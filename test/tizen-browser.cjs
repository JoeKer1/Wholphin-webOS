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
    const movie = {
      Id: "movie",
      Name: "Samsung test movie",
      Type: "Movie",
      MediaType: "Video",
      RunTimeTicks: 1200000000,
      Overview: "Example",
      ImageTags: { Primary: "poster" },
      UserData: { PlaybackPositionTicks: 300000000 },
      MediaSources: [{ Id: "source", MediaStreams: [] }],
    };
    await page.route("https://jellyfin.test/**", (r) => {
      const u = new URL(r.request().url());
      requests.push({
        path: u.pathname,
        auth: r.request().headers().authorization,
        body: r.request().postDataJSON(),
      });
      if (u.pathname.includes("/Images/")) return r.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
      let data = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        data = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      else if (u.pathname.endsWith("/Resume")) data = { Items: [movie, ...Array.from({ length: 4 }, (_, i) => ({ ...movie, Id: "other" + i, Name: "Other movie " + i }))] };
      else if (u.pathname.endsWith("/Latest")) data = [movie];
      else if (u.pathname.endsWith("/Items/movie")) data = movie;
      else if (u.pathname.endsWith("/PlaybackInfo"))
        data = {
          PlaySessionId: "play",
          MediaSources: [
            {
              Id: "source",
              TranscodingUrl: "/Videos/movie/master.m3u8?api_key=token",
              TranscodingContainer: "ts",
            },
          ],
        };
      return r.fulfill({ json: data });
    });
    await page.addInitScript(() => {
      const NativeObserver = window.IntersectionObserver;
      window.IntersectionObserver = function (callback, options) {
        return new NativeObserver(entries => callback(entries.map(e => ({ target: e.target, intersectionRatio: e.intersectionRatio }))), options);
      };
      delete window.AbortController;
      delete Promise.allSettled;
      delete Promise.prototype.finally;
      const supports = CSS.supports.bind(CSS);
      CSS.supports = (...a) =>
        a.join(":") === "display:grid" ? false : supports(...a);
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "token",
          name: "Joe",
        }),
      );
      window.testSamsung = {
        registered: [],
        state: "NONE",
        time: 0,
        calls: [],
      };
      const s = window.testSamsung;
      window.tizen = {
        tvinputdevice: { registerKey: (k) => s.registered.push(k) },
        application: {
          getCurrentApplication: () => ({ exit: () => (s.exited = true) }),
        },
      };
      window.webapis = {
        avplay: {
          getState: () => s.state,
          open: (url) => {
            s.url = url;
            s.state = "IDLE";
          },
          close: () => (s.state = "NONE"),
          stop: () => (s.state = "IDLE"),
          setListener: (l) => (s.listener = l),
          setDisplayRect: (...r) => (s.rect = r),
          setDisplayMethod: (m) => (s.method = m),
          prepareAsync: (ok) =>
            setTimeout(() => {
              s.state = "READY";
              ok();
            }, 10),
          getDuration: () => 120000,
          getStreamingProperty: () => "false",
          setSilentSubtitle() {},
          play: () => {
            s.state = "PLAYING";
          },
          pause: () => (s.state = "PAUSED"),
          seekTo: (ms, ok) => {
            s.time = ms;
            setTimeout(ok, 0);
          },
        },
      };
      setInterval(() => {
        if (s.state === "PLAYING") {
          s.time += 250;
          s.listener.oncurrentplaytime(s.time);
        }
      }, 250);
    });
    await page.goto(pathToFileURL(path.resolve("dist/tizen/index.html")).href);
    await page
      .getByRole("button", { name: "Samsung test movie", exact: true })
      .first()
      .waitFor();
    assert.equal(await page.evaluate(() => window.EmberPlatform.id), "tizen");
    assert.equal(await page.evaluate(() => typeof AbortController), "function");
    assert.equal(
      await page.evaluate(() => typeof Promise.allSettled),
      "function",
    );
    assert.equal(
      await page.evaluate(() => typeof Promise.prototype.finally),
      "function",
    );
    assert.equal(
      await page.evaluate(() =>
        document.documentElement.classList.contains("legacy-grid"),
      ),
      true,
    );
    await page.waitForFunction(() => document.querySelectorAll(".card img[src]").length >= 4);
    await page
      .getByRole("button", { name: "Samsung test movie", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: /^Resume/, exact: false })
      .first()
      .click();
    await page.waitForFunction(
      () =>
        window.testSamsung.state === "PLAYING" &&
        window.testSamsung.time >= 30000,
    );
    assert.ok(
      (await page.evaluate(() => window.testSamsung.url)).includes(
        "master.m3u8",
      ),
    );
    assert.equal(
      await page.locator("#player").evaluate((n) => n.hidden),
      false,
    );
    assert.ok(
      requests.some((r) => (r.auth || "").includes('Device="Samsung TV"')),
    );
    assert.ok(
      await page.evaluate(() =>
        window.testSamsung.registered.includes("MediaPlayPause"),
      ),
    );
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 10252, bubbles: true }),
      ),
    );
    assert.equal(await page.evaluate(() => window.testSamsung.state), "PAUSED");
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { keyCode: 10009, bubbles: true }),
      ),
    );
    await page.waitForFunction(()=>document.getElementById("controls").style.opacity === "0");
    await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent("keydown",{keyCode:10009,bubbles:true})));
    await page.locator("#player[hidden]").waitFor({ state: "attached" });
    assert.equal(await page.evaluate(() => window.testSamsung.state), "NONE");
    await page.waitForFunction(() => document.activeElement && document.activeElement.closest("main"));
    await page.locator("nav [data-nav=settings]").focus();
    await page.waitForFunction(() => document.querySelector("header").getBoundingClientRect().width >= 329);
    await page.locator("nav [data-nav=settings]").click();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Playback mode: Samsung AVPlay (Compatibility)",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page.locator('[aria-label^="Dolby Vision MP4"]').isVisible(),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: staged Tizen startup, old-engine polyfills, legacy layout, Samsung AVPlay resume, remote pause/Return, cleanup and Samsung-specific settings",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
