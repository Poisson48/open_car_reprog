const unzipper = require('unzipper');

class WinolsParser {
  async parse(buffer, filename) {
    const ext = (filename || '').toLowerCase();

    // ZIP-based OLS (WinOLS 3.x and some exports)
    if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
      return await this._parseZip(buffer, filename);
    }

    // Intel HEX format
    if (ext.endsWith('.hex') || (buffer[0] === 0x3A && this._looksLikeHex(buffer))) {
      return { rom: this._parseIntelHex(buffer), filename: filename.replace(/\.hex$/i, '.bin') };
    }

    // Raw binary fallback
    return { rom: buffer, filename: ext.endsWith('.bin') ? filename : filename + '.bin' };
  }

  async _parseZip(buffer, filename) {
    const dir = await unzipper.Open.buffer(buffer);
    const files = dir.files;

    // Find the largest binary file (likely the ROM)
    const binFiles = files
      .filter(f => !f.path.endsWith('/'))
      .sort((a, b) => b.uncompressedSize - a.uncompressedSize);

    if (binFiles.length === 0) throw new Error('No files found in ZIP');

    const romFile = binFiles[0];
    const rom = await romFile.buffer();
    return { rom, filename: romFile.path, maps: [] };
  }

  _looksLikeHex(buffer) {
    const sample = buffer.slice(0, 80).toString('ascii');
    return /^:[0-9A-Fa-f]{10,}/.test(sample);
  }

  _parseIntelHex(buffer) {
    const lines = buffer.toString('ascii').split(/\r?\n/);
    let maxAddr = 0;
    const segments = [];
    let extAddr = 0;

    for (const line of lines) {
      if (!line.startsWith(':')) continue;
      const bytes = Buffer.from(line.slice(1), 'hex');
      const count = bytes[0];
      const addr = (bytes[1] << 8) | bytes[2];
      const type = bytes[3];

      if (type === 0x00) { // Data
        const fullAddr = extAddr + addr;
        segments.push({ addr: fullAddr, data: bytes.slice(4, 4 + count) });
        maxAddr = Math.max(maxAddr, fullAddr + count);
      } else if (type === 0x02) { // Extended segment address
        extAddr = ((bytes[4] << 8) | bytes[5]) << 4;
      } else if (type === 0x04) { // Extended linear address
        extAddr = ((bytes[4] << 8) | bytes[5]) << 16;
      } else if (type === 0x01) { // EOF
        break;
      }
    }

    const rom = Buffer.alloc(maxAddr, 0xFF);
    for (const seg of segments) {
      seg.data.copy(rom, seg.addr);
    }
    return rom;
  }
}

module.exports = WinolsParser;
