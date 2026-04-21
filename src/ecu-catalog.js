// ECU catalog — supported ECUs grouped by family
// Each entry describes capabilities, known parameter addresses, and A2L availability.
// stage1Maps / popbangParams are undefined for ECUs without confirmed addresses.

const ECU_CATALOG = [
  // ── Bosch EDC16 (diesel, early 2000s–2010) ────────────────────────────────
  {
    id: 'edc16c34',
    name: 'EDC16C34',
    family: 'EDC16',
    fuel: 'diesel',
    application: 'PSA 1.6 HDi 110cv (DV6TED4) — 206 / 307 / 308 / Berlingo / C3 / C4',
    a2l: 'ressources/edc16c34/damos.a2l',
    stage1Maps: [
      { name: 'AccPed_trqEngHiGear_MAP', address: 0x16D6C4, defaultPct: 15, label: 'Couple pédale Hi gear' },
      { name: 'AccPed_trqEngLoGear_MAP', address: 0x16DA04, defaultPct: 15, label: 'Couple pédale Lo gear' },
      { name: 'FMTC_trq2qBas_MAP',      address: 0x1760A4, defaultPct: 12, label: 'Couple → Injection (FMTC)' },
      { name: 'Rail_pSetPointBase_MAP',  address: 0x17A4A4, defaultPct: 10, label: 'Pression rail setpoint' },
      { name: 'EngPrt_trqAPSLim_MAP',   address: 0x1758E4, defaultPct: 25, label: 'Limite protection moteur' },
    ],
    popbangParams: {
      nOvrRun: { address: 0x1C4046, min: 500,  max: 5500, label: 'RPM départ overrun' },
      qOvrRun: { address: 0x1C40B4, min: 0,    max: 100,  label: 'Qté carburant (brut ×0.1 mg)' },
    },
    autoModPatterns: [
      {
        id: 'dpf_off',
        search:  [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x01,0x01,0x00,0x0C,0x3B,0x0D,0x03],
        replace: [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x00,0x00,0x00,0x0C,0x3B,0x0D,0x03],
        restore: [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x01,0x01,0x00,0x0C,0x3B,0x0D,0x03],
      }
    ],
    autoModAddresses: [
      { id: 'dpf_dtc_off', address: 0x1E9DD4, bytes: [0xFF,0xFF], restore: [0x00,0x01] },
      { id: 'egr_off',     address: 0x1C4C4E, bytes: [0x00,0x00], restore: null },
    ],
  },
  {
    id: 'edc16c39',
    name: 'EDC16C39',
    family: 'EDC16',
    fuel: 'diesel',
    application: 'PSA 2.0 HDi 136cv (DW10BTED4) — 407 / 607 / C5 / C6',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'edc16c3',
    name: 'EDC16C3',
    family: 'EDC16',
    fuel: 'diesel',
    application: 'VW / Audi / Seat / Skoda 1.9 TDI 105cv PD (BKC / BXE / BJB)',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'edc16u31',
    name: 'EDC16U31',
    family: 'EDC16',
    fuel: 'diesel',
    application: 'VW / Audi / Seat / Skoda 1.9 TDI 105cv CR (BLS)',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'edc16cp31',
    name: 'EDC16CP31',
    family: 'EDC16',
    fuel: 'diesel',
    application: 'BMW 318d / 320d / 520d (M47TU2)',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'edc16c2',
    name: 'EDC16C2',
    family: 'EDC16',
    fuel: 'diesel',
    application: 'Renault / Nissan 1.9 dCi 120cv (F9Q)',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },

  // ── Bosch EDC17 (diesel, 2008+) ────────────────────────────────────────────
  {
    id: 'edc17c10',
    name: 'EDC17C10',
    family: 'EDC17',
    fuel: 'diesel',
    application: 'PSA 1.6 HDi 112cv BlueHDi (DV6C)',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'edc17c46',
    name: 'EDC17C46',
    family: 'EDC17',
    fuel: 'diesel',
    application: 'Renault 1.5 dCi 110cv (K9K) — Mégane / Clio / Kangoo',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'edc17c60',
    name: 'EDC17C60',
    family: 'EDC17',
    fuel: 'diesel',
    application: 'VW / Audi 2.0 TDI CR (EA288) — Golf 7 / A3 8V',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },

  // ── Bosch ME7 (essence, 1998–2008) ─────────────────────────────────────────
  {
    id: 'me7.4.4',
    name: 'ME7.4.4',
    family: 'ME7',
    fuel: 'essence',
    application: 'VW / Audi 1.8T 20v (AUM / ARZ / APX) — Golf 4 / A3 8L / TT',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'me7.5',
    name: 'ME7.5',
    family: 'ME7',
    fuel: 'essence',
    application: 'VW / Audi 1.8T / 2.0T (APY / AWU / BAM) — S3 / TT 225',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },

  // ── Bosch MED17 (essence direct injection, 2005+) ─────────────────────────
  {
    id: 'med17.5.25',
    name: 'MED17.5.25',
    family: 'MED17',
    fuel: 'essence',
    application: 'VW / Audi / Seat / Skoda 1.4 / 1.8 / 2.0 TFSI/TSI (EA111 / EA888)',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
  {
    id: 'med17.1',
    name: 'MED17.1',
    family: 'MED17',
    fuel: 'essence',
    application: 'BMW 2.0i / 3.0i (N43 / N53) — 1er / 3er / 5er',
    a2l: null,
    stage1Maps: null,
    popbangParams: null,
  },
];

const ECU_MAP = Object.fromEntries(ECU_CATALOG.map(e => [e.id, e]));

function getEcu(id) {
  return ECU_MAP[id] || null;
}

function listEcus() {
  return ECU_CATALOG.map(({ id, name, family, fuel, application, a2l, stage1Maps, popbangParams }) => ({
    id,
    name,
    family,
    fuel,
    application,
    hasA2l:      !!a2l,
    hasStage1:   !!stage1Maps,
    hasPopbang:  !!popbangParams,
  }));
}

module.exports = { ECU_CATALOG, getEcu, listEcus };
