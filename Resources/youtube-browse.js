// Executed only in the signed-in catalog service page (callAsyncJavaScript, argument: request).
// Reads pages straight from YouTube Music's own data service instead of loading and scraping
// the website. Credentials stay in this page; only parsed catalog items are returned to Cadence.
const ORIGIN='https://music.youtube.com';
const TRACK_LIMIT=1000,CAROUSEL_LIMIT=60,EXTRA_SECTION_PAGES=3;
const clean=s=>(s||'').replace(/\s+/g,' ').trim();
const runs=x=>typeof x==='string'?x:(x?.runs||[]).map(r=>r.text||'').join('')||x?.simpleText||'';
const thumbs=x=>x?.musicThumbnailRenderer?.thumbnail?.thumbnails||x?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails||x?.thumbnails||[];
const https=u=>typeof u==='string'&&u.startsWith('https:')?u:'';
const largest=list=>https([...list].sort((a,b)=>(b.width||0)-(a.width||0))[0]?.url);
const pageType=e=>e?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType||'';
const TYPE_LABEL=/^(Song|Video|Episode|Album|Single|EP|Playlist|Artist|Profile|Podcast|Audiobook)$/;
// Cadence is music-only: podcasts, podcast episodes, and audiobooks are left out everywhere.
const NOT_MUSIC_TYPE=/PODCAST|NON_MUSIC_AUDIO|AUDIOBOOK/,NOT_MUSIC_ID=/^(MPSP|MPED|FEmusic_non_music_audio|FEmusic_podcast|VLSE$|VLRDPN)/,NOT_MUSIC_LABEL=/^(Episode|Podcast|Audiobook)$/;
const GROUPS={Song:'Songs',Video:'Videos',Episode:'Episodes',Album:'Albums',Single:'Albums',EP:'Albums',Playlist:'Playlists',Artist:'Artists',Profile:'Profiles',Podcast:'Podcasts',Audiobook:'Audiobooks'};
function find(root,key){const out=[];(function visit(v,depth){if(!v||typeof v!=='object'||depth>40)return;for(const [k,x] of Object.entries(v)){if(k===key)out.push(x);else visit(x,depth+1);}})(root,0);return out;}

async function api(path,body,query=''){
 const cfg=window.ytcfg;if(!cfg?.get)throw Error('YouTube Music is still loading.');
 const context=JSON.parse(JSON.stringify(cfg.get('INNERTUBE_CONTEXT')||{}));if(!context.client)throw Error('YouTube Music context unavailable.');
 const headers={'Content-Type':'application/json','X-Origin':location.origin,'X-Goog-AuthUser':String(cfg.get('SESSION_INDEX')||0)};
 const cookies=Object.fromEntries(document.cookie.split(';').map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1)];}));
 const sid=cookies.SAPISID||cookies['__Secure-3PAPISID']||cookies['__Secure-1PAPISID'];
 if(sid){const timestamp=Math.floor(Date.now()/1000);const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${timestamp} ${sid} ${location.origin}`));headers.Authorization=`SAPISIDHASH ${timestamp}_${[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}`;}
 const delegated=cfg.get('DELEGATED_SESSION_ID');if(delegated)headers['X-Goog-PageId']=delegated;
 const visitor=cfg.get('VISITOR_DATA');if(visitor)headers['X-Goog-Visitor-Id']=visitor;
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
 let response;try{response=await fetch(`/youtubei/v1/${path}?prettyPrint=false${query}`,{method:'POST',credentials:'include',headers,body:JSON.stringify({...body,context}),signal:controller.signal});}finally{clearTimeout(timeout);}
 if(!response.ok)throw Error(`YouTube Music returned ${response.status}.`);
 return {data:await response.json(),signedIn:!!sid};
}

function route(raw){
 const u=new URL(raw);if(u.origin!==ORIGIN)throw Error('Unsupported page.');
 const fixed={'/':'FEmusic_home','/explore':'FEmusic_explore','/library':'FEmusic_library_landing','/new_releases':'FEmusic_new_releases'};
 if(u.pathname==='/search'){const query=clean(u.searchParams.get('q'));if(!query)throw Error('Empty search.');return{path:'search',body:{query},kind:'search'};}
 if(fixed[u.pathname])return{path:'browse',body:{browseId:fixed[u.pathname]},kind:u.pathname==='/'?'home':'browse'};
 if(u.pathname==='/playlist'&&u.searchParams.get('list'))return{path:'browse',body:{browseId:'VL'+u.searchParams.get('list')},kind:'detail'};
 const m=u.pathname.match(/^\/(?:browse|channel)\/([^/]+)$/);
 if(m){const body={browseId:decodeURIComponent(m[1])};const params=u.searchParams.get('params');if(params)body.params=params;return{path:'browse',body,kind:/^FEmusic_/.test(body.browseId)?'browse':'detail'};}
 throw Error('Unsupported page.');
}

function kindOf(type,id){
 if(/ALBUM|AUDIOBOOK/.test(type))return'album';if(/PLAYLIST/.test(type))return'playlist';if(/ARTIST|USER_CHANNEL/.test(type))return'artist';
 if(!type){if(/^MPRE/.test(id))return'album';if(/^(VL|PL|RD|OLAK)/.test(id))return'playlist';if(/^UC/.test(id))return'artist';}
 return'collection';
}
function browseURL(b){
 if(!b?.browseId)return'';
 if(/^VL/.test(b.browseId)&&!b.params)return ORIGIN+'/playlist?list='+encodeURIComponent(b.browseId.slice(2));
 const u=new URL(ORIGIN+'/browse/'+encodeURIComponent(b.browseId));if(b.params)u.searchParams.set('params',b.params);return u.href;
}
const isArtistRun=r=>{const e=r.navigationEndpoint;return !!e?.browseEndpoint&&(/ARTIST|USER_CHANNEL/.test(pageType(e))||/^UC/.test(e.browseEndpoint.browseId||''));};

// Normalizes every renderer into Cadence's catalog item shape.
function finish(o){
 if(NOT_MUSIC_TYPE.test(o.type||'')||NOT_MUSIC_TYPE.test(o.titleType||'')||NOT_MUSIC_ID.test(o.browse?.browseId||'')||NOT_MUSIC_LABEL.test((o.subtitle||'').split(' • ')[0].trim()))return null;
 const song=!!o.videoId&&!o.browse;
 if(!o.title||(!song&&!o.browse?.browseId))return null;
 const kind=song?'song':kindOf(o.type||'',o.browse.browseId);
 const url=song?ORIGIN+'/watch?v='+encodeURIComponent(o.videoId):browseURL(o.browse);if(!url)return null;
 const parts=(o.subtitle||'').split(' • ').map(clean).filter(Boolean);
 let artist=[...new Set((o.subRuns||[]).filter(isArtistRun).map(r=>clean(r.text)).filter(Boolean))].join(' & ');
 // Unlinked names: skip the type label, durations, dates, and play/view counts.
 if(!artist&&song)artist=parts.filter((p,i)=>!(i===0&&TYPE_LABEL.test(p))&&!/^\d{1,2}:\d{2}|^\d{4}$|^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d|\b(plays|views|subscribers|listeners|audience|songs|tracks|episodes)\b|\bago$/i.test(p))[0]||'';
 const duration=o.duration||parts.find(p=>/^\d{1,2}:\d{2}(?::\d{2})?$/.test(p))||'';
 const id=song?o.videoId:(new URL(url).searchParams.get('list')||o.browse.browseId);
 return {id,title:o.title,artist,subtitle:o.subtitle||'',art:https(o.art),url,kind,duration,label:TYPE_LABEL.test(parts[0]||'')?parts[0]:''};
}
function listItem(r){
 if(r.musicItemRendererDisplayPolicy==='MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT')return null;
 const cols=(r.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text||{});
 const nav=r.navigationEndpoint,titleNav=cols[0]?.runs?.[0]?.navigationEndpoint;
 const play=r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
 const videoId=r.playlistItemData?.videoId||titleNav?.watchEndpoint?.videoId||(!nav?.browseEndpoint&&play?.watchEndpoint?.videoId)||'';
 return finish({title:clean(runs(cols[0])),videoId,browse:videoId?null:nav?.browseEndpoint,type:pageType(nav),subRuns:cols[1]?.runs||[],subtitle:clean(runs(cols[1])),titleType:pageType(titleNav),
  duration:clean(runs(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)),art:thumbs(r.thumbnail).at(-1)?.url});
}
function twoRow(r){const nav=r.navigationEndpoint||{};return finish({title:clean(runs(r.title)),videoId:nav.watchEndpoint?.videoId,browse:nav.browseEndpoint,type:pageType(nav),subRuns:r.subtitle?.runs||[],subtitle:clean(runs(r.subtitle)),art:thumbs(r.thumbnailRenderer).at(-1)?.url});}
function navButton(r){return finish({title:clean(runs(r.buttonText)),browse:r.clickCommand?.browseEndpoint,subtitle:''});}
function card(r){const nav=r.onTap||r.title?.runs?.[0]?.navigationEndpoint||{};return finish({titleType:pageType(r.title?.runs?.[0]?.navigationEndpoint),title:clean(runs(r.title)),videoId:nav.watchEndpoint?.videoId,browse:nav.browseEndpoint,type:pageType(nav),subRuns:r.subtitle?.runs||[],subtitle:clean(runs(r.subtitle)),art:thumbs(r.thumbnail).at(-1)?.url});}
function item(entry){
 const [key,r]=Object.entries(entry||{})[0]||[];
 if(key==='musicResponsiveListItemRenderer')return listItem(r);if(key==='musicTwoRowItemRenderer')return twoRow(r);
 if(key==='musicNavigationButtonRenderer')return navButton(r);
 // musicMultiRowListItemRenderer is only used for podcast episodes, so it is skipped.
 return null;
}
function continuationOf(list){const c=list?.at?.(-1)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;return c?{token:c,style:'command'}:null;}
function nextOf(x){const c=x?.continuations?.[0]?.nextContinuationData?.continuation;return c?{token:c,style:'next'}:null;}

// Appends parsed shelves to page.sections; remembers the main track list's continuation.
function readShelves(entries,page,state){
 const add=(title,list,limit,track)=>{
  const items=(list||[]).map(item).filter(Boolean).slice(0,limit);
  if(!items.length)return;
  const section={title:clean(title)||(items.every(i=>i.kind==='song')?'Tracks':'Browse'),items};
  page.sections.push(section);
  if(track&&state&&!state.tracks){const more=continuationOf(list)||nextOf(track);if(more)state.tracks={...more,section:page.sections.length-1};}
 };
 for(const entry of entries||[]){
  const [key,v]=Object.entries(entry||{})[0]||[];if(!v)continue;
  if(key==='musicCarouselShelfRenderer')add(runs(v.header?.musicCarouselShelfBasicHeaderRenderer?.title),v.contents,CAROUSEL_LIMIT);
  else if(key==='musicShelfRenderer')add(runs(v.title),v.contents,TRACK_LIMIT,v);
  else if(key==='musicPlaylistShelfRenderer')add('Tracks',v.contents,TRACK_LIMIT,v);
  else if(key==='gridRenderer')add(runs(v.header?.gridHeaderRenderer?.title),v.items,200);
  else if(key==='musicCardShelfRenderer'){
   const top=card(v);const rows=(v.contents||[]).map(item).filter(Boolean);
   // Songs listed under an artist's top-result card belong to that artist.
   if(top?.kind==='artist')for(const t of rows)if(t.kind==='song'&&!t.artist)t.artist=top.title;
   const items=[top,...rows].filter(Boolean);if(items.length)page.sections.push({title:'Top result',items});
  }
  else if(key==='musicDescriptionShelfRenderer'){if(!page.description)page.description=clean(runs(v.description));}
  else if(key==='itemSectionRenderer'){
   // Current search pages list one result per section without shelf titles: group them by type.
   for(const child of v.contents||[]){const parsed=item(child);if(parsed){const title=GROUPS[parsed.label]||'Results';let section=page.sections.find(s=>s.title===title);if(!section)page.sections.push(section={title,items:[]});section.items.push(parsed);}
    else readShelves([child],page,state);}
  }
  else if(key==='musicMessageRenderer'||key==='messageRenderer'){page.message=clean(runs(v.text)||runs(v.title));}
 }
}

function readHeader(data,page){
 const h=find(data,'musicResponsiveHeaderRenderer')[0]||data.header?.musicImmersiveHeaderRenderer||data.header?.musicVisualHeaderRenderer||data.header?.musicDetailHeaderRenderer||find(data.contents,'musicDetailHeaderRenderer')[0]||data.header?.musicHeaderRenderer||{};
 const strap=clean(runs(h.straplineTextOne)),sub=clean(runs(h.subtitle)),second=clean(runs(h.secondSubtitle));
 page.title=clean(runs(h.title));page.subtitle=strap||sub;
 page.description=clean(runs(h.description?.musicDescriptionShelfRenderer?.description)||runs(h.description));
 page.art=largest(thumbs(h.thumbnail))||largest(thumbs(h.foregroundThumbnail));
 page.releaseYear=`${sub} ${second}`.match(/\b(?:19|20)\d{2}\b/)?.[0]||'';
 return strap;
}

function parse(data,url,state){
 const page={url,title:'',subtitle:'',description:'',art:'',releaseYear:'',sections:[],message:''};
 const albumArtist=readHeader(data,page);
 for(const list of find(data.contents,'sectionListRenderer')){readShelves(list.contents,page,state);if(state&&!state.sections)state.sections=nextOf(list);}
 // Album track rows omit artwork and often the artist: inherit them from the page header.
 if(page.title)for(const s of page.sections)for(const t of s.items)if(t.kind==='song'){if(!t.artist)t.artist=albumArtist;if(!t.art)t.art=page.art;}
 for(const s of page.sections)for(const t of s.items)delete t.label;
 return page;
}

async function fetchMore(state){
 const page=state.page;
 if(state.tracks){
  const {token,style,section}=state.tracks;state.tracks=null;
  const {data}=style==='command'?await api('browse',{continuation:token}):await api('browse',{},`&ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next`);
  const appended=find(data,'appendContinuationItemsAction').flatMap(a=>a.continuationItems||[]);
  const legacy=data.continuationContents?.musicPlaylistShelfContinuation||data.continuationContents?.musicShelfContinuation;
  const list=appended.length?appended:legacy?.contents||[];
  const target=page.sections[section];const fresh=list.map(item).filter(Boolean);
  const title=page.title,artist=page.subtitle;
  for(const t of fresh)if(t.kind==='song'){if(!t.art)t.art=page.art;if(!t.artist&&title)t.artist=artist;}
  for(const t of fresh)delete t.label;
  target.items.push(...fresh.slice(0,TRACK_LIMIT-target.items.length));
  const next=continuationOf(list)||nextOf(legacy);
  if(next&&target.items.length<TRACK_LIMIT)state.tracks={...next,section};
 }else if(state.sections&&state.sectionPages<EXTRA_SECTION_PAGES){
  const {token}=state.sections;state.sections=null;state.sectionPages++;
  const {data}=await api('browse',{},`&ctoken=${encodeURIComponent(token)}&continuation=${encodeURIComponent(token)}&type=next`);
  const cont=data.continuationContents?.sectionListContinuation;
  const entries=cont?.contents||find(data,'appendContinuationItemsAction').flatMap(a=>a.continuationItems||[]);
  const before=page.sections.length;readShelves(entries,page,null);
  for(const s of page.sections.slice(before))for(const t of s.items)delete t.label;
  state.sections=nextOf(cont);
 }
}
const hasMore=state=>!!state.tracks||(!!state.sections&&state.sectionPages<EXTRA_SECTION_PAGES);

async function execute(request){
 const store=window.__cadenceBrowse||(window.__cadenceBrowse={});
 if(request.op==='more'){
  const state=store[request.token];if(!state)return{ok:false,message:'Expired.'};
  await fetchMore(state);const more=hasMore(state);if(!more)delete store[request.token];
  return{ok:true,data:state.page,more,token:request.token};
 }
 const target=route(request.url);
 const {data,signedIn}=await api(target.path,target.body);
 const state={tracks:null,sections:null,sectionPages:0};
 const page=parse(data,request.url,state);
 // Search and detail pages are complete without their (unrelated) section continuations.
 if(target.kind!=='home'&&target.kind!=='browse')state.sections=null;
 if(!page.sections.length&&!page.title){
  const library=target.body.browseId==='FEmusic_library_landing';
  return{ok:false,empty:true,message:!signedIn&&library?'Sign in through Account to see your library, then refresh.':page.message||'Nothing to show on this page yet.'};
 }
 page.signedIn=signedIn;page.needsSignIn=false;page.empty=false;page.source='api';
 for(const key of Object.keys(store))if(Date.now()-Number(key.split(':')[0])>600000)delete store[key];
 const token=`${Date.now()}:${Math.random().toString(36).slice(2)}`;
 const more=hasMore(state);if(more){state.page=page;store[token]=state;}
 return{ok:true,data:page,more,token};
}
try{return await execute(request);}catch(error){return{ok:false,message:error?.name==='AbortError'?'YouTube Music took too long to respond.':String(error?.message||error)};}
