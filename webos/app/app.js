(function () {
  "use strict";
  var C = window.WholphinCore,
    main = document.getElementById("main"),
    nav = document.getElementById("nav"),
    status = document.getElementById("status"),
    video = document.getElementById("video"),
    player = document.getElementById("player");
  var session = null,
    playing = null,
    stack = [],
    revision = 0,
    timer = null,
    busy = false,
    controlsTimer = null,
    resumeTimer = null,
    libraryItems = [],
    contentFocus = null,
    previewTimer = null,
    backdropRequest = 0,
    previewCache = new Map(),
    libraryRequest = null,
    libraryUpdated = 0,
    navSignature = null,
    homeCache = new Map(),
    homeRowObserver = null,
    posterObserver = null,
    backdropTimer = null,
    backdropLoading = null,
    logoTimer = null,
    logoRequest = 0,
    homeController = null,
    cancelQuickConnect = null,
    queueItems = [],
    playRequest = 0,
    playController = null,
    panelReturnFocus = null,
    infoController = null,
    listingStates = new Map(),
    activeListing = null;
  var device = localStorage.getItem("wholphin-device");
  if (!device) {
    device = "webos-" + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem("wholphin-device", device);
  }
  try {
    session = JSON.parse(localStorage.getItem("wholphin-session"));
  } catch (_) {}
  function el(tag, text, parent) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function button(text, action, parent) {
    var b = el("button", text, parent);
    b.onclick = function () {
      run(action);
    };
    return b;
  }
  function message(text) {
    status.textContent = text || "";
  }
  function run(action) {
    Promise.resolve()
      .then(action)
      .catch(function (error) {
        message(error.message || "Something went wrong.");
      });
  }
  function auth(context) {
    return (
      'MediaBrowser Client="Wholphin webOS", Device="LG TV", DeviceId="' +
      device +
      '", Version="0.2.9"' +
      (context && context.token ? ', Token="' + context.token + '"' : "")
    );
  }
  async function api(path, values, body, method, options) {
    options = options || {};
    var context = options.session || session,
      controller = new AbortController(),
      signal = options.signal,
      timeout = setTimeout(function () {
        controller.abort();
      }, 20000);
    function abort() {
      controller.abort();
    }
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort);
    }
    try {
      var response = await fetch(
        context.server + path + (values ? "?" + C.query(values) : ""),
        {
          signal: controller.signal,
          method: method || (body ? "POST" : "GET"),
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          headers: {
            Authorization: auth(context),
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!response.ok) {
        var error = new Error(
          response.status === 401
            ? "Sign-in expired or incorrect credentials. Sign out and try again."
            : "Jellyfin request failed (" + response.status + ").",
        );
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : await response.json();
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }
  function focusFirst() {
    var node =
      main.querySelector("input,button,select") || nav.querySelector("button");
    if (node) node.focus();
  }
  function reset(title) {
    revision++;
    if (activeListing) {
      activeListing.dispose();
      activeListing = null;
    }
    if (busy && playController) {
      playRequest++;
      playController.abort();
    }
    if (cancelQuickConnect) cancelQuickConnect();
    if (homeController) homeController.abort();
    clearTimeout(previewTimer);
    clearTimeout(logoTimer);
    logoRequest++;
    if (homeRowObserver) homeRowObserver.disconnect();
    if (posterObserver) posterObserver.disconnect();
    main.textContent = "";
    main.className = "";
    main.scrollTop = 0;
    document.body.classList.toggle("signed-in", !!(session && session.token));
    setBackdrop(null);
    message("");
    el("h1", title, main);
    return revision;
  }
  function go(action) {
    if (stack.length)
      stack[stack.length - 1].focus =
        document.activeElement && document.activeElement.dataset.item;
    stack.push({ action: action });
    return action();
  }
  async function back() {
    if (!upNext.hidden) {
      dismissUpNext();
      return;
    }
    if (activeListing && activeListing.closeOptions()) return;
    if (!document.getElementById("playback-panel").hidden) {
      closePlaybackPanel();
      return;
    }
    if (main.classList.contains("quick-connect-page")) {
      login();
      return;
    }
    if (playing) {
      await stop();
      return;
    }
    if (
      nav.contains(document.activeElement) &&
      contentFocus &&
      contentFocus.isConnected
    ) {
      contentFocus.focus();
      return;
    }
    if (stack.length > 1) {
      stack.pop();
      var page = stack[stack.length - 1];
      await page.action();
      if (page.focus) {
        var nodes = main.querySelectorAll("[data-item]");
        for (var i = 0; i < nodes.length; i++)
          if (nodes[i].dataset.item === page.focus) nodes[i].focus();
      }
    } else if (window.webOS && window.webOS.platformBack)
      window.webOS.platformBack();
    else if (window.PalmSystem) {
      if (window.confirm("Exit Wholphin?")) window.close();
    } else message("You are on the home screen.");
  }
  function navIcon(name) {
    var paths = {
      home: "M3 11L12 3l9 8M5 10v11h5v-7h4v7h5V10",
      search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
      favorites:
        "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
      movies: "M4 3h16v18H4zM4 8h16M4 16h16M8 3v18M16 3v18",
      tv: "M3 4h18v14H3zM8 22h8M12 18v4",
      folder: "M3 6h7l2 2h9v12H3z",
      settings:
        "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
    };
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[name] || paths.folder);
    svg.appendChild(path);
    return svg;
  }
  function navigation() {
    document.getElementById("profile-initial").textContent =
      session && session.name ? session.name.charAt(0).toUpperCase() : "U";
    var signature =
      session && session.token
        ? session.server +
          session.user +
          JSON.stringify(
            libraryItems.map(function (item) {
              return [item.Id, item.Name, item.CollectionType];
            }),
          )
        : "signed-out";
    if (signature === navSignature) {
      selectNav(main.dataset.nav || "home");
      return;
    }
    var previous = nav.contains(document.activeElement)
      ? document.activeElement.dataset.nav
      : null;
    var previousScroll = nav.scrollTop;
    navSignature = signature;
    nav.textContent = "";
    if (!session || !session.token) return;
    function entry(label, icon, action, key) {
      var b = button("", action, nav);
      b.setAttribute("aria-label", label);
      b.dataset.nav = key;
      b.appendChild(navIcon(icon));
      el("span", label, b).className = "nav-label";
      return b;
    }
    entry(
      "Search",
      "search",
      function () {
        return go(search);
      },
      "search",
    );
    entry(
      "Home",
      "home",
      function () {
        stack = [];
        return go(home);
      },
      "home",
    );
    entry(
      "Favorites",
      "favorites",
      function () {
        return go(favorites);
      },
      "favorites",
    );
    libraryItems.forEach(function (item) {
      entry(
        item.Name,
        item.CollectionType === "movies"
          ? "movies"
          : item.CollectionType === "tvshows"
            ? "tv"
            : "folder",
        function () {
          return go(function () {
            return listing(item.Id, item.Name);
          });
        },
        item.Id,
      );
    });
    entry(
      "Settings",
      "settings",
      function () {
        return go(settings);
      },
      "settings",
    ).className = "settings-entry";
    selectNav(main.dataset.nav || "home");
    if (previous) {
      var restore = Array.prototype.find.call(
        nav.querySelectorAll("button"),
        function (b) {
          return b.dataset.nav === previous;
        },
      );
      if (restore) restore.focus();
    }
    nav.scrollTop = previousScroll;
  }
  function selectNav(key) {
    main.dataset.nav = key;
    Array.prototype.forEach.call(nav.querySelectorAll("button"), function (b) {
      if (b.dataset.nav === key) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }
  function settings() {
    reset("Settings");
    selectNav("settings");
    el("p", "Connected to " + session.server, main).className = "metadata";
    button(
      "Customize Home",
      function () {
        return go(customizeHome);
      },
      main,
    );
    button(
      "Playback queue",
      function () {
        return go(queuePage);
      },
      main,
    );
    var autoplay = button(
      autoplayLabel(),
      function () {
        setAutoplay(!playbackOptions().autoplay);
        autoplay.textContent = autoplayLabel();
      },
      main,
    );
    [
      ["countdown", "Up Next countdown", [0, 15, 30, 60]],
      ["stillWatching", "Still watching prompt", [0, 3, 5]],
    ].forEach(function (setting) {
      function label() {
        var value = playbackOptions()[setting[0]];
        return (
          setting[1] +
          ": " +
          (value
            ? value + (setting[0] === "countdown" ? " seconds" : " episodes")
            : "Off")
        );
      }
      var control = button(
        label(),
        function () {
          var options = playbackOptions(),
            values = setting[2];
          options[setting[0]] =
            values[(values.indexOf(options[setting[0]]) + 1) % values.length];
          localStorage.setItem(
            accountKey("playback-options"),
            JSON.stringify(options),
          );
          control.textContent = label();
        },
        main,
      );
    });
    button(
      "Reset track preferences",
      function () {
        localStorage.removeItem(accountKey("track-preferences"));
        message(
          "Remembered audio/subtitle choices cleared. New videos will use Jellyfin defaults.",
        );
      },
      main,
    );
    var decoder = decoderOptions();
    var nativeMode = button(
      "Playback mode: " +
        (decoder.native ? "LG C1 native (experimental)" : "Compatibility"),
      function () {
        decoder.native = !decoder.native;
        localStorage.setItem(
          accountKey("decoder-options"),
          JSON.stringify(decoder),
        );
        nativeMode.textContent =
          "Playback mode: " +
          (decoder.native ? "LG C1 native (experimental)" : "Compatibility");
        vision.disabled = !decoder.native;
      },
      main,
    );
    var vision = button(
      "Dolby Vision MP4 (experimental): " +
        (decoder.dolbyVision ? "On" : "Off"),
      function () {
        decoder.dolbyVision = !decoder.dolbyVision;
        localStorage.setItem(
          accountKey("decoder-options"),
          JSON.stringify(decoder),
        );
        vision.textContent =
          "Dolby Vision MP4 (experimental): " +
          (decoder.dolbyVision ? "On" : "Off");
      },
      main,
    );
    vision.disabled = !decoder.native;
    el(
      "p",
      "C1 native mode enables supported 4K/HEVC, HDR10 and Dolby Digital audio, with compatible HLS remuxing. Compatibility uses the existing H.264/AAC path. Native formats still need TV testing; Dolby Vision is limited to compatible MP4 variants. Audio passthrough depends on the TV and sound system.",
      main,
    ).className = "metadata";
    button(
      "Sign out",
      async function () {
        try {
          await stop();
        } catch (_) {}
        try {
          await api("/Sessions/Logout", null, {}, "POST");
        } catch (_) {}
        localStorage.removeItem("wholphin-session");
        session = null;
        stack = [];
        libraryItems = [];
        libraryUpdated = 0;
        libraryRequest = null;
        homeCache.clear();
        previewCache.clear();
        queueItems = [];
        listingStates.clear();
        navigation();
        login();
      },
      main,
    );
    focusFirst();
  }
  function accountKey(suffix) {
    return "wholphin-" + suffix + ":" + session.server + ":" + session.user;
  }
  function readPreference(suffix, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(accountKey(suffix)));
      return value || fallback;
    } catch (_) {
      return fallback;
    }
  }
  function homeOptions() {
    return readPreference("home-options", {
      combine: true,
      live: true,
      holidays: true,
      released: false,
      favorites: true,
      collections: true,
      playlists: true,
      showTitles: false,
      hiddenLibraries: [],
    });
  }
  function customizeHome() {
    reset("Customize Home");
    selectNav("settings");
    var options = homeOptions(),
      form = el("form", null, main);
    form.className = "home-options";
    function checkbox(label, checked, onChange) {
      var line = el("label", null, form),
        input = el("input", null, line);
      input.type = "checkbox";
      input.checked = !!checked;
      el("span", label, line);
      input.onchange = function () {
        onChange(input.checked);
      };
    }
    checkbox(
      "Combine Continue watching and Next up",
      options.combine,
      function (v) {
        options.combine = v;
      },
    );
    checkbox("Watch live row", options.live !== false, function (v) {
      options.live = v;
    });
    checkbox(
      "Holiday rows for the current month",
      options.holidays !== false,
      function (v) {
        options.holidays = v;
      },
    );
    checkbox("Show poster titles", options.showTitles, function (v) {
      options.showTitles = v;
    });
    checkbox("Recently released rows", options.released, function (v) {
      options.released = v;
    });
    checkbox(
      "Favorite movies and shows",
      options.favorites !== false,
      function (v) {
        options.favorites = v;
      },
    );
    checkbox("Collections", options.collections !== false, function (v) {
      options.collections = v;
    });
    checkbox("Playlists", options.playlists !== false, function (v) {
      options.playlists = v;
    });
    el("h2", "Recently added libraries", form);
    libraryItems
      .filter(function (library) {
        return (
          [
            "livetv",
            "music",
            "photos",
            "books",
            "boxsets",
            "playlists",
          ].indexOf(library.CollectionType) === -1
        );
      })
      .forEach(function (library) {
        checkbox(
          library.Name,
          (options.hiddenLibraries || []).indexOf(library.Id) === -1,
          function (enabled) {
            options.hiddenLibraries = (options.hiddenLibraries || []).filter(
              function (id) {
                return id !== library.Id;
              },
            );
            if (!enabled) options.hiddenLibraries.push(library.Id);
          },
        );
      });
    var save = el("button", "Save and open Home", form);
    save.type = "submit";
    form.onsubmit = function (event) {
      event.preventDefault();
      localStorage.setItem(accountKey("home-options"), JSON.stringify(options));
      homeCache.clear();
      stack = [];
      run(function () {
        return go(home);
      });
    };
    focusFirst();
  }
  async function loadLibraries() {
    if (libraryUpdated && Date.now() - libraryUpdated < 60000)
      return libraryItems;
    if (!libraryRequest) {
      var current = session,
        key = accountKey("libraries");
      var request = api("/Users/" + session.user + "/Views")
        .then(function (data) {
          if (session !== current) return data.Items || [];
          libraryItems = data.Items || [];
          libraryUpdated = Date.now();
          localStorage.setItem(
            key,
            JSON.stringify(
              libraryItems.map(function (item) {
                return {
                  Id: item.Id,
                  Name: item.Name,
                  CollectionType: item.CollectionType,
                };
              }),
            ),
          );
          navigation();
          return libraryItems;
        })
        .finally(function () {
          if (libraryRequest === request) libraryRequest = null;
        });
      libraryRequest = request;
    }
    return libraryRequest;
  }
  async function favorites() {
    var r = reset("Favorites");
    selectNav("favorites");
    message("Loading…");
    var data = await api("/Users/" + session.user + "/Items", {
      Recursive: true,
      IsFavorite: true,
      IncludeItemTypes: "Movie,Series,Episode",
      SortBy: "SortName",
      Limit: 100,
      Fields: "Overview,Genres",
    });
    if (r !== revision) return;
    message("");
    cards(data.Items, main);
    focusFirst();
  }
  async function completeSignIn(result, context) {
    if (
      !result ||
      typeof result.AccessToken !== "string" ||
      !result.AccessToken ||
      /["\r\n]/.test(result.AccessToken) ||
      !result.User ||
      typeof result.User.Id !== "string" ||
      !result.User.Id
    )
      throw new Error("Jellyfin returned an invalid sign-in response.");
    session = {
      server: context.server,
      token: result.AccessToken,
      user: result.User.Id,
      name: result.User.Name || "",
    };
    homeCache.clear();
    previewCache.clear();
    queueItems = [];
    listingStates.clear();
    libraryItems = [];
    libraryUpdated = 0;
    libraryRequest = null;
    localStorage.setItem("wholphin-session", JSON.stringify(session));
    navigation();
    stack = [];
    await go(home);
  }
  async function quickConnect(server) {
    var context = { server: C.serverUrl(server) };
    reset("Quick Connect");
    main.className = "quick-connect-page";
    var controller = new AbortController(),
      timer = null,
      expiry = null,
      active = true,
      secret = null,
      options = { session: context, signal: controller.signal };
    function cancel() {
      active = false;
      secret = null;
      clearTimeout(timer);
      clearTimeout(expiry);
      controller.abort();
      if (cancelQuickConnect === cancel) cancelQuickConnect = null;
    }
    cancelQuickConnect = cancel;
    el(
      "p",
      "On a signed-in Jellyfin phone or browser, open Settings → Quick Connect and enter this code:",
      main,
    );
    var code = el("p", "Connecting…", main);
    code.className = "quick-connect-code";
    code.setAttribute("aria-live", "polite");
    var info = el("p", "", main);
    info.setAttribute("role", "status");
    button("Cancel", login, main).focus();
    function failed(error) {
      if (!active) return;
      cancel();
      code.textContent = "";
      info.textContent =
        error.status === 404
          ? "Code expired. Generate a new code."
          : error.message;
      button(
        "Generate new code",
        function () {
          return quickConnect(context.server);
        },
        main,
      );
    }
    async function poll() {
      if (!active) return;
      try {
        var state = await api(
          "/QuickConnect/Connect",
          { Secret: secret },
          null,
          "GET",
          options,
        );
        if (!active) return;
        if (state.Authenticated) {
          var result = await api(
            "/Users/AuthenticateWithQuickConnect",
            null,
            { Secret: secret },
            "POST",
            options,
          );
          if (!active) return;
          await completeSignIn(result, context);
          return;
        }
        timer = setTimeout(poll, 3000);
      } catch (error) {
        failed(error);
      }
    }
    try {
      if (
        (await api("/QuickConnect/Enabled", null, null, "GET", options)) !==
        true
      )
        throw new Error(
          "Quick Connect is disabled on this Jellyfin server. Enable it in the server dashboard or sign in with a password.",
        );
      var state = await api(
        "/QuickConnect/Initiate",
        null,
        null,
        "POST",
        options,
      );
      if (!active) return;
      if (
        !state ||
        typeof state.Secret !== "string" ||
        !state.Secret ||
        !/^\d{6}$/.test(state.Code)
      )
        throw new Error("Jellyfin returned an invalid Quick Connect code.");
      secret = state.Secret;
      code.textContent = state.Code;
      info.textContent =
        "Waiting for approval. This code expires in 10 minutes.";
      expiry = setTimeout(function () {
        failed(new Error("Code expired. Generate a new code."));
      }, 600000);
      timer = setTimeout(poll, 3000);
    } catch (error) {
      failed(error);
    }
  }
  function login() {
    var loginRevision = reset("Connect to Jellyfin");
    var form = el("form", null, main);
    form.noValidate = true;
    function field(label, type, value) {
      var id = "field-" + form.children.length;
      var l = el("label", label, form);
      l.htmlFor = id;
      var input = el("input", null, form);
      input.id = id;
      input.type = type;
      input.required = true;
      input.value = value || "";
      return input;
    }
    var server = field("Server URL", "text", session && session.server),
      user = field("Username", "text"),
      password = field("Password", "password");
    password.required = false;
    var submit = el("button", "Sign in", form);
    submit.type = "submit";
    var loginError = el("p", "", form);
    loginError.setAttribute("role", "alert");
    form.onsubmit = function (e) {
      e.preventDefault();
      run(async function () {
        submit.disabled = true;
        loginError.textContent = "";
        try {
          var normalizedServer = C.serverUrl(server.value);
          if (!user.value.trim())
            throw new Error("Enter your Jellyfin username.");
          server.value = normalizedServer;
          session = { server: normalizedServer };
          message("Connecting…");
          var result = await api("/Users/AuthenticateByName", null, {
            Username: user.value,
            Pw: password.value,
          });
          if (revision !== loginRevision) return;
          password.value = "";
          await completeSignIn(result, session);
        } catch (error) {
          if (revision !== loginRevision) return;
          loginError.textContent =
            error.message || "Could not connect to Jellyfin.";
          message(loginError.textContent);
        } finally {
          submit.disabled = false;
          if (loginError.textContent && submit.isConnected) submit.focus();
        }
      });
    };
    var quick = button(
      "Use Quick Connect",
      function () {
        var normalized = C.serverUrl(server.value);
        session = { server: normalized };
        password.value = "";
        return quickConnect(normalized);
      },
      main,
    );
    quick.type = "button";
    focusFirst();
  }
  function backdropUrl(item) {
    if (!item) return null;
    var id =
      item.BackdropImageTags && item.BackdropImageTags.length
        ? item.Id
        : item.ParentBackdropItemId || item.SeriesId;
    return id
      ? session.server +
          "/Items/" +
          encodeURIComponent(id) +
          "/Images/Backdrop?maxWidth=1280&quality=80"
      : null;
  }
  function setBackdrop(item) {
    var url = backdropUrl(item),
      backdrop = document.getElementById("backdrop"),
      request = ++backdropRequest;
    clearTimeout(backdropTimer);
    if (backdropLoading) {
      backdropLoading.onload = null;
      backdropLoading.onerror = null;
      backdropLoading.removeAttribute("src");
      backdropLoading = null;
    }
    if (!url) {
      backdrop.removeAttribute("src");
      backdrop.hidden = true;
      return;
    }
    if (backdrop.getAttribute("src") === url) {
      backdrop.hidden = false;
      return;
    }
    backdrop.hidden = true;
    backdropTimer = setTimeout(function () {
      var loading = new Image();
      backdropLoading = loading;
      loading.onload = function () {
        if (request === backdropRequest) {
          backdrop.src = url;
          backdrop.hidden = false;
          backdropLoading = null;
        }
      };
      loading.onerror = function () {
        if (request === backdropRequest) {
          backdrop.hidden = true;
          backdropLoading = null;
        }
      };
      loading.src = url;
    }, 180);
  }
  function itemMetadata(item) {
    return C.quickDetails(item);
  }
  function previewLogo(item) {
    var image = document.getElementById("preview-logo"),
      title = document.getElementById("preview-title"),
      id = C.logoItem(item);
    if (id && image.dataset.logoItem === id) {
      title.classList.toggle("has-logo", !image.hidden);
      return;
    }
    clearTimeout(logoTimer);
    var request = ++logoRequest;
    image.dataset.logoItem = id || "";
    image.hidden = true;
    title.classList.remove("has-logo");
    if (!id) {
      image.removeAttribute("src");
      return;
    }
    logoTimer = setTimeout(function () {
      image.onload = function () {
        if (
          request === logoRequest &&
          document.getElementById("preview-logo") === image
        ) {
          image.hidden = false;
          title.classList.add("has-logo");
        }
      };
      image.onerror = function () {
        if (request === logoRequest) {
          image.hidden = true;
          title.classList.remove("has-logo");
        }
      };
      image.src =
        session.server +
        "/Items/" +
        encodeURIComponent(id) +
        "/Images/Logo?maxWidth=600&quality=90";
    }, 150);
  }
  function updatePreview(item) {
    var preview = document.getElementById("home-preview");
    if (!preview) return;
    preview.dataset.item = item.Id;
    preview.classList.toggle(
      "is-episode",
      item.Type === "Episode" || !!item.SeriesName,
    );
    previewLogo(item);
    document.getElementById("preview-title").textContent =
      item.SeriesName || item.Name;
    document.getElementById("preview-meta").textContent = itemMetadata(item);
    document.getElementById("preview-overview").textContent =
      item.Overview || "";
    var episode = document.getElementById("preview-episode");
    episode.textContent = item.SeriesName ? item.Name : "";
    setBackdrop(item);
  }
  function previewItem(item) {
    clearTimeout(previewTimer);
    var full = previewCache.get(item.Id);
    updatePreview(full || item);
    if (full || item.Overview) return;
    var r = revision,
      current = session;
    previewTimer = setTimeout(function () {
      api(
        "/Users/" + session.user + "/Items/" + encodeURIComponent(item.Id),
        null,
        null,
        "GET",
        { signal: homeController && homeController.signal },
      )
        .then(function (data) {
          if (session !== current || r !== revision) return;
          if (previewCache.size > 80)
            previewCache.delete(previewCache.keys().next().value);
          previewCache.set(item.Id, data);
          var preview = document.getElementById("home-preview");
          if (r === revision && preview && preview.dataset.item === item.Id)
            updatePreview(data);
        })
        .catch(function () {});
    }, 150);
  }
  function image(item, landscape) {
    var tags = item.ImageTags || {},
      id = item.Id,
      kind = "Primary";
    if (landscape && tags.Thumb) kind = "Thumb";
    else if (
      landscape &&
      item.Type !== "Episode" &&
      item.BackdropImageTags &&
      item.BackdropImageTags.length
    )
      kind = "Backdrop";
    else if (!landscape && item.SeriesId) id = item.SeriesId;
    else if (!tags.Primary && item.SeriesId) id = item.SeriesId;
    else if (!tags.Primary) return null;
    return (
      session.server +
      "/Items/" +
      encodeURIComponent(id) +
      "/Images/" +
      kind +
      (landscape ? "?maxWidth=720&quality=80" : "?maxWidth=450&quality=80")
    );
  }
  function loadPoster(img) {
    if (!img || !img.dataset.src) return;
    img.src = img.dataset.src;
    delete img.dataset.src;
    if (posterObserver) posterObserver.unobserve(img);
  }
  function observePoster(img) {
    if (!posterObserver && window.IntersectionObserver)
      posterObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) loadPoster(entry.target);
          });
        },
        { root: null, rootMargin: "160px 240px" },
      );
    if (posterObserver) posterObserver.observe(img);
    else requestAnimationFrame(loadVisiblePosters);
  }
  function loadVisiblePosters() {
    var root = document.getElementById("home-rows") || main,
      bounds = root.getBoundingClientRect();
    Array.prototype.forEach.call(
      main.querySelectorAll("img[data-src]"),
      function (img) {
        var rect = img.getBoundingClientRect(),
          rail = img.closest(".rail"),
          clip = rail ? rail.getBoundingClientRect() : bounds;
        if (
          rect.bottom > Math.max(0, bounds.top) - 160 &&
          rect.top < Math.min(innerHeight, bounds.bottom) + 160 &&
          rect.right > Math.max(0, clip.left) - 240 &&
          rect.left < Math.min(innerWidth, clip.right) + 240
        )
          loadPoster(img);
      },
    );
  }
  document.addEventListener(
    "scroll",
    function () {
      if (!window.IntersectionObserver)
        requestAnimationFrame(loadVisiblePosters);
    },
    true,
  );
  function prefetchFocusedPosters(card) {
    [
      card,
      card.previousElementSibling,
      card.nextElementSibling,
      card.nextElementSibling && card.nextElementSibling.nextElementSibling,
    ].forEach(function (node) {
      if (node) loadPoster(node.querySelector("img[data-src]"));
    });
  }
  function cards(items, parent, layout, existing) {
    var grid = existing || el("div", null, parent);
    if (!existing) grid.className = layout ? "rail " + layout : "grid";
    items.forEach(function (item) {
      var b = button(
        "",
        function () {
          return go(function () {
            return detail(item.Id, !!item.IsLiveProgram);
          });
        },
        grid,
      );
      b.className = "card";
      b.dataset.item = item.Id;
      b.setAttribute("aria-label", item.Name);
      b.addEventListener("focus", function () {
        prefetchFocusedPosters(b);
        if (document.getElementById("home-preview")) previewItem(item);
      });
      var art = el("div", null, b);
      art.className = "art";
      var placeholder = el("span", item.Name.charAt(0), art);
      placeholder.className = "placeholder";
      var url = image(item, layout === "landscape");
      if (url) {
        var img = el("img", null, art);
        img.dataset.src = url;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        observePoster(img);
        img.onerror = function () {
          img.style.visibility = "hidden";
        };
      }
      if (item.Type === "Episode" || item.SeriesName) {
        if (item.IndexNumber != null)
          el("span", "E" + item.IndexNumber, art).className = "episode-badge";
      }
      var percent = item.UserData && item.UserData.PlayedPercentage;
      if (percent > 0 && percent < 100) {
        var progress = el("div", null, art);
        progress.className = "card-progress";
        el("div", null, progress).style.width = Math.min(100, percent) + "%";
      }
      el("span", item.SeriesName || item.Name, b).className = "card-title";
      var subtitle = item.SeriesName
        ? "S" +
          (item.ParentIndexNumber || 0) +
          " · E" +
          (item.IndexNumber || 0) +
          "  " +
          item.Name
        : item.ProductionYear;
      if (subtitle) el("span", String(subtitle), b).className = "card-subtitle";
    });
    if (!items.length && !existing) el("p", "No items found.", parent);
    return grid;
  }
  async function fetchHomeRow(row, signal) {
    function request(path, values) {
      return api(path, values, null, "GET", { signal: signal });
    }
    var fields = "Overview,Genres,Taglines",
      base = "/Users/" + session.user + "/Items";
    function resume() {
      return request(base + "/Resume", {
        Limit: 24,
        MediaTypes: "Video",
        Fields: fields,
      }).then(function (data) {
        return data.Items || [];
      });
    }
    function next() {
      return request("/Shows/NextUp", {
        UserId: session.user,
        Limit: 24,
        Fields: fields,
      }).then(function (data) {
        return data.Items || [];
      });
    }
    if (row.kind === "live")
      return request("/LiveTv/Programs", {
        UserId: session.user,
        IsAiring: true,
        MinEndDate: new Date(Date.now() + 60000).toISOString(),
        Limit: 24,
        Fields: "Overview,ChannelInfo",
        EnableImages: true,
      }).then(function (data) {
        return (data.Items || [])
          .filter(function (item) {
            return !!item.ChannelId;
          })
          .map(function (item) {
            item.IsLiveProgram = true;
            return item;
          });
      });
    if (row.kind === "resume") return resume();
    if (row.kind === "next") return next();
    if (row.kind === "combined") {
      var both = await Promise.all([resume(), next()]);
      return C.combineResume(both[0], both[1]);
    }
    if (row.kind === "latest")
      return request(base + "/Latest", {
        ParentId: row.parent,
        Limit: 24,
        Fields: fields,
        IncludeItemTypes: "Movie,Series,Episode,Video,MusicVideo",
      });
    var query = {
      Recursive: true,
      Limit: 24,
      Fields: fields,
      IncludeItemTypes: row.type || "Movie,Series,Episode,Video",
      SortBy: "SortName",
    };
    if (row.kind === "holiday") {
      Object.assign(query, row.filter);
      query.SortBy = "Random";
      query.Limit = 20;
    }
    if (row.parent) query.ParentId = row.parent;
    if (row.kind === "released") {
      query.SortBy = "PremiereDate";
      query.SortOrder = "Descending";
    }
    if (row.kind === "favorites") query.IsFavorite = true;
    return request(base, query).then(function (data) {
      return data.Items || [];
    });
  }
  async function home() {
    var r = reset("Home"),
      options = homeOptions();
    homeController = new AbortController();
    var homeSignal = homeController.signal,
      earlyRows = new Map();
    // Overlap critical playback rows with cold library discovery.
    if (!libraryItems.length)
      C.homeRows([], options).forEach(function (row) {
        if (["combined", "resume", "next"].indexOf(row.kind) === -1) return;
        earlyRows.set(
          row.key,
          fetchHomeRow(row, homeSignal).then(
            function (items) {
              return { items: items };
            },
            function (error) {
              return { error: error };
            },
          ),
        );
      });
    main.className = "home-page" + (options.showTitles ? " show-titles" : "");
    selectNav("home");
    var preview = el("section", null, main);
    preview.id = "home-preview";
    var heading = el("div", null, preview);
    heading.className = "preview-heading";
    var logo = el("img", null, heading);
    logo.id = "preview-logo";
    logo.alt = "";
    logo.hidden = true;
    el("h2", "", heading).id = "preview-title";
    el("p", "", preview).id = "preview-episode";
    el("p", "", preview).id = "preview-meta";
    el("p", "", preview).id = "preview-overview";
    var rows = el("div", null, main);
    rows.id = "home-rows";
    // Only take focus while initially entering Home. Late row responses never move it away.
    main.tabIndex = -1;
    main.focus({ preventScroll: true });
    if (!libraryItems.length) {
      var loading = el("p", "Loading libraries…", rows);
      loading.className = "row-message";
      try {
        await loadLibraries();
      } catch (error) {
        if (r !== revision) return;
        loading.textContent = "Could not load libraries. " + error.message;
        button("Retry", home, rows).focus();
        return;
      }
      if (r !== revision) return;
      rows.textContent = "";
    } else {
      loadLibraries().catch(function () {});
    }
    var plan = C.homeRows(libraryItems, options),
      queue = [],
      active = 0;
    function valid() {
      return r === revision && rows.isConnected;
    }
    function pump() {
      while (active < 2 && queue.length && valid()) {
        var job = queue.shift();
        active++;
        job().finally(function () {
          active--;
          pump();
        });
      }
    }
    function focusRow(section) {
      var first = section.querySelector("button");
      if (first) focusContent(first);
    }
    function render(section, row, items) {
      if (!valid()) return;
      var focused = section.contains(document.activeElement),
        focusedId = focused && document.activeElement.dataset.item;
      var anchor =
        !focused && rows.contains(document.activeElement)
          ? document.activeElement
          : null;
      var anchorTop = anchor && anchor.getBoundingClientRect().top;
      function stabilize() {
        if (anchor && anchor.isConnected)
          rows.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
      }
      section.setAttribute("aria-busy", "false");
      section.classList.remove("row-pending");
      var old = section.querySelector(".rail");
      if (old) old.remove();
      if (!items.length) {
        section.hidden = true;
        stabilize();
        if (focused || document.activeElement === main) {
          var available = Array.prototype.find.call(
            rows.querySelectorAll("section:not([hidden])"),
            function (node) {
              return !!node.querySelector("button");
            },
          );
          if (available) focusRow(available);
        }
        return;
      }
      cards(items, section, row.layout || "poster");
      stabilize();
      if (
        focused ||
        document.activeElement === main ||
        document.activeElement === document.body
      ) {
        var restore =
          focusedId &&
          Array.prototype.find.call(
            section.querySelectorAll("[data-item]"),
            function (node) {
              return node.dataset.item === focusedId;
            },
          );
        if (restore) focusContent(restore);
        else focusRow(section);
      }
    }
    plan.forEach(function (row, index) {
      var section = el("section", null, rows);
      section.dataset.row = row.key;
      section.className =
        "home-row" + (row.layout === "landscape" ? " landscape-row" : "");
      el("h2", row.title, section);
      var key = accountKey("row:") + row.key,
        cached = homeCache.get(key),
        queued = false;
      function schedule(force) {
        if (!valid() || queued) return;
        if (!force && cached && Date.now() - cached.time < 60000) return;
        queued = true;
        if (homeRowObserver) homeRowObserver.unobserve(section);
        queue.push(async function () {
          if (!valid()) return;
          try {
            var early = earlyRows.get(row.key);
            earlyRows.delete(row.key);
            var result = early && (await early);
            if (result && result.error) throw result.error;
            var items = result
              ? result.items
              : await fetchHomeRow(row, homeSignal);
            if (!valid()) return;
            cached = { items: items, time: Date.now() };
            if (homeCache.size >= 60 && !homeCache.has(key))
              homeCache.delete(homeCache.keys().next().value);
            homeCache.set(key, cached);
            render(section, row, items);
          } catch (error) {
            if (!valid()) return;
            if (!cached) {
              var rail = section.querySelector(".rail"),
                hadFocus = section.contains(document.activeElement);
              rail.textContent = "";
              section.classList.remove("row-pending");
              section.setAttribute("aria-busy", "false");
              var retry = button(
                "Retry loading " + row.title,
                function () {
                  schedule(true);
                },
                rail,
              );
              retry.className = "row-retry";
              retry.title = error.message;
              if (hadFocus) retry.focus();
            }
          } finally {
            queued = false;
          }
        });
        pump();
      }
      section.loadHomeRow = schedule;
      if (cached) render(section, row, cached.items);
      else {
        section.classList.add("row-pending");
        section.setAttribute("aria-busy", "true");
        var rail = el("div", null, section);
        rail.className = "rail";
        var waiting = button(
          "Loading…",
          function () {
            schedule(true);
          },
          rail,
        );
        waiting.className = "row-placeholder";
        waiting.addEventListener("focus", function () {
          schedule();
        });
        for (var i = 0; i < 5; i++)
          el("div", null, rail).className = "poster-placeholder";
      }
      if (index < 2 || (cached && !cached.items.length)) schedule();
    });
    if (window.IntersectionObserver) {
      homeRowObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && entry.target.loadHomeRow)
              entry.target.loadHomeRow();
          });
        },
        { root: rows, rootMargin: "500px 0px" },
      );
      Array.prototype.forEach.call(rows.children, function (section, index) {
        // The first two rows already started; observing them again can retry failures during a repaint.
        if (index >= 2) homeRowObserver.observe(section);
      });
    } else {
      Array.prototype.forEach.call(rows.children, function (section) {
        section.loadHomeRow();
      });
    }
    var first = rows.querySelector("section:not([hidden]) button");
    if (first) first.focus();
  }
  async function listing(id, title, focusControl) {
    var r = reset(title),
      controller = new AbortController(),
      disposed = false;
    main.className = "library-page";
    var library = libraryItems.find(function (item) {
      return item.Id === id;
    });
    if (library) selectNav(id);
    var type =
      library &&
      { movies: "Movie,Video", tvshows: "Series" }[library.CollectionType];
    var key = accountKey("library:" + id),
      preferenceKey = "library-options:" + id;
    var defaults = { sort: "title-asc", watched: "all", genre: "", year: "" };
    function fresh(options) {
      return {
        options: options,
        items: [],
        ids: new Set(),
        nextIndex: 0,
        total: null,
        done: false,
        scroll: 0,
        focusId: null,
        facets: null,
      };
    }
    var state =
      listingStates.get(key) ||
      fresh(
        Object.assign({}, defaults, readPreference(preferenceKey, defaults)),
      );
    listingStates.delete(key);
    listingStates.set(key, state);
    while (listingStates.size > 3)
      listingStates.delete(listingStates.keys().next().value);
    var toolbar = el("div", null, main);
    toolbar.className = "library-toolbar";
    var count = el("p", "", main);
    count.id = "library-count";
    count.setAttribute("role", "status");
    var holder = el("div", null, main);
    holder.id = "library-items";
    var top = el("div", null, holder),
      grid = el("div", null, holder),
      bottom = el("div", null, holder);
    top.setAttribute("aria-hidden", "true");
    bottom.setAttribute("aria-hidden", "true");
    grid.className = "grid library-grid";
    var loader = el("div", null, main);
    loader.id = "library-loading";
    loader.setAttribute("role", "status");
    var dialog = el("section", null, main);
    dialog.id = "library-options";
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    var cardMap = new Map(),
      loading = false,
      failed = false,
      pendingFocus = null,
      frame = null,
      columns = 6,
      rowHeight = 480,
      lastStart = -1,
      lastEnd = -1,
      dialogOpener = null,
      dialogRequest = 0,
      facetRequest = null;
    var sortOptions = [
      ["title-asc", "Title (A–Z)"],
      ["title-desc", "Title (Z–A)"],
      ["release-desc", "Release date (newest)"],
      ["release-asc", "Release date (oldest)"],
      ["added-desc", "Date added (newest)"],
      ["added-asc", "Date added (oldest)"],
    ];
    function valid() {
      return !disposed && r === revision && holder.isConnected;
    }
    function geometry() {
      var style = getComputedStyle(grid);
      columns = style.gridTemplateColumns.split(/\s+/).length || 6;
      var width = (grid.clientWidth - 20 - 24 * (columns - 1)) / columns;
      rowHeight = width * 1.5 + 75 + 32;
    }
    function offset() {
      return (
        main.getBoundingClientRect().top - holder.getBoundingClientRect().top
      );
    }
    function snapshot() {
      state.scroll = main.scrollTop;
      if (grid.contains(document.activeElement))
        state.focusId = document.activeElement.dataset.item;
    }
    function renderWindow() {
      if (!valid()) return;
      geometry();
      var window = C.libraryWindow(
        state.items.length,
        columns,
        rowHeight,
        Math.max(0, offset()),
        main.clientHeight,
      );
      top.style.height = window.top + "px";
      bottom.style.height = window.bottom + "px";
      if (window.start === lastStart && window.end === lastEnd) return;
      var focused = grid.contains(document.activeElement)
        ? Number(document.activeElement.dataset.libraryIndex)
        : null;
      var scroll = main.scrollTop;
      cardMap.forEach(function (card, index) {
        if (index >= window.start && index < window.end) return;
        if (posterObserver)
          Array.prototype.forEach.call(
            card.querySelectorAll("img"),
            function (img) {
              posterObserver.unobserve(img);
            },
          );
        card.remove();
        cardMap.delete(index);
      });
      var fragment = document.createDocumentFragment();
      for (var index = window.start; index < window.end; index++) {
        var card = cardMap.get(index);
        if (!card) {
          cards([state.items[index]], holder, null, grid);
          card = grid.lastElementChild;
          card.dataset.libraryIndex = index;
          if (!card.querySelector(".card-subtitle"))
            el("span", " ", card).className = "card-subtitle";
          cardMap.set(index, card);
        }
        fragment.appendChild(card);
      }
      grid.appendChild(fragment);
      lastStart = window.start;
      lastEnd = window.end;
      if (focused != null) {
        if (cardMap.has(focused))
          cardMap.get(focused).focus({ preventScroll: true });
        else main.focus({ preventScroll: true });
      }
      main.scrollTop = scroll;
    }
    function focusIndex(index) {
      if (!state.items.length) return;
      index = Math.max(0, Math.min(index, state.items.length - 1));
      renderWindow();
      if (!cardMap.has(index)) {
        main.scrollTop += Math.floor(index / columns) * rowHeight - offset();
        renderWindow();
      }
      var card = cardMap.get(index);
      if (card) {
        state.focusId = card.dataset.item;
        focusContent(card);
      }
    }
    function updateCount() {
      count.textContent =
        state.total != null
          ? state.items.length + " of " + state.total + " items"
          : state.items.length + " items loaded";
      if (!state.items.length && state.done)
        loader.textContent = "No items match these filters.";
      else if (state.done) loader.textContent = "All items loaded.";
    }
    async function loadNext(force) {
      if (!valid() || loading || state.done || (failed && !force)) return;
      loading = true;
      failed = false;
      var retryFocused = loader.contains(document.activeElement);
      loader.textContent = state.items.length
        ? "Loading more…"
        : "Loading videos…";
      loader.setAttribute("aria-busy", "true");
      try {
        var data = await api(
          "/Users/" + session.user + "/Items",
          C.libraryQuery(id, state.options, state.nextIndex, type),
          null,
          "GET",
          { signal: controller.signal },
        );
        if (!valid()) return;
        var raw = data.Items || [],
          seen = state.ids;
        var additions = raw.filter(function (item) {
          if (!item.Id || seen.has(item.Id)) return false;
          seen.add(item.Id);
          return true;
        });
        if (raw.length && !additions.length)
          throw new Error("The server repeated the previous items.");
        state.items = state.items.concat(additions);
        state.nextIndex += raw.length;
        if (
          Number.isFinite(data.TotalRecordCount) &&
          data.TotalRecordCount >= state.nextIndex
        )
          state.total = data.TotalRecordCount;
        state.done =
          !raw.length ||
          (state.total != null && state.nextIndex >= state.total);
        loader.textContent = "";
        renderWindow();
        updateCount();
        if (
          pendingFocus &&
          (document.activeElement.dataset.item === pendingFocus.from ||
            retryFocused)
        ) {
          focusIndex(pendingFocus.index);
          pendingFocus = null;
        } else if (document.activeElement === main && !state.focusId)
          focusIndex(0);
        else if (retryFocused)
          focusIndex(state.items.length - additions.length);
      } catch (error) {
        if (!valid()) return;
        failed = true;
        loader.textContent = "Could not load more videos. " + error.message;
        var retry = button(
          "Retry loading videos",
          function () {
            return loadNext(true);
          },
          loader,
        );
        if (
          pendingFocus &&
          document.activeElement.dataset.item === pendingFocus.from
        )
          retry.focus();
      } finally {
        loading = false;
        if (valid()) {
          loader.setAttribute("aria-busy", "false");
          if (!failed) schedule();
        }
      }
    }
    function tick() {
      frame = null;
      if (!valid()) return;
      snapshot();
      renderWindow();
      if (
        main.scrollTop + main.clientHeight >=
        main.scrollHeight - rowHeight * 2
      )
        run(loadNext);
    }
    function schedule() {
      if (frame == null && valid()) frame = requestAnimationFrame(tick);
    }
    function closeOptions() {
      if (dialog.hidden) return false;
      dialogRequest++;
      dialog.hidden = true;
      dialog.textContent = "";
      if (dialogOpener && dialogOpener.isConnected) dialogOpener.focus();
      return true;
    }
    function change(options, control) {
      localStorage.setItem(accountKey(preferenceKey), JSON.stringify(options));
      var replacement = fresh(options);
      replacement.facets = state.facets;
      listingStates.set(key, replacement);
      return listing(id, title, control);
    }
    function facets() {
      if (state.facets) return Promise.resolve(state.facets);
      if (!facetRequest)
        facetRequest = api(
          "/Items/Filters",
          { UserId: session.user, ParentId: id, IncludeItemTypes: type },
          null,
          "GET",
          { signal: controller.signal },
        )
          .then(function (data) {
            if (valid()) state.facets = data;
            return data;
          })
          .finally(function () {
            facetRequest = null;
          });
      return facetRequest;
    }
    async function openOptions(kind) {
      dialogOpener = document.getElementById("library-" + kind);
      var token = ++dialogRequest;
      dialog.hidden = false;
      dialog.textContent = "";
      var title = {
        sort: "Sort library",
        watched: "Watch status",
        genre: "Genre",
        year: "Year",
      }[kind];
      dialog.setAttribute("aria-label", title);
      el("h2", title, dialog);
      button("Close options", closeOptions, dialog).focus();
      var content = el("div", null, dialog),
        choices;
      if (kind === "sort") choices = sortOptions;
      if (kind === "watched")
        choices = [
          ["all", "All videos"],
          ["unwatched", "Unwatched"],
          ["watched", "Watched"],
        ];
      if (kind === "genre" || kind === "year") {
        content.textContent = "Loading options…";
        try {
          var data = await facets();
          if (!valid() || dialog.hidden || token !== dialogRequest) return;
          choices =
            kind === "genre"
              ? [["", "All genres"]].concat(
                  (data.Genres || []).map(function (genre) {
                    return [String(genre), String(genre)];
                  }),
                )
              : [["", "All years"]].concat(
                  (data.Years || [])
                    .filter(function (year) {
                      return Number.isInteger(year) && year > 0;
                    })
                    .sort(function (a, b) {
                      return b - a;
                    })
                    .map(function (year) {
                      return [String(year), String(year)];
                    }),
                );
        } catch (error) {
          if (!valid() || dialog.hidden || token !== dialogRequest) return;
          content.textContent = "Could not load options. " + error.message;
          button(
            "Retry loading options",
            function () {
              return openOptions(kind);
            },
            content,
          );
          return;
        }
      }
      content.textContent = "";
      choices.forEach(function (choice) {
        var option = button(
          choice[1],
          function () {
            if (state.options[kind] === choice[0]) {
              closeOptions();
              return;
            }
            var next = Object.assign({}, state.options);
            next[kind] = choice[0];
            return change(next, kind);
          },
          content,
        );
        option.setAttribute(
          "aria-pressed",
          String(state.options[kind] === choice[0]),
        );
      });
    }
    ["sort", "watched", "genre", "year"].forEach(function (kind) {
      var label =
        kind === "sort"
          ? (sortOptions.find(function (entry) {
              return entry[0] === state.options.sort;
            }) || sortOptions[0])[1]
          : kind === "watched"
            ? { all: "All", watched: "Watched", unwatched: "Unwatched" }[
                state.options.watched
              ] || "All"
            : state.options[kind] || "All";
      button(
        (kind === "watched"
          ? "Show"
          : kind.charAt(0).toUpperCase() + kind.slice(1)) +
          ": " +
          label,
        function () {
          return openOptions(kind);
        },
        toolbar,
      ).id = "library-" + kind;
    });
    button(
      "Reset filters",
      function () {
        return change(
          Object.assign({}, defaults, { sort: state.options.sort }),
          "watched",
        );
      },
      toolbar,
    );
    button(
      "Refresh library",
      function () {
        return change(Object.assign({}, state.options), "sort");
      },
      toolbar,
    );
    activeListing = {
      closeOptions: closeOptions,
      scope: function () {
        return dialog.hidden ? null : dialog;
      },
      handleKey: function (key, active) {
        if (!dialog.hidden) return false;
        if (active === main && state.items.length) {
          focusIndex(
            Math.max(
              0,
              Math.floor(Math.max(0, offset()) / rowHeight) * columns,
            ),
          );
          return true;
        }
        if (!grid.contains(active)) return false;
        pendingFocus = null;
        var index = Number(active.dataset.libraryIndex),
          target = index;
        if (key === 37) {
          if (index % columns === 0) {
            focusContent(
              nav.querySelector('[aria-current="page"]') ||
                nav.querySelector("button"),
            );
            return true;
          }
          target--;
        } else if (key === 39) {
          if (index % columns === columns - 1) return true;
          target++;
        } else if (key === 38) target -= columns;
        else if (key === 40) target += columns;
        if (target < 0) document.getElementById("library-sort").focus();
        else if (target < state.items.length || state.done) focusIndex(target);
        else {
          pendingFocus = { index: target, from: active.dataset.item };
          if (failed) loader.querySelector("button").focus();
          else run(loadNext);
        }
        return true;
      },
      dispose: function () {
        snapshot();
        disposed = true;
        controller.abort();
        if (frame != null) cancelAnimationFrame(frame);
        main.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", resize);
      },
    };
    function resize() {
      lastStart = -1;
      schedule();
    }
    main.addEventListener("scroll", schedule);
    window.addEventListener("resize", resize);
    main.tabIndex = -1;
    renderWindow();
    updateCount();
    main.scrollTop = state.scroll;
    renderWindow();
    if (focusControl)
      document
        .getElementById("library-" + focusControl)
        .focus({ preventScroll: true });
    else if (state.focusId) {
      var saved = state.items.findIndex(function (item) {
        return item.Id === state.focusId;
      });
      if (saved >= 0) {
        if (!cardMap.has(saved)) focusIndex(saved);
        else cardMap.get(saved).focus({ preventScroll: true });
      }
    } else main.focus({ preventScroll: true });
    if (!state.items.length && !state.done) await loadNext();
    else schedule();
  }
  function search() {
    reset("Search");
    selectNav("search");
    var form = el("form", null, main);
    var label = el("label", "Title", form);
    label.htmlFor = "search";
    var input = el("input", null, form);
    input.id = "search";
    input.required = true;
    var submit = el("button", "Search", form);
    submit.type = "submit";
    var results = el("section", null, main);
    form.onsubmit = function (e) {
      e.preventDefault();
      var r = ++revision;
      run(async function () {
        message("Searching…");
        var data = await api("/Users/" + session.user + "/Items", {
          SearchTerm: input.value,
          Recursive: true,
          IncludeItemTypes: "Movie,Series,Episode",
          Limit: 48,
        });
        if (r !== revision) return;
        results.textContent = "";
        cards(data.Items, results);
        message("");
        var first = results.querySelector("button");
        if (first) first.focus();
      });
    };
    focusFirst();
  }
  async function detail(id, liveProgram) {
    var r = reset("Loading…");
    var item = await api(
      liveProgram
        ? "/LiveTv/Programs/" + id
        : "/Users/" + session.user + "/Items/" + id,
    );
    if (liveProgram) item.IsLiveProgram = true;
    if (r !== revision) return;
    reset(item.Name);
    main.className = "detail-page";
    setBackdrop(item);
    el("p", itemMetadata(item), main).className = "metadata";
    if (item.Genres && item.Genres.length)
      el("p", item.Genres.join(", "), main).className = "genres";
    if (item.Taglines && item.Taglines.length)
      el("p", item.Taglines[0], main).className = "tagline";
    el("p", item.Overview || "", main).className = "overview";
    var director = (item.People || []).find(function (person) {
      return person.Type === "Director";
    });
    if (director)
      el("p", "Directed by " + director.Name, main).className = "metadata";
    var actions = el("div", null, main);
    actions.className = "actions";
    if (item.IsLiveProgram) {
      button(
        "Watch live",
        function () {
          return play(item, 0, false, true);
        },
        actions,
      );
    } else if (item.IsFolder) {
      button(
        "Browse " + item.Name,
        function () {
          return go(function () {
            return listing(id, item.Name);
          });
        },
        actions,
      );
    } else if (item.MediaType === "Video") {
      var ticks = (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
      if (ticks)
        button(
          "Resume",
          function () {
            return play(item, ticks, true);
          },
          actions,
        );
      button(
        "Play from beginning",
        function () {
          return play(item, 0);
        },
        actions,
      );
    }
    if (!item.IsFolder && !item.IsLiveProgram && item.MediaType === "Video") {
      button(
        "Add to queue",
        function () {
          if (
            (playing && playing.item.Id === item.Id) ||
            queueItems.some(function (entry) {
              return entry.Id === item.Id;
            })
          ) {
            message("Already playing or in the queue.");
            return;
          }
          if (queueItems.length >= 100) {
            message("The queue holds up to 100 videos.");
            return;
          }
          queueItems.push(item);
          message("Added to queue: " + item.Name);
          updatePlaybackButtons();
        },
        actions,
      );
      button(
        "View playback queue",
        function () {
          return go(queuePage);
        },
        actions,
      );
    }
    var firstAction = actions.querySelector("button");
    if (firstAction) firstAction.classList.add("primary-action");
    var favorite = button(
      item.UserData && item.UserData.IsFavorite
        ? "Remove from favorites"
        : "Add to favorites",
      async function () {
        var remove = item.UserData && item.UserData.IsFavorite;
        await api(
          "/Users/" + session.user + "/FavoriteItems/" + item.Id,
          null,
          null,
          remove ? "DELETE" : "POST",
        );
        item.UserData = item.UserData || {};
        item.UserData.IsFavorite = !remove;
        homeCache.delete(accountKey("row:") + "favorite-movies");
        homeCache.delete(accountKey("row:") + "favorite-series");
        favorite.textContent = !remove
          ? "Remove from favorites"
          : "Add to favorites";
      },
      actions,
    );
    button("Back", back, actions);
    var people = (item.People || [])
      .filter(function (person) {
        return person.Type === "Actor";
      })
      .slice(0, 6);
    if (people.length) {
      var cast = el("section", null, main);
      cast.className = "cast-section";
      el("h2", "People", cast);
      var row = el("div", null, cast);
      row.className = "cast-row";
      people.forEach(function (person) {
        var figure = el("figure", null, row);
        if (person.PrimaryImageTag) {
          var img = el("img", null, figure);
          img.src =
            session.server +
            "/Items/" +
            person.Id +
            "/Images/Primary?maxWidth=250";
          img.alt = "";
        }
        el("figcaption", person.Name, figure);
        if (person.Role) el("p", person.Role, figure);
      });
    }
    focusFirst();
  }
  function decoderOptions() {
    return readPreference("decoder-options", {
      native: false,
      dolbyVision: false,
    });
  }
  function playbackOptions() {
    return Object.assign(
      { autoplay: true, countdown: 30, stillWatching: 3 },
      readPreference("playback-options", {}),
    );
  }
  function rememberTrack(type, preference) {
    var preferences = readPreference("track-preferences", {});
    if (preference) preferences[type] = preference;
    else delete preferences[type];
    localStorage.setItem(
      accountKey("track-preferences"),
      JSON.stringify(preferences),
    );
  }
  function autoplayLabel() {
    return (
      "Autoplay next episodes: " + (playbackOptions().autoplay ? "On" : "Off")
    );
  }
  function setAutoplay(value) {
    localStorage.setItem(
      accountKey("playback-options"),
      JSON.stringify(Object.assign(playbackOptions(), { autoplay: value })),
    );
  }
  function queuePage() {
    reset("Playback queue");
    renderQueue(main, false);
    focusFirst();
  }
  function episodeLabel(item) {
    return (
      (item.SeriesName ? item.SeriesName + " · " : "") +
      (item.ParentIndexNumber != null && item.IndexNumber != null
        ? "S" + item.ParentIndexNumber + " E" + item.IndexNumber + " · "
        : "") +
      item.Name
    );
  }
  function renderQueue(container, inPlayer) {
    if (playing) el("p", "Playing: " + episodeLabel(playing.item), container);
    var autoplay = button(
      autoplayLabel(),
      function () {
        setAutoplay(!playbackOptions().autoplay);
        autoplay.textContent = autoplayLabel();
      },
      container,
    );
    if (!queueItems.length)
      el(
        "p",
        "No videos queued. Add videos from their details page.",
        container,
      );
    queueItems.forEach(function (item, index) {
      var row = el("div", null, container);
      row.className = "queue-entry";
      el("p", index + 1 + ". " + episodeLabel(item), row);
      button(
        "Play: " + item.Name,
        function () {
          return play(item, 0);
        },
        row,
      );
      function redraw() {
        if (inPlayer) return openPlaybackPanel("queue");
        queuePage();
      }
      if (index > 0)
        button(
          "Move up: " + item.Name,
          function () {
            queueItems.splice(index, 1);
            queueItems.splice(index - 1, 0, item);
            redraw();
          },
          row,
        );
      if (index < queueItems.length - 1)
        button(
          "Move down: " + item.Name,
          function () {
            queueItems.splice(index, 1);
            queueItems.splice(index + 1, 0, item);
            redraw();
          },
          row,
        );
      button(
        "Remove: " + item.Name,
        function () {
          queueItems.splice(index, 1);
          updatePlaybackButtons();
          redraw();
        },
        row,
      );
    });
    if (queueItems.length)
      button(
        "Clear queue",
        function () {
          queueItems = [];
          updatePlaybackButtons();
          if (inPlayer) return openPlaybackPanel("queue");
          queuePage();
        },
        container,
      );
    if (playing && playing.episodes.length) {
      el("h3", "Following episodes", container);
      playing.episodes.forEach(function (episode) {
        button(
          "Play episode: " + episodeLabel(episode),
          function () {
            return play(episode, 0);
          },
          container,
        );
      });
      el(
        "p",
        "Episodes play automatically when autoplay is On. Queued videos play first.",
        container,
      );
    } else if (playing && playing.nextError) {
      el(
        "p",
        "Could not load following episodes. " + playing.nextError,
        container,
      );
      button(
        "Retry following episodes",
        function () {
          loadFollowing(playing);
          return openPlaybackPanel("queue");
        },
        container,
      );
    }
  }
  function updatePlaybackButtons() {
    var active = playing;
    document.getElementById("audio").disabled =
      !active || active.live || !C.tracks(active.source, "Audio").length;
    document.getElementById("subtitles").disabled =
      !active || active.live || !C.tracks(active.source, "Subtitle").length;
    document.getElementById("chapters").disabled =
      !active || active.live || !C.chapters(active.item).length;
    document.getElementById("next-video").disabled =
      !active || active.live || (!queueItems.length && !active.episodes.length);
  }
  function loadFollowing(active) {
    active.nextError = null;
    active.following = api(
      "/Shows/" + encodeURIComponent(active.item.SeriesId) + "/Episodes",
      {
        UserId: session.user,
        Fields: "Overview",
        StartItemId: active.item.Id,
        Limit: 21,
        IsMissing: false,
      },
      null,
      "GET",
      { signal: active.extrasController.signal },
    )
      .then(function (data) {
        if (playing !== active) return;
        active.episodes = C.followingEpisodes(active.item, data.Items || []);
        updatePlaybackButtons();
      })
      .catch(function (error) {
        if (playing === active) active.nextError = error.message;
      });
  }
  function loadPlaybackExtras(active) {
    if (active.live) return;
    if (!Array.isArray(active.item.Chapters) || !active.source.MediaStreams) {
      active.metadata = api(
        "/Users/" +
          session.user +
          "/Items/" +
          encodeURIComponent(active.item.Id),
        {
          Fields: "Chapters,MediaSources,MediaStreams",
        },
        null,
        "GET",
        { signal: active.extrasController.signal },
      )
        .then(function (item) {
          if (playing !== active) return;
          active.item = Object.assign({}, active.item, item);
          if (!active.source.MediaStreams) {
            var source = (item.MediaSources || []).find(function (entry) {
              return entry.Id === active.source.Id;
            });
            active.source.MediaStreams = source
              ? source.MediaStreams
              : item.MediaStreams;
          }
          updatePlaybackButtons();
        })
        .catch(function () {});
    }
    if (active.item.Type === "Episode" && active.item.SeriesId)
      loadFollowing(active);
  }
  var panelRequest = 0;
  function closePlaybackPanel(restore) {
    panelRequest++;
    if (infoController) {
      infoController.abort();
      infoController = null;
    }
    var panel = document.getElementById("playback-panel");
    panel.hidden = true;
    panel.textContent = "";
    if (restore !== false && panelReturnFocus && panelReturnFocus.isConnected)
      panelReturnFocus.focus();
    showControls();
  }
  async function openPlaybackPanel(kind) {
    hideUpNext();
    var active = playing;
    if (!active || (active.live && kind !== "queue" && kind !== "info")) return;
    var panel = document.getElementById("playback-panel"),
      token = ++panelRequest;
    if (panel.hidden) panelReturnFocus = document.activeElement;
    panel.hidden = false;
    panel.style.bottom =
      Math.max(230, document.getElementById("controls").offsetHeight + 16) +
      "px";
    panel.textContent = "";
    var title = {
      audio: "Audio tracks",
      subtitles: "Subtitles",
      chapters: "Chapters",
      queue: "Playback queue",
      info: "Playback information",
    }[kind];
    panel.setAttribute("aria-label", title);
    el("h2", title, panel);
    button("Close", closePlaybackPanel, panel).focus();
    var content = el("div", null, panel);
    el("p", "Loading…", content);
    showControls();
    await (kind === "queue" ? active.following : active.metadata);
    if (playing !== active || token !== panelRequest) return;
    var stats = null,
      telemetryUnavailable = false;
    if (kind === "info") {
      if (infoController) infoController.abort();
      infoController = new AbortController();
      try {
        var sessions = await api(
          "/Sessions",
          { DeviceId: device },
          null,
          "GET",
          { signal: infoController.signal },
        );
        var match =
          Array.isArray(sessions) &&
          sessions.find(function (entry) {
            return (
              entry.DeviceId === device &&
              entry.UserId === session.user &&
              entry.NowPlayingItem &&
              entry.NowPlayingItem.Id === active.item.Id &&
              (!entry.PlayState ||
                !entry.PlayState.PlaySessionId ||
                entry.PlayState.PlaySessionId === active.sessionId)
            );
          });
        stats = (match && match.TranscodingInfo) || null;
      } catch (_) {
        telemetryUnavailable = true;
      }
    }
    if (playing !== active || token !== panelRequest) return;
    content.textContent = "";
    if (kind === "info") {
      var quality = null;
      try {
        quality =
          video.getVideoPlaybackQuality && video.getVideoPlaybackQuality();
      } catch (_) {}
      var rows = C.playbackInfo(active, stats, {
        width: video.videoWidth,
        height: video.videoHeight,
        dropped: quality && quality.droppedVideoFrames,
        frames: quality && quality.totalVideoFrames,
      });
      var list = el("dl", null, content);
      list.className = "playback-info";
      rows.forEach(function (row) {
        var entry = el("div", null, list);
        entry.className = "playback-info-row";
        entry.tabIndex = 0;
        el("dt", row[0], entry);
        el("dd", row[1], entry);
      });
      if (telemetryUnavailable)
        el(
          "p",
          "Server stream details are unavailable for this account. Source metadata is still shown.",
          content,
        );
      el(
        "p",
        "Source HDR metadata does not confirm the TV's active HDR mode. Audio output and passthrough are managed by the TV and sound system.",
        content,
      );
      button(
        "Refresh playback info",
        function () {
          return openPlaybackPanel("info");
        },
        content,
      );
      if (active.nativeMode && !active.live)
        button(
          "Use Compatibility for this video",
          function () {
            return compatibilityPlayback(active, false);
          },
          content,
        );
    } else if (kind === "queue") renderQueue(content, true);
    else if (kind === "chapters") {
      var chapters = C.chapters(active.item);
      if (!chapters.length) el("p", "No chapters available.", content);
      chapters.forEach(function (chapter, index) {
        button(
          formatTime(chapter.StartPositionTicks / 10000000) +
            " · " +
            (chapter.Name || "Chapter " + (index + 1)),
          function () {
            if (!active.started) {
              message("Wait for playback to start before seeking.");
              return;
            }
            video.currentTime = chapter.StartPositionTicks / 10000000;
            closePlaybackPanel();
            return report("/Progress");
          },
          content,
        );
      });
    } else {
      var subtitle = kind === "subtitles",
        current = subtitle ? active.subtitleIndex : active.audioIndex;
      function option(index, label) {
        var entry = button(
          label,
          function () {
            return switchTrack(subtitle, index);
          },
          content,
        );
        entry.setAttribute("aria-pressed", String(index === current));
      }
      if (subtitle) option(-1, "Off");
      C.tracks(active.source, subtitle ? "Subtitle" : "Audio").forEach(
        function (track) {
          option(track.index, track.label);
        },
      );
      el(
        "p",
        "Language choices are remembered for this account on this TV. Tracks without language metadata apply only to the current video. Reset saved choices in Settings.",
        content,
      );
      if (subtitle)
        el(
          "p",
          "Subtitles are rendered by the server. Changing tracks briefly reloads playback at the same position.",
          content,
        );
    }
  }
  async function switchTrack(subtitle, index) {
    var active = playing;
    if (!active || active.live || busy || !active.started) return;
    var type = subtitle ? "Subtitle" : "Audio";
    var preference = C.trackPreference(active.source, type, index);
    if ((subtitle ? active.subtitleIndex : active.audioIndex) === index) {
      rememberTrack(type, preference);
      closePlaybackPanel();
      return;
    }
    var ticks = position(),
      paused = video.paused;
    video.pause();
    try {
      await play(active.item, ticks, false, false, {
        trackChange: true,
        pendingPreference: { type: type, value: preference },
        paused: paused,
        mediaSourceId: active.source.Id,
        audioIndex: subtitle ? active.audioIndex : index,
        subtitleIndex: subtitle ? index : active.subtitleIndex,
      });
    } catch (error) {
      if (playing === active && !paused) await video.play();
      message("Could not change track. " + error.message);
    }
  }
  var upNext = el("section", null, player);
  upNext.id = "up-next";
  upNext.hidden = true;
  upNext.setAttribute("role", "dialog");
  upNext.setAttribute("aria-label", "Up Next");
  var upNextFocus = null;
  function hideUpNext() {
    var focused = upNext.contains(document.activeElement);
    upNext.hidden = true;
    upNext.textContent = "";
    if (focused && upNextFocus && upNextFocus.isConnected) upNextFocus.focus();
  }
  function dismissUpNext() {
    if (playing) {
      playing.cancelAdvance = true;
      if (playing.awaitingWatching) {
        run(stop);
        return;
      }
    }
    hideUpNext();
  }
  function showUpNext(next, remaining, watching) {
    var active = playing;
    if (!active || document.hidden) return;
    if (
      upNext.hidden ||
      upNext.dataset.item !== next.Id ||
      upNext.dataset.watching !== String(watching)
    ) {
      upNextFocus = document.activeElement;
      upNext.textContent = "";
      upNext.dataset.item = next.Id;
      upNext.dataset.watching = String(watching);
      var artwork = image(next, true);
      if (artwork) {
        var img = el("img", null, upNext);
        img.src = artwork;
        img.alt = "";
        img.onerror = function () {
          img.hidden = true;
        };
      }
      el("h2", watching ? "Still watching?" : "Up Next", upNext);
      el("p", episodeLabel(next), upNext);
      if (next.Overview)
        el("p", next.Overview, upNext).className = "up-next-overview";
      el("p", "", upNext).className = "up-next-countdown";
      button(
        watching ? "Keep watching" : "Play now",
        function () {
          if (playing !== active) return;
          if (watching) active.episodeCount = 0;
          hideUpNext();
          return advancePlayback(true);
        },
        upNext,
      );
      button(watching ? "Stop watching" : "Cancel", dismissUpNext, upNext);
      upNext.hidden = false;
      upNext.querySelector("button").focus();
    }
    upNext.querySelector(".up-next-countdown").textContent = watching
      ? "Playback is paused until you choose."
      : "Starts in " + Math.max(0, Math.ceil(remaining)) + " seconds";
  }
  function updateUpNext() {
    var active = playing,
      options = playbackOptions();
    if (
      !active ||
      active.live ||
      !active.started ||
      active.cancelAdvance ||
      document.hidden
    )
      return;
    var next = queueItems[0] || (options.autoplay && active.episodes[0]);
    if (active.awaitingWatching) {
      if (next) showUpNext(next, 0, true);
      return;
    }
    var duration =
      Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : active.item.RunTimeTicks / 10000000;
    var remaining = duration - video.currentTime;
    if (
      next &&
      options.countdown > 0 &&
      remaining > 0 &&
      remaining <= options.countdown &&
      document.getElementById("playback-panel").hidden
    )
      showUpNext(next, remaining, false);
    else hideUpNext();
  }
  async function advancePlayback(manual) {
    var active = playing;
    if (!active || active.live || active.advancing || busy) return;
    if (!manual && document.hidden) {
      await stop();
      return;
    }
    if (!manual && active.cancelAdvance) {
      await stop();
      return;
    }
    active.advancing = true;
    try {
      if (!queueItems.length) await active.following;
      if (playing !== active) return;
      var next =
        queueItems[0] ||
        ((manual || playbackOptions().autoplay) && active.episodes[0]);
      if (!next) {
        if (!manual) await stop();
        else message("No more videos in the queue.");
        return;
      }
      var threshold = playbackOptions().stillWatching;
      if (!manual && threshold > 0 && active.episodeCount >= threshold) {
        active.awaitingWatching = true;
        video.pause();
        showUpNext(next, 0, true);
        return;
      }
      await play(next, 0, false, false, { episodeCount: active.episodeCount });
    } catch (error) {
      message("Could not play the next video. " + error.message);
      showControls();
    } finally {
      active.advancing = false;
    }
  }
  async function compatibilityPlayback(active, automatic) {
    if (playing !== active || busy || active.fallbackInProgress) return;
    active.fallbackInProgress = true;
    var ticks =
      automatic && active.lastPositionTicks != null
        ? active.lastPositionTicks
        : position();
    if (automatic) active.failurePositionTicks = ticks;
    var paused = video.paused;
    video.pause();
    try {
      await play(active.item, ticks, false, false, {
        compatibility: true,
        trackChange: true,
        paused: automatic ? false : paused,
        mediaSourceId: active.source.Id,
        audioIndex: active.audioIndex,
        subtitleIndex: active.subtitleIndex,
        pendingPreference: active.pendingPreference,
        policyReason: automatic
          ? "Native playback failed; retried with Compatibility"
          : "Compatibility requested for this video",
      });
    } catch (error) {
      message("Compatibility playback failed. " + error.message);
      if (playing === active) await stop();
    }
  }
  document.getElementById("playback-info").onclick = function () {
    run(function () {
      return openPlaybackPanel("info");
    });
  };
  ["audio", "subtitles", "chapters", "queue"].forEach(function (kind) {
    document.getElementById(kind).onclick = function () {
      run(function () {
        return openPlaybackPanel(kind);
      });
    };
  });
  document.getElementById("next-video").onclick = function () {
    run(function () {
      return advancePlayback(true);
    });
  };

  function position() {
    if (!playing) return 0;
    if (playing.failurePositionTicks != null)
      return playing.failurePositionTicks;
    if (!playing.started) return playing.resumeTicks;
    return Math.round(video.currentTime * 10000000);
  }
  function report(path, extra) {
    var active = playing;
    if (!active || !active.started) return Promise.resolve();
    var payload = Object.assign(
      {
        ItemId: active.item.Id,
        MediaSourceId: active.source.Id,
        PlaySessionId: active.sessionId,
        PositionTicks: position(),
        IsPaused: video.paused,
        CanSeek: !active.live,
        LiveStreamId: active.source.LiveStreamId,
        PlayMethod: active.method,
        AudioStreamIndex: active.audioIndex,
        SubtitleStreamIndex: active.subtitleIndex,
      },
      extra || {},
    );
    // Keep start/progress/stop ordered so a late progress request cannot undo stop.
    active.reporting = active.reporting
      .catch(function () {})
      .then(function () {
        return api("/Sessions/Playing" + path, null, payload);
      });
    return active.reporting;
  }
  function finishResume() {
    var active = playing;
    if (!active || active.started || !active.metadataReady) return;
    var target = active.resume;
    if (target > 0 && Math.abs(video.currentTime - target) > 2) {
      if (Date.now() > active.resumeDeadline) {
        message(
          "The TV could not seek to your saved position. Your saved position has been kept. Please try Resume again.",
        );
        run(stop);
        return;
      }
      if (!video.seeking && Date.now() - active.lastSeek > 750) {
        var canSeek =
          Number.isFinite(video.duration) && video.duration >= target;
        for (var i = 0; i < video.seekable.length; i++) {
          if (
            video.seekable.start(i) <= target &&
            video.seekable.end(i) >= target
          )
            canSeek = true;
        }
        if (canSeek) {
          active.lastSeek = Date.now();
          try {
            video.currentTime = target;
          } catch (_) {}
        }
      }
      return;
    }
    if (!active.hasPlayed || video.seeking) return;
    active.started = true;
    active.lastPositionTicks = Math.round(video.currentTime * 10000000);
    if (active.pendingPreference) {
      rememberTrack(
        active.pendingPreference.type,
        active.pendingPreference.value,
      );
      active.pendingPreference = null;
    }
    clearInterval(resumeTimer);
    run(function () {
      return report("");
    });
  }
  async function play(item, ticks, resumeSaved, live, options) {
    options = options || {};
    if (busy) return;
    busy = true;
    var request = ++playRequest,
      previous = playing,
      controller = new AbortController();
    playController = controller;
    function playbackApi(path, values, body) {
      return api(path, values, body, undefined, { signal: controller.signal });
    }
    message("Preparing playback…");
    var returnItem = item,
      openedLive = null;
    try {
      if (live) {
        if (!item.ChannelId)
          throw new Error("This programme does not have a playable channel.");
        item = await playbackApi(
          "/Users/" + session.user + "/Items/" + item.ChannelId,
        );
        item = Object.assign({}, item, {
          Name: returnItem.Name,
          IsLiveProgram: true,
        });
        ticks = 0;
      }
      if (resumeSaved) {
        item = await playbackApi(
          "/Users/" + session.user + "/Items/" + item.Id,
        );
        ticks = (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
      }
      var decoder = decoderOptions(),
        preferences =
          !options.trackChange && !live
            ? readPreference("track-preferences", {})
            : {};
      var sourceMetadata = null;
      if (
        !live &&
        ((decoder.native && !options.compatibility) ||
          preferences.Audio ||
          preferences.Subtitle ||
          ((options.audioIndex != null || options.subtitleIndex != null) &&
            !options.mediaSourceId))
      ) {
        var sources = item.MediaSources;
        if (
          !sources ||
          !sources.some(function (source) {
            return Array.isArray(source.MediaStreams);
          })
        ) {
          var metadata = await playbackApi(
            "/Items/" + encodeURIComponent(item.Id) + "/PlaybackInfo",
            { UserId: session.user },
          );
          sources = metadata.MediaSources || [];
        }
        sourceMetadata = sources.find(function (source) {
          return (
            (!options.mediaSourceId || source.Id === options.mediaSourceId) &&
            Array.isArray(source.MediaStreams)
          );
        });
        if (!sourceMetadata)
          sourceMetadata = sources.find(function (source) {
            return (
              !options.mediaSourceId || source.Id === options.mediaSourceId
            );
          });
        if (sourceMetadata) options.mediaSourceId = sourceMetadata.Id;
        if (preferences.Audio)
          options.audioIndex = C.preferredTrack(
            sourceMetadata || {},
            "Audio",
            preferences.Audio,
          );
        if (preferences.Subtitle)
          options.subtitleIndex = C.preferredTrack(
            sourceMetadata || {},
            "Subtitle",
            preferences.Subtitle,
          );
        if (
          options.audioIndex != null ||
          (options.subtitleIndex != null &&
            (options.subtitleIndex >= 0 ||
              !sourceMetadata ||
              sourceMetadata.DefaultSubtitleStreamIndex !==
                options.subtitleIndex))
        )
          options.applyPreferences = true;
      }
      var subtitleIndex =
        options.subtitleIndex != null
          ? options.subtitleIndex
          : sourceMetadata
            ? sourceMetadata.DefaultSubtitleStreamIndex
            : undefined;
      var policy = live
        ? { native: false, reason: "Live TV uses compatibility HLS" }
        : options.compatibility
          ? { native: false, reason: options.policyReason }
          : C.nativePolicy(sourceMetadata, decoder, subtitleIndex);
      var nativeMode = policy.native;
      var deviceProfile = C.profile({
        native: nativeMode,
        dolbyVision: decoder.dolbyVision,
      });
      var forceTranscode =
        !!live ||
        !!options.trackChange ||
        !!options.applyPreferences ||
        !!options.compatibility;
      var requestBody = {
        UserId: session.user,
        StartTimeTicks: ticks,
        IsPlayback: true,
        AutoOpenLiveStream: true,
        EnableDirectPlay: !forceTranscode,
        EnableDirectStream: nativeMode,
        EnableTranscoding: true,
        AllowVideoStreamCopy: !options.compatibility && !(subtitleIndex >= 0),
        MaxAudioChannels: nativeMode ? 6 : 2,
        AudioStreamIndex: options.audioIndex,
        SubtitleStreamIndex: options.subtitleIndex,
        MediaSourceId: options.mediaSourceId,
      };
      var info = await playbackApi(
        "/Items/" + encodeURIComponent(item.Id) + "/PlaybackInfo",
        requestBody,
        Object.assign({}, requestBody, {
          DeviceProfile: deviceProfile,
          MaxStreamingBitrate: deviceProfile.MaxStreamingBitrate,
        }),
      );
      openedLive = (info.MediaSources || []).find(function (source) {
        return !!source.LiveStreamId;
      });
      openedLive = openedLive && openedLive.LiveStreamId;
      var selected = C.stream(
        session.server,
        item.Id,
        info,
        session.token,
        device,
        forceTranscode,
      );
      if (request !== playRequest || document.hidden) return;
      if (previous)
        await stop({
          transition: true,
          positionTicks: previous.item.Id === item.Id ? ticks : undefined,
        });
      if (request !== playRequest || document.hidden) return;
      playing = Object.assign(selected, {
        item: item,
        episodeCount:
          options.trackChange && previous
            ? previous.episodeCount
            : item.Type === "Episode"
              ? (options.episodeCount || 0) + 1
              : 0,
        cancelAdvance:
          options.trackChange && previous ? previous.cancelAdvance : false,
        returnItem: returnItem,
        live: !!live,
        audioIndex:
          options.audioIndex != null
            ? options.audioIndex
            : selected.source.DefaultAudioStreamIndex,
        subtitleIndex:
          options.subtitleIndex != null
            ? options.subtitleIndex
            : selected.source.DefaultSubtitleStreamIndex,
        nativeMode: nativeMode,
        profileName: deviceProfile.Name,
        policyReason: policy.reason,
        pendingPreference: options.pendingPreference,
        pauseOnReady: !!options.paused,
        episodes: options.trackChange && previous ? previous.episodes : [],
        extrasController: new AbortController(),
        sessionId: info.PlaySessionId,
        resume: ticks / 10000000,
        resumeTicks: ticks,
        started: false,
        metadataReady: false,
        hasPlayed: false,
        lastSeek: 0,
        resumeDeadline: Date.now() + 30000,
        reporting: Promise.resolve(),
        returnFocus: previous ? previous.returnFocus : document.activeElement,
      });
      openedLive = null;
      queueItems = queueItems.filter(function (entry) {
        return entry.Id !== item.Id;
      });
      hideUpNext();
      closePlaybackPanel(false);
      updatePlaybackButtons();
      loadPlaybackExtras(playing);
      player.hidden = false;
      document.body.classList.add("is-playing");
      video.style.objectFit = previous ? video.style.objectFit : "contain";
      document.getElementById("fit").textContent =
        video.style.objectFit === "cover" ? "Fit video" : "Fill screen";
      document.getElementById("rewind").disabled = !!live;
      document.getElementById("forward").disabled = !!live;
      document.getElementById("timeline").hidden = !!live;
      showControls();
      document.getElementById("playing-title").textContent = item.Name;
      video.src = selected.url + (ticks ? "#t=" + ticks / 10000000 : "");
      resumeTimer = setInterval(finishResume, 250);
      video.load();
      document.getElementById("toggle").focus();
      message("");
      timer = setInterval(function () {
        run(function () {
          return report("/Progress");
        });
      }, 10000);
    } catch (error) {
      if (request === playRequest) throw error;
    } finally {
      if (playController === controller) playController = null;
      busy = false;
      if (openedLive)
        await api(
          "/LiveStreams/Close",
          { LiveStreamId: openedLive },
          { LiveStreamId: openedLive },
        );
    }
  }
  video.onloadedmetadata = function () {
    if (!playing) return;
    playing.metadataReady = true;
    if (document.hidden) return;
    finishResume();
    if (playing.pauseOnReady) {
      playing.hasPlayed = true;
      finishResume();
      showControls();
    } else
      run(function () {
        if (playing && !document.hidden) return video.play();
      });
  };
  video.onplaying = function () {
    if (!playing) return;
    if (document.hidden) {
      video.pause();
      return;
    }
    playing.hasPlayed = true;
    finishResume();
  };
  ["canplay", "durationchange", "progress", "seeked"].forEach(function (event) {
    video.addEventListener(event, finishResume);
  });
  video.addEventListener("seeked", function () {
    if (playing && playing.started && !video.error)
      playing.lastPositionTicks = Math.round(video.currentTime * 10000000);
  });
  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    var hours = Math.floor(seconds / 3600),
      minutes = Math.floor(seconds / 60) % 60;
    return (
      (hours ? hours + ":" + String(minutes).padStart(2, "0") : minutes) +
      ":" +
      String(seconds % 60).padStart(2, "0")
    );
  }
  video.ontimeupdate = function () {
    if (!playing || video.error) return;
    finishResume();
    if (!playing) return;
    playing.lastPositionTicks = position();
    updateUpNext();
    var elapsed = position() / 10000000;
    var duration = playing.live
      ? 0
      : playing.item.RunTimeTicks / 10000000 ||
        (Number.isFinite(video.duration) ? video.duration : 0);
    document.getElementById("clock").textContent = playing.live
      ? "Live"
      : formatTime(elapsed) + (duration ? " / " + formatTime(duration) : "");
    document.getElementById("timeline-fill").style.width = duration
      ? Math.min(100, (elapsed / duration) * 100) + "%"
      : "0%";
  };
  video.onerror = function () {
    if (
      playing &&
      playing.nativeMode &&
      !document.hidden &&
      !busy &&
      !playing.fallbackInProgress
    ) {
      var active = playing;
      message(
        "Native playback failed. Trying Compatibility at the same position…",
      );
      run(function () {
        return compatibilityPlayback(active, true);
      });
      return;
    }
    if (playing && playing.lastPositionTicks != null)
      playing.failurePositionTicks = playing.lastPositionTicks;
    message(
      "Playback failed. Check server transcoding logs and TV codec support.",
    );
    run(stop);
  };
  video.onended = function () {
    run(function () {
      return advancePlayback(false);
    });
  };
  video.onpause = function () {
    showControls();
    document.getElementById("toggle").textContent = "Play";
    run(function () {
      return report("/Progress");
    });
  };
  video.onplay = function () {
    showControls();
    document.getElementById("toggle").textContent = "Pause";
    run(function () {
      return report("/Progress");
    });
  };
  async function stop(options) {
    options = options || {};
    if (!options.transition) {
      playRequest++;
      if (playController) playController.abort();
      if (status.textContent === "Preparing playback…") message("");
    }
    if (!playing) return;
    clearInterval(timer);
    clearTimeout(controlsTimer);
    clearInterval(resumeTimer);
    var stopped = playing,
      stoppedRevision = revision,
      ticks =
        options.positionTicks != null ? options.positionTicks : position();
    hideUpNext();
    playing = null;
    stopped.extrasController.abort();
    closePlaybackPanel(false);
    video.pause();
    video.removeAttribute("src");
    video.load();
    player.hidden = true;
    document.body.classList.remove("is-playing");
    if (
      !options.transition &&
      stopped.returnFocus &&
      stopped.returnFocus.isConnected
    )
      stopped.returnFocus.focus();
    try {
      await stopped.reporting.catch(function () {});
      if (stopped.started)
        await api("/Sessions/Playing/Stopped", null, {
          ItemId: stopped.item.Id,
          MediaSourceId: stopped.source.Id,
          PlaySessionId: stopped.sessionId,
          PositionTicks: ticks,
        });
    } finally {
      try {
        if (stopped.method === "Transcode")
          await api(
            "/Videos/ActiveEncodings",
            { DeviceId: device, PlaySessionId: stopped.sessionId },
            null,
            "DELETE",
          );
      } finally {
        if (stopped.source.LiveStreamId)
          await api(
            "/LiveStreams/Close",
            { LiveStreamId: stopped.source.LiveStreamId },
            { LiveStreamId: stopped.source.LiveStreamId },
          );
      }
    }
    homeCache.delete(accountKey("row:") + "continue");
    homeCache.delete(accountKey("row:") + "next");
    previewCache.delete(stopped.item.Id);
    if (
      !options.transition &&
      stopped.started &&
      revision === stoppedRevision &&
      !playing &&
      stopped.returnFocus &&
      stopped.returnFocus.isConnected
    ) {
      await detail(stopped.returnItem.Id, !!stopped.live);
    }
  }
  function showControls() {
    var controls = document.getElementById("controls");
    controls.style.opacity = "1";
    clearTimeout(controlsTimer);
    if (playing)
      controlsTimer = setTimeout(function () {
        if (!video.paused && document.getElementById("playback-panel").hidden)
          controls.style.opacity = "0";
      }, 3000);
  }
  player.addEventListener("mousemove", showControls);
  player.addEventListener("click", showControls);
  function toggle() {
    if (playing && playing.awaitingWatching) return;
    if (video.paused) return video.play();
    video.pause();
  }
  function seek(seconds) {
    if (
      !playing ||
      !playing.started ||
      playing.live ||
      playing.awaitingWatching
    )
      return;
    var target = Math.max(0, video.currentTime + seconds);
    if (Number.isFinite(video.duration))
      target = Math.min(target, video.duration);
    video.currentTime = target;
  }
  document.getElementById("toggle").onclick = function () {
    run(toggle);
  };
  document.getElementById("rewind").onclick = function () {
    seek(-30);
  };
  document.getElementById("forward").onclick = function () {
    seek(30);
  };
  document.getElementById("fit").onclick = function () {
    var fill = video.style.objectFit !== "cover";
    video.style.objectFit = fill ? "cover" : "contain";
    this.textContent = fill ? "Fit video" : "Fill screen";
    showControls();
  };
  document.getElementById("stop").onclick = function () {
    run(stop);
  };
  document.addEventListener("focusin", function (e) {
    document
      .querySelector("header")
      .classList.toggle("drawer-open", nav.contains(e.target));
    document.querySelector("header").scrollLeft = 0;
    nav.scrollLeft = 0;
    if (main.contains(e.target)) contentFocus = e.target;
  });
  function focusContent(node) {
    if (!node) return;
    node.focus();
    node.scrollIntoView({ block: "nearest", inline: "nearest" });
    var rows = document.getElementById("home-rows");
    if (rows && rows.contains(node)) {
      var section = node.closest("section");
      if (section)
        rows.scrollTop +=
          section.getBoundingClientRect().top -
          rows.getBoundingClientRect().top -
          8;
    }
  }
  document.addEventListener("keydown", function (e) {
    var key = e.keyCode;
    if (key === 13 && document.activeElement.type === "checkbox") {
      e.preventDefault();
      document.activeElement.click();
      return;
    }
    if (key === 461 || key === 27) {
      e.preventDefault();
      run(back);
      return;
    }
    if (playing && !upNext.hidden) {
      if (key >= 37 && key <= 40) {
        e.preventDefault();
        var choices = Array.prototype.slice.call(
          upNext.querySelectorAll("button"),
        );
        var index = choices.indexOf(document.activeElement);
        choices[
          Math.max(
            0,
            Math.min(
              choices.length - 1,
              index + (key === 37 || key === 38 ? -1 : 1),
            ),
          )
        ].focus();
        return;
      }
      if (key === 13) return;
      if (
        playing.awaitingWatching &&
        [415, 19, 179, 32, 412, 417].indexOf(key) >= 0
      ) {
        e.preventDefault();
        return;
      }
    }
    if (playing) {
      var panelOpen = !document.getElementById("playback-panel").hidden;
      var controlsHidden =
        document.getElementById("controls").style.opacity === "0";
      showControls();
      if (controlsHidden && (key === 37 || key === 39)) {
        e.preventDefault();
        seek(key === 37 ? -30 : 30);
        return;
      }
      if (controlsHidden && key === 13) {
        e.preventDefault();
        return;
      }
      if (key === 415) {
        e.preventDefault();
        run(function () {
          return video.play();
        });
        return;
      }
      if (key === 19) {
        e.preventDefault();
        video.pause();
        return;
      }
      if (key === 179 || key === 32) {
        e.preventDefault();
        run(toggle);
        return;
      }
      if (key === 413) {
        e.preventDefault();
        run(stop);
        return;
      }
      if (!panelOpen && (key === 412 || key === 417)) {
        e.preventDefault();
        seek(key === 412 ? -30 : 30);
        return;
      }
    }
    if (key < 37 || key > 40) return;
    var active = document.activeElement;
    if (
      active.tagName === "INPUT" &&
      active.type !== "checkbox" &&
      active.value &&
      (key === 37 || key === 39)
    )
      return;
    e.preventDefault();
    if (!playing && activeListing && activeListing.handleKey(key, active))
      return;
    if (!playing && nav.contains(active)) {
      var entries = Array.prototype.slice.call(nav.querySelectorAll("button")),
        index = entries.indexOf(active);
      if (key === 38 || key === 40)
        focusContent(entries[index + (key === 38 ? -1 : 1)]);
      if (key === 39)
        focusContent(
          contentFocus && contentFocus.isConnected
            ? contentFocus
            : main.querySelector("input,button,select"),
        );
      return;
    }
    var rail = !playing && active.closest(".rail");
    if (rail) {
      var rowCards = Array.prototype.slice.call(
          rail.querySelectorAll("button"),
        ),
        cardIndex = rowCards.indexOf(active);
      if (key === 37 || key === 39) {
        var sibling = rowCards[cardIndex + (key === 37 ? -1 : 1)];
        if (sibling) focusContent(sibling);
        else if (key === 37)
          focusContent(
            nav.querySelector('[aria-current="page"]') ||
              nav.querySelector("button"),
          );
        return;
      }
      var rails = Array.prototype.slice
          .call(main.querySelectorAll(".rail"))
          .filter(function (node) {
            return node.getClientRects().length;
          }),
        nextRail = rails[rails.indexOf(rail) + (key === 38 ? -1 : 1)];
      if (nextRail) {
        var nextCards = nextRail.querySelectorAll("button");
        focusContent(nextCards[Math.min(cardIndex, nextCards.length - 1)]);
      } else if (key === 38)
        focusContent(
          nav.querySelector('[aria-current="page"]') ||
            nav.querySelector("button"),
        );
      return;
    }
    var scope = playing
      ? document.getElementById("playback-panel").hidden
        ? player
        : document.getElementById("playback-panel")
      : (activeListing && activeListing.scope()) || main;
    var nodes = Array.prototype.slice
      .call(scope.querySelectorAll('button,input,select,[tabindex="0"]'))
      .filter(function (n) {
        return !n.disabled && n.getClientRects().length;
      });
    if (nodes.indexOf(active) < 0) {
      if (nodes[0]) nodes[0].focus();
      return;
    }
    var next = C.neighbor(
      active.getBoundingClientRect(),
      nodes
        .filter(function (n) {
          return n !== active;
        })
        .map(function (n) {
          return { element: n, rect: n.getBoundingClientRect() };
        }),
      { 37: "left", 38: "up", 39: "right", 40: "down" }[key],
    );
    if (!next && !playing && key === 37) {
      focusContent(
        nav.querySelector('[aria-current="page"]') ||
          nav.querySelector("button"),
      );
      return;
    }
    if (next) {
      next.focus();
      next.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && cancelQuickConnect) {
      login();
      message(
        "Quick Connect cancelled while the app was hidden. Generate a new code to continue.",
      );
    }
    if (!document.hidden && playing) updateUpNext();
    if (document.hidden && playing) {
      hideUpNext();
      if (playing.live) run(stop);
      else video.pause();
    }
  });
  function updateWallClock() {
    document.getElementById("wall-clock").textContent =
      new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  updateWallClock();
  setInterval(updateWallClock, 30000);
  if (session && session.token) libraryItems = readPreference("libraries", []);
  navigation();
  if (session && session.token && !session.name) {
    var current = session;
    api("/Users/" + session.user)
      .then(function (user) {
        if (session !== current || !user.Name) return;
        session.name = user.Name;
        localStorage.setItem("wholphin-session", JSON.stringify(session));
        document.getElementById("profile-initial").textContent =
          user.Name.charAt(0).toUpperCase();
      })
      .catch(function () {});
  }
  if (session && session.token)
    run(function () {
      return go(home);
    });
  else login();
})();
