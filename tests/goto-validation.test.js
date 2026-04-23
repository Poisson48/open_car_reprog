// Goto address input must reject non-hex / out-of-range values with visible
// feedback (red border + status bar message) instead of silently parsing.

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
      data: { name: '_GOTO_VALID_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1000);

    // 1. Non-hex input → red border + status message
    await page.fill('#goto-addr', 'zzz');
    await page.click('#btn-goto');
    await page.waitForTimeout(200);
    let hasErr = await page.$eval('#goto-addr', e => e.classList.contains('input-error'));
    assert(hasErr, 'input should have input-error class after "zzz"');
    let status = await page.textContent('#status-bar');
    assert(/invalide/i.test(status), `status should mention "invalide": got "${status}"`);
    console.log('  ✓ non-hex input rejected');

    // 2. Typing again removes the error class
    await page.fill('#goto-addr', '');
    await page.keyboard.type('1');
    await page.waitForTimeout(100);
    hasErr = await page.$eval('#goto-addr', e => e.classList.contains('input-error'));
    assert(!hasErr, 'input-error should clear when user types again');

    // 3. Mixed hex+garbage ("123g") → must reject, not silently parse as 0x123
    await page.fill('#goto-addr', '123g');
    await page.click('#btn-goto');
    await page.waitForTimeout(200);
    hasErr = await page.$eval('#goto-addr', e => e.classList.contains('input-error'));
    assert(hasErr, 'mixed hex+garbage should be rejected');
    console.log('  ✓ "123g" rejected (was silently parsed before)');

    // 4. Out-of-range address (0xFFFFFFFF on a 2 MB ROM)
    await page.fill('#goto-addr', 'FFFFFFFF');
    await page.click('#btn-goto');
    await page.waitForTimeout(200);
    hasErr = await page.$eval('#goto-addr', e => e.classList.contains('input-error'));
    assert(hasErr, 'out-of-range address should be rejected');
    status = await page.textContent('#status-bar');
    assert(/hors ROM/i.test(status), `status should mention "hors ROM": got "${status}"`);
    console.log('  ✓ out-of-range rejected');

    // 5. Valid hex works
    await page.fill('#goto-addr', '0x1C1448');
    await page.click('#btn-goto');
    await page.waitForTimeout(300);
    hasErr = await page.$eval('#goto-addr', e => e.classList.contains('input-error'));
    assert(!hasErr, 'valid hex should NOT be flagged');
    status = await page.textContent('#status-bar');
    assert(/goto.*1c1448/i.test(status), `status should confirm goto: got "${status}"`);
    console.log('  ✓ valid hex accepted');

    await page.screenshot({ path: path.join(OUT, 'goto-validation.png') });
    // Re-trigger error for the screenshot
    await page.fill('#goto-addr', 'zzz');
    await page.click('#btn-goto');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'goto-validation-err.png') });

    console.log('✅ goto-validation test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
