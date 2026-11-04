package tv.ember.jellyfin;

import android.content.Context;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import org.json.JSONObject;

/** System transport integration. Metadata deliberately excludes stream URLs and credentials. */
final class PlaybackSession {
    interface Commands { void send(String action, long positionMs); }
    private final MediaSession session;
    private JSONObject info = new JSONObject();
    PlaybackSession(Context context, Commands commands) {
        session = new MediaSession(context, "Ember playback");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { commands.send("play", 0); }
            @Override public void onPause() { commands.send("pause", 0); }
            @Override public void onStop() { commands.send("stop", 0); }
            @Override public void onSeekTo(long position) { if (!info.optBoolean("live")) commands.send("seek", Math.max(0, position)); }
            @Override public void onFastForward() { if (!info.optBoolean("live")) commands.send("forward", 0); }
            @Override public void onRewind() { if (!info.optBoolean("live")) commands.send("rewind", 0); }
            @Override public void onSkipToNext() { if (info.optBoolean("next")) commands.send("next", 0); }
            @Override public void onSkipToPrevious() { if (info.optBoolean("previous")) commands.send("previous", 0); }
        }, new Handler(Looper.getMainLooper()));
    }
    void setInfo(JSONObject value) {
        info = value == null ? new JSONObject() : value;
        String title = info.optString("title", "Ember"), subtitle = info.optString("subtitle", "");
        session.setMetadata(new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title.substring(0, Math.min(title.length(), 500)))
            .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle.substring(0, Math.min(subtitle.length(), 500)))
            .putLong(MediaMetadata.METADATA_KEY_DURATION, Math.max(0, info.optLong("duration", 0))).build());
    }
    void update(ExoPlayer player, boolean foreground) {
        session.setActive(foreground && player.getPlaybackState() != Player.STATE_ENDED && player.getPlaybackState() != Player.STATE_IDLE);
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        if (!info.optBoolean("live") && player.isCurrentMediaItemSeekable()) actions |= PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_REWIND;
        if (info.optBoolean("next")) actions |= PlaybackState.ACTION_SKIP_TO_NEXT;
        if (info.optBoolean("previous")) actions |= PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        int state = player.getPlaybackState() == Player.STATE_ENDED ? PlaybackState.STATE_STOPPED
            : player.getPlaybackState() == Player.STATE_BUFFERING ? PlaybackState.STATE_BUFFERING
            : player.getPlayWhenReady() && foreground ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        long position = Math.max(0, player.getCurrentPosition() + info.optLong("offset", 0));
        session.setPlaybackState(new PlaybackState.Builder().setActions(actions)
            .setState(state, position, player.isPlaying() && foreground ? player.getPlaybackParameters().speed : 0).build());
    }
    void deactivate() { session.setActive(false); }
    void release() { session.setActive(false); session.release(); }
}
