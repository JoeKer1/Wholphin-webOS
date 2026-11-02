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
      requests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let failText = false,
      holdText = false,
      releaseText = null;
    let downloads = 0, refreshes = 0, denySearch = false, pending = null;
    const native = process.env.NATIVE_DOWNLOAD === "1";
    const item = {
      Id: "movie",
      Name: "Subtitle test",
      MediaType: "Video",
      Type: "Movie",
      RunTimeTicks: 18000000000,
      Chapters: [],
    };
    const source = {
      Id: "source",
      Container: "mp4",
      DefaultAudioStreamIndex: 2,
      DefaultSubtitleStreamIndex: 9,
      MediaStreams: [
        { Type: "Video", Index: 1, Codec: "h264", VideoRangeType: "SDR", Width: 1920, Height: 1080, BitDepth: 8 },
        {
          Type: "Audio",
          Index: 2,
          Codec: "aac",
          Language: "eng",
          DisplayTitle: "English stereo",
        },
        {
          Type: "Subtitle",
          Index: 9,
          Codec: "srt",
          Language: "eng",
          DisplayTitle: "English text",
        },
        {
          Type: "Subtitle",
          Index: 12,
          Codec: "pgssub",
          Language: "spa",
          DisplayTitle: "Spanish image",
        },
        {
          Type: "Subtitle",
          Index: 14,
          Codec: "ass",
          Language: "jpn",
          DisplayTitle: "Japanese ASS",
        },
      ],
    };
    await page.route("https://jellyfin.test/**", async (route) => {
      const request = route.request(),
        u = new URL(request.url()),
        body = request.postDataJSON();
      requests.push({
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        body,
        method: request.method(),
      });
      if (u.pathname === "/Localization/Languages") return route.fulfill({json: [{Name:"Dutch", ThreeLetterISOLanguageName:"nld"}]});
      if (u.pathname.includes("/RemoteSearch/Subtitles/")) {
        if (denySearch) return route.fulfill({status:403,json:{}});
        if (request.method() === "POST") {
          downloads++;
          refreshes=0;
          pending = [{Type:"Subtitle", Index:0, Codec:"subrip", Language:"eng", IsExternal:true, Path:"/download-"+downloads+".srt", DisplayTitle:"Downloaded "+downloads}].concat(source.MediaStreams.map(t=>({...t,Index:t.Index+1})));
          return route.fulfill({status:204});
        }
        return route.fulfill({json:[
          {Id:"bad",Name:"Bitmap",Format:"pgs"},
          {Id:"provider/result?1",Name:'<img src=x onerror="window.downloadXSS=1">',ProviderName:"OpenSubtitles",Format:"srt",IsHashMatch:true,HearingImpaired:true},
          {Id:"other",Name:"Other result",Format:"vtt"}
        ]});
      }
      if (u.pathname === "/Items/movie/PlaybackInfo" && request.method() === "GET" && pending && ++refreshes >= 2) {
        source.MediaStreams=pending;pending=null;
        source.DefaultAudioStreamIndex++;
        source.DefaultSubtitleStreamIndex++;
      }
      let json = { Items: [] };
      if (u.pathname.endsWith("/Views"))
        json = {
          Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }],
        };
      if (u.pathname.endsWith("/Latest")) json = { Items: [item] }.Items;
      if (u.pathname === "/Users/user/Items/movie") json = item;
      if (u.pathname === "/Items/movie/PlaybackInfo")
        json = {
          PlaySessionId: "session-" + requests.length,
          MediaSources: [
            {
              ...source,
              SupportsDirectPlay: !body || body.EnableDirectPlay,
              TranscodingUrl: "/Videos/movie/master.m3u8?api_key=mock",
            },
          ],
        };
      if (u.pathname.includes("/Subtitles/")) {
        if (holdText) await new Promise((r) => (releaseText = r));
        if (failText) return route.fulfill({ status: 404, json: {} });
        return route.fulfill({
          contentType: "text/vtt",
          body: 'WEBVTT\n\n00:01:39.000 --> 00:01:41.000\nHello &amp; &lt;img src=x onerror="window.subtitleXSS=1"&gt;\n\n00:01:42.000 --> 00:01:50.000\nNext subtitle',
        });
      }
      if (
        u.pathname.includes("/Sessions/") ||
        u.pathname.endsWith("/ActiveEncodings")
      )
        return route.fulfill({ status: 204 });
      return route.fulfill({ json });
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "wholphin-session",
        JSON.stringify({
          server: "https://jellyfin.test",
          user: "user",
          token: "mock",
          name: "Test",
        }),
      );
      const p = HTMLMediaElement.prototype;
      Object.defineProperties(p, {
        src: {
          get() {
            return this._src || "";
          },
          set(v) {
            this._src = v;
            this._time = 0;
          },
        },
        currentTime: {
          get() {
            return this._time || 0;
          },
          set(v) {
            this._time = v;
            setTimeout(() => this.dispatchEvent(new Event("seeked")), 0);
          },
        },
        duration: {
          get() {
            return 1800;
          },
        },
        readyState: {
          get() {
            return 4;
          },
        },
        seeking: {
          get() {
            return false;
          },
        },
        paused: {
          get() {
            return !this._playing;
          },
        },
      });
      p.load = function () {
        if (this._src)
          setTimeout(() => this.dispatchEvent(new Event("loadedmetadata")), 0);
      };
      p.play = function () {
        this._playing = true;
        this.dispatchEvent(new Event("play"));
        this.dispatchEvent(new Event("playing"));
        return Promise.resolve();
      };
      p.pause = function () {
        this._playing = false;
        this.dispatchEvent(new Event("pause"));
      };
      const remove = Element.prototype.removeAttribute;
      p.removeAttribute = function (name) {
        if (name === "src") this._src = "";
        return remove.call(this, name);
      };
    });
    if (native) await page.addInitScript(() => {
      window.downloadNativeCommands = [];
      window.downloadNativeState = { position: 0, duration: 1800000, paused: true, id: 0 };
      window.EmberAndroid = {
        capabilities: () => JSON.stringify({ videos: [{codec:"h264",width:1920,height:1080,bitDepth:8,frameRate:60,bitrate:40000000,level:42}], audio:["aac"], maxAudioChannels:2 }),
        command(raw) {
          const command=JSON.parse(raw); downloadNativeCommands.push(command);
          const emit=type=>setTimeout(()=>EmberFireTV.receive({...downloadNativeState,type}),0);
          if(command.action==="load") { downloadNativeState={position:0,duration:1800000,paused:true,id:command.id}; emit("loadedmetadata"); }
          if(command.action==="play") {downloadNativeState.paused=false;emit("play");emit("playing");}
          if(command.action==="pause") {downloadNativeState.paused=true;emit("pause");}
          if(command.action==="seek") {downloadNativeState.position=command.ms;emit("seeked");}
          if(command.action==="tracks") emit("trackschanged");
        }
      };
    });
    const click = (name) =>
      page.getByRole("button", { name, exact: true }).click();
    const infos = () =>
      requests.filter(
        (r) => r.path === "/Items/movie/PlaybackInfo" && r.method === "POST",
      );
    const starts = () => requests.filter((r) => r.path === "/Sessions/Playing");
    async function wait(fn) {
      for (let n = 0; n < 150; n++) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Condition not met");
    }
    async function at(t) {
      if (native) { await page.locator("#timeline").evaluate((node,t)=>{node.value=t;node.dispatchEvent(new Event("input"));},t); return; }
      await page.locator("#video").evaluate((v, t) => {
        v.currentTime = t;
        v.dispatchEvent(new Event("timeupdate"));
      }, t);
    }
    async function subs() {
      if (await page.locator("#player-tools").isHidden())
        await page.locator("#player-options").click();
      await page.locator("#subtitles").click();
    }
    async function appearance() {
      await subs();
      await page
        .locator("#playback-panel")
        .getByRole("button", { name: "Subtitle appearance", exact: true })
        .click();
      await page.locator("#playback-panel .subtitle-preview").waitFor();
    }
    await page.goto(
      pathToFileURL(
        path.join(
          process.env.APP_DIR || path.resolve(__dirname, "../app"),
          "index.html",
        ),
      ).href,
    );
    await click("Subtitle test");
    await page.getByRole("combobox",{name:"Subtitles before playback"}).click();
    await page.locator("button:visible").filter({hasText:/^Find subtitles…$/}).click();
    await page.locator("#subtitle-search").waitFor({state:"visible"});
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator("#subtitle-search-language").evaluate(n=>n===document.activeElement),true);
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator("#subtitle-search").getByRole("button",{name:"Search",exact:true}).evaluate(n=>n===document.activeElement),true);
    await page.locator("#subtitle-search").getByRole("button",{name:"Search",exact:true}).click();
    const result = page.locator("#subtitle-search button").filter({hasText:"Download and use:"}).first();
    await result.waitFor();
    if (!native) await page.screenshot({path:"/private/tmp/ember-subtitle-download.png"});
    assert.match(await result.textContent(), /Exact file match.*Hearing impaired/);
    assert.equal(await page.locator("#subtitle-search img").count(),0);
    assert.equal(await page.getByRole("button",{name:/Download and use: Bitmap/}).count(),0);
    await result.click();
    await page.locator("#subtitle-search").waitFor({state:"hidden"});
    assert.equal(downloads,1);
    assert.equal(refreshes,2);
    assert(requests.some(r=>r.method === "POST" && r.path.endsWith("/RemoteSearch/Subtitles/provider%2Fresult%3F1")));
    assert.equal(await page.getByRole("combobox",{name:"Subtitles before playback"}).inputValue().catch(()=>page.getByRole("combobox",{name:"Subtitles before playback"}).evaluate(n=>n.value)),"0");
    await click("Play from beginning");
    await wait(()=>starts().length===1);
    await at(100);
    await page.locator("#toggle").click();
    await subs();
    await page.locator("button:visible").filter({hasText:/^Find subtitles…$/}).click();
    await page.locator("#subtitle-search").getByRole("button",{name:"Search",exact:true}).click();
    await result.click();
    await page.locator("#subtitle-search").waitFor({state:"hidden"});
    await wait(()=>page.locator("#playback-panel").isHidden());
    assert.equal(downloads,2);
    await wait(()=>starts().length === (native ? 2 : 1));
    assert.equal(starts().length,native ? 2 : 1,"Only new native sidecars require a reload");
    if (native) {
      const loads=await page.evaluate(()=>downloadNativeCommands.filter(c=>c.action==="load"));
      assert.equal(loads.length,2);
      assert.equal(loads.at(-1).tracks.externalIndex,0);
      assert.equal(loads.at(-1).tracks.audio,0);
      assert.equal(loads.at(-1).tracks.external.length,2);
    }
    assert.equal(await page.locator("#player").isHidden(),false);
    assert.equal(await page.locator("#timeline").evaluate(v=>Number(v.value)),100);
    assert.equal(await page.locator("#toggle").getAttribute("aria-label"),"Play");
    await subs();
    await page.locator("button:visible").filter({hasText:/^Find subtitles…$/}).click();
    denySearch=true;
    await page.locator("#subtitle-search").getByRole("button",{name:"Search",exact:true}).click();
    await page.getByText("This Jellyfin account does not have permission to search or download subtitles.").waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#subtitle-search").isHidden(),true);
    assert.equal(await page.locator("#player").isHidden(),false);
    assert.equal(await page.locator("#playback-panel").isHidden(),false);
    assert.equal(await page.evaluate(()=>window.downloadXSS),undefined);
    assert.deepEqual(errors,[]);
    console.log("Subtitle download browser checks passed");
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
