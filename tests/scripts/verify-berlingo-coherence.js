// Verifies every open_damos-relocated map on the Berlingo ROM against
// physical expectations for a 1.6 HDi 75cv DV6TED4 : torque ranges,
// rail pressure bar, fuel mg/cyc, rpm axes, limiter behavior.
//
// This catches silent errors like : "fingerprint matched but it's not
// actually the same map, it's a similarly-shaped unrelated table".

const fs = require('fs');
const path = require('path');
const { loadOpenDamos, relocate } = require('../../src/open-damos');
const { readMapData } = require('../../src/rom-patcher');

const BERLINGO = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', '9663944680.Bin');
const ORI = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', 'ori.BIN');

// Expected physical ranges per map (Bosch EDC16C34 PSA, famille DV6TED4 —
// cross-checked avec forums ecuedit/mhhauto + physique moteur).
// NB : ces maps encodent des PLAFONDS (ce que le driver PEUT demander ou
// ce que la protection moteur accepte), pas les sorties réelles. Un driver's
// wish max de 290 Nm sur un 75cv est normal — le limiteur clampe à la sortie.
const EXPECTED = {
  AccPed_trqEngHiGear_MAP: {
    dataUnit: 'Nm',
    dataRange: [-50, 350],                // driver's wish peut aller haut, limité ailleurs
    expectedMaxNm: { min: 150, max: 350 },
    rpmAxisRange: [350, 5500],
    description: 'Driver wish Hi gear — couple demandé à la pédale',
    allowFlat: false,                     // doit avoir un gradient (pas constant)
  },
  AccPed_trqEngLoGear_MAP: {
    dataUnit: 'Nm',
    dataRange: [-50, 350],
    expectedMaxNm: { min: 50, max: 350 },
    rpmAxisRange: [350, 5500],
    description: 'Driver wish Lo gear',
    allowFlat: false,
  },
  FMTC_trq2qBas_MAP: {
    dataUnit: 'mg/cyc',
    dataRange: [-5, 150],                 // peak cells peuvent atteindre 100+ mg/cyc
    expectedMaxMg: { min: 30, max: 150 },
    rpmAxisRange: [200, 5500],
    description: 'Conversion couple → injection',
    allowFlat: false,
  },
  Rail_pSetPointBase_MAP: {
    dataUnit: 'bar',                      // A2L: factor=100, unit=hPa. bar = hPa/1000 = raw*0.1
    dataRange: [0, 2000],
    expectedMaxBar: { min: 1000, max: 2000 },
    rpmAxisRange: [500, 5000],
    description: 'Consigne pression rail common-rail',
    allowFlat: false,
  },
  EngPrt_trqAPSLim_MAP: {
    dataUnit: 'Nm',
    dataRange: [0, 500],
    expectedMaxNm: { min: 150, max: 500 },
    description: 'Plafond couple protection turbo (souvent flat à ~400-450 Nm = safety ceiling jamais atteint)',
    allowFlat: true,                      // cette map EST flat par design sur Bosch EDC16
  },
};

function analyzeMap(romBuf, rel, expected) {
  const { address, name, dims, data: dataCfg, matchMode } = rel;
  const md = readMapData(romBuf, address);
  const dFactor = dataCfg.factor || 1;
  const dOffset = dataCfg.offset || 0;

  // Convert raw data to physical
  const physData = md.data.map(r => r * dFactor + dOffset);
  const physMin = Math.min(...physData);
  const physMax = Math.max(...physData);
  const physAvg = physData.reduce((s, v) => s + v, 0) / physData.length;

  // Convert rail hPa → bar for readability (1 bar = 1000 hPa)
  const dispUnit = expected.dataUnit === 'bar' ? 'bar' : expected.dataUnit;
  const dispMin = expected.dataUnit === 'bar' ? physMin / 1000 : physMin;
  const dispMax = expected.dataUnit === 'bar' ? physMax / 1000 : physMax;
  const dispAvg = expected.dataUnit === 'bar' ? physAvg / 1000 : physAvg;

  // Check data range
  const rangeOk = dispMin >= expected.dataRange[0] && dispMax <= expected.dataRange[1];
  const expectedMaxKey = Object.keys(expected).find(k => k.startsWith('expectedMax'));
  const expectedMax = expectedMaxKey ? expected[expectedMaxKey] : null;
  const maxOk = expectedMax ? (dispMax >= expectedMax.min && dispMax <= expectedMax.max) : true;

  // Check axes
  const rpmAxis = md.xAxis;
  const rpmOk = !expected.rpmAxisRange || (
    rpmAxis[0] >= expected.rpmAxisRange[0] - 100 &&
    rpmAxis[rpmAxis.length - 1] <= expected.rpmAxisRange[1] + 200
  );

  // Monotonic axes
  const rpmMono = rpmAxis.every((v, i) => i === 0 || v > rpmAxis[i - 1]);
  const yMono = md.yAxis.every((v, i) => i === 0 || v > md.yAxis[i - 1]);

  // Gradient check : map constante vs vraie cartographie
  const avg = physAvg;
  const stdDev = Math.sqrt(physData.reduce((s, v) => s + (v - avg) ** 2, 0) / physData.length);
  const coefVariation = avg !== 0 ? stdDev / Math.abs(avg) : 0;
  const isFlat = coefVariation < 0.01; // < 1 % de variation = constante
  const flatOk = expected.allowFlat || !isFlat;

  return {
    name,
    address: '0x' + address.toString(16).toUpperCase(),
    dims: `${md.nx}×${md.ny}`,
    matchMode,
    physMin: dispMin.toFixed(1),
    physMax: dispMax.toFixed(1),
    physAvg: dispAvg.toFixed(1),
    unit: dispUnit,
    rpm: `[${rpmAxis[0]}..${rpmAxis[rpmAxis.length - 1]}]`,
    coefVar: (coefVariation * 100).toFixed(1) + '%',
    isFlat,
    rpmOk, rpmMono, yMono, rangeOk, maxOk, flatOk,
    ok: rpmOk && rpmMono && yMono && rangeOk && maxOk && flatOk,
    expected,
  };
}

function run() {
  console.log('=' .repeat(75));
  console.log('open_damos coherence check — 1.6 HDi 75cv Berlingo (SW 1037383736)');
  console.log('=' .repeat(75));

  const damos = loadOpenDamos('edc16c34');
  const berBuf = fs.readFileSync(BERLINGO);
  const oriBuf = fs.readFileSync(ORI);

  const berRel = relocate(damos, berBuf);
  const oriRel = relocate(damos, oriBuf);
  const byNameBer = new Map(berRel.map(r => [r.name, r]));
  const byNameOri = new Map(oriRel.map(r => [r.name, r]));

  let allOk = true;
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const ber = byNameBer.get(name);
    const ori = byNameOri.get(name);
    if (!ber || ber.type === 'VALUE') continue;

    const analysisBer = analyzeMap(berBuf, ber, expected);
    const analysisOri = analyzeMap(oriBuf, ori, expected);

    console.log('');
    console.log(`── ${name}`);
    console.log(`   ${expected.description}`);
    console.log(`   Berlingo @ ${analysisBer.address}  dims=${analysisBer.dims}  match=${analysisBer.matchMode}`);
    console.log(`     data [min/avg/max] : ${analysisBer.physMin} / ${analysisBer.physAvg} / ${analysisBer.physMax} ${analysisBer.unit}`);
    console.log(`     rpm axis           : ${analysisBer.rpm}`);
    console.log(`   ori.BIN reference  @ ${analysisOri.address}`);
    console.log(`     data [min/avg/max] : ${analysisOri.physMin} / ${analysisOri.physAvg} / ${analysisOri.physMax} ${analysisOri.unit}`);

    // Verdict
    const checks = [];
    checks.push([analysisBer.rangeOk, `data dans ${expected.dataRange[0]}..${expected.dataRange[1]} ${analysisBer.unit}`]);
    if (expected.expectedMaxNm || expected.expectedMaxBar || expected.expectedMaxMg) {
      const e = expected.expectedMaxNm || expected.expectedMaxBar || expected.expectedMaxMg;
      checks.push([analysisBer.maxOk, `max entre ${e.min}..${e.max} ${analysisBer.unit}`]);
    }
    checks.push([analysisBer.rpmOk, `rpm axis ${expected.rpmAxisRange?.[0] || '?'}..${expected.rpmAxisRange?.[1] || '?'}`]);
    checks.push([analysisBer.rpmMono, 'rpm monotone']);
    checks.push([analysisBer.yMono, 'Y axis monotone']);
    checks.push([analysisBer.flatOk, analysisBer.isFlat
      ? `map ${expected.allowFlat ? 'plate (OK, flat by design = safety ceiling)' : '⚠ PLATE — suspecte, peut indiquer mauvais fingerprint'}`
      : `gradient ${analysisBer.coefVar}`]);
    for (const [ok, label] of checks) console.log(`     ${ok ? '✓' : '✗'} ${label}`);
    if (!analysisBer.ok) allOk = false;
  }

  console.log('\n' + '=' .repeat(75));
  console.log(allOk ? '✅ TOUTES LES MAPS SONT COHÉRENTES AVEC UN 1.6 HDi 75cv' : '❌ INCOHÉRENCES DÉTECTÉES — open_damos a fingerprinté une map incorrecte');
  console.log('=' .repeat(75));

  // ── Cross-firmware physical comparison ──────────────────────────────────────
  console.log('\n=== Comparaison Berlingo vs ori.BIN (valeurs physiques max) ===');
  for (const name of Object.keys(EXPECTED)) {
    const ber = byNameBer.get(name);
    const ori = byNameOri.get(name);
    if (!ber || !ori || ber.type === 'VALUE') continue;
    const b = analyzeMap(berBuf, ber, EXPECTED[name]);
    const o = analyzeMap(oriBuf, ori, EXPECTED[name]);
    const diff = ((parseFloat(b.physMax) - parseFloat(o.physMax)) / parseFloat(o.physMax) * 100).toFixed(1);
    console.log(`  ${name.padEnd(30)} max : Berlingo ${b.physMax} ${b.unit}  |  ori ${o.physMax}  |  Δ ${diff}%`);
  }
}

run();
