// Verifies multi-ROM slots: upload several reference ROMs per project,
// list them, compare the active ROM to a slot, delete a slot.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MAP_NAME = 'AccPed_trqEngHiGear_MAP';
const MAP_ADDR = 1840200;

function buildRom(cellValue) {
  const NX = 4, NY = 4;
  const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
  rom.writeInt16BE(NX, MAP_ADDR);
  rom.writeInt16BE(NY, MAP_ADDR + 2);
  for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, MAP_ADDR + 4 + i * 2);
  for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, MAP_ADDR + 4 + NX * 2 + i * 2);
  const dataOff = MAP_ADDR + 4 + NX * 2 + NY * 2;
  for (let i = 0; i < NX * NY; i++) rom.writeInt16BE(cellValue, dataOff + i * 2);
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
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-slots', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Active ROM: cells=500 (phys 50)
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'tune.bin', mimeType: 'application/octet-stream', buffer: buildRom(500) } }
    });

    // Upload two slots via API
    const oriPath = path.join(OUT, '_ori.bin');
    const altPath = path.join(OUT, '_alt.bin');
    fs.writeFileSync(oriPath, buildRom(300)); // cells=300 everywhere
    fs.writeFileSync(altPath, buildRom(700)); // cells=700 everywhere

    const s1 = await (await page.request.post(URL + `/api/projects/${id}/roms`, {
      multipart: { rom: { name: '_ori.bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(oriPath) } }
    })).json();
    const s2 = await (await page.request.post(URL + `/api/projects/${id}/roms`, {
      multipart: { rom: { name: '_alt.bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync(altPath) } }
    })).json();
    console.log('slot1:', s1, 'slot2:', s2);
    if (!s1.slug || !s2.slug) throw new Error('slot upload missing slug');

    // List
    const list = await (await page.request.get(URL + `/api/projects/${id}/roms`)).json();
    console.log('list count:', list.length);
    if (list.length !== 2) throw new Error(`expected 2 slots, got ${list.length}`);

    // Open UI, verify both slots visible in the panel
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('.git-slot-row', { timeout: 5000 });
    const slotRows = await page.$$('.git-slot-row');
    console.log('slot rows visible:', slotRows.length);
    if (slotRows.length !== 2) throw new Error(`expected 2 slot rows, got ${slotRows.length}`);

    // Click compare on the first slot → the map-diff list should populate
    await page.click('.git-slot-row:first-child .git-slot-compare');
    await page.waitForSelector('.map-diff-row', { timeout: 5000 });
    await page.waitForTimeout(300);
    const diffRows = await page.$$('.map-diff-row');
    console.log('diff rows after slot compare:', diffRows.length);
    if (diffRows.length < 1) throw new Error('expected at least 1 map diff after compare-from-slot');

    const banner = await page.$eval('.git-compare-status', el => el.textContent);
    console.log('compare banner:', banner.trim().slice(0, 100));
    if (!/\.bin/.test(banner)) throw new Error(`banner should mention .bin: "${banner}"`);

    // Click the MAP diff row → editor opens with compare overlay (cells highlighted)
    const rows = await page.$$('.map-diff-row');
    let clicked = false;
    for (const r of rows) {
      if ((await r.getAttribute('data-name')) === MAP_NAME) { await r.click(); clicked = true; break; }
    }
    if (!clicked) throw new Error(`${MAP_NAME} not in diff list`);
    await page.waitForSelector('.map-compare-banner', { timeout: 3000 });
    const highlighted = await page.$$eval('#map-grid-table td', tds =>
      tds.filter(td => td.style.boxShadow && td.style.boxShadow !== 'none').length
    );
    console.log('highlighted cells:', highlighted);
    if (highlighted < 16) throw new Error(`expected 16 highlighted cells (all differ), got ${highlighted}`);

    await page.screenshot({ path: path.join(OUT, 'rom-slots.png'), fullPage: false });
    console.log('  📸 rom-slots.png');

    // Delete one slot
    page.on('dialog', d => d.accept());
    await page.click('.git-slot-row:first-child .git-slot-delete');
    await page.waitForTimeout(400);
    const remaining = await page.$$('.git-slot-row');
    console.log('after delete:', remaining.length);
    if (remaining.length !== 1) throw new Error(`expected 1 slot left, got ${remaining.length}`);

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-slots.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
