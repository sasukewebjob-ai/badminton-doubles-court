const assert = require('assert/strict');
const { loadApp } = require('./test_app_loader');
let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); }
}
function start(courts = 4, players = 18) {
  const app = loadApp();
  app.inputs({courtCount: courts, playerCount: players, roundCount: 10, restOrder: 'desc', genderMode: 'off'});
  app.generate();
  assert.ok(app.session);
  return app;
}
function change(app, consumed, courts, add = 0, removed = [], returned = []) {
  app.inputs({consumedRound: consumed, changeCourtCount: courts, addCount: add});
  app.select('#removeChips .chip.selected', removed);
  app.select('#returnChips .chip.selected', returned);
  const kept = JSON.stringify(app.session.rounds.slice(0, consumed));
  app.applyMemberChange();
  assert.equal(JSON.stringify(app.session.rounds.slice(0, consumed)), kept);
}

test('share after 4 -> 3 courts applies change starting at the changed round', () => {
  const app = start();
  change(app, 3, 3);
  assert.equal(app.session.rounds[3].assignments.length, 3);
  const decoded = app.decodeShareData(app.encodeShareData());
  assert.ok(decoded, 'valid changed schedule was rejected');
  assert.deepEqual(decoded.session.rounds, app.session.rounds);
});
test('share after changing the last round', () => {
  const app = start();
  change(app, 9, 4, 1);
  assert.ok(app.decodeShareData(app.encodeShareData()), 'valid final-round change was rejected');
});
test('share validates participants at the exact join/leave round', () => {
  const app = start(2, 10);
  change(app, 3, 2, 1, [1]);
  const round = app.session.rounds[3];
  // Replace the newly joined member with someone who has left. Structure alone stays valid.
  round.resting = round.resting.map(p => p === 11 ? 1 : p);
  for (const court of round.assignments) {
    court.pair1 = court.pair1.map(p => p === 11 ? 1 : p);
    court.pair2 = court.pair2.map(p => p === 11 ? 1 : p);
  }
  assert.equal(app.decodeShareData(app.encodeShareData()), null);
});
test('cancelled invalid generation does not change the active round count', () => {
  const app = start();
  app.inputs({roundCount: 30});
  app.select('#rosterChips .chip.selected', [app.roster[0]], 'name');
  const original = JSON.stringify(app.session);
  app.generate();
  assert.equal(JSON.stringify(app.session), original);
  assert.equal(app.totalRounds, 10);
});
test('corrupt saved round is rejected without throwing or adopting it', () => {
  const app = start();
  app.session.rounds[0] = null;
  app.storage.set('badminton-court-session-v1', JSON.stringify({v: 1, session: app.session}));
  app.session = null;
  assert.equal(app.restoreSession(), false);
  assert.equal(app.session, null);
});

test('repeated member changes preserve the rest credit of earlier newcomers', () => {
  const app = start(2, 10);
  app.inputs({roundCount: 30});
  app.generate();
  change(app, 10, 2, 1); // All original members have rested twice; newcomer receives credit 2.
  change(app, 11, 2); // Replan one round later without changing membership.
  const counts = Object.fromEntries(app.session.players.map(p => [p, p === 11 ? 2 : 0]));
  for (const r of app.session.rounds) {
    r.resting.forEach(p => counts[p]++);
    if (r.round >= 11) {
      const values = Object.values(counts);
      assert.ok(Math.max(...values) - Math.min(...values) <= 1,
        `credited rest imbalance at round ${r.round}: ${JSON.stringify(counts)}`);
    }
  }
});

test('share remains valid above member number 200 after repeated replacements', () => {
  const app = start(2, 26);
  app.inputs({roundCount: 30});
  app.generate();
  for (let consumed = 1; consumed <= 24; consumed++) {
    change(app, consumed, 2, 8, app.session.players.slice(0, 8));
    assert.ok(app.decodeShareData(app.encodeShareData()), `share rejected at member ${app.session.maxNumber}`);
  }
  assert.equal(app.session.maxNumber, 218);
});

if (failed) process.exitCode = 1;
