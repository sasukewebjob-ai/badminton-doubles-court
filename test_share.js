// 対戦表の共有リンク（URL埋め込み）の検証（Playwright）
// 1. エンコード/デコードの往復一致・URL長
// 2. 共有リンクを別ブラウザ（別localStorage）で開くと同じ対戦表が見える（閲覧モード）
// 3. 閲覧者のlocalStorageを汚さない・編集UIが出ない
// 4. メンバー変更後の再共有が反映される（ハッシュだけの遷移でも更新される）
// 5. 自分のコート割を持つ人が共有を見ても、自分のデータに戻れる
// 6. 壊れたリンクは警告して通常モードにフォールバック
const { chromium, launchOptions } = require('./pw');
const path = require('path');

// 引数でURLを指定すると本番検証に使える（省略時はローカルのindex.html）
const URL = process.argv[2] || 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name); }
}

(async () => {
  const browser = await chromium.launch(launchOptions());

  // --- ホスト（共有する側） ---
  const hostCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const host = await hostCtx.newPage();
  host.on('dialog', async d => { await d.accept(); });

  console.log('[1] エンコード/デコードの往復一致');
  await host.goto(URL);
  await host.selectOption('#courtCount', '4');
  await host.selectOption('#playerCount', '18');
  await host.selectOption('#roundCount', '10');
  await host.click('#generateBtn');
  await host.waitForSelector('.round-card');

  const roundtrip = await host.evaluate(() => {
    const decoded = decodeShareData(encodeShareData());
    if (!decoded) return { ok: false };
    const s = decoded.session;
    const norm = JSON.parse(JSON.stringify(session));
    norm.changes.forEach(c => { if (!c.returned) c.returned = []; });
    const pick = o => JSON.stringify({
      totalRounds: o.totalRounds, initialCourts: o.initialCourts, restOrder: o.restOrder,
      maxNumber: o.maxNumber, players: o.players, everPlayers: o.everPlayers,
      changes: o.changes, rounds: o.rounds
    });
    return {
      ok: pick(s) === pick(norm),
      sharedAtValid: Math.abs(decoded.sharedAt - Date.now()) < 120000
    };
  });
  check('デコード結果がセッションと一致', roundtrip.ok);
  check('作成時刻が現在時刻と一致（±2分）', roundtrip.sharedAtValid);

  const url1 = await host.evaluate(() => buildShareUrl());
  check('URL長が常識的（1000文字未満）', url1.length < 1000);
  const hostRounds = await host.evaluate(() => JSON.stringify(session.rounds));

  // --- 閲覧者（まっさらな別ブラウザ） ---
  console.log('[2] 共有リンクを別ブラウザで開く');
  const viewCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const viewer = await viewCtx.newPage();
  const viewerDialogs = [];
  viewer.on('dialog', async d => { viewerDialogs.push(d.message()); await d.accept(); });

  await viewer.goto(url1);
  await viewer.waitForSelector('.round-card');
  check('10節が表示される', await viewer.locator('.round-card').count() === 10);
  const viewerRounds = await viewer.evaluate(() => JSON.stringify(session.rounds));
  check('割当内容がホストと完全一致', viewerRounds === hostRounds);
  check('閲覧バナーが出る', await viewer.locator('.viewer-banner').count() === 1);
  check('入力セクションは非表示', await viewer.locator('.input-section').isHidden());
  check('メンバー変更UIは出ない', await viewer.locator('.change-section').count() === 0);
  check('休み回数表は見える', await viewer.locator('.stats-table').count() === 1);
  check('共有ボタンも見える（転送可）', await viewer.locator('.btn-share').count() === 1);

  console.log('[3] 閲覧者のデータを汚さない');
  check('閲覧者のlocalStorageは空のまま',
    await viewer.evaluate(() => localStorage.getItem('badminton-court-session-v1')) === null);
  const overflow = await viewer.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('375pxで横はみ出しなし', overflow <= 0);

  // --- メンバー変更 → 再共有 ---
  console.log('[4] メンバー変更後の再共有');
  await host.selectOption('#consumedRound', '3');
  await host.selectOption('#addCount', '2'); // 19,20番追加
  await host.click('.btn-change');
  await host.waitForSelector('.change-divider');
  const url2 = await host.evaluate(() => buildShareUrl());
  check('変更後はURLが変わる', url2 !== url1);

  // 開いたままのタブにハッシュだけ変わったリンクが来ても反映される
  await viewer.evaluate(u => { location.href = u; }, url2).catch(() => {});
  await viewer.waitForFunction(
    () => typeof session !== 'undefined' && session && session.players.length === 20,
    null, { timeout: 5000 });
  check('再共有で20人に更新（ハッシュ遷移）', true);
  check('変更マーカーも表示', await viewer.locator('.change-divider').count() === 1);

  // --- 自分のデータを持つ閲覧者 ---
  console.log('[5] 自分のコート割を持つ人が共有を見る');
  const ownCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const own = await ownCtx.newPage();
  own.on('dialog', async d => { await d.accept(); });
  await own.goto(URL);
  await own.selectOption('#courtCount', '2');
  await own.selectOption('#playerCount', '8');
  await own.selectOption('#roundCount', '15');
  await own.click('#generateBtn');
  await own.waitForSelector('.round-card');
  check('自分の15節を生成', await own.locator('.round-card').count() === 15);

  await own.goto(url1);
  await own.waitForSelector('.viewer-banner');
  check('共有の10節が表示される', await own.locator('.round-card').count() === 10);
  check('自分の保存データは残っている',
    await own.evaluate(() => JSON.parse(localStorage.getItem('badminton-court-session-v1')).session.rounds.length) === 15);

  await own.click('.viewer-banner button');
  await own.waitForSelector('.restore-banner');
  check('「自分のコート割を作る」で自分の15節に戻る', await own.locator('.round-card').count() === 15);
  check('入力セクションも戻る', await own.locator('.input-section').isVisible());

  // --- 壊れたリンク ---
  console.log('[6] 壊れたリンクのフォールバック');
  const brokenCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const broken = await brokenCtx.newPage();
  const brokenDialogs = [];
  broken.on('dialog', async d => { brokenDialogs.push(d.message()); await d.accept(); });
  await broken.goto(URL + '#s=' + url1.split('#s=')[1].slice(0, 20)); // 途中で切れたリンク
  await broken.waitForTimeout(500);
  check('警告が出る', brokenDialogs.some(m => m.includes('読み込めません')));
  check('通常モードで起動（入力セクション表示）', await broken.locator('.input-section').isVisible());
  check('対戦表は表示されない', await broken.locator('.round-card').count() === 0);

  // --- 細工された共有データ（2026-07-25追加） ---
  console.log('[7] 仕様外の共有データを拒否する（内容検証）');
  const tamper = await host.evaluate(() => {
    const real = session;                               // 実物は最後に戻す
    const orig = JSON.parse(JSON.stringify(session));
    const clone = () => JSON.parse(JSON.stringify(orig));
    const encodeWith = (s) => { session = s; const out = encodeShareData(); session = real; return out; };
    const accepts = (s) => decodeShareData(encodeWith(s)) !== null;
    const rejects = (s) => decodeShareData(encodeWith(s)) === null;

    // 指定のコート数・人数・節数で内部的に矛盾のないセッションを作る
    // （拒否理由を1つに絞るため、検証したい項目以外はすべて正しい値にしておく）
    const synth = (courts, players, rounds) => {
      const all = Array.from({ length: players }, (_, i) => i + 1);
      const rs = [];
      for (let r = 0; r < rounds; r++) {
        const assignments = [];
        for (let c = 0; c < courts; c++) {
          const b = c * 4;
          assignments.push({ pair1: [all[b], all[b + 1]], pair2: [all[b + 2], all[b + 3]] });
        }
        const playing = new Set();
        assignments.forEach(a => a.pair1.concat(a.pair2).forEach(p => playing.add(p)));
        rs.push({ round: r + 1, resting: all.filter(p => !playing.has(p)), assignments });
      }
      return {
        totalRounds: rounds, initialCourts: courts, courts, restOrder: 'asc',
        players: all, everPlayers: all, maxNumber: players,
        names: null, genderMode: false, guestGenders: null, changes: [], rounds: rs
      };
    };

    const stretch = (s, rounds) => {
      s.totalRounds = rounds;
      while (s.rounds.length < rounds) {
        const c = JSON.parse(JSON.stringify(s.rounds[0]));
        c.round = s.rounds.length + 1;
        s.rounds.push(c);
      }
      return s;
    };

    const r = {};
    // 正常データは今までどおり通る（過剰な検証で正規リンクを壊していないか）
    r.validReal = accepts(clone());
    r.validSynth = accepts(synth(4, 16, 10));
    r.validNames = (() => { const s = clone(); s.names = { 1: 'テスト' }; return accepts(s); })();

    // レビュー指摘の「5コート・31節・各節0コート」
    r.courts5 = rejects(synth(5, 20, 10));
    r.courts0 = rejects(synth(0, 20, 10));
    r.rounds31 = rejects(stretch(synth(4, 16, 10), 31));
    r.rounds9 = rejects((() => { const s = synth(4, 16, 10); s.totalRounds = 9; s.rounds.pop(); return s; })());
    r.reviewPayload = rejects(stretch(synth(0, 20, 10), 31));

    // 人数・番号の範囲
    r.players27 = rejects(synth(4, 27, 10));
    r.numberOutOfRange = rejects((() => { const s = clone(); s.rounds[0].resting[0] = 999; return s; })());

    // 節の整合性
    r.roundCountMismatch = rejects((() => { const s = clone(); s.rounds.pop(); return s; })());
    r.roundNumberSkip = rejects((() => { const s = clone(); s.rounds[4].round = 99; return s; })());
    r.courtCountMismatch = rejects((() => { const s = clone(); s.rounds[5].assignments.pop(); return s; })());
    r.duplicatePlayer = rejects((() => {
      const s = clone();
      s.rounds[0].assignments[1].pair1[0] = s.rounds[0].assignments[0].pair1[0];
      return s;
    })());
    r.restingConflict = rejects((() => {
      const s = clone();
      s.rounds[0].resting.push(s.rounds[0].assignments[0].pair1[0]);
      return s;
    })());

    // 変更履歴の整合性
    r.changeCourts9 = rejects((() => { const s = clone(); s.changes[0].courts = 9; return s; })());
    r.changeAtRound0 = rejects((() => { const s = clone(); s.changes[0].atRound = 0; return s; })());

    // 名前ブロックのキーが参加者の範囲外
    r.nameOutOfRange = rejects((() => { const s = clone(); s.names = { 999: 'テスト' }; return s; })());

    session = real;
    return r;
  });
  check('正常な共有データ（メンバー変更あり）は通る', tamper.validReal);
  check('正常な合成データ（4c16p10節）も通る', tamper.validSynth);
  check('名前付きの正常データも通る', tamper.validNames);
  check('5コートは拒否', tamper.courts5);
  check('0コートは拒否', tamper.courts0);
  check('31節は拒否', tamper.rounds31);
  check('9節（下限未満）は拒否', tamper.rounds9);
  check('レビュー指摘の payload（31節×0コート）は拒否', tamper.reviewPayload);
  check('27人は拒否', tamper.players27);
  check('範囲外の番号は拒否', tamper.numberOutOfRange);
  check('節数と totalRounds の不一致は拒否', tamper.roundCountMismatch);
  check('節番号の飛びは拒否', tamper.roundNumberSkip);
  check('変更履歴と合わないコート数の節は拒否', tamper.courtCountMismatch);
  check('同じ節に同じ人が二重登場は拒否', tamper.duplicatePlayer);
  check('出場者が休みにも入っていたら拒否', tamper.restingConflict);
  check('変更履歴のコート数9は拒否', tamper.changeCourts9);
  check('変更履歴の節番号0は拒否', tamper.changeAtRound0);
  check('参加者にない番号の名前は拒否', tamper.nameOutOfRange);

  // 細工リンクを実際に開いても閲覧モードにならず警告が出る
  const badSession = await host.evaluate(() => {
    const real = session;
    const s = JSON.parse(JSON.stringify(session));
    s.totalRounds = 31;
    while (s.rounds.length < 31) {
      const c = JSON.parse(JSON.stringify(s.rounds[0]));
      c.round = s.rounds.length + 1;
      s.rounds.push(c);
    }
    session = s;
    const out = encodeShareData();
    session = real;
    return out;
  });
  const badCtx = await browser.newContext({ viewport: { width: 375, height: 700 } });
  const bad = await badCtx.newPage();
  const badDialogs = [];
  bad.on('dialog', async d => { badDialogs.push(d.message()); await d.accept(); });
  await bad.goto(URL + '#s=' + badSession);
  await bad.waitForTimeout(500);
  check('細工リンクは警告が出る', badDialogs.some(m => m.includes('読み込めません')));
  check('細工リンクでは対戦表が出ない', await bad.locator('.round-card').count() === 0);
  check('細工リンクでは通常モードで起動', await bad.locator('.input-section').isVisible());

  await browser.close();
  console.log(`\n結果: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
