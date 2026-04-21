// Integration test for map-level git diff.
// Creates a project with a synthetic 2MB ROM, commits it, mutates bytes at the
// known Stage 1 map address, commits again, and verifies the map-level diff
// endpoint returns that A2L characteristic.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// Target param from the A2L (real declared address for ECU edc16c34).
// VALUE type = simplest, 2 bytes.
const TARGET_NAME = 'ACCD_uSRCMin_C';
const TARGET_ADDR = 1840076; // 0x1C13CC
// A MAP param we also expect to detect when we patch inside its data region.
const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200; // 0x1C1448

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleMsgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    // 1. Create project
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-diff-map', ecu: 'edc16c34' }
    });
    id = (await proj.json()).id;
    console.log('project:', id);

    // 2. Synthetic 2 MB ROM filled with a recognizable pattern (0xAA).
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    // Seed a plausible MAP structure at MAP_ADDR so we can count data cells.
    rom.writeInt16BE(8, MAP_ADDR);
    rom.writeInt16BE(8, MAP_ADDR + 2);
    for (let i = 0; i < 8; i++) rom.writeInt16BE(100 + i * 100, MAP_ADDR + 4 + i * 2);
    for (let i = 0; i < 8; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + 8 * 2 + i * 2);
    const mapDataOff = MAP_ADDR + 4 + 8 * 2 + 8 * 2;
    for (let i = 0; i < 64; i++) rom.writeInt16BE(500, mapDataOff + i * 2);
    // Seed a value at TARGET_ADDR
    rom.writeInt16BE(1234, TARGET_ADDR);

    fs.writeFileSync('/tmp/pw-diff-rom.bin', rom);

    // 3. Import ROM (this creates an "Import ROM" commit)
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: {
        rom: { name: 'pw-diff-rom.bin', mimeType: 'application/octet-stream', buffer: rom }
      }
    });

    // 4a. Modify VALUE at TARGET_ADDR (1234 → 5678)
    const v = Buffer.alloc(2); v.writeInt16BE(5678, 0);
    await page.request.patch(URL + `/api/projects/${id}/rom/bytes`, {
      data: { offset: TARGET_ADDR, data: v.toString('base64') }
    });

    // 4b. Modify one cell of the MAP data (500 → 600)
    const m = Buffer.alloc(2); m.writeInt16BE(600, 0);
    await page.request.patch(URL + `/api/projects/${id}/rom/bytes`, {
      data: { offset: mapDataOff, data: m.toString('base64') }
    });

    // 5. Commit
    await page.request.post(URL + `/api/projects/${id}/git/commit`, {
      data: { message: 'Test diff-maps' }
    });

    // 6. Get latest commit hash
    const logRes = await page.request.get(URL + `/api/projects/${id}/git/log`);
    const log = await logRes.json();
    const headHash = log[0].hash;
    console.log('HEAD:', headHash, '|', log[0].message);

    // 7. Call diff-maps endpoint
    const diffRes = await page.request.get(URL + `/api/projects/${id}/git/diff-maps/${headHash}`);
    const diff = await diffRes.json();
    console.log('diff.maps count:', diff.maps?.length);

    const valueFound = diff.maps?.find(m => m.name === TARGET_NAME);
    const mapFound = diff.maps?.find(m => m.name === MAP_NAME);
    if (!valueFound) {
      console.log('All returned maps:', diff.maps?.slice(0, 20).map(m => m.name));
      throw new Error(`Expected ${TARGET_NAME} in maps, not found`);
    }
    if (!mapFound) {
      console.log('All returned maps:', diff.maps?.slice(0, 20).map(m => m.name));
      throw new Error(`Expected ${MAP_NAME} in maps, not found`);
    }
    console.log('✓ Found VALUE:', valueFound.name, valueFound.sample);
    console.log('✓ Found MAP:', mapFound.name, mapFound.sample, 'cells:', mapFound.cellsChanged);
    if (valueFound.sample?.before !== 1234 || valueFound.sample?.after !== 5678) {
      throw new Error(`VALUE sample mismatch: ${JSON.stringify(valueFound.sample)}`);
    }
    if (mapFound.sample?.before !== 500 || mapFound.sample?.after !== 600) {
      throw new Error(`MAP sample mismatch: ${JSON.stringify(mapFound.sample)}`);
    }
    if (mapFound.cellsChanged < 1) throw new Error('MAP cellsChanged should be ≥ 1');

    // 8. UI: open project, click the commit, see the map diff
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('.git-entry', { timeout: 5000 });
    await page.waitForTimeout(400);
    // Widen the git panel so the map diff is readable in screenshots
    await page.evaluate(() => {
      const p = document.getElementById('git-panel');
      if (p) p.style.width = '420px';
    });
    await page.click('.git-entry:first-child');
    await page.waitForSelector('.map-diff-row', { timeout: 3000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, 'diff-map-level.png'), fullPage: false });
    // Also capture just the git panel region
    const gp = await page.$('#git-panel');
    if (gp) await gp.screenshot({ path: path.join(OUT, 'diff-map-level-panel.png') });
    console.log('  📸 diff-map-level.png + panel');

    const rowNames = await page.$$eval('.map-diff-row .map-diff-name', els => els.map(e => e.textContent));
    console.log('UI shows', rowNames.length, 'maps');
    if (!rowNames.includes(TARGET_NAME)) throw new Error(`UI missing ${TARGET_NAME}`);
    if (!rowNames.includes(MAP_NAME)) throw new Error(`UI missing ${MAP_NAME}`);

    const errors = consoleMsgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) {
      console.log('Console errors:'); errors.forEach(e => console.log(' ', e));
      throw new Error(`${errors.length} console error(s)`);
    }

    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-diff-map.png') });
    console.log('\n❌', e.message);
    consoleMsgs.slice(-20).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
