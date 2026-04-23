// Smoke test visuel de la split view : capture la comparaison 2 commits
// en vue 2D split, 3D split, et la liste des modifs cliquable.
//
// Usage : node tests/scripts/verify-split-view.js (port 3002 par défaut)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3002';
const ROM = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', 'ori.BIN');
const OUT = path.join(__dirname, '..', '..', 'docs', 'wiki', 'images');
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const p = path.join(OUT, name + '.png');
  await page.screenshot({ path: p });
  console.log('  📸', name);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  ⚠ pageerror:', e.message));
  page.on('console', msg => console.log('  [browser.' + msg.type() + ']:', msg.text()));
  page.on('requestfailed', req => console.log('  ⚠ requestfailed:', req.url(), req.failure()?.errorText));

  const createdIds = [];
  try {
    // 1. Crée projet + import ROM via API
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: 'Split view verification', ecu: 'edc16c34' }
    });
    const proj = await r.json();
    createdIds.push(proj.id);
    console.log('  ✓ project', proj.id);

    await page.request.post(URL + '/api/projects/' + proj.id + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    // 2. Apply Stage 1 → commit
    await page.request.post(URL + '/api/projects/' + proj.id + '/stage1', { data: {} });
    await page.request.post(URL + '/api/projects/' + proj.id + '/git/commit', { data: { message: 'Stage 1' } });
    console.log('  ✓ Stage 1 committed');

    // 3. Apply rail_max_raise → commit
    await page.request.post(URL + '/api/projects/' + proj.id + '/open-damos-recipe/rail_max_raise', {
      headers: { 'Content-Type': 'application/json' }
    });
    await page.request.post(URL + '/api/projects/' + proj.id + '/git/commit', { data: { message: 'Rail max +15%' } });
    console.log('  ✓ Rail max committed');

    // 4. Open project
    await page.goto(URL + '/#/project/' + proj.id);
    await page.waitForSelector('#hex-canvas', { timeout: 6000 });
    await page.waitForTimeout(1500);
    await shot(page, 'verify-split-01-project-open');

    // 5. Open compare 2-refs modal via git panel button
    await page.click('#git-compare-refs-btn');
    await page.waitForSelector('#git-compare-refs-modal', { timeout: 3000 });
    await page.waitForTimeout(400);
    await shot(page, 'verify-split-02-compare-refs-modal');

    // 6. The modal already has 2 dropdowns prepopulated. Click "Comparer"
    await page.click('#crm-compare');
    await page.waitForSelector('.map-diff-row', { timeout: 3000 });
    await page.waitForTimeout(600);
    await shot(page, 'verify-split-03-diff-list');

    // 7. Click on FMTC_trq2qBas_MAP (or first diff row) to open compare view
    // Prefer a MAP type for best visual split
    const mapRow = await page.$('.map-diff-row:has-text("MAP")') || await page.$('.map-diff-row');
    if (!mapRow) throw new Error('No diff row found');
    const mapName = await mapRow.getAttribute('data-name');
    console.log('  → clicking map:', mapName);
    await mapRow.click();
    await page.waitForTimeout(3000);

    // Debug — mapEditor state
    const state = await page.evaluate(() => ({
      mapPaneExists: !!document.getElementById('map-editor-pane'),
      mapPaneHidden: document.getElementById('map-editor-pane')?.classList.contains('hidden'),
      mapPaneInnerHTMLLen: document.getElementById('map-editor-pane')?.innerHTML.length || 0,
      mapPaneDisplay: window.getComputedStyle(document.getElementById('map-editor-pane') || document.body).display,
      hasBanner: !!document.querySelector('.map-compare-banner'),
      hasSplitBtn: !!document.querySelector('#map-cmp-split-toggle'),
      hasMapTable: !!document.querySelector('#map-grid-table'),
      status: document.getElementById('status-bar')?.textContent,
    }));
    console.log('  debug state:', JSON.stringify(state, null, 2));

    await shot(page, 'verify-split-04-compare-view-default');

    // 8. Click Split toggle in compare banner
    const splitBtn = await page.$('#map-cmp-split-toggle');
    if (!splitBtn) throw new Error('Split toggle not found — the compare banner did not render');
    await splitBtn.click();
    await page.waitForTimeout(800);
    await shot(page, 'verify-split-05-split-view-2D');

    // 9. Toggle 3D view
    const toggle3D = await page.$('#map-toggle-3d');
    if (toggle3D) {
      await toggle3D.click();
      await page.waitForTimeout(800);
      await shot(page, 'verify-split-06-split-view-3D');
    }

    // 10. Click Modifs button to open the clickable list
    // (Back in 2D first for readability — re-query the button since DOM re-rendered)
    const toggle3DAgain = await page.$('#map-toggle-3d');
    if (toggle3DAgain) {
      await toggle3DAgain.click();
      await page.waitForTimeout(600);
    }
    const modifsBtn = await page.$('#map-cmp-list-toggle');
    if (modifsBtn) {
      await modifsBtn.click();
      await page.waitForTimeout(600);
      await shot(page, 'verify-split-07-modifs-list');

      // Click first row in modifs list → should flash cell B
      const firstRow = await page.$('#map-cmp-list-modal .cmp-list-row');
      if (firstRow) {
        console.log('  → click modif row 0');
        await firstRow.click();
        await page.waitForTimeout(800);
        await shot(page, 'verify-split-08-modif-click-flash');
      }
    }

    console.log('\n  ✅ Tous les écrans ont été capturés dans', OUT);
  } catch (e) {
    console.error('  ❌', e.message);
    console.error(e.stack);
    process.exit(1);
  } finally {
    for (const id of createdIds) {
      try { await page.request.delete(URL + '/api/projects/' + id); } catch {}
    }
    await browser.close();
  }
})();
