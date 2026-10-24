/**
 * 大会練習の成績：Webアプリの窓口とシートの読み書き。
 * 計算は core.js（CORE）に任せ、ここではシートとの受け渡しだけをする。
 *
 * 窓口（アプリの singles.html 固定ペア版から呼ぶ）
 *   GET  ?action=tournaments&date=YYYY-MM-DD … その日が練習期間の大会と大会ペア
 *   GET  ?action=get&id=表ID&since=版        … 表の点数（版が新しければ共有データも）
 *        ※ c・sid はGoogleの予約語でURLに使えない（400「ファイルを開くことができません」になる）
 *   POST {action:'register', …}               … 対戦表の登録・作り直し（作った端末の鍵が必要）
 *   POST {action:'score', …}                  … 点数の入力・消去（リンクを開いた人なら誰でも）
 *   POST {action:'admin', key, op, …}         … 準備・確認用（ADMIN_KEY は secret.js。git に入れない）
 */
const SHEETS = {
  view: '成績', tournaments: '大会', pairs: 'ペア', matches: '試合', log: '記録',
  stats: 'ペア成績', tables: '対戦表', roster: '名簿',
};
const TZ = 'Asia/Tokyo';
const TOUR_HEADERS = ['大会名', '大会日', '練習開始', '練習終了', '内容', 'メモ'];
const PAIR_HEADERS = ['大会名', '種目・クラス', '選手1', '選手2', 'メモ'];
const MATCH_HEADERS = ['練習日', '表ID', '節', 'コート', 'ペアA 1人目', 'ペアA 2人目', 'ペアB 1人目', 'ペアB 2人目', 'A点', 'B点', '状態', '表', '更新日時'];
const COL = { date: 1, sid: 2, round: 3, court: 4, a1: 5, a2: 6, b1: 7, b2: 8, scoreA: 9, scoreB: 10, state: 11, table: 12, at: 13 };
const TABLE_HEADERS = ['表ID', '練習日', '作成日時', '更新日時', '版', '鍵', '共有データ'];
const STATS_HEADERS = ['大会名', '種目・クラス', 'ペア', '試合', '勝', '敗', '勝率', '得点', '失点', '得失点', '参加日数', '並び順'];
const VIEW_HEADERS = ['順位', '種目・クラス', 'ペア', '試合', '勝', '敗', '勝率', '得点', '失点', '得失点', '参加日数'];
const LOG_HEADERS = ['日時', '表ID', '節', 'コート', '操作', '内容'];
const ROSTER_HEADERS = ['名前'];
// 書き込んだ側がすぐ新しい内容を入れ直すが、読み込みと書き込みが重なると古い内容が入りうるので短めにする
const CACHE_SECONDS = 20;

// ---------- 窓口 ----------
function doGet(e) {
  return respond_(() => {
    const p = (e && e.parameter) || {};
    if (p.action === 'tournaments') return apiTournaments_(p.date);
    if (p.action === 'get') return apiGet_(p.id, Number(p.since) || 0);
    if (p.action === 'ping') return { ok: true };
    throw userError_('不明な操作です。');
  });
}

function doPost(e) {
  return respond_(() => {
    let body;
    try { body = JSON.parse(e.postData.contents); } catch (err) { throw userError_('送信内容が読めません。'); }
    if (!body || typeof body !== 'object') throw userError_('送信内容が読めません。');
    if (body.action === 'register') return apiRegister_(body);
    if (body.action === 'score') return apiScore_(body);
    if (body.action === 'admin') return apiAdmin_(body);
    throw userError_('不明な操作です。');
  });
}

function respond_(fn) {
  let out;
  try {
    out = fn();
  } catch (err) {
    if (!(err && err.userMessage)) console.error(err && err.stack ? err.stack : err);
    out = { ok: false, error: err && err.userMessage ? err.userMessage : 'サーバーでエラーが起きました。少し待ってからもう一度試してください。', code: (err && err.code) || 'server_error' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function userError_(message, code) {
  const e = new Error(message);
  e.userMessage = message;
  e.code = code || 'bad_request';
  return e;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('混み合っています。少し待ってからもう一度試してください。', 'busy');
  try { return fn(); } finally { lock.releaseLock(); }
}

function apiTournaments_(date) {
  if (CORE.dayNumber(date) === null) throw userError_('日付が正しくありません。');
  return { ok: true, tournaments: CORE.activeTournaments(readTournaments_(), readPairs_(), date) };
}

function apiGet_(sid, since) {
  if (!CORE.isId(sid)) throw userError_('表IDが正しくありません。');
  const snap = snapshot_(sid);
  if (!snap.version) throw userError_('この対戦表はまだ登録されていません。', 'not_found');
  const out = { ok: true, version: snap.version, date: snap.date, matches: snap.matches };
  if (snap.version > since) out.data = snap.data;
  return out;
}

function apiRegister_(p) {
  const err = CORE.checkRegister(p);
  if (err) throw userError_(err);
  return withLock_(() => {
    const tables = sheet_(SHEETS.tables);
    const row = findRow_(tables, 1, p.sid);
    const hash = digest_(p.hostKey), now = new Date();
    let version;
    if (row) {
      const v = tables.getRange(row, 1, 1, TABLE_HEADERS.length).getValues()[0];
      if (String(v[5]) !== hash) throw userError_('この対戦表は別の端末で作られたため、作り直しを登録できません。', 'forbidden');
      version = (Number(v[4]) || 0) + 1;
      tables.getRange(row, 2, 1, 6).setValues([[dateValue_(p.date), v[2], now, version, hash, CORE.cellText(p.data)]]);
    } else {
      version = 1;
      appendRows_(tables, [[CORE.cellText(p.sid), dateValue_(p.date), now, now, version, hash, CORE.cellText(p.data)]]);
    }

    const sh = sheet_(SHEETS.matches);
    const existing = sidMatches_(sh, p.sid);
    const plan = CORE.planRegister(existing, p.matches);
    const byRow = {};
    existing.forEach(m => { byRow[m.row] = m; });
    plan.swap.forEach(r => {
      const m = byRow[r];
      sh.getRange(r, COL.a1, 1, 6).setValues([[side_(m.b, 0), side_(m.b, 1), side_(m.a, 0), side_(m.a, 1), m.scoreB === null ? '' : m.scoreB, m.scoreA === null ? '' : m.scoreA]]);
    });
    plan.retire.forEach(r => sh.getRange(r, COL.table).setValue(CORE.TABLE_PREV));
    // 練習日をあとから直したときは、この表の行すべてを新しい日付にする（組み合わせはそのまま）
    let dateChanged = false;
    existing.forEach(m => {
      if (m.date !== p.date) { sh.getRange(m.row, COL.date).setValue(dateValue_(p.date)); dateChanged = true; }
    });
    if (plan.add.length) {
      appendRows_(sh, plan.add.map(m => [
        dateValue_(p.date), CORE.cellText(p.sid), m.round, m.court,
        side_(m.a, 0), side_(m.a, 1), side_(m.b, 0), side_(m.b, 1), '', '', CORE.STATE_EMPTY, '', now,
      ]));
    }
    if (p.roster) writeRoster_(CORE.mergeRoster(readRoster_(), p.roster));
    log_(p.sid, '', '', version === 1 ? '登録' : '作り直し', '版' + version + '・' + p.matches.length + '試合' +
      (plan.retire.length ? '・作り直し前' + plan.retire.length + '試合' : ''));
    snapshot_(p.sid, true);
    const scoredChanged = plan.swap.length || plan.retire.some(r => byRow[r].scoreA !== null) || dateChanged;
    if (scoredChanged) recomputeStats_();
    return { ok: true, version };
  });
}

function apiScore_(p) {
  const err = CORE.checkScore(p);
  if (err) throw userError_(err);
  const score = CORE.parseScore(p.scoreA, p.scoreB);
  return withLock_(() => {
    const sh = sheet_(SHEETS.matches);
    const rows = sidMatches_(sh, p.sid);
    if (!rows.length) throw userError_('この対戦表はまだ登録されていません。', 'not_found');
    const m = rows.find(r => r.table !== CORE.TABLE_PREV && r.round === p.round && r.court === p.court);
    if (!m || !CORE.sameSide(m.a, p.a) || !CORE.sameSide(m.b, p.b)) {
      throw userError_('対戦表が作り直されています。画面を更新してから入れ直してください。', 'stale');
    }
    const state = m.state === CORE.STATE_EXCLUDED ? m.state : score.clear ? CORE.STATE_EMPTY : CORE.STATE_DONE;
    sh.getRange(m.row, COL.scoreA, 1, 5).setValues([[score.clear ? '' : score.a, score.clear ? '' : score.b, state, m.table, new Date()]]);
    const before = m.scoreA === null ? '未入力' : m.scoreA + '-' + m.scoreB;
    log_(p.sid, p.round, p.court, score.clear ? '消去' : '入力', before + ' → ' + (score.clear ? '未入力' : score.a + '-' + score.b));
    const snap = snapshot_(p.sid, true);
    recomputeStats_();
    return { ok: true, version: snap.version, matches: snap.matches };
  });
}

// ---------- 管理用（準備・確認・後片付け） ----------
function apiAdmin_(p) {
  if (typeof ADMIN_KEY !== 'string' || ADMIN_KEY.length < 20 || p.key !== ADMIN_KEY) throw userError_('権限がありません。', 'forbidden');
  if (p.op === 'setup') return withLock_(() => setup_(p));
  if (p.op === 'dump') return dump_(p);
  if (p.op === 'view') return withLock_(() => view_(p));
  if (p.op === 'addTournaments') return withLock_(() => { addTournaments_(p.tournaments || []); recomputeStats_(); return { ok: true }; });
  if (p.op === 'addPairs') return withLock_(() => { addPairs_(p.pairs || []); recomputeStats_(); return { ok: true }; });
  if (p.op === 'setPairs') return withLock_(() => { const r = setPairs_(p); recomputeStats_(); return r; });
  if (p.op === 'deleteRows') return withLock_(() => deleteRows_(p));
  if (p.op === 'recompute') return withLock_(() => { recomputeStats_(); return { ok: true }; });
  throw userError_('不明な操作です。');
}

// 確認用：各シートの表示値（成績シートは数式の計算結果）
function dump_(p) {
  SpreadsheetApp.flush();
  const out = { ok: true, sheets: {} };
  (p.sheets || Object.keys(SHEETS).map(k => SHEETS[k])).forEach(name => {
    const sh = book_().getSheetByName(name);
    if (!sh) return;
    const last = Math.min(sh.getLastRow(), p.limit || 200), cols = sh.getLastColumn();
    out.sheets[name] = last && cols ? sh.getRange(1, 1, last, cols).getDisplayValues() : [];
  });
  return out;
}

// 確認用：成績シートの大会・最低試合数を切り替えて計算結果を返す
function view_(p) {
  const sh = sheet_(SHEETS.view);
  if (p.tournament !== undefined) sh.getRange(1, 2).setValue(CORE.cellText(p.tournament));
  if (p.min !== undefined) sh.getRange(1, 5).setValue(p.min);
  SpreadsheetApp.flush();
  const last = Math.max(sh.getLastRow(), 5);
  return { ok: true, values: sh.getRange(1, 1, last, VIEW_HEADERS.length).getDisplayValues() };
}

// テストデータの後片付け：表IDの行を試合・対戦表・記録から消す（大会名を渡すと大会とそのペアも）
function dropRows_(name, col, pred) {
  const sh = book_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return 0;
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  let n = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (pred(String(values[i][col - 1]).trim())) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}

function deleteRows_(p) {
  const removed = {};
  const drop = (name, col, pred) => { removed[name] = dropRows_(name, col, pred); };
  // 文字列を渡すと indexOf が部分一致になり関係ない行まで消えるので、配列の表IDだけを受け付ける
  const sids = Array.isArray(p.sids) ? p.sids.filter(CORE.isId) : [];
  if (sids.length) {
    drop(SHEETS.matches, COL.sid, v => sids.indexOf(v) >= 0);
    drop(SHEETS.tables, 1, v => sids.indexOf(v) >= 0);
    drop(SHEETS.log, 2, v => sids.indexOf(v) >= 0);
    sids.forEach(invalidate_);
  }
  const tours = Array.isArray(p.tournaments) ? p.tournaments.filter(t => typeof t === 'string' && t.trim()) : [];
  if (tours.length) {
    drop(SHEETS.tournaments, 1, v => tours.indexOf(v) >= 0);
    drop(SHEETS.pairs, 1, v => tours.indexOf(v) >= 0);
  }
  recomputeStats_();
  return { ok: true, removed };
}

// ---------- シートの準備 ----------
function setup_(p) {
  const ss = book_();
  ss.setSpreadsheetTimeZone(TZ);
  ss.setSpreadsheetLocale('ja_JP');
  // 作成時の空のシート（シート1）は成績シートとして使う
  if (!ss.getSheetByName(SHEETS.view)) {
    const first = ss.getSheets().find(s => /^(シート|Sheet)1$/.test(s.getName()) && s.getLastRow() === 0);
    if (first) first.setName(SHEETS.view);
  }
  const order = [SHEETS.view, SHEETS.tournaments, SHEETS.pairs, SHEETS.matches, SHEETS.log, SHEETS.stats, SHEETS.tables, SHEETS.roster];
  order.forEach(name => { if (!ss.getSheetByName(name)) ss.insertSheet(name); });

  header_(SHEETS.tournaments, TOUR_HEADERS, [160, 120, 120, 120, 200, 200]);
  header_(SHEETS.pairs, PAIR_HEADERS, [160, 110, 90, 90, 200]);
  header_(SHEETS.matches, MATCH_HEADERS, [95, 150, 40, 50, 80, 80, 80, 80, 45, 45, 70, 80, 140]);
  header_(SHEETS.log, LOG_HEADERS, [140, 150, 40, 50, 70, 200]);
  header_(SHEETS.stats, STATS_HEADERS, null);
  header_(SHEETS.tables, TABLE_HEADERS, null);
  header_(SHEETS.roster, ROSTER_HEADERS, null);

  const tours = sheet_(SHEETS.tournaments);
  tours.getRange(2, 2, tours.getMaxRows() - 1, 3).setNumberFormat('yyyy/mm/dd (ddd)');
  tours.getRange(1, 3).setNote('空欄なら「大会日の3週前の日曜日」が自動で入ります。日付を手で入れると、その日からになります。');
  tours.getRange(1, 4).setNote('空欄なら「大会の前日」が自動で入ります。');
  const matches = sheet_(SHEETS.matches);
  applyFormats_(matches);
  matches.getRange(1, COL.state).setNote('アプリが自動で入れます。成績から外したい試合は「除外」にしてください。');
  matches.getRange(1, COL.table).setNote('「作り直し前」は途中変更で組み直された試合です。点数が入っていれば実際に試合した結果として成績に入ります。');
  applyFormats_(sheet_(SHEETS.log));

  if (p.roster) writeRoster_(CORE.mergeRoster(readRoster_(), p.roster));
  if (p.tournaments && sheet_(SHEETS.tournaments).getLastRow() < 2) addTournaments_(p.tournaments);
  if (p.pairs && sheet_(SHEETS.pairs).getLastRow() < 2) addPairs_(p.pairs);
  ensureTournamentFormulas_();

  // プルダウン：ペアの大会名は大会シートから（それ以外は不可）、選手は名簿から（名簿外の人は警告だけ）
  const pairs = sheet_(SHEETS.pairs), rows = pairs.getMaxRows() - 1;
  pairs.getRange(2, 1, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(tours.getRange('A2:A'), true).setAllowInvalid(false).build());
  pairs.getRange(2, 3, rows, 2).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sheet_(SHEETS.roster).getRange('A2:A'), true).setAllowInvalid(true)
    .setHelpText('名簿にない名前です（大会ペアの自動作成には名簿の名前が必要です）').build());

  setupView_();
  [SHEETS.matches, SHEETS.log, SHEETS.stats, SHEETS.tables].forEach(name => {
    const sh = sheet_(name);
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setWarningOnly(true);
  });
  order.forEach((name, i) => { ss.setActiveSheet(sheet_(name)); ss.moveActiveSheet(i + 1); });
  [SHEETS.stats, SHEETS.tables, SHEETS.roster].forEach(name => sheet_(name).hideSheet());
  ss.setActiveSheet(sheet_(SHEETS.view));
  recomputeStats_();
  return { ok: true, url: ss.getUrl() };
}

function header_(name, headers, widths) {
  const sh = sheet_(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e6f4ea');
  sh.setFrozenRows(1);
  if (widths) widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
}

// 成績シート：大会を選ぶと、その大会ペアの練習成績が勝率順に出る（計算は ペア成績 シート、ここは並べ替えだけ）
function setupView_() {
  const sh = sheet_(SHEETS.view);
  // 選んでいる大会（B1）と最低試合数（E1）は、整え直しても消さない
  sh.getRange(1, 1).setValue('大会').setFontWeight('bold');
  sh.getRange(1, 4).setValue('最低試合数');
  if (sh.getRange(1, 5).getValue() === '') sh.getRange(1, 5).setValue(0);
  sh.getRange(1, 4).setFontWeight('bold').setNote('この試合数より少ないペアは表示しません（1試合だけで勝率100%のペアが上に来るのを防ぐ）。');
  sh.getRange(1, 2).setBackground('#fff8e1').setFontWeight('bold').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(sheet_(SHEETS.tournaments).getRange('A2:A'), true).setAllowInvalid(false).build());
  sh.getRange(1, 5).setBackground('#fff8e1');
  sh.getRange(2, 1).setFormula(
    '=IFERROR("練習期間 "&TEXT(XLOOKUP($B$1,\'大会\'!A2:A,\'大会\'!C2:C),"m/d(ddd)")&" 〜 "&TEXT(XLOOKUP($B$1,\'大会\'!A2:A,\'大会\'!D2:D),"m/d(ddd)")' +
    '&"　大会 "&TEXT(XLOOKUP($B$1,\'大会\'!A2:A,\'大会\'!B2:B),"m/d(ddd)"),"")');
  sh.getRange(3, 1).setValue('大会に登録したペアの練習成績です（臨時ペアは数えません。大会ペアが臨時ペアと対戦した試合は数えます）。');
  sh.getRange(3, 1).setFontColor('#666666');
  sh.getRange(4, 1, 1, VIEW_HEADERS.length).setValues([VIEW_HEADERS]).setFontWeight('bold').setBackground('#e6f4ea');
  sh.setFrozenRows(4);
  sh.getRange(5, 1).setFormula(
    '=IFERROR(LET(d,FILTER(\'ペア成績\'!B2:L,\'ペア成績\'!A2:A=$B$1,\'ペア成績\'!D2:D>=$E$1),' +
    's,SORT(d,11,FALSE,3,FALSE,9,FALSE),HSTACK(SEQUENCE(ROWS(s)),CHOOSECOLS(s,1,2,3,4,5,6,7,8,9,10))),"（該当するペアがありません）")');
  sh.getRange(5, 7, sh.getMaxRows() - 4, 1).setNumberFormat('0.0%');
  [50, 110, 160, 50, 40, 40, 60, 50, 50, 60, 70].forEach((w, i) => sh.setColumnWidth(i + 1, w));
}

// 大会シート：練習開始・終了が空の行に自動計算の式を入れる（手で入れた日付はそのまま）
function ensureTournamentFormulas_() {
  const sh = sheet_(SHEETS.tournaments), n = sh.getLastRow() - 1;
  if (n <= 0) return;
  const values = sh.getRange(2, 1, n, 4).getValues(), formulas = sh.getRange(2, 3, n, 2).getFormulas();
  values.forEach((v, i) => {
    const r = i + 2;
    if (v[1] === '' || v[1] === null) return;
    if (v[2] === '' && !formulas[i][0]) sh.getRange(r, 3).setFormula('=IF(B' + r + '="","",B' + r + '-21+MOD(1-WEEKDAY(B' + r + '-21),7))');
    if (v[3] === '' && !formulas[i][1]) sh.getRange(r, 4).setFormula('=IF(B' + r + '="","",B' + r + '-1)');
  });
}

function addTournaments_(list) {
  const rows = list.filter(t => t && typeof t.name === 'string' && CORE.dayNumber(t.date) !== null)
    .map(t => [CORE.cellText(t.name.trim()), dateValue_(t.date), '', '', CORE.cellText(t.content || ''), CORE.cellText(t.memo || '')]);
  if (rows.length) appendRows_(sheet_(SHEETS.tournaments), rows);
  ensureTournamentFormulas_();
}

function addPairs_(list) {
  const rows = list.filter(p => p && typeof p.tournament === 'string' && Array.isArray(p.names) && p.names.length === 2)
    .map(p => [CORE.cellText(p.tournament.trim()), CORE.cellText(p.category || ''), CORE.cellText(p.names[0]), CORE.cellText(p.names[1]), CORE.cellText(p.memo || '')]);
  if (rows.length) appendRows_(sheet_(SHEETS.pairs), rows);
}

// 大会のペアを丸ごと入れ替える（名前の訂正・ペア表の更新。大会の行と並びはそのまま）
function setPairs_(p) {
  const t = typeof p.tournament === 'string' ? p.tournament.trim() : '';
  if (!t || !readTournaments_().some(x => x.name === t)) throw userError_('大会シートにない大会です。');
  const pairs = (p.pairs || []).map(x => ({ ...x, tournament: t }));
  const removed = dropRows_(SHEETS.pairs, 1, v => v === t);
  addPairs_(pairs);
  return { ok: true, removed, added: readPairs_().filter(x => x.tournament === t).length };
}

// ---------- 成績の再計算 ----------
function recomputeStats_() {
  const tours = readTournaments_();
  const rows = CORE.computeStats(tours, readPairs_(), readMatches_().map(m => ({
    date: m.date, a: m.a, b: m.b, scoreA: m.scoreA, scoreB: m.scoreB, excluded: m.state === CORE.STATE_EXCLUDED,
  })));
  const sh = sheet_(SHEETS.stats), old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, STATS_HEADERS.length).clearContent();
  if (rows.length) {
    sh.getRange(2, 1, rows.length, STATS_HEADERS.length).setValues(rows.map(r => [
      CORE.cellText(r.tournament), CORE.cellText(r.category), CORE.cellText(r.label), r.games, r.wins, r.losses,
      r.rate === null ? '' : r.rate, r.pf, r.pa, r.diff, r.days, r.rate === null ? -1 : r.rate,
    ]));
  }
  // 成績シートの大会が空・消えた大会なら、いま練習期間中の大会にする
  const view = book_().getSheetByName(SHEETS.view);
  if (view) {
    const current = String(view.getRange(1, 2).getValue()).trim();
    if (!tours.some(t => t.name === current)) view.getRange(1, 2).setValue(CORE.cellText(CORE.defaultTournament(tours, todayYmd_())));
  }
}

// ---------- シートの読み書き ----------
function book_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const sh = book_().getSheetByName(name);
  if (!sh) throw userError_('スプレッドシートの準備ができていません（「' + name + '」シートがありません）。', 'not_ready');
  return sh;
}

// 新しいシートは1000行で、getRange は最大行を超えると例外になる（appendRow と違って行は自動で増えない）。
// 足りなければまとめて増やす（2026-10-24。記録シートは点数を保存するたびに1行増え、練習20回前後で満杯になっていた）
function appendRows_(sh, rows) {
  const start = sh.getLastRow() + 1, short = start + rows.length - 1 - sh.getMaxRows();
  if (short > 0) {
    sh.insertRowsAfter(sh.getMaxRows(), short + 500);
    applyFormats_(sh);
  }
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

// 日付の表示形式（準備のときと、行を増やしたときに付ける）
function applyFormats_(sh) {
  const name = sh.getName();
  const formats = name === SHEETS.matches ? [[COL.date, 'yyyy/mm/dd (ddd)'], [COL.at, 'yyyy/mm/dd hh:mm']]
    : name === SHEETS.log ? [[1, 'yyyy/mm/dd hh:mm:ss']] : [];
  formats.forEach(([col, format]) => sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat(format));
}

function findRow_(sh, col, text) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const hit = sh.getRange(2, col, last - 1, 1).createTextFinder(text).matchCase(true).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function readTournaments_() {
  const sh = sheet_(SHEETS.tournaments), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return CORE.resolveTournaments(sh.getRange(2, 1, n, 4).getValues().map(v => ({
    name: String(v[0]).trim(), date: ymd_(v[1]), start: ymd_(v[2]), end: ymd_(v[3]),
  })));
}

function readPairs_() {
  const sh = sheet_(SHEETS.pairs), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, 4).getValues().map(v => ({
    tournament: String(v[0]).trim(), category: String(v[1]).trim(), names: [String(v[2]).trim(), String(v[3]).trim()],
  }));
}

function rowToMatch_(v, row) {
  const score = x => (x === '' || x === null ? null : x);
  return {
    row, date: ymd_(v[COL.date - 1]), sid: String(v[COL.sid - 1]).trim(), round: Number(v[COL.round - 1]), court: String(v[COL.court - 1]).trim(),
    a: [v[COL.a1 - 1], v[COL.a2 - 1]].map(x => String(x).trim()).filter(Boolean),
    b: [v[COL.b1 - 1], v[COL.b2 - 1]].map(x => String(x).trim()).filter(Boolean),
    scoreA: score(v[COL.scoreA - 1]), scoreB: score(v[COL.scoreB - 1]),
    state: String(v[COL.state - 1]).trim(), table: String(v[COL.table - 1]).trim(),
  };
}

function readMatches_() {
  const sh = sheet_(SHEETS.matches), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, MATCH_HEADERS.length).getValues().map((v, i) => rowToMatch_(v, i + 2));
}

// 1つの表の行だけを読む（表IDで探して、その範囲だけ読む）
function sidMatches_(sh, sid) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const hits = sh.getRange(2, COL.sid, last - 1, 1).createTextFinder(sid).matchCase(true).matchEntireCell(true).findAll().map(r => r.getRow());
  if (!hits.length) return [];
  const first = Math.min.apply(null, hits), lastHit = Math.max.apply(null, hits);
  return sh.getRange(first, 1, lastHit - first + 1, MATCH_HEADERS.length).getValues()
    .map((v, i) => rowToMatch_(v, first + i)).filter(m => m.sid === sid);
}

// アプリに返す内容（点数の入った現在の試合と、共有データ）。30秒ごとに読まれるのでキャッシュする
function snapshot_(sid, fresh) {
  const cache = CacheService.getScriptCache();
  const hit = fresh ? null : cache.get('s:' + sid);
  if (hit) return JSON.parse(hit);
  const tables = sheet_(SHEETS.tables), row = findRow_(tables, 1, sid);
  let snap = { version: 0, date: '', data: '', matches: [] };
  if (row) {
    const v = tables.getRange(row, 1, 1, TABLE_HEADERS.length).getValues()[0];
    snap = {
      version: Number(v[4]) || 0, date: ymd_(v[1]), data: String(v[6]),
      matches: sidMatches_(sheet_(SHEETS.matches), sid)
        .filter(m => m.table !== CORE.TABLE_PREV && m.scoreA !== null && m.scoreB !== null)
        // 対戦の顔ぶれも返す。アプリは自分の表と同じ対戦の点数だけを出す（作り直しの登録が届く前の古い点数を別の対戦に出さない）
        .map(m => ({ round: m.round, court: m.court, a: m.a, b: m.b, scoreA: m.scoreA, scoreB: m.scoreB })),
    };
  }
  try { cache.put('s:' + sid, JSON.stringify(snap), CACHE_SECONDS); } catch (e) { /* 大きすぎる表はキャッシュしないだけ */ }
  return snap;
}

function invalidate_(sid) {
  try { CacheService.getScriptCache().remove('s:' + sid); } catch (e) { /* キャッシュが使えなくても動く */ }
}

function log_(sid, round, court, op, text) {
  appendRows_(sheet_(SHEETS.log), [[new Date(), CORE.cellText(sid), round, court, op, CORE.cellText(text)]]);
}

function readRoster_() {
  const sh = sheet_(SHEETS.roster), n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(v => String(v[0]).trim()).filter(Boolean) : [];
}

function writeRoster_(names) {
  const sh = sheet_(SHEETS.roster), old = sh.getLastRow() - 1;
  if (old > 0) sh.getRange(2, 1, old, 1).clearContent();
  if (names.length) sh.getRange(2, 1, names.length, 1).setValues(names.map(n => [CORE.cellText(n)]));
}

function side_(names, i) { return names[i] === undefined ? '' : CORE.cellText(names[i]); }

function digest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

// シートの日付（Date・文字列・シリアル値）を 'YYYY-MM-DD' に
function ymd_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 0) return CORE.ymdOf(Math.round(v) - 25569); // 1899-12-30 起点のシリアル値
  if (typeof v === 'string') {
    const m = v.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      const s = m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
      return CORE.dayNumber(s) === null ? '' : s;
    }
  }
  return '';
}

// 'YYYY-MM-DD' を東京の0時の Date に（スクリプトのタイムゾーンは appsscript.json で Asia/Tokyo）
function dateValue_(ymd) {
  return new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
}

function todayYmd_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

// ---------- スプレッドシート上の操作 ----------
// 最初に1回だけ、スクリプトエディタでこの関数を実行して権限を許可する（Webアプリが自分の権限で動くため）
function 初回の承認() {
  console.log('承認できました：' + SpreadsheetApp.getActiveSpreadsheet().getName());
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('大会練習')
    .addItem('成績を再計算', 'menuRecompute')
    .addItem('シートを整える', 'menuSetup')
    .addToUi();
}

// メニューや手での編集からの再計算も、アプリからの書き込みと同じロックの中で行う
// （ロックの外だと、点数の保存と前後したときに古い内容で成績を上書きすることがある）
function menuRecompute() { withLock_(() => recomputeStats_()); }
function menuSetup() { withLock_(() => setup_({})); }

// 大会・ペア・試合を手で直したら成績を計算し直す（シンプルトリガー）
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  if ([SHEETS.tournaments, SHEETS.pairs, SHEETS.matches].indexOf(name) < 0) return;
  try {
    withLock_(() => {
      if (name === SHEETS.tournaments) ensureTournamentFormulas_();
      if (name === SHEETS.matches) {
        const sh = e.range.getSheet();
        const first = Math.max(e.range.getRow(), 2), last = e.range.getRow() + e.range.getNumRows() - 1;
        if (last >= first) sh.getRange(first, COL.sid, last - first + 1, 1).getValues().forEach(v => invalidate_(String(v[0]).trim()));
      }
      recomputeStats_();
    });
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
}
