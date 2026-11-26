package tv.ember.jellyfin;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognizerIntent;
import android.view.KeyEvent;
import android.view.Display;
import androidx.media3.common.Format;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.Tracks;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.ArrayList;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.extractor.DefaultExtractorsFactory;
import androidx.media3.extractor.ExtractorsFactory;
import io.github.peerless2012.ass.media.AssHandler;
import io.github.peerless2012.ass.media.AssHandlerConfig;
import io.github.peerless2012.ass.media.factory.AssRenderersFactory;
import io.github.peerless2012.ass.media.parser.AssSubtitleParserFactory;
import io.github.peerless2012.ass.media.type.AssRenderType;
import io.github.peerless2012.ass.media.widget.AssSubtitleView;
import io.github.peerless2012.ass.media.kt.AssPlayerKt;

/** Bundled Ember UI over native video; remote pages cannot navigate into the bridge. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class MainActivity extends Activity {
    private static final String HOME = "https://appassets.androidplatform.net/assets/index.html";
    private static final int VOICE_SEARCH_REQUEST = 401;
    private int voiceSearchId;
    private Intent pendingHomeSearch;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private SeerrClient seerr;
    private AppUpdater updater;
    private PlayerView video;
    private ExoPlayer player;
    private PlaybackSession mediaSession;
    private TvHomeIntegration tvHome;
    private final java.util.concurrent.ExecutorService artworkWorker = java.util.concurrent.Executors.newSingleThreadExecutor();
    private androidx.media3.exoplayer.analytics.PlaybackStatsListener playbackStats;
    private String videoDecoder = "", audioDecoder = "";
    private AssHandler assHandler;
    private AssSubtitleView assView;
    private int externalSubtitle = -1;
    private int generation;
    private boolean destroyed, metadataSent, seeking;
    private boolean foreground;
    private int audioTrack = -1, subtitleTrack = -1;
    private boolean tracksApplied;
    private String displayPreference = "off";
    private boolean displayRequested;
    private int savedDisplayMode;
    private float savedDisplayRate;

    private void restoreDisplay() {
        if (!displayRequested) return;
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.preferredDisplayModeId = savedDisplayMode;
        params.preferredRefreshRate = savedDisplayRate;
        getWindow().setAttributes(params);
        displayRequested = false;
    }
    private void matchDisplay() {
        if (!foreground || player == null || displayPreference.equals("off")) return;
        Format format = player.getVideoFormat();
        if (format == null) return;
        try {
            Display display = getWindowManager().getDefaultDisplay();
            Display.Mode current = display.getMode();
            Display.Mode[] supported = display.getSupportedModes();
            DisplayModeSelector.Mode[] modes = new DisplayModeSelector.Mode[supported.length];
            for (int i = 0; i < supported.length; i++) {
                Display.Mode m = supported[i];
                modes[i] = new DisplayModeSelector.Mode(m.getModeId(), m.getPhysicalWidth(), m.getPhysicalHeight(), m.getRefreshRate());
            }
            int mode = DisplayModeSelector.select(modes,
                new DisplayModeSelector.Mode(current.getModeId(), current.getPhysicalWidth(), current.getPhysicalHeight(), current.getRefreshRate()),
                format.width, format.height, format.frameRate, !displayPreference.equals("resolution"), !displayPreference.equals("rate"));
            if (mode == current.getModeId()) return;
            WindowManager.LayoutParams params = getWindow().getAttributes();
            if (displayRequested && params.preferredDisplayModeId == mode) return;
            if (!displayRequested) {
                savedDisplayMode = params.preferredDisplayModeId;
                savedDisplayRate = params.preferredRefreshRate;
                displayRequested = true;
            }
            params.preferredDisplayModeId = mode;
            params.preferredRefreshRate = 0;
            getWindow().setAttributes(params);
        } catch (RuntimeException ignored) { restoreDisplay(); }
    }


    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        pendingHomeSearch = getIntent();
        tvHome = new TvHomeIntegration(this);
        tvHome.intent(getIntent());
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        setContentView(R.layout.main);
        video = findViewById(R.id.native_player);
        // Letterbox/pillarbox bars must remain true black, including HDR playback.
        video.setBackgroundColor(Color.BLACK);
        video.setShutterBackgroundColor(Color.BLACK);
        video.setDescendantFocusability(android.view.ViewGroup.FOCUS_BLOCK_DESCENDANTS);
        web = findViewById(R.id.webview);
        web.setBackgroundColor(Color.TRANSPARENT);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        // User-configured HTTP Jellyfin servers on the LAN must remain accessible.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !HOME.equals(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !HOME.equals(url); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!HOME.equals(url)) { result.cancel(); return true; }
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("OK", (dialog, which) -> result.confirm())
                    .setNegativeButton("Cancel", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        updater = new AppUpdater(this, data -> handler.post(() -> {
            if (!destroyed && HOME.equals(web.getUrl())) web.evaluateJavascript("window.EmberFireTV.updateResult(" + data.toString() + ")", null);
        }));
        seerr = new SeerrClient(this);
        web.addJavascriptInterface(new Bridge(), "EmberAndroid");
        web.loadUrl(HOME);
        web.requestFocus();
        handler.post(tick);
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            if (player != null && metadataSent) send("timeupdate");
            handler.postDelayed(this, 500);
        }
    };
    private final class Bridge {
        @JavascriptInterface public boolean supportsHomeSearch() {
            return HomeSearchProvider.supported(MainActivity.this);
        }
        @JavascriptInterface public void homeSearchProfile(String profile) {
            if (supportsHomeSearch() && profile != null && profile.length() <= 4096)
                HomeSearchProvider.selectProfile(MainActivity.this, profile);
        }
        @JavascriptInterface public void publishHomeTitles(String profile, String items) {
            if (supportsHomeSearch() && profile != null && items != null && items.length() <= 2500000)
                HomeSearchProvider.update(MainActivity.this, profile, items);
        }
        @JavascriptInterface public String takeHomeTitle(String profile) {
            synchronized (MainActivity.this) {
                if (profile == null) return "";
                JSONObject item = HomeSearchProvider.open(MainActivity.this, pendingHomeSearch, profile);
                if (item == null) return "";
                pendingHomeSearch = null;
                return item.toString();
            }
        }
        @JavascriptInterface public void voiceSearch(int id) {
            handler.post(() -> startVoiceSearch(id));
        }
        @JavascriptInterface public void updateCommand(String action) {
            handler.post(() -> {
                if (destroyed || !foreground || !HOME.equals(web.getUrl())) return;
                if (player != null && !action.equals("status") && !action.equals("check")) return;
                updater.command(action);
            });
        }
        @JavascriptInterface public String appVersion() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface public void seerrRequest(String raw) {
            if (raw == null || raw.length() > 32768) return;
            handler.post(() -> {
                if (destroyed || !HOME.equals(web.getUrl())) return;
                try { seerr.request(new JSONObject(raw), result -> handler.post(() -> {
                    if (!destroyed && HOME.equals(web.getUrl())) web.evaluateJavascript("window.EmberFireTV.seerrResult(" + result.toString() + ")", null);
                })); } catch (Exception ignored) {}
            });
        }
        @JavascriptInterface public String capabilities() {
            JSONObject data = PlaybackCapabilities.read(MainActivity.this);
            try { data.put("watchNextStatus", tvHome.status()); } catch (Exception ignored) {}
            return data.toString();
        }
        @JavascriptInterface public void systemProfile(String profile) {
            if (profile != null && profile.length() < 4096) tvHome.profile(profile);
        }
        @JavascriptInterface public void syncWatchNext(String raw) {
            if (raw == null || raw.length() > 65536) return;
            try { tvHome.sync(new JSONObject(raw)); } catch (Exception ignored) {}
        }
        @JavascriptInterface public String takeSystemResume(String profile) { return tvHome.takeResume(profile); }
        @JavascriptInterface public void artwork(String raw) {
            if (raw == null || raw.length() > 8192) return;
            handler.post(() -> {
                final int token = generation;
                if (mediaSession == null) return;
                artworkWorker.execute(() -> {
                    try {
                        java.io.File file = SystemArtwork.load(MainActivity.this, new JSONObject(raw));
                        if (file == null) return;
                        android.graphics.Bitmap bitmap = BitmapFactory.decodeFile(file.getAbsolutePath());
                        handler.post(() -> {
                            if (!destroyed && token == generation && mediaSession != null) mediaSession.setArtwork(bitmap);
                        });
                    } catch (Exception ignored) {}
                });
            });
        }
        @JavascriptInterface public void command(String raw) {
            if (raw == null || raw.length() > 32768) return;
            handler.post(() -> {
                if (destroyed || !HOME.equals(web.getUrl())) return;
                try { execute(new JSONObject(raw)); }
                catch (Exception error) { send("error"); }
            });
        }
    }
    private void execute(JSONObject command) throws Exception {
        String name = command.getString("action");
        int id = command.optInt("id", -1);
        if (name.equals("displayPreferences")) {
            String mode = command.optString("mode", "off");
            displayPreference = mode.equals("rate") || mode.equals("both") || mode.equals("resolution") ? mode : "off";
            if (displayPreference.equals("off")) restoreDisplay();
            return;
        }
        if (name.equals("exit")) { finish(); return; }
        if (name.equals("load")) {
            if (!foreground) return;
            release();
            generation = id;
            Uri uri = Uri.parse(command.getString("url"));
            if ((!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) ||
                uri.getHost() == null || uri.getUserInfo() != null) { send("error"); return; }
            JSONObject tracks = command.optJSONObject("tracks");
            if (tracks != null && tracks.optBoolean("unavailable")) { send("error"); return; }
            audioTrack = tracks == null ? -1 : tracks.optInt("audio", -1);
            subtitleTrack = tracks == null ? -1 : tracks.optInt("subtitle", -1);
            externalSubtitle = tracks == null ? -1 : tracks.optInt("externalIndex", -1);
            tracksApplied = false;
            final DolbyVisionConversion conversion;
            if (tracks != null && tracks.optBoolean("convertProfile7")) {
                if (!PlaybackCapabilities.read(this).optBoolean("dolbyVisionConversionAvailable")) { send("error"); return; }
                try { conversion = new DolbyVisionConversion(); }
                catch (LinkageError error) { send("error"); return; }
            } else conversion = null;
            DefaultRenderersFactory renderers = conversion == null ? new DefaultRenderersFactory(this) : conversion.renderers(this);
            renderers.setEnableDecoderFallback(true);
            assHandler = new AssHandler(AssRenderType.OVERLAY_CANVAS, new AssHandlerConfig(10000, 128, 1920 * 1080));
            AssSubtitleParserFactory parser = new AssSubtitleParserFactory(assHandler);
            ExtractorsFactory extractors = AssPlayerKt.withAssMkvSupport(new DefaultExtractorsFactory(), parser, assHandler);
            if (conversion != null) extractors = conversion.wrap(extractors);
            DefaultMediaSourceFactory sources = new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this), extractors)
                .setSubtitleParserFactory(parser);
            player = new ExoPlayer.Builder(this, new AssRenderersFactory(assHandler, renderers))
                .setMediaSourceFactory(sources).build();
            videoDecoder = "";
            audioDecoder = "";
            playbackStats = new androidx.media3.exoplayer.analytics.PlaybackStatsListener(false, null);
            player.addAnalyticsListener(playbackStats);
            final int decoderGeneration = generation;
            player.addAnalyticsListener(new androidx.media3.exoplayer.analytics.AnalyticsListener() {
                @Override public void onVideoDecoderInitialized(EventTime event, String name, long timestamp, long duration) {
                    if (generation == decoderGeneration) videoDecoder = name;
                }
                @Override public void onAudioDecoderInitialized(EventTime event, String name, long timestamp, long duration) {
                    if (generation == decoderGeneration) audioDecoder = name;
                }
            });
            // Explicit mode matching owns cadence; do not race Media3's surface hints.
            player.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF);
            assHandler.init(player);
            assView = new AssSubtitleView(this, assHandler);
            video.getSubtitleView().addView(assView, new FrameLayout.LayoutParams(-1, -1));
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            player.setHandleAudioBecomingNoisy(true);
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subtitleTrack < 0 && externalSubtitle < 0).build());
            final int token = generation;
            mediaSession = new PlaybackSession(this, (action, position) -> {
                if (!foreground || destroyed || player == null || token != generation || !HOME.equals(web.getUrl())) return;
                try {
                    JSONObject data = new JSONObject().put("id", token).put("type", "media-command")
                        .put("action", action).put("position", position);
                    web.evaluateJavascript("window.EmberFireTV && window.EmberFireTV.receive(" + data + ")", null);
                } catch (Exception ignored) {}
            });
            mediaSession.setInfo(command.optJSONObject("media"));
            player.addListener(new Player.Listener() {
                private boolean current() { return player != null && token == generation; }
                @Override public void onPlaybackStateChanged(int state) {
                    if (!current()) return;
                    if (state == Player.STATE_READY) {
                        matchDisplay();
                        if (!applyTracks(player.getCurrentTracks())) { send("error"); return; }
                        if (!metadataSent) { metadataSent = true; send("loadedmetadata"); }
                        if (seeking) { seeking = false; send("seeked"); }
                        if (player.getPlayWhenReady()) send("playing");
                    } else if (state == Player.STATE_ENDED) send("ended");
                    else if (state == Player.STATE_BUFFERING) send("waiting");
                }
                @Override public void onRenderedFirstFrame() {
                    if (current() && conversion != null && !conversion.hasConverted()) send("error");
                }
                @Override public void onVideoSizeChanged(VideoSize size) {
                    if (current()) matchDisplay();
                }
                @Override public void onTracksChanged(Tracks tracks) {
                    if (current()) applyTracks(tracks);
                }
                @Override public void onPlayWhenReadyChanged(boolean ready, int reason) {
                    if (current()) send(ready ? "play" : "pause");
                }
                @Override public void onIsPlayingChanged(boolean playing) {
                    if (current() && playing) send("playing");
                }
                @Override public void onPlayerError(PlaybackException error) {
                    if (current()) send("error"); // Keep stream URLs and tokens out of diagnostics.
                }
                @Override public void onPositionDiscontinuity(Player.PositionInfo oldPosition,
                    Player.PositionInfo newPosition, int reason) {
                    if (current() && seeking && reason == Player.DISCONTINUITY_REASON_SEEK) {
                        seeking = false; send("seeked");
                    }
                }
            });
            video.setPlayer(player);
            video.setVisibility(View.VISIBLE);
            MediaItem.Builder media = new MediaItem.Builder().setUri(uri);
            ArrayList<MediaItem.SubtitleConfiguration> captions = new ArrayList<>();
            JSONArray external = tracks == null ? null : tracks.optJSONArray("external");
            if (external != null) for (int i = 0; i < Math.min(32, external.length()); i++) {
                JSONObject entry = external.getJSONObject(i);
                Uri text = Uri.parse(entry.getString("url"));
                if (!uri.getScheme().equals(text.getScheme()) || !uri.getAuthority().equals(text.getAuthority()) || text.getUserInfo() != null)
                    throw new IllegalArgumentException("Invalid subtitle origin");
                String mime = entry.getString("mime");
                if (!mime.equals("text/x-ssa") && !mime.equals("application/x-subrip") && !mime.equals("text/vtt") && !mime.equals("application/ttml+xml"))
                    throw new IllegalArgumentException("Unsupported subtitle type");
                captions.add(new MediaItem.SubtitleConfiguration.Builder(text).setMimeType(mime)
                    .setId("ember-external-" + entry.getInt("index"))
                    .setLanguage(entry.optString("language", "und")).build());
            }
            media.setSubtitleConfigurations(captions);
            player.setMediaItem(media.build());
            player.prepare();
            return;
        }
        if (id != generation) return;
        if (name.equals("close")) { release(); return; }
        if (player == null) return;
        switch (name) {
            case "mediaInfo":
                if (mediaSession != null) { mediaSession.setInfo(command.optJSONObject("media")); mediaSession.update(player, foreground); }
                break;
            case "tracks":
                JSONObject selection = command.getJSONObject("tracks");
                int previousAudio = audioTrack, previousSubtitle = subtitleTrack, previousExternal = externalSubtitle;
                audioTrack = selection.optInt("audio", -1);
                subtitleTrack = selection.optInt("subtitle", -1);
                externalSubtitle = selection.optInt("externalIndex", -1);
                tracksApplied = false;
                if (applyTracks(player.getCurrentTracks())) send("trackschanged");
                else {
                    audioTrack = previousAudio; subtitleTrack = previousSubtitle; externalSubtitle = previousExternal;
                    tracksApplied = true; send("tracksfailed");
                }
                break;
            case "play": if (foreground) player.play(); break;
            case "pause": player.pause(); break;
            case "seek":
                seeking = true;
                player.seekTo(Math.max(0, command.getLong("ms")));
                handler.post(() -> {
                    if (player != null && generation == id && seeking && player.getPlaybackState() == Player.STATE_READY) {
                        seeking = false; send("seeked");
                    }
                });
                break;
            case "rect":
                double vw = command.getDouble("viewportWidth"), vh = command.getDouble("viewportHeight");
                if (vw <= 0 || vh <= 0) return;
                double sx = web.getWidth() / vw, sy = web.getHeight() / vh;
                int width = Math.max(1, (int)Math.round(command.getDouble("width") * sx));
                int height = Math.max(1, (int)Math.round(command.getDouble("height") * sy));
                FrameLayout.LayoutParams bounds = new FrameLayout.LayoutParams(width, height);
                bounds.leftMargin = (int)Math.round(command.getDouble("left") * sx);
                bounds.topMargin = (int)Math.round(command.getDouble("top") * sy);
                video.setLayoutParams(bounds);
                video.setResizeMode(command.optBoolean("fill") ?
                    AspectRatioFrameLayout.RESIZE_MODE_ZOOM : AspectRatioFrameLayout.RESIZE_MODE_FIT);
                break;
        }
    }
    private boolean applyTracks(Tracks tracks) {
        if (tracksApplied || player == null) return true;
        TrackSelectionParameters.Builder selection = player.getTrackSelectionParameters().buildUpon()
            .clearOverridesOfType(C.TRACK_TYPE_AUDIO).clearOverridesOfType(C.TRACK_TYPE_TEXT)
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subtitleTrack < 0 && externalSubtitle < 0);
        boolean audioFound = audioTrack < 0, subtitleFound = subtitleTrack < 0 && externalSubtitle < 0;
        int audio = 0, subtitles = 0;
        for (Tracks.Group group : tracks.getGroups()) {
            for (int i = 0; i < group.length; i++) {
                if (group.getType() == C.TRACK_TYPE_AUDIO && audio++ == audioTrack && group.isTrackSupported(i)) {
                    selection.addOverride(new TrackSelectionOverride(group.getMediaTrackGroup(), i)); audioFound = true;
                }
                String trackId = group.getTrackFormat(i).id;
                boolean externalTrack = trackId != null && trackId.startsWith("ember-external-");
                boolean chosenText = externalSubtitle >= 0 ? ("ember-external-" + externalSubtitle).equals(trackId)
                    : !externalTrack && subtitles == subtitleTrack;
                if (group.getType() == C.TRACK_TYPE_TEXT && !externalTrack) subtitles++;
                if (group.getType() == C.TRACK_TYPE_TEXT && chosenText && group.isTrackSupported(i)) {
                    selection.addOverride(new TrackSelectionOverride(group.getMediaTrackGroup(), i)); subtitleFound = true;
                }
            }
        }
        if (!audioFound || !subtitleFound) return false;
        tracksApplied = true;
        player.setTrackSelectionParameters(selection.build());
        return true;
    }
    private void send(String type) {
        if (destroyed || web == null) return;
        try {
            JSONObject data = new JSONObject().put("id", generation).put("type", type);
            if (player != null) {
                if (mediaSession != null) mediaSession.update(player, foreground);
                long duration = player.getDuration();
                VideoSize size = player.getVideoSize();
                data.put("position", player.getCurrentPosition()).put("duration", duration == C.TIME_UNSET ? -1 : duration)
                    .put("live", player.isCurrentMediaItemLive()).put("paused", !player.getPlayWhenReady())
                    .put("width", size.width).put("height", size.height);
                Format format = player.getVideoFormat();
                androidx.media3.exoplayer.DecoderCounters counters = player.getVideoDecoderCounters();
                if (counters != null) counters.ensureUpdated();
                androidx.media3.exoplayer.analytics.PlaybackStats stats = playbackStats == null ? null : playbackStats.getCombinedPlaybackStats();
                Format audio = player.getAudioFormat();
                data.put("diagnostics", new JSONObject()
                    .put("bufferMs", player.getTotalBufferedDuration())
                    .put("state", player.getPlaybackState())
                    .put("dropped", counters == null ? JSONObject.NULL : counters.droppedBufferCount)
                    .put("rendered", counters == null ? JSONObject.NULL : counters.renderedOutputBufferCount)
                    .put("videoDecoder", videoDecoder).put("audioDecoder", audioDecoder)
                    .put("frameRate", format == null ? -1 : format.frameRate)
                    .put("audioMime", audio == null || audio.sampleMimeType == null ? "" : audio.sampleMimeType)
                    .put("audioChannels", audio == null ? -1 : audio.channelCount)
                    .put("rebufferCount", stats == null ? 0 : stats.totalRebufferCount)
                    .put("rebufferMs", stats == null ? 0 : stats.getTotalRebufferTimeMs()));
                if (format != null) data.put("format", new JSONObject()
                    .put("mime", format.sampleMimeType == null ? "" : format.sampleMimeType)
                    .put("codecs", format.codecs == null ? "" : format.codecs)
                    .put("colorTransfer", format.colorInfo == null ? -1 : format.colorInfo.colorTransfer));
                if (player.isCurrentMediaItemSeekable() && duration > 0)
                    data.put("seekStart", 0).put("seekEnd", duration);
            }
            web.evaluateJavascript("window.EmberFireTV && window.EmberFireTV.receive(" + data + ")", null);
        } catch (Exception ignored) { /* Activity is closing. */ }
    }
    private void release() {
        restoreDisplay();
        if (mediaSession != null) { mediaSession.release(); mediaSession = null; }
        if (assView != null) {
            video.getSubtitleView().removeView(assView);
            assView = null;
        }
        metadataSent = false;
        seeking = false;
        if (player != null) {
            video.setPlayer(null);
            ExoPlayer old = player;
            player = null;
            old.release();
        }
        if (assHandler != null) { assHandler.release(); assHandler = null; }
        video.setVisibility(View.GONE);
    }
    private void key(int code) {
        key(code, "keydown", false);
    }
    private void key(int code, String phase, boolean repeat) {
        web.evaluateJavascript("window.EmberFireTV && window.EmberFireTV.key(" + code + ",\"" + phase + "\"," + repeat + ")", null);
    }
    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        int code;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: code = 179; break;
            case KeyEvent.KEYCODE_MEDIA_PLAY: code = 415; break;
            case KeyEvent.KEYCODE_MEDIA_PAUSE: code = 19; break;
            case KeyEvent.KEYCODE_MEDIA_STOP: code = 413; break;
            case KeyEvent.KEYCODE_MEDIA_REWIND: code = 412; break;
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: code = 417; break;
            case KeyEvent.KEYCODE_MENU: code = 457; break;
            default: return super.dispatchKeyEvent(event);
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN || event.getAction() == KeyEvent.ACTION_UP)
            key(code, event.getAction() == KeyEvent.ACTION_UP ? "keyup" : "keydown", event.getRepeatCount() > 0);
        return true;
    }
    @Override public void onBackPressed() { key(27); }
    private void startVoiceSearch(int id) {
        if (destroyed || !HOME.equals(web.getUrl())) return;
        if (!foreground || voiceSearchId != 0 || player != null) {
            voiceSearchResult(id, "unavailable", "");
            return;
        }
        voiceSearchId = id;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Say a title, or say Play followed by a title")
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        try {
            startActivityForResult(intent, VOICE_SEARCH_REQUEST);
        } catch (ActivityNotFoundException | SecurityException error) {
            voiceSearchId = 0;
            voiceSearchResult(id, "unavailable", "");
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != VOICE_SEARCH_REQUEST || voiceSearchId == 0) return;
        int id = voiceSearchId;
        voiceSearchId = 0;
        if (result == RESULT_CANCELED) {
            voiceSearchResult(id, "cancelled", "");
            return;
        }
        ArrayList<String> matches = result == RESULT_OK && data != null
            ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        String title = matches == null || matches.isEmpty() || matches.get(0) == null ? "" : matches.get(0).trim();
        voiceSearchResult(id, title.isEmpty() ? "no-match" : "ok", title.substring(0, Math.min(256, title.length())));
    }
    private void voiceSearchResult(int id, String status, String title) {
        if (destroyed || !HOME.equals(web.getUrl())) return;
        try {
            JSONObject result = new JSONObject().put("id", id).put("status", status).put("title", title);
            web.evaluateJavascript("window.EmberFireTV && window.EmberFireTV.voiceSearchResult(" + result + ")", null);
        } catch (org.json.JSONException ignored) {}
    }
    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (updater != null) updater.status();
        if (web != null) web.evaluateJavascript("document.dispatchEvent(new Event('ember-system-resume'))", null);
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        synchronized (this) { pendingHomeSearch = intent; }
        setIntent(intent);
        tvHome.intent(intent);
        if (web != null) web.evaluateJavascript("document.dispatchEvent(new Event('ember-system-resume'))", null);
    }
    @Override protected void onPause() {
        foreground = false;
        restoreDisplay();
        web.evaluateJavascript("document.dispatchEvent(new Event('ember-suspend'))", null);
        if (player != null) player.pause();
        if (mediaSession != null) mediaSession.deactivate();
        super.onPause();
    }
    @Override protected void onDestroy() {
        destroyed = true;
        if (seerr != null) seerr.close();
        if (updater != null) updater.close();
        tvHome.close();
        artworkWorker.shutdownNow();
        handler.removeCallbacksAndMessages(null);
        release();
        web.removeJavascriptInterface("EmberAndroid");
        web.destroy();
        super.onDestroy();
    }
}
