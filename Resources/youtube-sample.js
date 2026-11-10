(() => {
  const p = document.querySelector('ytmusic-player-bar');
  const v = document.querySelector('video');
  const player = document.querySelector('#movie_player');
  const data = player?.getVideoData?.() || {};
  const media = navigator.mediaSession?.metadata;
  const title = p?.querySelector('.title')?.textContent?.trim() || media?.title || '';
  const artists = [...(p?.querySelectorAll('.byline a[href*="channel/"]') || [])].map(a => a.textContent.trim()).filter(Boolean);
  const artist = artists.join(' & ') || media?.artist || '';
  const albumLink = p?.querySelector('.byline a[href*="browse/"]');
  const id = data.video_id || '';
  const ad = !!document.querySelector('.ad-showing, .ad-interrupting');
  const likeStatus = p?.querySelector('ytmusic-like-button-renderer')?.getAttribute('like-status') || '';
  return {hasMedia:!!v, volume:v?.volume ?? 1, source:'youtube', id, title, artist, album:albumLink?.textContent?.trim() || '',
    url:id ? 'https://music.youtube.com/watch?v='+encodeURIComponent(id) : '',
    playing:!!v && !v.paused && !v.ended && !ad, ended:!!v?.ended,
    position:Number.isFinite(v?.currentTime)?v.currentTime:0,
    duration:Number.isFinite(v?.duration)?v.duration:0,
    art:p?.querySelector('img')?.src || '', ad, liked:likeStatus === 'LIKE', likeKnown:!!likeStatus, error:document.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim() || '', eligible:!!id && !ad && !!title && !!artist};
})()
