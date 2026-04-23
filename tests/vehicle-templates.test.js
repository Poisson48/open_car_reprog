// Verifies the vehicle-templates feature: one-click presets that bundle
// Stage 1 + Pop&Bang + auto-mods for a car family. Tests API apply end-to-end
// and the "Appliquer ce template" button inside the auto-mods modal.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// edc16c34 Stage 1 map addresses (from src/ecu-catalog.js)
const S1_ADDRS = {
  AccPed_trqEngHiGear_MAP: 0x16D6C4,
  AccPed_trqEngLoGear_MAP: 0x16DA04,
  FMTC_trq2qBas_MAP:       0x1760A4,
  Rail_pSetPointBase_MAP:  0x17A4A4,
  EngPrt_trqAPSLim_MAP:    0x1758E4,
};

// DPF pattern placement (synthetic) and address-based auto-mods
const DPF_OFFSET = 0x100000;
const DPF_PATTERN = [0x7F,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x02,0x01,0x01,0x00,0x0C,0x3B,0x0D,0x03];
const DPF_DTC_ADDR = 0x1E9DD4;
const EGR_ADDR = 0x1C4C4E;
const POPBANG_RPM_ADDR = 0x1C4046;
const POPBANG_QTY_ADDR = 0x1C40B4;

function writeStage1Map(rom, addr, cellVal) {
  const NX = 2, NY = 2;
  rom.writeInt16BE(NX, addr);
  rom.writeInt16BE(NY, addr + 2);
  for (let i = 0; i < NX; i++) rom.writeInt16BE(1000 + i * 500, addr + 4 + i * 2);
  for (let i = 0; i < NY; i++) rom.writeInt16BE(10 + i * 10, addr + 4 + NX * 2 + i * 2);
  const dataOff = addr + 4 + NX * 2 + NY * 2;
  for (let i = 0; i < NX * NY; i++) rom.writeInt16BE(cellVal, dataOff + i * 2);
  return dataOff;
}

function buildRom() {
  const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
  for (const addr of Object.values(S1_ADDRS)) writeStage1Map(rom, addr, 1000);
  rom.writeInt16BE(1000, POPBANG_RPM_ADDR); // stock value
  rom.writeInt16BE(0,    POPBANG_QTY_ADDR);
  for (let i = 0; i < DPF_PATTERN.length; i++) rom[DPF_OFFSET + i] = DPF_PATTERN[i];
  rom[DPF_DTC_ADDR]     = 0x00; rom[DPF_DTC_ADDR + 1] = 0x01;
  rom[EGR_ADDR]         = 0x20; rom[EGR_ADDR + 1]     = 0x20;
  return rom;
}

function dataOff(addr) {
  const NX = 2, NY = 2;
  return addr + 4 + NX * 2 + NY * 2;
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
    // ── List templates (global) ─────────────────────────────────────────────
    const all = await (await page.request.get(URL + '/api/templates')).json();
    console.log('global templates:', all.length);
    if (all.length < 3) throw new Error(`expected >=3 templates, got ${all.length}`);

    // ── Setup project + ROM ─────────────────────────────────────────────────
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-tpl', ecu: 'edc16c34' } });
    id = (await proj.json()).id;
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: buildRom() } }
    });

    // ── Compatible templates for edc16c34 ───────────────────────────────────
    const compat = await (await page.request.get(URL + `/api/projects/${id}/templates`)).json();
    console.log('compat templates:', compat.map(t => t.id).join(', '));
    if (!compat.some(t => t.id === 'psa_16hdi_110_stage1_safe')) throw new Error('safe template missing');
    if (!compat.some(t => t.id === 'psa_16hdi_110_depollution_off')) throw new Error('depol template missing');

    // ── Apply Stage 1 Safe via API ─────────────────────────────────────────
    const r1 = await page.request.post(URL + `/api/projects/${id}/apply-template/psa_16hdi_110_stage1_safe`);
    const data1 = await r1.json();
    console.log('safe result:', JSON.stringify(data1).slice(0, 200));
    if (!data1.ok) throw new Error('safe apply failed: ' + data1.error);
    if (data1.stage1.length !== 5) throw new Error(`expected 5 stage1 entries, got ${data1.stage1.length}`);
    if (data1.popbang !== null) throw new Error('safe template should not set popbang');
    if (data1.autoMods.length !== 0) throw new Error('safe template should not apply autoMods');

    // Verify one cell value actually increased
    const rom1 = Buffer.from(await (await page.request.get(URL + `/api/projects/${id}/rom`)).body());
    const hiAfter = rom1.readInt16BE(dataOff(S1_ADDRS.AccPed_trqEngHiGear_MAP));
    console.log(`HiGear cell after safe: ${hiAfter} (expected ~1100 = +10%)`);
    if (hiAfter < 1080 || hiAfter > 1120) throw new Error(`HiGear cell should be ~1100, got ${hiAfter}`);

    // ── Apply Dépollution OFF via API ──────────────────────────────────────
    const r2 = await page.request.post(URL + `/api/projects/${id}/apply-template/psa_16hdi_110_depollution_off`);
    const data2 = await r2.json();
    console.log('depol result:', JSON.stringify(data2).slice(0, 200));
    if (!data2.ok) throw new Error('depol apply failed: ' + data2.error);
    if (data2.autoMods.length !== 3) throw new Error(`expected 3 autoMods, got ${data2.autoMods.length}`);
    const errs = data2.autoMods.filter(m => m.error);
    if (errs.length) throw new Error('autoMods errors: ' + JSON.stringify(errs));

    const rom2 = Buffer.from(await (await page.request.get(URL + `/api/projects/${id}/rom`)).body());
    // dpf_off: pattern byte index 10/11 should have flipped 0x01→0x00
    if (rom2[DPF_OFFSET + 10] !== 0x00 || rom2[DPF_OFFSET + 11] !== 0x00) {
      throw new Error(`DPF pattern not flipped: [${rom2[DPF_OFFSET+10].toString(16)}, ${rom2[DPF_OFFSET+11].toString(16)}]`);
    }
    if (rom2[DPF_DTC_ADDR] !== 0xFF || rom2[DPF_DTC_ADDR + 1] !== 0xFF) throw new Error('dpf_dtc_off not applied');
    if (rom2[EGR_ADDR] !== 0x00 || rom2[EGR_ADDR + 1] !== 0x00) throw new Error('egr_off not applied');
    console.log('✓ auto-mods applied (DPF / DTC / EGR)');

    // ── Incompatible ECU ───────────────────────────────────────────────────
    const other = await page.request.post(URL + '/api/projects', { data: { name: 'pw-tpl-other', ecu: 'me7.5' } });
    const oid = (await other.json()).id;
    const compatOther = await (await page.request.get(URL + `/api/projects/${oid}/templates`)).json();
    console.log('templates for me7.5:', compatOther.length);
    if (compatOther.length !== 0) throw new Error('me7.5 should have no templates');
    await page.request.delete(URL + '/api/projects/' + oid);

    // ── UI flow: open auto-mods, apply template via button ─────────────────
    // Fresh project so we know the post-apply state
    const p3 = await page.request.post(URL + '/api/projects', { data: { name: 'pw-tpl-ui', ecu: 'edc16c34' } });
    const uid = (await p3.json()).id;
    await page.request.post(URL + `/api/projects/${uid}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: buildRom() } }
    });

    await page.goto(URL + '/#/project/' + uid);
    await page.waitForSelector('#btn-auto-mods', { timeout: 5000 });
    await page.click('#btn-auto-mods');
    await page.waitForSelector('#am-templates .am-template', { timeout: 5000 });
    const templateCards = await page.$$('#am-templates .am-template');
    console.log('template cards in modal:', templateCards.length);
    if (templateCards.length < 3) throw new Error(`expected >=3 template cards, got ${templateCards.length}`);

    await page.screenshot({ path: path.join(OUT, 'vehicle-templates.png'), fullPage: false });
    console.log('  📸 vehicle-templates.png');

    page.on('dialog', d => d.accept());
    await page.click('.am-tpl-apply[data-tid="psa_16hdi_110_stage1_safe"]');
    await page.waitForTimeout(800);
    const btnText = await page.$eval('.am-tpl-apply[data-tid="psa_16hdi_110_stage1_safe"]', el => el.textContent);
    console.log('button after click:', btnText);
    if (!/Appliqué/.test(btnText)) throw new Error(`expected "Appliqué" in button, got "${btnText}"`);

    await page.request.delete(URL + '/api/projects/' + uid);

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-templates.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
