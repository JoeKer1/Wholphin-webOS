(function () {
  "use strict";
  var P = window.EmberPlatform,
    C = window.WholphinCore,
    main = document.getElementById("main"),
    nav = document.getElementById("nav"),
    status = document.getElementById("status"),
    video = P.createPlayer(document.getElementById("video")),
    player = document.getElementById("player");
  var session = null,
    playing = null,
    livePreview = false,
    stack = [],
    revision = 0,
    timer = null,
    busy = false,
    controlsTimer = null,
    resumeTimer = null,
    subtitleTimer = null,
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
    playbackHistory = [],
    playRequest = 0,
    playController = null,
    panelReturnFocus = null,
    infoController = null,
    listingStates = new Map(),
    activeListing = null,
    activeGuide = null,
    detailController = null,
    detailRowObserver = null,
    bonfireAvailable = false,
    bonfireProfile = null;
  var device = localStorage.getItem("wholphin-device");
  if (!device) {
    device = "webos-" + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem("wholphin-device", device);
  }
  try {
    session = JSON.parse(localStorage.getItem("wholphin-session"));
    if (session && session.profileAccount) {
      delete session.profileAccount;
      localStorage.setItem("wholphin-session", JSON.stringify(session));
    }
  } catch (_) {}
  function el(tag, text, parent) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  }
  function button(text, action, parent) {
    var b = el("button", text, parent);
    b.onmousedown = function (event) {
      if (b.classList.contains("icon-action")) event.preventDefault();
    };
    b.onclick = function () {
      run(action);
      if (b.classList.contains("icon-action")) b.focus();
    };
    if (parent && parent.classList.contains("actions") && text)
      labelAction(b, text);
    return b;
  }
  function labelAction(node, label) {
    var icon = /^Play from beginning/.test(label)
      ? node.classList.contains("primary-action")
        ? "play_arrow"
        : "replay"
      : /^(Play|Resume)/.test(label)
        ? "play_arrow"
        : label === "Mark as watched"
          ? "visibility_off"
          : label === "Mark as unwatched"
            ? "visibility"
            : /favorites/i.test(label)
              ? "heart"
              : label === "Back"
                ? "arrow_back"
                : label === "Add to queue"
                  ? "playlist_add"
                  : /seasons|playback queue/i.test(label)
                    ? "movie"
                    : "more_vert";
    node.classList.add("icon-action");
    node.setAttribute("aria-label", label);
    var text = node.querySelector(".action-label"),
      art = node.querySelector(".action-icon");
    if (!text) {
      node.textContent = "";
      art = el("span", null, node);
      art.className = "action-icon";
      text = el("span", null, node);
      text.className = "action-label";
    }
    if (art.dataset.icon !== icon) {
      art.textContent = "";
      art.dataset.icon = icon;
      if (icon === "heart") art.appendChild(navIcon("favorites"));
      else {
        var img = el("img", null, art);
        setImageSource(img, "icons/" + (icon === "movie" ? "local_movies" : icon) + ".svg");
        img.alt = "";
      }
    }
    text.textContent = label;
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
      'MediaBrowser Client="Ember", Device="' +
      P.deviceName +
      '", DeviceId="' +
      device +
      '", Version="0.2.80"' +
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
      }, options.timeoutMs || 20000);
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
        if (
          options.profileErrors &&
          [400, 403].indexOf(response.status) !== -1
        ) {
          var reason = (await response.text()).slice(0, 300);
          try {
            var parsed = JSON.parse(reason);
            if (typeof parsed === "string") reason = parsed;
          } catch (_) {}
          if (reason) error.message = reason;
        }
        throw error;
      }
      if (options.subtitleText) {
        var limit = 2097152;
        if (Number(response.headers.get("content-length")) > limit) {
          if (response.body) await response.body.cancel();
          throw Object.assign(new Error("Subtitle file is too large."), {code: "SUBTITLE_TOO_LARGE"});
        }
        var reader = response.body.getReader(),
          chunks = [],
          bytes = 0;
        try {
          while (true) {
            var part = await reader.read();
            if (part.done) break;
            bytes += part.value.length;
            if (bytes > limit) {
              await reader.cancel();
              throw Object.assign(new Error("Subtitle file is too large."), {code: "SUBTITLE_TOO_LARGE"});
            }
            chunks.push(part.value);
          }
        } finally {
          reader.releaseLock();
        }
        var all = new Uint8Array(bytes),
          offset = 0;
        chunks.forEach(function (chunk) {
          all.set(chunk, offset);
          offset += chunk.length;
        });
        return new TextDecoder("utf-8").decode(all);
      }
      return response.status === 204 ? null : await response.json();
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }
  function focusFirst() {
    var node =
      Array.prototype.find.call(
        main.querySelectorAll("input,button,select"),
        function (entry) {
          return !entry.disabled && entry.getClientRects().length;
        },
      ) || nav.querySelector("button");
    if (node) node.focus();
  }
  function reset(title) {
    closeSubtitleSearch(false);
    main.removeAttribute("data-profile-theme");
    document.body.classList.remove("choosing-profile");
    if (livePreview && title !== "Live TV") run(stop);
    revision++;
    if (detailController) {
      detailController.abort();
      detailController = null;
    }
    if (detailRowObserver) {
      detailRowObserver.disconnect();
      detailRowObserver = null;
    }
    if (activeGuide) {
      activeGuide.dispose();
      activeGuide = null;
    }
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
    main.refreshPlaybackUserData = null;
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
    if (stack.length) {
      var active = document.activeElement,
        rail =
          active &&
          active.classList.contains("card") &&
          active.closest(".detail-media-row"),
        frame = stack[stack.length - 1];
      frame.focus = active && active.dataset.item;
      frame.related = rail
        ? {
            key: rail.dataset.rowKey,
            index: Array.prototype.indexOf.call(
              rail.querySelectorAll(".rail button"),
              active,
            ),
          }
        : null;
    }
    stack.push({ action: action });
    return action();
  }
  function fullscreenLive() {
    if (!playing || !playing.live) return;
    livePreview = false;
    document.body.classList.remove("live-preview");
    document.body.classList.add("is-playing");
    showControls();
    document.getElementById("toggle").focus();
  }
  function livePreviewActions(toolbar) {
    var actions = el("div", null, toolbar);
    actions.className = "live-preview-actions";
    button("Return to fullscreen", fullscreenLive, actions);
    button("Stop Live TV", stop, actions);
  }
  async function showLivePreview() {
    if (!playing || !playing.live) return;
    livePreview = true;
    document.body.classList.add("live-preview");
    document.body.classList.remove("is-playing");
    hideControls();
    if (!activeGuide || !main.classList.contains("live-guide-page")) {
      var state = { focusChannel: playing.item.Id };
      await go(function () {
        return liveGuide(state);
      });
    }
    if (!playing || !playing.live || !livePreview) return;
    if (!main.querySelector(".live-preview-actions"))
      livePreviewActions(main.querySelector(".guide-toolbar"));
    if (activeGuide) activeGuide.focusChannel(playing.item.Id);
  }
  async function back() {
    var settingsMenu = document.getElementById("setting-options");
    if (settingsMenu) { settingsMenu.closeMenu(); return; }
    if (subtitleSearch && !subtitleSearch.hidden) { closeSubtitleSearch(); return; }
    if (main.classList.contains("profiles-page")) return profilesPage();
    var moreMenu = document.getElementById("detail-more-options");
    if (moreMenu && !moreMenu.hidden && !playing) {
      moreMenu.hidden = true;
      var more = document.getElementById("detail-more-button");
      more.setAttribute("aria-expanded", "false");
      more.focus();
      return;
    }
    var subtitleMenu = document.getElementById("detail-subtitle-menu");
    if (subtitleMenu && !subtitleMenu.hidden && !playing) {
      subtitleMenu.hidden = true;
      var picker = document.getElementById("detail-subtitles");
      picker.setAttribute("aria-expanded", "false");
      picker.focus();
      return;
    }
    if (!upNext.hidden) {
      dismissUpNext();
      return;
    }
    if (activeListing && activeListing.closeOptions()) return;
    if (!document.getElementById("playback-panel").hidden) {
      var section = document.getElementById("playback-panel").dataset.kind;
      if (["appearance", "timing"].indexOf(section) >= 0) {
        closePlaybackPanel(false);
        document.getElementById("player-options").click();
        document.getElementById("subtitle-" + section).focus();
        return;
      }
      closePlaybackPanel();
      return;
    }
    if (main.classList.contains("quick-connect-page")) {
      login();
      return;
    }
    if (playing && !document.getElementById("player-tools").hidden) {
      closePlayerTools();
      return;
    }
    if (playing && playing.live) {
      if (livePreview) await stop();
      else await showLivePreview();
      return;
    }
    if (playing && document.getElementById("controls").style.opacity !== "0") {
      hideControls();
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
    } else if (P.exit) {
      if (window.confirm("Exit Ember?")) P.exit();
    } else if (window.webOS && window.webOS.platformBack)
      window.webOS.platformBack();
    else if (window.PalmSystem) {
      if (window.confirm("Exit Ember?")) window.close();
    } else message("You are on the home screen.");
  }
  function navIcon(name) {
    var paths = {
      play: "M8 4l13 8-13 8Z",
      pause: "M8 4v16M16 4v16",
      rewind: "M11 5L3 12l8 7V5M21 5l-8 7 8 7V5",
      forward: "M3 5l8 7-8 7V5M13 5l8 7-8 7V5",
      next: "M5 4l12 8-12 8ZM20 4v16",
      stop: "M5 5h14v14H5Z",
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
  function profileAvatar(profile, host) {
    host.textContent =
      profile.avatarInitial ||
      (profile.profileName || "U").charAt(0).toUpperCase();
    if (/^#[0-9a-f]{6}$/i.test(profile.avatarColor || ""))
      host.style.backgroundColor = profile.avatarColor;
    if (profile.transparentAvatar) host.style.backgroundColor = "transparent";
    if (typeof profile.profileImage !== "string") return;
    var url = profile.profileImage;
    if (url.indexOf("/plugins/profiles/") === 0) url = session.server + url;
    try {
      var parsed = new URL(url);
      if (
        ["http:", "https:"].indexOf(parsed.protocol) === -1 ||
        parsed.username ||
        parsed.password
      )
        return;
      var img = el("img", null, host);
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = function () {
        img.remove();
      };
      setImageSource(img, parsed.href);
    } catch (_) {}
  }
  function rememberBonfireProfiles(profiles) {
    bonfireAvailable = Array.isArray(profiles);
    bonfireProfile = bonfireAvailable
      ? profiles.map(bonfireFields).filter(function (profile) {
          return (
            typeof profile.profileUserId === "string" &&
            profile.profileUserId.replace(/-/g, "").toLowerCase() ===
              session.user.replace(/-/g, "").toLowerCase()
          );
        })[0] || null
      : null;
  }
  function navigation() {
    document.getElementById("profile-initial").textContent =
      session && session.name ? session.name.charAt(0).toUpperCase() : "U";
    document.getElementById("profile-initial").hidden = bonfireAvailable;
    var signature =
      session && session.token
        ? session.server +
          session.user +
          String(bonfireAvailable) +
          JSON.stringify(bonfireProfile) +
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
    if (bonfireAvailable) {
      var profilesEntry = entry(
        "Switch profile",
        "settings",
        function () {
          return go(profilesPage);
        },
        "profiles",
      );
      var initial = el(
        "span",
        session.name ? session.name.charAt(0).toUpperCase() : "U",
      );
      initial.className = "profile-nav-initial";
      profileAvatar(bonfireProfile || { profileName: session.name }, initial);
      profilesEntry.replaceChild(initial, profilesEntry.querySelector("svg"));
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
    var libraryOrder = ["movies", "tv", "anime", "kids tv", "collections", "discover"];
    function libraryName(item) {
      var name = item.Name.toLowerCase().replace(/\s+/g, " ").trim();
      if (name === "tv shows" || name === "television") return "tv";
      if (name === "kids" || name === "kids shows") return "kids tv";
      if (item.CollectionType === "boxsets") return "collections";
      return name;
    }
    function libraryRank(item) {
      var rank = libraryOrder.indexOf(libraryName(item));
      return rank === -1 ? libraryOrder.length : rank;
    }
    function libraryEntry(item) {
      var name = libraryName(item),
        label = name === "tv" ? "TV" : name === "kids tv" ? "Kids TV" : item.Name;
      entry(
        label,
        item.CollectionType === "movies" ? "movies" : item.CollectionType === "tvshows" ? "tv" : "folder",
        function () {
          return go(function () {
            return ["tvshows", "movies"].indexOf(item.CollectionType) !== -1
              ? tvLibrary(item)
              : listing(item.Id, item.Name);
          });
        },
        item.Id,
      );
    }
    var libraries = libraryItems.filter(function (item) {
      return item.CollectionType !== "livetv";
    }).slice().sort(function (a, b) {
      return libraryRank(a) - libraryRank(b);
    });
    libraries.filter(function (item) { return libraryRank(item) < 4; }).forEach(libraryEntry);
    entry(
      "Live TV",
      "tv",
      function () {
        var state = {};
        return go(function () { return liveGuide(state); });
      },
      "livetv",
    );
    entry("Favorites", "favorites", function () { return go(favorites); }, "favorites");
    libraries.filter(function (item) { return libraryRank(item) >= 4; }).forEach(libraryEntry);
    if (P.seerrRequest) entry("Seerr", "search", function () { return go(seerrDiscover); }, "seerr");
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
  function settingChoices(title, choices, current, choose, opener) {
    var menu = el("section", null, main);
    menu.id = "setting-options";
    menu.className = "choice-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.setAttribute("aria-label", title);
    function close() { menu.remove(); if (opener.isConnected) opener.focus(); }
    menu.closeMenu = close;
    el("h2", title, menu);
    button("Close options", close, menu).className = "menu-close";
    choices.forEach(function (choice) {
      var option = button(choice[1], function () { choose(choice[0]); close(); }, menu);
      option.setAttribute("aria-pressed", String(choice[0] === current));
    });
    menu.addEventListener("keydown", function (event) {
      var key = event.keyCode;
      if ([27, 461, 10009].indexOf(key) >= 0) { event.preventDefault(); event.stopPropagation(); close(); }
      else if ((key >= 37 && key <= 40) || key === 9) {
        event.preventDefault(); event.stopPropagation();
        var nodes = Array.prototype.slice.call(menu.querySelectorAll("button")), at = nodes.indexOf(document.activeElement);
        var delta = key === 37 || key === 38 || (key === 9 && event.shiftKey) ? -1 : 1;
        nodes[(at + delta + nodes.length) % nodes.length].focus();
      }
    });
    (menu.querySelector('[aria-pressed="true"]') || menu.querySelector("button")).focus();
  }
  async function signOut() {
    try { await stop(); } catch (_) {}
    try {
      var root = profileAccount();
      await Promise.allSettled([
        api("/Sessions/Logout", null, {}, "POST"),
        root.token !== session.token ? api("/Sessions/Logout", null, {}, "POST", { session: root }) : Promise.resolve(),
      ]);
    } catch (_) {}
    localStorage.removeItem("wholphin-session");
    session = null;
    bonfireAvailable = false;
    bonfireProfile = null;
    stack = [];
    libraryItems = [];
    libraryUpdated = 0;
    libraryRequest = null;
    homeCache.clear(); previewCache.clear(); queueItems = []; listingStates.clear();
    navigation(); login();
  }
  async function settings() {
    var settingsRevision = reset("Settings");
    await syncLanguagePreferences();
    if (settingsRevision !== revision) return;
    selectNav("settings");
    main.className = "settings-page";
    var layout = el("div", null, main),
      categories,
      pane;
    layout.className = "settings-layout";
    categories = el("div", null, layout);
    categories.className = "settings-categories";
    categories.setAttribute("aria-label", "Settings categories");
    pane = el("div", null, layout);
    pane.className = "settings-pane";
    function section(title, description) {
      var area = el("section", null, pane);
      area.className = "settings-section";
      el("h2", title, area);
      el("p", description, area).className = "settings-description";
      var category = button(
        title,
        function () {
          focusContent(area.querySelector("button"));
        },
        categories,
      );
      category.className = "settings-category";
      area.categoryButton = category;
      category.settingsSection = area;
      return area;
    }
    function row(area, title, value, description, action, accessible) {
      var control = button(
        "",
        function () {
          return action(control);
        },
        area,
      );
      control.className = "setting-row";
      function render() {
        control.textContent = "";
        control.setAttribute(
          "aria-label",
          typeof accessible === "function" ? accessible() : accessible || title,
        );
        var copy = el("span", null, control);
        copy.className = "setting-copy";
        el("span", title, copy).className = "setting-title";
        if (description)
          el("span", description, copy).className = "setting-description";
        var current = typeof value === "function" ? value() : value;
        if (current) el("span", current, control).className = "setting-value";
        else {
          var arrow = el("span", "›", control);
          arrow.className = "setting-chevron";
          arrow.setAttribute("aria-hidden", "true");
        }
      }
      control.refreshSetting = render;
      render();
      return control;
    }
    var profile = section(
      "Profile & Home",
      "Personalize Ember for " + (session.name || "your profile") + ".",
    );
    row(
      profile,
      "Switch profile",
      "",
      "Choose a Bonfire profile.",
      function () {
        return go(profilesPage);
      },
    );
    row(
      profile,
      "Customize Home",
      "",
      "Reorder rows, choose artwork and pin your favorites.",
      function () {
        return go(customizeHome);
      },
    );
    var playback = section(
      "Playback",
      "Control what happens between episodes.",
    );
    row(
      playback,
      "Autoplay next episode",
      function () {
        return playbackOptions().autoplay ? "On" : "Off";
      },
      "Continue to the next episode automatically.",
      function (control) {
        setAutoplay(!playbackOptions().autoplay);
        control.refreshSetting();
      },
      autoplayLabel,
    );
    [
      [
        "countdown",
        "Up Next countdown",
        [0, 15, 30, 60],
        "How long to show the next episode before it starts.",
      ],
      [
        "stillWatching",
        "Still watching prompt",
        [0, 3, 5],
        "Ask before continuing after several episodes.",
      ],
    ].forEach(function (setting) {
      function value() {
        var v = playbackOptions()[setting[0]];
        return v
          ? v + (setting[0] === "countdown" ? " seconds" : " episodes")
          : "Off";
      }
      row(
        playback,
        setting[1],
        value,
        setting[3],
        function (control) {
          var options = playbackOptions();
          settingChoices(setting[1], setting[2].map(function (v) {
            return [v, v ? v + (setting[0] === "countdown" ? " seconds" : " episodes") : "Off"];
          }), options[setting[0]], function (v) {
            options[setting[0]] = v;
            localStorage.setItem(accountKey("playback-options"), JSON.stringify(options));
            control.refreshSetting();
          }, control);
        },
        function () {
          return setting[1] + ": " + value();
        },
      );
    });
    row(
      playback,
      "Playback queue",
      "",
      "View and reorder what plays next.",
      function () {
        return go(queuePage);
      },
    );
    row(playback, "Anime audio language", function () {
      var code = readPreference("audio-defaults", {}).animeLanguage;
      return {jpn: "Japanese", eng: "English", spa: "Spanish", fra: "French", deu: "German", kor: "Korean", zho: "Chinese"}[code] || "Use normal audio preference";
    }, "For Anime libraries and titles tagged with the Anime genre. Syncs across Ember devices for this profile.", function (control) {
      var choices = [["", "Use normal audio preference"], ["jpn", "Japanese"], ["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["kor", "Korean"], ["zho", "Chinese"]];
      settingChoices("Anime audio language", choices, readPreference("audio-defaults", {}).animeLanguage || "", function (value) {
        saveLanguagePreference("audio-defaults", {animeLanguage: value});
        control.refreshSetting();
      }, control);
    }, function () {
      var code = readPreference("audio-defaults", {}).animeLanguage;
      return "Anime audio language: " + ({jpn: "Japanese", eng: "English", spa: "Spanish", fra: "French", deu: "German", kor: "Korean", zho: "Chinese"}[code] || "Use normal audio preference");
    });
    el("p", languageSyncText(), playback).className = "language-sync-status";
    if (P.seerrRequest) row(playback, "Seerr", "", "Connect your profile to discover and request movies and TV shows.", function () { return go(seerrSettings); });
    var subtitles = section("Subtitles", "Keep dialogue comfortable to read.");
    row(subtitles, "Subtitle defaults", "", "Preferred language and English subtitles for non-English audio, saved per profile.", function () { return go(subtitleDefaultsSettings); });
    row(
      subtitles,
      "Subtitle appearance",
      "",
      "Preview and choose text size, color, background and position.",
      function () {
        return go(function () {
          reset("Subtitle appearance");
          renderSubtitleAppearance(main, false);
          focusFirst();
        });
      },
    );
    row(
      subtitles,
      "Reset track preferences",
      "",
      "Clear remembered audio and subtitle choices for this profile.",
      function () {
        localStorage.removeItem(accountKey("track-preferences"));
        localStorage.removeItem(accountKey("subtitle-choices"));
        localStorage.removeItem(accountKey("subtitle-timing"));
        message(
          "Remembered audio/subtitle choices cleared. New videos will use Jellyfin defaults.",
        );
      },
    );
    var device = section(
        "Device",
        "Choose the playback format for this television.",
      ),
      decoder = decoderOptions();
    function modeValue() {
      if (P.playbackPolicy) return P.playbackName + (decoder.native ? " (Automatic)" : " (Compatibility)");
      return P.nativePlayback === false
        ? (P.playbackName || "Samsung AVPlay") + " (Compatibility)"
        : decoder.native
          ? "LG C1 native (experimental)"
          : "Compatibility";
    }
    var modeControl = row(
      device,
      "Playback mode",
      modeValue,
      P.playbackPolicy
        ? "Detect device decoders and audio output for direct play; fall back to Compatibility on errors."
        : P.nativePlayback === false
        ? (P.playbackName || "Samsung AVPlay") + " with Jellyfin compatibility transcoding."
        : "Compatibility works with the widest range of files. Native enables supported C1 formats.",
      function (control) {
        var before = decoder.native;
        decoder.native = false; var compatible = modeValue();
        decoder.native = true; var nativeName = modeValue();
        decoder.native = before;
        settingChoices("Playback mode", [[false, compatible], [true, nativeName]], before, function (native) {
          decoder.native = native;
          localStorage.setItem(accountKey("decoder-options"), JSON.stringify(decoder));
          control.refreshSetting();
          vision.disabled = !decoder.native;
        }, control);
      },
      function () {
        return "Playback mode: " + modeValue();
      },
    );
    var vision = row(
      device,
      "Dolby Vision MP4",
      function () {
        return decoder.dolbyVision ? "On" : "Off";
      },
      "Experimental. Requires native mode and a compatible MP4 file.",
      function (control) {
        decoder.dolbyVision = !decoder.dolbyVision;
        localStorage.setItem(
          accountKey("decoder-options"),
          JSON.stringify(decoder),
        );
        control.refreshSetting();
      },
      function () {
        return (
          "Dolby Vision MP4 (experimental): " +
          (decoder.dolbyVision ? "On" : "Off")
        );
      },
    );
    vision.disabled = !decoder.native;
    if (P.nativePlayback === false) {
      modeControl.disabled = !P.playbackPolicy;
      vision.hidden = true;
    }
    row(device, "Screensaver", "", "Artwork, idle delay and clock for this profile.", function () { return go(screensaverSettings); });
    var about = section("About", "Ember for Jellyfin · v0.2.80");
    var server = el("p", "Connected to " + session.server, about);
    server.className = "settings-description";
    row(
      about,
      "Sign out",
      "",
      "Disconnect this TV from the current account.",
      signOut,
    );
    pane.addEventListener("focusin", function (event) {
      var area = event.target.closest(".settings-section");
      if (!area) return;
      Array.prototype.forEach.call(
        categories.querySelectorAll("button"),
        function (category) {
          if (category === area.categoryButton)
            category.setAttribute("aria-current", "true");
          else category.removeAttribute("aria-current");
        },
      );
    });
    categories.addEventListener("focusin", function (event) {
      var category = event.target.closest(".settings-category");
      if (!category) return;
      Array.prototype.forEach.call(
        categories.querySelectorAll("button"),
        function (item) {
          if (item === category) item.setAttribute("aria-current", "true");
          else item.removeAttribute("aria-current");
        },
      );
      pane.scrollTop +=
        category.settingsSection.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        5;
    });
    categories.querySelector("button").setAttribute("aria-current", "true");
    focusContent(categories.querySelector("button"));
  }
  function screensaverOptions() {
    var saved = readPreference("screensaver", {});
    return {
      enabled: saved.enabled !== false,
      idle: [2, 5, 10, 20].indexOf(saved.idle) >= 0 ? saved.idle : 5,
      duration: [15, 30, 60].indexOf(saved.duration) >= 0 ? saved.duration : 30,
      animate: saved.animate !== false,
      clock: saved.clock === true,
    };
  }
  function screensaverSettings() {
    reset("Screensaver");
    el("p", "Show artwork from your library while Ember is idle. Never starts during playback.", main);
    var options = screensaverOptions(), list = el("div", null, main);
    list.className = "screensaver-settings";
    function save() { localStorage.setItem(accountKey("screensaver"), JSON.stringify(options)); }
    function choice(key, label, choices) {
      var control = button("", function () {
        settingChoices(label, choices, options[key], function (value) {
          options[key] = value; save(); refresh();
        }, control);
      }, list);
      function refresh() { control.textContent = label + ": " + choices.find(function (v) { return v[0] === options[key]; })[1]; }
      refresh();
    }
    choice("enabled", "Screensaver", [[true, "On"], [false, "Off"]]);
    choice("idle", "Start after", [[2, "2 minutes"], [5, "5 minutes"], [10, "10 minutes"], [20, "20 minutes"]]);
    choice("duration", "Change artwork every", [[15, "15 seconds"], [30, "30 seconds"], [60, "60 seconds"]]);
    choice("animate", "Slow zoom", [[true, "On"], [false, "Off"]]);
    choice("clock", "Moving clock", [[true, "On"], [false, "Off"]]);
    button("Preview screensaver", function () { return startScreensaver(true); }, list);
    focusContent(list.querySelector("button"));
  }
  var saver = null, saverRequest = 0, saverLastActivity = Date.now(), saverWakeUntil = 0;
  function canScreensave() {
    return session && session.token && !playing && !busy && !document.hidden &&
      !document.body.classList.contains("choosing-profile") && !cancelQuickConnect;
  }
  function stopScreensaver() {
    saverRequest++;
    saverLastActivity = Date.now();
    if (!saver) return false;
    var previous = saver;
    saver = null;
    clearTimeout(previous.timer);
    previous.controller.abort();
    previous.overlay.remove();
    main.removeAttribute("aria-hidden");
    document.querySelector("header").removeAttribute("aria-hidden");
    if (previous.focus && previous.focus.isConnected) previous.focus.focus();
    return true;
  }
  async function startScreensaver(preview) {
    if (saver || !canScreensave() || (!preview && !screensaverOptions().enabled)) return;
    var request = ++saverRequest, options = screensaverOptions(), context = session;
    var overlay = el("section", null, document.body);
    overlay.id = "screensaver";
    overlay.tabIndex = -1;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Screensaver. Press any button to return.");
    overlay.className = options.animate ? "saver-animate" : "";
    overlay.style.setProperty("--saver-duration", options.duration + "s");
    var title = el("div", "Ember", overlay), clock = el("time", null, overlay);
    title.className = "saver-title";
    clock.className = "saver-clock";
    clock.hidden = !options.clock;
    var active = {overlay: overlay, focus: document.activeElement, controller: new AbortController(), timer: null};
    saver = active;
    overlay.focus();
    main.setAttribute("aria-hidden", "true");
    document.querySelector("header").setAttribute("aria-hidden", "true");
    function valid() { return saver === active && request === saverRequest && context === session && canScreensave(); }
    var items = [], at = 0, slide = null, turn = 0;
    function next() {
      if (!valid()) { if (saver === active) stopScreensaver(); return; }
      turn++;
      overlay.classList.toggle("saver-right", turn % 2 === 0);
      clock.textContent = new Date().toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
      if (items.length) {
        var item = items[at++ % items.length], img = document.createElement("img"), frame = turn;
        img.alt = "";
        img.className = "saver-art";
        img.onload = function () {
          if (!valid() || turn !== frame) return;
          var previous = slide;
          slide = img;
          overlay.insertBefore(img, title);
          // Start the fade after the initial frame without moving menu focus.
          requestAnimationFrame(function () { if (valid()) img.classList.add("saver-visible"); });
          if (previous) setTimeout(function () { previous.remove(); }, 1600);
          title.textContent = item.Name || "Ember";
        };
        setImageSource(img, context.server + "/Items/" + encodeURIComponent(item.Id) + "/Images/Backdrop/0?maxWidth=1920&quality=85");
      }
      active.timer = setTimeout(next, options.duration * 1000);
    }
    try {
      var result = await api("/Users/" + encodeURIComponent(context.user) + "/Items", {
        Recursive: true, IncludeItemTypes: "Movie,Series", ImageTypes: "Backdrop",
        SortBy: "Random", Limit: 60, EnableImageTypes: "Backdrop", EnableUserData: false,
      }, null, "GET", {signal: active.controller.signal});
      if (!valid()) { if (saver === active) stopScreensaver(); return; }
      items = (result.Items || []).filter(function (item) { return item.Id && item.BackdropImageTags && item.BackdropImageTags.length; });
    } catch (_) { if (!valid()) { if (saver === active) stopScreensaver(); return; } }
    next();
  }
  ["keydown", "keyup", "keypress", "pointerdown", "click", "wheel", "mousemove", "touchstart"].forEach(function (type) {
    document.addEventListener(type, function (event) {
      saverLastActivity = Date.now();
      if (saver) {
        stopScreensaver();
        saverWakeUntil = Date.now() + 400;
        event.preventDefault(); event.stopImmediatePropagation();
      } else if (Date.now() < saverWakeUntil && type !== "mousemove") {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, true);
  });
  setInterval(function () {
    if (saver && !canScreensave()) stopScreensaver();
    else if (!saver && canScreensave() && screensaverOptions().enabled && Date.now() - saverLastActivity >= screensaverOptions().idle * 60000)
      startScreensaver(false);
  }, 1000);
  document.addEventListener("visibilitychange", function () { stopScreensaver(); });
  document.addEventListener("ember-suspend", function () { stopScreensaver(); });
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
  // One shared client namespace across platforms; Bonfire profiles have distinct user IDs.
  var languageSyncQueue = Promise.resolve(), languageSyncStatus = {};
  function languageKey(account, suffix) {
    return "wholphin-" + suffix + ":" + account.server + ":" + account.user;
  }
  function storedLanguage(account, suffix, fallback) {
    try { return JSON.parse(localStorage.getItem(languageKey(account, suffix))) || fallback; }
    catch (_) { return fallback; }
  }
  function languageSyncText() {
    return languageSyncStatus[accountKey("language-sync")] === "saved"
      ? "Synced for this profile across Ember devices."
      : "Saved on this TV. Server sync will retry when you open this profile or Settings.";
  }
  function updateLanguageSyncStatus(account, status) {
    languageSyncStatus[languageKey(account, "language-sync")] = status;
    if (session && session.server === account.server && session.user === account.user)
      Array.prototype.forEach.call(document.querySelectorAll(".language-sync-status"), function (node) { node.textContent = languageSyncText(); });
  }
  function syncLanguagePreferences() {
    var account = profileAccount();
    var task = languageSyncQueue.then(async function () {
      try {
        var query = {userId: account.user, client: "ember"},
          options = {session: account, timeoutMs: 4000},
          document = await api("/DisplayPreferences/usersettings", query, null, "GET", options);
        if (!document || !document.CustomPrefs || typeof document.CustomPrefs !== "object" || Array.isArray(document.CustomPrefs))
          throw new Error("Invalid display preferences");
        var dirty = storedLanguage(account, "language-sync-pending", {}), uploaded = {}, write = false;
        ["subtitle-defaults", "audio-defaults"].forEach(function (suffix) {
          var local = storedLanguage(account, suffix, null), remote = null;
          try { remote = JSON.parse(document.CustomPrefs["ember-" + suffix]); } catch (_) {}
          // Only accept known fields and values from other devices.
          if (remote && suffix === "subtitle-defaults" &&
              ["remember", "language", "off"].indexOf(remote.mode) >= 0 &&
              ["eng", "spa", "fra", "deu", "ita", "por", "jpn", "kor", "zho", "hin"].indexOf(remote.language) >= 0 && typeof remote.foreignEnglish === "boolean")
            remote = {mode: remote.mode, language: remote.language, foreignEnglish: remote.foreignEnglish};
          else if (remote && suffix === "audio-defaults" &&
              ["", "jpn", "eng", "spa", "fra", "deu", "kor", "zho"].indexOf(remote.animeLanguage) >= 0)
            remote = {animeLanguage: remote.animeLanguage};
          else remote = null;
          if (local && (dirty[suffix] || !remote)) {
            uploaded[suffix] = JSON.stringify(local);
            document.CustomPrefs["ember-" + suffix] = uploaded[suffix];
            write = true;
          } else if (remote) localStorage.setItem(languageKey(account, suffix), JSON.stringify(remote));
        });
        if (write) {
          await api("/DisplayPreferences/usersettings", query, document, "POST", options);
          var pending = storedLanguage(account, "language-sync-pending", {});
          Object.keys(uploaded).forEach(function (suffix) {
            if (localStorage.getItem(languageKey(account, suffix)) === uploaded[suffix]) delete pending[suffix];
          });
          localStorage.setItem(languageKey(account, "language-sync-pending"), JSON.stringify(pending));
        }
        updateLanguageSyncStatus(account, "saved");
      } catch (_) { updateLanguageSyncStatus(account, "offline"); }
    });
    languageSyncQueue = task.catch(function () {});
    return task;
  }
  function saveLanguagePreference(suffix, value) {
    localStorage.setItem(accountKey(suffix), JSON.stringify(value));
    var pending = readPreference("language-sync-pending", {});
    pending[suffix] = true;
    localStorage.setItem(accountKey("language-sync-pending"), JSON.stringify(pending));
    updateLanguageSyncStatus(profileAccount(), "pending");
    return syncLanguagePreferences();
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
    var options = JSON.parse(JSON.stringify(homeOptions())),
      form = el("form", null, main);
    form.className = "home-options";
    form.id = "home-options-form";
    main.classList.add("home-editor-page");
    el(
      "p",
      "Choose what appears on Home, then arrange each row. Changes apply only to this profile when you save.",
      form,
    ).className = "metadata";
    var editorActions = el("div", null, main);
    main.insertBefore(editorActions, form);
    editorActions.className = "home-editor-actions";
    var rowsEditor,
      controller = new AbortController(),
      editorRevision = revision;
    function editButton(label, action, parent) {
      var control = button(label, action, parent);
      control.type = "button";
      return control;
    }

    function checkbox(label, checked, onChange) {
      var line = el("label", null, form),
        input = el("input", null, line);
      input.type = "checkbox";
      input.checked = !!checked;
      el("span", label, line);
      input.onchange = function () {
        onChange(input.checked);
        if (rowsEditor) renderRows();
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
    checkbox("Seasonal holiday rows", options.holidays !== false, function (v) {
      options.holidays = v;
    });
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
    el("h2", "Pinned rows", form);
    el(
      "p",
      "Add a row of titles from a collection, playlist, genre or studio.",
      form,
    ).className = "metadata";
    var pinActions = el("div", null, form);
    pinActions.className = "home-pin-actions";
    var picker = el("section", null, main),
      pickerOpener,
      pickerToken = 0;
    picker.id = "home-pin-picker";
    picker.className = "home-pin-picker";
    picker.hidden = true;
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-modal", "true");
    function closePins() {
      if (picker.hidden) return false;
      picker.hidden = true;
      pickerToken++;
      picker.textContent = "";
      if (pickerOpener && pickerOpener.isConnected) pickerOpener.focus();
      return true;
    }
    function openPins(kind, opener) {
      pickerOpener = opener;
      picker.hidden = false;
      picker.textContent = "";
      picker.setAttribute("aria-label", "Pin a " + kind);
      el("h2", "Pin a " + kind, picker);
      editButton("Close picker", closePins, picker);
      var label = el("label", "Search " + kind + "s", picker),
        input = el("input", null, picker);
      input.id = "home-pin-search";
      label.htmlFor = input.id;
      var results = el("div", null, picker),
        status = el("p", "", picker),
        offset = 0,
        loading = false,
        seen = new Set();
      status.setAttribute("role", "status");
      results.className = "home-pin-results";
      var more = editButton(
        "Load more",
        function () {
          return load(false);
        },
        picker,
      );
      async function load(resetResults) {
        if (loading && !resetResults) return;
        var token = ++pickerToken;
        if (resetResults) {
          offset = 0;
          seen.clear();
          results.textContent = "";
        }
        loading = true;
        more.disabled = true;
        status.textContent = "Loading…";
        var query = {
          UserId: session.user,
          StartIndex: offset,
          Limit: 48,
          SortBy: "SortName",
          SortOrder: "Ascending",
          SearchTerm: input.value.trim() || undefined,
          Recursive: true,
          EnableImages: false,
          EnableTotalRecordCount: true,
        };
        var path = "/Users/" + session.user + "/Items";
        if (kind === "genre") path = "/Genres";
        else if (kind === "studio") path = "/Studios";
        else
          query.IncludeItemTypes =
            kind === "collection" ? "BoxSet" : "Playlist";
        try {
          var data = await api(path, query, null, "GET", {
            signal: controller.signal,
          });
          if (
            revision !== editorRevision ||
            picker.hidden ||
            token !== pickerToken
          )
            return;
          var batch = data.Items || [];
          batch.forEach(function (item) {
            if (!item.Id || !item.Name || seen.has(item.Id)) return;
            seen.add(item.Id);
            var pinned = (options.pinnedRows || []).some(function (pin) {
              return pin.kind === kind && pin.id === item.Id;
            });
            var control = editButton(
              item.Name + (pinned ? " — pinned" : ""),
              function () {
                options.pinnedRows = options.pinnedRows || [];
                if (
                  !options.pinnedRows.some(function (pin) {
                    return pin.kind === kind && pin.id === item.Id;
                  })
                )
                  options.pinnedRows.push({
                    kind: kind,
                    id: item.Id,
                    name: item.Name,
                  });
                renderRows();
                closePins();
              },
              results,
            );
            control.disabled = pinned;
          });
          offset += batch.length;
          more.hidden =
            !batch.length ||
            (Number.isFinite(data.TotalRecordCount)
              ? offset >= data.TotalRecordCount
              : batch.length < 48);
          status.textContent = results.children.length
            ? ""
            : "No matches found.";
        } catch (error) {
          if (
            revision !== editorRevision ||
            picker.hidden ||
            token !== pickerToken
          )
            return;
          status.textContent = "Could not load choices. Try searching again.";
          more.hidden = false;
        } finally {
          if (token === pickerToken) {
            loading = false;
            more.disabled = false;
          }
        }
      }
      editButton(
        "Search choices",
        function () {
          return load(true);
        },
        picker,
      );
      input.onkeydown = function (event) {
        if (event.keyCode === 13) {
          event.preventDefault();
          run(function () {
            return load(true);
          });
        }
      };
      picker.querySelector("button").focus();
      run(function () {
        return load(true);
      });
    }
    ["collection", "playlist", "genre", "studio"].forEach(function (kind) {
      var control = editButton(
        "Pin " + kind,
        function () {
          openPins(kind, control);
        },
        pinActions,
      );
    });
    activeListing = {
      dispose: function () {
        controller.abort();
        pickerToken++;
      },
      scope: function () {
        return picker.hidden ? null : picker;
      },
      closeOptions: closePins,
      handleKey: function (key, active) {
        if (picker.hidden) return false;
        var controls = Array.prototype.slice
          .call(picker.querySelectorAll("button,input"))
          .filter(function (node) {
            return (
              !node.disabled && node.getClientRects().length && node !== active
            );
          });
        var next = C.neighbor(
          active.getBoundingClientRect(),
          controls.map(function (node) {
            return { element: node, rect: node.getBoundingClientRect() };
          }),
          { 37: "left", 38: "up", 39: "right", 40: "down" }[key],
        );
        if (next) focusContent(next);
        return true;
      },
    };
    el("h2", "Row order & artwork", form);
    el(
      "p",
      "Move rows up or down, hide individual rows, or switch between posters and wide thumbnails. Empty rows stay hidden on Home.",
      form,
    ).className = "metadata";
    rowsEditor = el("div", null, form);
    rowsEditor.className = "home-row-editor";
    function renderRows(restoreKey, action) {
      rowsEditor.textContent = "";
      var planned = C.homeRows(
        libraryItems,
        Object.assign({}, options, { hiddenRows: [] }),
      );
      planned.forEach(function (row, index) {
        var key = C.homeRowKey(row),
          line = el("div", null, rowsEditor);
        line.className = "home-row-setting";
        line.dataset.rowKey = key;
        var title = el("div", null, line);
        title.className = "home-row-setting-title";
        el("strong", row.title, title);
        el("span", index + 1 + " of " + planned.length, title);
        function reorder(delta) {
          var order = planned.map(C.homeRowKey),
            target = index + delta;
          if (target < 0 || target >= order.length) return;
          order.splice(index, 1);
          order.splice(target, 0, key);
          options.rowOrder = order;
          renderRows(key, delta < 0 ? "up" : "down");
        }
        function control(label, actionName, callback) {
          var b = editButton(label, callback, line);
          b.dataset.action = actionName;
          b.setAttribute("aria-label", label);
          b.textContent =
            actionName === "up"
              ? "↑"
              : actionName === "down"
                ? "↓"
                : actionName === "visibility"
                  ? hidden
                    ? "Show"
                    : "Hide"
                  : actionName === "artwork"
                    ? row.layout === "landscape"
                      ? "Thumbnails"
                      : "Posters"
                    : "Unpin";
          return b;
        }
        control("Move " + row.title + " up", "up", function () {
          reorder(-1);
        }).disabled = index === 0;
        control("Move " + row.title + " down", "down", function () {
          reorder(1);
        }).disabled = index === planned.length - 1;
        var hidden = (options.hiddenRows || []).indexOf(key) >= 0;
        control(
          (hidden ? "Show " : "Hide ") + row.title,
          "visibility",
          function () {
            options.hiddenRows = (options.hiddenRows || []).filter(
              function (id) {
                return id !== key;
              },
            );
            if (!hidden) options.hiddenRows.push(key);
            renderRows(key, "visibility");
          },
        ).setAttribute("aria-pressed", String(!hidden));
        if (row.kind !== "live")
          control(
            "Artwork for " +
              row.title +
              ": " +
              (row.layout === "landscape" ? "Thumbnails" : "Posters"),
            "artwork",
            function () {
              options.rowLayouts = options.rowLayouts || {};
              options.rowLayouts[key] =
                row.layout === "landscape" ? "poster" : "landscape";
              renderRows(key, "artwork");
            },
          );
        if (row.kind === "pinned")
          control("Unpin " + row.title, "remove", function () {
            options.pinnedRows = (options.pinnedRows || []).filter(
              function (pin) {
                return "pinned:" + pin.kind + ":" + pin.id !== row.key;
              },
            );
            renderRows();
            focusContent(
              rowsEditor.querySelector("button:not(:disabled)") ||
                pinActions.querySelector("button"),
            );
          });
      });
      if (restoreKey) {
        var line = Array.prototype.find.call(
            rowsEditor.children,
            function (node) {
              return node.dataset.rowKey === restoreKey;
            },
          ),
          target = line && line.querySelector('[data-action="' + action + '"]');
        if (target && target.disabled)
          target = line.querySelector("button:not(:disabled)");
        if (target) focusContent(target);
      }
    }
    renderRows();
    editButton(
      "Reset row order and artwork",
      function () {
        options.rowOrder = [];
        options.rowLayouts = {};
        options.hiddenRows = [];
        renderRows();
      },
      form,
    );
    editButton("Cancel changes", back, editorActions);
    var save = el("button", "Save and open Home", editorActions);
    save.setAttribute("form", form.id);
    var editorReturn = form.querySelector("input");
    form.addEventListener("focusin", function (event) { editorReturn = event.target; });
    form.addEventListener("keydown", function (event) {
      if (event.keyCode !== 39 || !picker.hidden) return;
      var node = event.target, line = node.closest(".home-row-setting");
      if ((node.tagName === "INPUT" && node.type === "checkbox") ||
          (line && node === line.querySelector("button:last-child"))) {
        event.preventDefault(); event.stopPropagation(); save.focus();
      }
    });
    editorActions.addEventListener("keydown", function (event) {
      if (event.keyCode === 40 || (event.keyCode === 37 && event.target === editorActions.querySelector("button"))) {
        event.preventDefault(); event.stopPropagation();
        focusContent(editorReturn && editorReturn.isConnected ? editorReturn : form.querySelector("input"));
      }
    });
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
    form.querySelector("input").focus();
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
  function seerrSettingsValue() { return readPreference("seerr", {}); }
  function seerrServer(value) {
    var url;
    try { url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : "http://" + value.trim()); }
    catch (_) { throw new Error("Enter a valid Seerr address, including its port if needed."); }
    if (["http:", "https:"].indexOf(url.protocol) < 0 || url.username || url.password || url.search || url.hash || !url.hostname) throw new Error("Enter a Seerr address, including its port if needed.");
    return url.href.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
  }
  function seerrApi(path, body, server) {
    return P.seerrRequest({server: server || seerrSettingsValue().server, profile: accountKey("seerr"), path: path, method: body ? "POST" : "GET", body: body});
  }
  async function seerrSettings() {
    var r = reset("Seerr"), account = session, saved = seerrSettingsValue();
    main.className = "seerr-page";
    el("p", "Discover and request movies and shows. Sign in separately for each Ember profile; your password is not saved.", main);
    var form = el("form", null, main); form.className = "seerr-login";
    function field(label, type, value) {
      var id = "seerr-" + type, caption = el("label", label, form), input = el("input", null, form);
      caption.htmlFor = id; input.id = id; input.type = type; input.value = value || ""; input.autocomplete = "off";
      return input;
    }
    var server = field("Seerr server address", "url", saved.server || localStorage.getItem("wholphin-seerr-server:" + session.server));
    server.placeholder = "http://your-server:5055"; server.type = "text";
    var label = el("label", "Sign-in method", form), method = el("select", null, form);
    method.id = "seerr-method"; label.htmlFor = method.id;
    [["jellyfin", "Jellyfin account"], ["local", "Seerr local account"]].forEach(function (v) { var option = el("option", v[1], method); option.value = v[0]; });
    var username = field("Username (email for a Seerr local account)", "text", ""), password = field("Password", "password", "");
    var submit = el("button", "Sign in to Seerr", form); submit.type = "submit";
    var feedback = el("p", "", main); feedback.setAttribute("role", "status");
    form.onsubmit = async function (event) {
      event.preventDefault(); if (submit.disabled) return;
      var url, loginMethod = method.value, credentials = {password: password.value};
      password.value = "";
      try {
        url = seerrServer(server.value);
        if (!username.value.trim()) throw new Error("Enter your username or email.");
        credentials[loginMethod === "local" ? "email" : "username"] = username.value.trim();
        submit.disabled = true; feedback.textContent = "Signing in…";
        await seerrApi("/auth/" + loginMethod, credentials, url);
        if (r !== revision || session !== account) return;
        var me = await seerrApi("/auth/me", null, url);
        if (r !== revision || session !== account) return;
        seerrBrowseStates.delete(accountKey("seerr-browse"));
        localStorage.setItem(accountKey("seerr"), JSON.stringify({server: url}));
        localStorage.setItem("wholphin-seerr-server:" + session.server, url);
        return go(seerrDiscover);
      } catch (error) { if (r === revision) feedback.textContent = error.message; }
      finally { credentials.password = ""; if (r === revision) submit.disabled = false; }
    };
    if (saved.server) {
      button("Open Discover", function () { return go(seerrDiscover); }, main);
      button("Disconnect this profile from Seerr", async function () {
        await seerrApi("/auth/logout", {});
        if (session !== account || r !== revision) return;
        seerrBrowseStates.delete(accountKey("seerr-browse"));
        localStorage.removeItem(accountKey("seerr"));
        return seerrSettings();
      }, main);
    }
    focusFirst();
  }
  function seerrStatus(info) {
    return {1: "Not requested", 2: "Requested · awaiting approval", 3: "Approved · processing", 4: "Partially available", 5: "Available", 6: "Unavailable"}[(info || {}).status] || "Not requested";
  }
  function seerrCard(item, type) {
    type = item.mediaType || type;
    if (["movie", "tv"].indexOf(type) < 0 || !Number.isSafeInteger(item.id) || item.id < 1) return null;
    var art = typeof item.posterPath === "string" && /^\/[a-zA-Z0-9._-]+$/.test(item.posterPath) ? "https://image.tmdb.org/t/p/w342" + item.posterPath : null;
    return {Id: "seerr:" + type + ":" + item.id, Name: item.title || item.name || "Untitled", Type: type === "tv" ? "Series" : "Movie", ProductionYear: seerrStatus(item.mediaInfo), SeerrPoster: art, seerrType: type, seerrId: item.id};
  }
  var seerrBrowseStates = new Map();
  async function seerrDiscover() {
    if (!seerrSettingsValue().server) return seerrSettings();
    var r = reset("Discover"), account = session, me;
    main.className = "seerr-page"; selectNav("seerr");
    var feedback = el("p", "Connecting to Seerr…", main); feedback.setAttribute("role", "status");
    try { me = await seerrApi("/auth/me"); }
    catch (error) {
      if (r !== revision) return;
      feedback.textContent = error.message;
      button("Seerr sign-in settings", function () { return go(seerrSettings); }, main); focusFirst(); return;
    }
    if (r !== revision || session !== account) return;
    feedback.textContent = "Signed in as " + (me.displayName || me.username || me.jellyfinUsername || "Seerr user") + ".";
    var tabs = el("div", null, main); tabs.className = "tv-library-tabs";
    var form = el("form", null, main); form.className = "seerr-search";
    var input = el("input", null, form); input.setAttribute("aria-label", "Search Seerr"); input.placeholder = "Search movies and shows";
    var searchButton = el("button", "Search", form); searchButton.type = "submit";
    var results = el("section", null, main), state = 0, path = "/discover/trending", kind = null, page = 0, more = true, loading = false, grid;
    function valid() { return r === revision && session === account; }
    async function load() {
      if (!valid() || loading || !more) return;
      var current = state, next = page + 1; loading = true;
      feedback.textContent = "Loading…";
      try {
        var requestPath = path.indexOf("/request?") === 0
          ? path + "&skip=" + ((next - 1) * 20)
          : path + (path.indexOf("?") < 0 ? "?" : "&") + "page=" + next;
        var data = await seerrApi(requestPath);
        if (!valid() || current !== state) return;
        var items = data.results || [];
        if (path === "/request?requestedBy=" + me.id + "&take=20") {
          var detailed = [], cursor = 0;
          async function requestTitles() {
            while (cursor < items.length && valid() && current === state) {
              var index = cursor++, media = items[index].media || {}, type = media.mediaType, id = media.tmdbId;
              if (["movie", "tv"].indexOf(type) < 0 || !Number.isSafeInteger(id)) continue;
              try { var item = await seerrApi("/" + type + "/" + id); item.mediaType = type; detailed[index] = item; } catch (_) {}
            }
          }
          await Promise.all([requestTitles(), requestTitles(), requestTitles()]);
          items = detailed.filter(Boolean);
          more = next < ((data.pageInfo || {}).pages || 1);
        } else more = next < (data.totalPages || 1);
        if (!valid() || current !== state) return;
        var batch = items.map(function (item) { return seerrCard(item, kind); }).filter(Boolean);
        cards(batch, results, null, grid, function (item) { return go(function () { return seerrDetail(item.seerrType, item.seerrId, me); }); });
        page = next;
        feedback.textContent = grid.children.length ? "" : "No titles found.";
        if (page === 1 && document.activeElement === searchButton && grid.firstChild) focusContent(grid.firstChild);
      } catch (error) {
        if (!valid() || current !== state) return;
        feedback.textContent = error.message;
        button("Retry loading titles", function () { return load(); }, results);
      } finally { if (current === state) loading = false; }
    }
    function browse(label, route, type) {
      state++; path = route; kind = type; page = 0; more = true; loading = false;
      seerrBrowseStates.set(accountKey("seerr-browse"), {label: label, route: route, type: type, query: input.value});
      if (seerrBrowseStates.size > 50) seerrBrowseStates.delete(seerrBrowseStates.keys().next().value);
      results.textContent = ""; el("h2", label, results); grid = el("div", null, results); grid.className = "grid";
      Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute("aria-pressed", String(b.textContent === label)); });
      return load();
    }
    [["Trending", "/discover/trending"], ["Movies", "/discover/movies", "movie"], ["TV", "/discover/tv", "tv"], ["Upcoming", "/discover/movies/upcoming", "movie"], ["My requests", "/request?requestedBy=" + me.id + "&take=20"]].forEach(function (tab) { button(tab[0], function () { browse.apply(null, tab); }, tabs); });
    button("Seerr settings", function () { return go(seerrSettings); }, tabs);
    form.onsubmit = function (event) { event.preventDefault(); if (input.value.trim()) browse("Search results", "/search?query=" + encodeURIComponent(input.value.trim().slice(0, 150))); };
    var onScroll = function () { if (!valid()) return; if (main.scrollHeight - main.scrollTop - main.clientHeight < 700) load(); };
    main.addEventListener("scroll", onScroll);
    results.addEventListener("focusin", function (event) { var list = grid.querySelectorAll("button"), at = Array.prototype.indexOf.call(list, event.target); if (at >= Math.max(0, list.length - 6)) load(); });
    // The handler is replaced on every Discover visit to avoid retaining detached pages.
    if (main.seerrScroll) main.removeEventListener("scroll", main.seerrScroll);
    main.seerrScroll = onScroll;
    var previous = seerrBrowseStates.get(accountKey("seerr-browse"));
    if (previous) input.value = previous.query || "";
    await browse(previous ? previous.label : "Trending", previous ? previous.route : "/discover/trending", previous && previous.type);
    if (valid()) focusContent(tabs.firstChild);
  }
  async function seerrDetail(type, id, me) {
    var r = reset("Loading title…"), account = session, data;
    main.className = "seerr-page";
    try { data = await seerrApi("/" + type + "/" + id); }
    catch (error) { if (r === revision) { message(error.message); button("Retry", function () { return seerrDetail(type, id, me); }, main); focusFirst(); } return; }
    if (r !== revision || session !== account) return;
    main.querySelector("h1").textContent = data.title || data.name || "Title";
    var info = data.mediaInfo || {}, permissions = Number(me.permissions) || 0;
    el("p", [type === "movie" ? "Movie" : "TV series", data.releaseDate || data.firstAirDate, seerrStatus(info)].filter(Boolean).join(" · "), main);
    el("p", data.overview || "No description available.", main).className = "seerr-overview";
    var actions = el("div", null, main); actions.className = "actions";
    var libraryId = info.jellyfinMediaId || info.jellyfinMediaId4k;
    if (typeof libraryId === "string" && /^[a-f0-9-]{32,36}$/i.test(libraryId)) button("Open in Jellyfin library", function () { return go(function () { return detail(libraryId); }); }, actions);
    var feedback = el("p", "", main); feedback.setAttribute("role", "status");
    var standardAllowed = !!(permissions & (2 | 32 | (type === "movie" ? 262144 : 524288))),
      fourKAllowed = !!(permissions & (2 | 1024 | (type === "movie" ? 2048 : 4096))),
      allowed = standardAllowed || fourKAllowed;
    var pending = [2, 3, 5, 6].indexOf(info.status) >= 0;
    if (!allowed) el("p", "This Seerr account cannot request " + (type === "movie" ? "movies." : "TV shows."), main);
    else {
      var form = el("section", null, main), selected = [], is4k = !standardAllowed && fourKAllowed;
      el("h2", "Request " + (type === "movie" ? "movie" : "seasons"), form);
      var standardPending = pending;
      var quality = button("Quality: " + (is4k ? "4K" : "Standard"), function () {
        is4k = !is4k; quality.textContent = "Quality: " + (is4k ? "4K" : "Standard");
        selected = []; renderSeasons(); submit.textContent = "Review request"; refresh();
      }, form);
      quality.hidden = !fourKAllowed;
      quality.disabled = !(standardAllowed && fourKAllowed);
      var seasons = el("div", null, form); seasons.className = "seerr-seasons";
      var submit = button("Review request", function () {
        if (type === "tv" && !selected.length) { feedback.textContent = "Choose at least one season."; return; }
        var summary = "Request " + (data.title || data.name) + (type === "tv" ? " · seasons " + selected.join(", ") : "") + (is4k ? " in 4K?" : "?");
        settingChoices(summary, [[false, "Cancel"], [true, "Confirm request"]], false, async function (confirmed) {
          if (!confirmed) return;
          var requestedQuality = is4k, requestedSeasons = selected.slice();
          Array.prototype.forEach.call(form.querySelectorAll("button"), function (b) { b.disabled = true; });
          feedback.textContent = "Submitting request…";
          try {
            await seerrApi("/request", Object.assign({mediaType: type, mediaId: id, is4k: requestedQuality}, type === "tv" ? {seasons: requestedSeasons} : {}));
            if (r !== revision || session !== account) return;
            feedback.textContent = "Request submitted. Track its progress in My requests.";
            if (type === "movie") info[requestedQuality ? "status4k" : "status"] = 2;
            else {
              info.seasons = info.seasons || [];
              requestedSeasons.forEach(function (number) {
                var season = info.seasons.filter(function (v) { return v.seasonNumber === number; })[0];
                if (!season) { season = {seasonNumber: number}; info.seasons.push(season); }
                season[requestedQuality ? "status4k" : "status"] = 2;
              });
              selected = []; renderSeasons();
            }
            quality.disabled = !(standardAllowed && fourKAllowed);
            submit.textContent = "Requested";
            focusContent(returnButton);
          } catch (error) { if (r === revision) { feedback.textContent = error.message; quality.disabled = !(standardAllowed && fourKAllowed); renderSeasons(); refresh(); focusContent(submit); } }
        }, submit);
      }, form);
      function refresh() { submit.disabled = type === "movie" ? [2, 3, 5, 6].indexOf(is4k ? info.status4k : info.status) >= 0 : !selected.length; }
      function renderSeasons() {
        seasons.textContent = "";
        if (type !== "tv") return;
        (data.seasons || []).filter(function (season) { return season.episodeCount > 0; }).forEach(function (season) {
          var existing = (info.seasons || []).filter(function (v) { return v.seasonNumber === season.seasonNumber; })[0] || {};
          var unavailable = [2, 3, 5].indexOf(is4k ? existing.status4k : existing.status) >= 0;
          var b = button((season.name || "Season " + season.seasonNumber) + (unavailable ? " · already requested or available" : ""), function () {
            var at = selected.indexOf(season.seasonNumber); if (at < 0) selected.push(season.seasonNumber); else selected.splice(at, 1);
            b.setAttribute("aria-pressed", String(at < 0)); submit.textContent = "Review request"; refresh();
          }, seasons);
          b.setAttribute("aria-pressed", String(selected.indexOf(season.seasonNumber) >= 0)); b.disabled = unavailable;
        });
      }
      renderSeasons(); refresh();
      if (type === "movie" && standardPending) feedback.textContent = seerrStatus(info) + ".";
    }
    var returnButton = button("Back to Discover", back, main); focusFirst();
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
  function bonfireFields(value) {
    if (!value || typeof value !== "object") return value;
    var normalized = {};
    Object.keys(value).forEach(function (key) {
      normalized[key.charAt(0).toLowerCase() + key.slice(1)] = value[key];
    });
    return normalized;
  }
  function profileAccount() {
    return {
      server: session.server,
      token: session.token,
      user: session.user,
      name: session.name,
    };
  }
  async function startSession() {
    var current = session;
    await syncLanguagePreferences();
    if (session !== current) return;
    reset("Loading profiles…");
    document.body.classList.add("choosing-profile");
    try {
      var profiles = await api("/plugins/profiles/list", null, null, "GET", {
        session: profileAccount(),
        timeoutMs: 4000,
      });
      if (session !== current) return;
      rememberBonfireProfiles(profiles);
      if (bonfireAvailable && profiles.length) return go(profilesPage);
    } catch (_) {
      if (session !== current) return;
      bonfireAvailable = false;
    }
    return go(home);
  }

  async function discoverBonfire() {
    var current = session;
    if (!current) return;
    try {
      var profiles = await api("/plugins/profiles/list", null, null, "GET", {
        session: profileAccount(),
        timeoutMs: 4000,
      });
      if (session !== current) return;
      rememberBonfireProfiles(profiles);
      navigation();
    } catch (_) {
      if (session === current) {
        bonfireAvailable = false;
        navigation();
      }
    }
  }
  async function profilesPage() {
    if (playing) await stop();
    var r = reset("Who's watching?"),
      account = profileAccount(),
      current = session;
    selectNav("profiles");
    main.className = "profiles-page";
    document.body.classList.add("choosing-profile");
    main.dataset.profileTheme = C.profileHolidayTheme();
    var controller = new AbortController();
    homeController = controller;
    var content = el("div", null, main),
      busy = false;
    content.className = "profile-content";
    function valid() {
      return (
        r === revision && session === current && !controller.signal.aborted
      );
    }
    async function switchTo(profile, pin, feedback, submit) {
      if (busy || !valid()) return;
      busy = true;
      submit.disabled = true;
      feedback.textContent = "Switching profile…";
      var limited = false;
      try {
        var result = await api(
          "/plugins/profiles/switch",
          null,
          { profileId: profile.profileUserId, pin: pin || undefined },
          "POST",
          { session: account, signal: controller.signal, profileErrors: true },
        );
        if (!valid()) return;
        result = bonfireFields(result);
        if (
          !result ||
          typeof result.activeProfileToken !== "string" ||
          !result.activeProfileToken ||
          /["\r\n]/.test(result.activeProfileToken) ||
          typeof result.jellyfinUserId !== "string" ||
          result.jellyfinUserId.replace(/-/g, "").toLowerCase() !==
            profile.profileUserId.replace(/-/g, "").toLowerCase()
        )
          throw new Error("Bonfire returned an invalid profile session.");
        await completeSignIn(
          {
            AccessToken: result.activeProfileToken,
            User: { Id: result.jellyfinUserId, Name: profile.profileName },
          },
          { server: account.server, profileAccount: account },
        );
      } catch (error) {
        if (!valid()) return;
        limited = error.status === 429;
        feedback.textContent = limited
          ? "Too many PIN attempts. Wait 15 minutes before trying again."
          : error.status === 401
            ? "Your account session expired. Sign out and sign in again."
            : error.message;
      } finally {
        busy = false;
        if (valid()) submit.disabled = limited;
      }
    }
    function pick(profile, card) {
      if (busy) return;
      if (!profile.requiresPin) {
        switchTo(profile, "", feedback, card);
        return;
      }
      grid.hidden = true;
      feedback.textContent = "";
      var form = el("form", null, content);
      form.className = "profile-pin-form";
      el("h2", profile.profileName, form);
      var label = el("label", "Profile PIN", form),
        input = el("input", null, form);
      input.id = "profile-pin";
      label.htmlFor = input.id;
      input.type = "password";
      input.inputMode = "numeric";
      input.pattern = "[0-9]{4,8}";
      input.minLength = 4;
      input.maxLength = 8;
      input.required = true;
      input.autocomplete = "off";
      var submit = el("button", "Unlock profile", form);
      submit.type = "submit";
      var error = el("p", "", form);
      error.setAttribute("role", "status");
      button(
        "Cancel",
        function () {
          controller.abort();
          return profilesPage();
        },
        form,
      ).type = "button";
      form.onsubmit = function (event) {
        event.preventDefault();
        var pin = input.value;
        input.value = "";
        if (!/^[0-9]{4,8}$/.test(pin)) {
          error.textContent = "Enter a 4–8 digit PIN.";
          return;
        }
        switchTo(profile, pin, error, submit);
      };
      input.focus();
    }
    var grid = el("div", null, content);
    grid.className = "profile-grid";
    var feedback = el("p", "Loading profiles…", content);
    feedback.setAttribute("role", "status");
    try {
      var profiles = await api("/plugins/profiles/list", null, null, "GET", {
        session: account,
        signal: controller.signal,
        timeoutMs: 5000,
      });
      if (!valid()) return;
      if (!Array.isArray(profiles))
        throw new Error("Bonfire did not return a profile list.");
      rememberBonfireProfiles(profiles);
      navigation();
      profiles
        .map(bonfireFields)
        .filter(function (profile) {
          return (
            profile &&
            typeof profile.profileUserId === "string" &&
            profile.profileUserId &&
            typeof profile.profileName === "string"
          );
        })
        .forEach(function (profile) {
          var card = button(
            "",
            function () {
              pick(profile, card);
            },
            grid,
          );
          card.className = "profile-card";
          card.setAttribute(
            "aria-label",
            profile.profileName + (profile.requiresPin ? ", PIN required" : ""),
          );
          var avatar = el(
            "span",
            profile.avatarInitial ||
              profile.profileName.charAt(0).toUpperCase(),
            card,
          );
          avatar.className = "profile-avatar";
          profileAvatar(profile, avatar);
          el("span", profile.profileName, card).className = "profile-name";
          if (profile.requiresPin)
            el("span", "PIN required", card).className = "profile-note";
          if (
            profile.profileUserId.replace(/-/g, "").toLowerCase() ===
            session.user.replace(/-/g, "").toLowerCase()
          )
            el("span", "Current profile", card).className = "profile-note";
        });
      feedback.textContent = grid.children.length
        ? ""
        : "No profiles are available for this account.";
      if (!grid.children.length) {
        button("Retry profiles", profilesPage, content);
        button("Sign out", signOut, content);
      }
    } catch (error) {
      if (!valid()) return;
      feedback.textContent =
        [404, 405].indexOf(error.status) !== -1
          ? "Bonfire is not available on this server. Install the plugin, then retry."
          : error.status === 401
            ? "Your account session expired. Sign out and sign in again."
            : "Could not load Bonfire profiles. Try again.";
      button("Retry profiles", profilesPage, content);
      button("Sign out", signOut, content);
    }
    if (!valid()) return;
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
    bonfireProfile = null;
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
    if (context.profileAccount) {
      await syncLanguagePreferences();
      await go(home);
      discoverBonfire();
    } else await startSession();
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
    var serverError = el("p", "", form), userError = el("p", "", form);
    serverError.id = "server-error"; userError.id = "username-error";
    [serverError, userError].forEach(function (node) { node.className = "field-error"; node.setAttribute("role", "alert"); });
    form.insertBefore(serverError, server.nextSibling);
    form.insertBefore(userError, user.nextSibling);
    server.setAttribute("aria-describedby", "server-error server-example");
    user.setAttribute("aria-describedby", "username-error");
    var example = el("p", "For example: http://192.168.1.10:8096 or https://media.example.com", form);
    example.id = "server-example"; example.className = "field-hint";
    form.insertBefore(example, serverError.nextSibling);
    function validateServer() {
      serverError.textContent = ""; server.removeAttribute("aria-invalid");
      try { return C.serverUrl(server.value); }
      catch (error) { serverError.textContent = error.message; server.setAttribute("aria-invalid", "true"); server.focus(); return null; }
    }
    server.addEventListener("input", function () { serverError.textContent = ""; server.removeAttribute("aria-invalid"); });
    user.addEventListener("input", function () { userError.textContent = ""; user.removeAttribute("aria-invalid"); });
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
          var normalizedServer = validateServer();
          if (!normalizedServer) return;
          userError.textContent = ""; user.removeAttribute("aria-invalid");
          if (!user.value.trim()) {
            userError.textContent = "Enter your Jellyfin username.";
            user.setAttribute("aria-invalid", "true"); user.focus(); return;
          }
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
        var normalized = validateServer();
        if (!normalized) return;
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
          setImageSource(backdrop, url);
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
      setImageSource(loading, url);
    }, 180);
  }
  function itemMetadata(item, host) {
    var text = C.quickDetails(item);
    host.textContent = "";
    var pattern = /(\d+\.\d ★|\d+% 🍅)/g,
      match,
      offset = 0;
    while ((match = pattern.exec(text))) {
      host.appendChild(
        document.createTextNode(text.slice(offset, match.index)),
      );
      var critic = match[0].indexOf("🍅") !== -1,
        score = match[0].split(" ")[0],
        rating = el("span", null, host);
      rating.className = "media-rating";
      rating.setAttribute(
        "aria-label",
        (critic ? "Critic rating: " : "Community rating: ") +
          score +
          (critic ? "" : " out of 10"),
      );
      rating.appendChild(document.createTextNode(score + " "));
      if (critic) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.classList.add("rating-tomato");
        var body = document.createElementNS(svg.namespaceURI, "path");
        body.setAttribute(
          "d",
          "M12 7C5 3 1 9 3 16c1 4 5 6 9 5 4 1 8-1 9-5 2-7-2-13-9-9Z",
        );
        body.setAttribute("fill", "#ef4136");
        svg.appendChild(body);
        var leaf = document.createElementNS(svg.namespaceURI, "path");
        leaf.setAttribute("d", "m12 8-6-3 5 1 1-5 2 5 5-2-4 4 2 3-5-2-4 2Z");
        leaf.setAttribute("fill", "#63b447");
        svg.appendChild(leaf);
        rating.appendChild(svg);
      } else {
        var star = el("span", "★", rating);
        star.className = "rating-star";
        star.setAttribute("aria-hidden", "true");
      }
      offset = pattern.lastIndex;
    }
    host.appendChild(document.createTextNode(text.slice(offset)));
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
      setImageSource(image, session.server +
        "/Items/" +
        encodeURIComponent(id) +
        "/Images/Logo?maxWidth=600&quality=90");
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
    itemMetadata(item, document.getElementById("preview-meta"));
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
    if (item.SeerrPoster && /^https:\/\/image\.tmdb\.org\/t\/p\/w342\/[a-zA-Z0-9._-]+$/.test(item.SeerrPoster)) return item.SeerrPoster;
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
    else if (landscape && item.Type === "Episode" && !tags.Primary) return null;
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
  function setImageSource(img, url) {
    if (P.loadImage) P.loadImage(img, url);
    else img.src = url;
  }
  function loadPoster(img) {
    if (!img || !img.dataset.src) return;
    setImageSource(img, img.dataset.src);
    delete img.dataset.src;
    if (posterObserver) posterObserver.unobserve(img);
  }
  function observePoster(img) {
    if (!posterObserver && window.IntersectionObserver)
      posterObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.intersectionRatio > 0) loadPoster(entry.target);
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
  function updateCardUserData(card, item) {
    var art = card.querySelector(".art");
    if (!art) return;
    Array.prototype.forEach.call(art.querySelectorAll(".card-progress, .watched-badge"), function (node) { node.remove(); });
    var data = item.UserData || {};
    card.dataset.watched = String(!!data.Played);
    if (data.Played) {
      var badge = el("span", "✓", art);
      badge.className = "watched-badge";
      badge.setAttribute("aria-label", "Watched");
    } else if (data.PlayedPercentage > 0 && data.PlayedPercentage < 100) {
      var progress = el("div", null, art); progress.className = "card-progress";
      el("div", null, progress).style.width = Math.min(100, data.PlayedPercentage) + "%";
    }
  }
  function refreshUserData(item, data, account) {
    item.UserData = Object.assign({}, item.UserData, data);
    if (session !== account) return;
    homeCache.clear(); listingStates.clear(); previewCache.clear();
    Array.prototype.forEach.call(main.querySelectorAll(".card[data-item]"), function (card) {
      if (card.dataset.item !== item.Id) return;
      if (card.item) card.item.UserData = Object.assign({}, card.item.UserData, data);
      updateCardUserData(card, item);
    });
    if (main.refreshPlaybackUserData) main.refreshPlaybackUserData(item, data);
  }
  function cards(items, parent, layout, existing, onSelect) {
    var grid = existing || el("div", null, parent);
    if (!existing) grid.className = layout ? "rail " + layout : "grid";
    items.forEach(function (item) {
      var b = button(
        "",
        function () {
          if (onSelect) return onSelect(item);
          return go(function () {
            return detail(item.Id, !!item.IsLiveProgram);
          });
        },
        grid,
      );
      b.className = "card";
      b.item = item;
      b.dataset.item = item.Id;
      b.setAttribute("aria-label", item.Name);
      if (item.Type === "Episode") b.episodeItem = item;
      b.addEventListener("focus", function () {
        if (item.Type === "Episode") {
          var description = main.querySelector(".series-continue-description");
          if (description)
            description.textContent =
              item.Overview || "No description available.";
        }
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
      if (
        item.Type === "Season" &&
        item.UserData &&
        item.UserData.UnplayedItemCount > 0
      )
        el("span", String(item.UserData.UnplayedItemCount), art).className =
          "episode-badge";
      updateCardUserData(b, item);
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
        ParentId: row.parent,
        IncludeItemTypes: row.parent ? row.type || "Episode" : undefined,
        Fields: fields,
      }).then(function (data) {
        return data.Items || [];
      });
    }
    function next() {
      return request("/Shows/NextUp", {
        UserId: session.user,
        ParentId: row.parent,
        EnableResumable: row.parent ? false : undefined,
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
    if (row.kind === "resume") return C.combineResume(await resume(), []);
    if (row.kind === "next") return next();
    if (row.kind === "combined") {
      var both = await Promise.all([resume(), next()]);
      return C.combineResume(both[0], both[1]);
    }
    if (row.kind === "pinned" && row.pinType === "playlist")
      return request("/Playlists/" + encodeURIComponent(row.pinId) + "/Items", {
        UserId: session.user,
        Limit: 24,
        Fields: fields,
      }).then(function (data) {
        return data.Items || [];
      });
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
    if (row.filter) Object.assign(query, row.filter);
    if (row.kind === "favorites") query.IsFavorite = true;
    return request(base, query).then(function (data) {
      return data.Items || [];
    });
  }
  function movieRecommendations(library) {
    var rows = [
      { kind: "resume", title: "Continue watching" },
      {
        kind: "items",
        title: "Recently Added",
        filter: { SortBy: "DateCreated", SortOrder: "Descending" },
      },
      {
        kind: "released",
        title: "Recently Released",
        filter: { MaxPremiereDate: new Date().toISOString(), IsUnaired: false },
      },
      {
        kind: "items",
        title: "Top Rated Unwatched",
        filter: {
          IsPlayed: false,
          SortBy: "CommunityRating",
          SortOrder: "Descending",
        },
      },
    ];
    rows = rows.concat(
      C.holidayRows().filter(function (row) {
        return row.type === "Movie";
      }),
    );
    rows.push({
      kind: "items",
      title: "Suggestions",
      filter: { IsPlayed: false, SortBy: "Random" },
    });
    return rows.map(function (row) {
      row.parent = library.Id;
      row.type = "Movie";
      row.key = "movie:" + library.Id + ":" + (row.key || row.title);
      return row;
    });
  }
  async function setWatched(item, watched, signal, options) {
    var context = options && options.session || session;
    var data = await api(
      "/Users/" + encodeURIComponent(context.user) + "/PlayedItems/" + encodeURIComponent(item.Id),
      null, null, watched ? "POST" : "DELETE", Object.assign({}, options, { session: context, signal: signal }),
    );
    // Jellyfin resets the resume point for both watched-state mutations.
    item.UserData = Object.assign({}, item.UserData, {
      Played: watched, PlaybackPositionTicks: 0, PlayedPercentage: watched ? 100 : 0,
    }, watched ? {} : { PlayCount: 0, LastPlayedDate: null }, data || {});
    refreshUserData(item, item.UserData, context);
  }
  async function home(tvLibraryItem) {
    var r = reset(tvLibraryItem ? tvLibraryItem.Name : "Home"),
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
    selectNav(tvLibraryItem ? tvLibraryItem.Id : "home");
    if (tvLibraryItem) {
      main.classList.add("tv-recommended");
      tvTabs(tvLibraryItem, "recommended");
    }
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
    var plan =
        tvLibraryItem && tvLibraryItem.CollectionType === "movies"
          ? movieRecommendations(tvLibraryItem)
          : tvLibraryItem
            ? [
                { kind: "resume", title: "Continue watching" },
                { kind: "next", title: "Next Up" },
                {
                  kind: "released",
                  title: "Recently Released",
                  type: "Episode",
                  filter: {
                    MaxPremiereDate: new Date().toISOString(),
                    IsUnaired: false,
                  },
                },
                {
                  kind: "items",
                  title: "Recently Added",
                  type: "Episode",
                  filter: { SortBy: "DateCreated", SortOrder: "Descending" },
                },
                {
                  kind: "items",
                  title: "Top Rated Unwatched",
                  type: "Series",
                  filter: {
                    IsPlayed: false,
                    SortBy: "CommunityRating",
                    SortOrder: "Descending",
                  },
                },
                {
                  kind: "items",
                  title: "Suggestions",
                  type: "Series",
                  filter: { IsPlayed: false, SortBy: "Random" },
                },
              ]
                .reduce(function (plan, row) {
                  if (row.title === "Suggestions")
                    plan = plan.concat(
                      C.holidayRows().filter(function (holiday) {
                        return holiday.type === "Episode";
                      }),
                    );
                  plan.push(row);
                  return plan;
                }, [])
                .map(function (row) {
                  row.parent = tvLibraryItem.Id;
                  row.key =
                    "tv:" + tvLibraryItem.Id + ":" + (row.key || row.title);
                  return row;
                })
            : C.homeRows(libraryItems, options),
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
            if (entry.intersectionRatio > 0 && entry.target.loadHomeRow)
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
  function tvTabs(library, selected) {
    var tabs = el("div", null, main);
    tabs.className = "tv-library-tabs";
    main.insertBefore(tabs, main.firstChild);
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", library.Name);
    (library.CollectionType === "movies"
      ? ["recommended", "library", "collections", "genres"]
      : ["recommended", "library", "genres", "studios", "collections"]
    ).forEach(function (tab) {
      var control = button(
        tab.charAt(0).toUpperCase() + tab.slice(1),
        function () {
          var action = function () {
            return tvLibrary(library, tab);
          };
          var frame = stack[stack.length - 1];
          if (frame) {
            frame.action = action;
            frame.focus = null;
            frame.related = null;
          }
          return action();
        },
        tabs,
      );
      control.setAttribute("role", "tab");
      control.setAttribute("aria-selected", String(tab === selected));
      control.dataset.tvTab = tab;
    });
  }
  function tvLibrary(library, tab) {
    tab = tab || "recommended";
    if (tab === "recommended") return home(library);
    if (tab === "library")
      return listing(library.Id, library.Name, false, null, {
        library: library,
        tab: tab,
      });
    return tvCategories(library, tab);
  }
  async function tvCategories(library, tab) {
    var contentType = library.CollectionType === "movies" ? "Movie" : "Series";
    var contentName = contentType === "Movie" ? "movies" : "TV shows";
    var r = reset(library.Name),
      controller = new AbortController();
    homeController = controller;
    main.className = "tv-category-page tv-library-page";
    selectNav(library.Id);
    tvTabs(library, tab);
    var grid = el("div", null, main),
      status = el("p", "", main);
    grid.className = "grid tv-category-grid";
    var offset = 0,
      done = false,
      loading = false,
      failed = false,
      ids = new Set(),
      checked = new Map();
    function valid() {
      return r === revision && !controller.signal.aborted;
    }
    function request(path, query) {
      return api(path, query, null, "GET", { signal: controller.signal });
    }
    async function load() {
      if (!valid() || loading || done) return;
      loading = true;
      failed = false;
      status.textContent =
        tab === "collections"
          ? "Checking collections for " + contentName + "…"
          : "Loading…";
      try {
        var data = await request(
          tab === "collections"
            ? "/Users/" + session.user + "/Items"
            : tab === "genres"
              ? "/Genres"
              : "/Studios",
          {
            UserId: session.user,
            ParentId: tab === "collections" ? undefined : library.Id,
            IncludeItemTypes: tab === "collections" ? "BoxSet" : contentType,
            Recursive: true,
            SortBy: "SortName",
            SortOrder: "Ascending",
            StartIndex: offset,
            Limit: 24,
            EnableTotalRecordCount: true,
            Fields: "PrimaryImageAspectRatio",
          },
        );
        if (!valid()) return;
        var batch = data.Items || [],
          selected = batch;
        if (tab === "collections") {
          var cursor = 0;
          async function worker() {
            while (cursor < batch.length && valid()) {
              var entry = batch[cursor++];
              if (!checked.has(entry.Id)) {
                var contents = await request(
                  "/Users/" + session.user + "/Items",
                  {
                    ParentId: entry.Id,
                    Recursive: true,
                    IncludeItemTypes: contentType,
                    Limit: 1,
                    EnableTotalRecordCount: false,
                  },
                );
                if (!valid()) return;
                checked.set(
                  entry.Id,
                  (contents.Items || []).some(function (item) {
                    return item.Type === contentType;
                  }),
                );
              }
            }
          }
          var checks = await Promise.allSettled([worker(), worker()]);
          var rejected = checks.find(function (result) {
            return result.status === "rejected";
          });
          if (rejected) throw rejected.reason;
          selected = batch.filter(function (entry) {
            return checked.get(entry.Id);
          });
        }
        if (!valid()) return;
        var fresh = selected.filter(function (entry) {
          if (!entry.Id || ids.has(entry.Id)) return false;
          ids.add(entry.Id);
          return true;
        });
        cards(fresh, grid, null, grid, function (entry) {
          return go(function () {
            var filter = {};
            if (tab === "genres") filter.GenreIds = entry.Id;
            if (tab === "studios") filter.StudioIds = entry.Id;
            return listing(
              tab === "collections" ? entry.Id : library.Id,
              entry.Name,
              false,
              null,
              { library: library, tab: tab, filter: filter },
            );
          });
        });
        offset += batch.length;
        done =
          !batch.length ||
          (Number.isFinite(data.TotalRecordCount)
            ? offset >= data.TotalRecordCount
            : batch.length < 24);
        status.textContent = done
          ? ids.size
            ? ids.size + " " + tab
            : "No " +
              tab +
              (tab === "collections"
                ? " containing " + contentName + "."
                : " found.")
          : "Scroll for more " + tab + ".";
        if (document.activeElement === main && grid.firstElementChild)
          focusContent(grid.firstElementChild);
      } catch (error) {
        if (!valid()) return;
        failed = true;
        status.textContent = "Could not load " + tab + ". ";
        button("Retry " + tab, load, status);
      } finally {
        loading = false;
        if (
          valid() &&
          !done &&
          !failed &&
          status.getBoundingClientRect().top <
            main.getBoundingClientRect().bottom + 300
        )
          load();
      }
    }
    function scroll() {
      if (
        !failed &&
        status.getBoundingClientRect().top <
          main.getBoundingClientRect().bottom + 300
      )
        load();
    }
    main.addEventListener("scroll", scroll);
    activeListing = {
      dispose: function () {
        controller.abort();
        main.removeEventListener("scroll", scroll);
      },
      closeOptions: function () {
        return false;
      },
      scope: function () {
        return null;
      },
      handleKey: function () {
        return false;
      },
    };
    main.tabIndex = -1;
    main.focus();
    await load();
  }
  async function seasonBrowser(id, title, context) {
    var r = reset(title),
      controller = new AbortController();
    homeController = controller;
    main.className = "detail-page season-browser";
    var tabs = el("div", null, main);
    tabs.className = "season-browser-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Seasons");
    context.seasons.forEach(function (season) {
      var control = button(
        season.Name,
        function () {
          var action = function () {
            return seasonBrowser(
              season.Id,
              context.title + " · " + season.Name,
              context,
            );
          };
          var frame = stack[stack.length - 1];
          if (frame) {
            frame.action = action;
            frame.focus = null;
          }
          return action();
        },
        tabs,
      );
      control.setAttribute("role", "tab");
      control.setAttribute("aria-selected", String(season.Id === id));
    });
    var heading = main.querySelector("h1");
    heading.textContent = context.title;
    main.insertBefore(tabs, heading);
    var name = el("h2", "Loading episode…", main),
      meta = el("p", "", main),
      specs = el("p", "", main),
      overview = el("p", "", main);
    name.className = "episode-browser-name";
    meta.className = "metadata";
    specs.className = "metadata episode-stream-details";
    overview.className = "overview episode-browser-overview";
    var grid = el("div", null, main);
    grid.className = "rail landscape episode-browser-rail library-grid";
    grid.setAttribute("aria-label", "Episodes");
    var actions = el("div", null, main);
    actions.className = "actions episode-browser-actions";
    var subtitleMount = el("div", null, main),
      episodeSubtitles = null;
    var status = el("p", "Loading episodes…", main),
      peopleHost = el("div", null, main);
    var cacheKey = accountKey("season-browser:" + id),
      cached = listingStates.get(cacheKey);
    var selected = null,
      items = cached ? cached.items : [],
      offset = cached ? cached.offset : 0,
      done = cached ? cached.done : false,
      loading = false,
      timer = null,
      selectedRequest = 0;
    function valid() {
      return r === revision && !controller.signal.aborted;
    }
    function request(path, query, method) {
      return api(path, query, null, method || "GET", {
        signal: controller.signal,
      });
    }
    var playButton = button(
      "Play",
      function () {
        if (selected)
          return play(
            selected,
            (selected.UserData && selected.UserData.PlaybackPositionTicks) || 0,
            true,
            false,
            episodeSubtitles ? episodeSubtitles.options() : {},
          );
      },
      actions,
    );
    var watched = button(
      "Mark as watched",
      async function () {
        if (!selected) return;
        var item = selected,
          remove = !!(item.UserData && item.UserData.Played);
        watched.disabled = true;
        try {
          await setWatched(item, !remove, controller.signal);
          if (valid() && selected.Id === item.Id) paint(item);
        } finally {
          if (valid()) watched.disabled = false;
        }
      },
      actions,
    );
    var favorite = button(
      "",
      async function () {
        if (!selected) return;
        var item = selected,
          remove = !!(item.UserData && item.UserData.IsFavorite);
        favorite.disabled = true;
        try {
          await request(
            "/Users/" + session.user + "/FavoriteItems/" + item.Id,
            null,
            remove ? "DELETE" : "POST",
          );
          item.UserData = Object.assign({}, item.UserData, {
            IsFavorite: !remove,
          });
          if (valid() && selected.Id === item.Id) paint(item);
        } finally {
          if (valid()) favorite.disabled = false;
        }
      },
      actions,
    );
    favorite.className = "favorite-heart";
    favorite.appendChild(navIcon("favorites"));
    button(
      "More options",
      function () {
        if (selected) {
          var episode = selected,
            parentFrame = stack[stack.length - 1];
          var result = go(function () {
            return detail(episode.Id);
          });
          if (parentFrame) parentFrame.focus = episode.Id;
          return result;
        }
      },
      actions,
    );
    if (context.seasons.length > 1) button("All seasons", back, actions);
    function paint(item) {
      selected = item;
      name.textContent = item.Name;
      itemMetadata(item, meta);
      overview.textContent = item.Overview || "No description available.";
      labelAction(
        playButton,
        ((item.UserData && item.UserData.PlaybackPositionTicks) || 0) > 0
          ? "Resume"
          : "Play",
      );
      labelAction(
        watched,
        item.UserData && item.UserData.Played
          ? "Mark as unwatched"
          : "Mark as watched",
      );
      var saved = !!(item.UserData && item.UserData.IsFavorite);
      favorite.setAttribute(
        "aria-label",
        saved ? "Remove from favorites" : "Add to favorites",
      );
      favorite.setAttribute("aria-pressed", String(saved));
      labelAction(
        favorite,
        saved ? "Remove from favorites" : "Add to favorites",
      );
      formatPills(item, specs);
      setBackdrop(item);
    }
    main.refreshPlaybackUserData = function (item, data) {
      if (valid() && selected && selected.Id === item.Id) {
        selectedRequest++; clearTimeout(timer);
        selected.UserData = Object.assign({}, selected.UserData, data);
        paint(selected);
      }
    };
    function select(item) {
      if (selected && selected.Id === item.Id) return;
      paint(item);
      subtitleMount.textContent = "";
      episodeSubtitles = subtitleControl(item, subtitleMount, function (full) {
        if (valid() && selected.Id === item.Id) formatPills(full, specs);
      });
      peopleHost.textContent = "";
      clearTimeout(timer);
      var n = ++selectedRequest;
      timer = setTimeout(function () {
        request("/Users/" + session.user + "/Items/" + item.Id)
          .then(function (full) {
            if (!valid() || n !== selectedRequest) return;
            full = Object.assign({}, item, full);
            paint(full);
            var people = full.People || [];
            renderPeople(
              full,
              peopleHost,
              "Cast & Crew",
              people.filter(function (person) {
                return person.Type !== "GuestStar";
              }),
            );
            renderPeople(
              full,
              peopleHost,
              "Guest stars",
              people.filter(function (person) {
                return person.Type === "GuestStar";
              }),
            );
          })
          .catch(function () {});
      }, 180);
    }
    async function load() {
      if (!valid() || loading || done) return;
      loading = true;
      status.textContent = "Loading episodes…";
      try {
        var data = await request("/Users/" + session.user + "/Items", {
          ParentId: id,
          IncludeItemTypes: "Episode",
          SortBy: "IndexNumber,SortName",
          SortOrder: "Ascending",
          StartIndex: offset,
          Limit: 48,
          Fields: "Overview,MediaSources,MediaStreams",
          EnableTotalRecordCount: true,
        });
        if (!valid()) return;
        var batch = data.Items || [],
          known = new Set(
            items.map(function (item) {
              return item.Id;
            }),
          );
        var fresh = batch.filter(function (item) {
          if (known.has(item.Id)) return false;
          known.add(item.Id);
          return true;
        });
        if (batch.length && !fresh.length)
          throw new Error("The server repeated this episode page.");
        items = items.concat(fresh);
        offset += batch.length;
        done =
          !batch.length ||
          (Number.isFinite(data.TotalRecordCount)
            ? offset >= data.TotalRecordCount
            : batch.length < 48);
        cards(fresh, grid, "landscape", grid);
        status.textContent = done
          ? items.length
            ? ""
            : "No episodes available."
          : "Scroll for more episodes.";
        var frame = stack[stack.length - 1],
          saved = frame && frame.focus;
        if (!selected && items.length) {
          var first =
            Array.prototype.find.call(grid.children, function (card) {
              return card.dataset.item === saved;
            }) || grid.firstElementChild;
          first.focus();
          main.scrollTop = 0;
        }
      } catch (error) {
        if (!valid()) return;
        status.textContent = "Could not load episodes. ";
        button("Retry episodes", load, status);
      } finally {
        loading = false;
      }
    }
    grid.addEventListener("focusin", function (event) {
      var card = event.target.closest(".card");
      if (!card) return;
      select(
        items.find(function (item) {
          return item.Id === card.dataset.item;
        }),
      );
      card.scrollIntoView({ block: "nearest", inline: "nearest" });
      main.scrollTop = 0;
      if (Array.prototype.indexOf.call(grid.children, card) >= items.length - 3)
        load();
    });
    grid.addEventListener("scroll", function () {
      if (grid.scrollWidth - grid.clientWidth - grid.scrollLeft < 480) load();
    });
    grid.addEventListener(
      "wheel",
      function (event) {
        if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) return;
        var next = Math.max(
          0,
          Math.min(
            grid.scrollWidth - grid.clientWidth,
            grid.scrollLeft + event.deltaY,
          ),
        );
        if (next !== grid.scrollLeft) {
          event.preventDefault();
          grid.scrollLeft = next;
        }
      },
      { passive: false },
    );
    activeListing = {
      dispose: function () {
        listingStates.set(cacheKey, {
          items: items,
          offset: offset,
          done: done,
        });
        while (listingStates.size > 6)
          listingStates.delete(listingStates.keys().next().value);
        clearTimeout(timer);
        controller.abort();
      },
      closeOptions: function () {
        return false;
      },
      scope: function () {
        return null;
      },
      handleKey: function (key, active) {
        if (tabs.contains(active)) {
          var controls = Array.prototype.slice.call(tabs.children),
            at = controls.indexOf(active);
          if (key === 37 || key === 39)
            focusContent(controls[at + (key === 37 ? -1 : 1)]);
          else if (key === 40) focusContent(grid.querySelector(".card"));
          return true;
        }
        if (grid.contains(active) && key === 38) {
          focusContent(tabs.querySelector('[aria-selected="true"]'));
          return true;
        }
        if (grid.contains(active) && key === 40) {
          focusContent(playButton);
          return true;
        }
        if (actions.contains(active) && key === 38) {
          focusContent(
            Array.prototype.find.call(grid.children, function (card) {
              return selected && card.dataset.item === selected.Id;
            }),
          );
          return true;
        }
        return false;
      },
    };
    if (items.length) {
      status.textContent = done ? "" : "Scroll for more episodes.";
      cards(items, grid, "landscape", grid);
      var parentFrame = stack[stack.length - 1];
      var restore = Array.prototype.find.call(grid.children, function (card) {
        return parentFrame && card.dataset.item === parentFrame.focus;
      });
      (restore || grid.firstElementChild).focus();
      main.scrollTop = 0;
    } else await load();
  }
  async function listing(id, title, focusControl, seasonContext, tvContext) {
    if (seasonContext) return seasonBrowser(id, title, seasonContext);
    var r = reset(title),
      controller = new AbortController(),
      disposed = false;
    main.className = "library-page";
    var library = libraryItems.find(function (item) {
      return item.Id === id;
    });
    if (library) selectNav(id);
    if (tvContext) {
      main.classList.add("tv-library-page");
      if (title === tvContext.library.Name)
        main.classList.add("tv-library-root");
      selectNav(tvContext.library.Id);
      tvTabs(tvContext.library, tvContext.tab);
    }
    var type = tvContext
      ? tvContext.library.CollectionType === "movies"
        ? "Movie"
        : "Series"
      : library &&
        { movies: "Movie,Video", tvshows: "Series" }[library.CollectionType];
    var scopeKey =
        id +
        (tvContext ? ":" + type : "") +
        (tvContext && tvContext.filter
          ? ":" + JSON.stringify(tvContext.filter)
          : ""),
      key = accountKey("library:" + scopeKey),
      preferenceKey = "library-options:" + scopeKey;
    var defaults = {
      sort: seasonContext ? "episode-asc" : "title-asc",
      watched: "all",
      genre: "",
      year: "",
    };
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
        jumpLetter: "",
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
    if (seasonContext && seasonContext.seriesId)
      seriesContinue(
        { Id: seasonContext.seriesId, Name: seasonContext.title },
        seasonContext.seasons,
      );
    if (seasonContext && seasonContext.seasons.length > 1) {
      var picker = el("div", null, main);
      picker.className = "season-picker";
      button("All seasons", back, picker);
    }
    var toolbar = el("div", null, main);
    toolbar.className = "library-toolbar";
    var alphabet = el("aside", null, main);
    alphabet.className = "library-alphabet";
    alphabet.setAttribute("aria-label", "Jump to title letter");
    main.classList.add("has-alphabet");
    "#ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (letter) {
      var jump = button(
        letter,
        function () {
          var replacement = fresh(
            Object.assign({}, state.options, { sort: "title-asc" }),
          );
          replacement.facets = state.facets;
          replacement.jumpLetter = letter === "#" ? "" : letter;
          listingStates.set(key, replacement);
          return listing(id, title, null, seasonContext, tvContext);
        },
        alphabet,
      );
      jump.dataset.letter = letter;
      jump.setAttribute(
        "aria-label",
        letter === "#" ? "Jump to beginning" : "Jump to " + letter,
      );
      if ((state.jumpLetter || "#") === letter)
        jump.setAttribute("aria-current", "true");
    });
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
    grid.className =
      "grid library-grid" + (seasonContext ? " episode-grid" : "");
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
    if (seasonContext)
      sortOptions.unshift(
        ["episode-asc", "Episode number (first to last)"],
        ["episode-desc", "Episode number (last to first)"],
      );
    function valid() {
      return !disposed && r === revision && holder.isConnected;
    }
    function geometry() {
      var style = getComputedStyle(grid);
      columns = document.documentElement.classList.contains("legacy-grid")
        ? innerWidth <= 1100
          ? 4
          : 6
        : style.gridTemplateColumns.split(/\s+/).length || 6;
      var width = (grid.clientWidth - 20 - 24 * (columns - 1)) / columns;
      rowHeight = width * (seasonContext ? 0.5625 : 1.5) + 75 + 32;
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
          cards(
            [state.items[index]],
            holder,
            seasonContext ? "landscape" : null,
            grid,
          );
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
      if (state.jumpLetter)
        count.textContent =
          "From " + state.jumpLetter + " · " + count.textContent;
      if (!state.items.length && state.done)
        loader.textContent = state.jumpLetter
          ? "No titles at or after " +
            state.jumpLetter +
            ". Choose another letter or # to return to the beginning."
          : "No items match these filters.";
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
          Object.assign(
            C.libraryQuery(id, state.options, state.nextIndex, type),
            seasonContext ? { Fields: "Overview,PrimaryImageAspectRatio" } : {},
            tvContext ? tvContext.filter || {} : {},
            state.jumpLetter
              ? { NameStartsWithOrGreater: state.jumpLetter }
              : {},
          ),
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
      return listing(id, title, control, seasonContext, tvContext);
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
      var dialogClose = button("Close options", closeOptions, dialog);
      dialogClose.className = "menu-close";
      dialogClose.focus();
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
      focusContent(content.querySelector('[aria-pressed="true"]') || content.querySelector("button"));
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
        if (alphabet.contains(active)) {
          var letters = Array.prototype.slice.call(
              alphabet.querySelectorAll("button"),
            ),
            at = letters.indexOf(active);
          if (key === 38 || key === 40)
            focusContent(
              letters[
                Math.max(
                  0,
                  Math.min(letters.length - 1, at + (key === 38 ? -1 : 1)),
                )
              ],
            );
          else if (key === 37) {
            if (state.items.length)
              focusIndex(
                state.focusId
                  ? Math.max(
                      0,
                      state.items.findIndex(function (item) {
                        return item.Id === state.focusId;
                      }),
                    )
                  : 0,
              );
            else focusContent(document.getElementById("library-sort"));
          }
          return true;
        }
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
          if (
            index % columns === columns - 1 ||
            index === state.items.length - 1
          ) {
            focusContent(
              alphabet.querySelector('[aria-current="true"]') ||
                alphabet.querySelector("button"),
            );
            return true;
          }
          target++;
        } else if (key === 38) target -= columns;
        else if (key === 40) target += columns;
        if (target < 0) {
          var continueCard = main.querySelector(".series-continue .card");
          if (continueCard) focusContent(continueCard);
          else document.getElementById("library-sort").focus();
        } else if (target < state.items.length || state.done)
          focusIndex(target);
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
  function guideTime(value) {
    var date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      : "";
  }
  async function liveGuide(state) {
    var r = reset("Live TV");
    selectNav("livetv");
    main.className = "live-guide-page";
    var owner = accountKey("live-guide");
    if (state.owner !== owner)
      Object.assign(state, {
        owner: owner,
        channels: [],
        next: 0,
        done: false,
        total: null,
        cache: new Map(),
        offset: 0,
        at: Date.now(),
        favorites: false,
        scroll: 0,
        focusChannel: null,
        focusColumn: 0,
      });
    if (!state.offset && Date.now() - state.at > 60000) {
      state.at = Date.now();
      state.cache.clear();
    }
    var controller = new AbortController(),
      disposed = false,
      loading = false,
      failed = false,
      frame = null;
    var rows = new Map(),
      queued = new Set(),
      jobs = [],
      running = 0,
      pendingFocus = null;
    var toolbar = el("div", null, main);
    toolbar.className = "guide-toolbar";
    livePreviewActions(toolbar);
    function reopen(channels) {
      if (channels) {
        state.channels = [];
        state.next = 0;
        state.done = false;
        state.total = null;
      }
      state.at = Date.now() + state.offset * 3600000;
      state.cache.clear();
      state.scroll = 0;
      return liveGuide(state);
    }
    button(
      "Now",
      function () {
        state.offset = 0;
        return reopen(false);
      },
      toolbar,
    );
    var earlier = button(
      "Earlier",
      function () {
        state.offset = Math.max(0, state.offset - 2);
        return reopen(false);
      },
      toolbar,
    );
    earlier.disabled = state.offset === 0;
    var later = button(
      "Later",
      function () {
        state.offset += 2;
        return reopen(false);
      },
      toolbar,
    );
    later.disabled = state.offset >= 24;
    var favoriteFilter = button(
      state.favorites ? "Channels: Favorites" : "Channels: All",
      function () {
        state.favorites = !state.favorites;
        return reopen(true);
      },
      toolbar,
    );
    favoriteFilter.setAttribute("aria-pressed", String(state.favorites));
    button(
      "Refresh guide",
      function () {
        return reopen(true);
      },
      toolbar,
    );
    el(
      "p",
      new Date(state.at).toLocaleString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      main,
    ).className = "metadata";
    var headers = el("div", null, main);
    headers.className = "guide-headings";
    el("span", "Channel", headers);
    el("span", state.offset ? "At " + guideTime(state.at) : "Now", headers);
    el("span", "Next", headers);
    var count = el("p", "Loading channels…", main);
    count.id = "guide-count";
    count.setAttribute("role", "status");
    var holder = el("div", null, main);
    holder.id = "guide-channels";
    var top = el("div", null, holder),
      list = el("div", null, holder),
      bottom = el("div", null, holder);
    top.setAttribute("aria-hidden", "true");
    bottom.setAttribute("aria-hidden", "true");
    var loader = el("div", null, main);
    loader.id = "guide-loading";
    function valid() {
      return !disposed && r === revision;
    }
    function itemButton(label, action, parent, channel, column, itemId) {
      var control = button(label, action, parent);
      control.dataset.channel = channel.Id;
      control.dataset.column = column;
      control.dataset.item = itemId;
      return control;
    }
    function focusRow(index, column) {
      if (!valid()) return;
      if (column === 0) column = 1;
      var channel = state.channels[index];
      if (!channel) {
        pendingFocus = { index: index, column: column };
        if (!loading && !failed && !state.done) run(loadChannels);
        return;
      }
      var node = rows.get(channel.Id);
      if (!node || !node.isConnected) {
        main.scrollTop = Math.max(
          0,
          holder.offsetTop - main.offsetTop + index * 132 - 100,
        );
        render(index);
        node = rows.get(channel.Id);
      }
      if (node) {
        var target =
          node.querySelector('[data-column="' + column + '"]') ||
          node.querySelector('[data-column="1"]') ||
          node.querySelector("button");
        if (target) focusContent(target);
      }
    }
    function showBrowseDetails(channel, column) {
      if (!livePreview || !channel) return;
      var cached = state.cache.get(channel.Id),
        programme =
          cached &&
          cached.data &&
          (column === 2 ? cached.data.next : cached.data.current),
        station =
          (channel.ChannelNumber ? channel.ChannelNumber + " · " : "") +
          channel.Name;
      document.getElementById("live-browse-title").textContent = programme
        ? programme.Name
        : channel.Name;
      document.getElementById("live-browse-metadata").textContent =
        station +
        (programme
          ? " · " +
            guideTime(programme.StartDate) +
            " – " +
            guideTime(programme.EndDate)
          : "");
      document.getElementById("live-browse-overview").textContent = programme
        ? programme.Overview || "No description available."
        : !cached
          ? "Loading programme details…"
          : cached.error
            ? "Programme details are unavailable. Retry listings for this channel."
            : column === 2
              ? "No upcoming programme listed."
              : "No programme listed for this channel.";
    }
    function watchChannel(channel, programme) {
      return play(
        {
          Id: programme ? programme.Id : channel.Id,
          ChannelId: channel.Id,
          ChannelName: channel.Name,
          Name: programme ? programme.Name : channel.Name,
          IsLiveChannel: true,
        },
        0,
        false,
        true,
      );
    }
    function watchCell(cell, channel, message) {
      return itemButton(
        "Watch live · " + message,
        function () {
          return watchChannel(channel);
        },
        cell,
        channel,
        1,
        channel.Id + ":watch",
      );
    }
    function fillProgrammes(row, channel, result) {
      var focused =
        row.contains(document.activeElement) &&
        document.activeElement.dataset.column;
      var cells = row.querySelectorAll(".guide-programme");
      cells.forEach(function (cell, index) {
        cell.textContent = "";
        var programme = index === 0 ? result.current : result.next;
        if (!programme) {
          if (index === 0) watchCell(cell, channel, "No programme listed");
          else el("p", "No upcoming listing", cell);
          return;
        }
        var control = itemButton(
          "",
          function () {
            if (
              Date.parse(programme.StartDate) <= Date.now() &&
              Date.parse(programme.EndDate) > Date.now()
            )
              return watchChannel(channel, programme);
            return go(function () {
              return detail(programme.Id, true);
            });
          },
          cell,
          channel,
          index + 1,
          programme.Id,
        );
        el("span", programme.Name || "Untitled programme", control).className =
          "guide-programme-title";
        el(
          "span",
          guideTime(programme.StartDate) + " – " + guideTime(programme.EndDate),
          control,
        ).className = "guide-time";
        if (!state.offset && index === 0) {
          var progress = el("div", null, control);
          progress.className = "guide-progress";
          el("div", null, progress).style.width =
            C.liveProgress(programme, state.at) + "%";
        }
      });
      if (state.focusChannel === channel.Id)
        showBrowseDetails(channel, state.focusColumn);
      if (focused) {
        var restore = row.querySelector('[data-column="' + focused + '"]');
        if (restore) restore.focus();
      }
    }
    function enqueue(channel, row) {
      var cached = state.cache.get(channel.Id);
      if (cached && Date.now() - cached.time < 60000) {
        if (cached.error) guideError(row, channel);
        else fillProgrammes(row, channel, cached.data);
        return;
      }
      if (queued.has(channel.Id)) return;
      queued.add(channel.Id);
      jobs.push({ channel: channel, row: row });
      pump();
    }
    function guideError(row, channel) {
      if (state.focusChannel === channel.Id)
        showBrowseDetails(channel, state.focusColumn);
      var cells = row.querySelectorAll(".guide-programme");
      cells[0].textContent = "";
      cells[1].textContent = "";
      watchCell(cells[0], channel, "Guide unavailable");
      itemButton(
        "Retry guide",
        function () {
          state.cache.delete(channel.Id);
          enqueue(channel, row);
        },
        cells[1],
        channel,
        2,
        channel.Id + ":retry",
      );
    }
    function pump() {
      if (!valid()) return;
      while (running < 2 && jobs.length) {
        var job = jobs.shift();
        job.row = rows.get(job.channel.Id) || job.row;
        if (!job.row.isConnected) {
          queued.delete(job.channel.Id);
          continue;
        }
        running++;
        (function (entry) {
          api(
            "/LiveTv/Programs",
            {
              UserId: session.user,
              ChannelIds: entry.channel.Id,
              MinEndDate: new Date(state.at).toISOString(),
              MaxStartDate: new Date(state.at + 24 * 3600000).toISOString(),
              SortBy: "StartDate",
              SortOrder: "Ascending",
              Limit: 24,
              Fields: "Overview,ChannelInfo",
              EnableImages: true,
            },
            null,
            "GET",
            { signal: controller.signal },
          )
            .then(function (data) {
              if (!valid()) return;
              var result = C.liveProgrammes(
                data.Items,
                entry.channel.Id,
                state.at,
              );
              state.cache.set(entry.channel.Id, {
                time: Date.now(),
                data: result,
              });
              var target = rows.get(entry.channel.Id);
              if (target && target.isConnected)
                fillProgrammes(target, entry.channel, result);
            })
            .catch(function () {
              if (!valid()) return;
              state.cache.set(entry.channel.Id, {
                time: Date.now(),
                error: true,
              });
              var target = rows.get(entry.channel.Id);
              if (target && target.isConnected)
                guideError(target, entry.channel);
            })
            .finally(function () {
              running--;
              queued.delete(entry.channel.Id);
              while (state.cache.size > 100)
                state.cache.delete(state.cache.keys().next().value);
              pump();
            });
        })(job);
      }
    }
    function channelRow(channel) {
      var row = el("div");
      row.className = "guide-channel-row";
      var station = el("div", null, row);
      station.className = "guide-station";
      var watch = el("div", null, station);
      watch.className = "guide-channel-label";
      var logo = image(channel, true);
      if (logo) {
        var img = el("img", null, watch);
        setImageSource(img, logo);
        img.alt = "";
        img.loading = "lazy";
        img.width = 56;
        img.height = 48;
        img.onerror = function () {
          img.hidden = true;
        };
      }
      el(
        "span",
        (channel.ChannelNumber ? channel.ChannelNumber + " · " : "") +
          channel.Name,
        watch,
      );
      var favorite = itemButton(
        "",
        async function () {
          if (favorite.disabled) return;
          favorite.disabled = true;
          try {
            var remove = !!(channel.UserData && channel.UserData.IsFavorite);
            await api(
              "/Users/" +
                session.user +
                "/FavoriteItems/" +
                encodeURIComponent(channel.Id),
              null,
              null,
              remove ? "DELETE" : "POST",
              { signal: controller.signal },
            );
            if (!valid()) return;
            channel.UserData = Object.assign({}, channel.UserData, {
              IsFavorite: !remove,
            });
            labelFavorite();
            if (state.favorites && remove) return reopen(true);
          } finally {
            if (valid()) favorite.disabled = false;
          }
        },
        station,
        channel,
        3,
        channel.Id + ":favorite",
      );
      favorite.className = "guide-favorite";
      function labelFavorite() {
        var saved = !!(channel.UserData && channel.UserData.IsFavorite);
        favorite.textContent = saved ? "★" : "☆";
        favorite.setAttribute(
          "aria-label",
          (saved ? "Unfavorite " : "Favorite ") + channel.Name,
        );
        favorite.setAttribute("aria-pressed", String(saved));
      }
      labelFavorite();
      for (var i = 0; i < 2; i++) {
        var cell = el("div", null, row);
        cell.className = "guide-programme";
        if (i === 0) watchCell(cell, channel, "Loading programme…");
        else el("p", "Loading…", cell);
      }
      return row;
    }
    function render(ensureIndex) {
      if (!valid()) return;
      var offset = Math.max(
        0,
        main.getBoundingClientRect().top - holder.getBoundingClientRect().top,
      );
      var first = Math.max(0, Math.floor(offset / 132) - 3);
      if (ensureIndex != null) first = Math.max(0, ensureIndex - 3);
      var end = Math.min(
        state.channels.length,
        first + Math.ceil(main.clientHeight / 132) + 7,
      );
      var keep = new Set(
        state.channels.slice(first, end).map(function (c) {
          return c.Id;
        }),
      );
      rows.forEach(function (row, id) {
        if (!keep.has(id)) {
          row.remove();
          rows.delete(id);
        }
      });
      top.style.height = first * 132 + "px";
      bottom.style.height = (state.channels.length - end) * 132 + "px";
      var cursor = list.firstChild;
      state.channels.slice(first, end).forEach(function (channel) {
        var row = rows.get(channel.Id),
          fresh = !row;
        if (fresh) {
          row = channelRow(channel);
          rows.set(channel.Id, row);
        }
        if (row !== cursor) list.insertBefore(row, cursor);
        cursor = row.nextSibling;
        if (fresh) enqueue(channel, row);
      });
      count.textContent =
        state.channels.length +
        (state.total != null ? " of " + state.total : "") +
        " channels";
      if (!state.channels.length && state.done)
        count.textContent = state.favorites
          ? "No favorite channels. Switch to All to add favorites."
          : "No Live TV channels available. Check your Jellyfin Live TV setup and account access.";
    }
    async function loadChannels() {
      if (!valid() || loading || state.done) return;
      loading = true;
      failed = false;
      loader.textContent = "Loading channels…";
      try {
        var data = await api(
          "/LiveTv/Channels",
          {
            UserId: session.user,
            StartIndex: state.next,
            Limit: 24,
            SortBy: "ChannelNumber,SortName",
            SortOrder: "Ascending",
            IsFavorite: state.favorites ? true : undefined,
            AddCurrentProgram: true,
            EnableUserData: true,
            EnableImages: true,
          },
          null,
          "GET",
          { signal: controller.signal },
        );
        if (!valid()) return;
        var items = data.Items || [],
          ids = new Set(
            state.channels.map(function (c) {
              return c.Id;
            }),
          ),
          added = 0;
        items.forEach(function (c) {
          if (c.Id && !ids.has(c.Id)) {
            ids.add(c.Id);
            state.channels.push(c);
            added++;
          }
        });
        if (items.length && !added)
          throw new Error(
            "The server returned duplicate channels. Retry to continue.",
          );
        state.next += items.length;
        state.total = Number.isFinite(data.TotalRecordCount)
          ? data.TotalRecordCount
          : null;
        state.done =
          !items.length || (state.total != null && state.next >= state.total);
        loader.textContent = "";
        render();
        if (pendingFocus) {
          var pending = pendingFocus;
          pendingFocus = null;
          focusRow(pending.index, pending.column);
        }
      } catch (error) {
        if (!valid()) return;
        failed = true;
        if (!state.channels.length) count.textContent = "No channels loaded";
        loader.textContent = "";
        el(
          "p",
          error.status === 403
            ? "Live TV is unavailable for this account."
            : "Could not load channels. " + error.message,
          loader,
        );
        var retry = button("Retry channels", loadChannels, loader);
        if (pendingFocus) retry.focus();
      } finally {
        loading = false;
        if (valid() && !failed) schedule();
      }
    }
    function tick() {
      frame = null;
      if (!valid()) return;
      state.scroll = main.scrollTop;
      render();
      if (
        main.scrollTop + main.clientHeight >= main.scrollHeight - 396 &&
        !loading &&
        !failed &&
        !state.done
      )
        run(loadChannels);
    }
    function schedule() {
      if (frame == null && valid()) frame = requestAnimationFrame(tick);
    }
    function remember(e) {
      if (e.target.dataset.channel) {
        state.focusChannel = e.target.dataset.channel;
        state.focusColumn = Number(e.target.dataset.column);
        showBrowseDetails(
          state.channels.find(function (channel) {
            return channel.Id === state.focusChannel;
          }),
          state.focusColumn,
        );
      }
    }
    main.addEventListener("scroll", schedule);
    main.addEventListener("focusin", remember);
    activeGuide = {
      focusChannel: function (id) {
        var index = state.channels.findIndex(function (channel) {
          return channel.Id === id;
        });
        if (index >= 0) {
          focusRow(index, 0);
          showBrowseDetails(state.channels[index], 0);
        } else focusFirst();
      },
      dispose: function () {
        disposed = true;
        controller.abort();
        if (frame != null) cancelAnimationFrame(frame);
        main.removeEventListener("scroll", schedule);
        main.removeEventListener("focusin", remember);
        jobs = [];
      },
      handleKey: function (key, node) {
        if (
          (key === 40 && toolbar.contains(node)) ||
          (key === 39 && nav.contains(node))
        ) {
          focusRow(0, 1);
          return true;
        }
        if (!node.dataset.channel) return false;
        var index = state.channels.findIndex(function (c) {
            return c.Id === node.dataset.channel;
          }),
          column = Number(node.dataset.column);
        if (key === 38 || key === 40) {
          var next = index + (key === 38 ? -1 : 1);
          if (next < 0)
            focusContent(
              Array.prototype.find.call(
                toolbar.querySelectorAll("button"),
                function (entry) {
                  return !entry.disabled && entry.getClientRects().length;
                },
              ),
            );
          else if (next < state.channels.length || !state.done)
            focusRow(next, column);
          return true;
        }
        if (key === 37 || key === 39) {
          var row = node.closest(".guide-channel-row"),
            order = [3, 1, 2],
            at = order.indexOf(column),
            target = order[at + (key === 37 ? -1 : 1)];
          if (target != null) {
            var choice = row.querySelector('[data-column="' + target + '"]');
            if (choice) focusContent(choice);
          } else if (key === 37)
            focusContent(nav.querySelector('[data-nav="livetv"]'));
          return true;
        }
        return false;
      },
    };
    render();
    main.scrollTop = state.scroll;
    render();
    if (state.focusChannel) {
      var index = state.channels.findIndex(function (c) {
        return c.Id === state.focusChannel;
      });
      if (index >= 0) focusRow(index, state.focusColumn || 1);
      else focusRow(0, 1);
    } else focusRow(0, 1);
    if (!state.channels.length) await loadChannels();
  }
  async function seasonChoices(seriesId) {
    var data = await api(
      "/Shows/" + encodeURIComponent(seriesId) + "/Seasons",
      {
        UserId: session.user,
        IsMissing: false,
        Fields: "ItemCounts,UserData",
      },
    );
    return (data.Items || [])
      .filter(function (season) {
        return season.Id;
      })
      .sort(function (a, b) {
        return (
          (a.IndexNumber == null ? 9999 : a.IndexNumber) -
          (b.IndexNumber == null ? 9999 : b.IndexNumber)
        );
      });
  }
  async function seasonsPage(seriesId) {
    return detail(seriesId);
  }
  function seriesRows(item, seasons, error) {
    var ready = seriesContinue(item, seasons);
    var holder = el("section", null, main);
    holder.className = "season-choices";
    if (error) {
      el("p", "Could not load seasons. " + error.message, holder);
      button(
        "Retry seasons",
        function () {
          return detail(item.Id);
        },
        holder,
      );
    } else if (!seasons.length) el("p", "No seasons available.", holder);
    else {
      el("h2", "Seasons (" + seasons.length + ")", holder);
      var grid = cards(
        seasons.map(function (season) {
          return Object.assign({}, season, {
            Name: season.Name || "Season " + season.IndexNumber,
            SeriesName: null,
          });
        }),
        holder,
        null,
        null,
        function (season) {
          return go(function () {
            return listing(season.Id, item.Name + " · " + season.Name, false, {
              seriesId: item.Id,
              title: item.Name,
              seasons: seasons,
            });
          });
        },
      );
      grid.classList.add("season-grid", "rail", "portrait");
    }
    return ready;
  }
  function seriesContinue(item, seasons) {
    var controller = new AbortController();
    detailController = controller;
    var continueRow = el("section", null, main);
    continueRow.className = "series-continue";
    continueRow.hidden = true;
    async function loadContinue() {
      continueRow.textContent = "";
      continueRow.hidden = true;
      function request(path, query) {
        return api(path, query, null, "GET", { signal: controller.signal });
      }
      var results = await Promise.allSettled([
        request("/Users/" + session.user + "/Items/Resume", {
          ParentId: item.Id,
          IncludeItemTypes: "Episode",
          Limit: 1,
          Fields: "Overview",
        }),
        request("/Shows/NextUp", {
          UserId: session.user,
          SeriesId: item.Id,
          Limit: 1,
          EnableResumable: true,
          EnableRewatching: false,
          Fields: "Overview",
        }),
        request("/Users/" + session.user + "/Items", {
          ParentId: item.Id,
          Recursive: true,
          IncludeItemTypes: "Episode",
          IsPlayed: true,
          Limit: 1,
          Fields: "UserData",
        }),
      ]);
      if (controller.signal.aborted || !continueRow.isConnected) return;
      function entries(index) {
        return results[index].status === "fulfilled"
          ? (results[index].value.Items || []).filter(function (entry) {
              return entry.SeriesId === item.Id;
            })
          : [];
      }
      var resume = entries(0).find(function (entry) {
          return entry.UserData && entry.UserData.PlaybackPositionTicks > 0;
        }),
        watched = entries(2).some(function (entry) {
          return entry.UserData && entry.UserData.Played;
        }),
        next = watched ? entries(1)[0] : null,
        episode = resume || next,
        heading = "Continue watching";
      if (
        !episode &&
        !results.some(function (result) {
          return result.status === "rejected";
        })
      ) {
        var firstSeason =
          (seasons || []).find(function (season) {
            return season.IndexNumber === 1;
          }) ||
          (seasons || []).find(function (season) {
            return season.IndexNumber > 0;
          }) ||
          (seasons || [])[0];
        try {
          var first = await request(
            "/Shows/" + encodeURIComponent(item.Id) + "/Episodes",
            {
              UserId: session.user,
              SeasonId: firstSeason && firstSeason.Id,
              Season: firstSeason ? undefined : 1,
              SortBy: "IndexNumber",
              IsMissing: false,
              Limit: 24,
              Fields: "Overview",
            },
          );
          if (controller.signal.aborted || !continueRow.isConnected) return;
          var episodes = (first.Items || []).filter(function (entry) {
            return entry.SeriesId === item.Id && !entry.IsMissing;
          });
          episode =
            episodes.find(function (entry) {
              return entry.IndexNumber === 1;
            }) ||
            episodes.find(function (entry) {
              return entry.IndexNumber > 0;
            }) ||
            episodes[0];
          heading = watched ? "Watch again" : "Start watching";
        } catch (error) {
          if (controller.signal.aborted || !continueRow.isConnected) return;
          results.push({ status: "rejected" });
        }
      }
      if (episode) {
        continueRow.hidden = false;
        el("h2", heading, continueRow);
        var content = el("div", null, continueRow);
        content.className = "series-continue-content";
        cards([episode], content, "landscape");
        var selected = document.activeElement.episodeItem || episode;
        var description = el(
          "p",
          selected.Overview || "No description available.",
          content,
        );
        description.className = "series-continue-description";
      } else if (
        results.some(function (result) {
          return result.status === "rejected";
        })
      ) {
        continueRow.hidden = false;
        el("p", "Could not check your next episode.", continueRow);
        button("Retry continue watching", loadContinue, continueRow);
      }
    }
    return loadContinue().then(function () {
      return continueRow.querySelector(".card,button");
    });
  }
  function formatPills(item, host) {
    var source = (item.MediaSources || [])[0],
      streams = (source && source.MediaStreams) || item.MediaStreams || [];
    var videoStream =
      streams.find(function (stream) {
        return stream.Type === "Video";
      }) || {};
    var audioStreams = streams.filter(function (stream) {
      return stream.Type === "Audio";
    });
    var audioStream =
      audioStreams.find(function (stream) {
        return source && stream.Index === source.DefaultAudioStreamIndex;
      }) ||
      audioStreams.find(function (stream) {
        return stream.IsDefault;
      }) ||
      audioStreams[0] ||
      {};
    var height = Number(videoStream.Height || (source && source.Height));
    var width = Number(videoStream.Width || (source && source.Width));
    var resolution =
      width >= 7600 || height >= 4200
        ? "8K"
        : width >= 3800 || height >= 2100
          ? "4K"
          : width >= 2500 || height >= 1400
            ? "1440p"
            : width >= 1900 || height >= 1060
              ? "1080p"
              : width >= 1260 || height >= 700
                ? "720p"
                : height > 0 && height <= 8640
                  ? height + "p"
                  : "";
    var range = /^DOVI/.test(videoStream.VideoRangeType || "")
      ? "Dolby Vision"
      : { HDR10: "HDR10", HDR10Plus: "HDR10+", HLG: "HLG" }[
          videoStream.VideoRangeType
        ] || "";
    var codec = String(videoStream.Codec || "").toLowerCase();
    var codecLabel =
      {
        hevc: "HEVC",
        h265: "HEVC",
        h264: "H.264",
        av1: "AV1",
        vp9: "VP9",
        mpeg2video: "MPEG-2",
        mpeg4: "MPEG-4",
      }[codec] || (/^[a-z0-9]{1,12}$/.test(codec) ? codec.toUpperCase() : "");
    var channels = Number(audioStream.Channels);
    var audioLabel =
      { 1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1" }[channels] ||
      (channels > 0 && channels <= 32 ? channels + " channels" : "");
    var labels = [
      [resolution, range].filter(Boolean).join(" "),
      codecLabel,
      [({ eng: "English", en: "English", spa: "Spanish", es: "Spanish", fra: "French", fre: "French", fr: "French", jpn: "Japanese", ja: "Japanese", deu: "German", ger: "German", de: "German", ita: "Italian", it: "Italian", hin: "Hindi", hi: "Hindi", kor: "Korean", ko: "Korean", zho: "Chinese", chi: "Chinese", zh: "Chinese" })[String(audioStream.Language || "").toLowerCase()] || audioStream.Language || "",
        ({ opus: "Opus", aac: "AAC", ac3: "Dolby Digital", eac3: "Dolby Digital Plus", truehd: "TrueHD", dts: "DTS", flac: "FLAC", mp3: "MP3", vorbis: "Vorbis" })[String(audioStream.Codec || "").toLowerCase()] || "", audioLabel].filter(Boolean).join(" "),
    ].filter(Boolean);
    host.textContent = "";
    host.classList.add("format-pills");
    host.setAttribute("aria-label", labels.join(" · "));
    labels.forEach(function (label) {
      var pill = el("span", label, host);
      pill.className = "format-pill";
      if (label === labels[labels.length - 1] && audioStreams.length) {
        var icon = el("img", null, pill);
        icon.src = "icons/volume_up.svg";
        icon.alt = "";
        pill.insertBefore(icon, pill.firstChild);
      }
    });
  }
  var subtitleSearch = el("section", null, document.body),
    subtitleSearchController = null,
    subtitleSearchFocus = null;
  subtitleSearch.id = "subtitle-search";
  subtitleSearch.hidden = true;
  subtitleSearch.setAttribute("role", "dialog");
  subtitleSearch.setAttribute("aria-modal", "true");
  subtitleSearch.setAttribute("aria-label", "Download subtitles");
  function closeSubtitleSearch(restore) {
    if (!subtitleSearch) return;
    if (subtitleSearchController) subtitleSearchController.abort();
    subtitleSearchController = null;
    subtitleSearch.hidden = true;
    subtitleSearch.textContent = "";
    if (restore !== false && subtitleSearchFocus && subtitleSearchFocus.isConnected)
      subtitleSearchFocus.focus();
  }
  async function findSubtitles(item, source, downloaded) {
    closeSubtitleSearch(false);
    var controller = new AbortController(), context = session, view = revision;
    subtitleSearchController = controller;
    subtitleSearchFocus = document.activeElement;
    function valid() {
      return !controller.signal.aborted && session === context && revision === view &&
        !subtitleSearch.hidden && (!playing || playing.item.Id === item.Id);
    }
    subtitleSearch.hidden = false;
    el("h2", "Download subtitles", subtitleSearch);
    button("Close", closeSubtitleSearch, subtitleSearch).className = "menu-close";
    el("p", "Find SRT or WebVTT subtitles to render on this TV without burn-in. Downloads are saved to your Jellyfin server.", subtitleSearch);
    var label = el("label", "Language", subtitleSearch),
      language = el("select", null, subtitleSearch);
    language.id = "subtitle-search-language";
    label.htmlFor = language.id;
    var preferred = readPreference("track-preferences", {}).Subtitle || {},
      initial = preferred.language || "eng";
    [["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["ita", "Italian"], ["por", "Portuguese"], ["jpn", "Japanese"], ["kor", "Korean"], ["zho", "Chinese"], ["hin", "Hindi"]].forEach(function (entry) {
      var option = el("option", entry[1], language);
      option.value = entry[0];
    });
    language.value = initial;
    if (!language.value) language.value = "eng";
    var search = button("Search", searchSubtitles, subtitleSearch),
      results = el("div", null, subtitleSearch),
      request = 0;
    results.setAttribute("aria-live", "polite");
    language.focus();
    // Language lookup is optional; searching still works if the server denies it.
    api("/Localization/Languages", null, null, "GET", { signal: controller.signal }).then(function (languages) {
      if (!valid() || !Array.isArray(languages)) return;
      var selected = language.value;
      languages.forEach(function (entry) {
        var code = entry.ThreeLetterISOLanguageName;
        if (!/^[a-z]{3}$/.test(code || "") || Array.prototype.some.call(language.options, function (option) { return option.value === code; })) return;
        var option = el("option", entry.DisplayName || entry.Name || code, language);
        option.value = code;
      });
      language.value = selected;
    }).catch(function () {});
    async function searchSubtitles() {
      var token = ++request, code = language.value;
      results.textContent = "Searching…";
      search.disabled = true;
      language.disabled = true;
      try {
        var matches = await api("/Items/" + encodeURIComponent(item.Id) + "/RemoteSearch/Subtitles/" + encodeURIComponent(code), null, null, "GET", { signal: controller.signal, timeoutMs: 60000 });
        if (!valid() || token !== request) return;
        matches = (Array.isArray(matches) ? matches : []).filter(function (entry) {
          return entry.Id && /^(srt|subrip|vtt|webvtt)$/i.test(entry.Format || "");
        }).sort(function (a, b) {
          return Number(!!b.IsHashMatch) - Number(!!a.IsHashMatch) ||
            Number(/^(srt|subrip)$/i.test(b.Format)) - Number(/^(srt|subrip)$/i.test(a.Format)) ||
            (Number(b.CommunityRating) || 0) - (Number(a.CommunityRating) || 0) ||
            (Number(b.DownloadCount) || 0) - (Number(a.DownloadCount) || 0);
        });
        results.textContent = "";
        if (!matches.length) el("p", "No compatible subtitles found. Try another language, or check the subtitle provider in Jellyfin.", results);
        matches.slice(0, 100).forEach(function (entry) {
          var text = [entry.Name || "Subtitle", entry.ProviderName, String(entry.Format).toUpperCase(),
            entry.IsHashMatch ? "Exact file match" : "", entry.HearingImpaired ? "Hearing impaired" : "", entry.Forced ? "Forced" : ""].filter(Boolean).join(" · ");
          button("Download and use: " + text, function () { return download(entry); }, results);
        });
        var first = results.querySelector("button");
        if (first) focusContent(first);
      } catch (error) {
        if (valid() && token === request) results.textContent = error.status === 403
          ? "This Jellyfin account does not have permission to search or download subtitles."
          : "Subtitle search failed. Check the provider configuration in Jellyfin and try again.";
      } finally { if (valid() && token === request) { search.disabled = false; language.disabled = false; } }
    }
    async function download(entry) {
      search.disabled = true;
      language.disabled = true;
      results.textContent = "Downloading…";
      var before = (source.MediaStreams || []).filter(function (track) { return track.Type === "Subtitle" && track.IsExternal; });
      try {
        await api("/Items/" + encodeURIComponent(source.Id || item.Id) + "/RemoteSearch/Subtitles/" + encodeURIComponent(entry.Id), null, null, "POST", { signal: controller.signal, timeoutMs: 60000 });
        for (var attempt = 0; attempt < 8; attempt++) {
          if (!valid()) return;
          var metadata = await api("/Items/" + encodeURIComponent(item.Id) + "/PlaybackInfo", { UserId: context.user }, null, "GET", { signal: controller.signal }),
            updated = (metadata.MediaSources || []).find(function (candidate) { return candidate.Id === source.Id; }),
            track = updated && (updated.MediaStreams || []).find(function (candidate) {
              return candidate.IsExternal && C.textSubtitle(updated, candidate.Index) && !before.some(function (old) {
                return old.Path && candidate.Path ? old.Path === candidate.Path : old.Index === candidate.Index && old.Codec === candidate.Codec && old.Language === candidate.Language && old.DisplayTitle === candidate.DisplayTitle;
              });
            });
          if (!valid()) return;
          if (track) {
            if (!P.nativeSubtitle) {
              var style = subtitleOptions();
              style.enabled = true;
              localStorage.setItem(accountKey("subtitle-appearance"), JSON.stringify(style));
            }
            saveSubtitleChoice(item.Id, updated, track.Index);
            closeSubtitleSearch(false);
            try {
              await downloaded(updated, track);
              message("Subtitle downloaded and selected.");
            } catch (error) { message("Subtitle downloaded, but could not select it. " + error.message); }
            return;
          }
          results.textContent = "Waiting for Jellyfin to refresh subtitle tracks…";
          await new Promise(function (resolve) { setTimeout(resolve, 1500); });
        }
        throw new Error("Jellyfin has not exposed the downloaded track yet. Try reopening subtitles in a moment; check the provider and server write permissions if it does not appear.");
      } catch (error) {
        if (valid()) results.textContent = error.status === 403
          ? "This Jellyfin account does not have permission to download subtitles."
          : "Could not select the download. " + error.message;
      } finally {
        if (valid()) { search.disabled = false; language.disabled = false; search.focus(); }
      }
    }
  }
  function subtitleControl(item, parent, onSource) {
    var subtitleSettings = el("div", null, parent);
    subtitleSettings.className = "detail-subtitle-settings";
    var compact = parent.classList.contains("movie-specs");
    function openDetailSubtitles() {
      subtitleMenu.hidden = !subtitleMenu.hidden;
      subtitlePicker.setAttribute(
        "aria-expanded",
        String(!subtitleMenu.hidden),
      );
      if (!subtitleMenu.hidden) {
        var chosen =
          subtitleMenu.querySelector('[aria-selected="true"]') ||
          subtitleMenu.querySelector("button");
        if (chosen) focusContent(chosen);
      }
    }
    var subtitlePicker = button(
      "Loading subtitles…",
      openDetailSubtitles,
      subtitleSettings,
    );
    subtitlePicker.id = "detail-subtitles";
    subtitlePicker.value = "-1";
    subtitlePicker.setAttribute("role", "combobox");
    subtitlePicker.setAttribute("aria-label", "Subtitles before playback");
    subtitlePicker.setAttribute("aria-haspopup", "listbox");
    subtitlePicker.setAttribute("aria-expanded", "false");
    subtitlePicker.setAttribute("aria-controls", "detail-subtitle-menu");
    var subtitleLabel = el("label", "Subtitles", subtitleSettings);
    subtitleLabel.htmlFor = subtitlePicker.id;
    subtitleSettings.insertBefore(subtitleLabel, subtitlePicker);
    var subtitleMenu = el("div", null, subtitleSettings);
    subtitleMenu.id = "detail-subtitle-menu";
    subtitleMenu.setAttribute("role", "listbox");
    subtitleMenu.setAttribute("aria-label", "Available subtitles");
    subtitleMenu.hidden = true;
    function detailSubtitleOptions() {
      return subtitlePicker.disabled ||
        !subtitlePicker.dataset.source ||
        subtitlePicker.dataset.explicit !== "true"
        ? {}
        : {
            subtitleIndex: Number(subtitlePicker.value),
            mediaSourceId: subtitlePicker.dataset.source,
          };
    }
    async function loadDetailSubtitles() {
      subtitlePicker.disabled = true;
      subtitlePicker.textContent = "Loading subtitles…";
      subtitleMenu.textContent = "";
      try {
        var sources = item.MediaSources;
        if (
          !sources ||
          !sources.some(function (source) {
            return Array.isArray(source.MediaStreams);
          })
        ) {
          var metadata = await api(
            "/Items/" + encodeURIComponent(item.Id) + "/PlaybackInfo",
            { UserId: session.user },
          );
          sources = metadata.MediaSources || [];
        }
        if (!subtitlePicker.isConnected) return;
        var source =
            sources.find(function (entry) {
              return Array.isArray(entry.MediaStreams);
            }) || {},
          tracks = [{ index: -1, label: "Off" }].concat(
            C.subtitleTracks(source),
          ),
          saved = readPreference("subtitle-choices", {})[item.Id],
          chosen =
            saved && saved.source === source.Id
              ? saved.index
              : C.defaultSubtitle(source,
                  await defaultAudio(item, source),
                  subtitleDefaults(), readPreference("track-preferences", {}).Subtitle);
        if (!subtitlePicker.isConnected) return;
        if (chosen == null) chosen = source.DefaultSubtitleStreamIndex;
        if (
          !tracks.some(function (track) {
            return track.index === chosen;
          })
        )
          chosen = -1;
        if (onSource)
          onSource(Object.assign({}, item, { MediaSources: [source] }));
        if (source.Id) subtitlePicker.dataset.source = source.Id;
        subtitlePicker.dataset.explicit = String(
          !!(saved && saved.source === source.Id && saved.index === chosen),
        );
        function selectTrack(track, persist) {
          subtitlePicker.value = String(track.index);
          subtitlePicker.textContent = compact
            ? (track.index < 0 ? "None" : track.label) + (tracks.length > 1 ? " (+" + (tracks.length - 1) + ")" : "")
            : track.label;
          Array.prototype.forEach.call(
            subtitleMenu.querySelectorAll("button"),
            function (node) {
              node.setAttribute(
                "aria-selected",
                String(node.dataset.index === String(track.index)),
              );
            },
          );
          subtitleMenu.hidden = true;
          subtitlePicker.setAttribute("aria-expanded", "false");
          if (persist) {
            subtitlePicker.dataset.explicit = "true";
            saveSubtitleChoice(item.Id, source, track.index);
            subtitlePicker.focus();
          }
        }
        tracks.forEach(function (track) {
          var option = button(
            track.label,
            function () {
              selectTrack(track, true);
            },
            subtitleMenu,
          );
          option.setAttribute("role", "option");
          option.dataset.index = String(track.index);
          option.setAttribute("aria-selected", String(track.index === chosen));
        });
        var find = button("Find subtitles…", function () {
          subtitleMenu.hidden = true;
          subtitlePicker.setAttribute("aria-expanded", "false");
          return findSubtitles(item, source, async function (updated) {
            item.MediaSources = [updated];
            await loadDetailSubtitles();
            subtitlePicker.focus();
          });
        }, subtitleMenu);
        find.setAttribute("role", "option");
        selectTrack(
          tracks.find(function (track) {
            return track.index === chosen;
          }),
          false,
        );
        subtitlePicker.disabled = false;
        subtitlePicker.onclick = function () {
          run(openDetailSubtitles);
        };
      } catch (_) {
        if (!subtitlePicker.isConnected) return;
        subtitlePicker.textContent = "Subtitles unavailable — retry";
        subtitlePicker.disabled = false;
        subtitlePicker.onclick = function () {
          run(loadDetailSubtitles);
        };
      }
    }
    loadDetailSubtitles();
    return { picker: subtitlePicker, options: detailSubtitleOptions };
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
    var showSeasons = [],
      seasonsError = null,
      seriesReady = null;
    if (item.Type === "Series") {
      try {
        showSeasons = await seasonChoices(item.Id);
      } catch (error) {
        seasonsError = error;
      }
      if (r !== revision) return;
      if (!seasonsError && showSeasons.length === 1)
        return listing(
          showSeasons[0].Id,
          item.Name + " · " + showSeasons[0].Name,
          false,
          { seriesId: item.Id, title: item.Name, seasons: showSeasons },
        );
    }
    reset(item.Name);
    main.className =
      "detail-page" + (item.Type === "Series" ? " series-detail" : item.Type === "Movie" ? " movie-detail" : "");
    if (item.Type === "Movie") {
      var heading = main.querySelector("h1"), movieLogoId = C.logoItem(item);
      heading.classList.add("detail-title");
      if (movieLogoId) {
        heading.textContent = "";
        var titleText = el("span", item.Name, heading), movieLogo = el("img", null, heading);
        titleText.className = "detail-title-text";
        movieLogo.className = "detail-title-logo";
        movieLogo.alt = "";
        movieLogo.hidden = true;
        movieLogo.onload = function () {
          if (heading.isConnected) { movieLogo.hidden = false; heading.classList.add("has-logo"); }
        };
        setImageSource(movieLogo, session.server + "/Items/" + encodeURIComponent(movieLogoId) + "/Images/Logo?maxWidth=720&quality=90");
      }
    }
    setBackdrop(item);
    var metadata = el("p", null, main);
    metadata.className = "metadata";
    itemMetadata(item, metadata);
    if (item.Genres && item.Genres.length)
      el("p", item.Genres.join(", "), main).className = "genres";
    var formatSection = item.Type === "Movie" ? el("div", null, main) : main;
    if (formatSection !== main) formatSection.className = "movie-specs";
    var formatHost = el("div", null, formatSection);
    formatPills(item, formatHost);
    if (item.Taglines && item.Taglines.length)
      el("p", item.Taglines[0], main).className = "tagline";
    el("p", item.Overview || "", main).className = "overview";
    var directors = (item.People || []).filter(function (person) { return person.Type === "Director"; });
    if (directors.length)
      el("p", "Directed by " + directors.map(function (person) { return person.Name; }).join(", "), main).className = "metadata directors";
    var actions = el("div", null, main);
    actions.className = "actions";
    if (item.IsLiveProgram) {
      button(
        Date.parse(item.StartDate) > Date.now() ||
          Date.parse(item.EndDate) <= Date.now()
          ? "Watch channel now"
          : "Watch live",
        function () {
          return play(item, 0, false, true);
        },
        actions,
      );
    } else if (item.Type === "Series") {
      var seriesPlay = button(
        "Play",
        function () {
          var card = main.querySelector(".series-continue .card");
          if (card && card.episodeItem)
            return play(
              card.episodeItem,
              (card.episodeItem.UserData &&
                card.episodeItem.UserData.PlaybackPositionTicks) ||
                0,
              true,
            );
        },
        actions,
      );
      seriesPlay.disabled = true;
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
      var subtitles = subtitleControl(item, item.Type === "Movie" ? formatSection : main, function (full) {
        if (formatHost.isConnected) formatPills(full, formatHost);
      });
      var subtitlePicker = subtitles.picker;
      var detailSubtitleOptions = subtitles.options;
      var ticks = (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
      var resumeButton = null;
      if (ticks)
        resumeButton = button(
          "Resume",
          function () {
            return play(item, ticks, true, false, detailSubtitleOptions());
          },
          actions,
        );
      var startButton = button(
        "Play from beginning",
        function () {
          return play(item, 0, false, false, detailSubtitleOptions());
        },
        actions,
      );
    }
    if (!item.IsFolder && !item.IsLiveProgram && item.MediaType === "Video") {
      var extraActions = el("div", null, main);
      extraActions.id = "detail-more-options";
      extraActions.className = "detail-more-options";
      extraActions.setAttribute("role", "dialog");
      extraActions.setAttribute("aria-label", "More options");
      extraActions.hidden = true;
      var movieWatched = button(
        item.UserData && item.UserData.Played
          ? "Mark as unwatched"
          : "Mark as watched",
        async function () {
          movieWatched.disabled = true;
          try {
            var remove = !!(item.UserData && item.UserData.Played);
            await setWatched(item, !remove);
            if (!movieWatched.isConnected) return;
            ticks = item.UserData.PlaybackPositionTicks || 0;
            if (resumeButton) {
              resumeButton.hidden = !ticks;
              if (!ticks) {
                resumeButton.classList.remove("primary-action");
                startButton.classList.add("primary-action");
                labelAction(startButton, "Play from beginning");
              }
            }
            itemMetadata(item, metadata);
            labelAction(
              movieWatched,
              !remove ? "Mark as unwatched" : "Mark as watched",
            );
          } finally {
            if (movieWatched.isConnected) movieWatched.disabled = false;
          }
        },
        actions,
      );
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
        extraActions,
      );
      button(
        "View playback queue",
        function () {
          return go(queuePage);
        },
        actions,
      );
    }
    if (item.Type === "Episode" && item.SeriesId) {
      button(
        "View seasons",
        function () {
          return go(function () {
            return seasonsPage(item.SeriesId, item.SeriesName || "Series");
          });
        },
        actions,
      );
    }
    var firstAction = actions.querySelector("button");
    if (firstAction) {
      firstAction.classList.add("primary-action");
      labelAction(
        firstAction,
        firstAction.getAttribute("aria-label") || firstAction.textContent,
      );
    }
    var favorite = button(
      null,
      async function () {
        if (favorite.disabled) return;
        favorite.disabled = true;
        try {
          var remove = !!(item.UserData && item.UserData.IsFavorite);
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
          updateFavorite();
        } finally {
          favorite.disabled = false;
        }
      },
      actions,
    );
    favorite.className = "favorite-heart";
    favorite.appendChild(navIcon("favorites"));
    function updateFavorite() {
      var saved = !!(item.UserData && item.UserData.IsFavorite),
        label = saved ? "Remove from favorites" : "Add to favorites";
      favorite.setAttribute("aria-label", label);
      favorite.setAttribute("title", label);
      favorite.setAttribute("aria-pressed", String(saved));
      labelAction(
        favorite,
        saved ? "Remove from favorites" : "Add to favorites",
      );
    }
    updateFavorite();
    if (extraActions) {
      var queueButton = actions.querySelector(
        '[aria-label="View playback queue"]',
      );
      if (queueButton) actions.insertBefore(favorite, queueButton);
      var moreButton = button(
        "More options",
        function () {
          extraActions.hidden = !extraActions.hidden;
          moreButton.setAttribute(
            "aria-expanded",
            String(!extraActions.hidden),
          );
          if (!extraActions.hidden)
            focusContent(extraActions.querySelector("button"));
        },
        actions,
      );
      moreButton.id = "detail-more-button";
      moreButton.setAttribute("aria-expanded", "false");
      button(
        "Close",
        function () {
          extraActions.hidden = true;
          moreButton.setAttribute("aria-expanded", "false");
          moreButton.focus();
        },
        extraActions,
      );

    } else button("Back", back, actions);
    if (item.Type === "Series") {
      seriesReady = seriesRows(item, showSeasons, seasonsError);
      seriesReady.then(function (target) {
        if (target && target.episodeItem && seriesPlay.isConnected) {
          seriesPlay.disabled = false;
          labelAction(
            seriesPlay,
            target.episodeItem.UserData &&
              target.episodeItem.UserData.PlaybackPositionTicks > 0
              ? "Resume"
              : "Play",
          );
        }
      });
    }
    renderPeople(item, main, item.Type === "Movie" ? "People" : "Cast");
    detailRelated(item);
    var seasonCard = main.querySelector(".season-grid .card");
    if (seasonCard) seasonCard.focus();
    else if (item.Type === "Movie" && firstAction) focusContent(firstAction);
    else focusFirst();
    main.scrollTop = 0;
    if (
      seriesReady &&
      !(stack[stack.length - 1] && stack[stack.length - 1].focus)
    )
      seriesReady.then(function (target) {
        if (
          target &&
          target.isConnected &&
          document.activeElement === seasonCard
        ) {
          target.focus();
          main.scrollTop = 0;
        }
      });
  }
  function renderPeople(item, parent, title, supplied) {
    var people =
      supplied ||
      (item.People || []).filter(function (person) {
        return person.Type === "Actor";
      });
    if (people.length) {
      var cast = el("section", null, parent);
      cast.className = "cast-section";
      el("h2", title, cast);
      var row = el("div", null, cast),
        renderedCast = 0;
      row.className = "cast-row";
      row.setAttribute("role", "list");
      row.setAttribute("aria-label", title);
      row.loadMoreCast = function () {
        var end = Math.min(renderedCast + 8, people.length);
        while (renderedCast < end) {
          var index = renderedCast++,
            person = people[index];
          var figure = el("figure", null, row);
          figure.tabIndex = 0;
          figure.setAttribute("role", "listitem");
          figure.setAttribute("aria-setsize", String(people.length));
          figure.setAttribute("aria-posinset", String(index + 1));
          figure.setAttribute(
            "aria-label",
            person.Name + (person.Role ? " as " + person.Role : ""),
          );
          if (person.PrimaryImageTag) {
            var img = el("img", null, figure);
            img.dataset.src =
              session.server +
              "/Items/" +
              encodeURIComponent(person.Id) +
              "/Images/Primary?maxWidth=250&quality=80&tag=" +
              encodeURIComponent(person.PrimaryImageTag);
            img.alt = "";
            observePoster(img);
          } else {
            var placeholder = el("div", (person.Name || "?").charAt(0), figure);
            placeholder.className = "cast-placeholder";
            placeholder.setAttribute("aria-hidden", "true");
          }
          el("figcaption", person.Name, figure);
          if (person.Role) el("p", person.Role, figure);
        }
      };
      row.loadMoreCast();
      row.addEventListener("scroll", function () {
        if (row.scrollWidth - row.clientWidth - row.scrollLeft < 480)
          row.loadMoreCast();
      });
      row.addEventListener("focusin", function (event) {
        var figure = event.target.closest("figure");
        if (!figure) return;
        if (Number(figure.getAttribute("aria-posinset")) >= renderedCast - 2)
          row.loadMoreCast();
        loadPoster(figure.querySelector("img[data-src]"));
        figure.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      row.addEventListener(
        "wheel",
        function (event) {
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
          var target = Math.max(
            0,
            Math.min(
              row.scrollWidth - row.clientWidth,
              row.scrollLeft + event.deltaY,
            ),
          );
          if (target !== row.scrollLeft) {
            event.preventDefault();
            row.scrollLeft = target;
          }
        },
        { passive: false },
      );
    }
  }
  function detailRelated(item) {
    if (
      item.IsLiveProgram ||
      item.Type === "TvChannel" ||
      item.Type === "BoxSet" ||
      (item.Type !== "Movie" &&
        item.Type !== "Series" &&
        item.Type !== "Episode" &&
        item.MediaType !== "Video")
    )
      return;
    var seed =
        item.Type === "Episode" && item.SeriesId ? item.SeriesId : item.Id,
      host = el("div", null, main),
      collectionHost = el("div", null, host),
      similarHost = el("div", null, host),
      controller = detailController || new AbortController(),
      frame = stack[stack.length - 1],
      restore = frame && frame.related,
      pendingFocus = null;
    host.className = "detail-related";
    detailController = controller;
    function valid() {
      return !controller.signal.aborted && host.isConnected;
    }
    function request(path, values) {
      return api(path, values, null, "GET", { signal: controller.signal });
    }
    function notify(section, rail, state) {
      if (!valid()) return;
      if (restore && restore.key === section.dataset.rowKey) {
        var target = Array.prototype.find.call(
          rail.querySelectorAll("button"),
          function (node) {
            return node.dataset.item === frame.focus;
          },
        );
        if (target) {
          restore = null;
          focusContent(target);
        } else if (!state.error && !state.done && state.count <= restore.index)
          section.loadPage();
      } else if (pendingFocus && document.activeElement === pendingFocus) {
        var first = host.querySelector(".rail button, p button");
        if (first) {
          pendingFocus = null;
          focusContent(first);
        }
      }
    }
    function row(parent, title, key, path, query) {
      var section = el("section", null, parent),
        heading = el("div", null, section);
      section.className = "detail-media-row";
      section.dataset.rowKey = key;
      heading.className = "detail-row-heading";
      el("h2", title, heading);
      var rail = el("div", null, section),
        status = el("p", "", section),
        state = { loading: false, done: false, offset: 0, count: 0 },
        ids = new Set();
      rail.className = "rail portrait";
      rail.setAttribute("aria-label", title);
      section.loadPage = async function () {
        if (state.loading || state.done || !valid()) return;
        state.loading = true;
        state.error = false;
        status.textContent = "Loading…";
        try {
          var data = await request(
            path,
            Object.assign({}, query, { StartIndex: state.offset, Limit: 24 }),
          );
          if (!valid()) return;
          var batch = data.Items || [],
            fresh = batch.filter(function (entry) {
              if (!entry.Id || entry.Id === item.Id || ids.has(entry.Id))
                return false;
              ids.add(entry.Id);
              return true;
            });
          state.offset += batch.length;
          state.done =
            !batch.length ||
            (Number.isFinite(data.TotalRecordCount)
              ? state.offset >= data.TotalRecordCount
              : batch.length < 24) ||
            (!fresh.length && batch.length > 0 && state.count > 0);
          state.done = true;
          cards(fresh, section, "portrait", rail);
          state.count += fresh.length;
          section.hidden = state.done && !state.count;
          status.textContent = "";
        } catch (error) {
          if (!valid()) return;
          state.error = true;
          status.textContent = "Could not load this row. ";
          button("Retry " + title, section.loadPage, status);
        } finally {
          state.loading = false;
          if (valid()) {
            notify(section, rail, state);
            if (!state.done && !state.count && !status.textContent)
              section.loadPage();
          }
        }
      };
      rail.addEventListener("focusin", function (event) {
        if (
          Array.prototype.indexOf.call(rail.children, event.target) >=
          rail.children.length - 3
        )
          section.loadPage();
      });
      rail.addEventListener("scroll", function () {
        if (rail.scrollWidth - rail.clientWidth - rail.scrollLeft < 480)
          section.loadPage();
      });
      if (detailRowObserver) detailRowObserver.observe(section);
      else section.loadPage();
      if (restore && restore.key === key) section.loadPage();
      return section;
    }
    if (window.IntersectionObserver) {
      detailRowObserver = new IntersectionObserver(
        function (entries) {
          if (!valid() || !detailRowObserver) return;
          entries.forEach(function (entry) {
            if (entry.intersectionRatio > 0) {
              detailRowObserver.unobserve(entry.target);
              entry.target.loadPage();
            }
          });
        },
        { root: main, rootMargin: "400px 240px" },
      );
    }
    var membershipLoading = false,
      membershipLoaded = false;
    async function collections() {
      if (membershipLoading || membershipLoaded || !valid()) return;
      membershipLoading = true;
      collectionHost.textContent = "";
      try {
        var data = await request(
          "/Items/" + encodeURIComponent(seed) + "/Collections",
          { UserId: session.user, Fields: "PrimaryImageAspectRatio" },
        );
        if (!valid()) return;
        membershipLoaded = true;
        var seen = new Set();
        var members = (data.Items || []).filter(function (collection) {
          if (!collection.Id || seen.has(collection.Id)) return false;
          seen.add(collection.Id);
          return true;
        });
        if (members.length) {
          var section = el("section", null, collectionHost);
          section.className = "detail-media-row";
          section.dataset.rowKey = "collections:" + seed;
          var heading = el("div", null, section);
          heading.className = "detail-row-heading";
          el("h2", "Collections", heading);
          var position = el("span", "1 of " + members.length, heading);
          position.className = "metadata";
          section.loadPage = function () {};
          cards(members, section, "portrait", null, function (collection) {
            return go(function () {
              return listing(collection.Id, collection.Name);
            });
          });
          var rail = section.querySelector(".rail");
          rail.addEventListener("focusin", function (event) {
            var card = event.target.closest(".card");
            if (!card) return;
            position.textContent =
              Array.prototype.indexOf.call(rail.children, card) +
              1 +
              " of " +
              members.length;
            var bounds = rail.getBoundingClientRect(),
              rect = card.getBoundingClientRect();
            if (rect.left < bounds.left + 16)
              rail.scrollLeft -= bounds.left + 16 - rect.left;
            else if (rect.right > bounds.right - 16)
              rail.scrollLeft += rect.right - bounds.right + 16;
          });
          rail.addEventListener(
            "wheel",
            function (event) {
              if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
              var target = Math.max(
                0,
                Math.min(
                  rail.scrollWidth - rail.clientWidth,
                  rail.scrollLeft + event.deltaY,
                ),
              );
              if (target !== rail.scrollLeft) {
                event.preventDefault();
                rail.scrollLeft = target;
              }
            },
            { passive: false },
          );
          notify(section, rail, {
            done: true,
            count: members.length,
          });
        }
      } catch (error) {
        if (!valid() || error.status === 404) return;
        var retryMessage = el(
          "p",
          "Could not check collection membership. ",
          collectionHost,
        );
        button("Retry collections", collections, retryMessage);
      } finally {
        membershipLoading = false;
      }
    }
    collections();
    row(
      similarHost,
      "More like this",
      "similar:" + seed,
      "/Items/" + encodeURIComponent(seed) + "/Similar",
      { UserId: session.user, Fields: "Overview,PrimaryImageAspectRatio" },
    );
    host.requestFocus = function () {
      var first = host.querySelector(".rail button, p button");
      if (first) focusContent(first);
      else {
        pendingFocus = document.activeElement;
        Array.prototype.forEach.call(
          host.querySelectorAll(".detail-media-row"),
          function (section) {
            section.loadPage();
          },
        );
        host.scrollIntoView({ block: "nearest" });
      }
    };
  }
  var animeAncestry = new Map();
  async function defaultAudio(item, source, signal) {
    var remembered = readPreference("track-preferences", {}).Audio,
      language = readPreference("audio-defaults", {}).animeLanguage;
    if (!language) return C.preferredTrack(source || {}, "Audio", remembered);
    var anime = C.animeItem(item, libraryItems, []),
      key = accountKey("anime-ancestry:") + (item.SeriesId || item.Id);
    if (!anime) {
      var ancestors = animeAncestry.get(key);
      if (!ancestors) {
        try {
          ancestors = await api("/Items/" + encodeURIComponent(item.SeriesId || item.Id) + "/Ancestors", {UserId: session.user}, null, "GET", {signal: signal, timeoutMs: 4000});
          if (!Array.isArray(ancestors)) ancestors = [];
          animeAncestry.set(key, ancestors);
          if (animeAncestry.size > 200) animeAncestry.delete(animeAncestry.keys().next().value);
        } catch (error) {
          if (signal && signal.aborted) throw error;
          return C.preferredTrack(source || {}, "Audio", remembered);
        }
      }
      anime = C.animeItem(item, libraryItems, ancestors);
    }
    return anime ? C.animeAudio(source || {}, language, remembered) : C.preferredTrack(source || {}, "Audio", remembered);
  }
  function subtitleDefaults() {
    return Object.assign({mode: "remember", language: "eng", foreignEnglish: true}, readPreference("subtitle-defaults", {}));
  }
  function subtitleDefaultsSettings() {
    reset("Subtitle defaults");
    el("p", languageSyncText(), main).className = "language-sync-status";
    el("p", "A manual choice for a title takes priority.", main);
    var options = subtitleDefaults(), list = el("div", null, main);
    list.className = "screensaver-settings";
    function choice(key, label, choices) {
      var control = button("", function () {
        settingChoices(label, choices, options[key], function (value) {
          options[key] = value;
          saveLanguagePreference("subtitle-defaults", options);
          refresh();
        }, control);
      }, list);
      function refresh() { var current = choices.find(function (v) { return v[0] === options[key]; }) || choices[0]; control.textContent = label + ": " + current[1]; }
      refresh();
    }
    choice("mode", "Default subtitles", [["remember", "Remember last choice"], ["language", "Preferred language when available"], ["off", "Off"]]);
    choice("language", "Preferred language", [["eng", "English"], ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["ita", "Italian"], ["por", "Portuguese"], ["jpn", "Japanese"], ["kor", "Korean"], ["zho", "Chinese"], ["hin", "Hindi"]]);
    choice("foreignEnglish", "English for non-English audio", [[true, "On"], [false, "Off"]]);
    el("p", "When enabled, English subtitles are selected for known non-English audio if a matching track is available. Missing or unknown audio languages do not trigger this rule.", main);
    focusContent(list.querySelector("button"));
  }
  async function loadSubtitleCues(item, source, index, signal) {
    var account = profileAccount();
    for (var attempt = 0; attempt < 2; attempt++) {
      if ((signal && signal.aborted) || !session || session.server !== account.server || session.user !== account.user)
        throw new DOMException("Subtitle loading cancelled.", "AbortError");
      try {
        var text = await api("/Videos/" + encodeURIComponent(item.Id) + "/" + encodeURIComponent(source.Id) + "/Subtitles/" + index + "/Stream.vtt",
          {StartPositionTicks: 0, CopyTimestamps: true, AddVttTimeMap: false}, null, "GET",
          {session: account, signal: signal, subtitleText: true, timeoutMs: attempt ? 10000 : 20000});
        var cues = C.parseSubtitles(text);
        if (!cues.length) throw new Error("No subtitle cues were returned.");
        return cues;
      } catch (error) {
        if (attempt || (signal && signal.aborted) || error.code === "SUBTITLE_TOO_LARGE" ||
            (error.status && error.status !== 408 && error.status < 500)) throw error;
        // Jellyfin may still be extracting an embedded track after a failed first response.
        await new Promise(function (resolve, reject) {
          function cancel() {
            clearTimeout(timer);
            if (signal) signal.removeEventListener("abort", cancel);
            reject(new DOMException("Subtitle loading cancelled.", "AbortError"));
          }
          var timer = setTimeout(function () {
            if (signal) signal.removeEventListener("abort", cancel);
            resolve();
          }, 300);
          if (signal) {
            if (signal.aborted) cancel();
            else signal.addEventListener("abort", cancel);
          }
        });
      }
    }
  }
  function subtitleOptions() {
    var style = C.subtitleStyle(readPreference("subtitle-appearance", { enabled: !P.nativeSubtitle }));
    // Legacy appearance delays are global and must never carry into another video.
    style.delay = 0;
    return style;
  }
  function subtitleDelay(item, source, index) {
    var key = C.subtitleTimingKey(item, source, index), saved = readPreference("subtitle-timing", {})[key];
    return saved ? C.subtitleStyle({ delay: saved.delay }).delay : 0;
  }
  function saveSubtitleDelay(active) {
    var key = C.subtitleTimingKey(active.item, active.source, active.subtitleIndex);
    if (!key) return;
    var saved = readPreference("subtitle-timing", {});
    saved[key] = { delay: active.subtitleStyle.delay, updated: Date.now() };
    Object.keys(saved).sort(function (a, b) { return saved[b].updated - saved[a].updated; }).slice(100).forEach(function (old) { delete saved[old]; });
    localStorage.setItem(accountKey("subtitle-timing"), JSON.stringify(saved));
  }
  var subtitleOverlay = el("div", null, player);
  subtitleOverlay.id = "subtitle-overlay";
  subtitleOverlay.hidden = true;
  subtitleOverlay.setAttribute("aria-hidden", "true");
  var subtitleTextNode = el("span", "", subtitleOverlay);
  function applySubtitleStyle(node, style) {
    var text = node.querySelector("span");
    text.style.fontSize = style.size / 19.2 + "vw";
    text.style.color = { white: "#ffffff", yellow: "#ffff66", cyan: "#80ffff" }[
      style.color
    ];
    text.style.backgroundColor = {
      none: "transparent",
      half: "rgba(0,0,0,0.65)",
      solid: "#000000",
    }[style.background];
    node.style.top = style.position === "top" ? "8%" : "auto";
    node.style.bottom =
      style.position === "top"
        ? "auto"
        : style.position === "raised"
          ? "22%"
          : "7%";
  }
  function renderSubtitleOverlay() {
    var active = playing;
    if (!active || !active.subtitleCues || document.hidden) {
      subtitleOverlay.hidden = true;
      return;
    }
    if (active.subtitleStyle.position !== "top") {
      var controls = document.getElementById("controls");
      var base =
        innerHeight *
        (active.subtitleStyle.position === "raised" ? 0.22 : 0.07);
      var bottom =
        Math.max(
          base,
          controls.style.opacity !== "0" ? controls.offsetHeight + 20 : 0,
        ) + "px";
      if (subtitleOverlay.style.bottom !== bottom)
        subtitleOverlay.style.bottom = bottom;
    }
    var text = C.subtitleText(
      active.subtitleCues,
      video.currentTime,
      active.subtitleStyle.delay,
    );
    if (subtitleTextNode.textContent !== text)
      subtitleTextNode.textContent = text;
    subtitleOverlay.hidden = !text;
  }
  function renderSubtitleAppearance(container, inPlayer) {
    var draft = subtitleOptions();
    var editor = el("div", null, container);
    editor.className = "subtitle-editor";
    var preview = el("div", null, editor);
    preview.className = "subtitle-preview";
    preview.setAttribute("aria-label", "Subtitle preview");
    var sample = el("div", null, preview);
    sample.className = "subtitle-sample";
    el("span", "This is how your subtitles will look.", sample);
    var hint = el("p", "Preview your changes, then choose Save appearance. Saved for this profile on this TV.", editor);
    hint.className = "subtitle-editor-hint";
    var fields = el("div", null, editor);
    fields.className = "subtitle-editor-fields";
    var choices = el("div", null, editor);
    choices.className = "subtitle-editor-choices";
    choices.hidden = true;
    var settings = [
      ["enabled", "Subtitle style", [false, true], ["Original", "Custom"]],
      ["size", "Text size", [32, 40, 48, 56, 64], ["Small", "Medium", "Large", "Extra large", "Largest"]],
      ["color", "Text color", ["white", "yellow", "cyan"], ["White", "Yellow", "Cyan"]],
      ["background", "Background", ["none", "half", "solid"], ["None", "Translucent black", "Solid black"]],
      ["position", "Position", ["bottom", "raised", "top"], ["Bottom", "Raised", "Top"]],
    ];
    var controls = [], opened = null;
    function value(setting) { return setting[3][setting[2].indexOf(draft[setting[0]])]; }
    function refresh() {
      applySubtitleStyle(sample, draft);
      controls.forEach(function (control, i) {
        var setting = settings[i];
        control.textContent = "";
        el("span", setting[1], control);
        el("span", value(setting), control).className = "subtitle-editor-value";
        control.setAttribute("aria-label", setting[1] + ": " + value(setting));
      });
    }
    function closeChoices() {
      if (!opened) return;
      var opener = opened;
      opened = null;
      choices.hidden = true;
      fields.hidden = false;
      opener.setAttribute("aria-expanded", "false");
      opener.focus();
    }
    settings.forEach(function (setting) {
      var control = button("", function () {
        opened = control;
        fields.hidden = true;
        choices.hidden = false;
        choices.textContent = "";
        control.setAttribute("aria-expanded", "true");
        el("h3", setting[1], choices);
        var list = el("div", null, choices);
        list.setAttribute("role", "radiogroup");
        list.setAttribute("aria-label", setting[1]);
        var options = setting[2].map(function (choice, index) {
          var option = button(setting[3][index], function () {
            draft[setting[0]] = choice;
            if (setting[0] !== "enabled") draft.enabled = true;
            refresh();
            closeChoices();
          }, list);
          option.setAttribute("role", "radio");
          option.setAttribute("aria-checked", String(draft[setting[0]] === choice));
          return option;
        });
        options[Math.max(0, setting[2].indexOf(draft[setting[0]]))].focus();
      }, fields);
      control.className = "subtitle-editor-row";
      control.setAttribute("aria-expanded", "false");
      controls.push(control);
    });
    editor.addEventListener("keydown", function (event) {
      var key = event.keyCode;
      if (opened && (key === 27 || key === 461 || key === 10009)) {
        event.preventDefault();
        event.stopPropagation();
        closeChoices();
      }
    });
    var note = el("p", "SRT and WebVTT support custom appearance. ASS/SSA can be converted to plain text on this TV; original styling is not preserved. Adjust timing from player Options.", editor);
    note.className = "subtitle-editor-note";
    var actions = el("div", null, editor);
    actions.className = "subtitle-editor-actions";
    button("Reset appearance", function () {
      draft = C.subtitleStyle({ enabled: !P.nativeSubtitle });
      closeChoices();
      refresh();
    }, actions);
    button("Cancel", function () {
      if (inPlayer) closePlaybackPanel();
      else return back();
    }, actions);
    var saveAppearance = button(
      "Save appearance",
      async function () {
        draft = C.subtitleStyle(draft);
        var active = inPlayer && playing;
        if (active && (busy || !active.started)) {
          message("Wait for playback to start before applying subtitles.");
          return;
        }
        localStorage.setItem(
          accountKey("subtitle-appearance"),
          JSON.stringify(draft),
        );
        if (!active) {
          await back();
          message("Subtitle appearance saved.");
          return;
        }
        if (active.subtitleCues && draft.enabled) {
          draft.delay = subtitleDelay(active.item, active.source, active.subtitleIndex);
          active.subtitleStyle = draft;
          applySubtitleStyle(subtitleOverlay, draft);
          renderSubtitleOverlay();
          closePlaybackPanel();
          return;
        }
        if (
          !(active.subtitleIndex >= 0) ||
          !C.textSubtitle(active.source, active.subtitleIndex)
        ) {
          closePlaybackPanel();
          message(
            "Saved. Appearance applies to SRT/WebVTT text tracks; current subtitles are Off or use server rendering.",
          );
          return;
        }
        if (!draft.enabled && !active.subtitleCues) {
          closePlaybackPanel();
          return;
        }
        var ticks = position(),
          paused = video.paused;
        video.pause();
        try {
          await play(active.item, ticks, false, false, {
            trackChange: true,
            paused: paused,
            mediaSourceId: active.source.Id,
            audioIndex: active.audioIndex,
            subtitleIndex: active.subtitleIndex,
          });
        } catch (error) {
          if (playing === active && !paused && !document.hidden)
            await video.play();
          message(
            "Appearance saved for future playback; current subtitles unchanged. " +
              error.message,
          );
        }
      },
      actions,
    );
    saveAppearance.className = "subtitle-editor-save";
    refresh();
  }
  function decoderOptions() {
    return readPreference("decoder-options", {
      native: !!P.playbackPolicy,
      dolbyVision: false,
    });
  }
  function saveSubtitleChoice(itemId, source, index) {
    var choices = readPreference("subtitle-choices", {});
    choices[itemId] = { source: source.Id, index: index, updated: Date.now() };
    Object.keys(choices)
      .sort(function (a, b) {
        return choices[b].updated - choices[a].updated;
      })
      .slice(100)
      .forEach(function (key) {
        delete choices[key];
      });
    try {
      localStorage.setItem(
        accountKey("subtitle-choices"),
        JSON.stringify(choices),
      );
      rememberTrack("Subtitle", C.trackPreference(source, "Subtitle", index));
    } catch (_) {}
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
    document.getElementById("subtitle-timing").disabled = !active || active.live;
    document.getElementById("subtitle-appearance").disabled = !active || active.live;
    document.getElementById("chapters").disabled =
      !active || active.live || !C.chapters(active.item).length;
    document.getElementById("previous-video").hidden = !!(active && active.live);
    document.getElementById("previous-video").disabled = !active || active.live || !playbackHistory.length;
    document.getElementById("next-video").hidden = !!(active && active.live);
    document.getElementById("next-video").disabled =
      !active || active.live || (!queueItems.length && !active.episodes.length && !active.nextError);
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
        if ((data.Items || []).length && !(data.Items || []).some(function (item) { return item.Id === active.item.Id; }))
          throw new Error("The server did not include the current episode.");
        active.episodes = C.followingEpisodes(active.item, data.Items || []);
        updatePlaybackButtons();
      })
      .catch(function (error) {
        if (playing === active) { active.nextError = error.message; updatePlaybackButtons(); }
      });
    return active.following;
  }
  function loadPlaybackExtras(active) {
    if (active.live) return;
    if (!Array.isArray(active.item.Chapters) || !active.source.MediaStreams || (active.item.Type === "Episode" && !active.item.SeriesId)) {
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
          if (active.item.Type === "Episode" && active.item.SeriesId && !active.following) loadFollowing(active);
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
  function renderSubtitleTiming(container, active) {
    el("h3", "Subtitle timing", container);
    var local = !!active.subtitleCues;
    el("p", local ? "Move text earlier if it appears after the dialogue, or later if it appears too soon. Changes apply immediately."
      : "Timing adjustment needs a locally rendered SRT or WebVTT track. Select a text track and use Styled on TV in Appearance.", container);
    var value = el("p", "", container);
    value.className = "subtitle-timing-value";
    value.setAttribute("aria-live", "polite");
    var controls = el("div", null, container);
    controls.className = "subtitle-timing-controls";
    function refresh() {
      var delay = Number(active.subtitleStyle.delay) || 0;
      value.textContent = !delay ? "On time · 0.0 s" : Math.abs(delay).toFixed(1) + " s " + (delay < 0 ? "earlier" : "later");
    }
    function adjust(delta) {
      if (playing !== active || !local) return;
      active.subtitleStyle.delay = delta == null ? 0 : Math.max(-10, Math.min(10, (Number(active.subtitleStyle.delay) || 0) + delta));
      saveSubtitleDelay(active);
      renderSubtitleOverlay();
      refresh();
    }
    [["Earlier 0.5 s", -0.5], ["Later 0.5 s", 0.5], ["Reset timing", null]].forEach(function (entry) {
      button(entry[0], function () { adjust(entry[1]); }, controls).disabled = !local;
    });
    if (local) el("p", "Remembered only for this video's selected subtitle track.", container);
    refresh();
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
    closePlayerTools();
    var active = playing;
    if (!active || (active.live && kind !== "queue" && kind !== "info")) return;
    var panel = document.getElementById("playback-panel"),
      token = ++panelRequest;
    if (panel.hidden || !panel.contains(document.activeElement)) panelReturnFocus = document.activeElement;
    panel.hidden = false;
    panel.style.bottom =
      Math.max(230, document.getElementById("controls").offsetHeight + 16) +
      "px";
    panel.textContent = "";
    panel.dataset.kind = kind;
    var subtitleSection = ["subtitles", "timing", "appearance"].indexOf(kind) >= 0;
    var title = {
      audio: "Audio tracks",
      subtitles: "Subtitles",
      chapters: "Chapters",
      queue: "Playback queue",
      info: "Playback information",
      appearance: "Subtitle appearance",
      timing: "Subtitle timing",
    }[kind];
    panel.classList.toggle("subtitle-picker", kind === "subtitles");
    panel.classList.toggle("compact-menu", kind === "audio" || kind === "chapters");
    panel.classList.toggle("subtitle-appearance-panel", kind === "appearance");
    panel.setAttribute("aria-label", title);
    el("h2", title, panel);
    var close = button("Close", closePlaybackPanel, panel);
    close.className = "menu-close";
    if (subtitleSection) close.classList.add("subtitle-panel-close");
    close.focus();
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
    } else if (kind === "appearance") renderSubtitleAppearance(content, true);
    else if (kind === "timing") renderSubtitleTiming(content, active);
    else if (kind === "queue") renderQueue(content, true);
    else if (kind === "chapters") {
      var chapters = C.chapters(active.item);
      if (!chapters.length) el("p", "No chapters available.", content);
      var chapterIndex = 0;
      chapters.forEach(function (chapter, index) {
        if (chapter.StartPositionTicks / 10000000 <= video.currentTime) chapterIndex = index;
      });
      chapters.forEach(function (chapter, index) {
        var chapterButton = button(
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
        chapterButton.setAttribute("aria-pressed", String(index === chapterIndex));
      });
      var currentChapter = content.querySelector('[aria-pressed="true"]');
      if (currentChapter) focusContent(currentChapter);
    } else {
      var subtitle = kind === "subtitles",
        current = subtitle ? active.subtitleIndex : active.audioIndex;
      var trackHost = subtitle ? el("div", null, content) : content;
      if (subtitle) trackHost.className = "subtitle-picker-tracks";
      function option(index, label, detail) {
        var entry = button(
          label,
          function () {
            return switchTrack(subtitle, index);
          },
          trackHost,
        );
        entry.setAttribute("aria-label", label);
        entry.setAttribute("aria-pressed", String(index === current));
        if (detail) {
          entry.className = "subtitle-track-option";
          el("span", detail, entry).className = "subtitle-track-detail";
        }
      }
      if (subtitle) {
        var findButton = button("Find subtitles…", function () {
          return findSubtitles(active.item, active.source, async function (updated, track) {
            if (playing !== active) return;
            // Jellyfin can insert external tracks before the audio tracks.
            var oldAudio = (active.source.MediaStreams || []).filter(function (stream) { return stream.Type === "Audio"; }),
              ordinal = oldAudio.findIndex(function (stream) { return stream.Index === active.audioIndex; }),
              newAudio = (updated.MediaStreams || []).filter(function (stream) { return stream.Type === "Audio"; });
            var oldSubtitle = (active.source.MediaStreams || []).find(function (stream) { return stream.Type === "Subtitle" && stream.Index === active.subtitleIndex; }),
              mappedSubtitle = oldSubtitle && (updated.MediaStreams || []).find(function (stream) {
                return stream.Type === "Subtitle" && (oldSubtitle.Path && stream.Path ? oldSubtitle.Path === stream.Path :
                  stream.Codec === oldSubtitle.Codec && stream.Language === oldSubtitle.Language && stream.DisplayTitle === oldSubtitle.DisplayTitle && !!stream.IsExternal === !!oldSubtitle.IsExternal);
              });
            active.source = updated;
            active.item = Object.assign({}, active.item, { MediaSources: [updated] });
            active.subtitleIndex = mappedSubtitle ? mappedSubtitle.Index : -1;
            if (ordinal >= 0 && newAudio[ordinal]) active.audioIndex = newAudio[ordinal].Index;
            if (active.nativeMode) {
              // Newly downloaded sidecars are not attached to the native media item yet.
              // Reload in place; external stream indices may also have shifted.
              await play(active.item, position(), false, false, {
                trackChange: true, paused: video.paused, mediaSourceId: updated.Id,
                audioIndex: active.audioIndex, subtitleIndex: track.Index,
                pendingPreference: { type: "Subtitle", value: C.trackPreference(updated, "Subtitle", track.Index) },
              });
            } else await switchTrack(true, track.Index);
            if (!playing || playing.item.Id !== active.item.Id || playing.subtitleIndex !== track.Index)
              throw new Error("Choose the downloaded track from Subtitles to retry.");
          });
        }, content);
        option(-1, "Off");
      }
      function localSubtitle(index) {
        return !!((C.textSubtitle(active.source, index) && subtitleOptions().enabled) ||
          (active.nativeMode && active.method === "DirectPlay" && P.nativeSubtitle && P.nativeSubtitle(active.source, index)));
      }
      var tracks = subtitle ? C.subtitleTracks(active.source) : C.tracks(active.source, "Audio");
      if (subtitle) tracks.sort(function (a, b) { return Number(localSubtitle(b.index)) - Number(localSubtitle(a.index)) || a.index - b.index; });
      tracks.forEach(function (track) {
        option(track.index, track.label, subtitle ? [track.external ? "External" : "Embedded", localSubtitle(track.index) ? "No burn-in" : "Requires video conversion"].join(" · ") : null);
      });
      if (subtitle && findButton) content.appendChild(findButton);
      if (!subtitle) el("p", "Language choices are remembered for this account on this TV.", content);
      {
        var currentOption = content.querySelector('[aria-pressed="true"]');
        if (currentOption) focusContent(currentOption);
      }
    }
    if (kind === "queue" || kind === "info") {
      var entry = content.querySelector(".queue-entry button, .playback-info-row, button:not(:disabled)");
      if (entry) focusContent(entry);
    }
    if (kind === "timing" || kind === "appearance") {
      var first = content.querySelector("button:not(:disabled)");
      if (first) focusContent(first);
    }
  }
  async function switchTrack(subtitle, index) {
    var active = playing;
    if (!active || active.live || busy || !active.started) return;
    var type = subtitle ? "Subtitle" : "Audio";
    var preference = C.trackPreference(active.source, type, index);
    if ((subtitle ? active.subtitleIndex : active.audioIndex) === index &&
        !(subtitle && index >= 0 && !active.subtitleCues && subtitleOptions().enabled && C.textSubtitle(active.source, index))) {
      rememberTrack(type, preference);
      if (subtitle) saveSubtitleChoice(active.item.Id, active.source, index);
      closePlaybackPanel();
      return;
    }
    var nativeSwitch = subtitle && active.nativeMode && active.method === "DirectPlay" && video.selectTracks && P.nativeSubtitle(active.source, index),
      overlaySwitch = subtitle && (active.subtitleCues || active.subtitleIndex < 0) &&
        (index < 0 || (subtitleOptions().enabled && C.textSubtitle(active.source, index)));
    if (nativeSwitch || overlaySwitch) {
      busy = true;
      try {
        var style = subtitleOptions(), cues = null;
        style.delay = subtitleDelay(active.item, active.source, index);
        if (style.enabled && C.textSubtitle(active.source, index)) {
          cues = await loadSubtitleCues(active.item, active.source, index, active.extrasController.signal);
        }
        if (playing !== active) return;
        if (nativeSwitch) {
          var selection = P.playbackTracks(active, active.source, active.audioIndex, index, cues, true,
            { server: session.server, itemId: active.item.Id, token: session.token });
          await video.selectTracks(selection);
        }
        if (playing !== active) return;
        active.subtitleIndex = index;
        active.subtitleCues = cues;
        active.subtitleStyle = style;
        rememberTrack(type, preference);
        saveSubtitleChoice(active.item.Id, active.source, index);
        applySubtitleStyle(subtitleOverlay, style);
        renderSubtitleOverlay();
        closePlaybackPanel();
        showControls();
        run(function () { return report("/Progress"); });
        return;
      } catch (error) {
        if (playing !== active) return;
        message("Could not change subtitles in place. " + error.message);
      } finally { busy = false; drainPendingAdvance(); }
    }
    var nextSubtitle = active.subtitleIndex;
    if (!subtitle && nextSubtitle < 0) {
      var manualSubtitle = readPreference("subtitle-choices", {})[active.item.Id];
      if (!(manualSubtitle && manualSubtitle.source === active.source.Id && manualSubtitle.index === -1)) {
        var automatic = C.defaultSubtitle(active.source, index, {mode: "off", foreignEnglish: subtitleDefaults().foreignEnglish});
        if (automatic >= 0) nextSubtitle = automatic;
      }
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
        subtitleIndex: subtitle ? index : nextSubtitle,
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
      upNext.dataset.nextItem !== next.Id ||
      upNext.dataset.watching !== String(watching)
    ) {
      upNextFocus = document.activeElement;
      upNext.textContent = "";
      upNext.dataset.nextItem = next.Id;
      upNext.dataset.watching = String(watching);
      var artwork = image(next, true);
      if (artwork) {
        var img = el("img", null, upNext);
        setImageSource(img, artwork);
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
    upNext.style.bottom =
      Math.max(260, document.getElementById("controls").offsetHeight + 24) +
      "px";
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
    if (!active || active.live) return;
    if (active.advancing) { if (!manual && active.completed) active.pendingAdvance = true; return; }
    if (busy) { if (!manual && active.completed) active.pendingAdvance = true; return; }
    active.pendingAdvance = false;
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
      if (!queueItems.length && (manual || playbackOptions().autoplay)) {
        await active.following;
        if (playing === active && active.nextError && active.item.SeriesId) await loadFollowing(active);
        if (playing === active && active.nextError) {
          message("Could not load the next episode. Press Next video to retry.");
          showControls(); return;
        }
      }
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
      await play(next, 0, false, false, { episodeCount: active.episodeCount, preserveHistory: true });
      if (!playing || playing === active) return;
      playbackHistory.push(active.item);
      if (playbackHistory.length > 100) playbackHistory.shift();
      updatePlaybackButtons();
    } catch (error) {
      message("Could not play the next video. " + error.message);
      showControls();
    } finally {
      active.advancing = false;
      drainPendingAdvance();
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
    var paused = P.playbackPolicy && !active.hasPlayed ? active.pauseOnReady : video.paused;
    video.pause();
    try {
      await play(active.item, ticks, false, false, {
        compatibility: true,
        trackChange: true,
        paused: P.playbackPolicy ? paused : automatic ? false : paused,
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
  ["timing", "appearance"].forEach(function (kind) {
    document.getElementById("subtitle-" + kind).onclick = function () {
      run(function () { return openPlaybackPanel(kind); });
    };
  });
  document.getElementById("previous-video").onclick = function () {
    run(async function () {
      if (!playing || playing.live || !playbackHistory.length) return;
      var previous = playbackHistory[playbackHistory.length - 1], current = playing.item;
      await play(previous, 0, false, false, { preserveHistory: true });
      playbackHistory.pop();
      queueItems.unshift(current);
      updatePlaybackButtons();
    });
  };
  document.getElementById("next-video").onclick = function () {
    run(function () {
      return advancePlayback(true);
    });
  };

  function position() {
    if (!playing) return 0;
    if (playing.completedPositionTicks != null) return playing.completedPositionTicks;
    if (playing.failurePositionTicks != null)
      return playing.failurePositionTicks;
    if (!playing.started) return playing.resumeTicks;
    return Math.round(video.currentTime * 10000000);
  }
  function report(path, extra) {
    var active = playing;
    if (!active || !active.started || active.completed || active.finishReporting) return Promise.resolve();
    if (path === "/Progress" && active.progressPending) return active.reporting;
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
        return api("/Sessions/Playing" + path, null, payload, "POST", {session: active.account, timeoutMs: 5000});
      });
    if (path === "/Progress") {
      active.progressPending = true;
      active.reporting = active.reporting.finally(function () { active.progressPending = false; });
    }
    return active.reporting;
  }
  async function finishPlaybackReporting(active, ticks) {
    if (active.finishReporting) return active.finishReporting;
    active.finishReporting = (async function () {
      await active.reporting.catch(function () {});
      if (!active.started) return;
      try {
        await api("/Sessions/Playing/Stopped", null, {
          ItemId: active.item.Id, MediaSourceId: active.source.Id,
          PlaySessionId: active.sessionId, PositionTicks: ticks,
        }, "POST", {session: active.account, timeoutMs: 5000});
      } catch (_) { /* A report failure must not block the next episode. */ }
      if (active.live) return;
      try {
        var fresh = await api("/Users/" + encodeURIComponent(active.account.user) + "/Items/" + encodeURIComponent(active.item.Id), null, null, "GET", {session: active.account, timeoutMs: 5000});
        if (active.completed && !(fresh.UserData && fresh.UserData.Played))
          await setWatched(active.item, true, null, {session: active.account, timeoutMs: 5000});
        else if (fresh.UserData) refreshUserData(active.item, fresh.UserData, active.account);
      } catch (_) {
        if (active.completed) {
          try { await setWatched(active.item, true, null, {session: active.account, timeoutMs: 5000}); }
          catch (_) { active.watchSaveFailed = true; }
        }
      }
    })();
    return active.finishReporting;
  }
  function drainPendingAdvance() {
    if (playing && playing.pendingAdvance && !busy) run(function () { return advancePlayback(false); });
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
      if (active.pendingPreference.type === "Subtitle")
        saveSubtitleChoice(active.item.Id, active.source, active.subtitleIndex);
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
    if (live && playing && playing.live && item.ChannelId === playing.item.Id) {
      fullscreenLive();
      return;
    }
    if (busy) return;
    busy = true;
    if (!options.trackChange && !options.preserveHistory) playbackHistory = [];
    var wasLivePreview = livePreview && live;
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
          subtitleOptions().enabled ||
          preferences.Audio ||
          preferences.Subtitle ||
          subtitleDefaults().mode !== "remember" || subtitleDefaults().foreignEnglish || readPreference("audio-defaults", {}).animeLanguage ||
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
        if (!options.trackChange && options.audioIndex == null)
          options.audioIndex = await defaultAudio(item, sourceMetadata || {}, controller.signal);
        if (!options.trackChange && options.subtitleIndex == null) {
          var savedSubtitle = readPreference("subtitle-choices", {})[item.Id];
          options.subtitleIndex = savedSubtitle && sourceMetadata && savedSubtitle.source === sourceMetadata.Id &&
            (savedSubtitle.index === -1 || (sourceMetadata.MediaStreams || []).some(function (s) { return s.Type === "Subtitle" && s.Index === savedSubtitle.index; }))
            ? savedSubtitle.index
            : C.defaultSubtitle(sourceMetadata || {}, options.audioIndex, subtitleDefaults(), preferences.Subtitle);
        }
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
      var subtitleStyle = subtitleOptions(),
        subtitleCues = null,
        subtitleNotice = "";
      subtitleStyle.delay = subtitleDelay(item, sourceMetadata, subtitleIndex);
      var selectedSubtitle = C.textSubtitle(sourceMetadata, subtitleIndex);
      if (!live && subtitleStyle.enabled && selectedSubtitle) {
        try {
          if (
            previous &&
            previous.item.Id === item.Id &&
            previous.source.Id === sourceMetadata.Id &&
            previous.subtitleIndex === subtitleIndex &&
            previous.subtitleCues
          )
            subtitleCues = previous.subtitleCues;
          else {
            subtitleCues = await loadSubtitleCues(item, sourceMetadata, subtitleIndex, controller.signal);
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          subtitleCues = null;
          subtitleNotice =
            "Text subtitles could not load; using server-rendered subtitles for this video. Select the track again to retry.";
        }
      }
      var deliveredSubtitleIndex = subtitleCues ? -1 : subtitleIndex;
      var policy = live
        ? { native: false, reason: "Live TV uses compatibility HLS" }
        : options.compatibility
          ? { native: false, reason: options.policyReason }
          : P.playbackPolicy
            ? P.playbackPolicy(sourceMetadata, decoder, deliveredSubtitleIndex)
          : P.nativePlayback === false
            ? { native: false, reason: P.deviceName + " compatibility playback" }
            : C.nativePolicy(sourceMetadata, decoder, deliveredSubtitleIndex);
      var nativeMode = policy.native;
      var deviceProfile = C.profile({
        native: nativeMode,
        dolbyVision: decoder.dolbyVision,
      });
      if (nativeMode && P.playbackProfile) deviceProfile = P.playbackProfile(C.profile(), sourceMetadata);
      var forceTranscode =
        !!live || !!options.compatibility ||
        (!(nativeMode && P.playbackPolicy) && (!!options.trackChange || !!subtitleCues || !!options.applyPreferences));
      var requestBody = {
        UserId: session.user,
        StartTimeTicks: ticks,
        IsPlayback: true,
        AutoOpenLiveStream: true,
        EnableDirectPlay: !forceTranscode,
        EnableDirectStream: nativeMode,
        EnableTranscoding: true,
        AllowVideoStreamCopy:
          !options.compatibility && (!(deliveredSubtitleIndex >= 0) || (nativeMode && !!P.playbackPolicy)),
        MaxAudioChannels: nativeMode && P.playbackProfile
          ? Number(deviceProfile.TranscodingProfiles[0].MaxAudioChannels) || 2
          : nativeMode ? 6 : 2,
        AudioStreamIndex: options.audioIndex,
        SubtitleStreamIndex: subtitleCues ? -1 : options.subtitleIndex,
        MediaSourceId: options.mediaSourceId || (nativeMode && P.playbackProfile && sourceMetadata ? sourceMetadata.Id : undefined),
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
      if (subtitleCues && selected.source.Id !== sourceMetadata.Id)
        throw new Error("Subtitle source changed. Try another track.");
      if (request !== playRequest || document.hidden) return;
      if (previous)
        await stop({
          transition: true,
          keepPlayer: !!options.trackChange && !wasLivePreview,
          positionTicks: previous.item.Id === item.Id ? ticks : undefined,
        });
      if (request !== playRequest || document.hidden) return;
      playing = Object.assign(selected, {
        item: item,
        account: session,
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
        subtitleCues: subtitleCues,
        subtitleStyle: subtitleStyle,
        subtitleIndex: subtitleCues
          ? subtitleIndex
          : options.subtitleIndex != null
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
        returnFocus:
          previous && !wasLivePreview
            ? previous.returnFocus
            : document.activeElement,
      });
      openedLive = null;
      queueItems = queueItems.filter(function (entry) {
        return entry.Id !== item.Id;
      });
      hideUpNext();
      closePlayerTools(false);
      closePlaybackPanel(false);
      updatePlaybackButtons();
      loadPlaybackExtras(playing);
      applySubtitleStyle(subtitleOverlay, subtitleStyle);
      renderSubtitleOverlay();
      subtitleTimer = setInterval(renderSubtitleOverlay, 100);
      player.hidden = false;
      livePreview = false;
      document.body.classList.toggle("live-preview", livePreview);
      document.body.classList.toggle("is-playing", !livePreview);
      document.getElementById("live-preview-caption").textContent =
        returnItem.ChannelName || item.Name;
      video.style.objectFit = previous ? video.style.objectFit : "contain";
      document.getElementById("fit").textContent =
        video.style.objectFit === "cover" ? "Fit video" : "Fill screen";
      document.getElementById("rewind").disabled = !!live;
      document.getElementById("forward").disabled = !!live;
      document.getElementById("timeline").hidden = !!live;
      document.getElementById("timeline").min = 0;
      document
        .getElementById("timeline")
        .setAttribute("aria-label", "Playback position");
      showControls();
      document.getElementById("playing-title").textContent = item.SeriesName ? item.SeriesName + " · " + item.Name : item.Name;
      document.getElementById("playing-year").textContent = item.ProductionYear || "";
      var playerLogo = document.getElementById("player-logo"), logoId = C.logoItem(item);
      playerLogo.hidden = true;
      playerLogo.dataset.playingItem = item.Id;
      playerLogo.onload = function () { if (playerLogo.dataset.playingItem === item.Id) playerLogo.hidden = false; };
      playerLogo.onerror = function () { playerLogo.hidden = true; };
      if (logoId) setImageSource(playerLogo, session.server + "/Items/" + encodeURIComponent(logoId) + "/Images/Logo?maxWidth=400&quality=90");
      else playerLogo.removeAttribute("src");
      document.getElementById("end-time").textContent = "";
      if (P.playbackTracks && video.configure)
        video.configure(P.playbackTracks(selected, sourceMetadata, playing.audioIndex, playing.subtitleIndex, subtitleCues, nativeMode, { server: session.server, itemId: item.Id, token: session.token }));
      video.src = selected.url + (ticks ? "#t=" + ticks / 10000000 : "");
      resumeTimer = setInterval(finishResume, 250);
      video.load();
      if (livePreview && activeGuide) activeGuide.focusChannel(item.Id);
      else document.getElementById("toggle").focus();
      message(subtitleNotice);
      timer = setInterval(function () {
        run(function () {
          return report("/Progress");
        });
      }, 10000);
    } catch (error) {
      if (request === playRequest) {
        if (!playing && options.trackChange) { player.hidden = true; document.body.classList.remove("is-playing"); }
        throw error;
      }
    } finally {
      if (playController === controller) playController = null;
      busy = false;
      drainPendingAdvance();
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
    renderSubtitleOverlay();
    if (playing.live) {
      var range = liveSeekWindow(),
        timeline = document.getElementById("timeline"),
        behind = range ? Math.max(0, range.end - video.currentTime) : 0;
      timeline.hidden = !range;
      document.getElementById("rewind").disabled =
        !range || video.currentTime <= range.start + 1;
      document.getElementById("forward").disabled = !range || behind < 2;
      document.getElementById("clock").textContent =
        behind > 5 ? "−" + formatTime(behind) + " · Live" : "Live";
      document.getElementById("remaining-time").textContent = "";
      if (range) {
        timeline.min = range.start;
        timeline.max = range.end;
        timeline.value = Math.max(
          range.start,
          Math.min(range.end, video.currentTime),
        );
        timeline.setAttribute("aria-label", "Live TV buffer");
        timeline.setAttribute(
          "aria-valuetext",
          behind > 5 ? formatTime(behind) + " behind live" : "Live edge",
        );
        timeline.style.backgroundSize =
          Math.max(
            0,
            Math.min(
              100,
              ((video.currentTime - range.start) / (range.end - range.start)) *
                100,
            ),
          ) + "% 100%";
      }
      return;
    }
    var elapsed = position() / 10000000;
    var duration = playing.live
      ? 0
      : playing.item.RunTimeTicks / 10000000 ||
        (Number.isFinite(video.duration) ? video.duration : 0);
    document.getElementById("clock").textContent = playing.live
      ? "Live"
      : formatTime(elapsed);
    document.getElementById("end-time").textContent = duration ? "Ends at " + new Date(Date.now() + Math.max(0, duration - elapsed) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    var timeline = document.getElementById("timeline");
    timeline.max = duration || 1;
    timeline.value = Math.min(elapsed, duration || 0);
    timeline.setAttribute(
      "aria-valuetext",
      formatTime(elapsed) + " of " + formatTime(duration),
    );
    timeline.style.backgroundSize =
      (duration ? Math.min(100, (elapsed / duration) * 100) : 0) + "% 100%";
    document.getElementById("remaining-time").textContent = duration
      ? "−" + formatTime(duration - elapsed)
      : "";
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
    var active = playing;
    if (!active || active.live || !active.started || active.completed) return;
    active.completed = true;
    active.completedPositionTicks = Math.max(position(), active.lastPositionTicks || 0,
      Number.isFinite(video.duration) ? Math.round(video.duration * 10000000) : 0,
      active.item.RunTimeTicks || 0);
    clearInterval(timer);
    run(async function () {
      await finishPlaybackReporting(active, active.completedPositionTicks);
      if (playing === active) return advancePlayback(false);
    });
  };
  video.onpause = function () {
    showControls();
    setTransportState(true);
    run(function () {
      return report("/Progress");
    });
  };
  video.onplay = function () {
    showControls();
    setTransportState(false);
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
    clearInterval(subtitleTimer);
    subtitleOverlay.hidden = true;
    subtitleTextNode.textContent = "";
    var stopped = playing,
      stoppedRevision = revision,
      ticks =
        options.positionTicks != null ? options.positionTicks : stopped.completedPositionTicks != null ? stopped.completedPositionTicks : position();
    hideUpNext();
    playing = null;
    livePreview = false;
    document.body.classList.remove("live-preview");
    closeSubtitleSearch(false);
    stopped.extrasController.abort();
    closePlaybackPanel(false);
    video.pause();
    video.removeAttribute("src");
    video.load();
    if (!options.keepPlayer) {
      player.hidden = true;
      document.body.classList.remove("is-playing");
    }
    if (
      !options.transition &&
      stopped.returnFocus &&
      stopped.returnFocus.isConnected
    )
      stopped.returnFocus.focus();
    await finishPlaybackReporting(stopped, ticks);
    if (stopped.method === "Transcode") {
      try { await api("/Videos/ActiveEncodings", {DeviceId: device, PlaySessionId: stopped.sessionId}, null, "DELETE", {session: stopped.account, timeoutMs: 3000}); } catch (_) {}
    }
    if (stopped.source.LiveStreamId) {
      try { await api("/LiveStreams/Close", {LiveStreamId: stopped.source.LiveStreamId}, {LiveStreamId: stopped.source.LiveStreamId}, "POST", {session: stopped.account, timeoutMs: 3000}); } catch (_) {}
    }
    if (session === stopped.account) { homeCache.clear(); listingStates.clear(); previewCache.clear(); }
    if (
      !options.transition &&
      stopped.started &&
      session === stopped.account &&
      !stopped.returnItem.IsLiveChannel &&
      revision === stoppedRevision &&
      !playing &&
      stopped.returnFocus &&
      stopped.returnFocus.isConnected
    ) {
      await detail(stopped.returnItem.Id, !!stopped.live);
    }
  }
  function transportIcon(id, icon, label) {
    var control = document.getElementById(id);
    control.textContent = "";
    control.appendChild(navIcon(icon));
    el("span", label, control);
    control.setAttribute("aria-label", label);
    control.title = label;
  }
  function setTransportState(paused) {
    transportIcon(
      "toggle",
      paused ? "play" : "pause",
      paused ? "Play" : "Pause",
    );
  }
  transportIcon("rewind", "rewind", "Back 30 seconds");
  transportIcon("forward", "forward", "Forward 30 seconds");
  transportIcon("next-video", "next", "Next video");
  transportIcon("previous-video", "next", "Previous video");
  [["player-options", "settings", "Options"], ["subtitles", "closed_caption", "Subtitles"], ["audio", "volume_up", "Audio"]].forEach(function (entry) {
    var control = document.getElementById(entry[0]);
    control.textContent = "";
    var img = el("img", null, control);
    img.src = "icons/" + entry[1] + ".svg";
    img.alt = "";
    control.setAttribute("aria-label", entry[2]);
    control.title = entry[2];
  });
  setTransportState(false);
  function closePlayerTools(restore) {
    var tools = document.getElementById("player-tools"),
      focused = tools.contains(document.activeElement);
    tools.hidden = true;
    document
      .getElementById("player-options")
      .setAttribute("aria-expanded", "false");
    if (focused && restore !== false)
      document.getElementById("player-options").focus();
  }
  document.getElementById("player-options").onclick = function () {
    var tools = document.getElementById("player-tools");
    if (!tools.hidden) closePlayerTools();
    else {
      tools.hidden = false;
      this.setAttribute("aria-expanded", "true");
      var first = tools.querySelector("button:not(:disabled)");
      if (first) first.focus();
    }
    showControls();
  };
  function hideControls() {
    document.getElementById("controls").style.opacity = "0";
    document.getElementById("controls").style.pointerEvents = "none";
    document.getElementById("controls").setAttribute("aria-hidden", "true");
    if (document.getElementById("controls").contains(document.activeElement))
      document.activeElement.blur();
  }
  function showControls() {
    if (livePreview) return;
    var controls = document.getElementById("controls");
    controls.style.opacity = "1";
    controls.style.pointerEvents = "auto";
    controls.removeAttribute("aria-hidden");
    clearTimeout(controlsTimer);
    if (playing)
      controlsTimer = setTimeout(function () {
        if (
          !video.paused &&
          !video.seeking &&
          document.getElementById("playback-panel").hidden &&
          document.getElementById("player-tools").hidden &&
          upNext.hidden
        )
          hideControls();
      }, 3000);
  }
  player.addEventListener("mousemove", showControls);
  player.addEventListener("click", function () {
    if (livePreview) fullscreenLive();
    else showControls();
  });
  function toggle() {
    if (playing && playing.awaitingWatching) return;
    if (video.paused) return video.play();
    video.pause();
  }
  function liveSeekWindow() {
    if (!playing || !playing.live || !playing.started || !video.seekable.length)
      return null;
    var index = video.seekable.length - 1,
      start = video.seekable.start(index),
      end = video.seekable.end(index) - 1;
    return Number.isFinite(start) && Number.isFinite(end) && end - start >= 2
      ? { start: start, end: end }
      : null;
  }
  function seek(seconds) {
    if (!playing || !playing.started || playing.awaitingWatching) return;
    var range = liveSeekWindow();
    if (playing.live) {
      if (range)
        video.currentTime = Math.max(
          range.start + 0.1,
          Math.min(range.end, video.currentTime + seconds),
        );
      return;
    }
    var target = Math.max(0, video.currentTime + seconds);
    if (Number.isFinite(video.duration))
      target = Math.min(target, video.duration);
    video.currentTime = target;
  }
  document.getElementById("timeline").oninput = function () {
    if (!playing || !playing.started || playing.awaitingWatching) return;
    if (playing.live) {
      var range = liveSeekWindow();
      if (!range) return;
      video.currentTime = Math.max(
        range.start + 0.1,
        Math.min(range.end, Number(this.value)),
      );
    } else video.currentTime = Number(this.value);
    showControls();
  };
  document.getElementById("timeline").onchange = function () {
    run(function () {
      return report("/Progress");
    });
  };
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
  document.addEventListener("focusin", function (e) {
    document
      .querySelector("header")
      .classList.toggle("drawer-open", nav.contains(e.target));
    document.querySelector("header").scrollLeft = 0;
    nav.scrollLeft = 0;
    if (main.contains(e.target)) {
      contentFocus = e.target;
      if (
        main.classList.contains("detail-page") &&
        e.target.closest(".actions")
      )
        main.scrollTop = 0;
    }
  });
  function focusContent(node) {
    if (!node) return;
    if (nav.contains(node) && !nav.contains(document.activeElement))
      node = nav.querySelector('[data-nav="home"]') || node;
    node.focus();
    if (nav.contains(node)) {
      var rect = node.getBoundingClientRect(),
        bounds = nav.getBoundingClientRect();
      if (rect.top < bounds.top) nav.scrollTop -= bounds.top - rect.top;
      else if (rect.bottom > bounds.bottom)
        nav.scrollTop += rect.bottom - bounds.bottom;
      nav.scrollLeft = 0;
      document.querySelector("header").scrollLeft = 0;
      return;
    }
    if (P.nativePlayback === false && main.classList.contains("live-guide-page") && main.contains(node)) {
      // Older Tizen scrollIntoView scrolls the document as well as the guide.
      var itemBounds = node.getBoundingClientRect(),
        guideBounds = main.getBoundingClientRect();
      if (itemBounds.top < guideBounds.top + 12)
        main.scrollTop -= guideBounds.top + 12 - itemBounds.top;
      else if (itemBounds.bottom > guideBounds.bottom - 12)
        main.scrollTop += itemBounds.bottom - guideBounds.bottom + 12;
    } else node.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (
      (main.classList.contains("detail-page") && node.closest(".actions")) ||
      node.closest(".series-continue")
    )
      main.scrollTop = 0;
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
    var key = P.keyCode(e);
    if (subtitleSearch && !subtitleSearch.hidden) {
      if (key === 461 || key === 27) { e.preventDefault(); closeSubtitleSearch(); }
      else if (key >= 37 && key <= 40) {
        var options = Array.prototype.slice.call(subtitleSearch.querySelectorAll("button,select")).filter(function (node) { return !node.disabled; }),
          index = options.indexOf(document.activeElement);
        // Left/right changes the language; up/down moves between controls.
        if (document.activeElement.tagName === "SELECT" && (key === 37 || key === 39)) {
          var select = document.activeElement;
          select.selectedIndex = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + (key === 37 ? -1 : 1)));
        } else focusContent(options[Math.max(0, Math.min(options.length - 1, index + (key === 37 || key === 38 ? -1 : 1)))]);
        e.preventDefault();
      }
      return;
    }
    if (livePreview && key === 413) {
      e.preventDefault();
      run(stop);
      return;
    }
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
    var detailSubtitleMenu = document.getElementById("detail-subtitle-menu");
    if (
      (!playing || livePreview) &&
      detailSubtitleMenu &&
      !detailSubtitleMenu.hidden &&
      key >= 37 &&
      key <= 40
    ) {
      e.preventDefault();
      var subtitleOptions = Array.prototype.slice.call(
          detailSubtitleMenu.querySelectorAll("button"),
        ),
        optionIndex = subtitleOptions.indexOf(document.activeElement),
        nextOption = Math.max(
          0,
          Math.min(
            subtitleOptions.length - 1,
            optionIndex + (key === 38 || key === 37 ? -1 : 1),
          ),
        );
      focusContent(subtitleOptions[nextOption]);
      return;
    }
    if (
      (!playing || livePreview) &&
      document.activeElement.id === "detail-subtitles" &&
      key >= 37 &&
      key <= 40
    ) {
      e.preventDefault();
      if (key === 40 && main.classList.contains("movie-detail"))
        focusContent(main.querySelector(".actions button"));
      else if (key === 40 && main.querySelector(".cast-row figure"))
        focusContent(main.querySelector(".cast-row figure"));
      else if (key === 40 && main.querySelector(".detail-related"))
        main.querySelector(".detail-related").requestFocus();
      else if (key !== 40) focusContent(main.querySelector(".actions button"));
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
    if (playing && !livePreview) {
      var panelOpen = !document.getElementById("playback-panel").hidden;
      var controlsHidden =
        document.getElementById("controls").style.opacity === "0";
      showControls();
      if (
        !panelOpen &&
        document.activeElement.id === "timeline" &&
        (key === 37 || key === 39)
      ) {
        e.preventDefault();
        seek(key === 37 ? -10 : 10);
        return;
      }
      if (controlsHidden && (key === 37 || key === 39)) {
        e.preventDefault();
        seek(key === 37 ? -10 : 10);
        document.getElementById("timeline").focus();
        return;
      }
      if (controlsHidden && key === 13) {
        e.preventDefault();
        document.getElementById("toggle").focus();
        return;
      }
      if (!panelOpen && controlsHidden && key >= 37 && key <= 40) {
        e.preventDefault();
        document.getElementById(key === 38 ? "timeline" : "toggle").focus();
        return;
      }
      if (
        !panelOpen &&
        document.activeElement.id === "timeline" &&
        key === 13
      ) {
        e.preventDefault();
        document.getElementById("toggle").focus();
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
    if (
      playing &&
      !livePreview &&
      document.getElementById("playback-panel").hidden &&
      key >= 37 &&
      key <= 40
    ) {
      var focused = document.activeElement,
        transport = document.getElementById("transport"),
        tools = document.getElementById("player-tools");
      if (transport.contains(focused)) {
        e.preventDefault();
        var buttons = Array.prototype.slice
            .call(transport.querySelectorAll("button"))
            .filter(function (node) {
              return !node.disabled && !node.hidden;
            }),
          index = buttons.indexOf(focused);
        if (key === 37 || key === 39)
          buttons[
            Math.max(
              0,
              Math.min(buttons.length - 1, index + (key === 37 ? -1 : 1)),
            )
          ].focus();
        else if (key === 38) document.getElementById("timeline").focus();
        else if (!tools.hidden)
          tools.querySelector("button:not(:disabled)").focus();
        else document.getElementById("player-options").focus();
        return;
      }
      if (focused.id === "timeline" && key === 40) {
        e.preventDefault();
        document.getElementById("toggle").focus();
        return;
      }
      if (tools.contains(focused)) {
        e.preventDefault();
        var group = focused.closest(".player-tool-group"), groups = Array.prototype.slice.call(tools.querySelectorAll(".player-tool-group"));
        var members = Array.prototype.slice.call(group.querySelectorAll("button:not(:disabled)")), column = members.indexOf(focused), row = groups.indexOf(group);
        if (key === 37 || key === 39) {
          (members[column + (key === 37 ? -1 : 1)] || focused).focus();
        } else {
          var nextGroup = groups[row + (key === 38 ? -1 : 1)];
          if (nextGroup) {
            var nextMembers = nextGroup.querySelectorAll("button:not(:disabled)");
            if (nextMembers.length) nextMembers[Math.min(column, nextMembers.length - 1)].focus();
          } else if (key === 38) document.getElementById("player-options").focus();
        }
        return;
      }
    }
    if (document.activeElement.tagName === "SELECT") {
      if (document.activeElement.id === "detail-subtitles") {
        if (key === 38 || key === 39) {
          e.preventDefault();
          focusContent(main.querySelector(".actions button"));
        } else if (key === 40 && main.querySelector(".cast-row figure")) {
          e.preventDefault();
          focusContent(main.querySelector(".cast-row figure"));
        }
      }
      return;
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
    var moreMenu = main.querySelector("#detail-more-options:not([hidden])");
    if (moreMenu && (!playing || livePreview)) {
      var moreControls = Array.prototype.slice.call(
        moreMenu.querySelectorAll("button"),
      );
      var pos = moreControls.indexOf(active);
      focusContent(
        moreControls[
          Math.max(
            0,
            Math.min(
              moreControls.length - 1,
              pos + (key === 37 || key === 38 ? -1 : 1),
            ),
          )
        ],
      );
      return;
    }
    if ((!playing || livePreview) && main.classList.contains("settings-page")) {
      var category = active.closest(".settings-category"),
        setting = active.closest(".setting-row");
      if (category) {
        var cats = Array.prototype.slice.call(
            main.querySelectorAll(".settings-category"),
          ),
          index = cats.indexOf(category);
        if (key === 38 || key === 40)
          focusContent(cats[index + (key === 38 ? -1 : 1)]);
        else if (key === 39)
          focusContent(
            category.settingsSection.querySelector("button:not(:disabled)"),
          );
        else if (key === 37)
          focusContent(nav.querySelector('[aria-current="page"]'));
        return;
      }
      if (setting) {
        var rows = Array.prototype.slice.call(
            main.querySelectorAll(".setting-row:not(:disabled)"),
          ),
          pos = rows.indexOf(setting);
        if (key === 38 || key === 40)
          focusContent(rows[pos + (key === 38 ? -1 : 1)]);
        else if (key === 37)
          focusContent(setting.closest(".settings-section").categoryButton);
        return;
      }
    }
    var tvTab = active.closest(".tv-library-tabs");
    if ((!playing || livePreview) && tvTab) {
      if (key === 37 || key === 39) {
        var tabs = Array.prototype.slice.call(tvTab.querySelectorAll("button")),
          at = tabs.indexOf(active);
        var target = tabs[at + (key === 37 ? -1 : 1)];
        if (target) focusContent(target);
        else if (key === 37)
          focusContent(nav.querySelector('[aria-current="page"]'));
      } else if (key === 40) {
        focusContent(
          main.querySelector(
            ".rail button,.library-grid .card,.tv-category-grid .card,#library-sort",
          ),
        );
      }
      return;
    }
    if (
      (!playing || livePreview) &&
      activeGuide &&
      activeGuide.handleKey(key, active)
    )
      return;
    if (
      (!playing || livePreview) &&
      activeListing &&
      activeListing.handleKey(key, active)
    )
      return;
    if ((!playing || livePreview) && nav.contains(active)) {
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
    if ((!playing || livePreview) && main.classList.contains("movie-detail") && key === 38 && active.closest(".actions")) {
      var movieSubtitles = main.querySelector("#detail-subtitles:not(:disabled)");
      if (movieSubtitles) { focusContent(movieSubtitles); return; }
    }
    if ((!playing || livePreview) && key === 40 && active.closest(".actions")) {
      var detailCast = main.querySelector(".cast-row");
      var detailSubtitles = main.classList.contains("movie-detail") ? null : main.querySelector(
        "#detail-subtitles:not(:disabled)",
      );
      if (detailCast) detailCast.castReturnFocus = active;
      if (detailSubtitles || detailCast) {
        focusContent(detailSubtitles || detailCast.querySelector("figure"));
        return;
      }
      if (main.querySelector(".detail-related")) {
        main.querySelector(".detail-related").requestFocus();
        return;
      }
    }
    var seasonGrid = !playing && active.closest(".season-grid");
    if (seasonGrid && (key === 38 || key === 40)) {
      var y = active.getBoundingClientRect().top,
        seasonNodes = Array.prototype.slice.call(
          seasonGrid.querySelectorAll(".card"),
        ),
        hasRow = seasonNodes.some(function (node) {
          return key === 38
            ? node.getBoundingClientRect().top < y - 4
            : node.getBoundingClientRect().top > y + 4;
        });
      if (!hasRow) {
        if (key === 38)
          focusContent(
            main.querySelector(".series-continue .card") ||
              main.querySelector(".actions button"),
          );
        else if (main.querySelector(".cast-row")) {
          main.querySelector(".cast-row").castReturnFocus = active;
          focusContent(main.querySelector(".cast-row figure"));
        } else if (main.querySelector(".detail-related"))
          main.querySelector(".detail-related").requestFocus();
        return;
      }
    }
    var castRow = (!playing || livePreview) && active.closest(".cast-row");
    if (castRow) {
      var castCards = Array.prototype.slice.call(
          castRow.querySelectorAll("figure"),
        ),
        castIndex = castCards.indexOf(active);
      if (key === 37 || key === 39) {
        if (key === 39 && castIndex >= castCards.length - 2) {
          castRow.loadMoreCast();
          castCards = Array.prototype.slice.call(
            castRow.querySelectorAll("figure"),
          );
        }
        var nextCast = castCards[castIndex + (key === 37 ? -1 : 1)];
        if (nextCast) focusContent(nextCast);
        else if (key === 37)
          focusContent(
            nav.querySelector('[aria-current="page"]') ||
              nav.querySelector("button"),
          );
      } else if (key === 40) {
        var castRows = Array.prototype.slice.call(
          main.querySelectorAll(".cast-row"),
        );
        var nextCastRow = castRows[castRows.indexOf(castRow) + 1];
        var related = main.querySelector(".detail-related");
        if (nextCastRow) focusContent(nextCastRow.querySelector("figure"));
        else if (related) related.requestFocus();
      } else if (key === 38) {
        var castRowsAbove = Array.prototype.slice.call(
          main.querySelectorAll(".cast-row"),
        );
        var previousCastRow = castRowsAbove[castRowsAbove.indexOf(castRow) - 1];
        if (previousCastRow) {
          focusContent(previousCastRow.querySelector("figure"));
          return;
        }
        focusContent(
          castRow.castReturnFocus && castRow.castReturnFocus.isConnected
            ? castRow.castReturnFocus
            : main.querySelector(".actions button"),
        );
      }
      return;
    }
    var rail = (!playing || livePreview) && active.closest(".rail");
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
          .call(
            main.querySelectorAll(".rail,.season-grid,.cast-row,.library-grid"),
          )
          .filter(function (node) {
            return node.getClientRects().length;
          }),
        nextRail = rails[rails.indexOf(rail) + (key === 38 ? -1 : 1)];
      if (nextRail) {
        var nextCards = nextRail.querySelectorAll("button,figure[tabindex]");
        focusContent(nextCards[Math.min(cardIndex, nextCards.length - 1)]);
      } else if (key === 38) {
        var selectedTab = main.querySelector(
          '.tv-library-tabs [aria-selected="true"]',
        );
        if (selectedTab) {
          focusContent(selectedTab);
          return;
        }
        if (rail.closest(".series-continue")) {
          focusContent(
            main.querySelector(".actions button") ||
              main.querySelector("#library-sort"),
          );
          return;
        }
        var cast =
          main.classList.contains("detail-page") &&
          main.querySelectorAll(".cast-row figure");
        if (cast && cast.length)
          focusContent(cast[Math.min(cardIndex, cast.length - 1)]);
        else if (main.classList.contains("detail-page"))
          focusContent(main.querySelector(".actions button"));
        else
          focusContent(
            nav.querySelector('[aria-current="page"]') ||
              nav.querySelector("button"),
          );
      }
      return;
    }
    var scope =
      playing && !livePreview
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
    if (!next && (!playing || livePreview) && key === 37) {
      focusContent(
        nav.querySelector('[aria-current="page"]') ||
          nav.querySelector("button"),
      );
      return;
    }
    if (next) focusContent(next);
  });
  document.addEventListener("ember-suspend", function () {
    run(stop);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) closeSubtitleSearch(false);
    if (document.hidden && cancelQuickConnect) {
      login();
      message(
        "Quick Connect cancelled while the app was hidden. Generate a new code to continue.",
      );
    }
    if (!document.hidden && playing) updateUpNext();
    if (document.hidden) subtitleOverlay.hidden = true;
    if (document.hidden && playing) {
      hideUpNext();
      if (playing.live) run(stop);
      else video.pause();
    }
  });
  function updateWallClock() {
    document.getElementById("wall-clock").textContent =
      new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    document.getElementById("player-wall-clock").textContent = document.getElementById("wall-clock").textContent;
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
      return startSession();
    });
  else login();
})();
