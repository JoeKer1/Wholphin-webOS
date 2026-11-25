package tv.ember.jellyfin;

import android.content.Context;
import android.media.MediaCodec;
import android.net.Uri;
import android.os.Handler;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.Renderer;
import androidx.media3.exoplayer.mediacodec.ForwardingMediaCodecAdapter;
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector;
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer;
import androidx.media3.exoplayer.video.VideoRendererEventListener;
import androidx.media3.extractor.*;
import com.suyashbelekar.exoplayerhdrutils.libdovi.FrameInfo;
import com.suyashbelekar.exoplayerhdrutils.libdovi.LibDovi;
import java.nio.Buffer;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Profile 7 conversion, following Wholphin PR #2017 (GPL-2.0). */
@OptIn(markerClass = UnstableApi.class)
final class DolbyVisionConversion {
    private final LibDovi libDovi = new LibDovi();
    private ByteBuffer scratch = ByteBuffer.allocateDirect(4096);
    private volatile boolean converted;

    boolean hasConverted() { return converted; }

    ExtractorsFactory wrap(ExtractorsFactory delegate) {
        return new ForwardingExtractorsFactory(delegate) {
            @Override public Extractor[] createExtractors() {
                return wrapExtractors(super.createExtractors());
            }
            @Override public Extractor[] createExtractors(Uri uri, Map<String, List<String>> headers) {
                return wrapExtractors(super.createExtractors(uri, headers));
            }
        };
    }

    private Extractor[] wrapExtractors(Extractor[] extractors) {
        Extractor[] result = new Extractor[extractors.length];
        for (int i = 0; i < extractors.length; i++) {
            result[i] = new ForwardingExtractor(extractors[i]) {
                @Override public void init(ExtractorOutput output) {
                    super.init(new ForwardingExtractorOutput(output) {
                        @Override public TrackOutput track(int id, int type) {
                            TrackOutput track = super.track(id, type);
                            if (type != C.TRACK_TYPE_VIDEO) return track;
                            return new ForwardingTrackOutput(track) {
                                @Override public void format(Format format) {
                                    String codecs = format.codecs;
                                    if (format.drmInitData != null || !MimeTypes.VIDEO_DOLBY_VISION.equals(format.sampleMimeType)
                                            || codecs == null || !codecs.matches("dv(he|h1)\\.07\\.[0-9]{2}")) {
                                        throw new IllegalStateException("Expected an unencrypted Dolby Vision profile 7 track");
                                    }
                                    super.format(format.buildUpon()
                                        .setCodecs(codecs.substring(0, 5) + "08" + codecs.substring(7)).build());
                                }
                            };
                        }
                    });
                }
            };
        }
        return result;
    }

    DefaultRenderersFactory renderers(Context context) {
        return new DefaultRenderersFactory(context) {
            @Override protected void buildVideoRenderers(Context context, int extensionMode,
                    MediaCodecSelector selector, boolean fallback, Handler handler,
                    VideoRendererEventListener listener, long joiningTime, ArrayList<Renderer> out) {
                out.add(new MediaCodecVideoRenderer.Builder(context)
                    .setMediaCodecSelector(selector)
                    .setEnableDecoderFallback(fallback)
                    .setEventHandler(handler)
                    .setEventListener(listener)
                    .setAllowedJoiningTimeMs(joiningTime)
                    .setMaxDroppedFramesToNotify(MAX_DROPPED_VIDEO_FRAME_COUNT_TO_NOTIFY)
                    .setCodecAdapterFactory(config -> {
                        if (!MimeTypes.VIDEO_DOLBY_VISION.equals(config.codecInfo.mimeType) || config.crypto != null)
                            throw new IllegalStateException("Dolby Vision decoder unavailable");
                        return new ForwardingMediaCodecAdapter(getCodecAdapterFactory().createAdapter(config)) {
                            @Override public void queueInputBuffer(int index, int offset, int size, long time, int flags) {
                                if (size > 0 && (flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0)
                                    size = convert(getInputBuffer(index), offset, size);
                                super.queueInputBuffer(index, offset, size, time, flags);
                            }
                        };
                    }).build());
            }
        };
    }

    private int convert(ByteBuffer data, int offset, int size) {
        if (data == null || offset < 0 || size > 32 * 1024 * 1024 || size > data.limit() - offset)
            throw new IllegalStateException("Invalid Dolby Vision input buffer");
        int end = offset + size;
        if (startCodeLength(data, offset, end) == 0)
            throw new IllegalStateException("Expected Annex B Dolby Vision input");
        if (scratch.capacity() < size + 4096) scratch = ByteBuffer.allocateDirect(size + 4096);
        ((Buffer) scratch).clear();
        boolean hasMetadata = false;
        for (int unit = offset; unit < end;) {
            int payload = unit + startCodeLength(data, unit, end);
            if (payload + 1 >= end) throw new IllegalStateException("Truncated Dolby Vision unit");
            int next = payload + 2;
            while (next < end && startCodeLength(data, next, end) == 0) next++;
            int type = (data.get(payload) & 0x7e) >> 1;
            if (type == 62) hasMetadata = true;
            if (type != 63) scratch.put(window(data, unit, next - unit));
            unit = next;
        }
        int length = scratch.position();
        if (hasMetadata) {
            try {
                FrameInfo info = libDovi.getFrameInfo(scratch, length);
                if (info == null || info.getDoviProfile() != 7)
                    throw new IllegalStateException("Unexpected Dolby Vision metadata");
                // JNI mode 1 rewrites profile 7 metadata as profile 8.1.
                length = libDovi.processHevcFrame(scratch, length, 1, false);
            } catch (LinkageError error) {
                throw new IllegalStateException("Dolby Vision conversion library unavailable", error);
            }
            if (length <= 0 || length > size) throw new IllegalStateException("Dolby Vision conversion failed");
            converted = true;
        }
        window(data, offset, length).put(window(scratch, 0, length));
        return length;
    }

    private static ByteBuffer window(ByteBuffer data, int offset, int length) {
        ByteBuffer view = data.duplicate();
        ((Buffer) view).limit(offset + length);
        ((Buffer) view).position(offset);
        return view;
    }

    private static int startCodeLength(ByteBuffer data, int offset, int end) {
        if (end - offset < 3 || data.get(offset) != 0 || data.get(offset + 1) != 0) return 0;
        if (data.get(offset + 2) == 1) return 3;
        return end - offset >= 4 && data.get(offset + 2) == 0 && data.get(offset + 3) == 1 ? 4 : 0;
    }
}
