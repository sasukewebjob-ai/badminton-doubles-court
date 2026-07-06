// バグ修正の回帰テスト（2026-07-06）
// バグ1: 最終節直前でメンバー変更→残り節なし→再度「作り直す」でも全節が消えないこと
//   （applyMemberChangeのNaN/null節番号ガード＋UIボタン非表示）
// バグ2: 共有リンクの名前に含まれるHTMLタグがエスケープされ、live要素として挿入されないこと（XSS対策）
const { chromium } = require('C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright');
const path = require('path');
const EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';

(async () => {
  const url = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
  const browser = await chromium.launch({ executablePath: EXE });
  let pass = 0, fail = 0;
  const check = (name, ok) => { if (ok) { pass++; console.log('  OK  ' + name); } else { fail++; console.log('  NG  ' + name); } };

  // --- バグ1: 全節消失しないこと ---
  const ctx1 = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx1.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(url);
  await page.click('#generateBtn'); // デフォルト10節
  await page.waitForSelector('.round-card');
  check('10節生成できた(前提)', await page.locator('.round-card').count() === 10);

  await page.selectOption('#consumedRound', '9'); // 第9節まで終了で変更
  await page.click('.btn-change');
  await page.waitForTimeout(300);
  check('変更後、消化済みセレクトは消える(残り節なし)', await page.locator('#consumedRound').count() === 0);
  check('「これ以上作り直せません」の案内が出る', (await page.locator('.change-section').textContent()).includes('作り直せる節はありません'));
  check('作り直しボタンが消えている', await page.locator('.btn-change').count() === 0);

  // 万一ボタンが押されても全消失しないことを直接検証（applyMemberChangeのガード）
  await page.evaluate(() => applyMemberChange());
  await page.waitForTimeout(200);
  const cards1 = await page.locator('.round-card').count();
  const savedRounds = await page.evaluate(() => {
    try { const d = JSON.parse(localStorage.getItem('badminton-court-session-v1')); return d.session.rounds.length; }
    catch (e) { return -1; }
  });
  check('applyMemberChange直呼びでも節は消えない', cards1 === 10);
  check('保存データの節も維持される', savedRounds === 10);
  await ctx1.close();

  // --- バグ2: 名前のHTMLがエスケープされること ---
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const host = await ctx2.newPage();
  host.on('dialog', d => d.accept());
  await host.goto(url);
  await host.click('#generateBtn');
  await host.waitForSelector('.round-card');
  // 攻撃者が細工した名前(20文字以内)を含む共有リンク。<b>タグが素通りするか確認
  const shareUrl = await host.evaluate(() => {
    session.names = { 1: '<b>x</b>', 2: '田中' };
    return buildShareUrl();
  });
  const victim = await ctx2.newPage();
  victim.on('dialog', d => d.accept());
  await victim.goto(shareUrl);
  await victim.waitForSelector('.round-card');
  check('閲覧モードで開けた(共有往復OK)', await victim.locator('.viewer-banner').count() === 1);
  const liveTags = await victim.evaluate(() => document.querySelectorAll('#results b').length);
  const literalShown = await victim.evaluate(() => document.querySelector('.roster-map').textContent.includes('<b>x</b>'));
  check('注入した<b>がlive要素として挿入されていない', liveTags === 0);
  check('名前は文字列としてそのまま表示される', literalShown);
  await ctx2.close();

  await browser.close();
  console.log(`\n検証完了: ${pass} OK / ${fail} NG`);
  process.exit(fail === 0 ? 0 : 1);
})();
