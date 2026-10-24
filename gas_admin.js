// 大会練習の成績（GAS）の準備と本番確認（2026-10-24追加）
//   node gas_admin.js setup   … シートを作り、名簿・2026年度の大会・岡谷連盟杯のペアを入れる（入っていれば増やさない）
//   node gas_admin.js pairs   … PAIRS にある大会のペアをシートで丸ごと入れ替える（名前の訂正・ペア表の更新）
//   node gas_admin.js e2e     … 本番のWebアプリで登録→点数→成績シートの数式まで確認し、テストデータを消す
//   node gas_admin.js dump [シート名…]
// 管理用の鍵は gas/secret.js（git に入れない）から読む
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbwwYPljkI-6oMhpUZkCY3oohtZFEM6uxlMrtZUEAoq3AJS0zq3e0Nj31ZyMQshIsKM2Zw/exec';
const ADMIN_KEY = fs.readFileSync(path.join(__dirname, 'gas/secret.js'), 'utf8').match(/ADMIN_KEY = '([^']+)'/)[1];

async function call(method, body, params = {}) {
  const url = WEBAPP_URL + '?' + new URLSearchParams(params);
  const res = await fetch(url, method === 'GET' ? {} : { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const text = await res.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`JSONでない応答（承認前の可能性）: ${text.slice(0, 200)}`); }
}
const admin = (op, extra = {}) => call('POST', { action: 'admin', key: ADMIN_KEY, op, ...extra });

// 名簿の原本（バドミントン系/members.txt）
function roster() {
  return fs.readFileSync(path.join(__dirname, '..', 'members.txt'), 'utf8').split(/\r?\n/)
    .map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('[')).map(l => l.split(/\s+/)[0]);
}

// 2026年度 KALIDIA大会日程（20260329 2026年度 KALIDIA大会日程.xlsx）のうち 2026-10-24 以降
const TOURNAMENTS = [
  { name: '岡谷連盟杯', date: '2026-11-03', content: '男女D・S' },
  { name: '伊那市長杯', date: '2026-11-29', content: '男女初級・一般D、S' },
  { name: '第8回 KALIDIA杯', date: '2027-01-17', content: 'KALIDIAメンバーのみ団体戦' },
  { name: '岡谷オープン大会', date: '2027-01-24', content: '男女D・男女S（クラス分けなし）' },
  { name: '駒ヶ根市レディース大会', date: '2027-02-07', content: '女子初級・中級・上級D' },
  { name: '岡谷市バドミントン団体戦', date: '2027-02-11', content: '団体戦' },
  { name: '春季バドミントン大会', date: '2027-03-07', content: '男女1部〜8部でのD' },
];
// 2026年度 大会ペア組み合わせ.xlsx の「岡谷連盟杯」シート（佐藤＝バレ、根津＝根津真、渡辺大＝渡辺。ユーザー確認 2026-10-24）
const PAIRS = [
  ['男子A', 'バレ', '原', 'ペア表では佐藤'],
  ['男子B', '越野', '善志'], ['男子B', '唐澤', '渡辺', 'ペア表では渡辺大'], ['男子B', '細井', '宮澤輝'], ['男子B', '北原', '上條'],
  ['女子A', '内田', '根津真', 'ペア表では根津'], ['女子A', '黒河内', '酒井'],
  ['女子B', '田中', '依田'],
].map(([category, a, b, memo]) => ({ tournament: '岡谷連盟杯', category, names: [a, b], memo }));

async function setup() {
  const r = await admin('setup', { roster: roster(), tournaments: TOURNAMENTS, pairs: PAIRS });
  console.log(r);
}

// PAIRS にある大会のペアを、シートで丸ごと入れ替える（名前の訂正・ペア表の更新）
async function pairs() {
  for (const t of [...new Set(PAIRS.map(p => p.tournament))]) {
    const r = await admin('setPairs', { tournament: t, pairs: PAIRS.filter(p => p.tournament === t) });
    if (!r.ok) throw new Error(t + ': ' + JSON.stringify(r));
    console.log(`${t}：${r.removed}組を消して${r.added}組を登録`);
  }
}

async function dump(names) {
  const r = await admin('dump', names.length ? { sheets: names } : {});
  if (!r.ok) throw new Error(JSON.stringify(r));
  for (const [name, rows] of Object.entries(r.sheets)) {
    console.log(`=== ${name}（${rows.length}行）`);
    rows.forEach(row => console.log(row.join(' | ')));
  }
}

// 本番確認：架空の大会（2000年）とペアで、登録→点数→成績シートの並べ替えまで。最後に消す
async function e2e() {
  const T = 'zz自動確認用', SID1 = 'E2eCheck' + Date.now() + 'a', SID2 = 'E2eCheck' + Date.now() + 'b';
  const KEY1 = 'E2eHostKey' + Date.now() + 'x', KEY2 = 'E2eHostKey' + Date.now() + 'y';
  const P = { a: ['確認A1', '確認A2'], b: ['確認B1', '確認B2'], c: ['確認C1', '確認C2'], t: ['臨時X', '臨時Y'] };
  const before = await admin('view', {});
  const keepTournament = before.values[0][1], keepMin = before.values[0][4];
  // 途中で止めた前回の確認が残っていれば先に消す（表IDは E2eCheck で始まる）
  const left = (await admin('dump', { sheets: ['対戦表', '試合'], limit: 5000 })).sheets;
  const leftSids = [...new Set([...left['対戦表'].map(r => r[0]), ...left['試合'].map(r => r[1])].filter(s => /^E2eCheck/.test(s)))];
  const pre = await admin('deleteRows', { sids: leftSids, tournaments: [T] });
  if (Object.values(pre.removed || {}).some(n => n > 0)) console.log('前回の残りを消しました', JSON.stringify(pre.removed));
  let ok = 0;
  const check = (cond, label) => { assert.ok(cond, label); ok++; console.log('OK ' + label); };
  try {
    check((await call('GET', null, { action: 'ping' })).ok, 'Webアプリが応答する');
    check((await admin('addTournaments', { tournaments: [{ name: T, date: '2000-01-30', content: '自動確認' }] })).ok, '大会を追加');
    check((await admin('addPairs', { pairs: [['A', P.a], ['B', P.b], ['C', P.c]].map(([category, names]) => ({ tournament: T, category, names })) })).ok, 'ペアを追加');
    const added = (await admin('dump', { sheets: ['大会', 'ペア'] })).sheets;
    const nT = added['大会'].filter(r => r[0] === T).length, nP = added['ペア'].filter(r => r[0] === T).length;
    check(nT === 1 && nP === 3, `1回の追加で1行ずつ増える（大会${nT}行・ペア${nP}行）`);
    const day = await call('GET', null, { action: 'tournaments', date: '2000-01-15' });
    check(day.ok && day.tournaments.length === 1 && day.tournaments[0].start === '2000-01-09' && day.tournaments[0].end === '2000-01-29' && day.tournaments[0].pairs.length === 3,
      '練習期間（3週前の日曜〜前日）と大会ペアが返る: ' + JSON.stringify(day.tournaments.map(t => [t.name, t.start, t.end, t.pairs.length])));
    // 表1（Aコートで3ペア）・表2（別の端末・別のコート）
    const reg1 = await call('POST', { action: 'register', sid: SID1, hostKey: KEY1, date: '2000-01-15', data: 'eyJlMmUiOjF9',
      matches: [{ round: 1, court: 'A', a: P.a, b: P.b }, { round: 2, court: 'A', a: P.a, b: P.c }, { round: 3, court: 'A', a: P.b, b: P.t }] });
    check(reg1.ok && reg1.version === 1, '表1を登録');
    const reg2 = await call('POST', { action: 'register', sid: SID2, hostKey: KEY2, date: '2000-01-22', data: 'eyJlMmUiOjJ9',
      matches: [{ round: 1, court: 'B', a: P.c, b: P.t }, { round: 2, court: 'B', a: P.t, b: P.a }] });
    check(reg2.ok, '表2（別の表）を登録');
    const s = (sid, round, court, a, b, x, y) => call('POST', { action: 'score', sid, round, court, a, b, scoreA: x, scoreB: y });
    check((await s(SID1, 1, 'A', P.a, P.b, 21, 15)).ok, '点数 1A');
    check((await s(SID1, 2, 'A', P.a, P.c, 19, 21)).ok, '点数 2A');
    check((await s(SID1, 3, 'A', P.b, P.t, 21, 5)).ok, '点数 3A（臨時ペアとの対戦）');
    check((await s(SID2, 1, 'B', P.c, P.t, 21, 18)).ok, '点数 表2の1B');
    const last = await s(SID2, 2, 'B', P.t, P.a, 10, 21);
    check(last.ok && last.matches.length === 2, '点数 表2の2B（返り値に表2の点数2件）');
    check((await s(SID1, 1, 'A', P.a, P.b, 21, 21)).error === '同点は保存できません。', '同点は拒否');
    const g = await call('GET', null, { action: 'get', sid: SID1, since: 0 });
    check(g.ok && g.data === 'eyJlMmUiOjF9' && g.matches.length === 3, '表1の取得（共有データと点数3件）');
    // 期待：A 3戦2勝(21-15,19-21,21-10) / C 2戦2勝(21-19,21-18) / B 2戦1勝(15-21,21-5)
    const v = await admin('view', { tournament: T, min: 0 });
    const table = v.values.slice(4).filter(r => r[0] !== '');
    console.log(table.map(r => r.join(' | ')).join('\n'));
    check(table.length === 3, '成績シートに大会ペア3組（臨時ペアは出ない）');
    check(table[0][2] === '確認C1・確認C2' && table[0][3] === '2' && table[0][6] === '100.0%', '1位は勝率100%のC');
    check(table[1][2] === '確認A1・確認A2' && table[1][3] === '3' && table[1][4] === '2' && table[1][6] === '66.7%' && table[1][9] === '17', '2位はA（3戦2勝・得失点+17）');
    check(table[2][2] === '確認B1・確認B2' && table[2][6] === '50.0%' && table[2][10] === '1', '3位はB（勝率50%・参加1日）');
    check(/練習期間 1\/9\(日\) 〜 1\/29\(土\)/.test(v.values[1][0]), '練習期間の表示: ' + v.values[1][0]);
    const v2 = await admin('view', { tournament: T, min: 3 });
    check(v2.values[4][2] === '確認A1・確認A2' && v2.values[5][0] === '', '最低試合数3ならAだけ');
  } finally {
    const r = await admin('deleteRows', { sids: [SID1, SID2], tournaments: [T] });
    await admin('view', { tournament: keepTournament, min: keepMin === '' ? 0 : Number(keepMin) });
    console.log('後片付け', JSON.stringify(r.removed));
  }
  console.log(`本番確認 ${ok}項目 全合格`);
}

const [cmd, ...rest] = process.argv.slice(2);
({ setup, pairs, e2e, dump: () => dump(rest) })[cmd]?.().catch(e => { console.error(e.message); process.exitCode = 1; })
  ?? console.log('使い方: node gas_admin.js setup | pairs | e2e | dump [シート名…]');
