// Builds a showcase project with the reference tune ROM and captures the
// canonical screenshots used by the wiki pages. All outputs land in
// docs/wiki/images/ (committed — not in tests/screenshots which is gitignored).
//
// Usage: node tests/scripts/wiki-screenshots.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const ROM = path.join(__dirname, '..', '..', 'ressources', 'edc16c34',
  '1.7bar boost, Launch Control 2500, Popcorn 4400, 185hp 410nm');
const OUT = path.join(__dirname, '..', '..', 'docs', 'wiki', 'images');
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name, target) {
  const p = path.join(OUT, name + '.png');
  if (target) {
    const el = await page.$(target);
    if (el) await el.screenshot({ path: p });
    else await page.screenshot({ path: p });
  } else {
    await page.screenshot({ path: p });
  }
  console.log('  📸', name);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  const cleanup = [];
  try {
    // ── 1. Home page with a couple of demo projects ──────────────────────────
    const demos = [
      { name: '206 HDI 110 Stage 1', ecu: 'edc16c34', vehicle: 'Peugeot 206 1.6 HDi', immat: 'AB-123-CD', year: '2005', description: 'Stage 1 + FAP off' },
      { name: '307 HDI Pop & Bang', ecu: 'edc16c34', vehicle: 'Peugeot 307 HDi', immat: 'EF-456-GH', year: '2007', description: 'Pop & bang 4400 RPM' },
      { name: 'Partner 1.6 HDi démo', ecu: 'edc16c34', vehicle: 'Peugeot Partner', immat: 'IJ-789-KL', year: '2008', description: 'Démo wiki' }
    ];
    const createdIds = [];
    for (const d of demos) {
      const r = await page.request.post(URL + '/api/projects', { data: d });
      createdIds.push((await r.json()).id);
    }
    cleanup.push(async () => { for (const id of createdIds) try { await page.request.delete(URL + '/api/projects/' + id); } catch {} });

    // Import ROM into the first project
    const mainId = createdIds[0];
    await page.request.post(URL + '/api/projects/' + mainId + '/rom', {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/');
    await page.waitForSelector('.project-card', { timeout: 5000 });
    await page.waitForTimeout(500);
    await shot(page, '01-home');

    // ── 2. New project modal ────────────────────────────────────────────────
    await page.click('#btn-new');
    await page.waitForSelector('#modal-new-project:not(.hidden)');
    await page.fill('#np-name', '208 HDi 90 cv demo');
    await page.fill('#np-vehicle', 'Peugeot 208 1.6 HDi');
    await page.fill('#np-immat', 'MN-321-OP');
    await page.fill('#np-year', '2014');
    await page.fill('#np-desc', 'Essai Stage 1');
    await page.waitForTimeout(200);
    await shot(page, '02-new-project-modal');
    await page.click('#np-cancel');
    await page.waitForTimeout(200);

    // ── 3. Open the main project ────────────────────────────────────────────
    await page.goto(URL + '/#/project/' + mainId);
    await page.waitForSelector('#hex-canvas', { timeout: 5000 });
    await page.waitForTimeout(1000);
    await shot(page, '03-workspace');

    // ── 4. Param sidebar: search for 'rail' ─────────────────────────────────
    await page.fill('#param-search', 'boost');
    await page.waitForTimeout(600);
    await shot(page, '04-param-search', '#param-sidebar');

    // Reset search and click a real MAP
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(600);
    await page.click('.param-item');
    await page.waitForTimeout(1200);
    await shot(page, '05-map-editor');

    // ── 5. Auto-mods modal ──────────────────────────────────────────────────
    await page.click('#btn-auto-mods');
    await page.waitForSelector('.auto-mods-modal', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, '06-auto-mods');
    await page.click('#am-close');
    await page.waitForTimeout(300);

    // ── 6. Branch switcher open ─────────────────────────────────────────────
    await page.click('#branch-btn');
    await page.waitForSelector('.branch-popover', { timeout: 2000 });
    await shot(page, '07-branch-switcher');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    // Click somewhere neutral to close popover
    await page.click('#hex-wrap');
    await page.waitForTimeout(300);

    // ── 7. Edit project modal showing displayAddressBase field ──────────────
    await page.click('#btn-edit-project');
    await page.waitForSelector('#modal-edit-project:not(.hidden)');
    await page.fill('#ep-addr-base', '0x00000');
    await page.waitForTimeout(200);
    await shot(page, '08-edit-project');
    await page.click('#ep-cancel');
    await page.waitForTimeout(300);

    // ── 8. Make a modification + commit + reveal graph + map-diff ───────────
    // Patch a few bytes to trigger an auto-commit-worthy diff
    const bp = async (off, bytes) => page.request.patch(URL + '/api/projects/' + mainId + '/rom/bytes',
      { data: { offset: off, data: Buffer.from(bytes).toString('base64') } });
    await bp(0x1C1448 + 4 + 16 + 16 + 0, [0x02, 0xBC]); // cell[0]
    await bp(0x1C1448 + 4 + 16 + 16 + 10, [0x01, 0x90]); // cell[5]
    await page.request.post(URL + '/api/projects/' + mainId + '/git/commit', { data: { message: 'Tune AccPed +/-' } });

    // Now create a stage1 branch from UI too, so the graph shows divergence
    const branchR = await page.request.post(URL + '/api/projects/' + mainId + '/git/branches', { data: { name: 'stage1' } });
    await branchR.json();
    await bp(0x1C13CC, [0x16, 0x2E]);
    await page.request.post(URL + '/api/projects/' + mainId + '/git/commit', { data: { message: 'Stage 1 preset' } });

    await page.goto(URL + '/#/project/' + mainId);
    await page.waitForSelector('.git-entry', { timeout: 5000 });
    await page.waitForTimeout(600);
    // Widen the git panel for readability
    await page.evaluate(() => { const p = document.getElementById('git-panel'); if (p) p.style.width = '440px'; });
    await page.waitForTimeout(300);
    await shot(page, '09-git-graph', '#git-panel');

    // Click most-recent commit to see map diff
    await page.click('.git-entry:first-child');
    await page.waitForSelector('.map-diff-row', { timeout: 3000 });
    await page.waitForTimeout(300);
    await shot(page, '10-diff-map-level', '#git-panel');

    // Click a map-diff row → compare view
    const rows = await page.$$('.map-diff-row');
    for (const r of rows) {
      const name = await r.getAttribute('data-name');
      if (name === 'AccPed_trqEngHiGear_MAP') { await r.click(); break; }
    }
    await page.waitForTimeout(800);
    await shot(page, '11-map-compare');

    // ── 9. Auto-suggest commit message ──────────────────────────────────────
    await bp(0x1C140C, [0xAA, 0xBB]);
    await bp(0x1C140E, [0xCC, 0xDD]);
    await page.evaluate(() => document.querySelector('#git-commit-msg').value = '');
    await page.click('#git-suggest-btn');
    await page.waitForTimeout(600);
    await shot(page, '12-auto-commit-msg', '#git-panel');

    console.log('\n✅ wiki screenshots done');
  } catch (e) {
    console.log('❌', e.message);
  } finally {
    for (const c of cleanup) await c();
    await browser.close();
  }
})();
