// localStorage永続化の検証（Playwright）
// 1. 生成→リロード→状態が復元される（バナー表示・節数一致）
// 2. メンバー変更→リロード→変更が反映済み
// 3. 「消去して最初から」→リロード→復元されない
// 4. 既存セッションありで再生成→確認ダイアログが出る
const { chromium } = require('C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright');
const path = require('path');

const EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();

  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  // --- 1. 生成→リロード→復元 ---
  console.log('[1] 生成→リロードで復元');
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const cardsBefore = await page.locator('.round-card').count();
  check('生成直後に10節表示', cardsBefore === 10);
  check('生成直後はバナーなし', await page.locator('.restore-banner').count() === 0);

  const roundsBefore = await page.evaluate(() => JSON.stringify(session.rounds));

  await page.reload();
  await page.waitForSelector('.round-card');
  check('リロード後も10節表示', await page.locator('.round-card').count() === 10);
  check('復元バナー表示', await page.locator('.restore-banner').count() === 1);
  const roundsAfter = await page.evaluate(() => JSON.stringify(session.rounds));
  check('割当内容が完全一致', roundsBefore === roundsAfter);
  check('入力欄も復元（人数18）', await page.inputValue('#playerCount') === '18');
  check('入力欄も復元（節数10）', await page.inputValue('#roundCount') === '10');

  // 横はみ出しがないこと（375px）
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0);

  // --- 2. メンバー変更→リロード→反映済み ---
  console.log('[2] メンバー変更→リロードで反映');
  await page.selectOption('#consumedRound', '3');
  await page.selectOption('#addCount', '2'); // 19,20番追加
  await page.click('.btn-change');
  await page.waitForSelector('.change-divider');
  const playersBefore = await page.evaluate(() => JSON.stringify(session.players));

  await page.reload();
  await page.waitForSelector('.round-card');
  check('変更マーカーも復元', await page.locator('.change-divider').count() === 1);
  const playersAfter = await page.evaluate(() => JSON.stringify(session.players));
  check('追加メンバーも復元（20人）', playersBefore === playersAfter
    && JSON.parse(playersAfter).length === 20);

  // --- 3. 消去して最初から ---
  console.log('[3] 消去して最初から');
  dialogs.length = 0;
  await page.click('.restore-banner button');
  check('消去の確認ダイアログ', dialogs.length === 1 && dialogs[0].includes('消去'));
  check('結果がクリアされる', await page.locator('.round-card').count() === 0);
  await page.reload();
  await page.waitForTimeout(300);
  check('リロード後も復元されない', await page.locator('.round-card').count() === 0);

  // --- 4. 再生成時の上書き確認 ---
  console.log('[4] 再生成時の上書き確認');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  dialogs.length = 0;
  await page.click('#generateBtn'); // セッションありで再生成→confirm（acceptで続行）
  await page.waitForTimeout(300);
  check('上書き確認ダイアログが出る', dialogs.length === 1 && dialogs[0].includes('破棄'));
  check('承諾後は新しく生成される', await page.locator('.round-card').count() > 0);

  // 壊れた保存データは無視されること
  console.log('[5] 壊れたデータの扱い');
  await page.evaluate(() => localStorage.setItem('badminton-court-session-v1', '{broken'));
  await page.reload();
  await page.waitForTimeout(300);
  check('壊れたデータでもエラーなく起動', await page.locator('#generateBtn').count() === 1);
  check('復元はされない', await page.locator('.round-card').count() === 0);

  await browser.close();
  console.log(`\n結果: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
