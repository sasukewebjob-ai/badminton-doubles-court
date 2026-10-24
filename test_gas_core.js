// 大会練習の成績（gas/core.js）の計算のテスト（2026-10-24追加）
// - 練習期間（大会日の3週前の日曜日〜前日）
// - 名前の照合（ペアの並び順・はしごだか・空白）と点数の判定
// - 途中変更で作り直したときに既存の試合行をどうするか
// - 成績：大会ペアだけ数える／臨時ペアとの対戦は大会ペア側だけ／期間外・除外・未入力は数えない
const assert = require('assert/strict');
const CORE = require('./gas/core.js');

let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); }
}
const ID = 'abcdefghijklmnop1234';

test('練習期間：大会日の21日前以降で最初の日曜日〜大会の前日', () => {
  // 2026年度の日程表から：日曜・祝日（火）・土曜・年またぎ
  assert.deepEqual(CORE.practicePeriod('2026-11-03'), { start: '2026-10-18', end: '2026-11-02' }); // 岡谷連盟杯（火・祝）
  assert.deepEqual(CORE.practicePeriod('2026-11-29'), { start: '2026-11-08', end: '2026-11-28' }); // 伊那市長杯（日）
  assert.deepEqual(CORE.practicePeriod('2027-01-17'), { start: '2026-12-27', end: '2027-01-16' }); // 年またぎ
  assert.deepEqual(CORE.practicePeriod('2026-11-28'), { start: '2026-11-08', end: '2026-11-27' }); // 土曜の大会
  assert.deepEqual(CORE.practicePeriod('2027-02-11'), { start: '2027-01-24', end: '2027-02-10' }); // 木曜の祝日
  for (const d of ['2026-02-30', '2026-13-01', '2026/11/03', '', null, 20261103]) assert.equal(CORE.practicePeriod(d), null, String(d));
});

test('練習開始は必ず日曜日で、大会日の21日前〜15日前に入る（1年分の全日付）', () => {
  for (let n = CORE.dayNumber('2026-04-01'); n <= CORE.dayNumber('2027-03-31'); n++) {
    const date = CORE.ymdOf(n), p = CORE.practicePeriod(date);
    const start = CORE.dayNumber(p.start);
    assert.equal(new Date(start * 86400000).getUTCDay(), 0, date);
    assert.ok(n - start >= 15 && n - start <= 21, date);
    assert.equal(CORE.dayNumber(p.end), n - 1, date);
  }
});

test('名前の照合：並び順・はしごだか・全角半角の空白を同じに扱う', () => {
  assert.equal(CORE.pairKey(['原', '佐藤']), CORE.pairKey(['佐藤', '原']));
  assert.equal(CORE.pairKey(['髙橋', '黒河内']), CORE.pairKey(['黒河内', '高橋']));
  assert.equal(CORE.pairKey([' 宮澤輝 ', '細井']), CORE.pairKey(['細井', '宮澤　輝']));
  assert.equal(CORE.pairKey(['原', '原']), '', '同じ人2人はペアにしない');
  assert.equal(CORE.pairKey(['原', '']), '');
  assert.equal(CORE.pairKey(['7番ペア']), '', '番号だけのペアは数えない');
  assert.ok(CORE.sameSide(['原', '佐藤'], ['佐藤', '原']));
  assert.ok(CORE.sameSide(['7番ペア'], ['7番ペア']));
  assert.ok(!CORE.sameSide(['原', '佐藤'], ['原', '越野']));
  assert.ok(!CORE.sameSide([], []), '空どうしは同じとみなさない');
});

test('点数の判定：0〜30の整数・同点不可・両方空なら消去', () => {
  assert.deepEqual(CORE.parseScore(21, 18), { a: 21, b: 18 });
  assert.deepEqual(CORE.parseScore('21', ' 19 '), { a: 21, b: 19 });
  assert.deepEqual(CORE.parseScore(29, 30), { a: 29, b: 30 });
  assert.deepEqual(CORE.parseScore(0, 21), { a: 0, b: 21 });
  assert.deepEqual(CORE.parseScore('', ''), { clear: true });
  assert.deepEqual(CORE.parseScore(null, undefined), { clear: true });
  for (const [a, b] of [[21, 21], [31, 29], [-1, 21], [21.5, 19], ['21a', 19], [21, ''], ['', 18], [true, 1], ['1e1', 3]]) {
    assert.ok(CORE.parseScore(a, b).error, `${a}-${b}`);
    assert.equal(CORE.validScore(a, b), false, `${a}-${b}`);
  }
  assert.ok(CORE.validScore(21, 18));
});

test('対戦表の登録内容の確認：表ID・日付・試合一覧・名簿の形が正しいものだけ通す', () => {
  const ok = { sid: ID, hostKey: ID + 'k', date: '2026-10-25', data: 'eyJ4IjoxfQ==',
    matches: [{ round: 1, court: 'A', a: ['原', '佐藤'], b: ['越野', '善志'] }, { round: 1, court: 'B', a: ['7番ペア'], b: ['内田', '根津真'] }],
    roster: ['原', '佐藤'] };
  assert.equal(CORE.checkRegister(ok), null);
  const bad = [
    { sid: 'short' }, { sid: '-' + ID }, { sid: ID + '!' }, { hostKey: undefined }, { date: '2026-02-30' }, { data: '' }, { data: 'x'.repeat(45001) },
    { matches: [] }, { matches: [{ round: 0, court: 'A', a: ['原', '佐藤'], b: ['越野', '善志'] }] },
    { matches: [{ round: 31, court: 'A', a: ['原', '佐藤'], b: ['越野', '善志'] }] },
    { matches: [{ round: 1, court: 'E', a: ['原', '佐藤'], b: ['越野', '善志'] }] },
    { matches: [{ round: 1, court: 'A', a: ['原', '佐藤', '大野'], b: ['越野', '善志'] }] },
    { matches: [{ round: 1, court: 'A', a: ['原', 'あ'.repeat(21)], b: ['越野', '善志'] }] },
    { matches: [{ round: 1, court: 'A', a: ['原', 3], b: ['越野', '善志'] }] },
    { matches: [ok.matches[0], ok.matches[0]] }, { roster: 'x' }, { roster: ['原', ''] },
  ];
  for (const b of bad) assert.ok(CORE.checkRegister({ ...ok, ...b }), JSON.stringify(b).slice(0, 80));
  assert.ok(CORE.checkRegister(null));
  assert.equal(CORE.checkScore({ sid: ID, round: 3, court: 'B', a: ['原', '佐藤'], b: ['越野', '善志'], scoreA: 21, scoreB: 15 }), null);
  assert.equal(CORE.checkScore({ sid: ID, round: 3, court: 'B', a: ['原', '佐藤'], b: ['越野', '善志'], scoreA: '', scoreB: '' }), null);
  assert.ok(CORE.checkScore({ sid: ID, round: 3, court: 'B', a: ['原', '佐藤'], b: ['越野', '善志'], scoreA: 21, scoreB: 21 }));
  assert.ok(CORE.checkScore({ sid: ID, round: 3, court: 'Z', a: ['原', '佐藤'], b: ['越野', '善志'], scoreA: 21, scoreB: 1 }));
});

test('作り直し：同じ対戦は残す・左右だけ入れ替わったら入れ替え・変わった/なくなった試合は作り直し前へ', () => {
  const row = (r, round, court, a, b, table = '') => ({ row: r, round, court, a, b, table });
  const existing = [
    row(2, 1, 'A', ['原', '佐藤'], ['越野', '善志']),
    row(3, 2, 'A', ['原', '佐藤'], ['唐澤', '渡辺']),
    row(4, 3, 'A', ['越野', '善志'], ['唐澤', '渡辺']),
    row(5, 4, 'A', ['原', '佐藤'], ['細井', '宮澤輝']),
    row(6, 3, 'A', ['古い', '試合'], ['もう', '外れた'], CORE.TABLE_PREV),
  ];
  const plan = CORE.planRegister(existing, [
    { round: 1, court: 'A', a: ['佐藤', '原'], b: ['善志', '越野'] }, // 同じ（並び順だけ違う）
    { round: 2, court: 'A', a: ['唐澤', '渡辺'], b: ['原', '佐藤'] }, // 左右が入れ替わった
    { round: 3, court: 'A', a: ['越野', '善志'], b: ['細井', '宮澤輝'] }, // 相手が変わった
    { round: 3, court: 'B', a: ['北原', '上條'], b: ['唐澤', '渡辺'] }, // 新しいコート
  ]);
  assert.deepEqual(plan.keep, [2]);
  assert.deepEqual(plan.swap, [3]);
  assert.deepEqual(plan.retire.sort(), [4, 5], '第4節は表から無くなったので作り直し前。作り直し前の行(6)は触らない');
  assert.deepEqual(plan.add.map(m => m.round + m.court), ['3A', '3B']);
});

// 成績のテスト用データ
const tours = CORE.resolveTournaments([
  { name: '岡谷連盟杯', date: '2026-11-03', start: '', end: '' },
  { name: '伊那市長杯', date: '2026-11-29', start: '', end: '' },
  { name: '練習期間を手で短く', date: '2026-12-20', start: '2026-12-13', end: '2026-12-18' },
  { name: '岡谷連盟杯', date: '2027-01-01', start: '', end: '' }, // 同じ大会名は先の行を使う
  { name: '', date: '2026-12-01', start: '', end: '' }, { name: '日付なし', date: '', start: '', end: '' },
]);
const pairs = [
  { tournament: '岡谷連盟杯', category: '男子A', names: ['佐藤', '原'] },
  { tournament: '岡谷連盟杯', category: '男子B', names: ['越野', '善志'] },
  { tournament: '岡谷連盟杯', category: '男子B', names: ['唐澤', '渡辺'] },
  { tournament: '岡谷連盟杯', category: '女子A', names: ['内田', '根津真'] },
  { tournament: '岡谷連盟杯', category: '重複', names: ['原', '佐藤'] }, // 同じペアの2回目は無視
  { tournament: '伊那市長杯', category: '', names: ['原', '佐藤'] },
  { tournament: '登録のない大会', category: '', names: ['大野', '細井'] },
  { tournament: '練習期間を手で短く', category: '', names: ['大野', '細井'] },
];
const m = (date, a, b, scoreA, scoreB, excluded = false) => ({ date, a, b, scoreA, scoreB, excluded });
const matches = [
  m('2026-10-25', ['原', '佐藤'], ['越野', '善志'], 21, 18), // 大会ペア同士：両方数える
  m('2026-10-25', ['越野', '善志'], ['佐藤', '原'], 21, 15), // 並び順が逆でも同じペア
  m('2026-10-28', ['原', '佐藤'], ['大野', '細井'], 21, 10), // 臨時ペアとの対戦：原・佐藤だけ数える
  m('2026-10-28', ['大野', '細井'], ['北原', '上條'], 21, 19), // 臨時どうし：誰も数えない
  m('2026-10-28', ['唐澤', '渡辺'], ['原', '佐藤'], '', ''), // 未入力
  m('2026-10-28', ['唐澤', '渡辺'], ['原', '佐藤'], 21, 3, true), // 除外
  m('2026-10-28', ['唐澤', '渡辺'], ['原', '佐藤'], 21, 21), // 同点（手で入れたおかしな値）は数えない
  m('2026-10-17', ['原', '佐藤'], ['越野', '善志'], 21, 0), // 練習期間の前日
  m('2026-11-03', ['原', '佐藤'], ['越野', '善志'], 21, 0), // 大会当日
  m('2026-10-18', ['原', '佐藤'], ['唐澤', '渡辺'], 17, 21), // 練習初日
  m('2026-11-02', ['髙橋', '大野'], ['唐澤', '渡辺'], 15, 21), // 練習最終日・相手は臨時
  m('2026-11-10', ['原', '佐藤'], ['大野', '細井'], 21, 12), // 伊那市長杯の期間
  m('2026-12-12', ['大野', '細井'], ['原', '佐藤'], 21, 12), // 手で短くした期間の前
  m('2026-12-15', ['大野', '細井'], ['原', '佐藤'], 21, 12), // 手で短くした期間の中
  m('2026-12-19', ['大野', '細井'], ['原', '佐藤'], 21, 12), // 手で短くした期間の後
  m('2026-10-25', ['7番ペア'], ['越野', '善志'], 10, 21), // 番号だけのペアとの対戦：越野・善志は数える
];
const stats = CORE.computeStats(tours, pairs, matches);
const find = (t, label) => stats.find(r => r.tournament === t && r.label === label);

test('練習期間：手で入れた日付を使い、空なら自動。大会名の重複・日付なしは無視', () => {
  assert.deepEqual(tours.map(t => [t.name, t.start, t.end]), [
    ['岡谷連盟杯', '2026-10-18', '2026-11-02'], ['伊那市長杯', '2026-11-08', '2026-11-28'], ['練習期間を手で短く', '2026-12-13', '2026-12-18'],
  ]);
});

test('成績：大会ペア同士・臨時ペアとの対戦・期間の境目', () => {
  // 原・佐藤（岡谷）：10/25 勝(21-18)・負(15-21)、10/28 勝(21-10)、10/18 負(17-21)。期間外・未入力・除外・同点は数えない
  assert.deepEqual(find('岡谷連盟杯', '佐藤・原'), {
    tournament: '岡谷連盟杯', category: '男子A', label: '佐藤・原', games: 4, wins: 2, losses: 2, rate: 0.5,
    pf: 21 + 15 + 21 + 17, pa: 18 + 21 + 10 + 21, diff: (21 + 15 + 21 + 17) - (18 + 21 + 10 + 21), days: 3,
  });
  const k = find('岡谷連盟杯', '越野・善志');
  assert.deepEqual([k.games, k.wins, k.losses, k.days], [3, 2, 1, 1], '番号だけのペアとの対戦も数える');
  const w = find('岡谷連盟杯', '唐澤・渡辺');
  assert.deepEqual([w.games, w.wins, w.losses, w.pf, w.pa], [2, 2, 0, 42, 32], '最終日の臨時ペア（髙橋・大野）との対戦を含む');
  const u = find('岡谷連盟杯', '内田・根津真');
  assert.deepEqual([u.games, u.wins, u.rate, u.days], [0, 0, null, 0], '試合がないペアも表に出る（勝率は空）');
  assert.equal(stats.filter(r => r.tournament === '岡谷連盟杯').length, 4, '同じペアの2回目の登録は無視');
  assert.ok(!stats.some(r => r.label === '大野・細井' && r.tournament === '岡谷連盟杯'), '臨時ペアは表に出ない');
});

test('成績：同じペアでも大会ごとにその期間だけ数える。登録のない大会のペアは出さない', () => {
  const ina = find('伊那市長杯', '原・佐藤');
  assert.deepEqual([ina.games, ina.wins, ina.category], [1, 1, '']);
  const short = find('練習期間を手で短く', '大野・細井');
  assert.deepEqual([short.games, short.wins], [1, 1], '手で短くした期間の中の1試合だけ');
  assert.ok(!stats.some(r => r.tournament === '登録のない大会'));
});

test('その日が練習期間の大会と大会ペア（アプリの自動ペア用）', () => {
  const day = CORE.activeTournaments(tours, pairs, '2026-10-25');
  assert.deepEqual(day.map(t => t.name), ['岡谷連盟杯']);
  assert.equal(day[0].pairs.length, 5, '重複の登録もそのまま返す（アプリ側で同じペアは1つにする）');
  assert.deepEqual(day[0].pairs[0], { category: '男子A', names: ['佐藤', '原'] });
  assert.deepEqual(CORE.activeTournaments(tours, pairs, '2026-11-03'), [], '大会当日は練習期間外');
  // 期間が重なる大会は両方返す
  const overlap = CORE.resolveTournaments([{ name: 'X', date: '2027-01-17' }, { name: 'Y', date: '2027-01-24' }]);
  assert.deepEqual(CORE.activeTournaments(overlap, [], '2027-01-10').map(t => t.name), ['X', 'Y']);
});

test('成績シートで最初に見せる大会：練習期間中 → これから → 最後', () => {
  assert.equal(CORE.defaultTournament(tours, '2026-10-24'), '岡谷連盟杯');
  assert.equal(CORE.defaultTournament(tours, '2026-11-03'), '岡谷連盟杯', '大会当日はその大会');
  assert.equal(CORE.defaultTournament(tours, '2026-11-04'), '伊那市長杯', '翌日からは次の大会');
  assert.equal(CORE.defaultTournament(tours, '2027-05-01'), '練習期間を手で短く');
  assert.equal(CORE.defaultTournament([], '2026-10-24'), '');
});

test('名簿の追加：既存を消さず、同じ人（はしごだか違い含む）は増やさない', () => {
  assert.deepEqual(CORE.mergeRoster(['原', '髙橋'], ['原', '高橋', '大野', '', 'あ'.repeat(21)]), ['原', '髙橋', '大野']);
});

test('シートに書く文字は数式にならない', () => {
  assert.equal(CORE.cellText('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  for (const s of ['+1', '-1', '@x', "'x"]) assert.equal(CORE.cellText(s)[0], "'", s);
  assert.equal(CORE.cellText('原'), '原');
});

if (failed) process.exitCode = 1;
else console.log('大会練習の成績（計算）のテスト 全合格');
