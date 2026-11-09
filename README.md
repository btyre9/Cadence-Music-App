# Cadence 0.7

A personal macOS music client with custom browsing and playback controls, built with AppKit and WebKit. Requires an Apple silicon Mac running macOS 13 or later. Locally signed for development; not notarized for distribution.

## Automatic ListenBrainz history

1. Open **Connections** in Cadence.
2. Choose **Get my token** to open your ListenBrainz settings in your browser.
3. Choose **Connect ListenBrainz & enable** and paste your user token into the secure macOS sheet. Do not paste the token into chat.
4. Confirm **Connect & enable**. Cadence validates the token, displays its account username, stores the token in macOS Keychain, and enables tracking.
5. Listen through YouTube Music or the SoundCloud player inside Cadence. The connection status shows queued and uploaded listens.

Tracking is off until connected. The account is determined by the validated token, and its username is used for recommendations. ListenBrainz listening history is public: track/artist names, album when available, service link, duration, and the start timestamp are sent directly to ListenBrainz. Recommendations change on ListenBrainz’s schedule, not instantly.

A track qualifies after half its duration or four minutes of observed playback, whichever is less. Tracks under 30 seconds, detected ads, detected SoundCloud previews, and tracks without usable metadata are skipped. Paused time, buffering, seeks, sleep, and long sampling gaps do not add listening time. Repeated polling does not submit the same play twice; fully replayed songs can count again. Current play state and completed submission markers survive app restarts.

Qualifying listens are queued locally before upload. Offline and server failures retry automatically while Cadence is running, using backoff and the same original listening timestamp. The queue survives restarts and holds up to 1,000 listens. Server credential errors pause tracking until you reconnect. Invalid submissions are skipped with a status message so later tracks can upload. As with network retries generally, an interrupted response can leave uncertainty about server receipt; stable metadata and timestamps allow ListenBrainz to deduplicate retries.

Use the **Automatically share qualifying listens** checkbox to pause/resume. Pausing retains queued listens locally and stops future requests; an already-sent request cannot be recalled. **Disconnect & clear queued listens** removes the local token, queue, and current tracking state. Previously uploaded history remains on ListenBrainz. Connecting a different account discards the old account’s local queue rather than uploading it to the new account.

Only playback inside Cadence is tracked. Playback in your separate browser or other apps is not tracked. Detection polls every 1.5 seconds; very brief playback near track boundaries may be missed. WebKit must keep the app running for automatic uploads. YouTube’s website can change its player structure; detected ads are excluded, but unusual layouts may require adapter updates. SoundCloud uses publisher artist metadata when available and otherwise credits the uploader; untagged mixes may not match ListenBrainz’s music database accurately. Tracking has no effect on your Premium membership.

## Now-playing release date and radio

The bottom bar automatically shows the current song’s earliest release date under its artist. Click that date to open source and version details. Lookup happens in the background after the song’s actual metadata arrives; cached results are reused. Temporary service failures are retried once after 30 seconds while the same song is still selected. If a song has multiple versions with different dates, the bar says **Release: multiple versions**. Unknown dates are labelled unavailable, and changing tracks immediately clears the old date. YouTube songs and tracks in the SoundCloud widget use the same release lookup.

The footer **Create Radio Station** button starts YouTube Music’s song-based mix using the current YouTube song as the seed. It clears Cadence’s custom queue, turns off repeat, and lets YouTube Music supply similar tracks. The right sidebar identifies the seed; Next moves through the station. Selecting another song or album ends station mode. The station uses YouTube Music’s recommendations rather than ListenBrainz. SoundCloud radio is not included.

## Save a radio station

While radio is active, choose **Save Radio as Playlist** in the right sidebar. Cadence reads the station’s currently loaded queue, includes the original seed, removes duplicate/unplayable entries, and shows a preview of up to 200 songs. Rename the playlist or edit its description, then choose **Save playlist**. It is created as **Private** in your signed-in YouTube Music account. The seed’s link is kept in the description.

After saving, choose **Open saved playlist** or **Keep listening**. You can return to it from Library and edit it using the existing playlist controls. Saving does not interrupt radio playback.

This saves a fixed snapshot of loaded songs. It does not save every song an endless radio station might recommend later, and future recommendations are not automatically added. If fewer than two playable songs have loaded, the app asks you to try again shortly rather than creating an empty playlist. Creation uses one request containing the snapshot’s song IDs; uncertain failures are not retried automatically to avoid duplicate playlists. The snapshot preview was checked in the running app. Creation requests, duplicate filtering, seed inclusion, validation, and double-submit prevention are covered by tests with mocked writes.

## Faster playback, shuffle, repeat, and release info

- Recently visited music pages are cached in memory for 90 seconds, making repeat visits immediate. **Refresh** bypasses that cache. Saved-account changes invalidate the cache. No listening credentials are stored in the page cache.
- Playback reuses YouTube Music’s loaded router when changing tracks, with a full-navigation fallback if the router cannot accept the request. First playback and uncached browsing still depend on WebKit startup and YouTube/network response times.
- Pages are read directly from YouTube Music’s own data service inside the signed-in catalog engine, instead of loading the full website and reading what it draws. Search, albums, artists, playlists, Explore, and Library typically open in about 0.3–0.7 seconds. Both music engines start at launch, and the first page is requested as soon as the catalog engine is usable, so Home appears in about a second. If the data service fails, Cadence falls back to loading the website page. Control state is checked about every 350 ms, and listening-history checkpoints are batched while keeping qualifying listens durable before upload.
- Long playlists and albums show their first 100 songs immediately and fill in the rest (up to 1,000) within a couple of seconds. Home loads extra shelves the same way.
- **Music only:** podcasts, podcast episodes, audiobooks, the Explore Podcasts section, and the “New Episodes” feed are left out of Home, Explore, Library, search, and artist pages.
- **Shuffle** is available on album/playlist pages and beside the footer player. It randomizes the loaded playlist or remaining custom queue without changing your saved playlist order. Duplicate song entries are retained. Turning shuffle off restores the remaining tracks’ original order.
- **Repeat**, beside Play, cycles **Off → All → One → Off**. The active setting is highlighted; One displays `↻¹`. All repeats the custom playlist/queue; One loops the current YouTube song. YouTube advertisements are excluded from song looping. These controls apply to YouTube Music; SoundCloud uses its original embedded player controls.
- Volume uses YouTube’s player volume API and is applied on adjustment or initial playback, rather than being forced repeatedly by polling. The chosen level is remembered. The percentage next to the slider reflects the player’s reported level during YouTube playback.
- **ⓘ Info** on albums and song rows opens release information. Cadence searches MusicBrainz for the selected title and artist, showing earliest release dates and source links. Several matching versions are shown separately. Partial dates stay partial. Exact matches can be unavailable, especially for user uploads or remasters with altered titles; a YouTube upload date is not substituted for an original release date. A displayed YouTube Music release year is also shown when available.

Release lookups run for the current song and when an Info panel is requested, are cached in memory, and are paced to at most one request per 1.1 seconds. The selected title and artist are sent directly to MusicBrainz’s public metadata API; no account token is required or sent.

## Playlist and library controls

- Open **Library** and use the **⋯** button on any card. Cadence reads current YouTube permissions before showing actions.
- **Playlists you own:** edit the name and description, remove individual song entries, move loaded tracks up/down, and delete the playlist. Duplicate copies of a song are identified separately so removing one entry does not remove all copies.
- **Saved playlists/albums:** choose **Remove from library**. The original content is not deleted.
- **Subscribed artists/channels:** choose **Unsubscribe**. This changes the subscription in your YouTube account. Coke Studio is this kind of item.
- **New playlist:** use **+ Playlist** at the top of the music view. New playlists are created Private.
- **Add a song:** use **⋯** beside a track, choose a playlist from the loaded account list (or paste its YouTube Music playlist link), select **Check playlist**, then **Add song**. Cadence checks that you own the target playlist first.

Edits go directly to the signed-in YouTube account and appear on its other devices. Permanent playlist deletion has a separate native confirmation with Cancel as the default. Removing a saved item, unsubscribing, and removing a song each show the specific item and effect before submission. Requests are not automatically retried after uncertain failures; refresh before retrying to avoid duplicated additions or creations.

Only owned playlists are editable in this version. Collaborative-playlist editing and privacy changes on existing playlists are not implemented. Automatic collections such as Liked Music may not expose editable/remove controls. Podcast-specific library actions are not implemented. The editor uses the first loaded set of playlist entries; a notice appears when more may remain. Moves across an unloaded boundary are blocked. There is no local undo for account changes. Re-add saved items, resubscribe to channels, or add songs back where applicable.

These account actions use the same signed-in service page as the catalog. Session authorization is computed and used inside that page; cookies and authorization headers are never returned to Cadence’s interface or logged. YouTube can change these unofficial endpoints. Ownership and errors are checked again for each action.

## Custom music interface

Cadence follows the Mac’s Light/Dark setting. Light Mode uses the original lavender look; Dark Mode uses a softer plum-gray palette (darker, never black). For the live self-test, `CADENCE_APPEARANCE=light` or `dark` previews either one.

Home, Explore, Library, search results, albums/collections, track lists, the Up Next queue, and the bottom player are Cadence’s interface. YouTube Music’s website is no longer shown inside the normal listening view.

- **Search:** type in the top search field and press Return. Filter the displayed results by Songs, Albums, Artists, or Playlists. Click an album, artist, or collection to browse its contents.
- **Play:** use a track’s play button, title, or the album Play action. The custom footer has play/pause, next/previous, a seek bar, elapsed time, and volume.
- **Queue:** use + beside a song. The right sidebar plays/removes individual queued tracks; Next consumes the custom queue before falling back to YouTube’s radio queue. Album Play queues the listed tracks. Playlists and albums include up to 1,000 songs; shuffle and repeat-all apply to that loaded set.
- **Account:** opens a separate YouTube/Google account window solely for authentication/account management. Close it after signing in, then refresh Cadence’s page. Home/Library use the same signed-in session.
- **Saved:** hearts save discoveries locally. ListenBrainz recommendations open a custom Cadence search so you can choose the correct recording. This is not automatic matching.
- **SoundCloud:** keeps the official free embedded player as originally requested. Paste a full `https://soundcloud.com/artist/track` or playlist URL and play inside that player. SoundCloud account search/sync is not included. Paid, regional, or embedding-disabled content can be unavailable or previews.

Starting YouTube playback stops SoundCloud. Loading or starting SoundCloud pauses YouTube. Browsing albums, Home, Discover, and Library does not interrupt music.

## Playback architecture and limits

This is a custom user interface, not a fully independent native YouTube streaming engine. Two internal WebKit service views provide catalog data and Premium playback using your own account session. They render behind the opaque Cadence interface, are excluded from accessibility navigation, and are not exposed as browsing panes. Catalog browsing and audio use separate service views so searches do not replace the currently playing song. No stream extraction, DRM handling, or ad blocking is implemented. YouTube ads, when served, remain audible and are labelled in the custom footer.

The separate Account window intentionally shows Google/YouTube for authentication. Google may refuse embedded authentication; a browser’s session does not automatically transfer into Cadence. Existing in-app sessions are retained.

Catalog data comes from YouTube Music’s internal data service (the same one its website uses), called from inside the signed-in catalog engine; the website is used only as a fallback. This is not an official or stable public API. Website changes can break parsing, playback metadata, controls, or pagination. Results can be limited to the items YouTube has loaded. Filter buttons narrow the loaded results rather than issue new service-wide category searches. Artist names on unusual uploads may be incomplete. Song likes, downloads, offline playback, and lyrics are not implemented. Saved discoveries and the custom queue are separate from YouTube’s playlists; the queue resets on restart.

**Clear local preferences & saved discoveries** clears the recommendation username, saved tracks, and saved SoundCloud link. It does not disconnect history tracking or clear Google’s session; use the separate tracking disconnect control.

## Privacy and storage

No Cadence server or analytics. Google sessions are stored in the app’s WebKit data store. Saved discoveries, recommendation username, and SoundCloud link use local WebKit storage. Tracking preferences, current play state, and pending listens use local app preferences. Only the ListenBrainz token uses Keychain and never enters JavaScript, localStorage, history payloads, or logs. The bundled SoundCloud helper is downloaded from the official widget API endpoint. Requests go directly to the chosen music services, ListenBrainz, and Cover Art Archive for cover artwork.

## Build and tests

Run `./build.sh` with Apple’s Command Line Tools installed. Default output: `build/Cadence.app`; pass a destination app path as the first argument to override it. On an ExFAT drive, code signing fails because macOS stores extra `._` files there; build to a Mac-formatted (APFS) location instead, for example `./build.sh ~/Applications/Cadence.app`.

For a live check against your signed-in account (read-only: it browses and searches, never plays or edits), run the built app with `CADENCE_DEBUG=1 CADENCE_SELFTEST=1 CADENCE_SELFTEST_DIR=/some/folder`. It logs page timings, saves a screenshot of each page, and quits. Add `CADENCE_LEGACY=1` to compare against the old website-loading method. No Node runtime is needed to use the app. Node is used only for adapter and custom-client tests.

Run `./test.sh` for playback qualification, restart persistence, repeat/deduplication, seek/pause/sleep/ads, metadata extraction, SoundCloud preview handling, authenticated submission, queue acceptance, rate-limit backoff, pause/disconnect, rejected-token tests, catalog parsing, artwork host checks, custom queue progression, playlist ownership, library removal versus deletion, private creation, selected duplicate entries, reorder bounds, and request failure handling, shuffle duplicate preservation, repeat modes/cycling, cached navigation, release matching, ambiguous versions, and partial dates, now-playing lookup caching/stale-response rejection, and radio seed/queue behavior. Upload tests intercept all HTTP requests locally and never submit live listens. Real-account ListenBrainz token validation and live uploads need your account connection. Custom YouTube search, albums, and audio were also checked manually in the running app. Live read-only checks verified the Coke Studio subscription controls and owned-playlist editor. Mutation requests are covered by local mocks; no existing account items were changed during these checks.

## Design and API references

Visual direction inspired by Alexis Kiredjian’s YouTube Music Desktop App concept: https://www.behance.net/gallery/212200607/YouTube-Music-Desktop-App . Original artwork is not bundled.

- https://listenbrainz.readthedocs.io/en/latest/users/api/core.html
- https://listenbrainz.readthedocs.io/en/latest/users/json.html
- https://developers.soundcloud.com/docs/api/html5-widget

Release metadata API: https://musicbrainz.org/doc/MusicBrainz_API
