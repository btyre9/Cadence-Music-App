// Lyrics: the data-service lookup (mocked responses shaped like YouTube Music's) and the Lyrics tab.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const script=fs.readFileSync('Resources/youtube-browse.js','utf8');
function page(){
 const queue=[],requests=[];
 const ctx=vm.createContext({window:{ytcfg:{get:k=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB_REMIX'}},SESSION_INDEX:0})[k]}},document:{cookie:''},location:{origin:'https://music.youtube.com'},
  URL,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:globalThis.crypto,
  fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return{ok:true,status:200,json:async()=>queue.shift()};}});
 const fn=vm.runInContext(`(async(request)=>{${script}\n})`,ctx);
 return{queue,requests,run:request=>fn(request)};
}
const watch=(lyricsTab)=>({contents:{singleColumnMusicWatchNextResultsRenderer:{tabbedRenderer:{watchNextTabbedResultsRenderer:{tabs:[
 {tabRenderer:{title:'Up next',content:{}}},
 {tabRenderer:lyricsTab},
 {tabRenderer:{title:'Related',endpoint:{browseEndpoint:{browseId:'MPTRt_abc'}}}}]}}}}});
const lyricsPage={contents:{sectionListRenderer:{contents:[{musicDescriptionShelfRenderer:{description:{runs:[{text:'First line\r\nSecond line\n\nChorus'}]},footer:{runs:[{text:'Source: LyricFind'}]}}}]}}};
(async()=>{
 let p=page();p.queue.push(watch({title:'Lyrics',endpoint:{browseEndpoint:{browseId:'MPLYt_song'}}}),lyricsPage);
 let out=await p.run({op:'lyrics',videoId:'4IJI6soiQhI'});
 assert.equal(out.ok,true);assert.equal(out.lyrics,'First line\nSecond line\n\nChorus');assert.equal(out.source,'Source: LyricFind');
 assert.equal(p.requests[0].url,'/youtubei/v1/next?prettyPrint=false');assert.equal(p.requests[0].body.videoId,'4IJI6soiQhI');
 assert.equal(p.requests[1].url,'/youtubei/v1/browse?prettyPrint=false');assert.equal(p.requests[1].body.browseId,'MPLYt_song','Uses the Lyrics tab, not Related');
 // No Lyrics tab (instrumental, or YouTube has none): one request and a plain message.
 p=page();p.queue.push(watch({title:'Lyrics',unselectable:true}));out=await p.run({op:'lyrics',videoId:'4IJI6soiQhI'});
 assert.equal(out.ok,true);assert.equal(out.lyrics,'');assert.match(out.message,/No lyrics/);assert.equal(p.requests.length,1);
 // A Lyrics page with only a message.
 p=page();p.queue.push(watch({title:'Lyrics',endpoint:{browseEndpoint:{browseId:'MPLYt_song'}}}),{contents:{messageRenderer:{text:{runs:[{text:'Lyrics not available'}]}}}});
 out=await p.run({op:'lyrics',videoId:'4IJI6soiQhI'});assert.equal(out.lyrics,'');assert.equal(out.message,'Lyrics not available');
 p=page();out=await p.run({op:'lyrics',videoId:'bad id!'});assert.equal(out.ok,false);assert.equal(p.requests.length,0);
 console.log('PASS: lyrics come from the song’s Lyrics tab with their source credit; missing lyrics give a plain message; invalid songs send nothing');

 // The Lyrics tab asks once per song, caches, and follows the current song.
 class Element {constructor(){const set=new Set();this.classList={toggle(c,on){if(on===undefined?!set.has(c):on)set.add(c);else set.delete(c);},remove(c){set.delete(c);},add(c){set.add(c);},contains(c){return set.has(c);}};this.value='';this.dataset={};this.textContent='';}append(){}replaceChildren(){}replaceWith(){}setAttribute(){}querySelector(){return null;}}
 const elements=new Map(),calls=[];
 const context=vm.createContext({document:{getElementById:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement:()=>new Element(),querySelectorAll:()=>[]},window:{webkit:{messageHandlers:{cadence:{postMessage:x=>calls.push(x)}}}},localStorage:{getItem:()=>null,setItem:()=>{}},URL,setTimeout:()=>1,clearTimeout:()=>{},stopSoundCloudTracking:()=>{},attachSoundCloudTracking:()=>{},clearNowRelease:()=>{},updateNowRelease:()=>{},saveRadioPlaylist:()=>{}});
 vm.runInContext(fs.readFileSync('Resources/app.js','utf8'),context);
 const run=code=>vm.runInContext(code,context),asks=()=>calls.filter(c=>c.action==='lyrics'),text=()=>elements.get('lyrics-text').textContent;
 run(`$('lyrics-tab').onclick()`);assert.equal(elements.get('lyrics-panel').hidden,false);assert.equal(elements.get('queue-tracks').hidden,true);assert.match(text(),/Play a song/);assert.equal(asks().length,0);
 run(`playTrack({id:'songA123',title:'A',artist:'Artist',kind:'song'})`);assert.equal(asks().length,1);assert.equal(asks()[0].id,'songA123');assert.match(text(),/Finding/);
 run(`renderQueue();renderQueue();`);assert.equal(asks().length,1,'Asked once per song');
 run(`window.receive({event:'lyrics-result',payload:{ok:true,id:'songA123',requestID:${JSON.stringify(asks()[0].requestID)},lyrics:'Hello\\nWorld',source:'Source: LyricFind'}})`);
 assert.equal(text(),'Hello\nWorld');assert.equal(elements.get('lyrics-source').textContent,'Source: LyricFind');assert.equal(elements.get('lyrics-text').classList.contains('lyrics-message'),false);
 run(`playTrack({id:'songB123',title:'B',artist:'Artist',kind:'song'})`);assert.equal(asks().length,2);
 run(`window.receive({event:'lyrics-result',payload:{ok:true,id:'songA123',requestID:'stale',lyrics:'Old'}})`);assert.match(text(),/Finding/,'Stale answers are ignored');
 run(`window.receive({event:'lyrics-result',payload:{ok:false,id:'songB123',requestID:${JSON.stringify(asks()[1].requestID)},message:'YouTube Music is still loading.'}})`);assert.match(text(),/still loading/);
 run(`renderQueue()`);assert.equal(asks().length,2,'A failure is not retried in a loop');
 run(`$('lyrics-tab').onclick()`);assert.equal(asks().length,3,'Opening the tab again retries');
 run(`previousTrack()`);assert.equal(text(),'Hello\nWorld','Cached lyrics show instantly');assert.equal(asks().length,3);
 run(`$('queue-tab').onclick()`);assert.equal(elements.get('lyrics-panel').hidden,true);
 run(`$('lyrics-tab').onclick();source='soundcloud';renderQueue()`);assert.match(text(),/YouTube Music songs/);
 console.log('PASS: the Lyrics tab fetches once per song, caches, ignores stale answers, retries on request, and explains SoundCloud');
})().catch(e=>{console.error(e);process.exitCode=1;});
