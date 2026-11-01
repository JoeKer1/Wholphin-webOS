# Ember for Jellyfin — LG webOS and Samsung Tizen

Ember is an unofficial, experimental Jellyfin client for LG webOS and Samsung Tizen TVs, inspired by [Wholphin for Android TV](https://github.com/damontecres/Wholphin). This repository contains the standalone TV implementation; it does not require an Android build or a Jellyfin Web deployment.

Current version: **0.2.54**. Developed for an LG C1 running webOS 6.5; Samsung Q6FN / Tizen 4.0 installation and startup are also confirmed; Samsung playback remains under hardware testing. Other models are untested. This is not affiliated with or an official release of Wholphin, Jellyfin, LG, or Samsung, and does not have feature parity with Android Wholphin.

The app was previously named Wholphin for webOS. Existing installations update in place and keep their sign-in and settings.

![Ember icon](webos/app/ember-large-icon.png)

## Features

- Password and Quick Connect sign-in, customizable Home, library-specific rows and seasonal holiday rows.
- Continuous library browsing, season selection, sorting/filtering, search, favorites and item details.
- Resume playback, audio/subtitle selection, remembered track languages, styled SRT/WebVTT subtitles with size/color/background/position/delay controls, chapters and playback queue.
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
Samsung uses AVPlay and a Chromium 56 compatibility bundle. LG retains its existing HTML video playback.

```sh
npm ci
npm test
npm run build:webos  # dist/webos, LG appinfo.json
npm run build:tizen  # dist/tizen, Samsung config.xml
npm run package:webos
TIZEN_PROFILE=YourSamsungProfile npm run package:tizen
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

## License and attribution

Distributed under the [GNU GPL version 2](LICENSE), retaining the upstream Wholphin license. Wholphin branding/assets and the UI inspiration originate from [damontecres/Wholphin](https://github.com/damontecres/Wholphin); credit belongs to its contributors. Seasonal query presets are credited to [KefinTweaks](https://github.com/ranaldsgift/KefinTweaks), as documented in the source and webOS README. The webOS application is a separate implementation maintained here.
