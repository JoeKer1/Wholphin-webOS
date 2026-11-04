package tv.ember.jellyfin;

import java.util.Locale;
import org.json.JSONObject;

/** Classify request failures without displaying arbitrary server output or secrets. */
final class RequestErrors {
    static String message(int status, String body) {
        String reason = "";
        try { reason = new JSONObject(body).optString("message", "").toLowerCase(Locale.ROOT); } catch (Exception ignored) {}
        if (status == 401) return "Your Seerr session has expired. Sign in to Seerr again.";
        if (status == 409) return "This title or these seasons have already been requested. Refresh this title to see their status.";
        if (status == 403 && reason.contains("quota")) return "Your Seerr request quota has been reached. Try again after it resets or contact your server administrator.";
        if (status == 403 && (reason.contains("blocklist") || reason.contains("blocklisted"))) return "This title is blocked from requests by your Seerr server.";
        if (status == 403) return "Seerr did not allow this request. Refresh the title to check your permissions; your server may also apply request limits.";
        if (status == 429) return "Seerr is receiving too many requests. Wait a moment and try again.";
        return "Seerr request failed (HTTP " + status + "). Try again or check the Seerr server.";
    }
}
