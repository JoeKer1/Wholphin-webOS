package tv.ember.jellyfin;

import android.app.SearchManager;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import java.text.Normalizer;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Supplies an opt-in, profile-scoped snapshot to Android global search without storing credentials. */
public final class HomeSearchProvider extends ContentProvider {
    private static final String[] COLUMNS = {"_id", SearchManager.SUGGEST_COLUMN_TEXT_1,
        SearchManager.SUGGEST_COLUMN_PRODUCTION_YEAR, SearchManager.SUGGEST_COLUMN_DURATION,
        SearchManager.SUGGEST_COLUMN_INTENT_DATA};
    private static final String ITEM_ID = "[a-fA-F0-9-]{32,36}";

    private static SharedPreferences catalog(Context context) {
        return context.getSharedPreferences("home-search", Context.MODE_PRIVATE);
    }
    static boolean supported(Context context) {
        return context.getPackageManager().hasSystemFeature("android.software.leanback")
            && !context.getPackageManager().hasSystemFeature("amazon.hardware.fire_tv");
    }
    static synchronized void selectProfile(Context context, String profile) {
        SharedPreferences prefs = catalog(context);
        if (!profile.equals(prefs.getString("profile", "")))
            prefs.edit().remove("items").putString("profile", profile).apply();
    }
    static synchronized void update(Context context, String profile, String items) {
        SharedPreferences prefs = catalog(context);
        if (profile.isEmpty() || !profile.equals(prefs.getString("profile", ""))) return;
        SharedPreferences.Editor change = prefs.edit().putString("items", items);
        if (!prefs.contains("secret")) change.putString("secret", UUID.randomUUID().toString());
        change.apply();
    }
    private static String linkKey(SharedPreferences prefs, String profile, String item) throws Exception {
        String secret = prefs.getString("secret", "");
        return secret.isEmpty() ? "" : SystemArtwork.key(secret + "\n" + profile + "\n" + item);
    }
    static JSONObject open(Context context, Intent intent, String profile) {
        if (!supported(context) || profile.isEmpty() || intent == null) return null;
        if (Intent.ACTION_SEARCH.equals(intent.getAction())) {
            String query = intent.getStringExtra(SearchManager.QUERY);
            if (query == null || query.trim().isEmpty() || query.length() > 256) return null;
            try { return new JSONObject().put("query", query); }
            catch (org.json.JSONException ignored) { return null; }
        }
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        Uri uri = intent.getData();
        if (uri == null || !"ember".equals(uri.getScheme()) || !"title".equals(uri.getAuthority()) ||
            uri.getPathSegments().size() != 2) return null;
        String key = uri.getPathSegments().get(0), item = uri.getPathSegments().get(1);
        if (!item.matches(ITEM_ID) || !key.matches("[a-f0-9]{64}")) return null;
        try {
            if (key.equals(linkKey(catalog(context), profile, item)))
                return new JSONObject().put("item", item)
                    .put("play", intent.getBooleanExtra("android.intent.extra.START_PLAYBACK", false));
        } catch (Exception ignored) {}
        return null;
    }
    private static String normalize(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)
            .replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
    }

    @Override public boolean onCreate() { return true; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor rows = new MatrixCursor(COLUMNS);
        Context context = getContext();
        if (context == null || !supported(context) || uri.getPathSegments().isEmpty() ||
            !SearchManager.SUGGEST_URI_PATH_QUERY.equals(uri.getPathSegments().get(0))) return rows;
        String raw = args != null && args.length > 0 ? args[0] :
            uri.getPathSegments().size() == 2 ? uri.getLastPathSegment() : "";
        if (raw == null || raw.length() > 256) return rows;
        String term = normalize(raw);
        if (term.length() < 2) return rows;
        SharedPreferences prefs = catalog(context);
        String profile = prefs.getString("profile", "");
        if (profile.isEmpty() || !prefs.contains("secret")) return rows;
        try {
            JSONArray items = new JSONArray(prefs.getString("items", "[]"));
            for (int pass = 0; pass < 2 && rows.getCount() < 20; pass++) {
                for (int i = 0; i < items.length() && rows.getCount() < 20; i++) {
                    JSONObject item = items.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id"), title = item.optString("title");
                    String normalized = normalize(title);
                    if (!id.matches(ITEM_ID) || !(pass == 0 ? normalized.equals(term)
                        : !normalized.equals(term) && normalized.contains(term))) continue;
                    rows.addRow(new Object[]{i, title, item.optInt("year"), item.optLong("duration"),
                        "ember://title/" + linkKey(prefs, profile, id) + "/" + id});
                }
            }
        } catch (Exception ignored) {}
        if (!profile.equals(prefs.getString("profile", ""))) {
            rows.close();
            return new MatrixCursor(COLUMNS);
        }
        return rows;
    }
    @Override public String getType(Uri uri) { return SearchManager.SUGGEST_MIME_TYPE; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
