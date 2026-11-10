const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {constructor(tag=''){this.tag=tag;const set=new Set();this.classList={toggle(c,on){if(on===undefined?!set.has(c):on)set.add(c);else set.delete(c);},remove(c){set.delete(c);},add(c){set.add(c);},contains(c){return set.has(c);}};this.children=[];this.value='';this.dataset={};this.attributes={};this.textContent='';}append(...c){this.children.push(...c);}replaceChildren(...c){this.children=c;}replaceWith(){}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}querySelector(){return null;}}
const elements=new Map(),calls=[],storage=new Map();
const context=vm.createContext({document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:t=>new Element(t),querySelectorAll:()=>[]},window:{webkit:{messageHandlers:{cadence:{postMessage:x=>calls.push(x)}}}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL,setTimeout:()=>1,clearTimeout:()=>{},stopSoundCloudTracking:()=>{},attachSoundCloudTracking:()=>{},clearNowRelease:()=>{},updateNowRelease:()=>{},saveRadioPlaylist:()=>{},choosePlaylist:()=>{},manageItem:()=>{},showMusicInfo:()=>{}});
vm.runInContext(fs.readFileSync('Resources/app.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
const likes=()=>calls.filter(c=>c.action==='like');
const heart=()=>elements.get('now-like');

// A song row's heart saves the song and likes it in YouTube Music; tapping again undoes both.
run(`globalThis.song={id:'songA123',title:'Song A',artist:'Artist',kind:'song'};globalThis.row=likeButton(song);`);
assert.equal(run('row.textContent'),'♡');
run('row.onclick()');
assert.equal(run('row.textContent'),'♥');assert.equal(run('saved.length'),1);
assert.deepEqual({...likes().at(-1)},{action:'like',id:'songA123',liked:true});
run('row.onclick()');
assert.equal(run('row.textContent'),'♡');assert.equal(run('saved.length'),0);
assert.deepEqual({...likes().at(-1)},{action:'like',id:'songA123',liked:false});

// ListenBrainz suggestions (not YouTube songs) stay local.
const before=likes().length;
run(`toggleSave({id:'8f3a0b7e-1111-2222-3333-444455556666',title:'Suggested',artist:'Someone'})`);
assert.equal(likes().length,before);assert.equal(run('saved.length'),1);
console.log('PASS: song hearts like and unlike in YouTube Music; ListenBrainz suggestions stay local');

// The footer heart follows the current song, including likes made elsewhere in YouTube Music.
assert.equal(heart().hidden,true,'No footer heart before anything plays');
run(`playTrack({id:'songB123',title:'Song B',artist:'Artist',kind:'song'})`);
assert.equal(heart().hidden,false);assert.equal(heart().textContent,'♡');
run(`window.receive({event:'track',payload:{id:'songB123',title:'Song B',artist:'Artist',playing:true,position:1,duration:200,liked:true,likeKnown:true}})`);
assert.equal(heart().textContent,'♥','A song already liked in YouTube Music shows as liked');
run('$("now-like").onclick()');
assert.equal(heart().textContent,'♡');assert.deepEqual({...likes().at(-1)},{action:'like',id:'songB123',liked:false});
run(`window.receive({event:'track',payload:{id:'songB123',title:'Song B',artist:'Artist',playing:true,position:2,duration:200,liked:true,likeKnown:true}})`);
assert.equal(heart().textContent,'♡','Your tap wins over the player catching up');
run('$("now-like").onclick()');
assert.equal(heart().textContent,'♥');assert.equal(run(`saved.some(x=>x.id==='songB123')`),true,'Liking from the footer also saves it in Cadence');

// If YouTube Music doesn't confirm, the heart goes back to what YouTube says and you're told.
run(`window.receive({event:'like-result',payload:{ok:false,id:'songB123',liked:true,message:'Sign in through Account before managing your library.'}})`);
assert.match(elements.get('toast').textContent,/didn’t confirm the like/);
assert.equal(run(`likeState.has('songB123')`),false);
run(`window.receive({event:'like-result',payload:{ok:true,id:'songB123',liked:true}})`);
assert.match(elements.get('toast').textContent,/Liked Music/);

// SoundCloud songs can't be liked on YouTube, so the footer heart hides.
run(`source='soundcloud';updateControls()`);assert.equal(heart().hidden,true);
console.log('PASS: footer heart shows YouTube Music likes, toggles like and save together, and reports unconfirmed changes');
