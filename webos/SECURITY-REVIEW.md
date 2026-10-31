# webOS client review — 2026-10-31

Scope: the standalone `webos/app` client, its login, network requests, metadata rendering, Home loading, and playback URL selection. This is a source review with mocked browser checks, not a penetration test of the Jellyfin server, Android app, TV OS, or network.

## Addressed in 0.2.4

- **Preview data crossed account lifetimes.** The preview cache used item IDs and survived sign-out. Sign-in/sign-out now clear it, and late preview responses must match the current session and screen before caching or rendering.
- **Obsolete requests consumed resources.** Home row and preview requests now abort on navigation. Queued rows already check screen identity before starting. This avoids competing with requests for the new screen; playback reporting and tuner cleanup remain independent.
- **API redirects were followed automatically.** API fetches now reject redirects, omit browser cookies, suppress referrers, and avoid the browser HTTP cache. This also protects password and Quick Connect POST bodies from redirect replay. Use the canonical Jellyfin server URL; configure reverse proxies to serve API routes directly instead of redirecting them.
- **No explicit document policy.** A Content Security Policy now limits executable scripts to packaged files and disables embedded objects, base URL changes, and native form submission. Metadata continues to use text nodes. Network/media/image sources permit HTTP and HTTPS because servers are user-configured; this is not a server-origin allowlist. Inline styles remain allowed for existing player/UI geometry, while inline scripts and eval remain blocked.
- **Authentication responses were trusted without validation.** Both login methods now require a nonempty token and user ID. Invalid results do not enter Home. A superseded password form cannot replace a newer screen's session.
- **Response-body reads escaped request timeouts.** The 20-second abort timer now covers JSON body consumption as well as response headers.

## Quick Connect handling

Uses Jellyfin's Enabled → Initiate → Connect → AuthenticateWithQuickConnect flow. Only the six-digit code appears on screen. The secret remains in memory and is sent only to the selected server; polling every three seconds is sequential. Cancel, Back, navigation, hiding the app, and a ten-minute local expiry clear the secret and abort pending requests. Cancellation cannot revoke a server-issued code: Jellyfin controls its server-side expiry. Password login remains available. No user password or Quick Connect secret is stored in localStorage. The resulting access token is saved to retain the login between launches.

Protocol references: [Jellyfin Quick Connect guide](https://jellyfin.org/docs/general/server/quick-connect/), [controller](https://github.com/jellyfin/jellyfin/blob/master/Jellyfin.Api/Controllers/QuickConnectController.cs), and [expiry implementation](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/QuickConnect/QuickConnectManager.cs).

## Remaining limits

- Bare server addresses default to HTTP on port 8096 as requested. HTTP exposes credentials, tokens, Quick Connect secrets, and media to anyone able to observe that traffic. HTTPS must be configured on the server/proxy and entered explicitly to encrypt it. Quick Connect avoids typing a password on the TV, but does not encrypt HTTP.
- The access token is in app-local storage, without hardware-backed encryption. Code executing in the app context or privileged TV access could read it. Sign-out removes the saved token and attempts server logout; if offline, server revocation cannot be confirmed. Account-scoped library names and Home preferences remain on the TV.
- Native video playback needs a token in the media URL. Initial transcode URLs are checked against the server origin, but the native media engine's redirects and subsequent HLS segment requests are outside the JavaScript API fetch policy. The selected server and proxy remain trusted.
- No actual LG Chromium 79 run or live Quick Connect approval was performed for this build, to avoid disturbing the TV session. Native playback and CSP behavior still need a device check when convenient.

## Loading changes and evidence

Cold-start resume/Next Up requests begin alongside library discovery instead of waiting for it. The browser test holds both endpoints independently and proves that Resume starts before Views finishes, without duplicate requests. Home's request queue retains its two-row concurrency limit. Poster requests use 450px instead of 600px for 225px portrait cards; landscape cards use 720px for a 360px display width. Posters still load by visibility. Home cache entries are capped at 60; preview entries remain bounded. No percentage improvement in real TV load time or transfer size is claimed.

Validation: 15 core tests, syntax checks, and six browser suites covering existing playback/resume, Home navigation/loading, live tuner cleanup, holidays, Quick Connect, redirect blocking, metadata injection resistance, startup overlap, and obsolete-request cancellation. All run locally against mocked server/media responses.

## v0.2.8 diagnostics follow-up

The playback panel requests `/Sessions` only on opening/refreshing it and filters results by current device/user/item and available play-session ID. Display fields are explicitly selected; media URLs, tokens, source paths and raw session JSON are not rendered. Unknown transcode-reason strings are not echoed. API redirect/referrer/cookie protections remain in effect. Closing the panel aborts its pending request, and lack of session-read permission degrades to source-only diagnostics. New preset choices are non-secret account-scoped local preferences. This follow-up has core and mocked-browser coverage, without a live server permission audit or TV execution.

## 0.2.10 packaged startup correction

On the LG C1's Chromium 79 runtime, the installed file-based page's `'self'` CSP source did not authorize its own local scripts or stylesheet. Browser security logs confirmed all three were blocked, preventing startup. Script, style and image directives now explicitly allow `file:` alongside `'self'`. This permits local-file resources (not a directory-specific allowlist); HTTP/HTTPS scripts, inline scripts, eval, objects, forms and base changes remain blocked. Server metadata is still rendered as text. A startup regression checks explicit file sources, login rendering and applied CSS, and confirms inline/remote scripts remain blocked; it can also run against extracted, minified IPK contents with `APP_DIR`.
