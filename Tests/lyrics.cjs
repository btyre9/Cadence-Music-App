// Lyrics loader: follows the "next" response to the lyrics page and reads its text.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const script=fs.readFileSync('Resources/youtube-lyrics.js','utf8');
function page(responses,{cookie=''}={}){
 const requests=[];
 const ctx=vm.createContext({window:{ytcfg:{get:k=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB_REMIX'}},SESSION_INDEX:0})[k]}},document:{cookie},location:{origin:'https://music.youtube.com'},
  AbortController,setTimeout,clearTimeout,TextEncoder,crypto:globalThis.crypto,
  fetch:async(url,options)=>{requests.push({url,headers:options.headers,body:JSON.parse(options.body)});const r=responses.shift();return r instanceof Error?Promise.reject(r):{ok:true,status:200,json:async()=>r};}});
 const fn=vm.runInContext(`(async(request)=>{${script}\n})`,ctx);
 return{requests,run:r=>fn(r)};
}
const next=browseId=>({contents:{singleColumnMusicWatchNextResultsRenderer:{tabbedRenderer:{watchNextTabbedResultsRenderer:{tabs:[{tabRenderer:{title:{runs:[{text:'Up next'}]}}},browseId?{tabRenderer:{title:{runs:[{text:'Lyrics'}]},endpoint:{browseEndpoint:{browseId}}}}:{tabRenderer:{title:{runs:[{text:'Lyrics'}]},unselectable:true}}]}}}}});
const lyricsPage={contents:{sectionListRenderer:{contents:[{musicDescriptionShelfRenderer:{description:{runs:[{text:'First line\r\nSecond line\n\nNext verse'}]},footer:{runs:[{text:'Source: Example Lyrics'}]}}}]}}};
(async()=>{
 let p=page([next('MPLYt_abc123'),lyricsPage]);let r=await p.run({videoId:'4IJI6soiQhI'});
 assert.equal(r.ok,true);assert.equal(r.lyrics,'First line\nSecond line\n\nNext verse');assert.equal(r.source,'Source: Example Lyrics');assert.equal(r.videoId,'4IJI6soiQhI');
 assert.ok(p.requests[0].url.startsWith('/youtubei/v1/next'));assert.equal(p.requests[0].body.videoId,'4IJI6soiQhI');assert.equal(p.requests[1].body.browseId,'MPLYt_abc123');
 assert.equal(p.requests[0].headers.Authorization,undefined,'No sign-in needed');
 p=page([next(null)]);r=await p.run({videoId:'4IJI6soiQhI'});assert.equal(r.ok,false);assert.equal(r.missing,true);assert.equal(p.requests.length,1,'No lyrics page, no second request');
 p=page([next('MPLYt_abc123'),{contents:{}}]);r=await p.run({videoId:'4IJI6soiQhI'});assert.equal(r.missing,true);
 p=page([new Error('offline')]);r=await p.run({videoId:'4IJI6soiQhI'});assert.equal(r.ok,false);assert.ok(!r.missing,'Network errors can be retried');
 p=page([]);r=await p.run({videoId:'bad id!'});assert.equal(r.ok,false);assert.equal(p.requests.length,0);
 p=page([next('MPLYt_abc123'),lyricsPage],{cookie:'SAPISID=abc'});await p.run({videoId:'4IJI6soiQhI'});assert.match(p.requests[0].headers.Authorization,/^SAPISIDHASH /);
 console.log('PASS: lyrics lookup through the lyrics tab, missing lyrics, retryable errors, ID validation, and signed-in headers');
})().catch(e=>{console.error(e);process.exit(1);});
