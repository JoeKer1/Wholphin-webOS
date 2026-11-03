package tv.ember.jellyfin;

/** Pure selection policy: use only advertised modes, never invent timings. */
final class DisplayModeSelector {
    static final class Mode {
        final int id, width, height;
        final float rate;
        Mode(int id, int width, int height, float rate) {
            this.id = id; this.width = width; this.height = height; this.rate = rate;
        }
    }
    static int select(Mode[] modes, Mode current, int width, int height, float fps, boolean rate, boolean resolution) {
        if (width <= 0 || height <= 0) return current.id;
        int targetWidth = current.width, targetHeight = current.height;
        if (resolution) {
            long area = Long.MAX_VALUE;
            for (Mode m : modes) {
                long size = (long)m.width * m.height;
                if (m.width >= width && m.height >= height && size < area) {
                    area = size; targetWidth = m.width; targetHeight = m.height;
                }
            }
        }
        int best = current.id;
        double bestScore = Double.MAX_VALUE;
        for (Mode m : modes) {
            if (m.width != targetWidth || m.height != targetHeight || !Float.isFinite(m.rate) || m.rate <= 0) continue;
            int multiple = Math.round(m.rate / fps);
            boolean cadence = rate && Float.isFinite(fps) && fps > 0 && multiple >= 1 && Math.abs(m.rate / multiple - fps) < 0.02;
            // Prefer exact cadence, then the lowest matching multiple. If no cadence
            // exists at this resolution, preserve the current refresh rate.
            if (!cadence && Math.abs(m.rate - current.rate) > 0.02) continue;
            double score = cadence ? multiple : 1000;
            if (m.id == current.id) score -= 0.001;
            if (score < bestScore) { bestScore = score; best = m.id; }
        }
        return best;
    }
}
