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
      calls = [],
      errors = [];
    let encoderFails = false,
      refuseTranscode = false;
    page.on("pageerror", (e) => errors.push(e.message));
    const episode = (id, index, name) => ({
      Id: id,
      Type: "Episode",
      SeriesId: "show",
      SeriesName: "The Daily Show",
      ParentLogoItemId: "show",
      ParentIndexNumber: 31,
      IndexNumber: index,
      Name: name,
      PremiereDate: "2026-10-28T12:00:00Z",
      RunTimeTicks: 19800000000,
      UserData: { PlaybackPositionTicks: 12600000000 },
      ImageTags: { Primary: "tag" },
    });
    const first = episode("ep1", 121, "David Byrne"),
      second = episode("ep2", 117, "Taika Waititi");
    const programme = {
      Id: "programme",
      Type: "Program",
      Name: "Saturday Morning Gifts",
      ChannelName: "QVC",
      ChannelId: "channel",
      StartDate: new Date(Date.now() - 3600000).toISOString(),
      EndDate: new Date(Date.now() + 3600000).toISOString(),
      Overview: "Ideas for everyone.",
      ImageTags: { Primary: "tag" },
    };
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        body = req.postDataJSON();
      calls.push({ path: u.pathname, body, method: req.method() });
      if (u.pathname.includes("/Images/")) {
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="100"><text x="0" y="70" fill="white" font-size="50">The Daily Show</text></svg>',
        });
        return;
      }
      if (u.pathname.endsWith("/Views")) {
        await route.fulfill({
          json: {
            Items: [
              { Id: "live", Name: "Live TV", CollectionType: "livetv" },
              { Id: "movies", Name: "Movies", CollectionType: "movies" },
            ],
          },
        });
        return;
      }
      if (u.pathname.endsWith("/Resume")) {
        await route.fulfill({ json: { Items: [first, second] } });
        return;
      }
      if (u.pathname === "/Shows/NextUp") {
        await route.fulfill({
          json: { Items: [episode("next", 122, "Next episode")] },
        });
        return;
      }
      if (u.pathname === "/LiveTv/Programs") {
        await route.fulfill({ json: { Items: [programme] } });
        return;
      }
      if (u.pathname === "/LiveTv/Programs/programme") {
        await route.fulfill({ json: programme });
        return;
      }
      if (u.pathname === "/Users/user/Items/channel") {
        await route.fulfill({
          json: {
            Id: "channel",
            Name: "QVC",
            Type: "TvChannel",
            MediaType: "Video",
          },
        });
        return;
      }
      if (u.pathname === "/Items/channel/PlaybackInfo") {
        await route.fulfill({
          json: {
            PlaySessionId: "live-session",
            MediaSources: [
              {
                Id: "source",
                LiveStreamId: "tuner",
                SupportsDirectPlay: true,
                IsInfiniteStream: true,
                ...(refuseTranscode
                  ? {}
                  : { TranscodingUrl: "/Videos/channel/master.m3u8" }),
              },
            ],
          },
        });
        return;
      }
      if (u.pathname === "/Videos/ActiveEncodings") {
        await route.fulfill(
          encoderFails
            ? { status: 500, body: "encoder cleanup failed" }
            : { status: 204 },
        );
        return;
      }
      if (
        u.pathname === "/LiveStreams/Close" ||
        u.pathname.startsWith("/Sessions/")
      ) {
        await route.fulfill({ status: 204 });
        return;
      }
      if (u.pathname.endsWith("/Latest")) {
        await route.fulfill({ json: [] });
        return;
      }
      if (u.pathname.endsWith("/Items")) {
        await route.fulfill({ json: { Items: [] } });
        return;
      }
      await route.fulfill({ json: first });
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
            return this.dataset.testSrc || "";
          },
          set(v) {
            this.dataset.testSrc = v;
          },
        },
        readyState: {
          get() {
            return 4;
          },
        },
        paused: {
          get() {
            return false;
          },
        },
        duration: {
          get() {
            return Infinity;
          },
        },
        seeking: {
          get() {
            return false;
          },
        },
      });
      p.load = function () {
        if (this.dataset.testSrc)
          setTimeout(() => this.dispatchEvent(new Event("loadedmetadata")), 0);
      };
      p.play = function () {
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        this.dispatchEvent(new Event("timeupdate"));
        return Promise.resolve();
      };
      p.pause = function () {};
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    await page
      .getByRole("button", { name: "David Byrne", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("[data-row=continue] .card").count(),
      2,
      "Keep both in-progress Daily Show episodes",
    );
    assert.equal(
      await page.locator("#preview-episode").textContent(),
      "David Byrne",
    );
    assert.ok(
      (await page.locator("#preview-meta").textContent()).includes("S31 E121"),
    );
    assert.ok(
      (await page.locator("#preview-meta").textContent()).includes("Ends at"),
    );
    await page.locator("#preview-logo:not([hidden])").waitFor();
    assert.ok(
      (await page.locator("#preview-logo").getAttribute("src")).includes(
        "/Items/show/Images/Logo",
      ),
    );
    assert.equal(
      await page
        .locator("[data-row=continue] .episode-badge")
        .first()
        .textContent(),
      "E121",
    );
    assert.equal(await page.locator("#profile-initial").textContent(), "J");
    const liveRow = page.locator("[data-row=live]");
    await liveRow
      .getByRole("button", { name: programme.Name, exact: true })
      .waitFor();
    await liveRow
      .getByRole("button", { name: programme.Name, exact: true })
      .focus();
    assert.ok(
      (await page.locator("#preview-meta").textContent()).includes("QVC"),
    );
    assert.equal(
      await liveRow
        .locator(".art")
        .evaluate((el) =>
          Math.round(
            (el.getBoundingClientRect().width /
              el.getBoundingClientRect().height) *
              100,
          ),
        ),
      178,
    );
    await liveRow
      .getByRole("button", { name: programme.Name, exact: true })
      .click();
    await page.getByRole("button", { name: "Watch live", exact: true }).click();
    await page.waitForFunction(
      () => document.getElementById("clock").textContent === "Live",
    );
    assert.equal(await page.locator("#rewind").isDisabled(), true);
    assert.equal(
      calls.find((c) => c.path === "/Items/channel/PlaybackInfo").body
        .EnableDirectPlay,
      false,
    );
    const wait = async (check) => {
      for (let i = 0; i < 100; i++) {
        if (check()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Timed out waiting for live session");
    };
    await wait(() => calls.some((c) => c.path === "/Sessions/Playing"));
    assert.equal(
      calls.find((c) => c.path === "/Sessions/Playing").body.CanSeek,
      false,
    );
    assert.equal(
      calls.find((c) => c.path === "/Sessions/Playing").body.LiveStreamId,
      "tuner",
    );
    encoderFails = true;
    await page
      .getByRole("button", { name: "Stop playback", exact: true })
      .click();
    await wait(() => calls.some((c) => c.path === "/LiveStreams/Close"));
    assert.equal(
      calls.find((c) => c.path === "/LiveStreams/Close").body.LiveStreamId,
      "tuner",
      "Release tuner even if encoder cleanup fails",
    );
    refuseTranscode = true;
    encoderFails = false;
    await page.getByRole("button", { name: "Watch live", exact: true }).click();
    await wait(
      () => calls.filter((c) => c.path === "/LiveStreams/Close").length === 2,
    );
    assert.equal(
      await page.locator("#player").isHidden(),
      true,
      "Do not attempt an unsupported live direct stream",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: title logos, episode subtitle/date/finish time, episode badges, profile initial, combined resume rows, landscape live programmes, channel negotiation and tuner cleanup",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
