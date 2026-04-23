// Batch apply : select a template + multiple projects → one click applies
// the template to every project and auto-commits.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const created = [];

  try {
    // Create 3 sibling projects with the same ROM (simulating a fleet)
    for (let i = 0; i < 3; i++) {
      const r = await page.request.post(URL + '/api/projects', {
        data: { name: '_BATCH_' + i, vehicle: 'fleet member ' + i, ecu: 'edc16c34' }
      });
      const pid = (await r.json()).id;
      created.push(pid);
      await page.request.post(URL + '/api/projects/' + pid + '/rom', {
        multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
      });
    }

    await page.goto(URL + '/#/');
    await page.waitForSelector('#btn-batch-apply', { state: 'attached' });
    await page.waitForTimeout(400);

    await page.click('#btn-batch-apply');
    await page.waitForSelector('#ba-template', { timeout: 3000 });
    await page.waitForTimeout(600);

    // Select the Stage 1 Safe template (first one in edc16c34 templates)
    const templates = await page.$$eval('#ba-template option', opts => opts.map(o => ({ id: o.value, text: o.textContent })));
    console.log('  templates:', templates.length);
    assert(templates.length >= 1, 'should have at least one template');
    const safe = templates.find(t => /safe/i.test(t.text)) || templates[0];
    await page.selectOption('#ba-template', safe.id);
    await page.waitForTimeout(400);

    // Uncheck any other projects not from this test run
    await page.click('#ba-none');
    await page.waitForTimeout(100);
    for (const pid of created) {
      await page.check(`.ba-chk[data-id="${pid}"]`);
    }
    await page.waitForTimeout(100);

    const count = await page.textContent('#ba-count');
    assert(/3/.test(count), `should say 3 selected: got "${count}"`);

    await page.fill('#ba-msg', 'batch test e2e');
    await page.click('#ba-apply');
    await page.waitForTimeout(3000);

    // Each outcome row should be visible
    const results = await page.$$('#ba-results > div');
    assert(results.length >= 3, `should have 3 outcome rows: got ${results.length}`);

    // Verify each project got the commit
    for (const pid of created) {
      const log = await page.request.get(URL + '/api/projects/' + pid + '/git/log').then(r => r.json());
      assert(log.length >= 2, `project ${pid} should have ≥2 commits after batch apply`);
      assert(log[0].message.includes('batch test e2e'), `HEAD of ${pid} should be batch commit: got "${log[0].message}"`);
    }
    console.log('  ✓ all 3 projects got the batch commit');

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'batch-apply.png') });
    console.log('✅ batch-apply test passed');
  } finally {
    for (const pid of created) {
      await page.request.delete(URL + '/api/projects/' + pid).catch(() => {});
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
