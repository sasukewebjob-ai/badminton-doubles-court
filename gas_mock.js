// GAS（gas/core.js・gas/main.js）を Node で動かすための簡易モック（2026-10-24 test_gas_main.js から切り出し）
// SpreadsheetApp などを最小限まねる。数式（成績シートの並べ替え・大会シートの練習期間）は計算しない。
// - makeContext() … GAS のファイルを読み込んだ実行環境（doGet / doPost を呼べる）
// - webApp(ctx)   … ブラウザのテストで、公開Webアプリの代わりに応答する関数（Playwright の route から使う）
process.env.TZ = 'Asia/Tokyo';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const colOf = s => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
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
  // 左上のセルにかかる最後の入力規則（null を設定すると消える）
  getDataValidation() {
    const hit = this.sheet.validations.filter(({ range: [r, c, nr, nc] }) => this.row >= r && this.row < r + nr && this.col >= c && this.col < c + nc).pop();
    return hit ? hit.rule : null;
  }
  // 書式（太字・背景色・文字色）はセルごとに覚える。テストで見出しの行などを確かめる
  setFormats(kind, grid) {
    assert.equal(grid.length, this.nr, kind + ' の行数');
    grid.forEach(line => assert.equal(line.length, this.nc, kind + ' の列数'));
    return this.each((r, c, i, j) => {
      const f = this.sheet.formats.get(this.sheet.key(r, c)) || {};
      if (grid[i][j] === null) delete f[kind]; else f[kind] = grid[i][j];
      this.sheet.formats.set(this.sheet.key(r, c), f);
    });
  }
  setFontWeights(g) { return this.setFormats('weight', g); }
  setBackgrounds(g) { return this.setFormats('background', g); }
  setFontColors(g) { return this.setFormats('color', g); }
  clearFormat() { return this.each((r, c) => this.sheet.formats.delete(this.sheet.key(r, c))); }
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
  constructor(name, book) { this.name = name; this.book = book; this.id = book.nextSheetId++; this.metadata = []; this.cells = new Map(); this.formats = new Map(); this.validations = []; this.hidden = false; this.protections = []; this.maxRows = 1000; }
  key(r, c) { return r + ',' + c; }
  value(r, c) { const cell = this.cells.get(this.key(r, c)); return cell ? cell.v : ''; }
  formula(r, c) { const cell = this.cells.get(this.key(r, c)); return cell ? cell.f : ''; }
  // 本物と同じく、= で始まる文字は数式、先頭の ' は「文字として扱う」印で値には残らない
  put(r, c, v) {
    assert.ok(!(typeof v === 'string' && v.length > 50000), `${this.name} ${r}行${c}列: 1つのセルは5万字まで`);
    if (typeof v === 'string' && v.startsWith("'")) this.cells.set(this.key(r, c), { v: v.slice(1), f: '' });
    else if (typeof v === 'string' && v.startsWith('=')) this.cells.set(this.key(r, c), { v: '', f: v });
    else if (v === '' || v === null) this.cells.delete(this.key(r, c));
    else this.cells.set(this.key(r, c), { v, f: '' });
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  addDeveloperMetadata(key, value) {
    this.metadata.push({ getKey: () => key, getValue: () => value, getLocation: () => ({ getSheet: () => this }) });
    return this;
  }
  getDeveloperMetadata() { return this.metadata.slice(); }
  setName(n) { this.name = n; return this; }
  getIndex() { return this.book.sheets.indexOf(this) + 1; }
  format(r, c) { return this.formats.get(this.key(r, c)) || {}; }
  getLastRow() { let m = 0; for (const [k, cell] of this.cells) if (cell.v !== '' || cell.f) m = Math.max(m, Number(k.split(',')[0])); return m; }
  getLastColumn() { let m = 0; for (const [k, cell] of this.cells) if (cell.v !== '' || cell.f) m = Math.max(m, Number(k.split(',')[1])); return m; }
  // 本物と同じく、新しいシートは1000行。最大行を超える範囲は例外（appendRow と違って自動では増えない）。
  // 行を消すと最大行も減り、insertRowsAfter で増える
  getMaxRows() { return this.maxRows; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') { const m = a.match(/^([A-Z]+)(\d+):([A-Z]+)$/); return new Range(this, Number(m[2]), colOf(m[1]), this.maxRows - Number(m[2]) + 1, colOf(m[3]) - colOf(m[1]) + 1); }
    assert.ok(a >= 1 && b >= 1 && (c === undefined || c >= 1) && (d === undefined || d >= 1), `getRange(${a},${b},${c},${d}) は範囲外`);
    assert.ok(a + (c || 1) - 1 <= this.maxRows, `${this.name}: getRange(${a},${b},${c},${d}) は最大行${this.maxRows}を超える`);
    return new Range(this, a, b, c || 1, d || 1);
  }
  insertRowsAfter(after, n) {
    const next = new Map();
    for (const [k, cell] of this.cells) {
      const [row, col] = k.split(',').map(Number);
      next.set(row > after ? this.key(row + n, col) : k, cell);
    }
    this.cells = next;
    this.maxRows += n;
    return this;
  }
  deleteRow(r) {
    const next = new Map();
    for (const [k, cell] of this.cells) {
      const [row, col] = k.split(',').map(Number);
      if (row < r) next.set(k, cell); else if (row > r) next.set(this.key(row - 1, col), cell);
    }
    this.cells = next;
    this.maxRows--;
  }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  hideSheet() { this.hidden = true; return this; }
  protect() { const p = { warningOnly: false, setWarningOnly(b) { p.warningOnly = b; return p; } }; this.protections.push(p); return p; }
  getProtections() { return this.protections; }
}

class Book {
  constructor() { this.nextSheetId = 1; this.sheets = [new Sheet('シート1', this)]; this.active = this.sheets[0]; }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  setSpreadsheetLocale(l) { this.locale = l; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  createDeveloperMetadataFinder() {
    let key;
    const finder = { withKey(k) { key = k; return finder; }, find: () => this.sheets.flatMap(s => s.metadata).filter(m => m.getKey() === key) };
    return finder;
  }
  // index を渡すと、その位置（0始まり）に入れる
  insertSheet(n, index) { const s = new Sheet(n, this); if (index === undefined) this.sheets.push(s); else this.sheets.splice(index, 0, s); return s; }
  // 本物と同じく、最後の1枚は消せない
  deleteSheet(s) { assert.ok(this.sheets.length > 1, '最後のシートは消せない'); this.sheets = this.sheets.filter(x => x !== s); }
  setActiveSheet(s) { this.active = s; return s; }
  moveActiveSheet(pos) { this.sheets = this.sheets.filter(s => s !== this.active); this.sheets.splice(pos - 1, 0, this.active); }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/mock/edit'; }
}

function makeContext() {
  const book = new Book();
  const cache = new Map();
  const builder = () => { const rule = { getCriteriaValues: () => (rule.list ? [rule.list, rule.show] : [rule.range, rule.show]) }; const b = {
    requireValueInRange(r, show) { rule.range = r; rule.show = show; return b; }, requireValueInList(list, show) { rule.list = Array.from(list); rule.show = show; return b; },
    setAllowInvalid(x) { rule.allowInvalid = x; return b; }, setHelpText(t) { rule.help = t; return b; }, build() { return rule; } }; return b; };
  const context = {
    console: { error: (...a) => { context.errors.push(a.join(' ')); }, log() {} },
    errors: [],
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book, flush() {}, newDataValidation: builder, ProtectionType: { SHEET: 'SHEET' },
      getUi: () => { const menu = { addItem: () => menu, addToUi() {} }; return { createMenu: () => menu }; },
    },
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

// 公開Webアプリと同じふるまい：c・sid をURLに入れるとスクリプトに届かず400（2026-10-24の本番確認で発覚）
function webApp(ctx) {
  return ({ method, url, body }) => {
    const params = Object.fromEntries(new URL(url).searchParams);
    if ('c' in params || 'sid' in params) return { status: 400, contentType: 'text/html', body: '<title>ページが見つかりません</title>' };
    const out = method === 'GET' ? ctx.doGet({ parameter: params }) : ctx.doPost({ parameter: params, postData: { contents: body || '' } });
    return { status: 200, contentType: 'application/json', body: out.content };
  };
}

module.exports = { makeContext, webApp, Book, Sheet, Range };
