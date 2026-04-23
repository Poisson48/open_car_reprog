// Verifies open_damos relocation works end-to-end on both the reference
// ROM (ori.BIN — should all match defaults, score 1.00) AND on a foreign
// firmware (9663944680.Bin — Berlingo 1.6 HDi 75cv PSA, where addresses
// are shifted). Regression guard : Stage 1 maps must relocate correctly
// so `applyPctToMap` succeeds on both ROMs.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadOpenDamos, relocate } = require('../src/open-damos');
const { applyPctToMap } = require('../src/rom-patcher');

const ORI = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');
const BERLINGO = path.join(__dirname, '..', 'ressources', 'edc16c34', '9663944680.Bin');

const STAGE1 = [
  'AccPed_trqEngHiGear_MAP',
  'AccPed_trqEngLoGear_MAP',
  'FMTC_trq2qBas_MAP',
  'Rail_pSetPointBase_MAP',
  'EngPrt_trqAPSLim_MAP',
];

function run() {
  const damos = loadOpenDamos('edc16c34');
  assert(damos, 'open_damos not found');
  assert(damos.characteristics.length >= 10, 'expected ≥10 characteristics');

  // ── Test 1 : ori.BIN → all match defaults ──
  {
    const buf = fs.readFileSync(ORI);
    const result = relocate(damos, buf);
    console.log(`ori.BIN: ${result.length} entries relocated`);
    for (const e of result) {
      assert(e.addressSource === 'fingerprint' || e.addressSource === 'anchor',
        `ori: ${e.name} fell back to ${e.addressSource} (should match default)`);
      assert(e.delta === 0, `ori: ${e.name} delta=${e.delta}, expected 0`);
    }
    console.log('  ✓ Tous les entries à delta=0 (baseline preservée)');
  }

  // ── Test 2 : Berlingo → Stage 1 MAPs relocated and patching works ──
  {
    const buf = Buffer.from(fs.readFileSync(BERLINGO));
    const result = relocate(damos, buf);
    console.log(`\n9663944680.Bin (Berlingo): ${result.length} entries relocated`);

    const byName = new Map(result.map(r => [r.name, r]));
    for (const name of STAGE1) {
      const r = byName.get(name);
      assert(r, `Berlingo: ${name} missing from relocation`);
      assert(r.addressSource === 'fingerprint',
        `Berlingo: ${name} fell back to ${r.addressSource} (should use fingerprint)`);
      assert(r.score >= 0.7, `Berlingo: ${name} score=${r.score.toFixed(2)} too low`);

      // applyPctToMap doit réussir et changer des octets
      const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const changed = applyPctToMap(u8, r.address, 10);
      assert(changed.length > 0, `Berlingo: ${name} @0x${r.address.toString(16).toUpperCase()} a 0 octets changés à +10%`);
      console.log(`  ✓ ${name.padEnd(28)} @ 0x${r.address.toString(16).toUpperCase()} Δ=${r.delta>=0?'+':''}${r.delta} score=${r.score.toFixed(2)} (${r.matchMode}) → +10% = ${changed.length} cells`);
    }
  }

  // ── Test 3 : unknown ROM (random bytes) → mostly default-fallback ──
  {
    const buf = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 131) & 0xFF;
    const result = relocate(damos, buf);
    const fingerprinted = result.filter(r => r.addressSource === 'fingerprint').length;
    console.log(`\nRandom ROM: ${fingerprinted}/${result.length} fingerprinted (expected ≤ 2 by pure luck)`);
    assert(fingerprinted <= 2, `Too many false positives on random data: ${fingerprinted}`);
    console.log('  ✓ Pas de faux positif systématique sur data aléatoire');
  }

  console.log('\n✅ open_damos relocation OK sur ori.BIN + Berlingo + random-data negative-test');
}

run();
