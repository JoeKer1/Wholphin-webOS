package tv.ember.jellyfin;

import android.content.SharedPreferences;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import java.lang.reflect.Proxy;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Runs the real cookie transport against a local fixture; no real media requests. */
public final class SeerrClientTest {
    private static int nextId;
    private static JSONObject call(SeerrClient client, String server, String profile, String path, JSONObject body) throws Exception {
        CompletableFuture<JSONObject> response = new CompletableFuture<>();
        client.request(new JSONObject().put("id", ++nextId).put("server", server).put("profile", profile).put("path", path).put("method", body == null ? "GET" : "POST").put("body", body), response::complete);
        return response.get(5, TimeUnit.SECONDS);
    }
    private static void check(boolean value, String reason) { if (!value) throw new AssertionError(reason); }
    private static SharedPreferences storage() {
        Map<String, String> data = new HashMap<>();
        Object editor = Proxy.newProxyInstance(SeerrClientTest.class.getClassLoader(), new Class[]{SharedPreferences.Editor.class}, (proxy, method, args) -> {
            switch (method.getName()) {
                case "putString": data.put((String) args[0], (String) args[1]); return proxy;
                case "remove": data.remove(args[0]); return proxy;
                case "apply": return null;
                case "commit": return true;
                default: throw new UnsupportedOperationException(method.getName());
            }
        });
        return (SharedPreferences) Proxy.newProxyInstance(SeerrClientTest.class.getClassLoader(), new Class[]{SharedPreferences.class}, (proxy, method, args) -> {
            if (method.getName().equals("getString")) return data.getOrDefault(args[0], (String) args[1]);
            if (method.getName().equals("edit")) return editor;
            throw new UnsupportedOperationException(method.getName());
        });
    }
    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        final int[] requests = {0}, writes = {0};
        server.createContext("/", exchange -> {
            requests[0]++;
            String route = exchange.getRequestURI().getPath(), body = "{}";
            int status = 200;
            String cookie = exchange.getRequestHeaders().getFirst("Cookie");
            if (route.equals("/api/v1/status")) {
                exchange.getResponseHeaders().add("Set-Cookie", "XSRF-TOKEN=fixture-csrf; Path=/; Max-Age=3600");
            } else if (route.equals("/api/v1/auth/local")) {
                check("fixture-csrf".equals(exchange.getRequestHeaders().getFirst("X-XSRF-TOKEN")), "CSRF header is supplied");
                String raw = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                String user = new JSONObject(raw).getString("email");
                if (new JSONObject(raw).getString("password").equals("correct")) {
                    exchange.getResponseHeaders().add("Set-Cookie", "seerr.sid=" + user + "; HttpOnly; Path=/; Max-Age=3600");
                    body = "{\"id\":7,\"jellyfinAuthToken\":\"must-not-leak\",\"nested\":{\"apiKey\":\"private\"}}";
                } else status = 403;
            } else if (cookie == null || !cookie.contains("seerr.sid=")) status = 403;
            else if (route.equals("/api/v1/auth/me")) body = "{\"id\":7,\"permissions\":32,\"username\":\"" + (cookie.contains("seerr.sid=alice") ? "alice" : "bob") + "\"}";
            else if (route.equals("/api/v1/movie/99")) { status = 302; exchange.getResponseHeaders().add("Location", "/unexpected"); }
            else if (route.equals("/api/v1/request")) {
                check("fixture-csrf".equals(exchange.getRequestHeaders().getFirst("X-XSRF-TOKEN")), "Request CSRF header"); writes[0]++; body = "{\"id\":123,\"status\":1}";
            } else body = "{\"results\":[]}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        SharedPreferences prefs = storage();
        SeerrClient client = new SeerrClient(prefs), restored = null;
        String url = "http://127.0.0.1:" + server.getAddress().getPort();
        try {
            JSONObject login = new JSONObject().put("email", "alice").put("password", "correct");
            JSONObject result = call(client, url, "profile-a", "/auth/local", login);
            check(result.getInt("status") == 200, "Native login succeeds");
            check(!result.toString().contains("must-not-leak") && !result.toString().contains("private"), "Tokens do not reach JavaScript");
            check(call(client, url, "profile-a", "/auth/me", null).getJSONObject("data").getString("username").equals("alice"), "Cookie authentication succeeds");
            check(call(client, url, "profile-b", "/auth/me", null).getInt("status") == 403, "Second Ember profile cannot reuse first profile cookie");
            check(call(client, url, "profile-b", "/auth/local", new JSONObject().put("email", "bob").put("password", "correct")).getInt("status") == 200, "Independent second login");
            check(call(client, url, "profile-a", "/request", new JSONObject().put("mediaType", "tv").put("mediaId", 12).put("seasons", new org.json.JSONArray().put(2))).getInt("status") == 200 && writes[0] == 1, "Native request succeeds with session and CSRF");
            restored = new SeerrClient(prefs);
            check(call(restored, url, "profile-a", "/auth/me", null).getInt("status") == 200, "Cookie restored after app process restart");
            int before = requests[0];
            check(call(client, url, "profile-a", "/settings/main", null).getInt("status") == 0 && requests[0] == before, "Native bridge rejects non-allowlisted routes");
            check(call(client, "file:///etc", "profile-a", "/auth/me", null).getInt("status") == 0, "Reject file URLs");
            check(call(client, url, "profile-a", "/movie/99", null).getInt("status") == 302, "Authenticated redirects are not followed");
            check(call(client, url, "profile-a", "/auth/local", new JSONObject().put("email", "wrong").put("password", "wrong")).getInt("status") == 403, "Failed login returns access error");
            check(call(client, url, "profile-a", "/auth/me", null).getInt("status") == 403, "Failed login does not retain previous account session");
            check(call(client, url, "profile-b", "/auth/me", null).getInt("status") == 200, "Other profile is unaffected");
            call(client, url, "profile-b", "/auth/logout", new JSONObject());
            check(call(client, url, "profile-b", "/auth/me", null).getInt("status") == 403, "Disconnect clears only this profile's cookie");
            System.out.println("PASS real native Seerr HTTP: CSRF, login, cookie persistence and profile isolation, requests, secret stripping, redirect and endpoint restrictions, failed-login cleanup and disconnect");
        } finally { client.close(); if (restored != null) restored.close(); server.stop(0); }
    }
}
