// 本番URLに新版（名前付き参加者機能＋画像Canvas上限修正）が反映されたか確認
const { chromium } = require('C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright');
const EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const context = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());

  const deadline = Date.now() + 180000;
  let deployed = false;
  while (Date.now() < deadline) {
    await page.goto('https://sasukewebjob-ai.github.io/badminton-doubles-court/?v=' + Date.now());
    // 2026-07-22: 画像保存フォールバック導入で本体はsaveAsImageImplに分離。
    // 「上限の1割余裕（* 0.9）」の存在を新版の目印にする
    deployed = await page.evaluate(() =>
      typeof ROSTER !== 'undefined' && Array.isArray(ROSTER) && ROSTER.length === 26 &&
      typeof saveAsImageImpl === 'function' && saveAsImageImpl.toString().includes('16777216 * 0.9'));
    if (deployed) break;
    await page.waitForTimeout(15000);
  }
  if (!deployed) {
    console.log('NG: 3分待っても本番に名前機能＋画像修正が反映されていません');
    await browser.close();
    process.exit(1);
  }
  console.log('OK: 本番に名前機能＋画像Canvas上限修正のコードが反映');

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

  // 後始末（本番確認で作ったlocalStorageを消す）
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await browser.close();
  process.exit(namesOk && imgOk ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
