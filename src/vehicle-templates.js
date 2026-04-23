// Vehicle templates — presets « one-click » pour des familles de voitures.
// Chaque template bundle un Stage 1 (pourcentages par carte), éventuellement
// un Pop & Bang (RPM + qté carburant), et une liste d'auto-mods à appliquer.
//
// Les templates réutilisent les adresses déjà définies dans ecu-catalog.js ;
// seuls les pourcentages / valeurs / sélections d'auto-mods vivent ici.

const VEHICLE_TEMPLATES = [
  {
    id: 'psa_16hdi_110_stage1_safe',
    name: 'PSA 1.6 HDi 110 — Stage 1 Safe',
    description: 'Stage 1 conservateur (≈+20 ch / +40 Nm estimé). Garde une marge sur rail et protection moteur. Turbo et embrayage d\'origine OK.',
    vehicles: '206 / 307 / 308 / Berlingo / C3 / C4 HDi 110cv (DV6TED4)',
    appliesTo: ['edc16c34'],
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
    name: 'PSA 1.6 HDi 110 — Stage 1 Sport + Pop&Bang',
    description: 'Stage 1 agressif (≈+30 ch / +60 Nm estimé) avec Pop & Bang overrun léger (CT compatible). À réserver à un turbo + embrayage sains.',
    vehicles: '206 / 307 / 308 / Berlingo / C3 / C4 HDi 110cv (DV6TED4)',
    appliesTo: ['edc16c34'],
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
  {
    id: 'psa_16hdi_110_depollution_off',
    name: 'PSA 1.6 HDi 110 — Dépollution OFF',
    description: 'FAP, DTC FAP, EGR désactivés. ⚠ À faire après dépose physique (FAP vidé, EGR bouchée). Repasser stock avant CT.',
    vehicles: '206 / 307 / 308 / Berlingo / C3 / C4 HDi 110cv (DV6TED4)',
    appliesTo: ['edc16c34'],
    stage1: null,
    popbang: null,
    autoMods: ['dpf_off', 'dpf_dtc_off', 'egr_off'],
  },
];

function listTemplates() {
  return VEHICLE_TEMPLATES.map(({ id, name, description, vehicles, appliesTo, stage1, popbang, autoMods }) => ({
    id, name, description, vehicles, appliesTo,
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

module.exports = { VEHICLE_TEMPLATES, listTemplates, getTemplate, listTemplatesForEcu };
