// ROM patching utilities for Kf_Xs16_Ys16_Ws16 layout (EDC16C34 / Bosch)
// Layout at address A (all SWORD, big-endian):
//   A+0           : nx (number of X axis points)
//   A+2           : ny (number of Y axis points)
//   A+4           : X axis values [nx × SWORD]
//   A+4+nx*2      : Y axis values [ny × SWORD]
//   A+4+nx*2+ny*2 : data values   [nx × ny × SWORD]

const SWORD_MAX = 32767;
const SWORD_MIN = -32768;

function readSwordBE(buf, off) {
  const v = (buf[off] << 8) | buf[off + 1];
  return v > SWORD_MAX ? v - 65536 : v;
}

function writeSwordBE(buf, off, value) {
  const v = Math.max(SWORD_MIN, Math.min(SWORD_MAX, Math.round(value)));
  const u = v < 0 ? v + 65536 : v;
  buf[off]     = (u >> 8) & 0xFF;
  buf[off + 1] = u & 0xFF;
}

function readMapDimensions(rom, address) {
  const nx = readSwordBE(rom, address);
  const ny = readSwordBE(rom, address + 2);
  if (nx <= 0 || ny <= 0 || nx > 64 || ny > 64) {
    throw new Error(`Invalid map dimensions nx=${nx} ny=${ny} at 0x${address.toString(16).toUpperCase()}`);
  }
  const xAxisOff  = address + 4;
  const yAxisOff  = xAxisOff + nx * 2;
  const dataOff   = yAxisOff + ny * 2;
  return { nx, ny, xAxisOff, yAxisOff, dataOff };
}

function readMapData(rom, address) {
  const dims = readMapDimensions(rom, address);
  const { nx, ny, xAxisOff, yAxisOff, dataOff } = dims;

  const xAxis = Array.from({ length: nx }, (_, i) => readSwordBE(rom, xAxisOff + i * 2));
  const yAxis = Array.from({ length: ny }, (_, i) => readSwordBE(rom, yAxisOff + i * 2));
  const data  = Array.from({ length: nx * ny }, (_, i) => readSwordBE(rom, dataOff + i * 2));

  return { nx, ny, xAxis, yAxis, data, dataOff };
}

// Apply a percentage change to all positive data values in a map
// negativeValues stay untouched (represent drag/braking — do not scale)
function applyPctToMap(rom, address, pct, { onlyPositive = true, rawMin = SWORD_MIN, rawMax = SWORD_MAX } = {}) {
  const { nx, ny, data, dataOff } = readMapData(rom, address);
  const factor = 1 + pct / 100;
  const changed = [];

  for (let i = 0; i < data.length; i++) {
    const raw = data[i];
    if (onlyPositive && raw <= 0) continue;
    const newRaw = Math.max(rawMin, Math.min(rawMax, Math.round(raw * factor)));
    if (newRaw !== raw) {
      writeSwordBE(rom, dataOff + i * 2, newRaw);
      changed.push({ offset: dataOff + i * 2, old: raw, new: newRaw });
    }
  }

  return changed;
}

// Read/write a single SWORD VALUE parameter
function readValue(rom, address) {
  return readSwordBE(rom, address);
}

function writeValue(rom, address, rawValue) {
  writeSwordBE(rom, address, rawValue);
}

module.exports = { readMapData, applyPctToMap, readValue, writeValue, readSwordBE, writeSwordBE };
