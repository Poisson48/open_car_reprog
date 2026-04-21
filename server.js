const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const ProjectManager = require('./src/project-manager');
const GitManager = require('./src/git-manager');
const A2lParser = require('./src/a2l-parser');
const WinolsParser = require('./src/winols-parser');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 32 * 1024 * 1024 } });

const pm = new ProjectManager(path.join(__dirname, 'projects'));

const ECU_A2L = {
  edc16c34: path.join(__dirname, 'ressources', 'edc16c34', 'damos.a2l')
};

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

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  res.json(await pm.list());
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, ecu, description } = req.body;
    if (!name || !ecu) return res.status(400).json({ error: 'name and ecu required' });
    res.status(201).json(await pm.create({ name, ecu, description }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', async (req, res) => {
  const p = await pm.get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
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

app.get('/api/projects/:id/rom', (req, res) => {
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
