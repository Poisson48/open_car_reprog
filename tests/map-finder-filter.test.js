// The auto-find modal shows up to 200 candidates on a Bosch ROM. A search
// input + "hors A2L only" toggle let the tuner narrow down without
// endlessly scrolling.

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
      data: { name: '_MF_FILTER_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1000);

    await page.click('#btn-map-finder');
    await page.waitForSelector('#mf-filter', { timeout: 5000 });
    await page.waitForTimeout(2500); // wait for scan

    const allRows = await page.$$('.mf-row');
    assert(allRows.length > 10, `expected many candidates, got ${allRows.length}`);
    console.log('  total candidates:', allRows.length);

    // Filter by dimensions "16x16"
    await page.fill('#mf-filter', '16x16');
    await page.waitForTimeout(300);
    const dims = await page.$$eval('.mf-row .mf-dims', els => els.map(e => e.textContent.trim()));
    assert(dims.length > 0, 'expected some 16x16 candidates on this Bosch ROM');
    assert(dims.every(d => d === '16×16'), `all rows should be 16×16: got ${JSON.stringify(dims.slice(0, 5))}`);
    console.log('  ✓ dim filter "16x16":', dims.length, 'rows');

    // Filter by hex address substring
    await page.fill('#mf-filter', '1c1');
    await page.waitForTimeout(300);
    const addrs = await page.$$eval('.mf-row .mf-addr', els => els.map(e => e.textContent.trim().toLowerCase()));
    assert(addrs.length > 0, 'expected some 0x1C1… candidates');
    assert(addrs.every(a => a.includes('1c1')), `all addrs should contain "1c1": got ${JSON.stringify(addrs.slice(0, 3))}`);
    console.log('  ✓ hex substring "1c1":', addrs.length, 'rows');

    // "hors A2L only"
    await page.fill('#mf-filter', '');
    await page.click('#mf-hors-a2l-only');
    await page.waitForTimeout(300);
    const known = await page.$$eval('.mf-row .mf-known', els => els.map(e => e.textContent.trim()));
    console.log('  hors A2L only:', known.length, 'rows');
    assert(known.every(k => !/^✓/.test(k)), `all rows should be hors A2L: got ${JSON.stringify(known.slice(0, 3))}`);

    // Empty filter → all rows back
    await page.click('#mf-hors-a2l-only');
    await page.waitForTimeout(300);
    const again = await page.$$('.mf-row');
    assert.strictEqual(again.length, allRows.length, 'clearing filter should restore all rows');

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'map-finder-filter.png') });
    console.log('✅ map-finder-filter test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
