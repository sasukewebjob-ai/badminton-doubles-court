const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
// AUDIT_BASE_URL lets the same regression checks verify the deployed pages.
const baseUrl = process.env.AUDIT_BASE_URL;
const url = file => baseUrl ? new URL(file + '?audit=' + Date.now(), baseUrl).href : pathToFileURL(path.join(__dirname, file)).href;
let passed = 0, failed = 0;
async function test(browser, name, file, fn) {
  const context = await browser.newContext({ viewport: { width: 375, height: 740 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  try {
    const response = await page.goto(url(file));
    if (baseUrl) {
      assert.equal(response.status(), 200);
      assert.equal((await response.text()).replace(/\r\n/g, '\n'),
        fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n'),
        'deployed HTML must match the tested local version');
    }
    await fn(page);
    assert.deepEqual(errors, []);
    passed++; console.log('OK ' + name);
  } catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
  finally { await context.close(); }
}
function assertStreaks(rounds) {
  const streak = {};
  rounds.forEach(r => {
    for (let p = 1; p <= 20; p++) {
      streak[p] = r.resting.includes(p) ? (streak[p] || 0) + 1 : 0;
      assert.ok(streak[p] <= 3, `round ${r.round}, player ${p}: ${streak[p]} consecutive rests`);
    }
  });
}
(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    await test(browser, 'regeneration after reload keeps completed rounds, rest streaks, displayed totals and share data', 'index.html', async page => {
      await page.selectOption('#courtCount', '2');
      await page.selectOption('#playerCount', '20');
      await page.selectOption('#roundCount', '10');
      await page.selectOption('#restOrder', 'desc');
      await page.click('#generateBtn');
      const original = await page.evaluate(() => session.rounds);
      await page.reload();
      await page.selectOption('#consumedRound', '5');
      await page.click('.btn-change');
      const changed = await page.evaluate(() => ({
        rounds: session.rounds,
        shared: decodeShareData(encodeShareData()).session.rounds,
        saved: JSON.parse(localStorage.getItem(STORAGE_KEY)).session.rounds,
        rows: [...document.querySelectorAll('.stats-table tr')].slice(1).map(r => [...r.cells].map(c => c.textContent)),
      }));
      assert.deepEqual(changed.rounds.slice(0, 5), original.slice(0, 5));
      assert.deepEqual(changed.shared, changed.rounds);
      assert.deepEqual(changed.saved, changed.rounds);
      assertStreaks(changed.rounds);
      changed.rows.forEach((row, i) => {
        const rests = changed.rounds.filter(r => r.resting.includes(i + 1)).map(r => r.round);
        assert.equal(Number(row[1]), rests.length);
        assert.equal(row[2], rests.length ? rests.join(', ') : '-');
      });
      await page.reload();
      assert.deepEqual(await page.evaluate(() => session.rounds), changed.rounds);
      await page.selectOption('#consumedRound', '6');
      await page.click('.btn-change');
      const repeated = await page.evaluate(() => session.rounds);
      assert.deepEqual(repeated.slice(0, 6), changed.rounds.slice(0, 6));
      assertStreaks(repeated);
    });

    for (const file of ['index.html', 'singles.html']) for (const lateNull of [false, true]) for (const onIOS of [false, true]) {
      await test(browser, `${file} / ${onIOS ? 'iOS' : 'desktop'}: late ${lateNull ? 'fallback' : 'PNG'} completion cannot replace the latest preview`, file, async page => {
        await page.selectOption('#roundCount', '20');
        await page.click('#generateBtn');
        await page.evaluate(ios => {
          // Hold actual PNG callbacks and finish them in reverse order, as can happen on a busy phone.
          const original = HTMLCanvasElement.prototype.toBlob;
          window.__pngJobs = [];
          HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
            const job = { callback, blob: null }; window.__pngJobs.push(job);
            original.call(this, blob => { job.blob = blob; }, ...args);
          };
          window.__downloads = []; window.__revoked = [];
          HTMLAnchorElement.prototype.click = function() { window.__downloads.push(this.download); };
          const revoke = URL.revokeObjectURL;
          URL.revokeObjectURL = function(url) { window.__revoked.push(url); revoke.call(URL, url); };
          Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
          if (ios) Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
        }, onIOS);
        await page.evaluate(doubles => {
          if (doubles) { saveAsImage(0); saveAsImage(1); }
          else { saveImage(0); saveImage(10); }
        }, file === 'index.html');
        await page.waitForFunction(() => window.__pngJobs.length === 2 && window.__pngJobs.every(j => j.blob));
        await page.evaluate(() => window.__pngJobs[1].callback(window.__pngJobs[1].blob));
        const latest = await page.locator('#imagePreview').textContent();
        const src = await page.locator('#imagePreview img').getAttribute('src');
        const sharedFile = await page.evaluate(() => lastImageFile.name);
        assert.ok(latest.includes('11〜20'));
        await page.evaluate(useNull => window.__pngJobs[0].callback(useNull ? null : window.__pngJobs[0].blob), lateNull);
        assert.equal(await page.locator('#imagePreview').textContent(), latest);
        assert.equal(await page.locator('#imagePreview img').getAttribute('src'), src);
        assert.equal(await page.evaluate(() => lastImageFile.name), sharedFile);
        assert.equal(await page.evaluate(() => window.__downloads.length), onIOS ? 0 : 2, 'desktop keeps both downloads; iOS uses the preview');
        assert.equal(await page.evaluate(current => window.__revoked.includes(current), src), false);
        if (onIOS && !lateNull) assert.equal(await page.evaluate(() => window.__revoked.length), 1, 'discard the stale iOS blob');
      });
    }
  } finally { await browser.close(); }
  console.log(`2026-09-28 browser regressions: ${passed} passed / ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
