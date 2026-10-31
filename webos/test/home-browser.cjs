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
      images = [],
      calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const libraries = [
      { Id: "movies", Name: "Movies", CollectionType: "movies" },
      { Id: "tv", Name: "TV", CollectionType: "tvshows" },
      { Id: "kids", Name: "Kids Shows", CollectionType: "tvshows" },
    ];
    const item = (id, name) => ({
      Id: id,
      Name: name,
      MediaType: "Video",
      Type: "Movie",
      ImageTags: { Primary: "tag" },
      Overview: "An item description.",
    });
    const movies = Array.from({ length: 24 }, (_, i) =>
      item("movie" + i, "Movie " + i),
    );
    let nextFails = true,
      failViews = false,
      releaseMovies;
    const moviesGate = new Promise((resolve) => {
      releaseMovies = resolve;
    });
    await page.route("https://jellyfin.test/**", async (route) => {
      const u = new URL(route.request().url());
      calls.push({ path: u.pathname, parent: u.searchParams.get("ParentId") });
      if (u.pathname.includes("/Images/")) {
        images.push(u.pathname);
        await route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
            "base64",
          ),
        });
        return;
      }
      if (u.pathname.endsWith("/Views")) {
        await route.fulfill(
          failViews
            ? { status: 503, body: "Unavailable" }
            : { json: { Items: libraries } },
        );
        return;
      }
      if (u.pathname.endsWith("/Resume")) {
        await route.fulfill({
          json: { Items: [item("resume", "Resume movie")] },
        });
        return;
      }
      if (u.pathname === "/Shows/NextUp") {
        await route.fulfill(
          nextFails
            ? { status: 503, body: "Unavailable" }
            : { json: { Items: [item("next", "Next episode")] } },
        );
        return;
      }
      if (u.pathname.endsWith("/Latest")) {
        assert.ok(
          u.searchParams.get("ParentId"),
          "Latest must always target a specific library",
        );
        if (u.searchParams.get("ParentId") === "movies") await moviesGate;
        await route.fulfill({
          json:
            u.searchParams.get("ParentId") === "movies"
              ? movies
              : [item("tvitem", "TV show")],
        });
        return;
      }
      if (u.pathname.endsWith("/Items")) {
        await route.fulfill({ json: { Items: [] } });
        return;
      }
      await route.fulfill({ json: item("resume", "Resume movie") });
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "test-token",
        }),
      ),
    );
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
    await page
      .getByRole("button", { name: "Resume movie", exact: true })
      .waitFor();
    assert.equal(
      await page.locator("#preview-title").textContent(),
      "Resume movie",
    );
    await page
      .getByRole("button", { name: "Retry loading Next up", exact: true })
      .waitFor();
    assert.equal(await page.locator("#status").textContent(), "");
    for (const label of [
      "Recently added in Movies",
      "Recently added in TV",
      "Recently added in Kids Shows",
    ])
      await page.getByRole("heading", { name: label, exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-row="latest:movies"]')
          .getAttribute("aria-busy") === "true",
    );
    assert.equal(
      await page.locator("#home-rows .card").count(),
      1,
      "Slow row must not block Continue watching",
    );
    releaseMovies();
    const movieRow = page.locator('[data-row="latest:movies"]');
    await movieRow.locator(".card").first().waitFor({ state: "attached" });
    assert.equal(
      await movieRow.locator("img[src]").count(),
      0,
      "Offscreen posters must not issue image requests",
    );
    await movieRow
      .getByRole("button", { name: "Movie 0", exact: true })
      .focus();
    await movieRow.locator("img[src]").first().waitFor({ state: "attached" });
    assert.ok(
      (await movieRow.locator("img[data-src]").count()) > 0,
      "Remaining horizontal posters must stay lazy",
    );
    assert.equal(
      await movieRow
        .getByRole("button", { name: "Movie 23", exact: true })
        .locator("img")
        .getAttribute("src"),
      null,
    );
    await movieRow
      .getByRole("button", { name: "Movie 23", exact: true })
      .focus();
    assert.ok(
      await movieRow
        .getByRole("button", { name: "Movie 23", exact: true })
        .locator("img")
        .getAttribute("src"),
    );
    assert.ok(
      images.filter((p) => p.includes("/movie")).length < 24,
      "Do not eagerly load the whole row",
    );
    // Cached rows should render immediately on return, without rebuilding navigation nodes.
    await page
      .getByRole("button", { name: "Home", exact: true })
      .evaluate((el) => {
        window.originalHomeNav = el;
        el.click();
      });
    await page
      .getByRole("button", { name: "Resume movie", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.originalHomeNav ===
          document.querySelector("nav [data-nav=home]"),
      ),
      true,
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page
        .locator("header")
        .evaluate((el) => el.classList.contains("drawer-open")),
      true,
    );
    assert.equal(
      await page
        .locator("nav [data-nav=home] .nav-label")
        .evaluate((el) => getComputedStyle(el).visibility),
      "visible",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page
        .locator("header")
        .evaluate((el) => el.classList.contains("drawer-open")),
      false,
    );
    await page
      .getByRole("button", { name: "Retry loading Next up", exact: true })
      .waitFor();
    nextFails = false;
    await page
      .getByRole("button", { name: "Retry loading Next up", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Next episode", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Customize Home", exact: true })
      .click();
    await page.getByLabel("Combine Continue watching and Next up").check();
    await page.getByLabel("Show poster titles").check();
    await page.getByLabel("Recently released rows").check();
    await page
      .getByRole("checkbox", { name: "Kids Shows", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "Save and open Home", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Continue watching",
        exact: true,
      })
      .waitFor();
    assert.equal(await page.locator('[data-row="latest:kids"]').count(), 0);
    assert.equal(await page.locator('[data-row="released:movies"]').count(), 1);
    assert.equal(
      await page
        .locator("main")
        .evaluate((el) => el.classList.contains("show-titles")),
      true,
    );
    // Even if Views is unavailable on the next launch, cached sidebar text is present immediately.
    failViews = true;
    await page.reload();
    await page.getByRole("button", { name: "Movies", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Resume movie", exact: true })
      .waitFor();
    assert.equal(
      await page.locator('[data-row="latest:kids"]').count(),
      0,
      "Home choices persist per account",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: per-library rows, independent failures and retries, slow-row isolation, lazy poster requests, stable sidebar, immediate labels, account-scoped Home options and offline library cache",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
