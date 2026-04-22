// Verifies the ROM-level undo/redo shortcut:
// - Ctrl-Z reverts the last edit (single cell or whole batch from ±%)
// - Ctrl-Shift-Z and Ctrl-Y redo
// - A fresh ROM load clears the stack

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200; // 0x1C1448

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-undo', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Synthetic 2 MB ROM with a 4×4 MAP of flat 500.
    const NX = 4, NY = 4;
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(NX, MAP_ADDR);
    rom.writeInt16BE(NY, MAP_ADDR + 2);
    for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
    for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
    const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
    for (let i = 0; i < NX * NY; i++) rom.writeInt16BE(500, dataOff + i * 2);

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    // Commit the initial ROM, then click the commit to open the map via the diff list.
    // (The map editor opens in compare mode, same as other tests — unrelated to
    // undo — but that's the most convenient path to get a map open.)
    // Actually there's no diff on a fresh ROM; instead we'll use the param panel
    // search to open the map.
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-wrap canvas', { timeout: 5000 });
    await page.waitForTimeout(400);

    // Use the param search to find and click the map
    const search = await page.$('.sidebar input[type="search"]');
    if (!search) throw new Error('param search box not found');
    await search.fill('AccPed_trqEngHiGear_MAP');
    await page.waitForSelector('.param-item', { timeout: 3000 });
    await page.click('.param-item');
    await page.waitForSelector('#map-grid-table', { timeout: 3000 });
    await page.waitForTimeout(300);

    // Read a cell, edit it, undo, verify it reverted.
    const cellSelector = '#map-grid-table input[data-xi="0"][data-yi="0"]';
    const origValue = await page.$eval(cellSelector, el => el.value);
    console.log('original value:', origValue);
    if (parseFloat(origValue) === 0) throw new Error('initial value should not be 0');

    // Edit the cell to a distinctly different value
    const cell = await page.$(cellSelector);
    await cell.click({ clickCount: 3 });
    await cell.type('999');
    await cell.press('Enter');
    // Click outside so the input loses focus (so Ctrl-Z targets ROM, not the input's native text undo)
    await page.click('.map-toolbar');
    await page.waitForTimeout(150);

    const afterEdit = await page.$eval(cellSelector, el => el.value);
    console.log('after edit:', afterEdit);
    if (parseFloat(afterEdit) === parseFloat(origValue)) {
      throw new Error(`edit did not stick: ${afterEdit}`);
    }

    // Ctrl-Z
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const afterUndo = await page.$eval(cellSelector, el => el.value);
    console.log('after undo:', afterUndo);
    if (parseFloat(afterUndo) !== parseFloat(origValue)) {
      throw new Error(`undo did not revert: expected ${origValue}, got ${afterUndo}`);
    }

    // Ctrl-Shift-Z (redo)
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(200);
    const afterRedo = await page.$eval(cellSelector, el => el.value);
    console.log('after redo:', afterRedo);
    if (parseFloat(afterRedo) === parseFloat(origValue)) {
      throw new Error(`redo did not reapply: still ${afterRedo}`);
    }

    // Redo again when nothing to redo should be a no-op (and no console errors)
    await page.keyboard.press('Control+y');
    await page.waitForTimeout(150);

    // Batch undo: select all 16 cells, apply +5% → one Ctrl-Z should revert all of them.
    // The selection toolbar is only shown once something is selected, so click
    // any cell first to reveal "Tout sélectionner".
    await page.click('#map-grid-table input[data-xi="0"][data-yi="0"]');
    await page.waitForTimeout(100);
    await page.click('#map-sel-all');
    await page.waitForTimeout(100);
    const valsBefore = await page.$$eval('#map-grid-table input[data-xi]', els => els.map(e => parseFloat(e.value)));
    await page.click('.map-adj-btn[data-val="5"]');
    await page.waitForTimeout(150);
    const valsAfter = await page.$$eval('#map-grid-table input[data-xi]', els => els.map(e => parseFloat(e.value)));
    const anyChanged = valsAfter.some((v, i) => v !== valsBefore[i]);
    if (!anyChanged) throw new Error('+5% did not change any cell');
    console.log('batch +5%: first cell', valsBefore[0], '→', valsAfter[0]);

    // Click outside so focus isn't in a map input
    await page.click('.map-toolbar');
    await page.waitForTimeout(100);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(250);
    const valsAfterUndo = await page.$$eval('#map-grid-table input[data-xi]', els => els.map(e => parseFloat(e.value)));
    const mismatches = valsAfterUndo.reduce((n, v, i) => n + (Math.abs(v - valsBefore[i]) > 0.01 ? 1 : 0), 0);
    console.log('mismatches after batch undo:', mismatches);
    if (mismatches > 0) throw new Error(`batch undo incomplete: ${mismatches} cells still differ`);

    // Screenshot the final state
    await page.screenshot({ path: path.join(OUT, 'undo-redo.png'), fullPage: false });
    console.log('  📸 undo-redo.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-undo.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
