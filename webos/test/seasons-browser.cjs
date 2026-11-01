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
    const show = (Id, Name) => ({
      Id,
      Name,
      Type: "Series",
      IsFolder: true,
      Overview: "A show with a season overview.",
      ImageTags: { Primary: "show" },
    });
    const shows = [
      show("multi", "Multiple seasons"),
      show("single", "Single season"),
      show("fresh", "Unwatched show"),
    ];
    const season = (Id, Name, IndexNumber) => ({
      Id,
      Name,
      IndexNumber,
      Type: "Season",
      IsFolder: true,
      ImageTags: { Primary: "season" },
    });
    const seasons = {
      multi: [
        season("m2", "Season 2", 2),
        season("ms", "Specials", 0),
        season("m1", "Season 1", 1),
      ],
      single: [season("one", "Season 1", 1)],
      fresh: [
        season("fs", "Specials", 0),
        season("f1", "Season 1", 1),
        season("f2", "Season 2", 2),
      ],
    };
    const ep = (Id, SeriesId, Name, n, ticks = 0) => ({
      Id,
      SeriesId,
      Name,
      SeriesName: shows.find((s) => s.Id === SeriesId).Name,
      Type: "Episode",
      MediaType: "Video",
      Overview: "Episode synopsis for " + Name,
      ParentIndexNumber: 1,
      IndexNumber: n,
      RunTimeTicks: 18000000000,
      UserData: { PlaybackPositionTicks: ticks },
      ImageTags: { Primary: "episode" },
    });
    const resume = ep(
        "progress",
        "multi",
        "In progress episode",
        2,
        3000000000,
      ),
      next = ep("next", "multi", "Next episode", 3),
      first = ep("first", "fresh", "First episode", 1),
      special = ep("special", "fresh", "Special episode", 1),
      single = ep("singlefirst", "single", "Only season first episode", 1);
    let resumeEnabled = true;
    await page.route("https://jellyfin.test/**", async (route) => {
      const u = new URL(route.request().url());
      requests.push({
        path: u.pathname,
        q: Object.fromEntries(u.searchParams),
      });
      if (u.pathname.includes("/Images/"))
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#51405f"/></svg>',
        });
      let data = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        data = {
          Items: [{ Id: "library", Name: "Shows", CollectionType: "tvshows" }],
        };
      else if (u.pathname.endsWith("/Latest")) data = shows;
      else if (u.pathname.endsWith("/Seasons"))
        data = { Items: seasons[u.pathname.split("/")[2]] || [] };
      else if (u.pathname.endsWith("/Resume"))
        data = {
          Items:
            u.searchParams.get("ParentId") === "multi" && resumeEnabled
              ? [resume]
              : [],
        };
      else if (u.pathname === "/Shows/NextUp")
        data = {
          Items:
            u.searchParams.get("SeriesId") === "multi"
              ? [next]
              : u.searchParams.get("SeriesId") === "fresh"
                ? [first]
                : [],
        };
      else if (
        u.pathname === "/Users/user/Items" &&
        u.searchParams.get("IsPlayed") === "true"
      )
        data = {
          Items:
            u.searchParams.get("ParentId") === "multi"
              ? [{ ...resume, UserData: { Played: true } }]
              : [],
        };
      else if (u.pathname.endsWith("/Episodes")) {
        const id = u.pathname.split("/")[2],
          sid = u.searchParams.get("SeasonId");
        data = {
          Items:
            id === "fresh"
              ? sid === "fs"
                ? [special]
                : [first]
              : id === "single"
                ? [single]
                : [resume, next],
        };
      } else if (
        u.pathname === "/Users/user/Items" &&
        u.searchParams.has("ParentId")
      ) {
        const id = u.searchParams.get("ParentId");
        data = {
          Items:
            id === "one"
              ? [single]
              : id === "m2"
                ? [next]
                : id === "m1"
                  ? [resume]
                  : id === "f1"
                    ? [first]
                    : [],
          TotalRecordCount: 1,
        };
      } else if (u.pathname.startsWith("/Users/user/Items/"))
        data =
          [...shows, resume, next, first, single].find(
            (s) => s.Id === u.pathname.split("/").at(-1),
          ) || {};
      else if (u.pathname.endsWith("/PlaybackInfo"))
        data = {
          MediaSources: [
            { Id: "source", MediaStreams: [], DefaultSubtitleStreamIndex: -1 },
          ],
        };
      await route.fulfill({ json: data });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "test",
          name: "Test",
        }),
      );
      localStorage.setItem(
        "wholphin-home-options:https://jellyfin.test:user",
        JSON.stringify({
          combine: false,
          favorites: false,
          collections: false,
          playlists: false,
          holidays: false,
        }),
      );
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    async function open(id) {
      await page.locator("nav [data-nav=home]").click();
      await page
        .locator('#main .card[data-item="' + id + '"]')
        .first()
        .click();
    }
    await page.locator("#main .card[data-item=multi]").first().click();
    await page.locator(".season-grid .card").first().waitFor();
    assert.deepEqual(
      await page
        .locator(".season-grid .card")
        .evaluateAll((ns) => ns.map((n) => n.getAttribute("aria-label"))),
      ["Specials", "Season 1", "Season 2"],
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Choose season", exact: true })
        .count(),
      0,
    );
    await page.locator(".series-continue [data-item=progress]").waitFor();
    assert.equal(
      await page.locator(".series-continue-description").textContent(),
      "Episode synopsis for In progress episode",
    );
    const previewBounds = await page
      .locator(".series-continue .card")
      .boundingBox();
    const descriptionBounds = await page
      .locator(".series-continue-description")
      .boundingBox();
    assert.ok(
      descriptionBounds.x > previewBounds.x + previewBounds.width,
      "Synopsis appears to the right of the episode",
    );

    assert.equal(
      await page.locator(".series-continue h2").textContent(),
      "Continue watching",
    );
    assert.equal(
      await page
        .locator(".series-continue")
        .evaluate(
          (n) =>
            !!(
              n.compareDocumentPosition(
                document.querySelector(".season-choices"),
              ) & Node.DOCUMENT_POSITION_FOLLOWING
            ),
        ),
      true,
      "Continue is the first content row",
    );
    await page.locator(".series-continue .card").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator(":focus").getAttribute("data-item"), "ms");
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "progress",
    );
    await page.screenshot({ path: "/tmp/wholphin-show-seasons.png" });
    await page.getByRole("button", { name: "Season 2", exact: true }).click();
    await page.locator(".library-grid [data-item=next]").waitFor();
    await page.locator(".library-grid [data-item=next]").focus();
    assert.equal(
      await page.locator(".series-continue-description").textContent(),
      "Episode synopsis for Next episode",
    );
    await page.locator(".series-continue .card").focus();
    assert.equal(
      await page.locator(".series-continue-description").textContent(),
      "Episode synopsis for In progress episode",
    );
    assert.ok(
      requests.some(
        (r) => r.q.ParentId === "m2" && r.q.Fields.includes("Overview"),
      ),
    );

    assert.equal(
      await page.locator(".season-picker button").textContent(),
      "All seasons",
    );
    await page
      .getByRole("button", { name: "All seasons", exact: true })
      .click();
    await page.locator(".season-grid [data-item=m2]").waitFor();
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "m2",
      "Back restores the season card",
    );
    resumeEnabled = false;
    await open("multi");
    await page.locator(".series-continue [data-item=next]").waitFor();
    assert.equal(
      await page.locator(".series-continue h2").textContent(),
      "Continue watching",
    );
    await open("single");
    await page
      .getByRole("heading", { name: "Single season · Season 1", exact: true })
      .waitFor();
    await page.locator(".library-grid [data-item=singlefirst]").waitFor();
    const episodeArt = page.locator(
      ".library-grid [data-item=singlefirst] .art",
    );
    await episodeArt.scrollIntoViewIfNeeded();
    const still = await episodeArt
      .locator("img")
      .evaluate((n) => n.getAttribute("src") || n.dataset.src);
    assert.ok(
      still.includes("/Items/singlefirst/Images/Primary"),
      "Season cards use the episode still",
    );
    const size = await episodeArt.boundingBox();
    assert.ok(
      Math.abs(size.width / size.height - 16 / 9) < 0.05,
      "Episode stills match Start watching proportions",
    );

    assert.equal(
      await page.locator(".season-grid").count(),
      0,
      "A single season opens its episodes directly",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "All seasons", exact: true })
        .count(),
      0,
    );
    await page.locator(".series-continue [data-item=singlefirst]").waitFor();
    assert.equal(
      await page.locator(".series-continue h2").textContent(),
      "Start watching",
    );
    await page.locator(".series-continue .card").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .locator(":focus")
        .evaluate((n) => !!n.closest(".library-grid")),
      true,
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page
        .locator(":focus")
        .evaluate((n) => !!n.closest(".series-continue")),
      true,
    );
    await open("fresh");
    await page.locator(".series-continue [data-item=first]").waitFor();
    assert.equal(
      await page.locator(".series-continue h2").textContent(),
      "Start watching",
    );
    assert.ok(
      requests.some(
        (r) => r.path === "/Shows/fresh/Episodes" && r.q.SeasonId === "f1",
      ),
      "Start selects season 1 rather than Specials",
    );
    assert.equal(
      await page.locator(".series-continue [data-item=special]").count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: season poster overview, sorted Specials/seasons, progress before Next Up, Start at S1E1, single-season bypass and Start row, All seasons/Back focus, and remote navigation between Continue and seasons/episodes",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
