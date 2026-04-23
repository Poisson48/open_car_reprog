// The home search must show an explicit "Aucun projet…" empty state when
// the query matches nothing, instead of rendering a blank grid.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let projectId;
  try {
    // Need at least one project so we don't hit the "first project" empty state.
    const r = await page.request.post(URL + '/api/projects', {
      data: { name: '_HOME_EMPTY_STATE_', ecu: 'edc16c34' }
    });
    projectId = (await r.json()).id;

    await page.goto(URL + '/#/');
    await page.waitForSelector('.project-card, .empty-state', { state: 'attached' });
    await page.waitForTimeout(300);

    // Search for something that can't match any field
    await page.fill('#project-search', 'zzz-no-match-zzz-' + Date.now());
    await page.waitForTimeout(300);

    const cards = await page.$$('.project-card');
    assert.strictEqual(cards.length, 0, 'should render no project-card for no-match query');

    const emptyState = await page.$('.empty-state');
    assert(emptyState, 'missing .empty-state when search matches nothing');
    const txt = await emptyState.textContent();
    assert(/aucun projet/i.test(txt), `empty-state text should mention "aucun projet": got "${txt}"`);
    console.log('  ✓ empty state visible :', txt.trim());

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'home-empty-state.png') });
    console.log('✅ home-empty-state test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
