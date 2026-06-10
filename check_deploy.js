// 本番URLに新版（離脱者復帰）が反映されたか確認
const { chromium } = require('C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright');
const EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const URL = 'https://sasukewebjob-ai.github.io/badminton-doubles-court/?v=' + Date.now();

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage();
  page.on('dialog', async d => await d.accept());

  const deadline = Date.now() + 180000;
  let deployed = false;
  while (Date.now() < deadline) {
    await page.goto('https://sasukewebjob-ai.github.io/badminton-doubles-court/?v=' + Date.now());
    deployed = await page.evaluate(() => typeof applyMemberChange === 'function'
      && applyMemberChange.toString().includes('returnChips'));
    if (deployed) break;
    await page.waitForTimeout(15000);
  }
  if (!deployed) {
    console.log('NG: 3分待っても本番に復帰機能が反映されていません');
    await browser.close();
    process.exit(1);
  }
  console.log('OK: 本番に復帰機能のコードが反映');

  // 実際に動かして確認: 生成→4番離脱→復帰チップ→復帰
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#playerCount', '10');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  await page.selectOption('#consumedRound', '2');
  await page.click('#removeChips .chip[data-num="4"]');
  await page.click('.btn-change');
  await page.waitForSelector('#returnChips .chip[data-num="4"]');
  await page.selectOption('#consumedRound', '4');
  await page.click('#returnChips .chip[data-num="4"]');
  await page.click('.btn-change');
  await page.waitForTimeout(500);
  const ok = await page.evaluate(() => session.players.includes(4) && session.players.length === 10);
  console.log(ok ? 'OK: 本番で離脱→復帰の動作確認' : 'NG: 復帰が動作しない');

  // 後始末（本番確認で作ったlocalStorageを消す）
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
