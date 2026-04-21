const fs = require('fs');

// Data type sizes in bytes
const DATA_TYPE_SIZE = {
  UBYTE: 1, SBYTE: 1,
  UWORD: 2, SWORD: 2,
  ULONG: 4, SLONG: 4,
  FLOAT32_IEEE: 4,
  FLOAT64_IEEE: 8,
  A_UINT64: 8, A_INT64: 8
};

class A2lParser {
  parse(filePath) {
    console.log('[A2L] Reading file...');
    let content = fs.readFileSync(filePath, 'utf8');

    console.log('[A2L] Removing comments...');
    content = content.replace(/\/\*[\s\S]*?\*\//g, ' ');

    console.log('[A2L] Tokenizing...');
    const tokens = this._tokenize(content);

    console.log(`[A2L] Parsing ${tokens.length} tokens...`);
    const result = this._parse(tokens);

    console.log(`[A2L] Done: ${result.characteristics.length} characteristics, ${Object.keys(result.recordLayouts).length} record layouts, ${Object.keys(result.compuMethods).length} compu methods`);
    return result;
  }

  _tokenize(content) {
    const tokens = [];
    // Match /begin, /end, quoted strings, hex numbers, numbers, identifiers
    const re = /\/begin|\/end|"(?:[^"\\]|\\.)*"|-?0[xX][0-9a-fA-F]+|-?\d+\.?\d*(?:[eE][+-]?\d+)?|[^\s"\/\t\n\r]+/g;

    for (const m of content.matchAll(re)) {
      const tok = m[0];
      if (tok === '/begin') {
        tokens.push({ t: 'B' });
      } else if (tok === '/end') {
        tokens.push({ t: 'E' });
      } else if (tok[0] === '"') {
        tokens.push({ t: 'S', v: tok.slice(1, -1) });
      } else if (tok.startsWith('0x') || tok.startsWith('0X')) {
        tokens.push({ t: 'H', v: parseInt(tok, 16) });
      } else if (/^-?\d/.test(tok)) {
        const n = parseFloat(tok);
        tokens.push({ t: 'N', v: isNaN(n) ? tok : n });
      } else {
        tokens.push({ t: 'I', v: tok });
      }
    }

    return tokens;
  }

  _parse(tokens) {
    const result = {
      characteristics: [],
      recordLayouts: {},
      compuMethods: {},
      axisPts: {},
      compuVtabs: {}
    };

    let i = 0;
    const n = tokens.length;

    const peek = () => tokens[i];
    const consume = () => tokens[i++];
    const val = () => consume()?.v;
    const numVal = () => { const t = consume(); return t ? (t.t === 'H' ? t.v : parseFloat(t.v)) : 0; };

    const skipBlock = () => {
      let depth = 1;
      while (i < n && depth > 0) {
        const t = consume();
        if (t?.t === 'B') depth++;
        else if (t?.t === 'E') { depth--; if (depth === 0) consume(); }
      }
    };

    const skipUntilEndOrBegin = () => {
      while (i < n) {
        const t = peek();
        if (t?.t === 'E' || t?.t === 'B') return;
        consume();
      }
    };

    const parseAxisDescr = () => {
      // ASAP2 order: Attribute InputQuantity Conversion MaxAxisPoints LowerLimit UpperLimit
      const descr = {
        attribute: val(),       // STD_AXIS | COM_AXIS | FIX_AXIS | RES_AXIS | CURVE_AXIS
        inputQuantity: val(),   // measurement name or NO_INPUT_QUANTITY
        conversion: val(),      // compu method name
        maxAxisPoints: numVal(),
        lowerLimit: numVal(),
        upperLimit: numVal()
      };

      while (i < n) {
        const t = peek();
        if (t?.t === 'E') { consume(); consume(); break; }
        if (t?.t === 'B') { consume(); const sub = val(); skipBlock(); continue; }
        const kw = val();
        if (kw === 'LOWER_LIMIT') descr.lowerLimit = numVal();
        else if (kw === 'UPPER_LIMIT') descr.upperLimit = numVal();
        else if (kw === 'AXIS_PTS_REF') descr.axisPtsRef = val();
        else if (kw === 'FIX_AXIS_PAR') {
          descr.fixAxisOffset = numVal();
          descr.fixAxisShift = numVal();
          descr.fixAxisCount = numVal();
        } else if (kw === 'FIX_AXIS_PAR_LIST') {
          descr.fixAxisList = [];
          while (i < n && peek()?.t !== 'E' && peek()?.t !== 'B' && peek()?.t !== 'I') {
            descr.fixAxisList.push(numVal());
          }
        }
      }
      return descr;
    };

    const parseCharacteristic = () => {
      const c = {
        name: val(),
        description: val(),
        type: val(),
        address: numVal(),
        recordLayout: val(),
        maxDiff: numVal(),
        conversion: val(),
        lowerLimit: numVal(),
        upperLimit: numVal(),
        axisDefs: []
      };

      while (i < n) {
        const t = peek();
        if (t?.t === 'E') { consume(); consume(); break; }
        if (t?.t === 'B') {
          consume();
          const sub = val();
          if (sub === 'AXIS_DESCR') c.axisDefs.push(parseAxisDescr());
          else skipBlock();
          continue;
        }
        const kw = val();
        if (kw === 'BYTE_ORDER') c.byteOrder = val();
        else if (kw === 'BIT_MASK') c.bitMask = val();
        else if (kw === 'FORMAT') c.format = val();
        else if (kw === 'PHYS_UNIT') c.unit = val();
        else if (kw === 'NUMBER') c.number = numVal();
        // Skip unknown keywords that might have a value
      }
      return c;
    };

    const parseRecordLayout = () => {
      const rl = { name: val(), fncValues: null, axisX: null, axisY: null, byteOrder: 'BIG_ENDIAN' };

      while (i < n) {
        const t = peek();
        if (t?.t === 'E') { consume(); consume(); break; }
        if (t?.t === 'B') { consume(); skipBlock(); continue; }
        const kw = val();
        if (kw === 'FNC_VALUES') {
          rl.fncValues = { position: numVal(), dataType: val(), indexMode: val(), addrType: val() };
        } else if (kw === 'AXIS_PTS_X') {
          rl.axisX = { position: numVal(), dataType: val(), indexMode: val(), addrType: val() };
        } else if (kw === 'AXIS_PTS_Y') {
          rl.axisY = { position: numVal(), dataType: val(), indexMode: val(), addrType: val() };
        } else if (kw === 'NO_AXIS_PTS_X') {
          rl.noAxisPtsX = { position: numVal(), dataType: val() };
        } else if (kw === 'NO_AXIS_PTS_Y') {
          rl.noAxisPtsY = { position: numVal(), dataType: val() };
        } else if (kw === 'BYTE_ORDER') {
          rl.byteOrder = val();
        }
      }
      return rl;
    };

    const parseCompuMethod = () => {
      const cm = {
        name: val(),
        description: val(),
        conversionType: val(),
        format: val(),
        unit: val()
      };

      while (i < n) {
        const t = peek();
        if (t?.t === 'E') { consume(); consume(); break; }
        if (t?.t === 'B') {
          consume();
          const sub = val();
          if (sub === 'COEFFS') {
            cm.coeffs = {
              a: numVal(), b: numVal(), c: numVal(),
              d: numVal(), e: numVal(), f: numVal()
            };
          } else {
            skipBlock();
          }
          continue;
        }
        const kw = val();
        if (kw === 'COEFFS') {
          cm.coeffs = {
            a: numVal(), b: numVal(), c: numVal(),
            d: numVal(), e: numVal(), f: numVal()
          };
        } else if (kw === 'COMPU_TAB_REF') {
          cm.compuTabRef = val();
        } else if (kw === 'STATUS_STRING_REF') {
          cm.statusStringRef = val();
        }
      }
      return cm;
    };

    const parseAxisPts = () => {
      const ap = {
        name: val(),
        description: val(),
        address: numVal(),
        inputQuantity: val(),
        recordLayout: val(),
        maxDiff: numVal(),
        conversion: val(),
        maxAxisPoints: numVal(),
        lowerLimit: numVal(),
        upperLimit: numVal()
      };

      while (i < n) {
        const t = peek();
        if (t?.t === 'E') { consume(); consume(); break; }
        if (t?.t === 'B') { consume(); skipBlock(); continue; }
        const kw = val();
        if (kw === 'BYTE_ORDER') ap.byteOrder = val();
      }
      return ap;
    };

    const parseCompuVtab = () => {
      const vt = { name: val(), description: val(), conversionType: val(), numberValuePairs: numVal(), pairs: [] };
      while (i < n) {
        const t = peek();
        if (t?.t === 'E') { consume(); consume(); break; }
        if (t?.t === 'B') { consume(); skipBlock(); continue; }
        // Pairs of (numeric, string)
        const a = peek();
        if (a?.t === 'N' || a?.t === 'H') {
          const k = numVal();
          const v2 = val();
          vt.pairs.push({ key: k, value: v2 });
        } else { consume(); }
      }
      return vt;
    };

    // Parse any block by name, dispatching to specialized handlers or recursing
    const parseBlock = (blockName) => {
      switch (blockName) {
        case 'CHARACTERISTIC': {
          const c = parseCharacteristic();
          if (c.name && c.address !== undefined) result.characteristics.push(c);
          break;
        }
        case 'RECORD_LAYOUT': {
          const rl = parseRecordLayout();
          if (rl.name) result.recordLayouts[rl.name] = rl;
          break;
        }
        case 'COMPU_METHOD': {
          const cm = parseCompuMethod();
          if (cm.name) result.compuMethods[cm.name] = cm;
          break;
        }
        case 'AXIS_PTS': {
          const ap = parseAxisPts();
          if (ap.name) result.axisPts[ap.name] = ap;
          break;
        }
        case 'COMPU_VTAB':
        case 'COMPU_VTAB_RANGE': {
          const vt = parseCompuVtab();
          if (vt.name) result.compuVtabs[vt.name] = vt;
          break;
        }
        // Container blocks: recurse into children
        case 'PROJECT':
        case 'MODULE':
        case 'IF_DATA': {
          // For IF_DATA skip the entire block; for others recurse
          if (blockName === 'IF_DATA') { skipBlock(); break; }
          // Skip any inline tokens until child BEGIN/END
          while (i < n) {
            const t = peek();
            if (t?.t === 'E') { consume(); consume(); break; } // /end BLOCK_NAME
            if (t?.t === 'B') { consume(); parseBlock(val()); continue; }
            consume(); // skip inline identifier tokens (block name argument etc.)
          }
          break;
        }
        default:
          skipBlock();
      }
    };

    // Main parse loop
    while (i < n) {
      const t = consume();
      if (t?.t !== 'B') continue;
      parseBlock(val());
    }

    // Enrich characteristics with resolved type info
    this._enrich(result);

    return result;
  }

  _enrich(result) {
    const { characteristics, recordLayouts, compuMethods, axisPts } = result;

    for (const c of characteristics) {
      const rl = recordLayouts[c.recordLayout];
      const cm = compuMethods[c.conversion];

      // Resolve data type and byte order
      if (rl?.fncValues) {
        c.dataType = rl.fncValues.dataType;
        c.byteSize = DATA_TYPE_SIZE[c.dataType] || 2;
      } else {
        // Infer from record layout name convention: Kw_Ws16 → s16 → SWORD
        c.dataType = this._inferDataType(c.recordLayout);
        c.byteSize = DATA_TYPE_SIZE[c.dataType] || 2;
      }

      c.byteOrder = c.byteOrder || rl?.byteOrder || 'BIG_ENDIAN';

      // Resolve conversion
      if (cm) {
        c.conversionType = cm.conversionType;
        c.unit = c.unit || cm.unit;
        if (cm.coeffs) {
          c.coeffs = cm.coeffs;
          // For simple linear RAT_FUNC: raw = (b*phys + c) / f  →  phys = (raw*f - c) / b
          const { a, b, c: cc, d, e, f } = cm.coeffs;
          if (a === 0 && d === 0 && e === 0 && b !== 0) {
            c.factor = f / b;
            c.offset = -cc / b;
          }
        }
      }

      // Resolve axes for CURVE/MAP — axis dataType comes from the parent
      // record layout's AXIS_PTS_X/Y slot (STD_AXIS) or from the referenced
      // AXIS_PTS entity (COM_AXIS), NOT from AXIS_DESCR (which doesn't carry it).
      const parentRl = recordLayouts[c.recordLayout];
      c.axisDefs.forEach((axis, axIdx) => {
        if (axis.attribute === 'COM_AXIS' && axis.axisPtsRef) {
          const ap = axisPts[axis.axisPtsRef];
          if (ap) {
            axis.address = ap.address;
            // If the AXIS_DESCR didn't give a useful count (rare), take it from AXIS_PTS.
            axis.maxAxisPoints = axis.maxAxisPoints || ap.maxAxisPoints;
            const apRl = recordLayouts[ap.recordLayout];
            axis.dataType = apRl?.axisX?.dataType || 'SWORD';
            axis.byteSize = DATA_TYPE_SIZE[axis.dataType] || 2;
          }
        } else {
          const slot = axIdx === 0 ? parentRl?.axisX : parentRl?.axisY;
          axis.dataType = slot?.dataType || 'SWORD';
          axis.byteSize = DATA_TYPE_SIZE[axis.dataType] || 2;
        }

        const axisCm = compuMethods[axis.conversion];
        if (axisCm?.coeffs) {
          const { b, c: cc, f } = axisCm.coeffs;
          if (b !== 0) {
            axis.factor = f / b;
            axis.offset = -cc / b;
          }
          axis.unit = axisCm.unit;
        }
      });
    }
  }

  _inferDataType(layoutName) {
    if (!layoutName) return 'SWORD';
    const lower = layoutName.toLowerCase();
    if (lower.includes('u8') || lower.includes('wu8')) return 'UBYTE';
    if (lower.includes('s8') || lower.includes('ws8')) return 'SBYTE';
    if (lower.includes('u16') || lower.includes('wu16')) return 'UWORD';
    if (lower.includes('s16') || lower.includes('ws16')) return 'SWORD';
    if (lower.includes('u32') || lower.includes('wu32')) return 'ULONG';
    if (lower.includes('s32') || lower.includes('ws32')) return 'SLONG';
    if (lower.includes('f32') || lower.includes('float32')) return 'FLOAT32_IEEE';
    if (lower.includes('f64') || lower.includes('float64')) return 'FLOAT64_IEEE';
    return 'SWORD';
  }
}

module.exports = A2lParser;
module.exports.DATA_TYPE_SIZE = DATA_TYPE_SIZE;
