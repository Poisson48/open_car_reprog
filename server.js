const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const ProjectManager = require('./src/project-manager');
const GitManager = require('./src/git-manager');
const A2lParser = require('./src/a2l-parser');
const WinolsParser = require('./src/winols-parser');
const { applyPctToMap, readValue, writeValue } = require('./src/rom-patcher');
const { getEcu, listEcus } = require('./src/ecu-catalog');
const { mapsChanged } = require('./src/map-differ');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

const pm = new ProjectManager(path.join(__dirname, 'projects'));

// Build A2L path map from catalog
const ECU_A2L = {};
for (const ecu of listEcus()) {
  const entry = getEcu(ecu.id);
  if (entry?.a2l) {
    ECU_A2L[ecu.id] = path.join(__dirname, entry.a2l);
  }
}

// A2L parsed cache (in-memory + file cache)
const a2lCache = {};

async function getA2l(ecu) {
  if (a2lCache[ecu]) return a2lCache[ecu];

  const a2lPath = ECU_A2L[ecu];
  if (!a2lPath || !fs.existsSync(a2lPath)) return null;

  const cachePath = a2lPath.replace('.a2l', '.cache.json');
  if (fs.existsSync(cachePath)) {
    console.log(`[A2L] Loading cached ${ecu}...`);
    a2lCache[ecu] = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return a2lCache[ecu];
  }

  const parser = new A2lParser();
  const parsed = parser.parse(a2lPath);
  fs.writeFileSync(cachePath, JSON.stringify(parsed));
  a2lCache[ecu] = parsed;
  return parsed;
}

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Version ───────────────────────────────────────────────────────────────────

app.get('/api/version', (req, res) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  res.json({ version: pkg.version });
});

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  res.json(await pm.list());
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, ecu, description, vehicle, immat, year } = req.body;
    if (!name || !ecu) return res.status(400).json({ error: 'name and ecu required' });
    res.status(201).json(await pm.create({ name, ecu, description, vehicle, immat, year }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  const p = await pm.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.patch('/api/projects/:id', async (req, res) => {
  try {
    const allowed = ['name', 'description', 'vehicle', 'immat', 'year', 'ecu'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (updates.ecu && !getEcu(updates.ecu)) {
      return res.status(400).json({ error: `Unknown ECU: ${updates.ecu}` });
    }
    const meta = await pm.update(req.params.id, updates);
    res.json(meta);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  await pm.delete(req.params.id);
  res.status(204).end();
});

// ── ROM ───────────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/rom', upload.single('rom'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const meta = await pm.importRom(req.params.id, req.file.buffer, req.file.originalname);
    res.json(meta);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/projects/:id/rom', async (req, res) => {
  if (req.query.commit) {
    try {
      const gm = new GitManager(pm.getProjectDir(req.params.id));
      const buf = await gm.readFileAtCommit(req.query.commit);
      if (!buf.length) return res.status(404).json({ error: 'No rom at commit' });
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.end(buf);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  const p = pm.getRomPath(req.params.id);
  if (!p) return res.status(404).json({ error: 'No ROM' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(p);
});

app.get('/api/projects/:id/rom/backup', (req, res) => {
  const p = pm.getBackupPath(req.params.id);
  if (!p) return res.status(404).json({ error: 'No backup' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(p);
});

app.patch('/api/projects/:id/rom/bytes', async (req, res) => {
  try {
    const { offset, data } = req.body; // data is base64
    await pm.patchRom(req.params.id, offset, Buffer.from(data, 'base64'));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Git ───────────────────────────────────────────────────────────────────────

app.post('/api/projects/:id/git/commit', async (req, res) => {
  try {
    const gm = new GitManager(pm.getProjectDir(req.params.id));
    const result = await gm.commit(req.body.message || 'Update ROM');
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/projects/:id/git/log', async (req, res) => {
  const gm = new GitManager(pm.getProjectDir(req.params.id));
  res.json(await gm.log());
});

app.get('/api/projects/:id/git/diff/:hash', async (req, res) => {
  const gm = new GitManager(pm.getProjectDir(req.params.id));
  res.json(await gm.diff(req.params.hash));
});

app.post('/api/projects/:id/git/restore/:hash', async (req, res) => {
  try {
    const gm = new GitManager(pm.getProjectDir(req.params.id));
    await gm.restore(req.params.hash);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Map-level diff: what A2L characteristics differ between a commit and its parent.
app.get('/api/projects/:id/git/diff-maps/:hash', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });

    const gm = new GitManager(pm.getProjectDir(proj.id));
    const log = await gm.log();
    const idx = log.findIndex(c => c.hash === req.params.hash);
    if (idx === -1) return res.status(404).json({ error: 'commit not found' });

    const parentHash = log[idx + 1]?.hash;
    if (!parentHash) return res.json({ hash: req.params.hash, isFirst: true, maps: [] });

    const [curBuf, parentBuf] = await Promise.all([
      gm.readFileAtCommit(req.params.hash),
      gm.readFileAtCommit(parentHash)
    ]);

    const a2l = await getA2l(proj.ecu);
    if (!a2l) return res.json({ hash: req.params.hash, parentHash, maps: [], error: 'No A2L for this ECU' });

    const { maps, intervals } = mapsChanged(parentBuf, curBuf, a2l.characteristics);
    res.json({ hash: req.params.hash, parentHash, maps, intervalCount: intervals.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// What maps differ between HEAD and the working-tree rom.bin (used for auto-generated commit messages).
app.get('/api/projects/:id/git/diff-maps-head', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.json({ maps: [] });

    const gm = new GitManager(pm.getProjectDir(proj.id));
    const log = await gm.log();
    const headHash = log[0]?.hash;
    if (!headHash) return res.json({ maps: [] });

    const headBuf = await gm.readFileAtCommit(headHash);
    const curBuf = fs.readFileSync(pm.getRomPath(proj.id));

    const a2l = await getA2l(proj.ecu);
    if (!a2l) return res.json({ maps: [], error: 'No A2L for this ECU' });

    const { maps } = mapsChanged(headBuf, curBuf, a2l.characteristics);
    res.json({ maps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/git/branches', async (req, res) => {
  try {
    const gm = new GitManager(pm.getProjectDir(req.params.id));
    res.json(await gm.listBranches());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:id/git/branches', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const gm = new GitManager(pm.getProjectDir(req.params.id));
    const result = await gm.createBranch(name);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/projects/:id/git/branches/:name', async (req, res) => {
  try {
    const gm = new GitManager(pm.getProjectDir(req.params.id));
    const result = await gm.switchBranch(req.params.name);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/git/branches/:name', async (req, res) => {
  try {
    const gm = new GitManager(pm.getProjectDir(req.params.id));
    await gm.deleteBranch(req.params.name);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── ECU Parameters ────────────────────────────────────────────────────────────

app.get('/api/ecu/:ecu/parameters', async (req, res) => {
  const a2l = await getA2l(req.params.ecu);
  if (!a2l) return res.status(404).json({ error: 'Unknown ECU or A2L not found' });

  let items = a2l.characteristics;
  const { search, type, offset = 0, limit = 200 } = req.query;

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(p =>
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }
  if (type) items = items.filter(p => p.type === type.toUpperCase());

  res.json({ total: items.length, items: items.slice(+offset, +offset + +limit) });
});

app.get('/api/ecu/:ecu/parameters/:name', async (req, res) => {
  const a2l = await getA2l(req.params.ecu);
  if (!a2l) return res.status(404).json({ error: 'Unknown ECU' });
  const param = a2l.characteristics.find(c => c.name === req.params.name);
  if (!param) return res.status(404).json({ error: 'Parameter not found' });

  // Include record layout and compu method details
  const enriched = {
    ...param,
    _recordLayout: a2l.recordLayouts[param.recordLayout],
    _compuMethod: a2l.compuMethods[param.conversion]
  };

  // For CURVE/MAP: include axis details
  for (const axis of (enriched.axisDefs || [])) {
    if (axis.axisPtsRef) {
      axis._axisPts = a2l.axisPts[axis.axisPtsRef];
    }
  }

  res.json(enriched);
});

// ── ECU list ──────────────────────────────────────────────────────────────────

app.get('/api/ecu', (req, res) => {
  res.json(listEcus());
});

app.post('/api/projects/:id/stage1', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.status(400).json({ error: 'No ROM imported' });

    const ecuDef = getEcu(proj.ecu);
    const maps = ecuDef?.stage1Maps;
    if (!maps) return res.status(400).json({ error: 'Stage 1 non supporté pour ce calculateur' });

    // { mapName: pct } overrides from body, or use defaults
    const pcts = req.body.pcts || {};

    const romPath = pm.getRomPath(proj.id);
    const rom = Buffer.from(fs.readFileSync(romPath));
    const u8 = new Uint8Array(rom.buffer, rom.byteOffset, rom.byteLength);

    const result = [];
    for (const m of maps) {
      const pct = pcts[m.name] !== undefined ? Number(pcts[m.name]) : m.defaultPct;
      if (pct === 0) continue;
      try {
        const changed = applyPctToMap(u8, m.address, pct);
        result.push({ map: m.name, pct, changed: changed.length });
      } catch (e) {
        result.push({ map: m.name, error: e.message });
      }
    }

    fs.writeFileSync(romPath, rom);
    res.json({ ok: true, maps: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/popbang', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.status(400).json({ error: 'No ROM imported' });

    const ecuDef = getEcu(proj.ecu);
    const params = ecuDef?.popbangParams;
    if (!params) return res.status(400).json({ error: 'Pop & bang non supporté pour ce calculateur' });

    const { rpm = 3000, fuelQty = 10 } = req.body; // fuelQty in raw units (×10 mg)

    const romPath = pm.getRomPath(proj.id);
    const rom = Buffer.from(fs.readFileSync(romPath));
    const u8 = new Uint8Array(rom.buffer, rom.byteOffset, rom.byteLength);

    const clampedRpm = Math.max(params.nOvrRun.min, Math.min(params.nOvrRun.max, Math.round(rpm)));
    const clampedQty = Math.max(params.qOvrRun.min, Math.min(params.qOvrRun.max, Math.round(fuelQty)));

    writeValue(u8, params.nOvrRun.address, clampedRpm);
    writeValue(u8, params.qOvrRun.address, clampedQty);

    fs.writeFileSync(romPath, rom);
    res.json({ ok: true, rpm: clampedRpm, fuelQty: clampedQty });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WinOLS Import ─────────────────────────────────────────────────────────────

app.post('/api/projects/:id/import-winols', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const parser = new WinolsParser();
    const { rom, filename } = await parser.parse(req.file.buffer, req.file.originalname);
    const meta = await pm.importRom(req.params.id, rom, filename);
    res.json(meta);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  open-car-reprog → http://localhost:${PORT}\n`);
});
