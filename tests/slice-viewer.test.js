// Verifies the slice viewer: clicking a row or column header of a MAP opens a
// modal with a Chart.js line chart of that slice's values.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
const DOCS = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-slice', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Known 6×6 map with a monotonic ramp so we can check values end up on the chart.
    const NX = 6, NY = 6;
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(NX, MAP_ADDR);
    rom.writeInt16BE(NY, MAP_ADDR + 2);
    for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
    for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
    const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
    for (let yi = 0; yi < NY; yi++) {
      for (let xi = 0; xi < NX; xi++) {
        // raw = 100 + xi*100 + yi*50, phys = raw*0.1 = 10 + xi*10 + yi*5
        rom.writeInt16BE(100 + xi * 100 + yi * 50, dataOff + (yi * NX + xi) * 2);
      }
    }

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-wrap canvas', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.fill('.sidebar input[type="search"]', MAP_NAME);
    await page.waitForSelector('.param-item', { timeout: 3000 });
    await page.click('.param-item');
    await page.waitForSelector('#map-grid-table', { timeout: 3000 });
    await page.waitForTimeout(300);

    // ── Click a row header (Y=2) → modal should show a line chart of that row.
    await page.click('th.map-slice-th[data-slice="row"][data-idx="2"]');
    await page.waitForSelector('.map-slice-overlay', { timeout: 3000 });
    const title = await page.$eval('.map-slice-modal h2', el => el.textContent);
    if (!/ligne/i.test(title)) throw new Error(`modal title should mention "ligne", got "${title}"`);
    console.log('row slice title:', title);

    await page.waitForTimeout(500); // Chart.js render

    const pix = await page.$eval('#map-slice-canvas', c => {
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) colored++;
      }
      return { colored, w: c.width, h: c.height };
    });
    console.log('row slice canvas:', pix);
    if (pix.colored < 500) throw new Error(`row slice canvas looks empty: ${pix.colored}`);

    // Also: the info line should mention the min/max of this row.
    // Row 2: raw 100+xi*100+yi*50 with yi=2 → 200+xi*100 for xi 0..5 → [200,300,...,700]
    // phys: [20, 30, 40, 50, 60, 70]. min=20 max=70
    const infoText = await page.$eval('.map-slice-info', el => el.textContent);
    console.log('row info:', infoText.trim());
    if (!infoText.includes('20.00') || !infoText.includes('70.00')) {
      throw new Error(`row info missing 20.00/70.00: "${infoText}"`);
    }

    await page.screenshot({ path: path.join(OUT, 'slice-row.png'), fullPage: false });
    fs.copyFileSync(path.join(OUT, 'slice-row.png'), path.join(DOCS, 'slice-viewer.png'));
    console.log('  📸 slice-viewer.png');

    // ESC closes
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const stillThere = await page.$('.map-slice-overlay');
    if (stillThere) throw new Error('ESC did not close the slice modal');

    // ── Click a column header (X=3) → column chart of that column.
    await page.click('th.map-slice-th[data-slice="col"][data-idx="3"]');
    await page.waitForSelector('.map-slice-overlay', { timeout: 3000 });
    const colTitle = await page.$eval('.map-slice-modal h2', el => el.textContent);
    if (!/colonne/i.test(colTitle)) throw new Error(`modal title should mention "colonne", got "${colTitle}"`);
    console.log('col slice title:', colTitle);

    // Column 3: raw 100+3*100+yi*50 = 400+yi*50 for yi 0..5 → [400,450,500,550,600,650]
    // phys: [40, 45, 50, 55, 60, 65]. min=40 max=65
    const colInfo = await page.$eval('.map-slice-info', el => el.textContent);
    console.log('col info:', colInfo.trim());
    if (!colInfo.includes('40.00') || !colInfo.includes('65.00')) {
      throw new Error(`col info missing 40.00/65.00: "${colInfo}"`);
    }

    // Click on overlay background (outside the modal) → close
    const box = await page.$eval('.map-slice-overlay', el => {
      const r = el.getBoundingClientRect();
      return { x: r.x + 10, y: r.y + 10 };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(150);
    const stillOpen = await page.$('.map-slice-overlay');
    if (stillOpen) throw new Error('click outside modal did not close it');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-slice.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
