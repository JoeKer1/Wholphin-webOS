(function (root) {
  "use strict";
  var embedded = ["ass", "ssa", "srt", "subrip", "vtt", "webvtt", "mov_text", "pgssub"];
  function condition(property, value, operator, required) {
    return { Property: property, Value: String(value), Condition: operator || "LessThanEqual", IsRequired: required !== false };
  }
  function subtitle(source, index) {
    return ((source && source.MediaStreams) || []).find(function (s) {
      return s.Type === "Subtitle" && s.Index === index;
    });
  }
  function policy(source, options, index, caps) {
    if (!options.native) return { native: false, reason: "Compatibility mode selected" };
    var video = ((source && source.MediaStreams) || []).find(function (s) { return s.Type === "Video"; }),
      support = video && (caps.videos || []).find(function (v) { return v.codec === String(video.Codec).toLowerCase(); }),
      text = subtitle(source, index);
    if (!support || !(caps.audio || []).length) return { native: false, reason: "No matching device decoder capability" };
    if ((video.VideoRangeType && video.VideoRangeType !== "SDR") || video.VideoRange === "HDR" ||
        (!video.VideoRangeType && video.BitDepth > 8))
      return { native: false, reason: "HDR uses Compatibility with the current video surface" };
    if (index >= 0 && (!text || text.IsExternal || embedded.indexOf(String(text.Codec).toLowerCase()) < 0))
      return { native: false, reason: "Selected subtitles require server conversion" };
    return { native: true, reason: "Fire TV device decoder and audio-route negotiation" };
  }
  function profile(caps, fallback) {
    var videos = (caps.videos || []).filter(function (v) { return ["h264", "hevc", "vp9", "av1"].indexOf(v.codec) >= 0; }),
      audio = (caps.audio || []).filter(function (a) { return ["aac", "mp3", "flac", "opus", "vorbis", "ac3", "eac3"].indexOf(a) >= 0; }),
      channels = Math.max(2, Math.min(6, Number(caps.maxAudioChannels) || 2));
    fallback.Name = "Fire TV Media3 (device capabilities, SDR)";
    fallback.MaxStreamingBitrate = 80000000;
    fallback.DirectPlayProfiles = [{ Container: "mkv,mp4,m4v,mov,webm,ts,mpegts", Type: "Video",
      VideoCodec: videos.map(function (v) { return v.codec; }).join(","), AudioCodec: audio.join(",") }];
    fallback.CodecProfiles = videos.map(function (v) {
      var conditions = [condition("Width", v.width), condition("Height", v.height),
        condition("VideoBitDepth", v.bitDepth), condition("VideoFramerate", v.frameRate),
        condition("VideoBitrate", v.bitrate), condition("VideoRangeType", "SDR", "EqualsAny", false)];
      if (v.codec === "h264") {
        conditions.push(condition("VideoLevel", v.level || 41));
        conditions.push(condition("VideoProfile", "baseline|constrained baseline|main|high", "EqualsAny", false));
      }
      if (v.codec === "hevc") {
        if (v.level) conditions.push(condition("VideoLevel", v.level));
        conditions.push(condition("VideoProfile", v.bitDepth > 8 ? "main|main 10" : "main", "EqualsAny", false));
      }
      if (v.codec === "vp9") conditions.push(condition("VideoProfile", v.bitDepth > 8 ? "Profile0|Profile 0|Profile2|Profile 2" : "Profile0|Profile 0", "EqualsAny", false));
      return { Type: "Video", Codec: v.codec, Conditions: conditions };
    });
    fallback.CodecProfiles.push({ Type: "VideoAudio", Codec: audio.join(","), Conditions: [condition("AudioChannels", channels)] });
    var remux = videos.filter(function (v) { return v.codec === "h264" || v.codec === "hevc"; }).map(function (v) { return v.codec; });
    if (remux.length) fallback.TranscodingProfiles.unshift({ Container: "mp4", Type: "Video", VideoCodec: remux.join(","),
      AudioCodec: audio.filter(function (a) { return ["aac", "ac3", "eac3"].indexOf(a) >= 0; }).join(",") || "aac",
      Protocol: "hls", Context: "Streaming", MaxAudioChannels: String(channels), MinSegments: 1, BreakOnNonKeyFrames: true });
    fallback.SubtitleProfiles = embedded.map(function (codec) { return { Format: codec, Method: "Embed" }; }).concat(fallback.SubtitleProfiles);
    return fallback;
  }
  function tracks(selected, metadata, audioIndex, subtitleIndex, cues, nativeMode) {
    var result = { audio: -1, subtitle: -1 };
    if (!nativeMode || selected.method !== "DirectPlay") return result;
    if (!metadata || selected.source.Id !== metadata.Id) return { unavailable: true };
    function ordinal(type, index) {
      return (metadata.MediaStreams || []).filter(function (s) { return s.Type === type && !s.IsExternal; })
        .findIndex(function (s) { return s.Index === index; });
    }
    result.audio = ordinal("Audio", audioIndex == null ? metadata.DefaultAudioStreamIndex : audioIndex);
    if (!cues && subtitleIndex >= 0) result.subtitle = ordinal("Subtitle", subtitleIndex);
    if ((audioIndex >= 0 && result.audio < 0) || (!cues && subtitleIndex >= 0 && result.subtitle < 0)) return { unavailable: true };
    return result;
  }
  var api = { policy: policy, profile: profile, tracks: tracks };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EmberFirePlayback = api;
})(typeof window !== "undefined" ? window : globalThis);
