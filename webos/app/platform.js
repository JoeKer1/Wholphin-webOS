(function (root) {
  "use strict";
  root.EmberPlatform = {
    id: "webos",
    deviceName: "LG TV",
    nativePlayback: true,
    keyCode: function (event) {
      return event.keyCode;
    },
    createPlayer: function (element) {
      return element;
    },
  };
})(window);
