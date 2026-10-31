(function (root) {
  "use strict";
  function serverUrl(value) {
    var address = value.trim();
    if (!address) throw new Error("Enter your Jellyfin server address.");
    var hasScheme = /^https?:\/\//i.test(address);
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
        "Enter a server address such as 192.168.1.20:8096 or https://media.example.com.",
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
    if (!hasScheme && !url.port) url.port = "8096";
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
      Name: "Wholphin webOS (H.264 / AAC)",
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
    base.Name = "LG C1 native (experimental)";
    base.MaxStreamingBitrate = 60000000;
    base.DirectPlayProfiles = [
      {
        Container: "mp4,m4v",
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
            stream.Language || "Unknown language",
            stream.Codec && stream.Codec.toUpperCase(),
            stream.Channels ? stream.Channels + " ch" : null,
            stream.IsForced ? "Forced" : null,
          ]
            .filter(Boolean)
            .join(" · ");
        return { index: stream.Index, label: label };
      });
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
  function libraryQuery(id, options, offset, type) {
    var sorts = {
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
  // Activate for the entire holiday month, using the TV's local calendar.
  function holidayRows(now) {
    now = now || new Date();
    var month = now.getMonth() + 1;
    var holiday = {
      1: ["new-years", "New Year's", "new year's eve", "new year"],
      2: ["valentines", "Valentine's", "valentine's day", "valentine"],
      10: ["halloween", "Halloween", "halloween", "halloween"],
      11: ["thanksgiving", "Thanksgiving", "thanksgiving", "thanksgiving"],
      12: ["christmas", "Christmas", "christmas", "christmas"],
    }[month];
    if (!holiday) return [];
    var period = now.getFullYear() + "-" + month;
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
    return rows;
  }
  function combineResume(resume, next) {
    var seenIds = {},
      seenSeries = {},
      result = [];
    (resume || []).forEach(function (item) {
      if (seenIds[item.Id]) return;
      seenIds[item.Id] = true;
      if (item.SeriesId) seenSeries[item.SeriesId] = true;
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
      item.CommunityRating
        ? Number(item.CommunityRating).toFixed(1) + " ★"
        : null,
      end && !isNaN(end)
        ? "Ends at " +
          end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : null,
    ];
    return parts.filter(Boolean).join("  ·  ");
  }
  var api = {
    serverUrl: serverUrl,
    query: query,
    profile: profile,
    nativePolicy: nativePolicy,
    playbackInfo: playbackInfo,
    stream: stream,
    neighbor: neighbor,
    tracks: tracks,
    trackPreference: trackPreference,
    preferredTrack: preferredTrack,
    chapters: chapters,
    libraryQuery: libraryQuery,
    libraryWindow: libraryWindow,
    followingEpisodes: followingEpisodes,
    homeRows: homeRows,
    holidayRows: holidayRows,
    logoItem: logoItem,
    quickDetails: quickDetails,
    combineResume: combineResume,
  };
  if (typeof module !== "undefined") module.exports = api;
  root.WholphinCore = api;
})(typeof window !== "undefined" ? window : globalThis);
