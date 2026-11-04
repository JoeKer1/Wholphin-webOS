package tv.ember.jellyfin;
public final class RequestErrorsTest {
    public static void main(String[] args) {
        if (!RequestErrors.message(403,"{\"message\":\"Request quota exceeded\"}").contains("quota")) throw new AssertionError("quota");
        if (!RequestErrors.message(403,"{\"message\":\"Media is blocklisted\"}").contains("blocked")) throw new AssertionError("blocklist");
        if (!RequestErrors.message(409,"{}").contains("already")) throw new AssertionError("duplicate");
        if (!RequestErrors.message(401,"{}").contains("expired")) throw new AssertionError("session");
        if (RequestErrors.message(403,"{\"message\":\"api_key=private\"}").contains("private")) throw new AssertionError("leak");
        if (RequestErrors.message(500,"secret html").contains("secret")) throw new AssertionError("leak");
        System.out.println("PASS request error classification and secret-safe messages");
    }
}
