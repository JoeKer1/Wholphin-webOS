(function (root) {
  "use strict";
  var receive = function () {};
  function command(action, values) {
    root.EmberAndroid.command(JSON.stringify(Object.assign({ action: action }, values || {})));
  }
  root.EmberFireTV = {
    receive: function (data) { receive(data); },
    key: function (code) {
      if (code === 457 && !document.getElementById("player").hidden && !document.body.classList.contains("live-preview")) {
        document.getElementById("player-options").click();
        return;
      }
      document.dispatchEvent(new KeyboardEvent("keydown", { keyCode: code, which: code, bubbles: true, cancelable: true }));
    },
  };
  function capabilities() {
    try { return JSON.parse(root.EmberAndroid.capabilities()); } catch (_) { return {}; }
  }
  // HTTPS WebViews block HTTP <img> requests even with mixed-content enabled.
  // Fetch keeps LAN HTTP support, while blob URLs remain local to this page.
  var imageRequests = new WeakMap();
  function loadImage(img, url) {
    var request = {};
    imageRequests.set(img, request);
    if (!/^http:\/\//i.test(url)) { img.src = url; return; }
    fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" })
      .then(function (response) {
        if (!response.ok) throw new Error("Image unavailable");
        return response.blob();
      })
      .then(function (blob) {
        if (imageRequests.get(img) !== request) return;
        var source = URL.createObjectURL(blob);
        function release() {
          URL.revokeObjectURL(source);
          img.removeEventListener("load", release);
          img.removeEventListener("error", release);
        }
        img.addEventListener("load", release);
        img.addEventListener("error", release);
        img.src = source;
      })
      .catch(function () {
        if (imageRequests.get(img) === request) img.dispatchEvent(new Event("error"));
      });
  }
  root.EmberPlatform = {
    loadImage: loadImage,
    nativeSubtitle: function (source, index) { return root.EmberFirePlayback.nativeSubtitle(source, index); },
    playbackPolicy: function (source, options, index) { return root.EmberFirePlayback.policy(source, options, index, capabilities()); },
    playbackProfile: function (fallback) { return root.EmberFirePlayback.profile(capabilities(), fallback); },
    playbackTracks: function () { return root.EmberFirePlayback.tracks.apply(null, arguments); },
    id: "firetv",
    deviceName: "Fire TV",
    playbackName: "Fire TV Media3",
    nativePlayback: false,
    keyCode: function (event) { return event.keyCode; },
    exit: function () { command("exit"); },
    createPlayer: function (element) {
      var source = "", id = 0, ready = false, paused = true, seeking = false,
        time = 0, duration = NaN, width = 0, height = 0, error = null, trackChange = null,
        range = null, pending = [], lastRect = "", tracks = { audio: -1, subtitle: -1 };
      function settleTracks(reason) {
        if (!trackChange) return;
        root.clearTimeout(trackChange.timer);
        var change = trackChange; trackChange = null;
        if (reason) change.reject(reason); else change.resolve();
      }
      function emit(type) { element.dispatchEvent(new Event(type)); }
      function settle(reason) {
        var jobs = pending;
        pending = [];
        jobs.forEach(function (job) { if (reason) job.reject(reason); else job.resolve(); });
      }
      function send(action, values) { command(action, Object.assign({ id: id }, values || {})); }
      function rect() {
        if (!source || element.parentNode.hidden) return;
        var bounds = element.parentNode.getBoundingClientRect(),
          values = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height,
            viewportWidth: innerWidth, viewportHeight: innerHeight, fill: element.style.objectFit === "cover" },
          key = JSON.stringify(values);
        if (key !== lastRect) { send("rect", values); lastRect = key; }
      }
      receive = function (data) {
        if (data.id !== id || !source) return;
        if (data.type === "trackschanged" || data.type === "tracksfailed") {
          settleTracks(data.type === "tracksfailed" ? new Error("Native subtitle track is unavailable") : null);
          return;
        }
        time = Math.max(0, Number(data.position) || 0) / 1000;
        duration = data.live ? Infinity : data.duration > 0 ? data.duration / 1000 : NaN;
        if (typeof data.paused === "boolean") paused = data.paused;
        width = data.width || 0; height = data.height || 0;
        range = data.seekEnd > data.seekStart ? [data.seekStart / 1000, data.seekEnd / 1000] : null;
        if (data.type === "loadedmetadata") ready = true;
        if (data.type === "seeked") seeking = false;
        if (data.type === "playing") settle();
        if (data.type === "ended") paused = true;
        if (data.type === "error") {
          error = { code: 4, message: "Fire TV playback failed." };
          settle(new Error(error.message));
        }
        rect();
        emit(data.type);
      };
      var player = {
        style: element.style,
        addEventListener: element.addEventListener.bind(element),
        removeEventListener: element.removeEventListener.bind(element),
        configure: function (value) { tracks = value; },
        selectTracks: function (value) {
          if (!source || !ready || value.unavailable) return Promise.reject(new Error("Native tracks are unavailable"));
          settleTracks(new Error("Track change replaced"));
          return new Promise(function (resolve, reject) {
            trackChange = { resolve: resolve, reject: reject, timer: root.setTimeout(function () { settleTracks(new Error("Track change timed out")); }, 5000) };
            send("tracks", { tracks: value });
          });
        },
        load: function () {
          settle(new Error("Playback cancelled."));
          settleTracks(new Error("Playback cancelled."));
          send("close");
          id++;
          ready = false; paused = true; seeking = false;
          time = 0; duration = NaN; range = null; error = null; lastRect = "";
          if (source) { send("load", { url: source.split("#")[0], tracks: tracks }); rect(); }
        },
        play: function () {
          return new Promise(function (resolve, reject) {
            if (!source) return reject(new Error("No playback source."));
            pending.push({ resolve: resolve, reject: reject });
            send("play");
          });
        },
        pause: function () { paused = true; send("pause"); },
        removeAttribute: function (name) { if (name === "src") source = ""; },
      };
      Object.defineProperties(player, {
        src: { get: function () { return source; }, set: function (value) { source = value; } },
        currentTime: { get: function () { return time; }, set: function (value) {
          if (!ready || !Number.isFinite(value)) return;
          seeking = true; send("seek", { ms: Math.max(0, Math.round(value * 1000)) });
        } },
        duration: { get: function () { return duration; } },
        paused: { get: function () { return paused; } },
        seeking: { get: function () { return seeking; } },
        readyState: { get: function () { return ready ? 4 : 0; } },
        error: { get: function () { return error; } },
        videoWidth: { get: function () { return width; } },
        videoHeight: { get: function () { return height; } },
        seekable: { get: function () { return { length: range ? 1 : 0,
          start: function () { return range[0]; }, end: function () { return range[1]; } }; } },
      });
      ["loadedmetadata", "seeked", "timeupdate", "playing", "play", "pause", "ended", "error"].forEach(function (name) {
        Object.defineProperty(player, "on" + name, {
          get: function () { return element["on" + name]; },
          set: function (handler) { element["on" + name] = handler; },
        });
      });
      new MutationObserver(rect).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden"] });
      root.addEventListener("resize", rect);
      return player;
    },
  };
  document.documentElement.classList.add("platform-firetv");
  if (!root.CSS || !CSS.supports("display", "grid")) document.documentElement.classList.add("legacy-grid");
})(window);
