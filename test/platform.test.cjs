const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
function fixture() {
  const events = [],
    calls = [],
    parent = {
      hidden: false,
      insertBefore() {},
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 1920, height: 1080 };
      },
    },
    element = {
      style: { objectFit: "contain" },
      parentNode: parent,
      dispatchEvent(e) {
        events.push(e.type);
        this["on" + e.type]?.(e);
      },
      addEventListener() {},
      removeEventListener() {},
      removeAttribute() {},
    };
  let listener,
    prepared,
    seekSuccess,
    state = "NONE",
    live = false;
  const av = {
    getState: () => state,
    stop() {
      calls.push("stop");
      state = "IDLE";
    },
    close() {
      calls.push("close");
      state = "NONE";
    },
    open(url) {
      calls.push(["open", url]);
      state = "IDLE";
    },
    setListener(x) {
      listener = x;
    },
    setDisplayRect(...r) {
      calls.push(["rect", ...r]);
    },
    setDisplayMethod(x) {
      calls.push(["fit", x]);
    },
    prepareAsync(ok) {
      prepared = () => {
        state = "READY";
        ok();
      };
    },
    play() {
      calls.push("play");
      state = "PLAYING";
    },
    pause() {
      calls.push("pause");
      state = "PAUSED";
    },
    seekTo(ms, ok) {
      calls.push(["seek", ms]);
      seekSuccess = ok;
    },
    getDuration: () => 120000,
    getStreamingProperty: (k) =>
      k === "IS_LIVE" ? String(live) : "10000|60000",
    setSilentSubtitle() {},
  };
  const root = { innerWidth: 1920, addEventListener() {} };
  const context = {
    window: root,
    document: {
      createElement() {
        return {};
      },
      body: {},
    },
    MutationObserver: class {
      observe() {}
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    Number,
    Promise,
    Error,
  };
  vm.runInNewContext(
    fs.readFileSync("platforms/tizen/avplay.js", "utf8"),
    context,
  );
  return {
    p: root.EmberAVPlay(element, av),
    events,
    calls,
    ready: () => prepared(),
    time: (ms) => listener.oncurrentplaytime(ms),
    seekDone: () => seekSuccess(),
    ended: () => listener.onstreamcompleted(),
    setLive: () => (live = true),
    capture: () => ({ ready: prepared, time: listener.oncurrentplaytime }),
    parent,
  };
}
test("AVPlay prepares asynchronously, seeks in milliseconds and preserves paused state", async () => {
  const f = fixture();
  f.p.src = "https://media.test/movie.m3u8#t=30";
  f.p.load();
  let played = false;
  const ready = f.p.play().then(() => (played = true));
  assert.equal(played, false);
  f.ready();
  await ready;
  assert.equal(f.p.paused, false);
  assert.ok(
    f.calls.some(
      (x) =>
        Array.isArray(x) &&
        x[0] === "open" &&
        x[1] === "https://media.test/movie.m3u8",
    ),
  );
  f.p.currentTime = 30;
  assert.equal(f.p.seeking, true);
  f.seekDone();
  assert.equal(f.p.currentTime, 30);
  assert.ok(
    f.calls.some((x) => Array.isArray(x) && x[0] === "seek" && x[1] === 30000),
  );
  f.p.pause();
  f.p.currentTime = 45;
  f.seekDone();
  assert.equal(f.p.paused, true);
  assert.equal(f.p.duration, 120);
  assert.ok(f.events.includes("loadedmetadata"));
  f.p.removeAttribute("src");
  f.p.load();
  assert.equal(f.p.src, "");
  assert.ok(f.calls.includes("close"));
});
test("AVPlay ignores stale preparation and time callbacks after source replacement", async () => {
  const f = fixture();
  f.p.src = "https://media.test/old";
  f.p.load();
  const old = f.capture(),
    oldReady = old.ready,
    oldTime = old.time;
  const pending = f.p.play();
  f.p.src = "https://media.test/new";
  f.p.load();
  await assert.rejects(pending, /cancelled/);
  oldReady();
  oldTime(90000);
  assert.equal(f.p.currentTime, 0);
  assert.equal(f.calls.filter((x) => x === "play").length, 0);
});
test("AVPlay exposes only a valid live seek range and updates preview bounds", async () => {
  const f = fixture();
  f.setLive();
  f.p.src = "https://media.test/live";
  f.p.load();
  const ready = f.p.play();
  f.ready();
  await ready;
  assert.equal(f.p.duration, Infinity);
  assert.equal(f.p.seekable.length, 0);
  f.time(30000);
  assert.equal(f.p.seekable.length, 1);
  assert.equal(f.p.seekable.start(0), 10);
  assert.equal(f.p.seekable.end(0), 60);
  f.parent.getBoundingClientRect = () => ({
    left: 1400,
    top: 24,
    width: 480,
    height: 270,
  });
  f.time(31000);
  assert.ok(
    f.calls.some(
      (x) =>
        Array.isArray(x) && x[0] === "rect" && x[1] === 1400 && x[3] === 480,
    ),
  );
});
