// Test ROM variant detection (75ch / 90ch / 110ch) and Stage 1 safety guard.
// Verifies:
//   1. /api/projects/:id/rom/variant → 75ch for Berlingo 9663944680.Bin
//   2. Auto-mods modal shows variant banner ("DV6BTED4 55kW 75ch")
//   3. Stage 1 confirm() dialog fires when % > safePct (8%)
//   4. /api/projects/:id/dtc-group → Supprimer / Restaurer round-trip
//
// Usage: PORT=3002 node server.js & ; node tests/rom-variant-detection.test.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = process.env.APP_URL || 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', '9663944680.Bin');
const SHOTS = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

async function shot(page, name) {
  const p = path.join(SHOTS, `rom-variant-${name}.png`);
  await page.screenshot({ path: p });
  console.log('  📸', name);
}

(async () => {
  let projectId = null;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error') console.warn('  [browser]', msg.text()); });

  try {
    // ── 1. Setup project ──────────────────────────────────────────────────────
    const r1 = await page.request.post(URL + '/api/projects', {
      data: { name: 'Berlingo variant-detect test', ecu: 'edc16c34', vehicle: 'Citroën Berlingo 1.6 HDi 75ch' }
    });
    const proj = await r1.json();
    projectId = proj.id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: '9663944680.Bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });
    console.log('  ✓ Project + ROM importé', projectId);

    // ── 2. /rom/variant API ───────────────────────────────────────────────────
    const vRes = await page.request.get(URL + '/api/projects/' + projectId + '/rom/variant');
    assert(vRes.ok(), `variant endpoint HTTP ${vRes.status()}`);
    const vData = await vRes.json();
    console.log('  Variant API:', JSON.stringify(vData));
    assert.strictEqual(vData.variant, '75ch', `Expected 75ch, got ${vData.variant}`);
    assert.strictEqual(vData.safePct, 8, `Expected safePct=8, got ${vData.safePct}`);
    assert(vData.confidence === 'high', `Expected confidence=high`);
    console.log('  ✓ Variant 75ch détecté, safePct=8');

    // ── 3. Auto-mods modal — banner variant ───────────────────────────────────
    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { timeout: 6000 });
    await page.waitForTimeout(1500);

    await page.click('#btn-auto-mods');
    await page.waitForSelector('#auto-mods-modal', { timeout: 4000 });
    await page.waitForTimeout(2000); // laisser _detectVariant() arriver

    await shot(page, '01-modal-open');

    const banner = await page.$('#am-variant-banner');
    assert(banner, '#am-variant-banner missing in DOM');
    const bannerText = await banner.textContent();
    console.log('  Banner text:', bannerText.trim());
    assert(/75ch|DV6BTED4/i.test(bannerText), `Banner should mention 75ch/DV6BTED4, got: "${bannerText}"`);
    assert(/\+8%/.test(bannerText), `Banner should mention +8%, got: "${bannerText}"`);
    console.log('  ✓ Variant banner affiché correctement');

    // ── 4. Stage 1 safeNote text ──────────────────────────────────────────────
    const safeNote = await page.$('#am-s1-safe-note');
    assert(safeNote, '#am-s1-safe-note missing');
    const safeText = await safeNote.textContent();
    console.log('  safeNote text:', safeText.trim());
    assert(/8%|DV6BTED4/i.test(safeText), `safeNote should mention 8% or DV6BTED4, got: "${safeText}"`);
    console.log('  ✓ safeNote variante visible');

    // Wait for _loadStage1Deltas to settle (it runs after _detectVariant)
    // Stage 1 delta sets all inputs to 0 (ROM is stock). We need to fill AFTER.
    await page.waitForFunction(() => {
      const el = document.querySelector('#s1-pct-AccPed_trqEngHiGear_MAP');
      return el && el.value !== undefined; // element exists and delta has run
    }, { timeout: 5000 });
    await page.waitForTimeout(500); // give stage1-delta fetch a moment to write

    // ── 5. Warning border when % > safePct ───────────────────────────────────
    const firstPctInput = await page.$('#s1-pct-AccPed_trqEngHiGear_MAP');
    assert(firstPctInput, '#s1-pct-AccPed_trqEngHiGear_MAP not found');
    // Set value to 20 via evaluate to avoid native input validation interfering
    await firstPctInput.evaluate(el => { el.value = '20'; });
    await firstPctInput.dispatchEvent('input');
    await page.waitForTimeout(200);
    const borderColor = await firstPctInput.evaluate(el => el.style.borderColor);
    console.log('  borderColor at 20%:', borderColor);
    assert(borderColor && borderColor !== '', 'Border should change when % > safePct');
    console.log('  ✓ Border warning à 20% (dépasse safePct=8)');

    // Verify value is actually 20 in JS context
    const inputVal = await firstPctInput.evaluate(el => el.value);
    assert.strictEqual(inputVal, '20', `Input value should be 20, got ${inputVal}`);

    // ── 6. Confirm dialog when applying with high % ───────────────────────────
    let confirmMsg = null;
    page.once('dialog', async dialog => {
      confirmMsg = dialog.message();
      console.log('  ✓ Confirm dialog :', confirmMsg.split('\n')[0]);
      await dialog.dismiss(); // annuler → ne pas appliquer
    });
    const applyBtn = await page.$('button:has-text("Appliquer Stage 1")');
    assert(applyBtn, '"Appliquer Stage 1" button not found');
    await applyBtn.click();
    await page.waitForTimeout(1200);
    assert(confirmMsg !== null, 'Confirm dialog should have fired when % > safePct');
    assert(/Variante|DV6BTED4|limite/i.test(confirmMsg), 'Confirm should mention variant: ' + confirmMsg);
    console.log('  ✓ Confirm dialog bloque l\'application si % excessif');

    await shot(page, '02-stage1-safeguard');

    // ── 7. DTC group — suppression round-trip ─────────────────────────────────
    // Adresses EGR (hex) : 0x1C677A → 0x1C6781 (8 params)
    const EGR_ADDRS = Array.from({ length: 8 }, (_, i) => 0x1C677A + i);

    const suppressRes = await page.request.post(URL + '/api/projects/' + projectId + '/dtc-group', {
      data: { addresses: EGR_ADDRS, restore: false }
    });
    assert(suppressRes.ok(), `dtc-group suppress HTTP ${suppressRes.status()}`);
    const suppressData = await suppressRes.json();
    assert.strictEqual(suppressData.ok, true);
    assert(suppressData.changed > 0, `Expected >0 changed, got ${suppressData.changed}`);
    console.log(`  ✓ DTC EGR supprimés (${suppressData.changed} bytes)`);

    const restoreRes = await page.request.post(URL + '/api/projects/' + projectId + '/dtc-group', {
      data: { addresses: EGR_ADDRS, restore: true }
    });
    assert(restoreRes.ok());
    const restoreData = await restoreRes.json();
    assert(restoreData.changed > 0, `Expected >0 restored`);
    console.log(`  ✓ DTC EGR restaurés (${restoreData.changed} bytes)`);

    await shot(page, '03-dtc-ui');

    console.log('\n  ✅ rom-variant-detection PASS');
  } finally {
    if (projectId) {
      try { await page.request.delete(URL + '/api/projects/' + projectId); } catch {}
    }
    await browser.close();
  }
})();
