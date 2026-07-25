// 26人対応（上限24→26拡張）のブラウザ検証（Playwright、375px幅・dpr3）
// 1. 人数セレクトが26人まで選べる
// 2. 4コート×26人×10節（番号のみモード）で生成→毎節休み10人・4コート
// 3. 休み差≤1・ペア重複なし
// 4. 375pxで横はみ出しなし
// 5. 画像保存：dpr=3でもCanvas面積がiOS上限の9割以内・プレビュー表示・alertなし
// 6. リロード復元
// 7. 26人からの追加は「上限は26人です」で拒否
// 8. 25人でも生成OK
const { chromium, launchOptions } = require('./pw');
const path = require('path');

const URL = process.argv[2] || 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  console.log('[1] 人数セレクトの上限');
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  const opts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#playerCount option')).map(o => o.value));
  check('4コートで16〜26人が選べる', opts[0] === '16' && opts[opts.length - 1] === '26' && opts.length === 11);

  console.log('[2] 4コート×26人×10節で生成');
  await page.selectOption('#playerCount', '26');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('10節が生成される', await page.locator('.round-card').count() === 10);

  const s = await page.evaluate(() => ({
    players: session.players.length,
    rounds: session.rounds.map(r => ({ courts: r.assignments.length, resting: r.resting.length })),
  }));
  check('参加者26人', s.players === 26);
  check('毎節4コート＋休み10人', s.rounds.every(r => r.courts === 4 && r.resting === 10));

  console.log('[3] 公平性（休み差≤1・ペア重複なし）');
  const fair = await page.evaluate(() => {
    const rest = {}, pairs = {};
    for (const p of session.players) rest[p] = 0;
    for (const r of session.rounds) {
      for (const p of r.resting) rest[p]++;
      for (const c of r.assignments) {
        for (const pr of [c.pair1, c.pair2]) {
          const k = [...pr].sort((a, b) => a - b).join('-');
          pairs[k] = (pairs[k] || 0) + 1;
        }
      }
    }
    const vals = Object.values(rest);
    return { restDiff: Math.max(...vals) - Math.min(...vals), maxPair: Math.max(...Object.values(pairs)) };
  });
  check(`休み回数の差≤1（差=${fair.restDiff}）`, fair.restDiff <= 1);
  check(`同じペアの重複なし（max=${fair.maxPair}）`, fair.maxPair === 1);

  console.log('[4] 375px表示');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('横はみ出しなし', overflow <= 0);

  console.log('[5] 画像保存（dpr=3）');
  await page.click('.btn-save');
  await page.waitForSelector('#imagePreview img');
  await page.waitForFunction(() => {
    const img = document.querySelector('#imagePreview img');
    return img && img.naturalWidth > 0;
  });
  const dims = await page.evaluate(() => {
    const img = document.querySelector('#imagePreview img');
    return { w: img.naturalWidth, h: img.naturalHeight };
  });
  console.log(`   画像サイズ: ${dims.w}x${dims.h} = ${(dims.w * dims.h / 1e6).toFixed(1)}Mpx`);
  check('Canvas面積がiOS上限の9割（15,099,494px）以内', dims.w * dims.h <= 16777216 * 0.9);
  check('解像度は十分確保（幅1800px以上）', dims.w >= 1800);
  check('保存時にalertが出ない', dialogs.length === 0);

  console.log('[6] リロード復元');
  await page.reload();
  await page.waitForSelector('.round-card');
  check('26人セッションが復元される', await page.evaluate(() => session.players.length) === 26);

  console.log('[7] 26人からの追加は拒否');
  await page.selectOption('#consumedRound', '3');
  await page.selectOption('#addCount', '1');
  await page.click('.btn-change');
  await page.waitForTimeout(300);
  check('「上限は26人です」のalert', dialogs.some(m => m.includes('上限は26人')));
  check('節数は10のまま（変更されていない）', await page.evaluate(() => session.rounds.length) === 10);

  console.log('[8] 25人でも生成OK');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '25');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const s25 = await page.evaluate(() => ({
    players: session.players.length,
    ok: session.rounds.every(r => r.assignments.length === 4 && r.resting.length === 9),
  }));
  check('25人×毎節休み9人で生成', s25.players === 25 && s25.ok);

  await browser.close();
  console.log(`\n結果: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
