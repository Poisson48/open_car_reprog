// Verifies the map editor renders correctly for non-default DAMOS layouts:
// - Kf_Xu16_Yu16_Wu16 : 2D MAP with unsigned 16-bit everywhere (incl. inline
//   NO_AXIS_PTS_X/Y as UWORD, not the SWORD default)
// - Kl_Xs16_Ws16     : 1D CURVE with inline NO_AXIS_PTS_X header

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// Synthetic A2L with two custom layouts, placed on a 2 MB ROM:
//   U16_MAP   at 0x100000 — 4×4 unsigned 16-bit (inline N as UWORD)
//   MY_CURVE  at 0x200000 — 8-point signed 16-bit curve (inline N as SWORD)
const MAP_ADDR = 0x100000;
const CURVE_ADDR = 0x180000;

const A2L = `ASAP2_VERSION 1 70
/begin PROJECT DEMO "layouts test"
  /begin MODULE DIM ""

    /begin COMPU_METHOD NO_COMPU_METHOD
      "No conversion"
      IDENTICAL "%.3" "-"
    /end COMPU_METHOD

    /begin RECORD_LAYOUT Kf_Xu16_Yu16_Wu16
      NO_AXIS_PTS_X 1 UWORD
      NO_AXIS_PTS_Y 2 UWORD
      AXIS_PTS_X 3 UWORD INDEX_INCR DIRECT
      AXIS_PTS_Y 4 UWORD INDEX_INCR DIRECT
      FNC_VALUES 5 UWORD COLUMN_DIR DIRECT
    /end RECORD_LAYOUT

    /begin RECORD_LAYOUT Kl_Xs16_Ws16
      NO_AXIS_PTS_X 1 SWORD
      AXIS_PTS_X 2 SWORD INDEX_INCR DIRECT
      FNC_VALUES 3 SWORD COLUMN_DIR DIRECT
    /end RECORD_LAYOUT

    /begin CHARACTERISTIC U16_MAP
      "unsigned 2D map"
      MAP 0x100000 Kf_Xu16_Yu16_Wu16 0 NO_COMPU_METHOD 0 65535
      /begin AXIS_DESCR STD_AXIS RPM NO_COMPU_METHOD 16 0 65535
      /end AXIS_DESCR
      /begin AXIS_DESCR STD_AXIS Nm NO_COMPU_METHOD 16 0 65535
      /end AXIS_DESCR
    /end CHARACTERISTIC

    /begin CHARACTERISTIC MY_CURVE
      "signed 1D curve"
      CURVE 0x180000 Kl_Xs16_Ws16 0 NO_COMPU_METHOD -32768 32767
      /begin AXIS_DESCR STD_AXIS RPM NO_COMPU_METHOD 16 0 8000
      /end AXIS_DESCR
    /end CHARACTERISTIC

  /end MODULE
/end PROJECT
`;

function buildRom() {
  const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);

  // U16_MAP @ 0x100000 — 4×4 unsigned
  const NX = 4, NY = 4;
  rom.writeUInt16BE(NX, MAP_ADDR);
  rom.writeUInt16BE(NY, MAP_ADDR + 2);
  for (let i = 0; i < NX; i++) rom.writeUInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
  for (let i = 0; i < NY; i++) rom.writeUInt16BE(10 + i * 10, MAP_ADDR + 4 + 8 + i * 2);
  const mapDataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
  for (let yi = 0; yi < NY; yi++) {
    for (let xi = 0; xi < NX; xi++) {
      // Values that would overflow SWORD — only readable correctly as UWORD
      // Cell (0,0)=40000, (1,0)=40100, ...  up to (3,3)=41500
      rom.writeUInt16BE(40000 + (yi * NX + xi) * 100, mapDataOff + (yi * NX + xi) * 2);
    }
  }

  // MY_CURVE @ 0x200000 — 6 points (inline N says 6, even though A2L max=16)
  const N = 6;
  rom.writeInt16BE(N, CURVE_ADDR);                                // inline N
  for (let i = 0; i < N; i++) rom.writeInt16BE(1000 + i * 1000, CURVE_ADDR + 2 + i * 2);  // axis
  for (let i = 0; i < N; i++) rom.writeInt16BE(-100 + i * 200, CURVE_ADDR + 2 + N * 2 + i * 2); // data, spans -100..+900

  return rom;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-layouts', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Upload ROM + custom A2L
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: buildRom() } }
    });
    const up = await page.request.post(URL + `/api/projects/${id}/a2l`, {
      multipart: { a2l: { name: 'layouts.a2l', mimeType: 'application/octet-stream', buffer: Buffer.from(A2L) } }
    });
    if (!up.ok()) throw new Error('A2L upload failed: ' + await up.text());
    const info = await up.json();
    if (info.characteristicsCount !== 2) throw new Error(`expected 2 params, got ${info.characteristicsCount}`);

    await page.goto(URL + '/#/project/' + id);
    await page.waitForTimeout(500);

    const openAndRead = async (name) => {
      await page.fill('.sidebar input[type="search"]', '');
      await page.waitForTimeout(80);
      await page.fill('.sidebar input[type="search"]', name);
      await page.waitForSelector('.param-item', { timeout: 3000 });
      await page.waitForTimeout(100);
      await page.click('.param-item');
      // MAP uses id="map-grid-table"; CURVE renders a plain .map-table
      await page.waitForSelector('table.map-table', { timeout: 3000 });
      await page.waitForTimeout(200);
      return page.$$eval('table.map-table input[data-xi]', els =>
        els.map(e => ({ xi: +e.dataset.xi, yi: +e.dataset.yi, v: parseFloat(e.value) }))
      );
    };

    // ── U16_MAP: should read 16 cells with values 40000..41500
    const mapVals = await openAndRead('U16_MAP');
    console.log('U16_MAP cells:', mapVals.length, 'samples:', mapVals.slice(0, 4));
    if (mapVals.length !== 16) throw new Error(`expected 16 cells, got ${mapVals.length}`);

    const getCell = (x, y) => mapVals.find(c => c.xi === x && c.yi === y)?.v;
    const c00 = getCell(0, 0);
    const c33 = getCell(3, 3);
    console.log(`cell(0,0)=${c00}, cell(3,3)=${c33}`);
    if (Math.abs(c00 - 40000) > 1) throw new Error(`(0,0) expected 40000, got ${c00} (would be a negative number if read as SWORD)`);
    if (Math.abs(c33 - 41500) > 1) throw new Error(`(3,3) expected 41500, got ${c33}`);

    await page.screenshot({ path: path.join(OUT, 'layout-u16-map.png'), fullPage: false });

    // ── MY_CURVE: 6 cells with values -100..+900
    // The A2L declares max=16, but inline N says 6 → must use 6
    const curveVals = await openAndRead('MY_CURVE');
    console.log('MY_CURVE cells:', curveVals.length, 'samples:', curveVals);
    if (curveVals.length !== 6) throw new Error(`expected 6 cells (inline N), got ${curveVals.length}`);

    const first = curveVals.find(c => c.xi === 0)?.v;
    const last = curveVals.find(c => c.xi === 5)?.v;
    if (Math.abs(first - (-100)) > 1) throw new Error(`curve(0) expected -100, got ${first}`);
    if (Math.abs(last - 900) > 1) throw new Error(`curve(5) expected 900, got ${last}`);

    await page.screenshot({ path: path.join(OUT, 'layout-curve.png'), fullPage: false });

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-layouts.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
