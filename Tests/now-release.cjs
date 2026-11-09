const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),calls=[],timers=[];
function element(id){if(!elements.has(id))elements.set(id,{hidden:true,textContent:'',title:'',open:false});return elements.get(id);}
const c=vm.createContext({$:element,native:(a,b)=>calls.push({a,...b}),source:'youtube',setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
vm.runInContext(fs.readFileSync('Resources/music-info.js','utf8'),c);
const run=s=>vm.runInContext(s,c);
run("updateNowRelease({id:'one',title:'One',artist:'Artist'});");timers.at(-1)();const old=calls.at(-1).requestID;
run("updateNowRelease({id:'two',title:'Two',artist:'Artist'});");timers.at(-1)();const current=calls.at(-1).requestID;
c.receiveMusicInfo({requestID:old,matches:[{date:'1994-01-01'}]});assert.equal(element('now-release').textContent,'Release: looking up…');
c.receiveMusicInfo({requestID:current,matches:[{date:'2010-04-23'}]});assert.equal(element('now-release').textContent,'Released Apr 23, 2010 ⓘ');
const count=calls.length;run("updateNowRelease({id:'two',title:'Two',artist:'Artist'});");assert.equal(calls.length,count,'Polling must not repeat lookups');
run("updateNowRelease({id:'three',title:'Three',artist:'Artist'});");timers.at(-1)();c.receiveMusicInfo({requestID:calls.at(-1).requestID,matches:[{date:'1994'},{date:'1995'}]});assert.equal(element('now-release').textContent,'Release: multiple versions ⓘ');
assert.equal(run("releaseDateLabel('1994')"),'1994');assert.equal(run("releaseDateLabel('1994-02')"),'Feb 1994');
run('clearNowRelease()');assert.equal(element('now-release').hidden,true);
run("updateNowRelease({id:'two',title:'Two',artist:'Artist'});");assert.equal(element('now-release').textContent,'Released Apr 23, 2010 ⓘ');assert.equal(calls.length,count+1,'Cached song should not issue another request');
console.log('PASS: footer release date formatting, stale response rejection, polling deduplication, ambiguous versions, clearing, and cache reuse');
