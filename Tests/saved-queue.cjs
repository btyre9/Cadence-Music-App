const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {constructor(){this.classList={toggle(){},remove(){},add(){},contains(){return true;}};this.value='';this.dataset={};this.textContent='';}append(){}replaceChildren(){}replaceWith(){}setAttribute(){}querySelector(){return null;}}
const storage=new Map();
function launch(){
 const elements=new Map(),calls=[];
 const context=vm.createContext({document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),querySelectorAll:()=>[]},window:{webkit:{messageHandlers:{cadence:{postMessage:x=>calls.push(x)}}}},localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v)},URL,setTimeout:()=>1,clearTimeout:()=>{},stopSoundCloudTracking:()=>{},attachSoundCloudTracking:()=>{},clearNowRelease:()=>{},updateNowRelease:()=>{},saveRadioPlaylist:()=>{}});
 vm.runInContext(fs.readFileSync('Resources/app.js','utf8'),context);
 return {run:code=>vm.runInContext(code,context),calls,elements};
}
const song=(id,title)=>({id,title,artist:'Artist',art:'https://lh3.googleusercontent.com/'+id,kind:'song'});

// First launch: start a playlist, play a while, then quit.
let app=launch();
assert.equal(app.calls.some(c=>c.action==='play-track'),false,'Nothing plays on an empty first launch');
app.run(`startPlaylist(${JSON.stringify([song('songA123','A'),song('songB123','B'),song('songC123','C'),song('songD123','D')])},false);nextTrack();`);
app.run(`addQueue(${JSON.stringify(song('songE123','E'))});cycleRepeat();`);
app.run(`window.receive({event:'track',payload:{id:'songB123',title:'B',artist:'Artist',playing:true,position:83,duration:200}})`);
app.run(`window.receive({event:'track',payload:{id:'songB123',title:'B',artist:'Artist',playing:false,position:84,duration:200}})`);

// Next launch: Up Next, the paused song, repeat, and history come back, without playing anything yet.
app=launch();
assert.equal(app.run('current.id'),'songB123');assert.equal(app.elements.get('now-title').textContent,'B');
assert.equal(app.run('JSON.stringify(queue.map(t=>t.id))'),JSON.stringify(['songC123','songD123','songE123']));
assert.equal(app.run('JSON.stringify(played.map(t=>t.id))'),'["songA123"]');
assert.equal(app.run('repeatMode'),'all');
assert.equal(app.run('source'),'youtube');
assert.equal(app.calls.some(c=>c.action==='play-track'),false,'A restored song waits for Play');
app.run(`window.receive({event:'track',payload:{id:'',title:'',artist:'',playing:false,position:0,duration:0}})`);
assert.equal(app.calls.some(c=>c.action==='now-playing'),false,'Cadence does not claim Now Playing before you press Play');

// Play resumes the same song where you left off.
app.run(`$('toggle').onclick()`);
assert.equal(app.calls.filter(c=>c.action==='play-track').at(-1).id,'songB123');
assert.equal(app.run('JSON.stringify(played.map(t=>t.id))'),'["songA123"]','Resuming does not add the song to history twice');
app.run(`window.receive({event:'track',payload:{id:'songB123',title:'B',artist:'Artist',playing:true,position:0.5,duration:200}})`);
assert.equal(app.calls.filter(c=>c.action==='seek').at(-1).seconds,84);
app.run(`nextTrack()`);assert.equal(app.calls.filter(c=>c.action==='play-track').at(-1).id,'songC123');
console.log('PASS: Up Next, current song, position, repeat, and history survive a restart; the song resumes only when you press Play');

// Shuffle off after a restart restores the original order of the remaining songs.
app=launch();
app.run(`startPlaylist(${JSON.stringify([song('songA123','A'),song('songB123','B'),song('songC123','C'),song('songD123','D')])},true);`);
app=launch();
assert.equal(app.run('shuffleOn'),true);
app.run('toggleShuffle()');
const order=app.run('JSON.stringify(queue.map(t=>t.id))');const expected=['songA123','songB123','songC123','songD123'].filter(id=>id!==app.run('current.id'));
assert.equal(order,JSON.stringify(expected));

// The media play key also resumes; Clear queue and a bad saved value are handled.
app=launch();app.run(`window.receive({event:'remote',payload:{command:'play'}})`);assert.equal(app.calls.filter(c=>c.action==='play-track').length,1);
app.run(`$('clear-queue').onclick()`);app=launch();assert.equal(app.run('queue.length'),0);
storage.set('cadence.session','{not json');app=launch();assert.equal(app.run('current'),null);assert.equal(app.run('queue.length'),0);
storage.set('cadence.session',JSON.stringify({v:1,current:{id:'bad id!',title:'x',kind:'song'},queue:[{id:'songA123',title:'A',kind:'song',art:'https://evil.example/x.png'}]}));
app=launch();assert.equal(app.run('current'),null,'Invalid saved songs are dropped');assert.equal(app.run('queue[0].art'),'','Untrusted artwork hosts are dropped');
console.log('PASS: shuffle order, the play key, Clear queue, and damaged saved data after a restart');
