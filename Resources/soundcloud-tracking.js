'use strict';
// Official widget events/getters are used instead of inspecting the remote iframe.
let soundcloudGeneration = 0, soundcloudTimer, soundcloudWidgetInstance = null;
function stopSoundCloudTracking() { soundcloudGeneration++; clearInterval(soundcloudTimer); soundcloudWidgetInstance = null; }
// Media keys and Control Center control the current SoundCloud player through its official widget API.
function soundcloudWidget() { return soundcloudWidgetInstance; }
function attachSoundCloudTracking(frame) {
  stopSoundCloudTracking();
  const generation = soundcloudGeneration;
  if (!window.SC?.Widget) { toast('SoundCloud tracking helper could not load. Playback remains available.'); return; }
  const widget = SC.Widget(frame);
  soundcloudWidgetInstance = widget;
  let busy = false;
  function sample() {
    if (busy || generation !== soundcloudGeneration || !frame.isConnected) return;
    busy = true;
    // A watchdog releases the poll if the remote widget becomes unavailable.
    const watchdog = setTimeout(()=>{busy=false;},4000);
    widget.getCurrentSound(sound => {
      widget.getDuration(duration => {
        widget.getPosition(position => {
          widget.isPaused(paused => {
            clearTimeout(watchdog); busy = false;
            if (generation !== soundcloudGeneration || !frame.isConnected || !sound) return;
            const artist = sound.publisher_metadata?.artist || sound.user?.username || '';
            const title = sound.title || '';
            const url = sound.permalink_url || '';
            const seconds = duration/1000;
            const eligible = sound.streamable !== false && sound.policy !== 'SNIP' && sound.policy !== 'BLOCK' && duration >= 30000 && (!sound.duration || duration >= sound.duration * 0.9);
            native('history-sample',{sample:{source:'soundcloud',id:String(sound.id||sound.urn||url),title,artist,album:'',url,duration:seconds,position:position/1000,playing:!paused,eligible}});
            if(source==='soundcloud'&&title){if(typeof updateNowRelease==='function')updateNowRelease({source:'soundcloud',id:String(sound.id||url),title,artist});$('now-title').textContent=title;$('now-artist').textContent=artist;if(typeof reportNowPlaying==='function')reportNowPlaying({title,artist:artist||'SoundCloud',album:'',art:hiResArt(sound.artwork_url||''),duration:seconds,position:position/1000,playing:!paused,canSeek:seconds>0});}
          });
        });
      });
    });
  }
  widget.bind(SC.Widget.Events.READY, sample);
  widget.bind(SC.Widget.Events.PLAY, ()=>{ native('pause'); sample(); });
  widget.bind(SC.Widget.Events.PAUSE, sample);
  widget.bind(SC.Widget.Events.ERROR, ()=>toast('SoundCloud reported a player error. Tracking resumes when playback is available.'));
  soundcloudTimer = setInterval(sample,1500);
}
