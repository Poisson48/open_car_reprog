// Regression test for a silent-fail bug : the Stage 1 addresses in
// src/ecu-catalog.js were wrong and pointed to padding (FF FF FF FF) in
// every available ROM. `applyPctToMap` threw "Invalid map dimensions",
// which the /stage1 endpoint swallowed per-map, returning 200 OK with
// empty diffs. Users never got a Stage 1. This test checks that each
// Stage 1 map address in the catalog reads a plausible map header from
// the reference ROM and that applyPctToMap changes real bytes.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { getEcu } = require('../src/ecu-catalog');
const { readMapData, applyPctToMap } = require('../src/rom-patcher');

const ORI = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');

function run() {
  const ecu = getEcu('edc16c34');
  assert(ecu, 'edc16c34 missing from catalog');
  assert(ecu.stage1Maps?.length === 5, 'Stage 1 doit déclarer 5 cartes');

  const rom = fs.readFileSync(ORI);
  console.log(`ROM: ${ORI} (${(rom.length / 1024 / 1024).toFixed(2)} MB)\n`);

  const failures = [];

  for (const m of ecu.stage1Maps) {
    try {
      const { nx, ny, xAxis, yAxis, data } = readMapData(rom, m.address);
      const addrHex = '0x' + m.address.toString(16).toUpperCase();

      // Plausibility : dimensions in range, axes monotonic
      assert(nx >= 2 && nx <= 64, `${m.name} @ ${addrHex}: nx=${nx} implausible`);
      assert(ny >= 2 && ny <= 64, `${m.name} @ ${addrHex}: ny=${ny} implausible`);
      const monoX = isMonotone(xAxis);
      const monoY = isMonotone(yAxis);
      assert(monoX, `${m.name} @ ${addrHex}: X axis not monotonic: ${xAxis.slice(0, 8).join(',')}…`);
      assert(monoY, `${m.name} @ ${addrHex}: Y axis not monotonic: ${yAxis.slice(0, 8).join(',')}…`);

      // applyPctToMap on a throwaway copy doit changer au moins 1 octet.
      const copy = Buffer.from(rom);
      const u8 = new Uint8Array(copy.buffer, copy.byteOffset, copy.byteLength);
      const changed = applyPctToMap(u8, m.address, m.defaultPct);
      assert(changed.length > 0, `${m.name}: applyPctToMap +${m.defaultPct}% n'a changé aucun octet (data=${data.slice(0, 8).join(',')}…)`);

      console.log(`  ✓ ${m.name.padEnd(28)} ${addrHex}  ${nx}×${ny}  +${m.defaultPct}% → ${changed.length} cells`);
    } catch (e) {
      failures.push({ map: m.name, address: m.address, error: e.message });
      console.log(`  ✗ ${m.name.padEnd(28)} 0x${m.address.toString(16).toUpperCase()}  ${e.message}`);
    }
  }

  if (failures.length) {
    console.error(`\n✗ ${failures.length}/${ecu.stage1Maps.length} Stage 1 maps failed:`);
    for (const f of failures) console.error(`    - ${f.map}: ${f.error}`);
    process.exit(1);
  }

  console.log(`\n✅ Stage 1 OK: ${ecu.stage1Maps.length}/${ecu.stage1Maps.length} maps valides sur ori.BIN`);

  // Popbang addresses should point to readable SWORDs (not padding).
  for (const [key, p] of Object.entries(ecu.popbangParams)) {
    const raw = (rom[p.address] << 8) | rom[p.address + 1];
    assert(raw !== 0xFFFF, `popbang ${key} @ 0x${p.address.toString(16).toUpperCase()} lit 0xFFFF (padding)`);
    console.log(`  ✓ popbang.${key.padEnd(8)} 0x${p.address.toString(16).toUpperCase()}  raw=0x${raw.toString(16).padStart(4, '0')}`);
  }

  // EGR OFF address doit aussi lire quelque chose de non-padding.
  const egr = ecu.autoModAddresses.find(a => a.id === 'egr_off');
  const egrRaw = (rom[egr.address] << 8) | rom[egr.address + 1];
  assert(egrRaw !== 0xFFFF, `egr_off @ 0x${egr.address.toString(16).toUpperCase()} lit 0xFFFF`);
  console.log(`  ✓ egr_off          0x${egr.address.toString(16).toUpperCase()}  raw=0x${egrRaw.toString(16).padStart(4, '0')} (sera patché à ${egr.bytes.map(b => b.toString(16)).join(' ')})`);
}

function isMonotone(arr) {
  if (arr.length < 2) return true;
  let incr = true, decr = true;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] <= arr[i - 1]) incr = false;
    if (arr[i] >= arr[i - 1]) decr = false;
  }
  return incr || decr;
}

run();
