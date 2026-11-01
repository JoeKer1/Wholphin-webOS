# Ember for Fire TV (experimental)

An isolated APK project for **Android-based Fire OS 6 and later** (Android API 25+), including Fire TV Stick 4K and compatible Fire TV televisions. Vega OS devices cannot install this APK.

The APK bundles Ember's shared UI from `webos/app` with a Fire TV platform adapter. AndroidX Media3 1.11.1 (matching upstream Wholphin) plays video underneath a transparent WebView, with Ember's remote controls, subtitle overlay and live-guide preview on top. Automatic playback now builds a Jellyfin profile from detected hardware video decoders and Media3's current Fire OS/HDMI audio capabilities. Supported files can direct-play (including 4K HDR10/HLG when reported by the decoder and connected display); unsupported audio can be converted while copying supported video. Decoded audio channel limits are queried per codec separately from HDMI passthrough. Compatibility remains selectable in Settings → Device and is retried automatically on playback errors. Native video uses SurfaceView to preserve HDR output. Dolby Vision remains on Compatibility pending profile-specific validation.

## Playback integration

- Hardware decoder probing bounds codec, resolution, frame rate, bit depth, bitrate and AVC/HEVC level. Missing capabilities retain conservative compatibility playback.
- Dolby AC-3/E-AC-3 are advertised only when decoding or the current audio route supports them. Output channels are bounded by that route; DTS/TrueHD are not advertised.
- Media3 decoder initialization fallback is enabled. Runtime failures retry Jellyfin compatibility negotiation at the same position, with the selected tracks and paused state retained.
- Direct-play audio and embedded subtitle selection maps Jellyfin stream indices to native track ordinals. Unsupported/mismatched native tracks fail into compatibility instead of silently selecting a different language.
- Embedded SSA/ASS, PGS, SRT/WebVTT and MOV text can use native Media3 subtitle rendering. Styled SRT/WebVTT web overlays remain available. External or unsupported subtitles use the existing overlay or server conversion path. Full libass font/animation rendering and MPV are not bundled.
- Live TV keeps its existing compatibility HLS and preview/tuner lifecycle.

These changes follow the device-profile and renderer-fallback approach in upstream Wholphin's `PlayerFactory` and `DeviceProfileService`; the bundled interface stays shared across platforms. Physical Fire TV decoding, passthrough and subtitle rendering still need device validation.

## Build

Install JDK 17 and the official Android SDK with platform 36 and build-tools 35.0.0, and set `JAVA_HOME` and `ANDROID_HOME`. From the repository root:

```sh
npm ci
npm run package:firetv
```

The isolated Gradle wrapper downloads Gradle 8.11.1. The APK is written to `dist/ember-firetv-<version>-debug.apk`; staged web assets are in `dist/firetv`. `GRADLE` can override the wrapper executable.

This is a debug-signed sideload/test build, with application ID `tv.ember.jellyfin.debug`. It does not overwrite upstream Wholphin, Jellyfin or either TV-platform app. Back up your local Android debug keystore if you need to update this test installation consistently. Appstore distribution needs a separately configured release signing key; never commit signing keys or passwords.

## Sideload

Enable ADB debugging on the Fire TV and approve the computer's connection prompt:

```sh
adb connect FIRE_TV_IP:5555
adb -s FIRE_TV_IP:5555 install -r dist/ember-firetv-VERSION-debug.apk
adb -s FIRE_TV_IP:5555 shell am start -n tv.ember.jellyfin.debug/tv.ember.jellyfin.MainActivity
```

## Validation

```sh
npm test
npm run build
# With Playwright installed (or PLAYWRIGHT_MODULE pointing to it):
node test/firetv-browser.cjs
node test/navigation-browser.cjs
platforms/firetv/gradlew -p platforms/firetv lintDebug
```

The bridge tests cover asynchronous start, resume seek units, cancellation/stale events, preview bounds and live seek ranges. Browser tests cover app startup, server negotiation, remote pause, background cleanup, native ASS selection, audio switching, device-profile negotiation, same-position compatibility retry, platform settings and shared sidebar order. APK assembly/signature checks and Android lint pass. Physical Fire TV playback and remote/keyboard behavior still need device validation.

## Security and lifecycle

Only the bundled `appassets.androidplatform.net/assets/index.html` page can navigate in the WebView. Local file/content access and popups are disabled; default TLS validation stays enabled. The native bridge checks the current page before handling commands, allows only HTTP(S) media sources, keeps credentials out of playback errors, and ignores commands/events from replaced streams. HTTP/mixed content is deliberately enabled for user-configured Jellyfin LAN servers. LAN HTTP artwork is fetched as blobs to avoid Chromium mixed-image blocking; temporary blob URLs are released after decoding. The Fire TV CSP permits these local image blobs. The existing UI CSP and inert metadata rendering remain in effect.

On backgrounding, Ember stops its session/tuner and pauses native playback. Audio focus is handled by Media3. App data backup/transfer is disabled; sessions and settings remain local to this APK. WebView inspection is enabled only in debug builds.

Media3, AndroidX WebKit and their dependencies retain their upstream licenses. The shared Ember UI retains the repository's GPL license and Wholphin attribution.
