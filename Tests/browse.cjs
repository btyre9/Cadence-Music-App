// Data-service catalog loader: parsing, pagination, sign-in, and music-only filtering.
// Fixtures are real anonymous YouTube Music responses (Nov 2026), stripped of tracking fields.
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const script=fs.readFileSync('Resources/youtube-browse.js','utf8');
const fixture=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(`Tests/fixtures/${name}.json.gz`)));
function page({cookie=''}={}){
 const queue=[],requests=[];
 const ctx=vm.createContext({window:{ytcfg:{get:k=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB_REMIX'}},SESSION_INDEX:0})[k]}},document:{cookie},location:{origin:'https://music.youtube.com'},
  URL,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:globalThis.crypto,
  fetch:async(url,options)=>{requests.push({url,headers:options.headers,body:JSON.parse(options.body)});return{ok:true,status:200,json:async()=>queue.shift()};}});
 const fn=vm.runInContext(`(async(request)=>{${script}\n})`,ctx);
 return{queue,requests,run:request=>fn(request)};
}
const all=data=>data.sections.flatMap(s=>s.items);
const notMusic=/MPSP|MPED|non_music_audio/;
(async()=>{
 // Search: grouped results, top-result songs credited to the artist, no podcasts.
 let p=page();p.queue.push(fixture('search'));
 let out=await p.run({op:'load',url:'https://music.youtube.com/search?q=radiohead'});
 assert.equal(out.ok,true);assert.equal(p.requests[0].url,'/youtubei/v1/search?prettyPrint=false');assert.equal(p.requests[0].body.query,'radiohead');
 const titles=out.data.sections.map(s=>s.title);
 for(const t of ['Top result','Songs','Albums','Artists','Playlists'])assert.ok(titles.includes(t),`missing ${t}`);
 for(const t of ['Episodes','Podcasts','Audiobooks'])assert.ok(!titles.includes(t),`${t} must be filtered`);
 assert.ok(all(out.data).every(i=>!notMusic.test(i.url)),'No podcast links in search');
 const top=out.data.sections[0].items;assert.equal(top[0].kind,'artist');assert.ok(top.slice(1).every(t=>t.kind==='song'&&t.artist==='Radiohead'));
 const karma=all(out.data).find(i=>i.title==='Karma Police');assert.equal(karma.id,'4IJI6soiQhI');assert.equal(karma.url,'https://music.youtube.com/watch?v=4IJI6soiQhI');assert.equal(karma.artist,'Radiohead');
 assert.ok(all(out.data).every(i=>i.url.startsWith('https://music.youtube.com/')&&(!i.art||i.art.startsWith('https://'))));
 assert.equal(out.more,false);
 // Album: header fields; track rows inherit artist and artwork; durations kept.
 p=page();p.queue.push(fixture('album'));out=await p.run({op:'load',url:'https://music.youtube.com/browse/MPREb_b9Yfli6Cg79'});
 assert.equal(out.data.title,'OK Computer OKNOTOK 1997 2017');assert.equal(out.data.subtitle,'Radiohead');assert.equal(out.data.releaseYear,'1997');assert.ok(out.data.art);
 const tracks=out.data.sections[0].items;assert.equal(tracks.length,23);assert.ok(tracks.every(t=>t.kind==='song'&&t.artist==='Radiohead'&&t.art&&/^\d+:\d{2}$/.test(t.duration)));
 // Large playlist: first 100 rows immediately, the rest appended page by page.
 p=page();p.queue.push(fixture('playlist'),fixture('playlist-continuation'));
 out=await p.run({op:'load',url:'https://music.youtube.com/playlist?list=PLwNv9Hhd8gZjNoQdpd2kBa3fwXNeJjzDX'});
 assert.equal(p.requests[0].body.browseId,'VLPLwNv9Hhd8gZjNoQdpd2kBa3fwXNeJjzDX');assert.equal(out.data.sections[0].items.length,100);assert.equal(out.more,true);
 out=await p.run({op:'more',token:out.token});
 assert.ok(p.requests[1].body.continuation,'Continuation token sent in the request body');assert.equal(out.data.sections[0].items.length,199);assert.equal(out.more,true);
 assert.equal(new Set(out.data.sections[0].items.map(t=>t.id)).size>150,true);
 const expired=await p.run({op:'more',token:'unknown'});assert.equal(expired.ok,false);assert.equal(expired.message,'Expired.');
 // Explore: no Podcasts button, no podcast episodes; mood categories keep their params.
 p=page();p.queue.push(fixture('explore'));out=await p.run({op:'load',url:'https://music.youtube.com/explore'});
 assert.ok(all(out.data).every(i=>!notMusic.test(i.url)&&i.title!=='Podcasts'));
 const mood=all(out.data).find(i=>i.title==='Chill');assert.match(mood.url,/FEmusic_moods_and_genres_category\?params=/);
 p=page();p.queue.push({contents:{}});await p.run({op:'load',url:mood.url});assert.ok(p.requests[0].body.params,'Category params round-trip');
 // Artist page: podcast shelves disappear, music shelves stay.
 p=page();p.queue.push(fixture('artist'));out=await p.run({op:'load',url:'https://music.youtube.com/browse/UCiMhD4jzUqG-IgPzUmmytRQ'});
 assert.equal(out.data.title,'Queen');assert.ok(out.data.description);
 assert.ok(!out.data.sections.some(s=>/episode|podcast/i.test(s.title)));assert.ok(out.data.sections.some(s=>s.title==='Albums'));
 // Home: more shelves are fetched after the first paint.
 p=page();p.queue.push(fixture('home'));out=await p.run({op:'load',url:'https://music.youtube.com/'});
 assert.equal(p.requests[0].body.browseId,'FEmusic_home');assert.ok(out.data.sections.length>=2);assert.equal(out.more,true);
 p.queue.push({continuationContents:{sectionListContinuation:{contents:fixture('home').contents.singleColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents}}});
 const firstCount=out.data.sections.length;out=await p.run({op:'more',token:out.token});
 assert.match(p.requests[1].url,/ctoken=.+&continuation=.+&type=next/);assert.ok(out.data.sections.length>firstCount);
 // Sign-in: authorization only when the page has a session; empty library asks to sign in.
 p=page();p.queue.push({contents:{}});out=await p.run({op:'load',url:'https://music.youtube.com/library'});
 assert.equal(p.requests[0].headers.Authorization,undefined);assert.equal(out.ok,false);assert.equal(out.empty,true);assert.match(out.message,/Sign in/);
 p=page({cookie:'SAPISID=abc; other=1'});p.queue.push(fixture('home'));out=await p.run({op:'load',url:'https://music.youtube.com/'});
 assert.match(p.requests[0].headers.Authorization,/^SAPISIDHASH \d+_[0-9a-f]{40}$/);assert.equal(out.data.signedIn,true);
 // The "New Episodes" auto-playlist is a podcast feed and is hidden; Liked Music stays.
 const shelf=list=>({contents:{singleColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{content:{sectionListRenderer:{contents:[{gridRenderer:{items:list}}]}}}}]}}});
 const card=(title,browseId)=>({musicTwoRowItemRenderer:{title:{runs:[{text:title}]},navigationEndpoint:{browseEndpoint:{browseId,browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_PLAYLIST'}}}}}});
 p=page({cookie:'SAPISID=abc'});p.queue.push(shelf([card('Liked Music','VLLM'),card('New Episodes','VLSE'),card('A Show',"MPSPPLx")]));out=await p.run({op:'load',url:'https://music.youtube.com/library'});
 assert.equal(JSON.stringify(all(out.data).map(i=>i.title)),'["Liked Music"]');
 // Only YouTube Music pages are accepted.
 out=await page().run({op:'load',url:'https://evil.example/browse/x'});assert.equal(out.ok,false);
 // Website-scraping fallback also skips podcast rows.
 const catalog=fs.readFileSync('Resources/youtube-catalog.js','utf8');
 const row=(title,href)=>{const link={href:'https://music.youtube.com/'+href,textContent:title,getAttribute:()=>href};return{data:{title:{runs:[{text:title}]}},textContent:title,getAttribute:()=>'',querySelector:s=>s.includes('title')?link:null,querySelectorAll:()=>[link]};};
 const rows=[row('Song','watch?v=abc12345'),row('A Podcast','browse/MPSPPLabc'),row('An Episode','browse/MPEDabc'),row('New Episodes','playlist?list=SE')];
 const scraped=vm.runInNewContext(catalog,{document:{querySelectorAll:s=>s.includes('carousel-shelf')?[]:rows,querySelector:()=>null},location:{origin:'https://music.youtube.com',href:'https://music.youtube.com/explore'},URL});
 assert.equal(JSON.stringify(scraped.sections[0].items.map(i=>i.title)),'["Song"]');
 console.log('PASS: data-service search/album/artist/explore/home parsing, playlist and home pagination, sign-in headers, page validation, and podcast/episode/audiobook filtering (data service and website fallback)');
})().catch(e=>{console.error(e);process.exit(1);});
