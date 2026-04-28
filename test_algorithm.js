// アルゴリズムの徹底検証スクリプト
// HTMLからJSを抽出し、Node.jsで実行

const COURT_LABELS = ['A','B','C','D'];
let TOTAL_ROUNDS = 20;

function generateRestSchedule(totalPlayers, restCount) {
  if (restCount === 0) return Array.from({length: TOTAL_ROUNDS}, () => []);
  const allPlayers = Array.from({length: totalPlayers}, (_, i) => i + 1);
  const restSchedule = [];
  const restCounts = {};
  allPlayers.forEach(p => restCounts[p] = 0);

  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  for (let startIdx = 0; startIdx < totalPlayers; startIdx += restCount) {
    if (restSchedule.length >= TOTAL_ROUNDS) break;
    const group = [];
    for (let i = 0; i < restCount; i++) {
      const idx = startIdx + i;
      if (idx < totalPlayers) group.push(allPlayers[idx]);
    }
    if (group.length === restCount) {
      restSchedule.push(group.sort((a, b) => a - b));
      group.forEach(p => restCounts[p]++);
    }
  }

  const zeroPlayers = allPlayers.filter(p => restCounts[p] === 0);
  if (zeroPlayers.length > 0 && restSchedule.length < TOTAL_ROUNDS) {
    const onePlayers = shuffle(allPlayers.filter(p => restCounts[p] === 1));
    const needed = restCount - zeroPlayers.length;
    const fill = onePlayers.slice(0, needed);
    const group = [...zeroPlayers, ...fill].sort((a, b) => a - b);
    restSchedule.push(group);
    group.forEach(p => restCounts[p]++);
  }

  while (restSchedule.length < TOTAL_ROUNDS) {
    const curMin = Math.min(...allPlayers.map(p => restCounts[p]));
    const prevSet = new Set(restSchedule[restSchedule.length - 1]);
    const pool = allPlayers.filter(p => restCounts[p] === curMin);
    const pool2 = allPlayers.filter(p => restCounts[p] === curMin + 1);
    const prioritize = (arr) => {
      const notPrev = shuffle(arr.filter(p => !prevSet.has(p)));
      const inPrev = shuffle(arr.filter(p => prevSet.has(p)));
      return [...notPrev, ...inPrev];
    };
    const candidates = [...prioritize(pool), ...prioritize(pool2)];
    const group = candidates.slice(0, restCount).sort((a, b) => a - b);
    restSchedule.push(group);
    group.forEach(p => restCounts[p]++);
  }

  return restSchedule;
}

function assignCourts(activePlayers, courts, pairHistory, opponentHistory) {
  const bestResult = { assignments: null, score: Infinity };
  for (let trial = 0; trial < 150; trial++) {
    const shuffled = activePlayers.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const pairs = greedyPairing(shuffled, pairHistory);
    if (!pairs) continue;
    const courtAssignments = assignPairsToCourts(pairs, courts, opponentHistory);
    const score = evaluateAssignment(courtAssignments, pairHistory, opponentHistory);
    if (score < bestResult.score) {
      bestResult.score = score;
      bestResult.assignments = courtAssignments;
    }
  }
  return bestResult.assignments;
}

function greedyPairing(players, pairHistory) {
  const n = players.length;
  const used = new Set();
  const pairs = [];
  const candidates = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = players[i], b = players[j];
      const count = (pairHistory[a] && pairHistory[a][b]) || 0;
      candidates.push({ i, j, a, b, count });
    }
  }
  candidates.sort((x, y) => x.count - y.count);
  for (const c of candidates) {
    if (used.has(c.i) || used.has(c.j)) continue;
    pairs.push([c.a, c.b]);
    used.add(c.i);
    used.add(c.j);
    if (pairs.length === n / 2) break;
  }
  return pairs.length === n / 2 ? pairs : null;
}

function assignPairsToCourts(pairs, courts, opponentHistory) {
  const n = pairs.length;
  const used = new Set();
  const courtAssignments = [];
  const matchups = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let oppScore = 0;
      for (const a of pairs[i]) {
        for (const b of pairs[j]) {
          oppScore += (opponentHistory[a] && opponentHistory[a][b]) || 0;
        }
      }
      matchups.push({ i, j, score: oppScore });
    }
  }
  matchups.sort((a, b) => a.score - b.score);
  for (const m of matchups) {
    if (used.has(m.i) || used.has(m.j)) continue;
    courtAssignments.push({ pair1: pairs[m.i], pair2: pairs[m.j] });
    used.add(m.i);
    used.add(m.j);
    if (courtAssignments.length === courts) break;
  }
  return courtAssignments;
}

function evaluateAssignment(assignments, pairHistory, opponentHistory) {
  if (!assignments) return Infinity;
  let score = 0;
  for (const court of assignments) {
    const p1 = (pairHistory[court.pair1[0]] && pairHistory[court.pair1[0]][court.pair1[1]]) || 0;
    const p2 = (pairHistory[court.pair2[0]] && pairHistory[court.pair2[0]][court.pair2[1]]) || 0;
    score += (p1 + p2) * 10;
    for (const a of court.pair1) {
      for (const b of court.pair2) {
        score += (opponentHistory[a] && opponentHistory[a][b]) || 0;
      }
    }
  }
  return score;
}

function updateHistories(assignments, pairHistory, opponentHistory) {
  for (const court of assignments) {
    const [a1, a2] = court.pair1;
    const [b1, b2] = court.pair2;
    addHistory(pairHistory, a1, a2);
    addHistory(pairHistory, b1, b2);
    for (const a of court.pair1) {
      for (const b of court.pair2) {
        addHistory(opponentHistory, a, b);
      }
    }
  }
}

function addHistory(hist, a, b) {
  if (!hist[a]) hist[a] = {};
  if (!hist[b]) hist[b] = {};
  hist[a][b] = (hist[a][b] || 0) + 1;
  hist[b][a] = (hist[b][a] || 0) + 1;
}

function generate(courts, totalPlayers, numRounds) {
  TOTAL_ROUNDS = numRounds || 20;
  const playingCount = courts * 4;
  const restCount = totalPlayers - playingCount;
  const restSchedule = generateRestSchedule(totalPlayers, restCount);
  const allPlayers = Array.from({length: totalPlayers}, (_, i) => i + 1);
  const pairHistory = {};
  const opponentHistory = {};
  const restHistory = {};
  allPlayers.forEach(p => restHistory[p] = 0);
  const rounds = [];
  for (let r = 0; r < TOTAL_ROUNDS; r++) {
    const resting = restSchedule[r];
    const restSet = new Set(resting);
    const active = allPlayers.filter(p => !restSet.has(p));
    resting.forEach(p => restHistory[p]++);
    const assignments = assignCourts(active, courts, pairHistory, opponentHistory);
    updateHistories(assignments, pairHistory, opponentHistory);
    rounds.push({ round: r + 1, resting, assignments });
  }
  return { rounds, courts, totalPlayers, restCount, restHistory, pairHistory, opponentHistory };
}

// =========================
// 検証ロジック
// =========================
function validate(result) {
  const { rounds, courts, totalPlayers, restCount, restHistory, pairHistory } = result;
  const errors = [];
  const warnings = [];

  // 1. 各ラウンドで全員が休みorアクティブで重複なし
  for (const r of rounds) {
    const restSet = new Set(r.resting);
    const activeSet = new Set();
    for (const c of r.assignments) {
      for (const p of [...c.pair1, ...c.pair2]) {
        if (activeSet.has(p)) errors.push(`Round ${r.round}: player ${p} appears twice in courts`);
        activeSet.add(p);
        if (restSet.has(p)) errors.push(`Round ${r.round}: player ${p} is both resting and playing`);
      }
    }
    // 全員カバー
    for (let p = 1; p <= totalPlayers; p++) {
      if (!restSet.has(p) && !activeSet.has(p)) {
        errors.push(`Round ${r.round}: player ${p} is missing (neither resting nor playing)`);
      }
    }
    // コート数
    if (r.assignments.length !== courts) {
      errors.push(`Round ${r.round}: expected ${courts} courts, got ${r.assignments.length}`);
    }
    // 休み人数
    if (r.resting.length !== restCount) {
      errors.push(`Round ${r.round}: expected ${restCount} resting, got ${r.resting.length}`);
    }
  }

  // 2. 休み回数の差
  const restValues = Object.values(restHistory);
  const minRest = Math.min(...restValues);
  const maxRest = Math.max(...restValues);
  if (maxRest - minRest > 1) {
    errors.push(`Rest imbalance: max=${maxRest}, min=${minRest}, diff=${maxRest - minRest}`);
  }

  // 3. 休み + プレイ = totalRounds
  const totalRounds = rounds.length;
  for (let p = 1; p <= totalPlayers; p++) {
    let playCount = 0;
    for (const r of rounds) {
      const restSet = new Set(r.resting);
      if (!restSet.has(p)) playCount++;
    }
    const totalAppearances = restHistory[p] + playCount;
    if (totalAppearances !== totalRounds) {
      errors.push(`Player ${p}: rest(${restHistory[p]}) + play(${playCount}) = ${totalAppearances} != ${totalRounds}`);
    }
  }

  // 4. 連続休み回避（強制じゃなく品質チェック）
  let consecutiveRests = 0;
  for (let p = 1; p <= totalPlayers; p++) {
    for (let i = 1; i < rounds.length; i++) {
      const prev = rounds[i-1].resting.includes(p);
      const curr = rounds[i].resting.includes(p);
      if (prev && curr) consecutiveRests++;
    }
  }

  // 5. ペア履歴の対称性
  for (const a in pairHistory) {
    for (const b in pairHistory[a]) {
      if (!pairHistory[b] || pairHistory[b][a] !== pairHistory[a][b]) {
        errors.push(`Pair history not symmetric: ${a}-${b}=${pairHistory[a][b]}, ${b}-${a}=${pairHistory[b]?.[a]}`);
      }
    }
  }

  // 6. 同じ人と同ラウンドで2回ペアになっていないか
  for (const r of rounds) {
    const pairsInRound = new Set();
    for (const c of r.assignments) {
      const pairs = [c.pair1, c.pair2];
      for (const pair of pairs) {
        const key = [pair[0], pair[1]].sort((a,b) => a-b).join('-');
        if (pairsInRound.has(key)) errors.push(`Round ${r.round}: duplicate pair ${key}`);
        pairsInRound.add(key);
      }
    }
  }

  // 7. ペアの偏り
  const pairCounts = [];
  for (const a in pairHistory) {
    for (const b in pairHistory[a]) {
      if (parseInt(a) < parseInt(b)) pairCounts.push(pairHistory[a][b]);
    }
  }
  const maxPair = Math.max(...pairCounts);
  const minPair = pairCounts.length ? Math.min(...pairCounts) : 0;

  // 8. 未対戦ペア数
  const totalPossiblePairs = totalPlayers * (totalPlayers - 1) / 2;
  const occurredPairs = pairCounts.length;
  const neverPaired = totalPossiblePairs - occurredPairs;

  return {
    errors,
    warnings,
    stats: {
      minRest, maxRest, restDiff: maxRest - minRest,
      consecutiveRests,
      maxPairCount: maxPair, minPairCount: minPair,
      occurredPairs, totalPossiblePairs, neverPaired
    }
  };
}

// =========================
// 全パターンを実行（節数も可変）
// =========================
const roundOptions = [10, 15, 20, 25, 30];
const configs = [];
for (const courts of [2, 3, 4]) {
  for (let players = courts * 4; players <= 24; players++) {
    for (const rounds of roundOptions) {
      configs.push([courts, players, rounds]);
    }
  }
}

console.log(`Testing ${configs.length} configurations × 5 trials each...\n`);

let totalErrors = 0;
const errorDetails = [];

for (const [courts, players, rounds] of configs) {
  const trials = 5;
  for (let t = 0; t < trials; t++) {
    const result = generate(courts, players, rounds);
    const v = validate(result);
    if (v.errors.length > 0) {
      totalErrors += v.errors.length;
      if (errorDetails.length < 10) {
        errorDetails.push(`${courts}c×${players}p×${rounds}r trial${t}: ${v.errors[0]}`);
      }
    }
  }
}

// 節数ごとのサマリー
console.log('=== 節数別サマリー（4コート×20人で各10回） ===');
console.log('rounds | restDiff(max-min) | maxPair | 未ペア');
for (const rounds of roundOptions) {
  let restDiffs = [];
  let maxPairs = [];
  let neverPaireds = [];
  for (let t = 0; t < 10; t++) {
    const result = generate(4, 20, rounds);
    const v = validate(result);
    restDiffs.push(v.stats.restDiff);
    maxPairs.push(v.stats.maxPairCount);
    neverPaireds.push(v.stats.neverPaired);
  }
  const avg = (a) => a.reduce((s,x) => s+x, 0) / a.length;
  console.log(`  ${String(rounds).padStart(2)}   |       ${avg(restDiffs).toFixed(2)}        |   ${avg(maxPairs).toFixed(1)}   |   ${avg(neverPaireds).toFixed(1)}`);
}

console.log(`\n総テスト数: ${configs.length * 5} (構成${configs.length}×5回)`);
console.log(`総エラー数: ${totalErrors}`);
if (errorDetails.length > 0) {
  console.log('\nエラー例:');
  errorDetails.forEach(e => console.log(`  - ${e}`));
}
console.log(totalErrors === 0 ? '\n✅ すべてのテスト合格' : '\n❌ エラー検出');

// 第1節がランダム化されたか検証
console.log('\n=== 第1節の決定論問題テスト ===');
const round1Results = new Set();
for (let i = 0; i < 20; i++) {
  const result = generate(4, 16, 20);
  const r1 = result.rounds[0];
  const sig = r1.assignments.map(c => `${c.pair1.join(',')}_vs_${c.pair2.join(',')}`).join('|');
  round1Results.add(sig);
}
console.log(`第1節のユニークパターン数（20回中）: ${round1Results.size}`);
console.log(round1Results.size > 1 ? '✅ ランダム化済み' : '❌ まだ決定論的');
