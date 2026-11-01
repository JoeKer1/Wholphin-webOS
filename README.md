# Ember for Jellyfin — LG webOS

Ember is an unofficial, experimental Jellyfin client for LG webOS TVs, inspired by [Wholphin for Android TV](https://github.com/damontecres/Wholphin). This repository contains the standalone webOS implementation; it does not require an Android build or a Jellyfin Web deployment.

Current version: **0.2.43**. Developed for an LG C1 running webOS 6.5; other models are untested. This is not affiliated with or an official release of Wholphin, Jellyfin, or LG, and does not have feature parity with Android Wholphin.

The app was previously named Wholphin for webOS. Existing installations update in place and keep their sign-in and settings.

![Ember icon](webos/app/largeIcon.png)

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

Open http://localhost:8080 to browse locally. Desktop browsers without native HLS support cannot play the TV's transcoded HLS streams. Source has no runtime dependencies or build step. Browser tests additionally require Playwright and Chromium; see [webOS documentation](webos/README.md).

## Install

Install LG's Developer Mode app on the TV and the official `@webos-tools/cli` on your computer. Follow [package and sideload instructions](webos/README.md#package-and-sideload). Installing a package does not require launching it; launch only when you are ready to interrupt current viewing.

See [security notes](webos/SECURITY-REVIEW.md) and [native playback limitations and pending hardware tests](webos/NATIVE-PLAYBACK.md). Experimental native codec support is not a guarantee of HDR display output or audio passthrough.

## License and attribution

Distributed under the [GNU GPL version 2](LICENSE), retaining the upstream Wholphin license. Wholphin branding/assets and the UI inspiration originate from [damontecres/Wholphin](https://github.com/damontecres/Wholphin); credit belongs to its contributors. Seasonal query presets are credited to [KefinTweaks](https://github.com/ranaldsgift/KefinTweaks), as documented in the source and webOS README. The webOS application is a separate implementation maintained here.
