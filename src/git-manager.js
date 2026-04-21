const { execFile } = require('child_process');
const util = require('util');
const simpleGit = require('simple-git');

const execFileAsync = util.promisify(execFile);

class GitManager {
  constructor(projectDir) {
    this.dir = projectDir;
    this.git = simpleGit(projectDir);
  }

  async init() {
    await this.git.init();
    await this.git.addConfig('user.email', 'reprog@local', false, 'local');
    await this.git.addConfig('user.name', 'open-car-reprog', false, 'local');
  }

  async commit(message) {
    await this.git.add('.');
    try {
      const result = await this.git.commit(message);
      return { hash: result.commit, message };
    } catch {
      return { nothing: true };
    }
  }

  async log() {
    try {
      const log = await this.git.log(['--all']);
      return log.all.map(e => ({
        hash: e.hash,
        date: e.date,
        message: e.message,
        author: e.author_name
      }));
    } catch {
      return [];
    }
  }

  async diff(hash) {
    try {
      const log = await this.git.log(['--all']);
      const idx = log.all.findIndex(c => c.hash === hash);
      if (idx === -1) return { error: 'commit not found' };

      const parentHash = log.all[idx + 1]?.hash;
      if (!parentHash) return { hash, changes: [], isFirst: true };

      const [currentBuf, parentBuf] = await Promise.all([
        this._showBinary(hash, 'rom.bin'),
        this._showBinary(parentHash, 'rom.bin')
      ]);

      const changes = this._diffBuffers(parentBuf, currentBuf);
      return { hash, parentHash, changes };
    } catch (e) {
      return { error: e.message };
    }
  }

  async restore(hash) {
    await this.git.checkout([hash, '--', 'rom.bin']);
    await this.git.add('rom.bin');
    await this.git.commit(`Restored to ${hash.slice(0, 8)}`);
  }

  async getStatus() {
    return this.git.status();
  }

  async listBranches() {
    try {
      const b = await this.git.branch();
      return {
        current: b.current,
        all: b.all.filter(n => !n.startsWith('remotes/'))
      };
    } catch {
      return { current: null, all: [] };
    }
  }

  async createBranch(name) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(name)) {
      throw new Error('Nom de branche invalide (lettres, chiffres, . _ / - uniquement)');
    }
    const { all } = await this.listBranches();
    if (all.includes(name)) throw new Error(`La branche "${name}" existe déjà`);
    await this.git.checkoutLocalBranch(name);
    return { name };
  }

  async switchBranch(name) {
    const status = await this.git.status();
    let autoCommitted = false;
    if (status.modified.length || status.not_added.length || status.created.length) {
      const current = (await this.git.branch()).current;
      await this.git.add('.');
      await this.git.commit(`WIP on ${current}`);
      autoCommitted = true;
    }
    await this.git.checkout(name);
    return { name, autoCommitted };
  }

  async deleteBranch(name) {
    const { current } = await this.listBranches();
    if (name === current) throw new Error('Impossible de supprimer la branche courante');
    await this.git.deleteLocalBranch(name, true);
  }

  async _showBinary(hash, file) {
    try {
      const { stdout } = await execFileAsync('git', ['show', `${hash}:${file}`], {
        cwd: this.dir,
        encoding: 'buffer',
        maxBuffer: 16 * 1024 * 1024
      });
      return stdout;
    } catch {
      return Buffer.alloc(0);
    }
  }

  _diffBuffers(a, b) {
    const changes = [];
    const len = Math.max(a.length, b.length);
    let i = 0;

    while (i < len) {
      const byteA = i < a.length ? a[i] : null;
      const byteB = i < b.length ? b[i] : null;
      if (byteA !== byteB) {
        const start = i;
        while (i < len && (i >= a.length || i >= b.length || a[i] !== b[i])) i++;
        changes.push({
          offset: start,
          old: Array.from(a.slice(start, i)),
          new: Array.from(b.slice(start, i))
        });
      } else {
        i++;
      }
    }

    return changes;
  }
}

module.exports = GitManager;
