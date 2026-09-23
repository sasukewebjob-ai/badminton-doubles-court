// シングルス・固定ペア版の休み順（2026-09-23 ユーザー要望）の回帰テスト
// - 休みが参加番号の半分未満: 通常のダブルス版と全く同じ休み順
// - 休みが半分以上: 1周目（まだ休んでいない番号）だけ番号順、2周目以降は対戦相手と合わせて選ぶ
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { loadSingles } = require('./test_singles');
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
const singles = loadSingles();
const doubles = loadApp();
const ids = n => Array.from({ length: n }, (_, i) => i + 1);
const config = (n, courts, restOrder = 'desc', totalRounds = 30, forced = {}) =>
  ({ mode: 'singles', players: ids(n), courts, totalRounds, restOrder, forced });
const doublesOrder = (n, courts) => { const r = n - courts * 2; return r > 0 && r * 2 < n; };

test('休み順の関数は index.html と singles.html で一字一句同じ', () => {
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
  const extract = (src, name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} が見つからない`);
    const end = src.indexOf('\n}\n', start);
    return src.slice(start, end + 2);
  };
  const idx = read('index.html'), sg = read('singles.html');
  for (const name of ['makeStrideGroups', 'strideLinearOrder', 'generateRestSchedule']) {
    assert.equal(extract(sg, name), extract(idx, name), `${name} が一致しない`);
  }
});

test('休みが半分未満の全構成で、休み順はダブルス版と全く同じ', () => {
  let count = 0;
  for (let courts = 1; courts <= 4; courts++) for (let n = courts * 2 + 1; n <= 12; n++) {
    if (!doublesOrder(n, courts)) continue;
    for (const total of [10, 15, 20, 25, 30]) for (const order of ['asc', 'desc']) {
      seedRandom(n * 100 + courts * 10 + total);
      const s = singles.buildSession(config(n, courts, order, total));
      const expected = doubles.generateRestSchedule(ids(n), n - courts * 2, total, null, null, order === 'desc', null, null);
      assert.deepEqual(s.rounds.map(r => r.rest), expected, `${courts}c×${n}×${total} ${order}`);
      count++;
    }
  }
  assert.ok(count >= 100, `構成数 ${count}`);
});

test('休みが半分未満なら、休み指定もダブルス版と同じ扱い（指定を守り、前後の節はなるべく休まない）', () => {
  // 9ペア・4コート（毎節1ペア休み）: 第3節は5番、第7節は2番を休み
  const forced = { 3: [5], 7: [2] };
  const s = singles.buildSession(config(9, 4, 'desc', 20, forced));
  const expected = doubles.generateRestSchedule(ids(9), 1, 20, null, null, true, null, { 2: [5], 6: [2] });
  assert.deepEqual(s.rounds.map(r => r.rest), expected);
  assert.deepEqual(s.rounds[2].rest, [5]);
  assert.deepEqual(s.rounds[6].rest, [2]);
});

test('ユーザーの例: 9ペア・4コートは 9→8→…→1 の順に休む（1番から休むなら 1→9）', () => {
  const desc = singles.buildSession({ ...config(9, 4, 'desc', 10), mode: 'pairs' });
  assert.deepEqual(desc.rounds.slice(0, 9).map(r => r.rest), [[9], [8], [7], [6], [5], [4], [3], [2], [1]]);
  const asc = singles.buildSession({ ...config(9, 4, 'asc', 10), mode: 'pairs' });
  assert.deepEqual(asc.rounds.slice(0, 9).map(r => r.rest), [[1], [2], [3], [4], [5], [6], [7], [8], [9]]);
});

test('休みが半分未満なら、途中変更の前後も含めて2節続けて休む番号はない', () => {
  for (let seed = 1; seed <= 60; seed++) {
    seedRandom(seed);
    const courts = 2 + seed % 3, n = Math.min(12, courts * 2 + 1 + seed % 4);
    if (!doublesOrder(n, courts)) continue;
    let s = singles.buildSession(config(n, courts, seed % 2 ? 'asc' : 'desc', 30));
    for (const consumed of [4, 11, 19]) {
      const players = s.players.slice();
      if (seed % 3 === 0 && players.length > courts * 2 + 1) players.pop();
      else if (seed % 3 === 1 && players.length < 12) players.push(Math.max(...ids(12).filter(p => !players.includes(p))));
      const r = players.length - courts * 2;
      if (!(r > 0 && r * 2 < players.length)) continue;
      s = singles.buildSession({ ...s, players }, s.rounds.slice(0, consumed));
      s.rounds.forEach((round, i) => {
        if (i && i >= consumed - 1) {
          const both = round.rest.filter(p => s.rounds[i - 1].rest.includes(p));
          assert.equal(both.length, 0, `seed${seed} 第${i}・${i + 1}節で連続休み ${both}`);
        }
      });
      assert.ok(singles.validSession(s));
    }
  }
});

test('休みが半分以上の全構成で、1周目は番号順に休む（最後の番号から／1番から）', () => {
  let count = 0;
  for (let courts = 1; courts <= 4; courts++) for (let n = courts * 2 + 1; n <= 12; n++) {
    if (doublesOrder(n, courts)) continue;
    const restSize = n - courts * 2;
    for (const order of ['asc', 'desc']) for (const total of [10, 30]) {
      seedRandom(n * 7 + courts + total);
      const s = singles.buildSession(config(n, courts, order, total));
      const queue = order === 'desc' ? ids(n).reverse() : ids(n);
      for (let i = 0, pos = 0; pos < n; i++, pos += restSize) {
        const want = queue.slice(pos, pos + restSize);
        assert.ok(want.every(p => s.rounds[i].rest.includes(p)), `${courts}c×${n} ${order} 第${i + 1}節 休み${s.rounds[i].rest} ⊇ ${want}`);
      }
      count++;
    }
  }
  assert.ok(count >= 40, `構成数 ${count}`);
});

test('休みが半分以上の1周目: 指定休みがある番号はその節を自分の番とし、1周目に2回休まない', () => {
  // 2コート10番号（毎節6休み）: 第2節は9番を休み指定。9番は第1節に番号順で休まず、第2節の指定を自分の番にする
  const s = singles.buildSession(config(10, 2, 'desc', 10, { 2: [9] }));
  assert.ok(!s.rounds[0].rest.includes(9), `第1節 ${s.rounds[0].rest}`);
  assert.ok(s.rounds[1].rest.includes(9), `第2節 ${s.rounds[1].rest}`);
  assert.deepEqual(s.rounds[0].rest, [4, 5, 6, 7, 8, 10]);
});

test('休みが半分以上で1周目の途中に参加した番号は、最初からの番号の後ろで休む', () => {
  // 2コート10番号: 第1節（10〜5番が休み）が終わったところで11番が参加
  let s = singles.buildSession(config(10, 2, 'desc', 10));
  assert.deepEqual(s.rounds[0].rest, [5, 6, 7, 8, 9, 10]);
  s = singles.buildSession({ ...s, players: ids(11) }, s.rounds.slice(0, 1));
  // 1周目の続き: まだ休んでいない4〜1番が第2節で休む。11番は休み0回扱い（継続者の最少回数）なので、
  // 毎節7休みのこの構成では公平のため同じ節で休む。残り枠は2周目の選び方
  assert.ok([1, 2, 3, 4].every(p => s.rounds[1].rest.includes(p)), `第2節 ${s.rounds[1].rest}`);
  assert.ok(singles.validSession(s));
});

// 途中変更のあとの対戦（2026-09-23の監査で見つかった2件）
const key = (a, b) => a < b ? `${a}-${b}` : `${b}-${a}`;
function matchings(list) {
  if (!list.length) return [[]];
  const [a, ...rest] = list, out = [];
  rest.forEach((b, i) => { for (const m of matchings(rest.filter((_, j) => j !== i))) out.push([[a, b], ...m]); });
  return out;
}
function randomEdits(seeds, visit) {
  for (let seed = 1; seed <= seeds; seed++) {
    seedRandom(seed);
    const courts = 1 + seed % 4, n = Math.max(courts * 2, 2 + Math.floor(Math.random() * 11));
    let s = singles.buildSession(config(n, courts, seed % 2 ? 'asc' : 'desc', 30));
    for (let step = 1; step <= 6; step++) {
      const consumed = step * 4, newCourts = 1 + Math.floor(Math.random() * 4);
      const count = Math.max(newCourts * 2, 2 + Math.floor(Math.random() * 11));
      const players = ids(12).sort(() => Math.random() - 0.5).slice(0, count).sort((a, b) => a - b);
      let next;
      try { next = singles.buildSession({ ...s, players, courts: newCourts }, s.rounds.slice(0, consumed)); }
      catch (e) { continue; }
      visit(next, consumed, `seed${seed} 第${consumed}節まで終了→${newCourts}コート${players.length}番号`);
      s = next;
    }
  }
}

test('全員出場の区間に切り替えた直後も、直前の節と同じ対戦から始めない（作り直しでも総当たりが続く）', () => {
  let checked = 0;
  randomEdits(250, (s, consumed, label) => {
    if (s.players.length === 2 || s.players.length !== s.courts * 2) return;
    const prev = new Set(s.rounds[consumed - 1].matches.map(m => key(...m)));
    const rep = s.rounds[consumed].matches.filter(m => prev.has(key(...m)));
    assert.equal(rep.length, 0, `${label}: 第${consumed}・${consumed + 1}節で同じ対戦 ${rep.map(m => m.join('-'))}`);
    // 同じ構成のまま2節後から作り直しても、総当たりの続きになる（一巡するまで同じ対戦なし）
    const again = singles.buildSession(s, s.rounds.slice(0, consumed + 2));
    const seen = new Set();
    for (const r of again.rounds.slice(consumed, consumed + s.players.length - 1)) for (const m of r.matches) {
      assert.ok(!seen.has(key(...m)), `${label}: 作り直し後の総当たりで ${m.join('-')} が重複`); seen.add(key(...m));
    }
    checked++;
  });
  assert.ok(checked >= 20, `検証件数 ${checked}`);
});

test('途中変更のあとも、避けられるなら同じ相手と2節続けて対戦しない', () => {
  let checked = 0;
  randomEdits(250, (s, consumed, label) => {
    for (let i = consumed; i < s.rounds.length; i++) {
      const prev = new Set(s.rounds[i - 1].matches.map(m => key(...m)));
      const rep = s.rounds[i].matches.filter(m => prev.has(key(...m)));
      if (!rep.length) continue;
      const active = s.rounds[i].matches.flat().sort((a, b) => a - b);
      // 出場者の組み合わせのどれでも再戦になるとき（2番号だけ・休みの公平で出場者が決まる1コートなど）は避けられない
      const avoidable = matchings(active).some(m => m.every(p => !prev.has(key(...p))));
      assert.ok(!avoidable, `${label}: 第${i}・${i + 1}節で同じ対戦 ${rep.map(m => m.join('-'))}`);
    }
    checked++;
  });
  assert.ok(checked >= 1000, `検証件数 ${checked}`);
});

if (failed) process.exitCode = 1;
else console.log('シングルス版の休み順テスト 全合格');
