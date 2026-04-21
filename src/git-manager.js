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
