// 固定ペア版の大会練習の点数（2026-10-24追加）の計算まわりのテスト
// - 大会ペアの自動ペア（2人そろったら大会ペア、残りはタップ順に臨時ペア。重なる大会は大会日の早い方）
// - 表ID・記録のオンオフは保存・共有リンクで保たれ、細工された値は受け付けない
// - スプシに送る試合の一覧（名前のない番号は「7番ペア」）
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); }
}
const src = fs.readFileSync(path.join(__dirname, 'singles.html'), 'utf8');
const script = src.match(/<script>([\s\S]*?)<\/script>/)[1].split('// Startup is kept separate')[0];
const app = vm.runInNewContext(`${script}
;({ planPairs, buildSession, validSession, encodeShare, decodeShare, scoreMatches, canonName, scoreApi, SCORE_ID_RE })`,
  { TextEncoder, TextDecoder, atob, btoa, console });
const plain = v => JSON.parse(JSON.stringify(v));
const names = slots => plain(slots).map(s => s.names.join('・') + (s.tournament ? `（${s.tournament} ${s.category}）` : ''));
const T1 = { name: '岡谷連盟杯', date: '2026-11-03', pairs: [
  { category: '男子A', names: ['バレ', '原'] }, { category: '男子B', names: ['越野', '善志'] }, { category: '男子B', names: ['北原', '上條'] },
  { category: '女子A', names: ['内田', '根津真'] },
] };
const T2 = { name: '伊那市長杯', date: '2026-11-29', pairs: [{ category: '女子', names: ['内田', '田中'] }, { category: '男子', names: ['高橋', '大野'] }] };

test('大会の情報がなければ従来どおりタップ順に2人ずつ（奇数は最後が1人）', () => {
  assert.deepEqual(names(app.planPairs(['a', 'b', 'c', 'd', 'e'], [])), ['a・b', 'c・d', 'e']);
  assert.deepEqual(names(app.planPairs([], [])), []);
});

test('大会ペアは2人そろった時点でペア、残りはタップ順に臨時ペア（番号は最初の人を選んだ順）', () => {
  assert.deepEqual(names(app.planPairs(['大野', 'バレ', '北原', '原', '越野', '善志'], [T1])),
    ['大野・北原', 'バレ・原（岡谷連盟杯 男子A）', '越野・善志（岡谷連盟杯 男子B）']);
  // 相方を後から選んでも、ペア表の並び（選手1・選手2）で並ぶ
  assert.deepEqual(names(app.planPairs(['原', '大野', 'バレ'], [T1])), ['バレ・原（岡谷連盟杯 男子A）', '大野']);
  // 相方が休みの人は臨時ペア（北原の相方の上條は来ていない）
  assert.deepEqual(names(app.planPairs(['北原', '細井'], [T1])), ['北原・細井']);
});

test('練習期間が重なる大会で相方が2人いるときは、先に渡した（大会日の早い）大会のペア', () => {
  assert.deepEqual(names(app.planPairs(['内田', '田中', '根津真'], [T1, T2])), ['内田・根津真（岡谷連盟杯 女子A）', '田中']);
  assert.deepEqual(names(app.planPairs(['内田', '田中'], [T1, T2])), ['内田・田中（伊那市長杯 女子）'], '片方の相方しか来ていなければその大会');
});

test('スプシの名前と名簿の名前は「髙／高」や空白の違いを同じ人とみなす（表示は名簿の書き方）', () => {
  assert.deepEqual(names(app.planPairs(['髙橋', '大野'], [T2])), ['髙橋・大野（伊那市長杯 男子）']);
  assert.equal(app.canonName(' 根津 真 '), '根津真');
});

const base = { mode: 'pairs', players: [1, 2, 3, 4], courts: 2, totalRounds: 10, restOrder: 'desc', forced: {},
  names: { 1: ['バレ', '原'], 2: ['越野', '善志'], 3: ['大野', '北原'], 4: ['内田', '根津真'] }, practiceDate: '2026-10-25' };
const ID = 'TAbcdefghijklmnop_-012';

test('表ID・記録のオンオフは保存・共有リンクで保たれる', () => {
  const s = app.buildSession({ ...base, scoring: true, scoreId: ID });
  assert.equal(s.scoreId, ID);
  assert.equal(s.scoring, true);
  assert.ok(app.validSession(plain(s)));
  const back = app.decodeShare(app.encodeShare(s));
  assert.deepEqual([back.scoreId, back.scoring], [ID, true]);
  assert.ok(app.validSession(plain(app.buildSession(base))), '記録しない表（従来の表）も通る');
});

test('細工された表ID・記録の設定は受け付けない', () => {
  const s = plain(app.buildSession({ ...base, scoring: true, scoreId: ID }));
  for (const [k, v] of [['scoreId', '-Abcdefghijklmnopq'], ['scoreId', 'short'], ['scoreId', 'Abc def ghijklmnopq'], ['scoreId', 12345678901234567], ['scoring', 'yes'], ['scoreId', 'A'.repeat(65)]]) {
    assert.equal(app.validSession({ ...s, [k]: v }), false, `${k}=${v}`);
  }
  assert.ok(app.SCORE_ID_RE.test(ID));
});

test('スプシに送る試合の一覧：全節・全コート、名前のない番号は「N番ペア」', () => {
  const s = plain(app.buildSession({ ...base, scoring: true, scoreId: ID }));
  s.names = { 1: ['バレ', '原'], 2: ['越野', '善志'], 3: ['大野', '北原'] }; // 4番は途中参加などで名前なし
  const list = plain(app.scoreMatches(s));
  assert.equal(list.length, 20);
  assert.deepEqual([...new Set(list.map(m => m.court))].sort(), ['A', 'B']);
  assert.ok(list.every(m => m.round >= 1 && m.round <= 10 && m.a.length && m.b.length));
  assert.ok(list.some(m => m.a.join() === '4番ペア' || m.b.join() === '4番ペア'));
  assert.ok(list.some(m => [m.a.join(), m.b.join()].includes('バレ,原')));
});

test('手元のファイル・Node では通信先がない（公開ページとテストだけ通信する）', () => {
  assert.equal(app.scoreApi(), '');
});

console.log(failed ? `\n大会練習の点数（固定ペア版・計算）のテスト ${failed}件失敗` : '\n大会練習の点数（固定ペア版・計算）のテスト 全合格');
if (failed) process.exitCode = 1;
