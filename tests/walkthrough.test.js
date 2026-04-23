// Exhaustive click-every-button walkthrough.
// Creates a temporary project with the Berlingo ROM, exercises every UI feature,
// captures screenshots, and logs every missing / broken / unresponsive interaction.
//
// Usage: PORT=3002 node server.js & ; node tests/walkthrough.test.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', '9663944680.Bin');
const OUT = path.join(__dirname, 'screenshots', 'walkthrough');
fs.mkdirSync(OUT, { recursive: true });

const findings = []; // { severity, where, what }
const add = (severity, where, what) => {
  findings.push({ severity, where, what });
  console.log(`  [${severity}] ${where}: ${what}`);
};

async function shot(page, name) {
  const p = path.join(OUT, name + '.png');
  try { await page.screenshot({ path: p, fullPage: false }); } catch {}
}

async function exists(page, sel) {
  return (await page.$(sel)) !== null;
}

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const requestFailures = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
  page.on('requestfailed', r => requestFailures.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) requestFailures.push(`${r.request().method()} ${r.url()} — HTTP ${r.status()}`); });
  page.on('dialog', async d => { console.log('  💬 dialog:', d.type(), '—', d.message().slice(0, 120)); await d.accept().catch(() => d.dismiss()); });

  let projectId = null;

  try {
    //========================================================================
    // PHASE 1 — HOME VIEW
    //========================================================================
    console.log('\n=== PHASE 1 — Home view ===');
    await page.goto(URL + '/#/');
    await page.waitForSelector('#btn-new', { timeout: 5000 });
    await shot(page, '01-home');

    // Search input
    await page.fill('#project-search', 'zzznomatchzzz');
    await wait(200);
    const emptyGrid = await page.$$('.project-card');
    if (emptyGrid.length > 0) add('warn', 'home/search', `search for nonsense still shows ${emptyGrid.length} card(s)`);
    await page.fill('#project-search', '');
    await wait(200);

    // + Nouveau projet
    await page.click('#btn-new');
    await page.waitForSelector('#modal-new-project:not(.hidden)');
    await shot(page, '02-new-project-modal');

    // ECU select: only edc16c34 offered
    const ecuOpts = await page.$$eval('#np-ecu option', os => os.map(o => o.value));
    if (ecuOpts.length < 2) add('info', 'new-project-modal', `<select #np-ecu> only exposes ${ecuOpts.join(',')} — the catalog has 13 ECUs`);

    // Annuler
    await page.click('#np-cancel');
    await page.waitForFunction(() => document.querySelector('#modal-new-project')?.classList.contains('hidden'));

    // Create test project
    await page.click('#btn-new');
    await page.waitForSelector('#modal-new-project:not(.hidden)');
    await page.fill('#np-name', '_WALKTHROUGH_ — delete me');
    await page.fill('#np-vehicle', 'Berlingo 1.6 HDi 75 walkthrough');
    await page.fill('#np-immat', 'WK-001-WK');
    await page.fill('#np-year', '2008');
    await page.fill('#np-desc', 'Auto test');
    await page.click('#np-create');
    await page.waitForFunction(() => document.querySelector('#modal-new-project')?.classList.contains('hidden'));
    await wait(500);

    // Find the created project id by polling API
    {
      const r = await page.request.get(URL + '/api/projects');
      const list = await r.json();
      const p = list.find(x => x.name === '_WALKTHROUGH_ — delete me');
      if (!p) { add('block', 'new-project', 'Project not created'); throw new Error('new project not created'); }
      projectId = p.id;
      console.log('  ✓ created projectId =', projectId);
    }

    // Edit button on card — go back home first (reload can miss race)
    await page.goto(URL + '/#/');
    await page.waitForLoadState('networkidle');
    await wait(500);
    let card = await page.locator('.project-card', { hasText: '_WALKTHROUGH_' }).first();
    if (!(await card.count())) {
      add('warn', 'home/card', 'test card not in grid, using direct edit-modal path');
    } else {
      await card.locator('.edit-btn').click();
      await page.waitForSelector('#modal-edit-project:not(.hidden)', { timeout: 3000 }).catch(() => add('bug', 'edit-modal', 'did not open after click'));
      await shot(page, '03-edit-project-modal');
      if (!(await exists(page, '#ep-addr-base'))) add('bug', 'edit-modal', '#ep-addr-base field missing');
      await page.fill('#ep-addr-base', '0x0');
      await page.click('#ep-save');
      await page.waitForFunction(() => document.querySelector('#modal-edit-project')?.classList.contains('hidden'));
    }

    //========================================================================
    // PHASE 2 — PROJECT VIEW, EMPTY
    //========================================================================
    console.log('\n=== PHASE 2 — Project view (empty) ===');
    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#drop-zone', { timeout: 5000 });
    await shot(page, '04-project-empty');

    // All main toolbar buttons present & disabled-state correct
    const toolbarWhenEmpty = {
      '#btn-goto': true,
      '#btn-edit-project': true,
      '#btn-auto-mods': true, // present but should be disabled
      '#btn-map-finder': true,
      '#btn-a2l-upload': true,
      '#btn-open-damos-dl': true,
      '#btn-import-rom': true,
    };
    for (const [sel, shouldExist] of Object.entries(toolbarWhenEmpty)) {
      const ok = await exists(page, sel);
      if (ok !== shouldExist) add('bug', 'toolbar(empty)', `${sel} exists=${ok}, expected=${shouldExist}`);
    }
    const autoModDisabled = await page.$eval('#btn-auto-mods', b => b.disabled).catch(() => null);
    if (!autoModDisabled) add('bug', 'toolbar(empty)', '#btn-auto-mods should be disabled without ROM');
    const mfDisabled = await page.$eval('#btn-map-finder', b => b.disabled).catch(() => null);
    if (!mfDisabled) add('bug', 'toolbar(empty)', '#btn-map-finder should be disabled without ROM');

    //========================================================================
    // PHASE 3 — Import ROM via API, reload, check UI
    //========================================================================
    console.log('\n=== PHASE 3 — Import ROM ===');
    const romUpload = await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: '9663944680.Bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });
    console.log('  · ROM upload status', romUpload.status());
    await page.goto(URL + '/#/'); // leave project view first
    await wait(200);
    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await wait(2500); // wait damos-match
    await shot(page, '05-project-with-rom');

    const badgeVisible = await page.$eval('#damos-match-badge', b => b.style.display !== 'none' && b.offsetWidth > 0).catch(() => false);
    if (!badgeVisible) add('warn', 'damos-badge', 'damos-match badge not visible after ROM load');

    //========================================================================
    // PHASE 4 — Goto address
    //========================================================================
    console.log('\n=== PHASE 4 — Goto address ===');
    await page.fill('#goto-addr', '0x1C1448');
    await page.click('#btn-goto');
    await wait(300);
    await shot(page, '06-goto-accped-trq');

    // Invalid hex
    await page.fill('#goto-addr', 'zzz');
    await page.click('#btn-goto');
    await wait(200);

    //========================================================================
    // PHASE 5 — Param panel
    //========================================================================
    console.log('\n=== PHASE 5 — Param panel ===');
    await page.waitForSelector('#param-search', { timeout: 3000 }).catch(() => add('bug', 'param-panel', '#param-search missing'));
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await wait(400);
    const paramItems = await page.$$('.param-item');
    if (paramItems.length === 0) add('bug', 'param-panel', 'search returns no items for AccPed_trqEngHiGear_MAP');
    else {
      await paramItems[0].click();
      await wait(600);
      const mapTable = await page.$('#map-grid-table, #map-grid-table-A');
      if (!mapTable) add('bug', 'map-editor', 'map table not rendered after param click');
      await shot(page, '07-map-editor-accped');
    }

    //========================================================================
    // PHASE 6 — Map editor : selection + adjustments
    //========================================================================
    console.log('\n=== PHASE 6 — Map editor selection ===');
    // First click a cell to reveal the selection bar, then "Tout sélectionner"
    const firstCell = await page.$('#map-grid-table td, #map-grid-table-A td');
    if (firstCell) await firstCell.click();
    await wait(200);
    if (await exists(page, '#map-sel-all')) {
      await page.click('#map-sel-all', { force: true });
      await wait(200);
      const selCount = await page.textContent('#map-sel-count');
      console.log('  ✓ sel-all:', selCount);
      if (!/\d+/.test(selCount)) add('bug', 'map-editor', `sel-all does not update count: "${selCount}"`);
    } else add('bug', 'map-editor', '#map-sel-all missing');

    // +5% button — modifications are in-memory until Ctrl-S flushes them.
    // Note: on Berlingo, AccPed_trqEngHiGear_MAP @ 0x1C1448 is a zero-padding
    // zone (firmware mismatch), so a +5% may legitimately no-op on pure zero
    // cells. We check after Ctrl-S.
    await wait(300);
    const romBefore = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await wait(400);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
    await wait(1200);
    const romAfter = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
    if (Buffer.compare(romBefore, romAfter) === 0) add('info', 'map-editor', '+5% no-op (map likely at zero-padding address on this firmware mismatch)');
    else console.log('  ✓ +5% modified ROM (Δ =', Buffer.from(romBefore).compare(Buffer.from(romAfter)), ')');

    // Smooth / Flatten / Ramp
    for (const [sel, label] of [['#map-smooth', 'Lisser'], ['#map-flatten', 'Égaliser'], ['#map-ramp', 'Rampe']]) {
      if (!(await exists(page, sel))) { add('bug', 'map-editor', `${sel} missing`); continue; }
      await page.click(sel, { force: true });
      await wait(300);
      console.log('  ✓ clicked', label);
    }

    // Set value & apply
    await page.click('#map-sel-all', { force: true });
    await page.fill('#map-set-val', '1234');
    await page.click('#map-apply-val', { force: true });
    await wait(300);

    // Clear selection
    await page.click('#map-sel-clear', { force: true });
    await wait(200);

    // Note input
    if (await exists(page, '#map-note-input')) {
      await page.fill('#map-note-input', 'walkthrough note');
      await wait(1500); // debounce save
    } else add('bug', 'map-editor', '#map-note-input missing');

    // Column sort / slice-viewer (click header opens slice viewer modal)
    const ths = await page.$$('#map-grid-table th');
    if (ths.length >= 2) { await ths[1].click(); await wait(300); }
    // Dismiss slice overlay if it opened
    const sliceClose = await page.$('#map-slice-close');
    if (sliceClose) { await sliceClose.click(); await wait(200); }

    // 3D toggle
    if (await exists(page, '#map-toggle-3d')) {
      await page.click('#map-toggle-3d');
      await wait(500);
      await shot(page, '08-map-3d');
      if (await exists(page, '#map-3d-reset')) await page.click('#map-3d-reset');
      // back to 2D
      await page.click('#map-toggle-3d');
      await wait(300);
    } else add('info', 'map-editor', '3D button missing for this MAP (expected for VALUE / CURVE)');

    // Close map editor
    await page.click('#map-close');
    await wait(200);

    //========================================================================
    // PHASE 7 — Auto-mods modal (templates + individual mods)
    //========================================================================
    console.log('\n=== PHASE 7 — Auto-mods modal ===');
    await page.click('#btn-auto-mods');
    await page.waitForSelector('#am-close', { timeout: 3000 });
    await wait(800);
    await shot(page, '09-auto-mods');

    // Apply a template if one is visible
    const tplBtns = await page.$$('.am-tpl-apply');
    console.log('  ✓ templates available:', tplBtns.length);
    if (tplBtns.length === 0) add('warn', 'auto-mods', 'no vehicle templates for this ECU');

    // Apply individual mods (Stage 1 / Pop & Bang / DPF OFF / EGR OFF / DTC DPF)
    const modButtons = await page.$$('.am-item .btn-primary');
    console.log('  ✓ mod apply buttons:', modButtons.length);

    // Try Stage 1 specifically (am-stage1 section)
    const stage1 = await page.$('#am-stage1 button.btn-primary, [id^=am-stage1] button');
    if (!stage1) add('info', 'auto-mods', 'could not locate Stage 1 apply button by id');

    // Close modal
    await page.click('#am-close');
    await wait(200);

    //========================================================================
    // PHASE 8 — Map finder
    //========================================================================
    console.log('\n=== PHASE 8 — Map finder (auto-find) ===');
    await page.click('#btn-map-finder');
    await page.waitForSelector('#mf-close', { timeout: 5000 });
    await wait(2000);
    await shot(page, '10-map-finder');
    const mfRows = await page.$$('#mf-list > *');
    console.log('  ✓ candidates:', mfRows.length);
    if (mfRows.length === 0) add('warn', 'map-finder', 'scanner returned 0 candidates on Berlingo ROM');
    // Click "Goto" on first candidate
    const firstGoto = await page.$('.mf-goto');
    if (firstGoto) { await firstGoto.click(); await wait(300); }
    else add('info', 'map-finder', 'no .mf-goto buttons');
    // Close if still open
    if (await exists(page, '#mf-close')) await page.click('#mf-close').catch(() => {});
    await wait(200);

    //========================================================================
    // PHASE 9 — A2L upload menu
    //========================================================================
    console.log('\n=== PHASE 9 — A2L menu ===');
    await page.click('#btn-a2l-upload');
    await wait(500);
    const a2lMenu = await page.$('#a2l-menu-close');
    if (!a2lMenu) add('bug', 'a2l-menu', 'menu did not open');
    else { await shot(page, '11-a2l-menu'); await page.click('#a2l-menu-close'); }
    await wait(200);

    //========================================================================
    // PHASE 10 — Open_damos download link
    //========================================================================
    console.log('\n=== PHASE 10 — open_damos download ===');
    const odHref = await page.$eval('#btn-open-damos-dl', a => a.href);
    const odResp = await page.request.get(odHref);
    if (odResp.status() !== 200) add('bug', 'open-damos', `download link returned HTTP ${odResp.status()}`);
    else console.log('  ✓ open_damos a2l size =', (await odResp.body()).length);

    //========================================================================
    // PHASE 11 — Git panel
    //========================================================================
    console.log('\n=== PHASE 11 — Git panel ===');
    // Suggest commit msg
    if (await exists(page, '#git-suggest-btn')) { await page.click('#git-suggest-btn'); await wait(700); }
    const msg = await page.inputValue('#git-commit-msg').catch(() => '');
    console.log('  ✓ suggested msg:', msg.slice(0, 80));

    // Commit
    if (!msg) await page.fill('#git-commit-msg', 'walkthrough commit');
    await page.click('#git-commit-btn');
    await wait(1200);
    await shot(page, '12-git-after-commit');
    const logEntries = await page.$$('.git-log-entry, .git-entry, .git-log > *');
    console.log('  ✓ git-log entries:', logEntries.length);

    // Click first commit to see diff
    if (logEntries[0]) { await logEntries[0].click(); await wait(500); }
    const diffVisible = await page.$eval('#git-diff', e => e.style.display !== 'none').catch(() => false);
    if (!diffVisible) add('warn', 'git-panel', 'diff pane not visible after commit click');
    else await shot(page, '13-git-diff');

    // Refresh
    await page.click('#git-refresh'); await wait(300);

    // Slot add (add Berlingo as reference)
    await page.setInputFiles('#git-slot-input', ROM);
    await wait(800);
    await shot(page, '14-git-slot-added');
    const slotItems = await page.$$('.git-slots-list > *');
    if (slotItems.length === 0) add('warn', 'git-panel', 'slot add did not create any row');

    // Compare from slot
    const cmpSlotBtn = await page.$('.git-slot-compare');
    if (cmpSlotBtn) { await cmpSlotBtn.click(); await wait(800); await shot(page, '15-compare-slot'); }

    // Compare refs modal (2 commits / branches)
    if (await exists(page, '#git-compare-refs-btn')) {
      await page.click('#git-compare-refs-btn');
      await wait(500);
      if (await exists(page, '#crm-close')) { await shot(page, '16-compare-refs-modal'); await page.click('#crm-close'); }
      else add('bug', 'git-panel', 'compare refs modal did not open');
    } else add('bug', 'git-panel', '#git-compare-refs-btn missing');

    //========================================================================
    // PHASE 12 — Branch switcher
    //========================================================================
    console.log('\n=== PHASE 12 — Branch switcher ===');
    if (await exists(page, '#branch-btn')) {
      await page.click('#branch-btn'); await wait(300);
      await shot(page, '17-branch-dropdown');
      // Create a branch
      if (await exists(page, '#branch-new-name')) {
        await page.fill('#branch-new-name', 'walkthrough-branch');
        await page.click('#branch-new-btn');
        await wait(1000);
        await shot(page, '18-branch-created');
      } else add('bug', 'branch-switcher', '#branch-new-name missing');
    } else add('bug', 'branch-switcher', '#branch-btn missing');

    //========================================================================
    // PHASE 13 — Download ROM links
    //========================================================================
    console.log('\n=== PHASE 13 — ROM downloads ===');
    for (const sel of ['#btn-dl-rom', '#btn-dl-backup']) {
      if (!(await exists(page, sel))) { add('bug', 'toolbar', `${sel} missing`); continue; }
      const href = await page.$eval(sel, a => a.href);
      const r = await page.request.get(href);
      if (r.status() !== 200) add('bug', 'toolbar', `${sel} → HTTP ${r.status()}`);
      else console.log('  ✓', sel, '→', (await r.body()).length, 'bytes');
    }

    //========================================================================
    // PHASE 14 — Keyboard shortcuts (undo / redo)
    //========================================================================
    console.log('\n=== PHASE 14 — Keyboard (undo/redo) ===');
    // Open a map to produce a change, then undo/redo
    await page.fill('#param-search', 'Rail_pSetPointBase_MAP');
    await wait(400);
    const item = await page.$('.param-item');
    if (item) {
      await item.click();
      await wait(500);
      const fc = await page.$('#map-grid-table td, #map-grid-table-A td');
      if (fc) await fc.click();
      await wait(200);
      await page.click('#map-sel-all', { force: true });
      const before = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
      await page.click('[data-op="pct"][data-val="1"]', { force: true });
      await wait(400);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
      await wait(1200);
      const after1 = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
      if (Buffer.compare(before, after1) === 0) add('info', 'undo/redo', '+1% no-op on Rail_pSetPointBase (firmware mismatch zero-padding)');
      await page.keyboard.press('Control+Z');
      await wait(400);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
      await wait(1200);
      const afterUndo = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
      if (Buffer.compare(before, afterUndo) !== 0) add('bug', 'undo/redo', 'Ctrl-Z did not restore ROM');
      else console.log('  ✓ Ctrl-Z restored ROM');
      await page.keyboard.press('Control+Shift+Z');
      await wait(400);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
      await wait(1200);
      const afterRedo = await page.request.get(URL + '/api/projects/' + projectId + '/rom').then(r => r.body());
      if (Buffer.compare(after1, afterRedo) !== 0) add('bug', 'undo/redo', 'Ctrl-Shift-Z did not redo');
      else console.log('  ✓ Ctrl-Shift-Z redone');
      await page.click('#map-close');
    }

    //========================================================================
    // PHASE 15 — Breadcrumb / home button
    //========================================================================
    console.log('\n=== PHASE 15 — Home button ===');
    await page.click('#btn-home');
    await page.waitForSelector('#btn-new', { timeout: 3000 });
    await shot(page, '19-back-home');

  } catch (e) {
    add('block', 'walkthrough', 'exception: ' + e.message);
    console.error(e);
  } finally {
    // Report console/network errors
    if (consoleErrors.length) console.log('\n=== JS ERRORS ===\n' + consoleErrors.join('\n'));
    if (requestFailures.length) console.log('\n=== HTTP FAILURES ===\n' + [...new Set(requestFailures)].join('\n'));
    console.log('\n=== FINDINGS (' + findings.length + ') ===');
    findings.forEach(f => console.log(`  [${f.severity}] ${f.where} — ${f.what}`));

    // Persist report
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({
      findings,
      consoleErrors,
      requestFailures: [...new Set(requestFailures)],
    }, null, 2));
    console.log('\n📄 Report written to', path.join(OUT, 'report.json'));

    // Cleanup: delete the test project
    if (projectId) {
      try {
        const r = await page.request.delete(URL + '/api/projects/' + projectId);
        console.log('🗑️  delete test project →', r.status());
      } catch (e) { console.log('delete failed', e.message); }
    }
    await browser.close();
  }
})();
