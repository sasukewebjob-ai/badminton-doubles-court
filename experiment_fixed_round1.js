// 実験: 「最後の番号から休む」時に第1節を固定配置（A: 1,2 vs 3,4 / B: 5,6 vs 7,8 ...）にすると
// 第2節以降の公平性（ペア重複・対戦分散）が悪化するかを実測比較する。
// test_algorithm.js のアルゴリズム関数部分を一時モジュールに切り出して再利用する。

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'test_algorithm.js'), 'utf8');
const cut = src.indexOf('function generate(');
const libPath = path.join(__dirname, '_algo_lib.tmp.js');
fs.writeFileSync(libPath,
  'let TOTAL_ROUNDS = 20;\n' +
  src.slice(src.indexOf('function makeStrideGroups'), cut) +
  '\nmodule.exports = { playersN, generateRestSchedule, assignCourts, balanceCourts, updateHistories, updateCourtHistory };\n');
const lib = require(libPath);
fs.unlinkSync(libPath);

// 第1節の固定配置: コートiに 4i+1,4i+2 vs 4i+3,4i+4
function fixedFirstRound(courts) {
  const assignments = [];
  for (let c = 0; c < courts; c++) {
    assignments.push({ pair1: [4 * c + 1, 4 * c + 2], pair2: [4 * c + 3, 4 * c + 4] });
  }
  return assignments;
}

// desc(最後の番号から休む)で全節生成。fixedR1=trueなら第1節のみ固定配置
function simulate(courts, totalPlayers, numRounds, fixedR1) {
  const playingCount = courts * 4;
  const restCount = totalPlayers - playingCount;
  const allPlayers = lib.playersN(totalPlayers);
  const restSchedule = lib.generateRestSchedule(allPlayers, restCount, numRounds, null, null, true);

  const pairHistory = {};
  const opponentHistory = {};
  const courtHistory = {};

  for (let r = 0; r < numRounds; r++) {
    const restSet = new Set(restSchedule[r]);
    const active = allPlayers.filter(p => !restSet.has(p));
    let assignments;
    if (r === 0 && fixedR1) {
      assignments = fixedFirstRound(courts);
    } else {
      assignments = lib.assignCourts(active, courts, pairHistory, opponentHistory);
      assignments = lib.balanceCourts(assignments, courtHistory);
    }
    lib.updateHistories(assignments, pairHistory, opponentHistory);
    lib.updateCourtHistory(assignments, courtHistory);
  }
  return { pairHistory, opponentHistory, totalPlayers };
}

// 公平性指標: 同一ペアの最大回数 / 重複ペア組数 / 同一対戦の最大回数 / 未対戦の組数
function metrics(res) {
  const players = lib.playersN(res.totalPlayers);
  let maxPair = 0, dupPairs = 0, maxOpp = 0, unmet = 0;
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const pc = (res.pairHistory[a] && res.pairHistory[a][b]) || 0;
      const oc = (res.opponentHistory[a] && res.opponentHistory[a][b]) || 0;
      if (pc > maxPair) maxPair = pc;
      if (pc >= 2) dupPairs++;
      if (oc > maxOpp) maxOpp = oc;
      if (oc === 0) unmet++;
    }
  }
  return { maxPair, dupPairs, maxOpp, unmet };
}

// --precise で主要構成×20試行モード（ノイズを抑えて差を見る）
const precise = process.argv.includes('--precise');
const TRIALS = precise ? 20 : 5;
const combos = precise
  ? [[2, 10], [2, 12], [3, 14], [4, 18], [4, 20]]
  : [[2, 9], [2, 10], [2, 12], [3, 13], [3, 14], [3, 16], [4, 18], [4, 20], [4, 24]];
const configs = [];
for (const rounds of [10, 15]) {
  for (const [c, p] of combos) {
    configs.push({ courts: c, players: p, rounds });
  }
}

function avg(arr) { return arr.reduce((s, x) => s + x, 0) / arr.length; }

console.log('構成              | モード | maxペア | 重複ペア | max対戦 | 未対戦');
console.log('------------------|--------|---------|----------|---------|-------');
let worse = 0, same = 0, better = 0;
for (const cfg of configs) {
  const results = {};
  for (const mode of ['random', 'fixed']) {
    const ms = [];
    for (let t = 0; t < TRIALS; t++) {
      ms.push(metrics(simulate(cfg.courts, cfg.players, cfg.rounds, mode === 'fixed')));
    }
    results[mode] = {
      maxPair: avg(ms.map(m => m.maxPair)),
      dupPairs: avg(ms.map(m => m.dupPairs)),
      maxOpp: avg(ms.map(m => m.maxOpp)),
      unmet: avg(ms.map(m => m.unmet)),
    };
  }
  const label = `${cfg.courts}c×${String(cfg.players).padStart(2)}p×${cfg.rounds}節`;
  for (const mode of ['random', 'fixed']) {
    const m = results[mode];
    console.log(`${label.padEnd(15)} | ${mode === 'fixed' ? '固定  ' : 'ランダム'} | ${m.maxPair.toFixed(1).padStart(7)} | ${m.dupPairs.toFixed(1).padStart(8)} | ${m.maxOpp.toFixed(1).padStart(7)} | ${m.unmet.toFixed(1).padStart(5)}`);
  }
  // 総合判定: 4指標の重み付き合計で比較（小さいほど良い）
  const sum = m => m.maxPair * 10 + m.dupPairs + m.maxOpp * 10 + m.unmet;
  const diff = sum(results.fixed) - sum(results.random);
  if (diff > 1) worse++; else if (diff < -1) better++; else same++;
}
console.log(`\n総合: 固定が悪化 ${worse}構成 / 同等 ${same}構成 / 固定が改善 ${better}構成（${configs.length}構成、各${TRIALS}試行平均）`);
