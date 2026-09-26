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
    // ---------- S4 ----------
    console.log('[S4] シングルス版: iPhoneで画像を保存できる');
    {
      const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
      const setup = async (page, courts = '4', players = '12', rounds = '30') => {
        await page.goto(singlesUrl);
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.selectOption('#courtCount', courts);
        await page.selectOption('#playerCount', players);
        await page.selectOption('#roundCount', rounds);
        await page.click('#generateBtn');
      };
      const previewState = page => page.evaluate(() => {
        const p = document.getElementById('imagePreview');
        const img = p && p.querySelector('img');
        return {
          text: p ? p.textContent : null,
          img: !!img, loaded: !!(img && img.complete && img.naturalWidth > 0), width: img ? img.naturalWidth : 0,
          photo: !!(p && p.querySelector('.photo-button')),
          guide: !!(p && p.querySelector('.preview-guide')),
        };
      });
      const waitImg = page => page.waitForFunction(() => {
        const img = document.querySelector('#imagePreview img');
        return img && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 20000 });

      // PC: 従来どおりダウンロード＋プレビュー
      {
        const { page, errors } = await freshPage(browser);
        await setup(page);
        const dl = page.waitForEvent('download');
        await page.getByRole('button', { name: '画像保存 11〜20節', exact: true }).click();
        const download = await dl;
        await waitImg(page);
        const st = await previewState(page);
        check('S4: PCはダウンロードされる（ファイル名も従来どおり）', download.suggestedFilename() === 'singles-court-11-20.png', download.suggestedFilename());
        check('S4: PCでもプレビューが出る（第11〜20節）', st.loaded && st.text.includes('第11〜20節') && st.width === 800, JSON.stringify(st));
        check('S4: PCでは長押しの案内を出さない', !st.guide, JSON.stringify(st));
        check('S4: PC ページエラーなし', errors.length === 0, errors.join(' / '));
      }

      // iPhone: ダウンロードを試みず、プレビュー長押し＋共有シート
      {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA, hasTouch: true, isMobile: true });
        await context.addInitScript(() => {
          window.__shared = [];
          navigator.canShare = data => !!(data && data.files && data.files.length);
          navigator.share = async data => { window.__shared.push(data.files.map(f => `${f.name}:${f.type}:${f.size}`)); };
        });
        const page = await context.newPage();
        const errors = [];
        let downloads = 0;
        page.on('pageerror', e => errors.push(e.message));
        page.on('dialog', d => d.accept());
        page.on('download', () => downloads++);
        await setup(page);
        await page.getByRole('button', { name: '画像保存 1〜10節', exact: true }).click();
        await waitImg(page);
        const st = await previewState(page);
        const status = await page.textContent('#status');
        check('S4: iPhoneではダウンロード（外部アプリの確認）を起こさない', downloads === 0, `downloads=${downloads}`);
        check('S4: iPhoneでは画像のプレビューが出る', st.loaded && st.text.includes('第1〜10節'), JSON.stringify(st));
        check('S4: iPhoneでは長押しの案内と「写真に保存」ボタンが出る', st.guide && st.photo && st.text.includes('"写真"に追加'), JSON.stringify(st));
        check('S4: 状態表示も長押しを案内する', status.includes('長押し'), status);
        await page.click('#imagePreview .photo-button');
        const shared = await page.evaluate(() => window.__shared);
        check('S4: 「写真に保存」で共有シートにPNGが渡る', shared.length === 1 && /^singles-court-1-10\.png:image\/png:\d+$/.test(shared[0][0]), JSON.stringify(shared));
        const inView = await page.locator('#imagePreview img').evaluate(img => img.getBoundingClientRect().width <= window.innerWidth);
        check('S4: プレビューは画面幅に収まる', inView);
        check('S4: iPhone ページエラーなし', errors.length === 0, errors.join(' / '));

        // 共有できない端末: ボタンは出さず長押しだけ案内
        await page.evaluate(() => { navigator.canShare = () => false; });
        await page.getByRole('button', { name: '画像保存 21〜30節', exact: true }).click();
        await page.waitForFunction(() => document.getElementById('imagePreview').textContent.includes('第21〜30節'));
        await waitImg(page);
        const noShare = await previewState(page);
        check('S4: 共有できない端末はボタンなしで長押しを案内', noShare.loaded && !noShare.photo && noShare.guide, JSON.stringify(noShare));

        // toBlob が null を返す端末: dataURLでプレビュー
        await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (cb) { setTimeout(() => cb(null), 10); }; });
        await page.getByRole('button', { name: '画像保存 1〜10節', exact: true }).click();
        await page.waitForFunction(() => { const img = document.querySelector('#imagePreview img'); return img && img.src.startsWith('data:image/png') && img.naturalWidth > 0; }, null, { timeout: 20000 });
        check('S4: toBlobがnullでもプレビューが出る', true);

        // 画像を作っている途中に作り直した: 古い表の画像を出さない
        await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (cb) { const c = this; setTimeout(() => c.toDataURL && cb(null), 1500); }; });
        await page.getByRole('button', { name: '画像保存 1〜10節', exact: true }).click();
        await page.click('#changePanel summary');
        await page.selectOption('#consumedRound', '3');
        await page.click('#changeBtn');
        await page.waitForTimeout(2500);
        const stale = await previewState(page);
        check('S4: 作成中に作り直したら古い表の画像は出さない', !stale.img, JSON.stringify(stale));

        // toBlob が応答しない端末: 15秒で見切ってプレビュー
        await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function () {}; });
        const t0 = Date.now();
        await page.getByRole('button', { name: '画像保存 1〜10節', exact: true }).click();
        await page.waitForFunction(() => { const img = document.querySelector('#imagePreview img'); return img && img.naturalWidth > 0; }, null, { timeout: 25000 });
        const sec = (Date.now() - t0) / 1000;
        check('S4: toBlobが応答しなくても15秒後にプレビューが出る', sec >= 14 && sec < 25, `${sec.toFixed(1)}秒`);
        check('S4: iPhone ページエラーなし（異常系のあと）', errors.length === 0, errors.join(' / '));
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n合格 ${pass} / 不合格 ${fail}`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
