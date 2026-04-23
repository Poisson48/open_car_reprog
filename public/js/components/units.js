// Per-project unit preferences (Nm ↔ lb·ft, °C ↔ °F).
// Conversion is purely display-level: values stored on disk stay in the A2L
// physical unit. When a user types into a cell, we convert back before
// writing to the ROM.

const NM_TO_LBFT = 0.7375621493;
const LBFT_TO_NM = 1 / NM_TO_LBFT;

const TORQUE_UNIT_RE = /^(Nm|N\.?m|newton.*m)/i;
const TEMP_UNIT_RE = /^(°?\s*C|deg.?C|celsius)/i;

export function kindOfUnit(a2lUnit) {
  if (!a2lUnit) return null;
  if (TORQUE_UNIT_RE.test(a2lUnit.trim())) return 'torque';
  if (TEMP_UNIT_RE.test(a2lUnit.trim())) return 'temp';
  return null;
}

// Convert an A2L-physical value to the display system defined by prefs.
export function toDisplay(physValue, a2lUnit, prefs) {
  const kind = kindOfUnit(a2lUnit);
  if (kind === 'torque' && prefs?.torque === 'lb_ft') return physValue * NM_TO_LBFT;
  if (kind === 'temp' && prefs?.temp === 'F') return physValue * 9 / 5 + 32;
  return physValue;
}

// Inverse conversion: display value → A2L physical.
export function fromDisplay(displayValue, a2lUnit, prefs) {
  const kind = kindOfUnit(a2lUnit);
  if (kind === 'torque' && prefs?.torque === 'lb_ft') return displayValue * LBFT_TO_NM;
  if (kind === 'temp' && prefs?.temp === 'F') return (displayValue - 32) * 5 / 9;
  return displayValue;
}

// Return the label a user would see for this A2L unit under given prefs.
export function displayUnit(a2lUnit, prefs) {
  const kind = kindOfUnit(a2lUnit);
  if (kind === 'torque' && prefs?.torque === 'lb_ft') return 'lb·ft';
  if (kind === 'temp' && prefs?.temp === 'F') return '°F';
  return a2lUnit;
}
