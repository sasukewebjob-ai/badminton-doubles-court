// 休み順・出場の顔ぶれ・コートの偏りの回帰テスト（2026-09-23の監査で直した3件）
// A: 周の切り替わりで、避けられるのに2節続けて休む人が出ていた
// B: 休みが参加人数の半分以上だと、出場する顔ぶれが固定されていた（2コート24人で8人ずつ3組）
// C: 2コートで、ペア・対戦の評価が同点でもコートの登場回数を見ずに選び、同じコートに固定されやすかった
const assert = require('assert/strict');
const { loadApp } = require('./test_app_loader');

let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); }
}
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = function () {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const app = loadApp();
const range = n => Array.from({ length: n }, (_, i) => i + 1);
const configs = [];
for (const courts of [2, 3, 4]) for (let N = courts * 4 + 1; N <= 26; N++) for (const R of [10, 15, 20, 25, 30]) for (const desc of [false, true]) {
  configs.push({ courts, N, R, desc, rest: N - courts * 4 });
}
function neverTogether(sched, N) {
  let n = 0;
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) if (!sched.some(r => !r.includes(a) && !r.includes(b))) n++;
  return n;
}
function checkFair(sched, N, label) {
  const cnt = Object.fromEntries(range(N).map(p => [p, 0]));
  sched.forEach((r, i) => {
    assert.equal(new Set(r).size, r.length, `${label} 第${i + 1}節 重複`);
    r.forEach(p => cnt[p]++);
    const v = Object.values(cnt);
    assert.ok(Math.max(...v) - Math.min(...v) <= 1, `${label} 第${i + 1}節 休み差>1`);
  });
}

test('A: 休みが半分未満の全構成で、2節続けて休む人はいない（公平・1周目の番号順は維持）', () => {
  let count = 0;
  for (const c of configs.filter(c => c.rest * 2 < c.N)) {
    const label = `${c.courts}c×${c.N}p×${c.R}r${c.desc ? 'desc' : 'asc'}`;
    const sched = app.generateRestSchedule(range(c.N), c.rest, c.R, null, null, c.desc, null, null);
    checkFair(sched, c.N, label);
    sched.forEach((r, i) => { if (i) assert.ok(!r.some(p => sched[i - 1].includes(p)), `${label} 第${i}・${i + 1}節で連続休み`); });
    const order = c.desc ? range(c.N).reverse() : range(c.N);
    for (let i = 0; i < Math.floor(c.N / c.rest) && i < c.R; i++) {
      assert.deepEqual(sched[i], order.slice(i * c.rest, (i + 1) * c.rest).sort((a, b) => a - b), `${label} 1周目の第${i + 1}節が番号順でない`);
    }
    count++;
  }
  assert.equal(count, 280);
});

test('A: メンバー変更の境目でも、休みが半分未満なら直前の休みの人は続けて休まない', () => {
  // 監査の再現例: 2コート12人・最後の番号から休む・第6節まで終了で1人追加 → 1・4番が第6・7節で連続休みだった
  let cases = 0;
  for (const courts of [2, 3, 4]) for (let N = courts * 4 + 1; N <= 26; N++) for (const order of ['asc', 'desc']) for (const kind of ['add', 'remove', 'same']) for (const consumed of [3, 6, 9]) {
    seedRandom(N * 1000 + consumed * 10 + courts);
    app.inputs({ courtCount: courts, playerCount: N, roundCount: 20, restOrder: order, genderMode: 'off' });
    app.generate();
    const s = app.session;
    const add = kind === 'add' && N < 26 ? 1 : 0;
    const removed = kind === 'remove' && N - 1 >= courts * 4 ? [s.players[(consumed * 7) % N]] : [];
    const newN = N + add - removed.length, rest = newN - courts * 4;
    if (rest <= 0 || rest * 2 >= newN) continue;
    app.inputs({ consumedRound: consumed, changeCourtCount: courts, addCount: add });
    app.select('#removeChips .chip.selected', removed);
    app.select('#returnChips .chip.selected', []);
    app.applyMemberChange();
    const last = s.rounds[consumed - 1].resting;
    const both = app.session.rounds[consumed].resting.filter(p => last.includes(p));
    assert.equal(both.length, 0, `${courts}c×${N}p ${order} ${kind} 第${consumed}節まで終了: ${both}番が連続休み`);
    cases++;
  }
  assert.ok(cases > 400, `検証件数 ${cases}`);
});

test('B: 休みが半分以上でも公平で、1周目は番号順に出場し、顔ぶれが固定されない', () => {
  let count = 0;
  for (const c of configs.filter(c => c.rest * 2 >= c.N)) {
    const label = `${c.courts}c×${c.N}p×${c.R}r${c.desc ? 'desc' : 'asc'}`;
    const sched = app.generateRestSchedule(range(c.N), c.rest, c.R, null, null, c.desc, null, null);
    checkFair(sched, c.N, label);
    // 1周目: 最後の番号から休む＝小さい番号から順に出場（1番から休むはその逆）
    const play = c.N - c.rest;
    const order = c.desc ? range(c.N) : range(c.N).reverse();
    for (let i = 0; (i + 1) * play <= c.N && i < c.R; i++) {
      const active = range(c.N).filter(p => !sched[i].includes(p));
      assert.deepEqual(active, order.slice(i * play, (i + 1) * play).sort((a, b) => a - b), `${label} 1周目の第${i + 1}節の出場が番号順でない`);
    }
    if (c.R === 30) {
      const pairs = c.N * (c.N - 1) / 2, never = neverTogether(sched, c.N);
      assert.ok(never <= pairs * 0.1, `${label} 一緒に出場しない組 ${never}/${pairs}`);
    }
    count++;
  }
  assert.equal(count, 140);
  // 監査で見つかった例: 2コート24人・30節は 8人ずつ3組に固定され、276組中192組が一度も一緒に出場しなかった
  const sched = app.generateRestSchedule(range(24), 16, 30, null, null, true, null, null);
  assert.ok(neverTogether(sched, 24) <= 20, `2c×24p×30r 一緒に出場しない組 ${neverTogether(sched, 24)}`);
});

test('B: 休みが半分以上の構成でも、休み指定・途中追加・引き継いだ回数を守る', () => {
  const players = [1, 2, 3, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]; // 欠番あり20人
  // 全員3回で並んだところに22・23番が途中追加（最少回数＝3回扱い）
  const initial = Object.fromEntries(players.map(p => [p, 3]));
  const forced = { 0: [1, 2], 2: [22], 5: [5, 8, 9] };
  const sched = app.generateRestSchedule(players, 12, 12, initial, [1, 3, 5], true, [22, 23], forced, 8);
  const cnt = { ...initial };
  sched.forEach((r, i) => {
    assert.equal(r.length, 12);
    assert.ok((forced[i] || []).every(p => r.includes(p)), `第${i + 1}節 指定休み`);
    r.forEach(p => cnt[p]++);
  });
  // 途中追加の23番は、最初の節ではなるべく出場する（参加直後にいきなり休みにしない）
  assert.ok(!sched[0].includes(23), '途中追加者が参加直後に休み');
  const others = players.filter(p => ![1, 2, 22, 5, 8, 9].includes(p)).map(p => cnt[p]);
  assert.ok(Math.max(...others) - Math.min(...others) <= 1, `指定のない人の休み差 ${JSON.stringify(cnt)}`);
});

test('C: ペア・対戦が同点なら、コートの登場回数が偏らない組み合わせを選ぶ', () => {
  seedRandom(42);
  // 1・2番はAコートばかり、3・4番はBコートばかり。どの組み合わせもペア・対戦は初めて＝同点
  const history = { 1: { 0: 6 }, 2: { 0: 6 }, 3: { 1: 6 }, 4: { 1: 6 } };
  const best = (() => {
    let min = Infinity;
    const P = range(8);
    // 4人ずつ2コートに分ける全通りの最小ペナルティ
    for (let mask = 0; mask < 256; mask++) {
      const A = P.filter((_, i) => mask & (1 << i));
      if (A.length !== 4) continue;
      const B = P.filter(p => !A.includes(p));
      const s = A.reduce((t, p) => t + (((history[p] || {})[0] || 0) + 1) ** 2, 0) + B.reduce((t, p) => t + (((history[p] || {})[1] || 0) + 1) ** 2, 0);
      min = Math.min(min, s);
    }
    return min;
  })();
  for (let t = 0; t < 20; t++) {
    const a = app.balanceCourts(app.assignCourts(range(8), 2, {}, {}, null, null, history), history);
    const s = a.reduce((sum, m, ci) => sum + m.pair1.concat(m.pair2).reduce((x, p) => x + (((history[p] || {})[ci] || 0) + 1) ** 2, 0), 0);
    assert.equal(s, best, `試行${t + 1}: コートのペナルティ ${s}（最小 ${best}）`);
  }
});

test('C: 2コート13人・10節（固定シード20回）で、8割以上同じコートに入る人が減っている', () => {
  let stuck = 0, spread = 0;
  for (let s = 0; s < 20; s++) {
    seedRandom(5000 + s);
    app.inputs({ courtCount: 2, playerCount: 13, roundCount: 10, restOrder: s % 2 ? 'desc' : 'asc', genderMode: 'off' });
    app.generate();
    const court = {};
    for (const r of app.session.rounds) r.assignments.forEach((m, ci) => m.pair1.concat(m.pair2).forEach(p => {
      court[p] = court[p] || [0, 0]; court[p][ci]++;
    }));
    for (const v of Object.values(court)) {
      const total = v[0] + v[1];
      if (total >= 5 && Math.max(...v) / total >= 0.8) stuck++;
      spread += Math.abs(v[0] - v[1]);
    }
  }
  console.log(`   2c×13p×10r 固定シード20回: 8割以上同じコート ${stuck}人 / コート差の合計 ${spread}`);
  // 同じシードで修正前は 10人・コート差の合計316、修正後は 3人・238
  assert.ok(stuck <= 5, `8割以上同じコート ${stuck}人`);
  assert.ok(spread <= 270, `コート差の合計 ${spread}`);
});

if (failed) process.exitCode = 1;
else console.log('休み順・顔ぶれ・コート偏りの回帰テスト 全合格');
