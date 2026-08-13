// 本番URLに新版（名前付き参加者機能＋画像Canvas上限修正＋26人対応）が反映されたか確認
const { chromium, launchOptions } = require('./pw');

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());

  const deadline = Date.now() + 180000;
  let deployed = false;
  while (Date.now() < deadline) {
    await page.goto('https://sasukewebjob-ai.github.io/badminton-doubles-court/?v=' + Date.now());
    // 2026-07-22: 画像保存フォールバック（saveAsImageImplの * 0.9）と
    // ミックス半々バランス（updateMixDiff）の両方の存在を新版の目印にする
    deployed = await page.evaluate(() =>
      typeof ROSTER !== 'undefined' && Array.isArray(ROSTER) && ROSTER.length === 26 &&
      typeof saveAsImageImpl === 'function' && saveAsImageImpl.toString().includes('16777216 * 0.9') &&
      typeof updateMixDiff === 'function');
    if (deployed) break;
    await page.waitForTimeout(15000);
  }
  if (!deployed) {
    console.log('NG: 3分待っても本番に名前機能＋画像修正が反映されていません');
    await browser.close();
    process.exit(1);
  }
  console.log('OK: 本番に名前機能＋画像Canvas上限修正のコードが反映');

  // 26人対応（2026-07-24）: 上限が24人のままの旧版を掴んでいないか実際に確かめる
  await page.selectOption('#courtCount', '4');
  const selOk = await page.evaluate(() => {
    const opts = Array.from(document.getElementById('playerCount').options).map(o => parseInt(o.value));
    return opts.length === 11 && opts[0] === 16 && opts[opts.length - 1] === 26;
  });
  console.log(`${selOk ? 'OK' : 'NG'}: 4コートの人数選択肢が16〜26人（11件）`);

  await page.selectOption('#playerCount', '26');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const gen26 = await page.evaluate(() =>
    session.players.length === 26 && session.rounds.length === 10 &&
    session.rounds.every(r => r.assignments.length === 4 && r.resting.length === 10));
  console.log(`${gen26 ? 'OK' : 'NG'}: 26人×4コート×10節が生成（毎節4コート・休み10人）`);

  // 名簿モードの確認は素の状態から始めたいので保存データを消して読み直す
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await page.goto('https://sasukewebjob-ai.github.io/badminton-doubles-court/?v=' + Date.now());

  // 実際に動かして確認: 名簿10人選択→生成→番号表＆名前表示→画像がiOS上限内
  for (let i = 0; i < 10; i++) await page.locator('#rosterChips .chip').nth(i).click();
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const namesOk = await page.evaluate(() =>
    session.names && Object.keys(session.names).length === 10 &&
    document.querySelectorAll('.roster-map-grid span').length === 10);
  console.log(namesOk ? 'OK: 本番で名簿選択→番号割当→番号表表示' : 'NG: 名前機能が動作しない');

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
  const imgOk = dims.w * dims.h <= 16777216 && dims.w >= 1800;
  console.log(`${imgOk ? 'OK' : 'NG'}: 画像 ${dims.w}x${dims.h}（iOS上限16,777,216px以内・十分な解像度）`);

  // 休み指定（2026-08-13追加）が本番に載っているか。旧版を掴んだらここで落ちる
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await page.goto('https://sasukewebjob-ai.github.io/badminton-doubles-court/?v=' + Date.now());
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  const hasForcedUI = await page.locator('#forcedAddBtn').count() === 1;
  let forcedOk = false;
  if (hasForcedUI) {
    await page.click('#forcedAddBtn');
    const row = page.locator('#forcedRestList .forced-row').last();
    await row.locator('.fr-round').selectOption('3');
    await row.locator('.fr-player').selectOption('p:5');
    await page.click('#generateBtn');
    await page.waitForSelector('.round-card');
    forcedOk = await page.evaluate(() =>
      session.rounds[2].resting.includes(5) &&
      session.rounds.every(r => r.resting.length === 2) &&
      JSON.stringify(session.forcedRests) === JSON.stringify({ 3: [5] }));
  }
  console.log(`${hasForcedUI && forcedOk ? 'OK' : 'NG'}: 休み指定（第3節に5番）が本番で反映される`);

  // 後始末（本番確認で作ったlocalStorageを消す）
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await browser.close();
  process.exit(selOk && gen26 && namesOk && imgOk && hasForcedUI && forcedOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
