#!/usr/bin/env node
// MCP stdio server — open-car-reprog ECU analyzer
// Protocole : MCP 2024-11-05 (JSON-RPC sur stdin/stdout)
// Enregistrement : claude mcp add ecu-analyzer node src/mcp-server.js
// Ou via .claude/settings.json (mcpServers.ecu-analyzer)

'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const ProjectManager = require('./project-manager');
const A2lParser = require('./a2l-parser');
const { readValue, readMapData } = require('./rom-patcher');
const { getEcu } = require('./ecu-catalog');
const { mapsChanged } = require('./map-differ');
const { loadOpenDamos, relocate } = require('./open-damos');

const BASE_DIR = process.env.OCR_BASE_DIR || path.join(__dirname, '..', 'projects');
const RESOURCE_DIR = path.join(__dirname, '..');
const pm = new ProjectManager(BASE_DIR);

// A2L cache (parse lourd — gardé en mémoire pour toute la session)
const a2lCache = new Map();

async function getA2l(ecuId) {
  if (a2lCache.has(ecuId)) return a2lCache.get(ecuId);
  const ecuDef = getEcu(ecuId);
  if (!ecuDef?.a2l) return null;
  const a2lPath = path.join(RESOURCE_DIR, ecuDef.a2l);
  const cachePath = a2lPath.replace('.a2l', '.cache.json');
  let parsed;
  if (fs.existsSync(cachePath)) {
    parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } else if (fs.existsSync(a2lPath)) {
    parsed = new A2lParser().parse(a2lPath);
  } else {
    return null;
  }
  a2lCache.set(ecuId, parsed);
  return parsed;
}

async function getA2lForProject(proj) {
  const customPath = path.join(BASE_DIR, proj.id, 'custom.a2l');
  if (fs.existsSync(customPath)) {
    const key = `custom:${proj.id}`;
    if (a2lCache.has(key)) return a2lCache.get(key);
    const parsed = new A2lParser().parse(customPath);
    a2lCache.set(key, parsed);
    return parsed;
  }
  return getA2l(proj.ecu);
}

// Résout l'adresse d'un scalaire (A2L → open_damos → catalog connu)
function resolveScalarAddress(name, a2l, proj, romBuf) {
  const char = a2l?.characteristics?.find(c => c.name === name);
  if (char?.address !== undefined) {
    return {
      address: char.address,
      addressSource: 'a2l',
      factor: char.factor || 1,
      offset: char.offset || 0,
      unit: char.unit || '',
    };
  }

  try {
    const od = loadOpenDamos(proj.ecu);
    if (od) {
      const relocated = relocate(od, romBuf);
      const entry = relocated.find(r => r.name === name);
      if (entry && entry.addressSource !== 'default-fallback' && entry.score > 0) {
        return {
          address: entry.address,
          addressSource: 'open_damos',
          factor: entry.data?.factor || 1,
          offset: entry.data?.offset || 0,
          unit: entry.unit || '',
        };
      }
    }
  } catch { /* non-fatal */ }

  const KNOWN = {
    AirCtl_nMin_C:    { address: 0x1C41B8, unit: 'tr/min' },
    AirCtl_nOvrRun_C: { address: 0x1C4046, unit: 'tr/min' },
    AirCtl_qOvrRun_C: { address: 0x1C40B4, unit: 'raw' },
  };
  if (KNOWN[name]) {
    return { ...KNOWN[name], addressSource: 'catalog', factor: 1, offset: 0 };
  }

  return null;
}

// ── Définitions des outils ──────────────────────────────────────────────────

const TOOLS = {

  ecu_list_projects: {
    description: 'Liste tous les projets ECU (nom, véhicule, calculateur, taille ROM). Point d\'entrée pour obtenir les IDs de projet.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    async execute() {
      const projects = await pm.list();
      return projects.map(p => ({
        id: p.id,
        name: p.name,
        vehicle: p.vehicle || '',
        immat: p.immat || '',
        year: p.year || '',
        ecu: p.ecu,
        hasRom: p.hasRom,
        romSize: p.romSize,
        description: p.description || '',
      }));
    },
  },

  ecu_search_params: {
    description: 'Cherche des paramètres A2L par nom ou mot-clé. Retourne les caractéristiques avec adresse, type (MAP/CURVE/VALUE/VAL_BLK) et unité.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'ID du projet (obtenu via ecu_list_projects)' },
        query:      { type: 'string', description: 'Mot-clé de recherche, ex: "AccPed", "Rail", "EGR", "boost"' },
        type:       { type: 'string', enum: ['VALUE', 'MAP', 'CURVE', 'VAL_BLK'], description: 'Filtrer par type (optionnel)' },
        limit:      { type: 'number', description: 'Nombre max de résultats, défaut 20' },
      },
      required: ['project_id', 'query'],
    },
    async execute({ project_id, query, type: typeFilter, limit = 20 }) {
      const proj = await pm.get(project_id);
      if (!proj) throw new Error(`Projet "${project_id}" introuvable`);
      const a2l = await getA2lForProject(proj);
      if (!a2l?.characteristics) return { results: [], total: 0 };
      const q = query.toLowerCase();
      const matches = a2l.characteristics
        .filter(c => c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q))
        .filter(c => !typeFilter || c.type === typeFilter);
      return {
        results: matches.slice(0, limit).map(c => ({
          name: c.name,
          type: c.type,
          address: c.address,
          addressHex: c.address !== undefined ? '0x' + c.address.toString(16).toUpperCase() : null,
          unit: c.unit || '',
          description: (c.description || '').slice(0, 200),
          dims: c.axisDefs?.map(a => a.maxAxisPoints) || [],
        })),
        total: matches.length,
        shown: Math.min(matches.length, limit),
      };
    },
  },

  ecu_read_map: {
    description: 'Lit les données d\'une cartographie (axes X/Y + matrice de valeurs) depuis la ROM courante ou la ROM stock originale.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        param_name: { type: 'string', description: 'Nom du paramètre A2L, ex: "AccPed_trqEngHiGear_MAP"' },
        from_stock:  { type: 'boolean', description: 'Si true, lit depuis la ROM originale (stock). Défaut false = ROM courante.' },
      },
      required: ['project_id', 'param_name'],
    },
    async execute({ project_id, param_name, from_stock = false }) {
      const proj = await pm.get(project_id);
      if (!proj) throw new Error(`Projet "${project_id}" introuvable`);
      if (!proj.hasRom) throw new Error('Aucune ROM importée pour ce projet');

      const a2l = await getA2lForProject(proj);
      const char = a2l?.characteristics?.find(c => c.name === param_name);
      if (!char?.address && char?.address !== 0) throw new Error(`Paramètre "${param_name}" non trouvé dans l'A2L`);

      const romFile = from_stock ? 'rom.original.bin' : 'rom.bin';
      const romPath = path.join(BASE_DIR, proj.id, romFile);
      if (!fs.existsSync(romPath)) throw new Error(`Fichier ROM "${romFile}" absent`);

      const rom = new Uint8Array(fs.readFileSync(romPath));
      const mapData = readMapData(rom, char.address);

      return {
        name: param_name,
        type: char.type,
        address: char.address,
        addressHex: '0x' + char.address.toString(16).toUpperCase(),
        unit: char.unit || '',
        description: char.description || '',
        nx: mapData.nx,
        ny: mapData.ny,
        xAxis: mapData.xAxis,
        yAxis: mapData.yAxis,
        data: mapData.data,
        from: from_stock ? 'stock' : 'current',
      };
    },
  },

  ecu_compare_map: {
    description: 'Compare une cartographie entre la ROM courante et la ROM stock. Retourne les deltas cellule par cellule, le % moyen de changement et les cellules modifiées.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        param_name: { type: 'string', description: 'Nom du paramètre A2L à comparer' },
      },
      required: ['project_id', 'param_name'],
    },
    async execute({ project_id, param_name }) {
      const proj = await pm.get(project_id);
      if (!proj) throw new Error(`Projet "${project_id}" introuvable`);
      if (!proj.hasRom) throw new Error('Aucune ROM importée');

      const origPath = path.join(BASE_DIR, proj.id, 'rom.original.bin');
      if (!fs.existsSync(origPath)) throw new Error('ROM originale absente (rom.original.bin)');

      const a2l = await getA2lForProject(proj);
      const char = a2l?.characteristics?.find(c => c.name === param_name);
      if (!char?.address && char?.address !== 0) throw new Error(`Paramètre "${param_name}" non trouvé dans l'A2L`);

      const curr = new Uint8Array(fs.readFileSync(path.join(BASE_DIR, proj.id, 'rom.bin')));
      const orig = new Uint8Array(fs.readFileSync(origPath));

      const currMap = readMapData(curr, char.address);
      const origMap = readMapData(orig, char.address);

      const deltas = currMap.data.map((v, i) => v - origMap.data[i]);
      const modified = deltas.filter(d => d !== 0).length;
      const pctList = origMap.data
        .map((o, i) => o !== 0 ? (currMap.data[i] - o) / Math.abs(o) * 100 : null)
        .filter(p => p !== null);
      const avgPct = pctList.length
        ? Math.round(pctList.reduce((a, b) => a + b, 0) / pctList.length * 10) / 10
        : 0;

      return {
        name: param_name,
        address: char.address,
        addressHex: '0x' + char.address.toString(16).toUpperCase(),
        unit: char.unit || '',
        description: char.description || '',
        nx: currMap.nx,
        ny: currMap.ny,
        xAxis: currMap.xAxis,
        yAxis: currMap.yAxis,
        currentData: currMap.data,
        stockData: origMap.data,
        deltas,
        modifiedCells: modified,
        totalCells: currMap.data.length,
        avgPctChange: avgPct,
        summary: modified === 0
          ? 'Identique au stock'
          : `${modified}/${currMap.data.length} cellules modifiées, moyenne ${avgPct > 0 ? '+' : ''}${avgPct}%`,
      };
    },
  },

  ecu_get_modified_maps: {
    description: 'Liste toutes les cartographies A2L qui ont été modifiées par rapport à la ROM stock d\'origine. Utile pour faire un audit de tune complet.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        min_cells:  { type: 'number', description: 'Nombre minimum de cellules changées pour apparaître (défaut 1)' },
      },
      required: ['project_id'],
    },
    async execute({ project_id, min_cells = 1 }) {
      const proj = await pm.get(project_id);
      if (!proj) throw new Error(`Projet "${project_id}" introuvable`);
      if (!proj.hasRom) throw new Error('Aucune ROM importée');

      const origPath = path.join(BASE_DIR, proj.id, 'rom.original.bin');
      if (!fs.existsSync(origPath)) throw new Error('ROM originale absente');

      const curr = fs.readFileSync(path.join(BASE_DIR, proj.id, 'rom.bin'));
      const orig = fs.readFileSync(origPath);
      const a2l = await getA2lForProject(proj);
      if (!a2l?.characteristics) return { maps: [], total: 0 };

      const { maps } = mapsChanged(orig, curr, a2l.characteristics);
      const filtered = maps.filter(m => m.cellsChanged >= min_cells);

      return {
        maps: filtered.map(m => ({
          name: m.name,
          type: m.type,
          address: m.address,
          addressHex: '0x' + m.address.toString(16).toUpperCase(),
          unit: m.unit,
          description: m.description,
          cellsChanged: m.cellsChanged,
          totalCells: m.totalCells,
          avgPctChange: m.avg ? Math.round(m.avg.avgRatio * 1000) / 10 : null,
        })),
        total: filtered.length,
      };
    },
  },

  ecu_read_scalar: {
    description: 'Lit la valeur actuelle d\'un paramètre VALUE (scalaire simple) depuis la ROM, avec comparaison à la valeur stock et facteur de conversion A2L. Cherche d\'abord dans l\'A2L, puis dans open_damos relocalisé, puis dans le catalog connu.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        param_name: { type: 'string', description: 'Nom du paramètre, ex: "AirCtl_nMin_C", "AccPed_nLimNMR_C", "VSSCD_vMax_C"' },
      },
      required: ['project_id', 'param_name'],
    },
    async execute({ project_id, param_name }) {
      const proj = await pm.get(project_id);
      if (!proj) throw new Error(`Projet "${project_id}" introuvable`);
      if (!proj.hasRom) throw new Error('Aucune ROM importée');

      const romPath = path.join(BASE_DIR, proj.id, 'rom.bin');
      const romBuf = fs.readFileSync(romPath);
      const a2l = await getA2lForProject(proj);
      const resolved = resolveScalarAddress(param_name, a2l, proj, romBuf);
      if (!resolved) throw new Error(`Paramètre "${param_name}" non trouvé dans A2L, open_damos ou catalog pour ECU ${proj.ecu}`);

      const rom = new Uint8Array(romBuf);
      const rawValue = readValue(rom, resolved.address);
      const physValue = rawValue * resolved.factor + resolved.offset;

      let stockRaw = null, stockPhys = null;
      const origPath = path.join(BASE_DIR, proj.id, 'rom.original.bin');
      if (fs.existsSync(origPath)) {
        const orig = new Uint8Array(fs.readFileSync(origPath));
        if (resolved.address + 1 < orig.length) {
          stockRaw = readValue(orig, resolved.address);
          stockPhys = stockRaw * resolved.factor + resolved.offset;
        }
      }

      return {
        name: param_name,
        address: resolved.address,
        addressHex: '0x' + resolved.address.toString(16).toUpperCase(),
        addressSource: resolved.addressSource,
        rawValue,
        physValue: Math.round(physValue * 100) / 100,
        stockRaw,
        stockPhys: stockPhys !== null ? Math.round(stockPhys * 100) / 100 : null,
        unit: resolved.unit,
        factor: resolved.factor,
        offset: resolved.offset,
        modified: stockRaw !== null && rawValue !== stockRaw,
      };
    },
  },

  ecu_analyze_stage1: {
    description: 'Analyse l\'état des cartographies Stage 1 du projet : % appliqué vs stock sur chaque MAP, valeurs pop&bang actuelles. Permet de voir l\'avancement d\'un tune Stage 1.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
      },
      required: ['project_id'],
    },
    async execute({ project_id }) {
      const proj = await pm.get(project_id);
      if (!proj) throw new Error(`Projet "${project_id}" introuvable`);
      if (!proj.hasRom) throw new Error('Aucune ROM importée');

      const ecuDef = getEcu(proj.ecu);
      const romPath = path.join(BASE_DIR, proj.id, 'rom.bin');
      const origPath = path.join(BASE_DIR, proj.id, 'rom.original.bin');
      const curr = new Uint8Array(fs.readFileSync(romPath));
      const hasOrig = fs.existsSync(origPath);
      const orig = hasOrig ? new Uint8Array(fs.readFileSync(origPath)) : null;

      const stage1 = [];
      if (ecuDef?.stage1Maps) {
        for (const m of ecuDef.stage1Maps) {
          try {
            const currMap = readMapData(curr, m.address);
            let avgPct = null;
            if (orig) {
              const origMap = readMapData(orig, m.address);
              let sum = 0, count = 0;
              for (let i = 0; i < currMap.data.length; i++) {
                const o = origMap.data[i];
                if (o > 0) { sum += (currMap.data[i] - o) / o; count++; }
              }
              avgPct = count > 0 ? Math.round(sum / count * 1000) / 10 : 0;
            }
            stage1.push({
              name: m.name,
              label: m.label,
              address: m.address,
              addressHex: '0x' + m.address.toString(16).toUpperCase(),
              nx: currMap.nx,
              ny: currMap.ny,
              avgPctVsStock: avgPct,
              defaultPct: m.defaultPct,
            });
          } catch (e) {
            stage1.push({ name: m.name, label: m.label, address: m.address, error: e.message });
          }
        }
      }

      const popbang = {};
      if (ecuDef?.popbangParams) {
        const p = ecuDef.popbangParams;
        popbang.nOvrRun = {
          label: p.nOvrRun.label,
          address: p.nOvrRun.address,
          current: readValue(curr, p.nOvrRun.address),
          stock: orig ? readValue(orig, p.nOvrRun.address) : null,
        };
        popbang.qOvrRun = {
          label: p.qOvrRun.label,
          address: p.qOvrRun.address,
          current: readValue(curr, p.qOvrRun.address),
          stock: orig ? readValue(orig, p.qOvrRun.address) : null,
        };
      }

      return { stage1, popbang };
    },
  },

};

// ── JSON-RPC / MCP protocol ─────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async raw => {
  const line = raw.trim();
  if (!line) return;

  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  const { id, method, params = {} } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'open-car-reprog-ecu-analyzer', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') return;
  if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0', id,
      result: {
        tools: Object.entries(TOOLS).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    const tool = TOOLS[name];
    if (!tool) { err(id, -32601, `Outil "${name}" inconnu`); return; }
    try {
      const result = await tool.execute(args);
      send({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      });
    } catch (e) {
      send({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: `Erreur : ${e.message}` }],
          isError: true,
        },
      });
    }
    return;
  }

  err(id, -32601, `Méthode "${method}" non supportée`);
});

rl.on('close', () => process.exit(0));
