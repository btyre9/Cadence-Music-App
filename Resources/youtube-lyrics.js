// Executed in the YouTube Music page: reads a song's lyrics the way YouTube Music's own Lyrics tab
// does (the "next" response names a lyrics page, which the browse service returns as text).
// Request: {videoId}. Result: {ok, videoId, lyrics, source} or {ok:false, missing, message}.
async function execute(request){
 const videoId=/^[A-Za-z0-9_-]{6,40}$/.test(request?.videoId||'')?request.videoId:'';
 if(!videoId)return{ok:false,message:'Select a valid song.'};
 const runs=x=>typeof x==='string'?x:(x?.runs||[]).map(r=>r.text||'').join('')||x?.simpleText||'';
 function find(root,test){const out=[];(function visit(v,depth){if(!v||typeof v!=='object'||depth>40)return;for(const[k,x]of Object.entries(v)){if(test(k,x))out.push(x);visit(x,depth+1);}})(root,0);return out;}
 async function api(path,body){
  const cfg=window.ytcfg;if(!cfg?.get)throw Error('YouTube Music is still loading.');
  const context=JSON.parse(JSON.stringify(cfg.get('INNERTUBE_CONTEXT')||{}));if(!context.client)throw Error('YouTube Music context unavailable.');
  const headers={'Content-Type':'application/json','X-Origin':location.origin,'X-Goog-AuthUser':String(cfg.get('SESSION_INDEX')||0)};
  const cookies=Object.fromEntries(document.cookie.split(';').map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1)];}));
  const sid=cookies.SAPISID||cookies['__Secure-3PAPISID']||cookies['__Secure-1PAPISID'];
  if(sid){const timestamp=Math.floor(Date.now()/1000);const digest=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(`${timestamp} ${sid} ${location.origin}`));headers.Authorization=`SAPISIDHASH ${timestamp}_${[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}`;}
  const visitor=cfg.get('VISITOR_DATA');if(visitor)headers['X-Goog-Visitor-Id']=visitor;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  let response;try{response=await fetch(`/youtubei/v1/${path}?prettyPrint=false`,{method:'POST',credentials:'include',headers,body:JSON.stringify({...body,context}),signal:controller.signal});}finally{clearTimeout(timeout);}
  if(!response.ok)throw Error(`YouTube Music returned ${response.status}.`);
  return response.json();
 }
 const missing={ok:false,missing:true,videoId,message:'No lyrics are available for this song.'};
 try{
  const next=await api('next',{videoId,isAudioOnly:true});
  // The lyrics page id starts with MPLY; songs without lyrics have no such link.
  const browseId=find(next,(k,x)=>k==='browseId'&&typeof x==='string'&&x.startsWith('MPLY'))[0];
  if(!browseId)return missing;
  const page=await api('browse',{browseId});
  const shelf=find(page,k=>k==='musicDescriptionShelfRenderer')[0];
  const lyrics=runs(shelf?.description).replace(/\r\n?/g,'\n').trim();
  if(!lyrics)return missing;
  return{ok:true,videoId,lyrics,source:runs(shelf.footer).trim()};
 }catch(error){return{ok:false,videoId,message:error.name==='AbortError'?'Lyrics took too long to load. Try again.':'Couldn’t load lyrics. Try again.'};}
}
return await execute(request);
