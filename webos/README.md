# Wholphin for LG webOS — initial port

A standalone webOS TV app alongside the Android client. This is an early implementation, not feature parity with Android Wholphin. No Android build or Jellyfin Web deployment is required. The UI follows the upstream Wholphin home and movie-detail designs and Android Compose implementation.

Implemented: Wholphin-style focused-item backdrops and summaries, collapsible navigation drawer, poster rows, favorites browsing/toggle, cast details, server URL/password login, saved session and sign out, continuous library/folder browsing with sorting and filters, continue watching, next up, recently added, title search, item details, resume, playback controls, remote directional navigation, and Jellyfin playback progress/stopped reporting. Magic Remote pointer clicks use standard buttons and inputs.

## Run locally

From this directory:

```sh
npm run serve
# Open http://localhost:8080
npm run check
npm test
```

The source has no runtime dependencies or build step. Target webOS 5+ initially; older versions are untested. The app uses modern browser APIs including fetch, AbortController, async functions, and CSS Grid. Native HLS playback is expected on the TV; desktop browsers without native HLS can browse but cannot play transcoded streams.

Use a full server URL, such as `http://192.168.1.20:8096` or `https://media.example.com/jellyfin`. A bare address without a port defaults to HTTP port `8096`. Explicit HTTP/HTTPS URLs retain their standard ports for reverse proxies. The server must be reachable from the TV and allow the app's origin through any reverse proxy. HTTPS certificates must be trusted by the TV. The app stores the Jellyfin access token locally, not your password. Sign out removes the saved token and attempts to revoke the server session.

## Package and sideload

Install the official LG CLI on your computer:

```sh
npm install -g @webos-tools/cli
npm run package
```

The resulting package is `dist/com.github.damontecres.wholphin.webos_0.2.11_all.ipk`.

1. Install LG's **Developer Mode** app from the TV's app store and sign in with an LG developer account.
2. Enable Developer Mode, reboot if requested, and enable Key Server. Note the TV IP address and passphrase.
3. On your computer, run the interactive device setup and add a TV named `myTV` (SSH port `9922`, user `prisoner`). Retrieve its key, entering the passphrase shown on the TV:

```sh
ares-setup-device
ares-novacom --device myTV --getkey
ares-install --device myTV dist/com.github.damontecres.wholphin.webos_0.2.11_all.ipk
ares-launch --device myTV com.github.damontecres.wholphin.webos
```

Keep the Developer Mode session extended. Expiration can disable Developer Mode and remove development apps. See [LG Developer Mode instructions](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) and [LG CLI guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide).

## Remote controls

- D-pad: move focus; OK: activate. Left from the first poster opens the navigation drawer, Right returns to the previous content focus, and Up/Down move between poster rows. In text fields, left/right move the caret when the field contains text; up/down move between fields.
- Back: stop playback, otherwise return to the previous screen. At the root on a TV, confirm exit.
- Playback buttons: play/pause, stop, rewind/fast-forward (30 seconds).
- On-screen controls also support play/pause, 30-second seek, and stop. Controls fade after three seconds of playback; OK reveals them and left/right seek when they are hidden.
- Fill screen crops the picture to fill the display; Fit video preserves its aspect ratio.
- Backgrounding the app pauses playback.

## Playback scope

The initial device profile advertises MP4 H.264/AAC/MP3 direct playback, with conservative 1080p/H.264 level 4.1 limits. Other media requests HLS H.264/AAC stereo transcoding from Jellyfin. The user needs server transcoding permissions and the server needs a working encoder. Subtitle formats advertised in the profile use server burn-in; audio/subtitle pickers are available during on-demand playback in v0.2.5, with a brief stream reload at the current position when changing tracks. Compatibility remains the default. Version 0.2.8 adds an opt-in experimental LG C1 native profile for HEVC/4K/HDR10 and Dolby audio, plus a separate experimental Dolby Vision MP4 toggle; see [native playback scope and validation](NATIVE-PLAYBACK.md). Audio passthrough is not verified or promised.

Resume reloads the latest server bookmark, then seeks the native player to that absolute time for both direct playback and HLS. Initial seeks are retried as the TV becomes ready; session reporting begins only after the seek is confirmed. Progress and stop reports are ordered, with no extra offset added to HLS timestamps. A failed initial seek preserves the bookmark. Seeking still depends on the TV's native HLS seekable window. There is no automatic decoder-failure fallback yet.

Not implemented: multiple accounts, DVR recording management, music, Seerr, subtitle search/download/style editing, trickplay, refresh-rate switching, and Android/MPV-specific playback features.


## Home and loading

Home combines Continue watching and Next up by default (or shows separate rows when configured), followed by **Recently added in <library>** for each video library. Nonempty favorite movie/show, collection, and playlist rows follow. Live TV libraries get a landscape **Watch live** programme row. Music, photos, and books do not get Home rows in this video-focused port.

Use **Settings → Customize Home** to enable the Watch live row, combine Continue watching/Next up, show poster titles, enable recently released rows, enable favorites/collections/playlists, or hide selected library rows. Choices are saved per server and user on this device; Android Wholphin's full row editor and server-synced settings are not implemented yet.

Rows request data independently with two concurrent row jobs. Nearby rows load first, offscreen rows wait until approaching the viewport, and failures show a local Retry button. Returning to Home uses a short in-memory row cache; stopping playback invalidates the resume rows. Empty rows do not displace the current focused card while results arrive.

Poster URLs are assigned only when images intersect the visible scrolling area or approach keyboard focus, using IntersectionObserver rather than relying on newer browser-native lazy loading. The focused card and its immediate neighbors are prefetched. Backdrops wait for focus to settle. Sidebar labels and nodes remain stable across Home refreshes; cached library names are available immediately after app restart.

## Reference screenshots and live TV

The supplied screenshots guide title-logo placement, episode subtitle/air-date details, expected finish times, episode poster badges, and the profile initial. Logos come from Jellyfin image assets, with a text fallback when no logo exists. Combined Continue watching preserves multiple in-progress episodes of the same show and suppresses redundant Next up entries.

Watch live uses currently airing Jellyfin EPG programmes and a channel's negotiated HLS stream. The app disables live seeking, carries the live stream identifier in session reports, and explicitly releases the tuner on stop, failed preparation, or backgrounding. Live TV is experimental: negotiation and cleanup have local mock-server coverage, but real tuner playback has **not** been validated on the C1. No TV app was opened or navigated during this update.

## Verification

`npm test` covers URL validation, reverse-proxy paths, stream selection, credential encoding, conservative codec profiles, and directional focus selection.

Optional Playwright tests exercise login, browsing, details, D-pad focus, resume, playback reporting, Back focus restoration, search, saved login, drawer focus restoration, row navigation, favorites requests, and sign out against mocked Jellyfin responses. A separate Home test checks slow and failed rows, per-library requests, lazy poster network requests, sidebar identity/labels, and saved Home options. The media engine is stubbed: passing it does not verify decoding or native HLS.

```sh
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

Before considering this ready for daily use, test on a physical LG TV with a real Jellyfin server: password login and restart, large libraries, MP4 direct play, MKV transcode, burned subtitles, resume and seek, finished episodes, server disconnects, and Developer Mode reinstall. Record the TV model/webOS version and Jellyfin version with failures. Initial device validation now covers LG OLED77C1PUB (webOS SDK 6.5.3, firmware 03.53.45): installation, signed-in browsing, full-viewport player geometry, and native HLS resume against a real Jellyfin server. A saved position of 665.277 seconds resumed at 665.277 seconds and remained 665.277 seconds after stopping. This does not cover every codec, subtitle format, or long playback session.

Holiday rows (v0.2.3) follow the native query presets in [KefinTweaks](https://github.com/ranaldsgift/KefinTweaks/blob/main/scripts/homeScreenConfig2.js): January New Year's, February Valentine's, October Halloween (including Horror and Thriller movies), November Thanksgiving, and December Christmas. They appear after Continue watching/Next up for the entire corresponding month, using the TV's local date each time Home loads. Movie rows require matching Jellyfin tags (`new year's eve`, `valentine's day`, `halloween`, `thanksgiving`, `christmas`); episode rows search episode names. Horror/Thriller rows use genres. Empty rows hide automatically; posters retain lazy loading. Disable these rows in Settings → Customize Home. No server plugin is required, and server metadata is never changed. This ports the query presets, not arbitrary server-side KefinTweaks custom sections or its animated themes.

Version 0.2.4 adds **Use Quick Connect** below password sign-in. Enter the server URL, select it, then approve the displayed six-digit code from Settings → Quick Connect in a signed-in Jellyfin phone/browser. Jellyfin must have Quick Connect enabled. Cancel/Back stops polling; a new code can be generated after expiry or an error. Hiding the app cancels pending approval. Password sign-in remains available.

Loading now overlaps cold library discovery with Continue watching/Next up, cancels old Home requests on navigation, bounds the row cache, and requests smaller portrait images. The API uses a canonical server URL with redirects disabled. See [security review and remaining limits](SECURITY-REVIEW.md), including HTTP transport and saved access-token storage. Version 0.2.4 is locally tested and packaged; device validation is pending.


## Playback controls in v0.2.5

- **Audio / Subtitles:** open a remote-navigable list of tracks from the selected Jellyfin media source. Audio and subtitle indices are preserved independently; **Off** explicitly disables subtitles. A change negotiates an HLS stream at the current position, stops/reports and cleans up the previous stream, and preserves paused state and Fit/Fill. Failed negotiation keeps the old stream available. Explicit choices use server transcoding; subtitle formats advertised by the client use burn-in. Server transcoding permission and a working encoder are required. These selectors currently cover on-demand videos; live TV selectors remain disabled. From v0.2.6, successful language choices and subtitle Off are remembered per server/account on this TV and applied to subsequent videos (details below).
- **Chapters:** jump to Jellyfin chapter markers using their names and times. The button becomes available when valid markers are loaded. No synthetic chapters or chapter thumbnails are generated.
- **Queue:** add videos from their detail pages, view the queue from Settings/detail pages or the player, and play, remove, reorder, or clear entries. The manual queue holds up to 100 videos and stays in memory until app restart or sign-out. Explicit queued videos take priority over automatically following episodes. **Next** advances manually; natural completion also advances queued videos.
- **Autoplay next episodes:** enabled by default, switchable in Settings or Queue, and saved per account on this TV. The client requests the current episode and its successors from Jellyfin in series order, including across season boundaries. It shows up to 20 following episodes and refreshes that window as playback advances. Missing/virtual and unrelated episodes are excluded; a missing current-episode anchor prevents automatic guessing. Disabling autoplay stops automatic episode progression while retaining the explicit manual queue. Series finales stop normally. No countdown or pass-out protection is implemented in this first version.
- **Back** closes a playback menu first; another Back stops playback. D-pad focus stays in an open menu. Leaving the app does not initiate episode autoplay. Cancelling playback also aborts an in-progress stream negotiation, so its late response cannot restart the player.

The new controls have mocked-browser coverage for stream indices, subtitle Off, position/pause preservation, failed switching, chapters, menu navigation, queue ordering/priority, report ordering, autoplay On/Off, season boundaries, final episodes and cancellation races. Local screenshots were inspected at 1920×1080. Actual C1 decoding, subtitle burn-in and autoplay still need device validation; v0.2.5 is staged only.


## Remembered audio and subtitles in v0.2.6

Selecting a track saves its language and role after playback successfully starts at the intended position. Later on-demand videos, including autoplay and queued videos, map those preferences to their own stream indices. Common two-/three-letter language codes and regional forms are normalized (for example `es`, `spa`, and `es-MX`). Forced subtitles stay distinct from full subtitles; commentary and described audio stay distinct from normal audio. Hearing-impaired variants are preferred when the selected variant is available.

An unavailable audio match uses Jellyfin's default audio. An unavailable subtitle match disables subtitles for that video. Neither fallback overwrites the saved preference, so the desired language returns when available again. Explicit subtitle **Off** persists even if another episode defaults to subtitles On. Tracks without usable language metadata apply only to the current video and clear the remembered preference for that track type rather than guessing. Failed or cancelled switches do not replace saved preferences.

Preferences are local to this TV and keyed by server/account; they survive restart and sign-out but do not change Jellyfin's server-side user settings. **Settings → Reset track preferences** restores server defaults for subsequent videos without changing autoplay settings or interrupting the current video. Live TV retains its previous behavior.

When preferences need mapping, the client uses media-source metadata already on the item if available, otherwise a read-only PlaybackInfo request before its single playback negotiation. It does not start a temporary playback session to discover indices. Explicit indices now always identify a media source, using a metadata request when needed. A remembered Off matching the source default does not force a new HLS stream; other explicit mapped choices can use native video-copy HLS when eligible, or Compatibility when burn-in is required. v0.2.6 remains locally tested and staged; actual C1 validation is pending.


## Continuous library browsing in v0.2.7

Libraries and folders are a single scrolling grid. More items are fetched as the viewport approaches the loaded end, or when D-pad navigation needs another row. There are no Next/Previous page controls. Only one item request runs per view; failures retain already loaded items and offer Retry. The client handles missing total counts and short server batches, deduplicates item IDs, and stops automatic requests if a server returns only repeated items.

**Sort** offers title, release date and date added, each in both directions. **Show** filters watched/unwatched; **Genre** and **Year** use Jellyfin's library-scoped filter metadata, loaded only when needed. Filters combine, **Reset filters** clears them while preserving the sort, and **Refresh library** fetches current server data. Root movie and TV libraries use their video/series item types; nested folders retain their direct-child hierarchy. Preferences are saved per library, server and account on this TV.

Loaded metadata and focus/scroll position are retained in memory for the three most recently visited library/folder views. Returning from a details page reuses that state without starting from the beginning. Restarting the app retains sort/filter choices but starts browsing at the top. Use Refresh to see changes made on the server during a cached browsing session.

Only a small window of cards around the visible rows is rendered, with spacers preserving scroll geometry; previously loaded item metadata remains available for scrolling back. Posters remain lazy-loaded and off-screen card image observers are released. Layout adapts to the existing six-/four-column breakpoints. This keeps the number of rendered cards bounded as more items load. Backend requests use offsets internally; the UI remains continuous scrolling.

Validation includes 22 core tests and eight local browser suites. The focused library fixture checks loading beyond 48 items, virtual card removal, lazy posters, retry and duplicate-batch recovery, concurrent scroll/D-pad requests, focus across a delayed load, exact Back restoration, combined filters, stale-query cancellation, absent totals, capped server batches and saved preferences. Mock screenshots were inspected at 1920×1080. Real LG C1 performance still needs validation; v0.2.7 is staged only.


## Playback information and native mode in v0.2.8

Select **Playback info** during playback for source codecs/container/resolution/HDR metadata, server-reported delivered codecs and resolution, bitrate, copy-versus-encode status, transcode reasons, decoded size and available frame counters. Use the D-pad to read individual rows and **Refresh playback info** to take another server snapshot. The panel displays no media URLs, tokens or filesystem paths. If the account cannot read session information, source metadata remains available and delivered-stream details are marked unavailable. The client does not claim that source HDR metadata proves active HDR output or that copied audio proves passthrough.

In Settings, **Playback mode: Compatibility** can be switched to **LG C1 native (experimental)**. **Dolby Vision MP4 (experimental)** is a separate toggle, initially Off. These choices are saved per server/account. Existing installations remain in Compatibility until changed. Native playback errors make one Compatibility retry at the last known position; the info panel also offers **Use Compatibility for this video**, preserving position and pause state. Neither fallback changes the global mode or repeats indefinitely. Burned-in subtitles use the H.264/AAC path; turning them Off can restore native video-copy eligibility. Live TV continues to use its previous compatibility path.

See [native format limits, references, and the pending device test matrix](NATIVE-PLAYBACK.md). All 25 core tests and nine local browser suites pass. Native media in the new fixture is simulated, and no new LG hardware decoding/display/audio validation has been performed. v0.2.8 is staged only.

### v0.2.9 — Up Next and unattended playback

Up Next previews the next queued video or episode, including available artwork and description. The countdown follows the current video's remaining playback time; playback advances at its actual end. Play now advances immediately; Cancel or Back suppresses automatic advance for that video, including queued videos. Seeking away from the end hides the preview. Live TV does not show Up Next.

Account-scoped Settings offer countdown Off/15/30/60 seconds (default 30), and Still watching Off/every 3/every 5 episodes (default 3). The latter waits at an episode boundary for Keep watching or Stop watching, with no unattended playback while unanswered. Explicit confirmation resets the episode count; track changes and Compatibility retries preserve it. Manual standalone playback starts a new count. Artwork/description depend on server metadata. Local mocked browser coverage verifies countdown timing, pause, seeking, cancellation and confirmation; physical TV validation is pending.

### v0.2.10 — LG packaged startup fix

Explicitly permits local `file:` scripts, styles and images in the document security policy. The C1's Chromium 79 rejected `'self'` for these installed resources, leaving v0.2.9 blank before login. Remote and inline scripts remain blocked. Adds a startup smoke test for both source and extracted IPK contents.

### v0.2.11 — Season selection and media controls

Series details now offer Choose season, including Specials in numeric season order. Episode details offer View seasons. A season switcher remains above the continuous episode grid, with episode-number sorting by default and the selected season restored on Back. Season loading failures offer Retry.

Playback now has icon-based play/pause, 30-second skip, Next and Stop controls, a focusable/clickable seek bar, elapsed/total time and time remaining. Audio, subtitles, chapters, queue, screen fit and diagnostics sit under Options. Left/Right on the seek bar moves ten seconds; Enter returns to play/pause. Hidden controls can be revealed with Enter or directional keys; Left/Right while hidden also seeks ten seconds. Controls fade during playback, remain visible while paused or using Options, and Back first closes Options or a playback panel, then hides controls before leaving playback on another Back. Live TV retains its disabled seek controls. Local browser tests cover seek input, remote navigation, Options focus, season retries/switching and Back restoration; validation on the physical TV is pending.
