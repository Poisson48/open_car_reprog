// 3D overlay mode: renders compareRom as white wireframe + current ROM as
// filled heatmap in the same 3D box. User toggles via the mode button
// (value → delta → split → overlay → value).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let projectId;

  try {
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: '_3D_OVERLAY_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Open map, modify, commit → +10% again so HEAD parent exists and differs
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);
    await (await page.$('#map-grid-table td')).click();
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="10"]', { force: true });
    await page.waitForTimeout(400);
    await page.fill('#git-commit-msg', 'step 1');
    await page.click('#git-commit-btn');
    await page.waitForTimeout(1500);

    await (await page.$('#map-grid-table td')).click();
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="10"]', { force: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(1200);

    // Δ vs parent loads compareRom and switches to 3D delta mode
    await page.click('#map-cmp-parent');
    await page.waitForTimeout(1200);

    // Cycle mode: delta → split → overlay
    await page.click('#map-3d-mode'); // delta → split
    await page.waitForTimeout(300);
    await page.click('#map-3d-mode'); // split → overlay
    await page.waitForTimeout(600);

    const modeLabel = await page.textContent('#map-3d-mode');
    console.log('  mode label:', modeLabel.trim());
    // After clicking twice from delta, we should now be in overlay mode.
    // The button label shows the NEXT mode in the cycle → "🎨 Valeur" means we're in overlay.
    assert(/valeur/i.test(modeLabel), `mode button should cycle to show "Valeur" label (meaning current is overlay): got "${modeLabel}"`);

    // Verify canvas has rendered overlay : check for both a wireframe line (near-white pixel)
    // and a colored fill pixel. Sampling across a grid of points.
    const hasBoth = await page.evaluate(() => {
      const c = document.querySelector('#map-heatmap');
      if (!c) return null;
      const ctx = c.getContext('2d');
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      let sawWhiteish = false, sawColored = false;
      for (let i = 0; i < img.length; i += 4) {
        const r = img[i], g = img[i + 1], b = img[i + 2];
        if (r > 200 && g > 200 && b > 200) sawWhiteish = true;
        else if ((r > 80 || g > 80 || b > 80) && !(r === g && g === b)) sawColored = true;
        if (sawWhiteish && sawColored) break;
      }
      return { sawWhiteish, sawColored };
    });
    console.log('  canvas scan:', hasBoth);
    assert(hasBoth?.sawColored, 'overlay must render filled heatmap quads');
    assert(hasBoth?.sawWhiteish, 'overlay must render white wireframe lines');

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'map-3d-overlay.png') });
    console.log('✅ map-3d-overlay test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
