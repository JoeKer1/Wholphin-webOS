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
    const film = {
      Id: "movie",
      Name: "Example movie",
      Type: "Movie",
      MediaType: "Video",
      ImageTags: { Primary: "p" },
      UserData: { PlaybackPositionTicks: 100000000 },
    };
    await page.route("https://jellyfin.test/**", (r) => {
      const u = new URL(r.request().url());
      requests.push({
        path: u.pathname,
        q: Object.fromEntries(u.searchParams),
      });
      let data = { Items: [] };
      if (u.pathname.includes("/Images/"))
        return r.fulfill({ status: 404, body: "" });
      if (u.pathname.endsWith("/Views"))
        data = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      else if (u.pathname === "/Genres")
        data = {
          Items: [{ Id: "comedy", Name: "Comedy" }],
          TotalRecordCount: 1,
        };
      else if (u.pathname === "/Studios")
        data = {
          Items: [{ Id: "studio", Name: "Example Studio" }],
          TotalRecordCount: 1,
        };
      else if (u.pathname.endsWith("/Latest")) data = [film];
      else if (u.pathname.endsWith("/Resume")) data = { Items: [film] };
      else if (u.pathname === "/Playlists/list/Items") data = { Items: [film] };
      else if (u.pathname.endsWith("/Items")) {
        if (u.searchParams.get("IncludeItemTypes") === "BoxSet")
          data = {
            Items: [{ Id: "collection", Name: "Movie night", Type: "BoxSet" }],
            TotalRecordCount: 1,
          };
        else if (u.searchParams.get("IncludeItemTypes") === "Playlist")
          data = {
            Items: [{ Id: "list", Name: "Weekend", Type: "Playlist" }],
            TotalRecordCount: 1,
          };
        else data = { Items: [film] };
      }
      return r.fulfill({ json: data });
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem("wholphin-session"))
        localStorage.setItem(
          "wholphin-session",
          JSON.stringify({
            server: "https://jellyfin.test",
            user: "user",
            token: "token",
            name: "Joe",
          }),
        );
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    async function editor() {
      await page.locator("nav [data-nav=settings]").click();
      await page
        .getByRole("button", { name: "Customize Home", exact: true })
        .click();
      await page.locator(".home-row-editor").waitFor();
    }
    await editor();
    await page.getByRole("button", { name: "Pin genre", exact: true }).click();
    await page.getByLabel("Search genres").fill("Com");
    await page.getByLabel("Search genres").press("Enter");
    await page.getByRole("button", { name: "Comedy", exact: true }).click();
    for (const [kind, name] of [
      ["collection", "Movie night"],
      ["playlist", "Weekend"],
      ["studio", "Example Studio"],
    ]) {
      await page
        .getByRole("button", { name: "Pin " + kind, exact: true })
        .click();
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page
      .getByRole("button", { name: "Move Comedy up", exact: true })
      .click();
    assert.ok(
      (await page.locator(":focus").getAttribute("aria-label")).startsWith(
        "Move Comedy",
      ),
      "Moving retains remote focus",
    );
    await page
      .getByRole("button", {
        name: "Artwork for Continue watching: Posters",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Hide Favorite shows", exact: true })
      .click();
    await page.locator(".home-row-editor").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/ember-home-editor.png" });
    await page
      .getByRole("button", { name: "Save and open Home", exact: true })
      .click();
    await page.locator("[data-row=continue] .rail.landscape").waitFor();
    assert.equal(await page.locator("[data-row=favorite-series]").count(), 0);
    for (const key of [
      "genre:comedy",
      "collection:collection",
      "playlist:list",
      "studio:studio",
    ]) {
      const row = page.locator('[data-row="pinned:' + key + '"]');
      await row.evaluate((n) => n.loadHomeRow());
      await row.locator(".card").first().waitFor();
    }
    assert.ok(requests.some((r) => r.path === "/Playlists/list/Items"));
    assert.ok(requests.some((r) => r.q.GenreIds === "comedy"));
    assert.ok(requests.some((r) => r.q.StudioIds === "studio"));
    assert.ok(requests.some((r) => r.q.ParentId === "collection"));
    const key = "wholphin-home-options:https://jellyfin.test:user";
    const saved = await page.evaluate((k) => localStorage.getItem(k), key);
    await editor();
    await page
      .getByRole("button", { name: "Unpin Comedy", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cancel changes", exact: true })
      .click();
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), key),
      saved,
      "Cancel never changes saved options",
    );
    await editor();
    await page.getByRole("button", { name: "Pin genre", exact: true }).click();
    await page
      .getByRole("button", { name: "Comedy — pinned", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Comedy — pinned", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#home-pin-picker").isVisible(), false);
    await page
      .getByRole("button", { name: "Cancel changes", exact: true })
      .click();
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("wholphin-session"));
      s.user = "other";
      localStorage.setItem("wholphin-session", JSON.stringify(s));
    });
    await page.reload();
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    assert.equal(
      await page.locator('[data-row^="pinned:"]').count(),
      0,
      "Other profiles have independent layouts",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: pin collections/playlists/genres/studios, move and artwork focus, hide, scoped content, save/cancel, duplicate prevention, picker Back and profile isolation",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
