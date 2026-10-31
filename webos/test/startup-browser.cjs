// Smoke-test the file-based entry point, including compiled IPK contents via APP_DIR.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
(async () => {
  const app = process.env.APP_DIR || path.resolve(__dirname, "../app");
  const html = fs.readFileSync(path.join(app, "index.html"), "utf8");
  // Chromium 79 on webOS does not match packaged file URLs against 'self'.
  for (const directive of ["script-src", "style-src", "img-src"]) {
    const sources = html.match(
      new RegExp(directive + ' ([^;" ]+(?: [^;" ]+)*)'),
    )[1];
    assert.match(sources, /(?:^| )file:(?: |$)/);
  }
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
    await page.goto(pathToFileURL(path.join(app, "index.html")).href);
    await page.getByLabel("Password", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => typeof window.WholphinCore),
      "object",
    );
    assert.equal(
      await page
        .locator("#player")
        .evaluate((n) => getComputedStyle(n).position),
      "fixed",
    );
    assert.equal(await page.locator("#player").isVisible(), false);
    await page.evaluate(() => {
      window.policyViolations = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        window.policyViolations.push(e.violatedDirective),
      );
      const inline = document.createElement("script");
      inline.textContent = "window.inlineExecuted = true";
      document.body.appendChild(inline);
      const remote = document.createElement("script");
      remote.src = "https://untrusted.example/remote.js";
      document.body.appendChild(remote);
    });
    await page.waitForFunction(() => window.policyViolations.length >= 2);
    assert.equal(await page.evaluate(() => window.inlineExecuted), undefined);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: file-based startup loads scripts/styles and login; explicit webOS file sources; inline and remote scripts stay blocked",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
