// Creates a branching commit history, then verifies the git-panel renders
// the graph SVG with multiple lanes and branch ref badges.
//
// History built:
//   master: c0 ← c1 ← c2
//                 ↖
//              stage1: c3 ← c4

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function patch(page, id, off, bytes) {
  const buf = Buffer.from(bytes);
  return page.request.patch(URL + `/api/projects/${id}/rom/bytes`, {
    data: { offset: off, data: buf.toString('base64') }
  });
}
async function commit(page, id, msg) {
  return page.request.post(URL + `/api/projects/${id}/git/commit`, { data: { message: msg } });
}
async function switchB(page, id, name) {
  return page.request.put(URL + `/api/projects/${id}/git/branches/${encodeURIComponent(name)}`);
}
async function createB(page, id, name) {
  return page.request.post(URL + `/api/projects/${id}/git/branches`, { data: { name } });
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
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-graph', ecu: 'edc16c34' }
    });
    id = (await proj.json()).id;

    const rom = Buffer.alloc(2 * 1024 * 1024, 0xAA);
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'rom.bin', mimeType: 'application/octet-stream', buffer: rom } }
    });

    // on master (or main): one more commit
    await patch(page, id, 0x1C13CC, [0x00, 0x01]);
    await commit(page, id, 'master change 1');
    await patch(page, id, 0x1C13CE, [0x00, 0x02]);
    await commit(page, id, 'master change 2');

    // create stage1 branch
    await createB(page, id, 'stage1');
    // commits on stage1
    await patch(page, id, 0x1C140C, [0x00, 0x03]);
    await commit(page, id, 'stage1 first');
    await patch(page, id, 0x1C140E, [0x00, 0x04]);
    await commit(page, id, 'stage1 second');

    // check log shape from API
    const log = await (await page.request.get(URL + `/api/projects/${id}/git/log`)).json();
    console.log('commits:', log.length);
    log.forEach(c => console.log(' ', c.hash.slice(0, 7), '|parents:', (c.parents || []).map(p => p.slice(0,7)).join(','), '|refs:', (c.refs || []).map(r => r.name).join(','), '|', c.message));

    if (log.length < 5) throw new Error(`Expected ≥5 commits, got ${log.length}`);
    const stage1Tip = log.find(c => (c.refs || []).find(r => r.name === 'stage1'));
    if (!stage1Tip) throw new Error('stage1 ref not found in log');
    const masterTip = log.find(c => (c.refs || []).find(r => r.name === 'master' || r.name === 'main'));
    if (!masterTip) throw new Error('master/main ref not found');

    // Open UI
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('.git-entry', { timeout: 5000 });
    await page.waitForTimeout(400);

    // Check SVGs in gutter
    const gutters = await page.$$eval('.git-gutter svg', svgs => svgs.length);
    console.log('gutter SVGs:', gutters);
    if (gutters < 5) throw new Error(`Expected ≥5 gutter SVGs, got ${gutters}`);

    // Check ref badges rendered
    const refNames = await page.$$eval('.git-ref', els => els.map(e => e.textContent));
    console.log('refs rendered:', refNames);
    if (!refNames.some(r => r.includes('stage1'))) throw new Error('stage1 badge missing');

    // Multi-lane: ensure SVG contains at least 2 distinct colored circles
    const circleColors = await page.$$eval('.git-gutter svg circle', cs => cs.map(c => c.getAttribute('fill')));
    const uniq = new Set(circleColors);
    console.log('unique circle colors:', uniq.size);
    if (uniq.size < 2) throw new Error(`Expected ≥2 lane colors, got ${uniq.size} (${[...uniq].join(',')})`);

    // Widen panel and screenshot
    await page.evaluate(() => { const p = document.getElementById('git-panel'); if (p) p.style.width = '440px'; });
    await page.waitForTimeout(200);
    const gp = await page.$('#git-panel');
    if (gp) await gp.screenshot({ path: path.join(OUT, 'git-graph.png') });
    console.log('  📸 git-graph.png');

    const errors = msgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) { errors.forEach(e => console.log(' ', e)); throw new Error(`${errors.length} console error(s)`); }
    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await page.screenshot({ path: path.join(OUT, 'FAIL-graph.png') });
    console.log('\n❌', e.message);
    msgs.slice(-10).forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    await browser.close();
  }
})();
