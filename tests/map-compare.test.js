// Verifies the map editor enters compare mode when a user clicks a map in the
// git diff list, and renders per-cell delta borders (red for decrease, green
// for increase) on the changed cells.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200; // 0x1C1448

async function patch(page, id, off, bytes) {
  const buf = Buffer.from(bytes);
  return page.request.patch(URL + `/api/projects/${id}/rom/bytes`, {
    data: { offset: off, data: buf.toString('base64') }
  });
}
async function commit(page, id, msg) {
  return page.request.post(URL + `/api/projects/${id}/git/commit`, { data: { message: msg } });
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
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-compare', ecu: 'edc16c34' }
    });
    id = (await proj.json()).id;

    // Synthetic 2 MB ROM with a MAP structure at MAP_ADDR: 4x4, values=500
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(4, MAP_ADDR);       // nx
    rom.writeInt16BE(4, MAP_ADDR + 2);   // ny
    for (let i = 0; i < 4; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);       // X axis
    for (let i = 0; i < 4; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + 8 + i * 2);      // Y axis
    const dataOff = MAP_ADDR + 4 + 4 * 2 + 4 * 2; // 20
    for (let i = 0; i < 16; i++) rom.writeInt16BE(500, dataOff + i * 2);

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    // Modify 3 cells: cell[0] 500→700 (+200), cell[5] 500→400 (-100), cell[10] 500→500 (no change via out-of-range to test)
    const b = (v) => { const x = Buffer.alloc(2); x.writeInt16BE(v, 0); return x.toString('base64'); };
    await patch(page, id, dataOff + 0 * 2, [0x02, 0xBC]);     // 700
    await patch(page, id, dataOff + 5 * 2, [0x01, 0x90]);     // 400
    await patch(page, id, dataOff + 10 * 2, [0x03, 0xE8]);    // 1000
    await commit(page, id, 'Tune AccPed +200/-100/+500 on 3 cells');

    // Open UI
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('.git-entry', { timeout: 5000 });
    await page.waitForTimeout(500);

    // Click the first commit (most recent) to open the diff
    await page.click('.git-entry:first-child');
    await page.waitForSelector('.map-diff-row', { timeout: 3000 });
    await page.waitForTimeout(200);

    // Find the MAP row and click it
    const rows = await page.$$('.map-diff-row');
    let clicked = false;
    for (const r of rows) {
      const name = await r.getAttribute('data-name');
      if (name === MAP_NAME) { await r.click(); clicked = true; break; }
    }
    if (!clicked) throw new Error(`Did not find ${MAP_NAME} row in diff`);
    await page.waitForTimeout(600);

    // Expect compare banner
    const banner = await page.$('.map-compare-banner');
    if (!banner) throw new Error('Compare banner not shown');
    const bannerText = await banner.textContent();
    console.log('banner:', bannerText);
    if (!bannerText.includes('Comparaison')) throw new Error('Banner text missing "Comparaison"');

    // Expect at least 3 cells with box-shadow (the 3 we modified)
    const highlighted = await page.$$eval('#map-grid-table td', tds =>
      tds.filter(td => td.style.boxShadow && td.style.boxShadow !== 'none').length
    );
    console.log('highlighted cells:', highlighted);
    if (highlighted < 3) throw new Error(`Expected ≥3 highlighted cells, got ${highlighted}`);

    // Verify at least one green + at least one red
    const colors = await page.$$eval('#map-grid-table td', tds =>
      tds.filter(td => td.style.boxShadow).map(td => td.style.boxShadow)
    );
    const greens = colors.filter(c => c.includes('4ec9b0') || c.includes('rgb(78, 201, 176)')).length;
    const reds = colors.filter(c => c.includes('f44747') || c.includes('rgb(244, 71, 71)')).length;
    console.log('greens:', greens, 'reds:', reds);
    if (greens < 1) throw new Error(`Expected ≥1 green cell, got ${greens}`);
    if (reds < 1) throw new Error(`Expected ≥1 red cell, got ${reds}`);

    // Hover first highlighted cell → tooltip should show previous→current
    const firstInput = await page.$('#map-grid-table input[data-xi="0"][data-yi="0"]');
    if (firstInput) {
      const title = await firstInput.getAttribute('title');
      console.log('cell(0,0) title:', title);
      if (!title || !/[-+]?\d+(\.\d+)?.*→.*[-+]?\d+(\.\d+)?/.test(title)) {
        throw new Error(`tooltip missing numeric transition, got "${title}"`);
      }
    }

    // Screenshot
    await page.waitForTimeout(200);
    const pane = await page.$('#map-editor-pane');
    if (pane) await pane.screenshot({ path: path.join(OUT, 'map-compare.png') });
    console.log('  📸 map-compare.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-compare.png') });
    console.log('\n❌', e.message);
    msgs.slice(-10).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
