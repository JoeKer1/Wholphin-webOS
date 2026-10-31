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
      calls = [],
      images = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let repeatMore = true;
    let failMore = true,
      failFacets = true,
      holdOffset = null,
      releaseHeld = null,
      holdSort = false,
      releaseSort = null;
    const items = Array.from({ length: 240 }, (_, i) => ({
      Id: "movie" + i,
      Name: "Movie " + String(i).padStart(3, "0"),
      Type: "Movie",
      MediaType: "Video",
      ImageTags: { Primary: "tag" },
      ProductionYear: i % 3 === 0 ? 2026 : 2025,
      Genres: [i % 2 ? "Comedy" : "Drama"],
      UserData: { Played: i % 4 === 0 },
      DateCreated: new Date(2020, 0, i + 1).toISOString(),
    }));
    const other = items.slice(0, 60).map((item, i) => ({
      ...item,
      Id: "unknown" + i,
      Name: "Unknown " + String(i).padStart(3, "0"),
    }));
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      let json = { Items: [] };
      if (u.pathname.includes("/Images/")) {
        images.push(u.pathname);
        await route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#3c3348"/><text x="200" y="300" text-anchor="middle" fill="#cbbce0" font-size="32">Poster</text></svg>',
        });
        return;
      }
      if (u.pathname.endsWith("/Views"))
        json = {
          Items: [
            { Id: "library", Name: "Movies", CollectionType: "movies" },
            { Id: "unknown", Name: "Other", CollectionType: "movies" },
            { Id: "repeated", Name: "Repeated", CollectionType: "movies" },
          ],
        };
      if (u.pathname === "/Items/Filters") {
        if (failFacets) {
          failFacets = false;
          await route.fulfill({ status: 503, json: {} });
          return;
        }
        json = { Genres: ["Comedy", "Drama"], Years: [2025, 2026] };
      }
      if (u.pathname === "/Users/user/Items") {
        const query = Object.fromEntries(u.searchParams);
        if (!query.ParentId) {
          await route.fulfill({ json: { Items: [] } });
          return;
        }
        calls.push(query);
        const start = Number(query.StartIndex || 0);
        if (start === holdOffset)
          await new Promise((resolve) => (releaseHeld = resolve));
        if (
          holdSort &&
          query.SortBy === "SortName" &&
          query.SortOrder === "Ascending" &&
          !query.IsPlayed
        )
          await new Promise((resolve) => (releaseSort = resolve));
        if (start === 48 && failMore) {
          failMore = false;
          await route.fulfill({ status: 503, json: {} });
          return;
        }
        let data = (query.ParentId === "unknown" ? other : items).filter(
          (item) =>
            (query.IsPlayed === undefined ||
              item.UserData.Played === (query.IsPlayed === "true")) &&
            (!query.Genres || item.Genres.includes(query.Genres)) &&
            (!query.Years || item.ProductionYear === Number(query.Years)),
        );
        if (query.SortBy.startsWith("DateCreated"))
          data.sort((a, b) => a.DateCreated.localeCompare(b.DateCreated));
        else data.sort((a, b) => a.Name.localeCompare(b.Name));
        if (query.SortOrder === "Descending") data.reverse();
        const cap = query.ParentId === "unknown" ? 17 : Number(query.Limit);
        json = {
          Items:
            query.ParentId === "repeated" && start === 48 && repeatMore
              ? data.slice(0, 48)
              : data.slice(start, start + cap),
          ...(query.ParentId === "unknown"
            ? {}
            : { TotalRecordCount: data.length }),
        };
      }
      const detail = u.pathname.match(/^\/Users\/user\/Items\/(movie\d+)$/);
      if (detail) json = items.find((item) => item.Id === detail[1]);
      await route.fulfill({ json });
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem("wholphin-session"))
        localStorage.setItem(
          "wholphin-session",
          JSON.stringify({
            server: "https://jellyfin.test",
            user: "user",
            token: "test",
            name: "Joe",
          }),
        );
      window.abortedLibrary = [];
      const fetch = window.fetch;
      window.fetch = function (url, opts) {
        if (opts.signal && url.includes("/Users/user/Items?"))
          opts.signal.addEventListener("abort", () =>
            window.abortedLibrary.push(url),
          );
        return fetch.apply(this, arguments);
      };
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    const click = async (name) =>
      page.getByRole("button", { name, exact: true }).click();
    async function waitFor(test) {
      for (let n = 0; n < 150; n++) {
        if (await test()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Condition not met");
    }
    const scrollEnd = () =>
      page.locator("#main").evaluate((main) => {
        main.scrollTop = main.scrollHeight;
        main.dispatchEvent(new Event("scroll"));
      });
    await page.locator("nav [data-nav=library]").click();
    await page.getByText("48 of 240 items", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: /Next page|Previous page/ })
        .count(),
      0,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].StartIndex, "0");
    assert.ok(images.length < 48, "Posters remain lazy on initial load");
    await scrollEnd();
    await click("Retry loading videos");
    await page.getByText("96 of 240 items", { exact: true }).waitFor();
    assert.deepEqual(
      calls.map((q) => q.StartIndex),
      ["0", "48", "48"],
    );
    assert.equal(
      await page.locator("[data-item=movie0]").count(),
      0,
      "Offscreen cards are removed from the rendered window",
    );
    holdOffset = 96;
    await scrollEnd();
    await waitFor(() => !!releaseHeld);
    await page.locator("[data-item=movie95]").focus();
    await page.keyboard.press("ArrowDown");
    releaseHeld();
    holdOffset = null;
    await waitFor(() =>
      page.evaluate(() => document.activeElement.dataset.item === "movie101"),
    );
    assert.equal(
      calls.filter((q) => q.StartIndex === "96").length,
      1,
      "Scrolling and D-pad share a single in-flight request",
    );
    for (let n = 0; n < 6; n++) {
      await scrollEnd();
      if (await page.getByText("All items loaded.", { exact: true }).count())
        break;
      await new Promise((r) => setTimeout(r, 60));
    }
    await page.getByText("240 of 240 items", { exact: true }).waitFor();
    assert.ok(
      (await page.locator("#library-items .card").count()) < 100,
      "Rendered cards are bounded even as the full library loads",
    );
    await page.locator("[data-item=movie230]").focus();
    await page
      .locator("[data-item=movie230]")
      .evaluate((node) => node.scrollIntoView({ block: "nearest" }));
    const scroll = await page
        .locator("#main")
        .evaluate((main) => main.scrollTop),
      before = calls.length;
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "Movie 230", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await waitFor(() =>
      page.evaluate(() => document.activeElement.dataset.item === "movie230"),
    );
    assert.ok(
      Math.abs(
        (await page.locator("#main").evaluate((main) => main.scrollTop)) -
          scroll,
      ) < 3,
      "Back restores exact scroll position",
    );
    assert.equal(calls.length, before, "Back reuses loaded library items");
    await page.screenshot({ path: "/tmp/wholphin-library-scroll.png" });
    await page.locator("#library-sort").click();
    await click("Date added (newest)");
    await page.getByText("48 of 240 items", { exact: true }).waitFor();
    assert.equal(calls.at(-1).SortBy, "DateCreated,SortName");
    assert.equal(calls.at(-1).StartIndex, "0");
    await page.locator("#library-watched").click();
    await click("Unwatched");
    await page.getByText("48 of 180 items", { exact: true }).waitFor();
    assert.equal(calls.at(-1).IsPlayed, "false");
    assert.equal(calls.at(-1).SortOrder, "Descending");
    await page.locator("#library-genre").click();
    await click("Retry loading options");
    await page.getByRole("button", { name: "Comedy", exact: true }).waitFor();
    await page.keyboard.press("ArrowDown");
    assert.ok(
      await page
        .locator("#library-options")
        .evaluate((d) => d.contains(document.activeElement)),
      "D-pad stays in options",
    );
    await click("Comedy");
    await page.getByText("48 of 120 items", { exact: true }).waitFor();
    await page.locator("#library-year").click();
    await click("2025");
    await page.getByText("48 of 80 items", { exact: true }).waitFor();
    assert.equal(calls.at(-1).Genres, "Comedy");
    assert.equal(calls.at(-1).Years, "2025");
    assert.equal(calls.at(-1).IsPlayed, "false");
    await page.locator("#library-year").click();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#library-options").evaluate((d) => d.hidden),
      true,
    );
    assert.equal(
      await page
        .locator("#main")
        .evaluate((m) => m.classList.contains("library-page")),
      true,
      "Back closes options without leaving library",
    );
    const headerState = await page.locator("header").evaluate((h) => ({
      scroll: h.scrollTop,
      rect: h.getBoundingClientRect().toJSON(),
      brand: document.getElementById("brand").getBoundingClientRect().toJSON(),
    }));
    assert.equal(headerState.scroll, 0, JSON.stringify(headerState));
    assert.ok(headerState.brand.top >= 0, JSON.stringify(headerState));
    assert.equal(
      await page.evaluate(() => document.elementFromPoint(45, 50).id),
      "profile-initial",
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    await page.screenshot({ path: "/tmp/wholphin-library-filters.png" });
    // A filter change must abort its previous query and ignore the delayed response.
    await click("Reset filters");
    await page.getByText("48 of 240 items", { exact: true }).waitFor();
    holdSort = true;
    await page.locator("#library-sort").click();
    await click("Title (A–Z)");
    await waitFor(() => !!releaseSort);
    await page.locator("#library-watched").click();
    await click("Watched");
    await page.getByText("48 of 60 items", { exact: true }).waitFor();
    releaseSort();
    holdSort = false;
    assert.ok((await page.evaluate(() => window.abortedLibrary)).length > 0);
    assert.equal(
      await page.locator("#library-watched").textContent(),
      "Show: Watched",
    );
    assert.ok(
      (await page.locator("#library-count").textContent()).includes("60"),
    );
    // Libraries without totals, and servers returning fewer than requested, still stream to the end.
    await page.locator("nav [data-nav=unknown]").click();
    await waitFor(() =>
      calls.some((q) => q.ParentId === "unknown" && q.StartIndex === "0"),
    );
    for (let n = 0; n < 8; n++) {
      await scrollEnd();
      if (await page.getByText("All items loaded.", { exact: true }).count())
        break;
      await new Promise((r) => setTimeout(r, 60));
    }
    await page.getByText("60 items loaded", { exact: true }).waitFor();
    await page.getByText("All items loaded.", { exact: true }).waitFor();
    assert.deepEqual(
      calls.filter((q) => q.ParentId === "unknown").map((q) => q.StartIndex),
      ["0", "17", "34", "51", "60"],
    );
    assert.equal(
      await page.locator("#library-watched").textContent(),
      "Show: All",
      "Filters do not leak between libraries",
    );
    await page.locator("nav [data-nav=repeated]").click();
    await page.getByText("48 of 240 items", { exact: true }).waitFor();
    await scrollEnd();
    await page
      .getByRole("button", { name: "Retry loading videos", exact: true })
      .waitFor();
    assert.equal(
      calls.filter((q) => q.ParentId === "repeated" && q.StartIndex === "48")
        .length,
      1,
      "Repeated batches stop automatic fetching",
    );
    repeatMore = false;
    await click("Retry loading videos");
    await page.getByText("96 of 240 items", { exact: true }).waitFor();
    const renderedIds = await page
      .locator("#library-items .card")
      .evaluateAll((nodes) => nodes.map((node) => node.dataset.item));
    assert.equal(
      new Set(renderedIds).size,
      renderedIds.length,
      "No duplicate cards appear after retry",
    );
    // Changing sort preferences survives reload, while rendered items are fetched afresh.
    await page.locator("nav [data-nav=library]").click();
    await page.getByText("48 of 60 items", { exact: true }).waitFor();
    await page.reload();
    await page.locator("nav [data-nav=library]").click();
    await page.getByText("48 of 60 items", { exact: true }).waitFor();
    assert.equal(calls.at(-1).IsPlayed, "true");
    assert.equal(calls.at(-1).SortBy, "SortName");
    assert.deepEqual(errors, []);
    console.log(
      "PASS: continuous scrolling, bounded DOM, lazy posters, retries, one request at a time, D-pad across loads, exact Back restoration, sorting/filters, options retry/Back, stale-query cancellation, unknown totals, short batches and per-library saved preferences",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
