const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/core.js");
test("normalizes server base paths and rejects unsafe URLs", () => {
  assert.equal(
    C.serverUrl(" https://media.example/jellyfin/ "),
    "https://media.example/jellyfin",
  );
  for (const url of [
    "file:///tmp/test",
    "javascript:alert(1)",
    "https://user:secret@example.com",
    "https://example.com/?api_key=secret",
  ])
    assert.throws(() => C.serverUrl(url));
});
test("query parameters encode server ids and tokens", () => {
  assert.equal(
    C.query({ a: "one & two", b: 0, c: false, d: undefined }),
    "a=one%20%26%20two&b=0&c=false",
  );
});
test("direct playback preserves reverse proxy prefix and encodes credentials", () => {
  const result = C.stream(
    "https://tv.example/jellyfin",
    "item/id",
    { MediaSources: [{ Id: "source", SupportsDirectPlay: true }] },
    "a&b",
    "device",
  );
  assert.equal(result.method, "DirectPlay");
  const url = new URL(result.url);
  assert.equal(url.pathname, "/jellyfin/Videos/item%2Fid/stream");
  assert.equal(url.searchParams.get("api_key"), "a&b");
});
test("transcode selection uses server URL and rejects cross-origin redirects", () => {
  const info = {
    MediaSources: [
      { Id: "unusable" },
      {
        Id: "ok",
        TranscodingUrl: "/jellyfin/Videos/id/master.m3u8?api_key=token",
      },
    ],
  };
  assert.equal(
    C.stream("https://tv.example/jellyfin", "id", info, "token", "device").url,
    "https://tv.example/jellyfin/Videos/id/master.m3u8?api_key=token",
  );
  assert.throws(() =>
    C.stream(
      "https://tv.example",
      "id",
      { MediaSources: [{ TranscodingUrl: "https://other.example/stream" }] },
      "token",
      "device",
    ),
  );
  assert.throws(() =>
    C.stream(
      "https://tv.example",
      "id",
      { MediaSources: [] },
      "token",
      "device",
    ),
  );
});
test("remote navigation prefers the same row and supports moving to the next row", () => {
  const r = (left, top) => ({ left, top, width: 100, height: 100 });
  const candidates = [
    { element: "right", rect: r(150, 0) },
    { element: "down", rect: r(0, 150) },
    { element: "diagonal", rect: r(150, 150) },
  ];
  assert.equal(C.neighbor(r(0, 0), candidates, "right"), "right");
  assert.equal(C.neighbor(r(0, 0), candidates, "down"), "down");
  assert.equal(C.neighbor(r(0, 0), candidates, "left"), null);
});
test("baseline requests server HLS transcoding rather than unsupported direct streams", () => {
  const p = C.profile();
  assert.equal(p.TranscodingProfiles[0].Protocol, "hls");
  assert.equal(p.TranscodingProfiles[0].VideoCodec, "h264");
  assert.equal(p.DirectPlayProfiles[0].Container, "mp4,m4v");
  assert.ok(p.SubtitleProfiles.every((s) => s.Method === "Encode"));
});

test("accepts server addresses without a scheme", () => {
  assert.equal(
    C.serverUrl("192.168.50.243:8096"),
    "http://192.168.50.243:8096",
  );
  assert.equal(
    C.serverUrl("media.example.com/jellyfin/"),
    "http://media.example.com/jellyfin",
  );
  assert.equal(C.serverUrl("localhost:8096"), "http://localhost:8096");
  assert.throws(() => C.serverUrl(""));
  assert.throws(() => C.serverUrl("not a server"));
});

test("uses Jellyfin port only for 192.168 hosts without an explicit port", () => {
  assert.equal(C.serverUrl("192.168.50.243"), "http://192.168.50.243:8096");
  assert.equal(C.serverUrl("http://192.168.50.243"), "http://192.168.50.243:8096");
  assert.equal(C.serverUrl("http://192.168.50.243:80"), "http://192.168.50.243");
  assert.equal(C.serverUrl("https://192.168.50.243:443"), "https://192.168.50.243");
  assert.equal(C.serverUrl("10.0.0.2"), "http://10.0.0.2");
  assert.equal(
    C.serverUrl("media.local/jellyfin"),
    "http://media.local/jellyfin",
  );
  assert.equal(
    C.serverUrl("http://media.example.com/jellyfin"),
    "http://media.example.com/jellyfin",
  );
  assert.equal(
    C.serverUrl("https://media.example.com"),
    "https://media.example.com",
  );
  assert.equal(
    C.serverUrl("192.168.50.243:9000"),
    "http://192.168.50.243:9000",
  );
});

test("home rows name each library and include favorites, collections, and playlists", () => {
  const libraries = [
    { Id: "movies", Name: "Movies", CollectionType: "movies" },
    { Id: "tv", Name: "TV", CollectionType: "tvshows" },
    { Id: "kids", Name: "Kids Shows", CollectionType: "tvshows" },
    { Id: "music", Name: "Music", CollectionType: "music" },
    { Id: "live", Name: "Live TV", CollectionType: "livetv" },
  ];
  const rows = C.homeRows(libraries, {});
  assert.deepEqual(
    rows.filter((r) => r.kind === "latest").map((r) => [r.title, r.parent]),
    [
      ["Recently added in Movies", "movies"],
      ["Recently added in TV", "tv"],
      ["Recently added in Kids Shows", "kids"],
    ],
  );
  assert.ok(rows.some((r) => r.key === "favorite-movies"));
  assert.ok(rows.some((r) => r.key === "favorite-series"));
  assert.ok(rows.some((r) => r.key === "collections"));
  assert.ok(rows.some((r) => r.key === "playlists"));
  const custom = C.homeRows(libraries, {
    combine: true,
    hiddenLibraries: ["kids"],
    released: true,
    favorites: false,
    collections: false,
    playlists: false,
  });
  assert.equal(custom[0].kind, "combined");
  assert.ok(custom.some((r) => r.title === "Recently released in TV"));
  assert.ok(
    !custom.some(
      (r) =>
        r.parent === "kids" || r.kind === "favorites" || r.kind === "items",
    ),
  );
});
test("combined Continue watching keeps resumed series before Next up without duplicates", () => {
  const resume = [{ Id: "movie" }, { Id: "episode1", SeriesId: "show" }];
  const next = [
    { Id: "episode2", SeriesId: "show" },
    { Id: "other-episode", SeriesId: "other" },
  ];
  assert.deepEqual(
    C.combineResume(resume, next).map((i) => i.Id),
    ["movie", "episode1", "other-episode"],
  );
});

test("screenshot-style episode metadata includes air date, remaining time and expected finish", () => {
  const now = new Date(2026, 9, 31, 12, 0);
  const episode = {
    Type: "Episode",
    SeriesName: "The Daily Show",
    ParentIndexNumber: 31,
    IndexNumber: 121,
    PremiereDate: "2026-10-28T12:00:00Z",
    RunTimeTicks: 19800000000,
    UserData: { PlaybackPositionTicks: 12600000000 },
  };
  const text = C.quickDetails(episode, now);
  assert.ok(text.includes("S31 E121"));
  assert.ok(text.includes("2026"));
  assert.ok(text.includes("33m"));
  assert.ok(text.includes("12m left"));
  assert.ok(
    text.includes(
      "Ends at " +
        new Date(2026, 9, 31, 12, 12).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
    ),
  );
  const live = C.quickDetails(
    {
      IsLiveProgram: true,
      ChannelName: "QVC",
      StartDate: new Date(2026, 9, 31, 10).toISOString(),
      EndDate: new Date(2026, 9, 31, 14).toISOString(),
    },
    now,
  );
  assert.ok(live.includes("QVC"));
  assert.ok(live.includes("4h 0m"));
  assert.ok(
    live.includes(
      "Ends at " +
        new Date(2026, 9, 31, 14).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
    ),
  );
});
test("logos prefer item artwork, then inherited and series logos", () => {
  assert.equal(
    C.logoItem({ Id: "movie", ImageTags: { Logo: "tag" } }),
    "movie",
  );
  assert.equal(
    C.logoItem({
      Id: "episode",
      ParentLogoItemId: "parent",
      SeriesId: "series",
    }),
    "parent",
  );
  assert.equal(C.logoItem({ Id: "episode", SeriesId: "series" }), "series");
  assert.equal(C.logoItem({ Id: "movie" }), null);
});
test("Continue watching keeps one most recently played episode per series", () => {
  const rows = C.combineResume(
    [
      {
        Id: "e1",
        SeriesId: "show",
        UserData: { LastPlayedDate: "2026-10-30T12:00:00Z" },
      },
      {
        Id: "e2",
        SeriesId: "show",
        UserData: { LastPlayedDate: "2026-11-01T12:00:00Z" },
      },
    ],
    [
      { Id: "e3", SeriesId: "show" },
      { Id: "other", SeriesId: "other" },
    ],
  );
  assert.deepEqual(
    rows.map((i) => i.Id),
    ["e2", "other"],
  );
  const plan = C.homeRows(
    [
      { Id: "live", Name: "Live TV", CollectionType: "livetv" },
      { Id: "discover", Name: "Discover" },
    ],
    { combine: true },
  );
  assert.equal(plan[0].title, "Continue watching");
  assert.ok(
    plan.some(
      (r) =>
        r.kind === "live" &&
        r.title === "Watch live" &&
        r.layout === "landscape",
    ),
  );
  assert.ok(plan.some((r) => r.title === "Recently added in Discover"));
});
test("live playback requires a negotiated transcode and carries the tuner identifier", () => {
  const info = {
    MediaSources: [
      {
        Id: "live",
        LiveStreamId: "tuner",
        SupportsDirectPlay: true,
        TranscodingUrl: "/live/master.m3u8",
      },
    ],
  };
  assert.equal(
    C.stream("https://tv.example", "channel", info, "token", "device", true)
      .method,
    "Transcode",
  );
  assert.equal(
    new URL(
      C.stream("https://tv.example", "channel", info, "token", "device").url,
    ).searchParams.get("LiveStreamId"),
    "tuner",
  );
  assert.throws(() =>
    C.stream(
      "https://tv.example",
      "channel",
      { MediaSources: [{ Id: "live", SupportsDirectPlay: true }] },
      "token",
      "device",
      true,
    ),
  );
});

test("holiday rows retain eleven days after holidays and Christmas follows Thanksgiving", () => {
  const rows = (month, day = 1, year = 2026) =>
    C.holidayRows(new Date(year, month - 1, day, 12));
  assert.deepEqual(
    rows(10).map((r) => r.title),
    [
      "Halloween Movies",
      "Horror Movies",
      "Thriller Movies",
      "Halloween Episodes",
    ],
  );
  assert.deepEqual(rows(10, 31), rows(10));
  assert.deepEqual(rows(11, 12)[0].filter, { Tags: "thanksgiving" });
  assert.deepEqual(rows(12)[1].filter, { SearchTerm: "christmas" });
  assert.equal(rows(12)[1].layout, "landscape");
  assert.equal(rows(11, 11)[0].title, "Halloween Movies");
  assert.equal(rows(11, 26)[0].title, "Thanksgiving Movies");
  assert.equal(rows(11, 27)[0].title, "Christmas Movies");
  assert.equal(rows(11, 23, 2023)[0].title, "Thanksgiving Movies");
  assert.equal(rows(11, 24, 2023)[0].title, "Christmas Movies");
  assert.equal(rows(1, 5, 2027)[0].title, "Christmas Movies");
  assert.equal(rows(1, 5, 2027)[0].key, rows(12, 25, 2026)[0].key);
  assert.deepEqual(rows(1, 6), []);
  assert.deepEqual(rows(1, 12), []);
  assert.deepEqual(rows(1, 13), []);
  assert.equal(rows(2, 25)[0].title, "Valentine's Movies");
  assert.deepEqual(rows(2, 26), []);
  for (const month of [3, 4, 5, 6, 7, 8, 9]) assert.deepEqual(rows(month), []);
  assert.notEqual(rows(1, 1, 2026)[0].key, rows(1, 1, 2027)[0].key);
  const plan = C.homeRows([], { combine: true }, new Date(2026, 9, 31));
  assert.equal(plan[0].kind, "combined");
  assert.equal(plan[1].title, "Halloween Movies");
  assert.ok(
    !C.homeRows([], { holidays: false }, new Date(2026, 9, 31)).some(
      (r) => r.kind === "holiday",
    ),
  );
});

test("track choices preserve Jellyfin stream indices and descriptive labels", () => {
  const source = {
    MediaStreams: [
      { Type: "Video", Index: 0 },
      { Type: "Audio", Index: 2, DisplayTitle: "English AAC stereo" },
      { Type: "Audio", Index: 7, Language: "spa", Codec: "aac", Channels: 6 },
      {
        Type: "Subtitle",
        Index: 11,
        Language: "eng",
        Codec: "srt",
        IsForced: true,
      },
      { Type: "Audio", Index: -1 },
    ],
  };
  assert.deepEqual(C.tracks(source, "Audio"), [
    { index: 2, label: "English AAC stereo" },
    { index: 7, label: "Spanish · AAC · 6 ch" },
  ]);
  assert.deepEqual(C.tracks(source, "Subtitle"), [
    { index: 11, label: "English · SRT · Forced" },
  ]);
  assert.deepEqual(C.tracks({}, "Audio"), []);
});
test("chapter markers are sorted and invalid or out-of-duration markers are omitted", () => {
  const item = {
    RunTimeTicks: 100,
    Chapters: [
      { Name: "End", StartPositionTicks: 100 },
      { Name: "Later", StartPositionTicks: 50 },
      { Name: "Opening", StartPositionTicks: 0 },
      { StartPositionTicks: -1 },
      { StartPositionTicks: NaN },
    ],
  };
  assert.deepEqual(
    C.chapters(item).map((c) => c.Name),
    ["Opening", "Later"],
  );
});
test("episode autoplay requires an inclusive current-item anchor and playable same-series successors", () => {
  const ep = (Id, extra = {}) => ({
    Id,
    Type: "Episode",
    SeriesId: "series",
    ...extra,
  });
  assert.deepEqual(
    C.followingEpisodes(ep("current"), [
      ep("previous"),
      ep("current"),
      ep("next"),
      ep("next"),
      ep("missing", { IsMissing: true }),
      ep("virtual", { IsVirtualItem: true }),
      ep("other", { SeriesId: "other" }),
      ep("last"),
    ]).map((e) => e.Id),
    ["next", "last"],
  );
  assert.deepEqual(
    C.followingEpisodes(ep("current"), [ep("previous"), ep("next")]),
    [],
  );
});

test("remembered tracks match language aliases and roles rather than old stream indices", () => {
  const first = {
    MediaStreams: [
      { Type: "Audio", Index: 5, Language: "spa" },
      {
        Type: "Subtitle",
        Index: 9,
        Language: "eng",
        IsForced: false,
        IsHearingImpaired: true,
      },
    ],
  };
  const audio = C.trackPreference(first, "Audio", 5),
    subtitle = C.trackPreference(first, "Subtitle", 9);
  assert.equal(audio.language, "es");
  assert.ok(!("Index" in audio));
  const next = {
    DefaultAudioStreamIndex: 2,
    DefaultSubtitleStreamIndex: 10,
    MediaStreams: [
      { Type: "Audio", Index: 2, Language: "eng" },
      { Type: "Audio", Index: 5, Language: "eng", Title: "Commentary" },
      { Type: "Audio", Index: 25, Language: "es-MX" },
      {
        Type: "Audio",
        Index: 26,
        Language: "spa",
        Title: "Spanish commentary",
      },
      { Type: "Subtitle", Index: 9, Language: "spa" },
      { Type: "Subtitle", Index: 10, Language: "eng", IsForced: true },
      { Type: "Subtitle", Index: 29, Language: "en-US" },
      { Type: "Subtitle", Index: 30, Language: "eng", IsHearingImpaired: true },
    ],
  };
  assert.equal(C.preferredTrack(next, "Audio", audio), 25);
  assert.equal(C.preferredTrack(next, "Subtitle", subtitle), 30);
  assert.equal(
    C.preferredTrack(next, "Subtitle", { language: "en", forced: true }),
    10,
  );
  assert.equal(
    C.preferredTrack(next, "Audio", { language: "es", role: "commentary" }),
    26,
  );
  assert.equal(C.preferredTrack(next, "Audio", { language: "fr" }), undefined);
  assert.equal(C.preferredTrack(next, "Subtitle", { language: "fr" }), -1);
  assert.equal(C.preferredTrack(next, "Subtitle", { off: true }), -1);
  assert.equal(C.preferredTrack(next, "Audio", null), undefined);
  assert.equal(
    C.preferredTrack(
      {
        MediaStreams: [
          { Type: "Subtitle", Index: 1, Language: "en", IsForced: true },
        ],
      },
      "Subtitle",
      { language: "en", forced: false },
    ),
    -1,
  );
});
test("unknown-language tracks do not create a preference or guess a match", () => {
  assert.equal(
    C.trackPreference(
      {
        MediaStreams: [
          { Type: "Audio", Index: 1, Language: "und", DisplayTitle: "Track 1" },
        ],
      },
      "Audio",
      1,
    ),
    null,
  );
  assert.equal(C.trackPreference({ MediaStreams: [] }, "Audio", 1), null);
  assert.deepEqual(C.trackPreference({}, "Subtitle", -1), { off: true });
  assert.equal(
    C.preferredTrack(
      { MediaStreams: [{ Type: "Subtitle", Index: 1, Language: "und" }] },
      "Subtitle",
      { language: "und" },
    ),
    undefined,
  );
});

test("library requests apply sort and filters without leaking them to another folder", () => {
  const query = C.libraryQuery(
    "movies",
    {
      sort: "release-desc",
      watched: "unwatched",
      genre: "Sci-Fi & Fantasy",
      year: "2025",
    },
    96,
    "Movie,Video",
  );
  assert.equal(query.StartIndex, 96);
  assert.equal(query.Limit, 48);
  assert.equal(query.SortBy, "PremiereDate,SortName");
  assert.equal(query.SortOrder, "Descending");
  assert.equal(query.IsPlayed, false);
  assert.equal(query.Genres, "Sci-Fi & Fantasy");
  assert.equal(query.Years, "2025");
  assert.equal(query.Recursive, true);
  assert.equal(query.IncludeItemTypes, "Movie,Video");
  const folder = C.libraryQuery(
    "season",
    { sort: "invalid", watched: "all" },
    0,
  );
  assert.equal(folder.SortBy, "SortName");
  assert.equal(folder.Recursive, false);
  assert.equal(folder.IsPlayed, undefined);
  assert.equal(folder.Genres, undefined);
});
test("library rendering stays bounded for very large continuous libraries", () => {
  const window = C.libraryWindow(100000, 6, 480, 240000, 1080);
  assert.ok(window.end - window.start <= 60);
  assert.equal(window.start % 6, 0);
  assert.equal(window.top, (window.start / 6) * 480);
  const last = C.libraryWindow(101, 6, 480, 16 * 480, 1080);
  assert.equal(last.end, 101);
  assert.equal(last.bottom, 0);
  assert.deepEqual(C.libraryWindow(0, 6, 480, 0, 1080), {
    start: 0,
    end: 0,
    top: 0,
    bottom: 0,
  });
  const resized = C.libraryWindow(100000, 4, 400, 12000, 1080);
  assert.equal(resized.start % 4, 0);
  assert.ok(resized.end - resized.start <= 40);
});

test("C1 native profile bounds 4K HEVC/HDR10 and Dolby audio without DTS/TrueHD", () => {
  const p = C.profile({ native: true });
  assert.equal(p.MaxStreamingBitrate, 60000000);
  assert.equal(p.DirectPlayProfiles[0].Container, "mp4,m4v,mkv");
  assert.equal(p.DirectPlayProfiles[0].VideoCodec, "h264,hevc");
  assert.equal(p.DirectPlayProfiles[0].AudioCodec, "aac,mp3,ac3,eac3");
  assert.ok(!JSON.stringify(p).includes("truehd"));
  assert.ok(!JSON.stringify(p).includes("dts"));
  const hevc = p.CodecProfiles.find(
    (c) => c.Codec === "hevc" && !c.Container && !c.ApplyConditions,
  );
  assert.equal(
    hevc.Conditions.find((c) => c.Property === "VideoRangeType").Value,
    "SDR|HDR10",
  );
  assert.equal(
    hevc.Conditions.find((c) => c.Property === "VideoLevel").Value,
    "153",
  );
  assert.equal(
    hevc.Conditions.find((c) => c.Property === "Width").Value,
    "3840",
  );
  assert.equal(
    hevc.Conditions.find((c) => c.Property === "Height").Value,
    "2160",
  );
  assert.equal(
    hevc.Conditions.find((c) => c.Property === "VideoFramerate").Value,
    "60",
  );
  const surround = p.CodecProfiles.find((c) => c.Codec === "ac3,eac3");
  assert.equal(surround.Conditions[0].Value, "6");
  assert.equal(p.TranscodingProfiles[0].Container, "mp4");
  assert.equal(p.TranscodingProfiles[0].Protocol, "hls");
  const enabled = C.profile({ native: true, dolbyVision: true });
  assert.ok(
    enabled.CodecProfiles.some((c) =>
      c.Conditions.some(
        (rule) =>
          rule.Property === "VideoRangeType" &&
          rule.Value === "SDR|HDR10|DOVI|DOVIWithHDR10",
      ),
    ),
  );
  assert.ok(
    !enabled.CodecProfiles.some((c) =>
      c.Conditions.some(
        (rule) =>
          rule.Property === "VideoRangeType" &&
          rule.Value.includes("DOVIWithEL"),
      ),
    ),
  );
  assert.equal(
    C.profile().MaxStreamingBitrate,
    20000000,
    "The shared baseline remains available for other platforms and explicit Compatibility",
  );
});
test("native policy requires compatible Dolby Vision MP4 and falls back for burn-in", () => {
  const source = (Container, VideoRangeType) => ({
    Container,
    MediaStreams: [{ Type: "Video", VideoRangeType }],
  });
  const on = { native: true, dolbyVision: true };
  assert.equal(
    C.nativePolicy(source("mp4", "HDR10"), { native: true }, -1).native,
    true,
  );
  assert.equal(C.nativePolicy(source("mp4", "DOVI"), on, -1).native, true);
  assert.equal(
    C.nativePolicy(source("mp4", "DOVIWithHDR10"), on, -1).native,
    true,
  );
  assert.equal(C.nativePolicy(source("mkv", "DOVI"), on, -1).native, false);
  assert.equal(
    C.nativePolicy(source("mp4", "DOVIWithEL"), on, -1).native,
    false,
  );
  assert.equal(
    C.nativePolicy(source("mp4", "DOVIWithHDR10Plus"), on, -1).native,
    false,
  );
  assert.equal(
    C.nativePolicy(
      source("mp4", "DOVI"),
      { native: true, dolbyVision: false },
      -1,
    ).native,
    false,
  );
  assert.equal(C.nativePolicy(source("mp4", "HDR10"), on, 3).native, false);
  assert.equal(C.nativePolicy(source("mp4", "HDR10"), on, null).native, true);
});
test("playback diagnostics distinguish source, remux and output without exposing credentials", () => {
  const active = {
    method: "Transcode",
    audioIndex: 1,
    profileName: "Test profile",
    source: {
      Container: "mkv",
      Bitrate: 40000000,
      Path: "/private/secret",
      TranscodingUrl:
        "/master.m3u8?api_key=do-not-show&TranscodeReasons=ContainerNotSupported,AudioCodecNotSupported",
      MediaStreams: [
        {
          Type: "Video",
          Codec: "hevc",
          Width: 3840,
          Height: 2160,
          VideoRangeType: "HDR10",
        },
        { Type: "Audio", Index: 1, Codec: "dts", Channels: 8 },
      ],
    },
  };
  const rows = Object.fromEntries(
    C.playbackInfo(
      active,
      {
        IsVideoDirect: true,
        IsAudioDirect: false,
        VideoCodec: "hevc",
        AudioCodec: "aac",
        Width: 3840,
        Height: 2160,
        AudioChannels: 2,
        Bitrate: 35000000,
      },
      { width: 3840, height: 2160, frames: 100, dropped: 2 },
    ),
  );
  assert.equal(rows.Playback, "Video copied; audio encoded");
  assert.equal(rows["Source dynamic range"], "HDR10");
  assert.equal(rows["Delivered resolution"], "3840 × 2160");
  assert.equal(rows["Dropped frames"], "2 / 100");
  assert.equal(
    rows["Server reasons"],
    "Container needs conversion; Audio codec is unsupported",
  );
  assert.ok(!JSON.stringify(rows).includes("do-not-show"));
  assert.ok(!JSON.stringify(rows).includes("/private/secret"));
  assert.equal(
    Object.fromEntries(C.playbackInfo(active, null))["Delivered stream"],
    "Not reported by the server yet",
  );
  assert.equal(
    Object.fromEntries(
      C.playbackInfo({ ...active, method: "DirectPlay" }, null),
    ).Playback,
    "Direct play",
  );
});

test("subtitle styling accepts only bounded known values and text codecs", () => {
  assert.deepEqual(
    C.subtitleStyle({
      enabled: true,
      size: 999,
      color: "url(secret)",
      background: "red",
      position: "left",
      delay: 99,
    }),
    {
      enabled: true,
      size: 48,
      color: "white",
      background: "none",
      position: "bottom",
      delay: 10,
    },
  );
  const source = {
    MediaStreams: [
      { Type: "Subtitle", Index: 9, Codec: "SRT" },
      { Type: "Subtitle", Index: 12, Codec: "pgssub" },
      { Type: "Subtitle", Index: 14, Codec: "ass" },
    ],
  };
  assert.equal(C.textSubtitle(source, 9).Index, 9);
  assert.equal(C.textSubtitle(source, 12), undefined);
  assert.equal(C.textSubtitle(source, 14).Index, 14);
});
test("subtitle cues preserve absolute timing, overlap, seeks and delay without HTML rendering", () => {
  const cues = C.parseSubtitles(
    "WEBVTT\n\n00:00:10.000 --> 00:00:15.000 align:start\n<b>Hello</b> &amp; &#x1f600;\n\ncue-id\n00:00:12.000 --> 00:00:13.000\n&lt;img src=x onerror=evil()&gt;\n\nNOTE ignored\n00:00:01.000 --> 00:00:03.000\nNot a cue\n\n00:00:90.000 --> 00:00:91.000\nInvalid",
  );
  assert.equal(cues.length, 2);
  assert.equal(C.subtitleText(cues, 11, 0), "Hello & 😀");
  assert.match(C.subtitleText(cues, 12, 0), /<img src=x onerror=evil\(\)>/);
  assert.equal(C.subtitleText(cues, 15, 0), "");
  assert.equal(C.subtitleText(cues, 10, 1), "");
  assert.equal(C.subtitleText(cues, 10, -1), "Hello & 😀");
  assert.equal(C.subtitleText(cues, 11, 0), "Hello & 😀");
  assert.equal(
    C.parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nSRT")[0].text,
    "SRT",
  );
  assert.throws(() => C.parseSubtitles("x".repeat(2097153)), /too large/);
});

test("Live TV now/next handles gaps, expired and duplicate listings per channel", () => {
  const at = Date.parse("2026-10-31T12:00:00Z");
  const p = (Id, ChannelId, start, end) => ({
    Id,
    ChannelId,
    StartDate: new Date(at + start * 60000).toISOString(),
    EndDate: new Date(at + end * 60000).toISOString(),
  });
  const current = p("now", "c", -20, 10),
    next = p("next", "c", 15, 45);
  const result = C.liveProgrammes(
    [
      next,
      p("old", "c", -60, 0),
      current,
      current,
      p("other", "d", -5, 5),
      { Id: "bad", ChannelId: "c" },
    ],
    "c",
    at,
  );
  assert.equal(result.current.Id, "now");
  assert.equal(result.next.Id, "next");
  assert.equal(C.liveProgrammes([next], "c", at).current, null);
  assert.ok(Math.abs(C.liveProgress(current, at) - 200 / 3) < 1e-10);
  assert.equal(C.liveProgress(current, at + 600000), 100);
  assert.equal(C.liveProgress({}, at), 0);
});

test("ratings include valid community and critic scores, including zero", () => {
  assert.ok(
    C.quickDetails({ CommunityRating: 8.5, CriticRating: 90 }).includes(
      "8.5 ★  ·  90% 🍅",
    ),
  );
  assert.ok(
    C.quickDetails({ CommunityRating: 0, CriticRating: 0 }).includes(
      "0.0 ★  ·  0% 🍅",
    ),
  );
  for (const item of [
    {},
    { CommunityRating: null, CriticRating: null },
    { CommunityRating: 11, CriticRating: 101 },
    { CommunityRating: NaN, CriticRating: -1 },
  ]) {
    const text = C.quickDetails(item);
    assert.ok(!text.includes("★") && !text.includes("🍅"));
  }
});

test("Home custom rows reorder, hide and set artwork without losing seasonal identity", () => {
  const libraries = [
    { Id: "movies", Name: "Movies", CollectionType: "movies" },
  ];
  const options = {
    combine: true,
    holidays: true,
    rowOrder: ["pinned:genre:comedy", "latest:movies", "continue"],
    hiddenRows: ["favorite-series"],
    rowLayouts: { continue: "landscape" },
    pinnedRows: [
      { kind: "genre", id: "comedy", name: "Comedy" },
      { kind: "genre", id: "comedy", name: "Duplicate" },
      { kind: "playlist", id: "list", name: "Weekend" },
      { kind: "invalid", id: "bad", name: "Bad" },
    ],
  };
  const rows = C.homeRows(libraries, options, new Date(2026, 9, 31));
  assert.deepEqual(
    rows.slice(0, 3).map((x) => x.key),
    ["pinned:genre:comedy", "latest:movies", "continue"],
  );
  assert.equal(rows[0].filter.GenreIds, "comedy");
  assert.equal(rows[2].layout, "landscape");
  assert.equal(rows.filter((x) => x.key === "pinned:genre:comedy").length, 1);
  assert.ok(
    !rows.some((x) => x.key === "favorite-series" || x.title === "Bad"),
  );
  assert.equal(
    C.homeRowKey(C.holidayRows(new Date(2026, 9, 31))[0]),
    C.homeRowKey(C.holidayRows(new Date(2027, 9, 31))[0]),
  );
  assert.ok(rows.some((x) => x.pinType === "playlist" && x.pinId === "list"));
});

test("subtitle menu labels use language, format and roles rather than release filenames", () => {
  const source={MediaStreams:[
    {Type:"Subtitle",Index:4,Codec:"subrip",Language:"eng",DisplayTitle:"Long release name - [extra junk]",IsExternal:true},
    {Type:"Subtitle",Index:9,Codec:"srt",Language:"en"},
    {Type:"Subtitle",Index:12,Codec:"PGSSUB",Language:"spa",IsForced:true},
    {Type:"Subtitle",Index:13,Codec:"ass",Language:"jpn",IsHearingImpaired:true}
  ]};
  const tracks=C.subtitleTracks(source);
  assert.deepEqual(tracks.map(t=>t.index),[4,9,12,13]);
  assert.equal(tracks[0].label,"English · SRT · Track 5");
  assert.equal(tracks[1].label,"English · SRT · Track 10");
  assert.equal(tracks[2].label,"Spanish · PGS · Forced");
  assert.equal(tracks[3].label,"Japanese · ASS · Hearing impaired");
  assert.equal(tracks[0].external,true);
  assert(!tracks.some(t=>t.label.includes("junk")));
});

test("subtitle timing belongs to one video, source and stable track identity", () => {
  const track = {Type:"Subtitle",Index:4,IsExternal:true,Path:"/media/movie.en.srt",Codec:"subrip",Language:"eng"};
  const source = {Id:"source",MediaStreams:[track]};
  const key = C.subtitleTimingKey({Id:"movie"},source,4);
  assert.equal(key,C.subtitleTimingKey({Id:"movie"},{...source,MediaStreams:[{...track,Index:8}]},8));
  assert.notEqual(key,C.subtitleTimingKey({Id:"another-movie"},source,4));
  assert.notEqual(key,C.subtitleTimingKey({Id:"movie"},{...source,Id:"another-source"},4));
  assert.notEqual(key,C.subtitleTimingKey({Id:"movie"},{...source,MediaStreams:[{...track,Path:"/media/movie.es.srt"}]},4));
  assert.equal(C.subtitleTimingKey({Id:"movie"},source,-1),"");
});

test("subtitle defaults are language-specific and automatically cover non-English audio", () => {
 const source={DefaultAudioStreamIndex:1,DefaultSubtitleStreamIndex:4,MediaStreams:[
  {Type:"Audio",Index:1,Language:"en"},{Type:"Audio",Index:2,Language:"jpn"},{Type:"Audio",Index:3,Language:"und"},
  {Type:"Subtitle",Index:4,Language:"eng",Codec:"pgssub"},{Type:"Subtitle",Index:5,Language:"en",Codec:"srt"},
  {Type:"Subtitle",Index:6,Language:"spa",Codec:"srt"}]};
 assert.equal(C.defaultSubtitle(source,1,{mode:"off",foreignEnglish:true}),-1,"English audio does not trigger foreign rule");
 assert.equal(C.defaultSubtitle(source,2,{mode:"off",foreignEnglish:true}),5,"Prefer soft English text to bitmap captions");
 assert.equal(C.defaultSubtitle(source,3,{mode:"off",foreignEnglish:true}),-1,"Unknown audio does not guess");
 assert.equal(C.defaultSubtitle(source,1,{mode:"language",language:"spa"}),6);
 assert.equal(C.defaultSubtitle(source,1,{mode:"language",language:"fra"}),-1);
 assert.equal(C.defaultSubtitle(source,2,{mode:"off",foreignEnglish:false}),-1);
 assert.equal(C.defaultSubtitle(source,1,{mode:"remember"},{off:true}),-1);
});

test("anime audio matches library ancestry and falls back without affecting ordinary TV", () => {
 const libraries=[{Id:"anime",Name:"Anime"},{Id:"tv",Name:"TV"}];
 assert.equal(C.animeItem({ParentId:"anime"},libraries,[]),true);
 assert.equal(C.animeItem({SeriesId:"show"},libraries,[{Id:"anime",Type:"CollectionFolder"}]),true);
 assert.equal(C.animeItem({Genres:["Anime"]},[],[]),true);
 assert.equal(C.animeItem({Genres:["Animation"]},libraries,[{Id:"tv",Name:"TV"}]),false);
 const source={MediaStreams:[{Type:"Audio",Index:1,Language:"eng"},{Type:"Audio",Index:4,Language:"ja"}]};
 assert.equal(C.animeAudio(source,"jpn",{language:"eng"}),4);
 assert.equal(C.animeAudio(source,"eng",{language:"ja"}),1);
 assert.equal(C.animeAudio(source,"fra",{language:"eng"}),1);
 assert.equal(C.animeAudio(source,"fra"),undefined);
 assert.equal(C.animeAudio(source,"",{language:"eng"}),1);
});
test("media segments accept valid intro/outro ticks and clamp to runtime", () => {
  assert.deepEqual(C.mediaSegments({Items: [
    {Type: 'Outro', StartTicks: 900000000, EndTicks: 1200000000},
    {Type: 'Intro', StartTicks: 100000000, EndTicks: 200000000},
    {Type: 'Commercial', StartTicks: 0, EndTicks: 100000000},
    {Type: 'Intro', StartTicks: -1, EndTicks: 10},
    {Type: 'Outro', StartTicks: 20, EndTicks: 10},
    {Type: 'Intro', StartTicks: '0', EndTicks: 10},
    {Type: 'Outro', StartTicks: 1100000000, EndTicks: 1200000000}
  ]}, 100), [{type: 'Intro', start: 10, end: 20}, {type: 'Outro', start: 90, end: 100}]);
  assert.deepEqual(C.mediaSegments(null), []);
});
