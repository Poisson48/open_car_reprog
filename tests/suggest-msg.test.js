// After modifying a map, clicking ✨ must populate the commit message with
// the list of modified maps. Previously returned empty because the server
// endpoint reads the on-disk ROM and didn't see unflushed in-memory edits.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let projectId;

  try {
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: '_SUGGEST_MSG_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    await (await page.$('#map-grid-table td, #map-grid-table-A td')).click();
    await page.waitForTimeout(150);
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="10"]', { force: true });
    await page.waitForTimeout(500);

    // Click ✨ — WITHOUT Ctrl-S. Must auto-flush and then populate the input.
    await page.click('#git-suggest-btn');
    await page.waitForTimeout(1500);

    const msg = await page.inputValue('#git-commit-msg');
    console.log('  suggested msg:', JSON.stringify(msg));
    assert(msg && msg.length > 0, 'REGRESSION: ✨ suggest-msg empty after +10% on 160 cells');
    assert(/AccPed_trqEngHiGear_MAP/i.test(msg), `msg should mention the modified map: got "${msg}"`);
    // After applying +10 %, the avg-based pct must have the correct (positive) sign.
    assert(/\+/.test(msg), `msg should reflect a POSITIVE delta for +10 %: got "${msg}"`);

    await page.screenshot({ path: path.join(OUT, 'suggest-msg.png') });
    console.log('✅ suggest-msg test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
