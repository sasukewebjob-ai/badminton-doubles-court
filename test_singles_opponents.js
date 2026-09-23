const assert=require('assert/strict');
const {loadSingles}=require('./test_singles');
const app=loadSingles();
const originalRandom=Math.random;
let cases=0,extraRepeatCases=0,largestRestGap=0,avoidableConsecutive=0;
const examples={};
function seedRandom(seed){let x=seed;Math.random=()=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x/4294967296;};}
try {
 for(let courts=1;courts<=4;courts++) for(let n=courts*2;n<=12;n++) for(const totalRounds of [10,15,20,25,30]) for(let trial=0;trial<20;trial++) {
  seedRandom(++cases);
  const players=Array.from({length:n},(_,i)=>i+1);
  const s=app.buildSession({players,courts,totalRounds,mode:trial%2?'singles':'pairs',restOrder:trial%2?'asc':'desc',forced:{}});
  const counts=new Map(),rest=Array(n+1).fill(0);let last=new Set(),consecutive=0;
  for(const r of s.rounds) {
   assert.equal(r.matches.length,courts);
   assert.deepEqual(r.matches.flat().concat(r.rest).sort((a,b)=>a-b),players);
   r.rest.forEach(p=>rest[p]++);
   const gap=Math.max(...rest.slice(1))-Math.min(...rest.slice(1));
   assert(gap<=1,'rest difference exceeds one');largestRestGap=Math.max(largestRestGap,gap);
   const current=new Set();
   for(const pair of r.matches){const key=pair.slice().sort((a,b)=>a-b).join('-');counts.set(key,(counts.get(key)||0)+1);current.add(key);if(last.has(key)) consecutive++;}
   last=current;
  }
  const possible=n*(n-1)/2,total=courts*totalRounds,lowerMax=Math.ceil(total/possible),lowerMissing=Math.max(0,possible-total);
  const max=Math.max(...counts.values()),missing=possible-counts.size;
  // The lower bound is not a claim of attainability with every fairness constraint.
  assert(max<=lowerMax+1,`opponent concentration: ${courts}c ${n}p ${totalRounds}r -> ${max}`);
  assert(missing<=lowerMissing+1,`opponent coverage: ${courts}c ${n}p ${totalRounds}r -> ${missing}`);
  if(max>lowerMax)extraRepeatCases++;
  if(n>2){assert.equal(consecutive,0,'same opponents in adjacent rounds');avoidableConsecutive+=consecutive;}
  // Divisible schedules are exact round-robin decompositions, including rest rounds.
  if((n%2===0&&n%(2*courts)===0)||(n%2===1&&n%courts===0)) {
   const all=[];for(let a=1;a<=n;a++)for(let b=a+1;b<=n;b++)all.push(counts.get(a+'-'+b)||0);
   assert(Math.max(...all)-Math.min(...all)<=1,'round-robin pair frequency difference exceeds one');
  }
  assert(app.validSession(s));
  if((n===4&&courts===1&&totalRounds===30)||(n===8&&courts===2&&totalRounds===15)||(n===12&&courts===4)) {
   const key=`${n} numbers / ${courts} courts / ${totalRounds} rounds`;
   const previous=examples[key]||{max:0,missing:0};examples[key]={max:Math.max(previous.max,max),missing:Math.max(previous.missing,missing)};
  }
 }
 // Imposed rests can force repeats; they must be honoured without duplicate players.
 const s=app.buildSession({players:[1,2,3,4],courts:1,totalRounds:10,mode:'pairs',restOrder:'desc',forced:Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,[3,4]]))});
 assert(s.rounds.every(r=>r.matches[0].slice().sort().join(',')==='1,2' && r.rest.join(',')==='3,4'));
 // Earlier saved tables used alternating fixed groups. Preserve their completed
 // rounds, but restore opponent coverage when regenerating the remaining rounds.
 const legacy={players:[1,2,3,4],courts:1,totalRounds:30,mode:'pairs',restOrder:'desc',forced:{}};
 const kept=Array.from({length:5},(_,i)=>({round:i+1,players:[1,2,3,4],courts:1,matches:[i%2 ? [3,4] : [1,2]],rest:i%2 ? [1,2] : [3,4]}));
 const resumed=app.buildSession(legacy,kept);
 assert.deepEqual(resumed.rounds.slice(0,5),kept);
 assert.equal(new Set(resumed.rounds.flatMap(r=>r.matches.map(m=>m.slice().sort().join('-')))).size,6);
 assert(app.validSession(resumed));
 console.log(JSON.stringify({cases,largestRestGap,avoidableConsecutive,extraRepeatCases,examples},null,2));
 console.log('Singles opponent-quality regression passed.');
} finally {Math.random=originalRandom;}
