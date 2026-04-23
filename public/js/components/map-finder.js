// Map-Finder modal — heuristic map detection UI.
// Scans the project ROM for inline-header maps (Kf_Xs16_Ys16_Ws16 convention)
// and shows candidates ranked by score. Clicking "Voir" jumps the hex editor
// to the block and highlights it.

export class MapFinder {
  constructor({ projectId, onGoto }) {
    this.projectId = projectId;
    this.onGoto = onGoto;
    this._el = null;
  }

  async open() {
    const existing = document.getElementById('map-finder-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'map-finder-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="min-width:720px;max-width:960px;max-height:85vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;margin-bottom:12px">
          <h2 style="flex:1">🔍 Auto-find maps — détection heuristique</h2>
          <button class="btn btn-sm" id="mf-close">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px">
          Scanne la ROM pour des blocs <code>Kf_Xs16_Ys16_Ws16</code> (header <code>nx/ny</code> inline + axes monotones + data lisse).
          Les candidats connus dans l'A2L sont marqués <span style="color:var(--accent2)">✓</span>.
        </div>
        <div id="mf-status" style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Scan en cours…</div>
        <div id="mf-list" style="overflow-y:auto;flex:1;border:1px solid var(--border)"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this._el = overlay;
    overlay.addEventListener('click', e => { if (e.target === overlay) this._close(); });
    overlay.querySelector('#mf-close').addEventListener('click', () => this._close());

    try {
      const t0 = Date.now();
      const res = await fetch(`/api/projects/${this.projectId}/auto-find-maps?limit=200`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'scan failed');
      const roundTrip = Date.now() - t0;

      this._el.querySelector('#mf-status').innerHTML =
        `<strong>${data.count}</strong> candidat${data.count > 1 ? 's' : ''} · scan <strong>${data.scanMs} ms</strong> (total ${roundTrip} ms) · ROM ${(data.romSize / 1024).toFixed(0)} Ko`;

      this._renderList(data.maps);
    } catch (e) {
      this._el.querySelector('#mf-status').innerHTML = `<span style="color:var(--danger)">Erreur : ${e.message}</span>`;
    }
  }

  _renderList(maps) {
    const listEl = this._el.querySelector('#mf-list');
    if (!maps.length) {
      listEl.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-dim)">Aucun candidat trouvé. La ROM n'utilise peut-être pas le layout Kf_Xs16_Ys16_Ws16.</div>`;
      return;
    }
    const rows = maps.map(m => {
      const scoreBarW = Math.round(m.score * 100);
      const known = m.knownName
        ? `<span style="color:var(--accent2);font-size:10px">✓ ${m.knownName}</span>`
        : `<span style="color:var(--text-dim);font-size:10px">hors A2L</span>`;
      return `
        <div class="mf-row" data-addr="${m.address}" data-nx="${m.nx}" data-ny="${m.ny}" data-bs="${m.blockSize}" data-name="${m.knownName || ''}">
          <div class="mf-score-bar" style="width:${scoreBarW}%"></div>
          <div class="mf-row-inner">
            <div class="mf-addr">0x${m.address.toString(16).toUpperCase().padStart(6, '0')}</div>
            <div class="mf-dims">${m.nx}×${m.ny}</div>
            <div class="mf-score">${m.score.toFixed(2)}</div>
            <div class="mf-axes">X[${m.axisX.min}…${m.axisX.max}] · Y[${m.axisY.min}…${m.axisY.max}]</div>
            <div class="mf-data">data [${m.data.min}…${m.data.max}]</div>
            <div class="mf-known">${known}</div>
            <button class="btn btn-sm mf-goto">Voir →</button>
          </div>
        </div>
      `;
    }).join('');
    listEl.innerHTML = rows;

    for (const row of listEl.querySelectorAll('.mf-row')) {
      row.querySelector('.mf-goto').addEventListener('click', () => {
        const addr = +row.getAttribute('data-addr');
        const blockSize = +row.getAttribute('data-bs');
        const name = row.getAttribute('data-name');
        this._close();
        if (this.onGoto) this.onGoto({ address: addr, blockSize, name });
      });
    }
  }

  _close() {
    this._el?.remove();
  }
}
