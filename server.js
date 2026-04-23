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
const { loadOpenDamos, relocate: relocateOpenDamos } = require('./src/open-damos');
const { listTemplates, getTemplate, listTemplatesForEcu } = require('./src/vehicle-templates');
const { mapsChanged } = require('./src/map-differ');
const { findMaps } = require('./src/map-finder');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

const pm = new ProjectManager(path.join(__dirname, 'projects'));

// Ephemeral compare-with-file buffers: one per project, kept in RAM only.
// The UX is "upload a reference bin to diff against the current ROM" —
// no need to persist or commit it, the user re-uploads if the server restarts.
const compareBuffers = new Map(); // projectId -> { buffer, fileName, uploadedAt }

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

// Returns the A2L to use for a project: custom if uploaded, else ECU default.
// Parsed result is kept in process memory — no disk cache in the project dir
// to keep git commits clean. A fresh server sees the parse cost once per
// project that has a custom A2L, which is acceptable given how rarely these
// are uploaded.
const projectA2lCache = new Map(); // projectId -> parsed A2L
async function getA2lForProject(proj) {
  const customPath = path.join(pm.getProjectDir(proj.id), 'custom.a2l');
  if (fs.existsSync(customPath)) {
    if (projectA2lCache.has(proj.id)) return projectA2lCache.get(proj.id);
    const parsed = new A2lParser().parse(customPath);
    projectA2lCache.set(proj.id, parsed);
    return parsed;
  }
  return getA2l(proj.ecu);
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
    const allowed = ['name', 'description', 'vehicle', 'immat', 'year', 'ecu', 'displayAddressBase'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (updates.ecu && !getEcu(updates.ecu)) {
      return res.status(400).json({ error: `Unknown ECU: ${updates.ecu}` });
    }
    if (updates.displayAddressBase !== undefined) {
      updates.displayAddressBase = Number(updates.displayAddressBase) >>> 0;
    }
    const meta = await pm.update(req.params.id, updates);
    res.json(meta);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id', async (req, res) => {
  compareBuffers.delete(req.params.id);
  projectA2lCache.delete(req.params.id);
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

    const a2l = await getA2lForProject(proj);
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

    const a2l = await getA2lForProject(proj);
    if (!a2l) return res.json({ maps: [], error: 'No A2L for this ECU' });

    const { maps } = mapsChanged(headBuf, curBuf, a2l.characteristics);
    res.json({ maps });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Compare-with-file: upload a reference bin and diff against current ROM ───

app.post('/api/projects/:id/compare-file', upload.single('rom'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.status(400).json({ error: 'Project has no ROM to compare against' });

    const currentBuf = fs.readFileSync(pm.getRomPath(proj.id));
    const otherBuf = req.file.buffer;

    compareBuffers.set(proj.id, {
      buffer: otherBuf,
      fileName: req.file.originalname,
      uploadedAt: new Date().toISOString()
    });

    const a2l = await getA2lForProject(proj);
    if (!a2l) return res.json({ fileName: req.file.originalname, size: otherBuf.length, maps: [], error: 'No A2L for this ECU' });

    // Diff direction: otherBuf = "parent/ori", currentBuf = "child/tune".
    // This matches how mapsChanged computes deltas elsewhere (older → newer).
    const { maps, intervals } = mapsChanged(otherBuf, currentBuf, a2l.characteristics);
    res.json({
      fileName: req.file.originalname,
      size: otherBuf.length,
      maps,
      intervalCount: intervals.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id/compare-file', (req, res) => {
  const entry = compareBuffers.get(req.params.id);
  if (!entry) return res.status(404).json({ error: 'No compare file uploaded' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Compare-Filename', entry.fileName);
  res.end(entry.buffer);
});

app.delete('/api/projects/:id/compare-file', (req, res) => {
  compareBuffers.delete(req.params.id);
  res.json({ ok: true });
});

// ── Multi-ROM slots ───────────────────────────────────────────────────────────
// Each project can hold N reference ROMs (customer dumps, other tuners'
// versions). They live in roms/ inside the project dir and are NOT committed
// (a per-project .gitignore is seeded on first use). Slots are read-only
// references; the active/editable ROM remains rom.bin.

app.get('/api/projects/:id/roms', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(pm.listRomSlots(proj.id));
});

app.post('/api/projects/:id/roms', upload.single('rom'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    const name = req.body?.name || req.file.originalname;
    const slot = pm.addRomSlot(proj.id, req.file.buffer, name);
    res.status(201).json({ ...slot, originalName: req.file.originalname });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:id/roms/:slug', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  pm.deleteRomSlot(proj.id, req.params.slug);
  res.json({ ok: true });
});

// Load a stored slot as the compare-file reference — reuses the same buffer
// lookup that POST /compare-file populates, so the existing compare UI works
// unchanged.
app.post('/api/projects/:id/compare-file-from-slot/:slug', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.status(400).json({ error: 'Project has no ROM to compare against' });
    const slotPath = pm.getRomSlotPath(proj.id, req.params.slug);
    if (!slotPath) return res.status(404).json({ error: 'Slot not found' });

    const otherBuf = fs.readFileSync(slotPath);
    const currentBuf = fs.readFileSync(pm.getRomPath(proj.id));
    compareBuffers.set(proj.id, {
      buffer: otherBuf,
      fileName: req.params.slug + '.bin',
      uploadedAt: new Date().toISOString()
    });

    const a2l = await getA2lForProject(proj);
    if (!a2l) return res.json({ fileName: req.params.slug + '.bin', size: otherBuf.length, maps: [] });

    const { maps, intervals } = mapsChanged(otherBuf, currentBuf, a2l.characteristics);
    res.json({ fileName: req.params.slug + '.bin', size: otherBuf.length, maps, intervalCount: intervals.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Per-map notes (stored in meta.mapNotes) ───────────────────────────────────

app.get('/api/projects/:id/notes', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    res.json(proj.mapNotes || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/projects/:id/notes/:mapName', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    const text = (req.body?.text ?? '').toString();
    const notes = { ...(proj.mapNotes || {}) };
    if (text.trim() === '') delete notes[req.params.mapName];
    else notes[req.params.mapName] = text;
    await pm.update(req.params.id, { mapNotes: notes });
    res.json({ ok: true, notes });
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

function filterParamList(a2l, query) {
  let items = a2l.characteristics;
  const { search, type, offset = 0, limit = 200 } = query;
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(p =>
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }
  if (type) items = items.filter(p => p.type === type.toUpperCase());
  return { total: items.length, items: items.slice(+offset, +offset + +limit) };
}

function enrichParam(a2l, name) {
  const param = a2l.characteristics.find(c => c.name === name);
  if (!param) return null;
  const enriched = {
    ...param,
    _recordLayout: a2l.recordLayouts[param.recordLayout],
    _compuMethod: a2l.compuMethods[param.conversion]
  };
  for (const axis of (enriched.axisDefs || [])) {
    if (axis.axisPtsRef) axis._axisPts = a2l.axisPts[axis.axisPtsRef];
  }
  return enriched;
}

app.get('/api/ecu/:ecu/parameters', async (req, res) => {
  const a2l = await getA2l(req.params.ecu);
  if (!a2l) return res.status(404).json({ error: 'Unknown ECU or A2L not found' });
  res.json(filterParamList(a2l, req.query));
});

app.get('/api/ecu/:ecu/parameters/:name', async (req, res) => {
  const a2l = await getA2l(req.params.ecu);
  if (!a2l) return res.status(404).json({ error: 'Unknown ECU' });
  const enriched = enrichParam(a2l, req.params.name);
  if (!enriched) return res.status(404).json({ error: 'Parameter not found' });
  res.json(enriched);
});

// Project-scoped parameter routes. Use the project's custom A2L when uploaded,
// else fall back to the ECU default. The frontend always hits these so the
// switch between default and custom is transparent.
app.get('/api/projects/:id/parameters', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const a2l = await getA2lForProject(proj);
  if (!a2l) return res.status(404).json({ error: 'No A2L (neither project custom nor ECU default)' });
  res.json(filterParamList(a2l, req.query));
});

app.get('/api/projects/:id/parameters/:name', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const a2l = await getA2lForProject(proj);
  if (!a2l) return res.status(404).json({ error: 'No A2L' });
  const enriched = enrichParam(a2l, req.params.name);
  if (!enriched) return res.status(404).json({ error: 'Parameter not found' });
  res.json(enriched);
});

// ── Per-project custom A2L upload ─────────────────────────────────────────────

app.post('/api/projects/:id/a2l', upload.single('a2l'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });

    const customPath = path.join(pm.getProjectDir(proj.id), 'custom.a2l');
    fs.writeFileSync(customPath, req.file.buffer);
    projectA2lCache.delete(proj.id);

    // Parse on upload so we fail fast on a malformed file, and seed the cache
    const parsed = new A2lParser().parse(customPath);
    projectA2lCache.set(proj.id, parsed);

    await pm.update(proj.id, { customA2lName: req.file.originalname, customA2lUploadedAt: new Date().toISOString() });

    res.json({
      fileName: req.file.originalname,
      size: req.file.buffer.length,
      characteristicsCount: parsed.characteristics.length
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/projects/:id/a2l/info', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const customPath = path.join(pm.getProjectDir(proj.id), 'custom.a2l');
  if (!fs.existsSync(customPath)) return res.json({ custom: false, ecuDefault: proj.ecu });
  const a2l = await getA2lForProject(proj);
  res.json({
    custom: true,
    fileName: proj.customA2lName || 'custom.a2l',
    uploadedAt: proj.customA2lUploadedAt,
    size: fs.statSync(customPath).size,
    characteristicsCount: a2l?.characteristics?.length || 0
  });
});

app.delete('/api/projects/:id/a2l', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  const customPath = path.join(pm.getProjectDir(proj.id), 'custom.a2l');
  fs.rmSync(customPath, { force: true });
  projectA2lCache.delete(proj.id);
  await pm.update(proj.id, { customA2lName: null, customA2lUploadedAt: null });
  res.json({ ok: true });
});

// Damos vs ROM match check : pour chaque characteristic MAP/CURVE avec une
// adresse dans l'A2L, lit le header à cette adresse dans la ROM et vérifie
// si les dimensions et axes sont plausibles. Retourne un score 0..100 :
// 100 = parfait match (c'est bien la ROM que le damos décrit), < 30 = le
// damos est pour un autre firmware, 30-80 = calibration cousine mais adresses
// décalées → open_damos prend le relais pour Stage 1.
app.get('/api/projects/:id/a2l/match', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.json({ hasRom: false, score: null });

    const a2l = await getA2lForProject(proj);
    if (!a2l?.characteristics) return res.json({ hasA2l: false, score: null });

    const rom = fs.readFileSync(pm.getRomPath(proj.id));
    const sampleSize = 200; // échantillonne 200 MAP/CURVE pour rapidité
    const candidates = a2l.characteristics.filter(c =>
      (c.type === 'MAP' || c.type === 'CURVE') && c.address !== undefined
    );
    const sampled = candidates.length <= sampleSize
      ? candidates
      : sampleCharacteristics(candidates, sampleSize);

    let plausible = 0, implausible = 0, padding = 0;
    for (const c of sampled) {
      if (c.address + 4 > rom.length) { implausible++; continue; }
      const nx = (rom[c.address] << 8) | rom[c.address + 1];
      const ny = c.type === 'MAP' ? (rom[c.address + 2] << 8) | rom[c.address + 3] : 0;
      if (nx === 0xFFFF || (c.type === 'MAP' && ny === 0xFFFF)) { padding++; continue; }
      const nxOk = nx >= 2 && nx <= 64;
      const nyOk = c.type !== 'MAP' || (ny >= 2 && ny <= 64);
      if (nxOk && nyOk) plausible++; else implausible++;
    }

    const total = sampled.length;
    const score = total ? Math.round(100 * plausible / total) : 0;

    // Statut qualitatif pour l'UI
    let status, message;
    if (score >= 90) {
      status = 'match';
      message = 'Le damos correspond à ta ROM — Stage 1 utilise les adresses A2L.';
    } else if (score >= 30) {
      status = 'partial';
      message = `Damos partiellement compatible (${score}%). Probablement un firmware cousin — open_damos relocalise par empreinte d'axes pour Stage 1.`;
    } else {
      status = 'mismatch';
      message = `⚠ Ton damos NE correspond PAS à cette ROM (${score}% de matches). Upload un damos spécifique à ton firmware via 📑 A2L, ou laisse open_damos faire le job (fingerprint auto).`;
    }

    res.json({
      hasRom: true, hasA2l: true,
      score,
      status,
      message,
      sampled: total,
      plausible,
      implausible,
      padding,
      ecu: proj.ecu,
      a2lSource: proj.customA2lName ? 'custom' : 'catalog',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function sampleCharacteristics(list, n) {
  // Stratified sample — prend des entries espacées dans la liste pour
  // couvrir différentes zones mémoire (sinon on pourrait tomber sur un
  // cluster qui est tout en padding sans représenter l'ensemble).
  const step = Math.max(1, Math.floor(list.length / n));
  const result = [];
  for (let i = 0; i < list.length && result.length < n; i += step) result.push(list[i]);
  return result;
}

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

    // Résolution des adresses par cascade :
    //   1. A2L custom (uploadé par l'utilisateur pour son firmware)
    //   2. A2L catalog (damos.a2l de référence — ne marche que si la ROM
    //      a le même firmware que ori.BIN)
    //   3. open_damos relocation (scan par empreinte d'axes — marche sur
    //      n'importe quel firmware EDC16C34 PSA sans damos dédié)
    //   4. Hardcoded catalog addresses (dernier recours)
    // Chaque résultat précise sa source via addressSource pour que le
    // frontend puisse expliquer ce qui s'est passé.
    const a2l = await getA2lForProject(proj);
    const a2lByName = new Map();
    if (a2l?.characteristics) {
      for (const c of a2l.characteristics) a2lByName.set(c.name, c);
    }

    // Précalcul open_damos : scan fingerprint une seule fois, réutilisable.
    let openDamosByName = new Map();
    let openDamosInfo = null;
    try {
      const od = loadOpenDamos(proj.ecu);
      if (od) {
        const relocated = relocateOpenDamos(od, rom);
        openDamosInfo = { version: od.version, entries: relocated.length };
        for (const r of relocated) openDamosByName.set(r.name, r);
      }
    } catch (e) {
      // non-fatal, on continue sans
    }

    const result = [];
    for (const m of maps) {
      const pct = pcts[m.name] !== undefined ? Number(pcts[m.name]) : m.defaultPct;
      if (pct === 0) continue;

      // Cascade A2L → open_damos → catalog
      const a2lEntry = a2lByName.get(m.name);
      const odEntry = openDamosByName.get(m.name);

      let addr, source;
      if (a2lEntry?.address !== undefined) {
        addr = a2lEntry.address;
        source = 'a2l';
      } else if (odEntry && odEntry.addressSource === 'fingerprint') {
        addr = odEntry.address;
        source = 'open_damos:fingerprint';
      } else {
        addr = m.address;
        source = 'catalog';
      }

      try {
        const changed = applyPctToMap(u8, addr, pct);
        result.push({ map: m.name, pct, address: addr, addressSource: source, changed: changed.length });
      } catch (e) {
        // Si A2L a échoué et qu'open_damos a un match fingerprint, retry
        if (source === 'a2l' && odEntry && odEntry.addressSource === 'fingerprint') {
          try {
            const changed = applyPctToMap(u8, odEntry.address, pct);
            result.push({ map: m.name, pct, address: odEntry.address, addressSource: 'open_damos:fingerprint (a2l-fallback)', changed: changed.length });
            continue;
          } catch (e2) { /* fall through */ }
        }
        result.push({ map: m.name, pct, address: addr, addressSource: source, error: e.message });
      }
    }

    // Si toutes les cartes ont échoué (ou aucune n'a changé d'octet), c'est
    // que le catalog ne correspond pas au firmware de cette ROM — on ne
    // doit PAS écrire le fichier (il n'aurait rien changé de toute façon)
    // et on retourne 400 pour que le frontend puisse afficher une vraie
    // erreur au lieu d'un silent success.
    const totalChanged = result.reduce((s, r) => s + (r.changed || 0), 0);
    const allFailed = result.length > 0 && result.every(r => r.error);
    if (allFailed || totalChanged === 0) {
      return res.status(400).json({
        ok: false,
        maps: result,
        error: allFailed
          ? 'Aucune carte Stage 1 n\'a pu être lue dans cette ROM — le catalog ne correspond pas au firmware. Uploader un A2L custom pour votre ROM via 📑 A2L.'
          : 'Aucun octet n\'a changé (pct = 0 partout ?). Stage 1 non appliqué.',
      });
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

// ── Vehicle templates — presets Stage 1 / Pop&Bang / dépollution par famille ──

function findPatternInBuf(buf, pattern) {
  const last = buf.length - pattern.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (buf[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

async function applyTemplateToProject(proj, template) {
  const ecuDef = getEcu(proj.ecu);
  const romPath = pm.getRomPath(proj.id);
  const rom = Buffer.from(fs.readFileSync(romPath));
  const u8 = new Uint8Array(rom.buffer, rom.byteOffset, rom.byteLength);

  const result = { stage1: [], popbang: null, autoMods: [] };

  if (template.stage1 && ecuDef?.stage1Maps) {
    for (const m of ecuDef.stage1Maps) {
      const pct = template.stage1.pcts?.[m.name];
      if (pct === undefined || pct === 0) continue;
      try {
        const changed = applyPctToMap(u8, m.address, pct);
        result.stage1.push({ map: m.name, pct, changed: changed.length });
      } catch (e) {
        result.stage1.push({ map: m.name, pct, error: e.message });
      }
    }
  }

  if (template.popbang && ecuDef?.popbangParams) {
    const { rpm, fuelQty } = template.popbang;
    const p = ecuDef.popbangParams;
    const clampedRpm = Math.max(p.nOvrRun.min, Math.min(p.nOvrRun.max, Math.round(rpm)));
    const clampedQty = Math.max(p.qOvrRun.min, Math.min(p.qOvrRun.max, Math.round(fuelQty)));
    writeValue(u8, p.nOvrRun.address, clampedRpm);
    writeValue(u8, p.qOvrRun.address, clampedQty);
    result.popbang = { rpm: clampedRpm, fuelQty: clampedQty };
  }

  for (const modId of (template.autoMods || [])) {
    const pat = (ecuDef?.autoModPatterns || []).find(p => p.id === modId);
    const addr = (ecuDef?.autoModAddresses || []).find(a => a.id === modId);
    if (pat) {
      const offset = findPatternInBuf(u8, pat.search);
      if (offset < 0) { result.autoMods.push({ id: modId, error: 'signature not found' }); continue; }
      for (let i = 0; i < pat.replace.length; i++) u8[offset + i] = pat.replace[i];
      result.autoMods.push({ id: modId, type: 'pattern', offset, bytes: pat.replace.length });
    } else if (addr) {
      for (let i = 0; i < addr.bytes.length; i++) u8[addr.address + i] = addr.bytes[i];
      result.autoMods.push({ id: modId, type: 'address', offset: addr.address, bytes: addr.bytes.length });
    } else {
      result.autoMods.push({ id: modId, error: 'unknown mod id for this ECU' });
    }
  }

  fs.writeFileSync(romPath, rom);
  return result;
}

app.get('/api/templates', (req, res) => {
  res.json(listTemplates());
});

app.get('/api/projects/:id/templates', async (req, res) => {
  const proj = await pm.get(req.params.id);
  if (!proj) return res.status(404).json({ error: 'Project not found' });
  res.json(listTemplatesForEcu(proj.ecu));
});

app.post('/api/projects/:id/apply-template/:tid', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.status(400).json({ error: 'No ROM imported' });

    const template = getTemplate(req.params.tid);
    if (!template) return res.status(404).json({ error: 'Unknown template' });
    if (!template.appliesTo.includes(proj.ecu)) {
      return res.status(400).json({ error: `Template "${template.id}" incompatible avec l'ECU ${proj.ecu}` });
    }

    const result = await applyTemplateToProject(proj, template);
    res.json({ ok: true, template: template.id, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Map-Finder — auto-détection de cartographies sans A2L ─────────────────────
// Scanne la ROM pour des blocs `Kf_Xs16_Ys16_Ws16` (header nx/ny inline +
// axes monotones + data smooth). Côté serveur parce que l'upload round-trip
// d'une ROM 2 Mo vers le navigateur pour scanner côté client serait plus lent
// que 30ms d'exécution Node.

app.get('/api/projects/:id/auto-find-maps', async (req, res) => {
  try {
    const proj = await pm.get(req.params.id);
    if (!proj) return res.status(404).json({ error: 'Project not found' });
    if (!proj.hasRom) return res.status(400).json({ error: 'No ROM imported' });

    const buf = fs.readFileSync(pm.getRomPath(proj.id));

    const opts = {};
    if (req.query.minN) opts.minN = Math.max(2, Math.min(64, +req.query.minN));
    if (req.query.maxN) opts.maxN = Math.max(2, Math.min(64, +req.query.maxN));
    if (req.query.limit) opts.limit = Math.max(1, Math.min(500, +req.query.limit));
    if (req.query.startOffset) opts.startOffset = +req.query.startOffset;
    if (req.query.endOffset) opts.endOffset = +req.query.endOffset;

    // Cross-reference with A2L: tag candidates whose address matches a known map.
    const a2l = await getA2lForProject(proj);
    const knownByAddr = new Map();
    if (a2l) {
      for (const c of a2l.characteristics) {
        if (c.address !== undefined) knownByAddr.set(c.address, c.name);
      }
    }

    const t0 = Date.now();
    const maps = findMaps(buf, opts);
    const ms = Date.now() - t0;

    for (const m of maps) {
      const known = knownByAddr.get(m.address);
      if (known) m.knownName = known;
    }

    res.json({
      romSize: buf.length,
      scanMs: ms,
      count: maps.length,
      maps,
    });
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
