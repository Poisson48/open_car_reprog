// Offline forensic analysis of EDC16C34 ROM structure.
// Uses the three reference ROMs in ressources/ to locate candidate checksum
// tables, byte regions invariant across tunes (→ likely code), and byte
// regions that vary (→ calibration / checksum slots themselves).
//
// Usage: node tests/scripts/analyze-checksums.js

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'ressources', 'edc16c34');
const files = [
  'ori.BIN',
  '9663944680.Bin',
  '1.7bar boost, Launch Control 2500, Popcorn 4400, 185hp 410nm'
];

const buffers = files.map(f => fs.readFileSync(path.join(DIR, f)));
const [ori, b2, tune] = buffers;

console.log('=== File sizes ===');
buffers.forEach((b, i) => console.log(`  ${files[i].slice(0, 50).padEnd(52)} ${b.length} bytes`));

if (!buffers.every(b => b.length === ori.length)) {
  console.log('WARNING: sizes differ — aborting'); process.exit(1);
}

// ── 1. High-address scan: find 32-bit pairs (X, ~X) in the last 8KB ────────────
// EDC16 Bosch typically stores checksums as big-endian pairs (sum, ~sum)
// at fixed tables near the end of flash or in a known calibration header.

function readU32BE(buf, off) {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function findInversePairs(buf, startOff, endOff) {
  const hits = [];
  for (let off = startOff; off + 8 <= endOff; off += 4) {
    const a = readU32BE(buf, off);
    const b = readU32BE(buf, off + 4);
    if (a !== 0 && a !== 0xFFFFFFFF && ((a + b) >>> 0) === 0xFFFFFFFF) {
      hits.push({ off, a, b });
    }
  }
  return hits;
}

console.log('\n=== Inverse-pair scan (X, ~X) in last 16 KB of each ROM ===');
for (let i = 0; i < buffers.length; i++) {
  const hits = findInversePairs(buffers[i], buffers[i].length - 16 * 1024, buffers[i].length - 4);
  console.log(`\n[${files[i].slice(0, 40)}] ${hits.length} pairs found`);
  hits.slice(0, 20).forEach(h => {
    console.log(`  0x${h.off.toString(16).toUpperCase().padStart(5, '0')}  ${h.a.toString(16).toUpperCase().padStart(8, '0')}  ~${h.b.toString(16).toUpperCase().padStart(8, '0')}`);
  });
}

// ── 2. Bytes that differ between the three ROMs (→ calibration / checksum slots)
console.log('\n=== Regions where ori ↔ 9663944680 differ in last 16 KB ===');
{
  const start = ori.length - 16 * 1024;
  let runs = [];
  let i = start;
  while (i < ori.length) {
    if (ori[i] !== b2[i]) {
      const s = i;
      while (i < ori.length && ori[i] !== b2[i]) i++;
      runs.push({ start: s, end: i, len: i - s });
    } else i++;
  }
  runs.slice(0, 40).forEach(r => {
    console.log(`  0x${r.start.toString(16).padStart(5, '0')}..0x${r.end.toString(16).padStart(5, '0')}  (${r.len} bytes)`);
  });
  console.log(`  total runs: ${runs.length}`);
}

// ── 3. Bytes identical across ALL three (→ very likely code / fixed strings) ──
console.log('\n=== Count of bytes identical in ALL three ROMs, per 64KB bucket ===');
{
  const bucket = 64 * 1024;
  for (let b = 0; b < ori.length; b += bucket) {
    let same = 0;
    for (let i = b; i < Math.min(b + bucket, ori.length); i++) {
      if (ori[i] === buffers[1][i] && ori[i] === buffers[2][i]) same++;
    }
    const pct = (same * 100 / bucket).toFixed(1);
    console.log(`  0x${b.toString(16).padStart(6, '0')}  ${same.toString().padStart(5)} / ${bucket}  (${pct}%)`);
  }
}

// ── 4. Scan whole ROM for inverse-pair structures matching the pattern
//    [ start32, end32, sum32, ~sum32 ] — 16-byte checksum entries
console.log('\n=== Candidate 16-byte checksum entries in ori.BIN ===');
{
  const hits = [];
  for (let off = 0; off + 16 <= ori.length; off += 4) {
    const start = readU32BE(ori, off);
    const end = readU32BE(ori, off + 4);
    const sum = readU32BE(ori, off + 8);
    const inv = readU32BE(ori, off + 12);
    if (
      start < end &&
      end <= ori.length &&
      (end - start) >= 0x100 &&
      (end - start) <= ori.length &&
      ((sum + inv) >>> 0) === 0xFFFFFFFF &&
      sum !== 0 && sum !== 0xFFFFFFFF
    ) {
      hits.push({ off, start, end, len: end - start, sum, inv });
    }
  }
  hits.slice(0, 30).forEach(h => {
    console.log(`  @0x${h.off.toString(16).toUpperCase().padStart(5, '0')}  range 0x${h.start.toString(16).toUpperCase().padStart(5, '0')}..0x${h.end.toString(16).toUpperCase().padStart(5, '0')} (${h.len} B)  sum=0x${h.sum.toString(16).toUpperCase().padStart(8, '0')}`);
  });
  console.log(`  total hits: ${hits.length}`);

  // Verify by recomputing a candidate
  if (hits.length > 0) {
    console.log('\n--- Recompute sum for top candidates ---');
    for (const h of hits.slice(0, 5)) {
      let s32 = 0;
      for (let i = h.start; i + 4 <= h.end; i += 4) s32 = (s32 + readU32BE(ori, i)) >>> 0;
      const match = s32 === h.sum ? '✓ 32-bit word sum matches' : `✗ got 0x${s32.toString(16)}`;
      console.log(`  @0x${h.off.toString(16)}  ${match}`);
      if (s32 !== h.sum) {
        // Try byte-sum
        let sByte = 0;
        for (let i = h.start; i < h.end; i++) sByte = (sByte + ori[i]) >>> 0;
        console.log(`    byte-sum: 0x${sByte.toString(16)}`);
        // Try u16-sum
        let s16 = 0;
        for (let i = h.start; i + 2 <= h.end; i += 2) s16 = (s16 + ((ori[i] << 8) | ori[i + 1])) >>> 0;
        console.log(`    u16-sum:  0x${s16.toString(16)}`);
      }
    }
  }
}
