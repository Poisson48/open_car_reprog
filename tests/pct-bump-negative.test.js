// Régression : +5 % sur une cellule négative doit AUGMENTER la magnitude
// (phys=-1.0 devient phys=-1.1, pas -0.9). Le bug v0.5.0 était un bump dir
// basé sur sign(pct) au lieu de sign(Δphys × factor).

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const URL = 'http://localhost:3002';
const ROM = path.join(__dirname, '..', 'ressources', 'edc16c34', 'ori.BIN');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  let pid;
  try {
    const r = await page.request.post(URL + '/api/projects', { data: { name: '_PCT_NEG_', ecu: 'edc16c34' } });
    pid = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + pid + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + pid);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // AccPed_trqEngHiGear_MAP cell [0,0] sur ori.BIN = phys -1.0 Nm (raw=-10, factor=0.1)
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);

    const v0 = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  cell [0,0] initial:', v0);
    assert(v0 < 0, `expected negative phys at [0,0], got ${v0}`);

    // +5 % : la magnitude doit AUGMENTER (−1.0 → −1.1), pas diminuer (−0.9)
    await (await page.$('#map-grid-table td')).click();
    await page.waitForTimeout(150);
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="5"]', { force: true });
    await page.waitForTimeout(500);

    const v1 = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  after +5%:', v1);
    assert(Math.abs(v1) > Math.abs(v0),
      `REGRESSION: +5 % sur ${v0} a produit ${v1} — la magnitude devrait augmenter (attendu ~${v0 * 1.1})`);
    // Entre -1.05 et -1.2 approximativement (bump ±1 raw = ±0.1 phys)
    assert(v1 < -1.0 && v1 > -1.3, `attendu entre -1.3 et -1.0, got ${v1}`);

    // −5 % : la magnitude doit DIMINUER (−1.1 → −1.0 ou −0.95)
    await page.click('[data-op="pct"][data-val="-5"]', { force: true });
    await page.waitForTimeout(500);
    const v2 = await page.$eval('input[data-xi="0"][data-yi="0"]', i => parseFloat(i.value));
    console.log('  after −5%:', v2);
    assert(Math.abs(v2) < Math.abs(v1),
      `REGRESSION: −5 % sur ${v1} a produit ${v2} — la magnitude devrait diminuer`);

    console.log('✅ pct-bump-negative test passed');
  } finally {
    if (pid) await page.request.delete(URL + '/api/projects/' + pid).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
