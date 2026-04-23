// Le rapport HTML /report.html doit lister les cartes modifiées par rapport
// à la ROM originale backup, avec les % deltas. L'utilisateur le télécharge
// et lance Ctrl-P depuis le navigateur pour enregistrer en PDF.

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
      data: {
        name: '_REPORT_TEST_',
        vehicle: 'Peugeot 308 HDi',
        immat: 'AB-123-XY',
        year: '2010',
        ecu: 'edc16c34'
      }
    });
    projectId = (await r.json()).id;
    await page.request.post(URL + '/api/projects/' + projectId + '/rom', {
      multipart: { rom: { name: 'ori.BIN', mimeType: 'application/octet-stream', buffer: fs.readFileSync(ROM) } }
    });

    await page.goto(URL + '/#/project/' + projectId);
    await page.waitForSelector('#hex-canvas', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(1500);

    // Modify some maps to populate the report
    await page.fill('#param-search', 'AccPed_trqEngHiGear_MAP');
    await page.waitForTimeout(400);
    await (await page.$('.param-item')).click();
    await page.waitForTimeout(600);
    await (await page.$('#map-grid-table td')).click();
    await page.click('#map-sel-all', { force: true });
    await page.click('[data-op="pct"][data-val="10"]', { force: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })));
    await page.waitForTimeout(1200);

    // Link is in the toolbar
    const href = await page.$eval('#btn-report', a => a.getAttribute('href'));
    assert(href.endsWith('/report.html'), 'report link should point to /report.html');

    // Open the report
    await page.goto(URL + href);
    await page.waitForSelector('table.maps, .empty', { timeout: 5000 });

    const title = await page.textContent('h1');
    assert(/Rapport tune/i.test(title), `h1 should say "Rapport tune": got "${title}"`);
    assert(/_REPORT_TEST_/.test(title), 'h1 should include project name');

    const meta = await page.textContent('table.meta');
    assert(/Peugeot 308 HDi/.test(meta), 'meta should show vehicle');
    assert(/AB-123-XY/.test(meta), 'meta should show immat');
    assert(/2010/.test(meta), 'meta should show year');
    assert(/EDC16C34/.test(meta), 'meta should show ECU');

    const rows = await page.$$('table.maps tbody tr');
    assert(rows.length > 0, 'should list at least one modified map');
    console.log('  ✓ report lists', rows.length, 'modified maps');

    // First row should mention AccPed_trqEngHiGear_MAP and a +10% delta
    const firstRow = await rows[0].textContent();
    assert(/AccPed_trqEngHiGear_MAP/.test(firstRow), `first row should be AccPed map: got "${firstRow.slice(0, 120)}"`);
    assert(/\+\d+\s*%/.test(firstRow), `first row should have a positive % delta: got "${firstRow.slice(0, 120)}"`);

    // Print button visible in browser, hidden on print (@media print)
    const printBtn = await page.$('.print-btn');
    assert(printBtn, 'Print button should be visible in the browser view');

    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'report-pdf.png'), fullPage: true });

    // Save a real PDF via Playwright's native PDF export (headless chromium)
    const pdfPath = path.join(__dirname, 'screenshots', 'report-pdf.pdf');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '1.5cm', bottom: '1.5cm', left: '1.2cm', right: '1.2cm' } });
    const pdfSize = fs.statSync(pdfPath).size;
    console.log('  ✓ PDF generated:', pdfSize, 'bytes');
    assert(pdfSize > 2000, 'PDF should be a reasonable size');

    console.log('✅ report-pdf test passed');
  } finally {
    if (projectId) await page.request.delete(URL + '/api/projects/' + projectId).catch(() => {});
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
