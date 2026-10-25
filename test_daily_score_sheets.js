// 日別の点数メモと、表示用シートの復旧・再試行を本物のGASコードで確認する。
const assert = require('assert/strict');
const { makeContext } = require('./gas_mock');
let failed = 0, passed = 0;
function test(label, run) {
  try { run(); passed++; console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + e.stack); }
}
const A = ['原', '佐藤'], B = ['越野', '善志'];
function fixture() {
  const c = makeContext();
  const post = body => JSON.parse(c.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  const admin = (op, extra = {}) => post({ action: 'admin', key: c.ADMIN_KEY, op, ...extra });
  assert.ok(admin('setup').ok);
  const reg = (sid, date, matches = [{ round: 1, court: 'A', a: A, b: B }]) => {
    const r = post({ action: 'register', sid, hostKey: sid + 'Key', date, data: 'eyJ2IjoxfQ==', matches });
    assert.ok(r.ok, JSON.stringify(r));
  };
  const score = (sid, x = 21, y = 15, round = 1) => {
    const r = post({ action: 'score', sid, round, court: 'A', a: A, b: B, scoreA: x, scoreB: y });
    assert.ok(r.ok, JSON.stringify(r));
    return r;
  };
  const flush = () => assert.ok(admin('recompute').ok);
  const sheet = date => c.book.getSheetByName('点数メモ ' + date);
  const lines = sh => sh.getRange(1, 1, sh.getLastRow(), 8).getValues().map(r => r.map(String).join('|').replace(/\|+$/, ''));
  return { c, post, admin, reg, score, flush, sheet, lines };
}

test('表示用の練習日シートを手で編集しても、元の記録から復元する', () => {
  const { c, reg, score, flush, lines } = fixture();
  reg('DailyRepair00000001', '2026-10-25'); score('DailyRepair00000001'); flush();
  const sh = c.book.getSheetByName('練習日'), before = lines(sh);
  sh.getRange(2, 1).setValue('消してしまった');
  c.onEdit({ range: sh.getRange(2, 1) });
  assert.deepEqual(lines(sh), before);
  // 別の入力規則が貼り付けられても日付選択が壊れない。
  sh.getRange(1, 2).setDataValidation({ getCriteriaValues: () => [new Date()] });
  c.onEdit({ range: sh.getRange(1, 2) });
  assert.deepEqual(lines(sh), before);
  assert.deepEqual(c.errors, []);
});

test('2日分を別タブに保存し、複数の表は同じ日にまとめる・訂正はその日だけ', () => {
  const { c, reg, score, flush, sheet, lines } = fixture();
  reg('DailyTable000000001', '2026-10-25'); score('DailyTable000000001');
  reg('DailyTable000000002', '2026-11-01'); score('DailyTable000000002', 18, 21);
  reg('DailyTable000000003', '2026-10-25'); score('DailyTable000000003', 21, 7);
  reg('DailyUnused00000001', '2026-11-08'); flush();
  const old = sheet('2026-10-25'), next = sheet('2026-11-01');
  assert.ok(old && next);
  assert.equal(sheet('2026-11-08'), null, '点数のない表の日付は増やさない');
  assert.equal(lines(old)[0], '練習日|2026/10/25 (日)');
  assert.match(lines(old)[1], /試合 2（点数あり 2）・対戦表 2つ/);
  assert.ok(lines(old).includes('表1・第1節 A|原・佐藤|21|15|越野・善志'));
  assert.ok(lines(old).includes('表2・第1節 A|原・佐藤|21|7|越野・善志'));
  const kept = lines(next);
  score('DailyTable000000001', 21, 3); flush();
  assert.ok(lines(old).includes('表1・第1節 A|原・佐藤|21|3|越野・善志'));
  assert.deepEqual(lines(next), kept);
  assert.ok(old.protections.some(p => p.warningOnly));
  assert.equal(old.getRange(1, 2).getDataValidation(), null, '日別タブの日付は固定');
  assert.deepEqual(c.errors, []);
});

test('日付の訂正・最後の点数の消去で、古い日の結果を残さない', () => {
  const { c, reg, score, flush, sheet, lines } = fixture();
  const sid = 'DailyMove0000000001';
  reg(sid, '2026-10-25'); score(sid); flush();
  reg(sid, '2026-11-01'); flush();
  assert.ok(sheet('2026-11-01'));
  assert.match(lines(sheet('2026-10-25'))[1], /この日の記録はありません/);
  assert.ok(!lines(sheet('2026-10-25')).some(s => /21\|15/.test(s)));
  score(sid, '', ''); flush();
  assert.match(lines(sheet('2026-11-01'))[1], /この日の記録はありません/);
  assert.equal(sheet('2026-11-01').getLastRow(), 2);
  assert.deepEqual(c.errors, []);
});

test('同名の手作りタブを上書きしない・タブを改名しても増殖しない・削除後は再作成する', () => {
  const { c, reg, score, flush, lines } = fixture();
  const keep = c.book.insertSheet('点数メモ 2026-10-25');
  keep.getRange(1, 1).setValue('手書きメモ');
  reg('DailyCollision00001', '2026-10-25'); score('DailyCollision00001'); flush();
  const sh = c.book.getSheetByName('点数メモ 2026-10-25 (2)');
  assert.ok(sh);
  assert.equal(keep.value(1, 1), '手書きメモ');
  sh.setName('日曜日の練習');
  const count = c.book.getSheets().length;
  flush();
  assert.equal(c.book.getSheets().length, count);
  const before = lines(sh);
  sh.getRange(1, 2).setValue('2027-01-01');
  sh.getRange(2, 1).setValue('間違って書き換えた');
  c.onEdit({ range: sh.getRange(1, 1, 2, 2) });
  assert.deepEqual(lines(sh), before, '日付と中身を復元する');
  c.book.sheets = c.book.sheets.filter(s => s !== sh);
  flush();
  const recreated = c.book.getSheetByName('点数メモ 2026-10-25 (2)');
  assert.ok(recreated && recreated !== sh);
  assert.deepEqual(lines(recreated), before, '前のキャッシュがあっても内容を書く');
  assert.deepEqual(c.errors, []);
});

test('日別タブの更新に一度失敗しても点数を保存し、次の取得で更新を再試行する', () => {
  const { c, reg, score, flush, sheet, lines } = fixture();
  const sid = 'DailyRetry000000001';
  reg(sid, '2026-10-25'); score(sid); flush();
  const sh = sheet('2026-10-25'), put = sh.put.bind(sh);
  sh.put = () => { throw new Error('一時的な表示更新エラー'); };
  c.cache.delete('stats');
  assert.ok(score(sid, 21, 8).ok);
  assert.equal(JSON.parse(c.cache.get('stats')).pending, true, '表示更新の失敗を再試行待ちにする');
  sh.put = put;
  const state = JSON.parse(c.cache.get('stats'));
  c.cache.set('stats', JSON.stringify({ ...state, at: state.at - 30000 }));
  const result = JSON.parse(c.doGet({ parameter: { action: 'get', id: sid } }).content);
  assert.ok(result.ok);
  assert.ok(lines(sh).includes('第1節 A|原・佐藤|21|8|越野・善志'));
  assert.equal(JSON.parse(c.cache.get('stats')).pending, false);
  assert.equal(c.errors.length, 1);
});

test('同じ内容の再計算で日別タブを書き直さない', () => {
  const { c, reg, score, flush, sheet } = fixture();
  reg('DailyWrites00000001', '2026-10-25'); score('DailyWrites00000001'); flush();
  const sh = sheet('2026-10-25'), put = sh.put.bind(sh);
  let writes = 0;
  sh.put = (...a) => { writes++; return put(...a); };
  flush();
  assert.equal(writes, 0);
  assert.deepEqual(c.errors, []);
});

test('公開済みのスプシを開くと、過去に保存した記録から日別タブを作る', () => {
  const { c, reg, score, flush, sheet, lines } = fixture();
  reg('DailyMigrate0000001', '2026-10-25'); score('DailyMigrate0000001'); flush();
  const original = lines(sheet('2026-10-25'));
  c.book.sheets = c.book.sheets.filter(s => !s.getDeveloperMetadata().length);
  c.cache.set('stats', JSON.stringify({ at: Date.now(), pending: false }));
  c.onOpen();
  assert.deepEqual(lines(sheet('2026-10-25')), original);
  assert.deepEqual(c.errors, []);
});

test('日別タブの初期設定が途中で失敗しても、未完成の表示を再試行する', () => {
  const { c, reg, score, flush, sheet } = fixture();
  reg('DailySetupRetry0001', '2026-10-25'); score('DailySetupRetry0001'); flush();
  const sh = sheet('2026-10-25'), widths = sh.setColumnWidth;
  sh.setColumnWidth = () => { throw Error('一時的な初期設定エラー'); };
  c.cache.delete('stats');
  score('DailySetupRetry0001', 21, 8);
  assert.equal(JSON.parse(c.cache.get('stats')).pending, true);
  sh.setColumnWidth = widths;
  flush();
  assert.equal(JSON.parse(c.cache.get('stats')).pending, false);
  assert.equal(c.errors.length, 1);
});

test('1日に1200試合あっても行を増やし、最後の試合まで表示する', () => {
  const { c, reg, score, flush, sheet, lines } = fixture();
  const matches = Array.from({ length: 30 }, (_, r) => 'ABCD'.split('').map(court => ({ round: r + 1, court, a: A, b: B }))).flat();
  for (let t = 0; t < 10; t++) {
    const sid = 'DailyLargeTable00' + String(t).padStart(2, '0');
    reg(sid, '2026-10-25', matches); score(sid, 21, 15, 30);
  }
  flush();
  const sh = sheet('2026-10-25');
  assert.ok(sh.getMaxRows() > 1000);
  assert.match(lines(sh)[1], /試合 1200（点数あり 10）・対戦表 10つ/);
  assert.ok(lines(sh).includes('表10・第30節 D|原・佐藤|||越野・善志|未入力'));
  assert.deepEqual(c.errors, []);
});

console.log(`日別の点数メモ: ${passed} passed / ${failed} failed`);
if (failed) process.exitCode = 1;
