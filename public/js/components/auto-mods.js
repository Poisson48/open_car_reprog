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
      id: 'adj_egr_threshold',
      category: 'Dépollution',
      name: 'Seuil coupure EGR — AirCtl_nMin_C',
      description: 'Régime au-dessus duquel l\'EGR ne peut plus s\'ouvrir. Stock ~700 tr/min (EDC16C34 PSA). À 8000 tr/min l\'EGR ne s\'active jamais en roulage normal (équivalent EGR OFF).',
      risk: 'low',
      type: 'adjustable',
      paramName: 'AirCtl_nMin_C',
      unit: 'tr/min',
      min: 500, max: 8000, step: 250,
      stockHint: 700,
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
      id: 'recipe_speed_limiter_off',
      category: 'Performance',
      name: 'Speed Limiter OFF — régulateur à 320 km/h',
      description: 'Relève les 3 plafonds de vitesse (VSSCD_vMax, CrCCD_vSetSpdMax, PrpCCD_vSetSpdMax) à 320 km/h via open_damos relocalisé. Utile pour débrider le régulateur de vitesse.',
      risk: 'low',
      type: 'recipe',
      recipeId: 'speed_limiter_off',
    },
    {
      id: 'recipe_rev_limit_raise',
      category: 'Performance',
      name: 'Rev Limiter — zone NMR relevée à 5500 rpm',
      description: 'Relève AccPed_nLimNMR_C (seuil régime non-monitored range). Permet plus de souplesse aux hauts régimes sans trigger les DTC de plausibilité.',
      risk: 'low',
      type: 'recipe',
      recipeId: 'rev_limit_raise',
    },
    {
      id: 'recipe_torque_limiter_off',
      category: 'Performance',
      name: 'Torque Limiter +30% — plafond protection relevé',
      description: 'Relève EngPrt_trqAPSLim_MAP de 30% et EngPrt_qLim_CUR de 25%. Ces plafonds clamment tes gains Stage 1/2, les monter évite les saturations couple.',
      risk: 'medium',
      type: 'recipe',
      recipeId: 'torque_limiter_off',
    },
    {
      id: 'recipe_rail_max_raise',
      category: 'Performance',
      name: 'Rail Pressure Max +15%',
      description: 'Relève Rail_pSetPointMax_MAP de 15% (ceiling ~1800 bar). Nécessaire pour Stage 2+ quand Rail_pSetPointBase atteint ce plafond.',
      risk: 'medium',
      type: 'recipe',
      recipeId: 'rail_max_raise',
    },
    {
      id: 'recipe_smoke_off',
      category: 'Performance',
      name: 'Smoke limiter assoupli (-5%)',
      description: 'Baisse FlMng_rLmbdSmk_MAP de 5%. Autorise plus de fuel avant le smoke cut → moins de fumée noire en Stage 1+. À combiner avec un pot catalytique sport.',
      risk: 'medium',
      type: 'recipe',
      recipeId: 'smoke_off',
    },
    {
      id: 'recipe_full_depollution',
      category: 'Dépollution',
      name: 'Full Dépollution — EGR shut + trq safety relevé',
      description: 'AirCtl_nMin_C à 8000 rpm (EGR jamais active) + AccPed_trqNMRMax_C à 250 Nm. À combiner avec un défap mécanique.',
      risk: 'low',
      type: 'recipe',
      recipeId: 'full_depollution',
    },
    {
      id: 'adj_rev_limiter',
      category: 'Réglages avancés',
      name: 'Limiteur régime NMR — AccPed_nLimNMR_C',
      description: 'Seuil Non-Monitored Range. Au-delà, le calculateur réduit le contrôle couple. Stock ~1500 tr/min. Recommandé ≤ 5500 tr/min avec Stage 1 pour éviter les DTC de plausibilité.',
      risk: 'medium',
      type: 'adjustable',
      paramName: 'AccPed_nLimNMR_C',
      unit: 'tr/min',
      min: 1500, max: 6000, step: 250,
      stockHint: 1500,
    },
    {
      id: 'adj_speed_limiter',
      category: 'Réglages avancés',
      name: 'Limiteur vitesse — VSSCD_vMax_C',
      description: 'Vitesse max du régulateur de vitesse et du contrôle propulsion. Stock PSA ~180 km/h. 320 km/h = débrider totalement (régulateur peut dépasser 130 km/h).',
      risk: 'low',
      type: 'adjustable',
      paramName: 'VSSCD_vMax_C',
      unit: 'km/h',
      min: 50, max: 320, step: 10,
      stockHint: 220,
    },
    {
      id: 'adj_torque_nmr',
      category: 'Réglages avancés',
      name: 'Couple max NMR — AccPed_trqNMRMax_C',
      description: 'Plafond couple en mode Non-Monitored Range. Évite que le Stage 1 soit saturé par cette limite protectrice. Stock EDC16C34 PSA = 100 Nm (factor 0.2). Relever à 250 Nm pour la full dépollution.',
      risk: 'medium',
      type: 'adjustable',
      paramName: 'AccPed_trqNMRMax_C',
      unit: 'Nm',
      min: 100, max: 350, step: 10,
      stockHint: 100,
    },
    {
      id: 'adj_cruise_speed',
      category: 'Réglages avancés',
      name: 'Vitesse max régulateur croisière — CrCCD_vSetSpdMax_C',
      description: 'Plafond du régulateur de vitesse (cruise control). Stock PSA EDC16C34 = 254 km/h. À relever uniquement si le régulateur se coupe avant d\'atteindre la vitesse demandée (rarement nécessaire).',
      risk: 'low',
      type: 'adjustable',
      paramName: 'CrCCD_vSetSpdMax_C',
      unit: 'km/h',
      min: 50, max: 320, step: 10,
      stockHint: 254,
    },
    // ─────────────── Codes défaut (DTC) ───────────────
    // Adresses A2L DSM_ClaDfp_* du damos.a2l (validées sur ori.BIN).
    // Sur le Berlingo 9663944680.Bin (firmware différent), les adresses
    // peuvent ne pas correspondre — lire l'avertissement dans l'UI.
    {
      id: 'dtc_all',
      category: 'Codes défaut (DTC)',
      name: 'Supprimer TOUS les codes défaut — 195 DTC',
      description: 'Met à zéro les 195 paramètres DSM_ClaDfp_* (0x1C6734 → 0x1C67F6). Couvre EGR, DPF, turbo, injecteurs, bougies, rail, capteurs, réseau CAN. Compatible DV6 si même firmware Bosch EDC16C34.',
      risk: 'medium',
      type: 'dtc_group',
      addresses: Array.from({ length: 195 }, (_, i) => 0x1C6734 + i),
    },
    {
      id: 'dtc_egr',
      category: 'Codes défaut (DTC)',
      name: 'EGR — Codes circuit vanne EGR (8 DTC)',
      description: 'Supprime EGRCD, EGRSCD (capteur/vanne), EGRVlv (bourrage, dérive long/court terme, gouverneur). À combiner avec le seuil EGR à 8000 tr/min pour une dépollution complète.',
      risk: 'low',
      type: 'dtc_group',
      addresses: [0x1C677A, 0x1C677B, 0x1C677C, 0x1C677D, 0x1C677E, 0x1C677F, 0x1C6780, 0x1C6781],
    },
    {
      id: 'dtc_dpf',
      category: 'Codes défaut (DTC)',
      name: 'DPF/FAP — Codes filtre à particules (7 DTC)',
      description: 'Supprime PFlt* : différentiel pression, charge absente/max/dépassée, défaillance filtre. À utiliser avec DPF OFF physique.',
      risk: 'low',
      type: 'dtc_group',
      addresses: [0x1C67C8, 0x1C67C9, 0x1C67CA, 0x1C67CB, 0x1C67CC, 0x1C67CD, 0x1C67CE],
    },
    {
      id: 'dtc_boost',
      category: 'Codes défaut (DTC)',
      name: 'Turbo/Boost — Codes suralimentation (19 DTC)',
      description: 'AFSCD (débitmètre, 11 codes), AirCtl débit/gouverneur (4), BPA actionneur boost (3), BPSCD capteur boost. Utile si débitmètre ou capteur boost déconnecté.',
      risk: 'medium',
      type: 'dtc_group',
      addresses: [
        // AFSCD 0x1C6739-0x1C6743 (11)
        ...Array.from({ length: 11 }, (_, i) => 0x1C6739 + i),
        // AirCtl flow + governor 0x1C6753-0x1C6756 (4)
        0x1C6753, 0x1C6754, 0x1C6755, 0x1C6756,
        // BPA actuateur + BPSCD capteur 0x1C675B-0x1C675E (4)
        0x1C675B, 0x1C675C, 0x1C675D, 0x1C675E,
      ],
    },
    {
      id: 'dtc_injectors',
      category: 'Codes défaut (DTC)',
      name: 'Injecteurs — Codes par cylindre et rampe (19 DTC)',
      description: 'InjCrv (courbe), InjVlvBnk (par rampe ×4), InjVlvChip (pilotes A/B), InjVlvCyl (par cylindre ×12). Utile après remplacement ou recalibration injecteurs.',
      risk: 'medium',
      type: 'dtc_group',
      addresses: [
        0x1C67A2, // InjCrv
        0x1C67A3, 0x1C67A4, 0x1C67A5, 0x1C67A6, // InjVlvBnk ×4
        0x1C67A7, 0x1C67A8, // InjVlvChipA/B
        // InjVlvCyl ×12 : 0x1C67A9-0x1C67B4
        ...Array.from({ length: 12 }, (_, i) => 0x1C67A9 + i),
      ],
    },
    {
      id: 'dtc_rail',
      category: 'Codes défaut (DTC)',
      name: 'Rail/Pompe HP — Codes haute pression (9 DTC)',
      description: 'RailCD, RailCDOfsTst (test offset rail), RailMeUn (unité de dosage pompe HP ×7). Utile après modification de la pression rail ou remplacement pompe.',
      risk: 'medium',
      type: 'dtc_group',
      addresses: [
        0x1C67D1, 0x1C67D2, // RailCD, RailCDOfsTst
        // RailMeUn 0x1C67D3-0x1C67D9 (7)
        ...Array.from({ length: 7 }, (_, i) => 0x1C67D3 + i),
      ],
    },
    {
      id: 'dtc_glowplug',
      category: 'Codes défaut (DTC)',
      name: 'Bougies de préchauffage (4 DTC)',
      description: 'GlwCD (commande) + GlwCtl (régulation bougies de préchauffage). Inutiles si bougies neuves ou moteur toujours chaud.',
      risk: 'low',
      type: 'dtc_group',
      addresses: [0x1C6795, 0x1C6796, 0x1C6797, 0x1C6798],
    },
    {
      id: 'dtc_misfire',
      category: 'Codes défaut (DTC)',
      name: 'Ratés de combustion (7 DTC)',
      description: 'CmbChbMisfire ×6 (détection ratés par cylindre) + CmbChbMisfireMul (ratés multiples). Peut masquer une vraie anomalie — à utiliser avec précaution.',
      risk: 'medium',
      type: 'dtc_group',
      addresses: [
        // CmbChbMisfire 0x1C676C-0x1C6771 (6) + CmbChbMisfireMul 0x1C6772 (1)
        ...Array.from({ length: 7 }, (_, i) => 0x1C676C + i),
      ],
    },
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
    this._loadTemplates();
    this._loadStage1Deltas();
    this._loadPopBangCurrent();
  }

  async _loadTemplates() {
    const container = this._el?.querySelector('#am-templates');
    if (!container) return;
    try {
      const res = await fetch(`/api/projects/${this.projectId}/templates`);
      const templates = await res.json();
      if (!Array.isArray(templates) || !templates.length) {
        container.innerHTML = `<div style="font-size:11px;color:var(--text-dim);padding:6px 0">Aucun template disponible pour ce calculateur.</div>`;
        return;
      }
      container.innerHTML = templates.map(t => {
        const tags = [];
        if (t.hasStage1) tags.push('Stage 1');
        if (t.hasPopbang) tags.push('Pop&Bang');
        if (t.autoModCount) tags.push(`${t.autoModCount} auto-mod${t.autoModCount > 1 ? 's' : ''}`);
        return `
        <div class="am-item am-template" data-tid="${t.id}">
          <div class="am-item-header">
            <span class="am-name">${t.name}</span>
            <span class="am-status" id="am-tpl-status-${t.id}">${tags.map(x => `<span class="am-tag">${x}</span>`).join('')}</span>
          </div>
          <div class="am-desc">${t.description}</div>
          ${t.vehicles ? `<div class="am-note">🚗 ${t.vehicles}</div>` : ''}
          <div class="am-actions">
            <button class="btn btn-sm btn-primary am-tpl-apply" data-tid="${t.id}">Appliquer ce template</button>
          </div>
        </div>
        `;
      }).join('');

      for (const btn of container.querySelectorAll('.am-tpl-apply')) {
        btn.addEventListener('click', () => this._applyTemplate(btn.getAttribute('data-tid'), btn));
      }
    } catch (e) {
      container.innerHTML = `<div style="font-size:11px;color:var(--danger)">Erreur chargement templates: ${e.message}</div>`;
    }
  }

  async _applyTemplate(tid, btn) {
    if (!confirm('Appliquer ce template ? Les cartographies seront modifiées. Il est recommandé de faire un commit git avant.')) return;
    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = 'Application…';
    try {
      const res = await fetch(`/api/projects/${this.projectId}/apply-template/${tid}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'apply failed');

      const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
      const romBuf = await romRes.arrayBuffer();
      this.romData.set(new Uint8Array(romBuf));

      const parts = [];
      if (data.stage1?.length) parts.push(`${data.stage1.length} map${data.stage1.length > 1 ? 's' : ''}`);
      if (data.popbang) parts.push(`popbang ${data.popbang.rpm}tr/min`);
      if (data.autoMods?.length) parts.push(`${data.autoMods.filter(m => !m.error).length} auto-mod${data.autoMods.length > 1 ? 's' : ''}`);
      btn.classList.remove('btn-primary');
      btn.classList.add('btn-success');
      btn.textContent = `✓ Appliqué (${parts.join(', ') || 'aucun changement'})`;

      const statusEl = this._el.querySelector(`#am-tpl-status-${tid}`);
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--accent2)">✓ Appliqué</span>';

      if (this.onBytesChange) this.onBytesChange(0, this.romData);

      // Refresh the rest of the modal since applied state of underlying mods has changed
      this._scan();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = prevText;
      alert('Erreur template: ' + e.message);
    }
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
        <div style="overflow-y:auto;flex:1">
          <div class="am-section">
            <div class="am-cat">🚗 Templates véhicule</div>
            <div id="am-templates"><div style="font-size:11px;color:var(--text-dim);padding:6px 0">Chargement…</div></div>
          </div>
          ${sections}
        </div>
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
      } else if (mod.type === 'adjustable' || mod.type === 'dtc_group') {
        this._results.set(mod.id, { found: null, offset: -1, applied: null });
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

      if (mod.type === 'recipe') {
        this._buildRecipeActions(actionsEl, mod);
        continue;
      }

      if (mod.type === 'adjustable') {
        this._buildAdjustableActions(actionsEl, mod);
        continue;
      }

      if (mod.type === 'dtc_group') {
        this._buildDTCGroupActions(actionsEl, mod);
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
      pctInput.id = `s1-pct-${m.name}`;
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

    // RPM — snap sur les valeurs d'axe RPM des maps Bosch EDC16C34
    // (AccPed_trqEng*_MAP xAxis). Mettre une valeur "hors grille" marche
    // techniquement (c'est un simple seuil) mais les forums recommandent
    // de coller à un point d'axe pour que le datalog soit lisible.
    const BOSCH_RPM_AXIS = [1000, 1250, 1500, 1750, 2000, 2250, 2500, 2750, 3000, 3500, 4000, 4500, 5000, 5300];
    const rpmRow = document.createElement('div');
    rpmRow.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:12px';
    const rpmLabel = document.createElement('label');
    rpmLabel.textContent = 'RPM départ overrun :';
    rpmLabel.style.cssText = 'width:160px;flex-shrink:0';
    const rpmSelect = document.createElement('select');
    rpmSelect.id = 'pb-rpm-select';
    rpmSelect.style.cssText = 'flex:1;padding:4px 8px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:3px';
    for (const r of BOSCH_RPM_AXIS) {
      const o = document.createElement('option');
      o.value = r; o.textContent = r + ' tr/min';
      if (r === 3000) o.selected = true; // défaut recommandé
      rpmSelect.appendChild(o);
    }
    const rpmVal = document.createElement('span');
    rpmVal.id = 'pb-rpm-stock-note';
    rpmVal.textContent = '(point d\'axe map)';
    rpmVal.style.cssText = 'width:120px;text-align:right;color:var(--text-dim);font-size:10px';
    // On expose une API {value: Number} pour que applyBtn continue à marcher
    const rpmSlider = { get value() { return rpmSelect.value; } };
    rpmRow.append(rpmLabel, rpmSelect, rpmVal);

    // Fuel qty slider
    const qRow = document.createElement('div');
    qRow.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:12px';
    const qLabel = document.createElement('label');
    qLabel.textContent = 'Qté carburant (brut) :';
    qLabel.style.cssText = 'width:160px;flex-shrink:0';
    const qSlider = document.createElement('input');
    qSlider.id = 'pb-q-slider';
    qSlider.type = 'range';
    qSlider.min = 0; qSlider.max = 100; qSlider.step = 1; qSlider.value = 10;
    qSlider.style.cssText = 'flex:1';
    const qVal = document.createElement('span');
    qVal.id = 'pb-q-val';
    qVal.textContent = '10 (≈1 mg/hub)';
    qVal.style.cssText = 'width:120px;text-align:right;color:var(--accent)';
    const qStockNote = document.createElement('span');
    qStockNote.id = 'pb-q-stock-note';
    qStockNote.style.cssText = 'font-size:10px;color:var(--text-dim)';
    qSlider.addEventListener('input', () => { qVal.textContent = `${qSlider.value} (≈${(qSlider.value/10).toFixed(1)} mg/hub)`; });
    qRow.append(qLabel, qSlider, qVal, qStockNote);

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

  // Recipe actions : bouton Appliquer qui hit le endpoint
  // /api/projects/:id/open-damos-recipe/:recipeId. Liste les opérations
  // effectuées (adresses, cells changées) après succès.
  _buildRecipeActions(container, mod) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:4px';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-sm btn-primary';
    applyBtn.textContent = 'Appliquer cette recette';

    const resultEl = document.createElement('div');
    resultEl.style.cssText = 'font-size:10px;color:var(--text-dim);margin-top:4px;max-height:120px;overflow-y:auto';

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Application…';
      resultEl.innerHTML = '';
      try {
        const res = await fetch(`/api/projects/${this.projectId}/open-damos-recipe/${mod.recipeId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erreur serveur');

        // Reload ROM data
        const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
        const romBuf = await romRes.arrayBuffer();
        this.romData.set(new Uint8Array(romBuf));
        if (this.onBytesChange) this.onBytesChange(0, this.romData);

        applyBtn.className = 'btn btn-sm btn-success';
        applyBtn.textContent = `✓ Appliqué (${data.bytesChanged} octets)`;

        // Montre le détail des ops (adresses touchées, erreurs)
        resultEl.innerHTML = data.operations.map(o => {
          const addr = o.address ? '0x' + o.address.toString(16).toUpperCase() : '—';
          if (o.error) return `<div style="color:var(--danger)">✗ <strong>${o.entry}</strong> @ ${addr} — ${o.error}</div>`;
          if (o.method === 'addPct') return `<div style="color:var(--accent2)">✓ <strong>${o.entry}</strong> @ ${addr} — +${o.pct}% (${o.cellsChanged} cells)</div>`;
          if (o.method === 'setPhys') return `<div style="color:var(--accent2)">✓ <strong>${o.entry}</strong> @ ${addr} — ${o.prevRaw} → ${o.rawValue} (${o.physValue} phys)</div>`;
          if (o.method === 'setRaw') return `<div style="color:var(--accent2)">✓ <strong>${o.entry}</strong> @ ${addr} — raw ${o.prevRaw} → ${o.rawValue}</div>`;
          if (o.method === 'setMapAll') return `<div style="color:var(--accent2)">✓ <strong>${o.entry}</strong> @ ${addr} — all cells → ${o.physValue} (${o.cellsChanged} cells)</div>`;
          return `<div>${o.entry} @ ${addr}</div>`;
        }).join('');
      } catch (e) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Appliquer cette recette';
        resultEl.innerHTML = `<span style="color:var(--danger)">Erreur : ${e.message}</span>`;
      }
    });

    wrap.append(applyBtn, resultEl);
    container.appendChild(wrap);
  }

  // Charge le delta actuel (% vs stock) pour chaque MAP Stage 1 et pré-remplit
  // les champs numériques du formulaire Stage 1. Appelé à l'ouverture du modal.
  async _loadStage1Deltas() {
    try {
      const res = await fetch(`/api/projects/${this.projectId}/rom/stage1-delta`);
      if (!res.ok) return;
      const { maps } = await res.json();
      for (const m of maps) {
        const input = this._el?.querySelector(`#s1-pct-${m.name}`);
        if (input && !m.error) input.value = Math.round(m.avgPct);
      }
    } catch { /* non-fatal */ }
  }

  // Charge les valeurs courantes de la ROM pour les sliders pop & bang.
  async _loadPopBangCurrent() {
    const rpmSel = this._el?.querySelector('#pb-rpm-select');
    const qSlider = this._el?.querySelector('#pb-q-slider');
    const qVal = this._el?.querySelector('#pb-q-val');
    if (!rpmSel && !qSlider) return;
    try {
      const [rpmRes, qRes] = await Promise.all([
        fetch(`/api/projects/${this.projectId}/rom/scalar?name=AirCtl_nOvrRun_C`),
        fetch(`/api/projects/${this.projectId}/rom/scalar?name=AirCtl_qOvrRun_C`),
      ]);
      if (rpmRes.ok) {
        const d = await rpmRes.json();
        if (d.rawValue !== undefined) {
          // Sélectionner la valeur la plus proche dans le <select>
          const opts = Array.from(rpmSel?.options || []);
          const closest = opts.reduce((a, b) => Math.abs(b.value - d.rawValue) < Math.abs(a.value - d.rawValue) ? b : a, opts[0]);
          if (closest) closest.selected = true;
          if (d.stockRaw !== null && d.rawValue !== d.stockRaw) {
            const note = this._el?.querySelector('#pb-rpm-stock-note');
            if (note) note.textContent = `(stock: ${d.stockRaw} tr/min)`;
          }
        }
      }
      if (qRes.ok) {
        const d = await qRes.json();
        if (d.rawValue !== undefined && qSlider) {
          qSlider.value = d.rawValue;
          if (qVal) qVal.textContent = `${d.rawValue} (≈${(d.rawValue/10).toFixed(1)} mg/hub)`;
          if (d.stockRaw !== null && d.rawValue !== d.stockRaw) {
            const note = this._el?.querySelector('#pb-q-stock-note');
            if (note) note.textContent = `(stock: ${d.stockRaw})`;
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  // Slider réglable pour un paramètre scalaire (VALUE) avec indicateur stock.
  _buildAdjustableActions(container, mod) {
    const listId = `am-adj-list-${mod.id}`;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';

    // ── Slider + valeur courante ──
    const sliderRow = document.createElement('div');
    sliderRow.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:12px';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = mod.min; slider.max = mod.max; slider.step = mod.step;
    slider.value = mod.stockHint ?? mod.min;
    slider.style.cssText = 'flex:1';
    slider.setAttribute('list', listId);

    const tickList = document.createElement('datalist');
    tickList.id = listId;

    const valueSpan = document.createElement('span');
    valueSpan.style.cssText = 'min-width:90px;text-align:right;font-family:monospace;color:var(--accent)';
    valueSpan.textContent = `${slider.value} ${mod.unit}`;

    sliderRow.append(slider, valueSpan);

    // ── Badge delta vs stock ──
    const badge = document.createElement('span');
    badge.className = 'am-scalar-badge am-scalar-badge-loading';
    badge.textContent = 'Chargement…';

    // ── Info stock ──
    const stockInfo = document.createElement('div');
    stockInfo.style.cssText = 'font-size:10px;color:var(--text-dim)';

    // ── Boutons ──
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;align-items:center';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn btn-sm btn-primary';
    applyBtn.textContent = 'Appliquer';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-sm';
    restoreBtn.textContent = '↩ Stock';
    restoreBtn.disabled = true;

    const resultInfo = document.createElement('div');
    resultInfo.style.cssText = 'font-size:10px;color:var(--text-dim)';

    btnRow.append(applyBtn, restoreBtn);

    let stockRaw = mod.stockHint ?? null;

    const updateBadge = () => {
      const val = Number(slider.value);
      valueSpan.textContent = `${val} ${mod.unit}`;
      if (stockRaw === null) { badge.textContent = '…'; return; }
      const diff = val - stockRaw;
      if (Math.abs(diff) < mod.step * 0.5) {
        badge.textContent = '= Stock';
        badge.className = 'am-scalar-badge am-scalar-badge-ok';
      } else if (diff > 0) {
        badge.textContent = `+${diff} ${mod.unit} vs stock`;
        badge.className = 'am-scalar-badge am-scalar-badge-warn';
      } else {
        badge.textContent = `${diff} ${mod.unit} vs stock`;
        badge.className = 'am-scalar-badge am-scalar-badge-info';
      }
      restoreBtn.disabled = Math.abs(diff) < mod.step * 0.5;
    };

    slider.addEventListener('input', updateBadge);

    // Chargement asynchrone des valeurs depuis la ROM.
    // On utilise physValue/stockPhys (valeur convertie par factor/offset A2L)
    // pour que le slider affiche des unités lisibles (km/h, rpm, Nm…).
    fetch(`/api/projects/${this.projectId}/rom/scalar?name=${encodeURIComponent(mod.paramName)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          badge.textContent = 'Non trouvé dans cette ROM';
          badge.className = 'am-scalar-badge am-scalar-badge-info';
          stockInfo.textContent = `ℹ ${data.error}`;
          return;
        }
        // physValue : valeur après conversion (ex: km/h, rpm, Nm)
        const phys = data.physValue ?? data.rawValue;
        const clamped = Math.max(mod.min, Math.min(mod.max, phys));
        slider.value = clamped;

        if (data.stockPhys !== null && data.stockPhys !== undefined) {
          stockRaw = data.stockPhys;  // on stocke la phys pour comparer
          const clampedStock = Math.max(mod.min, Math.min(mod.max, stockRaw));
          const opt = document.createElement('option');
          opt.value = clampedStock;
          opt.label = `stock (${stockRaw} ${mod.unit})`;
          tickList.appendChild(opt);
          stockInfo.textContent = `Stock ROM originale : ${stockRaw} ${mod.unit} — 0x${data.address.toString(16).toUpperCase()} (${data.addressSource})`;
        } else if (data.stockRaw !== null) {
          stockRaw = data.stockRaw;
          stockInfo.textContent = `Adresse 0x${data.address.toString(16).toUpperCase()} (${data.addressSource})`;
        }
        updateBadge();
      })
      .catch(() => {
        badge.textContent = 'Erreur lecture ROM';
        badge.className = 'am-scalar-badge am-scalar-badge-warn';
      });

    // ── Apply ──
    // physVal = valeur affichée (en unités lisibles). Le serveur convertit en raw.
    const doApply = async (physVal) => {
      applyBtn.disabled = true; restoreBtn.disabled = true;
      applyBtn.textContent = 'Application…';
      try {
        const res = await fetch(`/api/projects/${this.projectId}/rom/scalar`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: mod.paramName, physValue: physVal }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
        this.romData.set(new Uint8Array(await romRes.arrayBuffer()));
        if (this.onBytesChange) this.onBytesChange(data.address, []);
        slider.value = physVal;
        updateBadge();
        applyBtn.className = 'btn btn-sm btn-success';
        applyBtn.textContent = `✓ ${physVal} ${mod.unit}`;
        resultInfo.textContent = `Écrit : ${data.oldRaw} → ${data.newRaw} (phys: ${data.physValue}) @ 0x${data.address.toString(16).toUpperCase()}`;
        setTimeout(() => { applyBtn.className = 'btn btn-sm btn-primary'; applyBtn.textContent = 'Appliquer'; applyBtn.disabled = false; }, 2500);
      } catch (e) {
        applyBtn.disabled = false; applyBtn.textContent = 'Appliquer';
        restoreBtn.disabled = stockRaw === null || Number(slider.value) === stockRaw;
        resultInfo.innerHTML = `<span style="color:var(--danger)">Erreur : ${e.message}</span>`;
      }
    };

    applyBtn.addEventListener('click', () => doApply(Number(slider.value)));
    restoreBtn.addEventListener('click', () => {
      if (stockRaw === null) return;
      slider.value = Math.max(mod.min, Math.min(mod.max, stockRaw));
      updateBadge();
      doApply(stockRaw);
    });

    wrap.append(badge, sliderRow, tickList, stockInfo, btnRow, resultInfo);
    container.appendChild(wrap);
  }

  // Groupe de DTC : toggle Supprimer / Restaurer sur un lot d'adresses 1-octet.
  // La détection de l'état courant lit directement romData (sync, pas de round-trip).
  // Un avertissement firmware s'affiche si les valeurs lues sont hors plage DTC (>30).
  _buildDTCGroupActions(container, mod) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:4px';

    const badge = document.createElement('span');
    badge.className = 'am-scalar-badge am-scalar-badge-loading';
    badge.textContent = 'Lecture…';

    // Avertissement firmware mismatch (affiché si les valeurs semblent aberrantes)
    const warnEl = document.createElement('div');
    warnEl.className = 'am-note';
    warnEl.style.cssText = 'display:none;background:rgba(206,145,120,0.08);border:1px solid rgba(206,145,120,0.3);border-radius:4px;padding:6px 8px;font-size:11px;line-height:1.5;margin-top:2px';
    warnEl.innerHTML = '⚠ <strong>Firmware différent détecté</strong> — Les valeurs à ces adresses A2L sont hors plage DTC valide (0–30). Le damos.a2l est calibré pour ori.BIN, pas forcément pour votre Berlingo (9663944680.Bin). <strong>Vérifiez avec MPPS en lecture avant de flasher.</strong> Compatibilité DV6 75ch/90ch/110ch non garantie sans A2L spécifique.';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';

    const suppressBtn = document.createElement('button');
    suppressBtn.className = 'btn btn-sm btn-primary';
    suppressBtn.textContent = 'Supprimer ces DTC';

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn btn-sm';
    restoreBtn.textContent = '↩ Restaurer stock';
    restoreBtn.disabled = true;

    const resultInfo = document.createElement('div');
    resultInfo.style.cssText = 'font-size:10px;color:var(--text-dim)';

    // Lecture sync de l'état courant via romData
    const values = mod.addresses.map(addr => addr < this.romData.length ? this.romData[addr] : null);
    const valid = values.filter(v => v !== null);
    const suppressed = valid.filter(v => v === 0x00).length;
    const suspicious = valid.filter(v => v !== null && v > 30 && v < 255).length;
    const padding = valid.filter(v => v === 255).length;
    const total = mod.addresses.length;

    const updateBadge = (nSuppressed) => {
      if (nSuppressed === total) {
        badge.textContent = `✓ Tous supprimés (${total}/${total})`;
        badge.className = 'am-scalar-badge am-scalar-badge-ok';
        restoreBtn.disabled = false;
      } else if (nSuppressed > 0) {
        badge.textContent = `Partiellement supprimés (${nSuppressed}/${total})`;
        badge.className = 'am-scalar-badge am-scalar-badge-info';
        restoreBtn.disabled = false;
      } else {
        badge.textContent = `Non supprimés (0/${total})`;
        badge.className = 'am-scalar-badge am-scalar-badge-warn';
        restoreBtn.disabled = true;
      }
    };
    updateBadge(suppressed);

    // Affiche l'avertissement si plus d'un tiers des valeurs sont hors plage
    if (suspicious > total / 3 || padding > total / 2) {
      warnEl.style.display = '';
    }

    const doRequest = async (restore) => {
      const isRestore = !!restore;
      const activeBtn = isRestore ? restoreBtn : suppressBtn;
      const otherBtn = isRestore ? suppressBtn : restoreBtn;
      activeBtn.disabled = true;
      activeBtn.textContent = isRestore ? 'Restauration…' : 'Suppression…';
      resultInfo.innerHTML = '';
      try {
        const res = await fetch(`/api/projects/${this.projectId}/dtc-group`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: mod.addresses, restore: isRestore }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        const romRes = await fetch(`/api/projects/${this.projectId}/rom`);
        this.romData.set(new Uint8Array(await romRes.arrayBuffer()));
        if (this.onBytesChange) this.onBytesChange(mod.addresses[0], []);

        const newSuppressed = isRestore ? 0 : data.bytesWritten;
        updateBadge(isRestore ? 0 : data.bytesWritten);
        resultInfo.textContent = isRestore
          ? `${data.changed} valeurs restaurées depuis ROM originale`
          : `${data.changed} DTC supprimés (0x00 écrit)`;

        if (!isRestore) {
          suppressBtn.className = 'btn btn-sm btn-success';
          suppressBtn.textContent = `✓ ${data.changed} DTC supprimés`;
          setTimeout(() => { suppressBtn.className = 'btn btn-sm btn-primary'; suppressBtn.textContent = 'Supprimer ces DTC'; suppressBtn.disabled = false; }, 2500);
        } else {
          restoreBtn.textContent = '↩ Restaurer stock';
          otherBtn.disabled = false;
        }
      } catch (e) {
        activeBtn.disabled = false;
        activeBtn.textContent = isRestore ? '↩ Restaurer stock' : 'Supprimer ces DTC';
        resultInfo.innerHTML = `<span style="color:var(--danger)">Erreur : ${e.message}</span>`;
      }
    };

    suppressBtn.addEventListener('click', () => doRequest(false));
    restoreBtn.addEventListener('click', () => doRequest(true));

    btnRow.append(suppressBtn, restoreBtn);
    wrap.append(badge, warnEl, btnRow, resultInfo);
    container.appendChild(wrap);
  }

  _updateStatus(mod) {
    const el = this._el?.querySelector(`#am-status-${mod.id}`);
    if (!el) return;
    const result = this._results.get(mod.id);
    if (mod.type === 'info' || mod.type === 'stage1' || mod.type === 'popbang' || mod.type === 'recipe' || mod.type === 'adjustable' || mod.type === 'dtc_group') { el.textContent = ''; return; }
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
