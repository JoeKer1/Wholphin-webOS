(function (root) {
  "use strict";
  // Jellyfin ticks are absolute media times, independent of transcode start offsets.
  function mediaSegments(data, duration) {
    return (data && Array.isArray(data.Items) ? data.Items : []).filter(function (s) {
      return s && (s.Type === "Intro" || s.Type === "Outro") &&
        Number.isFinite(s.StartTicks) && Number.isFinite(s.EndTicks) &&
        s.StartTicks >= 0 && s.EndTicks > s.StartTicks &&
        (!duration || s.StartTicks / 10000000 < duration);
    }).map(function (s) {
      return {type: s.Type, start: s.StartTicks / 10000000,
        end: duration ? Math.min(duration, s.EndTicks / 10000000) : s.EndTicks / 10000000};
    }).sort(function (a, b) { return a.start - b.start; });
  }
  function serverUrl(value) {
    var address = value.trim();
    if (!address) throw new Error("Enter your Jellyfin server address.");
    if (
      !/^[a-z][a-z0-9+.-]*:/i.test(address) ||
      /^[^/:]+:\d+(?:\/|$)/.test(address)
    ) {
      address = "http://" + address;
    }
    var url;
    try {
      url = new URL(address);
    } catch (_) {
      throw new Error(
        "Enter a server address such as 192.168.50.243:8096 or https://media.example.com.",
      );
    }
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Enter an HTTP or HTTPS server URL without credentials or query parameters.",
      );
    var authority = address.split("/")[2] || "",
      explicitPort = /:\d+$/.test(authority);
    if (/^192\.168\./.test(url.hostname) && !explicitPort) url.port = "8096";
    return url.href.replace(/\/+$/, "");
  }
  function query(values) {
    return Object.keys(values)
      .filter(function (key) {
        return values[key] !== undefined && values[key] !== null;
      })
      .map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(values[key]);
      })
      .join("&");
  }
  function profile(options) {
    var base = {
      Name: "Ember (H.264 / AAC)",
      MaxStreamingBitrate: 20000000,
      DirectPlayProfiles: [
        {
          Container: "mp4,m4v",
          Type: "Video",
          VideoCodec: "h264",
          AudioCodec: "aac,mp3",
        },
      ],
      TranscodingProfiles: [
        {
          Container: "ts",
          Type: "Video",
          VideoCodec: "h264",
          AudioCodec: "aac",
          Protocol: "hls",
          Context: "Streaming",
          MaxAudioChannels: "2",
          MinSegments: 1,
          BreakOnNonKeyFrames: true,
        },
      ],
      CodecProfiles: [
        {
          Type: "Video",
          Codec: "h264",
          Conditions: [
            {
              Condition: "LessThanEqual",
              Property: "VideoLevel",
              Value: "41",
              IsRequired: true,
            },
            {
              Condition: "LessThanEqual",
              Property: "Width",
              Value: "1920",
              IsRequired: true,
            },
            {
              Condition: "LessThanEqual",
              Property: "Height",
              Value: "1080",
              IsRequired: true,
            },
            {
              Condition: "Equals",
              Property: "IsAnamorphic",
              Value: "false",
              IsRequired: false,
            },
          ],
        },
      ],
      SubtitleProfiles: [
        { Format: "srt", Method: "Encode" },
        { Format: "subrip", Method: "Encode" },
        { Format: "vtt", Method: "Encode" },
        { Format: "webvtt", Method: "Encode" },
        { Format: "ssa", Method: "Encode" },
        { Format: "dvdsub", Method: "Encode" },
        { Format: "dvbsub", Method: "Encode" },
        { Format: "mov_text", Method: "Encode" },
        { Format: "ass", Method: "Encode" },
        { Format: "pgssub", Method: "Encode" },
      ],
    };
    return options && options.native ? nativeProfile(base, options) : base;
  }
  function nativeProfile(base, options) {
    function condition(property, value, operator, required) {
      return {
        Property: property,
        Value: String(value),
        Condition: operator || "LessThanEqual",
        IsRequired: required !== false,
      };
    }
    base.Name = "LG C1 native";
    base.MaxStreamingBitrate = 60000000;
    base.DirectPlayProfiles = [
      {
        Container: "mp4,m4v,mkv",
        Type: "Video",
        VideoCodec: "h264,hevc",
        AudioCodec: "aac,mp3,ac3,eac3",
      },
    ];
    var fallback = base.TranscodingProfiles[0];
    base.TranscodingProfiles = [
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "h264,hevc",
        AudioCodec: "aac,ac3,eac3",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "6",
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
        ApplyConditions: [
          condition("VideoRangeType", "SDR|HDR10", "EqualsAny", false),
        ],
      },
      fallback,
    ];
    var ranges =
      "SDR|HDR10" + (options.dolbyVision ? "|DOVI|DOVIWithHDR10" : "");
    base.CodecProfiles = [
      {
        Type: "Video",
        Codec: "h264",
        Conditions: [
          condition("Width", 3840),
          condition("Height", 2160),
          condition("VideoLevel", 51),
          condition("VideoBitDepth", 8),
          condition("VideoFramerate", 60),
          condition("VideoBitrate", 50000000),
          condition(
            "VideoProfile",
            "baseline|constrained baseline|main|high",
            "EqualsAny",
            false,
          ),
          condition("VideoRangeType", "SDR", "EqualsAny", false),
        ],
      },
      {
        Type: "Video",
        Codec: "h264",
        ApplyConditions: [condition("Width", 1921, "GreaterThanEqual")],
        Conditions: [condition("VideoFramerate", 30)],
      },
      {
        Type: "Video",
        Codec: "hevc",
        Conditions: [
          condition("Width", 3840),
          condition("Height", 2160),
          condition("VideoLevel", 153),
          condition("VideoBitDepth", 10),
          condition("VideoFramerate", 60),
          condition("VideoBitrate", 60000000),
          condition("VideoProfile", "main|main 10", "EqualsAny", false),
          condition("VideoRangeType", ranges, "EqualsAny", false),
        ],
      },
      {
        Type: "Video",
        Codec: "hevc",
        Container: "-mp4,m4v",
        Conditions: [
          condition("VideoRangeType", "SDR|HDR10", "EqualsAny", false),
        ],
      },
      {
        Type: "Video",
        Codec: "hevc",
        ApplyConditions: [
          condition("VideoRangeType", "DOVI|DOVIWithHDR10", "EqualsAny"),
        ],
        Conditions: [condition("VideoCodecTag", "dvh1|dvhe", "EqualsAny")],
      },
      {
        Type: "VideoAudio",
        Codec: "aac,mp3",
        Conditions: [condition("AudioChannels", 2)],
      },
      {
        Type: "VideoAudio",
        Codec: "ac3,eac3",
        Conditions: [condition("AudioChannels", 6)],
      },
    ];
    return base;
  }
  function nativePolicy(source, options, subtitleIndex) {
    if (!options.native)
      return { native: false, reason: "Compatibility mode selected" };
    if (subtitleIndex != null && subtitleIndex >= 0)
      return {
        native: false,
        reason: "Selected subtitles require server burn-in",
      };
    var stream = ((source && source.MediaStreams) || []).find(function (entry) {
      return entry.Type === "Video";
    });
    if (stream && /^DOVI/.test(stream.VideoRangeType || "")) {
      if (!options.dolbyVision)
        return {
          native: false,
          reason: "Dolby Vision experimental playback is disabled",
        };
      if (
        ["mp4", "m4v"].indexOf((source.Container || "").toLowerCase()) < 0 ||
        ["DOVI", "DOVIWithHDR10"].indexOf(stream.VideoRangeType) < 0
      )
        return {
          native: false,
          reason:
            "This Dolby Vision container or variant requires Compatibility mode",
        };
    }
    return { native: true, reason: "LG C1 native mode requested" };
  }
  function playbackInfo(active, stats, decoded) {
    var source = active.source || {},
      streams = source.MediaStreams || [];
    var inputVideo =
      streams.find(function (s) {
        return s.Type === "Video";
      }) || {};
    var inputAudio =
      streams.find(function (s) {
        return s.Type === "Audio" && s.Index === active.audioIndex;
      }) ||
      streams.find(function (s) {
        return s.Type === "Audio";
      }) ||
      {};
    function codec(value) {
      return String(value || "Unknown")
        .replace(/[^a-z0-9 ._+-]/gi, "")
        .slice(0, 40)
        .toUpperCase();
    }
    function size(w, h) {
      return Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0
        ? w + " × " + h
        : "Not reported";
    }
    function bitrate(value) {
      return Number.isFinite(value) && value > 0
        ? (value / 1000000).toFixed(1) + " Mbps"
        : "Not reported";
    }
    var mode =
      active.method === "DirectPlay"
        ? "Direct play"
        : !stats
          ? "Server HLS (awaiting stream details)"
          : stats.IsVideoDirect === true
            ? stats.IsAudioDirect === true
              ? "Remux (video and audio copied)"
              : "Video copied; audio encoded"
            : stats.IsVideoDirect === false
              ? "Video transcoding"
              : "Server HLS (copy/encode not reported)";
    var knownRanges = {
      SDR: "SDR",
      HDR10: "HDR10",
      HDR10Plus: "HDR10+",
      HLG: "HLG",
      DOVI: "Dolby Vision",
      DOVIWithHDR10: "Dolby Vision + HDR10 base",
      DOVIWithEL: "Dolby Vision enhancement layer",
    };
    var rows = [
      ["Playback", mode],
      ["Profile", active.profileName || "Compatibility"],
      ["Client decision", active.policyReason || "Server negotiation"],
      ["Source container", codec(source.Container)],
      ["Source video", codec(inputVideo.Codec)],
      ["Source resolution", size(inputVideo.Width, inputVideo.Height)],
      [
        "Source dynamic range",
        knownRanges[inputVideo.VideoRangeType] || "Unknown",
      ],
      ["Source bitrate", bitrate(source.Bitrate)],
      [
        "Source audio",
        codec(inputAudio.Codec) +
          (inputAudio.Channels
            ? " · " + inputAudio.Channels + " channels"
            : ""),
      ],
    ];
    if (active.method === "DirectPlay") {
      rows.push(["Delivered stream", "Original video and audio"]);
    } else if (stats) {
      rows.push(
        [
          "Delivered video",
          codec(stats.VideoCodec) +
            (stats.IsVideoDirect === true
              ? " (copied)"
              : stats.IsVideoDirect === false
                ? " (encoded)"
                : " (copy/encode not reported)"),
        ],
        ["Delivered resolution", size(stats.Width, stats.Height)],
        [
          "Delivered audio",
          codec(stats.AudioCodec) +
            (stats.AudioChannels
              ? " · " + stats.AudioChannels + " channels"
              : ""),
        ],
        ["Delivered bitrate", bitrate(stats.Bitrate)],
      );
    } else rows.push(["Delivered stream", "Not reported by the server yet"]);
    var reasonNames = {
      ContainerNotSupported: "Container needs conversion",
      VideoCodecNotSupported: "Video codec is unsupported",
      AudioCodecNotSupported: "Audio codec is unsupported",
      AudioChannelsNotSupported: "Audio channel limit",
      VideoResolutionNotSupported: "Video resolution limit",
      VideoLevelNotSupported: "Video codec level limit",
      VideoProfileNotSupported: "Video profile is unsupported",
      VideoBitDepthNotSupported: "Video bit depth is unsupported",
      VideoRangeTypeNotSupported: "HDR format is unsupported",
      VideoBitrateNotSupported: "Video bitrate limit",
      ContainerBitrateExceedsLimit: "Container bitrate limit",
      VideoFramerateNotSupported: "Video frame-rate limit",
      SubtitleCodecNotSupported: "Subtitles require conversion or burn-in",
      SecondaryAudioNotSupported: "Selected audio requires another stream",
      AudioProfileNotSupported: "Audio profile is unsupported",
      VideoCodecTagNotSupported: "Video codec tag needs conversion",
      DirectPlayError: "Native playback failed",
    };
    var reasons = (stats && stats.TranscodeReasons) || source.TranscodeReasons;
    if (!reasons && source.TranscodingUrl) {
      try {
        reasons = new URL(
          source.TranscodingUrl,
          "https://jellyfin.invalid",
        ).searchParams.get("TranscodeReasons");
      } catch (_) {}
    }
    if (active.method !== "DirectPlay") {
      var labels = (
        Array.isArray(reasons)
          ? reasons
          : typeof reasons === "string"
            ? reasons.split(/,\s*/)
            : []
      )
        .map(function (reason) {
          return reasonNames[reason];
        })
        .filter(Boolean);
      rows.push([
        "Server reasons",
        labels.length ? labels.join("; ") : "Not reported",
      ]);
    }
    if (decoded) {
      rows.push(["Decoded size", size(decoded.width, decoded.height)]);
      if (Number.isFinite(decoded.dropped) && Number.isFinite(decoded.frames))
        rows.push(["Dropped frames", decoded.dropped + " / " + decoded.frames]);
    }
    return rows;
  }

  function stream(server, itemId, info, token, deviceId, forceTranscode) {
    var source = (info.MediaSources || []).filter(function (s) {
      return (!forceTranscode && s.SupportsDirectPlay) || s.TranscodingUrl;
    })[0];
    if (!source)
      throw new Error(
        "The server could not provide a playable stream. Check transcoding permissions.",
      );
    if (!forceTranscode && source.SupportsDirectPlay)
      return {
        source: source,
        method: "DirectPlay",
        offset: 0,
        url:
          server +
          "/Videos/" +
          encodeURIComponent(itemId) +
          "/stream?" +
          query({
            Static: true,
            MediaSourceId: source.Id,
            api_key: token,
            DeviceId: deviceId,
            LiveStreamId: source.LiveStreamId,
          }),
      };
    var url = new URL(source.TranscodingUrl, server + "/");
    // Resolve server-relative paths without allowing a response to leak credentials to another host.
    if (url.origin !== new URL(server).origin)
      throw new Error("The server returned a stream on a different origin.");
    return { source: source, method: "Transcode", offset: 0, url: url.href };
  }
  function tracks(source, type) {
    return (source.MediaStreams || [])
      .filter(function (stream) {
        return (
          stream.Type === type &&
          Number.isInteger(stream.Index) &&
          stream.Index >= 0
        );
      })
      .map(function (stream) {
        var label =
          stream.DisplayTitle ||
          [
            trackLanguageName(stream.Language),
            stream.Codec && stream.Codec.toUpperCase(),
            stream.Channels ? stream.Channels + " ch" : null,
            stream.IsForced ? "Forced" : null,
          ]
            .filter(Boolean)
            .join(" · ");
        return { index: stream.Index, label: label };
      });
  }
  function trackLanguageName(language) {
    var names = { en:"English", es:"Spanish", fr:"French", de:"German", it:"Italian", pt:"Portuguese", ja:"Japanese", ko:"Korean", zh:"Chinese", hi:"Hindi", ru:"Russian", ar:"Arabic", nl:"Dutch", sv:"Swedish", no:"Norwegian", da:"Danish", fi:"Finnish", pl:"Polish", cs:"Czech", el:"Greek", he:"Hebrew", tr:"Turkish", th:"Thai", vi:"Vietnamese", id:"Indonesian", ro:"Romanian", hu:"Hungarian", uk:"Ukrainian", fa:"Persian" };
    var normalized = trackLanguage(language);
    return names[normalized] || (normalized ? normalized.toUpperCase() : "Unknown language");
  }
  function subtitleTracks(source) {
    var formats = { subrip:"SRT", srt:"SRT", webvtt:"VTT", vtt:"VTT", pgssub:"PGS", pgs:"PGS", dvdsub:"VobSub", ass:"ASS", ssa:"SSA", mov_text:"Text", ttml:"TTML" };
    var result = tracks(source, "Subtitle").map(function (track) {
      var stream = source.MediaStreams.find(function (entry) { return entry.Type === "Subtitle" && entry.Index === track.index; }),
        language = trackLanguage(stream.Language), codec = String(stream.Codec || "").toLowerCase(),
        label = [trackLanguageName(stream.Language),
          formats[codec] || "Subtitle", stream.IsForced ? "Forced" : "", stream.IsHearingImpaired ? "Hearing impaired" : ""].filter(Boolean).join(" · ");
      return { index: track.index, label: label, external: !!stream.IsExternal };
    });
    result.forEach(function (track) {
      if (result.filter(function (entry) { return entry.label === track.label; }).length > 1) track.duplicate = true;
    });
    result.forEach(function (track) { if (track.duplicate) track.label += " · Track " + (track.index + 1); });
    return result;
  }
  function subtitleTimingKey(item, source, index) {
    if (!item || !source) return "";
    var stream = (source.MediaStreams || []).find(function (entry) { return entry.Type === "Subtitle" && entry.Index === index; });
    if (!stream) return "";
    var ordinal = (source.MediaStreams || []).filter(function (entry) { return entry.Type === "Subtitle" && !!entry.IsExternal === !!stream.IsExternal; }).indexOf(stream);
    return JSON.stringify([item.Id, source.Id, stream.Path || [!!stream.IsExternal, ordinal, stream.Title || "", !!stream.IsForced, !!stream.IsHearingImpaired], stream.Codec, stream.Language]);
  }
  function trackLanguage(language) {
    var value = String(language || "")
      .trim()
      .toLowerCase()
      .split(/[-_]/)[0];
    var aliases = {
      eng: "en",
      spa: "es",
      fra: "fr",
      fre: "fr",
      deu: "de",
      ger: "de",
      ita: "it",
      por: "pt",
      jpn: "ja",
      kor: "ko",
      zho: "zh",
      chi: "zh",
      rus: "ru",
      ara: "ar",
      hin: "hi",
      nld: "nl",
      dut: "nl",
      swe: "sv",
      nor: "no",
      dan: "da",
      fin: "fi",
      pol: "pl",
      ces: "cs",
      cze: "cs",
      ell: "el",
      gre: "el",
      heb: "he",
      tur: "tr",
      tha: "th",
      vie: "vi",
      ind: "id",
      ron: "ro",
      rum: "ro",
      hun: "hu",
      ukr: "uk",
      fas: "fa",
      per: "fa",
    };
    return ["", "und", "mul", "zxx", "mis"].indexOf(value) !== -1
      ? ""
      : aliases[value] || value;
  }
  function trackRole(stream) {
    var title = (stream.Title || "") + " " + (stream.DisplayTitle || "");
    return /commentary/i.test(title)
      ? "commentary"
      : stream.IsAudioDescription ||
          /audio description|descriptive audio|described audio|visually impaired/i.test(
            title,
          )
        ? "description"
        : "main";
  }
  function trackPreference(source, type, index) {
    if (type === "Subtitle" && index === -1) return { off: true };
    var stream = (source.MediaStreams || []).find(function (entry) {
      return entry.Type === type && entry.Index === index;
    });
    if (!stream || !trackLanguage(stream.Language)) return null;
    return {
      language: trackLanguage(stream.Language),
      forced: !!stream.IsForced,
      hearingImpaired: !!stream.IsHearingImpaired,
      role: trackRole(stream),
    };
  }
  function preferredTrack(source, type, preference) {
    if (!preference) return undefined;
    if (type === "Subtitle" && preference.off) return -1;
    var language = trackLanguage(preference.language);
    if (!language) return undefined;
    var candidates = (source.MediaStreams || []).filter(function (stream) {
      return (
        stream.Type === type &&
        Number.isInteger(stream.Index) &&
        stream.Index >= 0 &&
        trackLanguage(stream.Language) === language &&
        trackRole(stream) === (preference.role || "main") &&
        (type !== "Subtitle" || !!stream.IsForced === !!preference.forced)
      );
    });
    var defaultIndex =
      type === "Audio"
        ? source.DefaultAudioStreamIndex
        : source.DefaultSubtitleStreamIndex;
    function score(stream) {
      return (
        (!!stream.IsHearingImpaired === !!preference.hearingImpaired ? 2 : 0) +
        (stream.Index === defaultIndex ? 1 : 0)
      );
    }
    candidates.sort(function (a, b) {
      return score(b) - score(a);
    });
    // Missing audio falls back to server defaults; missing preferred subtitles stay off.
    return candidates.length
      ? candidates[0].Index
      : type === "Subtitle"
        ? -1
        : undefined;
  }
  function animeItem(item, libraries, ancestors) {
    var anime = (libraries || []).filter(function (l) { return /\banime\b/i.test(l.Name || ""); }),
      ids = anime.map(function (l) { return l.Id; });
    return (item.Genres || []).some(function (g) { return /^anime$/i.test(g); }) ||
      ids.indexOf(item.ParentId) >= 0 ||
      (ancestors || []).some(function (a) { return ids.indexOf(a.Id) >= 0 || (a.Type === "CollectionFolder" && /\banime\b/i.test(a.Name || "")); });
  }
  function trackScopes(item) {
    if (!item || item.Type !== "Episode" || !item.SeriesId) return [];
    var season = item.SeasonId || item.ParentId;
    return (season ? ["season:" + season] : []).concat("series:" + item.SeriesId);
  }
  function seerrPermissions(value, type) {
    var permissions = Number(value) || 0;
    return {
      standard: !!(permissions & (2 | 32 | (type === "movie" ? 262144 : 524288))),
      fourK: !!(permissions & (2 | 1024 | (type === "movie" ? 2048 : 4096))),
    };
  }
  // Merge individual choices rather than replacing another device's entire map.
  // A reset timestamp also clears older choices on devices that were offline.
  function mergeSeriesTracks(local, remote) {
    function resetTime(data) { return data && Number.isFinite(data.reset) && data.reset > 0 ? data.reset : 0; }
    var reset = Math.max(resetTime(local), resetTime(remote)), entries = {};
    [remote, local].forEach(function (data) {
      Object.keys(data && data.entries || {}).slice(0, 400).forEach(function (key) {
        if (!/^(series|season):[a-zA-Z0-9-]{1,128}$/.test(key)) return;
        ["Audio", "Subtitle"].forEach(function (type) {
          var entry = data.entries[key] && data.entries[key][type], value = entry && entry.value;
          if (!entry || !Number.isFinite(entry.updated) || entry.updated <= reset || !value) return;
          var language = trackLanguage(value.language), clean;
          if (type === "Subtitle" && value.off === true) clean = {off: true};
          else if (/^[a-z]{2,3}$/.test(language) && ["main", "commentary", "description"].indexOf(value.role || "main") >= 0)
            clean = {language: language, forced: !!value.forced, hearingImpaired: !!value.hearingImpaired, role: value.role || "main"};
          if (!clean) return;
          if (!entries[key]) entries[key] = {};
          if (!entries[key][type] || entries[key][type].updated <= entry.updated)
            entries[key][type] = {value: clean, updated: entry.updated};
        });
      });
    });
    var keys = Object.keys(entries).sort(function (a, b) {
      function latest(key) { return Math.max(entries[key].Audio && entries[key].Audio.updated || 0, entries[key].Subtitle && entries[key].Subtitle.updated || 0); }
      return latest(b) - latest(a);
    });
    keys.slice(200).forEach(function (key) { delete entries[key]; });
    return {reset: reset, entries: entries};
  }
  function seriesTrack(item, type, data) {
    var scopes = trackScopes(item), entries = data && data.entries || {};
    for (var i = 0; i < scopes.length; i++) {
      var entry = entries[scopes[i]] && entries[scopes[i]][type];
      if (entry && entry.updated > (data.reset || 0)) return entry.value;
    }
    return null;
  }
  function imageTag(item, kind, owner) {
    if (owner === item.Id) return kind === "Backdrop" ? (item.BackdropImageTags || [])[0] : (item.ImageTags || {})[kind];
    if (kind === "Primary" && owner === item.SeriesId) return item.SeriesPrimaryImageTag;
    if (kind === "Logo" && owner === item.ParentLogoItemId) return item.ParentLogoImageTag;
    if (kind === "Backdrop" && owner === item.ParentBackdropItemId) return (item.ParentBackdropImageTags || [])[0];
  }
  function imageTagQuery(item, kind, owner) {
    var tag = imageTag(item, kind, owner);
    return tag ? "&tag=" + encodeURIComponent(tag) : "";
  }
  function animeAudio(source, language, remembered) {
    var normal = preferredTrack(source, "Audio", remembered),
      match = language && preferredTrack(source, "Audio", {language: language});
    return Number.isInteger(match) && match >= 0 ? match : normal;
  }
  function defaultSubtitle(source, audioIndex, options, remembered) {
    options = options || {};
    var streams = source.MediaStreams || [],
      audio = streams.find(function (s) { return s.Type === "Audio" && s.Index === (audioIndex == null ? source.DefaultAudioStreamIndex : audioIndex); }),
      language = audio && trackLanguage(audio.Language);
    function match(code) {
      var plain = Object.assign({}, source, {MediaStreams: streams.filter(function (s) { return s.Type !== "Subtitle" || textSubtitle(source, s.Index); })}),
        index = preferredTrack(plain, "Subtitle", {language: code, forced: false});
      return index >= 0 ? index : preferredTrack(source, "Subtitle", {language: code, forced: false});
    }
    if (options.foreignEnglish !== false && language && language !== trackLanguage("eng")) {
      var english = match("eng");
      if (english >= 0) return english;
    }
    if (options.mode === "off") return -1;
    if (options.mode === "language") return match(options.language || "eng");
    return preferredTrack(source, "Subtitle", remembered);
  }
  function libraryQuery(id, options, offset, type) {
    var sorts = {
      "episode-asc": ["IndexNumber,SortName", "Ascending"],
      "episode-desc": ["IndexNumber,SortName", "Descending"],
      "title-asc": ["SortName", "Ascending"],
      "title-desc": ["SortName", "Descending"],
      "release-desc": ["PremiereDate,SortName", "Descending"],
      "release-asc": ["PremiereDate,SortName", "Ascending"],
      "added-desc": ["DateCreated,SortName", "Descending"],
      "added-asc": ["DateCreated,SortName", "Ascending"],
    };
    var sort = sorts[options.sort] || sorts["title-asc"];
    return {
      ParentId: id,
      StartIndex: offset,
      Limit: 48,
      SortBy: sort[0],
      SortOrder: sort[1],
      Recursive: !!type,
      IncludeItemTypes: type || undefined,
      EnableTotalRecordCount: true,
      IsPlayed:
        options.watched === "watched"
          ? true
          : options.watched === "unwatched"
            ? false
            : undefined,
      Genres: options.genre || undefined,
      Years: options.year || undefined,
    };
  }
  function libraryWindow(count, columns, rowHeight, scroll, height) {
    var rows = Math.ceil(count / columns),
      startRow = Math.max(0, Math.floor(scroll / rowHeight) - 3),
      endRow = Math.min(rows, Math.ceil((scroll + height) / rowHeight) + 3);
    startRow = Math.min(startRow, Math.max(0, rows - 1));
    return {
      start: startRow * columns,
      end: Math.min(count, endRow * columns),
      top: startRow * rowHeight,
      bottom: Math.max(0, rows - endRow) * rowHeight,
    };
  }
  function chapters(item) {
    return (item.Chapters || [])
      .filter(function (chapter) {
        return (
          Number.isFinite(chapter.StartPositionTicks) &&
          chapter.StartPositionTicks >= 0 &&
          (!item.RunTimeTicks || chapter.StartPositionTicks < item.RunTimeTicks)
        );
      })
      .sort(function (a, b) {
        return a.StartPositionTicks - b.StartPositionTicks;
      });
  }
  function followingEpisodes(item, episodes) {
    // StartItemId is inclusive. Refuse to autoplay an unrelated or ambiguous result.
    var start = episodes.findIndex(function (episode) {
      return episode.Id === item.Id;
    });
    if (start < 0) return [];
    var seen = new Set([item.Id]);
    return episodes.slice(start + 1).filter(function (episode) {
      if (
        episode.Type !== "Episode" ||
        episode.SeriesId !== item.SeriesId ||
        episode.IsMissing ||
        episode.IsVirtualItem ||
        seen.has(episode.Id)
      )
        return false;
      seen.add(episode.Id);
      return true;
    });
  }
  function neighbor(current, candidates, direction) {
    var cx = current.left + current.width / 2,
      cy = current.top + current.height / 2;
    var best = null,
      score = Infinity;
    candidates.forEach(function (candidate) {
      var r = candidate.rect,
        dx = r.left + r.width / 2 - cx,
        dy = r.top + r.height / 2 - cy;
      var primary =
        direction === "left"
          ? -dx
          : direction === "right"
            ? dx
            : direction === "up"
              ? -dy
              : dy;
      var cross =
        direction === "left" || direction === "right"
          ? Math.abs(dy)
          : Math.abs(dx);
      if (primary > 1 && primary + cross * 3 < score) {
        best = candidate.element;
        score = primary + cross * 3;
      }
    });
    return best;
  }
  // Native equivalents of KefinTweaks' seasonal query presets:
  // https://github.com/ranaldsgift/KefinTweaks/blob/main/scripts/homeScreenConfig2.js
  // Local-calendar seasons retain rows for eleven days after the holiday.
  function holidaySeason(now) {
    var year = now.getFullYear(),
      month = now.getMonth() + 1,
      day = now.getDate(),
      thanksgiving = 22 + ((4 - new Date(year, 10, 22).getDay() + 7) % 7),
      key;
    if (month === 10 || (month === 11 && day <= 11)) key = 10;
    else if (month === 11) key = day <= thanksgiving ? 11 : 12;
    else if (month === 12) key = 12;
    else if (month === 1 && day <= 5) {
      key = 12;
      year--;
    } else if (month === 1 && day <= 12) key = 1;
    else if (month === 2 && day <= 25) key = 2;
    var holiday = {
      2: ["valentines", "Valentine's", "valentine's day", "valentine"],
      10: ["halloween", "Halloween", "halloween", "halloween"],
      11: ["thanksgiving", "Thanksgiving", "thanksgiving", "thanksgiving"],
      12: ["christmas", "Christmas", "christmas", "christmas"],
    }[key];
    return holiday ? { holiday: holiday, month: key, year: year } : null;
  }
  function holidayRows(now) {
    var season = holidaySeason(now || new Date());
    if (!season) return [];
    var holiday = season.holiday,
      month = season.month,
      period = season.year + "-" + month;
    function row(suffix, title, type, filter) {
      return {
        key: "holiday:" + period + ":" + holiday[0] + ":" + suffix,
        kind: "holiday",
        title: title,
        type: type,
        filter: filter,
        layout: type === "Episode" ? "landscape" : "poster",
      };
    }
    var rows = [
      row("movies", holiday[1] + " Movies", "Movie", { Tags: holiday[2] }),
    ];
    if (month === 10) {
      rows.push(row("horror", "Horror Movies", "Movie", { Genres: "Horror" }));
      rows.push(
        row("thriller", "Thriller Movies", "Movie", { Genres: "Thriller" }),
      );
    }
    rows.push(
      row("episodes", holiday[1] + " Episodes", "Episode", {
        SearchTerm: holiday[3],
      }),
    );
    return rows;
  }
  function homeRowKey(row) {
    return row.key.replace(/^holiday:[^:]+:/, "holiday:");
  }
  function homeRows(libraries, options, now) {
    options = options || {};
    var rows = options.combine
      ? [
          {
            key: "continue",
            kind: "combined",
            title: "Continue watching",
          },
        ]
      : [
          { key: "continue", kind: "resume", title: "Continue watching" },
          { key: "next", kind: "next", title: "Next up" },
        ];
    if (options.holidays !== false) rows = rows.concat(holidayRows(now));
    (libraries || []).forEach(function (library) {
      if ((options.hiddenLibraries || []).indexOf(library.Id) !== -1) return;
      if (
        library.CollectionType === "livetv" &&
        options.live !== false &&
        !rows.some(function (row) {
          return row.kind === "live";
        })
      ) {
        rows.push({
          key: "live",
          kind: "live",
          title: "Watch live",
          layout: "landscape",
        });
      }
      if (
        ["livetv", "music", "photos", "books", "boxsets", "playlists"].indexOf(
          library.CollectionType,
        ) !== -1
      )
        return;
      rows.push({
        key: "latest:" + library.Id,
        kind: "latest",
        parent: library.Id,
        title: "Recently added in " + library.Name,
      });
      if (options.released)
        rows.push({
          key: "released:" + library.Id,
          kind: "released",
          parent: library.Id,
          title: "Recently released in " + library.Name,
        });
    });
    if (options.favorites !== false) {
      rows.push({
        key: "favorite-movies",
        kind: "favorites",
        type: "Movie",
        title: "Favorite movies",
      });
      rows.push({
        key: "favorite-series",
        kind: "favorites",
        type: "Series",
        title: "Favorite shows",
      });
    }
    if (options.collections !== false)
      rows.push({
        key: "collections",
        kind: "items",
        type: "BoxSet",
        title: "Collections",
      });
    if (options.playlists !== false)
      rows.push({
        key: "playlists",
        kind: "items",
        type: "Playlist",
        title: "Playlists",
      });
    (options.pinnedRows || []).forEach(function (pin) {
      if (
        !pin ||
        ["collection", "playlist", "genre", "studio"].indexOf(pin.kind) < 0 ||
        typeof pin.id !== "string" ||
        !pin.id ||
        typeof pin.name !== "string"
      )
        return;
      var row = {
        key: "pinned:" + pin.kind + ":" + pin.id,
        kind: "pinned",
        pinType: pin.kind,
        pinId: pin.id,
        title: pin.name,
        type:
          pin.kind === "genre" || pin.kind === "studio"
            ? "Movie,Series"
            : "Movie,Series,Episode,Video",
      };
      if (pin.kind === "collection") row.parent = pin.id;
      if (pin.kind === "genre") row.filter = { GenreIds: pin.id };
      if (pin.kind === "studio") row.filter = { StudioIds: pin.id };
      if (
        !rows.some(function (existing) {
          return existing.key === row.key;
        })
      )
        rows.push(row);
    });
    var order = options.rowOrder || [],
      layouts = options.rowLayouts || {},
      hidden = options.hiddenRows || [];
    return rows
      .filter(function (row) {
        return hidden.indexOf(homeRowKey(row)) < 0;
      })
      .map(function (row, index) {
        var layout = layouts[homeRowKey(row)];
        if (
          (layout === "poster" || layout === "landscape") &&
          row.kind !== "live"
        )
          row.layout = layout;
        return {
          row: row,
          index: index,
          order: order.indexOf(homeRowKey(row)),
        };
      })
      .sort(function (a, b) {
        var first = a.order < 0 ? order.length + a.index : a.order,
          second = b.order < 0 ? order.length + b.index : b.order;
        return first - second;
      })
      .map(function (entry) {
        return entry.row;
      });
  }
  function combineResume(resume, next) {
    var seenIds = {},
      seenSeries = {},
      result = [],
      seriesPositions = {};
    (resume || []).forEach(function (item) {
      if (seenIds[item.Id]) return;
      seenIds[item.Id] = true;
      if (item.SeriesId && seenSeries[item.SeriesId]) {
        var position = seriesPositions[item.SeriesId],
          previous = result[position],
          played = Date.parse(item.UserData && item.UserData.LastPlayedDate),
          prior = Date.parse(
            previous.UserData && previous.UserData.LastPlayedDate,
          );
        if (
          Number.isFinite(played) &&
          (!Number.isFinite(prior) || played > prior)
        )
          result[position] = item;
        return;
      }
      if (item.SeriesId) {
        seenSeries[item.SeriesId] = true;
        seriesPositions[item.SeriesId] = result.length;
      }
      result.push(item);
    });
    (next || []).forEach(function (item) {
      if (seenIds[item.Id] || (item.SeriesId && seenSeries[item.SeriesId]))
        return;
      seenIds[item.Id] = true;
      if (item.SeriesId) seenSeries[item.SeriesId] = true;
      result.push(item);
    });
    return result;
  }
  function logoItem(item) {
    if (item.ImageTags && item.ImageTags.Logo) return item.Id;
    if (item.ParentLogoItemId) return item.ParentLogoItemId;
    return item.SeriesId || null;
  }
  function quickDetails(item, now) {
    now = now || new Date();
    var duration = item.RunTimeTicks / 10000000;
    if (!duration && item.StartDate && item.EndDate)
      duration = (new Date(item.EndDate) - new Date(item.StartDate)) / 1000;
    var saved =
      (item.UserData && item.UserData.PlaybackPositionTicks / 10000000) || 0;
    var episode = item.Type === "Episode" || !!item.SeriesName;
    var date = item.PremiereDate && new Date(item.PremiereDate);
    var end =
      item.IsLiveProgram && item.EndDate
        ? new Date(item.EndDate)
        : duration
          ? new Date(now.getTime() + Math.max(0, duration - saved) * 1000)
          : null;
    var parts = [
      item.IsLiveProgram
        ? item.ChannelName
        : episode
          ? "S" + (item.ParentIndexNumber || 0) + " E" + (item.IndexNumber || 0)
          : null,
      episode && date && !isNaN(date)
        ? date.toLocaleDateString([], {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : item.ProductionYear,
      duration
        ? duration >= 3600
          ? Math.floor(duration / 3600) +
            "h " +
            (Math.floor(duration / 60) % 60) +
            "m"
          : Math.floor(duration / 60) + "m"
        : null,
      saved && duration && !item.IsLiveProgram
        ? Math.ceil(Math.max(0, duration - saved) / 60) + "m left"
        : null,
      item.OfficialRating,
      typeof item.CommunityRating === "number" &&
      Number.isFinite(item.CommunityRating) &&
      item.CommunityRating >= 0 &&
      item.CommunityRating <= 10
        ? item.CommunityRating.toFixed(1) + " ★"
        : null,
      typeof item.CriticRating === "number" &&
      Number.isFinite(item.CriticRating) &&
      item.CriticRating >= 0 &&
      item.CriticRating <= 100
        ? Math.round(item.CriticRating) + "% 🍅"
        : null,
      end && !isNaN(end)
        ? "Ends at " +
          end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : null,
    ];
    return parts.filter(Boolean).join("  ·  ");
  }
  function liveProgrammes(items, channelId, at) {
    var seen = new Set();
    var valid = (items || [])
      .filter(function (item) {
        var start = Date.parse(item.StartDate),
          end = Date.parse(item.EndDate);
        if (
          !item.Id ||
          item.ChannelId !== channelId ||
          seen.has(item.Id) ||
          !Number.isFinite(start) ||
          !(end > start) ||
          end <= at
        )
          return false;
        seen.add(item.Id);
        return true;
      })
      .sort(function (a, b) {
        return Date.parse(a.StartDate) - Date.parse(b.StartDate);
      });
    return {
      current:
        valid.find(function (item) {
          return (
            Date.parse(item.StartDate) <= at && Date.parse(item.EndDate) > at
          );
        }) || null,
      next:
        valid.find(function (item) {
          return Date.parse(item.StartDate) > at;
        }) || null,
    };
  }
  function liveProgress(programme, now) {
    var start = programme && Date.parse(programme.StartDate),
      end = programme && Date.parse(programme.EndDate);
    return Number.isFinite(start) && end > start
      ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100))
      : 0;
  }
  function subtitleStyle(value) {
    value = value || {};
    function choice(key, values, fallback) {
      return values.indexOf(value[key]) >= 0 ? value[key] : fallback;
    }
    var delay = Number(value.delay);
    return {
      enabled: value.enabled === true,
      size: choice("size", [32, 40, 48, 56, 64], 48),
      color: choice("color", ["white", "yellow", "cyan"], "white"),
      background: choice("background", ["none", "half", "solid"], "none"),
      position: choice("position", ["bottom", "raised", "top"], "bottom"),
      delay: Number.isFinite(delay)
        ? Math.max(-10, Math.min(10, Math.round(delay * 2) / 2))
        : 0,
    };
  }
  function textSubtitle(source, index) {
    return ((source && source.MediaStreams) || []).find(function (track) {
      return (
        track.Type === "Subtitle" &&
        track.Index === index &&
        ["srt", "subrip", "vtt", "webvtt", "ass", "ssa"].indexOf(
          String(track.Codec || "").toLowerCase(),
        ) >= 0 &&
        track.IsTextSubtitleStream !== false
      );
    });
  }
  function parseSubtitles(value) {
    if (typeof value !== "string" || value.length > 2097152)
      throw new Error("Subtitle file is too large.");
    value = value.replace(/^\uFEFF/, "").replace(/\r/g, "");
    function timestamp(text) {
      var parts = text.replace(",", ".").split(":").map(Number);
      if (
        parts.length < 2 ||
        parts.length > 3 ||
        parts.some(function (n) {
          return !Number.isFinite(n) || n < 0;
        }) ||
        parts[parts.length - 1] >= 60 ||
        parts[parts.length - 2] >= 60
      )
        return NaN;
      return parts.reduce(function (total, part) {
        return total * 60 + part;
      }, 0);
    }
    function plain(text) {
      return text
        .replace(/<[^>]*>/g, "")
        .replace(
          /&(#x[0-9a-f]+|#\d+|amp|lt|gt|nbsp|quot|apos);/gi,
          function (match, entity) {
            var names = {
              amp: "&",
              lt: "<",
              gt: ">",
              nbsp: " ",
              quot: '"',
              apos: "'",
            };
            if (entity.charAt(0) !== "#") return names[entity.toLowerCase()];
            var n =
              entity.charAt(1).toLowerCase() === "x"
                ? parseInt(entity.slice(2), 16)
                : Number(entity.slice(1));
            return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
              ? String.fromCodePoint(n)
              : "";
          },
        )
        .slice(0, 2000);
    }
    var cues = [];
    value.split(/\n[ \t]*\n/).forEach(function (block) {
      var lines = block.split("\n");
      if (/^(NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) return;
      var index = lines.findIndex(function (line) {
        return line.indexOf("-->") >= 0;
      });
      if (index < 0) return;
      var match = lines[index].match(
        /^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)(?:\s.*)?$/,
      );
      if (!match) return;
      var start = timestamp(match[1]),
        end = timestamp(match[2]);
      var text = plain(lines.slice(index + 1).join("\n"));
      if (Number.isFinite(start) && end > start && text)
        cues.push({ start: start, end: end, text: text });
    });
    if (cues.length > 20000)
      throw new Error("Subtitle file has too many cues.");
    cues.sort(function (a, b) {
      return a.start - b.start;
    });
    var maxEnd = 0;
    cues.forEach(function (cue) {
      cue.maxEnd = maxEnd = Math.max(maxEnd, cue.end);
    });
    return cues;
  }
  function subtitleText(cues, seconds, delay) {
    var time = seconds - (delay || 0),
      low = 0,
      high = cues.length;
    while (low < high) {
      var mid = (low + high) >>> 1;
      if (cues[mid].start <= time) low = mid + 1;
      else high = mid;
    }
    var active = [];
    for (
      var i = low - 1;
      i >= 0 && cues[i].maxEnd > time && active.length < 6;
      i--
    ) {
      if (cues[i].end > time) active.unshift(cues[i].text);
    }
    return active.join("\n").slice(0, 2000);
  }
  function profileHolidayTheme(now) {
    var date = now || new Date(),
      year = date.getFullYear(),
      month = date.getMonth(),
      day = date.getDate();
    var season = holidaySeason(date);
    if (season && (season.month === 12 || season.month === 1))
      return "snowfall";
    if (
      season &&
      (season.month === 11 ||
        (season.month === 10 && (month === 10 || day >= 17)))
    )
      return "harvest";
    // Gregorian Easter, using the anonymous computus.
    var a = year % 19,
      b = Math.floor(year / 100),
      c = year % 100,
      d = Math.floor(b / 4),
      e = b % 4,
      f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4),
      k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451),
      n = h + l - 7 * m + 114,
      easter = new Date(year, Math.floor(n / 31) - 1, (n % 31) + 1),
      today = new Date(year, month, day),
      delta = Math.round((today - easter) / 86400000);
    return delta >= -14 && delta <= 11 ? "bloom" : "";
  }
  var api = {
    profileHolidayTheme: profileHolidayTheme,
    liveProgrammes: liveProgrammes,
    liveProgress: liveProgress,
    subtitleStyle: subtitleStyle,
    textSubtitle: textSubtitle,
    parseSubtitles: parseSubtitles,
    subtitleText: subtitleText,
    mediaSegments: mediaSegments,
    serverUrl: serverUrl,
    query: query,
    profile: profile,
    nativePolicy: nativePolicy,
    playbackInfo: playbackInfo,
    stream: stream,
    neighbor: neighbor,
    tracks: tracks,
    subtitleTracks: subtitleTracks,
    subtitleTimingKey: subtitleTimingKey,
    trackPreference: trackPreference,
    preferredTrack: preferredTrack,
    trackScopes: trackScopes,
    seerrPermissions: seerrPermissions,
    mergeSeriesTracks: mergeSeriesTracks,
    seriesTrack: seriesTrack,
    imageTagQuery: imageTagQuery,
    defaultSubtitle: defaultSubtitle,
    animeItem: animeItem,
    animeAudio: animeAudio,
    chapters: chapters,
    libraryQuery: libraryQuery,
    libraryWindow: libraryWindow,
    followingEpisodes: followingEpisodes,
    homeRows: homeRows,
    homeRowKey: homeRowKey,
    holidayRows: holidayRows,
    logoItem: logoItem,
    quickDetails: quickDetails,
    combineResume: combineResume,
  };
  if (typeof module !== "undefined") module.exports = api;
  root.WholphinCore = api;
})(typeof window !== "undefined" ? window : globalThis);
