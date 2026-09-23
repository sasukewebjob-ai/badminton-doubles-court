const assert=require('assert/strict');
const {loadSingles}=require('./test_singles');
const app=loadSingles();
const ids=n=>Array.from({length:n},(_,i)=>i+1);
const config=(n=12,courts=4)=>({players:ids(n),courts,mode:'singles',totalRounds:30,restOrder:'desc',forced:{}});
let passed=0,failed=0;
function test(name,fn) { try {fn();passed++;console.log('OK '+name);} catch(e){failed++;console.error('FAIL '+name+': '+e.message);} }
function seeded(seed,fn) {
  const random=Math.random; let state=seed;
  Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  try{return fn();}finally{Math.random=random;}
}
// Independent replay oracle: joining/returning numbers inherit the continuing
// group's minimum at each historical join, not only at the newest edit.
function verifyFairness(s) {
  const credited=new Map(); let prior=[];
  for (const r of s.rounds) {
    const continuing=r.players.filter(p=>prior.includes(p));
    const base=continuing.length ? Math.min(...continuing.map(p=>credited.get(p)||0)) : 0;
    for (const p of r.players) if(!prior.includes(p)) credited.set(p,base);
    for (const p of r.rest) credited.set(p,(credited.get(p)||0)+1);
    const values=r.players.map(p=>credited.get(p)||0);
    assert(Math.max(...values)-Math.min(...values)<=1,`round ${r.round}: ${JSON.stringify(Object.fromEntries(r.players.map(p=>[p,credited.get(p)])))}`);
    prior=r.players;
  }
}
test('repeated member changes preserve earlier rest credits',()=>seeded(1,()=>{
  let s=app.buildSession(config(10,4));
  s=app.buildSession({...s,players:ids(12)},s.rounds.slice(0,10));
  s=app.buildSession({...s,courts:3},s.rounds.slice(0,15));
  verifyFairness(s);
}));
test('regeneration without membership changes continues the round robin',()=>{
  let s=app.buildSession(config(8,4));
  s=app.buildSession(s,s.rounds.slice(0,3));
  const seen=new Set();
  for (const r of s.rounds.slice(0,7)) for (const pair of r.matches) {
    const k=pair.slice().sort((a,b)=>a-b).join('-'); assert(!seen.has(k),`repeated opponent ${k} at round ${r.round}`);seen.add(k);
  }
});
test('completed-round position survives save/share for repeated edits',()=>{
  let s=app.buildSession(config()); s=app.buildSession(s,s.rounds.slice(0,20));
  assert.equal(app.decodeShare(app.encodeShare(s)).completedThrough,20);
});
test('300 seeded sessions with 2400 join/leave/court edits remain fair and valid',()=>{
  for (let seed=1;seed<=300;seed++) seeded(seed,()=>{
    let s=app.buildSession(config(8+seed%5,1+seed%4));
    for (let step=1;step<=8;step++) {
      const consumed=step*3, count=2+Math.floor(Math.random()*11);
      const players=ids(12).map(p=>({p,t:Math.random()})).sort((a,b)=>a.t-b.t).slice(0,count).map(x=>x.p).sort((a,b)=>a-b);
      const courts=1+Math.floor(Math.random()*Math.min(4,Math.floor(count/2)));
      const kept=s.rounds.slice(0,consumed), before=JSON.stringify(kept);
      s=app.buildSession({...s,players,courts},kept);
      assert.equal(JSON.stringify(s.rounds.slice(0,consumed)),before);
      assert(app.validSession(s)); verifyFairness(s);
      assert.deepEqual(app.decodeShare(app.encodeShare(s)),s);
    }
  });
});
test('500 seeded forced-rest schedules include every number exactly once per round',()=>{
  for (let seed=1;seed<=500;seed++) seeded(seed,()=>{
    const n=2+seed%11,courts=1+seed%Math.min(4,Math.floor(n/2)),forced={};
    for(let rn=1;rn<=30;rn++) {
      const size=Math.floor(Math.random()*(n-courts*2+1));
      forced[rn]=ids(n).map(p=>({p,t:Math.random()})).sort((a,b)=>a.t-b.t).slice(0,size).map(x=>x.p);
    }
    const s=app.buildSession({...config(n,courts),forced});assert(app.validSession(s));
    for(const r of s.rounds) {assert.deepEqual(r.matches.flat().concat(r.rest).sort((a,b)=>a-b),ids(n));forced[r.round].forEach(p=>assert(r.rest.includes(p)));}
  });
});
console.log(`Singles audit: ${passed} groups passed, ${failed} failed.`);
if(failed) process.exitCode=1;
