# Ember for Jellyfin — webOS, Tizen and Fire TV

Ember is an unofficial, experimental Jellyfin client for LG webOS, Samsung Tizen and Android-based Fire TV devices, inspired by [Wholphin for Android TV](https://github.com/damontecres/Wholphin). This repository contains the standalone TV implementation; it does not require an Android build or a Jellyfin Web deployment.

Current version: **0.2.93**. Developed for an LG C1 running webOS 6.5; Samsung Q6FN / Tizen 4.0 installation and startup are also confirmed. Android-based Fire TV devices use Media3 1.11.1 with device-derived Direct Play profiles, native subtitle support and compatibility fallback. Direct Play has been validated on Fire TV hardware, including HDR10 on a supported display. Other models and media combinations remain under testing. This is not affiliated with or an official release of Wholphin, Jellyfin, LG, Samsung, or Amazon, and does not have feature parity with Android Wholphin.

The app was previously named Wholphin for webOS. Existing installations update in place and keep their sign-in and settings.

![Ember icon](webos/app/ember-large-icon.png)

## Features

- Password and Quick Connect sign-in, customizable Home, library-specific rows and seasonal holiday rows.
- Continuous library browsing, season selection, sorting/filtering, search, favorites and item details.
- Resume playback, audio/subtitle selection, remembered track languages, styled SRT/WebVTT subtitles with previewed size/color/background/position choices, plus per-video/track timing in player configuration, chapters and playback queue.
- Search and download SRT/WebVTT subtitles through configured Jellyfin providers, before or during playback.
- Fire TV libass rendering for SSA/ASS, external text sidecars and in-place switching of supported loaded subtitles. LG/Tizen PGS continues to require server burn-in.
- Next-episode autoplay, Up Next previews/countdown and configurable Still watching confirmation.
- Live TV now/next guide, channel favorites, later listings, continuous channel browsing and playback without EPG.
- Conservative Compatibility playback by default; experimental opt-in LG C1 native HEVC/4K support and playback diagnostics.
- Remote navigation, standard media controls with a seek bar and Options menu, Magic Remote pointer controls and lazy-loaded posters.

## Development

```sh
cd webos
npm test
npm run check
npm run serve
```

Open http://localhost:8080 to browse locally. Desktop browsers without native HLS support cannot play the TV's transcoded HLS streams. The LG source runs directly. Separate platform builds and Samsung compatibility bundles are generated from the repository root. Browser tests additionally require Playwright and Chromium; see [webOS documentation](webos/README.md).

## Install

Install LG's Developer Mode app on the TV and the official `@webos-tools/cli` on your computer. Follow [package and sideload instructions](webos/README.md#package-and-sideload). Installing a package does not require launching it; launch only when you are ready to interrupt current viewing.

See [security notes](webos/SECURITY-REVIEW.md) and [native playback limitations and pending hardware tests](webos/NATIVE-PLAYBACK.md). Experimental native codec support is not a guarantee of HDR display output or audio passthrough.

## Separate platform builds

Shared UI source lives in `webos/app`; platform adapters are selected at build time.
Samsung uses AVPlay, Fire TV uses native AndroidX Media3, and both bundle browser compatibility helpers. LG retains its existing HTML video playback.

```sh
npm ci
npm test
npm run build:webos  # dist/webos, LG appinfo.json
npm run build:tizen  # dist/tizen, Samsung config.xml
npm run build:firetv # dist/firetv, bundled APK assets
npm run package:webos
TIZEN_PROFILE=YourSamsungProfile npm run package:tizen
npm run package:firetv # requires JDK 17 + Android SDK
```

Packaging requires the official LG CLI or Tizen CLI on PATH (or `ARES_PACKAGE` / `TIZEN_CLI`).
Samsung retail TV packages require your own Samsung TV author/distributor certificate profile,
including the target TV DUID. The SDK's default emulator certificate cannot be used for a retail TV.
Keep certificates and passwords outside this repository and back up the author certificate for future updates.
See [Samsung's certificate instructions](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).

Browser regression checks require Playwright (`PLAYWRIGHT_MODULE` and optional `CHROMIUM_PATH`).
After building Samsung, run `node test/tizen-browser.cjs` to exercise its adapter, remote keys,
compatibility polyfills, older IntersectionObserver API and navigation expansion.

Server addresses add port 8096 only for a 192.168.* host without an explicit port.
Other hosts retain the protocol's default port unless a port is entered.

Fire TV build, sideload, security and hardware validation details are in [platforms/firetv/README.md](platforms/firetv/README.md). This APK targets Android-based Fire OS devices, not Vega OS.

## License and attribution

Distributed under the [GNU GPL version 2](LICENSE), retaining the upstream Wholphin license. Wholphin branding/assets and the UI inspiration originate from [damontecres/Wholphin](https://github.com/damontecres/Wholphin); credit belongs to its contributors. Seasonal query presets are credited to [KefinTweaks](https://github.com/ranaldsgift/KefinTweaks), as documented in the source and webOS README. The Ember TV application is a separate implementation maintained here.

### Shared menu regression checks

After changing shared menus or remote navigation, run `npm run test:menus`.
This builds LG webOS, Samsung Tizen and Fire TV assets, then exercises the same
settings, nested subtitle appearance, Back/focus restoration and Home editor
flows against each platform bundle. Tizen and Fire TV also run with the legacy
layout fallback and missing APIs supplied by their compatibility bundle.
Set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` if Playwright/Chromium are outside the
normal module and browser locations. These fixture checks complement device
validation; they do not verify native playback or actual TV firmware rendering.

### In-app screensaver

Settings → Device → Screensaver controls the profile's artwork slideshow.
It starts after five minutes of idle browsing by default, changes artwork every
30 seconds, and offers slow zoom, an optional moving clock, configurable timing,
and a preview. It uses movie/show backdrops accessible to the signed-in user.
Any remote press dismisses it and restores focus without activating the control
underneath. Playback (including paused video), profile selection, hidden apps and
suspension prevent or dismiss it. Empty/error artwork responses retain a moving
Ember title on black. This operates inside Ember; it does not replace or disable
the TV's system screensaver. Run `npm run test:screensaver` for the three-platform
fixture checks.

### Profile subtitle defaults

Settings → Subtitles → Subtitle defaults offers remembered choices, preferred
language when available, or Off. English captions for known non-English audio
are enabled by default and can be disabled separately. Defaults, remembered
choices and title overrides belong to the signed-in profile on this device;
selecting Off on one profile does not change another. An explicit title choice
wins over automatic defaults. Missing preferred subtitles stay off, and unknown
audio language does not trigger the non-English rule. Automatic selection favors
text subtitles over bitmap tracks when both are available.

LG/Tizen can extract ASS/SSA as plain WebVTT instead of burning it into video.
This loses ASS styling/positioning; bitmap captions and failed text extraction
retain the conversion fallback. Fire TV retains its native ASS renderer by
default. Run `npm run test:subtitle-defaults` for cross-platform coverage.

### Anime audio language

Settings → Playback → Anime audio language chooses Japanese, English or another
supported language for this profile on this TV. It defaults to the normal audio
preference. Anime is identified through a library with Anime in its name, item
ancestry, or an explicit Anime genre (Animation alone is not treated as anime).
The rule also runs when starting an episode through Continue watching or
autoplay; manual in-player audio selection takes priority for that playback.
Missing preferred audio falls back to the normal profile/server choice. Subtitle
defaults use the selected audio language, so Japanese audio can automatically
enable English captions. Run `npm run test:anime-audio` for platform checks.

### Profile language sync

Ember syncs subtitle defaults (mode, preferred language and English for non-English audio) and the anime audio language through Jellyfin’s per-user display preferences. Bonfire profiles use their own Jellyfin user IDs, so their choices remain separate. LG, Samsung and Fire TV use the same Ember settings namespace; no Bonfire update is required.

Settings refresh when a profile opens or Settings opens. Explicit changes save to the server immediately. A local cache keeps preferences usable offline, and pending changes retry the next time the profile or Settings opens. On first sync, existing device preferences migrate only when no server preference exists; otherwise the server choice wins. Individual-title track choices, subtitle timing and appearance remain local. Devices need Ember 0.2.77 or newer to participate.

### Seerr integration (Fire TV, v0.2.88+)

Open **Seerr** in the sidebar or **Settings → Playback → Seerr**. Ember connects with the selected Jellyfin profile using Quick Connect, without another password. Jellyfin Quick Connect must be enabled and Seerr must use the same Jellyfin server. An optional different Seerr account can be configured manually. Each profile has its own native cookie session; passwords and API keys are not saved. No additional server container is required.

Includes trending movies/shows, movie and TV discovery, upcoming movies, search, My requests, automatic loading of additional results, title availability and links back to available Jellyfin items. Request movies or individual TV seasons, with optional 4K when your Seerr account permits it. Requests require confirmation; Seerr controls permissions, quotas and approval.

Seerr browsing and requests are currently Fire TV only. Its address now follows the profile through Jellyfin display preferences in the shared `ember` namespace (`ember-seerr-connection`). Existing configured TVs migrate their address automatically when no server value exists; clean devices adopt the server value. Explicit address edits queue for retry if Jellyfin is unavailable. Only the address syncs: cookies, credentials, and device disconnect choices stay local. Other profiles on a configured TV can inherit the address while authenticating independently, then save their own copy to Jellyfin. Use a public HTTPS address if TVs will connect away from home. No parent-profile token or new plugin is required. Native HTTP/CSRF/cookie regression instructions are in [test/native/README.md](test/native/README.md).

### Text subtitle recovery (v0.2.79+)

SRT/WebVTT/ASS/SSA extraction retries once after temporary server/network failures or empty extraction results before using server rendering. The retry is cancelled when playback is stopped; authentication errors, missing tracks and oversized files are not retried. If a text track has already fallen back to burn-in, selecting that same track again retries extraction while retaining position and paused state. Bitmap tracks keep their existing fallback. The shared path is tested in LG, Samsung and Fire TV bundles.

### Watched state and episode transitions (v0.2.80+)

Completed playback uses a stable final position even if a TV resets its clock at EOF. Watch state is refreshed from Jellyfin after reporting stop; natural completion is explicitly marked watched if the server has not done so. Mounted poster/episode checkmarks and selected season actions update immediately, and Home/library caches refresh without restarting Ember. Partial manual skips are not marked complete.

Following-episode lookups retry after a transient failure, and a failed stop/encoding-cleanup request no longer prevents the next video starting. Reports remain ordered, bounded, tied to the account that started playback, and duplicate end events do not send duplicate completion reports. A cross-platform fixture regression is available with `npm run test:completion`.

### Intro/outro skipping and display matching (v0.2.89+)

All three clients use Jellyfin's `/MediaSegments/{itemId}` timestamps for intro/outro skipping. Jellyfin 10.10+ and a segment provider such as Intro Skipper must supply these timestamps; Ember does not guess from chapter names. Under **Settings → Playback**, each profile can choose **Show skip button** (default), **Automatically**, or **Off**, separately for intros and outros. With transport controls hidden, OK activates the visible skip button. Titles without segments and older servers continue normally; Live TV is excluded. Skipping an outro seeks to its end and keeps normal completion/autoplay behavior, including post-credit scenes when the segment ends before the media does. Skip choices are local to the profile on that device.

**Match video display** is device-local and off by default. On native Fire TV playback it can request advertised refresh-rate modes, resolutions, or both. Only options supported by the connected display are shown. Cadence matching distinguishes 23.976 from 24 fps and can use integer multiples; resolution matching selects the smallest advertised resolution that fits the video, with the current resolution as fallback. Missing frame-rate metadata preserves the current refresh rate. The original window display preference is restored on stop, source replacement, suspend and exit. The OS/TV decides whether to honor a mode request, and HDMI switching may briefly blank the screen. Compatibility playback and Live TV do not request mode changes. LG webOS and Samsung Tizen keep their platform's normal display handling; this feature does not change their physical panel timing or app canvas resolution.

The Insignia's current advertised modes are 1080p/4K at 60 Hz, so it offers resolution matching. The other Fire TV advertises additional film/TV refresh rates and supports both settings. These capability reads are not confirmation of a successful live mode switch.

Checks: `npm run test:segments`, `npm run test:completion`, and the pure native selector regression:

```sh
javac -d /tmp/ember-display-tests platforms/firetv/app/src/main/java/tv/ember/jellyfin/DisplayModeSelector.java test/native/DisplayModeSelectorTest.java
java -cp /tmp/ember-display-tests tv.ember.jellyfin.DisplayModeSelectorTest
```

### GitHub updates on Fire TV (v0.2.90+)

Open **Settings → About → App updates**. Check for a newer stable GitHub Release, choose **Download**, then **Install update**. Ember opens Fire TV's system installer for your confirmation; it never silently installs or starts installation during playback. On supported Fire OS versions you may first need to allow Ember under **Developer Options → Install unknown apps**, then return to Ember and select Install update again. Older Fire OS versions use the system's global unknown-source setting. Sign-in and settings are preserved by an in-place update.

Release checks and downloads run in native code without Jellyfin/Seerr credentials. The source repository is fixed to this repository. Prereleases and downgrades are excluded. Only an exact `ember-firetv-VERSION-debug.apk` release asset is accepted; its declared size and GitHub SHA-256 digest, package ID, version, minimum Android API and signer matching the installed app are verified. Downloads are bounded, use HTTPS and allow only GitHub release delivery hosts. Partial/unverified files are never offered for installation. The initial updater-capable APK must be installed once through ADB; subsequent Fire TV releases can use this screen. There are no scheduled checks or forced restarts.

Maintainers: publish a stable release tagged `vVERSION` with the matching versioned APK attached, built with the **same signing key** as existing installs. Keep the current local Android signing key backed up privately; do not upload keystores to this public repository. GitHub must provide the release asset's `sha256:` digest. Uploading source changes alone does not publish an update. The current build retains the existing debug application ID/signing channel so installations can update in place; a future production signing/app-ID migration needs a separate plan. LG and Tizen do not expose this update screen and still use their existing installation workflow.

Run `npm run test:updater` for navigation/permission-flow fixtures. `UpdateReleaseTest.java` exercises stable-version, exact asset, origin, digest and size validation using `org.json:json:20240303` as a test runtime. Real Fire TV installer acceptance remains device-dependent.

### Fire TV launcher artwork (v0.2.92)

The launcher uses an explicit `EmberLauncher` activity alias with the current tile artwork, while keeping the existing app ID, data and updater channel. On the Insignia, updating/rebooting/clearing temporary cache and changing the launcher entry did not replace Amazon's persisted old artwork. A full uninstall followed by a fresh v0.2.92 installation did: the launcher now shows the current flame and Ember wordmark. A full uninstall clears Ember's local sign-in/settings and its per-app install permission; use this only when the stale-artwork issue warrants signing in again. Normal in-place updates remain the default.

### Full-size Fire TV artwork (v0.2.93)

The Fire TV tile is now an opaque **1280×720** PNG on a black background, with a **512×512** square fallback. The application icon, banner and logo all reference the wide artwork; `roundIcon` references the square fallback. This changes the primary application icon too, since supplying only an Android TV banner left the square application icon available to Fire OS's sideloaded-app treatment. LG and Samsung artwork are unchanged. The APK's embedded dimensions and primary resource mapping have been checked. Actual Fire TV launcher padding/caching behavior remains to be validated on hardware; this release does not claim that the gray padding is eliminated.

Source artwork: `platforms/branding/ember-firetv-tile.svg` and `ember-firetv-square.svg`. Regenerate the packaged PNGs with `node tools/render-firetv-branding.cjs` (requires Playwright; `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` can select an existing installation).
