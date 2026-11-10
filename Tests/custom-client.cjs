const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const catalogScript=fs.readFileSync('Resources/youtube-catalog.js','utf8');
function row(title,href,artist,kind='song'){
 const link={href:'https://music.youtube.com/'+href,textContent:title,getAttribute:()=>href};
 const artistLink={href:'https://music.youtube.com/channel/UCartist',textContent:artist,getAttribute:()=>'/channel/UCartist'};
 return {data:{title:{runs:[{text:title}]},subtitle:{runs:[{text:kind==='album'?'Album':'Song'}]},thumbnail:{musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:'https://lh3.googleusercontent.com/cover'}]}}}},textContent:title+' 4:00',getAttribute:()=>'',querySelector:s=>s==='img'?{src:'https://lh3.googleusercontent.com/cover'}:s.startsWith('[aria')?{getAttribute:()=>`Play ${title} - ${artist}`} :s.includes('title')?link:null,querySelectorAll:()=>[link,artistLink]};
}
const rows=[row('A Song','watch?v=abc12345','Musician'),row('An Album','browse/MPREalbum','Musician','album'),row('An Artist','channel/UC12345','Musician','artist'),row('Bad Link','https://evil.example/','Unknown')];
const doc={querySelectorAll:s=>s.includes('carousel-shelf')?[]:rows,querySelector:()=>null};
const result=vm.runInNewContext(catalogScript,{document:doc,location:{origin:'https://music.youtube.com',href:'https://music.youtube.com/search?q=test'},URL});
const items=result.sections[0].items;assert.equal(items[0].id,'abc12345');assert.equal(items[0].artist,'Musician');assert.equal(items[1].kind,'album');assert.equal(items[2].kind,'artist');assert.equal(items[0].art,'https://lh3.googleusercontent.com/cover');
class Element {constructor(){this.classList={toggle(){},remove(){},add(){},contains(){return true;}};this.value='';this.dataset={};}append(){}replaceChildren(){}replaceWith(){}setAttribute(){}querySelector(){return null;}}
const elements=new Map(),calls=[],storage=new Map();
const context=vm.createContext({document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),querySelectorAll:()=>[]},window:{webkit:{messageHandlers:{cadence:{postMessage:x=>calls.push(x)}}}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL,setTimeout:()=>1,clearTimeout:()=>{},stopSoundCloudTracking:()=>{},attachSoundCloudTracking:()=>{},clearNowRelease:()=>{},updateNowRelease:()=>{},saveRadioPlaylist:()=>{}});
vm.runInContext(fs.readFileSync('Resources/app.js','utf8'),context);
vm.runInContext(`playTrack({id:'songA123',title:'Song A',artist:'Artist',kind:'song'});addQueue({id:'songB123',title:'Song B',artist:'Artist',kind:'song'});`,context);
assert.equal(calls.at(-1).id,'songA123');
vm.runInContext(`window.receive({event:'track',payload:{id:'songA123',title:'Song A',artist:'Artist',playing:true,position:99,duration:100}});window.receive({event:'track',payload:{id:'songA123',title:'Song A',artist:'Artist',playing:false,ended:true,position:100,duration:100}});`,context);
assert.equal(calls.at(-1).id,'songB123','Queue must advance through the custom player at track end');
assert.equal(vm.runInContext('queue.length',context),0);
assert.equal(vm.runInContext("safeArt('https://evil.example/a.png')",context),false);
assert.equal(vm.runInContext("safeArt('https://lh3.googleusercontent.com/a.png')",context),true);
assert.equal(fs.readFileSync('Resources/index.html','utf8').includes('youtube-slot'),false);
console.log('PASS: custom catalog parsing, artist/album types, artwork, custom play/queue advancement, image host checks, and absence of the embedded website slot');
// Repeated songs are retained in shuffle; toggling off restores remaining order.
vm.runInContext(`const entries=[{id:'AAAAAAA1',title:'A',kind:'song'},{id:'BBBBBBB2',title:'B',kind:'song'},{id:'BBBBBBB2',title:'B copy',kind:'song'}];startPlaylist(entries,true);`,context);
assert.equal(vm.runInContext('[current,...queue].length',context),3);
assert.equal(vm.runInContext('[current,...queue].filter(t=>t.id==="BBBBBBB2").length',context),2);
vm.runInContext(`toggleShuffle();repeatMode='all';queue=[];nextTrack();`,context);
assert.equal(calls.at(-1).id,'AAAAAAA1','Repeat all restarts the original playlist order');
vm.runInContext(`repeatMode='one';pendingTrackId='';current={id:'AAAAAAA1',title:'A',kind:'song'};queue=[{id:'BBBBBBB2',title:'B',kind:'song'}];lastDuration=100;lastPosition=99;`,context);
const playbackCalls=()=>calls.filter(c=>c.action!=='now-playing').length,before=playbackCalls();
vm.runInContext(`window.receive({event:'track',payload:{id:'AAAAAAA1',title:'A',artist:'Artist',playing:false,ended:true,position:100,duration:100}});`,context);
assert.equal(playbackCalls(),before,'Repeat one leaves the queue untouched for the native media loop');
assert.equal(vm.runInContext('queue.length',context),1);
vm.runInContext(`repeatMode='off';cycleRepeat();cycleRepeat();`,context);
assert.equal(calls.at(-1).action,'repeat-one');assert.equal(calls.at(-1).enabled,true);
// A cached page avoids a native load; Refresh deliberately bypasses the cache.
vm.runInContext(`const cacheURL='https://music.youtube.com/library';catalogCache.set(cacheURL,{time:Date.now(),data:{title:'Library',sections:[]}});browse(cacheURL);`,context);
const cacheCalls=calls.length;
vm.runInContext(`browse('https://music.youtube.com/library');`,context);assert.equal(calls.length,cacheCalls);
vm.runInContext(`browse('https://music.youtube.com/library',false,true);`,context);assert.equal(calls.at(-1).action,'catalog');
console.log('PASS: shuffle preserves duplicates, repeat-all cycling, repeat-one queue isolation, repeat button modes, instant cached navigation, and explicit refresh');

vm.runInContext("$('create-radio').onclick();",context);
assert.equal(calls.at(-1).action,'start-radio');assert.equal(vm.runInContext('queue.length',context),0);assert.equal(vm.runInContext('repeatMode',context),'off');assert.equal(vm.runInContext('radioMode',context),true);
console.log('PASS: radio station uses current seed, clears custom queue, and turns off repeat-one');
