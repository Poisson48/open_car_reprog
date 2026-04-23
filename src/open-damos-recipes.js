// Recettes "auto-tune" prédéfinies qui opèrent sur les entries open_damos
// relocalisées. Chaque recette déclare une liste d'opérations :
//   - setPhys <num>            → écrit la valeur physique (raw = (phys-offset)/factor)
//   - setRaw <num>              → écrit directement la raw SWORD
//   - addPct <num>              → multiplie tous les octets d'une MAP par (1 + pct/100)
//   - setMapAll { phys }        → toutes les cellules de la MAP à la même valeur phys
//   - setCellMinPhys <num>      → sature cell-par-cell à MIN value (utile smoke limiter)
// Le code serveur résout chaque nom d'entry en adresse via open_damos relocation.

const { loadOpenDamos, relocate } = require('./open-damos');
const { readMapData, applyPctToMap, writeValue, readSwordBE, writeSwordBE } = require('./rom-patcher');

// CURVE version d'applyPct : header 2 bytes (nx uwBE), axes SWORD, data SWORD.
// rom-patcher.applyPctToMap suppose un header 4 bytes (MAP), d'où un helper
// dédié ici.
function applyPctToCurve(rom, address, pct, { onlyPositive = true } = {}) {
  const nx = (rom[address] << 8) | rom[address + 1];
  if (nx < 2 || nx > 64) throw new Error(`Invalid curve dim nx=${nx} at 0x${address.toString(16).toUpperCase()}`);
  const dataOff = address + 2 + nx * 2;
  const factor = 1 + pct / 100;
  const changed = [];
  for (let i = 0; i < nx; i++) {
    const cellOff = dataOff + i * 2;
    const raw = readSwordBE(rom, cellOff);
    if (onlyPositive && raw <= 0) continue;
    const newRaw = Math.max(-32768, Math.min(32767, Math.round(raw * factor)));
    if (newRaw !== raw) {
      writeSwordBE(rom, cellOff, newRaw);
      changed.push({ offset: cellOff, old: raw, new: newRaw });
    }
  }
  return changed;
}

// Bibliothèque de recettes
const RECIPES = {
  speed_limiter_off: {
    id: 'speed_limiter_off',
    name: 'Speed Limiter OFF — tous plafonds vitesse à 320 km/h',
    category: 'Limiters',
    description: 'Relève tous les plafonds de vitesse connus (régulateur, diagnostic, propulsion) à 320 km/h. Au-delà, le véhicule n\'est plus bridé électroniquement.',
    risk: 'low',
    ops: [
      { entry: 'VSSCD_vMax_C',         setPhys: 320 },
      { entry: 'CrCCD_vSetSpdMax_C',   setPhys: 320 },
      { entry: 'PrpCCD_vSetSpdMax_C',  setPhys: 320 },
    ],
  },

  smoke_off: {
    id: 'smoke_off',
    name: 'Smoke limiter assoupli — permet +20% de fuel sans coupure',
    category: 'Performance',
    description: 'Baisse la lambda mini du smoke cut (FlMng_rLmbdSmk_MAP) de 5% globalement → plus de fuel autorisé avant que le limiteur de fumée ne tire. Utile pour Stage 1+ si tu vois de la fumée noire pleine charge.',
    risk: 'medium',
    ops: [
      { entry: 'FlMng_rLmbdSmk_MAP', addPct: -5 },
    ],
  },

  torque_limiter_off: {
    id: 'torque_limiter_off',
    name: 'Torque Limiter OFF — relève les plafonds protection',
    category: 'Limiters',
    description: 'Relève les 2 plafonds couple (EngPrt_trqAPSLim_MAP + EngPrt_qLim_CUR) de 30%. Ces plafonds clamment tes gains Stage 1/2, les monter évite les saturations.',
    risk: 'medium',
    ops: [
      { entry: 'EngPrt_trqAPSLim_MAP', addPct: 30 },
      { entry: 'EngPrt_qLim_CUR',      addPct: 25 },
    ],
  },

  rev_limit_raise: {
    id: 'rev_limit_raise',
    name: 'Rev Limiter — zone non-monitored relevée',
    category: 'Limiters',
    description: 'Relève AccPed_nLimNMR_C (seuil régime non-monitored) de 1500 à 5500 rpm. Permet plus de souplesse aux hauts régimes sans trigger les diag.',
    risk: 'low',
    ops: [
      { entry: 'AccPed_nLimNMR_C', setPhys: 5500 },
    ],
  },

  rail_max_raise: {
    id: 'rail_max_raise',
    name: 'Rail Pressure Max — plafond à 1800 bar',
    category: 'Performance',
    description: 'Relève le plafond de pression rail (Rail_pSetPointMax_MAP) de 15% → ~1800 bar. Nécessaire pour Stage 2+ quand Rail_pSetPointBase atteint ce plafond.',
    risk: 'medium',
    ops: [
      { entry: 'Rail_pSetPointMax_MAP', addPct: 15 },
    ],
  },

  full_depollution: {
    id: 'full_depollution',
    name: 'Dépollution complète — EGR OFF + seuils relevés',
    category: 'Dépollution',
    description: 'Coupe EGR définitivement (seuil 8000 rpm via AirCtl_nMin_C) + relève AccPed_trqNMRMax_C pour éviter les clamp au Stage 1. ATTENTION : combiner avec un défap mécanique.',
    risk: 'low',
    ops: [
      { entry: 'AirCtl_nMin_C',          setPhys: 8000 },
      { entry: 'AccPed_trqNMRMax_C',     setPhys: 250 },
    ],
  },
};

function listRecipes() {
  return Object.values(RECIPES).map(r => ({
    id: r.id, name: r.name, category: r.category,
    description: r.description, risk: r.risk,
    opsCount: r.ops.length,
  }));
}

function getRecipe(id) { return RECIPES[id] || null; }

// Applique une recette sur un ROM buffer (modifié en place). Retourne
// { ok, operations: [{entry, method, address, ...}], bytesChanged }.
function applyRecipe(recipe, romBuf, ecu) {
  const damos = loadOpenDamos(ecu);
  if (!damos) throw new Error(`No open_damos for ECU ${ecu}`);
  const relocated = relocate(damos, romBuf);
  const byName = new Map(relocated.map(r => [r.name, r]));

  const u8 = new Uint8Array(romBuf.buffer, romBuf.byteOffset, romBuf.byteLength);
  const operations = [];
  let bytesChanged = 0;

  for (const op of recipe.ops) {
    const rel = byName.get(op.entry);
    if (!rel) {
      operations.push({ entry: op.entry, error: 'Entry not found in open_damos', method: null });
      continue;
    }
    if (rel.addressSource === 'default-fallback' || rel.score === 0) {
      operations.push({ entry: op.entry, error: `Entry could not be relocated on this ROM (${rel.warning || 'no fingerprint'}), skipping for safety`, address: rel.address, addressSource: rel.addressSource });
      continue;
    }

    try {
      if (op.setPhys !== undefined && rel.type === 'VALUE') {
        const factor = rel.data?.factor || 1;
        const offset = rel.data?.offset || 0;
        const raw = Math.round((op.setPhys - offset) / factor);
        const clamped = Math.max(-32768, Math.min(32767, raw));
        const prev = (u8[rel.address] << 8) | u8[rel.address + 1];
        writeValue(u8, rel.address, clamped);
        if (prev !== clamped) bytesChanged += 2;
        operations.push({ entry: op.entry, address: rel.address, addressSource: rel.addressSource, method: 'setPhys', physValue: op.setPhys, rawValue: clamped, prevRaw: prev });
      } else if (op.setRaw !== undefined && rel.type === 'VALUE') {
        const prev = (u8[rel.address] << 8) | u8[rel.address + 1];
        writeValue(u8, rel.address, op.setRaw);
        if (prev !== op.setRaw) bytesChanged += 2;
        operations.push({ entry: op.entry, address: rel.address, addressSource: rel.addressSource, method: 'setRaw', rawValue: op.setRaw, prevRaw: prev });
      } else if (op.addPct !== undefined && rel.type === 'MAP') {
        const changed = applyPctToMap(u8, rel.address, op.addPct);
        bytesChanged += changed.length * 2;
        operations.push({ entry: op.entry, address: rel.address, addressSource: rel.addressSource, method: 'addPct', pct: op.addPct, cellsChanged: changed.length });
      } else if (op.addPct !== undefined && rel.type === 'CURVE') {
        const changed = applyPctToCurve(u8, rel.address, op.addPct);
        bytesChanged += changed.length * 2;
        operations.push({ entry: op.entry, address: rel.address, addressSource: rel.addressSource, method: 'addPct', pct: op.addPct, cellsChanged: changed.length });
      } else if (op.setMapAll !== undefined && (rel.type === 'MAP' || rel.type === 'CURVE')) {
        const factor = rel.data?.factor || 1;
        const offset = rel.data?.offset || 0;
        const raw = Math.max(-32768, Math.min(32767, Math.round((op.setMapAll.phys - offset) / factor)));
        const { dataOff, data } = readMapData(u8, rel.address);
        let cells = 0;
        for (let i = 0; i < data.length; i++) {
          const cellOff = dataOff + i * 2;
          const prev = (u8[cellOff] << 8) | u8[cellOff + 1];
          writeValue(u8, cellOff, raw);
          if (prev !== raw) { cells++; bytesChanged += 2; }
        }
        operations.push({ entry: op.entry, address: rel.address, addressSource: rel.addressSource, method: 'setMapAll', physValue: op.setMapAll.phys, rawValue: raw, cellsChanged: cells });
      } else {
        operations.push({ entry: op.entry, error: `Unsupported operation on type ${rel.type}`, method: Object.keys(op).filter(k => k !== 'entry')[0] });
      }
    } catch (e) {
      operations.push({ entry: op.entry, address: rel.address, error: e.message });
    }
  }

  return { ok: operations.some(o => !o.error), operations, bytesChanged };
}

module.exports = { RECIPES, listRecipes, getRecipe, applyRecipe };
