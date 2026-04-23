// Map-Finder — détection heuristique de cartographies dans un ROM sans A2L.
//
// Algo (v1) : à chaque offset pair, interprète (nx, ny) comme UWORD BE.
// Si les deux sont dans [minN, maxN], lit les axes et les données aux offsets
// attendus par la convention Bosch (N_X → N_Y → axe X → axe Y → data).
// Les candidats sont filtrés par :
//   - axes strictement monotones (croissants ou décroissants)
//   - span axe minimal (évite les axes constants)
//   - données non-constantes (écart min < 5 → on rejette)
//
// Scoring (0..1) combine :
//   - smoothness : moyenne des diff adjacents rapportée au range total
//   - taille : favorise les formats classiques (8×8, 16×16, jusqu'à 32×32)
//
// Les candidats qui se chevauchent en mémoire sont dédupliqués (on garde le
// plus haut score). Le résultat est trié par score décroissant.
//
// Limites connues : ne détecte que les MAPs 2D (pas les CURVE 1D). Les
// valeurs sont interprétées en SWORD BE — ce qui couvre les RECORD_LAYOUT
// Kf_Xs16_Ys16_Ws16 / Kf_Xu16_Yu16_Wu16 où la signed-ness ne change pas
// la monotonie / la smoothness sur des plages petites.

const DEFAULT_OPTS = {
  minN: 4,
  maxN: 32,
  step: 2,
  minAxisSpan: 10,
  minDataRange: 5,
  limit: 100,
  overlapGap: 16,
};

function readU16BE(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}

function readS16BE(buf, off) {
  const v = readU16BE(buf, off);
  return v < 0x8000 ? v : v - 0x10000;
}

function checkMonotonic(values) {
  if (values.length < 2) return 0;
  let inc = true, dec = true;
  for (let i = 1; i < values.length; i++) {
    if (values[i] <= values[i - 1]) inc = false;
    if (values[i] >= values[i - 1]) dec = false;
    if (!inc && !dec) return 0;
  }
  return inc ? 1 : -1;
}

function computeBlockSize(nx, ny) {
  return 4 + 2 * nx + 2 * ny + 2 * nx * ny;
}

function scoreCandidate(buf, off, nx, ny) {
  const dataOff = off + 4 + 2 * nx + 2 * ny;

  let dmin = Infinity, dmax = -Infinity;
  const count = nx * ny;
  for (let i = 0; i < count; i++) {
    const v = readS16BE(buf, dataOff + i * 2);
    if (v < dmin) dmin = v;
    if (v > dmax) dmax = v;
  }
  const range = dmax - dmin;
  if (range < DEFAULT_OPTS.minDataRange) return null;

  // Smoothness: sum of abs adjacent diffs, both directions, normalized by range.
  let totalDiff = 0, diffCount = 0;
  for (let yi = 0; yi < ny; yi++) {
    for (let xi = 0; xi < nx - 1; xi++) {
      const a = readS16BE(buf, dataOff + (yi * nx + xi) * 2);
      const b = readS16BE(buf, dataOff + (yi * nx + xi + 1) * 2);
      totalDiff += Math.abs(a - b);
      diffCount++;
    }
  }
  for (let xi = 0; xi < nx; xi++) {
    for (let yi = 0; yi < ny - 1; yi++) {
      const a = readS16BE(buf, dataOff + (yi * nx + xi) * 2);
      const b = readS16BE(buf, dataOff + ((yi + 1) * nx + xi) * 2);
      totalDiff += Math.abs(a - b);
      diffCount++;
    }
  }
  const avgDiff = totalDiff / Math.max(1, diffCount);
  const smoothness = Math.max(0, Math.min(1, 1 - avgDiff / range));

  // Size preference: score peaks around nx+ny = 32 (16×16), tapers outside.
  const sizeSum = nx + ny;
  const sizePref = 1 - Math.min(1, Math.abs(sizeSum - 32) / 40);

  // Variance term: reward maps with a meaningful span relative to max SWORD.
  const variance = Math.min(1, range / 1000);

  const score = smoothness * 0.55 + sizePref * 0.2 + variance * 0.25;

  return {
    dataMin: dmin,
    dataMax: dmax,
    smoothness,
    sizePref,
    variance,
    score,
  };
}

function findMaps(buf, userOpts = {}) {
  const opts = { ...DEFAULT_OPTS, ...userOpts };
  const startOffset = Math.max(0, opts.startOffset | 0);
  const endOffset = Math.min(opts.endOffset ?? buf.length, buf.length);
  const minN = opts.minN | 0;
  const maxN = opts.maxN | 0;
  const step = Math.max(2, opts.step | 0);

  const raw = [];

  for (let off = startOffset; off < endOffset - 8; off += step) {
    const nx = readU16BE(buf, off);
    if (nx < minN || nx > maxN) continue;
    const ny = readU16BE(buf, off + 2);
    if (ny < minN || ny > maxN) continue;

    const blockSize = computeBlockSize(nx, ny);
    if (off + blockSize > endOffset) continue;

    // Axis X
    const axisXStart = off + 4;
    const axisX = new Array(nx);
    for (let i = 0; i < nx; i++) axisX[i] = readS16BE(buf, axisXStart + i * 2);
    const xDir = checkMonotonic(axisX);
    if (!xDir) continue;
    const xSpan = Math.abs(axisX[nx - 1] - axisX[0]);
    if (xSpan < opts.minAxisSpan) continue;

    // Axis Y
    const axisYStart = axisXStart + 2 * nx;
    const axisY = new Array(ny);
    for (let i = 0; i < ny; i++) axisY[i] = readS16BE(buf, axisYStart + i * 2);
    const yDir = checkMonotonic(axisY);
    if (!yDir) continue;
    const ySpan = Math.abs(axisY[ny - 1] - axisY[0]);
    if (ySpan < opts.minAxisSpan) continue;

    const scored = scoreCandidate(buf, off, nx, ny);
    if (!scored) continue;

    raw.push({
      address: off,
      nx, ny,
      blockSize,
      axisX: { min: Math.min(axisX[0], axisX[nx - 1]), max: Math.max(axisX[0], axisX[nx - 1]), dir: xDir },
      axisY: { min: Math.min(axisY[0], axisY[ny - 1]), max: Math.max(axisY[0], axisY[ny - 1]), dir: yDir },
      data: { min: scored.dataMin, max: scored.dataMax },
      smoothness: +scored.smoothness.toFixed(3),
      score: +scored.score.toFixed(3),
    });
  }

  // Deduplicate overlapping candidates — keep higher score.
  raw.sort((a, b) => b.score - a.score || a.address - b.address);
  const kept = [];
  for (const r of raw) {
    const rEnd = r.address + r.blockSize;
    let overlaps = false;
    for (const k of kept) {
      const kEnd = k.address + k.blockSize;
      if (!(rEnd + opts.overlapGap <= k.address || r.address >= kEnd + opts.overlapGap)) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) kept.push(r);
    if (kept.length >= opts.limit) break;
  }

  return kept;
}

module.exports = { findMaps };
