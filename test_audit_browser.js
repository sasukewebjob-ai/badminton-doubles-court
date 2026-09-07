// Exercise the audit regressions through real browser UI and localStorage.
const assert = require('assert/strict');
const { chromium, launchOptions } = require('./pw');
const { pathToFileURL } = require('url');
const path = require('path');
const url = pathToFileURL(path.join(__dirname, 'index.html')).href;

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({viewport: {width: 375, height: 700}});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(url);
    await page.selectOption('#courtCount', '4');
    await page.selectOption('#playerCount', '18');
    await page.click('#generateBtn');
    await page.selectOption('#consumedRound', '3');
    await page.selectOption('#changeCourtCount', '3');
    await page.click('.btn-change');
    const host = await page.evaluate(() => ({rounds: session.rounds, url: buildShareUrl()}));
    const viewerContext = await browser.newContext();
    const viewer = await viewerContext.newPage();
    viewer.on('pageerror', e => errors.push(e.message));
    viewer.on('dialog', d => d.accept());
    await viewer.goto(host.url);
    await viewer.waitForSelector('.viewer-banner');
    assert.deepEqual(await viewer.evaluate(() => session.rounds), host.rounds);
    assert.equal(await viewer.locator('.round-card').nth(2).locator('.court-match').count(), 4);
    assert.equal(await viewer.locator('.round-card').nth(3).locator('.court-match').count(), 3);
    console.log('OK court-count change displays identically for host and viewer');

    await page.selectOption('#consumedRound', '9');
    await page.selectOption('#addCount', '1');
    await page.click('.btn-change');
    const final = await page.evaluate(() => ({rounds: session.rounds, url: buildShareUrl()}));
    await viewer.goto(final.url);
    await viewer.waitForFunction(() => session && session.players.length === 19);
    assert.deepEqual(await viewer.evaluate(() => session.rounds), final.rounds);
    await page.reload();
    await page.waitForSelector('.restore-banner');
    assert.deepEqual(await page.evaluate(() => session.rounds), final.rounds);
    console.log('OK final-round member change can be shared and restored');

    const clean = await page.evaluate(() => JSON.parse(JSON.stringify(session)));
    const corruptions = [
      s => { s.rounds[0] = null; },
      s => { s.rounds[0].assignments[0].pair1[0] = s.rounds[0].assignments[0].pair1[1]; },
      s => { s.rounds[1].resting.push(999); },
      s => { s.changes[0] = null; },
      s => { s.totalRounds = 100000; },
      s => { s.players.push(s.players[0]); },
    ];
    for (const mutate of corruptions) {
      const corrupt = JSON.parse(JSON.stringify(clean));
      mutate(corrupt);
      await page.evaluate(s => localStorage.setItem('badminton-court-session-v1', JSON.stringify({v: 1, session: s})), corrupt);
      await page.reload();
      assert.equal(await page.evaluate(() => session), null);
      assert.equal(await page.locator('.round-card').count(), 0);
      assert.ok(await page.locator('#generateBtn').isEnabled());
    }
    console.log('OK six structurally corrupted saves are rejected without page errors');

    // Old sessions without optional returned/names/gender/forced fields still restore.
    const legacy = JSON.parse(JSON.stringify(clean));
    legacy.changes.forEach(c => delete c.returned);
    for (const k of ['names', 'genderMode', 'guestGenders', 'forcedRests', 'restOrder']) delete legacy[k];
    await page.evaluate(s => localStorage.setItem('badminton-court-session-v1', JSON.stringify({v: 1, savedAt: Date.now(), session: s})), legacy);
    await page.reload();
    await page.waitForSelector('.restore-banner');
    assert.deepEqual(await page.evaluate(() => session.rounds), clean.rounds);
    console.log('OK legacy save remains compatible');

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.selectOption('#courtCount', '2');
    await page.selectOption('#playerCount', '10');
    await page.selectOption('#roundCount', '30');
    await page.click('#generateBtn');
    await page.selectOption('#consumedRound', '10');
    await page.selectOption('#addCount', '1');
    await page.click('.btn-change');
    await page.reload(); // Credits must be reconstructed from saved history too.
    await page.waitForSelector('.restore-banner');
    const kept = await page.evaluate(() => JSON.stringify(session.rounds.slice(0, 11)));
    await page.selectOption('#consumedRound', '11');
    await page.click('.btn-change');
    const actual = await page.evaluate(() => session);
    assert.equal(JSON.stringify(actual.rounds.slice(0, 11)), kept);
    const counts = Object.fromEntries(actual.players.map(p => [p, p === 11 ? 2 : 0]));
    for (const r of actual.rounds) {
      r.resting.forEach(p => counts[p]++);
      if (r.round > 10) assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1);
    }
    assert.equal(await page.locator('.round-card').count(), 30);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    assert.deepEqual(errors, []);
    console.log('OK repeated member change after reload preserves rest credits and completed rounds; no page errors or horizontal overflow');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
