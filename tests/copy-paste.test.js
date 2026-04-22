// Verifies Ctrl-C / Ctrl-V on map selections:
// - copying a rectangle of values into the in-memory clipboard
// - pasting into a target selection overwrites the right cells
// - Ctrl-Z after paste reverts the whole paste in one shot

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200; // 0x1C1448

async function selectCellRange(page, x0, y0, x1, y1) {
  // Click the anchor cell to clear the previous selection, then ctrl-click the
  // rest. The map editor's mousedown handler toggles each cell without
  // clearing when a modifier key is down — effectively building a rectangle
  // by explicit clicks. Avoids relying on Playwright dispatching mouseover
  // events during a drag, which proved flaky with small 4×4 cells.
  await page.click(`#map-grid-table input[data-xi="${x0}"][data-yi="${y0}"]`);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === x0 && y === y0) continue;
      await page.click(`#map-grid-table input[data-xi="${x}"][data-yi="${y}"]`, { modifiers: ['Control'] });
    }
  }
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
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-copy', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Synthetic ROM with a known 4×4 grid where each cell is unique, so we can
    // tell copied/pasted cells apart from untouched ones.
    const NX = 4, NY = 4;
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(NX, MAP_ADDR);
    rom.writeInt16BE(NY, MAP_ADDR + 2);
    for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
    for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
    const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
    for (let yi = 0; yi < NY; yi++) {
      for (let xi = 0; xi < NX; xi++) {
        // raw value = yi*10 + xi+1 → phys (factor 0.1) = yi + (xi+1)/10
        // i.e. (0,0)=0.1, (1,0)=0.2, ..., (0,1)=1.1, ..., (3,3)=3.4
        rom.writeInt16BE(yi * 10 + xi + 1, dataOff + (yi * NX + xi) * 2);
      }
    }

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-wrap canvas', { timeout: 5000 });
    await page.waitForTimeout(400);
    const search = await page.$('.sidebar input[type="search"]');
    await search.fill(MAP_NAME);
    await page.waitForSelector('.param-item', { timeout: 3000 });
    await page.click('.param-item');
    await page.waitForSelector('#map-grid-table', { timeout: 3000 });
    await page.waitForTimeout(300);

    const cell = async (x, y) => parseFloat(await page.$eval(
      `#map-grid-table input[data-xi="${x}"][data-yi="${y}"]`, el => el.value));

    // Sanity: starting values
    const before = [];
    for (let y = 0; y < NY; y++) { const row = []; for (let x = 0; x < NX; x++) row.push(await cell(x, y)); before.push(row); }
    console.log('before:', before.map(r => r.map(v => v.toFixed(1)).join(' ')).join(' | '));

    // Select a 2×2 rectangle at (0,0)..(1,1) and Ctrl-C
    await selectCellRange(page, 0, 0, 1, 1);
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+c');
    await page.waitForTimeout(150);

    // Now select the bottom-right 2×2 rectangle at (2,2)..(3,3) and Ctrl-V
    await selectCellRange(page, 2, 2, 3, 3);
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);

    // Expect (2,2)=(0,0)_before, (3,2)=(1,0)_before, (2,3)=(0,1)_before, (3,3)=(1,1)_before
    const after22 = await cell(2, 2);
    const after32 = await cell(3, 2);
    const after23 = await cell(2, 3);
    const after33 = await cell(3, 3);
    console.log('after paste: (2,2)=', after22, '(3,2)=', after32, '(2,3)=', after23, '(3,3)=', after33);
    const want = [before[0][0], before[0][1], before[1][0], before[1][1]];
    const got = [after22, after32, after23, after33];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(got[i] - want[i]) > 0.05) {
        throw new Error(`paste mismatch at index ${i}: expected ${want[i]}, got ${got[i]}`);
      }
    }

    // Cells outside the paste region must be unchanged
    const still01 = await cell(0, 1);
    if (Math.abs(still01 - before[1][0]) > 0.05) throw new Error(`cell (0,1) changed unexpectedly: ${still01}`);

    // Single Ctrl-Z reverts the whole paste at once (paste = one batch)
    await page.click('.map-toolbar'); // blur away from any cell input
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const backs = [await cell(2, 2), await cell(3, 2), await cell(2, 3), await cell(3, 3)];
    const origs = [before[2][2], before[2][3], before[3][2], before[3][3]];
    console.log('after undo:', backs);
    for (let i = 0; i < 4; i++) {
      if (Math.abs(backs[i] - origs[i]) > 0.05) {
        throw new Error(`undo did not restore cell ${i}: expected ${origs[i]}, got ${backs[i]}`);
      }
    }

    await page.screenshot({ path: path.join(OUT, 'copy-paste.png'), fullPage: false });
    console.log('  📸 copy-paste.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-copy-paste.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
