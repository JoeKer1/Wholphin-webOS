const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
      }),
      errors = [],
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let container = "mp4",
      range = "HDR10",
      defaultSubtitle = -1,
      stats = null,
      sessionId = null,
      tvDevice = null,
      denyStats = false;
    function item() {
      return {
        Id: "movie",
        Name: "4K test",
        MediaType: "Video",
        Type: "Movie",
        Chapters: [],
        RunTimeTicks: 18000000000,
      };
    }
    function source() {
      return {
        Id: "source",
        Container: container,
        Bitrate: 45000000,
        Path: "/private/media/secret-path",
        DefaultAudioStreamIndex: 1,
        DefaultSubtitleStreamIndex: defaultSubtitle,
        MediaStreams: [
          {
            Type: "Video",
            Index: 0,
            Codec: "hevc",
            Width: 3840,
            Height: 2160,
            VideoRangeType: range,
            Profile: "Main 10",
            Level: 153,
            BitDepth: 10,
            VideoCodecTag: "dvh1",
          },
          {
            Type: "Audio",
            Index: 1,
            Codec: container === "mkv" ? "dts" : "eac3",
            Channels: 6,
            Language: "eng",
            DisplayTitle: "English surround",
          },
          {
            Type: "Subtitle",
            Index: 9,
            Language: "eng",
            Codec: "srt",
            DisplayTitle: "English subtitles",
          },
        ],
      };
    }
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        body = req.postDataJSON();
      requests.push({
        path: u.pathname,
        method: req.method(),
        body,
        query: Object.fromEntries(u.searchParams),
      });
      let json = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        json = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      if (u.pathname.endsWith("/Latest")) json = [item()];
      if (u.pathname === "/Users/user/Items/movie") json = item();
      if (u.pathname === "/Items/movie/PlaybackInfo") {
        if (req.method() === "GET") json = { MediaSources: [source()] };
        else {
          const native = body.DeviceProfile.Name.includes("C1");
          tvDevice = (req.headers().authorization.match(/DeviceId="([^"]+)"/) ||
            [])[1];
          sessionId = "play-" + requests.length;
          const direct = native && container === "mp4" && body.EnableDirectPlay;
          stats = direct
            ? null
            : {
                IsVideoDirect: native,
                IsAudioDirect: false,
                VideoCodec: native ? "hevc" : "h264",
                AudioCodec: "aac",
                AudioChannels: 2,
                Width: native ? 3840 : 1920,
                Height: native ? 2160 : 1080,
                Bitrate: native ? 42000000 : 12000000,
                TranscodeReasons:
                  "ContainerNotSupported, AudioCodecNotSupported",
              };
          json = {
            PlaySessionId: sessionId,
            MediaSources: [
              {
                ...source(),
                SupportsDirectPlay: direct,
                SupportsDirectStream: native && !direct,
                TranscodingUrl:
                  "/Videos/movie/master.m3u8?api_key=do-not-show&width=" +
                  (native ? 3840 : 1920),
              },
            ],
          };
        }
      }
      if (u.pathname === "/Sessions") {
        if (denyStats) {
          await route.fulfill({ status: 403, json: {} });
          return;
        }
        json = [
          {
            DeviceId: tvDevice,
            UserId: "other",
            NowPlayingItem: { Id: "movie" },
            TranscodingInfo: { VideoCodec: "other-user-secret" },
          },
          {
            DeviceId: tvDevice,
            UserId: "user",
            NowPlayingItem: { Id: "movie" },
            PlayState: { PlaySessionId: sessionId },
            TranscodingInfo: stats,
          },
        ];
      }
      if (
        u.pathname.includes("/Sessions/") ||
        u.pathname.endsWith("/ActiveEncodings")
      ) {
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "test",
          name: "Joe",
        }),
      );
      const p = HTMLMediaElement.prototype;
      Object.defineProperties(p, {
        src: {
          get() {
            return this._src || "";
          },
          set(v) {
            this._src = v;
            this._time = 0;
          },
        },
        currentTime: {
          get() {
            return this._time || 0;
          },
          set(v) {
            this._time = v;
            setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
          },
        },
        duration: {
          get() {
            return 1800;
          },
        },
        seeking: {
          get() {
            return false;
          },
        },
        paused: {
          get() {
            return !this._playing;
          },
        },
        videoWidth: {
          get() {
            return this._src && this._src.includes("width=1920") ? 1920 : 3840;
          },
        },
        videoHeight: {
          get() {
            return this.videoWidth === 3840 ? 2160 : 1080;
          },
        },
      });
      p.load = function () {
        if (this._src)
          setTimeout(() => this.dispatchEvent(new Event("loadedmetadata")), 0);
      };
      p.play = function () {
        window.mockPlayCount = (window.mockPlayCount || 0) + 1;
        this._playing = true;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      p.pause = function () {
        this._playing = false;
        this.dispatchEvent(new Event("pause"));
      };
      p.getVideoPlaybackQuality = function () {
        return { droppedVideoFrames: 3, totalVideoFrames: 100 };
      };
      const remove = Element.prototype.removeAttribute;
      p.removeAttribute = function (name) {
        if (name === "src") this._src = "";
        return remove.call(this, name);
      };
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    const click = async (name) =>
      page.getByRole("button", { name, exact: true }).click();
    async function waitFor(fn) {
      for (let n = 0; n < 150; n++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Condition not met");
    }
    async function control(id) {
      if (await page.locator("#player-tools").isHidden())
        await page.locator("#player-options").click();
      await page.locator("#" + id).click();
    }
    const infos = () =>
      requests.filter(
        (r) => r.path.endsWith("/PlaybackInfo") && r.method === "POST",
      );
    const starts = () => requests.filter((r) => r.path === "/Sessions/Playing");
    async function stopped() {
      await page.locator("#stop").click();
      await page
        .getByRole("heading", { name: "4K test", exact: true })
        .waitFor();
    }
    async function play() {
      const count = starts().length;
      await click("Play from beginning");
      await waitFor(() => starts().length > count);
    }
    async function atTime(t) {
      await page.locator("#video").evaluate((v, t) => {
        v.currentTime = t;
        v.dispatchEvent(new Event("timeupdate"));
      }, t);
    }
    async function info() {
      await control("playback-info");
      await page.locator(".playback-info").waitFor();
      return page.locator("#playback-panel").textContent();
    }
    await page.locator("nav [data-nav=settings]").click();
    await click("Playback mode: Compatibility");
    await click("Dolby Vision MP4 (experimental): Off");
    await page.locator("nav [data-nav=home]").click();
    await click("4K test");
    await play();
    let request = infos().at(-1).body;
    assert.ok(request.DeviceProfile.Name.includes("C1"));
    assert.equal(request.EnableDirectStream, true);
    assert.equal(request.MaxStreamingBitrate, 60000000);
    assert.equal(request.MaxAudioChannels, 6);
    let text = await info();
    assert.ok(text.includes("Direct play"));
    assert.ok(text.includes("3840 × 2160"));
    assert.ok(text.includes("HDR10"));
    assert.ok(text.includes("EAC3 · 6 channels"));
    assert.ok(!text.includes("do-not-show"));
    assert.ok(!text.includes("secret-path"));
    assert.ok(!text.includes("other-user-secret"));
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.classList.contains("playback-info-row"),
      ),
      true,
      "Info rows are remote navigable",
    );
    await page.screenshot({ path: "/tmp/wholphin-playback-info.png" });
    await click("Close");
    await atTime(321.5);
    const before = starts().length;
    await page.locator("#video").evaluate((v) => {
      v._time = 0;
      v.dispatchEvent(new Event("error"));
    });
    await waitFor(() => starts().length > before);
    request = infos().at(-1).body;
    assert.equal(request.DeviceProfile.Name, "Wholphin webOS (H.264 / AAC)");
    assert.equal(request.StartTimeTicks, 3215000000);
    assert.equal(request.AllowVideoStreamCopy, false);
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      321.5,
    );
    const nativeStop = requests
      .filter((r) => r.path === "/Sessions/Playing/Stopped")
      .at(-1);
    assert.equal(
      nativeStop.body.PositionTicks,
      3215000000,
      "Decoder error cannot overwrite the bookmark with zero",
    );
    assert.ok(
      (await info()).includes(
        "Native playback failed; retried with Compatibility",
      ),
    );
    const attempts = infos().length;
    await click("Close");
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("error")));
    await page.getByRole("heading", { name: "4K test", exact: true }).waitFor();
    assert.equal(
      infos().length,
      attempts,
      "Compatibility failure does not loop",
    );
    await play();
    await control("subtitles");
    await click("English subtitles");
    await waitFor(() => starts().at(-1).body.SubtitleStreamIndex === 9);
    assert.equal(
      infos().at(-1).body.DeviceProfile.Name,
      "Wholphin webOS (H.264 / AAC)",
      "Subtitle burn-in leaves the native HDR path",
    );
    await control("subtitles");
    await click("Off");
    await waitFor(() => starts().at(-1).body.SubtitleStreamIndex === -1);
    assert.ok(infos().at(-1).body.DeviceProfile.Name.includes("C1"));
    assert.equal(
      infos().at(-1).body.AllowVideoStreamCopy,
      true,
      "Subtitle Off restores video-copy eligibility",
    );
    assert.equal(infos().at(-1).body.MediaSourceId, "source");
    await stopped();
    container = "mkv";
    range = "HDR10";
    await play();
    request = infos().at(-1).body;
    assert.equal(request.EnableDirectStream, true);
    assert.equal(request.AllowVideoStreamCopy, true);
    text = await info();
    assert.ok(text.includes("Video copied; audio encoded"));
    assert.ok(text.includes("DTS · 6 channels"));
    assert.ok(text.includes("AAC · 2 channels"));
    assert.ok(text.includes("Container needs conversion"));
    await page.screenshot({ path: "/tmp/wholphin-playback-remux.png" });
    // Manual Compatibility preserves paused state and the original location.
    await click("Close");
    await atTime(120);
    await page.locator("#toggle").click();
    await info();
    await click("Use Compatibility for this video");
    await waitFor(
      () =>
        infos().at(-1).body.DeviceProfile.Name ===
          "Wholphin webOS (H.264 / AAC)" &&
        starts().at(-1).body.PositionTicks === 1200000000,
    );
    assert.equal(await page.locator("#video").evaluate((v) => v.paused), true);
    await stopped();
    container = "mp4";
    range = "DOVIWithHDR10";
    await play();
    assert.ok(infos().at(-1).body.DeviceProfile.Name.includes("C1"));
    await stopped();
    container = "mkv";
    await play();
    assert.equal(
      infos().at(-1).body.DeviceProfile.Name,
      "Wholphin webOS (H.264 / AAC)",
    );
    await stopped();
    container = "mp4";
    range = "DOVIWithEL";
    await play();
    assert.equal(
      infos().at(-1).body.DeviceProfile.Name,
      "Wholphin webOS (H.264 / AAC)",
    );
    await stopped();
    range = "HDR10";
    defaultSubtitle = 9;
    await page.evaluate(() =>
      localStorage.removeItem(
        "wholphin-track-preferences:https://jellyfin.test:user",
      ),
    );
    await play();
    assert.equal(
      infos().at(-1).body.DeviceProfile.Name,
      "Wholphin webOS (H.264 / AAC)",
    );
    assert.equal(infos().at(-1).body.AllowVideoStreamCopy, false);
    await stopped();
    defaultSubtitle = -1;
    await play();
    denyStats = true;
    text = await info();
    assert.ok(text.includes("Server stream details are unavailable"));
    assert.ok(text.includes("Source resolution"));
    assert.ok(!text.includes("other-user-secret"));
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#player").evaluate((p) => p.hidden),
      false,
    );
    await stopped();
    await play();
    const hiddenAttempts = infos().length;
    await page.evaluate(() =>
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      }),
    );
    const hiddenPlays = await page.evaluate(() => window.mockPlayCount);
    await page.locator("#video").evaluate((v) => {
      v.pause();
      v.dispatchEvent(new Event("loadedmetadata"));
    });
    assert.equal(await page.locator("#video").evaluate((v) => v.paused), true);
    assert.equal(
      await page.evaluate(() => window.mockPlayCount),
      hiddenPlays,
      "Late metadata must not autoplay while hidden",
    );
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("error")));
    await page.getByRole("heading", { name: "4K test", exact: true }).waitFor();
    assert.equal(
      infos().length,
      hiddenAttempts,
      "An error while hidden must not start another video stream",
    );
    await page.evaluate(() => delete document.hidden);
    await page.locator("nav [data-nav=settings]").click();
    await click("Playback mode: LG C1 native (experimental)");
    await page.locator("nav [data-nav=home]").click();
    await click("4K test");
    await play();
    assert.equal(infos().at(-1).body.MaxStreamingBitrate, 20000000);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: opt-in 4K/HEVC profile, Dolby audio, private playback diagnostics, current-session telemetry, remux reporting, HDR/DV gating, burn-in fallback, paused/manual and decoder-error Compatibility retry, bookmark preservation and no retry loop",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
