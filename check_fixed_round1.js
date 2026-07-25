// 第1節固定配置（最後の番号から休む）のブラウザ検証（Playwright）
// 1. desc選択で生成→第1節が A:1,2vs3,4 / B:5,6vs7,8 … になる
// 2. 第1節の休みは最後の番号（17,18）
// 3. リロード後も固定配置のまま復元される
// 4. asc（1番から休む）では従来どおりランダム配置
const { chromium, launchOptions } = require('./pw');
const path = require('path');

// 引数でURLを指定すると本番などローカル以外も検証できる（例: node check_fixed_round1.js https://...）
const URL = process.argv[2] || 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

function isFixed(assignments, courts) {
  for (let c = 0; c < courts; c++) {
    const m = assignments[c];
    if (m.pair1[0] !== c * 4 + 1 || m.pair1[1] !== c * 4 + 2 ||
        m.pair2[0] !== c * 4 + 3 || m.pair2[1] !== c * 4 + 4) return false;
  }
  return true;
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());

  console.log('[1] desc選択で生成→第1節固定');
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  await page.selectOption('#restOrder', 'desc');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');

  const r1 = await page.evaluate(() => session.rounds[0]);
  check('第1節が固定配置（A:1,2vs3,4 …）', isFixed(r1.assignments, 4));
  check('第1節の休みは[17,18]', JSON.stringify(r1.resting) === '[17,18]');
  const r2 = await page.evaluate(() => session.rounds[1]);
  check('第2節は4コート分生成されている', r2.assignments.length === 4);

  console.log('[2] リロード→復元後も固定のまま');
  await page.reload();
  await page.waitForSelector('.round-card');
  const r1r = await page.evaluate(() => session.rounds[0]);
  check('リロード後も第1節は固定配置', isFixed(r1r.assignments, 4));
  check('休み順セレクトもdescに復元', await page.inputValue('#restOrder') === 'desc');

  console.log('[3] asc（1番から休む）はランダムのまま');
  const sigs = new Set();
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await page.selectOption('#courtCount', '4');
    await page.selectOption('#playerCount', '18');
    await page.selectOption('#roundCount', '10');
    await page.selectOption('#restOrder', 'asc');
    await page.click('#generateBtn');
    await page.waitForSelector('.round-card');
    const a = await page.evaluate(() => session.rounds[0].assignments);
    sigs.add(JSON.stringify(a));
  }
  check(`ascの第1節は毎回変わる（5回中${sigs.size}パターン）`, sigs.size > 1);

  await browser.close();
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
