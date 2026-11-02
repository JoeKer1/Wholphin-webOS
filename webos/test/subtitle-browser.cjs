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
      // Exercise explicit server-rendering opt-out and its fallback path.
      localStorage.setItem("wholphin-subtitle-appearance:https://jellyfin.test:user", JSON.stringify({enabled:false,delay:5}));
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
    async function config(kind) {
      if (await page.locator("#playback-panel").isVisible())
        await page.keyboard.press("Escape");
      if (await page.locator("#player-tools").isHidden())
        await page.locator("#player-options").click();
      await page.locator("#subtitle-" + kind).click();
    }
    async function chooseAppearance(name, value) {
      await page.getByRole("button", {name: new RegExp("^" + name + ": ")}).click();
      await page.getByRole("radio", {name: value, exact:true}).click();
    }
    async function appearance() {
      await config("appearance");
      await page.locator("#playback-panel .subtitle-preview").waitFor();
    }
    await page.goto(
      pathToFileURL(
        path.join(
          process.env.APP_DIR || path.resolve(__dirname, "../app"),
          "index.html",
        ),
      ).href,
    );
    await click("Subtitle test");
    const selector = page.locator("#detail-subtitles");
    assert.equal(await selector.evaluate(n => getComputedStyle(n.previousElementSibling).display), "block");
    assert.ok((await selector.boundingBox()).height >= 56, "Movie subtitle selector should be a full-size control");
    await page.screenshot({path:"/private/tmp/ember-movie-subtitle-selector.png"});
    await click("Play from beginning");
    await wait(() => starts().length === 1);
    await at(100);
    await page.locator("#toggle").click();
    await subs();
    await page.screenshot({path:"/private/tmp/ember-subtitle-menu-before.png"});
    await appearance();
    await chooseAppearance("Text size", "Extra large");
    await page.screenshot({ path: "/tmp/wholphin-subtitle-appearance.png" });
    await click("Save appearance");
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
    await subs();
    assert.equal(await page.locator(":focus").getAttribute("aria-label"),"English · SRT");
    await config("timing");
    await at(100.75);
    await click("Earlier 0.5 s");
    await page.waitForFunction(()=>document.getElementById("subtitle-overlay").hidden);
    assert.match(await page.locator(".subtitle-timing-value").textContent(),/0.5 s earlier/);
    const timing = await page.evaluate(() => JSON.parse(localStorage.getItem("wholphin-subtitle-timing:https://jellyfin.test:user")));
    assert.equal(Object.values(timing)[0].delay, -0.5);
    assert.equal(JSON.parse(Object.keys(timing)[0])[0], "movie");

    assert.equal(starts().length,2,"Timing changes must not restart the video");
    assert.equal(await page.locator("#video").evaluate(v=>v.paused),true);
    await click("Reset timing");
    await page.waitForFunction(()=>!document.getElementById("subtitle-overlay").hidden);
    await at(99.25);
    await click("Later 0.5 s");
    await page.waitForFunction(()=>document.getElementById("subtitle-overlay").hidden);
    await page.screenshot({path:"/private/tmp/ember-subtitle-timing.png"});
    await click("Reset timing");
    await at(100);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(":focus").getAttribute("id"),"subtitle-timing");
    await subs();
    await page.screenshot({path:"/private/tmp/ember-subtitle-menu-after.png"});
    await click("Close");
    await appearance();
    await chooseAppearance("Text color", "Yellow");
    await chooseAppearance("Background", "Translucent black");
    await chooseAppearance("Position", "Raised");
    await click("Save appearance");
    await config("timing");
    await click("Later 0.5 s");
    await page.keyboard.press("Escape");
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
    await wait(() => page.locator("#playback-panel").isHidden());
    assert.equal(starts().length, 2, "Turning off local subtitles does not restart video");
    assert.equal(await page.locator("#subtitle-overlay").isHidden(), true);
    await subs();
    await click("Spanish · PGS");
    await wait(() => starts().length === 3);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, 12);
    await subs();
    await config("timing");
    assert.equal(await page.getByRole("button",{name:"Earlier 0.5 s",exact:true}).isDisabled(),true);
    await page.keyboard.press("Escape");
    await subs();
    await click("Japanese · ASS");
    await wait(() => starts().length === 4);
    assert.equal(infos().at(-1).body.SubtitleStreamIndex, -1, "ASS is extracted as WebVTT instead of burned in");
    assert.equal(
      requests.filter((r) => r.path.includes("/Subtitles/")).length,
      2,
      "SRT and ASS use soft subtitles; bitmap tracks keep server rendering",
    );
    failText = true;
    await subs();
    await click("English · SRT");
    await wait(() => starts().length === 5);
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
    await chooseAppearance("Subtitle style", "Original");
    await click("Save appearance");
    assert.equal(
      starts().length,
      5,
      "Already server-rendered playback should continue without reload",
    );
    await appearance();
    await chooseAppearance("Subtitle style", "Custom");
    holdText = true;
    await click("Save appearance");
    await wait(() => !!releaseText);
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    releaseText();
    holdText = false;
    await page.waitForSelector("body:not(.is-playing)");
    await page.waitForTimeout(100);
    assert.equal(
      starts().length,
      5,
      "A late subtitle response must not restart stopped playback",
    );
    await page.locator("nav [data-nav=home]").click();
    await click("Subtitle test");
    await click("Play from beginning");
    await wait(() => starts().length === 6);
    assert.equal(
      infos().at(-1).body.SubtitleStreamIndex,
      -1,
      "Saved styling applies to the next video's default text track",
    );
    await at(100);
    await wait(() => page.locator("#subtitle-overlay").isVisible());
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await page.locator("nav [data-nav=settings]").click();
    await click("Subtitle appearance");
    await page.locator("main .subtitle-preview").waitFor();
    await click("Reset appearance");
    await click("Save appearance");
    const pref = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          "wholphin-subtitle-appearance:https://jellyfin.test:user",
        ),
      ),
    );
    assert.equal(pref.enabled, true);
    assert.equal(pref.size, 48);
    assert.equal(pref.delay, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: TV text styling, secure cue rendering, absolute resume/timing/delay, paused apply, live appearance changes without reload, Off, bitmap fallback/ASS extraction, extraction fallback, cancellation and reset",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
