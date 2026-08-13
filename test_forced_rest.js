// 指定休み（「第◯節は◯◯さんを必ず休み」）のブラウザ検証（Playwright、375px幅）
// 1. UI: 行の追加/削除・節数と参加者に追従するセレクト
// 2. 番号のみモード: 指定した節でその人が必ず休む・* 印・凡例
// 3. 名簿モード: 名前で指定 → 生成時にランダム番号へ変換されても本人が休む
// 4. バリデーション: 休みなし構成・枠オーバー・節数範囲外・メンバー外は生成させない
// 5. リロード復元（指定行・forcedRests・* 印）
// 6. メンバー変更: 残り節の指定は維持、消化済みは不変、枠不足は確認ダイアログ
// 7. 画像保存が指定ありでも成功し、凡例のぶん高くなる
// 8. 共有リンク（v3のまま）で閲覧者が落ちない
// 9. 指定なしのときは従来どおり（forcedRests なし・凡例なし）
const { chromium, launchOptions } = require('./pw');
const path = require('path');

const URL = process.argv[2] || 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name + (detail ? `  → ${detail}` : '')); }
}

// 指定行を1つ足して値を入れる
async function addRow(page, round, who) {
  await page.click('#forcedAddBtn');
  const row = page.locator('#forcedRestList .forced-row').last();
  await row.locator('.fr-round').selectOption(String(round));
  await row.locator('.fr-player').selectOption(who);
}

// 名簿チップを名前で選ぶ（部分一致の誤爆を避けるため完全一致で探す）
async function pickNames(page, names) {
  for (const nm of names) {
    await page.locator('#rosterChips .chip').filter({ hasText: new RegExp(`^${nm}$`) }).first().click();
  }
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const page = await context.newPage();
  let dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // ================= 1. UI =================
  console.log('[1] 指定行のUI');
  await page.goto(URL);
  check('初期状態は指定行なし', await page.locator('#forcedRestList .forced-row').count() === 0);

  await page.click('#forcedAddBtn');
  check('「＋ 追加」で1行増える', await page.locator('#forcedRestList .forced-row').count() === 1);
  check('節セレクトは節数ぶん（10節）', await page.locator('.fr-round option').count() === 10);
  const firstPeople = await page.locator('.fr-player option').allTextContents();
  check('番号のみモードでは「N番」が並ぶ', firstPeople[0] === '1番' && firstPeople.length === 18,
    `先頭=${firstPeople[0]} 件数=${firstPeople.length}`);

  await page.selectOption('#roundCount', '20');
  check('節数を20に変えるとセレクトも20件', await page.locator('.fr-round option').count() === 20);
  await page.selectOption('#roundCount', '10');

  // 選択値が作り直しで消えないこと
  await page.locator('.fr-round').first().selectOption('4');
  await page.locator('.fr-player').first().selectOption('p:7');
  await page.selectOption('#roundCount', '15');
  check('節数変更後も選んだ値が残る',
    await page.locator('.fr-round').first().inputValue() === '4' &&
    await page.locator('.fr-player').first().inputValue() === 'p:7');
  await page.selectOption('#roundCount', '10');

  await page.click('#forcedAddBtn');
  check('2行目を追加できる', await page.locator('#forcedRestList .forced-row').count() === 2);
  await page.locator('#forcedRestList .forced-row').last().locator('.forced-del').click();
  check('× で削除できる', await page.locator('#forcedRestList .forced-row').count() === 1);

  // ================= 2. 番号のみモード =================
  console.log('[2] 番号のみモードの反映');
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');   // 休み2人
  await page.selectOption('#roundCount', '10');
  await addRow(page, 3, 'p:5');
  await addRow(page, 7, 'p:5');
  await addRow(page, 7, 'p:12');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('生成時にエラーダイアログが出ない', dialogs.length === 0, dialogs.join(' / '));

  const s2 = await page.evaluate(() => session);
  check('第3節に5番が休み', s2.rounds[2].resting.includes(5), JSON.stringify(s2.rounds[2].resting));
  check('第7節に5番と12番が休み',
    s2.rounds[6].resting.includes(5) && s2.rounds[6].resting.includes(12),
    JSON.stringify(s2.rounds[6].resting));
  check('毎節の休みは2人のまま', s2.rounds.every(r => r.resting.length === 2));
  check('forcedRestsが保存されている',
    JSON.stringify(s2.forcedRests) === JSON.stringify({ 3: [5], 7: [5, 12] }),
    JSON.stringify(s2.forcedRests));

  const badge3 = await page.locator('.round-card').nth(2).locator('.rest-badge').textContent();
  check('指定した人に * が付く', /5番\*/.test(badge3), badge3);
  const badge1 = await page.locator('.round-card').nth(0).locator('.rest-badge').textContent();
  check('指定していない節には * が付かない', !badge1.includes('*'), badge1);
  // textContent だと <script> のソースまで拾ってしまうので、見えているテキストで判定する
  check('* の凡例が出る', (await page.locator('#results').innerText()).includes('は指定した休み'));

  // 指定を受けていない人同士の公平性は保たれる
  const fair = await page.evaluate(() => {
    const counts = {};
    session.players.forEach(p => counts[p] = 0);
    session.rounds.forEach(r => r.resting.forEach(p => counts[p]++));
    const forced = new Set();
    for (const rn in session.forcedRests) session.forcedRests[rn].forEach(p => forced.add(p));
    const others = session.players.filter(p => !forced.has(p)).map(p => counts[p]);
    return { diff: Math.max(...others) - Math.min(...others), five: counts[5] };
  });
  check('指定を受けていない人同士の休み差は1以下', fair.diff <= 1, `差=${fair.diff}`);
  check('指定された5番は2回以上休んでいる', fair.five >= 2, `5番=${fair.five}回`);

  // ================= 3. 名簿モード（名前→番号変換） =================
  console.log('[3] 名簿モードの反映');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#roundCount', '10');
  await pickNames(page, ['大野', '唐澤', '北原', '越野', '小林', '善志', '高橋', '原',
                         'バレ', '根津', '細井', '松武', '宮澤輝', '渡辺', '濱島', '内田', '春日', '黒河内']);
  check('18人選択で休み2人', (await page.locator('#infoBox').textContent()).includes('2人が休み'));
  await addRow(page, 4, 'n:濱島');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('名簿モードでもエラーなく生成', dialogs.length === 0, dialogs.join(' / '));

  const s3 = await page.evaluate(() => session);
  const hamaNum = Object.keys(s3.names).find(k => s3.names[k] === '濱島');
  check('濱島の番号がランダムに決まっている', !!hamaNum);
  check('第4節に濱島が休んでいる（名前→番号に変換された）',
    s3.rounds[3].resting.includes(Number(hamaNum)),
    `濱島=${hamaNum}番 / 休み=${JSON.stringify(s3.rounds[3].resting)}`);
  check('forcedRestsは番号で保存される',
    JSON.stringify(s3.forcedRests) === JSON.stringify({ 4: [Number(hamaNum)] }),
    JSON.stringify(s3.forcedRests));
  const badge4 = await page.locator('.round-card').nth(3).locator('.rest-badge').textContent();
  check('名簿モードでも * が付く', badge4.includes('濱島*'), badge4);

  // ================= 4. バリデーション =================
  console.log('[4] バリデーション');
  // 4-1 休みが出ない構成
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '16');   // 休み0人
  await addRow(page, 2, 'p:3');
  check('休みなし構成では注意書きが赤く出る',
    (await page.locator('#forcedRestNote').textContent()).includes('休みが出ない'));
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForTimeout(200);
  check('休みなし構成では生成せずに知らせる',
    dialogs.length === 1 && dialogs[0].includes('休みが出ない構成'),
    dialogs.join(' / '));
  check('コート割は作られていない', await page.locator('.round-card').count() === 0);

  // 4-2 休み枠オーバー
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');   // 休み2人
  await addRow(page, 2, 'p:1');
  await addRow(page, 2, 'p:2');
  await addRow(page, 2, 'p:3');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForTimeout(200);
  check('休み枠を超える指定は生成せずに知らせる',
    dialogs.length === 1 && dialogs[0].includes('休みは2人までです'),
    dialogs.join(' / '));

  // 4-3 節数を減らして指定した節が無くなったとき
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '20');
  await addRow(page, 18, 'p:4');
  await page.selectOption('#roundCount', '10');
  check('無くなった節の指定は第1節に化けない（空値になる）',
    await page.locator('.fr-round').first().inputValue() === '',
    await page.locator('.fr-round').first().inputValue());
  check('節セレクトに「第18節（今は対象外）」と出る',
    (await page.locator('.fr-round').first().locator('option:checked').textContent()).includes('第18節'));
  check('注意書きが赤字で知らせる（節が無くなった場合）',
    (await page.locator('#forcedRestNote').textContent()).includes('対象外になっています'));
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('対象外の節指定は無視して生成される',
    await page.evaluate(() => session.forcedRests === null) &&
    await page.locator('.round-card').count() === 10,
    JSON.stringify(await page.evaluate(() => session.forcedRests)));

  // 4-4 名簿から外した人の指定
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#roundCount', '10');
  await pickNames(page, ['大野', '唐澤', '北原', '越野', '小林', '善志', '高橋', '原', 'バレ', '根津']);
  await addRow(page, 3, 'n:バレ');
  await pickNames(page, ['バレ']);   // 選択を外す
  // 黙って別人の指定にすり替わらないこと（すり替わると気づかないまま別人が休みになる）
  check('外れた人の指定は別人に化けない（空値になる）',
    await page.locator('.fr-player').first().inputValue() === '');
  check('選択肢に「今は対象外」と表示される',
    (await page.locator('.fr-player').first().locator('option:checked').textContent()).includes('対象外'));
  check('注意書きが赤字で知らせる',
    (await page.locator('#forcedRestNote').textContent()).includes('対象外になっています'));
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('対象外の指定は無視して生成される（別人は休みにならない）',
    await page.evaluate(() => session.forcedRests === null),
    JSON.stringify(await page.evaluate(() => session.forcedRests)));

  // ================= 5. リロード復元 =================
  console.log('[5] リロード復元');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  await addRow(page, 3, 'p:5');
  await addRow(page, 8, 'p:9');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const before5 = await page.evaluate(() => JSON.stringify(session.rounds));
  await page.reload();
  await page.waitForSelector('.round-card');
  check('対戦表がそのまま復元される',
    before5 === await page.evaluate(() => JSON.stringify(session.rounds)));
  check('forcedRestsが復元される',
    JSON.stringify(await page.evaluate(() => session.forcedRests)) === JSON.stringify({ 3: [5], 8: [9] }));
  check('指定行も2行復元される', await page.locator('#forcedRestList .forced-row').count() === 2);
  const restoredRows = await page.locator('#forcedRestList .forced-row').evaluateAll(rows =>
    rows.map(r => r.querySelector('.fr-round').value + '/' + r.querySelector('.fr-player').value));
  check('復元された指定行の中身が一致', JSON.stringify(restoredRows) === JSON.stringify(['3/p:5', '8/p:9']),
    JSON.stringify(restoredRows));
  check('復元後も * が付く',
    (await page.locator('.round-card').nth(2).locator('.rest-badge').textContent()).includes('5番*'));

  // 壊れた forcedRests でも落ちない
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('badminton-court-session-v1'));
    raw.session.forcedRests = { 'x': 'こわれ', 99: [1], 3: 'not-array' };
    localStorage.setItem('badminton-court-session-v1', JSON.stringify(raw));
  });
  const errsBefore = pageErrors.length;
  await page.reload();
  await page.waitForSelector('.round-card');
  check('壊れた指定データでも復元でき、例外が出ない',
    pageErrors.length === errsBefore && await page.locator('.round-card').count() === 10,
    pageErrors.slice(errsBefore).join(' / '));

  // ================= 6. メンバー変更 =================
  console.log('[6] メンバー変更との併用');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  await addRow(page, 2, 'p:5');    // 消化済みになる節
  await addRow(page, 9, 'p:5');    // 作り直す節
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const keptRounds = await page.evaluate(() => JSON.stringify(session.rounds.slice(0, 5)));

  await page.selectOption('#consumedRound', '5');
  await page.selectOption('#addCount', '1');
  dialogs = [];
  await page.click('.btn-change');
  await page.waitForFunction(() => session.players.length === 19);
  check('消化済みの節（第2節の指定含む）は変わらない',
    keptRounds === await page.evaluate(() => JSON.stringify(session.rounds.slice(0, 5))));
  check('作り直した区間の指定（第9節の5番）も守られる',
    await page.evaluate(() => session.rounds[8].resting.includes(5)),
    JSON.stringify(await page.evaluate(() => session.rounds[8].resting)));
  check('メンバー変更後も休み人数が正しい（19人4コート＝3人）',
    await page.evaluate(() => session.rounds.slice(5).every(r => r.resting.length === 3)));

  // 休み枠が減って入り切らないケース（確認ダイアログ）
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '2');
  await page.selectOption('#playerCount', '10');   // 休み2人
  await page.selectOption('#roundCount', '10');
  await addRow(page, 9, 'p:1');
  await addRow(page, 9, 'p:2');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  await page.selectOption('#consumedRound', '5');
  await page.selectOption('#changeCourtCount', '2');
  // 指定した1・2番ではない人を2人離脱させて休み0人にする
  // （指定者本人を抜くと「在籍しない指定」として消えてしまい、枠不足の検証にならない）
  const removeTargets = await page.locator('#removeChips .chip').evaluateAll(chips =>
    chips.map(c => Number(c.dataset.num)).filter(n => n !== 1 && n !== 2).slice(0, 2));
  for (const num of removeTargets) {
    await page.locator(`#removeChips .chip[data-num="${num}"]`).click();
  }
  dialogs = [];
  await page.click('.btn-change');
  await page.waitForTimeout(300);
  check('休み枠が足りないときは確認ダイアログで知らせる',
    dialogs.some(d => d.includes('一部しか反映できません')), dialogs.join(' / '));

  // ================= 7. 画像保存 =================
  console.log('[7] 画像保存');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const plainH = await page.evaluate(async () => {
    const c = buildImageCanvas ? null : null;
    return null;
  }).catch(() => null);
  // 指定なしの画像の高さを取る（createElementをフックして描画済みCanvasを拾う）
  const grabHeight = async (chunk = 0) => await page.evaluate(async i => {
    const made = [];
    const orig = document.createElement.bind(document);
    document.createElement = tag => { const el = orig(tag); if (tag === 'canvas') made.push(el); return el; };
    await saveAsImage(i);
    document.createElement = orig;
    const c = made.filter(el => el.width > 0 && el.height > 0).pop();
    return c ? { w: c.width, h: c.height } : null;
  }, chunk);
  const sizeNoForced = await grabHeight();
  check('指定なしで画像が作れる', !!sizeNoForced && sizeNoForced.h > 0, JSON.stringify(sizeNoForced));

  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  await addRow(page, 3, 'p:5');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  const sizeForced = await grabHeight();
  check('指定ありでも画像が作れる（例外・アラートなし）',
    !!sizeForced && sizeForced.h > 0 && dialogs.length === 0,
    `${JSON.stringify(sizeForced)} dialogs=${dialogs.join('/')}`);
  check('凡例のぶん画像が高くなる（幅は同じ）',
    sizeForced && sizeNoForced && sizeForced.w === sizeNoForced.w && sizeForced.h > sizeNoForced.h,
    `なし=${JSON.stringify(sizeNoForced)} あり=${JSON.stringify(sizeForced)}`);

  // 画像は10節ごとに分割されるので、* が出ない側の画像に凡例を出さないこと
  const sizes = {};
  for (const [key, forced] of [['plain', null], ['forced', 3]]) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(URL);
    await page.selectOption('#courtCount', '4');
    await page.selectOption('#playerCount', '18');
    await page.selectOption('#roundCount', '20');
    if (forced) await addRow(page, forced, 'p:5');
    dialogs = [];
    await page.click('#generateBtn');
    await page.waitForSelector('.round-card');
    sizes[key] = [await grabHeight(0), await grabHeight(1)];
  }
  check('20節は画像2枚になる', sizes.plain[0] && sizes.plain[1]);
  check('第3節に指定 → 1枚目（第1〜10節）だけ凡例のぶん高い',
    sizes.forced[0].h > sizes.plain[0].h,
    `なし=${sizes.plain[0].h} あり=${sizes.forced[0].h}`);
  check('* が出ない2枚目（第11〜20節）には凡例を出さない',
    sizes.forced[1].h === sizes.plain[1].h,
    `なし=${sizes.plain[1].h} あり=${sizes.forced[1].h}`);

  // ================= 8. 共有リンク =================
  console.log('[8] 共有リンク（v3のまま）');
  const shareUrl = await page.evaluate(() => buildShareUrl());
  const viewerCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const viewer = await viewerCtx.newPage();
  const viewerErrors = [];
  viewer.on('pageerror', e => viewerErrors.push(String(e)));
  viewer.on('dialog', async d => await d.accept());
  await viewer.goto(shareUrl);
  await viewer.waitForSelector('.round-card');
  check('閲覧モードで開ける', await viewer.evaluate(() => viewerMode === true));
  check('対戦表（休みの中身）は共有先でも一致',
    await page.evaluate(() => JSON.stringify(session.rounds)) ===
    await viewer.evaluate(() => JSON.stringify(session.rounds)));
  check('共有先で例外が出ない', viewerErrors.length === 0, viewerErrors.join(' / '));
  check('共有先には指定情報が渡らない（v3のまま・* は出ない）',
    await viewer.evaluate(() => !session.forcedRests) &&
    !(await viewer.locator('.round-card').nth(2).locator('.rest-badge').textContent()).includes('*'));
  await viewerCtx.close();

  // ================= 9. 指定なしの回帰 =================
  console.log('[9] 指定なしのときは従来どおり');
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await page.selectOption('#courtCount', '4');
  await page.selectOption('#playerCount', '18');
  await page.selectOption('#roundCount', '10');
  dialogs = [];
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
  check('forcedRestsはnull', await page.evaluate(() => session.forcedRests === null));
  check('* 印はどこにも出ない',
    !(await page.locator('#results').innerText()).includes('*'));
  check('凡例も出ない', !(await page.locator('#results').innerText()).includes('は指定した休み'));
  const restDiff = await page.evaluate(() => {
    const counts = {};
    session.players.forEach(p => counts[p] = 0);
    session.rounds.forEach(r => r.resting.forEach(p => counts[p]++));
    const v = Object.values(counts);
    return Math.max(...v) - Math.min(...v);
  });
  check('休み回数の差は従来どおり1以下', restDiff <= 1, `差=${restDiff}`);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0, `overflow=${overflow}`);

  check('ページ例外が最後まで発生していない', pageErrors.length === 0, pageErrors.join(' / '));

  await browser.close();
  console.log(`\n合計: ${pass + fail} 項目 / OK ${pass} / NG ${fail}`);
  console.log(fail === 0 ? '✅ 指定休み ブラウザ検証 全合格' : '❌ 失敗あり');
  process.exit(fail > 0 ? 1 : 0);
})();
