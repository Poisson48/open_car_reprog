// Each non-current branch in the dropdown has a 🗑 delete button. Clicking it
// (and confirming the dialog) must remove the branch from the list.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let projectId;

  try {
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: '_BRANCH_DELETE_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    // Create an extra branch via API (faster setup). createBranch switches to
    // it, so switch back to master so the popover lists throwaway as non-current.
    await page.request.post(URL + '/api/projects/' + projectId + '/git/branches', { data: { name: 'throwaway' } });
    await page.request.put(URL + '/api/projects/' + projectId + '/git/branches/master');

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Auto-accept the confirm dialog
    page.on('dialog', async d => await d.accept());

    // Open branch dropdown
    await page.click('#branch-btn');
    await page.waitForSelector('.branch-item', { timeout: 3000 });
    // Find the delete button for the throwaway branch
    const delBtn = await page.$('.branch-del[data-name="throwaway"]');
    assert(delBtn, 'missing 🗑 button for throwaway branch');

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'branch-delete-before.png') });
    await delBtn.click();
    await page.waitForTimeout(1500);

    // Verify via API
    const branches = await page.request.get(URL + '/api/projects/' + projectId + '/git/branches').then(r => r.json());
    assert(!branches.all.includes('throwaway'), `throwaway should be gone: got ${JSON.stringify(branches.all)}`);
    console.log('  ✓ deleted. Remaining:', branches.all);

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'branch-delete-after.png') });
    console.log('✅ branch-delete test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
