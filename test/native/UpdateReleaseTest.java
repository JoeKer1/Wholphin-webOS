package tv.ember.jellyfin;
import org.json.JSONArray;
import org.json.JSONObject;
public final class UpdateReleaseTest {
    private static JSONObject release() throws Exception {
        return new JSONObject().put("tag_name", "v0.2.91").put("assets", new JSONArray().put(new JSONObject()
            .put("name", "ember-firetv-0.2.91-debug.apk").put("size", 22000000)
            .put("digest", "sha256:" + new String(new char[64]).replace('\0','a'))
            .put("browser_download_url", "https://github.com/JoeKer1/Wholphin-webOS/releases/download/v0.2.91/ember-firetv-0.2.91-debug.apk")));
    }
    private static void rejects(JSONObject release) throws Exception {
        try { UpdateRelease.select(release, 20090); } catch (Exception expected) { return; }
        throw new AssertionError("Unsafe or incompatible release accepted");
    }
    public static void main(String[] args) throws Exception {
        if (UpdateRelease.versionCode("0.2.91") != 20091 || UpdateRelease.versionCode("0.2.91-beta") != -1) throw new AssertionError();
        JSONObject result = UpdateRelease.select(release(), 20090);
        if (!result.getString("version").equals("0.2.91")) throw new AssertionError();
        if (UpdateRelease.select(release(),20091) != null || UpdateRelease.select(release().put("prerelease",true),20090) != null) throw new AssertionError();
        for (String field : new String[]{"digest", "browser_download_url", "name"}) {
            JSONObject bad = release(); bad.getJSONArray("assets").getJSONObject(0).put(field,"untrusted"); rejects(bad);
        }
        JSONObject huge = release(); huge.getJSONArray("assets").getJSONObject(0).put("size", 200000000); rejects(huge);
        rejects(release().put("tag_name", "v99.0.0"));
        System.out.println("Update release policy passed: newer versions, stable channel, fixed origin, correct asset, size and digest");
    }
}
