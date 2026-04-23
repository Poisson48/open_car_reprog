// Audit exploratoire v0.5.0 — cherche les rough edges que le walkthrough
// automatisé ne voit pas : interactions entre features, états limites,
// cohérence visuelle, gestion d'erreur.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');
const BERLINGO = path.join(__dirname, '..', 'ressources', 'edc16c34', '9663944680.Bin');
const OUT = path.join(__dirname, 'screenshots', 'v05-audit');
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const add = (severity, where, what) => {
  findings.push({ severity, where, what });
  console.log(`  [${severity}] ${where}: ${what}`);
};

async function shot(page, name) {
  try { await page.screenshot({ path: path.join(OUT, name + '.png') }); } catch {}
}
async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const httpFailures = [];
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) httpFailures.push(`${r.request().method()} ${r.url()} → HTTP ${r.status()}`); });
  page.on('dialog', async d => await d.accept().catch(() => d.dismiss()));

  const created = [];

  try {
    //════════════════════════════════════════════════════════════════════════
    // A — Home : états limites + interaction batch-apply sans projet compatible
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ A. Home & batch-apply edge cases ═══');
    await page.goto(URL + '/#/');
    await page.waitForSelector('#btn-batch-apply', { state: 'attached' });
    await shot(page, 'A1-home');

    // A1 : ouvrir batch-apply quand on a des projets existants mais AUCUN ROM importé
    // Créer un projet sans ROM
    const noRom = await page.request.post(URL + '/api/projects', { data: { name: '_A_noROM', ecu: 'edc16c34' } });
    const noRomId = (await noRom.json()).id;
    created.push(noRomId);
    await page.reload();
    await wait(400);
    await page.click('#btn-batch-apply');
    await page.waitForSelector('#ba-template', { timeout: 3000 });
    await wait(400);
    await shot(page, 'A1-batch-modal');
    const baCount = await page.textContent('#ba-count');
    console.log('  batch count:', baCount);
    // Sans-ROM projet doit être exclu de la liste. Vérifions.
    const hasNoRomChk = await page.$(`.ba-chk[data-id="${noRomId}"]`);
    if (hasNoRomChk) add('bug', 'batch-apply', 'projet sans ROM est listé (devrait être exclu)');

    await page.click('#ba-close');
    await wait(200);

    //════════════════════════════════════════════════════════════════════════
    // B — Projet vide : toolbar en état "sans ROM"
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ B. Projet sans ROM — états des boutons ═══');
    await page.goto(URL + '/#/project/' + noRomId);
    await page.waitForSelector('#drop-zone', { timeout: 5000 });
    await wait(300);
    await shot(page, 'B1-empty-project');

    // Le toggle unités doit être utilisable même sans ROM
    const unitsBtn = await page.$('#btn-units-toggle');
    if (!unitsBtn) add('bug', 'units-toggle', 'bouton absent sans ROM');
    else {
      const vis = await unitsBtn.isVisible();
      if (!vis) add('warn', 'units-toggle', 'bouton non visible sans ROM');
    }

    // Rapport doit être GRISÉ ou ABSENT sans ROM (pas de contenu à rapporter)
    const reportLink = await page.$('#btn-report');
    if (reportLink) add('bug', 'report', 'bouton Rapport présent sans ROM (devrait être caché ou disabled)');

    // Auto-mods & Auto-find doivent être disabled
    const amDisabled = await page.$eval('#btn-auto-mods', b => b.disabled).catch(() => null);
    if (!amDisabled) add('bug', 'toolbar', 'Auto-mods pas disabled sans ROM');
    const afDisabled = await page.$eval('#btn-map-finder', b => b.disabled).catch(() => null);
    if (!afDisabled) add('bug', 'toolbar', 'Auto-find pas disabled sans ROM');

    // open_damos et A2L upload devraient être disabled aussi (pas de ROM à matcher)
    const odAttr = await page.$eval('#btn-open-damos-dl', a => ({ href: a.href, hasAriaDisabled: a.hasAttribute('aria-disabled') })).catch(() => null);
    if (odAttr && !odAttr.hasAriaDisabled) {
      // Fetch it — it might 400
      const r = await page.request.get(odAttr.href);
      if (r.ok()) add('warn', 'open_damos', `lien 🧬 open_damos téléchargeable même sans ROM (HTTP ${r.status()})`);
      else console.log('  ✓ open_damos HTTP', r.status(), 'sans ROM (attendu)');
    }

    //════════════════════════════════════════════════════════════════════════
    // C — Projet avec ROM : interactions croisées
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ C. Interactions cross-feature ═══');
    const full = await page.request.post(URL + '/api/projects', {
      data: { name: '_C_full', vehicle: 'Peugeot 308 HDi', immat: 'AB-123-XY', year: '2010', ecu: 'edc16c34' }
    });
    const fid = (await full.json()).id;
    created.push(fid);
    await page.request.post(URL + '/api/projects/' + fid + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + fid);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await wait(1500);

    // C1 : toggle unités pendant qu'une map est ouverte
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await wait(400);
    await (await page.$('.param-item')).click();
    await wait(800);

    const nmVal = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    await page.click('#btn-units-toggle');
    await wait(500);
    const lbVal = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  C1 toggle units while map open:', nmVal, 'Nm →', lbVal, 'lb·ft');
    if (Math.abs(lbVal - nmVal * 0.7376) > 0.1) add('bug', 'units', `conversion cellule [0,0] mauvaise : ${nmVal} → ${lbVal}`);

    // C2 : ajuster +5% en mode lb·ft → la modif doit persister quand on rebascule en Nm
    await (await page.$('#map-grid-table td')).click();
    await wait(200);
    await page.click('#map-sel-all', { force: true });
    await wait(200);
    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await wait(500);
    const lbAfterPct = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    await page.click('#btn-units-toggle');
    await wait(500);
    const nmAfterPct = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  C2 +5% in lb·ft → Nm display:', lbAfterPct, 'lb·ft ↔', nmAfterPct, 'Nm');
    if (Math.abs(lbAfterPct * 1.35582 - nmAfterPct) > 0.5) add('bug', 'units', `+5% dans unité converti ne roundtrip pas : ${lbAfterPct} lb·ft × 1.35582 ≠ ${nmAfterPct} Nm`);
    await shot(page, 'C2-pct-in-unit');

    // C3 : ouvrir le 3D delta sans commit parent → bouton "Δ vs parent" doit alerter proprement
    // Project vient d'être créé, il y a 1 commit initial. Diff vs parent inexistant.
    // D'abord commit les modifs
    await page.fill('#git-commit-msg', 'C2 test');
    await page.click('#git-commit-btn');
    await wait(1500);

    // Maintenant il y a HEAD + parent. Click Δ vs parent
    const dvp = await page.$('#map-cmp-parent');
    if (dvp) {
      await dvp.click();
      await wait(1200);
      // Bannière compare doit être visible
      const banner = await page.$('.map-compare-banner');
      if (!banner) add('bug', '3D-delta', '"Δ vs parent" cliqué mais pas de bannière compare');
      await shot(page, 'C3-delta-vs-parent');
    } else add('warn', 'toolbar', 'bouton "Δ vs parent" absent alors qu\'il y a 2 commits');

    //════════════════════════════════════════════════════════════════════════
    // D — Compare mode : interactions
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ D. Compare mode UI ═══');

    // En compare mode, on vérifie que le toggle unités synchronise le header.
    // État avant D1 : la toolbar peut être Nm ou lb·ft selon le chemin. On
    // lit l'état courant depuis le bouton, on clique une fois, et on vérifie
    // que le header A2L affiche bien l'unité opposée.
    const before = await page.textContent('#btn-units-label');
    const startedInLbft = /lb·ft/.test(before);
    await page.click('#btn-units-toggle');
    await wait(400);
    await shot(page, 'D1-compare-mode-units');
    const compareHeader = await page.$eval('.map-toolbar', el => el.textContent).catch(() => '');
    const expectedUnit = startedInLbft ? 'Nm' : 'lb·ft';
    const expectedRe = startedInLbft ? /\bNm\b/ : /lb·ft/i;
    if (!expectedRe.test(compareHeader)) add('bug', 'compare+units', `toolbar map pas en "${expectedUnit}" après toggle en compare mode (header: "${compareHeader.slice(0, 120)}")`);
    // Vérifier aussi qu'on est toujours en compare mode (bannière visible)
    const bannerStill = await page.$('.map-compare-banner');
    if (!bannerStill) add('bug', 'compare+units', 'toggle unités a cassé le compare mode (bannière disparue)');

    // Le cycle 3D modes
    await page.click('#map-toggle-3d'); // back to 2D
    await wait(400);
    await page.click('#map-toggle-3d'); // 3D again
    await wait(400);
    const modeBtnTxt1 = await page.textContent('#map-3d-mode').catch(() => null);
    console.log('  D2 3D mode btn:', modeBtnTxt1);
    if (modeBtnTxt1) {
      await page.click('#map-3d-mode');
      await wait(400);
      const modeBtnTxt2 = await page.textContent('#map-3d-mode');
      console.log('  → cycle:', modeBtnTxt2);
      if (modeBtnTxt1 === modeBtnTxt2) add('bug', '3D-cycle', 'cycle sur bouton mode ne change pas le label');
    }
    await shot(page, 'D2-cycle-3d-modes');

    // Fermer la carte, toggle unités pour remettre Nm
    await page.click('#map-close').catch(() => {});
    await wait(200);
    const unitsLabel = await page.textContent('#btn-units-label');
    if (/lb·ft/.test(unitsLabel)) {
      await page.click('#btn-units-toggle');
      await wait(300);
    }

    //════════════════════════════════════════════════════════════════════════
    // E — Rapport : cas où pas de modification
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ E. Rapport — cas limites ═══');
    // Nouveau projet fresh sans modifs : rapport doit dire "aucune modif"
    const fresh = await page.request.post(URL + '/api/projects', { data: { name: '_E_fresh', ecu: 'edc16c34' } });
    const freshId = (await fresh.json()).id;
    created.push(freshId);
    await page.request.post(URL + '/api/projects/' + freshId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });
    const r = await page.request.get(URL + '/api/projects/' + freshId + '/report.html');
    const html = await r.text();
    if (!/Aucune modification détectée/.test(html)) add('bug', 'report', 'rapport sans modifs ne dit pas "Aucune modification détectée"');
    else console.log('  ✓ rapport sans modifs : "Aucune modification détectée"');

    //════════════════════════════════════════════════════════════════════════
    // F — Auto-find filter : edge cases
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ F. Auto-find filter edge cases ═══');
    await page.goto(URL + '/#/project/' + freshId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await wait(1500);
    await page.click('#btn-map-finder');
    await page.waitForSelector('#mf-filter', { timeout: 5000 });
    await wait(3000); // wait scan

    // F1 : filtre qui ne matche rien → message "Aucun candidat ne correspond au filtre"
    await page.fill('#mf-filter', 'zz-no-match-zz');
    await wait(400);
    const mfMsg = await page.textContent('#mf-list');
    if (!/Aucun candidat/.test(mfMsg)) add('bug', 'auto-find', 'filtre sans match ne montre pas le bon message');
    else console.log('  ✓ filter no-match :', mfMsg.trim().slice(0, 60));

    // F2 : clear filter → liste revient
    await page.fill('#mf-filter', '');
    await wait(400);
    const rowsAfter = await page.$$eval('.mf-row', rs => rs.length);
    if (rowsAfter < 10) add('bug', 'auto-find', `après clear filter, ${rowsAfter} rows seulement`);

    // F3 : le compteur
    const filterCount = await page.textContent('#mf-filter-count');
    console.log('  F3 filter-count label:', filterCount);

    await page.click('#mf-close').catch(() => {});
    await wait(200);

    //════════════════════════════════════════════════════════════════════════
    // G — Largeurs étroites : layout break ?
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ G. Responsive layout ═══');
    await page.setViewportSize({ width: 1200, height: 800 });
    await wait(400);
    await shot(page, 'G1-narrow-1200');
    await page.setViewportSize({ width: 1000, height: 800 });
    await wait(400);
    await shot(page, 'G2-narrow-1000');

    // Vérifie que la toolbar n'overflow pas trop méchamment
    const toolbarOverflow = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      if (!tb) return null;
      return { scrollW: tb.scrollWidth, clientW: tb.clientWidth, overflow: tb.scrollWidth > tb.clientWidth };
    });
    if (toolbarOverflow?.overflow) {
      console.log('  G1 toolbar overflow à 1000px:', toolbarOverflow);
      add('info', 'layout', `toolbar overflow horizontale à 1000×800 : scroll ${toolbarOverflow.scrollW}px vs visible ${toolbarOverflow.clientW}px`);
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await wait(200);

    //════════════════════════════════════════════════════════════════════════
    // H — Keyboard et édition inline d'une cellule
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ H. Édition cellule + unités ═══');
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await wait(400);
    await (await page.$('.param-item')).click();
    await wait(600);

    // H1 : taper une valeur directement dans une cellule
    const cell = await page.$('input[data-xi="5"][data-yi="5"]');
    const oldV = await cell.inputValue();
    await cell.fill('999');
    await cell.press('Enter');
    await wait(400);
    const newV = await cell.inputValue();
    console.log('  H1 direct edit:', oldV, '→', newV);
    if (newV !== '999.00' && newV !== '999') add('warn', 'inline-edit', `valeur tapée 999, affichée ${newV}`);

    // H2 : taper dans le champ de valeur directe en mode Apply
    // (sélectionner d'abord)
    await (await page.$('#map-grid-table td')).click();
    await page.click('#map-sel-all', { force: true });
    await page.fill('#map-set-val', '42');
    await page.click('#map-apply-val', { force: true });
    await wait(400);
    const afterSet = await page.$eval('input[data-xi="0"][data-yi="0"]', i => i.value);
    console.log('  H2 apply value 42:', afterSet);
    // Note : comme on est en lb·ft, 42 reste 42 ; mais si on revient en Nm ça devrait être 42 * 1.356 = 56.95
    // Actually we set units back to Nm earlier, so 42 stays 42.

    //════════════════════════════════════════════════════════════════════════
    // I — Goto : déplacement après hex validation OK
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ I. Goto → scroll réel ═══');
    await page.click('#map-close').catch(() => {});
    await wait(200);
    await page.fill('#goto-addr', '0x1E9DD4');
    await page.click('#btn-goto');
    await wait(500);
    await shot(page, 'I1-goto-1E9DD4');
    const scrollTop = await page.$eval('#hex-scroll', s => s.scrollTop);
    console.log('  I1 scrollTop after goto 0x1E9DD4:', scrollTop);
    if (scrollTop === 0) add('bug', 'goto', 'goto valide mais scrollTop=0 — la navigation ne marche pas');

    //════════════════════════════════════════════════════════════════════════
    // J — Branches : dropdown visuellement correct après suppression
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ J. Branch switcher après delete ═══');
    await page.request.post(URL + '/api/projects/' + freshId + '/git/branches', { data: { name: 'J-tmp' } });
    await page.request.put(URL + '/api/projects/' + freshId + '/git/branches/master');
    await page.reload();
    await wait(1500);
    await page.click('#branch-btn');
    await wait(300);
    await shot(page, 'J1-branches-with-tmp');
    // Delete via UI
    const delBtn = await page.$('.branch-del[data-name="J-tmp"]');
    if (delBtn) {
      await delBtn.click();
      await wait(1500);
      await shot(page, 'J2-branches-after-delete');
      const list = await page.request.get(URL + '/api/projects/' + freshId + '/git/branches').then(r => r.json());
      if (list.all.includes('J-tmp')) add('bug', 'branch-delete', 'branche J-tmp encore présente après click 🗑');
    } else add('bug', 'branch-switcher', '🗑 absent sur branche non-courante');

    //════════════════════════════════════════════════════════════════════════
    // K — Notes : débordement
    //════════════════════════════════════════════════════════════════════════
    console.log('\n═══ K. Notes longues ═══');
    await page.fill('#param-search', 'Rail_pSetPointBase_MAP');
    await wait(400);
    await (await page.$('.param-item')).click();
    await wait(600);
    const noteInput = await page.$('#map-note-input');
    if (noteInput) {
      const longNote = 'x'.repeat(500);
      await noteInput.fill(longNote);
      await wait(1500);
      // reload map & check note
      await page.click('#map-close').catch(() => {});
      await wait(200);
      await (await page.$('.param-item')).click();
      await wait(600);
      const readBack = await page.$eval('#map-note-input', i => i.value);
      if (readBack.length !== 500) add('warn', 'notes', `note de 500 chars tronquée à ${readBack.length}`);
      else console.log('  ✓ note 500 chars OK');
    }

  } catch (e) {
    add('block', 'audit', 'exception: ' + e.message);
    console.error(e);
  } finally {
    console.log('\n═══ FINDINGS (' + findings.length + ') ═══');
    findings.forEach(f => console.log(`  [${f.severity}] ${f.where} — ${f.what}`));

    if (consoleErrors.length) {
      console.log('\n═══ JS ERRORS (' + consoleErrors.length + ') ═══');
      for (const e of consoleErrors.slice(0, 20)) console.log('  ' + e);
    }
    if (httpFailures.length) {
      const uniq = [...new Set(httpFailures)];
      console.log('\n═══ HTTP FAILURES (' + uniq.length + ' unique) ═══');
      for (const f of uniq.slice(0, 20)) console.log('  ' + f);
    }

    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({
      findings,
      consoleErrors,
      httpFailures: [...new Set(httpFailures)]
    }, null, 2));
    console.log('\n📄 Report : ' + path.join(OUT, 'report.json'));

    for (const id of created) {
      await page.request.delete(URL + '/api/projects/' + id).catch(() => {});
    }
    await browser.close();
  }
})();
