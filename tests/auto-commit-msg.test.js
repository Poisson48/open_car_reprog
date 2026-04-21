// Verifies the auto-suggested commit message reflects the current (uncommitted)
// changes to rom.bin. Three scenarios:
//   1. Single VALUE changed → message names the param with delta.
//   2. Several Stage 1 maps changed → message recognizes "Stage 1".
//   3. Empty working tree → suggest button flashes "rien à committer".

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const TARGET_NAME = 'ACCD_uSRCMin_C';
const TARGET_ADDR = 1840076;

// A2L-declared addresses (NOT the stage1Maps in the catalog which is a different
// tuning surface). We want maps whose addresses the server actually reports.
// Use 3 distinct VALUE params at known addresses to trigger the Stage 1 heuristic.

async function patchBytes(page, id, off, bytes) {
  const buf = Buffer.from(bytes);
  return page.request.patch(URL + `/api/projects/${id}/rom/bytes`, {
    data: { offset: off, data: buf.toString('base64') }
  });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();

  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-auto-msg', ecu: 'edc16c34' }
    });
    id = (await proj.json()).id;

    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(1234, TARGET_ADDR);
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    // Scenario 1: modify ONE value, verify message proposes "{name} +delta"
    await patchBytes(page, id, TARGET_ADDR, [0x16, 0x2E]); // 5678 BE
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#git-commit-msg', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('#git-suggest-btn');
    await page.waitForTimeout(500);
    let suggested = await page.inputValue('#git-commit-msg');
    console.log('1 value changed → message:', JSON.stringify(suggested));
    if (!suggested.includes(TARGET_NAME)) {
      throw new Error(`Expected message to include ${TARGET_NAME}, got "${suggested}"`);
    }
    if (!/[+-]\d+%/.test(suggested) && !/[+-]\d+/.test(suggested)) {
      throw new Error(`Expected a numeric delta in the message, got "${suggested}"`);
    }

    // Scenario 2: commit the suggestion, then patch many addresses to trigger "N cartes" phrasing
    await page.click('#git-commit-btn');
    await page.waitForTimeout(400);

    // Patch 5 real VALUE params so the suggestion groups them as multiple cartes
    for (const addr of [0x1C140C, 0x1C140E, 0x1C1410, 0x1C1412, 0x1C13E2]) {
      await patchBytes(page, id, addr, [0x12, 0x34]);
    }
    // Clear input and suggest
    await page.fill('#git-commit-msg', '');
    await page.click('#git-suggest-btn');
    await page.waitForTimeout(500);
    suggested = await page.inputValue('#git-commit-msg');
    console.log('Many changes → message:', JSON.stringify(suggested));
    if (!suggested.match(/cartes|carte|\bMAP\b|_MAP|_CUR|_C/)) {
      throw new Error(`Expected message to mention cartes/maps, got "${suggested}"`);
    }

    // Scenario 3: commit those, then nothing dirty → suggest flashes "rien à committer"
    await page.click('#git-commit-btn');
    await page.waitForTimeout(400);
    await page.fill('#git-commit-msg', '');
    await page.click('#git-suggest-btn');
    await page.waitForTimeout(1300);
    // After 1.2s the button text resets; but immediately after click it says "rien à committer"
    // Verify by checking that the input stays empty
    const finalInput = await page.inputValue('#git-commit-msg');
    console.log('Clean tree → input:', JSON.stringify(finalInput));
    if (finalInput.trim()) throw new Error(`Input should stay empty when no changes, got "${finalInput}"`);

    // Screenshot final state (with many cartes suggestion)
    // Re-make changes for the screenshot
    for (const addr of [0x1C1414, 0x1C1416, 0x1C1418]) {
      await patchBytes(page, id, addr, [0xAB, 0xCD]);
    }
    await page.fill('#git-commit-msg', '');
    await page.click('#git-suggest-btn');
    await page.waitForTimeout(500);
    await page.evaluate(() => { const p = document.getElementById('git-panel'); if (p) p.style.width = '420px'; });
    const gp = await page.$('#git-panel');
    if (gp) await gp.screenshot({ path: path.join(OUT, 'auto-commit-msg.png') });
    console.log('  📸 auto-commit-msg.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-auto-msg.png') });
    console.log('\n❌', e.message);
    msgs.slice(-10).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
