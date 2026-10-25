// 共有リンクを開いた8人が、それぞれ別の試合の点数を同時に保存しても、本物のスプシに全部入るかを確かめる（2026-10-25追加）
// 本番の固定ペア版（GitHub Pages）→ 本物のスプシ（GAS）。架空の練習日（2000-01-16・どの大会の練習期間でもない）で
// 4コート・8ペアの表を作り、最後に消す。確かめること:
//   [1] 1人だけで保存したときの時間（比べる基準）
//   [2] 8人が別々の試合を同時に保存 → 全件がスプシに入るか・何秒かかるか・「混み合っています」が出るか
//   [3] 2人が同じ試合を同時に保存 → どちらが残るか・記録シートに両方残るか
//   [4] スプシの中身 ／ [5] 幹事と共有リンクの人の画面に、全員の点数が出るか
// 片付けに管理用の鍵（gas/secret.js）を使うため、ユーザーが `! node check_score_concurrent.js` で実行する
// 手元の確認（本物には送らない。gas_mock.js の偽の窓口で手順だけ確かめる）: node check_score_concurrent.js --mock
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');

const MOCK = process.argv.includes('--mock');
const PAGE = MOCK ? pathToFileURL(path.join(__dirname, 'singles.html')).href
  : 'https://sasukewebjob-ai.github.io/badminton-doubles-court/singles.html';
const DATE = '2000-01-16';
const PEOPLE = 8;
const COURTS = ['A', 'B', 'C', 'D'];
let ok = 0, ng = 0;
const check = (label, pass, detail) => {
  if (pass) { ok++; console.log('  OK  ' + label); }
  else { ng++; console.log('  NG  ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail))); }
};
const sec = ms => (ms / 1000).toFixed(1) + '秒';

// ---------- 窓口（本番は本物の GAS、--mock は gas_mock.js） ----------
let admin, useApi;
if (MOCK) {
  const { makeContext, webApp } = require('./gas_mock');
  const gas = makeContext(), serve = webApp(gas), API = 'https://gas.test/exec';
  admin = async (op, extra = {}) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify({ action: 'admin', key: gas.ADMIN_KEY, op, ...extra }) } }).content);
  let busyOnce = true; // 押し直しの手順も確かめるため、2節目の保存を1回だけ「混み合っています」にする
  useApi = async context => {
    await context.addInitScript(api => { window.SCORE_API_URL = api; }, API);
    await context.route(API + '**', async route => {
      const req = route.request(), body = req.postData() || '';
      // 本物のように保存に時間がかかり、8人の通信が重なるようにする
      if (req.method() === 'POST') await new Promise(r => setTimeout(r, 300 + Math.random() * 300));
      let res;
      if (busyOnce && /"action":"score"/.test(body) && /"round":2,/.test(body)) {
        busyOnce = false;
        res = { status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: '混み合っています。少し待ってからもう一度試してください。', code: 'busy' }) };
      } else res = serve({ method: req.method(), url: req.url(), body });
      await route.fulfill({ status: res.status, contentType: res.contentType, body: res.body, headers: { 'Access-Control-Allow-Origin': '*' } });
    });
  };
} else {
  admin = require('./gas_admin').admin;
  useApi = context => context.unroute('https://script.google.com/**'); // pw.js が止めている本物の窓口を、この確認だけ通す
}

const rowSel = k => `.score-row[data-key="${k}"]`;
async function fillScore(page, k, a, b) {
  const inputs = page.locator(rowSel(k) + ' input');
  await inputs.nth(0).fill(String(a)); await inputs.nth(1).fill(String(b));
}
// 「保存」を押し、✓ かエラーが出るまでの時間を測る。混み合い・通信エラーは人と同じように1秒おいて押し直す（3回まで）
async function save(page, k, a, b) {
  const start = Date.now(), tries = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t = Date.now();
    await page.click(rowSel(k) + ' button.save');
    const r = await page.waitForFunction(([sel, want]) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const err = el.querySelector('.score-error');
      if (err) return { error: err.textContent };
      const saved = el.querySelector('.score-saved');
      return saved && saved.textContent === want ? { ok: true } : null;
    }, [rowSel(k), `${a} - ${b} ✓`], { timeout: 90000, polling: 100 }).then(h => h.jsonValue(), () => ({ error: '90秒待っても結果が出ない' }));
    tries.push({ ms: Date.now() - t, error: r.error || '' });
    if (r.ok) return { ok: true, ms: Date.now() - start, tries };
    if (!/混み合って|送信できませんでした|確かめられませんでした/.test(r.error)) break;
    await new Promise(done => setTimeout(done, 1000));
  }
  return { ok: false, ms: Date.now() - start, tries };
}
const describe = r => (r.ok ? '保存' : '失敗') + ' ' + sec(r.ms) +
  (r.tries.length > 1 || !r.ok ? '（' + r.tries.map((t, i) => `${i + 1}回目 ${sec(t.ms)}${t.error ? '「' + t.error + '」' : ' ✓'}`).join(' → ') + '）' : '');
const savedTexts = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.score-row')]
  .map(el => [el.dataset.key, (el.querySelector('.score-saved') || {}).textContent || ''])));
const refresh = async (page, count) => {
  await page.click('.score-bar button:has-text("最新の点数")');
  return page.waitForFunction(n => new RegExp('点数 ' + n + '試合入力済み').test(document.querySelector('.score-bar').textContent), count, { timeout: 60000 })
    .then(() => true, () => false);
};

(async () => {
  const browser = await chromium.launch(launchOptions());
  const errors = [];
  let sid = null;
  try {
    if (MOCK) await admin('setup', {});
    const open = async hash => {
      const context = await browser.newContext({ viewport: { width: 375, height: 800 }, timezoneId: 'Asia/Tokyo' });
      await useApi(context);
      // 窓口が返すサーバー側の時間（took）と、「そのままお待ちください」が出たかを記録する
      await context.addInitScript(() => {
        window.__took = []; window.__sawWait = false;
        const real = window.fetch;
        window.fetch = async (...args) => {
          const res = await real(...args);
          res.clone().text().then(t => { try { const j = JSON.parse(t); if (j && j.took) window.__took.push(j.took); } catch (e) { /* JSONでない */ } }, () => {});
          return res;
        };
        setInterval(() => { if (document.querySelector('.score-wait')) window.__sawWait = true; }, 200);
      });
      const page = await context.newPage();
      page.on('dialog', d => d.accept());
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(PAGE + '?v=' + Date.now() + (hash || ''));
      return page;
    };
    const wait = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 }).then(() => true, () => false);

    console.log(`準備：幹事が4コート・8ペア・10節の表を作り、${PEOPLE}人が共有リンクを開く（${MOCK ? '偽の窓口' : '本物のスプシ'}）`);
    const host = await open();
    await host.evaluate(() => localStorage.clear());
    await host.reload();
    await host.selectOption('#mode', 'pairs');
    await host.fill('#practiceDate', DATE); await host.dispatchEvent('#practiceDate', 'change');
    await host.selectOption('#courtCount', '4');
    await host.selectOption('#roundCount', '10');
    const names = (await host.evaluate(() => [...document.querySelectorAll('#rosterChips button[data-name]')].map(b => b.dataset.name))).slice(0, 16);
    for (const nm of names) await host.click(`#rosterChips button[data-name="${nm}"]`);
    await host.check('#scoring');
    await host.click('#generateBtn');
    check('点数欄が出る（4コート×10節＝40試合）', await wait(host, () => document.querySelectorAll('.score-row').length === 40));
    sid = await host.evaluate(() => session.scoreId);
    check('スプシに登録できる', await wait(host, () => /点数 0試合入力済み/.test(document.querySelector('.score-bar').textContent)),
      await host.textContent('.score-bar'));
    const hash = await host.evaluate(() => SHARE_PREFIX + encodeShare(session));
    const viewers = await Promise.all(Array.from({ length: PEOPLE }, () => open(hash)));
    const ready = await Promise.all(viewers.map(v => wait(v, () => document.querySelectorAll('.score-row').length === 40 &&
      /点数 \d+試合入力済み/.test((document.querySelector('.score-bar') || {}).textContent || ''))));
    check(`${PEOPLE}人とも共有リンクで点数欄が出る`, ready.every(Boolean), ready);

    console.log('[1] 1人だけで保存（比べる基準）');
    await fillScore(viewers[0], '3A', 21, 9);
    const base = await save(viewers[0], '3A', 21, 9);
    console.log(`      第3節Aコート 21-9 … ${describe(base)}`);
    check('1人だけの保存ができる', base.ok);

    console.log(`[2] ${PEOPLE}人が別々の試合を同時に保存（第1・2節のA〜Dコート）`);
    const burst = viewers.map((page, i) => ({ page, round: 1 + Math.floor(i / 4), court: COURTS[i % 4], a: 21, b: 10 + i }))
      .map(x => ({ ...x, k: x.round + x.court }));
    for (const x of burst) await fillScore(x.page, x.k, x.a, x.b);
    await Promise.all(viewers.map(v => v.evaluate(() => { window.__took = []; window.__sawWait = false; })));
    const t0 = Date.now();
    const results = await Promise.all(burst.map(x => save(x.page, x.k, x.a, x.b)));
    const total = Date.now() - t0;
    const server = await Promise.all(viewers.map(v => v.evaluate(() => ({ took: window.__took, sawWait: window.__sawWait }))));
    results.forEach((r, i) => {
      const t = server[i].took.slice(-1)[0];
      const detail = t ? `／サーバー：順番待ち ${sec(t.wait)}・処理 ${sec(t.work)}（成績を${t.stats ? '計算' : '後回し'}）` : '';
      console.log(`      ${i + 1}人目 第${burst[i].round}節${burst[i].court}コート 21-${burst[i].b} … ${describe(r)}${detail}${server[i].sawWait ? '・「そのままお待ちください」が出た' : ''}`);
    });
    const retried = results.filter(r => r.tries.length > 1).length;
    console.log(`      → 全員の保存が終わるまで ${sec(total)}、押し直しが要った人 ${retried}人、「そのままお待ちください」が出た人 ${server.filter(s => s.sawWait).length}人`);
    check(`${PEOPLE}人とも画面で保存できた（押し直しを含む）`, results.every(r => r.ok));

    console.log('[3] 2人が同じ試合（第4節Aコート）に違う点数を同時に保存');
    await fillScore(viewers[0], '4A', 21, 5); await fillScore(viewers[1], '4A', 21, 7);
    const [c0, c1] = await Promise.all([save(viewers[0], '4A', 21, 5), save(viewers[1], '4A', 21, 7)]);
    console.log(`      1人目 21-5 … ${describe(c0)}`);
    console.log(`      2人目 21-7 … ${describe(c1)}`);
    check('2人とも画面では「保存」になる（警告は出ない）', c0.ok && c1.ok);

    console.log('[4] スプシの中身');
    const dump = await admin('dump', { sheets: ['試合', '記録'], limit: 100000 });
    const mine = dump.sheets['試合'].filter(r => r[1] === sid);
    const at = (round, court) => mine.find(r => r[2] === String(round) && r[3] === court);
    check('試合シートにこの表の40試合', mine.length === 40, mine.length);
    const lost = burst.filter(x => { const r = at(x.round, x.court); return !r || r[8] !== '21' || r[9] !== String(x.b) || r[10] !== '入力済み'; });
    check(`同時に保存した${PEOPLE}件がすべて正しい点数で入っている`, !lost.length, lost.map(x => x.k));
    const b3 = at(3, 'A');
    check('1人だけで保存した第3節Aも入っている', b3 && b3[8] === '21' && b3[9] === '9', b3);
    const touched = new Set([...burst.map(x => x.k), '3A', '4A']);
    const stray = mine.filter(r => !touched.has(r[2] + r[3]) && (r[8] !== '' || r[9] !== ''));
    check('ほかの30試合には何も入っていない（別の試合に紛れ込んでいない）', !stray.length, stray.map(r => r[2] + r[3]));
    const log = dump.sheets['記録'].filter(r => r[1] === sid && r[4] === '入力');
    const logOf = (round, court) => log.filter(r => r[2] === String(round) && r[3] === court);
    const noLog = burst.filter(x => !logOf(x.round, x.court).length);
    check(`記録シートに${PEOPLE}件それぞれの入力が残っている`, !noLog.length, noLog.map(x => x.k));
    const c4 = logOf(4, 'A'), last4 = c4[c4.length - 1], f4 = at(4, 'A');
    check('同じ試合の2人分が記録シートに2件残る', c4.length === 2, c4.map(r => r[5]));
    const winner = f4 ? f4[8] + '-' + f4[9] : '';
    check('試合シートには後から保存した方の点数が残る', last4 && last4[5].endsWith('→ ' + winner), { 試合: winner, 記録: c4.map(r => r[5]) });
    if (c4.length === 2) console.log(`      記録シート: 「${c4[0][5]}」→「${c4[1][5]}」＝ ${winner} が残った`);

    console.log('[5] 画面の表示（🔄 最新の点数）');
    const want = Object.fromEntries([...burst.map(x => [x.k, `21 - ${x.b} ✓`]), ['3A', '21 - 9 ✓'], ['4A', winner.replace('-', ' - ') + ' ✓']]);
    const same = got => Object.keys(want).every(k => got[k] === want[k]) && Object.keys(got).filter(k => got[k]).length === Object.keys(want).length;
    check('幹事の画面に10試合の点数が出る', await refresh(host, 10));
    const hostGot = await savedTexts(host);
    check('幹事の画面の点数がスプシと同じ', same(hostGot), hostGot);
    const outsiders = viewers.slice(2); // 同じ試合を入れていない人
    const refreshed = await Promise.all(outsiders.map(v => refresh(v, 10)));
    const viewersGot = await Promise.all(outsiders.map(savedTexts));
    check('共有リンクの人の画面にも、ほかの人が入れた点数が全部出る', refreshed.every(Boolean) && viewersGot.every(same), viewersGot.filter(g => !same(g)));
    const both = await Promise.all([viewers[0], viewers[1]].map(async v => (await refresh(v, 10)) && (await savedTexts(v))['4A']));
    check('同じ試合を入れた2人の画面も、🔄 で残った方の点数になる', both.every(t => t === want['4A']), both);

    check('ページでエラーが起きていない', !errors.length, errors);
    console.log('まとめ');
    console.log(`  1人だけ: ${sec(base.ms)} ／ ${PEOPLE}人同時: 早い人 ${sec(Math.min(...results.map(r => r.ms)))}・遅い人 ${sec(Math.max(...results.map(r => r.ms)))}・押し直し ${retried}人`);
  } catch (e) {
    ng++; console.log('  NG  例外: ' + (e.stack || e.message));
  } finally {
    if (sid) {
      const r = await admin('deleteRows', { sids: [sid] });
      console.log('後片付け', JSON.stringify(r.removed));
    }
    await browser.close();
  }
  console.log(ng ? `同時保存の確認 ${ng}項目NG` : `同時保存の確認 ${ok}項目 全合格`);
  if (ng) process.exitCode = 1;
})();
