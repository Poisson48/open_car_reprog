// Canvas-based hex editor with virtual scrolling
// Supports 16 bytes per row, address column, hex + ASCII views

const ROW_H = 20;
const BYTES_PER_ROW = 16;
const ADDR_W = 80;
const HEX_START = ADDR_W + 10;
const HEX_CELL_W = 26;
const HEX_GAP = 8; // extra gap at byte 8
const ASCII_START = HEX_START + BYTES_PER_ROW * HEX_CELL_W + HEX_GAP + 16;
const ASCII_CELL_W = 9;
const TOTAL_W = ASCII_START + BYTES_PER_ROW * ASCII_CELL_W + 16;

function hexX(col) {
  return HEX_START + col * HEX_CELL_W + (col >= 8 ? HEX_GAP : 0);
}
function asciiX(col) {
  return ASCII_START + col * ASCII_CELL_W;
}

export class HexEditor {
  constructor(wrap) {
    this.wrap = wrap;
    this.data = null;         // Uint8Array
    this.modified = new Set(); // offsets that have been edited
    this.highlights = [];      // [{start, end, color, label}]
    this.selectedOffset = -1;
    this.editNibble = 0;      // 0 = high nibble, 1 = low nibble
    this.onByteChange = null;
    this._scrollTop = 0;
    this._raf = null;

    this._build();
  }

  _build() {
    this.wrap.innerHTML = '';
    this.wrap.style.position = 'relative';
    this.wrap.style.overflow = 'hidden';

    // Scroll container
    this.scroller = document.createElement('div');
    this.scroller.id = 'hex-scroll';
    this.scroller.style.cssText = 'position:absolute;inset:0;overflow-y:scroll;overflow-x:hidden;';

    this.sizer = document.createElement('div');
    this.sizer.id = 'hex-scroll-sizer';
    this.scroller.appendChild(this.sizer);
    this.wrap.appendChild(this.scroller);

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'hex-canvas';
    this.canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    this.wrap.appendChild(this.canvas);

    // Event layer (transparent, captures clicks)
    this.evLayer = document.createElement('div');
    this.evLayer.id = 'hex-event-layer';
    this.evLayer.style.cssText = `position:absolute;top:0;left:0;cursor:text;outline:none;`;
    this.evLayer.tabIndex = 0;
    this.wrap.appendChild(this.evLayer);

    this.ctx = this.canvas.getContext('2d');

    this.scroller.addEventListener('scroll', () => this._onScroll());
    this.evLayer.addEventListener('mousedown', (e) => this._onClick(e));
    this.evLayer.addEventListener('keydown', (e) => this._onKey(e));
    this.evLayer.addEventListener('wheel', (e) => {
      this.scroller.scrollTop += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    const ro = new ResizeObserver(() => this._resize());
    ro.observe(this.wrap);
    this._resize();
  }

  load(arrayBuffer) {
    this.data = new Uint8Array(arrayBuffer);
    this.modified.clear();
    this.selectedOffset = -1;
    this._updateSizer();
    this._resize(); // re-measure after sizer gets full height (scrollbar may appear)
  }

  setHighlights(highlights) {
    this.highlights = highlights || [];
    this._render();
  }

  scrollToOffset(offset) {
    if (!this.data) return;
    const row = Math.floor(offset / BYTES_PER_ROW);
    const y = row * ROW_H;
    const h = this.wrap.clientHeight;
    const scrollTop = Math.max(0, y - h / 3);
    this.scroller.scrollTop = scrollTop;
    this.selectedOffset = offset;
    this._render();
  }

  _updateSizer() {
    const rows = this.data ? Math.ceil(this.data.length / BYTES_PER_ROW) : 0;
    this.sizer.style.height = `${rows * ROW_H}px`;
  }

  _resize() {
    const sbW = this.scroller.offsetWidth - this.scroller.clientWidth;
    const w = this.wrap.clientWidth - sbW;
    const h = this.wrap.clientHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.evLayer.style.width = w + 'px';
    this.evLayer.style.height = h + 'px';
    this._render();
  }

  _onScroll() {
    this._scrollTop = this.scroller.scrollTop;
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => { this._raf = null; this._render(); });
    }
  }

  _render() {
    if (!this.data) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scrollTop = this._scrollTop;

    ctx.clearRect(0, 0, W, H);

    const firstRow = Math.floor(scrollTop / ROW_H);
    const visibleRows = Math.ceil(H / ROW_H) + 2;

    ctx.font = '12px Consolas, "Courier New", monospace';
    ctx.textBaseline = 'middle';

    for (let r = firstRow; r < firstRow + visibleRows; r++) {
      const baseOffset = r * BYTES_PER_ROW;
      if (baseOffset >= this.data.length) break;
      const y = r * ROW_H - scrollTop;

      // Row background (alternating)
      if (r % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.02)';
        ctx.fillRect(0, y, W, ROW_H);
      }

      // Highlight regions
      for (const hl of this.highlights) {
        const rowStart = baseOffset;
        const rowEnd = baseOffset + BYTES_PER_ROW;
        if (hl.end < rowStart || hl.start >= rowEnd) continue;

        const colStart = Math.max(0, hl.start - rowStart);
        const colEnd = Math.min(BYTES_PER_ROW, hl.end - rowStart);

        ctx.fillStyle = hl.color || 'rgba(38,79,120,0.6)';
        // Hex region
        const x1 = hexX(colStart);
        const x2 = hexX(colEnd - 1) + HEX_CELL_W;
        ctx.fillRect(x1 - 2, y + 1, x2 - x1 + 2, ROW_H - 2);
        // ASCII region
        ctx.fillRect(asciiX(colStart), y + 1, (colEnd - colStart) * ASCII_CELL_W, ROW_H - 2);
      }

      // Selected row highlight
      if (this.selectedOffset >= baseOffset && this.selectedOffset < baseOffset + BYTES_PER_ROW) {
        ctx.fillStyle = 'rgba(9,71,113,0.5)';
        ctx.fillRect(0, y, W, ROW_H);
      }

      // Address
      ctx.fillStyle = '#606070';
      ctx.fillText(`${(baseOffset).toString(16).toUpperCase().padStart(7, '0')}`, 4, y + ROW_H / 2);

      // Divider
      ctx.fillStyle = '#333340';
      ctx.fillRect(ADDR_W + 4, y, 1, ROW_H);
      ctx.fillRect(ASCII_START - 8, y, 1, ROW_H);

      // Bytes
      for (let col = 0; col < BYTES_PER_ROW; col++) {
        const offset = baseOffset + col;
        if (offset >= this.data.length) break;
        const byte = this.data[offset];
        const x = hexX(col);
        const ax = asciiX(col);

        const isSelected = offset === this.selectedOffset;
        const isModified = this.modified.has(offset);

        if (isSelected) {
          ctx.fillStyle = '#0d6efd';
          ctx.fillRect(x - 2, y + 1, HEX_CELL_W, ROW_H - 2);
          ctx.fillStyle = '#fff';
        } else if (isModified) {
          ctx.fillStyle = '#ff6b35';
        } else if (byte === 0x00) {
          ctx.fillStyle = '#404040';
        } else if (byte === 0xFF) {
          ctx.fillStyle = '#505060';
        } else {
          ctx.fillStyle = '#d4d4d4';
        }

        const hex = byte.toString(16).toUpperCase().padStart(2, '0');
        ctx.fillText(hex, x, y + ROW_H / 2);

        // ASCII
        const char = byte >= 0x20 && byte < 0x7F ? String.fromCharCode(byte) : '.';
        ctx.fillStyle = isSelected ? '#fff' : (byte >= 0x20 && byte < 0x7F ? '#a0a0b0' : '#404040');
        ctx.fillText(char, ax, y + ROW_H / 2);
      }
    }
  }

  _onClick(e) {
    if (!this.data) return;
    this.evLayer.focus();
    const rect = this.evLayer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top + this._scrollTop;
    const row = Math.floor(y / ROW_H);

    // Determine column from x position
    let col = -1;
    if (x >= HEX_START && x < ASCII_START - 8) {
      for (let c = 0; c < BYTES_PER_ROW; c++) {
        const cx = hexX(c);
        if (x >= cx - 2 && x < cx + HEX_CELL_W) { col = c; break; }
      }
    } else if (x >= ASCII_START) {
      col = Math.floor((x - ASCII_START) / ASCII_CELL_W);
      col = Math.max(0, Math.min(BYTES_PER_ROW - 1, col));
    }

    if (col >= 0) {
      this.selectedOffset = row * BYTES_PER_ROW + col;
      this.editNibble = 0;
      this._render();
    }
  }

  _onKey(e) {
    if (!this.data || this.selectedOffset < 0) return;
    const len = this.data.length;

    if (e.key === 'ArrowRight') { this._move(1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { this._move(-1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this._move(BYTES_PER_ROW); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { this._move(-BYTES_PER_ROW); e.preventDefault(); }
    else if (e.key === 'Home') { this.selectedOffset = Math.floor(this.selectedOffset / BYTES_PER_ROW) * BYTES_PER_ROW; this._render(); }
    else if (e.key === 'End') { this.selectedOffset = Math.floor(this.selectedOffset / BYTES_PER_ROW) * BYTES_PER_ROW + BYTES_PER_ROW - 1; this._ensureVisible(); this._render(); }
    else if (/^[0-9a-fA-F]$/.test(e.key)) {
      this._editNibble(parseInt(e.key, 16));
      e.preventDefault();
    }
  }

  _move(delta) {
    this.selectedOffset = Math.max(0, Math.min(this.data.length - 1, this.selectedOffset + delta));
    this.editNibble = 0;
    this._ensureVisible();
    this._render();
  }

  _ensureVisible() {
    const row = Math.floor(this.selectedOffset / BYTES_PER_ROW);
    const y = row * ROW_H;
    const h = this.wrap.clientHeight;
    if (y < this._scrollTop) {
      this.scroller.scrollTop = y;
    } else if (y + ROW_H > this._scrollTop + h) {
      this.scroller.scrollTop = y + ROW_H - h;
    }
  }

  _editNibble(nibble) {
    const offset = this.selectedOffset;
    let byte = this.data[offset];
    if (this.editNibble === 0) {
      byte = (nibble << 4) | (byte & 0x0F);
    } else {
      byte = (byte & 0xF0) | nibble;
    }
    this.data[offset] = byte;
    this.modified.add(offset);
    if (this.onByteChange) this.onByteChange(offset, byte);

    this.editNibble = 1 - this.editNibble;
    if (this.editNibble === 0) this._move(1);
    else this._render();
  }

  getModifiedBytes() {
    const result = [];
    for (const offset of this.modified) {
      result.push({ offset, value: this.data[offset] });
    }
    return result.sort((a, b) => a.offset - b.offset);
  }

  clearModified() {
    this.modified.clear();
    this._render();
  }

  // Patch bytes from external source (e.g., map editor)
  patchBytes(offset, bytes) {
    for (let i = 0; i < bytes.length; i++) {
      this.data[offset + i] = bytes[i];
      this.modified.add(offset + i);
    }
    this._render();
  }
}
