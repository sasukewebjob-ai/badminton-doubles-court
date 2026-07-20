// 種目別コート（A男子/B女子/C・Dミックス）のブラウザ検証（Playwright、375px幅）
// 1. 設定行の表示条件（4コート×名簿選択時のみ）
// 2. infoBoxに男女人数表示
// 3. 生成→全節がテンプレート準拠（A=男4/B=女4/C・D=男女ペア）＋種目タグ表示
// 4. リロード→genderMode込みで復元
// 5. 共有リンク（v3）→閲覧者にも種目タグが見える
// 6. メンバー変更→男女別ゲストセレクト・ゲスト性別の記録・残り節も準拠
// 7. 種目別オフ／番号のみモードは従来どおり（タグなし・リンクv1）
const { chromium } = require('C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright');
const path = require('path');

const EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

// ページ内で全節のテンプレート準拠を検証する共通関数（n=コート数）
const checkRoundsJs = n => `(() => {
  const g = p => {
    const nm = session.names && session.names[p];
    if (nm && GENDER[nm]) return GENDER[nm];
    return (session.guestGenders && session.guestGenders[p]) || null;
  };
  return session.rounds.every(r => {
    if (r.assignments.length !== ${n}) return false;
    const active = r.assignments.flatMap(c => c.pair1.concat(c.pair2));
    const m = active.filter(p => g(p) === 'M').length;
    const f = active.length - m;
    const templates = courtTemplates(m, f, ${n});
    return r.assignments.every((c, i) => {
      const players = c.pair1.concat(c.pair2);
      const cm = players.filter(p => g(p) === 'M').length;
      if (cm !== templates[i].m) return false;
      const need = pairTypesFor(templates[i]).slice().sort().join();
      const act = [c.pair1, c.pair2].map(pr => {
        const pm = pr.filter(p => g(p) === 'M').length;
        return pm === 2 ? 'MM' : pm === 1 ? 'MF' : 'FF';
      }).sort().join();
      return need === act;
    });
  });
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());

  // --- 1. 設定行の表示条件 ---
  console.log('[1] 設定行の表示条件');
  await page.goto(URL);
  check('名簿未選択では非表示（4コートでも）', !(await page.locator('#genderModeRow').isVisible()));

  // 男8人（先頭14人が男性）＋女8人（15人目以降が女性）を選択
  for (let i = 0; i < 8; i++) await page.locator('#rosterChips .chip').nth(i).click();
  for (let i = 14; i < 22; i++) await page.locator('#rosterChips .chip').nth(i).click();
  check('4コート×名簿選択で表示', await page.locator('#genderModeRow').isVisible());

  await page.selectOption('#courtCount', '3');
  check('3コートでも表示・文言がCミックス', await page.locator('#genderModeRow').isVisible() &&
    (await page.locator('#genderMode option[value="on"]').textContent()) === 'A男子・B女子・Cミックス');
  await page.selectOption('#courtCount', '2');
  check('2コートでは非表示', !(await page.locator('#genderModeRow').isVisible()));
  await page.selectOption('#courtCount', '4');
  check('4コートに戻すと再表示・文言がC/Dミックス', await page.locator('#genderModeRow').isVisible() &&
    (await page.locator('#genderMode option[value="on"]').textContent()) === 'A男子・B女子・C/Dミックス');

  // --- 2. infoBoxの男女人数表示 ---
  console.log('[2] infoBox');
  await page.selectOption('#genderMode', 'on');
  const info = await page.locator('#infoBox').textContent();
  check('男女人数を表示（男8人・女8人）', info.includes('男8人') && info.includes('女8人'));

  // --- 3. 生成→テンプレート準拠＋種目タグ ---
  console.log('[3] 生成と種目タグ');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('session.genderMode が true', await page.evaluate(() => session.genderMode === true));
  check('全節テンプレート準拠（A男4/B女4/C・D男女ペア）', await page.evaluate(checkRoundsJs(4)));

  const tags = await page.locator('.round-card').first().locator('.court-type').allTextContents();
  check('第1節に種目タグ4つ（男子/女子/ミックス×2）',
    tags.length === 4 && tags[0] === '男子' && tags[1] === '女子' &&
    tags[2] === 'ミックス' && tags[3] === 'ミックス');
  const tagCls = await page.locator('.round-card').first().locator('.court-type')
    .evaluateAll(els => els.map(e => e.className));
  check('タグ色: A青(ct-m)/B桃(ct-f)/C・D紫(ct-x)',
    tagCls[0].includes('ct-m') && tagCls[1].includes('ct-f') &&
    tagCls[2].includes('ct-x') && tagCls[3].includes('ct-x'));
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0);

  // --- 4. リロード復元 ---
  console.log('[4] リロード復元');
  const roundsBefore = await page.evaluate(() => JSON.stringify(session.rounds));
  await page.reload();
  await page.waitForSelector('.round-card');
  check('genderModeが復元される', await page.evaluate(() => session.genderMode === true));
  check('対戦表も同一で復元', roundsBefore === await page.evaluate(() => JSON.stringify(session.rounds)));
  check('セレクトも「on」に復元', await page.locator('#genderMode').inputValue() === 'on');
  check('復元後も種目タグ表示', await page.locator('.court-type').count() > 0);

  // --- 5. 共有リンク（v3） ---
  console.log('[5] 共有リンク');
  const shareUrl = await page.evaluate(() => buildShareUrl());
  const shareData = shareUrl.split('#s=')[1];
  check('共有データがバージョン3', shareData[0] === '3');

  const viewerCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const viewer = await viewerCtx.newPage();
  viewer.on('dialog', async d => await d.accept());
  await viewer.goto(shareUrl);
  await viewer.waitForSelector('.round-card');
  check('閲覧者: 閲覧バナー表示', await viewer.locator('.viewer-banner').isVisible());
  check('閲覧者: genderMode復元', await viewer.evaluate(() => session.genderMode === true));
  check('閲覧者: 対戦表が一致', roundsBefore === await viewer.evaluate(() => JSON.stringify(session.rounds)));
  check('閲覧者: 種目タグ表示', await viewer.locator('.court-type').count() > 0);
  await viewerCtx.close();

  // --- 6. メンバー変更（男女別ゲスト） ---
  console.log('[6] メンバー変更');
  check('男女別ゲストセレクト表示', await page.locator('#addCountM').count() === 1 &&
    await page.locator('#addCountF').count() === 1);
  check('従来のゲストセレクトは無い', await page.locator('#addCount').count() === 0);

  await page.selectOption('#consumedRound', '5');
  await page.selectOption('#addCountM', '1');
  await page.click('.btn-change');
  await page.waitForFunction(() => session.players.length === 17);
  const guestGenders = await page.evaluate(() => session.guestGenders);
  check('ゲスト（17番）の性別Mを記録', guestGenders && guestGenders[17] === 'M');
  check('変更後も全節テンプレート準拠', await page.evaluate(checkRoundsJs(4)));
  const shareData2 = (await page.evaluate(() => buildShareUrl())).split('#s=')[1];
  const viewerCtx2 = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const viewer2 = await viewerCtx2.newPage();
  await viewer2.goto(URL.split('#')[0] + '#s=' + shareData2);
  await viewer2.waitForSelector('.round-card');
  check('閲覧者: ゲスト性別も共有される', await viewer2.evaluate(() =>
    session.guestGenders && session.guestGenders[17] === 'M'));
  await viewerCtx2.close();

  // --- 7. オフ時・番号のみモードは従来どおり ---
  console.log('[7] 種目別オフ／番号のみモード');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForSelector('#rosterChips .chip');
  for (let i = 0; i < 8; i++) await page.locator('#rosterChips .chip').nth(i).click();
  for (let i = 14; i < 22; i++) await page.locator('#rosterChips .chip').nth(i).click();
  // genderMode はデフォルト off のまま生成
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('オフ時: genderMode false', await page.evaluate(() => session.genderMode === false));
  check('オフ時: 種目タグなし', await page.locator('.court-type').count() === 0);
  check('オフ時: 共有はバージョン2', await page.evaluate(() => encodeShareData()[0] === '2'));

  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForSelector('#rosterChips .chip');
  await page.selectOption('#playerCount', '18');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('番号のみ: genderMode false', await page.evaluate(() => session.genderMode === false));
  check('番号のみ: 種目タグなし', await page.locator('.court-type').count() === 0);
  check('番号のみ: 共有はバージョン1', await page.evaluate(() => encodeShareData()[0] === '1'));

  // --- 8. Dコートがミックスにならない節は緑タグ ---
  console.log('[8] Dコートの緑タグ（男10女6でDは男子ダブルス）');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForSelector('#rosterChips .chip');
  for (let i = 0; i < 10; i++) await page.locator('#rosterChips .chip').nth(i).click();
  for (let i = 14; i < 20; i++) await page.locator('#rosterChips .chip').nth(i).click();
  await page.selectOption('#genderMode', 'on');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const tags8 = await page.locator('.round-card').first().locator('.court-type').allTextContents();
  check('タグが 男子/女子/ミックス/男子', tags8.join(',') === '男子,女子,ミックス,男子');
  const cls8 = await page.locator('.round-card').first().locator('.court-type')
    .evaluateAll(els => els.map(e => e.className));
  check('Dの男子タグは緑(ct-o)・Aの男子タグは青(ct-m)',
    cls8[3].includes('ct-o') && cls8[0].includes('ct-m'));
  // 全節でDが緑タグ（男10女6は毎節D=男子）
  const allGreen = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.round-card')).every(card => {
      const t = card.querySelectorAll('.court-type');
      return t.length === 4 && t[3].classList.contains('ct-o');
    }));
  check('全節でDコートのタグが緑', allGreen);

  // --- 9. 3コート版（A男子・B女子・Cミックス、12〜15人） ---
  console.log('[9] 3コート版');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForSelector('#rosterChips .chip');
  for (let i = 0; i < 6; i++) await page.locator('#rosterChips .chip').nth(i).click();
  for (let i = 14; i < 20; i++) await page.locator('#rosterChips .chip').nth(i).click();
  await page.selectOption('#courtCount', '3');
  check('3コート×名簿選択で設定行表示', await page.locator('#genderModeRow').isVisible());
  await page.selectOption('#genderMode', 'on');
  const info9 = await page.locator('#infoBox').textContent();
  check('infoBoxに男6人・女6人（理想も6人ずつ）', info9.includes('男6人') && info9.includes('女6人') &&
    info9.includes('男6人・女6人の出場が理想'));
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('3c: genderMode true', await page.evaluate(() => session.genderMode === true));
  check('3c: 全節テンプレート準拠', await page.evaluate(checkRoundsJs(3)));
  const tags9 = await page.locator('.round-card').first().locator('.court-type').allTextContents();
  check('3c: タグが 男子/女子/ミックス', tags9.join(',') === '男子,女子,ミックス');
  const cls9 = await page.locator('.round-card').first().locator('.court-type')
    .evaluateAll(els => els.map(e => e.className));
  check('3c: タグ色 A青/B桃/C紫', cls9[0].includes('ct-m') && cls9[1].includes('ct-f') && cls9[2].includes('ct-x'));

  // 男性過多（8男4女）: Cコートが男子ダブルス＝緑タグ
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.waitForSelector('#rosterChips .chip');
  for (let i = 0; i < 8; i++) await page.locator('#rosterChips .chip').nth(i).click();
  for (let i = 14; i < 18; i++) await page.locator('#rosterChips .chip').nth(i).click();
  await page.selectOption('#courtCount', '3');
  await page.selectOption('#genderMode', 'on');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const tags9b = await page.locator('.round-card').first().locator('.court-type').allTextContents();
  check('3c 8男4女: タグが 男子/女子/男子', tags9b.join(',') === '男子,女子,男子');
  const cls9b = await page.locator('.round-card').first().locator('.court-type')
    .evaluateAll(els => els.map(e => e.className));
  check('3c 8男4女: Cの男子タグは緑(ct-o)・Aは青(ct-m)',
    cls9b[2].includes('ct-o') && cls9b[0].includes('ct-m'));

  await browser.close();
  console.log(`\n合計: ${pass + fail} 項目 / OK ${pass} / NG ${fail}`);
  console.log(fail === 0 ? '✅ 種目別コート ブラウザ検証 全合格' : '❌ 失敗あり');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
