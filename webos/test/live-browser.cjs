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
      requests = [],
      favorites = new Set(["c2"]),
      programmes = new Map();
    page.on("pageerror", (e) => errors.push(e.message));
    let programmeJobs = 0,
      maxJobs = 0,
      failChannel = false,
      failGuide = true,
      denyChannels = false;
    const channels = Array.from({ length: 83 }, (_, i) => ({
      Id: "c" + i,
      Name: "Station " + i,
      ChannelNumber: String(i + 1),
      ImageTags: { Primary: "logo" },
    }));
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        body = req.postDataJSON();
      requests.push({
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        body,
        method: req.method(),
      });
      let json = { Items: [] };
      if (u.pathname.includes("/Images/"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="48"><rect width="56" height="48" fill="#645270"/></svg>',
        });
      if (u.pathname.endsWith("/Views"))
        json = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      if (u.pathname === "/LiveTv/Channels") {
        if (denyChannels) return route.fulfill({ status: 403, json: {} });
        const start = Number(u.searchParams.get("StartIndex"));
        if (failChannel && start >= 24)
          return route.fulfill({ status: 503, json: {} });
        const selected =
          u.searchParams.get("IsFavorite") === "true"
            ? channels.filter((c) => favorites.has(c.Id))
            : channels;
        json = {
          Items: selected.slice(start, start + 24).map((c) => ({
            ...c,
            UserData: { IsFavorite: favorites.has(c.Id) },
          })),
          TotalRecordCount: selected.length,
        };
      }
      if (
        u.pathname === "/LiveTv/Programs" &&
        u.searchParams.has("ChannelIds")
      ) {
        const channel = u.searchParams.get("ChannelIds"),
          at = Date.parse(u.searchParams.get("MinEndDate"));
        programmeJobs++;
        maxJobs = Math.max(maxJobs, programmeJobs);
        await new Promise((r) => setTimeout(r, 50));
        programmeJobs--;
        if (channel === "c1" && failGuide)
          return route.fulfill({ status: 503, json: {} });
        const p = (suffix, start, end) => ({
          Id: channel + suffix,
          ChannelId: channel,
          ChannelName: channels.find((c) => c.Id === channel)?.Name,
          Name: suffix === "now" ? "Morning news" : "Afternoon show",
          StartDate: new Date(at + start * 60000).toISOString(),
          EndDate: new Date(at + end * 60000).toISOString(),
          Overview: "Programme summary",
        });
        const items =
          channel === "c3" ? [] : [p("now", -20, 10), p("next", 10, 40)];
        items.forEach((p) => programmes.set(p.Id, p));
        json = { Items: items };
      }
      if (u.pathname.startsWith("/LiveTv/Programs/"))
        json = programmes.get(u.pathname.split("/").at(-1));
      if (u.pathname.startsWith("/Users/user/FavoriteItems/")) {
        const id = u.pathname.split("/").at(-1);
        if (req.method() === "DELETE") favorites.delete(id);
        else favorites.add(id);
        return route.fulfill({ status: 204 });
      }
      if (/^\/Users\/user\/Items\/c\d+$/.test(u.pathname))
        json = {
          ...channels.find((c) => c.Id === u.pathname.split("/").at(-1)),
          Type: "TvChannel",
          MediaType: "Video",
        };
      if (u.pathname.endsWith("/PlaybackInfo"))
        json = {
          PlaySessionId: "live-session",
          MediaSources: [
            {
              Id: "source",
              LiveStreamId: "tuner",
              TranscodingUrl: "/Videos/live/master.m3u8?api_key=mock",
              MediaStreams: [],
            },
          ],
        };
      if (
        u.pathname.includes("/Sessions/") ||
        u.pathname.endsWith("/ActiveEncodings") ||
        u.pathname === "/LiveStreams/Close"
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
    await page.addInitScript(() => {
      const original = window.fetch;
      window.guideAborts = 0;
      window.fetch = function (url, options) {
        if (String(url).includes("/LiveTv/") && options && options.signal)
          options.signal.addEventListener("abort", () => window.guideAborts++);
        return original.apply(this, arguments);
      };
    });
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    async function wait(fn) {
      for (let n = 0; n < 200; n++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Condition not met");
    }
    const row = (id) =>
      page
        .locator(".guide-channel-row")
        .filter({ has: page.locator('[data-channel="' + id + '"]') })
        .first();
    await page.goto(
      pathToFileURL(
        path.join(
          process.env.APP_DIR || path.resolve(__dirname, "../app"),
          "index.html",
        ),
      ).href,
    );
    await page.locator("nav [data-nav=livetv]").click();
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    assert.equal(
      await page.locator("#guide-count").textContent(),
      "24 of 83 channels",
    );
    assert.equal(
      await page.locator(":focus").getAttribute("data-column"),
      "1",
      "Guide starts on the current programme",
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.locator(":focus").getAttribute("data-column"),
      "3",
      "Favorite remains reachable to the left",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(":focus").getAttribute("data-column"), "1");

    assert.ok(
      (await page.locator(".guide-channel-row").count()) < 20,
      "Guide DOM stays bounded",
    );
    assert.ok(
      requests.filter((r) => r.path === "/LiveTv/Programs").length < 24,
      "Offscreen guide data remains lazy",
    );
    assert.ok(maxJobs <= 2);
    await row("c1").getByRole("button", { name: "Retry guide" }).waitFor();
    failGuide = false;
    await row("c1").getByRole("button", { name: "Retry guide" }).click();
    await row("c1")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    assert.match(await row("c3").textContent(), /No programme listed/);
    await row("c0").getByRole("button", { name: "Favorite Station 0" }).click();
    await wait(() => favorites.has("c0"));
    await click("Channels: All");
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    assert.equal(
      await page.locator("#guide-count").textContent(),
      "2 of 2 channels",
    );
    await click("Channels: Favorites");
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    await row("c0")
      .getByRole("button", { name: /Afternoon show/ })
      .click();
    await page
      .getByRole("heading", { name: "Afternoon show", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "c0next",
      "Back restores programme focus",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("data-channel"),
      "c1",
      "D-pad moves within guide column",
    );
    await click("Later");
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .click();
    await page
      .getByRole("button", { name: "Watch channel now", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await click("Now");
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    assert.equal(
      await page
        .locator(".guide-channel-label button,.guide-channel-label[tabindex]")
        .count(),
      0,
      "Channel labels are not selectable",
    );
    const stationLayout = await page
      .locator(".guide-channel-label")
      .first()
      .evaluate((label) => {
        const image = label.querySelector("img").getBoundingClientRect(),
          text = label.querySelector("span").getBoundingClientRect(),
          row = label.closest(".guide-channel-row").getBoundingClientRect();
        return {
          above: image.bottom <= text.top,
          fits: text.bottom <= row.bottom,
          aligned:
            Math.abs(
              image.left + image.width / 2 - (text.left + text.width / 2),
            ) < 2,
        };
      });
    assert.deepEqual(
      stationLayout,
      { above: true, fits: true, aligned: true },
      "Channel logo sits naturally above the centred text within the existing row height",
    );
    await page.screenshot({ path: "/tmp/wholphin-live-guide.png" });
    await row("c3")
      .getByRole("button", { name: /Watch live/ })
      .click();
    await wait(() => requests.some((r) => r.path === "/Sessions/Playing"));
    assert.equal(await page.locator("#timeline").isVisible(), false);
    assert.equal(await page.locator("#rewind").isDisabled(), true);
    const closedBeforePreview = requests.filter(
      (r) => r.path === "/LiveStreams/Close",
    ).length;
    const startsBeforePreview = requests.filter(
      (r) => r.path === "/Sessions/Playing",
    ).length;
    const negotiationsBeforePreview = requests.filter((r) =>
      r.path.endsWith("/PlaybackInfo"),
    ).length;
    await page.locator("#video").evaluate((v) => {
      window.testLiveRange = { start: 0, end: 120 };
      Object.defineProperty(v, "seekable", {
        configurable: true,
        get() {
          const r = window.testLiveRange;
          return {
            length: r ? 1 : 0,
            start() {
              return r.start;
            },
            end() {
              return r.end;
            },
          };
        },
      });
      v.currentTime = 119;
      v.dispatchEvent(new Event("timeupdate"));
    });
    assert.equal(
      await page.locator("#timeline").evaluate((x) => x.hidden),
      false,
      "Timeline exposed for a usable live buffer",
    );
    await page.locator("#rewind").evaluate((x) => x.click());
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      89,
    );
    await page
      .locator("#video")
      .evaluate((v) => v.dispatchEvent(new Event("timeupdate")));
    assert.ok((await page.locator("#clock").textContent()).includes("Live"));
    await page.locator("#forward").evaluate((x) => x.click());
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      119,
      "Forward clamps at live edge",
    );
    await page.locator("#timeline").evaluate((x) => {
      x.value = 40;
      x.dispatchEvent(new Event("input"));
    });
    assert.equal(
      await page.locator("#video").evaluate((v) => v.currentTime),
      40,
    );
    await page.locator("#video").evaluate((v) => {
      window.testLiveRange = { start: 70, end: 100 };
      v.currentTime = 80;
      v.dispatchEvent(new Event("timeupdate"));
    });
    await page.locator("#rewind").evaluate((x) => x.click());
    assert.ok(
      Math.abs(
        (await page.locator("#video").evaluate((v) => v.currentTime)) - 70.1,
      ) < 0.01,
      "Rewind clamps to sliding buffer start",
    );
    await page.locator("#video").evaluate((v) => {
      window.testLiveRange = null;
      v.dispatchEvent(new Event("timeupdate"));
    });
    assert.equal(
      await page.locator("#timeline").evaluate((x) => x.hidden),
      true,
      "No seeking without a buffer",
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.body.classList.contains("live-preview"),
    );
    assert.equal(await page.locator("#player").isVisible(), true);
    assert.equal(
      await page.locator("#next-video").evaluate((x) => x.hidden),
      true,
      "Next video hidden for Live TV",
    );
    assert.equal(
      await page.locator("#video").evaluate((v) => v.paused),
      false,
      "Live audio/video continue in preview",
    );
    assert.equal(
      await page.locator(":focus").getAttribute("data-channel"),
      "c3",
    );
    assert.equal(
      requests.filter((r) => r.path === "/LiveStreams/Close").length,
      closedBeforePreview,
      "Back keeps the tuner open",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("data-channel"),
      "c4",
    );
    assert.equal(
      requests.filter((r) => r.path.endsWith("/PlaybackInfo")).length,
      negotiationsBeforePreview,
      "Browsing does not switch channels",
    );
    await page.waitForFunction(
      () =>
        document.getElementById("live-browse-title").textContent ===
        "Morning news",
    );
    assert.match(
      await page.locator("#live-browse-metadata").textContent(),
      /Station 4/,
    );
    assert.equal(
      await page.locator("#live-browse-overview").textContent(),
      "Programme summary",
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#live-browse-title").textContent(),
      "Afternoon show",
    );
    assert.equal(
      await page.locator("#live-preview-caption").textContent(),
      "Station 3",
      "Browsing details do not change the channel being watched",
    );

    assert.equal(await page.locator("header").isVisible(), true);
    assert.equal(
      await page.locator("#live-preview-caption").textContent(),
      "Station 3",
    );
    assert.equal(await page.locator("#live-preview-caption").isVisible(), true);
    const previewBounds = await page.locator("#player").boundingBox();
    const guideBounds = await page.locator("#main").boundingBox();
    assert.ok(
      previewBounds.y + previewBounds.height <= guideBounds.y,
      "Preview does not cover programme rows while scrolling",
    );
    if (process.env.APP_DIR && process.env.APP_DIR.includes("dist/tizen")) {
      const before = await page.locator("#live-browse-info").boundingBox();
      for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowDown");
      const after = await page.locator("#live-browse-info").boundingBox();
      assert.equal(after.y, before.y, "Description stays pinned while channel focus scrolls");
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      assert.ok(await page.locator("#main").evaluate(n => n.scrollTop > 0));
      const videoAfter = await page.locator("#player").boundingBox();
      assert.equal(videoAfter.y, previewBounds.y);
      for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowUp");
    }
    await page.screenshot({ path: "/tmp/wholphin-live-preview.png" });
    await row("c4")
      .getByRole("button", { name: /Morning news/ })
      .click();
    await wait(
      () =>
        requests.filter((r) => r.path === "/Sessions/Playing").length ===
        startsBeforePreview + 1,
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("live-preview")),
      false,
      "Selecting a different channel opens fullscreen",
    );
    assert.equal(
      requests.filter((r) => r.path === "/LiveStreams/Close").length,
      closedBeforePreview + 1,
      "Switching releases the previous tuner",
    );
    const startsAfterSwitch = requests.filter(
      (r) => r.path === "/Sessions/Playing",
    ).length;
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("is-playing")),
      true,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.body.classList.contains("live-preview"),
    );
    await click("Return to fullscreen");
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("is-playing")),
      true,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.body.classList.contains("live-preview"),
    );
    await row("c4")
      .getByRole("button", { name: /Morning news/ })
      .click();
    assert.equal(
      requests.filter((r) => r.path === "/Sessions/Playing").length,
      startsAfterSwitch,
      "Returning to the playing channel reuses playback",
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("is-playing")),
      true,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.body.classList.contains("live-preview"),
    );
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 413, bubbles: true }),
      ),
    );
    await wait(
      () =>
        requests.filter((r) => r.path === "/LiveStreams/Close").length ===
        closedBeforePreview + 2,
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((n) => n.classList.contains("live-preview")),
      false,
    );
    assert.ok(
      await page.locator("#guide-channels").isVisible(),
      "Stop returns to guide for channel without EPG",
    );
    failChannel = true;
    await page.locator("#main").evaluate((n) => {
      n.scrollTop = n.scrollHeight;
      n.dispatchEvent(new Event("scroll"));
    });
    await page
      .getByRole("button", { name: "Retry channels", exact: true })
      .waitFor();
    failChannel = false;
    await click("Retry channels");
    await wait(() =>
      page
        .locator("#guide-count")
        .textContent()
        .then((t) => t.startsWith("48")),
    );
    await page.locator("#main").evaluate((n) => {
      n.scrollTop = n.scrollHeight;
      n.dispatchEvent(new Event("scroll"));
    });
    await wait(() =>
      page
        .locator("#guide-count")
        .textContent()
        .then((t) => t.startsWith("72")),
    );
    assert.ok((await page.locator(".guide-channel-row").count()) < 20);
    await page.locator("#main").evaluate((n) => {
      n.scrollTop = n.scrollHeight;
      n.dispatchEvent(new Event("scroll"));
    });
    await wait(() =>
      page
        .locator("#guide-count")
        .textContent()
        .then((t) => t.startsWith("83")),
    );
    await page.locator("nav [data-nav=home]").click();
    denyChannels = true;
    await page.locator("nav [data-nav=livetv]").click();
    await page
      .getByText("Live TV is unavailable for this account.", { exact: true })
      .waitFor();
    denyChannels = false;
    await click("Retry channels");
    await row("c0")
      .getByRole("button", { name: /Morning news/ })
      .waitFor();
    assert.ok(
      await page.evaluate(() => window.guideAborts > 0),
      "Leaving guide cancels its pending requests",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Live TV now/next, lazy bounded guide, two-request limit, row/channel retries, favorites, future programme labels, D-pad and Back focus, continuous channels, no-EPG playback/tuner cleanup and denied access",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
