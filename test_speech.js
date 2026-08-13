// 音声読み上げ機能のブラウザ検証（Playwright、375px幅）
// speechSynthesisをスタブに差し替えて読み上げテキストと呼び出しを検証する
// 1. ROSTER全員にKANA（フリガナ）がある
// 2. 名簿モード：各節に🔊ボタン→タップで「だいNせつ」「Aコート」「たい」「やすみ」＋フリガナ読み
// 3. 読み上げ中はボタンが「⏹ 停止」表示、再タップで停止（cancel呼び出し＋🔊に戻る）
// 4. 別の節をタップ→前をキャンセルして新しい節を読む
// 5. 番号のみモード：「5番」形式で読む
// 6. 共有リンクの閲覧モードでも🔊ボタンが使える
// 7. 375pxで横はみ出しなし
const { chromium, launchOptions } = require('./pw');
const path = require('path');

// 引数でURL指定可能（本番検証用）: node test_speech.js https://...
const URL = process.argv[2] || 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

// 「その名前が実際に読み上げられる文字列」を返す関数を作る（index.html の sname と同じ優先順位）。
// SPEECH_KANA の手動上書き＞KANAのフリガナ＞漢字のまま。
// ページからテーブルを取り出してNode側で判定する（ページ内でevalしない）
async function speechOfFactory(page) {
  const { kana, override } = await page.evaluate(() => ({
    kana: KANA,
    override: typeof SPEECH_KANA === 'undefined' ? {} : SPEECH_KANA,
  }));
  const fn = nm => override[nm] || kana[nm] || nm;
  fn.kana = kana;
  fn.override = override;
  return fn;
}

// speechSynthesis/SpeechSynthesisUtteranceをスタブ化（呼び出しを__ttsに記録）
const TTS_STUB = () => {
  window.__tts = { spoken: [], cancels: 0 };
  window.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
  };
  const stub = {
    speak(u) { window.__tts.spoken.push({ text: u.text, lang: u.lang, rate: u.rate, volume: u.volume }); },
    cancel() { window.__tts.cancels++; },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true });
};

(async () => {
  const browser = await chromium.launch(launchOptions());
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
  // 読み上げ専用の手動上書き（自動生成されないので、名簿から抜けた人の残骸が溜まりやすい）
  const overrideKeys = await page.evaluate(() =>
    typeof SPEECH_KANA === 'undefined' ? null : Object.keys(SPEECH_KANA));
  check('SPEECH_KANAが定義されている', Array.isArray(overrideKeys));
  const stray = await page.evaluate(() =>
    Object.keys(SPEECH_KANA).filter(n => !ROSTER.includes(n)));
  check('SPEECH_KANAのキーは全員ROSTERに在籍', stray.length === 0);
  if (stray.length) console.log('    名簿にない上書き: ' + stray.join(','));
  const overrideFilled = await page.evaluate(() =>
    Object.values(SPEECH_KANA).every(v => typeof v === 'string' && v.length > 0));
  check('SPEECH_KANAの値が空でない', overrideFilled);

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
  check('速度0.89（0.99から10%ダウン）', t1.rate === 0.89);
  check('音量は最大1.0', t1.volume === 1.0);
  check('「第1節の対戦を読み上げます！」で始まる（漢字かな交じり＝正しいアクセント）', (t1.text || '').startsWith('第1節の対戦を読み上げます！'));
  check('「！。」の重複句読点がない', !t1.text.includes('！。'));
  check('Aコート・Bコートを含む', t1.text.includes('Aコート') && t1.text.includes('Bコート'));
  check('「たい」（対戦）を含む', t1.text.includes('、たい、'));
  check('「やすみ」を含む（10人2コートは休み2人）', t1.text.includes('やすみ、'));
  const expected1 = await page.evaluate(() => roundSpeechText(session.rounds[0]));
  check('読み上げ文がroundSpeechTextと一致', t1.text === expected1);
  // 出場者全員が「読み上げ表記」で登場し、かつ漢字のままでは登場しないこと。
  // バレのように名前自体がカタカナ＝読み上げ表記と同一の人は「漢字で出ていない」判定の対象外
  const speechOf = await speechOfFactory(page);
  const namesInPlay = await page.evaluate(() => Object.values(session.names));
  const kanaUsed = namesInPlay.every(nm => t1.text.includes(speechOf(nm))) &&
    namesInPlay.filter(nm => speechOf(nm) !== nm).every(nm => !t1.text.includes(nm));
  check('漢字ではなくフリガナ（読み上げ表記）で読む', kanaUsed);

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
  check('第2節が読まれる', spoken4[spoken4.length - 1].text.startsWith('第2節の対戦を読み上げます！'));
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
  // フリガナも読み上げ上書き表記（カタカナ）も一切出ないこと
  const speechOf2 = await speechOfFactory(page2);
  const allReadings = [...Object.values(speechOf2.kana), ...Object.values(speechOf2.override)];
  check('フリガナ・読み上げ上書き表記を含まない', allReadings.every(k => !t5.includes(k)));
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
  check('閲覧者側でも読み上げできる', tv && tv.text.startsWith('第1節の対戦を読み上げます！'));
  const speechOfV = await speechOfFactory(viewer);
  const viewerNames = await viewer.evaluate(() => Object.values(session.names));
  check('閲覧者側もフリガナ（読み上げ表記）で読む',
    viewerNames.every(nm => tv.text.includes(speechOfV(nm))));
  await viewer.close();

  // --- 7. 読み上げ専用の表記上書き（2026-08-13ユーザー要望） ---
  // バレ: 'ばれ'だと平板で「バレる」に聞こえる → カタカナ'バレ'で頭高
  // 濱島: 'はましま'だとスマホで頭が飲まれ「マシマ」に聞こえる → カタカナ'ハマシマ'
  console.log('[7] 読み上げ専用の表記上書き（バレ・濱島）');
  const page3 = await context.newPage();
  page3.on('dialog', async d => await d.accept());
  await page3.goto(URL);
  // 2コート=8人ちょうど（休みなし）にして、第1節に必ず両名が出る状態を作る
  for (const nm of ['大野', '唐澤', '北原', '越野', '小林', '善志', 'バレ', '濱島']) {
    await page3.locator('#rosterChips .chip', { hasText: nm }).first().click();
  }
  await page3.selectOption('#courtCount', '2');
  await page3.selectOption('#roundCount', '10');
  await page3.click('#generateBtn');
  await page3.waitForSelector('.round-card');
  const rest1 = await page3.evaluate(() => session.rounds[0].resting.length);
  check('8人2コートなので第1節は休みなし＝両名が出場', rest1 === 0);
  await page3.locator('.btn-speak').first().click();
  const t7 = await page3.evaluate(() => window.__tts.spoken[0].text);
  check('バレを「バレ」（カタカナ）で読む', t7.includes('バレ'));
  check('バレを旧表記「ばれ」で読まない', !t7.includes('ばれ'));
  check('濱島を「ハマシマ」（カタカナ）で読む', t7.includes('ハマシマ'));
  check('濱島を旧表記「はましま」で読まない', !t7.includes('はましま'));
  // 上書きは読み上げ専用：画面の表示名は従来どおり漢字
  const shown = await page3.evaluate(() => document.body.innerText);
  check('画面表示は漢字「濱島」のまま', shown.includes('濱島'));
  check('画面に読み上げ用の「ハマシマ」が漏れない', !shown.includes('ハマシマ'));
  // 上書きの無い人は従来どおりKANAのフリガナで読む（上書き機構が他に波及しないこと）
  check('上書きの無い人はフリガナのまま（例: おおの）', t7.includes('おおの'));
  await page3.close();

  await browser.close();
  console.log(`\n合計: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})();
