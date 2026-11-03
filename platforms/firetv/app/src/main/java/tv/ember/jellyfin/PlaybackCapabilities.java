package tv.ember.jellyfin;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Build;
import android.view.Display;
import android.view.WindowManager;
import androidx.media3.exoplayer.audio.AudioCapabilities;
import org.json.JSONArray;
import org.json.JSONObject;

/** Conservative decoder limits plus Media3's current HDMI/Fire OS audio route. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class PlaybackCapabilities {
    private static JSONArray videoCache;

    static synchronized JSONObject read(Context context) {
        JSONObject result = new JSONObject();
        try {
            MediaCodecInfo[] decoders = new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos();
            if (videoCache == null) {
                videoCache = new JSONArray();
                String[][] formats = {{"h264", "video/avc"}, {"hevc", "video/hevc"},
                    {"vp9", "video/x-vnd.on2.vp9"}, {"av1", "video/av01"}};
                for (String[] format : formats) {
                    JSONObject best = null;
                    for (MediaCodecInfo decoder : decoders) {
                        if (decoder.isEncoder() || !hardware(decoder)) continue;
                        try {
                            MediaCodecInfo.CodecCapabilities caps = decoder.getCapabilitiesForType(format[1]);
                            if (caps.isFeatureRequired(MediaCodecInfo.CodecCapabilities.FEATURE_SecurePlayback) ||
                                caps.isFeatureRequired(MediaCodecInfo.CodecCapabilities.FEATURE_TunneledPlayback)) continue;
                            MediaCodecInfo.VideoCapabilities video = caps.getVideoCapabilities();
                            if (video == null) continue;
                            for (int[] size : new int[][] {{3840,2160}, {1920,1080}, {1280,720}}) {
                                if (!video.areSizeAndRateSupported(size[0], size[1], 30)) continue;
                                int bits = 8, level = 0;
                                for (MediaCodecInfo.CodecProfileLevel p : caps.profileLevels) {
                                    if (format[0].equals("hevc") && p.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10) bits = 10;
                                    if (format[0].equals("vp9") && p.profile == MediaCodecInfo.CodecProfileLevel.VP9Profile2) bits = 10;
                                    if (Build.VERSION.SDK_INT >= 29 && format[0].equals("av1") && p.profile == MediaCodecInfo.CodecProfileLevel.AV1ProfileMain10) bits = 10;
                                    if (format[0].equals("h264")) level = Math.max(level, avcLevel(p.level));
                                    if (format[0].equals("hevc")) level = Math.max(level, hevcLevel(p.level));
                                }
                                if ((format[0].equals("h264") || format[0].equals("hevc")) && level == 0) continue;
                                JSONObject candidate = new JSONObject().put("codec", format[0])
                                    .put("width", size[0]).put("height", size[1]).put("bitDepth", bits)
                                    .put("frameRate", video.areSizeAndRateSupported(size[0], size[1], 60) ? 60 : 30)
                                    .put("bitrate", Math.min(80000000, video.getBitrateRange().getUpper()))
                                    .put("level", level);
                                if (best == null || size[0] > best.getInt("width") ||
                                    (size[0] == best.getInt("width") && bits > best.getInt("bitDepth"))) best = candidate;
                                break;
                            }
                        } catch (Exception ignored) { /* This decoder does not support this MIME/profile. */ }
                    }
                    if (best != null) videoCache.put(best);
                }
            }
            JSONArray audio = new JSONArray();
            JSONObject audioChannels = new JSONObject();
            AudioCapabilities output = AudioCapabilities.getCapabilities(context);
            String[][] formats = {{"aac","audio/mp4a-latm"}, {"mp3","audio/mpeg"},
                {"flac","audio/flac"}, {"opus","audio/opus"}, {"vorbis","audio/vorbis"},
                {"ac3","audio/ac3"}, {"eac3","audio/eac3"}};
            for (String[] format : formats) {
                boolean supported = format[0].equals("ac3") && output.supportsEncoding(AudioFormat.ENCODING_AC3) ||
                    format[0].equals("eac3") && output.supportsEncoding(AudioFormat.ENCODING_E_AC3);
                int channels = supported ? output.getMaxChannelCount() : 2;
                for (MediaCodecInfo decoder : decoders) {
                    if (decoder.isEncoder()) continue;
                    for (String mime : decoder.getSupportedTypes()) if (mime.equalsIgnoreCase(format[1])) {
                        supported = true;
                        channels = Math.max(channels, decoder.getCapabilitiesForType(mime).getAudioCapabilities().getMaxInputChannelCount());
                    }
                }
                if (supported) {
                    audio.put(format[0]);
                    audioChannels.put(format[0], Math.max(2, Math.min(8, channels)));
                }
            }
            boolean surround = output.supportsEncoding(AudioFormat.ENCODING_AC3) || output.supportsEncoding(AudioFormat.ENCODING_E_AC3);
            JSONArray ranges = new JSONArray().put("SDR");
            WindowManager manager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            Display.Mode currentMode = manager.getDefaultDisplay().getMode();
            boolean matchRate = false, matchResolution = false;
            for (Display.Mode mode : manager.getDefaultDisplay().getSupportedModes()) {
                matchRate |= Math.abs(mode.getRefreshRate() - currentMode.getRefreshRate()) > 0.02;
                matchResolution |= mode.getPhysicalWidth() != currentMode.getPhysicalWidth() || mode.getPhysicalHeight() != currentMode.getPhysicalHeight();
            }
            result.put("displayMatching", new JSONObject().put("rate", matchRate).put("resolution", matchResolution));
            for (int type : manager.getDefaultDisplay().getHdrCapabilities().getSupportedHdrTypes()) {
                if (type == Display.HdrCapabilities.HDR_TYPE_HDR10) ranges.put("HDR10");
                if (type == Display.HdrCapabilities.HDR_TYPE_HLG) ranges.put("HLG");
            }
            result.put("videos", videoCache).put("audio", audio).put("audioChannels", audioChannels).put("videoRanges", ranges)
                .put("maxAudioChannels", surround ? Math.min(6, output.getMaxChannelCount()) : 2)
                .put("hdr", ranges.length() > 1); // SurfaceView preserves native HDR output.
        } catch (Exception ignored) { /* Empty capabilities means compatibility playback. */ }
        return result;
    }

    private static boolean hardware(MediaCodecInfo decoder) {
        if (Build.VERSION.SDK_INT >= 29) return decoder.isHardwareAccelerated();
        String name = decoder.getName().toLowerCase(java.util.Locale.ROOT);
        return !name.startsWith("omx.google.") && !name.startsWith("c2.android.") &&
            !name.startsWith("omx.ffmpeg.") && (name.startsWith("omx.") || name.startsWith("c2."));
    }
    private static int hevcLevel(int level) {
        int[] levels = {30,60,63,90,93,120,123,150,153,156,180,183,186};
        for (int i = 0; i < levels.length; i++)
            if (level == (1 << (2 * i)) || level == (1 << (2 * i + 1))) return levels[i];
        return 0;
    }
    private static int avcLevel(int level) {
        int[] levels = {10,9,11,12,13,20,21,22,30,31,32,40,41,42,50,51,52};
        for (int i = 0; i < levels.length; i++) if (level == (1 << i)) return levels[i];
        return 0;
    }
}
