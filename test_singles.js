const fs = require('fs');
const assert = require('assert/strict');
const path = require('path');
function loadSingles() {
  const script=fs.readFileSync(path.join(__dirname,'singles.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1].split('// Startup is kept separate')[0];
  return new Function(`${script}\nreturn {buildSession,validSession,parseForced,encodeShare,decodeShare};`)();
}
module.exports={loadSingles};
if (require.main===module) {
  const app=loadSingles(); let cases=0;
  const config=(players=12,courts=4,restOrder='desc',totalRounds=10,mode='singles',forced={})=>({players:Array.from({length:players},(_,i)=>i+1),courts,restOrder,totalRounds,mode,forced});
  function check(s, fair=true) {
    assert(app.validSession(s));
    const counts=Object.fromEntries(s.players.map(p=>[p,0]));
    for (const r of s.rounds) {
      const all=r.matches.flat().concat(r.rest);
      assert.equal(new Set(all).size,r.players.length);
      assert.deepEqual(all.slice().sort((a,b)=>a-b),r.players.slice().sort((a,b)=>a-b));
      assert.equal(r.matches.length,r.courts);
      r.rest.forEach(p=>counts[p]++);
      if (fair) assert(Math.max(...Object.values(counts))-Math.min(...Object.values(counts))<=1,'休み差が1を超過');
    }
    cases++;
  }
  for (const mode of ['singles','pairs']) for (let courts=1;courts<=4;courts++) for (let n=courts*2;n<=12;n++) for (const total of [10,15,20,25,30]) for (const order of ['asc','desc']) for (let trial=0;trial<3;trial++) {
    const s=app.buildSession(config(n,courts,order,total,mode)); check(s);
    if(order==='desc') assert.deepEqual(s.rounds[0].matches,Array.from({length:courts},(_,i)=>[i*2+1,i*2+2]));
    assert.deepEqual(app.decodeShare(app.encodeShare(s)),s);
  }
  // No-rest round robins: every opponent is used once before any repetition.
  for (let courts=1;courts<=4;courts++) {
    const s=app.buildSession(config(courts*2,courts));
    const seen=new Set();
    for (const r of s.rounds.slice(0,courts*2-1)) for (const m of r.matches) {
      const k=m.slice().sort((a,b)=>a-b).join('-'); assert(!seen.has(k)); seen.add(k);
    }
    cases++;
  }
  const forced={1:[1,3],3:[12],4:[12],5:[12],6:[12]};
  const s=app.buildSession(config(12,4,'desc',30,'pairs',forced)); check(s,false);
  for(const [rn,ids] of Object.entries(forced)) for(const p of ids) assert(s.rounds[rn-1].rest.includes(p));
  assert.deepEqual(app.parseForced('３： ２、５\n3: 5,6\n10: 1'),{3:[2,5,6],10:[1]});
  for (const input of ['abc','3:','1.5: 2','1: 2,']) assert.throws(()=>app.parseForced(input));
  for (const c of [config(13),config(7,4),config(2,0),config(12,5),config(12,4,'desc',11),config(12,4,'x'),config(12,4,'desc',10,'x'),config(12,4,'desc',10,'singles',{1:[1,2,3,4,5]}),config(12,4,'desc',10,'singles',{11:[1]}),config(12,4,'desc',10,'singles',{1:[13]})]) assert.throws(()=>app.buildSession(c));
  // Removing, adding, returning, and changing courts preserves completed rounds.
  let changed=app.buildSession(config());
  for(const [consumed,players,courts] of [[3,[1,2,3,4,5,6,7,8,9],3],[5,[1,2,3,4,5,6,7,8,9,10,11,12],4],[9,[1,2,4,6],2]]) {
    const kept=changed.rounds.slice(0,consumed), before=JSON.stringify(kept);
    changed=app.buildSession({...changed,players,courts},kept);
    assert.equal(JSON.stringify(changed.rounds.slice(0,consumed)),before); check(changed,false);
    assert.deepEqual(app.decodeShare(app.encodeShare(changed)),changed);
    changed.rounds.slice(consumed).forEach(r=>assert.deepEqual(r.players,players));
  }
  assert.throws(()=>app.buildSession(changed,changed.rounds));
  assert.throws(()=>app.buildSession({...s,players:[1,2,3,4,5,6,7,8]},s.rounds.slice(0,2)));
  // Malformed restored/shared data never reaches rendering.
  const good=app.buildSession(config());
  const mutations=[x=>x.rounds[0].matches[0]=[1,1],x=>x.rounds[0].rest.pop(),x=>x.rounds[0].matches[0][0]='<img>',x=>x.rounds[0].round=99,x=>x.rounds.pop(),x=>x.mode='bad',x=>x.players.push(13),x=>x.courts=3,x=>x.forced={1:[1]},x=>x.rounds[0].players=[1,1]];
  for (const mutate of mutations) { const bad=structuredClone(good); mutate(bad); assert(!app.validSession(bad)); assert.throws(()=>app.decodeShare(app.encodeShare(bad))); cases++; }
  for(const bad of [null,{},[],{rounds:null}]) assert(!app.validSession(bad));
  assert.throws(()=>app.decodeShare('a'.repeat(24001)));
  assert.throws(()=>app.decodeShare('not valid'));
  console.log(`Singles/fixed-pairs: ${cases} configuration and regression cases passed.`);
}
