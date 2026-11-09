// Executed only in the signed-in service page; credentials never leave that page.
async function execute(request) {
 const clean=s=>(s||'').replace(/\s+/g,' ').trim();
 const runs=x=>typeof x==='string'?x:(x?.runs||[]).map(r=>r.text||'').join('')||x?.simpleText||'';
 function find(root,key){const out=[];function visit(v,depth){if(!v||typeof v!=='object'||depth>35)return;for(const [k,x]of Object.entries(v)){if(k===key)out.push(x);visit(x,depth+1);}}visit(root,0);return out;}
 function idFrom(url){const u=new URL(url);if(u.origin!=='https://music.youtube.com')throw Error('Unsupported music link.');return u.searchParams.get('list')||u.pathname.split('/').pop().replace(/^VL/,'');}
 const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{2,200}$/.test(id);
 async function api(path,body){
  const cfg=window.ytcfg;if(!cfg?.get)throw Error('YouTube Music is still loading. Try again shortly.');
  const cookies=Object.fromEntries(document.cookie.split(';').map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1)];}));
  const sid=cookies.SAPISID||cookies['__Secure-3PAPISID']||cookies['__Secure-1PAPISID'];
  if(!sid)throw Error('Sign in through Account before managing your library.');
  const timestamp=Math.floor(Date.now()/1000);
  const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${timestamp} ${sid} ${location.origin}`));
  const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const context=JSON.parse(JSON.stringify(cfg.get('INNERTUBE_CONTEXT')||{}));
  if(!context.client)throw Error('YouTube’s account context is unavailable. Refresh and try again.');
  const headers={'Content-Type':'application/json','Authorization':`SAPISIDHASH ${timestamp}_${hash}`,'X-Origin':location.origin,'X-Goog-AuthUser':String(cfg.get('SESSION_INDEX')||0)};
  const delegated=cfg.get('DELEGATED_SESSION_ID');if(delegated)headers['X-Goog-PageId']=delegated;
  const visitor=cfg.get('VISITOR_DATA');if(visitor)headers['X-Goog-Visitor-Id']=visitor;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  let response;try{response=await fetch(`/youtubei/v1/${path}?prettyPrint=false`,{method:'POST',credentials:'include',headers,body:JSON.stringify({...body,context}),signal:controller.signal});}finally{clearTimeout(timeout);}
  if(!response.ok)throw Error(response.status===401||response.status===403?'YouTube did not allow this change. Check your sign-in and playlist permissions.':`YouTube could not complete this request (${response.status}).`);
  const data=await response.json();if(data.error||data.status&&data.status!=='STATUS_SUCCEEDED')throw Error('YouTube rejected this change. Your library was not confirmed updated.');
  return data;
 }
 async function inspect(url){
  const id=idFrom(url);if(!valid(id))throw Error('This item does not have a supported library ID.');
  const isArtist=id.startsWith('UC'),isAlbum=id.startsWith('MPRE')||id.startsWith('OLAK');
  const data=await api('browse',{browseId:isArtist||id.startsWith('MPRE')?id:'VL'+id});
  const editable=find(data,'musicEditablePlaylistDetailHeaderRenderer')[0];
  const header=editable?.header?.musicDetailHeaderRenderer||editable?.header?.musicResponsiveHeaderRenderer||find(data,'musicResponsiveHeaderRenderer')[0]||find(data,'musicDetailHeaderRenderer')[0]||find(data,'musicImmersiveHeaderRenderer')[0]||{};
  const owned=!!editable&&!isArtist&&!isAlbum;
  const liked=find(data,'likeEndpoint').find(x=>x.target?.playlistId)?.target?.playlistId;
  const playlistId=isArtist?'':id.startsWith('MPRE')?(liked||''):id;
  const title=clean(runs(header.title))||request.title||'Library item';
  const trackRows=find(data,'musicResponsiveListItemRenderer');
  const tracks=trackRows.map(r=>{const cols=(r.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text);const videoId=r.playlistItemData?.videoId||r.navigationEndpoint?.watchEndpoint?.videoId;const setId=r.playlistItemData?.playlistSetVideoId;if(!videoId||!setId)return null;return{ id:videoId,setId,title:clean(runs(cols[0])),artist:clean(runs(cols[1]))};}).filter(Boolean);
  const subscribed=find(data,'subscribeButtonRenderer').some(x=>x.subscribed===true);
  return {id,playlistId,title,description:runs(editable?.description)||runs(header.description),owned,kind:isArtist?'artist':isAlbum?'album':'playlist',canRemove:!owned&&(!!playlistId||(isArtist&&subscribed)),tracks,partial:find(data,'continuationItemRenderer').length>0||find(data,'nextContinuationData').length>0};
 }
 const op=request.op;
 if(op==='list-playlists'){
  const data=await api('browse',{browseId:'FEmusic_liked_playlists'});
  const rows=[...find(data,'musicTwoRowItemRenderer'),...find(data,'musicResponsiveListItemRenderer')];
  const playlists=rows.map(r=>{const browse=r.navigationEndpoint?.browseEndpoint?.browseId;const watch=r.navigationEndpoint?.watchPlaylistEndpoint?.playlistId;const id=browse?.startsWith('VL')?browse.slice(2):watch;if(!id||['LM','SE'].includes(id))return null;const title=clean(runs(r.title)||runs(r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text));return title?{title,url:'https://music.youtube.com/playlist?list='+encodeURIComponent(id)}:null;}).filter(Boolean);
  return{ok:true,op,playlists};
 }
 if(op==='create'||op==='create-radio-playlist'){
  const title=clean(request.name);if(!title||title.length>150)throw Error('Enter a playlist name of 1–150 characters.');
  const body={title,description:String(request.description||'').slice(0,5000),privacyStatus:'PRIVATE'};
  if(op==='create-radio-playlist'){
   if(!Array.isArray(request.videoIds)||request.videoIds.length<2||request.videoIds.length>200||!request.videoIds.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{6,40}$/.test(id)))throw Error('The station snapshot is missing valid songs. Open Save Radio again.');
   body.videoIds=[...new Set(request.videoIds)];
   if(body.videoIds.length<2)throw Error('Wait for more station songs to load before saving.');
  }
  const data=await api('playlist/create',body);
  if(!data.playlistId)throw Error('YouTube did not confirm that the playlist was created. Refresh your library before retrying.');
  return {ok:true,op,url:'https://music.youtube.com/playlist?list='+encodeURIComponent(data.playlistId),title};
 }
 const info=await inspect(request.url);
 if(op==='inspect')return {ok:true,op,info};
 if(op==='remove-library'){
  if(info.owned)throw Error('This is a playlist you own. Use Delete playlist to delete it; removing a saved item never deletes an owned playlist.');
  if(!info.canRemove)throw Error('This item cannot be removed with the available library controls.');
  if(info.kind==='artist')await api('subscription/unsubscribe',{channelIds:[info.id]});
  else await api('like/removelike',{target:{playlistId:info.playlistId}});
  return {ok:true,op,title:info.title,kind:info.kind};
 }
 if(!info.owned)throw Error('You can edit only playlists owned by the signed-in account.');
 if(op==='delete'){await api('playlist/delete',{playlistId:info.playlistId});return{ok:true,op,title:info.title};}
 let actions=[];
 if(op==='rename'){
  const title=clean(request.name);if(!title||title.length>150)throw Error('Enter a playlist name of 1–150 characters.');
  actions=[{action:'ACTION_SET_PLAYLIST_NAME',playlistName:title},{action:'ACTION_SET_PLAYLIST_DESCRIPTION',playlistDescription:String(request.description||'').slice(0,5000)}];
 }else if(op==='add-track'){
  if(!valid(request.videoId))throw Error('Select a valid song.');actions=[{action:'ACTION_ADD_VIDEO',addedVideoId:request.videoId}];
 }else if(op==='remove-track'||op==='move-track'){
  const row=info.tracks.find(t=>t.setId===request.setId);if(!row)throw Error('That playlist entry is no longer loaded. Refresh before editing.');
  if(op==='remove-track')actions=[{action:'ACTION_REMOVE_VIDEO',setVideoId:row.setId,removedVideoId:row.id}];
  else {const successor=request.successor||'';if(successor&&!info.tracks.some(t=>t.setId===successor))throw Error('The new track position is no longer available. Refresh and try again.');const action={action:'ACTION_MOVE_VIDEO_BEFORE',setVideoId:row.setId};if(successor)action.movedSetVideoIdSuccessor=successor;actions=[action];}
 }else throw Error('Unsupported playlist action.');
 await api('browse/edit_playlist',{playlistId:info.playlistId,actions});return{ok:true,op,title:info.title};
}
try { return await execute(request); } catch(error) { return {ok:false,op:request.op,message:error.name==='AbortError'?'The request timed out. Refresh before retrying; the change may already have reached YouTube.':error.message||'Could not update the library.'}; }
