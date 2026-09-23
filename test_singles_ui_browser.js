// シングルス・固定ペア版の画面の回帰テスト（2026-09-23の監査で直した4件）
// 1: 壊れた・途中で切れた共有リンクで、ブラウザ内部の英語エラーがそのまま表示された
// 2: 休み指定の誤り（参加していない番号・休み枠超過）が「作り直しますか？」の確認のあとで表示された
// 3: 途中変更のあと再読み込みすると、作成欄が作成時ではなく変更後の人数・コート数になった
// 4: 再読み込み後、休み指定の欄が閉じたまま中身が残り、次の作成で気づかずに使われた
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const url = pathToFileURL(path.join(__dirname, 'singles.html')).href;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail ? ' → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
    const page = await context.newPage();
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    // 1: 共有リンク
    await page.selectOption('#courtCount', '4');
    await page.selectOption('#playerCount', '12');
    await page.selectOption('#roundCount', '30');
    await page.click('#generateBtn');
    const good = await page.evaluate(() => '#sp1=' + encodeShare(session));
    const viewer = await context.newPage();
    viewer.on('pageerror', e => errors.push(e.message));
    const open = async hash => {
      await viewer.goto('about:blank');
      await viewer.goto(url + hash);
      return { status: await viewer.textContent('#status'), cards: await viewer.locator('.round-card').count() };
    };
    const japanese = s => !/[A-Za-z]{4,}/.test(s.replace('自分の対戦表に戻る', ''));
    for (const [label, hash] of [
      ['途中で切れたリンク', good.slice(0, Math.floor(good.length / 2))],
      ['末尾1文字欠け', good.slice(0, -1)],
      ['base64として壊れたリンク', '#sp1=broken'],
    ]) {
      const r = await open(hash);
      check(`1: ${label}は日本語で案内し、表は出さない`, japanese(r.status) && r.status.includes('切れているか、壊れています') && r.cards === 0, r.status);
    }
    const encoded = await open(good.replace(/=/g, (m, i) => i < 5 ? m : '%3D'));
    check('1: 「=」が「%3D」に変わったリンクも開ける', encoded.cards === 30 && encoded.status.includes('共有された対戦表'), encoded.status);
    const normal = await open(good);
    check('1: 正しいリンクは従来どおり開ける', normal.cards === 30, normal.status);

    // 2: 入力の誤りは確認より先に
    await page.click('#forcedBox summary');
    for (const [label, forced, want] of [
      ['参加していない番号', '3: 13', '参加していない番号'],
      ['休み枠超過', '3: 1,2,3,4,5', '休み枠'],
    ]) {
      await page.fill('#forcedRests', forced.replace('13', '12'));
      if (label === '参加していない番号') await page.selectOption('#playerCount', '10');
      dialogs.length = 0;
      const before = await page.evaluate(() => JSON.stringify(session));
      await page.click('#generateBtn');
      const status = await page.textContent('#status');
      check(`2: ${label}は確認を出さずにすぐ知らせ、表は変えない`, dialogs.length === 0 && status.includes(want) &&
        before === await page.evaluate(() => JSON.stringify(session)), JSON.stringify({ dialogs, status }));
      await page.selectOption('#playerCount', '12');
    }

    // 3・4: 途中変更のあとの再読み込み
    await page.fill('#forcedRests', '8: 12');
    await page.click('#generateBtn');
    await page.click('#changePanel summary');
    await page.selectOption('#consumedRound', '3');
    await page.locator('#memberChips input[value="3"]').uncheck();
    await page.selectOption('#changeCourts', '3');
    await page.click('#changeBtn');
    const inputs = () => page.evaluate(() => ({ courts: $('courtCount').value, n: $('playerCount').value, forced: $('forcedRests').value,
      open: $('forcedBox').open, players: session.players.join(','), courtsNow: session.courts }));
    const live = await inputs();
    await page.reload();
    const restored = await inputs();
    check('3: 再読み込み後の作成欄は作成時の設定（4コート・12番号）', restored.courts === '4' && restored.n === '12', JSON.stringify(restored));
    check('3: 再読み込みしない画面と同じ作成欄', live.courts === restored.courts && live.n === restored.n && live.forced === restored.forced, JSON.stringify({ live, restored }));
    check('3: 表示中の表は変更後のまま（3コート・3番抜け）', restored.courtsNow === 3 && restored.players === '1,2,4,5,6,7,8,9,10,11,12', JSON.stringify(restored));
    check('4: 休み指定が残っているときは欄が開いている', restored.open === true && restored.forced === '8: 12', JSON.stringify(restored));
    await page.click('.actions button:has-text("消去して最初から")');
    await page.fill('#forcedRests', '');
    await page.click('#generateBtn');
    await page.reload();
    check('4: 休み指定がないときは欄を閉じたまま', await page.evaluate(() => !!session && !$('forcedBox').open));
    check('ページエラーなし', errors.length === 0, errors.join(' / '));
  } finally {
    await browser.close();
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
