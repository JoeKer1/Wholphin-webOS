package tv.ember.jellyfin;

import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.tv.TvContract;
import android.net.Uri;
import android.os.Build;
import java.io.File;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONObject;

/** Publishes only the active profile's resumable videos to Android TV's Watch Next provider. */
final class TvHomeIntegration {
    private final Context context;
    private final SharedPreferences links;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String profile = "";
    private volatile String status = "Not synced yet";
    private String pendingValue = "";

    TvHomeIntegration(Context context) {
        this.context = context;
        links = context.getSharedPreferences("watch-next-links", Context.MODE_PRIVATE);
        profile = links.getString("_profile", "");
    }
    void profile(String value) {
        if (value.equals(profile)) return;
        profile = value;
        worker.execute(() -> {
            clearRows();
            links.edit().clear().putString("_profile", value).apply();
            File directory = new File(context.getFilesDir(), "system-artwork");
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) file.delete();
        });
    }
    private void clearRows() {
        if (Build.VERSION.SDK_INT < 26) return;
        try (Cursor rows = context.getContentResolver().query(TvContract.WatchNextPrograms.CONTENT_URI,
                new String[]{"_id", "package_name"}, null, null, null)) {
            if (rows == null) return;
            while (rows.moveToNext()) if (context.getPackageName().equals(rows.getString(1)))
                context.getContentResolver().delete(ContentUris.withAppendedId(TvContract.WatchNextPrograms.CONTENT_URI, rows.getLong(0)), null, null);
        } catch (RuntimeException ignored) { status = "Launcher provider unavailable"; }
    }
    void sync(JSONObject request) {
        final String owner = request.optString("profile");
        if (!owner.equals(profile) || owner.isEmpty()) return;
        worker.execute(() -> {
            if (!owner.equals(profile) || Build.VERSION.SDK_INT < 26) return;
            try {
                JSONArray items = request.getJSONArray("items");
                Set<String> keep = new HashSet<>();
                for (int i = 0; i < Math.min(items.length(), 12); i++) {
                    if (!owner.equals(profile)) return;
                    JSONObject item = items.getJSONObject(i);
                    String key = SystemArtwork.key(owner + ":" + item.getString("id"));
                    keep.add(key);
                    JSONObject art = new JSONObject(request.toString()).put("item", item.optString("artworkItem", item.getString("id")));
                    File image = null;
                    try { image = SystemArtwork.load(context, art); } catch (Exception ignored) {}
                    if (!owner.equals(profile)) return;
                    ContentValues values = new ContentValues();
                    values.put("internal_provider_id", key);
                    values.put("watch_next_type", 0);
                    values.put("type", item.optBoolean("episode") ? 3 : 0);
                    values.put("title", item.getString("title"));
                    values.put("short_description", item.optString("subtitle"));
                    values.put("last_engagement_time_utc_millis", System.currentTimeMillis() - i);
                    values.put("last_playback_position_millis", item.optLong("position"));
                    values.put("duration_millis", item.optLong("duration"));
                    values.put("intent_uri", new Intent(context, MainActivity.class)
                        .setAction(Intent.ACTION_VIEW).setData(Uri.parse("ember://resume/" + key))
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP).toUri(Intent.URI_INTENT_SCHEME));
                    if (image != null) {
                        Uri uri = SystemArtwork.uri(context, image);
                        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
                        for (android.content.pm.ResolveInfo target : context.getPackageManager().queryIntentActivities(home, 0))
                            context.grantUriPermission(target.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        values.put("poster_art_uri", uri.toString());
                    }
                    Uri existing = null;
                    try (Cursor rows = context.getContentResolver().query(TvContract.WatchNextPrograms.CONTENT_URI,
                            new String[]{"_id", "package_name", "internal_provider_id"}, null, null, null)) {
                        if (rows != null) while (rows.moveToNext())
                            if (context.getPackageName().equals(rows.getString(1)) && key.equals(rows.getString(2)))
                                existing = ContentUris.withAppendedId(TvContract.WatchNextPrograms.CONTENT_URI, rows.getLong(0));
                    }
                    // Store only the item and profile identity. Tokens never enter launcher rows or links.
                    links.edit().putString(key, new JSONObject().put("profile", owner).put("item", item.getString("id")).toString()).apply();
                    if (existing == null) context.getContentResolver().insert(TvContract.WatchNextPrograms.CONTENT_URI, values);
                    else context.getContentResolver().update(existing, values, null, null);
                }
                try (Cursor rows = context.getContentResolver().query(TvContract.WatchNextPrograms.CONTENT_URI,
                        new String[]{"_id", "package_name", "internal_provider_id"}, null, null, null)) {
                    if (rows != null) while (rows.moveToNext()) {
                        String key = rows.getString(2);
                        if (context.getPackageName().equals(rows.getString(1)) && !keep.contains(key)) {
                            context.getContentResolver().delete(ContentUris.withAppendedId(TvContract.WatchNextPrograms.CONTENT_URI, rows.getLong(0)), null, null);
                            links.edit().remove(key).apply();
                        }
                    }
                }
                status = "Synced to Watch Next provider";
                File[] artwork = new File(context.getFilesDir(), "system-artwork").listFiles();
                if (artwork != null && artwork.length > 36) {
                    java.util.Arrays.sort(artwork, java.util.Comparator.comparingLong(File::lastModified));
                    for (int i = 0; i < artwork.length - 36; i++) artwork[i].delete();
                }
            } catch (Exception ignored) { status = "Launcher provider unavailable"; }
        });
    }
    synchronized void intent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri != null && "ember".equals(uri.getScheme()) && "resume".equals(uri.getHost()) &&
            uri.getLastPathSegment() != null && uri.getLastPathSegment().matches("[a-f0-9]{64}"))
            pendingValue = links.getString(uri.getLastPathSegment(), "");
    }
    synchronized String takeResume(String owner) {
        try {
            String value = pendingValue;
            if (!value.isEmpty() && new JSONObject(value).optString("profile").equals(owner)) {
                pendingValue = "";
                return value;
            }
        } catch (Exception ignored) {}
        return "";
    }
    String status() { return status; }
    void close() { worker.shutdownNow(); }
}
