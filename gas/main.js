/**
 * 大会練習の成績と練習日ごとの記録：Webアプリの窓口とシートの読み書き。
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
  view: '成績', day: '練習日', tournaments: '大会', pairs: 'ペア', matches: '試合', log: '記録',
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
// 順番待ちの上限。アプリは保存の返事を60秒待つので、その内に「混み合っています」を返せる長さにする
// （20秒だと、8人が同時に保存したときに後ろの人が待ちきれなかった。2026-10-25 check_score_concurrent.js で実測）
const LOCK_WAIT_MS = 45000;
// スプレッドシート上の操作（シンプルトリガーは30秒で止まる）
const LOCK_WAIT_SHEET_MS = 20000;

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

// 書き込みは手放す前に確定させる（確定前に手放すと、次の人が古い内容を読むことがある）
function withLock_(fn, waitMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) throw userError_('混み合っています。少し待ってからもう一度試してください。', 'busy');
  try { return fn(); } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

function apiTournaments_(date) {
  if (CORE.dayNumber(date) === null) throw userError_('日付が正しくありません。');
  return { ok: true, tournaments: CORE.activeTournaments(readTournaments_(), readPairs_(), date) };
}

function apiGet_(sid, since) {
  if (!CORE.isId(sid)) throw userError_('表IDが正しくありません。');
  flushStatsIfIdle_();
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
  const asked = Date.now();
  return withLock_(() => {
    const began = Date.now();
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
    // 返事は、さっき読んだ行に今の点数を入れて作る（試合シートを読み直すと、そのぶん順番待ちが長くなる）
    m.scoreA = score.clear ? null : score.a; m.scoreB = score.clear ? null : score.b; m.state = state;
    const snap = snapshot_(p.sid, true, rows);
    const stats = statsAfterWrite_();
    // took はサーバー側の時間（順番待ち・処理）。check_score_concurrent.js が表示する
    return { ok: true, version: snap.version, matches: snap.matches, took: { wait: began - asked, work: Date.now() - began, stats } };
  });
}

// ---------- 管理用（準備・確認・後片付け） ----------
function apiAdmin_(p) {
  if (typeof ADMIN_KEY !== 'string' || ADMIN_KEY.length < 20 || p.key !== ADMIN_KEY) throw userError_('権限がありません。', 'forbidden');
  if (p.op === 'setup') return withLock_(() => setup_(p));
  // 確認の前に、後回しにした成績の計算を片付ける（e2e などが見るのは計算済みの成績）
  if (p.op === 'dump') { withLock_(() => flushStats_(true)); return dump_(p); }
  if (p.op === 'view') return withLock_(() => { flushStats_(true); return view_(p); });
  if (p.op === 'day') return withLock_(() => { flushStats_(true); return day_(p); });
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

// 確認用：練習日シートの日付を選んで（date: 'YYYY-MM-DD' か表示の文字。'' なら自動）中身を返す
function day_(p) {
  const sh = daySheet_();
  if (p.date !== undefined) {
    const text = String(p.date);
    sh.getRange(1, 2).setValue(CORE.cellText(CORE.dayNumber(text) !== null ? CORE.dayLabel(text) : text));
  }
  renderDay_(readMatches_(), p.date !== undefined && p.date !== '');
  SpreadsheetApp.flush();
  return { ok: true, values: sh.getRange(1, 1, Math.max(sh.getLastRow(), 2), DAY_COLS).getDisplayValues() };
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
  const order = [SHEETS.view, SHEETS.day, SHEETS.tournaments, SHEETS.pairs, SHEETS.matches, SHEETS.log, SHEETS.stats, SHEETS.tables, SHEETS.roster];
  order.forEach(name => { if (!ss.getSheetByName(name)) ss.insertSheet(name); });
  setupDay_(sheet_(SHEETS.day));

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
  const tours = readTournaments_(), matches = readMatches_();
  const rows = CORE.computeStats(tours, readPairs_(), matches.map(m => ({
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
  // 表示更新に失敗しても点数は保存する。失敗した表示は次の取得・保存で再試行する。
  let pending = false;
  [() => renderDay_(matches), () => renderDayTabs_(matches)].forEach(render => {
    try { render(); } catch (e) { pending = true; console.error(e && e.stack ? e.stack : e); }
  });
  setStatsState_({ at: Date.now(), pending, dayTabsVersion: 1 });
}

// ---------- 練習日シート（2026-10-25 ユーザー要望：体育館のノートの代わり） ----------
// B1 で練習日を選ぶと、その日1日分（出席者と成績・ペアごとの成績・対戦表と点数）が出る。
// 中身は成績を計算し直すとき（点数の保存のあと）と、B1 を選び直したときに作り直す。
// 新しい練習日の点数が入ったら、その日に切り替える
const DAY_COLS = 8;
const DAY_LIST_MAX = 400; // プルダウンに出す練習日（新しい順）
const DAY_KEY = 'day';
const DAY_TAB_META = 'badmintonPracticeDay';

// 無ければ作る（公開中のスプシに「シートを整える」をしなくても、最初の計算で出てくる）
function daySheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(SHEETS.day);
  if (sh) return sh;
  const view = ss.getSheetByName(SHEETS.view);
  sh = ss.insertSheet(SHEETS.day, view ? view.getIndex() : 0);
  setupDay_(sh);
  return sh;
}

function setupDay_(sh) {
  sh.getRange(1, 1).setValue('練習日').setFontWeight('bold');
  // プルダウンの「2026/10/25 (日)」を日付に変えずに文字のまま持つ
  sh.getRange(1, 2).setNumberFormat('@').setBackground('#fff8e1').setFontWeight('bold')
    .setNote('練習日を選ぶと、その日の出席者・成績・対戦表と点数が出ます。新しい練習の点数が入ると、その日に切り替わります。');
  [130, 120, 45, 45, 130, 70, 45, 55].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setFrozenRows(1);
}

// matches は readMatches_() の結果。picked は B1 を人が選んだとき（記録の無い日でもその日のままにする）
function renderDay_(matches, picked, force) {
  const sh = daySheet_(), cell = sh.getRange(1, 2);
  const days = CORE.practiceDays(matches), labels = days.slice(0, DAY_LIST_MAX).map(CORE.dayLabel);
  const rule = cell.getDataValidation(), criteria = rule ? rule.getCriteriaValues()[0] : null;
  const before = Array.isArray(criteria) ? criteria : [];
  if (before.join('\n') !== labels.join('\n')) {
    cell.setDataValidation(labels.length ? SpreadsheetApp.newDataValidation().requireValueInList(labels, true)
      .setAllowInvalid(true).setHelpText('一覧から練習日を選んでください。').build() : null);
  }
  // 選んでいる日の記録が無い（初めて・消えた）か、新しい練習日が増えたら、いちばん新しい日にする
  const typed = ymd_(cell.getValue()), grew = labels.length && before.length && before.indexOf(labels[0]) < 0;
  const date = picked ? typed : days.indexOf(typed) < 0 || grew ? days[0] || '' : typed;
  if (date && String(cell.getValue()) !== CORE.dayLabel(date)) cell.setValue(CORE.dayLabel(date));
  if (!picked && !date && cell.getValue() !== '') cell.setValue('');

  writeDayBody_(sh, date, dayBody_(matches, date, days.length > 0), DAY_KEY + ':' + sh.getSheetId(), force);
}

// 日付ごとにタブを残す。管理印で探すため、手作りの同名タブを上書きせず、改名したタブも再利用する。
function renderDayTabs_(matches, forceSheetId) {
  const ss = book_(), tabs = Object.create(null), grouped = Object.create(null);
  ss.createDeveloperMetadataFinder().withKey(DAY_TAB_META).find().forEach(meta => {
    const date = meta.getValue(), sh = meta.getLocation().getSheet();
    if (sh && CORE.dayNumber(date) !== null) (tabs[date] = tabs[date] || []).push(sh);
  });
  matches.forEach(m => { (grouped[m.date] = grouped[m.date] || []).push(m); });
  CORE.practiceDays(matches).forEach(date => {
    if (tabs[date]) return;
    const base = '点数メモ ' + date;
    let name = base, n = 2;
    while (ss.getSheetByName(name)) name = base + ' (' + n++ + ')';
    const sh = ss.insertSheet(name);
    // 印は初期設定の前に付ける。設定が途中で失敗しても同じタブで再試行できる。
    sh.addDeveloperMetadata(DAY_TAB_META, date);
    tabs[date] = [sh];
  });
  Object.keys(tabs).sort().reverse().forEach(date => {
    const body = dayBody_(grouped[date] || [], date, true, true);
    tabs[date].forEach(sh => {
      writeDayBody_(sh, date, body, DAY_KEY + ':' + sh.getSheetId(), forceSheetId === sh.getSheetId(), () => {
        setupDay_(sh);
        sh.getRange(1, 2).setValue(CORE.dayLabel(date)).setDataValidation(null)
          .setNote('この練習日の点数メモです。訂正はアプリ、または「試合」タブで行うと自動で反映されます。');
        if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setWarningOnly(true);
      });
    });
  });
}

function dayBody_(matches, date, hasDays, fixedDate) {
  const out = [], styles = [];
  const line = (style, cells) => {
    const v = cells.map(x => (typeof x === 'string' ? CORE.cellText(x) : x));
    while (v.length < DAY_COLS) v.push('');
    out.push(v); styles.push(style);
  };
  const report = date ? CORE.dayReport(matches, date) : null;
  const r = report && report.games ? report : null;
  if (!r) {
    line('note', [fixedDate ? 'この日の記録はありません。点数を記録するとここに表示されます。'
      : !hasDays ? 'まだ記録がありません（アプリで点数を入れた練習日がここに出ます）。'
      : date ? 'この日の記録はありません（点数を入れた練習日は B1 の一覧から選べます）。' : 'B1 の一覧から練習日を選んでください。']);
  } else {
    line('summary', ['出席 ' + r.people.length + '人' + (r.unnamed ? '＋名前のないペア ' + r.unnamed + '組' : '') + '・試合 ' + r.games +
      '（点数あり ' + r.scored + '）' + (r.tables > 1 ? '・対戦表 ' + r.tables + 'つ' : '')]);
    line('note', ['点数が1試合でも入った対戦表だけを出します。点数が入った最後の節より後は、やらなかった節として出しません。']);
    const block = (title, head, items) => {
      line('', []);
      line('section', [title]);
      line('head', head);
      items.forEach(x => line('', x));
    };
    const stat = x => [x.label, x.rounds, x.games, x.wins, x.losses, x.pf, x.pa, x.diff];
    block('■ 出席者と成績（' + r.people.length + '人）', ['名前', '出た節', '試合', '勝', '敗', '得点', '失点', '得失点'], r.people.map(stat));
    block('■ ペアごとの成績（' + r.pairs.length + '組）', ['ペア', '出た節', '試合', '勝', '敗', '得点', '失点', '得失点'], r.pairs.map(stat));
    block('■ 対戦表と点数（' + r.games + '試合）', ['節・コート', 'ペア', '点', '点', 'ペア', 'メモ'], r.list.map(m => [
      (r.tables > 1 ? '表' + m.table + '・' : '') + '第' + m.round + '節 ' + m.court, m.a,
      m.scoreA === null ? '' : m.scoreA, m.scoreB === null ? '' : m.scoreB, m.b, m.note,
    ]));
  }

  return { out, styles };
}

// 日付・シートIDも含めて比較し、変化した日だけ書く。削除・再作成したタブは必ず書き直す。
function writeDayBody_(sh, date, body, cacheKey, force, prepare) {
  const { out, styles } = body;
  const sig = digest_(JSON.stringify([2, CORE.dayLabel(date), out]));
  const cache = CacheService.getScriptCache();
  try { if (!force && cache.get(cacheKey) === sig) return false; } catch (e) { /* 読めなければ書く */ }
  const old = sh.getLastRow();
  if (old >= 2) {
    const range = sh.getRange(2, 1, old - 1, Math.max(DAY_COLS, sh.getLastColumn()));
    range.clearContent(); range.clearFormat();
  }
  if (out.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), out.length + 1 - sh.getMaxRows() + 100);
  const range = sh.getRange(2, 1, out.length, DAY_COLS);
  const fill = fn => styles.map(s => Array(DAY_COLS).fill(fn(s)));
  range.setValues(out);
  range.setFontWeights(fill(s => (s === 'note' || s === '' ? 'normal' : 'bold')));
  range.setBackgrounds(fill(s => (s === 'section' ? '#d7ecf9' : s === 'head' ? '#e6f4ea' : null)));
  range.setFontColors(fill(s => (s === 'note' ? '#666666' : null)));
  if (prepare) prepare();
  try { cache.put(cacheKey, sig, 600); } catch (e) { /* 次も書くだけ */ }
  return true;
}

// ---------- 成績の計算の後回し（2026-10-25） ----------
// 保存のたびに全試合を読んで成績を計算し直すと、その間ほかの人の保存が順番待ちになる
// （1件約4秒・8人が同時に保存すると最後の人は35秒。check_score_concurrent.js で実測）。
// 前の計算から STATS_QUIET_MS 以内の保存は「計算待ち」の印だけ付け、あとでまとめて1回計算する。
// 計算待ちを片付けるのは、次の保存（間が空いていれば）・点数の取得（30秒ごと。ロックが空いているときだけ）・
// スプシを開いたとき・管理用の確認（view・dump）の前。1人だけの保存は、今までどおりその場で計算する。
// 印は CacheService に置く（PropertiesService などを使うと権限の追加が要り、公開中の窓口が止まるため）
const STATS_QUIET_MS = 20000;
const STATS_KEY = 'stats';

function statsState_() {
  try {
    const v = JSON.parse(CacheService.getScriptCache().get(STATS_KEY) || 'null');
    if (v && typeof v.at === 'number') return v;
  } catch (e) { /* 読めなければ「前の計算は無い」扱い＝次の保存で計算する */ }
  return { at: 0, pending: false };
}

function setStatsState_(s) {
  try { CacheService.getScriptCache().put(STATS_KEY, JSON.stringify(s), 21600); } catch (e) { /* 使えなければ毎回計算するだけ */ }
}

// 点数を書いたあと（ロックの中）。計算したら true
function statsAfterWrite_() {
  const s = statsState_();
  if (Date.now() - s.at < STATS_QUIET_MS) {
    if (!s.pending) setStatsState_({ ...s, pending: true });
    return false;
  }
  recomputeStats_();
  return true;
}

// 計算待ちがあれば計算する（ロックの中）。now が真なら間が空いていなくても計算する
function flushStats_(now) {
  const s = statsState_();
  if (s.pending && (now || Date.now() - s.at >= STATS_QUIET_MS)) recomputeStats_();
}

// 点数の取得のついで。保存の順番待ちに割り込まないよう、ロックが空いているときだけ
function flushStatsIfIdle_() {
  const s = statsState_();
  if (!s.pending || Date.now() - s.at < STATS_QUIET_MS) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try { flushStats_(false); } catch (e) {
    console.error(e && e.stack ? e.stack : e); // 計算に失敗しても点数の取得は続ける
  } finally {
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
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
// rows を渡すと、試合シートを読み直さずにそれを使う（点数を書いた直後。この表の行すべて）
function snapshot_(sid, fresh, rows) {
  const cache = CacheService.getScriptCache();
  const hit = fresh ? null : cache.get('s:' + sid);
  if (hit) return JSON.parse(hit);
  const tables = sheet_(SHEETS.tables), row = findRow_(tables, 1, sid);
  let snap = { version: 0, date: '', data: '', matches: [] };
  if (row) {
    const v = tables.getRange(row, 1, 1, TABLE_HEADERS.length).getValues()[0];
    snap = {
      version: Number(v[4]) || 0, date: ymd_(v[1]), data: String(v[6]),
      matches: (rows || sidMatches_(sheet_(SHEETS.matches), sid))
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
  // アプリの保存で後回しにした成績の計算を、開いた人が見る前に片付ける
  try {
    const state = statsState_();
    if (state.dayTabsVersion !== 1) withLock_(() => recomputeStats_(), LOCK_WAIT_SHEET_MS);
    else if (state.pending) withLock_(() => flushStats_(true), LOCK_WAIT_SHEET_MS);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
}

// メニューや手での編集からの再計算も、アプリからの書き込みと同じロックの中で行う
// （ロックの外だと、点数の保存と前後したときに古い内容で成績を上書きすることがある）
function menuRecompute() { withLock_(() => recomputeStats_(), LOCK_WAIT_SHEET_MS); }
function menuSetup() { withLock_(() => setup_({}), LOCK_WAIT_SHEET_MS); }

// 大会・ペア・試合を手で直したら成績を計算し直す（シンプルトリガー）
function onEdit(e) {
  const name = e && e.range ? e.range.getSheet().getName() : '';
  // 練習日シートの B1（練習日）を選び直したら、その日の中身にする
  if (name === SHEETS.day) {
    const r = e.range;
    const picked = r.getRow() === 1 && r.getColumn() <= 2 && r.getColumn() + r.getNumColumns() - 1 >= 2;
    try {
      withLock_(() => renderDay_(readMatches_(), picked, true), LOCK_WAIT_SHEET_MS);
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
    }
    return;
  }
  // 日別タブは表示専用。誤って直接書き換えても、元の試合から日付と点数を復元する。
  if (e && e.range && e.range.getSheet().getDeveloperMetadata().some(m => m.getKey() === DAY_TAB_META)) {
    try {
      withLock_(() => {
        const sh = e.range.getSheet();
        renderDayTabs_(readMatches_(), sh.getSheetId());
      }, LOCK_WAIT_SHEET_MS);
    } catch (err) { console.error(err && err.stack ? err.stack : err); }
    return;
  }
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
    }, LOCK_WAIT_SHEET_MS);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
  }
}
