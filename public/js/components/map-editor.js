// Map/Curve/Value editor with Chart.js visualization

const DATA_SIZES = { UBYTE:1, SBYTE:1, UWORD:2, SWORD:2, ULONG:4, SLONG:4, FLOAT32_IEEE:4, FLOAT64_IEEE:8 };

function readValue(buf, offset, dataType, bigEndian) {
  const view = new DataView(buf.buffer || buf, 0);
  const le = !bigEndian;
  switch (dataType) {
    case 'UBYTE':      return view.getUint8(offset);
    case 'SBYTE':      return view.getInt8(offset);
    case 'UWORD':      return view.getUint16(offset, le);
    case 'SWORD':      return view.getInt16(offset, le);
    case 'ULONG':      return view.getUint32(offset, le);
    case 'SLONG':      return view.getInt32(offset, le);
    case 'FLOAT32_IEEE': return view.getFloat32(offset, le);
    case 'FLOAT64_IEEE': return view.getFloat64(offset, le);
    default: return view.getUint16(offset, le);
  }
}

function writeValue(buf, offset, dataType, bigEndian, value) {
  const view = new DataView(buf.buffer || buf, 0);
  const le = !bigEndian;
  const v = Number(value);
  switch (dataType) {
    case 'UBYTE':      view.setUint8(offset, v); break;
    case 'SBYTE':      view.setInt8(offset, v); break;
    case 'UWORD':      view.setUint16(offset, v, le); break;
    case 'SWORD':      view.setInt16(offset, v, le); break;
    case 'ULONG':      view.setUint32(offset, v, le); break;
    case 'SLONG':      view.setInt32(offset, v, le); break;
    case 'FLOAT32_IEEE': view.setFloat32(offset, v, le); break;
    case 'FLOAT64_IEEE': view.setFloat64(offset, v, le); break;
  }
}

function toPhys(raw, param) {
  if (param.factor !== undefined) return raw * param.factor + (param.offset || 0);
  return raw;
}

function toRaw(phys, param) {
  if (param.factor !== undefined) return (phys - (param.offset || 0)) / param.factor;
  return phys;
}

export class MapEditor {
  constructor(el, { onBytesChange }) {
    this.el = el;
    this.onBytesChange = onBytesChange;
    this.param = null;
    this.romData = null;
    this._chart = null;
    el.classList.add('hidden');
  }

  show(param, romData) {
    this.param = param;
    this.romData = romData;
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

    this.el.innerHTML = `
      <div class="map-toolbar">
        <span class="map-name">${p.name}</span>
        <span class="map-desc">${p.description || ''}</span>
        <span style="font-size:11px;color:var(--text-dim)">${p.type} · ${p.dataType || ''} · ${p.unit || ''}</span>
        <button class="btn btn-sm" id="map-close" style="margin-left:8px">✕</button>
      </div>
      <div class="map-content">
        <div class="map-table-wrap" id="map-table-wrap"></div>
        <div class="map-chart-wrap" id="map-chart-wrap" style="display:${p.type === 'VALUE' ? 'none' : ''}">
          <canvas id="map-chart"></canvas>
        </div>
      </div>
    `;

    this.el.querySelector('#map-close').addEventListener('click', () => this.hide());

    if (p.type === 'VALUE') this._renderValue(bigEndian);
    else if (p.type === 'CURVE') this._renderCurve(bigEndian);
    else if (p.type === 'MAP') this._renderMap(bigEndian);
    else {
      this.el.querySelector('#map-table-wrap').innerHTML = `<div class="empty-state">Type ${p.type} non supporté</div>`;
    }
  }

  _renderValue(bigEndian) {
    const p = this.param;
    const raw = readValue(this.romData, p.address, p.dataType || 'SWORD', bigEndian);
    const phys = toPhys(raw, p);
    const wrap = this.el.querySelector('#map-table-wrap');

    wrap.innerHTML = `
      <table class="map-table" style="margin:16px">
        <tr>
          <th>Valeur brute (HEX)</th>
          <th>Valeur brute (DEC)</th>
          <th>Valeur physique (${p.unit || ''})</th>
        </tr>
        <tr>
          <td><input id="val-raw-hex" value="${raw.toString(16).toUpperCase().padStart(4,'0')}"></td>
          <td><input id="val-raw-dec" value="${raw}"></td>
          <td><input id="val-phys" value="${phys.toFixed(3)}"></td>
        </tr>
      </table>
      <div style="padding:0 16px;font-size:11px;color:var(--text-dim)">
        Adresse: 0x${p.address.toString(16).toUpperCase()} ·
        ${bigEndian ? 'Big-Endian' : 'Little-Endian'} ·
        Limites: [${p.lowerLimit}, ${p.upperLimit}]
      </div>
    `;

    const applyRaw = (v) => {
      const sz = DATA_SIZES[p.dataType] || 2;
      const bytes = new Uint8Array(sz);
      writeValue(bytes, 0, p.dataType || 'SWORD', bigEndian, v);
      this.romData.set(bytes, p.address);
      if (this.onBytesChange) this.onBytesChange(p.address, Array.from(bytes));
      wrap.querySelector('#val-raw-hex').value = v.toString(16).toUpperCase().padStart(4, '0');
      wrap.querySelector('#val-raw-dec').value = v;
      wrap.querySelector('#val-phys').value = toPhys(v, p).toFixed(3);
    };

    wrap.querySelector('#val-raw-hex').addEventListener('change', e => applyRaw(parseInt(e.target.value, 16) || 0));
    wrap.querySelector('#val-raw-dec').addEventListener('change', e => applyRaw(parseInt(e.target.value) || 0));
    wrap.querySelector('#val-phys').addEventListener('change', e => applyRaw(Math.round(toRaw(parseFloat(e.target.value), p))));
  }

  _renderCurve(bigEndian) {
    const p = this.param;
    const axis = p.axisDefs?.[0];
    if (!axis) { this.el.querySelector('#map-table-wrap').innerHTML = '<div class="empty-state">Pas d\'axe défini</div>'; return; }

    const valDT = p.dataType || 'SWORD';
    const axisDT = axis.dataType || 'SWORD';
    const valSz = DATA_SIZES[valDT] || 2;
    const axisSz = DATA_SIZES[axisDT] || 2;

    // Determine axis address and count
    let axisAddr = axis.address ?? p.address; // COM_AXIS uses axis.address
    const valCount = axis.maxAxisPoints || 16;

    // For STD_AXIS, axis data is stored before values at the param address
    // Layout: [axis_0..axis_n][val_0..val_n]
    if (axis.attribute === 'STD_AXIS' || !axis.address) {
      axisAddr = p.address;
    }

    const axisVals = [];
    const dataVals = [];

    // Read axis values
    let axisDataAddr = axis.attribute === 'COM_AXIS' && axis.address ? axis.address : p.address;
    for (let i = 0; i < valCount; i++) {
      const raw = readValue(this.romData, axisDataAddr + i * axisSz, axisDT, bigEndian);
      axisVals.push(toPhys(raw, axis));
    }

    // Read data values (after axis for STD_AXIS)
    let dataAddr = axis.attribute === 'STD_AXIS' ? p.address + valCount * axisSz : p.address;
    for (let i = 0; i < valCount; i++) {
      const raw = readValue(this.romData, dataAddr + i * valSz, valDT, bigEndian);
      dataVals.push(toPhys(raw, p));
    }

    const wrap = this.el.querySelector('#map-table-wrap');
    wrap.innerHTML = this._curveTable(axisVals, dataVals, axis, p);
    this._setupCurveInputs(wrap, axisVals, dataVals, axis, p, bigEndian, dataAddr, valSz, valDT);
    this._drawCurveChart(axisVals, dataVals, p.unit || '');
  }

  _curveTable(axisVals, dataVals, axis, p) {
    const axisRow = axisVals.map((v, i) =>
      `<th style="font-size:10px;color:var(--accent2)">${v.toFixed(1)}</th>`
    ).join('');
    const valRow = dataVals.map((v, i) =>
      `<td><input data-i="${i}" value="${v.toFixed(2)}"></td>`
    ).join('');
    return `
      <table class="map-table">
        <thead><tr><th>${axis.unit || 'X'} →</th>${axisRow}</tr></thead>
        <tbody><tr><th style="font-size:10px">${p.unit || 'Y'}</th>${valRow}</tr></tbody>
      </table>
    `;
  }

  _setupCurveInputs(wrap, axisVals, dataVals, axis, p, bigEndian, dataAddr, valSz, valDT) {
    wrap.querySelectorAll('input[data-i]').forEach(inp => {
      inp.addEventListener('change', e => {
        const i = parseInt(e.target.dataset.i);
        const phys = parseFloat(e.target.value);
        const raw = Math.round(toRaw(phys, p));
        const bytes = new Uint8Array(valSz);
        writeValue(bytes, 0, valDT, bigEndian, raw);
        const off = dataAddr + i * valSz;
        this.romData.set(bytes, off);
        if (this.onBytesChange) this.onBytesChange(off, Array.from(bytes));
        dataVals[i] = phys;
        if (this._chart) {
          this._chart.data.datasets[0].data = [...dataVals];
          this._chart.update('none');
        }
      });
    });
  }

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
    const xCount = axisX.maxAxisPoints || 8;
    const yCount = axisY.maxAxisPoints || 8;

    // Determine addresses
    // STD_AXIS: p.address → [xAxis][yAxis][data]
    // COM_AXIS: axes at their own addresses
    let xAddr = axisX.attribute === 'COM_AXIS' && axisX.address ? axisX.address : p.address;
    let yAddr = axisY.attribute === 'COM_AXIS' && axisY.address ? axisY.address : xAddr + xCount * xSz;
    let dataAddr = p.address;
    if (axisX.attribute === 'STD_AXIS') {
      dataAddr = xAddr + xCount * xSz + yCount * ySz;
    }

    const xVals = Array.from({ length: xCount }, (_, i) =>
      toPhys(readValue(this.romData, xAddr + i * xSz, xDT, bigEndian), axisX)
    );
    const yVals = Array.from({ length: yCount }, (_, i) =>
      toPhys(readValue(this.romData, yAddr + i * ySz, yDT, bigEndian), axisY)
    );

    const grid = [];
    for (let y = 0; y < yCount; y++) {
      grid[y] = [];
      for (let x = 0; x < xCount; x++) {
        const raw = readValue(this.romData, dataAddr + (y * xCount + x) * valSz, valDT, bigEndian);
        grid[y][x] = toPhys(raw, p);
      }
    }

    const wrap = this.el.querySelector('#map-table-wrap');
    this._renderMapTable(wrap, xVals, yVals, grid, axisX, axisY, p);
    this._setupMapInputs(wrap, grid, xCount, yCount, p, bigEndian, dataAddr, valSz, valDT);
    this._drawMapChart(xVals, yVals, grid, p.unit || '');
  }

  _renderMapTable(wrap, xVals, yVals, grid, axisX, axisY, p) {
    const xHeaders = xVals.map(v => `<th>${v.toFixed(1)}</th>`).join('');
    const rows = yVals.map((yv, yi) => {
      const cells = grid[yi].map((v, xi) =>
        `<td><input data-xi="${xi}" data-yi="${yi}" value="${v.toFixed(2)}"></td>`
      ).join('');
      return `<tr><th style="font-size:10px;color:var(--accent2)">${yv.toFixed(1)}</th>${cells}</tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="map-table">
        <thead><tr>
          <th style="color:var(--text-dim)">${axisY.unit || 'Y'} \\ ${axisX.unit || 'X'}</th>
          ${xHeaders}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  _setupMapInputs(wrap, grid, xCount, yCount, p, bigEndian, dataAddr, valSz, valDT) {
    wrap.querySelectorAll('input[data-xi]').forEach(inp => {
      inp.addEventListener('change', e => {
        const xi = parseInt(e.target.dataset.xi);
        const yi = parseInt(e.target.dataset.yi);
        const phys = parseFloat(e.target.value);
        const raw = Math.round(toRaw(phys, p));
        const bytes = new Uint8Array(valSz);
        writeValue(bytes, 0, valDT, bigEndian, raw);
        const off = dataAddr + (yi * xCount + xi) * valSz;
        this.romData.set(bytes, off);
        if (this.onBytesChange) this.onBytesChange(off, Array.from(bytes));
        grid[yi][xi] = phys;
        if (this._chart) {
          this._chart.data.datasets[0].data = grid.flat();
          this._chart.update('none');
        }
      });
    });
  }

  _drawCurveChart(xVals, yVals, unit) {
    const canvas = this.el.querySelector('#map-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (this._chart) this._chart.destroy();
    this._chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: xVals.map(v => v.toFixed(1)),
        datasets: [{ data: [...yVals], borderColor: '#569cd6', backgroundColor: 'rgba(86,156,214,0.1)', tension: 0.3, pointRadius: 3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#808080', font: { size: 10 } }, grid: { color: '#333' } },
          y: { ticks: { color: '#808080', font: { size: 10 } }, grid: { color: '#333' }, title: { display: !!unit, text: unit, color: '#808080' } }
        }
      }
    });
  }

  _drawMapChart(xVals, yVals, grid, unit) {
    const canvas = this.el.querySelector('#map-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (this._chart) this._chart.destroy();

    const datasets = grid.map((row, yi) => ({
      label: yVals[yi]?.toFixed(1) || yi,
      data: row,
      tension: 0.3,
      pointRadius: 2
    }));

    this._chart = new Chart(canvas, {
      type: 'line',
      data: { labels: xVals.map(v => v.toFixed(1)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#808080', font: { size: 9 } }, grid: { color: '#333' } },
          y: { ticks: { color: '#808080', font: { size: 9 } }, grid: { color: '#333' } }
        }
      }
    });
  }
}
