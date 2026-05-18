// Vehicle templates — presets « one-click » par famille de voiture.
// Chaque template bundle un Stage 1, éventuellement un Pop & Bang, et des auto-mods.
//
// appliesToVariant : tableau de variantes ['75ch','90ch','110ch'], ou null = toutes.
// Le serveur filtre par variante détectée depuis la ROM originale (backup).

const VEHICLE_TEMPLATES = [

  // ── DV6BTED4 55kW 75ch (Berlingo I / Partner / 206 / 307 1.6 HDi 75) ──────
  {
    id: 'psa_16hdi_75_stage1_safe',
    name: 'PSA 1.6 HDi 75ch — Stage 1 Safe',
    description: 'Stage 1 conservateur adapté au DV6BTED4 75ch (≈+8ch / +15Nm estimé). Reste dans les limites du turbo et de l\'embrayage d\'origine.',
    vehicles: 'Berlingo I / Partner / 206 / 307 / C3 1.6 HDi 75cv (DV6BTED4)',
    appliesTo: ['edc16c34'],
    appliesToVariant: ['75ch'],
    stage1: { pcts: {
      AccPed_trqEngHiGear_MAP: 6,
      AccPed_trqEngLoGear_MAP: 6,
      FMTC_trq2qBas_MAP: 5,
      Rail_pSetPointBase_MAP: 4,
      EngPrt_trqAPSLim_MAP: 6,
    } },
    popbang: null,
    autoMods: [],
  },
  {
    id: 'psa_16hdi_75_stage1_sport',
    name: 'PSA 1.6 HDi 75ch — Stage 1 Sport',
    description: 'Stage 1 au maximum recommandé pour le 75ch (≈+12ch / +20Nm estimé). Limite moteur relevée à +8%. Turbo et embrayage d\'origine requis en bon état.',
    vehicles: 'Berlingo I / Partner / 206 / 307 / C3 1.6 HDi 75cv (DV6BTED4)',
    appliesTo: ['edc16c34'],
    appliesToVariant: ['75ch'],
    stage1: { pcts: {
      AccPed_trqEngHiGear_MAP: 8,
      AccPed_trqEngLoGear_MAP: 8,
      FMTC_trq2qBas_MAP: 7,
      Rail_pSetPointBase_MAP: 6,
      EngPrt_trqAPSLim_MAP: 8,
    } },
    popbang: null,
    autoMods: [],
  },

  // ── DV6TED4 66kW 90ch ────────────────────────────────────────────────────────
  {
    id: 'psa_16hdi_90_stage1_safe',
    name: 'PSA 1.6 HDi 90ch — Stage 1 Safe',
    description: 'Stage 1 conservateur pour le DV6TED4 90ch (≈+12ch / +25Nm estimé).',
    vehicles: '207 / 308 / 3008 / C3 / C4 1.6 HDi 90cv (DV6TED4)',
    appliesTo: ['edc16c34'],
    appliesToVariant: ['90ch'],
    stage1: { pcts: {
      AccPed_trqEngHiGear_MAP: 8,
      AccPed_trqEngLoGear_MAP: 8,
      FMTC_trq2qBas_MAP: 7,
      Rail_pSetPointBase_MAP: 5,
      EngPrt_trqAPSLim_MAP: 10,
    } },
    popbang: null,
    autoMods: [],
  },
  {
    id: 'psa_16hdi_90_stage1_sport',
    name: 'PSA 1.6 HDi 90ch — Stage 1 Sport',
    description: 'Stage 1 agressif pour le 90ch (≈+18ch / +35Nm estimé). À réserver à un turbo sain.',
    vehicles: '207 / 308 / 3008 / C3 / C4 1.6 HDi 90cv (DV6TED4)',
    appliesTo: ['edc16c34'],
    appliesToVariant: ['90ch'],
    stage1: { pcts: {
      AccPed_trqEngHiGear_MAP: 12,
      AccPed_trqEngLoGear_MAP: 12,
      FMTC_trq2qBas_MAP: 10,
      Rail_pSetPointBase_MAP: 8,
      EngPrt_trqAPSLim_MAP: 12,
    } },
    popbang: null,
    autoMods: [],
  },

  // ── DV6TED4 81kW 110ch ───────────────────────────────────────────────────────
  {
    id: 'psa_16hdi_110_stage1_safe',
    name: 'PSA 1.6 HDi 110ch — Stage 1 Safe',
    description: 'Stage 1 conservateur (≈+20ch / +40Nm estimé). Garde une marge sur rail et protection moteur. Turbo et embrayage d\'origine OK.',
    vehicles: '206 / 307 / 308 / Berlingo II / C3 / C4 HDi 110cv (DV6TED4)',
    appliesTo: ['edc16c34'],
    appliesToVariant: ['110ch'],
    stage1: { pcts: {
      AccPed_trqEngHiGear_MAP: 10,
      AccPed_trqEngLoGear_MAP: 10,
      FMTC_trq2qBas_MAP: 8,
      Rail_pSetPointBase_MAP: 6,
      EngPrt_trqAPSLim_MAP: 15,
    } },
    popbang: null,
    autoMods: [],
  },
  {
    id: 'psa_16hdi_110_stage1_sport',
    name: 'PSA 1.6 HDi 110ch — Stage 1 Sport + Pop&Bang',
    description: 'Stage 1 agressif (≈+30ch / +60Nm estimé) avec Pop & Bang overrun léger (CT compatible). À réserver à un turbo + embrayage sains.',
    vehicles: '206 / 307 / 308 / Berlingo II / C3 / C4 HDi 110cv (DV6TED4)',
    appliesTo: ['edc16c34'],
    appliesToVariant: ['110ch'],
    stage1: { pcts: {
      AccPed_trqEngHiGear_MAP: 15,
      AccPed_trqEngLoGear_MAP: 15,
      FMTC_trq2qBas_MAP: 12,
      Rail_pSetPointBase_MAP: 10,
      EngPrt_trqAPSLim_MAP: 25,
    } },
    popbang: { rpm: 3000, fuelQty: 12 },
    autoMods: [],
  },

  // ── Dépollution — toutes variantes DV6 ─────────────────────────────────────
  {
    id: 'psa_16hdi_depollution_off',
    name: 'PSA 1.6 HDi — Dépollution OFF (EGR + FAP + DTC)',
    description: 'FAP, DTC FAP, EGR désactivés. ⚠ À faire après dépose physique (FAP vidé, EGR bouchée). Repasser stock avant CT.',
    vehicles: 'Toutes variantes DV6 75ch / 90ch / 110ch (EDC16C34)',
    appliesTo: ['edc16c34'],
    appliesToVariant: null,
    stage1: null,
    popbang: null,
    autoMods: ['dpf_off', 'dpf_dtc_off', 'egr_off'],
  },
];

function listTemplates() {
  return VEHICLE_TEMPLATES.map(({ id, name, description, vehicles, appliesTo, appliesToVariant, stage1, popbang, autoMods }) => ({
    id, name, description, vehicles, appliesTo, appliesToVariant,
    hasStage1: !!stage1,
    hasPopbang: !!popbang,
    autoModCount: (autoMods || []).length,
  }));
}

function getTemplate(id) {
  return VEHICLE_TEMPLATES.find(t => t.id === id) || null;
}

function listTemplatesForEcu(ecuId) {
  return listTemplates().filter(t => t.appliesTo.includes(ecuId));
}

function listTemplatesForVariant(ecuId, variant) {
  return listTemplatesForEcu(ecuId).filter(t =>
    t.appliesToVariant === null || t.appliesToVariant.includes(variant)
  );
}

module.exports = { VEHICLE_TEMPLATES, listTemplates, getTemplate, listTemplatesForEcu, listTemplatesForVariant };
