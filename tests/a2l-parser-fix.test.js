// After fixing the AXIS_DESCR field order, verify that MAP parameters have
// plausible maxAxisPoints (2..32, not 32767) and that the map editor can
// actually render them with a real ROM (ori.BIN) without the "Données
// invalides" error.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const ROM_PATH = path.join(__dirname, '..', 'ressources', 'edc16c34',
  '1.7bar boost, Launch Control 2500, Popcorn 4400, 185hp 410nm');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();

  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    // 1. Check API returns plausible maxAxisPoints
    console.log('=== API check: AccPed_trqEngHiGear_MAP ===');
    const paramRes = await page.request.get(URL + '/api/ecu/edc16c34/parameters/AccPed_trqEngHiGear_MAP');
    const p = await paramRes.json();
    console.log('  axis0.maxAxisPoints:', p.axisDefs[0].maxAxisPoints);
    console.log('  axis0.unit:', p.axisDefs[0].unit);
    console.log('  axis1.maxAxisPoints:', p.axisDefs[1].maxAxisPoints);
    if (p.axisDefs[0].maxAxisPoints !== 16 || p.axisDefs[1].maxAxisPoints !== 16) {
      throw new Error(`Expected both maxAxisPoints = 16, got ${p.axisDefs[0].maxAxisPoints}/${p.axisDefs[1].maxAxisPoints}`);
    }

    // 2. Open UI with the real tune ROM
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-a2l-fix', ecu: 'edc16c34' }
    });
    id = (await proj.json()).id;

    if (!fs.existsSync(ROM_PATH)) throw new Error('tune ROM not found at ' + ROM_PATH);
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'tune.bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM_PATH) } }
    });

    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#param-sidebar', { timeout: 5000 });
    await page.waitForTimeout(1000);

    // 3. Search for AccPed_trqEngHiGear_MAP and click it
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(800);
    const entry = await page.$('.param-item');
    if (!entry) throw new Error('No param entries shown in sidebar');
    await entry.click();
    await page.waitForTimeout(1200);

    // 4. Expect a map-grid-table (not the "Données invalides" error)
    const err = await page.$('.empty-state');
    if (err) {
      const txt = await err.textContent();
      if (txt.includes('invalides')) throw new Error('Still shows "Données invalides": ' + txt);
    }
    const table = await page.$('#map-grid-table');
    if (!table) throw new Error('No map-grid-table rendered');

    // 5. Verify dimensions match what we expect: 16×16
    const headers = await page.$$eval('#map-grid-table thead th', ths => ths.length);
    const bodyRows = await page.$$eval('#map-grid-table tbody tr', trs => trs.length);
    console.log('  UI: header count=', headers, 'body rows=', bodyRows);
    // headers = 1 corner + 16 X values = 17
    if (headers < 5 || headers > 40) throw new Error(`Unexpected X header count: ${headers}`);
    if (bodyRows < 2 || bodyRows > 40) throw new Error(`Unexpected Y row count: ${bodyRows}`);

    await page.screenshot({ path: path.join(OUT, 'a2l-parser-fix.png') });
    console.log('  📸 a2l-parser-fix.png');

    const errors = logs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-a2l-fix.png') });
    console.log('\n❌', e.message);
    logs.slice(-10).forEach(l => console.log(' ', l));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
