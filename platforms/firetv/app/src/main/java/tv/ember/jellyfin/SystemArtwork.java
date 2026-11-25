package tv.ember.jellyfin;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import androidx.core.content.FileProvider;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

/** Authenticated artwork is cached locally. Launcher metadata never contains credentials. */
final class SystemArtwork {
    static String key(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    static File load(Context context, JSONObject request) throws Exception {
        String server = request.getString("server"), item = request.getString("item");
        URL base = new URL(server);
        if ((!base.getProtocol().equals("http") && !base.getProtocol().equals("https")) ||
            base.getUserInfo() != null || !item.matches("[a-zA-Z0-9-]{1,128}")) return null;
        File directory = new File(context.getFilesDir(), "system-artwork");
        if (!directory.isDirectory() && !directory.mkdirs()) return null;
        File file = new File(directory, key(request.getString("profile") + ":" + item) + ".jpg");
        if (file.isFile()) return file;
        HttpURLConnection connection = (HttpURLConnection) new URL(server.replaceAll("/+$", "") +
            "/Items/" + item + "/Images/Primary?maxWidth=480&quality=80").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(3000);
        connection.setReadTimeout(3000);
        String token = request.getString("token");
        if (token.contains("\r") || token.contains("\n")) return null;
        connection.setRequestProperty("X-Emby-Token", token);
        try {
            if (connection.getResponseCode() != 200) return null;
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (java.io.InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > 1048576) return null;
                    bytes.write(buffer, 0, count);
                }
            }
            byte[] encoded = bytes.toByteArray();
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(encoded, 0, encoded.length, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0 ||
                (long) bounds.outWidth * bounds.outHeight > 4000000) return null;
            Bitmap bitmap = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
            if (bitmap == null) return null;
            try (FileOutputStream output = new FileOutputStream(file)) {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output);
            } finally { bitmap.recycle(); }
            return file;
        } finally { connection.disconnect(); }
    }
    static Uri uri(Context context, File file) {
        return FileProvider.getUriForFile(context, context.getPackageName() + ".updates", file);
    }
}
