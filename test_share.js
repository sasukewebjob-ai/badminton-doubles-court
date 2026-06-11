// 対戦表の共有リンク（URL埋め込み）の検証（Playwright）
// 1. エンコード/デコードの往復一致・URL長
// 2. 共有リンクを別ブラウザ（別localStorage）で開くと同じ対戦表が見える（閲覧モード）
// 3. 閲覧者のlocalStorageを汚さない・編集UIが出ない
// 4. メンバー変更後の再共有が反映される（ハッシュだけの遷移でも更新される）
// 5. 自分のコート割を持つ人が共有を見ても、自分のデータに戻れる
// 6. 壊れたリンクは警告して通常モードにフォールバック
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

  // --- ホスト（共有する側） ---
  const hostCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const host = await hostCtx.newPage();
  host.on('dialog', async d => { await d.accept(); });

  console.log('[1] エンコード/デコードの往復一致');
  await host.goto(URL);
  await host.selectOption('#courtCount', '4');
  await host.selectOption('#playerCount', '18');
  await host.selectOption('#roundCount', '10');
  await host.click('#generateBtn');
  await host.waitForSelector('.round-card');

  const roundtrip = await host.evaluate(() => {
    const decoded = decodeShareData(encodeShareData());
    if (!decoded) return { ok: false };
    const s = decoded.session;
    const norm = JSON.parse(JSON.stringify(session));
    norm.changes.forEach(c => { if (!c.returned) c.returned = []; });
    const pick = o => JSON.stringify({
      totalRounds: o.totalRounds, initialCourts: o.initialCourts, restOrder: o.restOrder,
      maxNumber: o.maxNumber, players: o.players, everPlayers: o.everPlayers,
      changes: o.changes, rounds: o.rounds
    });
    return {
      ok: pick(s) === pick(norm),
      sharedAtValid: Math.abs(decoded.sharedAt - Date.now()) < 120000
    };
  });
  check('デコード結果がセッションと一致', roundtrip.ok);
  check('作成時刻が現在時刻と一致（±2分）', roundtrip.sharedAtValid);

  const url1 = await host.evaluate(() => buildShareUrl());
  check('URL長が常識的（1000文字未満）', url1.length < 1000);
  const hostRounds = await host.evaluate(() => JSON.stringify(session.rounds));

  // --- 閲覧者（まっさらな別ブラウザ） ---
  console.log('[2] 共有リンクを別ブラウザで開く');
  const viewCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const viewer = await viewCtx.newPage();
  const viewerDialogs = [];
  viewer.on('dialog', async d => { viewerDialogs.push(d.message()); await d.accept(); });

  await viewer.goto(url1);
  await viewer.waitForSelector('.round-card');
  check('10節が表示される', await viewer.locator('.round-card').count() === 10);
  const viewerRounds = await viewer.evaluate(() => JSON.stringify(session.rounds));
  check('割当内容がホストと完全一致', viewerRounds === hostRounds);
  check('閲覧バナーが出る', await viewer.locator('.viewer-banner').count() === 1);
  check('入力セクションは非表示', await viewer.locator('.input-section').isHidden());
  check('メンバー変更UIは出ない', await viewer.locator('.change-section').count() === 0);
  check('休み回数表は見える', await viewer.locator('.stats-table').count() === 1);
  check('共有ボタンも見える（転送可）', await viewer.locator('.btn-share').count() === 1);

  console.log('[3] 閲覧者のデータを汚さない');
  check('閲覧者のlocalStorageは空のまま',
    await viewer.evaluate(() => localStorage.getItem('badminton-court-session-v1')) === null);
  const overflow = await viewer.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0);

  // --- メンバー変更 → 再共有 ---
  console.log('[4] メンバー変更後の再共有');
  await host.selectOption('#consumedRound', '3');
  await host.selectOption('#addCount', '2'); // 19,20番追加
  await host.click('.btn-change');
  await host.waitForSelector('.change-divider');
  const url2 = await host.evaluate(() => buildShareUrl());
  check('変更後はURLが変わる', url2 !== url1);

  // 開いたままのタブにハッシュだけ変わったリンクが来ても反映される
  await viewer.evaluate(u => { location.href = u; }, url2).catch(() => {});
  await viewer.waitForFunction(
    () => typeof session !== 'undefined' && session && session.players.length === 20,
    null, { timeout: 5000 });
  check('再共有で20人に更新（ハッシュ遷移）', true);
  check('変更マーカーも表示', await viewer.locator('.change-divider').count() === 1);

  // --- 自分のデータを持つ閲覧者 ---
  console.log('[5] 自分のコート割を持つ人が共有を見る');
  const ownCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const own = await ownCtx.newPage();
  own.on('dialog', async d => { await d.accept(); });
  await own.goto(URL);
  await own.selectOption('#courtCount', '2');
  await own.selectOption('#playerCount', '8');
  await own.selectOption('#roundCount', '15');
  await own.click('#generateBtn');
  await own.waitForSelector('.round-card');
  check('自分の15節を生成', await own.locator('.round-card').count() === 15);

  await own.goto(url1);
  await own.waitForSelector('.viewer-banner');
  check('共有の10節が表示される', await own.locator('.round-card').count() === 10);
  check('自分の保存データは残っている',
    await own.evaluate(() => JSON.parse(localStorage.getItem('badminton-court-session-v1')).session.rounds.length) === 15);

  await own.click('.viewer-banner button');
  await own.waitForSelector('.restore-banner');
  check('「自分のコート割を作る」で自分の15節に戻る', await own.locator('.round-card').count() === 15);
  check('入力セクションも戻る', await own.locator('.input-section').isVisible());

  // --- 壊れたリンク ---
  console.log('[6] 壊れたリンクのフォールバック');
  const brokenCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const broken = await brokenCtx.newPage();
  const brokenDialogs = [];
  broken.on('dialog', async d => { brokenDialogs.push(d.message()); await d.accept(); });
  await broken.goto(URL + '#s=' + url1.split('#s=')[1].slice(0, 20)); // 途中で切れたリンク
  await broken.waitForTimeout(500);
  check('警告が出る', brokenDialogs.some(m => m.includes('読み込めません')));
  check('通常モードで起動（入力セクション表示）', await broken.locator('.input-section').isVisible());
  check('対戦表は表示されない', await broken.locator('.round-card').count() === 0);

  await browser.close();
  console.log(`\n結果: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
