/**
 * 大会練習の成績：計算だけを集めたファイル（SpreadsheetApp などのGoogleのサービスに触らない）。
 * GAS ではそのまま読み込まれ、Node では末尾の module.exports からテストする（test_gas_core.js）。
 *
 * 成績は「ペア＋日付」で決める。大会の練習期間内の試合なら、どの表・どのコート・どの端末で
 * 入力しても、その大会に登録したペアの成績に入る。登録していないペア（臨時ペア）は数えないが、
 * 大会ペアが臨時ペアと対戦した試合は大会ペア側の成績に入る（2026-10-24 ユーザー要望）。
 */
const CORE = (() => {
  const MAX_POINT = 30;
  const MAX_ROUNDS = 30;
  const COURTS = ['A', 'B', 'C', 'D'];
  const MAX_NAME = 20;
  const MAX_DATA = 45000; // セル1つは5万字まで
  const MAX_ROSTER = 100;
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/; // 先頭が - だと数式扱いになるので英数字から
  // 試合シートの「状態」と「表」の値。除外は幹事が手で付ける（成績に入れない）
  const STATE_EMPTY = '未入力';
  const STATE_DONE = '入力済み';
  const STATE_EXCLUDED = '除外';
  const TABLE_PREV = '作り直し前';

  const DAY = 86400000;
  const pad = n => (n < 10 ? '0' : '') + n;
  const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

  // 'YYYY-MM-DD' ⇔ 通し日数（UTCで数えるのでタイムゾーンの影響を受けない）
  function dayNumber(ymd) {
    if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(dt.getTime() / DAY);
  }
  function ymdOf(day) {
    const dt = new Date(day * DAY);
    return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  }

  // 練習期間：大会日の21日前以降で最初の日曜日 〜 大会の前日（2026-10-24 ユーザー指定「最大3週前の日曜日まで」）
  function practicePeriod(tournamentDate) {
    const n = dayNumber(tournamentDate);
    if (n === null) return null;
    let start = n - 21;
    start += (7 - new Date(start * DAY).getUTCDay()) % 7;
    return { start: ymdOf(start), end: ymdOf(n - 1) };
  }

  // 名前の比較用：全角半角・空白の違いと、はしごだか等の異体字を同じに扱う
  const VARIANTS = { '髙': '高', '﨑': '崎' };
  function canonicalName(s) {
    if (typeof s !== 'string') return '';
    return s.normalize('NFKC').replace(/\s+/g, '').replace(/[髙﨑]/g, c => VARIANTS[c]);
  }
  // 片側（ペア）の比較キー。並び順は問わない。名前のない番号だけのペアは1要素
  function sideKey(names) {
    if (!Array.isArray(names)) return '';
    return names.map(canonicalName).filter(Boolean).sort().join('・');
  }
  const sameSide = (x, y) => sideKey(x) !== '' && sideKey(x) === sideKey(y);
  // 成績を数えるペアのキー（2人とも名前があるときだけ）
  function pairKey(names) {
    if (!Array.isArray(names) || names.length !== 2) return '';
    const a = canonicalName(names[0]), b = canonicalName(names[1]);
    if (!a || !b || a === b) return '';
    return a < b ? a + '・' + b : b + '・' + a;
  }

  function toPoint(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\s*\d{1,3}\s*$/.test(v)) return Number(v);
    return NaN;
  }
  const blank = v => v === null || v === undefined || v === '';
  // 入力された点数の判定。両方空なら消去
  function parseScore(a, b) {
    if (blank(a) && blank(b)) return { clear: true };
    const x = toPoint(a), y = toPoint(b);
    if (!isInt(x, 0, MAX_POINT) || !isInt(y, 0, MAX_POINT)) return { error: '点数は0〜' + MAX_POINT + 'の整数で入れてください。' };
    if (x === y) return { error: '同点は保存できません。' };
    return { a: x, b: y };
  }
  // シートに入っている点数が成績に数えられる形か（幹事が手で直した値も同じ基準で見る）
  function validScore(a, b) {
    const r = parseScore(a, b);
    return !r.clear && !r.error;
  }

  // 長さは空白込みで見る（シートには送られたまま書くので、前後の空白で上限をすり抜けられないように）
  const validName = s => typeof s === 'string' && s.trim().length >= 1 && s.length <= MAX_NAME;
  const validSide = side => Array.isArray(side) && (side.length === 1 || side.length === 2) && side.every(validName);
  const isId = s => typeof s === 'string' && ID_RE.test(s);

  // 対戦表の登録内容の確認。問題があればメッセージ、なければ null
  function checkRegister(p) {
    if (!p || typeof p !== 'object') return '送信内容が正しくありません。';
    if (!isId(p.sid) || !isId(p.hostKey)) return '表IDが正しくありません。';
    if (dayNumber(p.date) === null) return '練習日が正しくありません。';
    if (typeof p.data !== 'string' || !p.data || p.data.length > MAX_DATA) return '対戦表のデータが正しくありません。';
    if (!Array.isArray(p.matches) || !p.matches.length || p.matches.length > MAX_ROUNDS * COURTS.length) return '試合の一覧が正しくありません。';
    const seen = {};
    for (const m of p.matches) {
      if (!m || !isInt(m.round, 1, MAX_ROUNDS) || COURTS.indexOf(m.court) < 0 || !validSide(m.a) || !validSide(m.b)) return '試合の一覧が正しくありません。';
      if (seen[m.round + m.court]) return '同じ節・コートの試合が2つあります。';
      seen[m.round + m.court] = true;
    }
    if (p.roster !== undefined && (!Array.isArray(p.roster) || p.roster.length > MAX_ROSTER || !p.roster.every(validName))) return '名簿が正しくありません。';
    return null;
  }
  function checkScore(p) {
    if (!p || typeof p !== 'object') return '送信内容が正しくありません。';
    if (!isId(p.sid)) return '表IDが正しくありません。';
    if (!isInt(p.round, 1, MAX_ROUNDS) || COURTS.indexOf(p.court) < 0 || !validSide(p.a) || !validSide(p.b)) return '試合の指定が正しくありません。';
    const r = parseScore(p.scoreA, p.scoreB);
    return r.error || null;
  }

  /**
   * 同じ表の再登録（途中のメンバー変更で残りの節を作り直したとき）に、既存の行をどうするか決める。
   * existing: [{row, round, court, a, b, table}]（table が TABLE_PREV の行は対象外）
   * incoming: [{round, court, a, b}]
   * 同じ節・コートで同じ対戦なら残す（点数もそのまま）。左右だけ入れ替わったら swap。
   * 変わった・なくなった行は retire（作り直し前にする。点数が入っていれば実際に試合した結果なので成績には残る）。
   */
  function planRegister(existing, incoming) {
    const current = {};
    existing.forEach(e => { if (e.table !== TABLE_PREV) current[e.round + e.court] = e; });
    const keep = [], swap = [], retire = [], add = [];
    incoming.forEach(m => {
      const pos = m.round + m.court, e = current[pos];
      delete current[pos];
      if (e && sameSide(e.a, m.a) && sameSide(e.b, m.b)) keep.push(e.row);
      else if (e && sameSide(e.a, m.b) && sameSide(e.b, m.a)) swap.push(e.row);
      else { if (e) retire.push(e.row); add.push(m); }
    });
    Object.keys(current).forEach(k => retire.push(current[k].row));
    return { keep, swap, retire, add };
  }

  /**
   * 大会シートの行から練習期間を決める。練習開始・終了が空なら自動（practicePeriod）。
   * rows: [{name, date, start, end}]（日付は 'YYYY-MM-DD' か ''）。同じ大会名は先の行を使う
   */
  function resolveTournaments(rows) {
    const out = [], seen = {};
    rows.forEach(r => {
      const name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!name || seen[name] || dayNumber(r.date) === null) return;
      seen[name] = true;
      const auto = practicePeriod(r.date);
      out.push({
        name, date: r.date,
        start: dayNumber(r.start) !== null ? r.start : auto.start,
        end: dayNumber(r.end) !== null ? r.end : auto.end,
      });
    });
    return out;
  }
  const inPeriod = (date, t) => date >= t.start && date <= t.end; // 'YYYY-MM-DD' は文字列比較で日付順になる

  /**
   * ペアごとの成績。
   * tournaments: resolveTournaments の結果 / pairs: [{tournament, category, names:[p1,p2]}]
   * matches: [{date, a, b, scoreA, scoreB, excluded}]
   */
  function computeStats(tournaments, pairs, matches) {
    const results = {};
    matches.forEach(m => {
      if (m.excluded || !validScore(m.scoreA, m.scoreB)) return;
      const a = toPoint(m.scoreA), b = toPoint(m.scoreB);
      [[m.a, a, b], [m.b, b, a]].forEach(([side, pf, pa]) => {
        const k = pairKey(side);
        if (!k) return;
        (results[k] = results[k] || []).push({ date: m.date, pf, pa });
      });
    });
    const byName = {};
    tournaments.forEach(t => { if (!byName[t.name]) byName[t.name] = t; });
    const rows = [], seen = {};
    pairs.forEach(p => {
      const t = byName[typeof p.tournament === 'string' ? p.tournament.trim() : ''];
      const k = pairKey(p.names);
      if (!t || !k || seen[t.name + '\n' + k]) return;
      seen[t.name + '\n' + k] = true;
      const games = (results[k] || []).filter(r => inPeriod(r.date, t));
      const wins = games.filter(r => r.pf > r.pa).length;
      const pf = games.reduce((s, r) => s + r.pf, 0), pa = games.reduce((s, r) => s + r.pa, 0);
      const days = {};
      games.forEach(r => { days[r.date] = true; });
      rows.push({
        tournament: t.name, category: p.category ? String(p.category).trim() : '',
        label: p.names.map(n => String(n).trim()).join('・'),
        games: games.length, wins, losses: games.length - wins,
        rate: games.length ? wins / games.length : null,
        pf, pa, diff: pf - pa, days: Object.keys(days).length,
      });
    });
    return rows;
  }

  // その日が練習期間に入っている大会と、その大会ペア（アプリが出席者から大会ペアを自動で組むのに使う）
  function activeTournaments(tournaments, pairs, date) {
    return tournaments.filter(t => inPeriod(date, t)).map(t => ({
      name: t.name, date: t.date, start: t.start, end: t.end,
      pairs: pairs.filter(p => (typeof p.tournament === 'string' ? p.tournament.trim() : '') === t.name && pairKey(p.names))
        .map(p => ({ category: p.category ? String(p.category).trim() : '', names: p.names.map(n => String(n).trim()) })),
    }));
  }

  // 成績シートで最初に見せる大会：練習期間中の大会 → これからの大会 → 最後の大会
  function defaultTournament(tournaments, today) {
    if (!tournaments.length) return '';
    const sorted = tournaments.slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    const now = sorted.find(t => inPeriod(today, t)) || sorted.find(t => t.date >= today) || sorted[sorted.length - 1];
    return now.name;
  }

  // 名簿の追加（消さない。辞めた人がプルダウンに残るだけで害はない）
  function mergeRoster(existing, incoming) {
    const out = existing.filter(validName).map(s => s.trim()), seen = {};
    out.forEach(s => { seen[canonicalName(s)] = true; });
    (incoming || []).forEach(s => {
      if (!validName(s) || seen[canonicalName(s)] || out.length >= MAX_ROSTER * 2) return;
      seen[canonicalName(s)] = true;
      out.push(s.trim());
    });
    return out;
  }

  // シートに書く文字列：先頭が = + - @ だと数式として解釈されるので ' を付けて文字にする
  const cellText = s => (/^[=+\-@']/.test(String(s)) ? "'" : '') + String(s);

  return {
    MAX_POINT, MAX_ROUNDS, COURTS, STATE_EMPTY, STATE_DONE, STATE_EXCLUDED, TABLE_PREV,
    dayNumber, ymdOf, practicePeriod, canonicalName, sideKey, sameSide, pairKey,
    parseScore, validScore, isId, checkRegister, checkScore, planRegister,
    resolveTournaments, computeStats, activeTournaments, defaultTournament, mergeRoster, cellText,
  };
})();

if (typeof module !== 'undefined') module.exports = CORE;
