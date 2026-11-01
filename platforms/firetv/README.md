# Ember for Fire TV (experimental)

An isolated APK project for **Android-based Fire OS 6 and later** (Android API 25+), including Fire TV Stick 4K and compatible Fire TV televisions. Vega OS devices cannot install this APK.

The APK bundles Ember's shared UI from `webos/app` with a Fire TV platform adapter. AndroidX Media3 plays video underneath a transparent WebView, with Ember's remote controls, subtitle overlay and live-guide preview on top. The initial playback policy uses Jellyfin's H.264/AAC compatibility negotiation. Native 4K/HDR passthrough has not been enabled or verified.

## Build

Install JDK 17 and the official Android SDK with platform 35 and build-tools 35.0.0, and set `JAVA_HOME` and `ANDROID_HOME`. From the repository root:

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

The bridge tests cover asynchronous start, resume seek units, cancellation/stale events, preview bounds and live seek ranges. Browser tests cover app startup, server negotiation, remote pause, background cleanup, platform settings and shared sidebar order. APK assembly/signature checks and Android lint pass. Physical Fire TV playback and remote/keyboard behavior still need device validation.

## Security and lifecycle

Only the bundled `appassets.androidplatform.net/assets/index.html` page can navigate in the WebView. Local file/content access and popups are disabled; default TLS validation stays enabled. The native bridge checks the current page before handling commands, allows only HTTP(S) media sources, keeps credentials out of playback errors, and ignores commands/events from replaced streams. HTTP/mixed content is deliberately enabled for user-configured Jellyfin LAN servers. The existing UI CSP and inert metadata rendering remain in effect.

On backgrounding, Ember stops its session/tuner and pauses native playback. Audio focus is handled by Media3. App data backup/transfer is disabled; sessions and settings remain local to this APK. WebView inspection is enabled only in debug builds.

Media3, AndroidX WebKit and their dependencies retain their upstream licenses. The shared Ember UI retains the repository's GPL license and Wholphin attribution.
