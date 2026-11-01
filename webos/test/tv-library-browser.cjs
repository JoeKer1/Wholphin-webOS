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
      requests = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const show = {
      Id: "show",
      Name: "Test show",
      Type: "Series",
      ImageTags: { Primary: "art" },
      Overview: "Show overview",
    };
    const movie = {
      Id: "film",
      Name: "Test film",
      Type: "Movie",
      MediaType: "Video",
      Overview: "Film overview",
      ImageTags: { Primary: "art" },
      MediaSources: [
        {
          Id: "film-source",
          MediaStreams: [
            { Type: "Video", Codec: "hevc", Height: 1080 },
            { Type: "Audio", Channels: 6 },
          ],
        },
      ],
    };
    const ep = {
      Id: "episode",
      Name: "Test episode",
      Type: "Episode",
      SeriesId: "show",
      SeriesName: "Test show",
      Overview: "Episode overview",
      ImageTags: { Primary: "art" },
      ParentIndexNumber: 1,
      IndexNumber: 2,
    };
    let failCollections = true,
      activeChecks = 0,
      maxChecks = 0;
    await page.route("https://jellyfin.test/**", async (route) => {
      const u = new URL(route.request().url()),
        q = Object.fromEntries(u.searchParams);
      requests.push({ path: u.pathname, q });
      if (u.pathname.includes("/Images/"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#51405f"/></svg>',
        });
      let data = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        data = {
          Items: [
            { Id: "tv", Name: "TV", CollectionType: "tvshows" },
            { Id: "movies", Name: "Movies", CollectionType: "movies" },
          ],
        };
      else if (u.pathname.endsWith("/Resume") || u.pathname === "/Shows/NextUp")
        data = { Items: q.IncludeItemTypes === "Movie" ? [movie] : [ep] };
      else if (u.pathname.endsWith("/Latest")) data = [show];
      else if (u.pathname === "/Genres")
        data = {
          Items: [{ Id: "genre", Name: "Drama", Type: "Genre" }],
          TotalRecordCount: 1,
        };
      else if (u.pathname === "/Studios")
        data = {
          Items: [{ Id: "studio", Name: "Test Studio", Type: "Studio" }],
          TotalRecordCount: 1,
        };
      else if (u.pathname === "/Users/user/Items") {
        if (q.IncludeItemTypes === "BoxSet") {
          if (failCollections) return route.fulfill({ status: 503, json: {} });
          data = {
            Items: [
              { Id: "moviecol", Name: "Only Movies", Type: "BoxSet" },
              { Id: "tvcol", Name: "TV Collection", Type: "BoxSet" },
              { Id: "mixed", Name: "Mixed Collection", Type: "BoxSet" },
            ],
            TotalRecordCount: 3,
          };
        } else if (["moviecol", "tvcol", "mixed"].includes(q.ParentId)) {
          if (q.Limit === "1") {
            activeChecks++;
            maxChecks = Math.max(activeChecks, maxChecks);
            await new Promise((r) => setTimeout(r, 20));
            activeChecks--;
          }
          data = {
            Items:
              q.IncludeItemTypes === "Movie"
                ? q.ParentId === "tvcol"
                  ? []
                  : [movie]
                : q.ParentId === "moviecol"
                  ? []
                  : [show],
            TotalRecordCount:
              q.IncludeItemTypes === "Movie"
                ? q.ParentId === "tvcol"
                  ? 0
                  : 1
                : q.ParentId === "moviecol"
                  ? 0
                  : 1,
          };
        } else
          data = {
            Items:
              q.IncludeItemTypes === "Episode"
                ? [ep]
                : q.IncludeItemTypes === "Movie"
                  ? [movie]
                  : [show],
            TotalRecordCount: 1,
          };
      } else if (u.pathname.startsWith("/Users/user/Items/"))
        data = u.pathname.endsWith("/film") ? movie : show;
      await route.fulfill({ json: data });
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "test",
          name: "Test",
        }),
      ),
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    await page.locator("nav [data-nav=tv]").waitFor();
    await page.locator("nav [data-nav=tv]").click();
    await page.locator('[data-row="tv:tv:Continue watching"] .card').waitFor();
    assert.deepEqual(
      await page.locator(".tv-library-tabs button").allTextContents(),
      ["Recommended", "Library", "Genres", "Studios", "Collections"],
    );
    assert.ok(
      requests.some(
        (r) =>
          r.path.endsWith("/Resume") &&
          r.q.ParentId === "tv" &&
          r.q.IncludeItemTypes === "Episode",
      ),
    );
    assert.ok(
      requests.some((r) => r.path === "/Shows/NextUp" && r.q.ParentId === "tv"),
    );
    await page.locator('[data-row="tv:tv:Continue watching"] .card').focus();
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("data-tv-tab"),
      "recommended",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "episode",
    );
    await page
      .locator('[data-row="tv:tv:Top Rated Unwatched"]')
      .scrollIntoViewIfNeeded();
    await page
      .locator('[data-row="tv:tv:Top Rated Unwatched"] .card')
      .waitFor();
    assert.ok(
      requests.some(
        (r) =>
          r.q.ParentId === "tv" &&
          r.q.SortBy === "CommunityRating" &&
          r.q.IsPlayed === "false",
      ),
    );
    await page.locator('[data-row="tv:tv:Top Rated Unwatched"] .card').focus();
    await page.waitForFunction(() => {
      const image = document.querySelector(
        '[data-row="tv:tv:Top Rated Unwatched"] img',
      );
      return image && image.complete && image.naturalWidth > 0;
    });
    await page.screenshot({ path: "/tmp/wholphin-tv-recommended.png" });
    const tab = async (name) => {
      await page.locator("[data-tv-tab=" + name + "]").click();
    };
    await tab("library");
    await page.locator(".library-grid [data-item=show]").waitFor();
    assert.equal(
      await page.locator("[data-tv-tab=library]").getAttribute("aria-selected"),
      "true",
    );
    await tab("genres");
    await page.locator(".tv-category-grid [data-item=genre]").click();
    await page.locator(".library-grid [data-item=show]").waitFor();
    assert.ok(
      requests.some(
        (r) =>
          r.q.GenreIds === "genre" &&
          r.q.ParentId === "tv" &&
          r.q.IncludeItemTypes === "Series",
      ),
    );
    await page.keyboard.press("Escape");
    await page.locator(".tv-category-grid [data-item=genre]").waitFor();
    await tab("studios");
    await page.locator(".tv-category-grid [data-item=studio]").click();
    await page.locator(".library-grid [data-item=show]").waitFor();
    assert.ok(
      requests.some((r) => r.q.StudioIds === "studio" && r.q.ParentId === "tv"),
    );
    await tab("collections");
    await page
      .getByRole("button", { name: "Retry collections", exact: true })
      .waitFor();
    failCollections = false;
    await page
      .getByRole("button", { name: "Retry collections", exact: true })
      .click();
    await page.locator(".tv-category-grid [data-item=tvcol]").waitFor();
    assert.equal(await page.locator(".tv-category-grid .card").count(), 2);
    assert.equal(
      await page.locator(".tv-category-grid [data-item=moviecol]").count(),
      0,
    );
    assert.ok(
      maxChecks <= 2,
      "Collection membership uses at most two concurrent requests",
    );
    await page.screenshot({ path: "/tmp/wholphin-tv-collections.png" });
    await page.locator(".tv-category-grid [data-item=mixed]").click();
    await page.locator(".library-grid [data-item=show]").waitFor();
    assert.ok(
      requests.some(
        (r) =>
          r.q.ParentId === "mixed" &&
          r.q.IncludeItemTypes === "Series" &&
          r.q.Limit !== "1",
      ),
    );
    await page.keyboard.press("Escape");
    await page.locator(".tv-category-grid [data-item=mixed]").waitFor();
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "mixed",
    );
    await page.locator("nav [data-nav=movies]").click();
    await page
      .locator("[data-tv-tab=recommended][aria-selected=true]")
      .waitFor();
    assert.deepEqual(
      await page.locator(".tv-library-tabs button").allTextContents(),
      ["Recommended", "Library", "Collections", "Genres"],
    );
    const movieRows = await page.locator("#home-rows h2").allTextContents();
    assert.deepEqual(
      movieRows.filter(
        (n) => !/Halloween|Thanksgiving|Christmas|New Year|Valentine/.test(n),
      ),
      [
        "Continue watching",
        "Recently Added",
        "Recently Released",
        "Top Rated Unwatched",
        "Suggestions",
      ],
    );
    assert.ok(
      requests.some(
        (r) =>
          r.path.endsWith("/Resume") &&
          r.q.ParentId === "movies" &&
          r.q.IncludeItemTypes === "Movie",
      ),
    );
    await page.locator("[data-tv-tab=collections]").click();
    await page.locator(".tv-category-grid [data-item=moviecol]").waitFor();
    assert.equal(
      await page.locator(".tv-category-grid [data-item=tvcol]").count(),
      0,
    );
    await page.locator(".tv-category-grid [data-item=mixed]").click();
    await page.locator(".library-grid [data-item=film]").waitFor();
    assert.ok(
      requests.some(
        (r) =>
          r.q.ParentId === "mixed" &&
          r.q.IncludeItemTypes === "Movie" &&
          r.q.Limit !== "1",
      ),
    );
    await page.locator("[data-tv-tab=genres]").click();
    await page.locator(".tv-category-grid [data-item=genre]").click();
    await page.locator(".library-grid [data-item=film]").waitFor();
    assert.ok(
      requests.some(
        (r) =>
          r.q.ParentId === "movies" &&
          r.q.GenreIds === "genre" &&
          r.q.IncludeItemTypes === "Movie",
      ),
    );
    await page.locator("[data-tv-tab=library]").click();
    await page.locator(".library-grid [data-item=film]").click();
    await page.locator(".format-pill").first().waitFor();
    assert.deepEqual(await page.locator(".format-pill").allTextContents(), [
      "1080p",
      "HEVC",
      "5.1",
    ]);
    const watched = page.getByRole("button", {
      name: "Mark as watched",
      exact: true,
    });
    await watched.focus();
    await page.waitForTimeout(220);
    const expanded = await watched.boundingBox();
    await page
      .getByRole("button", { name: "Play from beginning", exact: true })
      .focus();
    await page.waitForTimeout(220);
    const collapsed = await watched.boundingBox();
    assert.ok(
      expanded.width > collapsed.width + 50,
      "Focused action expands into its label",
    );
    assert.equal(
      await watched.locator("img").getAttribute("src"),
      "icons/visibility_off.svg",
    );
    await watched.click();
    await page
      .getByRole("button", { name: "Mark as unwatched", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Mark as unwatched", exact: true })
        .locator("img")
        .getAttribute("src"),
      "icons/visibility.svg",
    );
    await page.screenshot({ path: "/tmp/wholphin-movie-detail-actions.png" });

    await page.locator("nav [data-nav=tv]").click();
    await page.locator("[data-tv-tab=collections]").click();
    await page.locator("nav [data-nav=home]").click();
    await page.waitForTimeout(100);
    assert.equal(
      await page.locator("main h1").textContent(),
      "Home",
      "Late category checks cannot repaint another screen",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: TV recommendation rows, scoped requests, tabs, remote navigation, genre/studio filters, TV-only collections including mixed collections, bounded checks, retry and Back restoration",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
