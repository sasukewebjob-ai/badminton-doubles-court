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

  // --- 6. 休み順の逆順オプション ---
  console.log('[6] 休み順「最後の番号から」');
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await page.reload();
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#playerCount', '10');
  await page.selectOption('#roundCount', '10');
  await page.selectOption('#restOrder', 'desc');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const firstRest = await page.locator('.round-card .rest-badge').first().textContent();
  check('第1節の休みが9・10番', firstRest.includes('9番') && firstRest.includes('10番'));

  await page.reload();
  await page.waitForSelector('.round-card');
  check('リロード後も休み順desc復元', await page.inputValue('#restOrder') === 'desc');
  const firstRest2 = await page.locator('.round-card .rest-badge').first().textContent();
  check('復元後も第1節は9・10番', firstRest2.includes('9番') && firstRest2.includes('10番'));

  // メンバー変更後も逆順を引き継ぐ（11番追加→以降の新規休みは大きい番号優先のまま公平）
  await page.selectOption('#consumedRound', '2');
  await page.selectOption('#addCount', '1');
  await page.click('.btn-change');
  await page.waitForSelector('.change-divider');
  const keepsReverse = await page.evaluate(() => session.restOrder === 'desc');
  check('変更後もsession.restOrder=desc', keepsReverse);

  const overflow2 = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('休み順セレクト追加後も375pxはみ出しなし', overflow2 <= 0);

  // --- 7. 離脱者の同番号復帰 ---
  console.log('[7] 離脱者の同番号復帰');
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await page.reload();
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#playerCount', '10');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('離脱者がいない間は復帰チップ非表示', await page.locator('#returnChips').count() === 0);

  // 2節消化で4番が離脱
  await page.selectOption('#consumedRound', '2');
  await page.click('#removeChips .chip[data-num="4"]');
  await page.click('.btn-change');
  await page.waitForSelector('.change-divider');
  check('離脱後に復帰チップが出る', await page.locator('#returnChips .chip[data-num="4"]').count() === 1);

  // 4節消化で4番が復帰
  await page.selectOption('#consumedRound', '4');
  await page.click('#returnChips .chip[data-num="4"]');
  await page.click('.btn-change');
  await page.waitForSelector('.change-divider:nth-of-type(2)', { timeout: 5000 }).catch(() => {});
  const returned = await page.evaluate(() => session.players.includes(4) && session.players.length === 10);
  check('4番が同じ番号で復帰', returned);
  const bodyText = await page.locator('body').textContent();
  check('復帰マーカー・注記の表示', bodyText.includes('復帰'));
  const noDup = await page.evaluate(() => session.everPlayers.filter(p => p === 4).length === 1);
  check('everPlayersに重複なし', noDup);

  // リロードしても復帰状態が残る
  await page.reload();
  await page.waitForSelector('.round-card');
  const returnedAfterReload = await page.evaluate(() => session.players.includes(4));
  check('リロード後も復帰状態を復元', returnedAfterReload);
  check('復帰後は復帰チップ非表示', await page.locator('#returnChips').count() === 0);

  await browser.close();
  console.log(`\n結果: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
