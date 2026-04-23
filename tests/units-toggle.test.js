// The Nm↔lb·ft / °C↔°F toggle must convert displayed values, persist the
// preference per-project, and write back converted values to the ROM.

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
      data: { name: '_UNITS_TOGGLE_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Check default state
    let label = await page.textContent('#btn-units-label');
    assert.strictEqual(label.trim(), 'Nm · °C', `default should be "Nm · °C": got "${label}"`);

    // Open AccPed_trqEngHiGear_MAP — unit is Nm in the A2L
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    // Read cell [0,0] in Nm
    const nmVal = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  Nm value:', nmVal);

    // Toggle to lb·ft
    await page.click('#btn-units-toggle');
    await page.waitForTimeout(500);
    label = await page.textContent('#btn-units-label');
    assert.strictEqual(label.trim(), 'lb·ft · °F', `after toggle should be "lb·ft · °F": got "${label}"`);

    const lbftVal = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  lb·ft value:', lbftVal);
    // Conversion factor: 1 Nm ≈ 0.7376 lb·ft
    const expected = nmVal * 0.7375621493;
    assert(Math.abs(lbftVal - expected) < 0.05, `expected ~${expected.toFixed(2)}, got ${lbftVal}`);
    console.log('  ✓ Nm → lb·ft conversion correct');

    // Unit label in the toolbar header should now say lb·ft
    const header = await page.$eval('.map-toolbar', el => el.textContent);
    assert(/lb·ft/.test(header), `toolbar should mention lb·ft: got "${header.slice(0, 200)}"`);

    // Check persistence : the preference survives reload
    await page.reload();
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 10000 });
    await page.waitForTimeout(1000);
    label = await page.textContent('#btn-units-label');
    assert.strictEqual(label.trim(), 'lb·ft · °F', `persisted label should be "lb·ft · °F": got "${label}"`);
    console.log('  ✓ preference persisted after reload');

    // Write back: user types a new lb·ft value → ROM stores the converted Nm
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    const inp = await page.$('input[data-xi="0"][data-yi="0"]');
    await inp.fill('100');
    await inp.press('Enter');
    await page.waitForTimeout(400);
    // Persist to disk (Ctrl-S).
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(1500);

    // Toggle back to Nm → 100 lb·ft = 135.58 Nm
    await page.click('#btn-units-toggle');
    await page.waitForTimeout(500);
    const backToNm = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  after entering 100 lb·ft and toggling back to Nm:', backToNm);
    assert(Math.abs(backToNm - 135.58) < 1, `100 lb·ft → ~135.58 Nm: got ${backToNm}`);
    console.log('  ✓ write-back conversion lb·ft → Nm correct');

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'units-toggle.png') });
    console.log('✅ units-toggle test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
