// Computes which A2L characteristics (maps / curves / values / val_blks) differ
// between two ROM buffers. Uses the A2L-declared region size to decide whether
// each characteristic overlaps a changed byte range.

function estimateRegionSize(c) {
  const xPts = c.axisDefs?.[0]?.maxAxisPoints || 0;
  const yPts = c.axisDefs?.[1]?.maxAxisPoints || 0;
  const valSize = c.byteSize || 2;
  const xAxisSize = c.axisDefs?.[0]?.byteSize || 2;
  const yAxisSize = c.axisDefs?.[1]?.byteSize || 2;

  switch (c.type) {
    case 'VALUE':   return valSize;
    case 'VAL_BLK': return (xPts || 1) * valSize || valSize;
    case 'CURVE':   return 2 + xPts * xAxisSize + xPts * valSize;
    case 'MAP':     return 4 + xPts * xAxisSize + yPts * yAxisSize + xPts * yPts * valSize;
    default:        return valSize;
  }
}

function diffIntervals(a, b) {
  const intervals = [];
  const minLen = Math.min(a.length, b.length);
  let i = 0;
  while (i < minLen) {
    if (a[i] !== b[i]) {
      const start = i;
      while (i < minLen && a[i] !== b[i]) i++;
      intervals.push([start, i]);
    } else {
      i++;
    }
  }
  if (a.length !== b.length) intervals.push([minLen, Math.max(a.length, b.length)]);
  return intervals;
}

// Samples a single changed cell (2-byte SWORD big-endian) for display.
function sampleChange(a, b, addr, size) {
  for (let off = 0; off + 1 < size; off += 2) {
    const i = addr + off;
    if (i + 1 >= a.length || i + 1 >= b.length) break;
    const ra = (a[i] << 8) | a[i + 1];
    const rb = (b[i] << 8) | b[i + 1];
    if (ra !== rb) {
      const sa = ra > 0x7FFF ? ra - 0x10000 : ra;
      const sb = rb > 0x7FFF ? rb - 0x10000 : rb;
      return { offset: off, before: sa, after: sb };
    }
  }
  return null;
}

// Counts how many SWORD cells differ inside the region.
function countDiffCells(a, b, addr, size) {
  let n = 0;
  for (let off = 0; off + 1 < size; off += 2) {
    const i = addr + off;
    if (i + 1 >= a.length || i + 1 >= b.length) break;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1]) n++;
  }
  return n;
}

function mapsChanged(bufA, bufB, characteristics) {
  const intervals = diffIntervals(bufA, bufB);
  if (!intervals.length) return { intervals: [], maps: [] };

  // Build sorted intervals for fast overlap check (they are already sorted).
  const results = [];
  const seen = new Set();

  for (const c of characteristics) {
    if (c.address === undefined || c.address === null) continue;
    const size = estimateRegionSize(c);
    if (size <= 0) continue;
    const cStart = c.address;
    const cEnd = c.address + size;

    // Linear scan — intervals sorted, can binary-search later if hot.
    let overlap = false;
    for (const [iStart, iEnd] of intervals) {
      if (iEnd <= cStart) continue;
      if (iStart >= cEnd) break;
      overlap = true;
      break;
    }
    if (!overlap) continue;
    if (seen.has(c.name)) continue;
    seen.add(c.name);

    results.push({
      name: c.name,
      type: c.type,
      address: c.address,
      size,
      unit: c.unit || '',
      description: (c.description || '').slice(0, 120),
      cellsChanged: countDiffCells(bufA, bufB, c.address, size),
      sample: sampleChange(bufA, bufB, c.address, size)
    });
  }

  // Sort: most cells changed first, then MAPs before CURVEs before VALUE.
  const typeWeight = { MAP: 3, CURVE: 2, VAL_BLK: 2, VALUE: 1 };
  results.sort((x, y) => {
    if (y.cellsChanged !== x.cellsChanged) return y.cellsChanged - x.cellsChanged;
    return (typeWeight[y.type] || 0) - (typeWeight[x.type] || 0);
  });

  return { intervals, maps: results };
}

module.exports = { mapsChanged, estimateRegionSize, diffIntervals };
