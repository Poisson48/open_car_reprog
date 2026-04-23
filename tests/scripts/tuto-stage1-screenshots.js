// Drives the full Stage 1 tutorial workflow end-to-end on a Berlingo ROM
// (stock PSA part 9663944680) and captures each step as a wiki screenshot.
//
// Outputs in docs/wiki/images/ under tuto-01..tuto-12-*.png.
//
// Usage: PORT=3002 node server.js & ; node tests/scripts/tuto-stage1-screenshots.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3002';
const RES = path.join(__dirname, '..', '..', 'ressources', 'edc16c34');
const STOCK_BIN = path.join(RES, '9663944680.Bin');
const TUNE_BIN = path.join(RES, '1.7bar boost, Launch Control 2500, Popcorn 4400, 185hp 410nm');
const OUT = path.join(__dirname, '..', '..', 'docs', 'wiki', 'images');
fs.mkdirSync(OUT, { recursive: true });

const VP = { width: 1600, height: 900 };

async function shot(page, name, target) {
  const p = path.join(OUT, name + '.png');
  if (target) {
    const el = await page.$(target);
    if (el) { await el.screenshot({ path: p }); console.log('  📸', name, '(element)'); return; }
  }
  await page.screenshot({ path: p });
  console.log('  📸', name);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const createdIds = [];

  try {
    // ── Create project via API ────────────────────────────────────────────────
    const r = await page.request.post(URL + '/api/projects', { data: {
      name: 'Berlingo 1.6 HDi 110',
      vehicle: 'Citroën Berlingo II 1.6 HDi 110 cv',
      immat: 'AB-123-CD',
      year: '2008',
      ecu: 'edc16c34',
      description: 'Stage 1 demo tutoriel — stock PSA part 9663944680',
    }});
    const proj = await r.json();
    const id = proj.id;
    createdIds.push(id);
    console.log('  ✓ Project créé', id);

    await page.request.post(URL + '/api/projects/' + id + '/rom', {
      multipart: { rom: { name: '9663944680.Bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(STOCK_BIN) } }
    });
    console.log('  ✓ ROM importé');

    // ── 1. Home page with the Berlingo project card ──────────────────────────
    await page.goto(URL + '/');
    await page.waitForSelector('.project-card', { timeout: 5000 });
    await page.waitForTimeout(400);
    await shot(page, 'tuto-01-home-berlingo');

    // ── 2. New-project modal filled (illustration for "créer projet") ────────
    await page.click('#btn-new');
    await page.waitForSelector('#modal-new-project:not(.hidden)');
    await page.fill('#np-name', 'Berlingo 1.6 HDi 110 — Stage 1');
    await page.fill('#np-vehicle', 'Citroën Berlingo II 1.6 HDi 110 cv');
    await page.fill('#np-immat', 'AB-123-CD');
    await page.fill('#np-year', '2008');
    await page.selectOption('#np-ecu', 'edc16c34');
    await page.fill('#np-desc', 'Stage 1 tutoriel pas-à-pas');
    await page.waitForTimeout(200);
    await shot(page, 'tuto-02-new-project-modal');
    await page.click('#np-cancel');
    await page.waitForTimeout(200);

    // ── 3. Open workspace ─────────────────────────────────────────────────────
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-canvas', { timeout: 6000 });
    await page.waitForTimeout(1500);
    await shot(page, 'tuto-03-workspace-berlingo');

    // ── 4. Param sidebar filtered on "AccPed" ─────────────────────────────────
    await page.fill('#param-search', 'AccPed_trqEng');
    await page.waitForTimeout(600);
    await shot(page, 'tuto-04-param-search-accped', '#param-sidebar');

    // ── 5. Click the Hi gear map to open editor ──────────────────────────────
    const mapLi = await page.$('.param-item:has-text("AccPed_trqEngHiGear_MAP")');
    if (mapLi) await mapLi.click();
    await page.waitForTimeout(1200);
    await shot(page, 'tuto-05-map-opened');

    // ── 6. Select a single cell to reveal the adjustment bar, bump +10% ─────
    // First cell (xi=0, yi=0) — click to trigger selection which shows the
    // #map-sel-bar (hidden when empty). Then "Tout sélectionner" is visible.
    const cell = await page.$('input[data-xi="0"][data-yi="0"]');
    if (cell) {
      await cell.click({ modifiers: ['Control'] });
      await page.waitForTimeout(200);
    }
    const selAll = await page.$('#map-sel-all');
    if (selAll) await selAll.click();
    await page.waitForTimeout(400);
    await shot(page, 'tuto-06-all-selected');

    const plus10 = await page.$('button[data-op="pct"][data-val="10"]');
    if (plus10) await plus10.click();
    await page.waitForTimeout(500);
    await shot(page, 'tuto-07-plus10-applied');

    // Reset — undo so the Stage 1 run is clean (Ctrl+Z)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(400);

    // ── 7. Auto-mods modal with Stage 1 form ──────────────────────────────────
    await page.click('#btn-auto-mods');
    await page.waitForSelector('#auto-mods-modal', { timeout: 4000 });
    await page.waitForTimeout(700);

    // Scroll to the Stage 1 block
    const s1Input = await page.$('#s1-chk-AccPed_trqEngHiGear_MAP');
    if (s1Input) await s1Input.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, 'tuto-08-auto-mods-stage1');

    // Apply Stage 1 defaults
    const applyBtn = await page.$('button:has-text("Appliquer Stage 1")');
    if (applyBtn) await applyBtn.click();
    await page.waitForTimeout(1500);
    await shot(page, 'tuto-09-stage1-applied');

    // Close auto-mods modal
    await page.click('#am-close');
    await page.waitForTimeout(400);

    // ── 8. Git panel — auto commit message after Stage 1 ─────────────────────
    const sparkle = await page.$('#git-suggest-btn');
    if (sparkle) { await sparkle.click(); await page.waitForTimeout(700); }
    await shot(page, 'tuto-10-auto-commit-msg', '#git-panel');

    // Commit it
    const commitBtn = await page.$('#git-commit-btn');
    if (commitBtn) await commitBtn.click();
    await page.waitForTimeout(1200);

    // Click the latest (Stage 1) commit to reveal diff-maps
    const firstCommit = await page.$('#git-log .git-entry');
    if (firstCommit) await firstCommit.click();
    await page.waitForTimeout(900);
    await shot(page, 'tuto-11-diff-maps', '#git-panel');

    // ── 9. Click one of the modified maps → compare view ─────────────────────
    const diffMap = await page.$('.map-diff-row');
    if (diffMap) { await diffMap.click(); await page.waitForTimeout(900); }
    await shot(page, 'tuto-12-compare-view');

    // Close compare banner (the map editor compare banner has a close button)
    const closeCompare = await page.$('#map-compare-close, .compare-banner-close');
    if (closeCompare) { await closeCompare.click(); await page.waitForTimeout(300); }

    // ── 10. Map-Finder scan ──────────────────────────────────────────────────
    await page.click('#btn-map-finder');
    await page.waitForSelector('#mf-list', { timeout: 5000 });
    await page.waitForTimeout(1200);
    await shot(page, 'tuto-13-map-finder');

    // Grab the first candidate to mention in the wiki
    const topCandidate = await page.evaluate(() => {
      const items = document.querySelectorAll('#mf-list .mf-item, #mf-list > div');
      return items.length > 0 ? items[0].textContent.slice(0, 120) : null;
    });
    console.log('  ℹ top map-finder candidate:', topCandidate);

    // Close map-finder modal
    await page.click('#mf-close');
    await page.waitForTimeout(300);

    // ── 11. Compare-file vs tuned ROM (simulates "sans damos" workflow) ──────
    const compareResp = await page.request.post(URL + '/api/projects/' + id + '/compare-file', {
      multipart: { rom: { name: 'tuned.bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(TUNE_BIN) } }
    });
    const compareData = await compareResp.json();
    console.log('  ℹ compare vs tune:', compareData.maps ? compareData.maps.length : 0, 'maps differ');

    // Reload the project page so the compare banner / "N maps differ" appears
    await page.reload();
    await page.waitForTimeout(1500);
    await shot(page, 'tuto-14-compare-file-diff');

    // ── Done ──────────────────────────────────────────────────────────────────
    console.log('\n  ✅ tutorial screenshots written to', OUT);
  } finally {
    for (const id of createdIds) {
      try { await page.request.delete(URL + '/api/projects/' + id); } catch {}
    }
    await browser.close();
  }
})();
