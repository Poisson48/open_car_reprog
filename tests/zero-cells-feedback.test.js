// When ±% is applied on a selection where ALL cells are 0 (e.g. the damos
// points to an FF/00 padding zone on a mismatched firmware), the map editor
// must display a visible warning instead of silently doing nothing.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
// Berlingo ROM: the damos address 0x1C1448 is all-zero padding on this firmware.
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', '9663944680.Bin');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let projectId;

  try {
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: '_ZERO_FEEDBACK_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: '9663944680.Bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Open AccPed_trqEngHiGear_MAP — this address is a zero-padding zone on
    // the Berlingo ROM (confirmed in the CLAUDE.md architecture doc).
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    await (await page.$('#map-grid-table td, #map-grid-table-A td')).click();
    await page.waitForTimeout(200);
    await page.click('#map-sel-all', { force: true });
    await page.waitForTimeout(200);

    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await page.waitForTimeout(400);

    const selCountText = await page.textContent('#map-sel-count');
    console.log('  sel-count after +5%:', JSON.stringify(selCountText));
    assert(/aucun effet|à 0/i.test(selCountText), `expected warning about 0 cells: got "${selCountText}"`);

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'zero-cells-feedback.png') });
    console.log('✅ zero-cells-feedback test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
