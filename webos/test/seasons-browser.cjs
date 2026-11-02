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
    seasons.multi[0].UserData = { Played: false, UnplayedItemCount: 0 };
    seasons.multi[0].RecursiveItemCount = 7;
    seasons.multi[1].UserData = { Played: false, UnplayedItemCount: 0 };
    seasons.multi[1].RecursiveItemCount = 0;
    seasons.multi[2].UserData = { Played: false, UnplayedItemCount: 2 };
    seasons.multi[2].RecursiveItemCount = 5;
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
      MediaSources: [
        {
          Id: "source-" + Id,
          DefaultSubtitleStreamIndex: 4,
          DefaultAudioStreamIndex: 3,
          MediaStreams: [
            {
              Type: "Video",
              Index: 0,
              Codec: "hevc",
              Height: 720,
              DisplayTitle: "720p Shield Ninja / PSA HEVC SDR",
            },
            {
              Type: "Audio",
              Index: 1,
              Codec: "aac",
              Channels: 6,
              DisplayTitle: "Hindi HE-AAC Shield Ninja default",
            },
            {
              Type: "Audio",
              Index: 3,
              Codec: "aac",
              Channels: 2,
              DisplayTitle: "English HE-AAC Shield Ninja default",
            },
            {
              Type: "Subtitle",
              Index: 4,
              DisplayTitle: "English",
              Language: "eng",
              Codec: "srt",
            },
            {
              Type: "Subtitle",
              Index: 7,
              DisplayTitle: "French",
              Language: "fra",
              Codec: "srt",
            },
          ],
        },
      ],
      People: [
        { Id: "host", Name: "Host", Type: "Actor" },
        { Id: "writer", Name: "Writer", Type: "Writer" },
        { Id: "guest", Name: "Guest", Type: "GuestStar" },
      ],
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
      pathToFileURL(process.env.TEST_PLATFORM ? path.resolve("dist", process.env.TEST_PLATFORM, "index.html") : path.resolve(__dirname, "../app/index.html")).href,
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
    assert.equal(await page.locator('[data-item=m2] .watched-badge').count(), 1, "Completed season has a watched check");
    assert.equal(await page.locator('[data-item=m1] .watched-badge').count(), 0, "Partly watched season has no check");
    assert.equal(await page.locator('[data-item=m1] .episode-badge').textContent(), "2");
    assert.equal(await page.locator('[data-item=ms] .watched-badge').count(), 0, "Empty season is not completed");
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
      await page.locator(".series-continue h2").textContent(),
      "Continue watching",
    );
    assert.equal(
      await page
        .locator(".season-grid")
        .evaluate((n) => getComputedStyle(n).display),
      "flex",
      "Seasons form one horizontal row",
    );
    await page.locator(".season-grid [data-item=m1]").click();
    await page.locator(".episode-browser-rail [data-item=progress]").waitFor();
    assert.equal(
      await page.locator(".episode-stream-details").getAttribute("aria-label"),
      "720p · HEVC · AAC Stereo",
      "Technical summary uses structured fields and one default audio stream",
    );

    await page.waitForFunction(() =>
      document
        .querySelector(".episode-browser-overview")
        .textContent.includes("In progress episode"),
    );
    assert.equal(
      await page
        .locator(".season-browser-tabs [aria-selected=true]")
        .textContent(),
      "Season 1",
    );
    assert.equal(await page.locator(".episode-browser-rail .card").count(), 1);
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator(":focus").textContent(), "Resume");
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "progress",
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-selected"),
      "true",
    );
    await page.locator("#detail-subtitles").click();
    await page.locator('#detail-subtitle-menu [data-index="-1"]').click();
    assert.equal(await page.locator("#detail-subtitles").textContent(), "Off");
    assert.equal(
      await page.locator("#detail-subtitles").getAttribute("data-source"),
      "source-progress",
    );
    assert.ok(
      !(await page.locator(".episode-stream-details").textContent()).includes(
        "French",
      ),
    );

    await page
      .locator(".season-browser-tabs")
      .getByRole("tab", { name: "Season 2", exact: true })
      .click();
    await page.locator(".episode-browser-rail [data-item=next]").waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector(".episode-browser-overview")
        .textContent.includes("Next episode"),
    );
    assert.equal(
      await page.locator("main h1").textContent(),
      "Multiple seasons",
    );
    await page.waitForFunction(
      () =>
        document.querySelector("#detail-subtitles").dataset.source ===
        "source-next",
    );
    assert.equal(
      await page.locator("#detail-subtitles").textContent(),
      "Off",
      "Off preference carries to another episode",
    );
    const art = page.locator(".episode-browser-rail [data-item=next] .art");
    const bounds = await art.boundingBox();
    assert.ok(Math.abs(bounds.width / bounds.height - 16 / 9) < 0.05);
    assert.ok(
      (
        await art.locator("img").evaluate((n) => n.src || n.dataset.src)
      ).includes("/Items/next/Images/Primary"),
    );
    await page
      .getByRole("button", { name: "More options", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Next episode", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".episode-browser-rail [data-item=next]").waitFor();
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "next",
    );
    await page
      .getByRole("heading", { name: "Guest stars", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Mark as watched", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mark as unwatched", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Add to favorites", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove from favorites", exact: true })
      .waitFor();
    await page.locator(".episode-browser-actions button").first().focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("id"),
      "detail-subtitles",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Host",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Guest",
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Host",
    );
    await page.locator(".episode-browser-rail .card").focus();
    await page.screenshot({ path: "/tmp/wholphin-season-browser.png" });
    await page
      .getByRole("button", { name: "All seasons", exact: true })
      .click();
    await page.locator(".season-grid").waitFor();
    resumeEnabled = false;
    await open("multi");
    await page.locator(".series-continue [data-item=next]").waitFor();
    await open("single");
    await page
      .locator(".episode-browser-rail [data-item=singlefirst]")
      .waitFor();
    assert.equal(await page.locator(".season-grid").count(), 0);
    assert.equal(
      await page
        .getByRole("button", { name: "All seasons", exact: true })
        .count(),
      0,
    );
    await open("fresh");
    await page.locator(".series-continue [data-item=first]").waitFor();
    assert.equal(
      await page.locator(".series-continue h2").textContent(),
      "Start watching",
    );
    assert.equal(
      await page.locator(".series-continue [data-item=special]").count(),
      0,
    );
    await page.screenshot({ path: "/tmp/wholphin-show-seasons.png" });
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
