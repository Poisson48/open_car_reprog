// Map/Curve/Value editor
// Features: heatmap 2D, range selection, ±% adjustments, physical conversion

const DATA_SIZES = { UBYTE:1, SBYTE:1, UWORD:2, SWORD:2, ULONG:4, SLONG:4, FLOAT32_IEEE:4, FLOAT64_IEEE:8 };

function readValue(buf, offset, dataType, bigEndian) {
  if (offset < 0 || offset + (DATA_SIZES[dataType] || 2) > buf.length) return 0;
  const view = new DataView(buf.buffer || buf, 0);
  const le = !bigEndian;
  switch (dataType) {
    case 'UBYTE': return view.getUint8(offset);
    case 'SBYTE': return view.getInt8(offset);
    case 'UWORD': return view.getUint16(offset, le);
    case 'SWORD': return view.getInt16(offset, le);
    case 'ULONG': return view.getUint32(offset, le);
    case 'SLONG': return view.getInt32(offset, le);
    case 'FLOAT32_IEEE': return view.getFloat32(offset, le);
    case 'FLOAT64_IEEE': return view.getFloat64(offset, le);
    default: return view.getUint16(offset, le);
  }
}

function writeValue(buf, offset, dataType, bigEndian, value) {
  if (offset < 0 || offset + (DATA_SIZES[dataType] || 2) > buf.length) return;
  const view = new DataView(buf.buffer || buf, 0);
  const le = !bigEndian;
  const v = Number(value);
  switch (dataType) {
    case 'UBYTE': view.setUint8(offset, Math.round(v)); break;
    case 'SBYTE': view.setInt8(offset, Math.round(v)); break;
    case 'UWORD': view.setUint16(offset, Math.round(v), le); break;
    case 'SWORD': view.setInt16(offset, Math.round(v), le); break;
    case 'ULONG': view.setUint32(offset, Math.round(v), le); break;
    case 'SLONG': view.setInt32(offset, Math.round(v), le); break;
    case 'FLOAT32_IEEE': view.setFloat32(offset, v, le); break;
    case 'FLOAT64_IEEE': view.setFloat64(offset, v, le); break;
  }
}

function toPhys(raw, param) {
  if (param?.factor !== undefined) return raw * param.factor + (param.offset || 0);
  return raw;
}
function toRaw(phys, param) {
  if (param?.factor !== undefined && param.factor !== 0) return (phys - (param.offset || 0)) / param.factor;
  return phys;
}

// Jet colormap: blue → cyan → green → yellow → red
function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0,    0,   0, 180],
    [0.25, 0, 200, 255],
    [0.5,  0, 210,   0],
    [0.75, 255, 210, 0],
    [1,    255,  30,  0]
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, r0, g0, b0] = stops[i];
    const [t1, r1, g1, b1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const r = Math.round(r0 + f * (r1 - r0));
      const g = Math.round(g0 + f * (g1 - g0));
      const b = Math.round(b0 + f * (b1 - b0));
      return `rgb(${r},${g},${b})`;
    }
  }
  return 'rgb(255,0,0)';
}

function textColorForBg(t) {
  return (t > 0.3 && t < 0.75) ? '#000' : '#fff';
}

export class MapEditor {
  constructor(el, { onBytesChange }) {
    this.el = el;
    this.onBytesChange = onBytesChange;
    this.param = null;
    this.romData = null;
    this._chart = null;
    this._selection = new Set(); // "xi,yi" keys
    this._dragStart = null;
    this._grid = null;
    this._dataAddr = 0;
    this._xCount = 0;
    this._yCount = 0;
    this._valDT = 'SWORD';
    this._valSz = 2;
    this._bigEndian = true;
    el.classList.add('hidden');
  }

  show(param, romData) {
    this.param = param;
    this.romData = romData;
    this._selection.clear();
    this.el.classList.remove('hidden');
    this._render();
  }

  hide() {
    this.el.classList.add('hidden');
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }

  _render() {
    const p = this.param;
    const bigEndian = p.byteOrder !== 'LITTLE_ENDIAN';
    this._bigEndian = bigEndian;

    this.el.innerHTML = `
      <div class="map-toolbar">
        <span class="map-name">${p.name}</span>
        <span class="map-desc">${p.description || ''}</span>
        <span style="font-size:11px;color:var(--text-dim)">${p.type} · ${p.dataType || ''} · ${p.unit || ''} · 0x${p.address.toString(16).toUpperCase()}</span>
        <button class="btn btn-sm" id="map-close" style="margin-left:8px">✕</button>
      </div>

      <div id="map-sel-bar" class="map-sel-bar hidden">
        <span id="map-sel-count" style="font-size:11px;color:var(--text-dim)">0 cellule(s) sélectionnée(s)</span>
        <button class="btn btn-sm map-adj-btn" data-op="pct" data-val="5">+5%</button>
        <button class="btn btn-sm map-adj-btn" data-op="pct" data-val="-5">−5%</button>
        <button class="btn btn-sm map-adj-btn" data-op="pct" data-val="10">+10%</button>
        <button class="btn btn-sm map-adj-btn" data-op="pct" data-val="-10">−10%</button>
        <button class="btn btn-sm map-adj-btn" data-op="pct" data-val="1">+1%</button>
        <button class="btn btn-sm map-adj-btn" data-op="pct" data-val="-1">−1%</button>
        <input type="number" id="map-set-val" placeholder="Valeur…" style="width:80px;background:var(--panel);border:1px solid var(--border);color:var(--text);padding:3px 6px;font-size:11px;font-family:inherit">
        <button class="btn btn-sm" id="map-apply-val">Appliquer</button>
        <button class="btn btn-sm" id="map-sel-all">Tout sélectionner</button>
        <button class="btn btn-sm" id="map-sel-clear">Désélectionner</button>
      </div>

      <div class="map-content">
        <div class="map-table-wrap" id="map-table-wrap"></div>
        <div class="map-chart-wrap" id="map-chart-wrap" style="display:${p.type === 'VALUE' ? 'none' : ''}">
          <canvas id="map-heatmap"></canvas>
        </div>
      </div>
    `;

    this.el.querySelector('#map-close').addEventListener('click', () => this.hide());

    // Selection bar buttons
    this.el.querySelectorAll('.map-adj-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const op = btn.dataset.op;
        const val = parseFloat(btn.dataset.val);
        if (op === 'pct') this._applyPct(val);
      });
    });
    this.el.querySelector('#map-apply-val')?.addEventListener('click', () => {
      const v = parseFloat(this.el.querySelector('#map-set-val').value);
      if (!isNaN(v)) this._applySet(v);
    });
    this.el.querySelector('#map-sel-all')?.addEventListener('click', () => this._selectAll());
    this.el.querySelector('#map-sel-clear')?.addEventListener('click', () => this._clearSelection());

    if (p.type === 'VALUE') this._renderValue(bigEndian);
    else if (p.type === 'CURVE') this._renderCurve(bigEndian);
    else if (p.type === 'MAP') this._renderMap(bigEndian);
    else {
      this.el.querySelector('#map-table-wrap').innerHTML =
        `<div class="empty-state">Type ${p.type} non supporté</div>`;
    }
  }

  // ── VALUE ───────────────────────────────────────────────────────────────────

  _renderValue(bigEndian) {
    const p = this.param;
    const raw = readValue(this.romData, p.address, p.dataType || 'SWORD', bigEndian);
    const phys = toPhys(raw, p);
    const wrap = this.el.querySelector('#map-table-wrap');

    wrap.innerHTML = `
      <div style="padding:16px">
        <table class="map-table" style="margin-bottom:12px">
          <tr>
            <th>Valeur brute (HEX)</th>
            <th>Valeur brute (DEC)</th>
            <th>Valeur physique (${p.unit || '—'})</th>
          </tr>
          <tr>
            <td><input id="val-raw-hex" value="${raw.toString(16).toUpperCase().padStart(4,'0')}"></td>
            <td><input id="val-raw-dec" value="${raw}"></td>
            <td><input id="val-phys" value="${phys.toFixed(3)}"></td>
          </tr>
        </table>
        <div style="font-size:11px;color:var(--text-dim)">
          Adresse: 0x${p.address.toString(16).toUpperCase()} ·
          ${bigEndian ? 'Big-Endian' : 'Little-Endian'} ·
          Limites: [${p.lowerLimit ?? '—'}, ${p.upperLimit ?? '—'}]
          ${p.factor !== undefined ? `· Facteur: ×${p.factor.toFixed(4)}` : ''}
        </div>
      </div>
    `;

    const applyRaw = (v) => {
      const sz = DATA_SIZES[p.dataType] || 2;
      const bytes = new Uint8Array(sz);
      writeValue(bytes, 0, p.dataType || 'SWORD', bigEndian, v);
      this.romData.set(bytes, p.address);
      if (this.onBytesChange) this.onBytesChange(p.address, Array.from(bytes));
      wrap.querySelector('#val-raw-hex').value = Math.round(v).toString(16).toUpperCase().padStart(4,'0');
      wrap.querySelector('#val-raw-dec').value = Math.round(v);
      wrap.querySelector('#val-phys').value = toPhys(v, p).toFixed(3);
    };

    wrap.querySelector('#val-raw-hex').addEventListener('change', e => applyRaw(parseInt(e.target.value, 16) || 0));
    wrap.querySelector('#val-raw-dec').addEventListener('change', e => applyRaw(parseInt(e.target.value) || 0));
    wrap.querySelector('#val-phys').addEventListener('change', e => applyRaw(Math.round(toRaw(parseFloat(e.target.value), p))));
  }

  // ── CURVE ───────────────────────────────────────────────────────────────────

  _renderCurve(bigEndian) {
    const p = this.param;
    const axis = p.axisDefs?.[0];
    if (!axis) { this.el.querySelector('#map-table-wrap').innerHTML = '<div class="empty-state">Pas d\'axe défini</div>'; return; }

    const valDT = p.dataType || 'SWORD';
    const axisDT = axis.dataType || 'SWORD';
    const valSz = DATA_SIZES[valDT] || 2;
    const axisSz = DATA_SIZES[axisDT] || 2;
    const valCount = axis.maxAxisPoints || 16;

    let axisAddr = axis.attribute === 'COM_AXIS' && axis.address ? axis.address : p.address;
    let dataAddr = axis.attribute === 'STD_AXIS' ? p.address + valCount * axisSz : p.address;

    const axisVals = Array.from({ length: valCount }, (_, i) =>
      toPhys(readValue(this.romData, axisAddr + i * axisSz, axisDT, bigEndian), axis)
    );
    const dataVals = Array.from({ length: valCount }, (_, i) =>
      toPhys(readValue(this.romData, dataAddr + i * valSz, valDT, bigEndian), p)
    );

    this._dataAddr = dataAddr;
    this._xCount = valCount;
    this._yCount = 1;
    this._valDT = valDT;
    this._valSz = valSz;
    this._grid = [dataVals];

    this._renderCurveTable(axisVals, dataVals, axis, p, bigEndian, dataAddr, valSz, valDT);
    this._drawCurveChart(axisVals, dataVals, p.unit || '');
  }

  _renderCurveTable(axisVals, dataVals, axis, p, bigEndian, dataAddr, valSz, valDT) {
    const wrap = this.el.querySelector('#map-table-wrap');
    const min = dataVals.reduce((a, b) => a < b ? a : b, Infinity);
    const max = dataVals.reduce((a, b) => a > b ? a : b, -Infinity);
    const range = max - min || 1;

    const axisRow = axisVals.map(v => `<th style="font-size:10px;color:var(--accent2)">${v.toFixed(1)}</th>`).join('');
    const valRow = dataVals.map((v, i) => {
      const t = (v - min) / range;
      const bg = heatColor(t);
      const fg = textColorForBg(t);
      return `<td style="background:${bg}"><input data-xi="${i}" data-yi="0" value="${v.toFixed(2)}" style="color:${fg}"></td>`;
    }).join('');

    wrap.innerHTML = `
      <table class="map-table">
        <thead><tr><th>${axis.unit || 'X'} →</th>${axisRow}</tr></thead>
        <tbody><tr><th style="font-size:10px">${p.unit || 'Y'}</th>${valRow}</tr></tbody>
      </table>
    `;

    this._bindTableInputs(wrap, bigEndian, dataAddr, valSz, valDT, p, 1, this._xCount, dataVals.length > 0 ? dataVals : null, null);
  }

  // ── MAP 2D ──────────────────────────────────────────────────────────────────

  _renderMap(bigEndian) {
    const p = this.param;
    const axisX = p.axisDefs?.[0];
    const axisY = p.axisDefs?.[1];
    if (!axisX || !axisY) {
      this.el.querySelector('#map-table-wrap').innerHTML = '<div class="empty-state">Axes non définis</div>';
      return;
    }

    const valDT = p.dataType || 'SWORD';
    const xDT = axisX.dataType || 'SWORD';
    const yDT = axisY.dataType || 'SWORD';
    const valSz = DATA_SIZES[valDT] || 2;
    const xSz = DATA_SIZES[xDT] || 2;
    const ySz = DATA_SIZES[yDT] || 2;

    // For STD_AXIS with Kf_Xs16_Ys16_Ws16 layout, read actual nx/ny from ROM header
    let xCount, yCount;
    const isStdAxis = axisX.attribute === 'STD_AXIS' && axisY.attribute === 'STD_AXIS';
    if (isStdAxis) {
      const view = new DataView(this.romData.buffer ?? this.romData);
      xCount = view.getInt16(p.address, false);
      yCount = view.getInt16(p.address + 2, false);
      if (xCount <= 0 || yCount <= 0 || xCount > 512 || yCount > 512) {
        this.el.querySelector('#map-table-wrap').innerHTML =
          `<div class="empty-state">Données invalides en ROM (nx=${xCount}, ny=${yCount}) — adresse 0x${p.address.toString(16).toUpperCase()}<br>Cette MAP n'est pas présente dans ce dump ROM.</div>`;
        return;
      }
    } else {
      xCount = Math.min(axisX.maxAxisPoints || 8, 512);
      yCount = Math.min(axisY.maxAxisPoints || 8, 512);
    }

    // xAddr starts after the nx/ny header (4 bytes) for STD_AXIS
    let xAddr = axisX.attribute === 'COM_AXIS' && axisX.address ? axisX.address : p.address + (isStdAxis ? 4 : 0);
    let yAddr = axisY.attribute === 'COM_AXIS' && axisY.address ? axisY.address : xAddr + xCount * xSz;
    let dataAddr = isStdAxis ? xAddr + xCount * xSz + yCount * ySz : p.address;

    this._dataAddr = dataAddr;
    this._xCount = xCount;
    this._yCount = yCount;
    this._valDT = valDT;
    this._valSz = valSz;

    const xVals = Array.from({ length: xCount }, (_, i) =>
      toPhys(readValue(this.romData, xAddr + i * xSz, xDT, bigEndian), axisX)
    );
    const yVals = Array.from({ length: yCount }, (_, i) =>
      toPhys(readValue(this.romData, yAddr + i * ySz, yDT, bigEndian), axisY)
    );
    const grid = Array.from({ length: yCount }, (_, yi) =>
      Array.from({ length: xCount }, (_, xi) =>
        toPhys(readValue(this.romData, dataAddr + (yi * xCount + xi) * valSz, valDT, bigEndian), p)
      )
    );

    this._grid = grid;
    this._renderMapTable(xVals, yVals, grid, axisX, axisY, p, bigEndian, dataAddr, valSz, valDT);
    this._drawHeatmap(xVals, yVals, grid, p);
  }

  _renderMapTable(xVals, yVals, grid, axisX, axisY, p, bigEndian, dataAddr, valSz, valDT) {
    const wrap = this.el.querySelector('#map-table-wrap');
    const allVals = grid.flat();
    const min = allVals.reduce((a, b) => a < b ? a : b, Infinity);
    const max = allVals.reduce((a, b) => a > b ? a : b, -Infinity);
    const range = max - min || 1;

    const xHeaders = xVals.map(v => `<th>${v.toFixed(1)}</th>`).join('');
    const rows = yVals.map((yv, yi) => {
      const cells = grid[yi].map((v, xi) => {
        const t = (v - min) / range;
        const bg = heatColor(t);
        const fg = textColorForBg(t);
        const key = `${xi},${yi}`;
        const selBorder = this._selection.has(key) ? 'outline:2px solid #fff;outline-offset:-2px;' : '';
        return `<td style="background:${bg};${selBorder}"><input data-xi="${xi}" data-yi="${yi}" value="${v.toFixed(2)}" style="color:${fg}"></td>`;
      }).join('');
      return `<tr><th style="font-size:10px;color:var(--accent2)">${yv.toFixed(1)}</th>${cells}</tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="map-table" id="map-grid-table">
        <thead><tr>
          <th style="color:var(--text-dim)">${axisY.unit || 'Y'} \\ ${axisX.unit || 'X'}</th>
          ${xHeaders}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    this._bindTableInputs(wrap, bigEndian, dataAddr, valSz, valDT, p, grid.length, xVals.length, null, grid);
    this._bindCellSelection(wrap, grid);
  }

  _bindTableInputs(wrap, bigEndian, dataAddr, valSz, valDT, p, yCount, xCount, curve1d, grid2d) {
    wrap.querySelectorAll('input[data-xi]').forEach(inp => {
      inp.addEventListener('change', e => {
        const xi = parseInt(e.target.dataset.xi);
        const yi = parseInt(e.target.dataset.yi);
        const phys = parseFloat(e.target.value);
        this._writeCell(xi, yi, phys, xCount, bigEndian, dataAddr, valSz, valDT, p);
        if (grid2d) {
          grid2d[yi][xi] = phys;
          this._refreshHeatmapColors(wrap, grid2d);
          this._drawHeatmap(null, null, grid2d, p);
        } else if (curve1d) {
          curve1d[xi] = phys;
        }
        e.target.closest('td').style.background = heatColor(this._normalizedVal(phys, grid2d || [curve1d]));
      });
    });
  }

  _bindCellSelection(wrap, grid) {
    const table = wrap.querySelector('#map-grid-table');
    if (!table) return;

    let isMouseDown = false;
    let startKey = null;

    table.addEventListener('mousedown', e => {
      const inp = e.target.closest('input[data-xi]');
      if (!inp) return;
      const xi = parseInt(inp.dataset.xi);
      const yi = parseInt(inp.dataset.yi);
      const key = `${xi},${yi}`;
      isMouseDown = true;
      startKey = { xi, yi };

      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        this._selection.clear();
      }
      this._toggleCell(key);
      this._updateSelectionBar();
      this._refreshSelectionHighlight(table);
    });

    table.addEventListener('mouseover', e => {
      if (!isMouseDown) return;
      const inp = e.target.closest('input[data-xi]');
      if (!inp || !startKey) return;
      const xi = parseInt(inp.dataset.xi);
      const yi = parseInt(inp.dataset.yi);
      // Select rectangle from startKey to current
      this._selection.clear();
      const x0 = Math.min(startKey.xi, xi), x1 = Math.max(startKey.xi, xi);
      const y0 = Math.min(startKey.yi, yi), y1 = Math.max(startKey.yi, yi);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          this._selection.add(`${x},${y}`);
      this._updateSelectionBar();
      this._refreshSelectionHighlight(table);
    });

    document.addEventListener('mouseup', () => { isMouseDown = false; startKey = null; });
  }

  _toggleCell(key) {
    if (this._selection.has(key)) this._selection.delete(key);
    else this._selection.add(key);
  }

  _selectAll() {
    this._selection.clear();
    for (let yi = 0; yi < this._yCount; yi++)
      for (let xi = 0; xi < this._xCount; xi++)
        this._selection.add(`${xi},${yi}`);
    this._updateSelectionBar();
    const table = this.el.querySelector('#map-grid-table');
    if (table) this._refreshSelectionHighlight(table);
  }

  _clearSelection() {
    this._selection.clear();
    this._updateSelectionBar();
    const table = this.el.querySelector('#map-grid-table');
    if (table) this._refreshSelectionHighlight(table);
  }

  _updateSelectionBar() {
    const bar = this.el.querySelector('#map-sel-bar');
    const count = this.el.querySelector('#map-sel-count');
    if (!bar) return;
    const n = this._selection.size;
    bar.classList.toggle('hidden', n === 0);
    if (count) count.textContent = `${n} cellule(s) sélectionnée(s)`;
  }

  _refreshSelectionHighlight(table) {
    table.querySelectorAll('input[data-xi]').forEach(inp => {
      const key = `${inp.dataset.xi},${inp.dataset.yi}`;
      const td = inp.closest('td');
      if (td) td.style.outline = this._selection.has(key) ? '2px solid #fff' : '';
      if (td) td.style.outlineOffset = this._selection.has(key) ? '-2px' : '';
    });
  }

  _applyPct(pct) {
    if (!this._selection.size || !this._grid) return;
    const factor = 1 + pct / 100;
    const changed = [];
    for (const key of this._selection) {
      const [xi, yi] = key.split(',').map(Number);
      const row = this._grid[yi] || this._grid[0];
      const oldPhys = row[xi];
      const newPhys = oldPhys * factor;
      row[xi] = newPhys;
      changed.push({ xi, yi, phys: newPhys });
    }
    this._flushChanges(changed);
  }

  _applySet(physVal) {
    if (!this._selection.size || !this._grid) return;
    const changed = [];
    for (const key of this._selection) {
      const [xi, yi] = key.split(',').map(Number);
      const row = this._grid[yi] || this._grid[0];
      row[xi] = physVal;
      changed.push({ xi, yi, phys: physVal });
    }
    this._flushChanges(changed);
  }

  _flushChanges(changed) {
    const xCount = this._xCount;
    const bigEndian = this._bigEndian;
    const dataAddr = this._dataAddr;
    const valSz = this._valSz;
    const valDT = this._valDT;
    const p = this.param;

    for (const { xi, yi, phys } of changed) {
      this._writeCell(xi, yi, phys, xCount, bigEndian, dataAddr, valSz, valDT, p);
    }

    // Refresh table inputs + colors
    const table = this.el.querySelector('#map-grid-table, .map-table');
    if (table) {
      table.querySelectorAll('input[data-xi]').forEach(inp => {
        const xi = parseInt(inp.dataset.xi);
        const yi = parseInt(inp.dataset.yi);
        const row = this._grid[yi] || this._grid[0];
        if (row) {
          inp.value = row[xi].toFixed(2);
          const allVals = this._grid.flat();
          const min = allVals.reduce((a, b) => a < b ? a : b, Infinity), max = allVals.reduce((a, b) => a > b ? a : b, -Infinity);
          const t = (row[xi] - min) / (max - min || 1);
          const td = inp.closest('td');
          if (td) {
            td.style.background = heatColor(t);
            inp.style.color = textColorForBg(t);
          }
        }
      });
      this._refreshSelectionHighlight(table);
    }

    if (this.param.type === 'MAP') this._drawHeatmap(null, null, this._grid, p);
  }

  _writeCell(xi, yi, phys, xCount, bigEndian, dataAddr, valSz, valDT, p) {
    const raw = Math.round(toRaw(phys, p));
    const bytes = new Uint8Array(valSz);
    writeValue(bytes, 0, valDT, bigEndian, raw);
    const off = dataAddr + (yi * xCount + xi) * valSz;
    this.romData.set(bytes, off);
    if (this.onBytesChange) this.onBytesChange(off, Array.from(bytes));
  }

  _normalizedVal(v, grid) {
    const all = grid.flat();
    const min = all.reduce((a, b) => a < b ? a : b, Infinity), max = all.reduce((a, b) => a > b ? a : b, -Infinity);
    return (v - min) / (max - min || 1);
  }

  _refreshHeatmapColors(wrap, grid) {
    const allVals = grid.flat();
    const min = allVals.reduce((a, b) => a < b ? a : b, Infinity), max = allVals.reduce((a, b) => a > b ? a : b, -Infinity);
    const range = max - min || 1;
    wrap.querySelectorAll('input[data-xi]').forEach(inp => {
      const xi = parseInt(inp.dataset.xi), yi = parseInt(inp.dataset.yi);
      const v = grid[yi]?.[xi] ?? 0;
      const t = (v - min) / range;
      const td = inp.closest('td');
      if (td) { td.style.background = heatColor(t); inp.style.color = textColorForBg(t); }
    });
  }

  // ── Heatmap Canvas ──────────────────────────────────────────────────────────

  _drawHeatmap(xVals, yVals, grid, p) {
    const canvas = this.el.querySelector('#map-heatmap');
    if (!canvas) return;

    const wrap = this.el.querySelector('#map-chart-wrap');
    const W = wrap.clientWidth || 220;
    const H = wrap.clientHeight || 200;
    canvas.width = W;
    canvas.height = H;

    const yCount = grid.length;
    const xCount = grid[0]?.length || 0;
    if (!xCount || !yCount) return;

    const allVals = grid.flat();
    const minV = allVals.reduce((a, b) => a < b ? a : b, Infinity), maxV = allVals.reduce((a, b) => a > b ? a : b, -Infinity);
    const range = maxV - minV || 1;

    const LABEL_W = 36, LABEL_H = 18, LEGEND_W = 16;
    const cellW = (W - LABEL_W - LEGEND_W - 4) / xCount;
    const cellH = (H - LABEL_H) / yCount;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.font = '9px Consolas, monospace';
    ctx.textBaseline = 'middle';

    // Draw cells
    for (let yi = 0; yi < yCount; yi++) {
      for (let xi = 0; xi < xCount; xi++) {
        const v = grid[yi][xi];
        const t = (v - minV) / range;
        const x = LABEL_W + xi * cellW;
        const y = yi * cellH;

        ctx.fillStyle = heatColor(t);
        ctx.fillRect(x, y, cellW, cellH);

        // Draw value if cell is large enough
        if (cellW > 24 && cellH > 12) {
          ctx.fillStyle = textColorForBg(t);
          ctx.textAlign = 'center';
          ctx.fillText(v.toFixed(1), x + cellW / 2, y + cellH / 2);
        }
      }
    }

    // X axis labels
    if (xVals) {
      ctx.fillStyle = '#888';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let xi = 0; xi < xCount; xi++) {
        const x = LABEL_W + xi * cellW + cellW / 2;
        ctx.fillText(xVals[xi]?.toFixed(0) ?? xi, x, yCount * cellH + 2);
      }
    }

    // Y axis labels
    if (yVals) {
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let yi = 0; yi < yCount; yi++) {
        ctx.fillStyle = '#888';
        ctx.fillText(yVals[yi]?.toFixed(0) ?? yi, LABEL_W - 2, yi * cellH + cellH / 2);
      }
    }

    // Color scale legend
    const legendX = W - LEGEND_W;
    for (let i = 0; i < H - LABEL_H; i++) {
      const t = 1 - i / (H - LABEL_H);
      ctx.fillStyle = heatColor(t);
      ctx.fillRect(legendX, i, LEGEND_W, 1);
    }
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(maxV.toFixed(0), legendX, 0);
    ctx.textBaseline = 'bottom';
    ctx.fillText(minV.toFixed(0), legendX, H - LABEL_H);

    // Border grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.5;
    for (let yi = 0; yi <= yCount; yi++) {
      ctx.beginPath();
      ctx.moveTo(LABEL_W, yi * cellH);
      ctx.lineTo(W - LEGEND_W - 4, yi * cellH);
      ctx.stroke();
    }
    for (let xi = 0; xi <= xCount; xi++) {
      ctx.beginPath();
      ctx.moveTo(LABEL_W + xi * cellW, 0);
      ctx.lineTo(LABEL_W + xi * cellW, yCount * cellH);
      ctx.stroke();
    }
  }

  // ── Curve Chart ─────────────────────────────────────────────────────────────

  _drawCurveChart(xVals, yVals, unit) {
    const canvas = this.el.querySelector('#map-heatmap');
    if (!canvas || typeof Chart === 'undefined') return;
    if (this._chart) this._chart.destroy();
    this._chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: xVals.map(v => v.toFixed(1)),
        datasets: [{
          data: [...yVals],
          borderColor: '#569cd6',
          backgroundColor: 'rgba(86,156,214,0.15)',
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#808080', font: { size: 9 } }, grid: { color: '#333' } },
          y: {
            ticks: { color: '#808080', font: { size: 9 } },
            grid: { color: '#333' },
            title: { display: !!unit, text: unit, color: '#808080', font: { size: 9 } }
          }
        }
      }
    });
  }
}
