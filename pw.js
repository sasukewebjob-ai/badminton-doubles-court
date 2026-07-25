// Playwrightの参照先を1か所にまとめるヘルパー（2026-07-25追加）
//
// 以前は各テストが開発機の絶対パス（n8n同梱のplaywright／ms-playwrightのchrome.exe）を
// 直接requireしていたため、別PCやCIではそのまま動かなかった。
// モジュールの優先順位:
//   1. このプロジェクトの node_modules（npm install 済みなら通常これ）
//   2. 環境変数 PLAYWRIGHT_MODULE で指定されたパス
//   3. 開発機のグローバルインストール（フォールバック）
// ブラウザ実行ファイルは、1で読めたときはPlaywright管理のブラウザに任せ、
// フォールバックで読んだときだけ既知のchrome.exeを使う（環境変数 PLAYWRIGHT_CHROMIUM で上書き可）。
const fs = require('fs');

const FALLBACK_MODULES = [
  process.env.PLAYWRIGHT_MODULE,
  'C:/Users/hanim/AppData/Roaming/npm/node_modules/n8n/node_modules/playwright'
].filter(Boolean);

const FALLBACK_EXE = 'C:/Users/hanim/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe';

let playwright = null;
let usedFallbackModule = false;
try {
  playwright = require('playwright');
} catch (e) {
  for (const p of FALLBACK_MODULES) {
    try {
      playwright = require(p);
      usedFallbackModule = true;
      break;
    } catch (e2) { /* 次の候補へ */ }
  }
}
if (!playwright) {
  console.error('Playwrightが見つかりません。`npm install` を実行するか、'
    + '環境変数 PLAYWRIGHT_MODULE でモジュールのパスを指定してください。');
  process.exit(1);
}

const { chromium } = playwright;

// chromium.launch() に渡すオプション。実行ファイルが特定できなければ既定に任せる
function launchOptions(extra) {
  const opts = Object.assign({}, extra);
  const exe = process.env.PLAYWRIGHT_CHROMIUM
    || (usedFallbackModule && fs.existsSync(FALLBACK_EXE) ? FALLBACK_EXE : null);
  if (exe) opts.executablePath = exe;
  return opts;
}

module.exports = { chromium, launchOptions };
