package tv.ember.jellyfin;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
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
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private SeerrClient seerr;
    private PlayerView video;
    private ExoPlayer player;
    private AssHandler assHandler;
    private AssSubtitleView assView;
    private int externalSubtitle = -1;
    private int generation;
    private boolean destroyed, metadataSent, seeking;
    private boolean foreground;
    private int audioTrack = -1, subtitleTrack = -1;
    private boolean tracksApplied;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
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
            return PlaybackCapabilities.read(MainActivity.this).toString();
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
            DefaultRenderersFactory renderers = new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
            assHandler = new AssHandler(AssRenderType.OVERLAY_CANVAS, new AssHandlerConfig(10000, 128, 1920 * 1080));
            AssSubtitleParserFactory parser = new AssSubtitleParserFactory(assHandler);
            DefaultMediaSourceFactory sources = new DefaultMediaSourceFactory(new DefaultDataSource.Factory(this),
                AssPlayerKt.withAssMkvSupport(new DefaultExtractorsFactory(), parser, assHandler))
                .setSubtitleParserFactory(parser);
            player = new ExoPlayer.Builder(this, new AssRenderersFactory(assHandler, renderers))
                .setMediaSourceFactory(sources).build();
            assHandler.init(player);
            assView = new AssSubtitleView(this, assHandler);
            video.getSubtitleView().addView(assView, new FrameLayout.LayoutParams(-1, -1));
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            player.setHandleAudioBecomingNoisy(true);
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, subtitleTrack < 0 && externalSubtitle < 0).build());
            final int token = generation;
            player.addListener(new Player.Listener() {
                private boolean current() { return player != null && token == generation; }
                @Override public void onPlaybackStateChanged(int state) {
                    if (!current()) return;
                    if (state == Player.STATE_READY) {
                        if (!applyTracks(player.getCurrentTracks())) { send("error"); return; }
                        if (!metadataSent) { metadataSent = true; send("loadedmetadata"); }
                        if (seeking) { seeking = false; send("seeked"); }
                        if (player.getPlayWhenReady()) send("playing");
                    } else if (state == Player.STATE_ENDED) send("ended");
                    else if (state == Player.STATE_BUFFERING) send("waiting");
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
                long duration = player.getDuration();
                VideoSize size = player.getVideoSize();
                data.put("position", player.getCurrentPosition()).put("duration", duration == C.TIME_UNSET ? -1 : duration)
                    .put("live", player.isCurrentMediaItemLive()).put("paused", !player.getPlayWhenReady())
                    .put("width", size.width).put("height", size.height);
                if (player.isCurrentMediaItemSeekable() && duration > 0)
                    data.put("seekStart", 0).put("seekEnd", duration);
            }
            web.evaluateJavascript("window.EmberFireTV && window.EmberFireTV.receive(" + data + ")", null);
        } catch (Exception ignored) { /* Activity is closing. */ }
    }
    private void release() {
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
        web.evaluateJavascript("window.EmberFireTV && window.EmberFireTV.key(" + code + ")", null);
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
        if (event.getAction() == KeyEvent.ACTION_DOWN) key(code);
        return true;
    }
    @Override public void onBackPressed() { key(27); }
    @Override protected void onResume() {
        super.onResume();
        foreground = true;
    }
    @Override protected void onPause() {
        foreground = false;
        web.evaluateJavascript("document.dispatchEvent(new Event('ember-suspend'))", null);
        if (player != null) player.pause();
        super.onPause();
    }
    @Override protected void onDestroy() {
        destroyed = true;
        if (seerr != null) seerr.close();
        handler.removeCallbacksAndMessages(null);
        release();
        web.removeJavascriptInterface("EmberAndroid");
        web.destroy();
        super.onDestroy();
    }
}
