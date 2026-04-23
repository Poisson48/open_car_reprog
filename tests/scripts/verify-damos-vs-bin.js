// Vérifie la correspondance A2L <-> BIN : pour chaque caractéristique A2L
// avec une adresse et un RECORD_LAYOUT à header inline (nx/ny), on lit la
// ROM à l'adresse déclarée et on regarde si les dimensions sont plausibles.
//
// Usage: node tests/scripts/verify-damos-vs-bin.js [path/to/rom.bin]

const fs = require('fs');
const path = require('path');
const A2lParser = require('../../src/a2l-parser');
const { readSwordBE } = require('../../src/rom-patcher');

const BIN_PATH = process.argv[2] || path.join(__dirname, '..', '..', 'ressources', 'edc16c34', '9663944680.Bin');
const A2L_PATH = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', 'damos.a2l');
const CACHE_PATH = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', 'damos.cache.json');

console.log(`BIN : ${BIN_PATH}`);
console.log(`A2L : ${A2L_PATH}`);

const rom = fs.readFileSync(BIN_PATH);
console.log(`ROM size : ${(rom.length / 1024 / 1024).toFixed(2)} MB\n`);

let parsed;
if (fs.existsSync(CACHE_PATH)) {
  parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  console.log(`A2L (cache) : ${parsed.characteristics.length} characteristics, ${Object.keys(parsed.recordLayouts).length} record layouts\n`);
} else {
  parsed = new A2lParser().parse(A2L_PATH);
  console.log(`A2L (parsed) : ${parsed.characteristics.length} characteristics\n`);
}

function readUwordBE(buf, off) {
  if (off + 1 >= buf.length) return null;
  return (buf[off] << 8) | buf[off + 1];
}

// Layout a-t-il un header inline (NO_AXIS_PTS_X et NO_AXIS_PTS_Y) ?
function hasInlineHeader(rl) {
  if (!rl) return false;
  return rl.noAxisPtsX !== undefined || rl.noAxisPtsY !== undefined;
}

// Plausibilité du header
function plausibleDims(nx, ny, type) {
  if (type === 'VALUE' || type === 'VAL_BLK') return true;
  if (nx === null) return false;
  if (type === 'CURVE') return nx >= 2 && nx <= 64;
  if (type === 'MAP')   return nx >= 2 && nx <= 64 && ny >= 2 && ny <= 64;
  return false;
}

// Axe monotone ?
function isMonotone(arr) {
  if (arr.length < 2) return true;
  let incr = true, decr = true;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i-1]) incr = false;
    if (arr[i] >= arr[i-1]) decr = false;
  }
  return incr || decr;
}

// === Stats globales ==========================================================

const stats = {
  total: 0,
  withAddr: 0,
  mapInline: 0, mapInlineOk: 0,
  mapInlineAxisOk: 0,
  curveInline: 0, curveInlineOk: 0,
  value: 0, valueOk: 0,
  mapFixed: 0, mapFixedAxisOk: 0,
};

const problems = [];

for (const c of parsed.characteristics) {
  stats.total++;
  if (c.address === undefined || c.address === null) continue;
  stats.withAddr++;

  const rl = parsed.recordLayouts[c.recordLayout];
  if (!rl) continue;

  if (c.type === 'VALUE') {
    stats.value++;
    // On ne peut pas vraiment valider un VALUE sans connaître sa plage physique;
    // on regarde juste que la lecture ne tombe pas hors bornes.
    if (c.address + (c.byteSize || 2) <= rom.length) stats.valueOk++;
    continue;
  }

  if (c.type === 'MAP' && hasInlineHeader(rl)) {
    stats.mapInline++;
    const nx = readUwordBE(rom, c.address);
    const ny = readUwordBE(rom, c.address + 2);
    if (plausibleDims(nx, ny, 'MAP')) {
      stats.mapInlineOk++;
      // Vérif axes monotones (header = 4 bytes UWORD, axes SWORD)
      const xAxis = [];
      const yAxis = [];
      for (let i = 0; i < nx; i++) xAxis.push(readSwordBE(rom, c.address + 4 + i * 2));
      for (let i = 0; i < ny; i++) yAxis.push(readSwordBE(rom, c.address + 4 + nx * 2 + i * 2));
      if (isMonotone(xAxis) && isMonotone(yAxis)) stats.mapInlineAxisOk++;
    } else if (problems.length < 10) {
      problems.push({ name: c.name, type: 'MAP', address: c.address, nx, ny, layout: c.recordLayout });
    }
    continue;
  }

  if (c.type === 'CURVE' && hasInlineHeader(rl)) {
    stats.curveInline++;
    const nx = readUwordBE(rom, c.address);
    if (plausibleDims(nx, null, 'CURVE')) stats.curveInlineOk++;
    continue;
  }

  if (c.type === 'MAP' && !hasInlineHeader(rl)) {
    stats.mapFixed++;
    // Dimensions fixes via AXIS_DESCR.maxAxisPoints
    const nx = c.axisDefs?.[0]?.maxAxisPoints;
    const ny = c.axisDefs?.[1]?.maxAxisPoints;
    if (!nx || !ny) continue;
    // Pas de header, on vérifie juste que les axes (à une adresse COM_AXIS ou
    // collés aux data selon le layout) seraient monotones si on en devine
    // l'emplacement. Faute de mieux, on check juste que la zone ne sort pas
    // de la ROM et que la plage data n'est pas dégénérée (tout = 0xFF).
    const totalSize = nx * ny * 2; // simplification : data seule en SWORD
    if (c.address + totalSize > rom.length) continue;
    let zeros = 0, ffs = 0;
    for (let i = 0; i < Math.min(totalSize, 512); i++) {
      if (rom[c.address + i] === 0) zeros++;
      else if (rom[c.address + i] === 0xFF) ffs++;
    }
    const n = Math.min(totalSize, 512);
    if (zeros < n * 0.95 && ffs < n * 0.95) stats.mapFixedAxisOk++;
  }
}

// === Sanity sur les 5 maps Stage 1 du catalog (adresses hardcodées) =========

const CATALOG_STAGE1 = [
  { name: 'AccPed_trqEngHiGear_MAP', addr: 0x16D6C4 },
  { name: 'AccPed_trqEngLoGear_MAP', addr: 0x16DA04 },
  { name: 'FMTC_trq2qBas_MAP',       addr: 0x1760A4 },
  { name: 'Rail_pSetPointBase_MAP',  addr: 0x17A4A4 },
  { name: 'EngPrt_trqAPSLim_MAP',    addr: 0x1758E4 },
];

console.log('=== Adresses Stage 1 ========================================');
console.log('Nom                         | Catalog    | A2L        | Catalog header     | A2L header');
console.log('----------------------------+------------+------------+--------------------+-------------------');

const a2lByName = new Map(parsed.characteristics.map(c => [c.name, c]));
for (const s of CATALOG_STAGE1) {
  const c = a2lByName.get(s.name);
  const a2lAddr = c?.address;

  const catHead = (() => {
    const nx = readUwordBE(rom, s.addr);
    const ny = readUwordBE(rom, s.addr + 2);
    return `nx=${nx} ny=${ny}`;
  })();

  const a2lHead = a2lAddr !== undefined ? (() => {
    const nx = readUwordBE(rom, a2lAddr);
    const ny = readUwordBE(rom, a2lAddr + 2);
    return `nx=${nx} ny=${ny}`;
  })() : '—';

  console.log(
    s.name.padEnd(27) + ' | ' +
    ('0x' + s.addr.toString(16).toUpperCase()).padEnd(10) + ' | ' +
    (a2lAddr !== undefined ? '0x' + a2lAddr.toString(16).toUpperCase() : '—').padEnd(10) + ' | ' +
    catHead.padEnd(18) + ' | ' + a2lHead
  );
}

// === Résumé ==================================================================

console.log('\n=== Stats globales ==========================================');
console.log(`Total characteristics            : ${stats.total}`);
console.log(`  avec adresse                  : ${stats.withAddr}`);
console.log(`  VALUE                         : ${stats.value} (${stats.valueOk} OK = ${pct(stats.valueOk, stats.value)}%)`);
console.log(`  MAP inline header             : ${stats.mapInline}`);
console.log(`    dims plausibles             : ${stats.mapInlineOk} (${pct(stats.mapInlineOk, stats.mapInline)}%)`);
console.log(`    dims + axes monotones       : ${stats.mapInlineAxisOk} (${pct(stats.mapInlineAxisOk, stats.mapInline)}%)`);
console.log(`  CURVE inline header           : ${stats.curveInline} (${stats.curveInlineOk} OK = ${pct(stats.curveInlineOk, stats.curveInline)}%)`);
console.log(`  MAP layout fixe (no header)   : ${stats.mapFixed} (${stats.mapFixedAxisOk} non-dégénérées = ${pct(stats.mapFixedAxisOk, stats.mapFixed)}%)`);

if (problems.length) {
  console.log('\n=== Quelques MAPs avec header invalide ======================');
  for (const p of problems) {
    console.log(`  ${p.name} @ 0x${p.address.toString(16).toUpperCase()}  ${p.layout}  nx=${p.nx} ny=${p.ny}`);
  }
}

function pct(num, den) {
  if (!den) return '—';
  return (100 * num / den).toFixed(1);
}

// === Verdict =================================================================

console.log('\n=== Verdict ================================================');
const inlineRate = stats.mapInlineAxisOk / (stats.mapInline || 1);
const curveRate = stats.curveInlineOk / (stats.curveInline || 1);
const overall = (stats.mapInlineAxisOk + stats.curveInlineOk) / ((stats.mapInline + stats.curveInline) || 1);

if (overall >= 0.85) {
  console.log(`✅ A2L correspond au BIN (${(overall * 100).toFixed(1)}% des layouts inline valident)`);
} else if (overall >= 0.5) {
  console.log(`⚠️  Correspondance partielle (${(overall * 100).toFixed(1)}% valides) — firmware proche mais pas identique`);
} else {
  console.log(`❌ A2L ne correspond PAS au BIN (seulement ${(overall * 100).toFixed(1)}% des layouts inline valident)`);
}
