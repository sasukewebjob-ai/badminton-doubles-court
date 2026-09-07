// Load the production script verbatim. Only browser I/O is replaced in Node tests.
const fs = require('fs');
const path = require('path');

function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('// 起動')[0];
  const elements = {};
  const selections = {};
  const storage = new Map();
  const alerts = [];
  const document = {
    getElementById: id => elements[id] || null,
    querySelectorAll: selector => selections[selector] || [],
  };
  const localStorage = {
    getItem: k => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: k => storage.delete(k),
  };
  const app = new Function('document', 'localStorage', 'alert', 'confirm', `${script}
    renderResults = () => {};
    saveSession = () => {};
    return {
      generate, applyMemberChange, makeStrideGroups, strideLinearOrder, generateRestSchedule, assignCourts,
      courtTemplates, pairTypesFor, genderAssign, balanceCourts, balanceCourtsSameType,
      evaluateAssignment, localSearchImprove, greedyPairing, assignPairsToCourts,
      updateHistories, updateCourtHistory, updateMixDiff, addHistory,
      encodeShareData, decodeShareData, validateSharedSession, restoreSession, restCountsThrough,
      get session() { return session; }, set session(s) { session = s; },
      get totalRounds() { return TOTAL_ROUNDS; },
      get roster() { return ROSTER; }, get genders() { return GENDER; }
    };
  `)(document, localStorage, msg => alerts.push(msg), () => true);
  app.inputs = values => {
    for (const [id, value] of Object.entries(values)) elements[id] = { value: String(value) };
  };
  app.select = (selector, values, key = 'num') => {
    selections[selector] = values.map(value => ({ dataset: { [key]: String(value) } }));
  };
  app.storage = storage;
  app.alerts = alerts;
  return app;
}

module.exports = { loadApp };
