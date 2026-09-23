// 休み指定の注意書きの表示（2026-09-23の監査で直した2件）をブラウザで確認する
// D: 番号のみモードで離脱者がいるセッションを再読み込みすると、在籍中の番号への指定が「今は対象外」と誤表示された
// E: 「消去して最初から」のあとも「表示中のコート割に反映するには…」の注意書きが残った
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const url = pathToFileURL(path.join(__dirname, 'index.html')).href;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail ? ' → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await (await browser.newContext({ viewport: { width: 375, height: 700 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    const note = () => page.textContent('#forcedRestNote');
    const selectedPlayer = () => page.locator('.fr-player').evaluate(s => s.selectedOptions[0].textContent);

    // D: 4コート18人・第8節は18番を休み → 第3節まで終了で2番が離脱 → 再読み込み
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.selectOption('#courtCount', '4');
    await page.selectOption('#playerCount', '18');
    await page.click('#forcedAddBtn');
    await page.selectOption('.fr-round', '8');
    await page.selectOption('.fr-player', 'p:18');
    await page.click('#generateBtn');
    await page.selectOption('#consumedRound', '3');
    await page.click('#removeChips .chip[data-num="2"]');
    await page.click('.btn-change');
    const live = { player: await selectedPlayer(), note: await note() };
    await page.reload();
    await page.waitForSelector('.restore-banner');
    const restored = await page.evaluate(() => ({
      player: document.querySelector('.fr-player').selectedOptions[0].textContent,
      value: document.querySelector('.fr-player').value,
      count: document.getElementById('playerCount').value,
      courts: document.getElementById('courtCount').value,
      forced: session.forcedRests,
      active: session.players.length,
    }));
    const restoredNote = await note();
    check('D: 再読み込み後も18番の指定は有効のまま（対象外と出ない）', restored.player === '18番' && restored.value === 'p:18', JSON.stringify(restored));
    check('D: 注意書きに「対象外」の警告が出ない', !restoredNote.includes('対象外'), restoredNote);
    check('D: 入力欄は作成時の設定（4コート・18人）に戻る', restored.count === '18' && restored.courts === '4', JSON.stringify(restored));
    check('D: 指定の表示は再読み込みしない画面と同じ', live.player === restored.player && !live.note.includes('対象外'), JSON.stringify({ live, restoredNote }));
    check('D: 表示中の対戦表と指定はそのまま', restored.active === 17 && JSON.stringify(restored.forced) === '{"8":[18]}', JSON.stringify(restored));

    // E: 生成後に指定を編集 → 消去して最初から
    await page.selectOption('.fr-round', '4');
    const beforeClear = await note();
    check('E: 表示中の表があるときは「作り直してください」の注意が出る', beforeClear.includes('表示中のコート割に反映するには'), beforeClear);
    await page.click('.restore-banner button');
    const afterClear = await note();
    check('E: 消去後は「表示中のコート割に反映するには…」が消える', !afterClear.includes('表示中のコート割に反映するには'), afterClear);
    check('E: 消去後も指定の件数は表示される', afterClear.includes('指定 1件'), afterClear);
    check('ページエラーなし', errors.length === 0, errors.join(' / '));
  } finally {
    await browser.close();
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
