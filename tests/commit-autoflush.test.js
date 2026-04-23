// Clicking "💾 Commit modifications" must flush in-memory edits to the server
// FIRST, then commit — otherwise the commit captures stale bytes and silently
// discards the user's latest map changes.

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
      data: { name: '_COMMIT_AUTOFLUSH_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Open a map and apply +5% — NO Ctrl-S
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    await (await page.$('#map-grid-table td, #map-grid-table-A td')).click();
    await page.waitForTimeout(150);
    await page.click('#map-sel-all', { force: true });
    await page.waitForTimeout(150);
    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await page.waitForTimeout(500);

    // ROM on disk must still be unchanged at this point.
    const romBeforeCommit = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());

    // Commit via the button. This must flush first.
    await page.fill('#git-commit-msg', 'autoflush test');
    await page.click('#git-commit-btn');
    await page.waitForTimeout(1800);

    // After commit: the committed HEAD must contain the modified bytes.
    const romAfterCommit = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
    let differing = 0;
    for (let i = 0; i < romBeforeCommit.length; i++) if (romBeforeCommit[i] !== romAfterCommit[i]) differing++;
    console.log('  bytes differing on disk after Commit:', differing);
    assert(differing > 0, 'REGRESSION: Commit did not flush pending edits — disk still matches pre-edit state');
    assert(differing >= 100, `Expected many differing bytes, got ${differing}`);

    // Check git log now has the new commit
    const log = await page.request.get(URL + '/api/projects/' + projectId + '/git/log').then(r => r.json());
    const tip = log[0];
    assert(tip.message.includes('autoflush test'), `HEAD message "${tip.message}" should contain our commit msg`);
    console.log('  ✓ HEAD =', tip.hash.slice(0, 8), '-', tip.message);

    await page.screenshot({ path: path.join(OUT, 'commit-autoflush.png') });
    console.log('✅ commit-autoflush test passed (', differing, 'bytes in the commit)');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
