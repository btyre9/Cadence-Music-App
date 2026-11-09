(() => {
 const clean = s => (s || '').replace(/\s+/g,' ').trim();
 const text = e => clean(e?.textContent);
 const absolute = s => { try { const u = new URL(s, location.origin); return u.origin === location.origin ? u.href : ''; } catch { return ''; } };
 function item(row) {
   const d=row.data || {};
   const runs=v=>(v?.runs||[]).map(r=>r.text||'').join('');
   const columns=(d.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text);
   const titleNode = row.querySelector('.title a, .title, .flex-column a, yt-formatted-string a');
   const title = clean(runs(d.title)||runs(columns[0])||text(titleNode)); if(!title) return null;
   const links = [...row.querySelectorAll('a[href]')];
   const watch = links.find(a=>a.getAttribute('href')?.startsWith('watch?')) || links.find(a=>a.href.includes('/watch?'));
   const browse = links.find(a=>a.href.includes('/browse/'));
   const playlist = links.find(a=>a.href.includes('/playlist?'));
   const channel = links.find(a=>a.href.includes('/channel/'));
   // Music only: skip podcast shows, episodes, and the Podcasts section.
   if(links.some(a=>/\/browse\/(MPSP|MPED|FEmusic_non_music_audio|VLSE$)|[?&]list=SE(&|$)/.test(a.href))) return null;
   const primary = watch || browse || playlist || channel;
   if(!primary) return null;
   const url = absolute(primary.getAttribute('href')); if(!url) return null;
   const u = new URL(url); const id = u.searchParams.get('v') || u.searchParams.get('list') || u.pathname.split('/').pop();
   let artists = links.filter(a=>a.href.includes('/channel/') || a.href.includes('/browse/UC')).map(text).filter(Boolean);
   const secondary = clean(runs(d.subtitle)||runs(columns[1])||text(row.querySelector('.subtitle, .secondary-flex-columns, .secondary-text')));
   if(!artists.length){const label=row.querySelector('[aria-label^="Play "]')?.getAttribute('aria-label')||row.getAttribute('aria-label')||'';const marker=label.lastIndexOf(' - ');if(marker>=0)artists=[label.slice(marker+3)];}
   if(!artists.length&&columns[1]){artists=(columns[1].runs||[]).filter(r=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')).map(r=>r.text);} 
   const full = text(row); const durations = full.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
   const image = row.querySelector('img');
   const thumbs=d.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails||d.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails||[];
   const art = thumbs.at(-1)?.url || (image?.src?.startsWith('https:') ? image.src : '');
   let kind = watch ? 'song' : playlist ? 'playlist' : (u.pathname.includes('/browse/UC')||u.pathname.includes('/channel/')) ? 'artist' : /album/i.test(secondary) || /\/browse\/MPRE|\/browse\/OLAK/.test(url) ? 'album' : /\/browse\/VL/.test(url) ? 'playlist' : 'collection';
   return {id, title, artist:artists.join(' & '), subtitle:secondary, art, url, kind, duration:runs(d.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)||durations?.at(-1)||''};
 }
 const shelves = [...document.querySelectorAll('ytmusic-carousel-shelf-renderer, ytmusic-shelf-renderer, ytmusic-playlist-shelf-renderer, ytmusic-grid-renderer')];
 const sections = []; const allSeen = new Set();
 for(const shelf of shelves){
   const rows = [...shelf.querySelectorAll('ytmusic-two-row-item-renderer, ytmusic-responsive-list-item-renderer')];
   const items = rows.map(item).filter(Boolean).filter(i=>{const key=i.url+'|'+i.title;if(allSeen.has(key))return false;allSeen.add(key);return true;});
   if(items.length) sections.push({title:text(shelf.querySelector('h2'))||clean((shelf.data?.title?.runs||[]).map(r=>r.text||'').join(''))||(items.every(i=>i.kind==='song')?'Tracks':'Browse'),items:items.slice(0,60)});
 }
 if(!sections.length){const items=[...document.querySelectorAll('ytmusic-two-row-item-renderer, ytmusic-responsive-list-item-renderer')].map(item).filter(Boolean);if(items.length)sections.push({title:'Your music',items:items.slice(0,60)});}
 const header = document.querySelector('ytmusic-responsive-header-renderer, ytmusic-detail-header-renderer, ytmusic-immersive-header-renderer, ytmusic-visual-header-renderer');
 const headerArt = [...(header?.querySelectorAll('img')||[])].sort((a,b)=>(b.clientWidth*b.clientHeight)-(a.clientWidth*a.clientHeight))[0]?.src || '';
 return {url:location.href, title:text(header?.querySelector('h1, .title')),
 subtitle:text(header?.querySelector('.subtitle, .strapline-text')),description:text(header?.querySelector('.description')),
 art:headerArt.startsWith('https:')?headerArt:'', releaseYear:clean([...(header?.querySelectorAll('.subtitle, .second-subtitle')||[])].map(text).join(' ')).match(/\b(?:19|20)\d{2}\b/)?.[0]||'', sections,
 signedIn:!!document.querySelector('ytmusic-settings-button img'),
 needsSignIn:!sections.length && !!document.querySelector('a[href*="accounts.google.com"]'),
 empty:!!document.querySelector('ytmusic-message-renderer'), message:text(document.querySelector('ytmusic-message-renderer'))};
})()
