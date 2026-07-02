// 音声読み上げ機能のブラウザ検証（Playwright、375px幅）
// speechSynthesisをスタブに差し替えて読み上げテキストと呼び出しを検証する
// 1. ROSTER全員にKANA（フリガナ）がある
// 2. 名簿モード：各節に🔊ボタン→タップで「だいNせつ」「Aコート」「たい」「やすみ」＋フリガナ読み
// 3. 読み上げ中はボタンが「⏹ 停止」表示、再タップで停止（cancel呼び出し＋🔊に戻る）
// 4. 別の節をタップ→前をキャンセルして新しい節を読む
// 5. 番号のみモード：「5番」形式で読む
// 6. 共有リンクの閲覧モードでも🔊ボタンが使える
// 7. 375pxで横はみ出しなし
const { chromium } = require('C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright');
const path = require('path');

const EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';
const URL = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

// speechSynthesis/SpeechSynthesisUtteranceをスタブ化（呼び出しを__ttsに記録）
const TTS_STUB = () => {
  window.__tts = { spoken: [], cancels: 0 };
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
  };
  const stub = {
    speak(u) { window.__tts.spoken.push({ text: u.text, lang: u.lang, rate: u.rate }); },
    cancel() { window.__tts.cancels++; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true });
};

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  await context.addInitScript(TTS_STUB);
  const page = await context.newPage();
  page.on('dialog', async d => await d.accept());

  // --- 1. KANAの完全性 ---
  console.log('[1] フリガナ表の完全性');
  await page.goto(URL);
  const missing = await page.evaluate(() => ROSTER.filter(n => !KANA[n]));
  check('ROSTER全員にKANAがある', missing.length === 0);
  if (missing.length) console.log('    KANA欠落: ' + missing.join(','));
  const kanaOnly = await page.evaluate(() =>
    Object.values(KANA).every(k => /^[ぁ-んー]+$/.test(k)));
  check('KANAはすべてひらがな', kanaOnly);

  // --- 2. 名簿モードの読み上げ ---
  console.log('[2] 名簿モードの読み上げ');
  for (let i = 0; i < 10; i++) {
    await page.locator('#rosterChips .chip').nth(i).click();
  }
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#roundCount', '10');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');

  check('各節に🔊ボタンがある（10個）', await page.locator('.btn-speak').count() === 10);

  await page.locator('.btn-speak').first().click();
  const spoken1 = await page.evaluate(() => window.__tts.spoken);
  check('speakが1回呼ばれた', spoken1.length === 1);
  const t1 = spoken1[0] || {};
  check('lang=ja-JP', t1.lang === 'ja-JP');
  check('「だい1せつ」で始まる', (t1.text || '').startsWith('だい1せつ'));
  check('Aコート・Bコートを含む', t1.text.includes('Aコート') && t1.text.includes('Bコート'));
  check('「たい」（対戦）を含む', t1.text.includes('、たい、'));
  check('「やすみ」を含む（10人2コートは休み2人）', t1.text.includes('やすみ、'));
  const expected1 = await page.evaluate(() => roundSpeechText(session.rounds[0]));
  check('読み上げ文がroundSpeechTextと一致', t1.text === expected1);
  const kanaUsed = await page.evaluate(text => {
    const names = Object.values(session.names);
    return names.every(nm => !text.includes(nm)) &&
           names.some(nm => text.includes(KANA[nm]));
  }, t1.text);
  check('漢字ではなくフリガナで読む', kanaUsed);

  // --- 3. 停止トグル ---
  console.log('[3] 停止トグル');
  const btn1 = page.locator('.btn-speak').first();
  check('読み上げ中は「⏹ 停止」表示', (await btn1.textContent()).includes('停止'));
  check('speakingクラス付与', await btn1.evaluate(b => b.classList.contains('speaking')));
  const cancelsBefore = await page.evaluate(() => window.__tts.cancels);
  await btn1.click();
  check('再タップでcancel', (await page.evaluate(() => window.__tts.cancels)) > cancelsBefore);
  check('ボタンが🔊に戻る', (await btn1.textContent()).includes('🔊'));
  check('speakは増えない（停止のみ）', (await page.evaluate(() => window.__tts.spoken.length)) === 1);

  // --- 4. 別の節への切替 ---
  console.log('[4] 別の節への切替');
  await btn1.click(); // 第1節を再開
  await page.locator('.btn-speak').nth(1).click(); // 読み上げ中に第2節
  const spoken4 = await page.evaluate(() => window.__tts.spoken);
  check('第2節が読まれる', spoken4[spoken4.length - 1].text.startsWith('だい2せつ'));
  check('第1節のボタンは🔊に戻る', (await btn1.textContent()).includes('🔊'));
  check('第2節のボタンが停止表示', (await page.locator('.btn-speak').nth(1).textContent()).includes('停止'));
  await page.locator('.btn-speak').nth(1).click(); // 停止

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0);

  // 閲覧モード検証用に共有リンクを取得
  const shareUrl = await page.evaluate(() => buildShareUrl());

  // --- 5. 番号のみモード ---
  console.log('[5] 番号のみモード');
  const page2 = await context.newPage();
  page2.on('dialog', async d => await d.accept());
  await page2.goto(URL);
  await page2.evaluate(() => localStorage.clear());
  await page2.reload();
  await page2.selectOption('#courtCount', '2');
  await page2.selectOption('#playerCount', '10');
  await page2.selectOption('#roundCount', '10');
  await page2.click('#generateBtn');
  await page2.waitForSelector('.round-card');
  await page2.locator('.btn-speak').first().click();
  const t5 = await page2.evaluate(() => window.__tts.spoken[0].text);
  check('「N番」形式で読む', /、[0-9]+番、/.test(t5));
  check('フリガナは含まない', await page2.evaluate(text =>
    Object.values(KANA).every(k => !text.includes(k)), t5));
  await page2.close();

  // --- 6. 閲覧モード ---
  console.log('[6] 共有リンクの閲覧モード');
  const viewer = await context.newPage();
  await viewer.goto(shareUrl);
  await viewer.waitForSelector('.round-card');
  check('閲覧モードである', await viewer.evaluate(() => viewerMode === true));
  check('閲覧モードにも🔊ボタン', await viewer.locator('.btn-speak').count() === 10);
  await viewer.locator('.btn-speak').first().click();
  const tv = await viewer.evaluate(() => window.__tts.spoken[0]);
  check('閲覧者側でも読み上げできる', tv && tv.text.startsWith('だい1せつ'));
  check('閲覧者側もフリガナで読む', await viewer.evaluate(text =>
    Object.values(session.names).some(nm => text.includes(KANA[nm])), tv.text));
  await viewer.close();

  await browser.close();
  console.log(`\n合計: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})();
