package tv.ember.jellyfin;
public final class DisplayModeSelectorTest {
    private static DisplayModeSelector.Mode m(int id, int w, int h, float r) { return new DisplayModeSelector.Mode(id,w,h,r); }
    private static void check(int expected, int actual) { if (expected != actual) throw new AssertionError(expected + " != " + actual); }
    public static void main(String[] args) {
        DisplayModeSelector.Mode current = m(1,3840,2160,60);
        DisplayModeSelector.Mode[] modes = {current,m(2,3840,2160,23.976f),m(3,3840,2160,24),m(4,1920,1080,24),m(5,1920,1080,60),m(6,3840,2160,50)};
        check(2, DisplayModeSelector.select(modes,current,3840,1608,23.976f,true,false));
        check(3, DisplayModeSelector.select(modes,current,1920,800,24,true,false));
        check(4, DisplayModeSelector.select(modes,current,1920,800,24,true,true));
        check(6, DisplayModeSelector.select(modes,current,3840,2160,25,true,true));
        check(5, DisplayModeSelector.select(modes,current,1920,1080,29.97f,true,true));
        check(1, DisplayModeSelector.select(modes,current,3840,2160,Float.NaN,true,true));
        check(1, DisplayModeSelector.select(new DisplayModeSelector.Mode[]{current},current,1920,1080,24,true,true));
        check(5, DisplayModeSelector.select(modes,current,1920,1080,0,true,true));
        // No 24Hz fallback for 23.976 when there is no matching NTSC mode.
        check(1, DisplayModeSelector.select(new DisplayModeSelector.Mode[]{current,modes[2]},current,3840,2160,23.976f,true,false));
        check(5, DisplayModeSelector.select(modes,current,1920,800,24,false,true));
        System.out.println("Display mode selection passed");
    }
}
