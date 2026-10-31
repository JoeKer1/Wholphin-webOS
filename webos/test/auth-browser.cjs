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
    await page.clock.install();
    let enabled = true,
      approved = false,
      invalid = false,
      expired = false,
      redirect = false,
      polls = 0;
    const requests = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      requests.push({
        path: u.pathname,
        headers: req.headers(),
        body: req.postDataJSON(),
      });
      let json = { Items: [] };
      if (u.pathname === "/QuickConnect/Enabled") {
        if (redirect) {
          await route.fulfill({
            status: 302,
            headers: { location: "https://other.test/stolen" },
          });
          return;
        }
        json = enabled;
      }
      if (u.pathname === "/QuickConnect/Initiate")
        json = { Code: "123456", Secret: "private-secret" };
      if (u.pathname === "/QuickConnect/Connect") {
        polls++;
        assert.equal(u.searchParams.get("Secret"), "private-secret");
        if (expired) {
          await route.fulfill({ status: 404, json: {} });
          return;
        }
        json = { Authenticated: approved };
      }
      if (u.pathname === "/Users/AuthenticateWithQuickConnect") {
        assert.deepEqual(req.postDataJSON(), { Secret: "private-secret" });
        json = invalid
          ? {}
          : { AccessToken: "access-token", User: { Id: "user", Name: "Joe" } };
      }
      await route.fulfill({ json });
    });
    const foreign = [];
    await page.route("https://other.test/**", async (r) => {
      foreign.push(r.request().url());
      await r.fulfill({ json: {} });
    });
    const app = pathToFileURL(
      path.resolve(__dirname, "../app/index.html"),
    ).href;
    await page.goto(app);
    async function start() {
      await page
        .getByLabel("Server URL", { exact: true })
        .fill("https://jellyfin.test");
      await page
        .getByRole("button", { name: "Use Quick Connect", exact: true })
        .click();
    }
    await start();
    await page.getByText("123456", { exact: true }).waitFor();
    assert.ok(
      !(await page.locator("body").textContent()).includes("private-secret"),
    );
    assert.ok(
      !(await page.evaluate(() => JSON.stringify(localStorage))).includes(
        "private-secret",
      ),
    );
    await page.clock.fastForward(3001);
    await page.waitForFunction(() => true);
    assert.equal(polls, 1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.clock.fastForward(10000);
    assert.equal(polls, 1, "Cancel stops polling");
    await start();
    await page.getByText("123456", { exact: true }).waitFor();
    approved = true;
    invalid = true;
    await page.clock.fastForward(3001);
    await page
      .getByText("Jellyfin returned an invalid sign-in response.", {
        exact: true,
      })
      .waitFor();
    invalid = false;
    await page
      .getByRole("button", { name: "Generate new code", exact: true })
      .click();
    await page.getByText("123456", { exact: true }).waitFor();
    await page.clock.fastForward(3001);
    await page.locator("#home-rows").waitFor();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wholphin-session")),
    );
    assert.equal(saved.token, "access-token");
    assert.ok(!JSON.stringify(saved).includes("private-secret"));
    assert.ok(
      requests
        .filter((r) => r.path.startsWith("/QuickConnect"))
        .every((r) => !r.headers.authorization.includes("Token=")),
    );
    // Isolated login to exercise disabled, expired and redirect failure paths.
    await page.evaluate(() => localStorage.removeItem("wholphin-session"));
    await page.reload();
    enabled = false;
    await start();
    await page.getByText(/Quick Connect is disabled/).waitFor();
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Use Quick Connect", exact: true })
      .waitFor();
    enabled = true;
    expired = true;
    await start();
    await page.getByText("123456", { exact: true }).waitFor();
    await page.clock.fastForward(3001);
    await page
      .getByText("Code expired. Generate a new code.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expired = false;
    redirect = true;
    await start();
    await page
      .getByRole("button", { name: "Generate new code", exact: true })
      .waitFor();
    assert.deepEqual(
      foreign,
      [],
      "API redirects must not reach a foreign host",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Quick Connect approval, no secret storage/display, cancel, invalid response, disabled server, expired code, Back, and redirect blocking",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
