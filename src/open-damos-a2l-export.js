// Converts an open_damos.json (+ optional relocated addresses from a specific
// ROM) into an ASAP2 A2L text file. The output is a valid A2L that can be
// loaded by WinOLS, TunerPro, EcuFlash, open-car-reprog, and any ASAP2 1.6+
// compliant tool.
//
// Two modes :
//   - baseline (no ROM) : uses defaultAddress from the damos
//   - relocated (with ROM) : runs fingerprint relocation, uses the found
//     addresses so the A2L matches a specific firmware
//
// The A2L includes RECORD_LAYOUTs, COMPU_METHODs, CHARACTERISTICs with axes,
// and a short header crediting open_damos + ori.BIN as the reference source.

const { relocate } = require('./open-damos');

function indent(s, n = 2) {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => l ? pad + l : l).join('\n');
}

function hexAddr(a) {
  return '0x' + a.toString(16).toUpperCase().padStart(6, '0');
}

function quote(s) {
  return '"' + String(s).replace(/"/g, '\\"') + '"';
}

// COMPU_METHOD ID from factor/offset/unit — we dedupe so that multiple
// characteristics with the same linear conversion share one method.
function compuMethodIdFor(factor, offset, unit) {
  const k = `${factor}_${offset}_${unit || 'NONE'}`;
  return 'CM_' + k.replace(/[^A-Za-z0-9]/g, '_');
}

function renderCompuMethod(id, factor, offset, unit) {
  // ASAP2 RAT_FUNC coeffs : a*phys^2 + b*phys + c = (d*phys^2 + e*phys + f) * raw
  // For linear phys = raw * factor + offset → raw = (phys - offset) / factor
  // RAT_FUNC with a=0 d=0 e=0 : phys = (raw*f - c) / b → factor = f/b, offset = -c/b.
  // Simplest choice : b=1, c=-offset, f=factor.
  const b = 1, c = -offset, f = factor;
  const unitStr = unit || '-';
  return `/begin COMPU_METHOD ${id}
  ${quote('Linear conversion f=' + factor + ' offset=' + offset)}
  RAT_FUNC
  "%.3"
  ${quote(unitStr)}
  COEFFS 0 ${b} ${c} 0 0 ${f}
/end COMPU_METHOD`;
}

function renderRecordLayout(name, layout) {
  // Minimal layout declarations for the 3 types we emit. Numbers are the
  // positional order inside the block (1-based).
  if (layout.type === 'MAP') {
    return `/begin RECORD_LAYOUT ${name}
  NO_AXIS_PTS_X 1 UWORD
  NO_AXIS_PTS_Y 2 UWORD
  AXIS_PTS_X 3 SWORD INDEX_INCR DIRECT
  AXIS_PTS_Y 4 SWORD INDEX_INCR DIRECT
  FNC_VALUES 5 SWORD COLUMN_DIR DIRECT
/end RECORD_LAYOUT`;
  }
  if (layout.type === 'CURVE') {
    return `/begin RECORD_LAYOUT ${name}
  NO_AXIS_PTS_X 1 UWORD
  AXIS_PTS_X 2 SWORD INDEX_INCR DIRECT
  FNC_VALUES 3 SWORD COLUMN_DIR DIRECT
/end RECORD_LAYOUT`;
  }
  if (layout.type === 'VALUE') {
    return `/begin RECORD_LAYOUT ${name}
  FNC_VALUES 1 SWORD COLUMN_DIR DIRECT
/end RECORD_LAYOUT`;
  }
  throw new Error('Unknown layout type: ' + layout.type);
}

function renderCharacteristic(entry, addr, compuMap) {
  const name = entry.name;
  const desc = entry.description || name;
  const rl = entry.recordLayout;
  const d = entry.data || {};
  const minPhys = -32768 * (d.factor || 1) + (d.offset || 0);
  const maxPhys =  32767 * (d.factor || 1) + (d.offset || 0);
  const cmId = compuMethodIdFor(d.factor || 1, d.offset || 0, d.unit);

  if (entry.type === 'VALUE') {
    return `/begin CHARACTERISTIC ${name}
  ${quote(desc)}
  VALUE
  ${hexAddr(addr)}
  ${rl}
  0
  ${cmId}
  ${minPhys}
  ${maxPhys}
/end CHARACTERISTIC`;
  }

  // MAP / CURVE : include AXIS_DESCR per axis. Axis IQ/CM are generated on
  // the fly from the entry.axes metadata.
  const axes = entry.axes.map((a, i) => {
    const axCm = compuMethodIdFor(a.factor || 1, a.offset || 0, a.unit);
    const aMin = -32768 * (a.factor || 1) + (a.offset || 0);
    const aMax =  32767 * (a.factor || 1) + (a.offset || 0);
    const count = i === 0 ? entry.dims.nx : entry.dims.ny;
    return `/begin AXIS_DESCR STD_AXIS NO_INPUT_QUANTITY ${axCm} ${count} ${aMin} ${aMax} /end AXIS_DESCR`;
  }).join('\n');

  return `/begin CHARACTERISTIC ${name}
  ${quote(desc)}
  ${entry.type}
  ${hexAddr(addr)}
  ${rl}
  0
  ${cmId}
  ${minPhys}
  ${maxPhys}
${indent(axes, 2)}
/end CHARACTERISTIC`;
}

// Main entry point. Given an open_damos object + optionally a ROM buffer,
// returns an A2L file as a string.
function exportA2l(damos, romBuf, opts = {}) {
  const header = [
    `ASAP2_VERSION 1 60`,
    `/begin PROJECT OPEN_DAMOS ${quote(damos.name || 'open_damos')}`,
    `  /begin HEADER ${quote(damos.description || '')}`,
    `    VERSION ${quote(damos.version || '1.0.0')}`,
    `    PROJECT_NO ${quote('open_damos-' + damos.ecu)}`,
    `  /end HEADER`,
    `  /begin MODULE ${damos.ecu.toUpperCase()} ${quote('ECU module')}`,
    '',
  ];

  const footer = [
    '',
    `  /end MODULE`,
    `/end PROJECT`,
  ];

  // Resolve addresses : baseline (from damos) or relocated from ROM
  let addressResolver;
  let relocInfo = null;
  if (romBuf) {
    const relocated = relocate(damos, romBuf, opts);
    relocInfo = relocated;
    const byName = new Map(relocated.map(r => [r.name, r]));
    addressResolver = (entry) => {
      const r = byName.get(entry.name);
      return r ? r.address : parseInt(entry.defaultAddress, 16);
    };
  } else {
    addressResolver = (entry) => parseInt(entry.defaultAddress, 16);
  }

  // Emit RECORD_LAYOUTs (dedup)
  const layouts = new Set();
  for (const c of damos.characteristics) layouts.add(c.recordLayout);
  const recordLayoutsSection = [...layouts].map(name => {
    const spec = damos.recordLayouts?.[name] || { type: c.type };
    return indent(renderRecordLayout(name, spec), 4);
  }).join('\n\n');

  // Emit COMPU_METHODs (dedup)
  const compuMethods = new Map(); // id -> string
  for (const c of damos.characteristics) {
    const d = c.data || {};
    const dId = compuMethodIdFor(d.factor || 1, d.offset || 0, d.unit);
    if (!compuMethods.has(dId)) compuMethods.set(dId, renderCompuMethod(dId, d.factor || 1, d.offset || 0, d.unit));
    if (c.axes) {
      for (const a of c.axes) {
        const aId = compuMethodIdFor(a.factor || 1, a.offset || 0, a.unit);
        if (!compuMethods.has(aId)) compuMethods.set(aId, renderCompuMethod(aId, a.factor || 1, a.offset || 0, a.unit));
      }
    }
  }
  const compuMethodsSection = [...compuMethods.values()].map(s => indent(s, 4)).join('\n\n');

  // Emit CHARACTERISTICs
  const characteristicsSection = damos.characteristics.map(c => {
    const addr = addressResolver(c);
    return indent(renderCharacteristic(c, addr), 4);
  }).join('\n\n');

  // Assemble
  const parts = [
    header.join('\n'),
    '    /* ── RECORD_LAYOUTs ─────────────────────────────────── */',
    recordLayoutsSection,
    '',
    '    /* ── COMPU_METHODs ──────────────────────────────────── */',
    compuMethodsSection,
    '',
    '    /* ── CHARACTERISTICs ───────────────────────────────── */',
    characteristicsSection,
    footer.join('\n'),
  ];
  const a2l = parts.join('\n') + '\n';

  return { a2l, relocation: relocInfo };
}

module.exports = { exportA2l };
