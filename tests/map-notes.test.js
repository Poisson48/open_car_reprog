// Verifies per-map notes persist across map switches and page reloads.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const MAP_A = 'AccPed_trqEngHiGear_MAP';
const MAP_B = 'AccPed_trqEngLoGear_MAP';
const ADDR_A = 1840200; // 0x1C1448

async function openMap(page, name) {
  const search = await page.$('.sidebar input[type="search"]');
  await search.fill('');
  await page.waitForTimeout(80);
  await search.fill(name);
  await page.waitForSelector('.param-item', { timeout: 3000 });
  await page.waitForTimeout(80);
  await page.click('.param-item');
  await page.waitForSelector('#map-note-input', { timeout: 3000 });
  await page.waitForTimeout(200);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-notes', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // Minimal ROM with a MAP at ADDR_A so the editor opens. MAP_B will fall back
    // to whatever layout lives in the ROM; we just care about the note input.
    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    rom.writeInt16BE(4, ADDR_A);
    rom.writeInt16BE(4, ADDR_A + 2);
    for (let i = 0; i < 4; i++) rom.writeInt16BE(1000 + i * 500, ADDR_A + 4 + i * 2);
    for (let i = 0; i < 4; i++) rom.writeInt16BE(10 + i * 10, ADDR_A + 4 + 8 + i * 2);
    const dataOff = ADDR_A + 4 + 4 * 2 + 4 * 2;
    for (let i = 0; i < 16; i++) rom.writeInt16BE(500, dataOff + i * 2);

    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-wrap canvas', { timeout: 5000 });
    await page.waitForTimeout(400);

    // Open MAP A, type a note, tab away so it saves.
    await openMap(page, MAP_A);
    const note = "Augmenté de 15% pour stage 1 — confirmé sur banc 2026-04";
    await page.fill('#map-note-input', note);
    // change fires on blur. Press Enter to trigger blur explicitly.
    await page.press('#map-note-input', 'Enter');
    await page.waitForTimeout(400);
    const status = await page.$eval('#map-note-status', el => el.textContent);
    console.log('save status:', status);
    if (!/enregistré|✓/.test(status)) throw new Error(`save status missing: "${status}"`);

    // Server-side check: the note was persisted
    const notesResp = await page.request.get(URL + `/api/projects/${id}/notes`);
    const notes = await notesResp.json();
    console.log('server notes:', notes);
    if (notes[MAP_A] !== note) throw new Error(`server has wrong note: "${notes[MAP_A]}"`);

    // Switch to MAP B, the note input should be empty
    await openMap(page, MAP_B);
    const noteB = await page.$eval('#map-note-input', el => el.value);
    console.log('MAP_B note on open:', JSON.stringify(noteB));
    if (noteB !== '') throw new Error(`MAP_B should have no note, got "${noteB}"`);

    // Save a note on MAP B, then switch back to MAP A → note should still be the original
    await page.fill('#map-note-input', 'test B');
    await page.press('#map-note-input', 'Enter');
    await page.waitForTimeout(400);
    await openMap(page, MAP_A);
    const noteAReload = await page.$eval('#map-note-input', el => el.value);
    console.log('MAP_A note after switch back:', JSON.stringify(noteAReload));
    if (noteAReload !== note) throw new Error(`MAP_A note lost: "${noteAReload}"`);

    // Reload the whole page → notes still there (proves persistence)
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-wrap canvas', { timeout: 5000 });
    await page.waitForTimeout(400);
    await openMap(page, MAP_A);
    const noteAPostReload = await page.$eval('#map-note-input', el => el.value);
    console.log('MAP_A note after page reload:', JSON.stringify(noteAPostReload));
    if (noteAPostReload !== note) throw new Error(`note did not survive reload: "${noteAPostReload}"`);

    // Clear note (empty string deletes)
    await page.fill('#map-note-input', '');
    await page.press('#map-note-input', 'Enter');
    await page.waitForTimeout(300);
    const cleared = await (await page.request.get(URL + `/api/projects/${id}/notes`)).json();
    if (cleared[MAP_A] !== undefined) throw new Error(`empty note should delete, got "${cleared[MAP_A]}"`);
    console.log('empty note deletes ✓');

    await page.screenshot({ path: path.join(OUT, 'map-notes.png'), fullPage: false });
    console.log('  📸 map-notes.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-notes.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
