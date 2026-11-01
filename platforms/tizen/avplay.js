(function (root) {
  "use strict";
  root.EmberAVPlay = function (element, av) {
    var source = "",
      generation = 0,
      ready = false,
      paused = true,
      wantPlay = false,
      clock = 0,
      duration = NaN,
      seeking = false,
      error = null,
      pending = [],
      lastRect = "";
    var object = document.createElement("object");
    object.type = "application/avplayer";
    object.id = "av-player";
    element.parentNode.insertBefore(object, element);
    function emit(name) {
      element.dispatchEvent(new Event(name));
    }
    function rejectPending(reason) {
      var jobs = pending;
      pending = [];
      jobs.forEach(function (job) {
        job.reject(reason);
      });
    }
    function fail() {
      ready = false;
      error = { code: 4, message: "Samsung playback failed." };
      rejectPending(new Error(error.message));
      emit("error");
    }
    function close() {
      generation++;
      ready = false;
      paused = true;
      wantPlay = false;
      seeking = false;
      lastRect = "";
      rejectPending(new Error("Playback cancelled."));
      try {
        if (av.getState() !== "NONE") av.stop();
        av.close();
      } catch (_) {}
    }
    function syncRect() {
      if (
        !source ||
        !element.parentNode ||
        element.parentNode.hidden ||
        seeking
      )
        return;
      var rect = element.parentNode.getBoundingClientRect(),
        scale = 1920 / root.innerWidth,
        key = [
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          element.style.objectFit,
        ].join(":");
      if (key === lastRect) return;
      try {
        av.setDisplayRect(
          Math.round(rect.left * scale),
          Math.round(rect.top * scale),
          Math.max(1, Math.round(rect.width * scale)),
          Math.max(1, Math.round(rect.height * scale)),
        );
        av.setDisplayMethod(
          element.style.objectFit === "cover"
            ? "PLAYER_DISPLAY_MODE_FULL_SCREEN"
            : "PLAYER_DISPLAY_MODE_LETTER_BOX",
        );
        lastRect = key;
      } catch (_) {}
    }
    function start() {
      if (!ready || seeking) return;
      if (!wantPlay) {
        var waiting = pending;
        pending = [];
        waiting.forEach(function (job) {
          job.resolve();
        });
        return;
      }
      try {
        av.play();
        paused = false;
        syncRect();
        emit("play");
        emit("playing");
        var jobs = pending;
        pending = [];
        jobs.forEach(function (job) {
          job.resolve();
        });
      } catch (_) {
        fail();
      }
    }
    function load() {
      close();
      clock = 0;
      duration = NaN;
      error = null;
      if (!source) return;
      var token = generation;
      try {
        av.open(source.split("#")[0]);
        av.setListener({
          oncurrentplaytime: function (ms) {
            if (token !== generation) return;
            clock = ms / 1000;
            syncRect();
            emit("timeupdate");
          },
          onstreamcompleted: function () {
            if (token !== generation) return;
            paused = true;
            emit("ended");
          },
          onerror: function () {
            if (token === generation) fail();
          },
          onbufferingstart: function () {
            if (token === generation) emit("waiting");
          },
          onbufferingcomplete: function () {
            if (token === generation && !paused) emit("playing");
          },
        });
        syncRect();
        av.prepareAsync(
          function () {
            if (token !== generation) return;
            ready = true;
            try {
              duration =
                av.getStreamingProperty("IS_LIVE").toLowerCase() === "true"
                  ? Infinity
                  : av.getDuration() / 1000;
              av.setSilentSubtitle(true);
            } catch (_) {
              duration = av.getDuration() / 1000;
            }
            emit("loadedmetadata");
            if (pending.length) start();
          },
          function () {
            if (token === generation) fail();
          },
        );
      } catch (_) {
        if (token === generation) fail();
      }
    }
    var player = {
      style: element.style,
      load: load,
      play: function () {
        return new Promise(function (resolve, reject) {
          if (error) {
            reject(new Error(error.message));
            return;
          }
          wantPlay = true;
          pending.push({ resolve: resolve, reject: reject });
          start();
        });
      },
      pause: function () {
        wantPlay = false;
        if (ready && !paused && !seeking) {
          try {
            av.pause();
          } catch (_) {}
        }
        paused = true;
        emit("pause");
      },
      removeAttribute: function (name) {
        if (name === "src") source = "";
        else element.removeAttribute(name);
      },
      addEventListener: element.addEventListener.bind(element),
      removeEventListener: element.removeEventListener.bind(element),
    };
    Object.defineProperties(player, {
      src: {
        get: function () {
          return source;
        },
        set: function (value) {
          source = value || "";
        },
      },
      currentTime: {
        get: function () {
          return clock;
        },
        set: function (seconds) {
          if (!ready || seeking || !Number.isFinite(seconds)) return;
          var token = generation;
          seeking = true;
          try {
            av.seekTo(
              Math.max(0, Math.round(seconds * 1000)),
              function () {
                if (token !== generation) return;
                clock = seconds;
                seeking = false;
                emit("seeked");
                emit("timeupdate");
                if (pending.length) start();
              },
              function () {
                if (token !== generation) return;
                seeking = false;
                emit("seeked");
                if (pending.length) start();
              },
            );
          } catch (_) {
            seeking = false;
          }
        },
      },
      duration: {
        get: function () {
          return duration;
        },
      },
      paused: {
        get: function () {
          return paused;
        },
      },
      seeking: {
        get: function () {
          return seeking;
        },
      },
      error: {
        get: function () {
          return error;
        },
      },
      videoWidth: {
        get: function () {
          return 0;
        },
      },
      videoHeight: {
        get: function () {
          return 0;
        },
      },
      seekable: {
        get: function () {
          var from = 0,
            to = duration;
          try {
            if (duration === Infinity) {
              var values = av
                .getStreamingProperty("GET_LIVE_DURATION")
                .split("|");
              from = Number(values[0]) / 1000;
              to = Number(values[1]) / 1000;
            }
          } catch (_) {
            to = NaN;
          }
          var valid =
            ready &&
            Number.isFinite(from) &&
            Number.isFinite(to) &&
            to > from &&
            clock >= from - 1 &&
            clock <= to + 5;
          return {
            length: valid ? 1 : 0,
            start: function () {
              return from;
            },
            end: function () {
              return to;
            },
          };
        },
      },
    });
    [
      "loadedmetadata",
      "timeupdate",
      "playing",
      "play",
      "pause",
      "ended",
      "error",
    ].forEach(function (name) {
      Object.defineProperty(player, "on" + name, {
        get: function () {
          return element["on" + name];
        },
        set: function (handler) {
          element["on" + name] = handler;
        },
      });
    });
    new MutationObserver(syncRect).observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    root.addEventListener("resize", syncRect);
    return player;
  };
})(window);
