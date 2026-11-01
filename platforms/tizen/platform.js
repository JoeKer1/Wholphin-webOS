(function (root) {
  "use strict";
  root.EmberPlatform = {
    id: "tizen",
    deviceName: "Samsung TV",
    nativePlayback: false,
    keyCode: function (event) {
      return event.keyCode === 10009
        ? 27
        : event.keyCode === 10252
          ? 179
          : event.keyCode;
    },
    exit: function () {
      root.tizen.application.getCurrentApplication().exit();
    },
    createPlayer: function (element) {
      return root.webapis && root.webapis.avplay
        ? root.EmberAVPlay(element, root.webapis.avplay)
        : element;
    },
  };
  document.documentElement.classList.add("platform-tizen");
  if (!root.CSS || !CSS.supports("display", "grid"))
    document.documentElement.classList.add("legacy-grid");
  try {
    [
      "MediaPlay",
      "MediaPause",
      "MediaPlayPause",
      "MediaStop",
      "MediaRewind",
      "MediaFastForward",
    ].forEach(function (key) {
      try {
        root.tizen.tvinputdevice.registerKey(key);
      } catch (_) {}
    });
  } catch (_) {}
})(window);
