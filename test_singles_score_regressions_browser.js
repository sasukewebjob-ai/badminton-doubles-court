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
const seen = []; // 窓口に届いた操作の順（登録を送り続けていないかの確認用）
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
    seen.push(action);
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
async function change(page, rev = false) {
  await page.evaluate(rev => {
    const next = JSON.parse(JSON.stringify(session));
    const [a, b, c, d] = next.rounds[2].matches.flat();
    next.rounds[2].matches = [[a, c], [b, d]];
    session = rev ? revised(next) : next; persist(); registerScores(); render();
  }, rev);
}
const remoteOf = id => JSON.parse(serve({ method: 'GET', url: API + '?action=get&id=' + id }).body);
async function test(label, fn) {
  try { await fn(); console.log('OK ' + label); }
  catch (e) { failures++; console.error('FAIL ' + label + ': ' + e.message); }
  finally { blocked.clear(); } // 途中で失敗しても、次のテストに通信の止めを持ち越さない
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
    // ---- 2026-10-24 再確認で見つかった不具合（ここから） ----
    await test('練習日の欄を変えても、確認で「キャンセル」なら表示中の表とスプシの日付・点数は動かない', async () => {
      const h = await host(browser); await save(h, 21, 18);
      const id = await h.evaluate(() => session.scoreId), messages = [];
      h.removeAllListeners('dialog'); h.on('dialog', d => { messages.push(d.message()); d.dismiss(); });
      await h.fill('#practiceDate', '2026-11-08'); await h.dispatchEvent('#practiceDate', 'change');
      await h.evaluate(() => registerChain);
      assert.equal(messages.length, 1, '確認が出る');
      assert.match(messages[0], /2026年11月8日/);
      assert.equal(await h.evaluate(() => session.practiceDate), '2026-10-25', '表示中の表の日付はそのまま');
      assert.equal(remoteOf(id).date, '2026-10-25', 'スプシの日付も動かない');
      assert.match(await h.locator('#status').textContent(), /新しく作る表は欄の日付/);
      assert.equal(await h.evaluate(() => freshPracticeDate()), '2026-11-08', '次に作る表は欄の日付');
      await h.dispatchEvent('#practiceDate', 'change');
      assert.equal(messages.length, 1, '同じ日付で change がもう一度来ても聞き直さない');
      await h.fill('#practiceDate', ''); await h.dispatchEvent('#practiceDate', 'change');
      assert.equal(await h.evaluate(() => session.practiceDate), '2026-10-25', '空欄にしても記録中の表の日付は消さない');
      h.removeAllListeners('dialog'); h.on('dialog', d => { messages.push(d.message()); d.accept(); });
      await h.fill('#practiceDate', '2026-10-26'); await h.dispatchEvent('#practiceDate', 'change');
      await h.evaluate(() => registerChain);
      assert.equal(messages.length, 2);
      assert.equal(await h.evaluate(() => session.practiceDate), '2026-10-26', '「OK」なら表示中の表の日付を変える');
      assert.equal(remoteOf(id).date, '2026-10-26');
      assert.match(await row(h).textContent(), /21 - 18 ✓/, '点数はそのまま');
      await h.context().close();
    });
    await test('閲覧者は、スプシの表が古いとき（作り直しの登録が失敗中）に古い表へ戻さず、古い点数を別の対戦に出さない', async () => {
      const h = await host(browser); await save(h, 21, 18);
      blocked.add('register'); await change(h, true); await h.evaluate(() => registerChain); blocked.delete('register');
      const link = await h.evaluate(() => SHARE_PREFIX + encodeShare(session)), mine = await h.evaluate(() => encodeShare(session));
      const v = await open(browser, link);
      await v.waitForFunction(() => scoreState.checkedAt > 0);
      assert.equal(await v.evaluate(() => encodeShare(session)), mine, '開いたリンクの（新しい）表のまま');
      assert.equal(await row(v).locator('.score-saved').count(), 0, '作り直す前の対戦の点数を出さない');
      await h.evaluate(async () => { registerScores(true); await registerChain; });
      await v.evaluate(() => syncScores());
      assert.equal(await v.evaluate(() => encodeShare(session)), mine);
      await h.context().close(); await v.context().close();
    });
    await test('作り直しの鍵が無い端末では、登録を送り続けずに点数を読む', async () => {
      const h = await host(browser);
      await h.evaluate(() => { const keys = JSON.parse(localStorage.getItem(SCORE_KEYS)); keys[session.scoreId] = 'Kxxxxxxxxxxxxxxxxxxxxxx'; localStorage.setItem(SCORE_KEYS, JSON.stringify(keys)); });
      await change(h); await h.evaluate(() => registerChain);
      assert.match(await h.locator('#scoreStatus').textContent(), /別の端末で作られた/);
      const from = seen.length;
      for (let i = 0; i < 3; i++) await h.evaluate(() => syncScores());
      assert.deepEqual(seen.slice(from), ['get', 'get', 'get']);
      await h.context().close();
    });
    await test('記録オフの登録が失敗したら、「もう一度登録する」で送り直せる', async () => {
      const h = await host(browser), id = await h.evaluate(() => session.scoreId);
      blocked.add('register'); await h.evaluate(async () => { toggleScoring(false); await registerChain; }); blocked.delete('register');
      await h.getByText('もう一度登録する', { exact: true }).click();
      await h.evaluate(() => registerChain);
      assert.equal(JSON.parse(Buffer.from(remoteOf(id).data, 'base64').toString('utf8')).scoring, false, 'スプシの表も記録オフになる');
      assert.equal(await h.getByText('もう一度登録する', { exact: true }).count(), 0);
      await h.context().close();
    });
    await test('入力欄をタップしただけ（まだ打っていない）のときは、読み込みで描き直さない', async () => {
      const h = await host(browser);
      await row(h).locator('input').first().focus();
      await h.evaluate(() => syncScores());
      assert.equal(await h.evaluate(() => document.activeElement.closest('.score-row')?.dataset.key), '3A', 'カーソルが外れない');
      await h.context().close();
    });
    await test('記録オフで作った表をオンにすると、共有リンクの送り直しを案内する', async () => {
      const h = await open(browser);
      await h.evaluate(() => {
        session = buildSession({ mode: 'pairs', players: [1, 2, 3, 4], courts: 2, totalRounds: 10, restOrder: 'desc', forced: {},
          names: { 1: ['バレ', '原'], 2: ['越野', '善志'], 3: ['大野', '北原'], 4: ['内田', '根津真'] }, practiceDate: '2026-10-25' });
        restoreInputs(); persist(); render();
      });
      await h.check('#scoringNow'); await h.evaluate(() => registerChain);
      assert.match(await h.locator('#status').textContent(), /送り直して/);
      assert.equal(await h.locator('.score-row').count(), 20);
      await h.context().close();
    });
    await test('大会ペアを読み込んでいる間は作成できず、読み込んだら大会ペアで作れる', async () => {
      admin({ op: 'addTournaments', tournaments: [{ name: 'テスト杯', date: '2026-11-15' }] });
      admin({ op: 'addPairs', pairs: [{ tournament: 'テスト杯', category: '男子', names: ['バレ', '原'] }, { tournament: 'テスト杯', category: '男子', names: ['越野', '善志'] }] });
      const h = await open(browser);
      await h.fill('#practiceDate', '2026-10-25'); await h.dispatchEvent('#practiceDate', 'change');
      const gate = pauseNext('tournaments');
      await h.selectOption('#mode', 'pairs'); await gate.ready;
      await h.selectOption('#courtCount', '1');
      for (const nm of ['バレ', '越野', '原', '善志']) await h.click(`#rosterChips button[data-name="${nm}"]`);
      assert.equal(await h.isDisabled('#generateBtn'), true, '読み込み中は作成ボタンを押せない');
      assert.match(await h.locator('#infoBox').textContent(), /大会ペアを確認しています/);
      gate.release();
      await h.waitForFunction(() => !document.querySelector('#generateBtn').disabled);
      await h.click('#generateBtn');
      assert.deepEqual(await h.evaluate(() => [session.names[1], session.names[2], session.scoring]), [['バレ', '原'], ['越野', '善志'], true]);
      await h.context().close();
    });
    assert.deepEqual(errors, [], 'ページの実行時エラー');
  } finally { blocked.clear(); paused.splice(0).forEach(g => g.release()); await browser.close(); }
  if (failures) process.exitCode = 1;
  console.log(`点数の同期の回帰: ${failures}件失敗`);
})().catch(e => { console.error(e); process.exitCode = 1; });
