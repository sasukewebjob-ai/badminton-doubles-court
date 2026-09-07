// Deterministic property tests against production functions, with independent accounting.
const assert = require('assert/strict');
const { loadApp } = require('./test_app_loader');
const app = loadApp();
let seed = 0x20260907;
const random = n => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return Math.floor(seed / 0x100000000 * n);
};
const shuffled = list => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sorted = list => list.slice().sort((a, b) => a - b);
const spread = values => values.length ? Math.max(...values) - Math.min(...values) : 0;
let schedules = 0, rounds = 0, assignments = 0;

for (let t = 0; t < 10000; t++) {
  const courts = 2 + random(3);
  const n = courts * 4 + random(27 - courts * 4);
  const players = Array.from({length: n}, (_, i) => i * 2 + 1); // non-consecutive IDs
  const restCount = n - courts * 4;
  const length = 1 + random(30);
  const counts = Object.fromEntries(players.map(p => [p, t % 3 === 0 ? random(15) : 0]));
  const initial = {...counts};
  const forced = {}, touched = new Set();
  if (t % 2) for (let r = 0; r < length; r++) {
    forced[r] = shuffled(players).slice(0, random(restCount + 1));
    forced[r].forEach(p => touched.add(p));
  }
  const rest = app.generateRestSchedule(players, restCount, length, initial,
    shuffled(players).slice(0, restCount), !!(t % 2), players.slice(-2), forced);
  assert.equal(rest.length, length);
  for (let r = 0; r < length; r++) {
    assert.equal(rest[r].length, restCount, `rest slots: case ${t} round ${r}`);
    assert.equal(new Set(rest[r]).size, restCount);
    assert.ok(rest[r].every(p => players.includes(p)));
    assert.ok((forced[r] || []).every(p => rest[r].includes(p)));
    const required = new Set(forced[r] || []);
    const omitted = players.filter(p => !rest[r].includes(p));
    // A discretionary rest must never skip someone with a lower rest count.
    for (const p of rest[r].filter(p => !required.has(p))) {
      assert.ok(omitted.every(q => counts[p] <= counts[q]), `fairness: case ${t} round ${r}`);
    }
    rest[r].forEach(p => counts[p]++);
    if (t % 3 !== 0) assert.ok(spread(players.filter(p => !touched.has(p)).map(p => counts[p])) <= 1);
    rounds++;
  }
  schedules++;
}
console.log(`OK ${schedules} rest schedules / ${rounds} rounds: slots, unique IDs, forced rests, fairness`);

// All 30 possible male/female counts in 3/4 courts, including no men or no women.
for (const courts of [3, 4]) for (let males = 0; males <= courts * 4; males++) {
  const players = Array.from({length: courts * 4}, (_, i) => i + 1);
  const genders = Object.fromEntries(players.map(p => [p, p <= males ? 'M' : 'F']));
  const ph = {}, oh = {}, ch = {}, md = {};
  for (let r = 0; r < 30; r++) {
    const a = app.assignCourts(shuffled(players), courts, ph, oh, genders, md);
    assert.equal(a.length, courts);
    assert.deepEqual(sorted(a.flatMap(c => c.pair1.concat(c.pair2))), players);
    const template = app.courtTemplates(males, players.length - males, courts);
    a.forEach((c, i) => {
      assert.equal(c.pair1.length, 2);
      assert.equal(c.pair2.length, 2);
      assert.equal(c.pair1.concat(c.pair2).filter(p => genders[p] === 'M').length, template[i].m);
      if (template[i].m === 2) for (const pair of [c.pair1, c.pair2]) assert.notEqual(genders[pair[0]], genders[pair[1]]);
    });
    const balanced = app.balanceCourtsSameType(a, ch, genders);
    balanced.forEach((c, i) => assert.equal(c.pair1.concat(c.pair2).filter(p => genders[p] === 'M').length, template[i].m));
    app.updateHistories(balanced, ph, oh);
    app.updateCourtHistory(balanced, ch);
    app.updateMixDiff(balanced, genders, md);
    for (const p of players) {
      assert.equal(Object.values(ph[p]).reduce((a, b) => a + b, 0), r + 1);
      assert.equal(Object.values(oh[p]).reduce((a, b) => a + b, 0), (r + 1) * 2);
      assert.equal(Object.values(ch[p]).reduce((a, b) => a + b, 0), r + 1);
      for (const q of players) {
        assert.equal(ph[p][q] || 0, (ph[q] || {})[p] || 0);
        assert.equal(oh[p][q] || 0, (oh[q] || {})[p] || 0);
      }
    }
    assignments++;
  }
}
console.log(`OK ${assignments} gender rounds: every gender ratio, pairs, court templates, history totals and symmetry`);

let changes = 0;
for (let t = 0; t < 100; t++) {
  const model = loadApp();
  const n = 8 + random(19);
  model.inputs({courtCount: 2, playerCount: n, roundCount: 30, restOrder: t % 2 ? 'asc' : 'desc', genderMode: 'off'});
  model.generate();
  const ledger = Object.fromEntries(model.session.players.map(p => [p, 0]));
  let prevConsumed = 0;
  for (let consumed = 3; consumed < 30; consumed += 3) {
    const s = model.session;
    for (const round of s.rounds.slice(prevConsumed, consumed)) round.resting.forEach(p => ledger[p]++);
    const removed = shuffled(s.players).slice(0, random(Math.min(4, s.players.length - 8) + 1));
    const continuing = s.players.filter(p => !removed.includes(p));
    const returned = shuffled(s.everPlayers.filter(p => !s.players.includes(p)))
      .slice(0, random(Math.min(3, 26 - continuing.length) + 1));
    const add = random(Math.min(4, 26 - continuing.length - returned.length) + 1);
    const nums = Array.from({length: add}, (_, i) => s.maxNumber + 1 + i);
    const minimum = Math.min(...continuing.map(p => ledger[p]));
    returned.forEach(p => ledger[p] = Math.max(ledger[p], minimum));
    nums.forEach(p => ledger[p] = minimum);
    const next = sorted(continuing.concat(returned, nums));
    const courts = 2 + random(Math.min(4, Math.floor(next.length / 4)) - 1);
    model.inputs({consumedRound: consumed, changeCourtCount: courts, addCount: add});
    model.select('#removeChips .chip.selected', removed);
    model.select('#returnChips .chip.selected', returned);
    const kept = JSON.stringify(s.rounds.slice(0, consumed));
    model.applyMemberChange();
    assert.equal(JSON.stringify(s.rounds.slice(0, consumed)), kept);
    assert.deepEqual(s.players, next);
    assert.ok(model.decodeShareData(model.encodeShareData()), `share case ${t} boundary ${consumed}`);
    const counts = {...ledger};
    for (const round of s.rounds.slice(consumed)) {
      const playing = round.assignments.flatMap(c => c.pair1.concat(c.pair2));
      assert.equal(round.assignments.length, courts);
      assert.deepEqual(sorted(playing.concat(round.resting)), next);
      for (const p of round.resting) {
        assert.ok(playing.every(q => counts[p] <= counts[q]), `change fairness: case ${t} boundary ${consumed} round ${round.round}`);
      }
      round.resting.forEach(p => counts[p]++);
    }
    prevConsumed = consumed;
    changes++;
  }
}
console.log(`OK ${changes} member changes: additions, departures, returns, court changes, preserved rounds, credited fairness and sharing`);
