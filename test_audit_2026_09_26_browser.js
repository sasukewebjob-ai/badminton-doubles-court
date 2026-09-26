// 2026-09-26の監査で直した画面まわりの回帰テスト（Playwright、375px幅）
// ダブルス版（index.html）
//   D3: 名簿モードで途中変更後に再読み込みすると、名簿チップだけ現在のメンバーに戻り「4コートなのに15人」になった
//   D4: 指定休みの人が離脱して * が1つも無いのに、画面に凡例だけ出た
//   D5: 読み上げ中に「消去して最初から」を押しても読み上げが止まらなかった
//   D6: 画像を作っている途中に作り直すと、作り直す前の表の画像がプレビューに出た
//   D8: 共有リンクの名前が「toString」などだと、読み上げにプログラムの文字列が入った
// シングルス版（singles.html）
//   S1: 「=」がすべて %3D に変わった共有リンク（接頭辞の #sp1= も含む）が開けなかった
//   S2: Array.prototype.at の無い端末（iOS 14.0〜15.3）で復元・共有が必ず失敗した
//   S3: 保存が使えない端末で「消去して最初から」が効かず、起動のたびに「復元できませんでした」と出た
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium, launchOptions } = require('./pw');
const indexUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const singlesUrl = pathToFileURL(path.join(__dirname, 'singles.html')).href;

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  OK  ' + label); }
  else { fail++; console.log('  NG  ' + label + (detail ? ' → ' + detail : '')); }
}
const TTS_STUB = () => {
  window.__tts = { spoken: [], cancels: 0 };
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(window, 'speechSynthesis', {
    value: { speak(u) { window.__tts.spoken.push(u.text); }, cancel() { window.__tts.cancels++; } },
    configurable: true,
  });
};

async function freshPage(browser, init) {
  const context = await browser.newContext({ viewport: { width: 375, height: 700 } });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  return { context, page, errors };
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    // ---------- D3 ----------
    console.log('[D3] 名簿モードで途中変更後に再読み込み');
    {
      const { page, errors } = await freshPage(browser);
      await page.goto(indexUrl);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      const roster = await page.evaluate(() => ROSTER.slice());
      await page.selectOption('#courtCount', '4');
      for (const nm of roster.slice(0, 17)) await page.click(`#rosterChips .chip[data-name="${nm}"]`);
      const target = roster[0];
      await page.click('#forcedAddBtn');
      await page.selectOption('.fr-round', '8');
      await page.selectOption('.fr-player', 'n:' + target);
      await page.click('#generateBtn');
      const leave = await page.evaluate(names => names.map(nm => Object.keys(session.names).find(k => session.names[k] === nm)), roster.slice(0, 3));
      await page.selectOption('#consumedRound', '3');
      for (const num of leave) await page.click(`#removeChips .chip[data-num="${num}"]`);
      await page.click(`#addNameChips .chip[data-name="${roster[20]}"]`);
      await page.selectOption('#changeCourtCount', '3');
      await page.click('.btn-change');
      const live = await page.evaluate(() => document.querySelectorAll('#rosterChips .chip.selected').length);
      await page.reload();
      await page.waitForSelector('.restore-banner');
      const restored = await page.evaluate(() => ({
        chips: Array.from(document.querySelectorAll('#rosterChips .chip.selected')).map(b => b.dataset.name),
        courts: document.getElementById('courtCount').value,
        player: document.querySelector('.fr-player').value,
        note: document.getElementById('forcedRestNote').textContent,
        info: document.getElementById('infoBox') ? document.getElementById('infoBox').textContent : '',
        active: session.players.length,
      }));
      check('D3: 再読み込み後も名簿チップは作成時の17人', restored.chips.length === 17 && restored.chips.length === live, JSON.stringify(restored.chips.length));
      check('D3: 離脱した人も作成時のメンバーとして選ばれ、途中参加者は選ばれない',
        restored.chips.includes(roster[1]) && !restored.chips.includes(roster[20]), restored.chips.join(','));
      check('D3: コート数は作成時の4コート', restored.courts === '4', restored.courts);
      check('D3: 休み指定は有効のまま（対象外と出ない）', restored.player === 'n:' + target && !restored.note.includes('対象外'), JSON.stringify(restored));
      check('D3: 人数不足の警告が出ない', !restored.info.includes('最低'), restored.info);
      check('D3: 表示中の対戦表は変更後の15人のまま', restored.active === 15, String(restored.active));
      check('D3: ページエラーなし', errors.length === 0, errors.join(' / '));
    }

    // ---------- D4 / D5 / D6 / D8 ----------
    console.log('[D4-D8] 番号のみモード');
    {
      const { page, errors } = await freshPage(browser, TTS_STUB);
      await page.goto(indexUrl);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.selectOption('#courtCount', '4');
      await page.selectOption('#playerCount', '18');
      await page.click('#forcedAddBtn');
      await page.selectOption('.fr-round', '8');
      await page.selectOption('.fr-player', 'p:18');
      await page.click('#generateBtn');
      const legendText = '* は指定した休み';
      const before = await page.textContent('#results');
      check('D4: 指定休みがあるときは凡例が出る', before.includes(legendText) && before.includes('18番*'));
      await page.selectOption('#consumedRound', '3');
      await page.click('#removeChips .chip[data-num="18"]');
      await page.click('.btn-change');
      const after = await page.textContent('#results');
      const stars = await page.evaluate(() => Array.from(document.querySelectorAll('.rest-badge')).filter(b => b.textContent.includes('*')).length);
      check('D4: 指定した人が離脱して * が無いときは凡例を出さない', stars === 0 && !after.includes(legendText), `stars=${stars}`);

      // D6: 画像作成中に作り直す（toBlobを1.5秒遅らせて遅い端末を模擬）
      await page.evaluate(() => {
        const orig = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (cb, ...rest) { setTimeout(() => orig.call(this, cb, ...rest), 1500); };
      });
      await page.click('.btn-save');
      await page.selectOption('#consumedRound', '4');
      await page.selectOption('#addCount', '1');
      await page.click('.btn-change');
      await page.waitForTimeout(2500);
      const stale = await page.locator('#imagePreview img').count();
      check('D6: 作り直す前の表の画像はプレビューに出ない', stale === 0, `img=${stale}`);
      await page.click('.btn-save');
      await page.waitForSelector('#imagePreview img', { timeout: 20000 });
      check('D6: 作り直したあとの保存は通常どおりプレビューが出る', await page.locator('#imagePreview img').count() === 1);

      // D5: 再読み込み → 読み上げ → 消去
      await page.reload();
      await page.waitForSelector('.restore-banner');
      await page.click('.btn-speak[data-round="2"]');
      const speaking = await page.evaluate(() => ({ round: speakingRound, spoken: window.__tts.spoken.length, cancels: window.__tts.cancels }));
      await page.click('.restore-banner button');
      const cleared = await page.evaluate(() => ({ round: speakingRound, cancels: window.__tts.cancels, session }));
      check('D5: 読み上げ中だった', speaking.round === 2 && speaking.spoken === 1, JSON.stringify(speaking));
      check('D5: 消去すると読み上げを止める', cleared.round === null && cleared.cancels > speaking.cancels && cleared.session === null, JSON.stringify(cleared));

      // D8: 細工した名前でも組み込みプロパティを読まない
      await page.click('#generateBtn');
      const odd = await page.evaluate(() => {
        session.names = { 1: 'toString', 2: 'constructor', 3: '__proto__' };
        return { s1: sname(1), s2: sname(2), s3: sname(3), g1: genderOfNum(1), g2: genderOfNum(2) };
      });
      check('D8: 読み上げは名前そのまま（関数の文字列が入らない）',
        odd.s1 === 'toString' && odd.s2 === 'constructor' && odd.s3 === '__proto__', JSON.stringify(odd));
      check('D8: 性別は不明扱い', odd.g1 === null && odd.g2 === null, JSON.stringify(odd));
      const normal = await page.evaluate(() => { session.names = { 1: ROSTER[0] }; return { s: sname(1), k: KANA[ROSTER[0]] || SPEECH_KANA[ROSTER[0]] }; });
      check('D8: 名簿の人は従来どおりフリガナで読む', normal.s === (normal.k || normal.s) && normal.s !== undefined, JSON.stringify(normal));
      check('D4-D8: ページエラーなし', errors.length === 0, errors.join(' / '));
    }

    // ---------- S1 ----------
    console.log('[S1] シングルス版: = がすべて %3D のリンク');
    {
      const { context, page, errors } = await freshPage(browser);
      await page.goto(singlesUrl);
      await page.selectOption('#courtCount', '4');
      await page.selectOption('#playerCount', '12');
      await page.selectOption('#roundCount', '30');
      await page.click('#generateBtn');
      const good = await page.evaluate(() => '#sp1=' + encodeShare(session));
      const viewer = await context.newPage();
      viewer.on('pageerror', e => errors.push(e.message));
      for (const [label, hash] of [['すべての = が %3D', good.replace(/=/g, '%3D')], ['小文字の %3d', good.replace(/=/g, '%3d')]]) {
        await viewer.goto('about:blank');
        await viewer.goto(singlesUrl + hash);
        const r = { status: await viewer.textContent('#status'), cards: await viewer.locator('.round-card').count() };
        check(`S1: ${label}のリンクも開ける`, r.cards === 30 && r.status.includes('共有された対戦表'), JSON.stringify(r));
      }
      await viewer.goto('about:blank');
      await viewer.goto(singlesUrl + '#xyz%3Dabc');
      check('S1: 別形式のリンクは従来どおり案内する', (await viewer.textContent('#status')).includes('読み込めない共有リンク'));
      check('S1: ページエラーなし', errors.length === 0, errors.join(' / '));
    }

    // ---------- S2 ----------
    console.log('[S2] シングルス版: Array.prototype.at の無い端末');
    {
      const { context, page, errors } = await freshPage(browser, () => { delete Array.prototype.at; });
      await page.goto(singlesUrl);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      check('S2: 模擬環境で .at が無い', await page.evaluate(() => typeof [].at) === 'undefined');
      await page.selectOption('#courtCount', '2');
      await page.selectOption('#playerCount', '7');
      await page.click('#generateBtn');
      const good = await page.evaluate(() => '#sp1=' + encodeShare(session));
      await page.reload();
      const st = await page.textContent('#status');
      check('S2: 再読み込みで復元できる', st.includes('復元しました') && await page.locator('.round-card').count() > 0, st);
      const viewer = await context.newPage();
      await viewer.goto(singlesUrl + good);
      const vs = await viewer.textContent('#status');
      check('S2: 共有リンクを開ける', vs.includes('共有された対戦表') && await viewer.locator('.round-card').count() > 0, vs);
      check('S2: ページエラーなし', errors.length === 0, errors.join(' / '));
    }

    // ---------- S3 ----------
    console.log('[S3] シングルス版: 保存が使えない端末');
    {
      const { page, errors } = await freshPage(browser, () => {
        const deny = () => { throw new DOMException('blocked', 'SecurityError'); };
        Storage.prototype.getItem = deny; Storage.prototype.setItem = deny; Storage.prototype.removeItem = deny;
      });
      await page.goto(singlesUrl);
      const boot = await page.textContent('#status');
      check('S3: 起動時に「復元できませんでした」と出ない', !boot.includes('復元できませんでした'), boot);
      await page.selectOption('#courtCount', '2');
      await page.selectOption('#playerCount', '6');
      await page.click('#generateBtn');
      const made = await page.locator('.round-card').count();
      await page.getByRole('button', { name: '消去して最初から' }).click();
      const left = await page.locator('.round-card').count();
      const st = await page.textContent('#status');
      check('S3: 消去すると画面の対戦表が消える', made > 0 && left === 0, `made=${made} left=${left} / ${st}`);
      check('S3: 保存が使えないことを案内する', st.includes('保存が使えません'), st);
      check('S3: ページエラーなし', errors.length === 0, errors.join(' / '));
    }
  } finally {
    await browser.close();
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
