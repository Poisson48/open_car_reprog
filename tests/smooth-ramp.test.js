// Verifies the Lisser / Égaliser / Rampe buttons on the map selection toolbar.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-smooth', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // 4×4 map with values that form a sharp checkerboard so smooth/flatten
    // produce visibly different results and we can assert on them.
    const NX = 4, NY = 4;
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(NX, MAP_ADDR);
    rom.writeInt16BE(NY, MAP_ADDR + 2);
    for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
    for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
    const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
    // Checkerboard: even cells = 100, odd = 1000
    for (let yi = 0; yi < NY; yi++) {
      for (let xi = 0; xi < NX; xi++) {
        const raw = (xi + yi) % 2 === 0 ? 100 : 1000;
        rom.writeInt16BE(raw, dataOff + (yi * NX + xi) * 2);
      }
    }

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-wrap canvas', { timeout: 5000 });
    await page.waitForTimeout(400);
    await page.fill('.sidebar input[type="search"]', MAP_NAME);
    await page.waitForSelector('.param-item', { timeout: 3000 });
    await page.click('.param-item');
    await page.waitForSelector('#map-grid-table', { timeout: 3000 });
    await page.waitForTimeout(300);

    const cell = async (x, y) => parseFloat(await page.$eval(
      `#map-grid-table input[data-xi="${x}"][data-yi="${y}"]`, el => el.value));

    // All 16 cells: select via click + Tout sélectionner
    await page.click('#map-grid-table input[data-xi="0"][data-yi="0"]');
    await page.waitForTimeout(50);
    await page.click('#map-sel-all');
    await page.waitForTimeout(100);

    // ── Égaliser → every selected cell becomes the mean of the original 16.
    // Checkerboard mean (raw) = (8*100 + 8*1000)/16 = 550. Phys = 55.
    await page.click('#map-flatten');
    await page.waitForTimeout(200);

    const flatVals = [];
    for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) flatVals.push(await cell(x, y));
    const minF = Math.min(...flatVals), maxF = Math.max(...flatVals);
    console.log('après égaliser: min=', minF, 'max=', maxF);
    if (maxF - minF > 0.1) throw new Error(`flatten produced a range: min=${minF}, max=${maxF}`);
    if (Math.abs(flatVals[0] - 55) > 1) throw new Error(`flatten mean wrong: expected ~55, got ${flatVals[0]}`);

    // Ctrl-Z → checkerboard restored
    await page.click('.map-toolbar');
    await page.waitForTimeout(50);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    const v00 = await cell(0, 0), v10 = await cell(1, 0);
    if (Math.abs(v00 - 10) > 0.5 || Math.abs(v10 - 100) > 0.5) {
      throw new Error(`undo after flatten broken: (0,0)=${v00}, (1,0)=${v10}`);
    }
    console.log('flatten + undo OK');

    // ── Lisser: re-select all, then Lisser. The 4 inner cells should be
    // averages ≠ the original checkerboard values.
    await page.click('#map-grid-table input[data-xi="0"][data-yi="0"]');
    await page.waitForTimeout(50);
    await page.click('#map-sel-all');
    await page.waitForTimeout(100);
    await page.click('#map-smooth');
    await page.waitForTimeout(200);
    const smoothCenter = await cell(1, 1);
    const smoothCorner = await cell(0, 0);
    console.log('après lissage: (1,1)=', smoothCenter, '(0,0)=', smoothCorner);
    // (1,1) had 9 neighbors in the checkerboard; all 9 values = [100,1000,100,1000,1000,100,1000,100,1000]
    // It should average to roughly (5*100+4*1000)/9 ≈ 500 raw → phys ~ 50.
    if (smoothCenter > 90 || smoothCenter < 10) throw new Error(`smooth center out of expected range: ${smoothCenter}`);
    // Corner (0,0) had 4 neighbors in-grid: itself(100)+neighbors(1000,1000,100) avg ≈ 550 raw → 55 phys.
    // Original was 10 → after smooth, must differ.
    if (Math.abs(smoothCorner - 10) < 1) throw new Error(`smooth corner unchanged: ${smoothCorner}`);

    await page.click('.map-toolbar');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);

    // ── Rampe: set the 4 corners to distinct values first, then select all
    // and click Rampe. The interior should be a bilinear blend of the corners.
    // Easier check: set (0,0)=10, (3,0)=40, (0,3)=70, (3,3)=100 (via direct
    // cell edits). Then Rampe over all 16: cell (1,0) should be 20
    // (linear between 10 and 40 at 1/3), (1,1) should be ~30, etc.
    async function setCell(x, y, v) {
      const sel = `#map-grid-table input[data-xi="${x}"][data-yi="${y}"]`;
      await page.click(sel, { clickCount: 3 });
      await page.keyboard.type(String(v));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(50);
    }
    await setCell(0, 0, 10);
    await setCell(3, 0, 40);
    await setCell(0, 3, 70);
    await setCell(3, 3, 100);

    // Select the full 4×4 and apply Rampe.
    await page.click('#map-grid-table input[data-xi="0"][data-yi="0"]');
    await page.waitForTimeout(50);
    await page.click('#map-sel-all');
    await page.waitForTimeout(100);
    await page.click('#map-ramp');
    await page.waitForTimeout(200);

    // Bilinear: v(x,y) = (1-tx)(1-ty)*v00 + tx(1-ty)*v10 + (1-tx)ty*v01 + tx*ty*v11
    // At (1,0): tx=1/3, ty=0 → 10 + 1/3*(40-10) = 20 → raw 200 → phys 20
    const r10 = await cell(1, 0);
    const r33 = await cell(3, 3);
    const r11 = await cell(1, 1);
    console.log('après rampe: (1,0)=', r10, '(1,1)=', r11, '(3,3)=', r33);
    // Values are stored as int16 raw (factor 0.1), so tolerance ±0.1 is plenty.
    if (Math.abs(r10 - 20) > 0.2) throw new Error(`ramp (1,0) expected ~20, got ${r10}`);
    if (Math.abs(r33 - 100) > 0.2) throw new Error(`ramp (3,3) should be corner=100, got ${r33}`);
    // (1,1): tx=1/3, ty=1/3 → (2/3)(2/3)*10 + (1/3)(2/3)*40 + (2/3)(1/3)*70 + (1/9)*100
    // = 4/9*10 + 2/9*40 + 2/9*70 + 1/9*100 = (40 + 80 + 140 + 100)/9 = 360/9 = 40
    if (Math.abs(r11 - 40) > 0.5) throw new Error(`ramp (1,1) expected ~40, got ${r11}`);

    await page.screenshot({ path: path.join(OUT, 'smooth-ramp.png'), fullPage: false });
    console.log('  📸 smooth-ramp.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-smooth.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
