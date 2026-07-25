// ブラウザ検証（Playwright）を一括実行して結果をまとめる（2026-07-25追加）
// 使い方: node run_browser_tests.js  ／  npm run test:browser
// 本番URLを叩く check_deploy.js は含めない（デプロイ後に個別実行する）
const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
  'test_persistence.js',
  'test_share.js',
  'test_names.js',
  'test_speech.js',
  'test_gender.js',
  'test_bugfix.js',
  'test_26players.js',
  'check_fixed_round1.js'
];

const results = [];
for (const t of TESTS) {
  console.log(`\n==================== ${t} ====================`);
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], {
    stdio: 'inherit',
    cwd: __dirname
  });
  results.push({ name: t, code: r.status === null ? 1 : r.status });
}

console.log('\n==================== ブラウザ検証の総合結果 ====================');
let failed = 0;
for (const r of results) {
  if (r.code !== 0) failed++;
  console.log(`  ${r.code === 0 ? '✅' : '❌'} ${r.name}${r.code === 0 ? '' : `（exit ${r.code}）`}`);
}
console.log(failed === 0
  ? `\n✅ 全${results.length}ファイル合格`
  : `\n❌ ${failed}／${results.length}ファイルが失敗`);
process.exit(failed === 0 ? 0 : 1);
