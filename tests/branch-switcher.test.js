// Manual integration test for the branch switcher.
// Assumes the dev server is running at http://localhost:3001.
// Run with: node tests/branch-switcher.test.js

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3001';
const OUT = path.join(__dirname, 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  const p = path.join(OUT, name + '.png');
  await page.screenshot({ path: p, fullPage: false });
  console.log('  📸', p);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 } });
  const page = await ctx.newPage();

  const consoleMsgs = [];
  page.on('console', m => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => consoleMsgs.push(`[pageerror] ${e.message}`));

  let id;
  try {
    // 1. Create project via API (faster than clicking)
    const proj = await page.request.post(URL + '/api/projects', {
      data: { name: 'pw-test-branches', ecu: 'edc16c34' }
    });
    const { id: pid } = await proj.json();
    id = pid;
    console.log('project created:', id);

    // Import a tiny fake ROM via API
    fs.writeFileSync('/tmp/pw-rom.bin', Buffer.from([0xAA, 0xBB, 0xCC, 0xDD]));
    const form = new FormData();
    form.append('rom', new Blob([fs.readFileSync('/tmp/pw-rom.bin')]), 'pw-rom.bin');
    await page.request.post(URL + `/api/projects/${id}/rom`, {
      multipart: { rom: { name: 'pw-rom.bin', mimeType: 'application/octet-stream', buffer: fs.readFileSync('/tmp/pw-rom.bin') } }
    });

    // 2. Navigate to project
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#branch-btn', { timeout: 5000 });
    await page.waitForTimeout(400); // let branch refresh() fire
    await shot(page, '1-project-loaded');

    // 3. Verify branch name is shown (master or main)
    const initialBranch = await page.textContent('#branch-name');
    console.log('initial branch:', initialBranch);
    if (!initialBranch || initialBranch === '…' || initialBranch === 'erreur') {
      throw new Error(`Branch name not loaded: "${initialBranch}"`);
    }

    // 4. Click branch button → popover opens
    await page.click('#branch-btn');
    await page.waitForSelector('.branch-popover', { timeout: 2000 });
    await shot(page, '2-popover-open');

    // 5. Create a new branch "stage1"
    await page.fill('#branch-new-name', 'stage1');
    await page.click('#branch-new-btn');
    await page.waitForTimeout(500);
    const branchAfterCreate = await page.textContent('#branch-name');
    console.log('after create:', branchAfterCreate);
    if (branchAfterCreate !== 'stage1') throw new Error(`Expected stage1, got "${branchAfterCreate}"`);
    await shot(page, '3-stage1-created');

    // 6. Re-open popover — should list master and stage1 with stage1 current
    await page.click('#branch-btn');
    await page.waitForSelector('.branch-popover');
    const items = await page.$$eval('.branch-item', els =>
      els.map(e => ({ name: e.dataset.name, current: e.classList.contains('current') }))
    );
    console.log('branches in popover:', items);
    if (!items.find(b => b.name === 'stage1' && b.current)) throw new Error('stage1 not current in popover');
    if (items.length < 2) throw new Error('not enough branches');
    await shot(page, '4-popover-with-stage1');

    // 7. Switch back to non-stage1 branch
    const otherBranch = items.find(b => b.name !== 'stage1').name;
    await page.click(`.branch-item[data-name="${otherBranch}"]`);
    await page.waitForTimeout(800);
    const back = await page.textContent('#branch-name');
    console.log('after switch back:', back);
    if (back !== otherBranch) throw new Error(`Expected ${otherBranch}, got "${back}"`);
    await shot(page, '5-switched-back');

    // 8. Errors check
    const errors = consoleMsgs.filter(m => m.includes('[error]') || m.includes('[pageerror]'));
    if (errors.length) {
      console.log('\nConsole errors:');
      errors.forEach(e => console.log(' ', e));
      throw new Error(`${errors.length} console error(s)`);
    }

    console.log('\n✅ ALL PASSED');
  } catch (e) {
    await shot(page, 'FAIL');
    console.log('\n❌', e.message);
    console.log('\nAll console messages:');
    consoleMsgs.forEach(m => console.log(' ', m));
    process.exitCode = 1;
  } finally {
    if (id) {
      try { await page.request.delete(URL + `/api/projects/${id}`); } catch {}
    }
    await browser.close();
  }
})();
