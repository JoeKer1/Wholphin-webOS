const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const calls = [], errors = [];
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.message));
    const item = { Id: "film", Name: "Group movie", Type: "Movie", MediaType: "Video", RunTimeTicks: 1200000000 };
    await page.route("https://jellyfin.test/**", route => {
      const request = route.request(), url = new URL(request.url());
      calls.push({ path: url.pathname, body: request.postDataJSON() });
      if (url.pathname === "/GetUtcTime") {
        const now = new Date(Date.now() + 8000).toISOString();
        return route.fulfill({ json: { RequestReceptionTime: now, ResponseTransmissionTime: now } });
      }
      if (url.pathname === "/SyncPlay/List")
        return route.fulfill({ json: [{ GroupId: "group", GroupName: "Family" }] });
      if (url.pathname.startsWith("/SyncPlay/") || url.pathname.startsWith("/Sessions/"))
        return route.fulfill({ status: 204 });
      if (url.pathname.endsWith("/Views"))
        return route.fulfill({ json: { Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }] } });
      if (url.pathname.endsWith("/Latest")) return route.fulfill({ json: [item] });
      if (url.pathname.endsWith("/Items/film")) return route.fulfill({ json: item });
      if (url.pathname.endsWith("/PlaybackInfo"))
        return route.fulfill({ json: { PlaySessionId: "play", MediaSources: [{ Id: "source", SupportsDirectPlay: true }] } });
      return route.fulfill({ json: { Items: [] } });
    });
    await page.addInitScript(() => {
      localStorage.setItem("wholphin-session", JSON.stringify({ server: "https://jellyfin.test", user: "tester", token: "fixture", name: "Tester" }));
      window.WebSocket = class {
        constructor(url) {
          window.groupSocket = this;
          window.socketUrl = url;
          this.readyState = 0;
          setTimeout(() => { this.readyState = 1; this.onopen(); }, 0);
        }
        send() {}
        close() { this.readyState = 3; }
        emit(type, data) { this.onmessage({ data: JSON.stringify({ MessageType: type, Data: data }) }); }
      };
      const p = HTMLMediaElement.prototype;
      Object.defineProperties(p, {
        src: { get() { return this.source || ""; }, set(value) { this.source = value; this.position = 0; } },
        paused: { get() { return !this.started; } },
        currentTime: { get() { return this.position || 0; }, set(value) {
          this.position = value; setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
        } },
        duration: { get() { return 120; } },
        readyState: { get() { return this.waiting ? 2 : 4; } },
        seeking: { get() { return false; } },
      });
      p.load = function () {
        if (this.source) setTimeout(() => this.dispatchEvent(new Event("loadedmetadata")), 0);
      };
      const remove = Element.prototype.removeAttribute;
      p.removeAttribute = function (name) {
        if (name === "src") this.source = "";
        return remove.call(this, name);
      };
      p.play = function () {
        this.started = true;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      p.pause = function () { this.started = false; this.dispatchEvent(new Event("pause")); };
    });
    await page.goto(pathToFileURL(path.resolve("dist/webos/index.html")).href);
    const sent = (action, count = 1) => expectCall("/SyncPlay/" + action, count);
    async function expectCall(endpoint, count) {
      for (let i = 0; calls.filter(call => call.path === endpoint).length < count && i < 100; i++)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(calls.filter(call => call.path === endpoint).length >= count, "Missing request " + endpoint);
      return calls.filter(call => call.path === endpoint).at(-1).body;
    }
    const command = (name, ticks, offset = 0, playlistId = "entry") => page.evaluate(({ name, ticks, offset, playlistId }) => {
      groupSocket.emit("SyncPlayCommand", {
        Command: name, PlaylistItemId: playlistId, PositionTicks: ticks,
        When: new Date(Date.now() + 8000 + offset).toISOString(),
      });
    }, { name, ticks, offset, playlistId });
    await page.locator("nav [data-nav=watch-together]").click();
    await page.getByRole("button", { name: "Join Family", exact: true }).click();
    assert.deepEqual(await sent("Join"), { GroupId: "group" });
    await page.getByText("Group: Family", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => new URL(socketUrl).protocol), "wss:");
    await page.evaluate(() => groupSocket.emit("SyncPlayGroupUpdate", {
      Type: "PlayQueue", Data: { Playlist: [{ ItemId: "film", PlaylistItemId: "entry" }], PlayingItemIndex: 0, StartPositionTicks: 300000000 },
    }));
    const ready = await sent("Ready");
    assert.equal(ready.PlaylistItemId, "entry");
    assert.equal(ready.PositionTicks, 300000000);
    assert.equal(ready.IsPlaying, false);
    await command("Unpause", 300000000, 300);
    assert.equal(await page.locator("#video").evaluate(video => video.paused), true);
    await page.waitForFunction(() => !document.querySelector("#video").paused);
    await page.locator("#toggle").evaluate(button => button.click());
    await sent("Pause");
    assert.equal(await page.locator("#video").evaluate(video => video.paused), false, "Local controls wait for the server");
    await command("Pause", 300000000, 0, "old-entry");
    await command("Pause", 310000000);
    await page.waitForFunction(() => document.querySelector("#video").paused && document.querySelector("#video").currentTime === 31);
    await page.locator("#forward").evaluate(button => button.click());
    assert.deepEqual(await sent("Seek"), { PositionTicks: 610000000 });
    await command("Seek", 610000000);
    await page.waitForFunction(() => document.querySelector("#video").currentTime === 61);
    await command("Unpause", 610000000);
    await page.waitForFunction(() => !document.querySelector("#video").paused);
    const priorReady = calls.filter(call => call.path === "/SyncPlay/Ready").length;
    await page.locator("#video").evaluate(video => { video.waiting = true; video.dispatchEvent(new Event("waiting")); });
    assert.equal((await sent("Buffering")).PlaylistItemId, "entry");
    await page.locator("#video").evaluate(video => { video.waiting = false; video.dispatchEvent(new Event("canplay")); });
    await sent("Ready", priorReady + 1);
    await page.locator("#leave-watch-group").evaluate(button => button.click());
    await sent("Leave");
    await page.locator("#player[hidden]").waitFor({ state: "attached" });
    await page.locator("nav [data-nav=watch-together]").click();
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    assert.ok((await sent("New")).GroupName);
    await page.getByRole("button", { name: "Leave group", exact: true }).waitFor();
    await page.locator("nav [data-nav=home]").click();
    await page.getByRole("button", { name: "Group movie", exact: true }).first().click();
    await page.getByRole("button", { name: "Play from beginning", exact: true }).click();
    assert.deepEqual(await sent("SetNewQueue"), { PlayingQueue: ["film"], PlayingItemPosition: 0, StartPositionTicks: 0 });
    assert.deepEqual(errors, []);
    console.log("PASS: Watch Together group join/create/leave, clock scheduling, remote and local controls, buffering, and group queue");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
