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
    let releaseViews, releaseResume;
    const views = new Promise((r) => (releaseViews = r)),
      resume = new Promise((r) => (releaseResume = r));
    let resumeCalls = 0,
      viewsStarted = false;
    const imageURLs = [];
    await page.route("https://jellyfin.test/**", async (route) => {
      const u = new URL(route.request().url());
      let json = { Items: [] };
      if (u.pathname.endsWith("/Views")) {
        viewsStarted = true;
        await views;
        json = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      }
      if (u.pathname.endsWith("/Resume")) {
        resumeCalls++;
        await resume;
        json = {
          Items: [
            {
              Id: "movie",
              Name: "Movie",
              Type: "Movie",
              ImageTags: { Primary: "tag" },
              Overview: '<img src=x onerror="window.injected=true">',
            },
          ],
        };
      }
      if (u.pathname.includes("/Images/")) imageURLs.push(u.href);
      await route.fulfill({ json });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          token: "test",
          user: "user",
          name: "Joe",
        }),
      );
      window.abortedRequests = [];
      const original = window.fetch;
      window.fetch = function (url, opts) {
        if (opts.signal)
          opts.signal.addEventListener("abort", () =>
            window.abortedRequests.push(url),
          );
        return original.apply(this, arguments);
      };
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    await page.waitForFunction(() => document.querySelector("#home-rows"));
    // Gate Views and Resume independently: both must start before either is released.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(viewsStarted);
    assert.equal(resumeCalls, 1, "Resume must start without waiting for Views");
    releaseViews();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    assert.ok(
      (await page.evaluate(() => window.abortedRequests)).some((u) =>
        u.includes("/Resume"),
      ),
      "Leaving Home aborts its pending request",
    );
    releaseResume();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await page.getByRole("button", { name: "Movie", exact: true }).waitFor();
    await page.getByRole("button", { name: "Movie", exact: true }).focus();
    assert.equal(await page.evaluate(() => window.injected), undefined);
    assert.equal(
      await page.locator("#preview-overview img").count(),
      0,
      "Metadata is text, never injected HTML",
    );
    await page.waitForFunction(
      () => !!document.querySelector(".card img[src]"),
    );
    assert.ok(
      (
        await page.locator(".card img[src]").first().getAttribute("src")
      ).includes("maxWidth=450"),
    );
    assert.equal(resumeCalls, 2, "Each Home visit sends one Resume request");
    console.log(
      "PASS: critical rows overlap library discovery, obsolete requests abort, metadata stays inert, and smaller lazy posters load",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
