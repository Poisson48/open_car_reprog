const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const GitManager = require('./git-manager');

class ProjectManager {
  constructor(projectsDir) {
    this.dir = projectsDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  getProjectDir(id) {
    return path.join(this.dir, id);
  }

  async list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.dir, e.name, 'meta.json'), 'utf8'));
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async get(id) {
    const p = path.join(this.dir, id, 'meta.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  async create({ name, ecu, description = '', vehicle = '', immat = '', year = '' }) {
    const id = uuidv4();
    const dir = this.getProjectDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const meta = {
      id, name, ecu, description, vehicle, immat, year,
      createdAt: new Date().toISOString(),
      hasRom: false
    };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    const gm = new GitManager(dir);
    await gm.init();
    await gm.commit('Initial project');

    return meta;
  }

  async update(id, fields) {
    const meta = await this.get(id);
    if (!meta) throw new Error('Project not found');
    Object.assign(meta, fields);
    fs.writeFileSync(path.join(this.getProjectDir(id), 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  async delete(id) {
    fs.rmSync(this.getProjectDir(id), { recursive: true, force: true });
  }

  async importRom(id, buffer, originalName) {
    const dir = this.getProjectDir(id);
    const romPath = path.join(dir, 'rom.bin');
    const backupPath = path.join(dir, 'rom.original.bin');

    fs.writeFileSync(romPath, buffer);

    // Only backup on first import — never overwrite the original
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, buffer);
    }

    const meta = await this.get(id);
    Object.assign(meta, {
      hasRom: true,
      romName: originalName,
      romSize: buffer.length,
      romImportedAt: new Date().toISOString()
    });
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    const gm = new GitManager(dir);
    await gm.commit(`Import ROM: ${originalName}`);

    return meta;
  }

  async patchRom(id, offset, data) {
    const romPath = path.join(this.dir, id, 'rom.bin');
    const fd = fs.openSync(romPath, 'r+');
    fs.writeSync(fd, data, 0, data.length, parseInt(offset));
    fs.closeSync(fd);
  }

  getRomPath(id) {
    const p = path.join(this.dir, id, 'rom.bin');
    return fs.existsSync(p) ? p : null;
  }

  getBackupPath(id) {
    const p = path.join(this.dir, id, 'rom.original.bin');
    return fs.existsSync(p) ? p : null;
  }
}

module.exports = ProjectManager;
