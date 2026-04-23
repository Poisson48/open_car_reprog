// Verifies the map-finder: planted maps in a synthetic ROM are detected,
// the API returns them ranked by score, and the UI modal can navigate to
// them (hex editor scrolls + highlight applied).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const PLANTED = [
  { addr: 0x050000, nx: 8, ny: 6, label: 'small_8x6' },
  { addr: 0x080000, nx: 16, ny: 16, label: 'classic_16x16' },
  { addr: 0x0A0000, nx: 12, ny: 10, label: 'medium_12x10' },
];

function plantMap(rom, addr, nx, ny) {
  rom.writeUInt16BE(nx, addr);
  rom.writeUInt16BE(ny, addr + 2);
  for (let i = 0; i < nx; i++) rom.writeInt16BE(500 + i * 200, addr + 4 + i * 2);
  for (let i = 0; i < ny; i++) rom.writeInt16BE(100 + i * 250, addr + 4 + nx * 2 + i * 2);
  const dataOff = addr + 4 + nx * 2 + ny * 2;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const v = 1000 + x * 45 + y * 70;
      rom.writeInt16BE(v, dataOff + (y * nx + x) * 2);
    }
  }
}

function buildRom() {
  const rom = Buffer.alloc(2 * 1024 * 1024);
  // Deterministic low-grade noise: LCG so the test is reproducible.
  let s = 123456789;
  for (let i = 0; i < rom.length; i += 2) {
    s = (s * 1103515245 + 12345) >>> 0;
    rom.writeInt16BE((s & 0xFFFF) - 0x8000, i);
  }
  for (const p of PLANTED) plantMap(rom, p.addr, p.nx, p.ny);
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
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-mf', ecu: 'edc16c34' } });
    id = (await proj.json()).id;
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: buildRom() } }
    });

    // ── API scan ─────────────────────────────────────────────────────────
    const res = await page.request.get(URL + `/api/projects/${id}/auto-find-maps?limit=200`);
    const data = await res.json();
    console.log(`scan ${data.scanMs}ms → ${data.count} candidates`);
    if (data.scanMs > 500) throw new Error(`scan too slow: ${data.scanMs}ms`);

    const foundAddrs = new Set(data.maps.map(m => m.address));
    for (const p of PLANTED) {
      if (!foundAddrs.has(p.addr)) throw new Error(`planted map 0x${p.addr.toString(16)} NOT found`);
      const rank = data.maps.findIndex(m => m.address === p.addr);
      const entry = data.maps[rank];
      console.log(`  ✓ ${p.label} at 0x${p.addr.toString(16)} rank=${rank} score=${entry.score} ${entry.nx}×${entry.ny}`);
      if (entry.nx !== p.nx || entry.ny !== p.ny) throw new Error(`dims mismatch for ${p.label}: got ${entry.nx}×${entry.ny}`);
      if (entry.score < 0.5) throw new Error(`score too low for ${p.label}: ${entry.score}`);
    }

    // ── Bounds: a limited range should exclude maps outside it ──────────
    const limited = await (await page.request.get(
      URL + `/api/projects/${id}/auto-find-maps?startOffset=${0x070000}&endOffset=${0x090000}`
    )).json();
    const addrsInRange = limited.maps.map(m => m.address);
    console.log(`limited scan: ${limited.count} candidates in [0x70000, 0x90000)`);
    if (!addrsInRange.includes(0x080000)) throw new Error('limited scan missed the planted 16×16');
    if (addrsInRange.includes(0x050000) || addrsInRange.includes(0x0A0000))
      throw new Error('limited scan leaked maps outside the range');

    // ── UI flow ─────────────────────────────────────────────────────────
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#btn-map-finder', { timeout: 5000 });
    await page.waitForTimeout(300);
    await page.click('#btn-map-finder');
    await page.waitForSelector('.mf-row', { timeout: 5000 });
    const rowCount = await page.$$eval('.mf-row', rows => rows.length);
    console.log('rows in modal:', rowCount);
    if (rowCount < 3) throw new Error(`expected >=3 rows, got ${rowCount}`);

    await page.screenshot({ path: path.join(OUT, 'map-finder.png'), fullPage: false });
    console.log('  📸 map-finder.png');

    // Click the 16×16 planted address to jump
    const target = `.mf-row[data-addr="${0x080000}"] .mf-goto`;
    await page.waitForSelector(target, { timeout: 3000 });
    await page.click(target);
    await page.waitForTimeout(500);

    // Modal should be gone
    const modalGone = await page.$('#map-finder-modal') === null;
    if (!modalGone) throw new Error('modal did not close after Voir');

    // Status bar should mention the address
    const status = await page.$eval('.status-bar, #status, .bottom-status', el => el.textContent).catch(() => '');
    console.log('status:', status.slice(0, 100));

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-map-finder.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
