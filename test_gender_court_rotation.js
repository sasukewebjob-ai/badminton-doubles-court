// 4男12女・10節で、女子がB/C/Dのどれかに1度も回らなかった再現用乱数。
const assert = require('assert/strict');
const { loadApp } = require('./test_app_loader');
const app = loadApp();
const players = Array.from({ length: 16 }, (_, i) => i + 1);
const genders = Object.fromEntries(players.map(p => [p, p <= 4 ? 'M' : 'F']));
const realRandom = Math.random;
let failures = 0;
try {
  for (const seed of [127, 266, 299, 318, 938]) {
    let state = seed;
    Math.random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    const pairHistory = {}, opponentHistory = {}, courtHistory = {}, mixDiff = {};
    for (let r = 0; r < 10; r++) {
      const assigned = app.assignCourts(players, 4, pairHistory, opponentHistory, genders, mixDiff);
      const balanced = app.balanceCourtsSameType(assigned, courtHistory, genders);
      assert.deepEqual(balanced.flatMap(c => c.pair1.concat(c.pair2)).sort((a, b) => a - b), players);
      assert.ok(balanced[0].pair1.concat(balanced[0].pair2).every(p => genders[p] === 'M'));
      assert.ok(balanced.slice(1).every(c => c.pair1.concat(c.pair2).every(p => genders[p] === 'F')));
      const pairKeys = list => list.map(c => [c.pair1.join(','), c.pair2.join(',')].sort().join('/')).sort();
      assert.deepEqual(pairKeys(balanced), pairKeys(assigned), '対戦とペアを変えずにコートだけ替える');
      app.updateHistories(balanced, pairHistory, opponentHistory);
      app.updateCourtHistory(balanced, courtHistory);
      app.updateMixDiff(balanced, genders, mixDiff);
    }
    const missing = players.filter(p => p > 4 && [1, 2, 3].some(c => !courtHistory[p][c]));
    if (missing.length) { failures++; console.error(`FAIL seed ${seed}: ${missing.join(',')}番が女子コートの一部に出ていない`); }
    else console.log(`OK seed ${seed}: 全員が女子B/C/Dすべてに登場`);
  }
} finally { Math.random = realRandom; }
if (failures) process.exitCode = 1;
