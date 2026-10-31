// Optional regression test. Media and Jellyfin are simulated; no real decoding is tested.
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
    });
    const errors = [],
      requests = [];
    let transcoding = false,
      detailRequests = 0;
    const movie = {
      Id: "movie",
      Name: "Test movie",
      MediaType: "Video",
      RunTimeTicks: 18000000000,
      UserData: { PlaybackPositionTicks: 600000000 },
    };
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        body = req.postDataJSON();
      requests.push({ path: url.pathname, body, query: url.searchParams });
      let data;
      if (url.pathname.endsWith("/AuthenticateByName"))
        data = { AccessToken: "mock-token", User: { Id: "user" } };
      else if (url.pathname.endsWith("/Views"))
        data = { Items: [{ Id: "library", Name: "Movies" }] };
      else if (url.pathname.endsWith("/Latest")) data = [movie];
      else if (url.pathname.endsWith("/Items/movie")) {
        detailRequests++;
        data = movie;
      } else if (url.pathname.endsWith("/PlaybackInfo"))
        data = {
          PlaySessionId: "session-" + requests.length,
          MediaSources: [
            transcoding
              ? {
                  Id: "source",
                  TranscodingUrl:
                    "/Videos/movie/master.m3u8?api_key=mock-token",
                }
              : { Id: "source", SupportsDirectPlay: true },
          ],
        };
      else if (url.pathname.includes("/Sessions/")) {
        if (url.pathname.endsWith("/Stopped"))
          movie.UserData.PlaybackPositionTicks = body.PositionTicks;
        await route.fulfill({ status: 204 });
        return;
      } else if (url.pathname.endsWith("/ActiveEncodings")) {
        await route.fulfill({ status: 204 });
        return;
      } else data = { Items: [movie], TotalRecordCount: 1 };
      await route.fulfill({ json: data });
    });
    await page.addInitScript(() => {
      const proto = HTMLMediaElement.prototype;
      Object.defineProperties(proto, {
        src: {
          get() {
            return this.dataset.mockSrc || "";
          },
          set(value) {
            this.dataset.mockSrc = value;
            this._time = 0;
            this._loaded = false;
            this._ignoredSeek = value.includes(".m3u8") ? 1 : 0;
          },
        },
        currentTime: {
          get() {
            return this._time || 0;
          },
          set(value) {
            if (window.refuseSeek) return;
            if (this._ignoredSeek > 0) {
              this._ignoredSeek--;
              return;
            }
            this._time = value;
            setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
          },
        },
        duration: {
          get() {
            return this._loaded ? 1800 : NaN;
          },
        },
        readyState: {
          get() {
            return this._loaded ? 4 : 0;
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
      proto.load = function () {
        this._time = 0;
        if (this.dataset.mockSrc)
          setTimeout(() => {
            this._loaded = true;
            this.dispatchEvent(new Event("loadedmetadata"));
          }, 0);
      };
      proto.play = function () {
        this._playing = true;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      proto.pause = function () {
        this._playing = false;
        this.dispatchEvent(new Event("pause"));
      };
    });
    await page.addInitScript(() => {
      if (
        !localStorage.getItem(
          "wholphin-home-options:https://jellyfin.test:user",
        )
      )
        localStorage.setItem(
          "wholphin-home-options:https://jellyfin.test:user",
          JSON.stringify({
            combine: false,
            favorites: true,
            collections: true,
            playlists: true,
          }),
        );
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    await page.getByLabel("Server URL").fill("https://jellyfin.test");
    await page.getByLabel("Username").fill("test");
    await page.getByLabel("Password").fill("password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator("#home-rows .card").first().waitFor();
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Test movie",
    );
    assert.equal(
      await page.locator("#preview-title").textContent(),
      "Test movie",
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Home",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Test movie",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .locator(":focus")
        .evaluate(
          (el) => el.closest("section").querySelector("h2").textContent,
        ),
      "Next up",
    );
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await page
      .getByRole("heading", { name: "Favorites", exact: true })
      .waitFor();
    await waitUntilFavoriteRequest();
    async function waitUntilFavoriteRequest() {
      await page
        .getByRole("button", { name: "Test movie", exact: true })
        .waitFor();
      assert.ok(requests.some((r) => r.query.get("IsFavorite") === "true"));
    }
    await page.getByRole("button", { name: "Movies", exact: true }).click();
    await page.getByRole("button", { name: "Test movie", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).waitFor();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator(":focus").textContent(),
      "Play from beginning",
    );
    const started = () =>
      requests.filter((r) => r.path === "/Sessions/Playing");
    const stopped = () =>
      requests.filter((r) => r.path === "/Sessions/Playing/Stopped");
    async function waitFor(check) {
      await require("node:timers/promises").setTimeout(20);
      for (let i = 0; i < 250; i++) {
        if (check()) return;
        await require("node:timers/promises").setTimeout(20);
      }
      throw new Error("Timed out waiting for mocked session state");
    }
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await waitFor(() => started().length === 1);
    assert.equal(started()[0].body.PositionTicks, 600000000);
    assert.deepEqual(
      await page.locator("#video").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
      { x: 0, y: 0, width: 1920, height: 1080 },
    );
    await page
      .getByRole("button", { name: "Fill screen", exact: true })
      .click();
    assert.equal(
      await page
        .locator("#video")
        .evaluate((el) => getComputedStyle(el).objectFit),
      "cover",
    );
    await page.getByRole("button", { name: "Fit video", exact: true }).click();
    await page.evaluate(() => {
      document.getElementById("video").currentTime = 90;
    });
    let details = detailRequests;
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await waitFor(() => stopped().length === 1 && detailRequests > details);
    assert.equal(stopped()[0].body.PositionTicks, 900000000);
    // Simulate a newer bookmark from another client after the details screen loaded.
    movie.UserData.PlaybackPositionTicks = 1200000000;
    transcoding = true;
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await waitFor(() => started().length === 2);
    assert.equal(started()[1].body.PositionTicks, 1200000000);
    assert.equal(
      await page.locator("#video").evaluate((el) => el.currentTime),
      120,
    );
    const info = requests
      .filter((r) => r.path.endsWith("/PlaybackInfo"))
      .at(-1);
    assert.equal(info.query.get("StartTimeTicks"), "1200000000");
    assert.equal(info.body.StartTimeTicks, 1200000000);
    await page.evaluate(() => {
      document.getElementById("video").currentTime = 135;
    });
    details = detailRequests;
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await waitFor(() => stopped().length === 2 && detailRequests > details);
    // HLS has an absolute media timeline: never add the requested 120 seconds again.
    assert.equal(stopped()[1].body.PositionTicks, 1350000000);
    assert.equal(movie.UserData.PlaybackPositionTicks, 1350000000);
    assert.ok(requests.some((r) => r.path === "/Videos/ActiveEncodings"));
    // A rejected initial seek must not report zero or overwrite the saved bookmark.
    await page.evaluate(() => {
      window.refuseSeek = true;
    });
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.locator("#player:not([hidden])").waitFor();
    await page.waitForFunction(
      () => document.getElementById("video").readyState === 4,
    );
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await page.locator("#player[hidden]").waitFor({ state: "attached" });
    assert.equal(started().length, 2);
    assert.equal(stopped().length, 2);
    assert.equal(movie.UserData.PlaybackPositionTicks, 1350000000);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("heading", { name: "Movies", exact: true }).waitFor();
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Test movie",
    );
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("test");
    await page.locator("form button").click();
    await page
      .getByRole("button", { name: "Test movie", exact: true })
      .waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("wholphin-session")),
      null,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: direct and HLS resume, delayed seek retry, fresh server bookmarks, no double offset, failed seek preserves bookmark, fullscreen, navigation, search and sign out",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
