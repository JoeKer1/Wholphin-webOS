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
    let failSeasons = false;
    let failSwitch = false,
      releaseNegotiation = null,
      holdNegotiation = false;
    const streams = [
      {
        Type: "Audio",
        Index: 2,
        Language: "eng",
        DisplayTitle: "English stereo",
      },
      {
        Type: "Audio",
        Index: 5,
        Language: "spa",
        DisplayTitle: "Spanish stereo",
      },
      {
        Type: "Subtitle",
        Index: 9,
        Language: "eng",
        DisplayTitle: "English subtitles",
      },
      {
        Type: "Subtitle",
        Index: 12,
        Language: "spa",
        DisplayTitle: "Spanish subtitles",
      },
    ];
    function streamsFor(id) {
      if (id === "e2")
        return streams.map((stream) => ({
          ...stream,
          Index: stream.Index + 20,
        }));
      if (id === "e3")
        return streams
          .filter((stream) => stream.Language === "eng")
          .map((stream) => ({ ...stream, Index: stream.Index + 40 }));
      return streams;
    }
    const chapters = [
      { Name: "Opening", StartPositionTicks: 0 },
      { Name: "The discovery", StartPositionTicks: 3000000000 },
      { Name: "Final act", StartPositionTicks: 9000000000 },
    ];
    const ep = (id, n) => ({
      Id: id,
      Name: "Episode " + n,
      Type: "Episode",
      MediaType: "Video",
      SeriesId: "series",
      SeriesName: "Test show",
      Overview: "The crew discovers a new signal.",
      ImageTags: { Primary: "episode-art" },
      ParentIndexNumber: n === 3 ? 2 : 1,
      IndexNumber: n === 3 ? 1 : n,
      RunTimeTicks: 18000000000,
      Chapters: chapters,
    });
    const items = {
      series: {
        Id: "series",
        Name: "Test show",
        Type: "Series",
        IsFolder: true,
      },
      e1: ep("e1", 1),
      e2: ep("e2", 2),
      e3: ep("e3", 3),
      m1: {
        Id: "m1",
        Name: "Movie one",
        Type: "Movie",
        MediaType: "Video",
        RunTimeTicks: 18000000000,
        Chapters: chapters,
      },
      m2: {
        Id: "m2",
        Name: "Movie two",
        Type: "Movie",
        MediaType: "Video",
        RunTimeTicks: 18000000000,
        Chapters: [],
      },
    };
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        body = req.postDataJSON();
      requests.push({
        path: url.pathname,
        body,
        query: Object.fromEntries(url.searchParams),
        method: req.method(),
      });
      if (url.pathname.includes("/Images/"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#534060"/></svg>',
        });
      if (failSeasons && url.pathname === "/Shows/series/Seasons")
        return route.fulfill({ status: 503, json: {} });
      let json = { Items: [] };
      if (url.pathname === "/Shows/series/Seasons")
        json = {
          Items: [
            { Id: "season2", Name: "Season 2", IndexNumber: 2 },
            { Id: "specials", Name: "Specials", IndexNumber: 0 },
            { Id: "season1", Name: "Season 1", IndexNumber: 1 },
          ],
        };
      if (
        url.pathname === "/Users/user/Items" &&
        url.searchParams.has("ParentId")
      ) {
        const season = url.searchParams.get("ParentId");
        const episodes =
          season === "season1"
            ? [items.e1, items.e2]
            : season === "season2"
              ? [items.e3]
              : [];
        json = { Items: episodes, TotalRecordCount: episodes.length };
      }
      if (url.pathname.endsWith("/Views"))
        json = {
          Items: [{ Id: "library", Name: "Videos", CollectionType: "movies" }],
        };
      if (url.pathname.endsWith("/Latest")) json = Object.values(items);
      const detail = url.pathname.match(
        /^\/Users\/(?:user|other)\/Items\/(series|e[123]|m[12])$/,
      );
      if (detail) json = items[detail[1]];
      if (url.pathname === "/Shows/series/Episodes") {
        const ids = ["e1", "e2", "e3"],
          start = ids.indexOf(url.searchParams.get("StartItemId"));
        json = { Items: ids.slice(Math.max(0, start)).map((id) => items[id]) };
      }
      const playback = url.pathname.match(
        /^\/Items\/(e[123]|m[12])\/PlaybackInfo$/,
      );
      if (playback) {
        if (holdNegotiation)
          await new Promise((resolve) => (releaseNegotiation = resolve));
        if (failSwitch) {
          await route.fulfill({ status: 503, json: {} });
          return;
        }
        json = {
          PlaySessionId: "session-" + requests.length,
          MediaSources: [
            {
              Id: "source-" + playback[1],
              SupportsDirectPlay: body ? body.EnableDirectPlay : true,
              TranscodingUrl:
                "/Videos/" + playback[1] + "/master.m3u8?api_key=test",
              DefaultAudioStreamIndex:
                playback[1] === "e2" ? 22 : playback[1] === "e3" ? 42 : 2,
              DefaultSubtitleStreamIndex:
                playback[1] === "e2" ? 29 : playback[1] === "e3" ? 49 : -1,
              MediaStreams: streamsFor(playback[1]),
            },
          ],
        };
      }
      if (
        url.pathname.includes("/Sessions/") ||
        url.pathname.endsWith("/ActiveEncodings")
      ) {
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json });
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem("wholphin-session"))
        localStorage.setItem(
          "wholphin-session",
          JSON.stringify({
            server: "https://jellyfin.test",
            user: "user",
            token: "test",
            name: "Joe",
          }),
        );
      localStorage.setItem(
        "wholphin-home-options:https://jellyfin.test:user",
        JSON.stringify({ combine: true, holidays: false }),
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
        readyState: {
          get() {
            return 4;
          },
        },
        paused: {
          get() {
            return !this._playing;
          },
        },
        seeking: {
          get() {
            return false;
          },
        },
      });
      p.load = function () {
        if (this._src)
          setTimeout(() => this.dispatchEvent(new Event("loadedmetadata")), 0);
      };
      p.play = function () {
        this._playing = true;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      p.pause = function () {
        this._playing = false;
        this.dispatchEvent(new Event("pause"));
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
        if (fn()) return;
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
    async function atTime(seconds) {
      await page.locator("#video").evaluate((v, t) => {
        v.currentTime = t;
        v.dispatchEvent(new Event("timeupdate"));
      }, seconds);
    }
    async function started(count) {
      await waitFor(() => starts().length >= count);
    }
    await click("Movie one");
    await click("More options");
    await click("Add to queue");
    await page.locator("nav [data-nav=home]").click();
    await click("Movie two");
    await click("More options");
    await click("Add to queue");
    await click("View playback queue");
    await click("Move up: Movie two");
    let queueText = await page.locator("#main").textContent();
    assert.ok(
      queueText.indexOf("1. Movie two") < queueText.indexOf("2. Movie one"),
    );
    await click("Move down: Movie two");
    await page.locator("nav [data-nav=home]").click();
    await click("Episode 1");
    await click("Play from beginning");
    await started(1);
    await page.screenshot({ path: "/tmp/wholphin-player-controls.png" });
    await atTime(123.25);
    assert.equal(await page.locator("#player-tools").isHidden(), true);
    await atTime(100);
    await page.locator("#timeline").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      110,
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      100,
    );
    await page.locator("#timeline").evaluate((n) => {
      n.value = "120";
      n.dispatchEvent(new Event("input"));
    });
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      120,
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(":focus").getAttribute("id"), "toggle");
    await page.locator("#player-options").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#player-tools").isHidden(), true);
    assert.equal(
      await page.locator(":focus").getAttribute("id"),
      "player-options",
    );
    await page.screenshot({ path: "/tmp/wholphin-normal-controls.png" });
    await page.waitForFunction(
      () => document.getElementById("controls").style.opacity === "0",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(":focus").getAttribute("id"), "toggle");
    assert.equal(
      await page.locator("#video").evaluate((v) => v.paused),
      false,
      "First Enter reveals controls without toggling playback",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#controls").getAttribute("aria-hidden"),
      "true",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(":focus").getAttribute("id"), "timeline");
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      130,
    );

    await atTime(123.25);
    await control("audio");
    await page
      .getByRole("button", { name: "Spanish stereo", exact: true })
      .waitFor();
    await page.keyboard.press("ArrowDown");
    assert.ok(
      await page
        .locator("#playback-panel")
        .evaluate((p) => p.contains(document.activeElement)),
    );
    await page.screenshot({ path: "/tmp/wholphin-player-audio.png" });
    await click("Spanish stereo");
    await started(2);
    assert.equal(infos().at(-1).body.AudioStreamIndex, 5);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, -1);
    assert.equal(infos().at(-1).body.EnableDirectPlay, false);
    assert.equal(infos().at(-1).body.StartTimeTicks, 1232500000);
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      123.25,
    );
    await control("subtitles");
    await click("English subtitles");
    await started(3);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, 9);
    assert.equal(infos().at(-1).body.AudioStreamIndex, 5);
    assert.ok(
      infos()
        .at(-1)
        .body.DeviceProfile.SubtitleProfiles.every(
          (p) => p.Method === "Encode",
        ),
    );
    await page.locator("#toggle").click();
    await control("subtitles");
    await click("Off");
    await started(4);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, -1);
    assert.equal(
      await page.locator("#video").evaluate((v) => v.paused),
      true,
      "Track switch preserves pause",
    );
    await control("chapters");
    await click("5:00 · The discovery");
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      300,
    );
    await control("audio");
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#player").evaluate((p) => p.hidden),
      false,
      "Back closes menu without stopping video",
    );
    await page.locator("#toggle").click();
    failSwitch = true;
    await control("audio");
    await click("English stereo");
    await page.getByText(/Could not change track/).waitFor();
    assert.equal(
      await page.locator("#video").evaluate((v) => v.paused),
      false,
      "Failed track negotiation preserves old playback",
    );
    assert.equal(
      await page.locator("#playing-title").textContent(),
      "Test show · Episode 1",
    );
    failSwitch = false;
    await page.keyboard.press("Escape");
    // Manual queue takes priority over automatic following episodes.
    await control("queue");
    await page
      .getByRole("heading", { name: "Following episodes", exact: true })
      .waitFor();
    await click("Close");
    await page.locator("#next-video").click();
    await started(5);
    assert.equal(
      await page.locator("#playing-title").textContent(),
      "Movie one",
    );
    assert.equal(await page.locator("#previous-video").isEnabled(), true);
    const beforePrevious = starts().length;
    await page.locator("#previous-video").click();
    await started(beforePrevious + 1);
    assert.equal(await page.locator("#playing-title").textContent(), "Test show · Episode 1");
    await page.locator("#next-video").click();
    await started(beforePrevious + 2);
    assert.equal(await page.locator("#playing-title").textContent(), "Movie one");
    const before = starts().length;
    await atTime(1800);
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await started(before + 1);
    assert.equal(
      await page.locator("#playing-title").textContent(),
      "Movie two",
    );
    assert.ok(
      requests.findIndex(
        (r) => r.path === "/Sessions/Playing/Stopped" && r.body.ItemId === "m1",
      ) <
        requests.findIndex(
          (r) => r.path === "/Sessions/Playing" && r.body.ItemId === "m2",
        ),
      "Old stop report precedes new start",
    );
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await page
      .getByRole("heading", { name: "Movie two", exact: true })
      .waitFor();
    await page.locator("nav [data-nav=home]").click();
    await click("Episode 1");
    await click("Play from beginning");
    await started(before + 2);
    await control("queue");
    await click("Autoplay next episodes: On");
    await click("Close");
    let e2Infos = infos().filter((r) => r.path.includes("/e2/")).length;
    await atTime(1800);
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await page
      .getByRole("heading", { name: "Episode 1", exact: true })
      .waitFor();
    assert.equal(
      infos().filter((r) => r.path.includes("/e2/")).length,
      e2Infos,
      "Autoplay Off stops at episode end",
    );
    await click("Play from beginning");
    await started(before + 3);
    await control("queue");
    await click("Autoplay next episodes: Off");
    await click("Close");
    await atTime(1800);
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await started(before + 4);
    assert.equal(
      infos().at(-1).body.AudioStreamIndex,
      25,
      "Spanish audio follows the language to its new index",
    );
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      -1,
      "Saved Off overrides a default-on subtitle",
    );
    assert.equal(
      await page.locator("#playing-title").textContent(),
      "Test show · Episode 2",
    );
    await atTime(1800);
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await started(before + 5);
    assert.equal(
      infos().at(-1).body.AudioStreamIndex,
      undefined,
      "Unavailable audio uses the server default",
    );
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, -1);
    assert.equal(
      await page.locator("#playing-title").textContent(),
      "Test show · Episode 3",
      "Autoplay crosses season boundary",
    );
    await atTime(1800);
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await page
      .getByRole("heading", { name: "Episode 3", exact: true })
      .waitFor();
    // Cancel while a track change is negotiating: its late response cannot restart playback.
    await click("Play from beginning");
    await started(before + 6);
    holdNegotiation = true;
    await control("subtitles");
    await click("English subtitles");
    await waitFor(() => !!releaseNegotiation);
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    releaseNegotiation();
    holdNegotiation = false;
    await page
      .getByRole("heading", { name: "Episode 3", exact: true })
      .waitFor();
    assert.equal(await page.locator("#player").evaluate((p) => p.hidden), true);
    const prefKey = "wholphin-track-preferences:https://jellyfin.test:user";
    const saved = async () =>
      page.evaluate((key) => JSON.parse(localStorage.getItem(key)), prefKey);
    assert.equal(
      (await saved()).Audio.language,
      "es",
      "A failed audio switch must not overwrite the saved language",
    );
    assert.deepEqual(
      (await saved()).Subtitle,
      { off: true },
      "A cancelled subtitle switch must not overwrite Off",
    );
    let count = starts().length;
    await page.reload();
    await click("Episode 2");
    await click("Play from beginning");
    await started(++count);
    assert.equal(
      infos().at(-1).body.AudioStreamIndex,
      25,
      "Language preference survives app restart",
    );
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, -1);
    await control("subtitles");
    await click("Spanish subtitles");
    await started(++count);
    assert.equal((await saved()).Subtitle.language, "es");
    await page.locator("#next-video").click();
    await started(++count);
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      -1,
      "Unavailable preferred subtitles stay off",
    );
    assert.equal(
      (await saved()).Subtitle.language,
      "es",
      "Fallback must retain the desired language for later episodes",
    );
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await page
      .getByRole("heading", { name: "Episode 3", exact: true })
      .waitFor();
    await page.locator("nav [data-nav=home]").click();
    await click("Episode 2");
    await click("Play from beginning");
    await started(++count);
    assert.equal(infos().at(-1).body.AudioStreamIndex, 25);
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      32,
      "Returning to an available language restores subtitles using the new index",
    );
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await page
      .getByRole("heading", { name: "Episode 2", exact: true })
      .waitFor();
    await page.evaluate(() =>
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "other",
          token: "other-token",
          name: "Other",
        }),
      ),
    );
    await page.reload();
    await click("Episode 2");
    await click("Play from beginning");
    await started(++count);
    assert.equal(infos().at(-1).body.UserId, "other");
    assert.equal(
      infos().at(-1).body.AudioStreamIndex,
      undefined,
      "Another account keeps its own defaults",
    );
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, undefined);
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await page
      .getByRole("heading", { name: "Episode 2", exact: true })
      .waitFor();
    await page.evaluate(() =>
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "test",
          name: "Joe",
        }),
      ),
    );
    await page.reload();
    await page.locator("nav [data-nav=settings]").click();
    await click("Autoplay next episodes: On");
    await click("Reset track preferences");
    assert.equal(await saved(), null);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem(
              "wholphin-playback-options:https://jellyfin.test:user",
            ),
          ).autoplay,
      ),
      false,
      "Resetting track preferences preserves autoplay settings",
    );
    await page.locator("nav [data-nav=home]").click();
    await click("Episode 2");
    await click("Play from beginning");
    await started(++count);
    assert.equal(infos().at(-1).body.AudioStreamIndex, undefined);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, undefined);
    assert.equal(
      infos().at(-1).body.EnableDirectPlay,
      true,
      "Reset returns to normal default playback negotiation",
    );
    // Up Next uses playback time, supports cancellation, and gates unattended playback.
    await page.evaluate(() =>
      localStorage.setItem(
        "wholphin-playback-options:https://jellyfin.test:user",
        JSON.stringify({ autoplay: true, countdown: 30, stillWatching: 1 }),
      ),
    );
    await atTime(1780);
    await page.waitForSelector("#up-next:not([hidden])");
    assert.match(await page.locator("#up-next").textContent(), /Episode 3/);
    assert.match(
      await page.locator(".up-next-countdown").textContent(),
      /20 seconds/,
    );
    assert.match(
      await page.locator("#up-next img").getAttribute("src"),
      /Images/,
    );
    assert.match(await page.locator("#up-next").textContent(), /new signal/);
    await page.locator("#video").evaluate((v) => v.pause());
    const pausedStarts = starts().length;
    await page.waitForTimeout(100);
    assert.equal(starts().length, pausedStarts);
    assert.match(
      await page.locator(".up-next-countdown").textContent(),
      /20 seconds/,
    );
    await page.screenshot({ path: "/tmp/wholphin-up-next.png" });
    await atTime(1700);
    assert.equal(
      await page.locator("#up-next").isVisible(),
      false,
      "Seeking away hides countdown",
    );
    await atTime(1785);
    await page.locator("#up-next button").last().click();
    await atTime(1790);
    assert.equal(
      await page.locator("#up-next").isVisible(),
      false,
      "Cancel stays dismissed for this video",
    );
    const beforeCancel = starts().length;
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await page.waitForSelector("body:not(.is-playing)");
    assert.equal(
      starts().length,
      beforeCancel,
      "Cancel prevents automatic advance",
    );
    await page.locator("nav [data-nav=home]").click();
    await click("Episode 2");
    await click("Play from beginning");
    await started(beforeCancel + 1);
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("ended")));
    await page.waitForFunction(() =>
      document
        .querySelector("#up-next")
        .textContent.includes("Still watching?"),
    );
    assert.equal(
      starts().length,
      beforeCancel + 1,
      "No next playback before confirmation",
    );
    await page.screenshot({ path: "/tmp/wholphin-still-watching.png" });
    await page.locator("#up-next button").first().click();
    await started(beforeCancel + 2);
    assert.match(
      await page.locator("#playing-title").textContent(),
      /Episode 3/,
    );
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await page.locator("nav [data-nav=home]").click();
    failSeasons = true;
    await click("Test show");
    await page
      .getByRole("button", { name: "Retry seasons", exact: true })
      .waitFor();
    failSeasons = false;
    await click("Retry seasons");
    await page
      .locator(".season-choices button")
      .filter({ hasText: "Specials" })
      .waitFor();
    assert.deepEqual(
      await page
        .locator(".season-choices .card")
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
      ["Specials", "Season 1", "Season 2"],
    );
    await click("Season 1");
    await page.locator('[data-item="e2"]').waitFor();
    await page
      .getByRole("heading", { name: "Test show", exact: true })
      .waitFor();
    await click("All seasons");
    await click("Season 2");
    await page.locator('[data-item="e3"]').waitFor();
    assert.equal(
      await page.locator('.library-grid [data-item="e1"]').count(),
      0,
    );
    await page.locator('[data-item="e3"]').click();
    await page.keyboard.press("Escape");
    await page.locator('[data-item="e3"]').waitFor();
    await page
      .getByRole("heading", { name: "Test show", exact: true })
      .waitFor();
    await page.locator('[data-item="e3"]').click();
    await click("View seasons");
    await page
      .locator(".season-choices button")
      .filter({ hasText: "Specials" })
      .waitFor();
    await page.locator("nav [data-nav=home]").click();
    await click("Movie one");
    const subtitlePicker = page.getByRole("combobox", {
      name: "Subtitles before playback",
    });
    await subtitlePicker.click();
    await page.locator('#detail-subtitle-menu [data-index="12"]').click();
    const preselectedStart = starts().length;
    await click("Play from beginning");
    await started(preselectedStart + 1);
    await waitFor(() => infos().at(-1).body.SubtitleStreamIndex === 12);
    assert.equal(infos().at(-1).body.MediaSourceId, "source-m1");
    assert.equal(await page.locator("#stop").count(), 0);
    await page.locator("#toggle").focus();
    for (let i = 0; i < 6; i++) {
      if (
        await page
          .locator("#player-options")
          .evaluate((n) => n === document.activeElement)
      )
        break;
      await page.keyboard.press("ArrowLeft");
    }
    assert.equal(
      await page
        .locator("#player-options")
        .evaluate((n) => n === document.activeElement),
      true,
      "Options is reachable with the remote",
    );
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#player-tools").isVisible(), true);
    const oldSubtitlePicker = await subtitlePicker.elementHandle();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("player").hidden);
    await page.waitForFunction((node) => !node.isConnected, oldSubtitlePicker);
    await page.waitForFunction(
      () =>
        document.getElementById("detail-subtitles").textContent ===
        "Spanish subtitles",
    );
    await page
      .getByRole("combobox", { name: "Subtitles before playback" })
      .focus();
    await page.keyboard.press("Enter");
    await page.getByRole("listbox", { name: "Available subtitles" }).waitFor();
    assert.equal(await page.locator(":focus").getAttribute("data-index"), "12");
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.locator(":focus").getAttribute("data-index"), "9");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#detail-subtitle-menu").isHidden(), true);
    assert.equal(
      await page.locator("#detail-subtitles").textContent(),
      "Spanish subtitles",
    );

    await page
      .getByRole("combobox", { name: "Subtitles before playback" })
      .click();
    await page.locator('#detail-subtitle-menu [data-index="-1"]').click();
    const offStart = starts().length;
    await click("Play from beginning");
    await started(offStart + 1);
    await waitFor(() => infos().at(-1).body.SubtitleStreamIndex === -1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.getElementById("player").hidden);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Up Next artwork/description, playback-time countdown, seek dismissal, cancellation, Still watching confirmation; audio/subtitle indices, Off, exact-position and paused switching, failure recovery, chapters, menu Back, queue reorder/priority, stop-before-start, autoplay toggle/season boundary/finale, cancelled-switch race, remembered languages across indices/restarts, missing-language fallback, account isolation and preference reset",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
