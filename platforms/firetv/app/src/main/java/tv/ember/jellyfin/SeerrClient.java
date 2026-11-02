package tv.ember.jellyfin;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Seerr cookies remain in native, app-private storage and are isolated by Ember profile and server. */
final class SeerrClient {
    interface Callback { void complete(JSONObject result); }
    private final SharedPreferences storage;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Map<String, CookieManager> sessions = new HashMap<>();
    SeerrClient(Context context) { storage = context.getSharedPreferences("seerr-sessions", Context.MODE_PRIVATE); }
    SeerrClient(SharedPreferences storage) { this.storage = storage; }
    void close() { worker.shutdownNow(); }
    void request(JSONObject command, Callback callback) {
        worker.execute(() -> {
            JSONObject result = new JSONObject();
            HttpURLConnection connection = null;
            try {
                result.put("id", command.getInt("id"));
                String server = command.getString("server"), profile = command.getString("profile"), path = command.getString("path");
                URI base = new URI(server);
                if (!("http".equals(base.getScheme()) || "https".equals(base.getScheme())) || base.getHost() == null || base.getUserInfo() != null || base.getRawQuery() != null || base.getFragment() != null || server.endsWith("/") || profile.length() < 1 || profile.length() > 1024) throw new Exception();
                String method = command.optString("method", "GET");
                boolean login = path.equals("/auth/jellyfin") || path.equals("/auth/local"), logout = path.equals("/auth/logout");
                if (method.equals("POST") ? !(login || logout || path.equals("/request")) : !method.equals("GET") || !path.matches("/(auth/me|search|request|discover/(trending|movies|tv)(/upcoming)?|(movie|tv)/[1-9][0-9]{0,9})(\\?[^#\\r\\n]*)?")) throw new Exception();
                String key = hex(MessageDigest.getInstance("SHA-256").digest((profile + "\n" + server).getBytes(StandardCharsets.UTF_8)));
                URI target = new URI(server + "/api/v1" + path);
                CookieManager cookies = sessions.get(key);
                if (cookies == null) {
                    cookies = new CookieManager(null, CookiePolicy.ACCEPT_ORIGINAL_SERVER);
                    JSONArray saved = new JSONArray(storage.getString(key, "[]"));
                    for (int i = 0; i < saved.length(); i++) {
                        JSONObject item = saved.getJSONObject(i);
                        long remaining = (item.getLong("expires") - System.currentTimeMillis()) / 1000;
                        if (remaining <= 0) continue;
                        HttpCookie cookie = new HttpCookie(item.getString("name"), item.getString("value"));
                        cookie.setPath(item.optString("path", "/"));
                        cookie.setSecure(item.optBoolean("secure"));
                        cookie.setMaxAge(remaining);
                        cookie.setVersion(0);
                        cookies.getCookieStore().add(new URI(server), cookie);
                    }
                    sessions.put(key, cookies);
                }
                // A failed attempt to sign in must not retain another Seerr account's session.
                if (login || logout) { cookies.getCookieStore().removeAll(); storage.edit().remove(key).apply(); }
                if (logout) { result.put("status", 200); result.put("data", new JSONObject()); callback.complete(result); return; }
                if (method.equals("POST")) {
                    HttpURLConnection preflight = (HttpURLConnection) new URI(server + "/api/v1/status").toURL().openConnection();
                    preflight.setInstanceFollowRedirects(false); preflight.setConnectTimeout(10000); preflight.setReadTimeout(10000);
                    try {
                        for (Map.Entry<String, List<String>> header : cookies.get(new URI(server + "/api/v1/status"), new HashMap<>()).entrySet())
                            preflight.setRequestProperty(header.getKey(), join(header.getValue()));
                        if (preflight.getResponseCode() == 200) {
                            cookies.put(new URI(server + "/api/v1/status"), preflight.getHeaderFields());
                            for (HttpCookie cookie : cookies.getCookieStore().getCookies()) cookie.setVersion(0);
                        }
                    } finally { preflight.disconnect(); }
                }
                connection = (HttpURLConnection) target.toURL().openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
                connection.setRequestMethod(method);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "Ember-FireTV");
                if (method.equals("POST")) {
                    connection.setRequestProperty("Origin", base.getScheme() + "://" + base.getRawAuthority());
                    connection.setRequestProperty("Referer", server + "/");
                    for (HttpCookie cookie : cookies.getCookieStore().getCookies()) {
                        if (cookie.getName().equals("XSRF-TOKEN") && !cookie.hasExpired()) {
                            String csrf = java.net.URLDecoder.decode(cookie.getValue(), "UTF-8");
                            connection.setRequestProperty("X-XSRF-TOKEN", csrf);
                            connection.setRequestProperty("X-CSRF-Token", csrf);
                        }
                    }
                }
                for (Map.Entry<String, List<String>> header : cookies.get(target, new HashMap<>()).entrySet())
                    connection.setRequestProperty(header.getKey(), join(header.getValue()));
                if (method.equals("POST")) {
                    byte[] payload = command.optJSONObject("body").toString().getBytes(StandardCharsets.UTF_8);
                    if (payload.length > 16384) throw new Exception();
                    connection.setRequestProperty("Content-Type", "application/json");
                    connection.setDoOutput(true);
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(payload); }
                }
                int status = connection.getResponseCode();
                result.put("status", status);
                if (status >= 200 && status < 300) {
                    cookies.put(target, connection.getHeaderFields());
                    for (HttpCookie cookie : cookies.getCookieStore().getCookies()) cookie.setVersion(0);
                    JSONArray saved = new JSONArray();
                    for (HttpCookie cookie : cookies.getCookieStore().getCookies()) {
                        if (cookie.hasExpired()) continue;
                        long age = cookie.getMaxAge();
                        // Session cookies persist only while this process lives; preserve server expiry otherwise.
                        if (age < 0) continue;
                        long expires = System.currentTimeMillis() + Math.min(age, 30L * 86400) * 1000;
                        // Retain an earlier expiry rather than extending a cookie every time it is used.
                        JSONArray previous = new JSONArray(storage.getString(key, "[]"));
                        for (int i = 0; i < previous.length(); i++) {
                            JSONObject old = previous.getJSONObject(i);
                            if (cookie.getName().equals(old.optString("name")) && cookie.getValue().equals(old.optString("value"))) expires = Math.min(expires, old.getLong("expires"));
                        }
                        saved.put(new JSONObject().put("name", cookie.getName()).put("value", cookie.getValue()).put("path", cookie.getPath() == null ? "/" : cookie.getPath()).put("secure", cookie.getSecure()).put("expires", expires));
                    }
                    storage.edit().putString(key, saved.toString()).apply();
                    try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[8192]; int count;
                        while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > 2097152) throw new Exception(); bytes.write(buffer, 0, count); }
                        String text = bytes.toString("UTF-8");
                        JSONObject data = text.isEmpty() ? new JSONObject() : new JSONObject(text);
                        removeSecrets(data);
                        result.put("data", data);
                    }
                } else if (status >= 300 && status < 400) result.put("error", "Seerr redirected the request. Enter its final address, including HTTPS or any path prefix.");
                else if (status == 401 || status == 403) result.put("error", "Seerr denied access. Check your login, request permissions or quota.");
                else if (status == 409) result.put("error", "This title has already been requested.");
                else if (status == 429) result.put("error", "Too many requests. Try again shortly.");
                else result.put("error", "Seerr could not complete the request (" + status + ").");
            } catch (Exception error) {
                try { result.put("status", 0); result.put("error", "Could not connect to Seerr. Check its address and try again."); } catch (Exception ignored) {}
            } finally { if (connection != null) connection.disconnect(); }
            callback.complete(result);
        });
    }
    private static String join(List<String> values) { StringBuilder text = new StringBuilder(); for (String value : values) { if (text.length() > 0) text.append("; "); text.append(value); } return text.toString(); }
    private static String hex(byte[] data) { StringBuilder value = new StringBuilder(); for (byte b : data) value.append(String.format("%02x", b & 255)); return value.toString(); }
    private static void removeSecrets(Object data) throws Exception {
        if (data instanceof JSONArray) { JSONArray list = (JSONArray) data; for (int i = 0; i < list.length(); i++) removeSecrets(list.get(i)); }
        else if (data instanceof JSONObject) {
            JSONObject object = (JSONObject) data;
            java.util.ArrayList<String> keys = new java.util.ArrayList<>(); object.keys().forEachRemaining(keys::add);
            for (String key : keys) {
                String lower = key.toLowerCase(java.util.Locale.ROOT);
                if (lower.contains("password") || lower.contains("token") || lower.contains("cookie") || lower.contains("apikey")) object.remove(key);
                else removeSecrets(object.get(key));
            }
        }
    }
}
