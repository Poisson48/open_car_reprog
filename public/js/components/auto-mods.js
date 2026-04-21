// Predefined binary patches and calibration shortcuts for supported ECUs
// Each mod can be pattern-based (search & replace) or address-based

const MODS = {
  edc16c34: [
    {
      id: 'dpf_off',
      category: 'Dépollution',
      name: 'DPF / FAP OFF',
      description: 'Désactive le filtre à particules par remplacement de signature binaire.',
      risk: 'low',
      search:  [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x01,0x01,0x00,0x0C,0x3B,0x0D,0x03],
      replace: [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x0C,0x3B,0x0D,0x03],
      restore: [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x01,0x01,0x00,0x0C,0x3B,0x0D,0x03],
      type: 'pattern'
    },
    {
      id: 'dpf_dtc_off',
      category: 'Dépollution',
      name: 'DPF — Supprimer DTC (P0420 / P242F)',
      description: 'Met les octets de détection de charge en saturation pour éviter les codes défaut liés au FAP.',
      risk: 'medium',
      address: 0x1E9DD4,
      bytes:   [0xFF, 0xFF],
      restore: [0x00, 0x01],
      type: 'address'
    },
    {
      id: 'egr_off',
      category: 'Dépollution',
      name: 'EGR OFF (hystérésis à 0)',
      description: 'Force l\'hystérésis EGR à 0 pour couper la recirculation des gaz.',
      risk: 'medium',
      address: 0x1C4C4E,
      bytes:   [0x00, 0x00],
      restore: null, // no known safe restore value — user should commit before applying
      type: 'address'
    },
    {
      id: 'swirl_off',
      category: 'Dépollution',
      name: 'Swirl Flaps OFF',
      description: 'Désactive les volets d\'admission (swirl flaps) — évite les DTC P2004/P2005.',
      risk: 'low',
      note: 'Recherche la map swirl dans les paramètres "SWF" ou "SwFl".',
      type: 'info'
    },
    {
      id: 'boost_stage1',
      category: 'Performance',
      name: 'Stage 1 — Boost +15%',
      description: 'Augmente la pression turbo de 15% sur la map boost (paramètre TCO_pMaxLimMapSp_MAP). Sélectionner la map et utiliser le bouton +15% dans l\'éditeur.',
      risk: 'medium',
      note: 'Chercher "TCO_pMaxLimMapSp" dans les paramètres.',
      type: 'info'
    },
    {
      id: 'inject_stage1',
      category: 'Performance',
      name: 'Stage 1 — Injection +10%',
      description: 'Augmente la quantité de carburant injectée de 10% (map InjQty). Chercher "InjQ" ou "Qmain".',
      risk: 'medium',
      type: 'info'
    },
    {
      id: 'speed_limiter_off',
      category: 'Divers',
      name: 'Limiteur de vitesse — Désactiver',
      description: 'Chercher le paramètre "vMax" ou "VSL" et mettre la valeur physique à 255 km/h.',
      risk: 'low',
      type: 'info'
    }
  ]
};

export class AutoMods {
  constructor({ ecu, romData, onBytesChange, onClose }) {
    this.ecu = ecu;
    this.romData = romData;
    this.onBytesChange = onBytesChange;
    this.onClose = onClose;
    this._results = new Map(); // mod.id → {found, offset}
    this._el = null;
  }

  open() {
    const existing = document.getElementById('auto-mods-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'auto-mods-modal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = this._buildHtml();
    document.body.appendChild(overlay);
    this._el = overlay;

    overlay.addEventListener('click', e => { if (e.target === overlay) this._close(); });
    overlay.querySelector('#am-close').addEventListener('click', () => this._close());

    this._scan();
    this._bindButtons();
  }

  _close() {
    this._el?.remove();
    if (this.onClose) this.onClose();
  }

  _buildHtml() {
    const mods = MODS[this.ecu] || [];
    const categories = [...new Set(mods.map(m => m.category))];

    const sections = categories.map(cat => {
      const items = mods.filter(m => m.category === cat).map(m => `
        <div class="am-item" id="am-${m.id}">
          <div class="am-item-header">
            <span class="am-name">${m.name}</span>
            <span class="am-risk am-risk-${m.risk}">${m.risk === 'low' ? '● bas' : m.risk === 'medium' ? '● moyen' : '● élevé'}</span>
            <span class="am-status" id="am-status-${m.id}">…</span>
          </div>
          <div class="am-desc">${m.description}</div>
          ${m.note ? `<div class="am-note">ℹ ${m.note}</div>` : ''}
          <div class="am-actions" id="am-actions-${m.id}"></div>
        </div>
      `).join('');
      return `<div class="am-section"><div class="am-cat">${cat}</div>${items}</div>`;
    }).join('');

    return `
      <div class="modal" style="min-width:560px;max-width:700px;max-height:80vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;margin-bottom:16px">
          <h2 style="flex:1">Modifications automatiques — ${this.ecu.toUpperCase()}</h2>
          <button class="btn btn-sm" id="am-close">✕</button>
        </div>
        <div style="overflow-y:auto;flex:1">${sections}</div>
        <div style="margin-top:12px;font-size:11px;color:var(--text-dim)">
          ⚠ Faites un commit git avant d'appliquer des modifications. La ROM originale est toujours disponible dans <code>rom.original.bin</code>.
        </div>
      </div>
    `;
  }

  _scan() {
    const mods = MODS[this.ecu] || [];
    for (const mod of mods) {
      if (mod.type === 'pattern') {
        const offset = this._findPattern(mod.search);
        this._results.set(mod.id, { found: offset >= 0, offset, applied: offset >= 0 && this._matchesReplace(offset, mod.replace) });
      } else if (mod.type === 'address') {
        const current = Array.from(this.romData.slice(mod.address, mod.address + mod.bytes.length));
        const applied = current.every((b, i) => b === mod.bytes[i]);
        this._results.set(mod.id, { found: true, offset: mod.address, applied });
      } else {
        this._results.set(mod.id, { found: null, offset: -1, applied: false });
      }
      this._updateStatus(mod);
    }
  }

  _bindButtons() {
    const mods = MODS[this.ecu] || [];
    for (const mod of mods) {
      const actionsEl = this._el.querySelector(`#am-actions-${mod.id}`);
      if (!actionsEl) continue;
      const result = this._results.get(mod.id);

      if (mod.type === 'info') {
        actionsEl.innerHTML = `<span style="font-size:10px;color:var(--text-dim)">Action manuelle via l'éditeur de cartographies.</span>`;
        continue;
      }

      if (!result?.found) {
        actionsEl.innerHTML = `<span style="font-size:10px;color:var(--danger)">Signature non trouvée dans cette ROM.</span>`;
        continue;
      }

      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-sm' + (result.applied ? ' btn-success' : ' btn-primary');
      applyBtn.textContent = result.applied ? '✓ Appliqué' : 'Appliquer';
      applyBtn.addEventListener('click', () => {
        if (result.applied) return;
        this._apply(mod);
        result.applied = true;
        applyBtn.className = 'btn btn-sm btn-success';
        applyBtn.textContent = '✓ Appliqué';
        if (restoreBtn) restoreBtn.disabled = false;
        this._updateStatus(mod);
      });

      let restoreBtn = null;
      if (mod.restore) {
        restoreBtn = document.createElement('button');
        restoreBtn.className = 'btn btn-sm';
        restoreBtn.textContent = '↩ Restaurer';
        restoreBtn.disabled = !result.applied;
        restoreBtn.addEventListener('click', () => {
          this._restore(mod);
          result.applied = false;
          applyBtn.className = 'btn btn-sm btn-primary';
          applyBtn.textContent = 'Appliquer';
          restoreBtn.disabled = true;
          this._updateStatus(mod);
        });
      }

      actionsEl.appendChild(applyBtn);
      if (restoreBtn) actionsEl.appendChild(restoreBtn);
    }
  }

  _updateStatus(mod) {
    const el = this._el?.querySelector(`#am-status-${mod.id}`);
    if (!el) return;
    const result = this._results.get(mod.id);
    if (mod.type === 'info') { el.textContent = ''; return; }
    if (!result?.found) { el.innerHTML = '<span style="color:var(--danger)">Non trouvé</span>'; return; }
    el.innerHTML = result.applied
      ? '<span style="color:var(--accent2)">✓ Actif</span>'
      : '<span style="color:var(--text-dim)">Inactif</span>';
  }

  _findPattern(pattern) {
    const data = this.romData;
    const len = data.length - pattern.length;
    outer: for (let i = 0; i <= len; i++) {
      for (let j = 0; j < pattern.length; j++) {
        if (data[i + j] !== pattern[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  _matchesReplace(offset, bytes) {
    return bytes.every((b, i) => this.romData[offset + i] === b);
  }

  _apply(mod) {
    const offset = this._results.get(mod.id)?.offset ?? mod.address;
    const bytes = mod.type === 'pattern' ? mod.replace : mod.bytes;
    for (let i = 0; i < bytes.length; i++) {
      this.romData[offset + i] = bytes[i];
    }
    if (this.onBytesChange) this.onBytesChange(offset, bytes);
  }

  _restore(mod) {
    if (!mod.restore) return;
    const offset = this._results.get(mod.id)?.offset ?? mod.address;
    for (let i = 0; i < mod.restore.length; i++) {
      this.romData[offset + i] = mod.restore[i];
    }
    if (this.onBytesChange) this.onBytesChange(offset, mod.restore);
  }
}
