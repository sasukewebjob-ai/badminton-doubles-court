// 2026-09-26の監査で直した計算まわりの回帰テスト
// D1: 2回目の途中変更（何も変えない作り直しを含む）で、前回途中参加してまだ休んでいない人が
//     休み待ちの先頭に割り込み、参加直後に休んでいた（ダブルス版・シングルス版とも）
// D2: 休みが参加人数の半分を超える構成で、同じ人が何節も続けて休んでいた（2コート26人30節で6節連続）
// D7: 共有データで同じ節に変更が2件あっても検証を通り、変更帯が1件分しか表示されなかった
const assert = require('assert/strict');
const { loadApp } = require('./test_app_loader');
const { loadSingles } = require('./test_singles');

let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); }
}
const range = n => Array.from({ length: n }, (_, i) => i + 1);

function start(courts, players) {
  const app = loadApp();
  app.inputs({ courtCount: courts, playerCount: players, roundCount: 10, restOrder: 'desc', genderMode: 'off' });
  app.generate();
  assert.ok(app.session);
  return app;
}
function change(app, consumed, courts, add = 0) {
  app.inputs({ consumedRound: consumed, changeCourtCount: courts, addCount: add });
  app.select('#removeChips .chip.selected', []);
  app.select('#returnChips .chip.selected', []);
  app.applyMemberChange();
}
const firstRest = (rounds, p, key = 'resting') => {
  const r = rounds.find(round => round[key].includes(p));
  return r ? r.round : Infinity;
};
// 途中参加者は、最初からいる人が全員1回休み終わる前には休まない（周の最後尾）
function assertAfterOriginals(rounds, originals, p, key) {
  const lastOriginal = Math.max(...originals.map(q => firstRest(rounds, q, key)));
  const mine = firstRest(rounds, p, key);
  assert.ok(mine >= lastOriginal, `${p}番の初休みが第${mine}節（最初からいる人の最後は第${lastOriginal}節）`);
}

test('D1: 途中参加者は、何も変えない作り直しのあとも周の最後尾で休む（3コート13人）', () => {
  const app = start(3, 13);
  change(app, 3, 3, 1);
  assertAfterOriginals(app.session.rounds, range(13), 14);
  change(app, 4, 3, 0);
  assertAfterOriginals(app.session.rounds, range(13), 14);
});
test('D1: 続けて別の人が参加しても、前回の参加者は周の最後尾で休む（3コート13人）', () => {
  const app = start(3, 13);
  change(app, 3, 3, 1);
  change(app, 4, 3, 1);
  assertAfterOriginals(app.session.rounds, range(13), 14);
  assertAfterOriginals(app.session.rounds, range(13), 15);
});
test('D1: 4コート20人で第1節後に21番、第2節後に22番が参加しても21番はすぐ休まない', () => {
  const app = start(4, 20);
  change(app, 1, 4, 1);
  change(app, 2, 4, 1);
  assertAfterOriginals(app.session.rounds, range(20), 21);
  assertAfterOriginals(app.session.rounds, range(20), 22);
});
test('D1: 一度休んだ途中参加者は、次の変更で後回しにならない（通常の順番に戻る）', () => {
  const app = start(4, 20);
  change(app, 1, 4, 1);
  const rested = firstRest(app.session.rounds, 21);
  change(app, rested, 4, 0);
  const counts = {};
  app.session.players.forEach(p => counts[p] = 0);
  app.session.rounds.forEach(r => r.resting.forEach(p => counts[p]++));
  const v = Object.values(counts);
  assert.ok(Math.max(...v) - Math.min(...v) <= 1, JSON.stringify(counts));
});

test('D1: シングルス版も、何も変えない作り直しのあと途中参加者は周の最後尾で休む', () => {
  const singles = loadSingles();
  const cfg = { mode: 'singles', players: range(10), courts: 4, totalRounds: 10, restOrder: 'desc', forced: {} };
  let s = singles.buildSession(cfg);
  s = singles.buildSession({ ...s, players: range(11) }, s.rounds.slice(0, 1));
  assertAfterOriginals(s.rounds, range(10), 11, 'rest');
  s = singles.buildSession(s, s.rounds.slice(0, 2));
  assertAfterOriginals(s.rounds, range(10), 11, 'rest');
  s = singles.buildSession({ ...s, players: range(12) }, s.rounds.slice(0, 3));
  assertAfterOriginals(s.rounds, range(10), 11, 'rest');
  assert.ok(singles.validSession(s));
});

test('D2: 休みが半分を超える全構成で、連続休みは避けられない長さ+1節まで', () => {
  const app = loadApp();
  const worst = [];
  for (const courts of [2, 3, 4]) for (let N = courts * 4 + 1; N <= 26; N++) {
    const rest = N - courts * 4;
    if (rest * 2 <= N) continue;
    const bound = Math.ceil(rest / (N - rest)) + 1;
    for (const R of [10, 15, 20, 25, 30]) for (const desc of [false, true]) {
      const sched = app.generateRestSchedule(range(N), rest, R, null, null, desc, null, null);
      const streak = {};
      let max = 0;
      sched.forEach(r => range(N).forEach(p => { streak[p] = r.includes(p) ? (streak[p] || 0) + 1 : 0; max = Math.max(max, streak[p]); }));
      if (max > bound) worst.push(`${courts}c${N}人${R}節: ${max}節連続（上限${bound}）`);
    }
  }
  assert.deepEqual(worst, []);
});
test('D2: 報告例 2コート26人30節は4節連続まで、2コート20人10節は3節連続まで', () => {
  const app = loadApp();
  const maxStreak = (N, rest, R) => {
    const sched = app.generateRestSchedule(range(N), rest, R, null, null, true, null, null);
    const streak = {};
    let max = 0;
    sched.forEach(r => range(N).forEach(p => { streak[p] = r.includes(p) ? (streak[p] || 0) + 1 : 0; max = Math.max(max, streak[p]); }));
    return max;
  };
  assert.ok(maxStreak(26, 18, 30) <= 4);
  assert.ok(maxStreak(20, 12, 10) <= 3);
});
test('D2: 休みが半分を超える構成で途中変更しても、連続休みは上限+1節まで', () => {
  const app = start(2, 20);
  for (const consumed of [3, 6]) {
    change(app, consumed, 2, 1);
    const N = app.session.players.length;
    const rest = N - 8;
    const bound = Math.ceil(rest / (N - rest)) + 1;
    const streak = {};
    let max = 0;
    app.session.rounds.slice(consumed).forEach(r => app.session.players.forEach(p => {
      streak[p] = r.resting.includes(p) ? (streak[p] || 0) + 1 : 0; max = Math.max(max, streak[p]);
    }));
    assert.ok(max <= bound + 1, `第${consumed}節後の変更で${max}節連続`);
  }
});

test('D7: 同じ節に変更が2件ある共有データは受け付けない', () => {
  const app = start(4, 18);
  change(app, 3, 4, 2);
  const c = app.session.changes[0];
  assert.ok(app.decodeShareData(app.encodeShareData()), '正常な変更が拒否された');
  app.session.changes = [
    { ...c, added: [c.added[0]] },
    { ...c, added: [c.added[1]], removed: [], returned: [] },
  ];
  assert.equal(app.decodeShareData(app.encodeShareData()), null);
});
test('D7: 通常の操作で続けて変更した共有データは受け付ける', () => {
  const app = start(4, 18);
  change(app, 3, 4, 1);
  change(app, 4, 4, 1);
  change(app, 5, 3, 0);
  assert.ok(app.decodeShareData(app.encodeShareData()));
});

if (failed) process.exitCode = 1;
else console.log('2026-09-26 監査の回帰テスト（計算） 全合格');
