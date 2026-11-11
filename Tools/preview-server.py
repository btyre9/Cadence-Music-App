#!/usr/bin/env python3
"""Serves Cadence's interface (Resources/) in a normal browser for design review.

A stand-in for the macOS app answers the interface's requests with sample pages parsed from
the test fixtures, so every screen shows real-looking music. Nothing plays and nothing is sent
to YouTube Music or ListenBrainz. Edits to Resources/ show up on reload.

Run from the project folder: python3 Tools/preview-server.py [port]   (default 8765)
"""
import http.server, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESOURCES = os.path.join(ROOT, "Resources")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765

BRIDGE = r"""(()=>{
const D=__DATA__;
const pick=u=>{const x=new URL(u),p=x.pathname,b=x.searchParams.get('browse')||'';
 if(p==='/search')return D.search;if(p==='/library')return D.library;if(p==='/playlist')return D.playlist;
 if(p==='/explore'||p==='/new_releases'||/FEmusic_(moods|charts|new)/.test(p))return D.explore;
 if(p.startsWith('/browse/MPRE'))return D.album;if(p.startsWith('/browse/UC')||p.startsWith('/channel/'))return D.artist;
 if(p.startsWith('/browse/VL'))return D.playlist;return D.home;};
const send=(event,payload,ms=150)=>setTimeout(()=>window.receive&&window.receive({event,payload}),ms);
let pos=0,dur=0,song=null,on=false,timer;
const tick=()=>{if(!song)return;if(on)pos=Math.min(dur,pos+1);send('track',{id:song.id,title:song.title,artist:song.artist,art:song.art,playing:on,position:pos,duration:dur,volume:.35},0);};
window.webkit={messageHandlers:{cadence:{postMessage(m){switch(m.action){
 case 'catalog':send('catalog-loading',{url:m.url},0);send('catalog-result',{...pick(m.url),requestURL:m.url});break;
 case 'youtube':break;
 case 'history-state':send('history',{connected:true,enabled:true,user:'btmedia',message:'Preview: tracking is on',pending:0});break;
 case 'recommend':send('error','Preview: ListenBrainz isn’t contacted here, so no recommendations are shown.',600);break;
 case 'play-track':{const all=Object.values(D).flatMap(d=>d.sections||[]).flatMap(s=>s.items);song=all.find(i=>i.id===m.id)||{id:m.id,title:'Sample song',artist:'Sample artist'};
  const t=/^(\d+):(\d\d)$/.exec(song.duration||'');dur=t?+t[1]*60+ +t[2]:215;pos=0;on=true;send('engine',{loading:true},0);clearInterval(timer);timer=setInterval(tick,1000);tick();break;}
 case 'toggle':on=!on;tick();break;case 'pause':on=false;tick();break;
 case 'seek':pos=m.seconds||0;tick();break;
 case 'next':case 'previous':case 'start-radio':case 'account':case 'external':case 'history-connect':case 'history-disconnect':
  send('notice','Preview only: “'+m.action+'” works in the Cadence app.',0);break;
 case 'library-request':send('library-result',{requestID:m.request?.requestID,ok:false,message:'Preview only: library changes work in the Cadence app.'});break;
 case 'radio-snapshot':send('radio-snapshot',{requestID:m.requestID,tracks:[]});break;
}}}}};
console.info('Cadence preview bridge ready');
})();"""


def build_bridge():
    data = subprocess.run(["node", "Tools/preview-data.cjs"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return BRIDGE.replace("__DATA__", data).encode()


class Handler(http.server.SimpleHTTPRequestHandler):
    bridge = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RESOURCES, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, body, kind):
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(RESOURCES, "index.html"), encoding="utf-8") as f:
                html = f.read()
            # The stand-in must exist before the interface's own scripts run.
            html = html.replace('<script src="soundcloud-widget.js">', '<script src="preview-bridge.js"></script><script src="soundcloud-widget.js">', 1)
            return self.reply(html.encode(), "text/html; charset=utf-8")
        if path == "/preview-bridge.js":
            Handler.bridge = Handler.bridge or build_bridge()
            return self.reply(Handler.bridge, "text/javascript; charset=utf-8")
        return super().do_GET()


if __name__ == "__main__":
    print(f"Cadence preview: http://localhost:{PORT}", flush=True)
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
