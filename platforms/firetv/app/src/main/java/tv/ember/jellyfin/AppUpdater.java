package tv.ember.jellyfin;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Fixed public release source; no session headers, arbitrary URLs, or silent installs. */
final class AppUpdater {
    interface Listener { void changed(JSONObject state); }
    private static final String LATEST = "https://api.github.com/repos/JoeKer1/Wholphin-webOS/releases/latest";
    private final Activity activity;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final File apk;
    private volatile boolean closed, busy;
    private volatile HttpURLConnection connection;
    private String state = "idle", message = "", version = "";
    private JSONObject asset;

    AppUpdater(Activity activity, Listener listener) {
        this.activity = activity; this.listener = listener;
        File directory = new File(activity.getCacheDir(), "updates");
        directory.mkdirs(); apk = new File(directory, "ember-update.apk");
        apk.delete(); // Never reuse an unverified file after process restart.
    }
    void close() {
        closed = true;
        HttpURLConnection active = connection;
        if (active != null) active.disconnect();
        worker.shutdownNow();
    }
    void status() { publish(); }
    private void publish() {
        if (closed) return;
        try {
            JSONObject data = new JSONObject().put("state", state).put("message", message)
                .put("installed", BuildConfig.VERSION_NAME).put("version", version)
                .put("canInstall", Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls());
            listener.changed(data);
        } catch (Exception ignored) {}
    }
    private void set(String next, String text) {
        activity.runOnUiThread(() -> { if (!closed) { state = next; message = text; publish(); } });
    }
    void command(String action) {
        if (closed) return;
        if (action.equals("status")) { publish(); return; }
        if (busy) return;
        if (action.equals("permission")) {
            if (Build.VERSION.SDK_INT >= 26) try {
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            } catch (Exception e) { set("ready", "Enable Ember under Fire TV Settings → Developer Options → Install unknown apps, then return and try again."); }
            return;
        }
        if (action.equals("install") && state.equals("ready")) {
            try {
                verify();
                if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
                    set("ready", "Allow Ember to install apps, then select Install update again."); return;
                }
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
                activity.startActivity(new Intent(Intent.ACTION_INSTALL_PACKAGE).setData(uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
            } catch (Exception e) { set("error", "The installer could not open this verified update. Check Fire TV app-install permissions, then check for updates again."); }
            return;
        }
        if (!action.equals("check") && !(action.equals("download") && asset != null && state.equals("available"))) return;
        busy = true;
        boolean check = action.equals("check");
        state = check ? "checking" : "downloading"; message = check ? "Checking GitHub Releases…" : "Downloading update…"; publish();
        worker.execute(() -> {
            try {
                if (check) check(); else download();
            } catch (Exception e) {
                apk.delete();
                set("error", check ? "Could not check GitHub Releases. Check your connection and try again." : "Update download or verification failed. Nothing was installed. Check for updates to retry.");
            } finally { busy = false; }
        });
    }
    private HttpURLConnection open(String address) throws Exception {
        for (int redirects = 0; redirects < 5; redirects++) {
            URL url = new URL(address);
            if (!url.getProtocol().equals("https") || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443) ||
                !(url.getHost().equals("api.github.com") || url.getHost().equals("github.com") || url.getHost().equals("release-assets.githubusercontent.com") || url.getHost().equals("objects.githubusercontent.com"))) throw new Exception("Invalid update origin");
            HttpURLConnection request = (HttpURLConnection)url.openConnection(); connection = request;
            request.setConnectTimeout(15000); request.setReadTimeout(30000); request.setInstanceFollowRedirects(false);
            request.setRequestProperty("User-Agent", "Ember-FireTV/" + BuildConfig.VERSION_NAME);
            int code = request.getResponseCode();
            if (code >= 300 && code <= 399) { String next = request.getHeaderField("Location"); request.disconnect(); address = new URL(url, next).toString(); continue; }
            return request;
        }
        throw new Exception("Too many redirects");
    }
    private void check() throws Exception {
        asset = null; version = ""; apk.delete();
        HttpURLConnection request = open(LATEST);
        try {
            if (request.getResponseCode() == 404) { set("current", "No published Fire TV updates yet."); return; }
            if (request.getResponseCode() != 200) throw new Exception();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream in = request.getInputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = in.read(buffer)) != -1) { if (closed || body.size() + count > 1000000) throw new Exception(); body.write(buffer, 0, count); }
            }
            asset = UpdateRelease.select(new JSONObject(body.toString("UTF-8")), BuildConfig.VERSION_CODE);
            if (asset == null) set("current", "Ember is up to date.");
            else { version = asset.getString("version"); set("available", "Ember " + version + " is available."); }
        } finally { request.disconnect(); connection = null; }
    }
    private void download() throws Exception {
        HttpURLConnection request = open(asset.getString("url"));
        try {
            if (request.getResponseCode() != 200) throw new Exception();
            long expected = asset.getLong("size"), total = 0, last = 0;
            try (InputStream in = request.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                byte[] buffer = new byte[65536]; int count;
                while ((count = in.read(buffer)) != -1) {
                    total += count;
                    if (closed || Thread.currentThread().isInterrupted() || total > expected) throw new Exception();
                    out.write(buffer, 0, count);
                    if (System.currentTimeMillis() - last > 1000) { set("downloading", "Downloading update… " + total * 100 / expected + "%"); last = System.currentTimeMillis(); }
                }
                out.getFD().sync();
            }
            if (total != expected) throw new Exception();
            verify();
            set("ready", "Update verified. Select Install update to open the Fire TV installer. Your sign-in and settings will be kept.");
        } finally { request.disconnect(); connection = null; }
    }
    @SuppressWarnings("deprecation")
    private void verify() throws Exception {
        if (asset == null || !apk.isFile() || apk.length() != asset.getLong("size")) throw new Exception();
        MessageDigest hash = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(apk)) { byte[] bytes = new byte[65536]; int n; while ((n = in.read(bytes)) != -1) hash.update(bytes, 0, n); }
        StringBuilder digest = new StringBuilder(); for (byte b : hash.digest()) digest.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        if (!digest.toString().equalsIgnoreCase(asset.getString("digest"))) throw new Exception();
        PackageManager pm = activity.getPackageManager();
        PackageInfo candidate = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNATURES);
        PackageInfo current = pm.getPackageInfo(activity.getPackageName(), PackageManager.GET_SIGNATURES);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName) ||
            candidate.applicationInfo == null || candidate.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT ||
            candidate.versionCode <= current.versionCode || candidate.versionCode != UpdateRelease.versionCode(asset.getString("version")) ||
            !asset.getString("version").equals(candidate.versionName) || !sameSigners(current.signatures, candidate.signatures)) throw new Exception();
    }
    static boolean sameSigners(Signature[] current, Signature[] candidate) {
        return current != null && candidate != null && current.length > 0 && current.length == candidate.length &&
            Arrays.asList(current).containsAll(Arrays.asList(candidate));
    }
}
