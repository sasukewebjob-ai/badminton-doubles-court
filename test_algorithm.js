// アルゴリズムの徹底検証スクリプト
// HTMLからJSを抽出し、Node.jsで実行

const COURT_LABELS = ['A','B','C','D'];
let TOTAL_ROUNDS = 20;

function makeStrideGroups(N, cycle, restCount) {
  const stride = cycle;
  const used = new Set();
  const groups = [];
  for (let offset = 0; offset < stride; offset++) {
    const candidates = [];
    for (let i = 0; offset + 1 + i * stride <= N; i++) {
      candidates.push(offset + 1 + i * stride);
    }
    for (let i = 0; i + restCount <= candidates.length; i += restCount) {
      const group = candidates.slice(i, i + restCount);
      groups.push(group);
      group.forEach(p => used.add(p));
    }
  }
  const leftovers = [];
  for (let p = 1; p <= N; p++) {
    if (!used.has(p)) leftovers.push(p);
  }
  for (let i = 0; i < leftovers.length; i += restCount) {
    groups.push(leftovers.slice(i, i + restCount));
  }
  groups.sort((a, b) => a[0] - b[0]);
  return groups;
}

function strideLinearOrder(N, cycle, restCount) {
  return makeStrideGroups(N, cycle, restCount).flat();
}

function generateRestSchedule(totalPlayers, restCount) {
  if (restCount === 0) return Array.from({length: TOTAL_ROUNDS}, () => []);
  const allPlayers = Array.from({length: totalPlayers}, (_, i) => i + 1);
  const restCounts = {};
  const boundaryHits = {};
  allPlayers.forEach(p => { restCounts[p] = 0; boundaryHits[p] = 0; });

  const restSchedule = [];
  let prevSet = new Set();
  const linearOrderCache = {};
  const getLinearOrder = (cycle) => {
    if (!linearOrderCache[cycle]) {
      linearOrderCache[cycle] = strideLinearOrder(totalPlayers, cycle, restCount);
    }
    return linearOrderCache[cycle];
  };

  while (restSchedule.length < TOTAL_ROUNDS) {
    let curMin = Infinity;
    for (const p of allPlayers) {
      if (restCounts[p] < curMin) curMin = restCounts[p];
    }
    const poolA = allPlayers.filter(p => restCounts[p] === curMin);
    const poolB = allPlayers.filter(p => restCounts[p] === curMin + 1);

    const cycleA = curMin + 1;
    const linearA = getLinearOrder(cycleA);
    const rankA = new Map();
    linearA.forEach((p, i) => rankA.set(p, i));

    const orderedA = poolA.slice().sort((a, b) => {
      const ra = rankA.has(a) ? rankA.get(a) : 0;
      const rb = rankA.has(b) ? rankA.get(b) : 0;
      return ra - rb;
    });

    let picks;
    let fillersFromB = [];

    if (orderedA.length >= restCount) {
      picks = orderedA.slice(0, restCount);
    } else {
      const need = restCount - orderedA.length;
      const cycleB = curMin + 2;
      const linearB = getLinearOrder(cycleB);
      const rankB = new Map();
      linearB.forEach((p, i) => rankB.set(p, i));

      const orderedB = poolB.slice().sort((a, b) => {
        if (boundaryHits[a] !== boundaryHits[b]) {
          return boundaryHits[a] - boundaryHits[b];
        }
        const ra = rankB.has(a) ? rankB.get(a) : 0;
        const rb = rankB.has(b) ? rankB.get(b) : 0;
        return ra - rb;
      });

      const nonPrevB = orderedB.filter(p => !prevSet.has(p));
      fillersFromB = (nonPrevB.length >= need ? nonPrevB : orderedB).slice(0, need);
      picks = orderedA.concat(fillersFromB);
    }

    fillersFromB.forEach(p => boundaryHits[p]++);
    picks.forEach(p => restCounts[p]++);
    restSchedule.push(picks.slice().sort((a, b) => a - b));
    prevSet = new Set(picks);
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

// 第1節がランダム化されたか検証（コート割は依然ランダム）
console.log('\n=== 第1節のコート割ランダム化テスト ===');
const round1Results = new Set();
for (let i = 0; i < 20; i++) {
  const result = generate(4, 16, 20);
  const r1 = result.rounds[0];
  const sig = r1.assignments.map(c => `${c.pair1.join(',')}_vs_${c.pair2.join(',')}`).join('|');
  round1Results.add(sig);
}
console.log(`第1節のユニークパターン数（20回中）: ${round1Results.size}`);
console.log(round1Results.size > 1 ? '✅ ランダム化済み' : '❌ まだ決定論的');

// =========================
// ストライド方式の検証
// =========================
console.log('\n=== ストライド方式 検証 ===');

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function strideTest(label, N, restCount, totalRounds, expectedRounds) {
  TOTAL_ROUNDS = totalRounds;
  const sched = generateRestSchedule(N, restCount);
  let ok = true;
  for (let i = 0; i < expectedRounds.length; i++) {
    if (!arraysEqual(sched[i], expectedRounds[i])) {
      console.log(`  ❌ ${label} 節${i+1}: 期待${JSON.stringify(expectedRounds[i])} 実際${JSON.stringify(sched[i])}`);
      ok = false;
    }
  }
  if (ok) console.log(`  ✅ ${label} (${expectedRounds.length}節パターン一致)`);
  return ok;
}

// N=6, restCount=3 (割り切れ): 1周目[1,2,3][4,5,6] 2周目[1,3,5][2,4,6] 3周目[1,4]... 但しstride3でN=6は[1,4]+[2,5]+[3,6]
strideTest('N=6 r=3', 6, 3, 6, [
  [1,2,3], [4,5,6],
  [1,3,5], [2,4,6],
  [1,2,3], [4,5,6]  // 3周目stride3だが、グループ[1,4][2,5][3,6]はrestCount3に満たないので残り[1,2,3,4,5,6]連番化
]);

// N=9, restCount=3: 周目通りユーザー例
strideTest('N=9 r=3', 9, 3, 9, [
  [1,2,3], [4,5,6], [7,8,9],            // 1周目
  [1,3,5], [2,4,6], [7,8,9],            // 2周目（ユーザー例）
  [1,4,7], [2,5,8], [3,6,9]             // 3周目（ユーザー例）
]);

// N=12, restCount=3: 4の倍数
strideTest('N=12 r=3 cycle1-2', 12, 3, 8, [
  [1,2,3], [4,5,6], [7,8,9], [10,11,12], // 1周目
  [1,3,5], [2,4,6], [7,9,11], [8,10,12]  // 2周目
]);

// =========================
// 境目公平性 (boundaryHits) の検証
// =========================
console.log('\n=== 境目公平性検証 (N=22, r=3, 30節) ===');
{
  TOTAL_ROUNDS = 30;
  const sched = generateRestSchedule(22, 3);
  // 各人の休み回数
  const counts = {};
  for (let p = 1; p <= 22; p++) counts[p] = 0;
  sched.forEach(g => g.forEach(p => counts[p]++));
  const vals = Object.values(counts);
  const maxC = Math.max(...vals), minC = Math.min(...vals);
  console.log(`  休み回数 min=${minC}, max=${maxC}, 差=${maxC - minC} ${maxC - minC <= 1 ? '✅' : '❌'}`);
  console.log(`  休み内訳:`, counts);
  // 第1節は[1,2,3]で固定（決定論）
  console.log(`  第1節: ${JSON.stringify(sched[0])} ${arraysEqual(sched[0], [1,2,3]) ? '✅' : '❌'}`);
  console.log(`  第8節（境目）: ${JSON.stringify(sched[7])}`);
  // 30節全部
  console.log('\n  全30節:');
  sched.forEach((g, i) => console.log(`    節${i+1}: [${g.join(',')}]`));
}

// =========================
// 全構成で最大-最小=1 厳守の確認（決定論版）
// =========================
console.log('\n=== 休み均等化（差≤1）全構成テスト ===');
{
  let fails = 0;
  let total = 0;
  for (const courts of [2, 3, 4]) {
    for (let players = courts * 4; players <= 24; players++) {
      for (const rounds of [10, 15, 20, 25, 30]) {
        const restCount = players - courts * 4;
        if (restCount === 0) continue;
        TOTAL_ROUNDS = rounds;
        const sched = generateRestSchedule(players, restCount);
        const cnt = {};
        for (let p = 1; p <= players; p++) cnt[p] = 0;
        sched.forEach(g => g.forEach(p => cnt[p]++));
        const vals = Object.values(cnt);
        const diff = Math.max(...vals) - Math.min(...vals);
        total++;
        if (diff > 1) {
          fails++;
          if (fails <= 5) {
            console.log(`  ❌ ${courts}c×${players}p×${rounds}r: 差=${diff}`);
          }
        }
      }
    }
  }
  console.log(`  ${total}構成中 ${fails === 0 ? `✅ 全構成で差≤1 達成` : `❌ ${fails}構成で違反`}`);
}
