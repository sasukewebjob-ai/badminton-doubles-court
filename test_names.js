// 名前付き参加者機能＋画像Canvas上限のブラウザ検証（Playwright、375px幅）
// 1. 名簿チップ選択→人数セレクトが隠れ選択人数が使われる
// 2. 生成→番号1..Nがランダムかつ一意に割当、番号表・対戦表・休みバッジに名前表示
// 3. リロード→names込みで復元、名簿チップも再選択
// 4. 共有リンク（v2）→別コンテキストの閲覧者にも名前が見える
// 5. 番号のみモードは従来どおり（リンクはv1のまま）
// 6. メンバー変更：名簿から追加（名前付き）・離脱チップに名前
// 7. 画像保存：deviceScaleFactor=3（iPhone相当）でもCanvas面積がiOS上限16,777,216px以内
// 8. 375pxで横はみ出しなし
const { chromium, launchOptions } = require('./pw');
const path = require('path');

const URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());

  // --- 1. 名簿チップ選択 ---
  console.log('[1] 名簿チップ選択');
  await page.goto(URL);
  const chipCount = await page.locator('#rosterChips .chip').count();
  check('名簿チップが26人分ある', chipCount === 26);
  check('未選択時は人数セレクト表示', await page.locator('#playerCountRow').isVisible());

  // 先頭から10人選択
  for (let i = 0; i < 10; i++) {
    await page.locator('#rosterChips .chip').nth(i).click();
  }
  check('選択後は人数セレクト非表示', !(await page.locator('#playerCountRow').isVisible()));
  const countText = await page.locator('#rosterCount').textContent();
  check('選択人数の表示（10人）', countText.includes('10人'));
  const selectedNames = await page.evaluate(() => selectedRosterNames());

  // --- 2. 生成→番号割当と名前表示 ---
  console.log('[2] 生成と名前表示');
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');

  const names = await page.evaluate(() => session.names);
  const nums = Object.keys(names).map(Number).sort((a, b) => a - b);
  check('番号1..10が割当済み', nums.length === 10 && nums[0] === 1 && nums[9] === 10);
  const assigned = Object.values(names);
  check('割当名が選択した10人と一致', assigned.length === 10 &&
    new Set(assigned).size === 10 && assigned.every(n => selectedNames.includes(n)));

  check('番号表カード表示', await page.locator('.roster-map').count() === 1);
  check('番号表に10人分', await page.locator('.roster-map-grid span').count() === 10);
  const mapFirst = await page.locator('.roster-map-grid span').first().textContent();
  check('番号表が「1 名前」形式', /^1 .+/.test(mapFirst));

  const firstMatch = await page.locator('.match-detail').first().textContent();
  check('対戦表に名前表示', assigned.some(n => firstMatch.includes(n)));
  const badge = await page.locator('.rest-badge').first().textContent();
  check('休みバッジに名前表示（・区切り）', badge.includes('・') && assigned.some(n => badge.includes(n)));

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0);

  // --- 3. リロード復元 ---
  console.log('[3] リロード復元');
  const namesBefore = JSON.stringify(names);
  await page.reload();
  await page.waitForSelector('.round-card');
  const namesAfter = await page.evaluate(() => JSON.stringify(session.names));
  check('namesが復元される', namesBefore === namesAfter);
  check('復元後も番号表表示', await page.locator('.roster-map').count() === 1);
  check('名簿チップも再選択（10人）', await page.locator('#rosterChips .chip.selected').count() === 10);

  // --- 4. 共有リンク（v2） ---
  console.log('[4] 共有リンク');
  const shareUrl = await page.evaluate(() => buildShareUrl());
  check('名前付きリンクはバージョン2', shareUrl.includes('#s=2'));

  const viewerCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const viewer = await viewerCtx.newPage();
  await viewer.goto(shareUrl);
  await viewer.waitForSelector('.round-card');
  check('閲覧者に閲覧バナー表示', await viewer.locator('.viewer-banner').count() === 1);
  const viewerNames = await viewer.evaluate(() => JSON.stringify(session.names));
  check('閲覧者にもnamesが伝わる', viewerNames === namesBefore);
  check('閲覧者にも番号表表示', await viewer.locator('.roster-map').count() === 1);
  const viewerStorage = await viewer.evaluate(() => localStorage.getItem('badminton-court-session-v1'));
  check('閲覧者のlocalStorageは汚さない', viewerStorage === null);
  await viewerCtx.close();

  // --- 5. 番号のみモードは従来どおり ---
  console.log('[5] 番号のみモード');
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page2 = await ctx2.newPage();
  page2.on('dialog', async d => await d.accept());
  await page2.goto(URL);
  await page2.selectOption('#courtCount', '2');
  await page2.selectOption('#playerCount', '10');
  await page2.selectOption('#roundCount', '10');
  await page2.click('#generateBtn');
  await page2.waitForSelector('.round-card');
  check('番号のみモードではnamesなし', await page2.evaluate(() => session.names === null));
  check('番号のみモードでは番号表なし', await page2.locator('.roster-map').count() === 0);
  const match2 = await page2.locator('.match-detail').first().textContent();
  check('従来の「N番」表示', /\d+番/.test(match2));
  const shareUrl2 = await page2.evaluate(() => buildShareUrl());
  check('番号のみリンクは従来のバージョン1', shareUrl2.includes('#s=1'));
  await ctx2.close();

  // --- 6. メンバー変更（名簿から追加・名前付き離脱） ---
  console.log('[6] メンバー変更');
  const removeChipText = await page.locator('#removeChips .chip').first().textContent();
  check('離脱チップに名前表示', /^1 .+/.test(removeChipText));
  check('名簿から追加チップあり（未参加16人）', await page.locator('#addNameChips .chip').count() === 16);

  await page.selectOption('#consumedRound', '3');
  await page.locator('#addNameChips .chip').first().click();
  const addedName = await page.locator('#addNameChips .chip').first().textContent();
  await page.locator('#removeChips .chip').first().click();
  await page.click('.btn-change');
  await page.waitForSelector('.change-divider');

  const divider = await page.locator('.change-divider').textContent();
  check('変更マーカーに追加者の名前', divider.includes('11 ' + addedName));
  const names11 = await page.evaluate(() => session.names[11]);
  check('11番に名簿の名前が割当', names11 === addedName);
  const departedShown = await page.locator('.roster-map-grid .departed').count();
  check('番号表で離脱者は打ち消し表示', departedShown === 1);

  // --- 7. 画像Canvas面積（iPhone相当 dpr=3） ---
  console.log('[7] 画像Canvas上限');
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
  check('Canvas面積がiOS上限16,777,216px以内', dims.w * dims.h <= 16777216);
  check('解像度は十分確保（幅1800px以上）', dims.w >= 1800);

  const overflow2 = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('変更後も375pxで横はみ出しなし', overflow2 <= 0);

  await browser.close();
  console.log(`\n結果: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
