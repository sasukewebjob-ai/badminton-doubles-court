// 本番の実データを変更せず、表示を再計算して日別タブの全行を照合する。
// 使い方: node check_daily_score_live.js
// 管理用の鍵は既存の gas_admin.js に任せ、ログには点数メモの日付と件数だけを出す。
const assert = require('assert/strict');
const CORE = require('./gas/core');
const { admin } = require('./gas_admin');

async function checked(op, params) {
  const r = await admin(op, params);
  assert.ok(r.ok, r.error || '本番の確認に失敗しました。');
  return r;
}
function ymd(value) {
  const m = String(value).match(/^(\d{4})[/-](\d{2})[/-](\d{2})/);
  return m ? m.slice(1).join('-') : '';
}
async function main() {
  await checked('recompute', {});
  const raw = (await checked('dump', { sheets: ['試合'], limit: 10000 })).sheets['試合'];
  assert.ok(raw && raw.length < 10000, '試合の取得範囲を確認してください。');
  const matches = raw.slice(1).map((v, i) => ({
    row: i + 2, date: ymd(v[0]), sid: v[1], round: Number(v[2]), court: v[3],
    a: [v[4], v[5]].filter(Boolean), b: [v[6], v[7]].filter(Boolean),
    scoreA: v[8] === '' ? null : Number(v[8]), scoreB: v[9] === '' ? null : Number(v[9]), state: v[10], table: v[11],
  }));
  const dates = CORE.practiceDays(matches);
  for (const date of dates) {
    const name = '点数メモ ' + date;
    const values = (await checked('dump', { sheets: [name], limit: 10000 })).sheets[name];
    assert.ok(values, name + ' がありません。同名の手作りタブがある場合は別名のタブを確認してください。');
    const r = CORE.dayReport(matches, date);
    const summary = '出席 ' + r.people.length + '人' + (r.unnamed ? '＋名前のないペア ' + r.unnamed + '組' : '') +
      '・試合 ' + r.games + '（点数あり ' + r.scored + '）' + (r.tables > 1 ? '・対戦表 ' + r.tables + 'つ' : '');
    assert.equal(values[0][1], CORE.dayLabel(date));
    assert.equal(values[1][0], summary);
    const padded = row => Array.from({ length: 8 }, (_, i) => String(row[i] === undefined ? '' : row[i]));
    const block = (title, rows) => {
      const start = values.findIndex(v => v[0] === title);
      assert.ok(start >= 0, title + ' がありません。');
      assert.deepEqual(values.slice(start + 2, start + 2 + rows.length).map(padded), rows.map(padded), title + ' の内容');
    };
    const stat = p => [p.label, p.rounds, p.games, p.wins, p.losses, p.pf, p.pa, p.diff];
    block('■ 出席者と成績（' + r.people.length + '人）', r.people.map(stat));
    block('■ ペアごとの成績（' + r.pairs.length + '組）', r.pairs.map(stat));
    block('■ 対戦表と点数（' + r.games + '試合）', r.list.map(m => [
      (r.tables > 1 ? '表' + m.table + '・' : '') + '第' + m.round + '節 ' + m.court, m.a,
      m.scoreA === null ? '' : m.scoreA, m.scoreB === null ? '' : m.scoreB, m.b, m.note,
    ]));
    assert.equal(values.length, 12 + r.people.length + r.pairs.length + r.list.length, '前の表示の行が残っていない');
    console.log('OK ' + date + '：' + summary + '（出席者・ペア成績・対戦と点数も全行一致）');
  }
  console.log('本番の日別点数メモ：' + dates.length + '日分が全行一致（元の試合・点数は変更していません）');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
