// Builds sample pages for the browser preview (Tools/preview-server.py) by running the real
// data-service parser over the test fixtures. Prints one JSON object keyed by page.
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
const script=fs.readFileSync('Resources/youtube-browse.js','utf8');
const fixture=name=>JSON.parse(zlib.gunzipSync(fs.readFileSync(`Tests/fixtures/${name}.json.gz`)));
function page(){
 const queue=[];
 const ctx=vm.createContext({window:{ytcfg:{get:k=>({INNERTUBE_CONTEXT:{client:{clientName:'WEB_REMIX'}},SESSION_INDEX:0})[k]}},document:{cookie:''},location:{origin:'https://music.youtube.com'},
  URL,AbortController,setTimeout,clearTimeout,TextEncoder,crypto:globalThis.crypto,
  fetch:async()=>({ok:true,status:200,json:async()=>queue.shift()})});
 const fn=vm.runInContext(`(async(request)=>{${script}\n})`,ctx);
 return{queue,run:request=>fn(request)};
}
async function load(name,url,more=[]){
 const p=page();p.queue.push(fixture(name),...more.map(fixture));
 let out=await p.run({op:'load',url});
 for(let i=0;i<more.length&&out.more;i++)out=await p.run({op:'more',token:out.token});
 return out.data;
}
(async()=>{
 const data={
  home:await load('home','https://music.youtube.com/'),
  search:await load('search','https://music.youtube.com/search?q=radiohead'),
  album:await load('album','https://music.youtube.com/browse/MPREb_b9Yfli6Cg79'),
  playlist:await load('playlist','https://music.youtube.com/playlist?list=PLwNv9Hhd8gZjNoQdpd2kBa3fwXNeJjzDX',['playlist-continuation']),
  explore:await load('explore','https://music.youtube.com/explore'),
  artist:await load('artist','https://music.youtube.com/browse/UCiMhD4jzUqG-IgPzUmmytRQ'),
 };
 // No library fixture (it needs sign-in): show the albums and playlists from the other pages instead.
 const cards=[...data.search.sections,...data.home.sections].flatMap(s=>s.items).filter(i=>i.kind==='album'||i.kind==='playlist');
 data.library={...data.home,title:'Library',sections:[{title:'Sample library (preview)',items:cards.slice(0,24)}]};
 process.stdout.write(JSON.stringify(data));
})().catch(e=>{console.error(e);process.exit(1);});
