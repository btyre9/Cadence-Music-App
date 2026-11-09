(() => {
 const tracks=[],seen=new Set();
 function add(data){if(!data||typeof data!=='object')return;const candidate=data.playlistPanelVideoWrapperRenderer||data;const d=candidate.playlistPanelVideoRenderer||candidate.primaryRenderer?.playlistPanelVideoRenderer||candidate;const id=d.videoId;if(typeof id!=='string'||!/^[A-Za-z0-9_-]{6,40}$/.test(id)||seen.has(id)||d.isPlayable===false)return;seen.add(id);const runs=x=>(x?.runs||[]).map(r=>r.text||'').join('')||x?.simpleText||'';tracks.push({id,title:runs(d.title)||'Untitled track',artist:runs(d.longBylineText)||runs(d.shortBylineText)||''});}
 const queue=document.querySelector('ytmusic-player-queue');
 if(queue){for(const row of queue.querySelectorAll('ytmusic-playlist-panel-video-renderer, ytmusic-playlist-panel-video-wrapper-renderer'))add(row.data);}
 // The backing queue retains loaded entries even when DOM rows are virtualized.
 const state=queue?.store?.getState?.();
 if(!tracks.length&&Array.isArray(state?.queue?.items))for(const item of state.queue.items)add(item);
 return {tracks:tracks.slice(0,200),partial:true};
})()
