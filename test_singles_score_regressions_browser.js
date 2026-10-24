// 点数の共有・作り直しと、遅れた通信の回帰。実際の GAS をローカルのモックで動かす。
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const { makeContext, webApp } = require('./gas_mock');
const API = 'https://gas.test/exec';
const url = pathToFileURL(path.join(__dirname, 'singles.html')).href;
const gas = makeContext(), serve = webApp(gas);
const admin = body => serve({ method: 'POST', url: API, body: JSON.stringify({ action: 'admin', key: gas.ADMIN_KEY, ...body }) });
admin({ op: 'setup' });
let failures = 0;
const errors = [];
const paused = [];
const blocked = new Set();
function pauseNext(action) {
  let release, ready;
  const gate = { action, wait: new Promise(r => { release = r; }), ready: new Promise(r => { ready = r; }), release, arrive: () => ready() };
  paused.push(gate);
  return gate;
}
async function open(browser, hash = '') {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  await ctx.addInitScript(api => { window.SCORE_API_URL = api; }, API);
  await ctx.route(API + '**', async route => {
    const req = route.request(), body = req.postData() || '';
    const action = req.method() === 'GET' ? new URL(req.url()).searchParams.get('action') : JSON.parse(body).action;
    if (blocked.has(action)) return route.abort();
    const res = serve({ method: req.method(), url: req.url(), body });
    const at = paused.findIndex(g => g.action === action);
    if (at >= 0) { const gate = paused.splice(at, 1)[0]; gate.arrive(); await gate.wait; }
    await route.fulfill({ status: res.status, contentType: res.contentType, body: res.body, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(url + hash);
  return page;
}
async function host(browser) {
  const page = await open(browser);
  await page.evaluate(async () => {
    session = buildSession({ mode: 'pairs', players: [1, 2, 3, 4], courts: 2, totalRounds: 10, restOrder: 'desc', forced: {},
      names: { 1: ['バレ', '原'], 2: ['越野', '善志'], 3: ['大野', '北原'], 4: ['内田', '根津真'] },
      practiceDate: '2026-10-25', scoring: true, scoreId: randomId('T') });
    restoreInputs(); persist(); render(); await registerScores();
  });
  return page;
}
const row = (page, key = '3A') => page.locator(`.score-row[data-key="${key}"]`);
async function save(page, a, b, key = '3A') {
  const el = row(page, key);
  if (await el.locator('.score-saved').count()) await el.getByText('直す', { exact: true }).click();
  await el.locator('input').nth(0).fill(String(a)); await el.locator('input').nth(1).fill(String(b));
  await el.locator('button.save').click();
  await page.waitForFunction(({ key, a, b }) => document.querySelector(`.score-row[data-key="${key}"] .score-saved`)?.textContent === `${a} - ${b} ✓`, { key, a, b });
}
async function change(page) {
  await page.evaluate(() => {
    const next = JSON.parse(JSON.stringify(session));
    const [a, b, c, d] = next.rounds[2].matches.flat();
    next.rounds[2].matches = [[a, c], [b, d]];
    session = next; persist(); registerScores(); render();
  });
}
async function test(label, fn) {
  try { await fn(); console.log('OK ' + label); }
  catch (e) { failures++; console.error('FAIL ' + label + ': ' + e.message); }
}
(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    await test('共有先は記録をオフ→オンに戻した後も同期を続ける', async () => {
      const h = await host(browser), v = await open(browser, await h.evaluate(() => SHARE_PREFIX + encodeShare(session)));
      await v.evaluate(() => syncScores());
      await h.evaluate(async () => { toggleScoring(false); await registerChain; });
      await v.evaluate(() => syncScores());
      assert.equal(await v.locator('.score-row').count(), 0);
      assert.equal(await v.evaluate(() => scoreTimer !== null), true, 'オフの間も表の変更を確認する');
      await h.evaluate(async () => { toggleScoring(true); await registerChain; });
      await v.evaluate(() => syncScores());
      assert.equal(await v.locator('.score-row').count(), 20);
      await h.context().close(); await v.context().close();
    });
    await test('作り直した別の対戦に、前の点数や入力途中の点数を表示しない', async () => {
      const h = await host(browser);
      await save(h, 21, 18);
      await row(h, '3B').locator('input').nth(0).fill('15');
      await row(h, '1A').locator('input').nth(0).fill('17');
      const gate = pauseNext('register');
      await change(h); await gate.ready;
      const saved = await row(h).locator('.score-saved').count();
      const draft = await row(h, '3B').locator('input').first().inputValue();
      gate.release(); await h.evaluate(() => registerChain);
      assert.equal(saved, 0, '以前の対戦の保存済み点数が別の対戦に表示された');
      assert.equal(draft, '', '以前の対戦の入力途中の点数が残った');
      assert.equal(await row(h, '1A').locator('input').first().inputValue(), '17', '変わらない対戦の下書きは残す');
      await h.context().close();
    });
    await test('保存より遅れて届いた古い読込結果で点数を巻き戻さない', async () => {
      const h = await host(browser); await save(h, 21, 18);
      const gate = pauseNext('get');
      await h.evaluate(() => { window.pendingScoreRead = syncScores(); }); await gate.ready;
      await save(h, 21, 12);
      gate.release(); await h.evaluate(() => window.pendingScoreRead);
      assert.match(await row(h).textContent(), /21 - 12 ✓/);
      assert.doesNotMatch(await h.locator('#scoreInfo').textContent(), /読み込んでいます/);
      await h.context().close();
    });
    await test('2試合を同時に保存しても、遅れた返事で別の試合の点数を巻き戻さない', async () => {
      const h = await host(browser); await save(h, 21, 18); await save(h, 15, 21, '3B');
      const gate = pauseNext('score');
      await row(h).getByText('直す', { exact: true }).click();
      await row(h).locator('input').nth(1).fill('12'); await row(h).locator('button.save').click(); await gate.ready;
      await save(h, 21, 10, '3B');
      gate.release(); await h.waitForFunction(() => scoreSaving.size === 0);
      assert.match(await row(h).textContent(), /21 - 12 ✓/);
      assert.match(await row(h, '3B').textContent(), /21 - 10 ✓/);
      await h.context().close();
    });
    await test('保存の返事が遅れても、作り直した別の対戦に前の点数を付けない', async () => {
      const h = await host(browser), gate = pauseNext('score');
      await row(h).locator('input').nth(0).fill('21'); await row(h).locator('input').nth(1).fill('18');
      await row(h).locator('button.save').click(); await gate.ready;
      await change(h); await h.evaluate(() => registerChain);
      gate.release(); await h.waitForFunction(() => scoreSaving.size === 0);
      assert.equal(await row(h).locator('.score-saved').count(), 0);
      await h.context().close();
    });
    await test('古い共有表から点数を保存しようとしたら、その場で最新の表に切り替える', async () => {
      const h = await host(browser), v = await open(browser, await h.evaluate(() => SHARE_PREFIX + encodeShare(session)));
      await v.evaluate(() => syncScores());
      await change(h); await h.evaluate(() => registerChain);
      const current = await h.evaluate(() => encodeShare(session));
      await row(v).locator('input').nth(0).fill('21'); await row(v).locator('input').nth(1).fill('18');
      await row(v).locator('button.save').click();
      await v.waitForFunction(data => encodeShare(session) === data, current, { timeout: 5000 });
      assert.equal(await row(v).locator('.score-saved').count(), 0);
      await h.context().close(); await v.context().close();
    });
    await test('作り直しの登録に失敗して再読込しても、変更を再送して一致させる', async () => {
      const h = await host(browser); await save(h, 21, 18);
      blocked.add('register'); await change(h); await h.evaluate(() => registerChain); blocked.delete('register');
      await h.reload();
      await h.waitForFunction(() => scoreState.checkedAt > 0 && !scoreState.registering);
      const id = await h.evaluate(() => session.scoreId);
      const remote = JSON.parse(serve({ method: 'GET', url: API + '?action=get&id=' + id }).body);
      assert.ok(remote.data === await h.evaluate(() => encodeShare(session)), '保存した表とスプシの表が異なる');
      assert.equal(await row(h).locator('.score-saved').count(), 0);
      await h.context().close();
    });
    assert.deepEqual(errors, [], 'ページの実行時エラー');
  } finally { blocked.clear(); paused.splice(0).forEach(g => g.release()); await browser.close(); }
  if (failures) process.exitCode = 1;
  console.log(`点数の同期の回帰: ${failures}件失敗`);
})().catch(e => { console.error(e); process.exitCode = 1; });
