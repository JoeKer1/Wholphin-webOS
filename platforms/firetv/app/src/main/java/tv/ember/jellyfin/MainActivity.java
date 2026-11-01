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
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

/** Bundled Ember UI over native video; remote pages cannot navigate into the bridge. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class MainActivity extends Activity {
    private static final String HOME = "https://appassets.androidplatform.net/assets/index.html";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private PlayerView video;
    private ExoPlayer player;
    private int generation;
    private boolean destroyed, metadataSent, seeking;
    private boolean foreground;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN |
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        setContentView(R.layout.main);
        video = findViewById(R.id.native_player);
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
            player = new ExoPlayer.Builder(this).build();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
            player.setHandleAudioBecomingNoisy(true);
            player.setTrackSelectionParameters(player.getTrackSelectionParameters().buildUpon()
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true).build());
            final int token = generation;
            player.addListener(new Player.Listener() {
                private boolean current() { return player != null && token == generation; }
                @Override public void onPlaybackStateChanged(int state) {
                    if (!current()) return;
                    if (state == Player.STATE_READY) {
                        if (!metadataSent) { metadataSent = true; send("loadedmetadata"); }
                        if (seeking) { seeking = false; send("seeked"); }
                        if (player.getPlayWhenReady()) send("playing");
                    } else if (state == Player.STATE_ENDED) send("ended");
                    else if (state == Player.STATE_BUFFERING) send("waiting");
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
            player.setMediaItem(MediaItem.fromUri(uri));
            player.prepare();
            return;
        }
        if (id != generation) return;
        if (name.equals("close")) { release(); return; }
        if (player == null) return;
        switch (name) {
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
        metadataSent = false;
        seeking = false;
        if (player != null) {
            video.setPlayer(null);
            ExoPlayer old = player;
            player = null;
            old.release();
        }
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
        handler.removeCallbacksAndMessages(null);
        release();
        web.removeJavascriptInterface("EmberAndroid");
        web.destroy();
        super.onDestroy();
    }
}
