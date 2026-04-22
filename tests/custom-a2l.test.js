// Verifies the project-level custom A2L upload:
// - without upload, the project uses the ECU default (6638 characteristics)
// - uploading a small valid A2L swaps the parameter list
// - deleting the custom A2L reverts to the ECU default

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

// A tiny but valid A2L snippet with 2 characteristics. Enough to round-trip
// through the parser; the actual addresses don't need to match a real ROM.
const SMALL_A2L = `ASAP2_VERSION 1 70
/begin PROJECT DEMO "Tiny test A2L"
  /begin MODULE DIM ""
    /begin COMPU_METHOD NO_COMPU_METHOD
      "No conversion"
      IDENTICAL "%8.3" "-"
    /end COMPU_METHOD
    /begin RECORD_LAYOUT Scalar_SWORD
      FNC_VALUES 1 SWORD COLUMN_DIR DIRECT
    /end RECORD_LAYOUT
    /begin CHARACTERISTIC CUSTOM_A2L_PARAM_ONE
      "my first custom param"
      VALUE 0x100000 Scalar_SWORD 0 NO_COMPU_METHOD -32768 32767
    /end CHARACTERISTIC
    /begin CHARACTERISTIC CUSTOM_A2L_PARAM_TWO
      "my second custom param"
      VALUE 0x100002 Scalar_SWORD 0 NO_COMPU_METHOD -32768 32767
    /end CHARACTERISTIC
  /end MODULE
/end PROJECT
`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();
  const msgs = [];
  page.on('console', m => msgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => msgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    const proj = await page.request.post(URL + '/api/projects', { data: { name: 'pw-a2l', ecu: 'edc16c34' } });
    id = (await proj.json()).id;

    // ── Default: ECU A2L (6638 characteristics for edc16c34)
    const defParams = await (await page.request.get(URL + `/api/projects/${id}/parameters?limit=1`)).json();
    console.log('default A2L total:', defParams.total);
    if (defParams.total !== 6638) throw new Error(`expected 6638 default params, got ${defParams.total}`);

    // Write the tiny A2L somewhere on disk so Playwright can upload it.
    const a2lPath = path.join(OUT, '_tiny.a2l');
    fs.writeFileSync(a2lPath, SMALL_A2L);

    // Upload via the API directly (simpler than driving the UI for now — the
    // UI is also tested indirectly by virtue of the api.js methods it uses).
    const uploadResp = await page.request.post(URL + `/api/projects/${id}/a2l`, {
      multipart: { a2l: { name: 'tiny.a2l', mimeType: 'application/octet-stream', buffer: Buffer.from(SMALL_A2L) } }
    });
    if (!uploadResp.ok()) throw new Error(`upload failed: ${await uploadResp.text()}`);
    const upload = await uploadResp.json();
    console.log('upload:', upload);
    if (upload.characteristicsCount !== 2) throw new Error(`expected 2 chars, got ${upload.characteristicsCount}`);

    // The project-scoped params should now reflect the custom A2L
    const customParams = await (await page.request.get(URL + `/api/projects/${id}/parameters`)).json();
    console.log('custom A2L total:', customParams.total, 'first:', customParams.items[0]?.name);
    if (customParams.total !== 2) throw new Error(`expected 2 custom params, got ${customParams.total}`);
    if (customParams.items[0].name !== 'CUSTOM_A2L_PARAM_ONE') {
      throw new Error(`unexpected first param name: ${customParams.items[0].name}`);
    }

    // Info endpoint reports custom:true + the filename
    const info = await (await page.request.get(URL + `/api/projects/${id}/a2l/info`)).json();
    console.log('info:', info);
    if (!info.custom || info.fileName !== 'tiny.a2l' || info.characteristicsCount !== 2) {
      throw new Error(`bad info payload: ${JSON.stringify(info)}`);
    }

    // Load the project in the UI → the breadcrumb should mention the custom A2L
    await page.goto(URL + '/#/project/' + id);
    await page.waitForTimeout(600);
    const crumb = await page.$eval('#breadcrumb', el => el.textContent);
    console.log('breadcrumb:', crumb);
    if (!crumb.includes('tiny.a2l')) throw new Error(`breadcrumb missing A2L name: "${crumb}"`);

    // The param panel should now list only the 2 custom params
    const listCount = await page.$$eval('.param-item', els => els.length);
    console.log('param items visible:', listCount);
    if (listCount !== 2) throw new Error(`expected 2 param items, got ${listCount}`);

    await page.screenshot({ path: path.join(OUT, 'custom-a2l.png'), fullPage: false });
    console.log('  📸 custom-a2l.png');

    // DELETE the custom A2L — should revert to ECU default
    const del = await page.request.delete(URL + `/api/projects/${id}/a2l`);
    if (!del.ok()) throw new Error(`delete failed: ${del.status()}`);
    const revertParams = await (await page.request.get(URL + `/api/projects/${id}/parameters?limit=1`)).json();
    console.log('after delete total:', revertParams.total);
    if (revertParams.total !== 6638) throw new Error(`expected 6638 after revert, got ${revertParams.total}`);

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-a2l.png') });
    console.log('\n❌', e.message);
    msgs.slice(-15).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
