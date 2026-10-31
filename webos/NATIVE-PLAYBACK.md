# LG C1 native playback — v0.2.8

This is an opt-in C1 preset, not automatic hardware capability detection. Compatibility remains the default and retains the previous 1080p H.264/AAC profile. Enable **Settings → Playback mode → LG C1 native (experimental)** when testing on the C1. A separate **Dolby Vision MP4 (experimental)** toggle defaults Off. Other TV models should use Compatibility until their capability profiles are validated.

## What the native profile requests

- MP4/M4V direct playback of compatible H.264/HEVC with AAC/MP3 stereo or AC-3/E-AC-3 up to six channels. DTS, TrueHD, AV1, lossless audio, and Atmos/passthrough promises are excluded.
- Up to 3840×2160. HEVC Main/Main 10 is limited to level 5.1 (FFmpeg level 153), ten bits, 60fps and 60Mbps. H.264 baseline/main/high is limited to eight bits, level 5.1, 50Mbps and 30fps above 1920px width; up to 60fps is allowed at lower widths.
- HEVC SDR/HDR10 are eligible. Dolby Vision direct playback is restricted to compatible MP4 variants identified as DOVI or DOVIWithHDR10, with dvh1/dvhe codec tags. Enhancement-layer, HDR10+ hybrid and non-MP4 Dolby Vision sources use Compatibility. This does not promise that every file tagged with those variants will decode correctly.
- Compatible non-Dolby-Vision MKV video may use native fragmented-MP4 HLS remuxing, preserving the video while converting the container or audio as necessary. MKV progressive direct play remains disabled. The server decides whether copy is possible; actual copy status is read from session telemetry instead of inferred from source codecs.
- Subtitle burn-in uses Compatibility for predictable decoding and server tone mapping. Explicit audio changes or subtitle Off can retain native video-copy eligibility. When Off already matches the source default, the saved preference does not unnecessarily force HLS. Explicit audio/subtitle stream indices always travel with a media source ID.

The preset enables the appropriate server negotiation; it does not control the TV's HDR picture mode, HDMI/eARC routing, receiver capabilities, or Jellyfin's tone-mapping configuration. Bitrate caps describe negotiated streams, not measured network throughput. Native mode can add a read-only media-info request before playback to inspect source metadata; it does not start a disposable play session.

## Playback information

**Playback info** is a remote-navigable panel. It separates source metadata from delivered-stream telemetry and decoded dimensions/frame counters. Session data must match the current device, user, item and, when provided, play session. Missing permissions or not-yet-available telemetry produce an explicit unavailable state. Only selected display fields are rendered: no access tokens, stream URLs, server filesystem paths or other users' session data.

Server HLS is labelled as remux, video-copy/audio-encode, or video transcode only when the server supplies the corresponding flags. A source HDR tag is shown as source metadata and does not establish the TV's active display mode. Audio copied by the server does not establish receiver passthrough. Refresh is manual; the panel does not add a permanent session polling loop. Closing it aborts a pending diagnostics request.

A native decoder error triggers one H.264/AAC Compatibility retry with video copy disabled and the last known playback position retained. A second error stops playback. Manual per-video Compatibility preserves paused state. Both leave the global preset unchanged, and Stop/navigation cancel pending negotiation so a late response cannot restart playback.

## Pending C1 device validation

The TV was not launched, navigated or inspected during this update. Every hardware observation below is pending. Local browser tests mock media decoding and server responses.

| Media / action | Expected behavior | Hardware observation |
| --- | --- | --- |
| Existing H.264/AAC sample in Compatibility | Existing play/resume behavior | Pending for this build |
| HEVC Main/Main 10 SDR MP4, including 4K | Direct playback within profile limits | Pending |
| HEVC HDR10 MP4 | Direct playback; verify actual TV HDR indication | Pending |
| HEVC HDR10 MKV with DTS audio | Video-copy HLS with supported audio conversion, if the server permits it | Pending |
| AC-3/E-AC-3 5.1 | Correct audible channels; verify TV/receiver routing separately | Pending |
| Compatible DV profile 5 / 8.1 MP4 with toggle On | Direct playback; verify actual Dolby Vision indication | Pending |
| DV enhancement-layer, hybrid or MKV source | Compatibility negotiation | Pending |
| Selected subtitle, then Off | Burn-in fallback, then eligible native path at the same position | Pending |
| Resume/seek during direct and remux playback | Position retained without a duplicate time offset | Pending |
| Native error and manual Compatibility | One retry; retained bookmark; Stop prevents restart | Pending |
| Session telemetry unavailable | Source-only diagnostics remain readable | Pending |

## References

Profile limits follow [LG's webOS 6 media specification](https://webostv.developer.lge.com/develop/specifications/video-audio-60). Container/remux and Dolby Vision restrictions are informed by the [official Jellyfin webOS adapter](https://github.com/jellyfin/jellyfin-webos/blob/master/frontend/js/webOS.js) and [Jellyfin browser profile implementation](https://github.com/jellyfin/jellyfin-web/blob/master/src/scripts/browserDeviceProfile.js). Codec condition application and stream-index/source-ID requirements were checked against [Jellyfin StreamBuilder](https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/Dlna/StreamBuilder.cs); diagnostics use the fields in [TranscodingInfo](https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Model/Session/TranscodingInfo.cs).
