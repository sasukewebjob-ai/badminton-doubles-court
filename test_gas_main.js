// 大会練習の成績（gas/main.js）の窓口とシートの読み書きのテスト（2026-10-24追加）
// SpreadsheetApp などを簡易モックにして、GAS のファイルをそのまま Node で動かす。
// 数式（成績シートの並べ替え・大会シートの練習期間）は計算しないので、本番のスプレッドシートで別に確認する。
process.env.TZ = 'Asia/Tokyo';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
function test(label, run) {
  try { run(); console.log('OK ' + label); }
  catch (e) { failed++; console.error('FAIL ' + label + ': ' + (e.stack || e.message).split('\n').slice(0, 3).join(' / ')); }
}

// ---------- モック ----------
const colOf = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getRow() { return this.row; }
  getNumRows() { return this.nr; }
  getSheet() { return this.sheet; }
  each(fn) { for (let r = 0; r < this.nr; r++) for (let c = 0; c < this.nc; c++) fn(this.row + r, this.col + c, r, c); return this; }
  grid(fn) { return Array.from({ length: this.nr }, (_, r) => Array.from({ length: this.nc }, (_, c) => fn(this.row + r, this.col + c))); }
  getValues() { return this.grid((r, c) => this.sheet.value(r, c)); }
  getValue() { return this.sheet.value(this.row, this.col); }
  getDisplayValues() { return this.grid((r, c) => { const v = this.sheet.value(r, c); return v instanceof Date ? v.toISOString() : String(v); }); }
  getFormulas() { return this.grid((r, c) => this.sheet.formula(r, c)); }
  setValues(vals) {
    assert.equal(vals.length, this.nr, 'setValues の行数');
    vals.forEach(line => assert.equal(line.length, this.nc, 'setValues の列数'));
    return this.each((r, c, i, j) => this.sheet.put(r, c, vals[i][j]));
  }
  setValue(v) { this.sheet.put(this.row, this.col, v); return this; }
  setFormula(f) { this.sheet.cells.set(this.sheet.key(this.row, this.col), { v: '', f }); return this; }
  clearContent() { return this.each((r, c) => this.sheet.cells.delete(this.sheet.key(r, c))); }
  setDataValidation(rule) { this.sheet.validations.push({ range: [this.row, this.col, this.nr, this.nc], rule }); return this; }
  createTextFinder(text) {
    const opts = { caseSensitive: false, entire: false };
    const hits = () => {
      const out = [];
      this.each((r, c) => {
        const v = String(this.sheet.value(r, c));
        const [x, y] = opts.caseSensitive ? [v, text] : [v.toLowerCase(), text.toLowerCase()];
        if (opts.entire ? x === y : x.includes(y)) out.push(new Range(this.sheet, r, c, 1, 1));
      });
      return out;
    };
    const finder = {
      matchCase(b) { opts.caseSensitive = b; return finder; },
      matchEntireCell(b) { opts.entire = b; return finder; },
      findAll: () => hits(),
      findNext: () => hits()[0] || null,
    };
    return finder;
  }
}
for (const m of ['setNumberFormat', 'setNote', 'setFontWeight', 'setBackground', 'setFontColor']) Range.prototype[m] = function () { return this; };

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.validations = []; this.hidden = false; this.protections = []; }
  key(r, c) { return r + ',' + c; }
  value(r, c) { const cell = this.cells.get(this.key(r, c)); return cell ? cell.v : ''; }
  formula(r, c) { const cell = this.cells.get(this.key(r, c)); return cell ? cell.f : ''; }
  // 本物と同じく、= で始まる文字は数式、先頭の ' は「文字として扱う」印で値には残らない
  put(r, c, v) {
    if (typeof v === 'string' && v.startsWith("'")) this.cells.set(this.key(r, c), { v: v.slice(1), f: '' });
    else if (typeof v === 'string' && v.startsWith('=')) this.cells.set(this.key(r, c), { v: '', f: v });
    else if (v === '' || v === null) this.cells.delete(this.key(r, c));
    else this.cells.set(this.key(r, c), { v, f: '' });
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { let m = 0; for (const [k, cell] of this.cells) if (cell.v !== '' || cell.f) m = Math.max(m, Number(k.split(',')[0])); return m; }
  getLastColumn() { let m = 0; for (const [k, cell] of this.cells) if (cell.v !== '' || cell.f) m = Math.max(m, Number(k.split(',')[1])); return m; }
  getMaxRows() { return 1000; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const m = a.match(/^([A-Z]+)(\d+):([A-Z]+)$/); return new Range(this, Number(m[2]), colOf(m[1]), 999, colOf(m[3]) - colOf(m[1]) + 1); }
    assert.ok(a >= 1 && b >= 1 && (c === undefined || c >= 1) && (d === undefined || d >= 1), `getRange(${a},${b},${c},${d}) は範囲外`);
    return new Range(this, a, b, c || 1, d || 1);
  }
  deleteRow(r) {
    const next = new Map();
    for (const [k, cell] of this.cells) {
      const [row, col] = k.split(',').map(Number);
      if (row < r) next.set(k, cell); else if (row > r) next.set(this.key(row - 1, col), cell);
    }
    this.cells = next;
  }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  hideSheet() { this.hidden = true; return this; }
  protect() { const p = { warningOnly: false, setWarningOnly(b) { p.warningOnly = b; return p; } }; this.protections.push(p); return p; }
  getProtections() { return this.protections; }
}

class Book {
  constructor() { this.sheets = [new Sheet('シート1')]; this.active = this.sheets[0]; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  setSpreadsheetLocale(l) { this.locale = l; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  setActiveSheet(s) { this.active = s; return s; }
  moveActiveSheet(pos) { this.sheets = this.sheets.filter(s => s !== this.active); this.sheets.splice(pos - 1, 0, this.active); }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/mock/edit'; }
}

function makeContext() {
  const book = new Book();
  const cache = new Map();
  const builder = () => { const rule = {}; const b = {
    requireValueInRange(r, show) { rule.range = r; return b; }, setAllowInvalid(x) { rule.allowInvalid = x; return b; },
    setHelpText(t) { rule.help = t; return b; }, build() { return rule; } }; return b; };
  const context = {
    console: { error: (...a) => { context.errors.push(a.join(' ')); }, log() {} },
    errors: [],
    SpreadsheetApp: { getActiveSpreadsheet: () => book, flush() {}, newDataValidation: builder, ProtectionType: { SHEET: 'SHEET' } },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ content: s, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: k => cache.delete(k) }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
      formatDate: (d, tz, fmt) => {
        assert.equal(fmt, 'yyyy-MM-dd');
        return new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
      },
    },
    ADMIN_KEY: 'test-admin-key-0123456789abcdef',
  };
  vm.createContext(context);
  for (const f of ['gas/core.js', 'gas/main.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), context, { filename: f });
  context.book = book;
  context.cache = cache;
  return context;
}

// ---------- 呼び出しの手伝い ----------
const ctx = makeContext();
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content);
// 本物のGoogleは c・sid をURLに入れると、スクリプトに届く前に400を返す（2026-10-24の本番確認で発覚）
const get = params => {
  const reserved = ['c', 'sid'].filter(k => k in params);
  if (reserved.length) throw new Error('Googleの予約語はURLに使えない: ' + reserved.join(','));
  return JSON.parse(ctx.doGet({ parameter: params }).content);
};
const admin = (op, extra = {}) => post({ action: 'admin', key: ctx.ADMIN_KEY, op, ...extra });
const rows = name => {
  const sh = ctx.book.getSheetByName(name), n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
};
const statsOf = (t, label) => rows('ペア成績').find(r => r[0] === t && r[2] === label);
const SID = 'Table0001aaaaaaaaaaaa', KEY = 'HostKey0001bbbbbbbbbbbb';
const OHARA = ['原', '佐藤'], KOSHINO = ['越野', '善志'], KARA = ['唐澤', '渡辺'], HOSOI = ['細井', '宮澤輝'], TEMP = ['大野', '北原'];
const table = (date, matches, extra = {}) => ({ action: 'register', sid: SID, hostKey: KEY, date, data: 'eyJ2IjoxfQ==', matches, ...extra });
const firstMatches = [
  { round: 1, court: 'A', a: OHARA, b: KOSHINO }, { round: 1, court: 'B', a: KARA, b: TEMP },
  { round: 2, court: 'A', a: OHARA, b: KARA }, { round: 2, court: 'B', a: KOSHINO, b: TEMP },
];
const score = (round, court, a, b, scoreA, scoreB, sid = SID) => post({ action: 'score', sid, round, court, a, b, scoreA, scoreB });

test('管理用の鍵が違うと何もできない', () => {
  assert.equal(admin('setup', { key: 'wrong' }).code, 'forbidden');
  assert.equal(post({ action: 'admin', op: 'setup' }).code, 'forbidden');
  assert.equal(get({ action: 'tournaments', date: '2026-10-25' }).code, 'not_ready', '準備前は「準備ができていません」');
});

test('準備：シートの作成・並び・隠し・名簿・大会・ペア・成績シートの初期の大会', () => {
  const r = admin('setup', {
    roster: ['原', '越野', '善志', '唐澤', '渡辺', '細井', '宮澤輝', '大野', '北原', '内田', '根津真'],
    tournaments: [{ name: '岡谷連盟杯', date: '2026-11-03', content: '男女D・S' }, { name: '伊那市長杯', date: '2026-11-29' }],
    pairs: [
      { tournament: '岡谷連盟杯', category: '男子A', names: ['佐藤', '原'] }, { tournament: '岡谷連盟杯', category: '男子B', names: KOSHINO },
      { tournament: '岡谷連盟杯', category: '男子B', names: ['唐澤', '渡辺'] }, { tournament: '岡谷連盟杯', category: '男子B', names: HOSOI },
      { tournament: '岡谷連盟杯', category: '女子A', names: ['内田', '根津真'] },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(ctx.book.getSheets().map(s => s.name), ['成績', '大会', 'ペア', '試合', '記録', 'ペア成績', '対戦表', '名簿']);
  assert.deepEqual(ctx.book.getSheets().filter(s => s.hidden).map(s => s.name), ['ペア成績', '対戦表', '名簿']);
  assert.equal(rows('名簿').length, 11);
  assert.equal(rows('大会').length, 2);
  assert.match(ctx.book.getSheetByName('大会').formula(2, 3), /WEEKDAY/, '練習開始は自動計算の式');
  assert.equal(rows('ペア').length, 5);
  assert.equal(rows('ペア成績').length, 5, '試合がなくても大会ペアは成績に並ぶ');
  // 準備をもう一度しても大会・ペアは増えない
  admin('setup', { tournaments: [{ name: 'X', date: '2026-12-01' }], pairs: [{ tournament: 'X', names: ['a', 'b'] }] });
  assert.equal(rows('大会').length, 2);
  assert.equal(rows('ペア').length, 5);
  assert.ok(ctx.book.getSheetByName('試合').protections.every(p => p.warningOnly), '試合シートは警告つきの保護');
});

test('その日の大会と大会ペア（練習期間内だけ）', () => {
  const r = get({ action: 'tournaments', date: '2026-10-25' });
  assert.deepEqual(r.tournaments.map(t => [t.name, t.start, t.end, t.pairs.length]), [['岡谷連盟杯', '2026-10-18', '2026-11-02', 5]]);
  assert.deepEqual(get({ action: 'tournaments', date: '2026-11-03' }).tournaments, []);
  assert.ok(get({ action: 'tournaments', date: '2026-02-30' }).error);
});

test('対戦表の登録 → 取得（版・共有データ・点数なし）', () => {
  const r = post(table('2026-10-25', firstMatches, { roster: ['原', '佐藤', '新人'] }));
  assert.deepEqual(r, { ok: true, version: 1 });
  const g = get({ action: 'get', id: SID });
  assert.deepEqual([g.version, g.date, g.data, g.matches], [1, '2026-10-25', 'eyJ2IjoxfQ==', []]);
  assert.equal(get({ action: 'get', id: SID, since: '1' }).data, undefined, '版が同じなら共有データは送らない');
  assert.equal(rows('試合').length, 4);
  assert.deepEqual(rows('試合')[1].slice(1, 11), [SID, 1, 'B', '唐澤', '渡辺', '大野', '北原', '', '', '未入力'].slice(0, 10));
  assert.ok(rows('名簿').some(r => r[0] === '新人'), '名簿に新しい名前が加わる');
  assert.equal(get({ action: 'get', id: 'Unknown0000000000000' }).code, 'not_found');
});

test('点数の入力 → 全員に返る・成績と記録に入る', () => {
  const r = score(1, 'A', OHARA, KOSHINO, 21, 18);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.matches, [{ round: 1, court: 'A', scoreA: 21, scoreB: 18 }]);
  assert.deepEqual(get({ action: 'get', id: SID }).matches, r.matches, '別の人の取得にも出る');
  score(1, 'B', KARA, TEMP, 21, 10); // 大会ペア vs 臨時ペア
  score(2, 'B', ['善志', '越野'], TEMP, 15, 21); // 名前の並び順が違っても同じ試合
  const o = statsOf('岡谷連盟杯', '佐藤・原'), k = statsOf('岡谷連盟杯', '越野・善志'), w = statsOf('岡谷連盟杯', '唐澤・渡辺');
  assert.deepEqual(o.slice(3, 11), [1, 1, 0, 1, 21, 18, 3, 1]);
  assert.deepEqual(k.slice(3, 11), [2, 0, 2, 0, 33, 42, -9, 1]);
  assert.deepEqual(w.slice(3, 7), [1, 1, 0, 1]);
  assert.equal(rows('記録').filter(r => r[1] === SID && r[4] === '入力').length, 3);
  assert.match(rows('記録').at(-1)[5], /未入力 → 15-21/);
});

test('点数の訂正・消去', () => {
  score(1, 'A', OHARA, KOSHINO, 21, 19);
  assert.deepEqual(statsOf('岡谷連盟杯', '佐藤・原').slice(7, 9), [21, 19]);
  score(1, 'A', OHARA, KOSHINO, '', '');
  assert.deepEqual(statsOf('岡谷連盟杯', '佐藤・原').slice(3, 5), [0, 0], '消すと成績から外れる');
  assert.equal(rows('試合')[0][10], '未入力');
  assert.ok(!get({ action: 'get', id: SID }).matches.some(m => m.round === 1 && m.court === 'A'));
  score(1, 'A', OHARA, KOSHINO, 21, 18);
});

test('おかしな点数・違う試合・未登録の表は保存しない', () => {
  const before = JSON.stringify(rows('試合'));
  assert.match(score(2, 'A', OHARA, KARA, 21, 21).error, /同点/);
  assert.match(score(2, 'A', OHARA, KARA, 31, 2).error, /0〜30/);
  assert.equal(score(2, 'A', OHARA, KOSHINO, 21, 2).code, 'stale', 'その節・コートの対戦と違う');
  assert.equal(score(3, 'A', OHARA, KARA, 21, 2).code, 'stale', '存在しない節');
  assert.equal(score(1, 'A', OHARA, KOSHINO, 21, 2, 'Unknown0000000000000').code, 'not_found');
  assert.equal(JSON.stringify(rows('試合')), before);
  assert.ok(JSON.parse(ctx.doPost({ postData: { contents: '{壊れた' } }).content).error);
  assert.ok(get({ action: 'nothing' }).error);
});

test('作り直しは作った端末の鍵だけ', () => {
  assert.equal(post({ ...table('2026-10-25', firstMatches), hostKey: 'OtherKey0000000000000' }).code, 'forbidden');
  assert.equal(rows('対戦表')[0][4], 1);
});

test('途中変更の作り直し：同じ対戦は点数ごと残す・変わった試合は作り直し前（点数があれば成績に残る）', () => {
  // 第2節を組み直す。2A は点数なし→作り直し前（数えない）。2B は点数あり→作り直し前でも成績に残る。1B は左右入れ替え
  const r = post(table('2026-10-25', [
    { round: 1, court: 'A', a: OHARA, b: KOSHINO }, { round: 1, court: 'B', a: TEMP, b: KARA },
    { round: 2, court: 'A', a: OHARA, b: HOSOI }, { round: 2, court: 'B', a: KARA, b: KOSHINO },
  ]));
  assert.deepEqual(r, { ok: true, version: 2 });
  const g = get({ action: 'get', id: SID, since: '1' });
  assert.equal(g.data, 'eyJ2IjoxfQ==', '版が上がったので共有データを送る');
  assert.deepEqual(g.matches, [{ round: 1, court: 'A', scoreA: 21, scoreB: 18 }, { round: 1, court: 'B', scoreA: 10, scoreB: 21 }], '入れ替えた試合は点数も入れ替わる');
  const all = rows('試合');
  assert.equal(all.length, 6);
  assert.deepEqual(all.filter(x => x[11] === '作り直し前').map(x => x[2] + x[3]), ['2A', '2B']);
  assert.equal(score(2, 'B', KOSHINO, TEMP, 21, 0).code, 'stale', '作り直し前の試合には入れられない');
  assert.ok(score(2, 'A', OHARA, HOSOI, 21, 17).ok);
  assert.deepEqual(statsOf('岡谷連盟杯', '越野・善志').slice(3, 6), [2, 0, 2], '作り直し前でも点数のある試合は数える');
  assert.deepEqual(statsOf('岡谷連盟杯', '細井・宮澤輝').slice(3, 6), [1, 0, 1]);
});

test('練習日をあとから直すと、その表の試合の日付も直る（期間外になれば数えない）', () => {
  post(table('2026-11-05', firstMatches.slice(0, 2).concat([{ round: 2, court: 'A', a: OHARA, b: HOSOI }, { round: 2, court: 'B', a: KARA, b: KOSHINO }])));
  assert.ok(rows('試合').filter(x => x[1] === SID).every(x => Object.prototype.toString.call(x[0]) === '[object Date]' && x[0].getDate() === 5));
  assert.equal(statsOf('岡谷連盟杯', '佐藤・原')[3], 0, '11/5 は岡谷連盟杯の練習期間外');
  post(table('2026-10-25', firstMatches.slice(0, 2).concat([{ round: 2, court: 'A', a: OHARA, b: HOSOI }, { round: 2, court: 'B', a: KARA, b: KOSHINO }])));
  assert.equal(statsOf('岡谷連盟杯', '佐藤・原')[3], 2);
});

test('別の表（別のコート・別の端末）の試合もペアと日付でまとまる', () => {
  const sid2 = 'Table0002cccccccccccc';
  assert.ok(post({ ...table('2026-10-28', [{ round: 1, court: 'A', a: ['根津真', '内田'], b: ['田中', '依田'] }]), sid: sid2, hostKey: 'HostKey0002dddddddddddd' }).ok);
  assert.ok(score(1, 'A', ['根津真', '内田'], ['田中', '依田'], 21, 12, sid2).ok);
  const u = statsOf('岡谷連盟杯', '内田・根津真');
  assert.deepEqual(u.slice(3, 6), [1, 1, 0]);
});

test('シートで「除外」にした試合は数えない（手で直したらキャッシュも捨てる）', () => {
  const sh = ctx.book.getSheetByName('試合');
  const r = rows('試合').findIndex(x => x[1] === SID && x[2] === 1 && x[3] === 'A') + 2;
  get({ action: 'get', id: SID }); // キャッシュに入れる
  sh.getRange(r, 11).setValue('除外');
  sh.getRange(r, 9).setValue(5);
  ctx.onEdit({ range: sh.getRange(r, 9, 1, 3) });
  assert.equal(statsOf('岡谷連盟杯', '佐藤・原')[3], 1, '1Aは除外');
  assert.equal(get({ action: 'get', id: SID }).matches.find(m => m.round === 1 && m.court === 'A').scoreA, 5, '手で直した点数がアプリに出る');
  assert.equal(score(1, 'A', OHARA, KOSHINO, 21, 18).ok, true);
  assert.equal(rows('試合')[r - 2][10], '除外', 'アプリから点数を直しても除外は外れない');
});

test('名前やデータが数式にならない', () => {
  const sid3 = 'Table0003eeeeeeeeeeee';
  assert.ok(post({ ...table('2026-10-25', [{ round: 1, court: 'A', a: ['=IMPORTXML(1)', '+1'], b: ['@x', '-y'] }]), sid: sid3, hostKey: 'HostKey0003ffffffffffff', data: '=HYPERLINK("x")' }).ok);
  const sh = ctx.book.getSheetByName('試合'), r = sh.getLastRow();
  assert.deepEqual([5, 6, 7, 8].map(c => [sh.value(r, c), sh.formula(r, c)]), [['=IMPORTXML(1)', ''], ['+1', ''], ['@x', ''], ['-y', '']]);
  const t = ctx.book.getSheetByName('対戦表'), tr = t.getLastRow();
  assert.deepEqual([t.value(tr, 7), t.formula(tr, 7)], ['=HYPERLINK("x")', '']);
  assert.ok(score(1, 'A', ['=IMPORTXML(1)', '+1'], ['@x', '-y'], 21, 3, sid3).ok, '数式に見える名前でも照合できる');
  assert.equal(get({ action: 'get', id: sid3 }).data, '=HYPERLINK("x")');
});

test('大会やペアを手で直したら成績が変わる・大会を消すと成績シートの大会も切り替わる', () => {
  const pairsSheet = ctx.book.getSheetByName('ペア');
  const r = pairsSheet.getLastRow() + 1;
  pairsSheet.getRange(r, 1, 1, 4).setValues([['岡谷連盟杯', '臨時→登録', '大野', '北原']]);
  ctx.onEdit({ range: pairsSheet.getRange(r, 1, 1, 4) });
  assert.deepEqual(statsOf('岡谷連盟杯', '大野・北原').slice(3, 6), [2, 1, 1], '後から登録したペアも過去の試合で数える');
  const view = ctx.book.getSheetByName('成績');
  view.getRange(1, 2).setValue('消える大会');
  admin('recompute');
  assert.ok(['岡谷連盟杯', '伊那市長杯'].includes(view.value(1, 2)), '存在しない大会は練習期間中・これからの大会に戻す（実行日で変わる）');
});

test('大会のペアを丸ごと入れ替える（名前の訂正。ほかの大会のペア・大会の並びはそのまま）', () => {
  const others = rows('ペア').filter(x => x[0] !== '岡谷連盟杯').length;
  const tours = rows('大会').map(x => x[0]);
  const r = admin('setPairs', { tournament: '岡谷連盟杯', pairs: [
    { category: '男子A', names: ['バレ', '原'], memo: 'ペア表では佐藤' }, { tournament: '別の大会', category: '男子B', names: KOSHINO },
  ] });
  assert.deepEqual([r.ok, r.removed, r.added], [true, 6, 2], JSON.stringify(r));
  assert.deepEqual(rows('ペア').filter(x => x[0] === '岡谷連盟杯').map(x => x.slice(1, 5)), [['男子A', 'バレ', '原', 'ペア表では佐藤'], ['男子B', '越野', '善志', '']], '大会名は指定した大会にそろえる');
  assert.equal(rows('ペア').filter(x => x[0] !== '岡谷連盟杯').length, others);
  assert.deepEqual(rows('大会').map(x => x[0]), tours);
  assert.ok(statsOf('岡谷連盟杯', 'バレ・原') && !statsOf('岡谷連盟杯', '佐藤・原'), '成績も入れ替わる');
  assert.equal(admin('setPairs', { tournament: 'ない大会', pairs: [] }).error, '大会シートにない大会です。');
  assert.equal(rows('ペア').filter(x => x[0] === '岡谷連盟杯').length, 2, 'エラーなら何も消さない');
});

test('後片付け（テストの表・大会を消す）', () => {
  const r = admin('deleteRows', { sids: [SID, 'Table0002cccccccccccc'], tournaments: ['伊那市長杯'] });
  assert.ok(r.ok);
  assert.ok(!rows('試合').some(x => x[1] === SID));
  assert.ok(!rows('対戦表').some(x => x[0] === SID));
  assert.ok(!rows('大会').some(x => x[0] === '伊那市長杯'));
  assert.equal(get({ action: 'get', id: SID }).code, 'not_found', 'キャッシュも消える');
});

test('サーバー側の想定外のエラーは中身を出さずに知らせる', () => {
  const broken = makeContext();
  broken.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error('内部の詳細'); };
  const r = JSON.parse(broken.doGet({ parameter: { action: 'tournaments', date: '2026-10-25' } }).content);
  assert.equal(r.code, 'server_error');
  assert.ok(!r.error.includes('内部の詳細'));
  assert.equal(broken.errors.length, 1, 'ログには残す');
  assert.deepEqual(ctx.errors, [], 'ここまでの正常系でエラーログなし');
});

if (failed) process.exitCode = 1;
else console.log('大会練習の成績（GASの窓口・シート）のテスト 全合格');
