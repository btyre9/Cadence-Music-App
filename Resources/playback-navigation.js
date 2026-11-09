// Use the already loaded Music router instead of rebuilding the whole player.
(() => {
 const id = VIDEO_ID;
 const app=document.querySelector('ytmusic-app');
 if(!app||!window.ytcfg)return false;
 const player=document.querySelector('#movie_player');
 if(!FORCE_RADIO&&player?.getVideoData?.().video_id===id){const v=document.querySelector('video');if(v){v.currentTime=0;v.play();}return true;}
 app.dispatchEvent(new CustomEvent('yt-navigate',{bubbles:true,composed:true,detail:{endpoint:{watchEndpoint:{videoId:id,playlistId:'RDAMVM'+id},commandMetadata:{webCommandMetadata:{url:'/watch?v='+encodeURIComponent(id),webPageType:'WEB_PAGE_TYPE_WATCH',rootVe:9663}}}}}));
 return true;
})()
