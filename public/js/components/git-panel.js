import { api } from '../api.js';

export class GitPanel {
  constructor(el, { projectId, onRestore, onMapClick, onCompareRefsMap }) {
    this.el = el;
    this.projectId = projectId;
    this.onRestore = onRestore;
    this.onMapClick = onMapClick;
    this.onCompareRefsMap = onCompareRefsMap;
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
      <div class="git-compare-area">
        <button class="btn btn-sm" id="git-compare-btn" title="Comparer la ROM actuelle à un fichier externe (.bin)">📁 Comparer avec un fichier…</button>
        <input type="file" id="git-compare-input" accept=".bin,.BIN,.hex,.HEX" style="display:none">
        <button class="btn btn-sm" id="git-compare-refs-btn" title="Comparer 2 commits ou branches arbitraires">🔀 Comparer 2 commits / branches…</button>
        <div id="git-compare-status" class="git-compare-status" style="display:none"></div>
      </div>
      <div class="git-slots-area">
        <div class="git-slots-head">
          <span>ROMs du projet</span>
          <button class="btn btn-sm" id="git-slot-add" title="Ajouter une ROM de référence au projet">+ Ajouter</button>
          <input type="file" id="git-slot-input" accept=".bin,.BIN,.hex,.HEX" style="display:none">
        </div>
        <div class="git-slots-list" id="git-slots-list"></div>
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

    // Compare-with-file wiring
    const cmpBtn = this.el.querySelector('#git-compare-btn');
    const cmpInput = this.el.querySelector('#git-compare-input');
    cmpBtn.addEventListener('click', () => cmpInput.click());
    cmpInput.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) this._onCompareFile(f);
      cmpInput.value = '';
    });

    // Compare-2-refs wiring (branches / commits arbitraires)
    const cmpRefsBtn = this.el.querySelector('#git-compare-refs-btn');
    cmpRefsBtn?.addEventListener('click', () => this._openCompareRefsModal());

    // Multi-ROM slots wiring
    const slotBtn = this.el.querySelector('#git-slot-add');
    const slotInput = this.el.querySelector('#git-slot-input');
    slotBtn.addEventListener('click', () => slotInput.click());
    slotInput.addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        await api.addRomSlot(this.projectId, f, f.name);
        await this._refreshSlots();
      } catch (err) {
        alert('Ajout ROM échoué : ' + err.message);
      }
      slotInput.value = '';
    });
    this._refreshSlots();

    // Auto-suggest when user focuses an empty input
    this.msgEl.addEventListener('focus', () => {
      if (!this.msgEl.value.trim()) this._suggestMsg(false);
    });
  }

  async _onCompareFile(file) {
    const status = this.el.querySelector('#git-compare-status');
    status.style.display = '';
    status.innerHTML = `<div class="spinner"></div> Analyse de ${file.name}…`;
    try {
      const fd = new FormData();
      fd.append('rom', file);
      const r = await fetch(`/api/projects/${this.projectId}/compare-file`, { method: 'POST', body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || r.statusText);
      }
      const diff = await r.json();
      this.compareFileName = diff.fileName;
      status.innerHTML = `📁 <b>${diff.fileName}</b> <span style="color:var(--text-dim)">(${(diff.size / 1024).toFixed(0)} KB · ${diff.maps?.length || 0} cartes diffèrent)</span> <a href="#" id="git-compare-clear">✕</a>`;
      status.querySelector('#git-compare-clear').addEventListener('click', e => {
        e.preventDefault();
        this._clearCompare();
      });

      // Deselect any commit and render the file-diff in the diff area
      this.activeHash = null;
      this.logEl.querySelectorAll('.git-entry').forEach(e => e.classList.remove('active'));
      this.diffEl.style.display = '';
      this._renderMapDiff(
        { maps: diff.maps, error: diff.error },
        { compareFile: true, fileName: diff.fileName, message: `fichier ${diff.fileName}` }
      );
    } catch (e) {
      status.innerHTML = `<span style="color:var(--danger)">Erreur: ${e.message}</span>`;
    }
  }

  async _refreshSlots() {
    const listEl = this.el.querySelector('#git-slots-list');
    if (!listEl) return;
    let slots = [];
    try { slots = await api.listRomSlots(this.projectId); } catch {}
    if (!slots.length) {
      listEl.innerHTML = `<div class="git-slots-empty">Aucune ROM stockée. Cliquez "+ Ajouter" pour en mettre une en référence.</div>`;
      return;
    }
    listEl.innerHTML = slots.map(s => `
      <div class="git-slot-row" data-slug="${s.slug}">
        <div class="git-slot-main">
          <span class="git-slot-name">${s.slug}</span>
          <span class="git-slot-meta">${(s.size / 1024).toFixed(0)} KB</span>
        </div>
        <div class="git-slot-actions">
          <button class="btn btn-sm git-slot-compare" title="Comparer à la ROM active">📊</button>
          <button class="btn btn-sm btn-danger git-slot-delete" title="Supprimer">✕</button>
        </div>
      </div>
    `).join('');
    listEl.querySelectorAll('.git-slot-row').forEach(row => {
      const slug = row.dataset.slug;
      row.querySelector('.git-slot-compare').addEventListener('click', () => this._compareFromSlot(slug));
      row.querySelector('.git-slot-delete').addEventListener('click', async () => {
        if (!confirm(`Supprimer la ROM "${slug}" ?`)) return;
        try { await api.deleteRomSlot(this.projectId, slug); await this._refreshSlots(); }
        catch (e) { alert('Suppression échouée : ' + e.message); }
      });
    });
  }

  async _compareFromSlot(slug) {
    const status = this.el.querySelector('#git-compare-status');
    status.style.display = '';
    status.innerHTML = `<div class="spinner"></div> Analyse de ${slug}…`;
    try {
      const diff = await api.compareFromSlot(this.projectId, slug);
      this.compareFileName = diff.fileName;
      status.innerHTML = `📁 <b>${diff.fileName}</b> <span style="color:var(--text-dim)">(${(diff.size / 1024).toFixed(0)} KB · ${diff.maps?.length || 0} cartes diffèrent)</span> <a href="#" id="git-compare-clear">✕</a>`;
      status.querySelector('#git-compare-clear').addEventListener('click', e => {
        e.preventDefault();
        this._clearCompare();
      });
      this.activeHash = null;
      this.logEl.querySelectorAll('.git-entry').forEach(e => e.classList.remove('active'));
      this.diffEl.style.display = '';
      this._renderMapDiff(
        { maps: diff.maps, error: diff.error },
        { compareFile: true, fileName: diff.fileName, message: `slot ${slug}` }
      );
    } catch (e) {
      status.innerHTML = `<span style="color:var(--danger)">Erreur: ${e.message}</span>`;
    }
  }

  async _clearCompare() {
    try { await api.clearCompareFile(this.projectId); } catch {}
    this.compareFileName = null;
    const status = this.el.querySelector('#git-compare-status');
    status.style.display = 'none';
    status.innerHTML = '';
    this.diffEl.style.display = 'none';
    this.diffEl.innerHTML = '';
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

    const laneInfo = computeLanes(this.entries);

    const frag = document.createDocumentFragment();
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      const info = laneInfo[entry.hash];
      const nextInfo = i + 1 < this.entries.length ? laneInfo[this.entries[i + 1].hash] : null;

      const div = document.createElement('div');
      div.className = 'git-entry' + (this.activeHash === entry.hash ? ' active' : '');
      const date = new Date(entry.date).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

      const refsHtml = (entry.refs || []).map(r => {
        const cls = r.head ? 'git-ref-head' : r.type === 'tag' ? 'git-ref-tag' : 'git-ref-branch';
        return `<span class="git-ref ${cls}">${r.head && r.type !== 'head' ? 'HEAD → ' : ''}${r.name}</span>`;
      }).join('');

      const gutter = renderGutter(info, nextInfo);

      div.innerHTML = `
        <div class="git-gutter">${gutter}</div>
        <div class="git-body">
          <div class="git-msg">${refsHtml}${entry.message}</div>
          <div class="git-meta">${date} · <span class="git-hash">${entry.hash.slice(0, 8)}</span></div>
        </div>
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
    const isFileCompare = !!entry.compareFile;
    let html = `<div class="map-diff-header">
      <span>${total} carte${total > 1 ? 's' : ''} ${isFileCompare ? `diffère${total > 1 ? 'nt' : ''} de ${entry.fileName}` : `modifiée${total > 1 ? 's' : ''}`}</span>
      ${isFileCompare ? '' : '<button class="btn btn-sm btn-danger" id="git-restore-btn" title="Restaurer la ROM à cet état">⟲ Restaurer</button>'}
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
        if (this.onMapClick) this.onMapClick(name, entry);
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

  // Modal : compare 2 refs (commits OU branches OU tags) arbitraires.
  // Dropdowns peuplées depuis this.entries (log) + branches.all.
  async _openCompareRefsModal() {
    const existing = document.getElementById('git-compare-refs-modal');
    if (existing) existing.remove();

    // Récupère la liste des branches pour les proposer aussi
    let branches = [];
    try {
      const b = await fetch(`/api/projects/${this.projectId}/git/branches`).then(r => r.json());
      branches = b.all || [];
    } catch {}

    // Construit les options : branches d'abord (utilité), puis commits
    const options = [];
    for (const br of branches) options.push({ value: br, label: `⎇ ${br}` });
    for (const c of this.entries) {
      const refs = (c.refs || []).map(r => r.name).join(' ');
      const hash8 = c.hash.slice(0, 8);
      const msg = c.message.slice(0, 50);
      options.push({ value: c.hash, label: `${hash8}  ${msg}${refs ? '  (' + refs + ')' : ''}` });
    }

    const mkSelect = (id, defaultVal) => `
      <select id="${id}" style="flex:1;padding:4px 6px;background:var(--bg2);border:1px solid var(--border);color:var(--text);font-family:monospace;font-size:11px">
        ${options.map(o => `<option value="${o.value}" ${o.value === defaultVal ? 'selected' : ''}>${o.label}</option>`).join('')}
      </select>`;

    const overlay = document.createElement('div');
    overlay.id = 'git-compare-refs-modal';
    overlay.className = 'modal-overlay';
    // Default : A = le commit HEAD~1 (ou root), B = HEAD
    const defaultA = this.entries[1]?.hash || this.entries[this.entries.length - 1]?.hash;
    const defaultB = this.entries[0]?.hash;
    overlay.innerHTML = `
      <div class="modal" style="min-width:640px;max-width:880px">
        <div style="display:flex;align-items:center;margin-bottom:12px">
          <h2 style="flex:1">🔀 Comparer 2 commits / branches</h2>
          <button class="btn btn-sm" id="crm-close">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="display:flex;gap:8px;align-items:center;font-size:12px">
            <span style="width:60px;color:var(--text-dim)">Avant (A)</span>
            ${mkSelect('crm-ref-a', defaultA)}
          </label>
          <label style="display:flex;gap:8px;align-items:center;font-size:12px">
            <span style="width:60px;color:var(--text-dim)">Après (B)</span>
            ${mkSelect('crm-ref-b', defaultB)}
          </label>
          <button class="btn btn-primary" id="crm-compare">Comparer →</button>
          <div id="crm-result" style="margin-top:8px;max-height:420px;overflow-y:auto"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#crm-close').addEventListener('click', () => overlay.remove());

    overlay.querySelector('#crm-compare').addEventListener('click', async () => {
      const a = overlay.querySelector('#crm-ref-a').value;
      const b = overlay.querySelector('#crm-ref-b').value;
      if (a === b) { alert('A et B sont identiques.'); return; }
      const resultEl = overlay.querySelector('#crm-result');
      resultEl.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-dim)"><div class="spinner"></div> Calcul du diff…</div>';
      try {
        const res = await fetch(`/api/projects/${this.projectId}/git/diff-maps-between/${encodeURIComponent(a)}/${encodeURIComponent(b)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'diff failed');
        this._renderCompareRefsResult(resultEl, a, b, data, overlay);
      } catch (e) {
        resultEl.innerHTML = `<div style="color:var(--danger);padding:12px">${e.message}</div>`;
      }
    });
  }

  _renderCompareRefsResult(container, refA, refB, data, overlay) {
    if (!data.maps?.length) {
      container.innerHTML = `<div style="padding:16px;color:var(--text-dim)">Aucune carte A2L ne diffère entre ces 2 refs. ${data.error ? '<br><em>' + data.error + '</em>' : ''}</div>`;
      return;
    }
    const header = `<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">
      <strong>${data.maps.length}</strong> cartes différentes · A = <code>${refA.slice(0, 16)}</code> · B = <code>${refB.slice(0, 16)}</code>
    </div>`;
    const rows = data.maps.map(m => {
      const sample = m.sample ? `${m.sample.before} → ${m.sample.after}` : '';
      const tag = `<span class="param-type-badge badge-${m.type}">${m.type}</span>`;
      return `
        <div class="map-diff-row" data-name="${m.name}" data-address="${m.address}" style="padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;font-size:11px">
          ${tag}
          <strong>${m.name}</strong>
          <span style="color:var(--text-dim)">${m.cellsChanged}/${m.totalCells} cells</span>
          <span style="color:var(--accent)">${sample}</span>
          <div style="color:var(--text-dim);font-size:10px">0x${m.address.toString(16).toUpperCase()} · ${(m.description || '').slice(0, 60)}</div>
        </div>`;
    }).join('');
    container.innerHTML = header + rows;

    container.querySelectorAll('.map-diff-row').forEach(row => {
      row.addEventListener('click', async () => {
        const name = row.getAttribute('data-name');
        console.log('[compare-refs] click row', name, 'refA', refA, 'refB', refB);
        overlay.remove();
        try {
          const [bufA, bufB] = await Promise.all([
            fetch(`/api/projects/${this.projectId}/rom?commit=${encodeURIComponent(refA)}`).then(r => { if (!r.ok) throw new Error('fetch A ' + r.status); return r.arrayBuffer(); }),
            fetch(`/api/projects/${this.projectId}/rom?commit=${encodeURIComponent(refB)}`).then(r => { if (!r.ok) throw new Error('fetch B ' + r.status); return r.arrayBuffer(); }),
          ]);
          console.log('[compare-refs] buffers loaded', bufA.byteLength, bufB.byteLength, 'hasCallback:', !!this.onCompareRefsMap);
          if (this.onCompareRefsMap) {
            this.onCompareRefsMap(name, new Uint8Array(bufA), new Uint8Array(bufB), refA, refB);
          } else {
            console.warn('[compare-refs] onCompareRefsMap callback not set on GitPanel instance');
          }
        } catch (e) {
          console.error('[compare-refs] failed:', e);
          alert('Chargement des ROMs échoué : ' + e.message);
        }
      });
    });
  }
}

// ── Git graph rendering ───────────────────────────────────────────────

const LANE_W = 12;
const ROW_H = 44;
const LANE_COLORS = ['#569cd6', '#c586c0', '#4ec9b0', '#d7ba7d', '#ce9178', '#9cdcfe', '#dcdcaa'];

// Given commits (newest first) with { hash, parents }, returns per-commit info:
//   { lane, parentLanes, activeBefore, activeAfter }
function computeLanes(commits) {
  const lanes = []; // index → expected-next parent hash (or null)
  const info = {};

  for (const c of commits) {
    const expecting = [];
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.hash) expecting.push(i);

    let lane;
    if (expecting.length > 0) {
      lane = expecting[0];
      for (let i = 1; i < expecting.length; i++) lanes[expecting[i]] = null;
    } else {
      lane = lanes.findIndex(l => l == null);
      if (lane === -1) { lane = lanes.length; lanes.push(null); }
    }

    const activeBefore = [...lanes];

    const parents = c.parents || [];
    const parentLanes = [];
    if (parents.length > 0) {
      lanes[lane] = parents[0];
      parentLanes.push(lane);
      for (let i = 1; i < parents.length; i++) {
        // See if another active lane already expects this parent
        let idx = lanes.findIndex(l => l === parents[i]);
        if (idx === -1) {
          idx = lanes.findIndex(l => l == null);
          if (idx === -1) { idx = lanes.length; lanes.push(null); }
          lanes[idx] = parents[i];
        }
        parentLanes.push(idx);
      }
    } else {
      lanes[lane] = null;
    }

    info[c.hash] = { lane, parentLanes, activeBefore, activeAfter: [...lanes] };
  }
  return info;
}

function renderGutter(info, nextInfo) {
  if (!info) return '';
  const activeBefore = info.activeBefore || [];
  const activeAfter = info.activeAfter || [];
  const maxLanes = Math.max(activeBefore.length, activeAfter.length, info.lane + 1);
  const width = Math.max(LANE_W * 1.5, (maxLanes + 1) * LANE_W);
  const mid = ROW_H / 2;

  let paths = '';

  // Incoming lines (top → middle): every lane active BEFORE this row draws from top
  for (let i = 0; i < activeBefore.length; i++) {
    if (activeBefore[i] == null) continue;
    const color = LANE_COLORS[i % LANE_COLORS.length];
    const x = i * LANE_W + LANE_W / 2;
    // If this lane is THIS commit's lane, line goes straight down to the dot
    // If it's being merged here, it angles to the commit's lane
    if (i === info.lane) {
      paths += `<line x1="${x}" y1="0" x2="${x}" y2="${mid}" stroke="${color}" stroke-width="1.5"/>`;
    } else {
      // Merging lane: angle to commit lane
      const targetX = info.lane * LANE_W + LANE_W / 2;
      paths += `<line x1="${x}" y1="0" x2="${targetX}" y2="${mid}" stroke="${color}" stroke-width="1.5"/>`;
    }
  }

  // Outgoing lines (middle → bottom): each lane active AFTER goes down
  for (let i = 0; i < activeAfter.length; i++) {
    if (activeAfter[i] == null) continue;
    const color = LANE_COLORS[i % LANE_COLORS.length];
    const x = i * LANE_W + LANE_W / 2;
    if (info.parentLanes.includes(i)) {
      // If this lane was opened by this commit (branching), angle from commit's lane
      if (i !== info.lane) {
        const fromX = info.lane * LANE_W + LANE_W / 2;
        paths += `<line x1="${fromX}" y1="${mid}" x2="${x}" y2="${ROW_H}" stroke="${color}" stroke-width="1.5"/>`;
      } else {
        paths += `<line x1="${x}" y1="${mid}" x2="${x}" y2="${ROW_H}" stroke="${color}" stroke-width="1.5"/>`;
      }
    } else {
      // Lane passes through (not touched here)
      paths += `<line x1="${x}" y1="${mid}" x2="${x}" y2="${ROW_H}" stroke="${color}" stroke-width="1.5"/>`;
    }
  }

  // Commit dot
  const dotX = info.lane * LANE_W + LANE_W / 2;
  const dotColor = LANE_COLORS[info.lane % LANE_COLORS.length];
  paths += `<circle cx="${dotX}" cy="${mid}" r="4" fill="${dotColor}" stroke="var(--bg)" stroke-width="1.5"/>`;

  return `<svg width="${width}" height="${ROW_H}" viewBox="0 0 ${width} ${ROW_H}">${paths}</svg>`;
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
