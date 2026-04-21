import { api } from '../api.js';

export class GitPanel {
  constructor(el, { projectId, onRestore, onMapClick }) {
    this.el = el;
    this.projectId = projectId;
    this.onRestore = onRestore;
    this.onMapClick = onMapClick;
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
        <div class="git-commit-input-row">
          <input type="text" id="git-commit-msg" placeholder="Message de commit…">
          <button class="btn btn-sm" id="git-suggest-btn" title="Suggérer un message depuis les cartes modifiées">✨</button>
        </div>
        <button class="btn btn-success btn-sm" id="git-commit-btn" style="width:100%">💾 Commit modifications</button>
      </div>
      <div class="git-log" id="git-log"></div>
      <div class="git-diff-view" id="git-diff" style="display:none"></div>
    `;

    this.logEl = this.el.querySelector('#git-log');
    this.diffEl = this.el.querySelector('#git-diff');
    this.msgEl = this.el.querySelector('#git-commit-msg');

    this.el.querySelector('#git-refresh').addEventListener('click', () => this.refresh());
    this.el.querySelector('#git-commit-btn').addEventListener('click', () => this._commit());
    this.el.querySelector('#git-suggest-btn').addEventListener('click', () => this._suggestMsg(true));

    // Auto-suggest when user focuses an empty input
    this.msgEl.addEventListener('focus', () => {
      if (!this.msgEl.value.trim()) this._suggestMsg(false);
    });
  }

  async _suggestMsg(force) {
    try {
      const { maps } = await api.gitDiffMapsHead(this.projectId);
      if (!maps || !maps.length) {
        if (force) this._flashSuggest('rien à committer');
        return;
      }
      const msg = formatCommitMsg(maps);
      if (force || !this.msgEl.value.trim()) {
        this.msgEl.value = msg;
        this.msgEl.dataset.autofilled = '1';
      }
    } catch {
      if (force) this._flashSuggest('erreur');
    }
  }

  _flashSuggest(text) {
    const btn = this.el.querySelector('#git-suggest-btn');
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1200);
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
      const mapDiff = await api.gitDiffMaps(this.projectId, entry.hash);
      this._renderMapDiff(mapDiff, entry);
    } catch (e) {
      this.diffEl.innerHTML = `<div class="empty-state">Erreur diff: ${e.message}</div>`;
    }
  }

  _renderMapDiff(diff, entry) {
    if (diff.isFirst) {
      this.diffEl.innerHTML = `<div style="padding:8px;font-size:11px;color:var(--text-dim)">Premier commit (import ROM)</div>`;
      return;
    }
    if (!diff.maps?.length) {
      this.diffEl.innerHTML = `<div style="padding:8px;font-size:11px;color:var(--text-dim)">
        Aucune carte A2L modifiée
        ${diff.error ? `<br><em>${diff.error}</em>` : ''}
      </div>`;
      return;
    }

    const total = diff.maps.length;
    let html = `<div class="map-diff-header">
      <span>${total} carte${total > 1 ? 's' : ''} modifiée${total > 1 ? 's' : ''}</span>
      <button class="btn btn-sm btn-danger" id="git-restore-btn" title="Restaurer la ROM à cet état">⟲ Restaurer</button>
    </div>`;

    const shown = diff.maps.slice(0, 50);
    for (const m of shown) {
      const typeClass = `tag-${m.type.toLowerCase()}`;
      const cellsLabel = m.cellsChanged > 1 ? `${m.cellsChanged} cells` : `${m.cellsChanged} cell`;
      let sampleHtml = '';
      if (m.sample) {
        const delta = m.sample.after - m.sample.before;
        const sign = delta > 0 ? '+' : '';
        const pct = m.sample.before !== 0 ? Math.round((delta / Math.abs(m.sample.before)) * 100) : null;
        sampleHtml = `<span class="map-diff-sample">${m.sample.before} → ${m.sample.after} (${sign}${delta}${pct !== null ? `, ${sign}${pct}%` : ''})</span>`;
      }
      html += `<div class="map-diff-row" data-name="${m.name}" data-address="${m.address}">
        <div class="map-diff-main">
          <span class="tag ${typeClass}">${m.type}</span>
          <span class="map-diff-name">${m.name}</span>
          <span class="map-diff-cells">${cellsLabel}</span>
        </div>
        ${sampleHtml}
        <div class="map-diff-meta">0x${m.address.toString(16).toUpperCase()}${m.description ? ' · ' + m.description : ''}</div>
      </div>`;
    }
    if (total > 50) {
      html += `<div style="padding:4px 8px;font-size:10px;color:var(--text-dim)">… +${total - 50} autres</div>`;
    }

    this.diffEl.innerHTML = html;

    this.diffEl.querySelectorAll('.map-diff-row').forEach(row => {
      row.addEventListener('click', () => {
        const name = row.dataset.name;
        if (this.onMapClick) this.onMapClick(name);
      });
    });

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

function formatName(m) {
  if (m.sample) {
    const d = m.sample.after - m.sample.before;
    const pct = m.sample.before !== 0 ? Math.round((d / Math.abs(m.sample.before)) * 100) : null;
    const delta = pct !== null ? `${d >= 0 ? '+' : ''}${pct}%` : `${d >= 0 ? '+' : ''}${d}`;
    return `${m.name} ${delta}`;
  }
  return `${m.name}: ${m.cellsChanged} cell${m.cellsChanged > 1 ? 's' : ''}`;
}

function formatCommitMsg(maps) {
  const top = maps[0];
  const next = maps[1];

  // Solo winner: top is a tight fit AND clearly ahead of the next one
  const soloWinner = top.tightness >= 0.5 && (!next || next.tightness < top.tightness * 0.5);
  if (maps.length === 1 || soloWinner) return formatName(top);

  // Filter out loose overlap noise — keep matches within 30% of the top tightness
  const tight = maps.filter(m => m.tightness >= (top.tightness || 0) * 0.3);
  const display = tight.length >= 2 ? tight : maps;

  // Detect Stage 1 pattern
  const stage1 = new Set(['AccPed_trqEngHiGear_MAP', 'AccPed_trqEngLoGear_MAP', 'FMTC_trq2qBas_MAP', 'Rail_pSetPointBase_MAP', 'EngPrt_trqAPSLim_MAP']);
  const stage1Hit = [...stage1].filter(n => display.find(m => m.name === n)).length;
  if (stage1Hit >= 3) return `Stage 1 (${stage1Hit}/5 cartes)`;

  if (display.length <= 4) return display.map(m => m.name).join(', ');
  return `${display.length} cartes : ${display.slice(0, 3).map(m => m.name).join(', ')}, …`;
}
