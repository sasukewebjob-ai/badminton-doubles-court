// 固定ペア版の大会練習の点数（2026-10-24追加）の画面テスト（Playwright、375px幅）
// 本物の GAS（gas/core.js・gas/main.js）を gas_mock.js で動かし、公開Webアプリの代わりに応答させる
// （ページには window.SCORE_API_URL で偽の窓口 gas.test を渡す。本物のスプシには書き込まない）。
// 手元: node test_singles_score_browser.js
// 本番: AUDIT_BASE_URL=https://sasukewebjob-ai.github.io/badminton-doubles-court/ node test_singles_score_browser.js
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const { makeContext, webApp } = require('./gas_mock');

const baseUrl = process.env.AUDIT_BASE_URL;
const url = baseUrl ? new URL('singles.html', baseUrl).href : pathToFileURL(path.join(__dirname, 'singles.html')).href;
const API = 'https://gas.test/exec';

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail !== undefined ? ' → ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
}

// ---------- 偽の窓口（本物の GAS のコード） ----------
const gas = makeContext();
const serve = webApp(gas);
const admin = (op, extra = {}) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify({ action: 'admin', key: gas.ADMIN_KEY, op, ...extra }) } }).content);
const rows = name => { const sh = gas.book.getSheetByName(name), n = sh.getLastRow(); return n < 2 ? [] : sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues(); };
admin('setup', {
  roster: ['大野', 'バレ', '北原', '原', '越野', '善志', '内田', '根津真', '上條'],
  tournaments: [{ name: '岡谷連盟杯', date: '2026-11-03' }, { name: '伊那市長杯', date: '2026-11-29' }],
  pairs: [['男子A', 'バレ', '原'], ['男子B', '越野', '善志'], ['男子B', '北原', '上條'], ['女子A', '内田', '根津真']]
    .map(([category, a, b]) => ({ tournament: '岡谷連盟杯', category, names: [a, b] })),
});
const log = [];
const blocked = new Set(); // ここに入れた操作は通信できないことにする
const count = action => log.filter(x => x.action === action).length;

async function openPage(browser) {
  const context = await browser.newContext({ viewport: { width: 375, height: 800 }, timezoneId: 'Asia/Tokyo' });
  await context.addInitScript(api => { window.SCORE_API_URL = api; }, API);
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
const errors = [];
const row = (page, k) => page.locator(`.score-row[data-key="${k}"]`);
const rowText = (page, k) => row(page, k).textContent();
async function enter(page, k, a, b) {
  const inputs = row(page, k).locator('input');
  await inputs.nth(0).fill(String(a)); await inputs.nth(1).fill(String(b));
  await row(page, k).locator('button.save').click();
}
const waitFor = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 10000 }).then(() => true, () => false);
const idle = page => waitFor(page, () => !/しています…|読み込んでいます…/.test((document.querySelector('.score-bar') || {}).textContent || ''));
const setDate = async (page, value) => { await page.fill('#practiceDate', value); await page.dispatchEvent('#practiceDate', 'change'); };
const tap = (page, nm) => page.click(`#rosterChips button[data-name="${nm}"]`);

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const host = await openPage(browser);
    await host.goto(url);
    await host.evaluate(() => localStorage.clear());
    await host.reload();

    console.log('[1] 作成前：練習期間の大会と大会ペア、自動のペア、点数を記録するの初期値');
    await host.selectOption('#mode', 'pairs');
    await setDate(host, '2026-10-25');
    check('練習期間の大会と大会ペアが出る', await waitFor(host, () => /岡谷連盟杯の練習期間（10\/18〜11\/2）/.test(document.querySelector('#tourBox').textContent)),
      await host.textContent('#tourBox'));
    check('メンバーを選ぶまで「点数を記録する」は出ない', await host.isHidden('#scoringRow'));
    await host.selectOption('#courtCount', '2');
    for (const nm of ['大野', 'バレ', '北原', '原', '越野', '善志', '内田', '根津真']) await tap(host, nm);
    const preview = await host.$$eval('#pairPreview li', lis => lis.map(li => li.textContent.replace(/\s+/g, '')));
    check('大会ペアは自動、残りはタップ順の臨時ペア', JSON.stringify(preview) === JSON.stringify(['1番ペア：大野・北原（臨時）', '2番ペア：バレ・原（🏆男子A）', '3番ペア：越野・善志（🏆男子B）', '4番ペア：内田・根津真（🏆女子A）']), preview);
    check('名簿のチップの番号もペア番号', await host.textContent('#rosterChips button[data-name="原"] .order') === '2');
    check('そろった大会ペアに✓（相方が来ていない北原・上條には付かない）', JSON.stringify(await host.$$eval('#tourBox li.formed', lis => lis.map(li => li.textContent))) === JSON.stringify(['男子A バレ・原 ✓', '男子B 越野・善志 ✓', '女子A 内田・根津真 ✓']));
    check('練習期間なので「点数を記録する」は最初からオン', await host.isVisible('#scoringRow') && await host.isChecked('#scoring'));

    console.log('[2] 作成するとスプシに登録され、各試合に点数欄が出る');
    await host.click('#generateBtn');
    check('点数欄が全試合ぶん（2コート×10節）', await waitFor(host, () => document.querySelectorAll('.score-row').length === 20));
    await idle(host);
    check('スプシの試合シートに20試合・練習日 10/25', rows('試合').length === 20 && rows('試合').every(r => r[0].getDate() === 25), rows('試合').length);
    check('ペアの名前で登録（大会ペアも臨時ペアも）', rows('試合').some(r => [r[4], r[5]].join() === 'バレ,原' || [r[6], r[7]].join() === 'バレ,原')
      && rows('試合').some(r => [r[4], r[5]].join() === '大野,北原' || [r[6], r[7]].join() === '大野,北原'));
    check('名簿シートにアプリの名簿が入る', rows('名簿').some(r => r[0] === '濱島'));
    check('表を読むURLは id（Googleの予約語 sid を使わない）', log.filter(x => x.method === 'GET' && x.action === 'get').length > 0 && !log.some(x => /[?&]sid=/.test(x.url)));
    check('iPhoneで入力時に拡大されない文字の大きさ（16px）', await row(host, '1A').locator('input').first().evaluate(e => getComputedStyle(e).fontSize) === '16px');

    console.log('[3] 点数の入力・入力ミス・直す');
    await enter(host, '1A', 21, 18);
    check('保存すると「21 - 18 ✓」', await waitFor(host, () => /21 - 18 ✓/.test(document.querySelector('.score-row[data-key="1A"]').textContent)));
    const r1a = rows('試合').find(r => r[2] === 1 && r[3] === 'A');
    check('スプシに点数と「入力済み」', r1a && r1a[8] === 21 && r1a[9] === 18 && r1a[10] === '入力済み', r1a && r1a.slice(8, 11));
    const m1a = await host.evaluate(() => session.rounds[0].matches[0].map(p => session.names[p].join('・')));
    // 続けて保存すると成績の計算は後回しになる（2026-10-25）。確認（view）で計算待ちを片付けてから読む
    const stat = label => { admin('view'); return rows('ペア成績').find(r => r[0] === '岡谷連盟杯' && r[2] === label); };
    const tourSide = m1a.find(l => l !== '大野・北原');
    check('大会ペアの成績に入る（臨時ペアは入らない）', stat(tourSide) && stat(tourSide)[3] === 1 && !stat('大野・北原'), m1a);
    const posts = count('score');
    for (const [a, b, msg] of [[21, 21, '同点は保存できません。'], [31, 2, '点数は0〜30の数字で入れてください。'], ['', '', '点数を入れてください。'], ['a', 3, '点数は0〜30の数字で入れてください。']]) {
      await enter(host, '1B', a, b);
      check(`入力ミスは送らずに知らせる（${a}-${b}）`, (await rowText(host, '1B')).includes(msg), await rowText(host, '1B'));
    }
    check('入力ミスでは通信しない', count('score') === posts);
    await row(host, '1A').locator('button', { hasText: '直す' }).click();
    check('「直す」で今の点数が入った欄になる', await row(host, '1A').locator('input').first().inputValue() === '21');
    await enter(host, '1A', 21, 19);
    check('直した点数になる', await waitFor(host, () => /21 - 19 ✓/.test(document.querySelector('.score-row[data-key="1A"]').textContent)));
    check('記録シートに入力と訂正', rows('記録').filter(r => r[2] === 1 && r[3] === 'A' && r[4] === '入力').length === 2);
    await row(host, '2A').locator('input').nth(0).fill('２１'); await row(host, '2A').locator('input').nth(1).fill('９');
    await row(host, '2A').locator('button.save').click();
    check('全角の数字でも入る', await waitFor(host, () => /21 - 9 ✓/.test(document.querySelector('.score-row[data-key="2A"]').textContent)));
    check('375px で横にはみ出さない', await host.evaluate(() => document.documentElement.scrollWidth <= 375));

    console.log('[4] 共有リンクを開いた人も点数を見られ・入れられる');
    const hash = await host.evaluate(() => SHARE_PREFIX + encodeShare(session));
    const viewer = await openPage(browser);
    await viewer.goto(url + hash);
    check('閲覧者にも点数欄と入力済みの点数', await waitFor(viewer, () => document.querySelectorAll('.score-row').length === 20 && /21 - 19 ✓/.test(document.querySelector('.score-row[data-key="1A"]').textContent)));
    check('閲覧者には「点数を記録する」の切り替えがない', await viewer.locator('#scoringNow').count() === 0);
    await enter(viewer, '1B', 15, 21);
    check('閲覧者が入れた点数が保存される', await waitFor(viewer, () => /15 - 21 ✓/.test(document.querySelector('.score-row[data-key="1B"]').textContent)));
    await host.click('text=🔄 最新の点数');
    check('幹事の画面も🔄で最新になる', await waitFor(host, () => /15 - 21 ✓/.test(document.querySelector('.score-row[data-key="1B"]').textContent)));

    console.log('[5] 途中変更（作り直し）と練習日の変更');
    await host.click('#changePanel summary');
    await host.selectOption('#consumedRound', '2');
    await host.uncheck('#memberChips input[value="4"]');
    await host.selectOption('#changeCourts', '1');
    await host.click('#changeBtn');
    check('作り直した表の点数欄（2節×2＋8節×1）', await waitFor(host, () => document.querySelectorAll('.score-row').length === 12));
    await idle(host);
    check('スプシの表の版が2になる', rows('対戦表')[0][4] === 2, rows('対戦表')[0][4]);
    check('終わった節の点数はそのまま', /21 - 19 ✓/.test(await rowText(host, '1A')) && /15 - 21 ✓/.test(await rowText(host, '1B')));
    check('スプシの今の試合は12（組み直した試合は「作り直し前」）', rows('試合').filter(r => r[11] !== '作り直し前').length === 12);
    await viewer.click('text=🔄 最新の点数');
    check('閲覧者の表も最新になる', await waitFor(viewer, () => document.querySelectorAll('.score-row').length === 12 && /最新の表/.test(document.querySelector('#status').textContent)));
    await setDate(host, '2026-10-26');
    await waitFor(host, () => document.querySelectorAll('.score-row').length === 12);
    await idle(host);
    check('練習日を直すとスプシの日付も直る', rows('試合').every(r => r[0].getDate() === 26) && rows('対戦表')[0][4] === 3, { days: [...new Set(rows('試合').map(r => r[0].getDate()))], version: rows('対戦表')[0][4], registers: count('register') });

    console.log('[6] 通信できないとき');
    blocked.add('score');
    await enter(host, '2B', 21, 10);
    check('送信できなかったと知らせる', await waitFor(host, () => /送信できませんでした/.test(document.querySelector('.score-row[data-key="2B"]').textContent)));
    check('入れた点数は欄に残る', await row(host, '2B').locator('input').first().inputValue() === '21');
    blocked.delete('score');
    await row(host, '2B').locator('button.save').click();
    check('つながったら同じ欄から保存できる', await waitFor(host, () => /21 - 10 ✓/.test(document.querySelector('.score-row[data-key="2B"]').textContent)));

    console.log('[7] 「点数を記録する」を作った後で切り替える');
    const regs = count('register');
    await host.uncheck('#scoringNow');
    check('オフにすると点数欄が消える', await waitFor(host, () => document.querySelectorAll('.score-row').length === 0));
    await idle(host);
    check('オフを共有リンクの人に伝えるため1回だけ登録', count('register') === regs + 1);
    await viewer.click('text=🔄 最新の点数');
    check('閲覧者の点数欄も消える', await waitFor(viewer, () => document.querySelectorAll('.score-row').length === 0 && !document.querySelector('.score-bar')));
    await setDate(host, '2026-10-27');
    await host.waitForTimeout(500);
    check('オフの間は練習日を直しても送らない', count('register') === regs + 1);
    await host.check('#scoringNow');
    check('オンに戻すと点数欄と入力済みの点数が戻る', await waitFor(host, () => document.querySelectorAll('.score-row').length === 12 && /21 - 19 ✓/.test(document.querySelector('.score-row[data-key="1A"]').textContent)));
    check('オンに戻すと登録し直す（日付も新しく）', rows('試合').every(r => r[0].getDate() === 27));

    console.log('[8] 再読み込み');
    const regs2 = count('register');
    await host.reload();
    check('再読み込みしても点数が出る', await waitFor(host, () => /21 - 19 ✓/.test((document.querySelector('.score-row[data-key="1A"]') || {}).textContent || '')));
    check('登録済みの表は登録し直さない', count('register') === regs2);

    console.log('[9] 大会の情報が読めないとき・練習期間でない日');
    const other = await openPage(browser);
    await other.goto(url);
    await other.evaluate(() => localStorage.clear());
    blocked.add('tournaments');
    await other.reload();
    await other.selectOption('#mode', 'pairs');
    await setDate(other, '2026-10-28');
    check('読めないと知らせ、もう一度読み込める', await waitFor(other, () => /読み込めませんでした/.test(document.querySelector('#tourBox').textContent)));
    blocked.delete('tournaments');
    await other.click('#tourBox button');
    check('もう一度読み込むと大会ペアが出る', await waitFor(other, () => /岡谷連盟杯の練習期間/.test(document.querySelector('#tourBox').textContent)));
    await setDate(other, '2026-12-20');
    check('練習期間でない日は大会の欄を出さない', await waitFor(other, () => document.querySelector('#tourBox').hidden));
    await other.selectOption('#courtCount', '1');
    for (const nm of ['バレ', '原', '越野', '善志']) await tap(other, nm);
    // 練習日ごとの記録を残すため、練習期間でない日も最初からオン（2026-10-25）
    check('練習期間でない日も「点数を記録する」は最初からオン', await other.isVisible('#scoringRow') && await other.isChecked('#scoring'));
    await other.uncheck('#scoring');
    const regs3 = count('register');
    await other.click('#generateBtn');
    await other.waitForSelector('.round-card');
    await other.waitForTimeout(500);
    check('オフで作るとスプシに送らず、点数欄もない', count('register') === regs3 && await other.locator('.score-row').count() === 0);
    await other.check('#scoringNow');
    check('作った後でオンにすると登録して点数欄が出る', await waitFor(other, () => document.querySelectorAll('.score-row').length === 10));
    await idle(other);
    check('スプシに12/20の表が加わる', rows('対戦表').length === 2 && rows('試合').some(r => r[0].getMonth() === 11 && r[0].getDate() === 20));

    console.log('[10] 名簿を使わない・シングルスでは点数の機能を出さない');
    await other.selectOption('#mode', 'singles');
    check('シングルスでは大会の欄も「点数を記録する」も出ない', await other.isHidden('#tourBox') && await other.isHidden('#scoringRow'));
    check('ページのエラーなし', errors.length === 0, errors);
  } catch (e) {
    fail++; console.log('  NG  例外: ' + (e.stack || e.message));
  } finally {
    await browser.close();
  }
  console.log(`\n固定ペア版の点数の画面テスト: ${pass}項目合格 / ${fail}項目失敗`);
  if (fail) process.exitCode = 1;
})();
