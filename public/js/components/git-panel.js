import { api } from '../api.js';

export class GitPanel {
  constructor(el, { projectId, onRestore }) {
    this.el = el;
    this.projectId = projectId;
    this.onRestore = onRestore;
    this.entries = [];
    this.activeHash = null;
    this._build();
    this.refresh();
  }

  _build() {
    this.el.innerHTML = `
      <div class="git-panel-header">
        <span>Historique Git</span>
        <button class="btn btn-sm" id="git-refresh">↻</button>
      </div>
      <div class="git-commit-area">
        <input type="text" id="git-commit-msg" placeholder="Message de commit…">
        <button class="btn btn-success btn-sm" id="git-commit-btn" style="width:100%">💾 Commit modifications</button>
      </div>
      <div class="git-log" id="git-log"></div>
      <div class="git-diff-view" id="git-diff" style="display:none"></div>
    `;

    this.logEl = this.el.querySelector('#git-log');
    this.diffEl = this.el.querySelector('#git-diff');

    this.el.querySelector('#git-refresh').addEventListener('click', () => this.refresh());
    this.el.querySelector('#git-commit-btn').addEventListener('click', () => this._commit());
  }

  async refresh() {
    try {
      this.entries = await api.gitLog(this.projectId);
      this._renderLog();
    } catch (e) {
      this.logEl.innerHTML = `<div class="empty-state">Erreur: ${e.message}</div>`;
    }
  }

  async _commit() {
    const msgEl = this.el.querySelector('#git-commit-msg');
    const msg = msgEl.value.trim() || 'Update ROM';
    try {
      await api.gitCommit(this.projectId, msg);
      msgEl.value = '';
      await this.refresh();
    } catch (e) {
      alert('Commit échoué: ' + e.message);
    }
  }

  _renderLog() {
    if (!this.entries.length) {
      this.logEl.innerHTML = '<div class="empty-state">Pas de commits</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const entry of this.entries) {
      const div = document.createElement('div');
      div.className = 'git-entry' + (this.activeHash === entry.hash ? ' active' : '');
      const date = new Date(entry.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
      div.innerHTML = `
        <div class="git-msg">${entry.message}</div>
        <div class="git-meta">${date}</div>
        <div class="git-hash">${entry.hash.slice(0, 8)}</div>
      `;
      div.addEventListener('click', () => this._selectCommit(entry, div));
      frag.appendChild(div);
    }
    this.logEl.innerHTML = '';
    this.logEl.appendChild(frag);
  }

  async _selectCommit(entry, el) {
    this.activeHash = entry.hash;
    this.logEl.querySelectorAll('.git-entry').forEach(e => e.classList.remove('active'));
    el.classList.add('active');

    this.diffEl.style.display = '';
    this.diffEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

    try {
      const diff = await api.gitDiff(this.projectId, entry.hash);
      this._renderDiff(diff, entry);
    } catch (e) {
      this.diffEl.innerHTML = `<div class="empty-state">Erreur diff: ${e.message}</div>`;
    }
  }

  _renderDiff(diff, entry) {
    if (diff.isFirst) {
      this.diffEl.innerHTML = `<div style="padding:8px;font-size:11px;color:var(--text-dim)">Premier commit (import ROM)</div>`;
      return;
    }
    if (!diff.changes?.length) {
      this.diffEl.innerHTML = `<div style="padding:8px;font-size:11px;color:var(--text-dim)">Aucune modification ROM</div>`;
      return;
    }

    let html = `<div style="padding:4px 8px;font-size:10px;color:var(--text-dim);border-bottom:1px solid var(--border);margin-bottom:4px">
      ${diff.changes.length} région(s) modifiée(s)
      <button class="btn btn-sm btn-danger" id="git-restore-btn" style="float:right;font-size:9px">⟲ Restaurer</button>
    </div>`;

    for (const ch of diff.changes.slice(0, 30)) {
      const oldHex = ch.old.map(b => b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
      const newHex = ch.new.map(b => b.toString(16).toUpperCase().padStart(2,'0')).join(' ');
      html += `<div class="diff-row">
        <span class="diff-offset">0x${ch.offset.toString(16).toUpperCase()}</span>
        <span class="diff-old">${oldHex}</span>
        <span style="color:var(--text-dim)">→</span>
        <span class="diff-new">${newHex}</span>
      </div>`;
    }
    if (diff.changes.length > 30) {
      html += `<div style="padding:4px 8px;font-size:10px;color:var(--text-dim)">… +${diff.changes.length - 30} autres</div>`;
    }

    this.diffEl.innerHTML = html;

    this.diffEl.querySelector('#git-restore-btn')?.addEventListener('click', async () => {
      if (!confirm(`Restaurer la ROM à l'état du commit "${entry.message}" ?`)) return;
      try {
        await api.gitRestore(this.projectId, entry.hash);
        if (this.onRestore) this.onRestore();
        await this.refresh();
      } catch (e) {
        alert('Restauration échouée: ' + e.message);
      }
    });
  }
}
