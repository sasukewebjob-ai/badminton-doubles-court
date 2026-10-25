// 練習日ごとの記録（2026-10-25 ユーザー要望：体育館のノートの代わり）と短い共有リンクの画面テスト（Playwright、375px幅）
// - 「点数を記録する」は大会の練習期間でなくても最初からオン
// - 共有リンクはスプシに登録済みなら「#t=表ID」だけ（登録中・失敗は従来の長いリンク）。開いた人はスプシから表を読む
// - 途中から来た人にも名簿から名前を付けられる（空いている番号を小さい順に）
// - スプシの「練習日」シートに、その日の出席者・成績・対戦表と点数が出る
// 本物の GAS（gas/core.js・gas/main.js）を gas_mock.js で動かし、公開Webアプリの代わりに応答させる。
// 手元: node test_practice_record_browser.js
// 本番: AUDIT_BASE_URL=https://sasukewebjob-ai.github.io/badminton-doubles-court/ node test_practice_record_browser.js
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium, launchOptions } = require('./pw');
const { makeContext, webApp } = require('./gas_mock');

const API = 'https://gas.test/exec';
let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail !== undefined ? ' → ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
}

const gas = makeContext();
const serve = webApp(gas);
const admin = (op, extra = {}) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify({ action: 'admin', key: gas.ADMIN_KEY, op, ...extra }) } }).content);
const rows = name => { const sh = gas.book.getSheetByName(name), n = sh.getLastRow(); return n < 2 ? [] : sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues(); };
admin('setup', { tournaments: [{ name: '岡谷連盟杯', date: '2026-11-03' }],
  pairs: [{ tournament: '岡谷連盟杯', category: '男子B', names: ['北原', '上條'] }] });
const log = [];
const blocked = new Set(); // ここに入れた操作は通信できないことにする
const count = action => log.filter(x => x.action === action).length;
const errors = [];

async function openPage(browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, timezoneId: 'Asia/Tokyo' });
  await context.addInitScript(api => {
    window.SCORE_API_URL = api;
    // 共有はクリップボードへのコピーで確かめる（共有シートは出さない）
    window.__copied = [];
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied.push(t); } }, configurable: true });
  }, API);
  await context.route(API + '**', async route => {
    const req = route.request(), body = req.postData() || '';
    let action = new URL(req.url()).searchParams.get('action');
    try { action = action || JSON.parse(body).action; } catch { /* 本文が読めなければ不明のまま */ }
    log.push({ method: req.method(), action, url: req.url() });
    if (blocked.has(action)) return route.abort();
    const res = serve({ method: req.method(), url: req.url(), body });
    await route.fulfill({ status: res.status, contentType: res.contentType, body: res.body, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  return page;
}
const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).then(() => true, () => false);
const idle = page => waitFor(page, () => !/しています…|読み込んでいます…/.test((document.querySelector('.score-bar') || {}).textContent || ''));
const setDate = async (page, value) => { await page.fill('#practiceDate', value); await page.dispatchEvent('#practiceDate', 'change'); };
const row = (page, k) => page.locator(`.score-row[data-key="${k}"]`);
async function enter(page, k, a, b) {
  const inputs = row(page, k).locator('input');
  await inputs.nth(0).fill(String(a)); await inputs.nth(1).fill(String(b));
  await row(page, k).locator('button.save').click();
  return waitFor(page, ([key, x, y]) => new RegExp(`${x} - ${y} ✓`).test((document.querySelector(`.score-row[data-key="${key}"]`) || {}).textContent || ''), [k, a, b]);
}
async function share(page) {
  const before = await page.evaluate(() => window.__copied.length);
  await page.getByRole('button', { name: '対戦表のリンクを共有' }).click();
  await waitFor(page, n => window.__copied.length > n, before);
  return page.evaluate(() => window.__copied[window.__copied.length - 1]);
}

(async () => {
  // 共有リンクは http(s) のページでだけ作れるので、手元でも小さなサーバーで配る
  let server = null, url = process.env.AUDIT_BASE_URL ? new URL('singles.html', process.env.AUDIT_BASE_URL).href : '';
  if (!url) {
    server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dirname, 'singles.html'))); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/singles.html`;
  }
  const browser = await chromium.launch(launchOptions());
  try {
    const host = await openPage(browser);
    await host.goto(url);
    await host.evaluate(() => localStorage.clear());
    await host.reload();

    console.log('[1] 大会の練習期間でない日も「点数を記録する」は最初からオン');
    await host.selectOption('#mode', 'pairs');
    await setDate(host, '2026-12-20');
    await host.selectOption('#courtCount', '2');
    for (const nm of ['大野', 'バレ', '北原', '原', '越野', '善志', '内田', '根津真']) await host.click(`#rosterChips button[data-name="${nm}"]`);
    check('練習期間でない日でもオン', await host.isVisible('#scoringRow') && await host.isChecked('#scoring'));
    check('説明に「練習日ごとの記録」', /練習日ごとの記録/.test(await host.textContent('#scoringRow')));

    console.log('[2] 登録できないうちは長いリンク、登録できたら短いリンク');
    blocked.add('register');
    await host.click('#generateBtn');
    check('登録の失敗を知らせる', await waitFor(host, () => /スプシに登録できませんでした/.test(document.querySelector('.score-bar').textContent)));
    const long = await share(host);
    check('登録できていないので従来の長いリンク', long.includes('#sp1=') && long.length > 1000, long.length);
    check('長いリンクにした理由を出す', /長いリンクにしました/.test(await host.textContent('#status')), await host.textContent('#status'));
    blocked.delete('register');
    await host.click('text=もう一度登録する');
    await idle(host);
    const sid = await host.evaluate(() => session.scoreId);
    const short = await share(host);
    check('登録できたら「#t=表ID」だけの短いリンク', short === url + '#t=' + sid, short);
    check('短いリンクは120文字以内（長いリンクは' + long.length + '文字）', short.length <= 120, short.length);

    console.log('[3] 短いリンクを開いた人：表と点数をスプシから読む・入力できる');
    check('幹事が点数を入れる', await enter(host, '1A', 21, 17));
    const viewer = await openPage(browser);
    await viewer.goto(url);
    await viewer.evaluate(() => localStorage.setItem('badminton-singles-pairs-session-v1', 'viewer-own-data'));
    await viewer.goto(short);
    check('対戦表が出る（10節・閲覧用）', await waitFor(viewer, () => document.querySelectorAll('.round-card').length === 10 && /閲覧用/.test(document.querySelector('#summary h2').textContent)));
    check('「共有された対戦表です」', /共有された対戦表/.test(await viewer.textContent('#status')));
    check('名前と入力済みの点数が出る', await waitFor(viewer, () => /21 - 17 ✓/.test((document.querySelector('.score-row[data-key="1A"]') || {}).textContent || '')
      && /大野・バレ/.test(document.querySelector('#results').textContent))); // 練習期間でないので大会ペアは無く、タップ順のペア
    check('入力欄・作り直しは出ない', await viewer.isHidden('#setup') && await viewer.isHidden('#changePanel'));
    check('開いた人の保存データを上書きしない', await viewer.evaluate(() => localStorage.getItem('badminton-singles-pairs-session-v1')) === 'viewer-own-data');
    check('開いた人が点数を入れられる', await enter(viewer, '1B', 15, 21));
    await host.click('text=🔄 最新の点数');
    check('幹事の画面にも出る', await waitFor(host, () => /15 - 21 ✓/.test(document.querySelector('.score-row[data-key="1B"]').textContent)));
    check('開いた人が送り直すリンクも短い', (await share(viewer)) === short);
    const encoded = await openPage(browser);
    await encoded.goto(url + '#t%3D' + sid);
    check('「=」が %3D に変わったリンクも開ける', await waitFor(encoded, () => document.querySelectorAll('.round-card').length === 10));

    console.log('[4] 開けないとき');
    const bad = await openPage(browser);
    await bad.goto(url + '#t=abc');
    check('壊れたリンク', await waitFor(bad, () => /途中で切れているか、壊れています/.test(document.querySelector('#status').textContent)) && await bad.locator('.round-card').count() === 0);
    await bad.goto(url + '#t=Unknown00000000000000');
    check('スプシに無い表', await waitFor(bad, () => /スプシに見つかりません/.test(document.querySelector('#status').textContent)));
    blocked.add('get');
    await bad.goto(url + '#t=' + sid);
    check('通信できなければ「もう一度読み込む」', await waitFor(bad, () => /電波の良い所/.test(document.querySelector('#status').textContent)) && await bad.locator('#status button').count() === 1);
    check('「自分の対戦表に戻る」も出る', await bad.locator('#status a', { hasText: '自分の対戦表に戻る' }).count() === 1);
    blocked.delete('get');
    await bad.click('#status button');
    check('もう一度読み込むと開ける', await waitFor(bad, () => document.querySelectorAll('.round-card').length === 10));

    console.log('[5] 途中から来た人に名簿から名前を付ける');
    await host.click('#changePanel summary');
    check('名簿のチップ（表にいる人は出ない）', await host.isVisible('#joinBox')
      && await host.locator('#joinChips button[data-name="上條"]').count() === 1 && await host.locator('#joinChips button[data-name="バレ"]').count() === 0);
    await host.click('#joinChips button[data-name="上條"]');
    check('1人だとペア待ち', /5番ペア：上條・（あと1人）/.test(await host.textContent('#joinPreview')));
    await host.selectOption('#consumedRound', '2');
    await host.click('#changeBtn');
    check('1人のままでは作り直さない', /2人ずつ選んでください/.test(await host.textContent('#status')) && await host.evaluate(() => session.players.length) === 4);
    await host.click('#joinChips button[data-name="細井"]');
    check('空いている番号（5番）', /5番ペア：上條・細井/.test(await host.textContent('#joinPreview')), await host.textContent('#joinPreview'));
    check('チップにもその番号', await host.textContent('#joinChips button[data-name="細井"] .order') === '5');
    await host.check('#memberChips input[value="5"]');
    check('番号のみの5番にチェックすると、名前のペアは6番', /6番ペア：上條・細井/.test(await host.textContent('#joinPreview')));
    await host.uncheck('#memberChips input[value="5"]');
    await host.click('#changeBtn');
    check('作り直すと5番ペアに名前が付く', await waitFor(host, () => JSON.stringify(session.names[5]) === '["上條","細井"]' && session.players.join() === '1,2,3,4,5'));
    check('対戦表に名前で出る', await waitFor(host, () => /上條・細井/.test(document.querySelector('#results').textContent)));
    check('途中参加の欄は空に戻り、上條・細井は名簿のチップから消える', await host.locator('#joinChips button.selected').count() === 0 && await host.locator('#joinChips button[data-name="上條"]').count() === 0);
    await idle(host);
    check('スプシの試合に名前で登録（9番ペアのような番号だけにならない）', rows('試合').some(r => r[1] === sid && r[11] !== '作り直し前' && [r[4], r[5], r[6], r[7]].includes('上條'))
      && !rows('試合').some(r => r[1] === sid && /番ペア/.test([r[4], r[6]].join())));
    const shortAfter = await share(host);
    check('作り直しても短いリンクのまま', shortAfter === short);
    await viewer.click('text=🔄 最新の点数');
    check('短いリンクの人の表も最新になる', await waitFor(viewer, () => /上條・細井/.test(document.querySelector('#results').textContent)));
    // 第3節以降で上條・細井の試合に点数を入れる
    const k = await host.evaluate(() => { const r = session.rounds.find(x => x.round >= 3 && x.matches.some(m => m.includes(5))); return r.round + 'ABCD'[r.matches.findIndex(m => m.includes(5))]; });
    check('途中参加のペアの試合に点数を入れる', await enter(host, k, 21, 12));

    console.log('[6] スプシの練習日シート');
    admin('view'); // 後回しにした計算を片付ける（実際は次の保存・30秒ごとの読み込み・スプシを開いたとき）
    const day = gas.book.getSheetByName('練習日');
    const lines = day.getRange(1, 1, day.getLastRow(), 8).getValues().map(r => r.map(String).join('|').replace(/\|+$/, ''));
    check('その日が選ばれている', lines[0] === '練習日|2026/12/20 (日)', lines[0]);
    check('出席者は10人（途中参加の2人を含む）', /^出席 10人・/.test(lines[1]), lines[1]);
    check('途中参加の人は出た節が第3節から', lines.some(l => /^上條\|第\d+節|^上條\|第\d+〜\d+節/.test(l) && !/^上條\|第[12]/.test(l)), lines.filter(l => /^上條/.test(l)));
    check('対戦表と点数（幹事・開いた人・途中参加の試合）', lines.some(l => /^第1節 A\|.*\|21\|17\|/.test(l)) && lines.some(l => /^第1節 B\|.*\|15\|21\|/.test(l)) && lines.some(l => /上條・細井/.test(l) && /\|21\|12\||\|12\|21\|/.test(l)));
    const dateTab = gas.book.getSheetByName('点数メモ 2026-12-20');
    check('日付ごとの点数メモタブも自動で作る', !!dateTab);
    check('日別タブに幹事・共有先・途中参加の記録がそろう', !!dateTab && JSON.stringify(dateTab.getRange(1, 1, dateTab.getLastRow(), 8).getValues()) === JSON.stringify(day.getRange(1, 1, day.getLastRow(), 8).getValues()));

    console.log('[7] 記録をオフにした表は長いリンク');
    await host.uncheck('#scoringNow');
    await idle(host);
    const offLink = await share(host);
    check('オフの表は長いリンク（理由の表示もなし）', offLink.includes('#sp1=') && !/長いリンク/.test(await host.textContent('#status')));
    check('ページのエラーなし', errors.length === 0, errors);
    check('375px で横にはみ出さない', await host.evaluate(() => document.documentElement.scrollWidth <= 375));
  } catch (e) {
    fail++; console.log('  NG  例外: ' + (e.stack || e.message));
  } finally {
    await browser.close();
    if (server) server.close();
  }
  console.log(`\n練習日ごとの記録・短い共有リンクの画面テスト: ${pass}項目合格 / ${fail}項目失敗`);
  if (fail) process.exitCode = 1;
})();
