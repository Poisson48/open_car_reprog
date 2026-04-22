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
    this._xVals = null;
    this._yVals = null;
    this._dataAddr = 0;
    this._xCount = 0;
    this._yCount = 0;
    this._valDT = 'SWORD';
    this._valSz = 2;
    this._bigEndian = true;
    this._view3D = false;
    this._view3DAz = 45;
    this._view3DEl = 30;
    el.classList.add('hidden');
  }

  show(param, romData) {
    this.param = param;
    this.romData = romData;
    this.compareRom = null;
    this.compareLabel = null;
    this._selection.clear();
    this.el.classList.remove('hidden');
    this._render();
  }

  showCompare(param, romData, compareRom, label) {
    this.param = param;
    this.romData = romData;
    this.compareRom = compareRom;
    this.compareLabel = label || 'autre version';
    this._selection.clear();
    this.el.classList.remove('hidden');
    this._render();
    // Apply delta overlay on top of the standard rendering
    queueMicrotask(() => this._applyCompareOverlay());
  }

  hide() {
    this.el.classList.add('hidden');
    if (this._chart) { this._chart.destroy(); this._chart = null; }
  }

  _showLayoutWarning(addr, rawX, rawY, declX, declY) {
    const toolbar = this.el.querySelector('.map-toolbar');
    if (!toolbar || toolbar.querySelector('.map-layout-warn')) return;
    const w = document.createElement('span');
    w.className = 'map-layout-warn';
    w.title = `En-tête nx/ny illisible à 0x${addr.toString(16).toUpperCase()} (lu nx=${rawX}, ny=${rawY}). Affichage avec les dimensions A2L ${declX}×${declY}.`;
    w.textContent = `⚠ Layout`;
    toolbar.appendChild(w);
  }

  _applyCompareOverlay() {
    if (!this.compareRom) return;
    const p = this.param;
    const toolbar = this.el.querySelector('.map-toolbar');
    if (toolbar && !toolbar.querySelector('.map-compare-banner')) {
      const banner = document.createElement('span');
      banner.className = 'map-compare-banner';
      banner.innerHTML = `📊 Comparaison vs <b>${this.compareLabel}</b> <a href="#" id="map-exit-compare">✕</a>`;
      toolbar.appendChild(banner);
      banner.querySelector('#map-exit-compare').addEventListener('click', (e) => {
        e.preventDefault();
        this.show(p, this.romData);
      });
    }
    if (p.type === 'MAP') this._overlayMapDeltas();
    else if (p.type === 'CURVE') this._overlayCurveDeltas();
    else if (p.type === 'VALUE') this._overlayValueDelta();
  }

  _overlayMapDeltas() {
    const p = this.param;
    const bigEndian = p.byteOrder !== 'LITTLE_ENDIAN';
    const table = this.el.querySelector('#map-grid-table');
    if (!table || !this.compareRom) return;

    const nx = readValue(this.romData, p.address, 'SWORD', bigEndian);
    const ny = readValue(this.romData, p.address + 2, 'SWORD', bigEndian);
    if (nx <= 0 || ny <= 0 || nx > 256 || ny > 256) return;

    const axisX = p.axisDefs?.[0];
    const axisY = p.axisDefs?.[1];
    const axisSz = axisX?.byteSize || 2;
    const yAxisSz = axisY?.byteSize || 2;
    const valSz = p.byteSize || 2;
    const valDT = p.dataType || 'SWORD';
    const dataOff = p.address + 4 + nx * axisSz + ny * yAxisSz;

    table.querySelectorAll('input[data-xi]').forEach(inp => {
      const xi = parseInt(inp.dataset.xi);
      const yi = parseInt(inp.dataset.yi);
      const cellAddr = dataOff + (yi * nx + xi) * valSz;
      if (cellAddr + valSz > this.compareRom.length) return;
      const rawOther = readValue(this.compareRom, cellAddr, valDT, bigEndian);
      const physOther = toPhys(rawOther, p);
      const physNow = parseFloat(inp.value);
      const delta = physNow - physOther;
      const td = inp.closest('td');
      if (!td) return;
      if (delta === 0) return;
      const color = delta > 0 ? '#4ec9b0' : '#f44747';
      td.style.boxShadow = `inset 0 0 0 2px ${color}`;
      inp.title = `${this.compareLabel}: ${physOther.toFixed(2)} → actuel: ${physNow.toFixed(2)} (${delta > 0 ? '+' : ''}${delta.toFixed(2)})`;
    });
  }

  _overlayCurveDeltas() {
    const p = this.param;
    const bigEndian = p.byteOrder !== 'LITTLE_ENDIAN';
    const table = this.el.querySelector('#map-grid-table');
    if (!table || !this.compareRom) return;
    const axis = p.axisDefs?.[0];
    if (!axis) return;

    const valSz = p.byteSize || 2;
    const valDT = p.dataType || 'SWORD';
    const axisSz = axis.byteSize || 2;
    const valCount = axis.maxAxisPoints || 16;
    const dataAddr = axis.attribute === 'STD_AXIS' ? p.address + valCount * axisSz : p.address;

    table.querySelectorAll('input[data-xi]').forEach(inp => {
      const xi = parseInt(inp.dataset.xi);
      const cellAddr = dataAddr + xi * valSz;
      if (cellAddr + valSz > this.compareRom.length) return;
      const rawOther = readValue(this.compareRom, cellAddr, valDT, bigEndian);
      const physOther = toPhys(rawOther, p);
      const physNow = parseFloat(inp.value);
      const delta = physNow - physOther;
      const td = inp.closest('td');
      if (!td || delta === 0) return;
      const color = delta > 0 ? '#4ec9b0' : '#f44747';
      td.style.boxShadow = `inset 0 0 0 2px ${color}`;
      inp.title = `${this.compareLabel}: ${physOther.toFixed(2)} → actuel: ${physNow.toFixed(2)} (${delta > 0 ? '+' : ''}${delta.toFixed(2)})`;
    });
  }

  _overlayValueDelta() {
    const p = this.param;
    const bigEndian = p.byteOrder !== 'LITTLE_ENDIAN';
    if (!this.compareRom) return;
    const rawOther = readValue(this.compareRom, p.address, p.dataType || 'SWORD', bigEndian);
    const physOther = toPhys(rawOther, p);
    const info = this.el.querySelector('.map-table-wrap');
    if (!info) return;
    const note = document.createElement('div');
    note.className = 'map-compare-note';
    note.innerHTML = `<b>${this.compareLabel}</b> : <code>${rawOther}</code> (phys ${physOther.toFixed(3)})`;
    info.appendChild(note);
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
        ${p.type === 'MAP' ? `<button class="btn btn-sm" id="map-toggle-3d" style="margin-left:4px" title="Vue 3D / 2D">${this._view3D ? '▦ 2D' : '🗻 3D'}</button>
        <button class="btn btn-sm map-3d-only" id="map-3d-reset" title="Réinitialiser la vue" style="display:${this._view3D ? '' : 'none'}">⟳</button>` : ''}
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

      <div class="map-content${this._view3D && p.type === 'MAP' ? ' view-3d' : ''}">
        <div class="map-table-wrap" id="map-table-wrap"></div>
        <div class="map-chart-wrap" id="map-chart-wrap" style="display:${p.type === 'VALUE' ? 'none' : ''}">
          <canvas id="map-heatmap"></canvas>
        </div>
      </div>
    `;
    // Expand the pane when 3D is active so the surface has room to breathe.
    this.el.classList.toggle('view-3d', !!(this._view3D && p.type === 'MAP'));

    this.el.querySelector('#map-close').addEventListener('click', () => this.hide());
    this.el.querySelector('#map-toggle-3d')?.addEventListener('click', () => {
      this._view3D = !this._view3D;
      this._render();
      if (this.compareRom) queueMicrotask(() => this._applyCompareOverlay());
    });
    this.el.querySelector('#map-3d-reset')?.addEventListener('click', () => {
      this._view3DAz = 45;
      this._view3DEl = 30;
      if (this._grid) this._drawChart(this._xVals, this._yVals, this._grid, p);
    });

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

    // Determine nx/ny from the record layout. Layouts like Kf_Xs16_Ys16_Ws16
    // store NO_AXIS_PTS_X/Y inline as a header; other layouts keep axis counts
    // fixed via AXIS_DESCR.maxAxisPoints. Fall back to AXIS_DESCR if inline
    // header reads nonsense (e.g. a different firmware lays the map elsewhere).
    const rl = p._recordLayout || {};
    const hasInlineNx = !!rl.noAxisPtsX;
    const hasInlineNy = !!rl.noAxisPtsY;
    const view = new DataView(this.romData.buffer ?? this.romData);

    const headerSize = (hasInlineNx ? 2 : 0) + (hasInlineNy ? 2 : 0);
    const posNx = 0;
    const posNy = hasInlineNx ? 2 : 0;

    const declaredX = Math.min(axisX.maxAxisPoints || 8, 512);
    const declaredY = Math.min(axisY.maxAxisPoints || 8, 512);

    let xCount = declaredX, yCount = declaredY, usedInline = false;
    if (hasInlineNx || hasInlineNy) {
      const rawX = hasInlineNx ? view.getInt16(p.address + posNx, false) : declaredX;
      const rawY = hasInlineNy ? view.getInt16(p.address + posNy, false) : declaredY;
      const plausible = (v, max) => v > 0 && v <= Math.max(max, 32);
      if (plausible(rawX, declaredX) && plausible(rawY, declaredY)) {
        xCount = rawX;
        yCount = rawY;
        usedInline = true;
      } else {
        // Header is nonsense → the ROM likely doesn't store this map at the A2L
        // address (different firmware version / base offset). Fall back silently
        // to the declared max sizes and show a warning banner.
        this._showLayoutWarning(p.address, rawX, rawY, declaredX, declaredY);
      }
    }

    // xAddr starts after the inline nx/ny header for STD_AXIS with inline layout.
    const xAddr = axisX.attribute === 'COM_AXIS' && axisX.address
      ? axisX.address
      : p.address + (usedInline ? headerSize : 0);
    const yAddr = axisY.attribute === 'COM_AXIS' && axisY.address
      ? axisY.address
      : xAddr + xCount * xSz;
    const dataAddr = (axisX.attribute === 'COM_AXIS' || axisY.attribute === 'COM_AXIS')
      ? p.address
      : xAddr + xCount * xSz + yCount * ySz;

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
    this._xVals = xVals;
    this._yVals = yVals;
    this._renderMapTable(xVals, yVals, grid, axisX, axisY, p, bigEndian, dataAddr, valSz, valDT);
    this._drawChart(xVals, yVals, grid, p);
    if (this._view3D) this._bind3DControls();
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
          this._drawChart(this._xVals, this._yVals, grid2d, p);
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

    if (this.param.type === 'MAP') this._drawChart(this._xVals, this._yVals, this._grid, p);
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

  // ── Chart dispatcher (2D heatmap vs 3D surface) ─────────────────────────────

  _drawChart(xVals, yVals, grid, p) {
    if (this._view3D && p.type === 'MAP') this._draw3D(xVals, yVals, grid, p);
    else this._drawHeatmap(xVals, yVals, grid, p);
  }

  // ── 3D surface ──────────────────────────────────────────────────────────────

  _draw3D(xVals, yVals, grid, p) {
    const canvas = this.el.querySelector('#map-heatmap');
    if (!canvas) return;
    const wrap = this.el.querySelector('#map-chart-wrap');
    const W = wrap.clientWidth || 400;
    const H = wrap.clientHeight || 260;
    canvas.width = W;
    canvas.height = H;

    const ny = grid.length;
    const nx = grid[0]?.length || 0;
    if (!nx || !ny) return;

    const allVals = grid.flat();
    const minV = allVals.reduce((a, b) => a < b ? a : b, Infinity);
    const maxV = allVals.reduce((a, b) => a > b ? a : b, -Infinity);
    const range = maxV - minV || 1;

    // Normalize data to a unit box: X,Y in [-0.5,0.5], Z in [-0.3,0.3]
    const nX = xi => nx > 1 ? (xi / (nx - 1) - 0.5) : 0;
    const nY = yi => ny > 1 ? (yi / (ny - 1) - 0.5) : 0;
    const nZ = v => ((v - minV) / range - 0.5) * 0.6;

    const az = this._view3DAz * Math.PI / 180;
    const el = this._view3DEl * Math.PI / 180;
    const cA = Math.cos(az), sA = Math.sin(az);
    const cE = Math.cos(el), sE = Math.sin(el);

    // Yaw around Z, then pitch around X. Camera looks along +Y.
    // Returns {sx, sy, depth} where larger depth = further from camera.
    const scale = Math.min(W, H) * 0.7;
    const cx = W / 2, cy = H / 2 + H * 0.06;
    const project = (x, y, z) => {
      const x1 = x * cA + y * sA;
      const y1 = -x * sA + y * cA;
      const y2 = y1 * cE + z * sE;
      const z2 = -y1 * sE + z * cE;
      return { sx: cx + x1 * scale, sy: cy - z2 * scale, depth: y2 };
    };

    // Project all grid vertices once
    const verts = [];
    for (let yi = 0; yi < ny; yi++) {
      const row = [];
      for (let xi = 0; xi < nx; xi++) row.push(project(nX(xi), nY(yi), nZ(grid[yi][xi])));
      verts.push(row);
    }

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, W, H);

    // Grid floor at Z = -0.3 for visual grounding
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    const floorZ = -0.3;
    for (let xi = 0; xi < nx; xi++) {
      const a = project(nX(xi), nY(0), floorZ);
      const b = project(nX(xi), nY(ny - 1), floorZ);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    for (let yi = 0; yi < ny; yi++) {
      const a = project(nX(0), nY(yi), floorZ);
      const b = project(nX(nx - 1), nY(yi), floorZ);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }

    // Build quads and sort back-to-front (painter's algorithm)
    const quads = [];
    for (let yi = 0; yi < ny - 1; yi++) {
      for (let xi = 0; xi < nx - 1; xi++) {
        const v00 = verts[yi][xi];
        const v10 = verts[yi][xi + 1];
        const v11 = verts[yi + 1][xi + 1];
        const v01 = verts[yi + 1][xi];
        const avgV = (grid[yi][xi] + grid[yi][xi + 1] + grid[yi + 1][xi + 1] + grid[yi + 1][xi]) / 4;
        quads.push({
          pts: [v00, v10, v11, v01],
          t: (avgV - minV) / range,
          depth: (v00.depth + v10.depth + v11.depth + v01.depth) / 4
        });
      }
    }
    quads.sort((a, b) => b.depth - a.depth);

    for (const q of quads) {
      ctx.fillStyle = heatColor(q.t);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(q.pts[0].sx, q.pts[0].sy);
      ctx.lineTo(q.pts[1].sx, q.pts[1].sy);
      ctx.lineTo(q.pts[2].sx, q.pts[2].sy);
      ctx.lineTo(q.pts[3].sx, q.pts[3].sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Axes at the back-left corner of the box
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.font = '10px Consolas, monospace';
    ctx.fillStyle = '#bbb';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const drawAxis = (p0, p1, label) => {
      ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.stroke();
      ctx.fillText(label, p1.sx + 4, p1.sy);
    };
    const xLabel = p.axisDefs?.[0]?.unit ? `X [${p.axisDefs[0].unit}]` : 'X';
    const yLabel = p.axisDefs?.[1]?.unit ? `Y [${p.axisDefs[1].unit}]` : 'Y';
    const zLabel = p.unit ? `Z [${p.unit}]` : 'Z';
    drawAxis(project(-0.5, -0.5, floorZ), project(0.5, -0.5, floorZ), xLabel);
    drawAxis(project(-0.5, -0.5, floorZ), project(-0.5, 0.5, floorZ), yLabel);
    drawAxis(project(-0.5, -0.5, floorZ), project(-0.5, -0.5, 0.3), zLabel);

    // Min/max annotation
    ctx.fillStyle = '#888';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`min ${minV.toFixed(2)}  max ${maxV.toFixed(2)}  az ${Math.round(this._view3DAz)}° el ${Math.round(this._view3DEl)}°`, 6, 4);
    ctx.fillText(`glisser pour tourner · molette pour zoomer`, 6, 18);
  }

  _bind3DControls() {
    const canvas = this.el.querySelector('#map-heatmap');
    if (!canvas || canvas._3dBound) return;
    canvas._3dBound = true;

    let dragging = false;
    let startX = 0, startY = 0, startAz = 0, startEl = 0;

    canvas.addEventListener('mousedown', e => {
      if (!this._view3D) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startAz = this._view3DAz; startEl = this._view3DEl;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
    });
    const onMove = (e) => {
      if (!dragging) return;
      this._view3DAz = startAz + (e.clientX - startX) * 0.5;
      this._view3DEl = Math.max(-10, Math.min(85, startEl - (e.clientY - startY) * 0.5));
      if (this._grid && this.param) this._draw3D(this._xVals, this._yVals, this._grid, this.param);
    };
    const onUp = () => { dragging = false; canvas.style.cursor = 'grab'; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.style.cursor = 'grab';
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
