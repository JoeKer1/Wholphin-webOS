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
    page.on("pageerror", (e) => errors.push(e.message));
    const items = Array.from({ length: 26 * 8 }, (_, i) => ({
      Id: "movie" + i,
      Name: String.fromCharCode(65 + Math.floor(i / 8)) + " movie " + i,
      Type: "Movie",
      MediaType: "Video",
      ImageTags: {},
    }));
    await page.route("https://jellyfin.test/**", (r) => {
      const u = new URL(r.request().url());
      let json = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        json = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      else if (u.pathname === "/Users/user/Items") {
        calls.push(Object.fromEntries(u.searchParams));
        const all = items.filter(
          (x) =>
            !u.searchParams.get("NameStartsWithOrGreater") ||
            x.Name >= u.searchParams.get("NameStartsWithOrGreater"),
        );
        const start = Number(u.searchParams.get("StartIndex") || 0);
        json = {
          Items: all.slice(start, start + 48),
          TotalRecordCount: all.length,
        };
      } else if (u.pathname === "/Users/user/Items/movie96") json = items[96];
      return r.fulfill({ json });
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "token",
          name: "Joe",
        }),
      ),
    );
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../app/index.html")).href,
    );
    await page.locator("nav [data-nav=movies]").click();
    await page.getByRole("tab", { name: "Library", exact: true }).click();
    await page.locator(".library-grid .card").first().waitFor();
    assert.equal(await page.locator(".library-alphabet button").count(), 27);
    await page.locator(".library-grid .card").nth(5).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Jump to beginning",
    );
    await page.getByRole("button", { name: "Jump to M", exact: true }).click();
    await page
      .getByRole("button", { name: "M movie 96", exact: true })
      .waitFor();
    assert.ok(
      calls.some(
        (x) =>
          x.NameStartsWithOrGreater === "M" &&
          x.StartIndex === "0" &&
          x.SortBy === "SortName",
      ),
    );
    assert.equal(
      await page
        .locator(".library-grid .card")
        .first()
        .getAttribute("data-item"),
      "movie96",
    );
    await page.locator(".library-grid .card").first().click();
    await page
      .getByRole("heading", { name: "M movie 96", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "M movie 96", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".library-alphabet [aria-current=true]").textContent(),
      "M",
    );
    await page.getByRole("button", { name: "Jump to Z", exact: true }).click();
    await page
      .getByRole("button", { name: "Z movie 200", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Jump to beginning", exact: true })
      .click();
    await page
      .getByRole("button", { name: "A movie 0", exact: true })
      .waitFor();
    await page.locator("nav [data-nav=movies]").evaluate((x) => x.blur());
    await page.locator(".library-grid .card").first().focus();
    assert.equal(
      await page.locator("header").evaluate((x) => getComputedStyle(x).width),
      "80px",
    );
    await page.screenshot({ path: "/tmp/ember-alphabet.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: alphabet server jump, title ordering, remote entry/exit, Back restoration, Z and reset to beginning, narrow sidebar",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
