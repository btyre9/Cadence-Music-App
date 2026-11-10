// Runs in the YouTube playback engine before its own scripts. If WebKit hands a media key or
// Control Center action to this page, send it to Cadence so the custom queue stays in charge.
(() => {
  const proto = window.MediaSession && window.MediaSession.prototype;
  if (!proto || !navigator.mediaSession || proto.__cadenceBridge) return;
  const original = proto.setActionHandler;
  const commands = {play: 'play', pause: 'pause', nexttrack: 'next', previoustrack: 'previous', seekto: 'seek'};
  const post = message => { try { window.webkit.messageHandlers.cadenceMedia.postMessage(message); } catch (_) {} };
  const forward = action => details => {
    if (action !== 'seekto') { post({command: commands[action]}); return; }
    if (Number.isFinite(details && details.seekTime) && details.seekTime >= 0) post({command: 'seek', position: details.seekTime});
  };
  // YouTube's own handlers are replaced; actions Cadence doesn't handle are cleared.
  proto.setActionHandler = function (action) {
    try { return original.call(this, action, commands[action] ? forward(action) : null); } catch (_) { return undefined; }
  };
  Object.defineProperty(proto, '__cadenceBridge', {value: true});
  for (const action of Object.keys(commands)) proto.setActionHandler.call(navigator.mediaSession, action);
})();
