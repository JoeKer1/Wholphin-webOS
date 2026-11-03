package tv.ember.jellyfin;
import org.json.JSONArray;
import org.json.JSONObject;

/** Release metadata validation shared by the updater and JVM regression tests. */
final class UpdateRelease {
    static final String REPO = "https://github.com/JoeKer1/Wholphin-webOS";
    static int versionCode(String version) {
        if (!version.matches("[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,4}")) return -1;
        String[] p = version.split("\\.");
        return Integer.parseInt(p[0]) * 1000000 + Integer.parseInt(p[1]) * 10000 + Integer.parseInt(p[2]);
    }
    static JSONObject select(JSONObject release, int installed) throws Exception {
        if (release.optBoolean("draft") || release.optBoolean("prerelease")) return null;
        String tag = release.optString("tag_name");
        String version = tag.startsWith("v") ? tag.substring(1) : tag;
        if (versionCode(version) < 0) throw new Exception("Invalid version");
        if (versionCode(version) <= installed) return null;
        JSONArray assets = release.getJSONArray("assets");
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            String name = "ember-firetv-" + version + "-debug.apk";
            if (!name.equals(asset.optString("name"))) continue;
            String url = REPO + "/releases/download/" + tag + "/" + name;
            long size = asset.optLong("size");
            if (!url.equals(asset.optString("browser_download_url")) || size <= 0 || size > 150000000 ||
                !asset.optString("digest").matches("sha256:[a-fA-F0-9]{64}")) throw new Exception("Invalid release asset");
            return new JSONObject().put("version", version).put("url", url).put("size", size).put("digest", asset.getString("digest").substring(7));
        }
        throw new Exception("No compatible Fire TV asset");
    }
}
