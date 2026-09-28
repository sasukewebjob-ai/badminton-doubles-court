// Date metadata must survive editing/restoring/sharing without changing the schedule.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const baseUrl = process.env.AUDIT_BASE_URL;
const out = path.join(__dirname, 'work', 'practice-date');
fs.mkdirSync(out, { recursive: true });
const url = file => baseUrl ? new URL(file + '?date=' + Date.now(), baseUrl).href : pathToFileURL(path.join(__dirname, file)).href;
(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    for (const mode of ['doubles', 'singles', 'pairs']) {
      const doubles = mode === 'doubles', file = doubles ? 'index.html' : 'singles.html';
      const context = await browser.newContext({ viewport: { width: 375, height: 800 }, timezoneId: 'Asia/Tokyo' });
      await context.addInitScript(() => {
        const OriginalDate = Date;
        // This is September 28 in Japan but September 27 in UTC.
        window.Date = class extends OriginalDate {
          constructor(...args) { super(...(args.length ? args : ['2026-09-27T16:00:00Z'])); }
          static now() { return new OriginalDate('2026-09-27T16:00:00Z').getTime(); }
        };
      });
      const page = await context.newPage(), errors = [];
      page.on('dialog', d => d.accept()); page.on('pageerror', e => errors.push(e.message));
      const response = await page.goto(url(file));
      if (baseUrl) {
        assert.equal(response.status(), 200);
        assert.equal((await response.text()).replace(/\r\n/g, '\n'), fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n'));
      }
      assert.equal(await page.inputValue('#practiceDate'), '2026-09-28');
      assert.deepEqual(await page.evaluate(() => ['2024-02-29', '2026-02-29', '2026-04-31', '0000-01-01', '<img>'].map(validPracticeDate)), [true, false, false, false, false]);
      if (!doubles) await page.selectOption('#mode', mode);
      await page.selectOption('#roundCount', '20');
      await page.click('#generateBtn');
      const rounds = await page.evaluate(() => JSON.stringify(session.rounds));
      assert.equal(await page.locator('.round-date').count(), 20);
      assert.equal(await page.locator('.round-date').first().textContent(), '2026年9月28日（月）');
      await page.fill('#practiceDate', '2026-10-03'); await page.dispatchEvent('#practiceDate', 'change');
      assert.equal(await page.evaluate(() => JSON.stringify(session.rounds)), rounds);
      assert.equal(await page.locator('.round-date').first().textContent(), '2026年10月3日（土）');
      await page.reload();
      assert.equal(await page.inputValue('#practiceDate'), '2026-10-03');
      assert.equal(await page.evaluate(() => JSON.stringify(session.rounds)), rounds);
      const shared = await page.evaluate(isDoubles => {
        const data = isDoubles ? encodeShareData() : encodeShare(session);
        const result = isDoubles ? decodeShareData(data).session : decodeShare(data);
        return { date: result.practiceDate, hash: isDoubles ? '#s=' + data : SHARE_PREFIX + data };
      }, doubles);
      assert.equal(shared.date, '2026-10-03');
      const viewer = await context.newPage();
      await viewer.goto(url(file) + shared.hash);
      assert.equal(await viewer.locator('.round-date').first().textContent(), '2026年10月3日（土）');
      await viewer.close();

      // Inspect the real saved image as well as the on-screen cards.
      await page.evaluate(isDoubles => { if (isDoubles) saveAsImage(1); else saveImage(10); }, doubles);
      await page.waitForFunction(() => { const img = document.querySelector('#imagePreview img'); return img && img.naturalWidth > 0; });
      await page.locator('#imagePreview').evaluate(el => { el.style.height = '430px'; el.style.overflow = 'hidden'; });
      await page.locator('#imagePreview').screenshot({ path: path.join(out, mode + '-image-top.png') });

      // Both exported parts carry the date; changing a date while encoding drops the outdated image.
      await page.evaluate(() => {
        window.__dateText = []; window.__heldImages = [];
        const text = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(value, ...args) { window.__dateText.push(String(value)); return text.call(this, value, ...args); };
        HTMLCanvasElement.prototype.toBlob = function(callback) { window.__heldImages.push(callback); };
        HTMLAnchorElement.prototype.click = function() {};
      });
      await page.evaluate(isDoubles => {
        if (isDoubles) { saveAsImage(0); saveAsImage(1); } else { saveImage(0); saveImage(10); }
      }, doubles);
      assert.equal(await page.evaluate(() => window.__dateText.filter(s => s === '2026年10月3日（土）').length), 2);
      await page.fill('#practiceDate', '2026-10-04'); await page.dispatchEvent('#practiceDate', 'change');
      await page.evaluate(() => window.__heldImages.forEach(callback => callback(new Blob(['unused'], { type: 'image/png' }))));
      assert.equal(await page.locator('#imagePreview img').count(), 0);
      assert.equal(await page.evaluate(() => JSON.stringify(session.rounds)), rounds);
      await page.locator('.round-card').first().screenshot({ path: path.join(out, mode + '-card.png') });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

      // An older saved table has no reliable practice date: keep it blank, and allow adding one without regeneration.
      await page.evaluate(isDoubles => {
        delete session.practiceDate;
        if (isDoubles) saveSession(); else persist();
      }, doubles);
      await page.reload();
      assert.equal(await page.inputValue('#practiceDate'), '');
      assert.equal(await page.locator('.round-date').count(), 0);
      await page.fill('#practiceDate', '2026-10-05'); await page.dispatchEvent('#practiceDate', 'change');
      assert.equal(await page.evaluate(() => JSON.stringify(session.rounds)), rounds);
      assert.equal(await page.locator('.round-date').first().textContent(), '2026年10月5日（月）');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`OK ${mode}: local date, metadata-only change, restore, sharing, both images, stale images, legacy data and mobile layout`);
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
