const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {constructor(){this.classList={toggle(){},remove(){},add(){},contains(){return true;}};this.value='';this.dataset={};}append(){}replaceChildren(){}replaceWith(){}setAttribute(){}querySelector(){return null;}}
const elements=new Map(),calls=[],storage=new Map(),widgetCalls=[];
let widget=null;
const context=vm.createContext({document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),querySelectorAll:()=>[]},window:{webkit:{messageHandlers:{cadence:{postMessage:x=>calls.push(x)}}}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},URL,setTimeout:()=>1,clearTimeout:()=>{},stopSoundCloudTracking:()=>{},attachSoundCloudTracking:()=>{},clearNowRelease:()=>{},updateNowRelease:()=>{},saveRadioPlaylist:()=>{},soundcloudWidget:()=>widget});
vm.runInContext(fs.readFileSync('Resources/app.js','utf8'),context);
let clock=1_000_000;vm.runInContext('Date.now=()=>globalThis.__clock',context);
const at=t=>{clock=t;context.__clock=t;};at(clock);
const run=code=>vm.runInContext(code,context);
const remote=(command,position)=>run(`window.receive({event:'remote',payload:${JSON.stringify(position===undefined?{command}:{command,position})}})`);
const last=action=>calls.filter(c=>c.action===action).at(-1);

// Nothing is playing yet: media keys do nothing.
remote('next');remote('toggle');assert.equal(calls.filter(c=>c.action!=='history-state'&&c.action!=='catalog').length,0);

// Next and Previous follow Cadence's own queue, exactly like the footer buttons.
run(`playTrack({id:'songA123',title:'Song A',artist:'Artist',kind:'song'});addQueue({id:'songB123',title:'Song B',artist:'Artist',kind:'song'});addQueue({id:'songC123',title:'Song C',artist:'Artist',kind:'song'});`);
at(clock+1000);remote('next');assert.equal(last('play-track').id,'songB123');
at(clock+100);remote('next');assert.equal(last('play-track').id,'songB123','A doubled key press within 350 ms only skips once');
at(clock+500);remote('next');assert.equal(last('play-track').id,'songC123');
at(clock+1000);remote('previous');assert.equal(last('play-track').id,'songB123','Previous returns to the song played before');
assert.equal(run('current.id'),'songB123');

// Play and pause are explicit, so AirPods and Control Center never invert the state.
at(clock+1000);remote('pause');assert.equal(calls.at(-1).action,'pause');assert.equal(run('playing'),false);
at(clock+1000);remote('play');assert.equal(calls.at(-1).action,'play');assert.equal(run('playing'),true);
at(clock+1000);remote('toggle');assert.equal(calls.at(-1).action,'toggle');assert.equal(run('playing'),false);

// Scrubbing in Control Center seeks the song, but not during an ad.
remote('seek',42.5);assert.equal(calls.at(-1).action,'seek');assert.equal(calls.at(-1).seconds,42.5);
run(`$('seek').disabled=true`);const beforeAd=calls.length;remote('seek',10);assert.equal(calls.length,beforeAd,'Seeking is ignored while an ad plays');run(`$('seek').disabled=false`);
remote('seek',-3);assert.equal(calls.length,beforeAd);
console.log('PASS: media keys follow the custom queue, ignore doubled presses, play/pause explicitly, and seek only when allowed');

// Now Playing is reported from the player, skipping unchanged updates.
run(`pendingTrackId='';current={id:'songB123',title:'Song B',artist:'Artist',art:'',kind:'song'};queue=[];`);
const track=(extra={})=>run(`window.receive({event:'track',payload:${JSON.stringify({id:'songB123',title:'Song B',artist:'Artist',album:'Album',art:'https://lh3.googleusercontent.com/abc=w60-h60-l90-rj',playing:true,position:10,duration:200,...extra})}})`);
const sent=()=>calls.filter(c=>c.action==='now-playing');
track();let info=last('now-playing');
assert.deepEqual({...info},{action:'now-playing',title:'Song B',artist:'Artist',album:'Album',art:'https://lh3.googleusercontent.com/abc=w544-h544-l90-rj',duration:200,position:10,playing:true,canSeek:true});
let count=sent().length;at(clock+350);track({position:10.35});assert.equal(sent().length,count,'Steady playback is not re-sent every poll');
at(clock+350);track({position:60});assert.equal(sent().length,count+1,'A seek is re-sent');assert.equal(last('now-playing').position,60);
at(clock+350);track({position:60.4,playing:false});assert.equal(sent().length,count+2,'Pausing is re-sent');assert.equal(last('now-playing').playing,false);
at(clock+5000);track({position:60.4,playing:false});assert.equal(sent().length,count+2,'A paused song stays put');
track({ad:true,playing:false,position:3,duration:15});info=last('now-playing');assert.equal(info.title,'YouTube advertisement');assert.equal(info.canSeek,false);assert.equal(info.art,'');
const beforeError=sent().length;track({error:'This song is unavailable',title:'Song B'});assert.equal(sent().length,beforeError,'Player errors are not shown as a song');
console.log('PASS: Now Playing title, artist, album, larger artwork, progress, pause, seek, and ads are reported without repeating unchanged updates');

assert.equal(run(`hiResArt('https://i1.sndcdn.com/artworks-abc-large.jpg')`),'https://i1.sndcdn.com/artworks-abc-t500x500.jpg');
assert.equal(run(`hiResArt('https://i.ytimg.com/vi/x/sddefault.jpg')`),'https://i.ytimg.com/vi/x/sddefault.jpg');
assert.equal(run(`hiResArt('http://lh3.googleusercontent.com/a=w60-h60')`),'');
assert.equal(run(`hiResArt('not a url')`),'');

// SoundCloud is controlled through its official widget.
widget={play:()=>widgetCalls.push('play'),pause:()=>widgetCalls.push('pause'),toggle:()=>widgetCalls.push('toggle'),next:()=>widgetCalls.push('next'),prev:()=>widgetCalls.push('prev'),seekTo:ms=>widgetCalls.push('seek:'+ms)};
run(`source='soundcloud'`);const beforeSC=calls.length;
for(const c of ['toggle','next','previous','play','pause']){at(clock+1000);remote(c);}remote('seek',12);
assert.deepEqual(widgetCalls,['toggle','next','prev','play','pause','seek:12000']);assert.equal(calls.length,beforeSC,'SoundCloud commands never touch the YouTube engine');
widget=null;at(clock+1000);remote('toggle');assert.equal(calls.length,beforeSC);
console.log('PASS: SoundCloud media keys use the widget player');

// The YouTube page's own media session forwards to Cadence instead of running YouTube's queue.
const posted=[],handlers={};
class MediaSession{setActionHandler(action,handler){if(action==='skipad')throw new Error('unsupported');handlers[action]=handler;}}
const session=new MediaSession(),pageWindow={MediaSession,webkit:{messageHandlers:{cadenceMedia:{postMessage:m=>posted.push(m)}}}};
const bridge=fs.readFileSync('Resources/media-session-bridge.js','utf8');
vm.runInNewContext(bridge,{window:pageWindow,navigator:{mediaSession:session}});
for(const a of ['play','pause','nexttrack','previoustrack','seekto'])assert.equal(typeof handlers[a],'function',a+' is forwarded from the start');
let youtubeNext=0;session.setActionHandler('nexttrack',()=>youtubeNext++);session.setActionHandler('seekforward',()=>{});
assert.equal(session.setActionHandler('skipad',()=>{}),undefined,'Unsupported actions do not break the page');
handlers.nexttrack();handlers.previoustrack();handlers.play();handlers.pause();handlers.seekto({seekTime:30});handlers.seekto({seekTime:NaN});
assert.equal(youtubeNext,0,"YouTube's own Next handler is never used");assert.equal(handlers.seekforward,null);
assert.deepEqual(JSON.parse(JSON.stringify(posted)),[{command:'next'},{command:'previous'},{command:'play'},{command:'pause'},{command:'seek',position:30}]);
vm.runInNewContext(bridge,{window:pageWindow,navigator:{mediaSession:session}});handlers.nexttrack();assert.equal(posted.length,6,'Running twice does not double-wrap');
console.log('PASS: the YouTube page media session forwards play, pause, next, previous, and seek to Cadence');
