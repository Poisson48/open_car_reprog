// Predefined binary patches and calibration shortcuts for supported ECUs
// Each mod can be pattern-based (search & replace), address-based, or special type

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
      restore: null,
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
      id: 'stage1',
      category: 'Performance',
      name: 'Stage 1 — Cartographies +puissance',
      description: 'Applique un pourcentage configurable sur les 5 cartographies clés du Stage 1 : demande couple pédale (Hi/Lo gear), conversion couple→injection (FMTC), pression rail et limite protection moteur.',
      risk: 'medium',
      type: 'stage1'
    },
    {
      id: 'popbang',
      category: 'Performance',
      name: 'Pop & Bang — Overrun actif',
      description: 'Active l\'injection en overrun (levée de pied) pour des pétarades à l\'échappement. Réglage RPM départ et quantité carburant (petite valeur = CT compatible).',
      risk: 'medium',
      type: 'popbang'
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

// Stage 1 map definitions with defaults
const STAGE1_MAPS = [
  { name: 'AccPed_trqEngHiGear_MAP', label: 'Couple pédale Hi gear',       defaultPct: 15 },
  { name: 'AccPed_trqEngLoGear_MAP', label: 'Couple pédale Lo gear',       defaultPct: 15 },
  { name: 'FMTC_trq2qBas_MAP',      label: 'Couple → Injection (FMTC)',   defaultPct: 12 },
  { name: 'Rail_pSetPointBase_MAP',  label: 'Pression rail setpoint',      defaultPct: 10 },
  { name: 'EngPrt_trqAPSLim_MAP',   label: 'Limite protection moteur',    defaultPct: 25 },
];

export class AutoMods {
  constructor({ ecu, romData, projectId, onBytesChange, onClose }) {
    this.ecu = ecu;
    this.romData = romData;
    this.projectId = projectId;
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
      const items = mods.filter(m => m.category === cat).map(m => {
        const riskLabel = m.risk === 'low' ? '● bas' : m.risk === 'medium' ? '● moyen' : '● élevé';
        return `
        <div class="am-item" id="am-${m.id}">
          <div class="am-item-header">
            <span class="am-name">${m.name}</span>
            ${m.risk ? `<span class="am-risk am-risk-${m.risk}">${riskLabel}</span>` : ''}
            <span class="am-status" id="am-status-${m.id}">…</span>
          </div>
          <div class="am-desc">${m.description}</div>
          ${m.note ? `<div class="am-note">ℹ ${m.note}</div>` : ''}
          <div class="am-actions" id="am-actions-${m.id}"></div>
        </div>
        `;
      }).join('');
      return `<div class="am-section"><div class="am-cat">${cat}</div>${items}</div>`;
    }).join('');

    return `
      <div class="modal" style="min-width:580px;max-width:720px;max-height:85vh;display:flex;flex-direction:column">
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

      if (mod.type === 'stage1') {
        this._buildStage1Actions(actionsEl);
        continue;
      }

      if (mod.type === 'popbang') {
        this._buildPopBangActions(actionsEl);
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

  _buildStage1Actions(container) {
    const statusEl = this._el.querySelector('#am-status-stage1');
    if (statusEl) statusEl.textContent = '';

    // Global percentage slider
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';

    // Per-map rows
    const mapInputs = {};
    const mapRows = STAGE1_MAPS.map(m => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px';

      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = true;
      check.id = `s1-chk-${m.name}`;

      const label = document.createElement('label');
      label.htmlFor = check.id;
      label.textContent = m.label;
      label.style.cssText = 'flex:1;cursor:pointer';

      const pctInput = document.createElement('input');
      pctInput.type = 'number';
      pctInput.value = m.defaultPct;
      pctInput.min = -50; pctInput.max = 50; pctInput.step = 1;
      pctInput.style.cssText = 'width:56px;padding:2px 4px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:3px;text-align:right';

      const pctLabel = document.createElement('span');
      pctLabel.textContent = '%';
      pctLabel.style.color = 'var(--text-dim)';

      mapInputs[m.name] = { check, pctInput };
      row.append(check, label, pctInput, pctLabel);
      return row;
    });

    mapRows.forEach(r => wrap.appendChild(r));

    // Apply button
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-sm btn-primary';
    applyBtn.textContent = 'Appliquer Stage 1';
    applyBtn.style.marginTop = '4px';
    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Application…';

      const pcts = {};
      for (const m of STAGE1_MAPS) {
        const { check, pctInput } = mapInputs[m.name];
        pcts[m.name] = check.checked ? Number(pctInput.value) : 0;
      }

      try {
        const res = await fetch(`/api/projects/${this.projectId}/stage1`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pcts })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        // Reload ROM data from server and notify
        const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
        const romBuf = await romRes.arrayBuffer();
        const newRom = new Uint8Array(romBuf);
        // Copy into existing romData reference
        this.romData.set(newRom);

        const totalChanged = data.maps.reduce((s, m) => s + (m.changed || 0), 0);
        applyBtn.className = 'btn btn-sm btn-success';
        applyBtn.textContent = `✓ Stage 1 appliqué (${totalChanged} valeurs)`;

        const statusEl = this._el.querySelector('#am-status-stage1');
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--accent2)">✓ Actif</span>';

        if (this.onBytesChange) {
          // Signal a broad change; hex editor will need reload
          this.onBytesChange(0, newRom);
        }
      } catch (e) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Appliquer Stage 1';
        alert('Erreur Stage 1: ' + e.message);
      }
    });

    wrap.appendChild(applyBtn);
    container.appendChild(wrap);
  }

  _buildPopBangActions(container) {
    const statusEl = this._el.querySelector('#am-status-popbang');
    if (statusEl) statusEl.textContent = '';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-top:4px';

    // RPM slider
    const rpmRow = document.createElement('div');
    rpmRow.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:12px';
    const rpmLabel = document.createElement('label');
    rpmLabel.textContent = 'RPM départ overrun :';
    rpmLabel.style.cssText = 'width:160px;flex-shrink:0';
    const rpmSlider = document.createElement('input');
    rpmSlider.type = 'range';
    rpmSlider.min = 1000; rpmSlider.max = 5500; rpmSlider.step = 100; rpmSlider.value = 3000;
    rpmSlider.style.cssText = 'flex:1';
    const rpmVal = document.createElement('span');
    rpmVal.textContent = '3000 tr/min';
    rpmVal.style.cssText = 'width:90px;text-align:right;color:var(--accent)';
    rpmSlider.addEventListener('input', () => { rpmVal.textContent = `${rpmSlider.value} tr/min`; });
    rpmRow.append(rpmLabel, rpmSlider, rpmVal);

    // Fuel qty slider
    const qRow = document.createElement('div');
    qRow.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:12px';
    const qLabel = document.createElement('label');
    qLabel.textContent = 'Qté carburant (brut) :';
    qLabel.style.cssText = 'width:160px;flex-shrink:0';
    const qSlider = document.createElement('input');
    qSlider.type = 'range';
    qSlider.min = 0; qSlider.max = 100; qSlider.step = 1; qSlider.value = 10;
    qSlider.style.cssText = 'flex:1';
    const qVal = document.createElement('span');
    qVal.textContent = '10 (≈1 mg/hub)';
    qVal.style.cssText = 'width:120px;text-align:right;color:var(--accent)';
    qSlider.addEventListener('input', () => { qVal.textContent = `${qSlider.value} (≈${(qSlider.value/10).toFixed(1)} mg/hub)`; });
    qRow.append(qLabel, qSlider, qVal);

    // CT note
    const note = document.createElement('div');
    note.className = 'am-note';
    note.innerHTML = 'ℹ Valeur carburant &lt; 20 recommandée pour passer le CT (overrun quasi-invisible aux sondes lambda).';

    // Apply + Disable buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-sm btn-primary';
    applyBtn.textContent = 'Activer Pop & Bang';

    const disableBtn = document.createElement('button');
    disableBtn.className = 'btn btn-sm';
    disableBtn.textContent = '↩ Désactiver';

    const sendPopBang = async (rpm, fuelQty) => {
      const res = await fetch(`/api/projects/${this.projectId}/popbang`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpm, fuelQty })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    };

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Application…';
      try {
        await sendPopBang(Number(rpmSlider.value), Number(qSlider.value));

        const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
        const romBuf = await romRes.arrayBuffer();
        this.romData.set(new Uint8Array(romBuf));

        applyBtn.className = 'btn btn-sm btn-success';
        applyBtn.textContent = `✓ Pop & Bang actif (${rpmSlider.value} tr/min)`;
        disableBtn.disabled = false;

        const statusEl = this._el.querySelector('#am-status-popbang');
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--accent2)">✓ Actif</span>';

        if (this.onBytesChange) this.onBytesChange(0, this.romData);
      } catch (e) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Activer Pop & Bang';
        alert('Erreur Pop & Bang: ' + e.message);
      }
    });

    disableBtn.addEventListener('click', async () => {
      disableBtn.disabled = true;
      try {
        // Restore defaults: nOvrRun=1000 (stock), qOvrRun=0
        await sendPopBang(1000, 0);

        const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
        const romBuf = await romRes.arrayBuffer();
        this.romData.set(new Uint8Array(romBuf));

        applyBtn.className = 'btn btn-sm btn-primary';
        applyBtn.textContent = 'Activer Pop & Bang';
        applyBtn.disabled = false;

        const statusEl = this._el.querySelector('#am-status-popbang');
        if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-dim)">Inactif</span>';

        if (this.onBytesChange) this.onBytesChange(0, this.romData);
      } catch (e) {
        disableBtn.disabled = false;
        alert('Erreur désactivation: ' + e.message);
      }
    });

    btnRow.append(applyBtn, disableBtn);
    wrap.append(rpmRow, qRow, note, btnRow);
    container.appendChild(wrap);
  }

  _updateStatus(mod) {
    const el = this._el?.querySelector(`#am-status-${mod.id}`);
    if (!el) return;
    const result = this._results.get(mod.id);
    if (mod.type === 'info' || mod.type === 'stage1' || mod.type === 'popbang') { el.textContent = ''; return; }
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
