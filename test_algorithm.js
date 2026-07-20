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

function playersN(n) {
  return Array.from({length: n}, (_, i) => i + 1);
}

// players: 参加者番号の配列（欠番可）
// initialRestCounts: 引き継ぐ休み回数（途中変更時）。省略時は全員0
// prevResting: 直前節の休み（境目の連続休み回避に使用）。省略可
function generateRestSchedule(players, restCount, numRounds, initialRestCounts, prevResting, reverse, deferredNew) {
  if (restCount === 0) return Array.from({length: numRounds}, () => []);

  const allPlayers = players.slice().sort((a, b) => reverse ? b - a : a - b);
  const M = allPlayers.length;
  // 欠番があってもストライドが機能するよう、番号順の並び位置(1..M)で組んで番号に戻す
  const playerAt = pos => allPlayers[pos - 1];

  const restCounts = {};
  const initialOf = {};
  const boundaryHits = {};
  const deferred = new Set(deferredNew || []);
  allPlayers.forEach(p => {
    restCounts[p] = (initialRestCounts && initialRestCounts[p]) || 0;
    initialOf[p] = restCounts[p];
    boundaryHits[p] = 0;
  });

  const restSchedule = [];
  let prevSet = new Set(prevResting || []);
  const linearOrderCache = {};
  const getLinearOrder = (cycle) => {
    if (!linearOrderCache[cycle]) {
      linearOrderCache[cycle] = strideLinearOrder(M, cycle, restCount).map(playerAt);
    }
    return linearOrderCache[cycle];
  };

  while (restSchedule.length < numRounds) {
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

    // 途中追加者の並び補正: 初休みは周回の最後尾（重み2）、
    // 初休み直後の節は連続休み回避で後ろへ（重み1・軟制約）
    const deferWeight = p => {
      if (!deferred.has(p)) return 0;
      if (restCounts[p] === initialOf[p]) return 2;
      if (prevSet.has(p)) return 1;
      return 0;
    };

    const orderedA = poolA.slice().sort((a, b) => {
      const wa = deferWeight(a);
      const wb = deferWeight(b);
      if (wa !== wb) return wa - wb;
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

// --- 種目別コート（index.html と同じ実装のコピー） ---
function courtTemplates(mCount, fCount, courts) {
  const wants = [{m:4,f:0},{m:0,f:4},{m:2,f:2},{m:2,f:2}].slice(0, courts);
  let availM = mCount, availF = fCount;
  return wants.map(w => {
    let m = Math.min(w.m, availM);
    let f = Math.min(w.f, availF);
    while (m + f < 4) {
      if (availM - m >= availF - f) m++; else f++;
    }
    availM -= m; availF -= f;
    return { m, f };
  });
}

function pairTypesFor(t) {
  if (t.m === 4) return ['MM', 'MM'];
  if (t.m === 3) return ['MM', 'MF'];
  if (t.m === 2) return ['MF', 'MF'];
  if (t.m === 1) return ['MF', 'FF'];
  return ['FF', 'FF'];
}

function genderAssign(shuffled, courts, genders, pairHistory, opponentHistory) {
  const males = shuffled.filter(p => genders[p] === 'M');
  const females = shuffled.filter(p => genders[p] === 'F');
  const templates = courtTemplates(males.length, females.length, courts);
  const courtNeeds = templates.map(pairTypesFor);
  const quota = { MM: 0, MF: 0, FF: 0 };
  courtNeeds.forEach(ts => ts.forEach(t => quota[t]++));

  const n = shuffled.length;
  const candidates = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = shuffled[i], b = shuffled[j];
      const type = genders[a] === genders[b] ? genders[a] + genders[b] : 'MF';
      const count = (pairHistory[a] && pairHistory[a][b]) || 0;
      candidates.push({ i, j, a, b, type, count });
    }
  }
  candidates.sort((x, y) => x.count - y.count);
  const used = new Set();
  const byType = { MM: [], MF: [], FF: [] };
  for (const c of candidates) {
    if (quota[c.type] === 0 || used.has(c.i) || used.has(c.j)) continue;
    quota[c.type]--;
    used.add(c.i);
    used.add(c.j);
    byType[c.type].push([c.a, c.b]);
  }

  const oppScore = (p, q) => {
    let s = 0;
    for (const a of p) for (const b of q) s += (opponentHistory[a] && opponentHistory[a][b]) || 0;
    return s;
  };
  const assignments = [];
  for (const [t1, t2] of courtNeeds) {
    let best = null;
    if (t1 === t2) {
      const list = byType[t1];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const s = oppScore(list[i], list[j]);
          if (!best || s < best.s) best = { s, i, j };
        }
      }
    } else {
      for (let i = 0; i < byType[t1].length; i++) {
        for (let j = 0; j < byType[t2].length; j++) {
          const s = oppScore(byType[t1][i], byType[t2][j]);
          if (!best || s < best.s) best = { s, i, j };
        }
      }
    }
    const pair2 = byType[t2].splice(best.j, 1)[0];
    const pair1 = byType[t1].splice(best.i, 1)[0];
    assignments.push({ pair1, pair2 });
  }
  return assignments;
}

function balanceCourtsSameType(assignments, courtHistory, genders) {
  if (!assignments || assignments.length <= 1) return assignments;
  const maleCount = c => c.pair1.concat(c.pair2).filter(p => genders[p] === 'M').length;
  const groups = {};
  assignments.forEach((c, i) => {
    const k = maleCount(c);
    (groups[k] = groups[k] || []).push(i);
  });
  const result = assignments.slice();
  for (const k in groups) {
    const idxs = groups[k];
    if (idxs.length <= 1) continue;
    const perms = [];
    (function permute(arr, cur) {
      if (arr.length === 0) { perms.push(cur); return; }
      for (let i = 0; i < arr.length; i++) {
        permute(arr.slice(0, i).concat(arr.slice(i + 1)), cur.concat(arr[i]));
      }
    })(idxs, []);
    let bestScore = Infinity;
    let bestPerm = perms[0];
    for (const perm of perms) {
      let score = 0;
      perm.forEach((srcIdx, j) => {
        const courtIdx = idxs[j];
        for (const p of assignments[srcIdx].pair1.concat(assignments[srcIdx].pair2)) {
          const cur = (courtHistory[p] && courtHistory[p][courtIdx]) || 0;
          score += (cur + 1) * (cur + 1);
        }
      });
      if (score < bestScore) {
        bestScore = score;
        bestPerm = perm;
      }
    }
    bestPerm.forEach((srcIdx, j) => { result[idxs[j]] = assignments[srcIdx]; });
  }
  return result;
}

function assignCourts(activePlayers, courts, pairHistory, opponentHistory, genders) {
  const candidates = [];
  for (let trial = 0; trial < 150; trial++) {
    const shuffled = activePlayers.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    let courtAssignments;
    if (genders) {
      courtAssignments = genderAssign(shuffled, courts, genders, pairHistory, opponentHistory);
    } else {
      const pairs = greedyPairing(shuffled, pairHistory);
      if (!pairs) continue;
      courtAssignments = assignPairsToCourts(pairs, courts, opponentHistory);
    }
    const score = evaluateAssignment(courtAssignments, pairHistory, opponentHistory);
    candidates.push({ assignments: courtAssignments, score });
  }
  // 上位5候補を局所探索で磨き、最良を採用
  candidates.sort((a, b) => a.score - b.score);
  const best = { assignments: null, score: Infinity };
  for (const cand of candidates.slice(0, 5)) {
    const r = localSearchImprove(cand.assignments, pairHistory, opponentHistory, genders);
    if (r.score < best.score) {
      best.score = r.score;
      best.assignments = r.assignments;
    }
  }
  return best.assignments;
}

// 選手2人の入れ替えを全組み合わせで試し、スコアが下がる限り繰り返す局所探索
function localSearchImprove(assignments, pairHistory, opponentHistory, genders) {
  let current = JSON.parse(JSON.stringify(assignments));
  let bestScore = evaluateAssignment(current, pairHistory, opponentHistory);
  let improved = true;
  while (improved) {
    improved = false;
    const positions = [];
    current.forEach((c, ci) => {
      positions.push([ci, 1, 0], [ci, 1, 1], [ci, 2, 0], [ci, 2, 1]);
    });
    for (let x = 0; x < positions.length; x++) {
      for (let y = x + 1; y < positions.length; y++) {
        const [ci1, pi1, s1] = positions[x];
        const [ci2, pi2, s2] = positions[y];
        if (ci1 === ci2 && pi1 === pi2) continue; // 同一ペア内の入替は結果が変わらない
        if (genders) {
          const g1 = (pi1 === 1 ? current[ci1].pair1 : current[ci1].pair2)[s1];
          const g2 = (pi2 === 1 ? current[ci2].pair1 : current[ci2].pair2)[s2];
          if (genders[g1] !== genders[g2]) continue;
        }
        const trial = JSON.parse(JSON.stringify(current));
        const arr1 = pi1 === 1 ? trial[ci1].pair1 : trial[ci1].pair2;
        const arr2 = pi2 === 1 ? trial[ci2].pair1 : trial[ci2].pair2;
        const tmp = arr1[s1]; arr1[s1] = arr2[s2]; arr2[s2] = tmp;
        const sc = evaluateAssignment(trial, pairHistory, opponentHistory);
        if (sc < bestScore) {
          bestScore = sc;
          current = trial;
          improved = true;
        }
      }
    }
  }
  return { assignments: current, score: bestScore };
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

// ペア回数は最優先（重み1000）、対戦相手は回数が多いほど急増する超線形ペナルティ
// (c+1)^2 : 0回→1, 1回→4, 2回→9, 3回→16 …「同じ相手と3回目・4回目」を強く回避
function evaluateAssignment(assignments, pairHistory, opponentHistory) {
  if (!assignments) return Infinity;
  let score = 0;
  for (const court of assignments) {
    const p1 = (pairHistory[court.pair1[0]] && pairHistory[court.pair1[0]][court.pair1[1]]) || 0;
    const p2 = (pairHistory[court.pair2[0]] && pairHistory[court.pair2[0]][court.pair2[1]]) || 0;
    score += ((p1 + 1) * (p1 + 1) + (p2 + 1) * (p2 + 1)) * 1000;
    for (const a of court.pair1) {
      for (const b of court.pair2) {
        const c = (opponentHistory[a] && opponentHistory[a][b]) || 0;
        score += (c + 1) * (c + 1);
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

function balanceCourts(assignments, courtHistory) {
  if (!assignments || assignments.length <= 1) return assignments;
  const n = assignments.length;
  const perms = [];
  (function permute(arr, current) {
    if (arr.length === 0) { perms.push(current); return; }
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      permute(rest, current.concat(arr[i]));
    }
  })([...Array(n).keys()], []);
  let bestScore = Infinity;
  let bestPerm = perms[0];
  for (const perm of perms) {
    let score = 0;
    for (let courtIdx = 0; courtIdx < n; courtIdx++) {
      const m = assignments[perm[courtIdx]];
      const players = m.pair1.concat(m.pair2);
      for (const p of players) {
        const cur = (courtHistory[p] && courtHistory[p][courtIdx]) || 0;
        score += (cur + 1) * (cur + 1);
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestPerm = perm;
    }
  }
  return bestPerm.map(i => assignments[i]);
}

function updateCourtHistory(assignments, courtHistory) {
  assignments.forEach((m, courtIdx) => {
    for (const p of m.pair1) {
      if (!courtHistory[p]) courtHistory[p] = {};
      courtHistory[p][courtIdx] = (courtHistory[p][courtIdx] || 0) + 1;
    }
    for (const p of m.pair2) {
      if (!courtHistory[p]) courtHistory[p] = {};
      courtHistory[p][courtIdx] = (courtHistory[p][courtIdx] || 0) + 1;
    }
  });
}

function addHistory(hist, a, b) {
  if (!hist[a]) hist[a] = {};
  if (!hist[b]) hist[b] = {};
  hist[a][b] = (hist[a][b] || 0) + 1;
  hist[b][a] = (hist[b][a] || 0) + 1;
}

function generate(courts, totalPlayers, numRounds, restOrder) {
  TOTAL_ROUNDS = numRounds || 20;
  const playingCount = courts * 4;
  const restCount = totalPlayers - playingCount;
  const allPlayers = playersN(totalPlayers);
  const restSchedule = generateRestSchedule(allPlayers, restCount, TOTAL_ROUNDS, null, null, restOrder === 'desc');
  const pairHistory = {};
  const opponentHistory = {};
  const restHistory = {};
  const courtHistory = {};
  allPlayers.forEach(p => restHistory[p] = 0);
  const rounds = [];
  for (let r = 0; r < TOTAL_ROUNDS; r++) {
    const resting = restSchedule[r];
    const restSet = new Set(resting);
    const active = allPlayers.filter(p => !restSet.has(p));
    resting.forEach(p => restHistory[p]++);
    let assignments;
    if (r === 0 && restOrder === 'desc') {
      // index.html と同じ: desc の第1節は番号順の固定配置
      assignments = [];
      for (let c = 0; c < courts; c++) {
        assignments.push({
          pair1: [active[c * 4], active[c * 4 + 1]],
          pair2: [active[c * 4 + 2], active[c * 4 + 3]]
        });
      }
    } else {
      assignments = assignCourts(active, courts, pairHistory, opponentHistory);
      assignments = balanceCourts(assignments, courtHistory);
    }
    updateHistories(assignments, pairHistory, opponentHistory);
    updateCourtHistory(assignments, courtHistory);
    rounds.push({ round: r + 1, resting, assignments });
  }
  return { rounds, courts, totalPlayers, restCount, restHistory, pairHistory, opponentHistory, courtHistory };
}

// --- メンバー途中変更（index.html の applyMemberChange と同じロジック） ---
function generateSession(courts, totalPlayers, numRounds, restOrder) {
  const res = generate(courts, totalPlayers, numRounds, restOrder);
  return {
    totalRounds: numRounds,
    restOrder: restOrder,
    initialCourts: courts,
    courts,
    players: playersN(totalPlayers),
    everPlayers: playersN(totalPlayers),
    maxNumber: totalPlayers,
    changes: [],
    rounds: res.rounds
  };
}

function applyMemberChangeTest(session, consumed, addCount, removeNumbers, newCourts, returnNumbers = []) {
  const remaining = session.totalRounds - consumed;

  const removedSet = new Set(removeNumbers);
  const continuing = session.players.filter(p => !removedSet.has(p));
  const newNumbers = [];
  for (let i = 1; i <= addCount; i++) newNumbers.push(session.maxNumber + i);
  const newPlayers = continuing.concat(returnNumbers).concat(newNumbers).sort((a, b) => a - b);

  const kept = session.rounds.slice(0, consumed);
  const pairHistory = {};
  const opponentHistory = {};
  const courtHistory = {};
  const restHistory = {};
  session.everPlayers.concat(newNumbers).forEach(p => restHistory[p] = 0);
  for (const round of kept) {
    round.resting.forEach(p => restHistory[p]++);
    updateHistories(round.assignments, pairHistory, opponentHistory);
    updateCourtHistory(round.assignments, courtHistory);
  }

  const contCounts = continuing.map(p => restHistory[p]);
  const minCont = contCounts.length > 0 ? Math.min(...contCounts) : 0;
  const initialRestCounts = {};
  continuing.forEach(p => initialRestCounts[p] = restHistory[p]);
  returnNumbers.forEach(p => initialRestCounts[p] = Math.max(restHistory[p], minCont));
  newNumbers.forEach(p => initialRestCounts[p] = minCont);

  const restCount = newPlayers.length - newCourts * 4;
  const prevResting = kept.length > 0 ? kept[kept.length - 1].resting : [];
  const restSchedule = generateRestSchedule(newPlayers, restCount, remaining, initialRestCounts, prevResting, session.restOrder === 'desc', newNumbers);

  const newRounds = [];
  for (let r = 0; r < remaining; r++) {
    const resting = restSchedule[r];
    const restSet = new Set(resting);
    const active = newPlayers.filter(p => !restSet.has(p));
    resting.forEach(p => restHistory[p]++);
    let assignments = assignCourts(active, newCourts, pairHistory, opponentHistory);
    assignments = balanceCourts(assignments, courtHistory);
    updateHistories(assignments, pairHistory, opponentHistory);
    updateCourtHistory(assignments, courtHistory);
    newRounds.push({ round: consumed + r + 1, resting, assignments });
  }

  session.rounds = kept.concat(newRounds);
  session.players = newPlayers;
  session.everPlayers = session.everPlayers.concat(newNumbers);
  session.maxNumber += addCount;
  session.courts = newCourts;
  session.changes.push({ atRound: consumed + 1, added: newNumbers, removed: removeNumbers, returned: returnNumbers, courts: newCourts });

  return { newNumbers, initialRestCounts };
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
  const sched = generateRestSchedule(playersN(N), restCount, totalRounds);
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
  const sched = generateRestSchedule(playersN(22), 3, 30);
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
        const sched = generateRestSchedule(playersN(players), restCount, rounds);
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

// =========================
// コート均等化検証（新機能）
// =========================
console.log('\n=== コート均等化検証 ===');
{
  // プレイヤーごとの (max-min) コート登場差を計算
  function courtDiffStats(result) {
    const { courts, totalPlayers, courtHistory, rounds } = result;
    const perPlayerDiff = [];
    const worstCase = { player: null, court: null, count: 0, plays: 0 };
    for (let p = 1; p <= totalPlayers; p++) {
      // 各コートの登場回数
      const counts = new Array(courts).fill(0);
      for (let c = 0; c < courts; c++) {
        counts[c] = (courtHistory[p] && courtHistory[p][c]) || 0;
      }
      const plays = counts.reduce((s, x) => s + x, 0);
      if (plays === 0) continue; // 全休みのケース
      const mx = Math.max(...counts), mn = Math.min(...counts);
      perPlayerDiff.push(mx - mn);
      if (mx > worstCase.count) {
        worstCase.player = p;
        worstCase.count = mx;
        worstCase.plays = plays;
        worstCase.court = counts.indexOf(mx);
      }
    }
    return {
      maxDiff: Math.max(...perPlayerDiff),
      avgDiff: perPlayerDiff.reduce((s, x) => s + x, 0) / perPlayerDiff.length,
      worstCase
    };
  }

  console.log('構成（c×p×r） |  最大差 |  平均差 | 最頻コート登場');
  for (const courts of [2, 3, 4]) {
    for (const players of [courts * 4, courts * 4 + 2, Math.min(24, courts * 4 + 4)]) {
      for (const rounds of [10, 15, 20]) {
        let totalMax = 0, totalAvg = 0, runs = 5;
        for (let t = 0; t < runs; t++) {
          const result = generate(courts, players, rounds);
          const s = courtDiffStats(result);
          totalMax = Math.max(totalMax, s.maxDiff);
          totalAvg += s.avgDiff;
        }
        console.log(`  ${courts}c×${players}p×${rounds}r | ${String(totalMax).padStart(4)}   | ${(totalAvg/runs).toFixed(2)}    |`);
      }
    }
  }

  // フェアネス全構成テスト：最大差が一定以下か
  console.log('\n=== 全構成でのコート最大差統計 ===');
  const buckets = { '0-1': 0, '2': 0, '3': 0, '4+': 0 };
  let total = 0;
  for (const courts of [2, 3, 4]) {
    for (let players = courts * 4; players <= 24; players++) {
      for (const rounds of [10, 15, 20]) {
        for (let t = 0; t < 3; t++) {
          const result = generate(courts, players, rounds);
          const s = courtDiffStats(result);
          total++;
          if (s.maxDiff <= 1) buckets['0-1']++;
          else if (s.maxDiff === 2) buckets['2']++;
          else if (s.maxDiff === 3) buckets['3']++;
          else buckets['4+']++;
        }
      }
    }
  }
  console.log(`  全${total}回中:`);
  console.log(`    最大差 0-1: ${buckets['0-1']} (${(buckets['0-1']/total*100).toFixed(1)}%)`);
  console.log(`    最大差  2 : ${buckets['2']} (${(buckets['2']/total*100).toFixed(1)}%)`);
  console.log(`    最大差  3 : ${buckets['3']} (${(buckets['3']/total*100).toFixed(1)}%)`);
  console.log(`    最大差 4+ : ${buckets['4+']} (${(buckets['4+']/total*100).toFixed(1)}%)`);

  // ユーザー報告のケース（ずっとAコート）を再現させない
  console.log('\n=== 「ずっと同じコート」回避テスト ===');
  let stuckCases = 0;
  let stuckSamples = [];
  for (let t = 0; t < 30; t++) {
    const result = generate(4, 16, 15);
    for (let p = 1; p <= 16; p++) {
      const counts = [0,1,2,3].map(c => (result.courtHistory[p] && result.courtHistory[p][c]) || 0);
      const plays = counts.reduce((s,x)=>s+x, 0);
      // 全試合中、1つのコートに 80%以上集中していたら「ずっと同じ」
      const mx = Math.max(...counts);
      if (plays >= 10 && mx / plays >= 0.8) {
        stuckCases++;
        if (stuckSamples.length < 3) {
          stuckSamples.push(`trial${t} player${p}: ${counts.join('/')} (plays=${plays})`);
        }
      }
    }
  }
  console.log(`  30試行×16人=${30*16}ケース中、80%以上同コート集中: ${stuckCases}件 ${stuckCases === 0 ? '✅' : '❌'}`);
  stuckSamples.forEach(s => console.log(`    例: ${s}`));
}

// =========================
// メンバー途中変更 検証
// =========================
console.log('\n=== メンバー途中変更 検証 ===');

function roundPlayers(round) {
  const ps = [...round.resting];
  round.assignments.forEach(m => ps.push(...m.pair1, ...m.pair2));
  return ps;
}

function validateChangeScenario(label, courts, players, totalRounds, consumed, addCount, removeNumbers, newCourts, opts) {
  const errors = [];
  const trials = 3;
  let maxOppSeen = 0;
  for (let t = 0; t < trials; t++) {
    const sess = generateSession(courts, players, totalRounds);
    const origRounds = JSON.parse(JSON.stringify(sess.rounds));
    const { newNumbers, initialRestCounts } = applyMemberChangeTest(sess, consumed, addCount, removeNumbers, newCourts);

    // 1. 消化済み節が不変
    for (let i = 0; i < consumed; i++) {
      if (JSON.stringify(sess.rounds[i]) !== JSON.stringify(origRounds[i])) {
        errors.push(`第${i+1}節（消化済み）が変わってしまった`);
      }
    }
    // 2. 変更後: 参加者がちょうど揃い、離脱者・重複なし、コート数一致
    const newSet = new Set(sess.players);
    for (let i = consumed; i < totalRounds; i++) {
      const r = sess.rounds[i];
      const ps = roundPlayers(r);
      if (ps.length !== sess.players.length) errors.push(`第${i+1}節 人数不一致 ${ps.length}≠${sess.players.length}`);
      const seen = new Set();
      for (const p of ps) {
        if (seen.has(p)) errors.push(`第${i+1}節 ${p}番が重複`);
        seen.add(p);
        if (!newSet.has(p)) errors.push(`第${i+1}節 不参加の${p}番が登場`);
      }
      if (r.assignments.length !== newCourts) errors.push(`第${i+1}節 コート数 ${r.assignments.length}≠${newCourts}`);
    }
    // 3. 変更前に新規参加者が登場しない
    for (let i = 0; i < consumed; i++) {
      const ps = roundPlayers(sess.rounds[i]);
      for (const p of newNumbers) {
        if (ps.includes(p)) errors.push(`新規${p}番が変更前の第${i+1}節に登場`);
      }
    }
    // 4. ペア厳守（余裕のある構成のみ）: 全節通して同じペアが2回発生しないこと
    if (opts && opts.strictPair) {
      const pairHistory = {};
      sess.rounds.forEach(r => updateHistories(r.assignments, pairHistory, {}));
      let maxPair = 0;
      for (const a in pairHistory) for (const b in pairHistory[a]) maxPair = Math.max(maxPair, pairHistory[a][b]);
      if (maxPair > 1) errors.push(`同じペアが${maxPair}回発生（厳守違反）`);
    }
    // 5. 休み公平性: 仮想カウント（引き継ぎ初期値＋変更後実績）の差 ≤ 1
    if (sess.players.length > newCourts * 4) {
      const virtual = Object.assign({}, initialRestCounts);
      for (let i = consumed; i < totalRounds; i++) {
        sess.rounds[i].resting.forEach(p => virtual[p]++);
      }
      const vals = sess.players.map(p => virtual[p]);
      const diff = Math.max(...vals) - Math.min(...vals);
      if (diff > 1) errors.push(`変更後の休み公平性 差=${diff} > 1`);
    }
    // 6. 対戦回数の最大値（参考情報）
    {
      const oppHistory = {};
      sess.rounds.forEach(r => updateHistories(r.assignments, {}, oppHistory));
      for (const a in oppHistory) for (const b in oppHistory[a]) maxOppSeen = Math.max(maxOppSeen, oppHistory[a][b]);
    }
  }
  const ok = errors.length === 0;
  console.log(`  ${ok ? '✅' : '❌'} ${label}（最大対戦${maxOppSeen}回）`);
  errors.slice(0, 5).forEach(e => console.log(`     - ${e}`));
  return errors.length;
}

let changeErrors = 0;
changeErrors += validateChangeScenario('4c20p15節 5節終了時 +2人/−2人(3,7番)', 4, 20, 15, 5, 2, [3, 7], 4, { strictPair: true });
changeErrors += validateChangeScenario('4c18p12節 4節終了時 −2人(5,9番)→3コート', 4, 18, 12, 4, 0, [5, 9], 3, { strictPair: true });
changeErrors += validateChangeScenario('4c18p12節 4節終了時 −5人→3コート', 4, 18, 12, 4, 0, [2, 5, 9, 11, 17], 3, {});
changeErrors += validateChangeScenario('4c16p10節(休みなし) 3節終了時 +2人', 4, 16, 10, 3, 2, [], 4, { strictPair: true });
changeErrors += validateChangeScenario('4c17p10節 5節終了時 −1人(17番)→休みなし', 4, 17, 10, 5, 0, [17], 4, { strictPair: true });
changeErrors += validateChangeScenario('2c10p15節 7節終了時 +1人/−1人(4番)', 2, 10, 15, 7, 1, [4], 2, {});

// 二重変更（変更のあとにさらに変更。直前変更で入った人の離脱も含む）
{
  const sess = generateSession(4, 20, 15);
  applyMemberChangeTest(sess, 5, 2, [3, 7], 4);
  const before = JSON.parse(JSON.stringify(sess.rounds.slice(0, 8)));
  applyMemberChangeTest(sess, 8, 1, [21], 4);
  let ok = JSON.stringify(sess.rounds.slice(0, 8)) === JSON.stringify(before);
  for (let i = 8; i < 15; i++) {
    const ps = roundPlayers(sess.rounds[i]);
    if (ps.includes(21) || ps.includes(3) || ps.includes(7)) ok = false;
    if (!ps.includes(23)) ok = false; // 2回目の追加者
  }
  console.log(`  ${ok ? '✅' : '❌'} 二重変更（5節後 +21,22/−3,7 → 8節後 +23/−21）`);
  if (!ok) changeErrors++;
}

console.log(changeErrors === 0 ? '\n✅ メンバー途中変更 全テスト合格' : `\n❌ メンバー途中変更 ${changeErrors}件のエラー`);

// =========================
// 休み順の逆順化（最後の番号から休む）検証
// =========================
console.log('\n=== 休み順逆順化（reverse） 検証 ===');
{
  let revErrors = 0;

  // 1. 第1節は最大番号側から休む（N=10, r=2 → [9,10]）
  {
    const sched = generateRestSchedule(playersN(10), 2, 10, null, null, true);
    const expectFirst5 = [[9,10],[7,8],[5,6],[3,4],[1,2]];
    let ok = true;
    for (let i = 0; i < 5; i++) {
      if (JSON.stringify(sched[i]) !== JSON.stringify(expectFirst5[i])) ok = false;
    }
    console.log(`  ${ok ? '✅' : '❌'} N=10 r=2: 1周目が[9,10]→[7,8]→…→[1,2]`);
    if (!ok) { revErrors++; sched.slice(0,5).forEach((g,i)=>console.log(`     節${i+1}: [${g}]`)); }
  }

  // 2. ミラー性: reverse版 = 通常版を p→N+1-p で写像したものと完全一致
  {
    let fails = 0, total = 0;
    for (const courts of [2, 3, 4]) {
      for (let players = courts * 4 + 1; players <= 24; players++) {
        for (const rounds of [10, 15, 30]) {
          const restCount = players - courts * 4;
          const asc = generateRestSchedule(playersN(players), restCount, rounds);
          const desc = generateRestSchedule(playersN(players), restCount, rounds, null, null, true);
          const mirrored = asc.map(g => g.map(p => players + 1 - p).sort((a, b) => a - b));
          total++;
          if (JSON.stringify(desc) !== JSON.stringify(mirrored)) fails++;
        }
      }
    }
    console.log(`  ${fails === 0 ? '✅' : '❌'} ミラー性: ${total}構成中${total - fails}構成で 逆順=通常の鏡像`);
    if (fails > 0) revErrors++;
  }

  // 3. 公平性: 逆順でも休み回数の差≤1
  {
    let fails = 0, total = 0;
    for (const courts of [2, 3, 4]) {
      for (let players = courts * 4 + 1; players <= 24; players++) {
        for (const rounds of [10, 15, 20, 25, 30]) {
          const restCount = players - courts * 4;
          const sched = generateRestSchedule(playersN(players), restCount, rounds, null, null, true);
          const cnt = {};
          for (let p = 1; p <= players; p++) cnt[p] = 0;
          sched.forEach(g => g.forEach(p => cnt[p]++));
          const vals = Object.values(cnt);
          total++;
          if (Math.max(...vals) - Math.min(...vals) > 1) fails++;
        }
      }
    }
    console.log(`  ${fails === 0 ? '✅' : '❌'} 休み均等化: ${total}構成中${total - fails}構成で差≤1`);
    if (fails > 0) revErrors++;
  }

  // 4. 欠番あり（途中離脱後の番号構成）でも逆順が機能する
  {
    const players = [1, 2, 4, 5, 6, 8, 9, 10, 11, 12]; // 3,7欠番
    const sched = generateRestSchedule(players, 2, 10, null, null, true);
    const ok1 = JSON.stringify(sched[0]) === JSON.stringify([11, 12]);
    const cnt = {};
    players.forEach(p => cnt[p] = 0);
    sched.forEach(g => g.forEach(p => cnt[p]++));
    const vals = Object.values(cnt);
    const ok2 = Math.max(...vals) - Math.min(...vals) <= 1;
    console.log(`  ${ok1 && ok2 ? '✅' : '❌'} 欠番あり(3,7抜け): 第1節[11,12]・差≤1`);
    if (!(ok1 && ok2)) revErrors++;
  }

  console.log(revErrors === 0 ? '\n✅ 休み順逆順化 全テスト合格' : `\n❌ 休み順逆順化 ${revErrors}件のエラー`);
}

// =========================
// 第1節固定配置（最後の番号から休む時のみ）検証
// =========================
console.log('\n=== 第1節固定配置（desc） 検証 ===');
{
  let fixErrors = 0;

  // 1. desc時: 第1節が常に番号順固定（A: 1,2 vs 3,4 / B: 5,6 vs 7,8 …）
  //    4c×16p は休みゼロ（restCount=0）のエッジケース
  {
    let ok = true;
    for (const [c, p] of [[2, 10], [3, 14], [4, 18], [4, 16]]) {
      for (let t = 0; t < 5; t++) {
        const r1 = generate(c, p, 10, 'desc').rounds[0];
        for (let ci = 0; ci < c; ci++) {
          const m = r1.assignments[ci];
          if (m.pair1[0] !== ci * 4 + 1 || m.pair1[1] !== ci * 4 + 2 ||
              m.pair2[0] !== ci * 4 + 3 || m.pair2[1] !== ci * 4 + 4) ok = false;
        }
      }
    }
    console.log(`  ${ok ? '✅' : '❌'} desc: 第1節は常に A:1,2vs3,4 / B:5,6vs7,8 …（4構成×5回、休みゼロ含む）`);
    if (!ok) fixErrors++;
  }

  // 2. desc時: 第2節以降はランダム最適化のまま
  {
    const sigs = new Set();
    for (let i = 0; i < 20; i++) {
      const r2 = generate(4, 16, 20, 'desc').rounds[1];
      sigs.add(r2.assignments.map(m => `${m.pair1}_vs_${m.pair2}`).join('|'));
    }
    console.log(`  ${sigs.size > 1 ? '✅' : '❌'} desc: 第2節はランダムのまま（20回中${sigs.size}パターン）`);
    if (sigs.size <= 1) fixErrors++;
  }

  // 3. asc(1番から休む)時: 第1節は従来どおりランダム
  {
    const sigs = new Set();
    for (let i = 0; i < 20; i++) {
      const r1 = generate(4, 18, 20).rounds[0];
      sigs.add(r1.assignments.map(m => `${m.pair1}_vs_${m.pair2}`).join('|'));
    }
    console.log(`  ${sigs.size > 1 ? '✅' : '❌'} asc: 第1節はランダムのまま（20回中${sigs.size}パターン）`);
    if (sigs.size <= 1) fixErrors++;
  }

  // 4. desc+第1節固定でも休み均等化（差≤1）を維持
  {
    let ok = true;
    for (const [c, p, n] of [[2, 10, 15], [3, 14, 15], [4, 20, 10]]) {
      const res = generate(c, p, n, 'desc');
      const vals = Object.values(res.restHistory);
      if (Math.max(...vals) - Math.min(...vals) > 1) ok = false;
    }
    console.log(`  ${ok ? '✅' : '❌'} desc+固定: 休み回数差≤1を維持（3構成）`);
    if (!ok) fixErrors++;
  }

  console.log(fixErrors === 0 ? '\n✅ 第1節固定配置 全テスト合格' : `\n❌ 第1節固定配置 ${fixErrors}件のエラー`);
}

// =========================
// 離脱者の同番号復帰 検証
// =========================
console.log('\n=== 離脱者の同番号復帰 検証 ===');
{
  let retErrors = 0;

  // 1. 基本: 5節後に3,7離脱 → 9節後に3だけ復帰
  {
    const sess = generateSession(4, 20, 15);
    applyMemberChangeTest(sess, 5, 0, [3, 7], 4);
    const before = JSON.parse(JSON.stringify(sess.rounds.slice(0, 9)));
    const { initialRestCounts } = applyMemberChangeTest(sess, 9, 0, [], 4, [3]);

    let ok = true;
    const issues = [];
    if (JSON.stringify(sess.rounds.slice(0, 9)) !== JSON.stringify(before)) {
      ok = false; issues.push('消化済み節が変わった');
    }
    for (let i = 5; i < 9; i++) {
      const ps = roundPlayers(sess.rounds[i]);
      if (ps.includes(3) || ps.includes(7)) { ok = false; issues.push(`節${i+1}に離脱者が登場`); }
    }
    let appears3 = false;
    for (let i = 9; i < 15; i++) {
      const ps = roundPlayers(sess.rounds[i]);
      if (ps.includes(3)) appears3 = true;
      if (ps.includes(7)) { ok = false; issues.push(`節${i+1}に7番（離脱中）が登場`); }
    }
    if (!appears3) { ok = false; issues.push('復帰した3番が一度も登場しない'); }
    if (!sess.players.includes(3)) { ok = false; issues.push('playersに3番が戻っていない'); }
    if (sess.everPlayers.filter(p => p === 3).length !== 1) { ok = false; issues.push('everPlayersに3番が重複'); }
    if (sess.players.length !== 19) { ok = false; issues.push(`人数が${sess.players.length}（期待19）`); }
    // 各節で重複・人数不整合がないこと
    for (let i = 9; i < 15; i++) {
      const ps = roundPlayers(sess.rounds[i]);
      if (new Set(ps).size !== ps.length) { ok = false; issues.push(`節${i+1}で番号重複`); }
      if (ps.length !== 19) { ok = false; issues.push(`節${i+1}の人数が${ps.length}`); }
    }
    console.log(`  ${ok ? '✅' : '❌'} 基本復帰（3番のみ復帰、7番は離脱継続）`);
    issues.slice(0, 5).forEach(e => console.log(`     - ${e}`));
    if (!ok) retErrors++;
  }

  // 2. 復帰と同時に別の人が離脱＋新規追加
  {
    const sess = generateSession(4, 18, 12);
    applyMemberChangeTest(sess, 4, 0, [5], 4);              // 5離脱（17人）
    applyMemberChangeTest(sess, 7, 1, [10], 4, [5]);        // 5復帰・10離脱・19番追加（18人）
    let ok = true;
    for (let i = 7; i < 12; i++) {
      const ps = roundPlayers(sess.rounds[i]);
      if (!ps.includes(5) && !sess.rounds[i].resting.includes(5)) {} // 登場チェックは下でまとめて
      if (ps.includes(10)) ok = false;
    }
    const appears = { 5: false, 19: false };
    for (let i = 7; i < 12; i++) {
      const ps = roundPlayers(sess.rounds[i]);
      if (ps.includes(5)) appears[5] = true;
      if (ps.includes(19)) appears[19] = true;
    }
    if (!appears[5] || !appears[19]) ok = false;
    if (sess.players.length !== 18) ok = false;
    console.log(`  ${ok ? '✅' : '❌'} 復帰＋離脱＋新規追加の同時変更`);
    if (!ok) retErrors++;
  }

  // 3. 復帰→再離脱
  {
    const sess = generateSession(2, 10, 15);
    applyMemberChangeTest(sess, 4, 0, [4], 2);          // 4離脱
    applyMemberChangeTest(sess, 8, 0, [], 2, [4]);      // 4復帰
    applyMemberChangeTest(sess, 11, 0, [4], 2);         // 4再離脱
    let ok = true;
    for (let i = 4; i < 8; i++) if (roundPlayers(sess.rounds[i]).includes(4)) ok = false;
    let appearsMid = false;
    for (let i = 8; i < 11; i++) if (roundPlayers(sess.rounds[i]).includes(4)) appearsMid = true;
    if (!appearsMid) ok = false;
    for (let i = 11; i < 15; i++) if (roundPlayers(sess.rounds[i]).includes(4)) ok = false;
    console.log(`  ${ok ? '✅' : '❌'} 復帰→再離脱（離脱4節〜・復帰8節〜・再離脱11節〜）`);
    if (!ok) retErrors++;
  }

  // 4. 休み履歴の引き継ぎ: 復帰者のinitialRestCountは max(自身の履歴, 現役最少)
  {
    const sess = generateSession(4, 20, 15);
    // 3番の消化済み5節での休み回数を記録
    let rest3 = 0;
    for (let i = 0; i < 5; i++) if (sess.rounds[i].resting.includes(3)) rest3++;
    applyMemberChangeTest(sess, 5, 0, [3], 4);
    // 9節終了時点の現役の最少休み回数
    const counts = {};
    sess.players.forEach(p => counts[p] = 0);
    for (let i = 0; i < 9; i++) sess.rounds[i].resting.forEach(p => { if (p in counts) counts[p]++; });
    const minCont = Math.min(...Object.values(counts));
    const { initialRestCounts } = applyMemberChangeTest(sess, 9, 0, [], 4, [3]);
    const ok = initialRestCounts[3] === Math.max(rest3, minCont);
    console.log(`  ${ok ? '✅' : '❌'} 休み履歴引き継ぎ（3番: 自身${rest3}回 vs 現役最少${minCont}回 → ${initialRestCounts[3]}）`);
    if (!ok) retErrors++;
  }

  console.log(retErrors === 0 ? '\n✅ 離脱者の同番号復帰 全テスト合格' : `\n❌ 離脱者の同番号復帰 ${retErrors}件のエラー`);
}

// =========================
// 途中追加者の休み順（周回最後尾）検証
// =========================
console.log('\n=== 途中追加者の休み順（周回最後尾）検証 ===');
{
  let defErrors = 0;

  // 共通チェック: consumed節後にaddCount人追加したとき、
  // 追加者の初休みが「変更時点で休み最少だった既存メンバー全員の休み」より後（同節は可）になること
  function checkDeferredAdd(label, courts, totalPlayers, numRounds, restOrder, consumed, addCount) {
    const sess = generateSession(courts, totalPlayers, numRounds, restOrder);
    const counts = {};
    sess.players.forEach(p => counts[p] = 0);
    for (let i = 0; i < consumed; i++) sess.rounds[i].resting.forEach(p => counts[p]++);
    const minCont = Math.min(...Object.values(counts));
    const cycleRemain = sess.players.filter(p => counts[p] === minCont);

    const { newNumbers } = applyMemberChangeTest(sess, consumed, addCount, [], courts);
    const restCountAfter = totalPlayers + addCount - courts * 4;

    const firstRestOf = p => {
      for (let i = 0; i < numRounds; i++) if (sess.rounds[i].resting.includes(p)) return i;
      return -1;
    };

    let ok = true;
    const details = [];
    for (const n of newNumbers) {
      const fn = firstRestOf(n);
      if (fn < 0) { ok = false; details.push(`${n}番が一度も休んでいない`); continue; }
      // 追加直後の節でいきなり休みになっていないこと
      // （既存の残りキューが1節に収まる場合は同節で最後尾に入るのが正しいため対象外）
      if (fn === consumed && cycleRemain.length >= restCountAfter) {
        ok = false; details.push(`${n}番が追加直後の第${fn + 1}節で休み`);
      }
      // 既存の最少回数組が全員休み終わる（同節含む）まで初休みが来ないこと
      for (const q of cycleRemain) {
        const fq = firstRestOf(q);
        if (fq < 0 || fq > fn) { ok = false; details.push(`${n}番(第${fn + 1}節)が既存${q}番(第${fq + 1}節)より先に休み`); }
      }
      // 初休みの直後の節で連続休みになっていないこと
      if (fn + 1 < numRounds && sess.rounds[fn + 1].resting.includes(n)) {
        ok = false; details.push(`${n}番が第${fn + 1}・${fn + 2}節で連続休み`);
      }
    }

    // 公平性: 全期間の休み回数の差≤1（追加者は参加後のみ）
    const finalCounts = {};
    sess.players.forEach(p => finalCounts[p] = 0);
    for (const round of sess.rounds) round.resting.forEach(p => { if (p in finalCounts) finalCounts[p]++; });
    const vals = Object.values(finalCounts);
    if (Math.max(...vals) - Math.min(...vals) > 1) { ok = false; details.push(`休み差>1 (${Math.min(...vals)}〜${Math.max(...vals)})`); }

    console.log(`  ${ok ? '✅' : '❌'} ${label}${details.length ? ' → ' + details.join(' / ') : ''}`);
    if (!ok) defErrors++;
  }

  // 1. 画像の報告シナリオ: 3コート13人10節desc、3節消化後に1人追加（→14番）
  checkDeferredAdd('desc: 3c×13人10節・3節後+1人（報告シナリオ）', 3, 13, 10, 'desc', 3, 1);
  // 2. 昇順でも同様
  checkDeferredAdd('asc:  3c×13人10節・3節後+1人', 3, 13, 10, undefined, 3, 1);
  // 3. 複数人同時追加（desc）
  checkDeferredAdd('desc: 2c×10人15節・3節後+2人', 2, 10, 15, 'desc', 3, 2);
  // 4. 2周目の途中で追加（desc）: 消化済みが1周を超えた時点
  checkDeferredAdd('desc: 2c×10人15節・7節後+1人（2周目途中）', 2, 10, 15, 'desc', 7, 1);
  // 5. 4コート大人数（desc）
  checkDeferredAdd('desc: 4c×20人20節・4節後+1人', 4, 20, 20, 'desc', 4, 1);

  console.log(defErrors === 0 ? '\n✅ 途中追加者の休み順 全テスト合格' : `\n❌ 途中追加者の休み順 ${defErrors}件のエラー`);
}

// =========================
// 種目別コート（A男子/B女子/C・Dミックス）検証（2026-07-20追加）
// =========================
console.log('\n=== 種目別コート検証 ===');
{
  let genderErrors = 0;

  // 番号1..m を男性、m+1..m+f を女性とする性別マップ
  function gendersFor(mCount, fCount) {
    const g = {};
    for (let p = 1; p <= mCount; p++) g[p] = 'M';
    for (let p = mCount + 1; p <= mCount + fCount; p++) g[p] = 'F';
    return g;
  }

  // index.html の generate()（種目別モード）相当。4コート固定・balanceCourtsなし・第1節も最適化
  function generateGender(mCount, fCount, numRounds, restOrder) {
    const totalPlayers = mCount + fCount;
    const genders = gendersFor(mCount, fCount);
    TOTAL_ROUNDS = numRounds;
    const restCount = totalPlayers - 16;
    const allPlayers = playersN(totalPlayers);
    const restSchedule = generateRestSchedule(allPlayers, restCount, numRounds, null, null, restOrder === 'desc');
    const pairHistory = {}, opponentHistory = {}, restHistory = {}, courtHistory = {};
    allPlayers.forEach(p => restHistory[p] = 0);
    const rounds = [];
    for (let r = 0; r < numRounds; r++) {
      const resting = restSchedule[r];
      const restSet = new Set(resting);
      const active = allPlayers.filter(p => !restSet.has(p));
      resting.forEach(p => restHistory[p]++);
      let assignments = assignCourts(active, 4, pairHistory, opponentHistory, genders);
      assignments = balanceCourtsSameType(assignments, courtHistory, genders);
      updateHistories(assignments, pairHistory, opponentHistory);
      updateCourtHistory(assignments, courtHistory);
      rounds.push({ round: r + 1, resting, assignments });
    }
    return { rounds, genders, totalPlayers, restHistory, pairHistory, opponentHistory };
  }

  // 各節がテンプレートどおりの男女構成・ペア構成になっているか
  function checkGenderRounds(rounds, genders, label) {
    const details = [];
    for (const round of rounds) {
      const active = round.assignments.flatMap(c => c.pair1.concat(c.pair2));
      const m = active.filter(p => genders[p] === 'M').length;
      const f = active.length - m;
      const templates = courtTemplates(m, f, 4);
      round.assignments.forEach((court, idx) => {
        const t = templates[idx];
        const players = court.pair1.concat(court.pair2);
        const cm = players.filter(p => genders[p] === 'M').length;
        if (cm !== t.m) {
          details.push(`第${round.round}節 ${COURT_LABELS[idx]}: 男${cm}人 (期待${t.m}人)`);
          return;
        }
        const need = pairTypesFor(t).slice().sort().join('+');
        const actual = [court.pair1, court.pair2].map(pr => {
          const pm = pr.filter(p => genders[p] === 'M').length;
          return pm === 2 ? 'MM' : pm === 1 ? 'MF' : 'FF';
        }).sort().join('+');
        if (actual !== need) {
          details.push(`第${round.round}節 ${COURT_LABELS[idx]}: ペア構成 ${actual} (期待 ${need})`);
        }
      });
    }
    const ok = details.length === 0;
    console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' → ' + details.slice(0, 3).join(' / ')}`);
    if (!ok) genderErrors++;
    return ok;
  }

  function checkRestDiff(restCounts, players, label) {
    const vals = players.map(p => restCounts[p]);
    const diff = Math.max(...vals) - Math.min(...vals);
    const ok = diff <= 1;
    console.log(`  ${ok ? '✅' : '❌'} ${label}（差=${diff}）`);
    if (!ok) genderErrors++;
    return ok;
  }

  // index.html の applyMemberChange（種目別モード）相当
  function applyGenderChangeTest(res, consumed, addGenderList, removeNumbers, numRounds, restOrder) {
    const genders = Object.assign({}, res.genders);
    const players = playersN(res.totalPlayers);
    const removedSet = new Set(removeNumbers);
    const continuing = players.filter(p => !removedSet.has(p));
    const newNumbers = [];
    addGenderList.forEach((g, i) => {
      const n = res.totalPlayers + 1 + i;
      newNumbers.push(n);
      genders[n] = g;
    });
    const newPlayers = continuing.concat(newNumbers).sort((a, b) => a - b);
    const kept = res.rounds.slice(0, consumed);
    const pairHistory = {}, opponentHistory = {}, courtHistory = {}, restHistory = {};
    players.concat(newNumbers).forEach(p => restHistory[p] = 0);
    for (const round of kept) {
      round.resting.forEach(p => restHistory[p]++);
      updateHistories(round.assignments, pairHistory, opponentHistory);
      updateCourtHistory(round.assignments, courtHistory);
    }
    const contCounts = continuing.map(p => restHistory[p]);
    const minCont = contCounts.length > 0 ? Math.min(...contCounts) : 0;
    const initialRestCounts = {};
    continuing.forEach(p => initialRestCounts[p] = restHistory[p]);
    newNumbers.forEach(p => initialRestCounts[p] = minCont);
    const restCount = newPlayers.length - 16;
    const prevResting = kept.length > 0 ? kept[kept.length - 1].resting : [];
    const restSchedule = generateRestSchedule(newPlayers, restCount, numRounds - consumed, initialRestCounts, prevResting, restOrder === 'desc', newNumbers);
    const newRounds = [];
    for (let r = 0; r < numRounds - consumed; r++) {
      const resting = restSchedule[r];
      const restSet = new Set(resting);
      const active = newPlayers.filter(p => !restSet.has(p));
      resting.forEach(p => restHistory[p]++);
      let assignments = assignCourts(active, 4, pairHistory, opponentHistory, genders);
      assignments = balanceCourtsSameType(assignments, courtHistory, genders);
      updateHistories(assignments, pairHistory, opponentHistory);
      updateCourtHistory(assignments, courtHistory);
      newRounds.push({ round: consumed + r + 1, resting, assignments });
    }
    return { rounds: kept.concat(newRounds), genders, newPlayers, restHistory, kept };
  }

  // 1. 理想構成 8M8F（休みなし）: 全節 A=男4 / B=女4 / C・D=男女ペア×2
  {
    const res = generateGender(8, 8, 10, 'desc');
    checkGenderRounds(res.rounds, res.genders, '8男8女×10節: 全節テンプレート準拠');
    // ペア偏りの参考統計（男8人でMMペアは節2組×10節=20組・組合せ28通り）
    const counts = [];
    for (const a in res.pairHistory) {
      for (const b in res.pairHistory[a]) {
        if (parseInt(a) < parseInt(b)) counts.push(res.pairHistory[a][b]);
      }
    }
    console.log(`     （参考）ペア回数 max=${Math.max(...counts)}`);
  }

  // 2. 休みあり 10M10F×15節: テンプレート準拠＋休み公平
  {
    const res = generateGender(10, 10, 15, 'desc');
    checkGenderRounds(res.rounds, res.genders, '10男10女×15節（毎節4人休み）: テンプレート準拠');
    checkRestDiff(res.restHistory, playersN(20), '10男10女×15節: 休み差≤1');
  }

  // 3. 男性過多 10M6F: Dコートが男子ダブルスになる
  {
    const res = generateGender(10, 6, 10, 'desc');
    checkGenderRounds(res.rounds, res.genders, '10男6女×10節: A男子/B女子/Cミックス/D男子');
  }

  // 4. 女性過多 4M12F: C・Dが女子ダブルスになる
  {
    const res = generateGender(4, 12, 10, 'asc');
    checkGenderRounds(res.rounds, res.genders, '4男12女×10節: A男子/B女子/C・D女子');
  }

  // 5. 奇数混合＋休み 9M9F×12節
  {
    const res = generateGender(9, 9, 12, 'desc');
    checkGenderRounds(res.rounds, res.genders, '9男9女×12節（毎節2人休み）: テンプレート準拠');
    checkRestDiff(res.restHistory, playersN(18), '9男9女×12節: 休み差≤1');
  }

  // 6. 途中追加（男1女1ゲスト）: 消化済み不変＋残り節準拠＋休み公平
  {
    const res = generateGender(8, 8, 10, 'desc');
    const keptOrig = JSON.stringify(res.rounds.slice(0, 5));
    const after = applyGenderChangeTest(res, 5, ['M', 'F'], [], 10, 'desc');
    const keptOk = JSON.stringify(after.rounds.slice(0, 5)) === keptOrig;
    console.log(`  ${keptOk ? '✅' : '❌'} 途中追加: 消化済み5節が不変`);
    if (!keptOk) genderErrors++;
    checkGenderRounds(after.rounds.slice(5), after.genders, '途中追加（+男1+女1）: 残り節テンプレート準拠');
    checkRestDiff(after.restHistory, after.newPlayers, '途中追加後: 休み差≤1');
  }

  // 7. 途中離脱（男2）: 18人→16人で残り節準拠
  {
    const res = generateGender(10, 8, 12, 'desc');
    const after = applyGenderChangeTest(res, 4, [], [1, 2], 12, 'desc');
    checkGenderRounds(after.rounds.slice(4), after.genders, '途中離脱（男2人）: 残り節テンプレート準拠');
    const active = after.newPlayers;
    const noDeparted = after.rounds.slice(4).every(r =>
      r.assignments.every(c => c.pair1.concat(c.pair2).every(p => active.includes(p))));
    console.log(`  ${noDeparted ? '✅' : '❌'} 途中離脱: 離脱者が以降の節に登場しない`);
    if (!noDeparted) genderErrors++;
  }

  console.log(genderErrors === 0 ? '\n✅ 種目別コート 全テスト合格' : `\n❌ 種目別コート ${genderErrors}件のエラー`);
  if (genderErrors > 0) process.exitCode = 1;
}

// =========================
// 種目別コートの分散検証（2026-07-20追加）
// 各メンバーが男子コート（A/D）・女子コート・ミックスコートへ偏りなく回るか
// =========================
console.log('\n=== 種目別コート分散検証 ===');
{
  let distErrors = 0;

  function gendersForDist(mCount, fCount) {
    const g = {};
    for (let p = 1; p <= mCount; p++) g[p] = 'M';
    for (let p = mCount + 1; p <= mCount + fCount; p++) g[p] = 'F';
    return g;
  }

  // index.html の generate()（種目別モード）相当（balanceCourtsSameType込み）
  function generateGenderDist(mCount, fCount, numRounds, restOrder) {
    const totalPlayers = mCount + fCount;
    const genders = gendersForDist(mCount, fCount);
    TOTAL_ROUNDS = numRounds;
    const restCount = totalPlayers - 16;
    const allPlayers = playersN(totalPlayers);
    const restSchedule = generateRestSchedule(allPlayers, restCount, numRounds, null, null, restOrder === 'desc');
    const pairHistory = {}, opponentHistory = {}, restHistory = {}, courtHistory = {};
    allPlayers.forEach(p => restHistory[p] = 0);
    const rounds = [];
    for (let r = 0; r < numRounds; r++) {
      const resting = restSchedule[r];
      const restSet = new Set(resting);
      const active = allPlayers.filter(p => !restSet.has(p));
      resting.forEach(p => restHistory[p]++);
      let assignments = assignCourts(active, 4, pairHistory, opponentHistory, genders);
      assignments = balanceCourtsSameType(assignments, courtHistory, genders);
      updateHistories(assignments, pairHistory, opponentHistory);
      updateCourtHistory(assignments, courtHistory);
      rounds.push({ round: r + 1, resting, assignments });
    }
    return { rounds, genders, totalPlayers };
  }

  // 各プレイヤーのコート別登場回数 [A, B, C, D]
  function courtAppearances(rounds, totalPlayers) {
    const app = {};
    for (let p = 1; p <= totalPlayers; p++) app[p] = [0, 0, 0, 0];
    for (const r of rounds) {
      r.assignments.forEach((c, i) => {
        for (const p of c.pair1.concat(c.pair2)) app[p][i]++;
      });
    }
    return app;
  }

  function reportDist(label, checks) {
    const bad = checks.filter(c => !c.ok).map(c => c.msg);
    const ok = bad.length === 0;
    console.log(`  ${ok ? '✅' : '❌'} ${label}${ok ? '' : ' → ' + bad.slice(0, 4).join(' / ')}`);
    if (!ok) distErrors++;
    return ok;
  }

  // 1. 理想構成 8男8女×15節: 男性は毎節 A(男子) or C/D(ミックス) に入る。
  //    全員が A にも C にも D にも最低1回は登場し、ミックス回数の偏りが大きすぎないこと
  {
    const res = generateGenderDist(8, 8, 15, 'desc');
    const app = courtAppearances(res.rounds, 16);
    const checks = [];
    const mixCounts = [];
    for (let p = 1; p <= 8; p++) {
      checks.push({ ok: app[p][0] >= 1, msg: `男${p}: A(男子)0回` });
      checks.push({ ok: app[p][2] >= 1, msg: `男${p}: C(ミックス)0回` });
      checks.push({ ok: app[p][3] >= 1, msg: `男${p}: D(ミックス)0回` });
      mixCounts.push(app[p][2] + app[p][3]);
    }
    for (let p = 9; p <= 16; p++) {
      checks.push({ ok: app[p][1] >= 1, msg: `女${p}: B(女子)0回` });
      checks.push({ ok: app[p][2] >= 1, msg: `女${p}: C(ミックス)0回` });
      checks.push({ ok: app[p][3] >= 1, msg: `女${p}: D(ミックス)0回` });
      mixCounts.push(app[p][2] + app[p][3]);
    }
    const mixDiff = Math.max(...mixCounts) - Math.min(...mixCounts);
    checks.push({ ok: mixDiff <= 6, msg: `ミックス出場回数の差=${mixDiff}(>6)` });
    reportDist('8男8女×15節: 全員がA/B・C・Dすべてに登場（同種目コートもローテーション）', checks);
    console.log(`     （参考）ミックス出場回数: 平均${(mixCounts.reduce((s, x) => s + x, 0) / 16).toFixed(1)}回・最小${Math.min(...mixCounts)}・最大${Math.max(...mixCounts)}`);
  }

  // 2. 男性過多 10男6女×15節: AとDが両方男子ダブルス。
  //    全男性が A にも D にも回り、ミックス(C)にも登場する。女性は B と C の両方に登場
  {
    const res = generateGenderDist(10, 6, 15, 'desc');
    const app = courtAppearances(res.rounds, 16);
    const checks = [];
    const adDiffs = [];
    for (let p = 1; p <= 10; p++) {
      checks.push({ ok: app[p][0] >= 1, msg: `男${p}: A(男子)0回` });
      checks.push({ ok: app[p][3] >= 1, msg: `男${p}: D(男子)0回` });
      checks.push({ ok: app[p][2] >= 1, msg: `男${p}: C(ミックス)0回` });
      adDiffs.push(Math.abs(app[p][0] - app[p][3]));
    }
    for (let p = 11; p <= 16; p++) {
      checks.push({ ok: app[p][1] >= 1, msg: `女${p}: B(女子)0回` });
      checks.push({ ok: app[p][2] >= 1, msg: `女${p}: C(ミックス)0回` });
    }
    const maxAdDiff = Math.max(...adDiffs);
    checks.push({ ok: maxAdDiff <= 6, msg: `男子コートA/D登場差の最大=${maxAdDiff}(>6)` });
    reportDist('10男6女×15節: 男子はA/D両方＋ミックスに、女子はB＋ミックスに登場', checks);
    console.log(`     （参考）男性のA/D登場差: 最大${maxAdDiff}回`);
  }

  // 3. 女性過多 4男12女×10節: B/C/Dが全て女子ダブルス。全女性が3コートすべてに登場
  {
    const res = generateGenderDist(4, 12, 10, 'asc');
    const app = courtAppearances(res.rounds, 16);
    const checks = [];
    for (let p = 5; p <= 16; p++) {
      checks.push({ ok: app[p][1] >= 1, msg: `女${p}: B0回` });
      checks.push({ ok: app[p][2] >= 1, msg: `女${p}: C0回` });
      checks.push({ ok: app[p][3] >= 1, msg: `女${p}: D0回` });
    }
    reportDist('4男12女×10節: 女子コートB/C/D全てにローテーション', checks);
  }

  // 4. 休みあり 9男9女×18節: 分散＋休み込みでも全コート登場
  {
    const res = generateGenderDist(9, 9, 18, 'desc');
    const app = courtAppearances(res.rounds, 18);
    const checks = [];
    for (let p = 1; p <= 9; p++) {
      checks.push({ ok: app[p][0] >= 1, msg: `男${p}: A0回` });
      checks.push({ ok: app[p][2] + app[p][3] >= 1, msg: `男${p}: ミックス0回` });
    }
    for (let p = 10; p <= 18; p++) {
      checks.push({ ok: app[p][1] >= 1, msg: `女${p}: B0回` });
      checks.push({ ok: app[p][2] + app[p][3] >= 1, msg: `女${p}: ミックス0回` });
    }
    reportDist('9男9女×18節（毎節2人休み）: 全員が自分の種目＋ミックスに登場', checks);
  }

  // 5. ランダム性: 2回生成して同一結果にならない（第1節固定なし）
  {
    const sig = res => res.rounds.slice(0, 3).map(r =>
      r.assignments.map(c => c.pair1.join() + 'v' + c.pair2.join()).join('|')).join('#');
    const a = sig(generateGenderDist(8, 8, 10, 'desc'));
    const b = sig(generateGenderDist(8, 8, 10, 'desc'));
    const ok = a !== b;
    console.log(`  ${ok ? '✅' : '❌'} 2回生成で異なる組み合わせ（ランダム性）`);
    if (!ok) distErrors++;
  }

  console.log(distErrors === 0 ? '\n✅ 種目別コート分散 全テスト合格' : `\n❌ 種目別コート分散 ${distErrors}件のエラー`);
  if (distErrors > 0) process.exitCode = 1;
}
