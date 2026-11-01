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
    await page.clock.setFixedTime(new Date(2026, 9, 31, 12));
    const queries = [];
    await page.route("https://jellyfin.test/**", async (route) => {
      const url = new URL(route.request().url());
      let json = { Items: [] };
      if (url.pathname === "/Users/user/Items") {
        queries.push(Object.fromEntries(url.searchParams));
        if (url.searchParams.get("Tags") === "halloween")
          json = {
            Items: [
              { Id: "halloween", Name: "Halloween movie", Type: "Movie" },
            ],
          };
      }
      await route.fulfill({ json });
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "test",
          name: "Joe",
        }),
      ),
    );
    const app = pathToFileURL(
      path.resolve(__dirname, "../app/index.html"),
    ).href;
    await page.goto(app);
    await page
      .getByRole("button", { name: "Halloween movie", exact: true })
      .waitFor();
    const row = page.locator('[data-row="holiday:2026-10:halloween:movies"]');
    assert.equal(await row.locator("h2").textContent(), "Halloween Movies");
    assert.ok(
      queries.some(
        (q) =>
          q.Tags === "halloween" &&
          q.IncludeItemTypes === "Movie" &&
          q.SortBy === "Random",
      ),
    );
    await page
      .locator('[data-row="holiday:2026-10:halloween:episodes"]')
      .evaluate((el) => el.loadHomeRow());
    await page.waitForFunction(
      () =>
        document.querySelector(
          '[data-row="holiday:2026-10:halloween:episodes"]',
        ).hidden,
    );
    assert.ok(
      queries.some(
        (q) => q.SearchTerm === "halloween" && q.IncludeItemTypes === "Episode",
      ),
    );
    await page.clock.setFixedTime(new Date(2026, 10, 11, 12));
    await page.reload();
    await page
      .getByRole("button", { name: "Halloween movie", exact: true })
      .waitFor();
    await page.clock.setFixedTime(new Date(2026, 10, 12, 12));
    await page.reload();
    await page
      .locator('[data-row="holiday:2026-11:thanksgiving:movies"]')
      .waitFor({ state: "attached" });
    assert.equal(await page.locator('[data-row*="halloween"]').count(), 0);
    await page.clock.setFixedTime(new Date(2026, 10, 27, 12));
    await page.reload();
    await page
      .locator('[data-row="holiday:2026-12:christmas:movies"]')
      .waitFor({ state: "attached" });
    assert.equal(await page.locator('[data-row*="thanksgiving"]').count(), 0);
    console.log(
      "PASS: seasonal query filters, populated cards, hidden empty rows, and extended Halloween tail and immediate post-Thanksgiving Christmas",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
