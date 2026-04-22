// Verifies the "compare with an external file" flow:
// - upload a different .bin through the git panel
// - the server diff surfaces the maps that changed
// - clicking a map row opens the map editor in compare mode vs that file

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
const DOCS = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200; // 0x1C1448

function buildRom(withHill) {
  const NX = 8, NY = 8;
  const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
  rom.writeInt16BE(NX, MAP_ADDR);
  rom.writeInt16BE(NY, MAP_ADDR + 2);
  for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
  for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
  const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
  for (let yi = 0; yi < NY; yi++) {
    for (let xi = 0; xi < NX; xi++) {
      // Flat 500 for the "ori", or a Gaussian hill for the "tune"
      const dx = xi - 3.5, dy = yi - 3.5;
      const z = withHill ? Math.round(500 + 600 * Math.exp(-(dx * dx + dy * dy) / 6)) : 500;
      rom.writeInt16BE(z, dataOff + (yi * NX + xi) * 2);
    }
  }
  return rom;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-cmp-file', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Project ROM = the "tune" (with the Gaussian hill)
    const tune = buildRom(true);
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'tune.bin', mimeType: 'application/octet-stream', buffer: tune } }
    });

    // Open UI
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#git-compare-btn', { timeout: 5000 });
    await page.waitForTimeout(300);

    // Screenshot the empty state of the panel
    const panel = await page.$('.git-panel');
    await panel.screenshot({ path: path.join(OUT, 'compare-file-empty.png') });

    // Upload the "ori" (flat ROM) as the compare reference via the input
    const ori = buildRom(false);
    const oriPath = path.join(OUT, '_ori.bin');
    fs.writeFileSync(oriPath, ori);
    const fileInput = await page.$('#git-compare-input');
    await fileInput.setInputFiles(oriPath);

    // Wait for the diff list to populate
    await page.waitForSelector('.map-diff-row', { timeout: 5000 });
    await page.waitForTimeout(300);

    // Assert the status banner shows the filename
    const statusText = await page.$eval('#git-compare-status', el => el.textContent);
    if (!statusText.includes('_ori.bin')) throw new Error(`status banner missing filename, got "${statusText}"`);
    console.log('status banner:', statusText.trim().slice(0, 120));

    // Assert the target map is in the diff list
    const diffNames = await page.$$eval('.map-diff-row', rows => rows.map(r => r.getAttribute('data-name')));
    console.log('maps in diff:', diffNames.length, 'first few:', diffNames.slice(0, 5));
    if (!diffNames.includes(MAP_NAME)) throw new Error(`${MAP_NAME} missing from diff list`);

    // Screenshot the panel with the diff list visible
    await panel.screenshot({ path: path.join(OUT, 'compare-file-diff.png') });
    fs.copyFileSync(path.join(OUT, 'compare-file-diff.png'), path.join(DOCS, 'compare-file.png'));
    console.log('  📸 compare-file.png');

    // Click the target map → compare mode in the editor
    const rows = await page.$$('.map-diff-row');
    for (const r of rows) {
      if ((await r.getAttribute('data-name')) === MAP_NAME) { await r.click(); break; }
    }
    await page.waitForSelector('.map-compare-banner', { timeout: 3000 });
    const banner = await page.$eval('.map-compare-banner', el => el.textContent);
    if (!banner.includes('_ori.bin')) throw new Error(`compare banner missing filename, got "${banner}"`);
    console.log('compare banner:', banner.trim());

    // At least 1 cell should be highlighted (all center cells differ)
    const highlighted = await page.$$eval('#map-grid-table td', tds =>
      tds.filter(td => td.style.boxShadow && td.style.boxShadow !== 'none').length
    );
    console.log('highlighted cells:', highlighted);
    if (highlighted < 5) throw new Error(`expected ≥5 highlighted cells, got ${highlighted}`);

    // Screenshot the full editor area
    const pane = await page.$('#map-editor-pane');
    await pane.screenshot({ path: path.join(OUT, 'compare-file-mapeditor.png') });
    fs.copyFileSync(path.join(OUT, 'compare-file-mapeditor.png'), path.join(DOCS, 'compare-file-editor.png'));
    console.log('  📸 compare-file-editor.png');

    // Now clear the compare: the diff area should collapse
    await page.click('#git-compare-clear');
    await page.waitForTimeout(200);
    const stillHasRows = await page.$('.map-diff-row');
    if (stillHasRows) throw new Error('diff list should be cleared after "✕"');
    console.log('clear works ✓');

    // Server should have forgotten the file too
    const afterClear = await page.request.get(URL + `/api/projects/${id}/compare-file`);
    if (afterClear.status() !== 404) throw new Error(`expected 404 after clear, got ${afterClear.status()}`);

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-compare-file.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
