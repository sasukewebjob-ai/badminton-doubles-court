// Independent checks of completed-round boundaries, not just fresh schedules.
const assert = require('assert/strict');
const { loadApp } = require('./test_app_loader');
const app = loadApp();
const ids = n => Array.from({ length: n }, (_, i) => i + 1);
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('OK ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function trailingRests(players, rounds) {
  return Object.fromEntries(players.map(p => {
    let count = 0;
    for (let i = rounds.length - 1; i >= 0 && rounds[i].includes(p); i--) count++;
    return [p, count];
  }));
}
function checkSchedule(players, playing, schedule, description) {
  const counts = Object.fromEntries(players.map(p => [p, 0]));
  const streaks = { ...counts };
  const cap = Math.ceil((players.length - playing) / playing) + 1;
  schedule.forEach((rest, i) => {
    assert.equal(rest.length, players.length - playing);
    assert.equal(new Set(rest).size, rest.length);
    assert.ok(rest.every(p => players.includes(p)));
    players.forEach(p => {
      if (rest.includes(p)) { counts[p]++; streaks[p]++; } else streaks[p] = 0;
      assert.ok(streaks[p] <= cap, `${description}, round ${i + 1}, player ${p}: ${streaks[p]} consecutive rests > ${cap}`);
    });
    assert.ok(Math.max(...Object.values(counts)) - Math.min(...Object.values(counts)) <= 1, description);
  });
}

test('20 players / 2 courts: regenerating after round 5 retains the preceding rest streak', () => {
  const model = loadApp();
  model.inputs({ courtCount: 2, playerCount: 20, roundCount: 10, restOrder: 'desc', genderMode: 'off' });
  model.generate();
  const kept = JSON.stringify(model.session.rounds.slice(0, 5));
  model.inputs({ consumedRound: 5, changeCourtCount: 2, addCount: 0 });
  model.applyMemberChange();
  assert.equal(JSON.stringify(model.session.rounds.slice(0, 5)), kept);
  checkSchedule(ids(20), 8, model.session.rounds.map(r => r.resting), 'production member-change entry point');
  assert.ok(model.validateSharedSession(model.session));
  assert.ok(model.decodeShareData(model.encodeShareData()));
});

test('every high-rest configuration, round count, order and single regeneration boundary stays within the existing streak cap', () => {
  let checked = 0;
  for (let courts = 2; courts <= 4; courts++) for (let n = courts * 8 + 1; n <= 26; n++) {
    for (const length of [10, 15, 20, 25, 30]) for (const reverse of [false, true]) {
      const players = ids(n), restSize = n - courts * 4;
      const original = app.generateRestSchedule(players, restSize, length, null, null, reverse);
      for (let cut = 1; cut < length; cut++) {
        const kept = original.slice(0, cut), counts = Object.fromEntries(players.map(p => [p, 0]));
        kept.flat().forEach(p => counts[p]++);
        const future = app.generateRestSchedule(players, restSize, length - cut, counts, kept[cut - 1], reverse,
          [], {}, cut, trailingRests(players, kept));
        checkSchedule(players, courts * 4, kept.concat(future), `${n} players / ${courts} courts, cut ${cut}`);
        checked++;
      }
    }
  }
  assert.equal(checked, 2280);
  console.log(`  ${checked} boundaries checked`);
});

test('repeated regeneration retains complete streaks instead of resetting at each edit', () => {
  let checked = 0;
  for (let courts = 2; courts <= 3; courts++) for (let n = courts * 8 + 1; n <= 26; n++) {
    for (const reverse of [false, true]) for (const chunk of [1, 2, 3, 4, 5]) {
      const players = ids(n), counts = Object.fromEntries(players.map(p => [p, 0])), rounds = [];
      for (let offset = 0; offset < 30; offset += chunk) {
        const next = app.generateRestSchedule(players, n - courts * 4, Math.min(chunk, 30 - offset), counts,
          rounds[rounds.length - 1], reverse, [], {}, offset, trailingRests(players, rounds));
        rounds.push(...next); next.flat().forEach(p => counts[p]++);
      }
      checkSchedule(players, courts * 4, rounds, `${n} players / ${courts} courts, chunk ${chunk}`);
      checked++;
    }
  }
  assert.equal(checked, 120);
  console.log(`  ${checked} repeated-edit schedules checked`);
});

console.log(`2026-09-28 calculation regressions: ${passed} passed / ${failed} failed`);
if (failed) process.exitCode = 1;
