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
    const film = (id, name) => ({
      Id: id,
      Name: name,
      Type: "Movie",
      MediaType: "Video",
      ImageTags: { Primary: "art" },
      RunTimeTicks: 72000000000,
    });
    const movie = {
      ...film("m1", "Original movie"),
      People: [{ Id: "actor", Name: "Actor One", Type: "Actor" }],
    };
    const series = {
      Id: "s1",
      Name: "Original show",
      Type: "Series",
      IsFolder: true,
    };
    const episode = {
      ...film("ep1", "An episode"),
      Type: "Episode",
      SeriesId: "s1",
    };
    const members = [
      movie,
      ...Array.from({ length: 49 }, (_, i) =>
        film("member" + i, "Collection movie " + i),
      ),
    ];
    let failMembership = false,
      holdSimilar = false;
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
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
          Items: [{ Id: "library", Name: "Movies", CollectionType: "movies" }],
        };
      else if (u.pathname.endsWith("/Latest")) data = [movie, series, episode];
      else if (u.pathname.endsWith("/PlaybackInfo"))
        data = {
          MediaSources: [
            { Id: "source", MediaStreams: [], DefaultSubtitleStreamIndex: -1 },
          ],
        };
      else if (u.pathname.endsWith("/Collections")) {
        if (failMembership) return route.fulfill({ status: 503, json: {} });
        data = {
          Items:
            u.pathname.includes("/m1/") || u.pathname.includes("/s1/")
              ? [
                  { Id: "col1", Name: "A Collection" },
                  { Id: "col2", Name: "Another Collection" },
                ]
              : [],
        };
      } else if (u.pathname.endsWith("/Similar")) {
        if (holdSimilar) await new Promise((r) => setTimeout(r, 1000));
        data = {
          Items:
            u.pathname.includes("/m1/") || u.pathname.includes("/s1/")
              ? [
                  movie,
                  film("rec1", "Recommended movie"),
                  film("rec1", "Duplicate recommendation"),
                ]
              : [],
        };
      } else if (
        u.pathname === "/Users/user/Items" &&
        u.searchParams.has("ParentId")
      ) {
        if (u.searchParams.get("ParentId") === "col2") {
          data = {
            Items: [film("second", "Another collection movie")],
            TotalRecordCount: 1,
          };
        } else {
          const start = Number(u.searchParams.get("StartIndex") || 0);
          data = {
            Items: members.slice(start, start + 24),
            TotalRecordCount: members.length,
          };
        }
      } else if (u.pathname.startsWith("/Users/user/Items/")) {
        const id = u.pathname.split("/").at(-1);
        data =
          id === "m1"
            ? movie
            : id === "s1"
              ? series
              : id === "ep1"
                ? episode
                : film(id, "Child movie");
      }
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
        }),
      );
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    await page.locator('#main .card[data-item="m1"]').first().click();
    const collection = page.locator('[data-row-key="collections:m1"]');
    await collection.locator('.card[data-item="col1"]').waitFor();
    assert.equal(await collection.locator(".card").count(), 2);
    await collection
      .locator(".rail")
      .evaluate((n) => (n.style.maxWidth = "300px"));
    await collection.locator('[data-item="col2"]').focus();
    assert.equal(
      await collection.locator(".detail-row-heading .metadata").textContent(),
      "2 of 2",
    );
    assert.ok(
      await collection.locator(".rail").evaluate((n) => n.scrollLeft > 0),
      "Focused collection scrolls into view",
    );
    await collection.locator(".rail").evaluate((n) => {
      n.scrollLeft = 0;
      n.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 200,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.ok(
      await collection.locator(".rail").evaluate((n) => n.scrollLeft > 0),
      "Remote wheel scrolls collection row",
    );
    await collection.locator(".rail").evaluate((n) => (n.style.maxWidth = ""));

    assert.equal(
      requests.some((r) => r.q.ParentId === "col1" || r.q.ParentId === "col2"),
      false,
      "Membership cards do not fetch collection contents",
    );
    await page.locator(".cast-row figure").first().focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "col1",
    );
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("aria-label"),
      "Actor One",
    );
    await collection.locator('[data-item="col2"]').click();
    await page
      .getByRole("heading", { name: "Another Collection", exact: true })
      .waitFor();
    await page.locator('.library-grid [data-item="second"]').waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.activeElement.dataset.item === "col2",
    );
    await collection.locator('[data-item="col1"]').click();
    await page
      .getByRole("heading", { name: "A Collection", exact: true })
      .waitFor();
    await page.locator('.library-grid [data-item="member0"]').waitFor();
    assert.equal(
      await page.locator('.library-grid [data-item="m1"]').count(),
      1,
      "Opened collection includes the original title",
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.activeElement.dataset.item === "col1",
    );
    const similar = page.locator('[data-row-key="similar:m1"]');
    await similar.scrollIntoViewIfNeeded();
    await similar.locator('[data-item="rec1"]').waitFor();
    assert.equal(await similar.locator(".card").count(), 1);
    await similar.locator('[data-item="rec1"]').focus();
    await page.keyboard.press("ArrowUp");
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "col1",
    );
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.locator(":focus").getAttribute("data-item"),
      "rec1",
    );
    await page.screenshot({ path: "/tmp/wholphin-related-rows.png" });
    await similar.locator('[data-item="rec1"]').click();
    await page.locator(".detail-related").scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => document.querySelector(".detail-media-row").hidden,
    );
    assert.equal(
      await page.locator(".detail-media-row:not([hidden])").count(),
      0,
      "Empty recommendations and absent membership do not leave empty rows",
    );
    await page.locator("nav [data-nav=home]").click();
    await page.locator('#main .card[data-item="ep1"]').first().click();
    await page.locator(".detail-related").scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      document.querySelector('[data-row-key="similar:s1"] .card'),
    );
    assert.ok(requests.some((r) => r.path === "/Items/s1/Collections"));
    assert.ok(requests.some((r) => r.path === "/Items/s1/Similar"));
    assert.equal(
      requests.some((r) => r.path === "/Items/ep1/Similar"),
      false,
      "Episodes use show-level recommendations",
    );
    await page.locator("nav [data-nav=home]").click();
    failMembership = true;
    await page.locator('#main .card[data-item="m1"]').first().click();
    await page
      .getByRole("button", { name: "Retry collections", exact: true })
      .waitFor();
    await page.locator('[data-row-key="similar:m1"]').scrollIntoViewIfNeeded();
    await page.locator('[data-row-key="similar:m1"] .card').waitFor();
    failMembership = false;
    await page
      .getByRole("button", { name: "Retry collections", exact: true })
      .click();
    await collection.locator('[data-item="col1"]').waitFor();
    await page.locator("nav [data-nav=home]").click();
    holdSimilar = true;
    await page.locator('#main .card[data-item="m1"]').first().click();
    await page.locator(".detail-related").scrollIntoViewIfNeeded();
    await page.locator("nav [data-nav=home]").click();
    await page.waitForTimeout(1100);
    assert.equal(await page.locator("main h1").textContent(), "Home");
    assert.equal(
      await page.locator(".detail-related").count(),
      0,
      "Late results cannot repaint a different page",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: collection links without eager contents, collection opening, self/duplicate filtering, cast/row remote navigation, Back restoration, empty rows, episode series context, and stale-page cancellation",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
