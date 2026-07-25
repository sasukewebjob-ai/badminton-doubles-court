// 画像保存（Canvas描画）の検証（Playwright、375px幅・dpr3＝スマホ相当）
// 2026-07-25追加。既存テストは「例外が出ない・Canvas面積が上限内」までしか見ていなかったので、
// 実際に描かれた画素を調べて次を確認する:
//   1. 保存が最後まで通る（アラートなし・プレビュー表示・面積は上限の9割以内）
//   2. 画像の下端で内容が見切れていない
//   3. 休みバッジが「第N節」側にはみ出していない（休み人数が多い構成）
//   4. カードの右端より外に文字がはみ出していない（長い名前・長い変更ラベル）
const { chromium, launchOptions } = require('./pw');
const path = require('path');

const URL = process.argv[2] || 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const MAX_AREA = 16777216 * 0.9;

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  OK  ' + name + (detail ? `（${detail}）` : '')); }
  else { fail++; console.log('  NG  ' + name + (detail ? `（${detail}）` : '')); }
}

// 保存直前に生成されるCanvasを捕まえるフック
// プレビューも消しておく（前回の画像を新しい画像と取り違えないため）
const HOOK = () => {
  window.__canvases = [];
  window.__origCreate = document.createElement.bind(document);
  document.createElement = function (tag) {
    const el = window.__origCreate(tag);
    if (String(tag).toLowerCase() === 'canvas') window.__canvases.push(el);
    return el;
  };
  const pv = document.getElementById('imagePreview');
  if (pv) pv.textContent = '';
};

// 描かれた画素から、見切れ・はみ出しを調べる
const ANALYZE = () => {
  document.createElement = window.__origCreate;
  const cv = window.__canvases[window.__canvases.length - 1];
  if (!cv) return { error: 'canvas not captured' };
  const w = cv.width, h = cv.height;
  const data = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const lum = i => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

  // 下端付近（90〜98%）に濃い文字があるか＝最後の節が見切れていない
  let bottomDark = 0;
  for (let y = Math.floor(h * 0.90); y < Math.floor(h * 0.98); y++) {
    for (let x = 0; x < w; x += 2) {
      if (lum((y * w + x) * 4) < 110) bottomDark++;
    }
  }

  // 休み／休みなしバッジ（#e74c3c・#27ae60）の塗り。VSの文字と区別するため
  // 「横に長く連続している」ものだけを拾い、いちばん左の開始位置を見る。
  // 種目タグ（緑の「混成」など）も同じ色なので、左隣がヘッダーの紺色（#34495e）＝
  // バッジはヘッダー帯の上にある、という条件で区別する
  const isBadge = i => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return (Math.abs(r - 231) < 12 && Math.abs(g - 76) < 12 && Math.abs(b - 60) < 12)
        || (Math.abs(r - 39) < 12 && Math.abs(g - 174) < 12 && Math.abs(b - 96) < 12);
  };
  const onHeader = (y, x) => {
    if (x < 3) return false;
    const i = (y * w + x - 3) * 4;
    return Math.abs(data[i] - 52) < 14 && Math.abs(data[i + 1] - 73) < 14 && Math.abs(data[i + 2] - 94) < 14;
  };
  const runMin = Math.max(10, Math.round(w * 0.012));
  let badgeMinX = w;
  for (let y = 0; y < h; y += 2) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (isBadge((y * w + x) * 4)) {
        run++;
        const start = x - run + 1;
        if (run === runMin && start < badgeMinX && onHeader(y, start)) badgeMinX = start;
      } else {
        run = 0;
      }
    }
  }

  // カード右端（97.3%）より外に文字が出ていないか。影は薄いので輝度200未満だけ数える
  let rightBleed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = Math.floor(w * 0.975); x < w; x++) {
      if (lum((y * w + x) * 4) < 200) rightBleed++;
    }
  }

  return { w, h, area: w * h, bottomDark, badgeMinX, badgeMinRatio: badgeMinX / w, rightBleed };
};

async function saveAndAnalyze(page) {
  await page.evaluate(HOOK);
  await page.click('.btn-save');
  await page.waitForSelector('#imagePreview img');
  await page.waitForFunction(() => {
    const img = document.querySelector('#imagePreview img');
    return img && img.naturalWidth > 0;
  }, null, { timeout: 20000 });
  const info = await page.evaluate(ANALYZE);
  info.preview = await page.evaluate(() => {
    const img = document.querySelector('#imagePreview img');
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  return info;
}

async function setup(page, cfg) {
  await page.goto(URL);
  await page.evaluate(() => localStorage.removeItem('badminton-court-session-v1'));
  await page.goto(URL);
  if (cfg.roster) {
    for (let i = 0; i < cfg.roster; i++) await page.locator('#rosterChips .chip').nth(i).click();
  }
  await page.selectOption('#courtCount', String(cfg.courts));
  if (!cfg.roster) await page.selectOption('#playerCount', String(cfg.players));
  await page.selectOption('#roundCount', String(cfg.rounds));
  if (cfg.gender) await page.selectOption('#genderMode', 'on');
  await page.click('#generateBtn');
  await page.waitForSelector('.round-card');
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

  const CONFIGS = [
    { label: '番号のみ 2c×8人×10節（最小）', courts: 2, players: 8, rounds: 10 },
    { label: '番号のみ 4c×16人×15節（SCALE2.0）', courts: 4, players: 16, rounds: 15 },
    { label: '番号のみ 4c×26人×25節（SCALE1.2）', courts: 4, players: 26, rounds: 25 },
    { label: '番号のみ 4c×26人×30節（最長）', courts: 4, players: 26, rounds: 30 },
    { label: '番号のみ 2c×26人×15節（休み18人）', courts: 2, players: 26, rounds: 15 },
    { label: '名簿 26人×4c×15節（番号表つき）', courts: 4, roster: 26, rounds: 15 },
    { label: '名簿 26人×2c×15節（休み18人・名前つき）', courts: 2, roster: 26, rounds: 15 },
    { label: '名簿 26人×3c×10節（種目別・休み14人）', courts: 3, roster: 26, rounds: 10, gender: true },
    { label: '名簿 12人×3c×10節（種目別・休みなし）', courts: 3, roster: 12, rounds: 10, gender: true }
  ];

  for (const cfg of CONFIGS) {
    console.log(`\n[${cfg.label}]`);
    await setup(page, cfg);
    const before = dialogs.length; // 保存の前後だけを見る（生成時の案内は数えない）
    const info = await saveAndAnalyze(page);
    if (info.error) { check('Canvasを取得', false, info.error); continue; }
    check('アラートなしで保存できる', dialogs.length === before, dialogs.slice(before).join(' / '));
    check('プレビューがCanvasと同じ寸法', info.preview && info.preview.w === info.w && info.preview.h === info.h,
      `${info.w}x${info.h}`);
    check('Canvas面積が上限の9割以内', info.area <= MAX_AREA,
      `${info.area.toLocaleString()} ≦ ${MAX_AREA.toLocaleString()}`);
    check('横幅が十分（1000px以上）', info.w >= 1000, `${info.w}px`);
    check('下端で内容が見切れていない', info.bottomDark > 50, `濃い画素${info.bottomDark}`);
    check('休みバッジが第N節側にはみ出さない', info.badgeMinRatio >= 0.186 - 0.005,
      `左端 ${(info.badgeMinRatio * 100).toFixed(1)}% ≧ 18.6%`);
    check('カード右端より外に文字が出ない', info.rightBleed === 0, `はみ出し画素${info.rightBleed}`);
  }

  // --- メンバー変更マーカー（長いラベル）---
  console.log('\n[名簿10人→8人追加（変更マーカーが最長）]');
  {
    await setup(page, { courts: 2, roster: 10, rounds: 10 });
    await page.selectOption('#consumedRound', '1');
    const addChips = await page.locator('#addNameChips .chip').count();
    for (let i = 0; i < Math.min(8, addChips); i++) await page.locator('#addNameChips .chip').nth(i).click();
    await page.click('.btn-change');
    await page.waitForSelector('.change-divider');
    const before = dialogs.length; // 「第2節以降を作り直しました」の案内は数えない
    const info = await saveAndAnalyze(page);
    check('アラートなしで保存できる', dialogs.length === before, dialogs.slice(before).join(' / '));
    check('Canvas面積が上限の9割以内', info.area <= MAX_AREA, info.area.toLocaleString());
    check('下端で内容が見切れていない', info.bottomDark > 50, `濃い画素${info.bottomDark}`);
    check('変更ラベルがカード外にはみ出さない', info.rightBleed === 0, `はみ出し画素${info.rightBleed}`);
    check('休みバッジが第N節側にはみ出さない', info.badgeMinRatio >= 0.186 - 0.005,
      `左端 ${(info.badgeMinRatio * 100).toFixed(1)}%`);
  }

  // --- 連続保存（blob URLが生きているか）---
  console.log('\n[連続保存]');
  {
    const before = dialogs.length;
    const first = await page.evaluate(() => document.querySelector('#imagePreview img').src);
    await saveAndAnalyze(page);
    const second = await page.evaluate(() => document.querySelector('#imagePreview img').src);
    check('2回目もアラートなし', dialogs.length === before);
    check('プレビューのURLが更新される', first !== second);
    check('2回目のプレビューが表示できる',
      await page.evaluate(() => document.querySelector('#imagePreview img').naturalWidth > 0));
  }

  // --- toBlobが応答しない端末（無反応の防止・2026-07-25追加）---
  console.log('\n[toBlobがコールバックを返さない場合]');
  {
    await setup(page, { courts: 2, players: 8, rounds: 10 });
    const before = dialogs.length;
    await page.evaluate(() => {
      window.__origToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function () { /* 永遠に返さない端末を再現 */ };
      const pv = document.getElementById('imagePreview');
      if (pv) pv.textContent = '';
    });
    const t0 = Date.now();
    await page.click('.btn-save');
    let shown = true;
    try {
      await page.waitForSelector('#imagePreview img', { timeout: 20000 });
      await page.waitForFunction(() => {
        const i = document.querySelector('#imagePreview img');
        return i && i.naturalWidth > 0;
      }, null, { timeout: 5000 });
    } catch (e) {
      shown = false;
    }
    const elapsed = Date.now() - t0;
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.__origToBlob; });
    check('15秒の監視タイマーでプレビューが出る（無反応にならない）', shown, `${(elapsed / 1000).toFixed(1)}秒`);
    check('dataURLでの表示なのでアラートは出ない', dialogs.length === before, dialogs.slice(before).join(' / '));
    check('タイマー発火まで15秒前後', elapsed >= 14000 && elapsed <= 19000, `${(elapsed / 1000).toFixed(1)}秒`);
  }

  // --- 閲覧モード（共有リンク）からの保存 ---
  console.log('\n[共有リンクの閲覧モードで保存]');
  {
    await setup(page, { courts: 3, roster: 15, rounds: 10, gender: true });
    const url = await page.evaluate(() => buildShareUrl());
    const vctx = await browser.newContext({ viewport: { width: 375, height: 700 }, deviceScaleFactor: 3 });
    const viewer = await vctx.newPage();
    const vdialogs = [];
    viewer.on('dialog', async d => { vdialogs.push(d.message()); await d.accept(); });
    await viewer.goto(url);
    await viewer.waitForSelector('.round-card');
    const info = await saveAndAnalyze(viewer);
    check('閲覧モードでもアラートなしで保存できる', vdialogs.length === 0, vdialogs.join(' / '));
    check('Canvas面積が上限の9割以内', info.area <= MAX_AREA, info.area.toLocaleString());
    check('下端で内容が見切れていない', info.bottomDark > 50, `濃い画素${info.bottomDark}`);
    check('カード右端より外に文字が出ない', info.rightBleed === 0, `はみ出し画素${info.rightBleed}`);
    await vctx.close();
  }

  await browser.close();
  console.log(`\n結果: ${pass} OK / ${fail} NG`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
