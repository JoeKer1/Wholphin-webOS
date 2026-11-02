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
    let available = true,
      mode = "normal", empty = false;
    const profiles = [
      {
        profileUserId: "master",
        profileName: "Parent",
        avatarInitial: "P",
        profileImage: "/plugins/profiles/image/master",
        isMaster: true,
        requiresPin: true,
      },
      {
        profileUserId: "kid",
        profileName: "Kids",
        avatarInitial: "K",
        avatarColor: "#558844",
        requiresPin: true,
        profileImage: "/plugins/profiles/image/kid",
      },
      {
        profileUserId: "guest",
        profileName: "Guest",
        avatarInitial: "G",
        requiresPin: false,
        profileImage: "javascript:alert(1)",
      },
    ];
    const film = (id, name) => ({
      Id: id,
      Name: name,
      Type: "Movie",
      MediaType: "Video",
      Overview: "Synopsis",
      ImageTags: {},
    });
    await page.route("https://jellyfin.test/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        body = req.postDataJSON(),
        auth = req.headers().authorization || "";
      requests.push({ path: u.pathname, body, auth });
      if (u.pathname === "/plugins/profiles/list") {
        if (!available) return route.fulfill({ status: 404, json: {} });
        assert.ok(
          auth.includes('Token="master-token"') ||
            auth.includes('Token="kid-token"'),
          "Profile requests use the active valid credential",
        );
        return route.fulfill({
          json: (empty ? [] : profiles).map((p) =>
            Object.fromEntries(
              Object.entries(p).map(([k, v]) => [
                k[0].toUpperCase() + k.slice(1),
                v,
              ]),
            ),
          ),
        });
      }
      if (u.pathname === "/plugins/profiles/image/master")
        return route.fulfill({
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
            "base64",
          ),
        });
      if (u.pathname.startsWith("/plugins/profiles/image/"))
        return route.fulfill({ status: 404, body: "" });
      if (u.pathname === "/plugins/profiles/switch") {
        assert.ok(
          auth.includes('Token="master-token"') ||
            auth.includes('Token="kid-token"'),
        );
        if (mode === "limited")
          return route.fulfill({ status: 429, body: "Too many attempts" });
        if (mode === "invalid")
          return route.fulfill({
            json: {
              ActiveProfileToken: "other-token",
              JellyfinUserId: "intruder",
            },
          });
        if (mode === "slow") await new Promise((r) => setTimeout(r, 400));
        if (body.profileId === "kid" && body.pin !== "9797")
          return route.fulfill({ status: 400, body: "<b>Incorrect PIN</b>" });
        return route.fulfill({
          json: {
            ActiveProfileToken:
              body.profileId === "kid" ? "kid-token" : "master-token",
            JellyfinUserId: body.profileId,
          },
        });
      }
      let data = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        data = {
          Items: [
            {
              Id: u.pathname.includes("/kid/")
                ? "kids-library"
                : "private-library",
              Name: u.pathname.includes("/kid/")
                ? "Kids only"
                : "Parent library",
            },
          ],
        };
      else if (u.pathname.endsWith("/Latest"))
        data = [
          film(
            u.searchParams.get("ParentId") === "kids-library"
              ? "kids-film"
              : "private-film",
            u.searchParams.get("ParentId") === "kids-library"
              ? "Kids movie"
              : "Private movie",
          ),
        ];
      if (u.pathname.startsWith("/Users/kid/"))
        assert.ok(
          auth.includes('Token="kid-token"'),
          "Child library requests never use the parent token",
        );
      return route.fulfill({ json: data });
    });
    await page.addInitScript(
      () =>
        !localStorage.getItem("wholphin-session") &&
        localStorage.setItem(
          "wholphin-session",
          JSON.stringify({
            server: "https://jellyfin.test",
            user: "master",
            token: "master-token",
            name: "Parent",
            profileAccount: {
              server: "https://jellyfin.test",
              user: "master",
              token: "expired-original-token",
            },
          }),
        ),
    );
    const app = pathToFileURL(
      path.resolve(__dirname, "../app/index.html"),
    ).href;
    await page.goto(app);
    await page
      .getByRole("heading", { name: "Who's watching?", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Kids, PIN required", exact: true })
      .waitFor();
    assert.equal(await page.locator(".profile-card").count(), 3);
    const frame = await page.locator("#main").boundingBox();
    assert.equal(frame.x, 0);
    assert.equal(frame.width, 1920);
    assert.equal(frame.height, 1080);
    assert.equal(
      await page.getByRole("button", { name: "Back", exact: true }).count(),
      0,
      "Selection has no bypass button",
    );
    assert.equal(await page.locator("#wall-clock").isVisible(), false);
    await page.keyboard.press("Escape");
    await page.locator(".profile-card").first().waitFor();
    assert.equal(
      await page.locator("header").isVisible(),
      false,
      "Back stays in picker",
    );
    assert.equal(
      await page.locator("header").isVisible(),
      false,
      "Menu hidden until profile chosen",
    );
    await page.keyboard.press("ArrowLeft");
    assert.equal(
      await page.evaluate(() => !!document.activeElement.closest("nav")),
      false,
    );
    assert.equal(
      await page.locator("#profile-initial").isVisible(),
      false,
      "Duplicate profile badge is hidden",
    );
    assert.equal(await page.locator("nav [data-nav=profiles]").count(), 1);
    await page
      .locator(".profile-nav-initial img")
      .waitFor({ state: "attached" });
    assert.ok(
      (
        await page.locator(".profile-nav-initial img").getAttribute("src")
      ).endsWith("/plugins/profiles/image/master"),
    );
    assert.ok(
      !requests.some((r) => r.auth.includes("expired-original-token")),
      "Expired legacy management token is discarded",
    );
    assert.equal(
      await page.locator('.profile-avatar img[src^="javascript:"]').count(),
      0,
    );
    const originalTheme = await page.locator(".profiles-page").getAttribute("data-profile-theme");
    for (const theme of ["harvest", "snowfall", "bloom"]) {
      await page.locator(".profiles-page").evaluate((node, theme) => node.dataset.profileTheme = theme, theme);
      const artwork = await page.locator(".profiles-page").evaluate(async (node) => {
        const background = getComputedStyle(node).backgroundImage;
        const url = background.match(/url\("?([^"\)]+)"?\)/)[1];
        const image = new Image();
        const loaded = new Promise(resolve => { image.onload = () => resolve(image.naturalWidth); image.onerror = () => resolve(0); });
        image.src = url;
        return { background, width: await loaded };
      });
      assert.ok(artwork.background.includes(theme + ".svg") && artwork.background.includes("linear-gradient"));
      assert.ok(artwork.width >= 240, "Seasonal decoration decodes locally");
      await page.screenshot({ path: "/tmp/ember-bonfire-" + theme + ".png" });
    }
    await page.locator(".profiles-page").evaluate((node, theme) => node.dataset.profileTheme = theme, originalTheme);
    await page.screenshot({ path: "/tmp/wholphin-bonfire-profiles.png" });
    await page
      .getByRole("button", { name: "Kids, PIN required", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("1111");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page.getByText("<b>Incorrect PIN</b>", { exact: true }).waitFor();
    assert.equal(
      await page.locator(".profile-pin-form b").count(),
      0,
      "Server errors remain inert text",
    );
    assert.equal(
      await page.getByLabel("Profile PIN", { exact: true }).inputValue(),
      "",
    );
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("wholphin-session")).user,
      ),
      "master",
    );
    await page.getByLabel("Profile PIN", { exact: true }).fill("9797");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await page.locator("nav [data-nav=kids-library]").waitFor();
    assert.equal(
      await page.locator("header").isVisible(),
      true,
      "Menu restored after successful switch",
    );
    assert.equal(
      await page.locator("nav [data-nav=private-library]").count(),
      0,
    );
    assert.equal(await page.locator("[data-item=private-film]").count(), 0);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wholphin-session")),
    );
    assert.equal(stored.token, "kid-token");
    await page.waitForFunction(
      () => document.querySelector(".profile-nav-initial").textContent === "K",
    );
    await page.waitForFunction(
      () => !document.querySelector(".profile-nav-initial img"),
    );
    assert.equal(stored.profileAccount, undefined);
    assert.ok(
      !JSON.stringify(stored).includes("9797"),
      "PIN is never persisted",
    );
    await page.reload();
    await page
      .getByRole("heading", { name: "Who's watching?", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Parent, PIN required", exact: true })
      .click();
    await page.keyboard.press("Escape");
    await page.locator(".profile-grid:not([hidden])").waitFor();
    assert.equal(
      await page.locator(".profile-pin-form").count(),
      0,
      "Back clears PIN form and returns to profiles",
    );
    mode = "limited";
    await page
      .getByRole("button", { name: "Parent, PIN required", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("1234");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page
      .getByText(
        "Too many PIN attempts. Wait 15 minutes before trying again.",
        { exact: true },
      )
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Unlock profile", exact: true })
        .isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    mode = "invalid";
    await page.getByRole("button", { name: "Guest", exact: true }).click();
    await page
      .getByText("Bonfire returned an invalid profile session.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("wholphin-session")).user,
      ),
      "kid",
    );
    mode = "slow";
    await page.getByRole("button", { name: "Guest", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("wholphin-session")).user,
      ),
      "kid",
      "Cancelled switch cannot replace a later session",
    );
    mode = "normal";
    await page
      .getByRole("button", { name: "Kids, PIN required", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("9797");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    empty = true;
    await page.locator("nav [data-nav=profiles]").click();
    await page.getByText("No profiles are available for this account.",{exact:true}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Sign out",exact:true}).isVisible(),true);
    assert.equal(await page.locator(":focus").textContent(),"Retry profiles");
    await page.screenshot({path:"/private/tmp/ember-ux-profiles.png"});
    empty = false;
    await page.getByRole("button",{name:"Retry profiles",exact:true}).click();
    await page.getByRole("button",{name:"Kids, PIN required",exact:true}).click();
    await page.getByLabel("Profile PIN",{exact:true}).fill("9797");
    await page.getByRole("button",{name:"Unlock profile",exact:true}).click();
    await page.getByRole("heading",{name:"Home",exact:true}).waitFor();
    available = false;
    await page.locator("nav [data-nav=settings]").click();
    await page
      .locator("#main")
      .getByRole("button", { name: "Switch profile", exact: true })
      .click();
    await page
      .getByText(
        "Bonfire is not available on this server. Install the plugin, then retry.",
        { exact: true },
      )
      .waitFor();
    available = true;
    mode = "normal";
    await page
      .getByRole("button", { name: "Retry profiles", exact: true })
      .click();
    await page.getByRole("button", { name: "Guest", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Kids, PIN required", exact: true })
      .click();
    await page.getByLabel("Profile PIN", { exact: true }).fill("9797");
    await page
      .getByRole("button", { name: "Unlock profile", exact: true })
      .click();
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await page.locator("nav [data-nav=settings]").click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
    const logouts = requests.filter((r) => r.path === "/Sessions/Logout");
    assert.ok(
      logouts.some((r) => r.auth.includes("kid-token")),
      "Sign out revokes the active session",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("wholphin-session")),
      null,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: Bonfire detection, avatars, PIN error/rate limit, profile-scoped content, active session management and startup picker, reload, cancellation, malformed session rejection, missing plugin/retry and full sign out",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
