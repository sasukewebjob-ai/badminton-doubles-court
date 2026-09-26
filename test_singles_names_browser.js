// シングルス・固定ペア版の名前表示（2026-09-26追加）の画面テスト（Playwright、375px幅）
// - 固定ペアは名簿をタップした順に2人ずつペア番号が付く／シングルスは作成時にランダム
// - 対戦表・休み・集計・途中変更欄・読み上げ・共有リンク・再読み込みに名前が出る
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const url = pathToFileURL(path.join(__dirname, 'singles.html')).href;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail ? ' → ' + detail : '')); }
}
const TTS_STUB = () => {
  window.__tts = [];
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', { value: { speak(u) { window.__tts.push(u.text); }, cancel() {} }, configurable: true });
};

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    await context.addInitScript(TTS_STUB);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const tap = nm => page.click(`#rosterChips button[data-name="${nm}"]`);
    const preview = () => page.$$eval('#pairPreview li', lis => lis.map(li => li.textContent));

    console.log('[1] 固定ペア: タップ順でペア番号');
    await page.selectOption('#mode', 'pairs');
    await page.selectOption('#courtCount', '2');
    check('名簿を選ぶ前は人数欄が出ている', await page.isVisible('#playerCount'));
    for (const nm of ['上條', '濱島', '大野', '田中', '依田']) await tap(nm);
    check('奇数人数では作成できず「あと1人」と案内', await page.isDisabled('#generateBtn') && (await page.textContent('#rosterInfo')).includes('あと1人'));
    check('名簿から選ぶと人数欄は隠れる', !(await page.isVisible('#playerCount')));
    await tap('バレ');
    check('タップ順に2人ずつペアになる', JSON.stringify(await preview()) === JSON.stringify(['1番ペア：上條・濱島', '2番ペア：大野・田中', '3番ペア：依田・バレ']), JSON.stringify(await preview()));
    const badges = await page.$$eval('#rosterChips button.selected', bs => bs.map(b => b.textContent));
    check('選んだチップにペア番号が付く', badges.includes('1上條') && badges.includes('3バレ'), badges.join(','));
    await tap('大野');
    check('途中の人を外すと後ろの人が繰り上がる', JSON.stringify(await preview()) === JSON.stringify(['1番ペア：上條・濱島', '2番ペア：田中・依田', '3番ペア：バレ・（あと1人）']), JSON.stringify(await preview()));
    await tap('大野');
    for (const nm of ['春日', '原', '宮下', '根津']) await tap(nm);
    check('5ペア・2コートで作成できる', !(await page.isDisabled('#generateBtn')) && (await page.textContent('#infoBox')).includes('毎節4ペアが対戦し、1ペアが休みます'), await page.textContent('#infoBox'));
    await page.click('#forcedBox summary');
    await page.fill('#forcedRests', '4: 濱島');
    await page.click('#generateBtn');
    const s1 = await page.evaluate(() => ({ names: session.names, forced: session.forced }));
    check('ペア番号はタップ順（1番ペア＝上條・濱島 … 5番ペア＝宮下・根津）',
      JSON.stringify(s1.names) === JSON.stringify({ 1: ['上條', '濱島'], 2: ['田中', '依田'], 3: ['バレ', '大野'], 4: ['春日', '原'], 5: ['宮下', '根津'] }), JSON.stringify(s1.names));
    check('名前での休み指定はその人のペア番号になる', JSON.stringify(s1.forced) === '{"4":[1]}', JSON.stringify(s1.forced));
    const round4 = await page.locator('.round-card').nth(3).textContent();
    check('対戦表に名前が出る／指定休みに * が付く', round4.includes('1 上條・濱島*') && /\d [^\s]+・[^\s]+vs/.test(round4), round4);
    const stats = await page.$$eval('.stats div', ds => ds.map(d => d.textContent));
    check('集計欄は「1番ペア」の下に名前', stats[0].startsWith('1番ペア上條・濱島'), stats[0]);
    await page.click('#changePanel summary');
    const memberChip = await page.$$eval('#memberChips label', ls => ls.map(l => l.textContent));
    check('途中変更欄に名前が出て、名前の無い番号は「6番」のまま', memberChip[0] === '1 上條・濱島' && memberChip[5] === '6番', memberChip.join(','));
    await page.locator('.round-card').first().getByRole('button', { name: '🔊 読み上げ' }).click();
    const spoken = await page.evaluate(() => window.__tts[0]);
    check('読み上げはフリガナ（濱島は「ハマシマ」）', spoken.includes('かみじょう、ハマシマ') || spoken.includes('たなか、よだ'), spoken);
    check('375px幅で横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= 375));

    console.log('[2] 再読み込みで作成時のメンバーに戻る');
    await page.reload();
    const restored = await page.evaluate(() => ({ picks: rosterPicks.slice(), mode: document.getElementById('mode').value, forced: document.getElementById('forcedRests').value }));
    check('固定ペアの選択順が戻る', JSON.stringify(restored.picks) === JSON.stringify(['上條', '濱島', '田中', '依田', 'バレ', '大野', '春日', '原', '宮下', '根津']) && restored.mode === 'pairs', JSON.stringify(restored));
    check('休み指定は番号で戻る（固定ペアの番号は変わらない）', restored.forced === '4: 1', restored.forced);
    check('再読み込み後もペア番号の表示が同じ', JSON.stringify(await preview()) === JSON.stringify(['1番ペア：上條・濱島', '2番ペア：田中・依田', '3番ペア：バレ・大野', '4番ペア：春日・原', '5番ペア：宮下・根津']), JSON.stringify(await preview()));

    console.log('[3] 共有リンク');
    const hash = await page.evaluate(() => '#sp1=' + encodeShare(session));
    const viewer = await context.newPage();
    viewer.on('pageerror', e => errors.push(e.message));
    await viewer.goto(url + hash);
    const vtext = await viewer.textContent('#results');
    check('共有先でも名前が出る', vtext.includes('上條・濱島') && (await viewer.textContent('#status')).includes('共有された対戦表'), await viewer.textContent('#status'));
    const crafted = await page.evaluate(() => {
      const s = JSON.parse(JSON.stringify(session));
      s.names[1] = ['<b>太字</b>', '<i>x</i>'];
      return '#sp1=' + encodeShare(s);
    });
    await viewer.goto('about:blank');
    await viewer.goto(url + crafted);
    const xss = await viewer.evaluate(() => ({ tags: document.querySelectorAll('#results b, #results i, #summary b, #summary i').length, text: document.getElementById('results').textContent.includes('<b>太字</b>') }));
    check('細工した名前はタグにならず文字として出る', xss.tags === 0 && xss.text, JSON.stringify(xss));
    const longName = await page.evaluate(() => { const s = JSON.parse(JSON.stringify(session)); s.names[1] = ['あ'.repeat(21), 'x']; return '#sp1=' + encodeShare(s); });
    await viewer.goto('about:blank');
    await viewer.goto(url + longName);
    check('長すぎる名前を含むリンクは受け付けない', (await viewer.textContent('#status')).includes('正しくありません') && await viewer.locator('.round-card').count() === 0, await viewer.textContent('#status'));

    console.log('[4] シングルス: 番号はランダム');
    await page.click('#summary >> text=消去して最初から');
    await page.selectOption('#mode', 'singles');
    check('固定ペアで選んだ10人はシングルスでも選択中', (await page.textContent('#rosterInfo')).includes('10人'));
    await page.click('#rosterClear');
    const roster = await page.evaluate(() => ROSTER.slice());
    for (const nm of roster.slice(0, 12)) await tap(nm);
    await tap(roster[12]);
    check('シングルスは13人目を選べない', (await page.textContent('#status')).includes('12人まで') && (await page.evaluate(() => rosterPicks.length)) === 12);
    await page.selectOption('#courtCount', '4');
    await page.fill('#forcedRests', '');
    const orders = new Set();
    for (let i = 0; i < 5; i++) {
      await page.click('#generateBtn');
      const names = await page.evaluate(() => session.names);
      const vals = Object.values(names);
      if (vals.length !== 12 || new Set(vals).size !== 12 || !vals.every(v => roster.slice(0, 12).includes(v))) { orders.add('bad'); break; }
      orders.add(JSON.stringify(names));
    }
    check('12人全員に1〜12番が1つずつ付く', !orders.has('bad'));
    check('作るたびに番号がランダムに変わる（5回中2通り以上）', orders.size >= 2, `${orders.size}通り`);
    await page.fill('#forcedRests', `2: ${roster[0]}\n3: ${roster[20]}`);
    await page.click('#generateBtn');
    check('選んでいない人の休み指定は案内して作成しない', (await page.textContent('#status')).includes(`「${roster[20]}」は参加メンバーにいません`), await page.textContent('#status'));
    await page.fill('#forcedRests', `2: ${roster[0]}`);
    await page.click('#generateBtn');
    const num = await page.evaluate(nm => Number(Object.keys(session.names).find(k => session.names[k] === nm)), roster[0]);
    check('シングルスの名前の休み指定はその人の番号になる', JSON.stringify(await page.evaluate(() => session.forced)) === `{"2":[${num}]}`);
    await page.reload();
    check('再読み込み後、シングルスの休み指定は名前で戻る（番号は作り直すと変わるため）', (await page.inputValue('#forcedRests')) === `2: ${roster[0]}`, await page.inputValue('#forcedRests'));

    console.log('[5] 種目の切り替え');
    await page.click('#summary >> text=消去して最初から');
    await page.selectOption('#mode', 'pairs');
    for (const nm of roster.slice(12, 24)) await tap(nm);
    await page.selectOption('#mode', 'singles');
    check('24人選んだままシングルスにすると12人までと案内して作成できない', await page.isDisabled('#generateBtn') && (await page.textContent('#infoBox')).includes('12人まで'), await page.textContent('#infoBox'));
    await page.click('#rosterClear');
    await page.fill('#forcedRests', '');
    check('全解除で番号のみの作成に戻る', await page.isVisible('#playerCount') && (await page.textContent('#rosterInfo')).includes('番号のみ'));
    await page.click('#generateBtn');
    check('番号のみの作成は従来どおり（名前なし）', await page.evaluate(() => !('names' in session)) && (await page.locator('.round-card').first().textContent()).includes('番'));
    check('ページエラーなし', errors.length === 0, errors.join(' / '));
  } finally {
    await browser.close();
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
