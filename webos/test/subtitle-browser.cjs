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
    let failText = false,
      holdText = false,
      releaseText = null;
    const item = {
      Id: "movie",
      Name: "Subtitle test",
      MediaType: "Video",
      Type: "Movie",
      RunTimeTicks: 18000000000,
      Chapters: [],
    };
    const source = {
      Id: "source",
      Container: "mp4",
      DefaultAudioStreamIndex: 2,
      DefaultSubtitleStreamIndex: 9,
      MediaStreams: [
        {
          Type: "Audio",
          Index: 2,
          Codec: "aac",
          Language: "eng",
          DisplayTitle: "English stereo",
        },
        {
          Type: "Subtitle",
          Index: 9,
          Codec: "srt",
          Language: "eng",
          DisplayTitle: "English text",
        },
        {
          Type: "Subtitle",
          Index: 12,
          Codec: "pgssub",
          Language: "spa",
          DisplayTitle: "Spanish image",
        },
        {
          Type: "Subtitle",
          Index: 14,
          Codec: "ass",
          Language: "jpn",
          DisplayTitle: "Japanese ASS",
        },
      ],
    };
    await page.route("https://jellyfin.test/**", async (route) => {
      const request = route.request(),
        u = new URL(request.url()),
        body = request.postDataJSON();
      requests.push({
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        body,
        method: request.method(),
      });
      let json = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        json = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      if (u.pathname.endsWith("/Latest")) json = { Items: [item] }.Items;
      if (u.pathname === "/Users/user/Items/movie") json = item;
      if (u.pathname === "/Items/movie/PlaybackInfo")
        json = {
          PlaySessionId: "session-" + requests.length,
          MediaSources: [
            {
              ...source,
              SupportsDirectPlay: !body || body.EnableDirectPlay,
              TranscodingUrl: "/Videos/movie/master.m3u8?api_key=mock",
            },
          ],
        };
      if (u.pathname.includes("/Subtitles/")) {
        if (holdText) await new Promise((r) => (releaseText = r));
        if (failText) return route.fulfill({ status: 404, json: {} });
        return route.fulfill({
          contentType: "text/vtt",
          body: 'WEBVTT\n\n00:01:39.000 --> 00:01:41.000\nHello &amp; &lt;img src=x onerror="window.subtitleXSS=1"&gt;\n\n00:01:42.000 --> 00:01:50.000\nNext subtitle',
        });
      }
      if (
        u.pathname.includes("/Sessions/") ||
        u.pathname.endsWith("/ActiveEncodings")
      )
        return route.fulfill({ status: 204 });
      return route.fulfill({ json });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "mock",
          name: "Test",
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
        readyState: {
          get() {
            return 4;
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
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    const infos = () =>
      requests.filter(
        (r) => r.path === "/Items/movie/PlaybackInfo" && r.method === "POST",
      );
    const starts = () => requests.filter((r) => r.path === "/Sessions/Playing");
    async function wait(fn) {
      for (let n = 0; n < 150; n++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Condition not met");
    }
    async function at(t) {
      await page.locator("#video").evaluate((v, t) => {
        v.currentTime = t;
        v.dispatchEvent(new Event("timeupdate"));
      }, t);
    }
    async function subs() {
      if (await page.locator("#player-tools").isHidden())
        await page.locator("#player-options").click();
      await page.locator("#subtitles").click();
    }
    async function appearance() {
      await subs();
      await page
        .locator("#playback-panel")
        .getByRole("button", { name: "Subtitle appearance", exact: true })
        .click();
      await page.locator("#playback-panel .subtitle-preview").waitFor();
    }
    await page.goto(
      pathToFileURL(path.join(process.env.APP_DIR || path.resolve(__dirname, "../app"), "index.html")).href,
    );
    await click("Subtitle test");
    await click("Play from beginning");
    await wait(() => starts().length === 1);
    await at(100);
    await page.locator("#toggle").click();
    await appearance();
    await click("Text size: 48");
    await page.screenshot({ path: "/tmp/wholphin-subtitle-appearance.png" });
    await click("Apply subtitle appearance");
    await wait(() => starts().length === 2);
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      -1,
      "Styled subtitles must be disabled in delivered video",
    );
    assert.equal(infos().at(-1).body.MediaSourceId, "source");
    assert.equal(await page.locator("#video").evaluate((v) => v.paused), true);
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      100,
    );
    await page.waitForFunction(
      () => !document.getElementById("subtitle-overlay").hidden,
    );
    assert.match(
      await page.locator("#subtitle-overlay").textContent(),
      /Hello & <img/,
    );
    assert.equal(await page.locator("#subtitle-overlay img").count(), 0);
    assert.equal(await page.evaluate(() => window.subtitleXSS), undefined);
    assert.equal(
      await page
        .locator("#subtitle-overlay span")
        .evaluate((n) => getComputedStyle(n).fontSize),
      "56px",
    );
    await appearance();
    await click("Text color: white");
    await click("Text background: None");
    await click("Text position: Bottom");
    await click("Subtitle delay: 0 s (+ later, − earlier)");
    await click("Apply subtitle appearance");
    assert.equal(
      starts().length,
      2,
      "Appearance-only changes must not restart playback",
    );
    assert.equal(
      await page
        .locator("#subtitle-overlay span")
        .evaluate((n) => getComputedStyle(n).color),
      "rgb(255, 255, 102)",
    );
    assert.equal(
      await page
        .locator("#subtitle-overlay span")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
      "rgba(0, 0, 0, 0.65)",
    );
    await at(99);
    await wait(() => page.locator("#subtitle-overlay").isHidden());
    await at(100);
    await wait(() => page.locator("#subtitle-overlay").isVisible());
    const bounds = await page.evaluate(() => ({
      subtitle: document
        .getElementById("subtitle-overlay")
        .getBoundingClientRect().bottom,
      controls: document.getElementById("controls").getBoundingClientRect().top,
    }));
    assert.ok(
      bounds.subtitle <= bounds.controls,
      "Subtitles stay above visible playback controls",
    );
    await page.screenshot({ path: "/tmp/wholphin-styled-subtitles.png" });
    await subs();
    await click("Off");
    await wait(() => starts().length === 3);
    assert.equal(await page.locator("#subtitle-overlay").isHidden(), true);
    await subs();
    await click("Spanish image");
    await wait(() => starts().length === 4);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, 12);
    await subs();
    await click("Japanese ASS");
    await wait(() => starts().length === 5);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, 14);
    assert.equal(
      requests.filter((r) => r.path.includes("/Subtitles/")).length,
      1,
      "Bitmap/ASS tracks must keep original server rendering",
    );
    failText = true;
    await subs();
    await click("English text");
    await wait(() => starts().length === 6);
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      9,
      "Failed extraction falls back to burn-in",
    );
    assert.match(
      await page.locator("#status").textContent(),
      /using server-rendered/,
    );
    failText = false;
    await appearance();
    await click("Text rendering: Styled on TV");
    await click("Apply subtitle appearance");
    assert.equal(
      starts().length,
      6,
      "Already server-rendered playback should continue without reload",
    );
    await appearance();
    await click("Text rendering: Server (original)");
    holdText = true;
    await click("Apply subtitle appearance");
    await wait(() => !!releaseText);
    await page.keyboard.press("Escape");
    await page.locator("#stop").click();
    releaseText();
    holdText = false;
    await page.waitForSelector("body:not(.is-playing)");
    await page.waitForTimeout(100);
    assert.equal(
      starts().length,
      6,
      "A late subtitle response must not restart stopped playback",
    );
    await page.locator("nav [data-nav=home]").click();
    await click("Subtitle test");
    await click("Play from beginning");
    await wait(() => starts().length === 7);
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      -1,
      "Saved styling applies to the next video's default text track",
    );
    await at(100);
    await wait(() => page.locator("#subtitle-overlay").isVisible());
    await page.locator("#stop").click();
    await page.locator("nav [data-nav=settings]").click();
    await click("Subtitle appearance");
    await page.locator("main .subtitle-preview").waitFor();
    await click("Reset appearance");
    await click("Apply subtitle appearance");
    const pref = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          "wholphin-subtitle-appearance:https://jellyfin.test:user",
        ),
      ),
    );
    assert.equal(pref.enabled, false);
    assert.equal(pref.size, 48);
    assert.equal(pref.delay, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: TV text styling, secure cue rendering, absolute resume/timing/delay, paused apply, live appearance changes without reload, Off, bitmap/ASS preservation, extraction fallback, cancellation and reset",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
