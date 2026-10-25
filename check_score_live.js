// 本番の固定ペア版（GitHub Pages）→ 本物のスプシ（GAS）まで、点数の登録・入力を通しで確かめる（2026-10-24追加）
// 2026-10-25：短い共有リンク（#t=表ID）で開く・練習日シートに出る、も確かめる
// 本物のスプシに書き込むので、架空の練習日（2000-01-15・どの大会の練習期間でもない）で表を作り、最後に消す。
// 片付けに管理用の鍵（gas/secret.js）を使うため、ユーザーが `! node check_score_live.js` で実行する
const { chromium, launchOptions } = require('./pw');
const { admin } = require('./gas_admin');

const PAGE = 'https://sasukewebjob-ai.github.io/badminton-doubles-court/singles.html';
const DATE = '2000-01-15';
let ok = 0, ng = 0;
const check = (label, pass, detail) => {
  if (pass) { ok++; console.log('  OK  ' + label); }
  else { ng++; console.log('  NG  ' + label + (detail === undefined ? '' : ' → ' + JSON.stringify(detail))); }
};

(async () => {
  const browser = await chromium.launch(launchOptions());
  let sid = null, keepDay = null;
  try {
    const open = async () => {
      const context = await browser.newContext({ viewport: { width: 375, height: 800 }, timezoneId: 'Asia/Tokyo' });
      await context.unroute('https://script.google.com/**'); // pw.js が止めている本物の窓口を、この確認だけ通す
      const page = await context.newPage();
      page.on('dialog', d => d.accept());
      return page;
    };
    const wait = (page, fn) => page.waitForFunction(fn, null, { timeout: 60000 }).then(() => true, () => false);
    const host = await open();
    await host.goto(PAGE + '?v=' + Date.now());
    await host.evaluate(() => localStorage.clear());
    await host.reload();
    await host.selectOption('#mode', 'pairs');
    await host.fill('#practiceDate', DATE); await host.dispatchEvent('#practiceDate', 'change');
    await host.selectOption('#courtCount', '1');
    for (const nm of ['大野', '北原', '越野', '善志']) await host.click(`#rosterChips button[data-name="${nm}"]`);
    // 練習日ごとの記録を残すため、練習期間でない日も最初からオン（2026-10-25）
    check('練習期間でない日も「点数を記録する」はオンで始まる', await host.isChecked('#scoring'));
    await host.click('#generateBtn');
    check('点数欄が出る（1コート×10節）', await wait(host, () => document.querySelectorAll('.score-row').length === 10));
    sid = await host.evaluate(() => session.scoreId);
    check('本物のスプシに登録できる', await wait(host, () => /点数 0試合入力済み/.test(document.querySelector('.score-bar').textContent)),
      await host.textContent('.score-bar'));
    const row = host.locator('.score-row[data-key="1A"]');
    await row.locator('input').nth(0).fill('21'); await row.locator('input').nth(1).fill('15');
    await row.locator('button.save').click();
    check('点数を保存できる（21 - 15 ✓）', await wait(host, () => /21 - 15 ✓/.test(document.querySelector('.score-row[data-key="1A"]').textContent)),
      await row.textContent());
    check('共有リンクは短い（#t=表ID）', await host.evaluate(() => shortLinkReady()));
    const viewer = await open();
    await viewer.goto(PAGE + '?v=' + Date.now() + '#t=' + sid);
    check('短い共有リンクを開いた人にも、本物のスプシから表と点数が出る', await wait(viewer, () => /21 - 15 ✓/.test((document.querySelector('.score-row[data-key="1A"]') || {}).textContent || '')));
    const sheet = await admin('dump', { sheets: ['試合'], limit: 5000 });
    const mine = sheet.sheets['試合'].filter(r => r[1] === sid);
    const first = mine.find(r => r[2] === '1' && r[3] === 'A');
    check('スプシの試合シートに10試合と点数（21-15・入力済み）', mine.length === 10 && first && first[8] === '21' && first[9] === '15' && first[10] === '入力済み', first);
    keepDay = (await admin('day', {})).values[0][1];
    const day = (await admin('day', { date: DATE })).values.map(r => r.join('|').replace(/\|+$/, ''));
    check('練習日シートにその日の出席者・対戦表と点数', day[1] === '出席 4人・試合 1（点数あり 1）' && day.some(l => /^第1節 A\|大野・北原\|21\|15\|越野・善志/.test(l)), day.slice(0, 3));
  } catch (e) {
    ng++; console.log('  NG  例外: ' + (e.stack || e.message));
  } finally {
    if (sid) {
      const r = await admin('deleteRows', { sids: [sid] });
      console.log('後片付け', JSON.stringify(r.removed));
      if (keepDay !== null) await admin('day', { date: keepDay }); // 練習日シートで選んでいた日に戻す
    }
    await browser.close();
  }
  console.log(ng ? `本番の通し確認 ${ng}項目NG` : `本番の通し確認 ${ok}項目 全合格`);
  if (ng) process.exitCode = 1;
})();
