// Captures the green "Damos match" badge on ori.BIN for the wiki.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:3002';
const ORI = path.join(__dirname, '..', '..', 'ressources', 'edc16c34', 'ori.BIN');
const OUT = path.join(__dirname, '..', '..', 'docs', 'wiki', 'images', 'berlingo-e2e-00-damos-match-badge.png');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  try {
    const r = await page.request.post(URL + '/api/projects', { data: { name: 'Ref 110cv (damos match)', ecu: 'edc16c34' } });
    const id = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + id + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ORI) } }
    });
    await page.goto(URL + '/#/project/' + id);
    await page.waitForSelector('#hex-canvas', { timeout: 5000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: OUT });
    const badge = await page.$('#damos-match-badge');
    console.log('  📸', path.basename(OUT));
    console.log('  badge:', (await badge.textContent()).trim());
    await page.request.delete(URL + '/api/projects/' + id);
  } finally { await browser.close(); }
})();
