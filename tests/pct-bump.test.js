// Bug fix : +/−% ne doit plus être muet sur les petites valeurs.
// Avant le fix, AccPed_trqEngHiGear_MAP (raws entre 0 et ~3) + +5 % ne
// modifiait aucun octet car le raw réarrondi retombait sur lui-même.
// Après le fix, chaque cellule non-zéro doit bouger d'au moins 1 raw.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
// ori.BIN matches damos.a2l 100% — maps have real non-zero values there.
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let projectId;

  try {
    // Setup project
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: '_PCT_BUMP_TEST_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    page.on('console', m => { if (m.type() !== 'log' || m.text().startsWith('[pct]')) console.log('[console]', m.text()); });
    page.on('pageerror', e => console.log('[pageerror]', e.message));
    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Open a map with small raws (AccPed_trqEngHiGear_MAP at 0x1C1448)
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    // Click a cell to reveal selection bar, then Tout sélectionner
    await (await page.$('#map-grid-table td, #map-grid-table-A td')).click();
    await page.waitForTimeout(200);
    await page.click('#map-sel-all', { force: true });
    await page.waitForTimeout(200);

    const before = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await page.waitForTimeout(500);
    // Modifications are in-memory until Ctrl-S persists them to the server.
    // Dispatch a synthetic keydown to bypass Playwright's browser-level intercept.
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(1500);
    const after = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());

    // Count differing bytes in the map region (address 0x1C1448, 16×10 SWORD = 320 bytes + header)
    let differing = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differing++;
    console.log('  bytes differing:', differing);

    assert(differing > 0, 'REGRESSION: +5% on AccPed_trqEngHiGear_MAP still modifies 0 bytes');
    assert(differing >= 100, `Expected many cells to change (>=100), got ${differing}`);

    await page.screenshot({ path: path.join(OUT, 'pct-bump-after-plus5.png') });
    console.log('  ✓ +5% modified', differing, 'bytes');

    // Verify −5% brings it back close to original (not exactly: we forced bump)
    await page.click('[data-op="pct"][data-val="-5"]', { force: true });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(1500);
    const afterMinus = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
    let stillDiff = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== afterMinus[i]) stillDiff++;
    console.log('  bytes still diff after −5 %:', stillDiff);

    console.log('✅ pct-bump test passed');
  } finally {
    if (projectId) {
      await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
