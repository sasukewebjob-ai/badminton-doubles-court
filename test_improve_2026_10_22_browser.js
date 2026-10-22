// 2026-10-22 の改善をブラウザで確かめる（エージェントチームの検討から、ユーザーが選んだもの）
//  A/B 練習日が前回の日付のまま作られる不具合（ダブルス版・シングルス版）＋シングルス版の読み上げ速度
//  C/D 「消化済み」の初期値をなくす・作り直す範囲をボタンに出す・完了alertを案内に置き換える・
//      「来た・帰る」でメンバー変更欄へ・離脱/復帰のチップを名簿の並びに
//  E/F 結果のいちばん上の「画像で送る」（プレビューは押したボタンの近く・閉じる・Slackなどに送る）
//  G   種目別コートの日に「番号 名前」の途中で改行しない
// 使い方: node test_improve_2026_10_22_browser.js
// 本番:   AUDIT_BASE_URL=https://sasukewebjob-ai.github.io/badminton-doubles-court/ node test_improve_2026_10_22_browser.js
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');

const baseUrl = process.env.AUDIT_BASE_URL;
const out = path.join(__dirname, 'work', 'improve-2026-10-22');
fs.mkdirSync(out, { recursive: true });
const url = file => baseUrl
  ? new URL(file + '?v=' + Date.now(), baseUrl).href
  : pathToFileURL(path.join(__dirname, file)).href;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIXED_NOW = '2026-10-22T03:00:00Z'; // 日本時間 2026-10-22（木）12:00
const VIEW = { width: 375, height: 667 };

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail !== undefined ? ' → ' + detail : '')); }
}

async function newPage(browser, { fixedDate = false, ua, initScript } = {}) {
  const context = await browser.newContext({ viewport: VIEW, timezoneId: 'Asia/Tokyo', ...(ua ? { userAgent: ua } : {}) });
  if (fixedDate) {
    await context.addInitScript(now => {
      const OriginalDate = Date;
      window.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return new OriginalDate(now).getTime(); }
      };
    }, FIXED_NOW);
  }
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const dialogs = [], errors = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, dialogs, errors };
}

async function fresh(page, file = 'index.html') {
  await page.goto(url(file));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

// 名簿の先頭からn人（名簿チップは ROSTER の並び）
async function pickFirst(page, n) {
  for (let i = 0; i < n; i++) await page.locator('#rosterChips .chip').nth(i).click();
}
// 名簿の並びで男m人・女f人（test_gender.js と同じ選び方）
async function pickByGender(page, males, females) {
  const idx = await page.evaluate(([m, f]) => {
    const mi = [], fi = [];
    ROSTER.forEach((n, i) => (GENDER[n] === 'M' ? mi : fi).push(i));
    return mi.length < m || fi.length < f ? null : [...mi.slice(0, m), ...fi.slice(0, f)];
  }, [males, females]);
  if (!idx) throw new Error(`名簿に男${males}人・女${females}人が足りません`);
  for (const i of idx) await page.locator('#rosterChips .chip').nth(i).click();
}
// smooth スクロールが止まるまで待つ
const settle = page => page.evaluate(() => new Promise(resolve => {
  let last = null, still = 0;
  const timer = setInterval(() => {
    if (window.scrollY === last) { if (++still >= 5) { clearInterval(timer); resolve(); } }
    else { still = 0; last = window.scrollY; }
  }, 60);
  setTimeout(() => { clearInterval(timer); resolve(); }, 3000);
}));
const topOf = (page, sel) => page.locator(sel).first().evaluate(el => Math.round(el.getBoundingClientRect().top));
const imageReady = page => page.waitForFunction(() => {
  const img = document.querySelector('#imagePreview img');
  return img && img.complete && img.naturalWidth > 0;
}, null, { timeout: 20000 });
const allOf = (page, sel, fn) => page.locator(sel).evaluateAll(fn);
// 名簿モードのチップ「12 北原」から名前だけを取り出す
const chipNames = (page, sel) => allOf(page, sel, bs => bs.map(b => b.textContent.replace(/^\d+\s/, '')));

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    // ---------- 0. 本番の配信内容 ----------
    if (baseUrl) {
      console.log('[0] 本番で配信されているHTMLがローカルと同じ');
      const page = await (await browser.newContext()).newPage();
      for (const file of ['index.html', 'singles.html']) {
        const res = await page.goto(url(file));
        const served = (await res.text()).replace(/\r\n/g, '\n');
        const local = fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\r\n/g, '\n');
        check(`0: ${file} が最新版`, res.status() === 200 && served === local, `status=${res.status()}`);
      }
    }

    // ---------- A. 練習日（ダブルス版） ----------
    console.log('[A] ダブルス版: 前回の練習日が新しい表に入らない');
    {
      const { context, page, errors } = await newPage(browser, { fixedDate: true });
      await fresh(page);
      check('A: 開いた直後の練習日は今日', await page.inputValue('#practiceDate') === '2026-10-22');
      await pickFirst(page, 18);
      await page.click('#generateBtn');
      // 前回の練習（10/15）の表が端末に残っている状態にする
      await page.evaluate(() => { session.practiceDate = '2026-10-15'; saveSession(); });
      await page.reload();
      check('A: 復元した表は前回の日付で表示（入力欄も前回の日付）',
        await page.inputValue('#practiceDate') === '2026-10-15'
        && (await page.locator('.round-date').first().textContent()) === '2026年10月15日（木）');
      await page.click('#generateBtn');
      check('A: 入力欄を触らずに作り直すと今日の日付になる',
        await page.evaluate(() => session.practiceDate) === '2026-10-22'
        && await page.inputValue('#practiceDate') === '2026-10-22'
        && (await page.locator('.round-date').first().textContent()) === '2026年10月22日（木）');
      await page.fill('#practiceDate', '2026-10-20');
      await page.dispatchEvent('#practiceDate', 'change');
      await page.click('#generateBtn');
      check('A: 手で選んだ過去の日付はそのまま使う', await page.evaluate(() => session.practiceDate) === '2026-10-20');
      await page.evaluate(() => { session.practiceDate = '2026-10-25'; saveSession(); });
      await page.reload();
      await page.click('#generateBtn');
      check('A: 前もって入れた先の日付はそのまま使う', await page.evaluate(() => session.practiceDate) === '2026-10-25');
      await page.evaluate(() => { session.practiceDate = '2026-10-15'; saveSession(); });
      await page.reload();
      await page.getByRole('button', { name: '消去して最初から' }).click();
      check('A: 「消去して最初から」で練習日が今日に戻る', await page.inputValue('#practiceDate') === '2026-10-22');
      await page.click('#generateBtn');
      check('A: 消去してから作った表も今日の日付', await page.evaluate(() => session.practiceDate) === '2026-10-22');
      await page.evaluate(() => { delete session.practiceDate; saveSession(); });
      await page.reload();
      check('A: 日付のない古い保存データは従来どおり空欄で復元',
        await page.inputValue('#practiceDate') === '' && await page.locator('.round-date').count() === 0);
      check('A: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }

    // ---------- B. 練習日と読み上げ（シングルス版） ----------
    console.log('[B] シングルス版: 練習日の持ち越しと読み上げ速度');
    {
      const { context, page, errors } = await newPage(browser, {
        fixedDate: true,
        initScript: () => {
          window.__spoken = [];
          const fake = { speak: u => window.__spoken.push({ rate: u.rate, volume: u.volume }), cancel: () => {}, speaking: false, pending: false, getVoices: () => [] };
          Object.defineProperty(window, 'speechSynthesis', { value: fake, configurable: true });
        },
      });
      await fresh(page, 'singles.html');
      check('B: 開いた直後の練習日は今日', await page.inputValue('#practiceDate') === '2026-10-22');
      await page.click('#generateBtn');
      await page.evaluate(() => { session.practiceDate = '2026-10-15'; persist(); });
      await page.reload();
      check('B: 復元した表の入力欄は前回の日付', await page.inputValue('#practiceDate') === '2026-10-15');
      await page.click('#generateBtn');
      check('B: 入力欄を触らずに作り直すと今日の日付になる',
        await page.evaluate(() => session.practiceDate) === '2026-10-22' && await page.inputValue('#practiceDate') === '2026-10-22');
      await page.fill('#practiceDate', '2026-10-20');
      await page.dispatchEvent('#practiceDate', 'change');
      await page.click('#generateBtn');
      check('B: 手で選んだ過去の日付はそのまま使う', await page.evaluate(() => session.practiceDate) === '2026-10-20');
      await page.getByRole('button', { name: '消去して最初から' }).click();
      check('B: 「消去して最初から」で練習日が今日に戻る', await page.inputValue('#practiceDate') === '2026-10-22');
      await page.click('#generateBtn');
      await page.getByRole('button', { name: '🔊 読み上げ' }).first().click();
      const spoken = await page.evaluate(() => window.__spoken);
      check('B: 読み上げ速度・音量はダブルス版と同じ（0.89・1.0）',
        spoken.length === 1 && Math.abs(spoken[0].rate - 0.89) < 1e-6 && spoken[0].volume === 1, JSON.stringify(spoken));
      check('B: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }

    // ---------- C. 消化済み・来た帰る・作り直し後の案内 ----------
    console.log('[C] ダブルス版: 消化済みの初期値・来た帰る・作り直し後の案内');
    {
      const { context, page, dialogs, errors } = await newPage(browser);
      await fresh(page);
      await pickFirst(page, 18);
      await page.click('#generateBtn');
      check('C: 消化済みは最初「選んでください」', await page.inputValue('#consumedRound') === '');
      check('C: 選ぶまで作り直すボタンは押せない',
        await page.locator('#changeApplyBtn').isDisabled() && (await page.textContent('#changeApplyBtn')).includes('選んでください'));
      const before = await page.evaluate(() => JSON.stringify(session.rounds));
      dialogs.length = 0;
      await page.evaluate(() => applyMemberChange());
      check('C: 選ばずに作り直しを呼んでも表は変わらず、選ぶよう案内する',
        await page.evaluate(() => JSON.stringify(session.rounds)) === before && dialogs.some(m => m.includes('選んでください')), dialogs.join(' / '));
      const removeNames = await chipNames(page, '#removeChips .chip');
      const expected = await page.evaluate(names => ROSTER.filter(n => names.includes(n)), removeNames);
      check('C: 帰る人のチップは名簿の並び', removeNames.length === 18 && JSON.stringify(removeNames) === JSON.stringify(expected), removeNames.join(','));
      await page.selectOption('#consumedRound', '4');
      check('C: 選ぶとボタンに作り直す範囲が出る',
        !(await page.locator('#changeApplyBtn').isDisabled())
        && (await page.textContent('#changeApplyBtn')) === '第5〜10節を作り直す（第4節まではそのまま）',
        await page.textContent('#changeApplyBtn'));
      await page.locator('#removeChips .chip').first().click();
      await page.locator('#changeSection').screenshot({ path: path.join(out, 'change-section.png') });
      const kept = await page.evaluate(() => JSON.stringify(session.rounds.slice(0, 4)));
      dialogs.length = 0;
      await page.click('.btn-change');
      await settle(page);
      check('C: 作り直しても完了のポップアップは出ない', dialogs.length === 0, dialogs.join(' / '));
      check('C: 第1〜4節はそのまま', await page.evaluate(() => JSON.stringify(session.rounds.slice(0, 4))) === kept);
      const notice = await page.locator('.change-notice').textContent();
      check('C: 結果の上に「第5節から組み直しました。画像を送り直してください」',
        notice.includes('第5節から組み直しました') && notice.includes('画像を送り直してください'), notice);
      const nTop = await topOf(page, '.change-notice');
      check('C: 作り直した直後、案内が画面内に見えている', nTop >= 0 && nTop < VIEW.height, nTop);
      await page.screenshot({ path: path.join(out, 'after-change.png') });
      await page.click('.change-notice button');
      await settle(page);
      const dTop = await topOf(page, '#change-at-5');
      check('C: 「第5節へ」で作り直した最初の節（変更の帯）へ移動', dTop >= -2 && dTop < 120, dTop);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('.btn-top-change');
      await settle(page);
      const cTop = await topOf(page, '#changeSection');
      check('C: 「来た・帰る」でメンバー変更欄へ移動', cTop >= -2 && cTop < 120, cTop);
      check('C: 2回目の変更でも消化済みは「選んでください」から', await page.inputValue('#consumedRound') === '');
      // 17人から2人帰ると15人で4コートに足りないので、3コートにして作り直す
      await page.selectOption('#consumedRound', '6');
      await page.locator('#removeChips .chip').nth(0).click();
      await page.locator('#removeChips .chip').nth(5).click();
      await page.selectOption('#changeCourtCount', '3');
      dialogs.length = 0;
      await page.click('.btn-change');
      await settle(page);
      check('C: 2回目の変更もポップアップなしで反映', dialogs.length === 0 && await page.evaluate(() => session.changes.length) === 2, dialogs.join(' / '));
      const returnNames = await chipNames(page, '#returnChips .chip');
      const expectedReturn = await page.evaluate(names => ROSTER.filter(n => names.includes(n)), returnNames);
      check('C: 戻る人のチップも名簿の並び',
        returnNames.length === 3 && JSON.stringify(returnNames) === JSON.stringify(expectedReturn), returnNames.join(','));
      check('C: 2回目の変更の案内は第7節から', (await page.locator('.change-notice').textContent()).includes('第7節から組み直しました'));
      await page.reload();
      check('C: 再読み込みすると案内は出ない（保存しない）', await page.locator('.change-notice').count() === 0);
      await page.click('#generateBtn');
      check('C: 新しく作り直しても案内は出ない', await page.locator('.change-notice').count() === 0);
      check('C: 横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check('C: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }

    // ---------- D. 番号のみモードのチップ ----------
    console.log('[D] 番号のみモード: チップは従来どおり番号順');
    {
      const { context, page, errors } = await newPage(browser);
      await fresh(page);
      await page.selectOption('#playerCount', '18');
      await page.click('#generateBtn');
      const nums = await allOf(page, '#removeChips .chip', bs => bs.map(b => Number(b.dataset.num)));
      check('D: 帰る人のチップは番号順', JSON.stringify(nums) === JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)), nums.join(','));
      check('D: 上のボタンは番号のみモードでも出る', await page.locator('.top-actions .btn-top').count() === 2);
      check('D: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }

    // ---------- E. 画像で送る（結果のいちばん上） ----------
    console.log('[E] 結果のいちばん上の「画像で送る」');
    {
      const { context, page, dialogs, errors } = await newPage(browser);
      await fresh(page);
      await pickFirst(page, 18);
      await page.click('#generateBtn');
      await settle(page);
      check('E: 「画像で送る」「来た・帰る」が並ぶ',
        await page.locator('.top-actions .btn-top-image').count() === 1 && await page.locator('.top-actions .btn-top-change').count() === 1);
      check('E: ボタンは番号表より上', await page.evaluate(() => {
        const a = document.querySelector('#results .top-actions'), m = document.querySelector('#results .roster-map');
        return !!(a.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING);
      }));
      const tTop = await topOf(page, '.top-actions');
      check('E: 作成直後の画面の中にボタンが見える', tTop >= 0 && tTop + 50 < VIEW.height, tTop);
      check('E: 下の保存ボタンも従来どおり（.btn-save 1個）', await page.locator('.btn-save').count() === 1);
      await page.screenshot({ path: path.join(out, 'top-actions.png') });
      dialogs.length = 0;
      await page.click('.btn-top-image');
      await imageReady(page);
      check('E: 上のボタンのプレビューは上の枠に出る',
        await page.evaluate(() => document.getElementById('imagePreview').parentElement.id) === 'imagePreviewTopSlot');
      const pTop = await topOf(page, '#imagePreview'), cardTop = await topOf(page, '.round-card');
      check('E: プレビューは節カードより上', pTop < cardTop, `${pTop} / ${cardTop}`);
      await page.screenshot({ path: path.join(out, 'top-preview.png') });
      await page.click('.btn-preview-close');
      check('E: 「プレビューを閉じる」で消える', await page.locator('#imagePreview > *').count() === 0);
      await page.click('.btn-save');
      await imageReady(page);
      check('E: 下の保存ボタンのプレビューは下の枠に出る',
        await page.evaluate(() => document.getElementById('imagePreview').parentElement.id) === 'imagePreviewBottomSlot');
      check('E: 画像の作成でアラートは出ない', dialogs.length === 0, dialogs.join(' / '));
      await page.selectOption('#roundCount', '15');
      await page.click('#generateBtn');
      const labels = await allOf(page, '.btn-top-image', bs => bs.map(b => b.textContent));
      check('E: 15節は「画像で送る」が2つ（範囲つき）',
        labels.length === 2 && labels[0].includes('1枚目・第1〜10節') && labels[1].includes('2枚目・第11〜15節'), labels.join(' | '));
      check('E: 15節の下の保存ボタンも従来どおり2つ', await page.locator('.btn-save').count() === 2);
      await page.locator('.btn-top-image').nth(1).click();
      await imageReady(page);
      check('E: 2枚目のプレビューに範囲の見出し', (await page.textContent('#imagePreview')).includes('2枚目（第11〜15節）'));
      await page.emulateMedia({ media: 'print' });
      check('E: 印刷ではボタンを隠す', await page.locator('.top-actions').evaluate(el => getComputedStyle(el).display) === 'none');
      await page.emulateMedia({ media: 'screen' });
      check('E: 横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const hash = await page.evaluate(() => '#s=' + encodeShareData());
      const viewer = await context.newPage();
      await viewer.goto(url('index.html') + hash);
      check('E: 共有リンクの閲覧画面には出さない',
        await viewer.locator('.top-actions').count() === 0 && await viewer.locator('.round-card').count() === 15);
      check('E: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }

    // ---------- F. iPhone: 共有シートでSlackなどへ ----------
    console.log('[F] iPhone: プレビューから共有シートへ');
    {
      const { context, page, dialogs, errors } = await newPage(browser, {
        ua: IPHONE_UA,
        initScript: () => {
          window.__shared = [];
          navigator.canShare = () => true;
          navigator.share = async data => { window.__shared.push(data.files.map(f => `${f.name}:${f.type}:${f.size}`)); };
        },
      });
      await fresh(page);
      await pickFirst(page, 18);
      await page.click('#generateBtn');
      dialogs.length = 0;
      await page.click('.btn-top-image');
      await page.waitForSelector('#imagePreview .btn-photo', { timeout: 20000 });
      check('F: 共有ボタンは「Slackなどに送る / 写真に保存」',
        (await page.textContent('#imagePreview .btn-photo')) === '📤 Slackなどに送る / 写真に保存');
      check('F: 案内に「Slackなどへそのまま送れます」', (await page.textContent('#imagePreview .preview-guide')).includes('Slackなどへそのまま送れます'));
      await page.click('#imagePreview .btn-photo');
      await page.waitForFunction(() => window.__shared.length > 0);
      const shared = await page.evaluate(() => window.__shared);
      check('F: 共有シートにPNGが1枚渡る',
        shared.length === 1 && shared[0].length === 1 && /\.png:image\/png:\d+$/.test(shared[0][0]), JSON.stringify(shared));
      check('F: アラートは出ない', dialogs.length === 0, dialogs.join(' / '));
      check('F: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }

    // ---------- G. 名前の途中で改行しない ----------
    console.log('[G] 種目別コートの日に「番号 名前」の途中で改行しない');
    {
      const { context, page, errors } = await newPage(browser);
      await fresh(page);
      await pickByGender(page, 10, 8);
      await page.selectOption('#genderMode', 'on');
      await page.click('#generateBtn');
      const total = await page.locator('.round-card .pair').count();
      const broken = await allOf(page, '.round-card .pair', els => els.filter(e => e.getClientRects().length > 1).map(e => e.textContent));
      check('G: 種目別（男10女8）で途中改行0か所', total === 160 && broken.length === 0, `${total}件中 ${broken.join(',')}`);
      check('G: 横にはみ出さない', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.locator('.round-card').nth(1).screenshot({ path: path.join(out, 'gender-card.png') });
      await fresh(page);
      await pickFirst(page, 26);
      await page.click('#generateBtn');
      const broken26 = await allOf(page, '.round-card .pair', els => els.filter(e => e.getClientRects().length > 1).length);
      check('G: 26人（名簿）でも途中改行0か所・はみ出しなし',
        broken26 === 0 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), broken26);
      check('G: ページエラーなし', errors.length === 0, errors.join(' / '));
      await context.close();
    }
  } catch (e) {
    fail++;
    console.log('  NG  例外: ' + (e && e.stack || e));
  } finally {
    await browser.close();
  }
  console.log(`\n2026-10-22 改善の検証: ${pass}件合格 / ${fail}件失敗`);
  console.log(`画面写真: ${out}`);
  process.exitCode = fail === 0 ? 0 : 1;
})();
