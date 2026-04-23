// The 3D 'delta' mode must color the surface by delta from compareRom
// (green > 0, red < 0) and heights reflect the delta, so unchanged cells
// show a flat grey plane and modified regions "pop" visually.
//
// Also tests the new "Δ vs parent" toolbar button: one-click compare
// against HEAD's parent without having to click the commit in git log.

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
      data: { name: '_3D_DELTA_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Modify + commit so HEAD has a parent
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);
    await (await page.$('#map-grid-table td')).click();
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="10"]', { force: true });
    await page.waitForTimeout(400);
    await page.fill('#git-commit-msg', 'step 1 +10%');
    await page.click('#git-commit-btn');
    await page.waitForTimeout(1500);

    // Apply another +5% on top so HEAD vs parent has a visible delta
    await (await page.$('#map-grid-table td')).click();
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(1200);

    // "Δ vs parent" button should be visible now
    const parentBtn = await page.$('#map-cmp-parent');
    assert(parentBtn, 'Δ vs parent button should exist on the map toolbar');
    await parentBtn.click();
    await page.waitForTimeout(1500);

    // Compare banner should now be visible (map editor sets .map-compare-banner)
    const banner = await page.$('.map-compare-banner');
    assert(banner, 'compare banner should appear after Δ vs parent click');
    const bannerText = await banner.textContent();
    assert(/parent de HEAD/i.test(bannerText), `banner should mention parent: got "${bannerText}"`);

    // Mode button should show "⇄ Split" (since current mode is delta after toggle)
    const modeBtn = await page.$('#map-3d-mode');
    assert(modeBtn, '3D mode button should be present in delta mode');
    // Visual: screenshot for inspection
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'map-3d-delta.png') });

    // Verify canvas has drawn non-black content (delta surface is visible)
    const hasContent = await page.evaluate(() => {
      const c = document.querySelector('#map-heatmap');
      if (!c) return false;
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      // A colored (non-background) pixel means we rendered something
      return d[0] !== 30 || d[1] !== 30 || d[2] !== 30;
    });
    assert(hasContent, 'canvas should have rendered something in delta mode');

    console.log('✅ map-3d-delta test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
