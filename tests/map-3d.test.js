// Verifies the 3D surface view for MAP parameters:
// - toggle button switches between 2D heatmap and 3D surface
// - the canvas renders quads (non-empty pixels)
// - drag rotates the view (the canvas pixel output changes)
// - cell edits in the 2D table refresh the 3D surface

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
const DOCS = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

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
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-3d', ecu: 'edc16c34' }
    });
    id = (await proj.json()).id;

    // Build a synthetic 2 MB ROM with a 8×8 map at MAP_ADDR that has a clear
    // "hill" pattern so the 3D surface is visually obvious in screenshots.
    const NX = 8, NY = 8;
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(NX, MAP_ADDR);
    rom.writeInt16BE(NY, MAP_ADDR + 2);
    for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
    for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
    const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
    for (let yi = 0; yi < NY; yi++) {
      for (let xi = 0; xi < NX; xi++) {
        // Gaussian-ish hill centered at (3.5, 3.5)
        const dx = xi - 3.5, dy = yi - 3.5;
        const z = Math.round(200 + 800 * Math.exp(-(dx * dx + dy * dy) / 6));
        rom.writeInt16BE(z, dataOff + (yi * NX + xi) * 2);
      }
    }

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    // Create a small committed change so we can open the map via the diff list.
    await patch(page, id, dataOff + 0, [0x02, 0xBC]); // 700 at cell (0,0)
    await commit(page, id, 'Raise corner cell to 700');

    // Open UI, click the first git entry, then click the map diff row.
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('.git-entry', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('.git-entry:first-child');
    await page.waitForSelector('.map-diff-row', { timeout: 3000 });

    const rows = await page.$$('.map-diff-row');
    let clicked = false;
    for (const r of rows) {
      if ((await r.getAttribute('data-name')) === MAP_NAME) { await r.click(); clicked = true; break; }
    }
    if (!clicked) throw new Error(`did not find ${MAP_NAME} in diff list`);
    await page.waitForTimeout(400);

    // The 3D toggle must be present for MAP type
    const toggle = await page.$('#map-toggle-3d');
    if (!toggle) throw new Error('3D toggle button not rendered');

    // Screenshot 2D state first
    const pane = await page.$('#map-editor-pane');
    await pane.screenshot({ path: path.join(OUT, 'map-3d-before.png') });

    // Click the 3D button — this triggers a re-render of the toolbar, so the
    // ElementHandle above is now detached. Re-query to inspect the new label.
    await toggle.click();
    await page.waitForTimeout(400);
    const labelAfter = (await page.$eval('#map-toggle-3d', b => b.textContent.trim()));
    if (!/2D/.test(labelAfter)) throw new Error(`Toggle label should read "2D" after switching, got "${labelAfter}"`);

    // The map-content should have the view-3d class
    const hasClass = await page.$eval('.map-content', el => el.classList.contains('view-3d'));
    if (!hasClass) throw new Error('.map-content.view-3d not applied');

    // The canvas should have non-trivial pixel content (3D surface drawn)
    const pixelsBefore = await page.$eval('#map-heatmap', c => {
      const ctx = c.getContext('2d');
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 16) {
        // count pixels that are not pure black / dark background
        if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) colored++;
      }
      return { colored, w: c.width, h: c.height };
    });
    console.log('3D canvas pixels:', pixelsBefore);
    if (pixelsBefore.colored < 1000) throw new Error(`3D canvas looks empty: ${pixelsBefore.colored} colored samples`);

    await pane.screenshot({ path: path.join(OUT, 'map-3d.png') });
    fs.copyFileSync(path.join(OUT, 'map-3d.png'), path.join(DOCS, 'map-3d.png'));
    console.log('  📸 map-3d.png');

    // Drag to rotate the view, assert the canvas output changed
    const canvasBox = await page.$eval('#map-heatmap', c => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const startX = canvasBox.x + canvasBox.w / 2;
    const startY = canvasBox.y + canvasBox.h / 2;
    // Sample a region in the center of the canvas — that's where the surface
    // actually is, so rotations will change pixels there (top-left stays
    // background).
    const sampleCenter = () => page.$eval('#map-heatmap', c => {
      const ctx = c.getContext('2d');
      const w = Math.min(200, c.width), h = Math.min(200, c.height);
      const x = Math.max(0, (c.width - w) >> 1), y = Math.max(0, (c.height - h) >> 1);
      const d = ctx.getImageData(x, y, w, h).data;
      // Cheap hash of pixel values
      let hash = 0;
      for (let i = 0; i < d.length; i += 8) hash = (hash * 31 + d[i] + d[i + 1] * 7) | 0;
      return hash;
    });
    const snapBefore = await sampleCenter();
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 150, startY - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const snapAfter = await sampleCenter();
    if (snapBefore === snapAfter) throw new Error('Drag did not change the 3D view');
    console.log('drag rotated the view ✓');

    await pane.screenshot({ path: path.join(OUT, 'map-3d-rotated.png') });
    fs.copyFileSync(path.join(OUT, 'map-3d-rotated.png'), path.join(DOCS, 'map-3d-rotated.png'));
    console.log('  📸 map-3d-rotated.png');

    // Edit a cell in the 2D table; the 3D surface should refresh.
    const cell = await page.$('#map-grid-table input[data-xi="3"][data-yi="3"]');
    if (cell) {
      const snapPre = await sampleCenter();
      await cell.click({ clickCount: 3 });
      await cell.type('2000');
      await cell.press('Enter');
      await page.waitForTimeout(200);
      const snapPost = await sampleCenter();
      if (snapPre === snapPost) throw new Error('Cell edit did not refresh 3D surface');
      console.log('cell edit refreshed 3D surface ✓');
    }

    // Toggle back to 2D
    await page.click('#map-toggle-3d');
    await page.waitForTimeout(200);
    const labelBack = await page.$eval('#map-toggle-3d', b => b.textContent.trim());
    if (!/3D/.test(labelBack)) throw new Error(`Toggle label should read "3D" after switching back, got "${labelBack}"`);

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-3d.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
