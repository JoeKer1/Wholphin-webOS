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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://jellyfin.test/**", (r) =>
      r.fulfill({
        json: r.request().url().includes("/plugins/profiles/list")
          ? []
          : { Items: [] },
      }),
    );
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
    await page.locator("nav [data-nav=settings]").click();
    const categories = page.locator(".settings-category");
    assert.equal(await categories.count(), 5);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() =>
      document.activeElement.classList.contains("setting-row"),
    );
    assert.ok(
      (
        await page.evaluate(() =>
          document.activeElement.getAttribute("aria-label"),
        )
      ).startsWith("Autoplay"),
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page
        .locator(".settings-section")
        .nth(1)
        .locator(".setting-value")
        .first()
        .textContent(),
      "Off",
    );
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(":focus").textContent(), "30 seconds");
    await page.screenshot({path:"/private/tmp/ember-ux-settings-choice.png"});
    await page.locator("#setting-options").getByRole("button", {name:"60 seconds",exact:true}).press("Enter");
    assert.equal(
      await page
        .getByRole("button", {
          name: "Up Next countdown: 60 seconds",
          exact: true,
        })
        .count(),
      1,
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent),
      "Playback",
    );
    await page.screenshot({ path: "/tmp/ember-settings-playback.png" });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Subtitle appearance",
    );
    await page.keyboard.press("Enter");
    await page
      .getByRole("heading", { name: "Subtitle appearance", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("heading", { name: "Settings", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Device", exact: true }).click();
    const mode = page.getByRole("button", {
      name: "Playback mode: Compatibility",
      exact: true,
    });
    await mode.click();
    await page.locator("#setting-options").getByRole("button", {name:"LG C1 native (experimental)",exact:true}).click();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Dolby Vision MP4 (experimental): Off",
          exact: true,
        })
        .isEnabled(),
      true,
    );
    await page.getByRole("button", { name: "About", exact: true }).click();
    await page.screenshot({ path: "/tmp/ember-settings-about.png" });
    const pane = await page.locator(".settings-pane").boundingBox(),
      signout = await page
        .getByRole("button", { name: "Sign out", exact: true })
        .boundingBox();
    assert.ok(
      signout.y >= pane.y && signout.y + signout.height <= pane.y + pane.height,
      "Last setting scrolls fully into view",
    );
    await page.reload();
    await page.locator("nav [data-nav=settings]").click();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Up Next countdown: 60 seconds",
          exact: true,
        })
        .count(),
      1,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Playback mode: LG C1 native (experimental)",
          exact: true,
        })
        .count(),
      1,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: settings categories, D-pad columns, live values, preference persistence, subtitle Back, native dependencies and final-row visibility",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
