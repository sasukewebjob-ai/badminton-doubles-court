// シングルス・固定ペア版の名前表示（2026-09-26追加）の計算まわりのテスト
// - 名簿（ROSTER・KANA・SPEECH_KANA）がダブルス版と同じ
// - 休み指定を名前で書ける（シングルスは作成時に番号が決まるため）
// - 名前つきの対戦表を作成・途中変更・保存・共有しても名前が保たれ、細工された名前は受け付けない
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.message); }
}
// 改行コード（Windowsで名簿スクリプトを実行するとCRLFになる）の違いで誤って失敗しないようにそろえる
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\r\n/g, '\n');
const singlesSrc = read('singles.html');
const indexSrc = read('index.html');
const script = singlesSrc.match(/<script>([\s\S]*?)<\/script>/)[1].split('// Startup is kept separate')[0];
const app = vm.runInNewContext(`${script}
;({ buildSession, validSession, parseForced, resolveForcedNames, encodeShare, decodeShare, ROSTER, KANA, SPEECH_KANA,
    setSession: s => { session = s; }, label, speechLabel })`, { TextEncoder, TextDecoder, atob, btoa, console });
const ids = n => Array.from({ length: n }, (_, i) => i + 1);
const plain = v => JSON.parse(JSON.stringify(v));
const block = (src, name) => {
  const m = src.match(new RegExp(`const ${name} = [\\[{][\\s\\S]*?[\\]}];`));
  assert.ok(m, `${name} が見つからない`);
  return m[0];
};

test('名簿（ROSTER・KANA）と読み上げの上書き（SPEECH_KANA）はダブルス版と同じ', () => {
  for (const name of ['ROSTER', 'KANA', 'SPEECH_KANA']) assert.equal(block(singlesSrc, name), block(indexSrc, name), `${name} が一致しない`);
  assert.ok(app.ROSTER.length >= 20 && app.ROSTER.every(nm => app.KANA[nm]), 'フリガナの無い人がいる');
});

test('休み指定は名前でも書け、番号と混ぜられる（従来の書式エラーは変わらない）', () => {
  assert.deepEqual(plain(app.parseForced('3: 田中, 2\n５： 大野、田中')), { 3: ['田中', 2], 5: ['大野', '田中'] });
  for (const input of ['abc', '3:', '1.5: 2', '1: 2,', '3: 2.5']) assert.throws(() => app.parseForced(input), input);
});
test('名前の休み指定を番号に直す（シングルス: その人の番号／固定ペア: その人のペア番号）', () => {
  assert.deepEqual(plain(app.resolveForcedNames({ 3: ['田中', 2] }, { 1: '大野', 2: '濱島', 5: '田中' }, 'singles')), { 3: [5, 2] });
  assert.deepEqual(plain(app.resolveForcedNames({ 4: ['濱島', '大野', 1] }, { 1: ['大野', '濱島'], 2: ['田中', '依田'] }, 'pairs')), { 4: [1] });
  assert.throws(() => app.resolveForcedNames({ 3: ['山田'] }, { 1: '大野' }, 'singles'), /参加メンバーにいません/);
  assert.throws(() => app.resolveForcedNames({ 3: ['田中'] }, undefined, 'singles'), /番号で入力/);
  assert.deepEqual(plain(app.resolveForcedNames({ 3: [2, 4] }, undefined, 'singles')), { 3: [2, 4] });
});

const namedSingles = () => ({ mode: 'singles', players: ids(6), courts: 2, totalRounds: 10, restOrder: 'desc', forced: { 3: [5] },
  names: { 1: '大野', 2: '濱島', 3: '田中', 4: '上條', 5: '依田', 6: 'バレ' } });
const namedPairs = () => ({ mode: 'pairs', players: ids(5), courts: 2, totalRounds: 15, restOrder: 'asc', forced: {},
  names: { 1: ['大野', '濱島'], 2: ['田中', '上條'], 3: ['依田', 'バレ'], 4: ['春日', '原'], 5: ['宮下', '根津'] } });

test('名前つきで作成・途中変更しても名前は保たれ、途中参加の番号は番号のまま', () => {
  const s = app.buildSession(namedSingles());
  assert.ok(app.validSession(s));
  assert.deepEqual(plain(s.names), namedSingles().names);
  const changed = app.buildSession({ ...s, players: ids(7) }, s.rounds.slice(0, 4));
  assert.ok(app.validSession(changed));
  assert.deepEqual(plain(changed.names), namedSingles().names);
  app.setSession(changed);
  assert.equal(app.label(3, 'singles'), '3 田中');
  assert.equal(app.label(7, 'singles'), '7番');
  const p = app.buildSession(namedPairs());
  app.setSession(p);
  assert.equal(app.label(2, 'pairs'), '2 田中・上條');
  assert.ok(app.validSession(p));
});
test('名前が無い従来の対戦表は、表示も保存形式も変わらない', () => {
  const s = app.buildSession({ mode: 'pairs', players: ids(6), courts: 2, totalRounds: 10, restOrder: 'desc', forced: {} });
  assert.equal('names' in s, false);
  app.setSession(s);
  assert.equal(app.label(4, 'pairs'), '4番ペア');
  assert.equal(app.speechLabel(4, 'pairs'), '4番ペア');
});
test('読み上げはフリガナ（上書きがある人はその表記）、固定ペアは2人の名前を読む', () => {
  app.setSession(app.buildSession(namedPairs()));
  assert.equal(app.speechLabel(1, 'pairs'), 'おおの、ハマシマ');
  assert.equal(app.speechLabel(3, 'pairs'), 'よだ、バレ');
});

test('日本語の名前を含む共有リンクを往復でき、名前の無い従来のリンクも読める', () => {
  const s = app.buildSession(namedPairs());
  const back = app.decodeShare(app.encodeShare(s));
  assert.deepEqual(plain(back), plain(s));
  const old = app.buildSession({ mode: 'singles', players: ids(8), courts: 3, totalRounds: 10, restOrder: 'asc', forced: {} });
  const legacy = btoa(JSON.stringify(old)); // 2026-09-26より前の作り方
  assert.deepEqual(plain(app.decodeShare(legacy)), plain(old));
  assert.deepEqual(plain(app.decodeShare(encodeURIComponent(app.encodeShare(s)))), plain(s));
});
test('細工された名前（長すぎる・型が違う・番号が範囲外・固定ペアで1人）は受け付けない', () => {
  const base = app.buildSession(namedSingles());
  for (const names of [
    { 1: 'あ'.repeat(21) }, { 1: 5 }, { 13: '大野' }, { 0: '大野' }, { 1: '' }, { 1: ['大野', '濱島'] }, [], 'x',
  ]) assert.equal(app.validSession({ ...plain(base), names }), false, JSON.stringify(names));
  const pairs = app.buildSession(namedPairs());
  for (const names of [{ 1: ['大野'] }, { 1: '大野' }, { 1: ['大野', 3] }]) assert.equal(app.validSession({ ...plain(pairs), names }), false, JSON.stringify(names));
  assert.ok(app.validSession({ ...plain(base), names: { 1: '<b>x</b>' } }), '記号を含む名前も文字列としては受け付ける（表示はtextContent）');
});

if (failed) process.exitCode = 1;
else console.log('シングルス・固定ペア版の名前表示のテスト 全合格');
