'use strict';
const $=id=>document.getElementById(id);
function read(k,d){try{return JSON.parse(localStorage.getItem(k))??d;}catch{return d;}}
function write(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{toast('Could not save preferences on this Mac.');}}
function native(action,args={}){window.webkit?.messageHandlers?.cadence?.postMessage({action,...args});}
let saved=read('cadence.saved',[]);if(!Array.isArray(saved))saved=[];saved=saved.filter(t=>t&&typeof t.id==='string'&&typeof t.title==='string'&&typeof t.artist==='string');
let tracks=[],page='home',source='none',waiting=false,toastTimer,recTimer,queue=[],played=[],current=null,playing=false,wasPlaying=false,lastPosition=0,lastDuration=0,endedFor='',filter='all',catalogData=null,catalogSignature='',catalogURL='https://music.youtube.com/',catalogTrail=[],catalogLabel='Home',railTab='queue',seeking=false,shuffleOn=false,repeatMode='off',playlistCycle=[],pendingTrackId='',pendingSince=0;
let radioMode=false,radioSeed=null;
const catalogCache=new Map();
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function button(text,label,fn,cls=''){const b=el('button',cls,text);if(label)b.setAttribute('aria-label',label);b.onclick=fn;return b;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),6500);}
function pauseSoundCloud(){stopSoundCloudTracking();const f=$('sc-player').querySelector('iframe');if(f){f.src='about:blank';f.remove();$('sc-player').replaceChildren(el('p','','SoundCloud playback stopped. Load your link to resume.'));}}
function navigate(next){
 if(next==='home'||next==='youtube'||next==='library'){
   page='home';const url=next==='library'?'https://music.youtube.com/library':next==='youtube'?'https://music.youtube.com/explore':'https://music.youtube.com/';
   catalogLabel=next==='library'?'Your library':next==='youtube'?'Explore':'Home';showPage('home',next);browse(url);return;
 }
 if(!$(next)?.classList.contains('page'))return;page=next;showPage(next,next);
}
function showPage(id,nav){document.querySelectorAll('.page').forEach(e=>e.classList.toggle('active',e.id===id));document.querySelectorAll('.nav').forEach(e=>e.classList.toggle('active',e.dataset.page===nav));}
function browse(url,push=true,force=false){if(push&&url!==catalogURL)catalogTrail.push({url:catalogURL,label:catalogLabel});catalogURL=url;catalogSignature='';catalogData=null;filter='all';$('home').classList.remove('detail-view');page='home';showPage('home',url.includes('/library')?'library':url.includes('/explore')?'youtube':'home');$('catalog-sections').replaceChildren();$('catalog-detail').replaceChildren();$('catalog-title').textContent=catalogLabel;$('catalog-subtitle').textContent=url.includes('/search')?'Find your next song, album, or artist.':'Your YouTube Music, in Cadence.';setCatalogState('Loading music…');renderFilters();const cached=catalogCache.get(url);if(!force&&cached&&Date.now()-cached.time<90000){renderCatalog(cached.data);return;}native('catalog',{url});}
function setCatalogState(message,error=false){$('catalog-state').hidden=!message;$('catalog-state').textContent=message;$('catalog-state').classList.toggle('error',error);}
function search(query){catalogLabel='Search results';const u=new URL('https://music.youtube.com/search');u.searchParams.set('q',query);browse(u.href);}
function safeArt(raw){try{const u=new URL(raw);return u.protocol==='https:'&&(/(^|\.)googleusercontent\.com$|(^|\.)ytimg\.com$|(^|\.)archive\.org$|^coverartarchive\.org$/.test(u.hostname));}catch{return false;}}
function artwork(t,cls='cover'){const c=el('div',cls,'♪');if(safeArt(t.art)){const img=el('img');img.src=t.art;img.alt=t.title?`${t.title} artwork`:'Album artwork';img.loading='lazy';img.onerror=()=>img.remove();c.append(img);}return c;}
function playTrack(t,continuing=false){if(!t||t.kind!=='song')return;if(source==='soundcloud')pauseSoundCloud();if(!continuing)playlistCycle=[t,...queue];if(current)played.push(current);current=t;source='youtube';clearNowRelease();radioMode=false;radioSeed=null;endedFor='';wasPlaying=false;lastPosition=0;lastDuration=0;playing=false;$('now-title').textContent=t.title;$('now-artist').textContent=t.artist||t.subtitle||'YouTube Music';$('now-art').replaceWith(Object.assign(artwork(t,'mini-art'),{id:'now-art'}));pendingTrackId=t.id;pendingSince=Date.now();native('play-track',{id:t.id});updateControls();renderQueue();}
function addQueue(t){queue.push(t);if(playlistCycle.length)playlistCycle.push(t);renderQueue();toast(`Added ${t.title} to the queue.`);}
function shuffled(list){const result=[...list];for(let i=result.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
function startPlaylist(songs,mix=shuffleOn){if(!songs.length)return;playlistCycle=[...songs];shuffleOn=mix;const order=mix?shuffled(songs):[...songs];queue=order.slice(1);playTrack(order[0],true);updateModes();}
function nextTrack(){if(!queue.length&&repeatMode==='all'&&playlistCycle.length){const order=shuffleOn?shuffled(playlistCycle):[...playlistCycle];queue=order;}if(queue.length){const t=queue.shift();playTrack(t,true);}else native('next');renderQueue();}
function previousTrack(){if(played.length){const prior=played.pop();current=null;playTrack(prior,true);}else native('previous');}
// Media keys, AirPods, and Control Center. YouTube commands run exactly like the footer buttons; SoundCloud uses its widget.
let lastRemote={command:'',time:0},nowPlayingSent=null;
function remoteCommand(command,position){
 const now=Date.now();if(command!=='seek'&&command===lastRemote.command&&now-lastRemote.time<350)return;lastRemote={command,time:now};
 if(source==='soundcloud'){const w=typeof soundcloudWidget==='function'?soundcloudWidget():null;if(!w)return;
  if(command==='play')w.play();else if(command==='pause')w.pause();else if(command==='toggle')w.toggle();else if(command==='next')w.next();else if(command==='previous')w.prev();else if(command==='seek'&&Number.isFinite(position))w.seekTo(Math.max(0,position)*1000);return;}
 if(source!=='youtube')return;
 if(command==='play'){playing=true;updateControls();native('play');}
 else if(command==='pause'){playing=false;updateControls();native('pause');}
 else if(command==='toggle')$('toggle').onclick();
 else if(command==='next')nextTrack();
 else if(command==='previous')previousTrack();
 else if(command==='seek'&&Number.isFinite(position)&&position>=0&&!$('seek').disabled){native('seek',{seconds:position});$('seek').value=position;$('elapsed').textContent=formatTime(position);}
}
// Larger artwork for Now Playing than the footer thumbnail.
function hiResArt(raw){if(!raw)return '';try{const u=new URL(raw);if(u.protocol!=='https:')return '';if(/(^|\.)googleusercontent\.com$/.test(u.hostname))return raw.replace(/=w\d+-h\d+([-a-z0-9]*)$/i,'=w544-h544$1');if(/(^|\.)sndcdn\.com$/.test(u.hostname))return raw.replace(/-(large|t\d+x\d+|crop)\.(jpg|png)$/,'-t500x500.$2');return raw;}catch{return '';}}
// Tells macOS what's playing. Unchanged updates are skipped; the system advances the clock itself while playing.
function reportNowPlaying(info){
 const position=Number.isFinite(info.position)?info.position:0,duration=Number.isFinite(info.duration)?info.duration:0,now=Date.now();
 const key=JSON.stringify([info.title,info.artist,info.album||'',info.art||'',Math.round(duration),!!info.playing,!!info.canSeek]);
 if(nowPlayingSent&&nowPlayingSent.key===key){const expected=nowPlayingSent.position+(info.playing?(now-nowPlayingSent.time)/1000:0);if(Math.abs(position-expected)<2)return;}
 nowPlayingSent={key,position,time:now};
 native('now-playing',{title:info.title,artist:info.artist||'',album:info.album||'',art:info.art||'',duration,position,playing:!!info.playing,canSeek:!!info.canSeek});
}
function updateModes(){$('shuffle').classList.toggle('mode-active',shuffleOn);$('shuffle').setAttribute('aria-pressed',String(shuffleOn));$('repeat').classList.toggle('mode-active',repeatMode!=='off');$('repeat').textContent=repeatMode==='one'?'↻¹':'↻';$('repeat').setAttribute('aria-label','Repeat: '+repeatMode+'; click to change');$('repeat').setAttribute('aria-pressed',String(repeatMode!=='off'));}
function cycleRepeat(){repeatMode=repeatMode==='off'?'all':repeatMode==='all'?'one':'off';native('repeat-one',{enabled:repeatMode==='one'});updateModes();toast(repeatMode==='one'?'Repeat this song':repeatMode==='all'?'Repeat playlist / queue':'Repeat off');}
function toggleShuffle(){shuffleOn=!shuffleOn;if(shuffleOn){if(!playlistCycle.length&&current)playlistCycle=[current,...queue];queue=shuffled(queue);}else if(playlistCycle.length){const remaining=[...queue];queue=[];for(const t of playlistCycle){const i=remaining.findIndex(x=>x===t);if(i>=0)queue.push(...remaining.splice(i,1));}queue.push(...remaining);}updateModes();renderQueue();}

function openItem(t){if(t.kind==='song'){playTrack(t);}else{catalogLabel=t.title;browse(t.url);}}
function openTrack(t){search(`${t.artist} ${t.title}`);toast('Choose the matching recording from these results.');}
function updateControls(){$('create-radio').disabled=source!=='youtube'||!current?.id;['previous','toggle','next'].forEach(id=>$(id).disabled=source!=='youtube');$('toggle').textContent=playing?'Ⅱ':'▷';$('player-label').textContent=source==='soundcloud'?'SOUNDCLOUD PLAYER':source==='youtube'?'YOUTUBE MUSIC':'READY TO LISTEN';}
function formatTime(n){return Number.isFinite(n)?`${Math.floor(n/60)}:${String(Math.floor(n%60)).padStart(2,'0')}`:'0:00';}
function toggleSave(t){const i=saved.findIndex(x=>x.id===t.id);if(i>=0)saved.splice(i,1);else saved.unshift(t);write('cadence.saved',saved);renderSaved();renderTracks($('recommendations'),tracks);}
function renderTracks(container,list){container.replaceChildren();for(const t of list){const c=el('article','track-card');c.append(artwork(t),el('h3','',t.title),el('p','',t.artist));const a=el('div','track-actions');a.append(button(t.kind==='song'?'Play':'Find song ↗',`Play ${t.title}`,()=>t.kind==='song'?playTrack(t):openTrack(t)));const yes=saved.some(x=>x.id===t.id);a.append(button(yes?'♥':'♡',`${yes?'Unsave':'Save'} ${t.title}`,()=>toggleSave(t),'heart'+(yes?' hearted':'')));c.append(a);container.append(c);}}
function renderSaved(){$('saved-count').textContent=saved.length;$('rail-count').textContent=String(saved.length).padStart(2,'0');$('saved-empty').hidden=saved.length>0;renderTracks($('saved-tracks'),saved);$('rail-tracks').replaceChildren();saved.forEach(t=>{const b=button('',`Find ${t.title}`,()=>t.kind==='song'?playTrack(t):openTrack(t),'rail-track');const info=el('div');info.append(el('strong','',t.title),el('small','',t.artist));b.append(artwork(t,'mini-art'),info);$('rail-tracks').append(b);});renderQueue();}
function renderQueue(){if(radioMode){$('queue-count').textContent='RADIO';$('queue-tracks').replaceChildren(el('div','queue-now',`Station based on ${radioSeed.title}`),el('p','dialog-description','Similar songs are selected by YouTube Music. Use Next to explore the station.'),button('Save Radio as Playlist',null,saveRadioPlaylist,'primary save-radio'));$('queue-tracks').hidden=railTab!=='queue';$('rail-tracks').hidden=railTab!=='saved';$('rail-empty').hidden=true;return;}$('queue-count').textContent=String(queue.length).padStart(2,'0');$('queue-tracks').replaceChildren();if(current){const now=el('div','queue-now');now.append(el('div','eyebrow','NOW PLAYING'),el('strong','',current.title),el('small','',current.artist||'YouTube Music'));$('queue-tracks').append(now);}queue.forEach((t,i)=>{const row=el('div','queued-row');const b=button('',`Play queued ${t.title}`,()=>{queue.splice(i,1);playTrack(t,true);},'rail-track');const info=el('div');info.append(el('strong','',t.title),el('small','',t.artist||t.subtitle||''));b.append(artwork(t,'mini-art'),info);row.append(b,button('×',`Remove ${t.title} from queue`,()=>{queue.splice(i,1);const cycleIndex=playlistCycle.lastIndexOf(t);if(cycleIndex>=0)playlistCycle.splice(cycleIndex,1);renderQueue();},'remove-queued'));$('queue-tracks').append(row);});$('queue-tracks').hidden=railTab!=='queue';$('rail-tracks').hidden=railTab!=='saved';$('rail-empty').hidden=railTab==='queue'?(queue.length>0||!!current):saved.length>0;$('queue-tab').classList.toggle('selected',railTab==='queue');$('saved-tab').classList.toggle('selected',railTab==='saved');}
function renderFilters(){document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected-filter',b.dataset.filter===filter));}
function renderCatalog(data){
 const signature=JSON.stringify(data);if(signature===catalogSignature)return;catalogSignature=signature;catalogData=data;setCatalogState('');
 $('catalog-title').textContent=data.title||catalogLabel;$('catalog-subtitle').textContent=data.subtitle|| (catalogURL.includes('/search')?`${new URL(catalogURL).searchParams.get('q')||''} · YouTube Music`:'Your collection. Your interface.');
 const detail=!!data.title&&(catalogURL.includes('/browse/')||catalogURL.includes('/playlist'));$('home').classList.toggle('detail-view',detail);$('catalog-detail').replaceChildren();
 if(detail){const panel=el('div','album-panel');panel.append(artwork({art:data.art,title:data.title},'album-cover'));const copy=el('div','album-copy');copy.append(el('div','eyebrow',data.subtitle||'YOUTUBE MUSIC'),el('h2','',data.title));if(data.description)copy.append(el('p','',data.description.slice(0,400)));const songs=data.sections.flatMap(s=>s.items).filter(t=>t.kind==='song');const controls=el('div','album-actions');if(songs.length){controls.append(button('▷ Play',`Play ${data.title}`,()=>startPlaylist(songs),'primary'),button('⤨ Shuffle',`Shuffle ${data.title}`,()=>startPlaylist(songs,true)),button('+ Queue tracks',`Queue ${data.title}`,()=>{queue.push(...songs);renderQueue();toast('Added tracks to your queue.');}));}if(data.url&&/\/playlist\?|\/browse\/VL|\/channel\//.test(data.url))controls.append(button('Manage',`Manage ${data.title}`,()=>manageItem({url:data.url,title:data.title}),'manage-detail'));controls.append(button('ⓘ Info',`Release information for ${data.title}`,()=>showMusicInfo({title:data.title,artist:data.subtitle||'',kind:'album',year:data.releaseYear||''})));copy.append(controls);panel.append(copy);$('catalog-detail').append(panel);}
 const container=$('catalog-sections');container.replaceChildren();let count=0;
 for(const section of data.sections){const items=section.items.filter(t=>filter==='all'||t.kind===filter);if(!items.length)continue;count+=items.length;const group=el('section','music-section');group.append(el('h2','',section.title));
 const songs=items.filter(t=>t.kind==='song'),others=items.filter(t=>t.kind!=='song');
 if(songs.length){const list=el('div','song-table');songs.forEach((t,i)=>{const row=el('div','song-row');const play=button('▷',`Play ${t.title}`,()=>playTrack(t),'row-play');const info=button('',`Play ${t.title}`,()=>playTrack(t),'song-name');info.append(el('strong','',t.title),el('small','',t.artist||t.subtitle||'YouTube Music'));row.append(el('span','song-number',String(i+1).padStart(2,'0')),play,artwork(t,'song-art'),info,el('span','song-duration',t.duration||''),button('+',`Add ${t.title} to queue`,()=>addQueue(t),'row-add'),button('♡',`Save ${t.title}`,()=>toggleSave(t),'row-save'),button('⋯',`Add ${t.title} to a playlist`,()=>choosePlaylist(t),'row-playlist'),button('ⓘ',`Release information for ${t.title}`,()=>showMusicInfo({...t,year:detail?data.releaseYear||'':''}),'row-info'));list.append(row);});group.append(list);}
 if(others.length){const grid=el('div','catalog-grid');others.forEach(t=>{const c=button('',`Open ${t.title}`,()=>openItem(t),'catalog-card');c.append(artwork(t),el('h3','',t.title),el('p','',t.artist||t.subtitle||t.kind));const wrapper=el('div','catalog-item');wrapper.append(c,button('⋯',`Manage ${t.title}`,()=>manageItem(t),'manage-card'));grid.append(wrapper);});group.append(grid);}container.append(group);
 }
 if(!count)setCatalogState('No items in this category. Choose another filter.');
}
function finishWaiting(){waiting=false;clearTimeout(recTimer);$('fetch-recs').disabled=false;$('fetch-recs').textContent='Refresh recommendations ↗';}
window.receive=({event,payload})=>{
 if(event==='music-info')receiveMusicInfo(payload);
 if(event==='radio-snapshot')receiveRadioSnapshot(payload);
 if(event==='library-result')receiveLibrary(payload);
 if(event==='catalog-loading'&&payload.url===catalogURL)setCatalogState('Loading music…');
 if(event==='catalog-result'&&(!payload.requestURL||payload.requestURL===catalogURL)){catalogCache.set(catalogURL,{time:Date.now(),data:payload});if(catalogCache.size>20)catalogCache.delete(catalogCache.keys().next().value);renderCatalog(payload);}
 if(event==='catalog-error')setCatalogState(payload,true);
 if(event==='history'){$('history-enabled').disabled=!payload.connected;$('history-enabled').checked=payload.enabled;$('history-account').textContent=payload.connected?'Connected as '+payload.user:'No account connected';$('history-status').textContent=payload.message+' · '+payload.pending+' queued';$('history-disconnect').hidden=!payload.connected;$('history-connect').textContent=payload.connected?'Reconnect / change account':'Connect ListenBrainz & enable';if(payload.connected&&$('username').value!==payload.user){$('username').value=payload.user;write('cadence.username',payload.user);}}
 if(event==='recommendations'){if(!waiting)return;finishWaiting();tracks=payload;$('rec-state').hidden=true;renderTracks($('recommendations'),tracks);}
 if(event==='error'){if(!waiting)return;finishWaiting();$('rec-state').hidden=false;$('rec-state').replaceChildren(el('h2','','A small pause in discovery.'),el('p','',payload));}
 if(event==='notice')toast(payload);
 if(event==='remote'&&typeof payload?.command==='string')remoteCommand(payload.command,payload.position);
 if(event==='engine'){$('now-artist').textContent='Starting playback…';}
 if(event==='track'&&source==='youtube'){
  if(pendingTrackId&&payload.id!==pendingTrackId&&Date.now()-pendingSince<12000&&!payload.error)return;
  if(payload.id===pendingTrackId||payload.error)pendingTrackId='';
  if(payload.title&&!payload.ad){updateNowRelease(payload);$('now-title').textContent=payload.title;$('now-artist').textContent=payload.artist||'YouTube Music';}
  if(payload.ad)$('now-artist').textContent='YouTube advertisement · your song follows';
  if(payload.error){$('now-artist').textContent=payload.error;}
  playing=payload.playing;updateControls();
  {const title=payload.ad?'YouTube advertisement':payload.title||current?.title||'',artist=payload.ad?'Your song follows':payload.artist||current?.artist||'YouTube Music';
   if(title&&!payload.error)reportNowPlaying({title,artist,album:payload.ad?'':payload.album||'',art:payload.ad?'':hiResArt(payload.art||current?.art||''),duration:payload.duration,position:payload.position,playing:payload.playing,canSeek:!payload.ad&&payload.duration>0});}
  if(Number.isFinite(payload.volume)&&document.activeElement!==$('volume-value'))$('volume-value').value=Math.round(payload.volume*100);
  if(payload.duration>0){$('seek').disabled=!!payload.ad;$('seek').max=payload.duration;if(!seeking)$('seek').value=payload.position;$('elapsed').textContent=formatTime(payload.position);$('duration').textContent=formatTime(payload.duration);}
  const nearEnd=lastDuration>0&&lastPosition>=lastDuration-3;
  const changedSong=current&&payload.id&&payload.id!==current.id&&!payload.ad;
  if(repeatMode!=='one'&&(queue.length||(repeatMode==='all'&&playlistCycle.length))&&endedFor!==current?.id&&((payload.ended&&nearEnd)||(nearEnd&&changedSong))){endedFor=current?.id;nextTrack();return;}
  if(current&&payload.id===current.id&&!payload.ad&&(current.artist!==payload.artist||current.title!==payload.title)){current={...current,title:payload.title,artist:payload.artist};renderQueue();}
  if(changedSong){current={id:payload.id,title:payload.title,artist:payload.artist,art:payload.art||'',kind:'song'};renderQueue();}
  lastPosition=payload.position||0;lastDuration=payload.duration||0;wasPlaying=playing;
 }
};
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;renderFilters();catalogSignature='';if(catalogData)renderCatalog(catalogData);});
$('search').onkeydown=e=>{if(e.key==='Enter'&&e.target.value.trim())search(e.target.value.trim());};
$('catalog-refresh').onclick=()=>browse(catalogURL,false,true);$('catalog-back').onclick=()=>{const prior=catalogTrail.pop();if(prior){catalogLabel=prior.label;browse(prior.url,false);}};
$('yt-account').onclick=$('catalog-account').onclick=$('settings-yt-account').onclick=()=>native('account');
$('queue-tab').onclick=()=>{railTab='queue';renderQueue();};$('saved-tab').onclick=()=>{railTab='saved';renderQueue();};$('clear-queue').onclick=()=>{queue=[];playlistCycle=current?[current]:[];renderQueue();};
$('create-radio').onclick=()=>{if(source!=='youtube'||!current?.id)return;radioSeed={...current};radioMode=true;queue=[];playlistCycle=[];repeatMode='off';shuffleOn=false;native('repeat-one',{enabled:false});native('start-radio',{id:current.id});updateModes();renderQueue();toast(`Creating a station based on ${current.title}…`);};
$('toggle').onclick=()=>{playing=!playing;updateControls();native('toggle');};$('shuffle').onclick=toggleShuffle;$('repeat').onclick=cycleRepeat;$('next').onclick=nextTrack;$('previous').onclick=previousTrack;
$('seek').oninput=()=>{seeking=true;};$('seek').onchange=e=>{native('seek',{seconds:Number(e.target.value)});seeking=false;};$('volume').value=read('cadence.volume',0.35);$('volume-value').value=Math.round(Number($('volume').value)*100);$('volume-value').onchange=e=>{const n=Number(e.target.value);if(!Number.isFinite(n))return;const volume=Math.max(0,Math.min(100,n))/100;$('volume').value=volume;write('cadence.volume',volume);native('volume',{volume});};$('volume').oninput=e=>{const volume=Number(e.target.value);$('volume-value').value=Math.round(volume*100);write('cadence.volume',volume);native('volume',{volume});};
$('username').value=read('cadence.username','');
$('recommend-form').onsubmit=e=>{e.preventDefault();const username=$('username').value.trim();if(!username)return;write('cadence.username',username);waiting=true;$('fetch-recs').disabled=true;$('fetch-recs').textContent='Finding your next favorites…';tracks=[];$('recommendations').replaceChildren();$('rec-state').hidden=false;$('rec-state').textContent='Fetching recommendations…';native('recommend',{username});clearTimeout(recTimer);recTimer=setTimeout(()=>window.receive({event:'error',payload:'The request timed out. Please try again.'}),60000);};
$('sc-url').value=read('cadence.soundcloud','');
$('sc-form').onsubmit=e=>{e.preventDefault();let u;try{u=new URL($('sc-url').value.trim());}catch{toast('Enter a valid SoundCloud link.');return;}if(u.protocol!=='https:'||!['soundcloud.com','www.soundcloud.com'].includes(u.hostname)||u.pathname.split('/').filter(Boolean).length<2||u.username||u.password){toast('Use a full soundcloud.com/artist/track or playlist link.');return;}u.search='';u.hash='';write('cadence.soundcloud',u.href);native('pause');source='soundcloud';clearNowRelease();const f=el('iframe');f.title='SoundCloud official player';f.allow='autoplay';f.src='https://w.soundcloud.com/player/?url='+encodeURIComponent(u.href)+'&auto_play=false&visual=true&color=%23db447e';stopSoundCloudTracking();$('sc-player').replaceChildren(f);attachSoundCloudTracking(f);$('now-title').textContent='SoundCloud';$('now-artist').textContent='Use the SoundCloud player to start listening';updateControls();};
$('lb-site').onclick=()=>native('external',{url:'https://listenbrainz.org'});
$('forget').onclick=()=>{finishWaiting();saved=[];write('cadence.saved',[]);write('cadence.username','');write('cadence.soundcloud','');$('username').value='';$('sc-url').value='';tracks=[];renderTracks($('recommendations'),[]);$('rec-state').hidden=false;$('rec-state').textContent='Enter your ListenBrainz username to load recommendations.';renderSaved();toast('Local preferences cleared. Your Google session is unchanged.');};
$('history-connect').onclick=()=>native('history-connect');$('history-enabled').onchange=e=>native('history-enabled',{enabled:e.target.checked});$('history-disconnect').onclick=()=>native('history-disconnect');$('history-settings').onclick=()=>native('external',{url:'https://listenbrainz.org/settings/'});
renderSaved();updateControls();updateModes();native('history-state');browse(catalogURL,false);
