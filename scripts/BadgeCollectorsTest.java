import java.lang.reflect.Method;
import java.lang.reflect.InvocationTargetException;
import java.util.Objects;

/** Tests the production decisions, including Android profile isolation and partial visibility. */
public final class BadgeCollectorsTest {
    public static class PackageMetadata { public Object overlayTarget; }
    public static class MissingMetadata { }
    private static void equal(Object actual, Object expected) {
        if (!Objects.equals(actual, expected)) throw new AssertionError("Expected " + expected + ", got " + actual);
    }
    public static void main(String[] args) throws Exception {
        Class<?> helper = Class.forName("dev.adbvault.helper.Main");
        Method wx = helper.getDeclaredMethod("wxState", int.class, int.class); wx.setAccessible(true);
        equal(wx.invoke(null, 28, 28), false);
        equal(wx.invoke(null, 29, 28), true);
        equal(wx.invoke(null, 36, 28), true);
        equal(wx.invoke(null, 29, 29), false);
        equal(wx.invoke(null, 36, 36), false);
        equal(wx.invoke(null, 36, 0), null);
        equal(wx.invoke(null, 0, 28), null);

        Method target = helper.getDeclaredMethod("overlayTarget", Object.class); target.setAccessible(true);
        PackageMetadata pkg = new PackageMetadata();
        equal(target.invoke(null, pkg), null);
        pkg.overlayTarget = "android"; equal(target.invoke(null, pkg), "android");
        for (Object invalid : new Object[] { "", 42 }) {
            pkg.overlayTarget = invalid;
            try { target.invoke(null, pkg); throw new AssertionError("Invalid metadata accepted"); }
            catch (InvocationTargetException expected) { if (!(expected.getCause() instanceof IllegalStateException)) throw expected; }
        }
        try { target.invoke(null, new MissingMetadata()); throw new AssertionError("Missing field became a negative result"); }
        catch (InvocationTargetException expected) { if (!(expected.getCause() instanceof NoSuchFieldException)) throw expected; }

        Method matches = helper.getDeclaredMethod("matchesProcess", int.class, int.class, String[].class, String.class); matches.setAccessible(true);
        equal(matches.invoke(null, 10123, 10123, new String[] { "org.example.app" }, "org.example.app"), true);
        equal(matches.invoke(null, 1010123, 10123, new String[] { "org.example.app" }, "org.example.app"), false);
        equal(matches.invoke(null, 10123, 10123, new String[] { "org.example.other" }, "org.example.app"), false);
        equal(matches.invoke(null, 10123, 10123, new String[] { "org.example.app.extra" }, "org.example.app"), false);
        equal(matches.invoke(null, 10123, 10123, null, "org.example.app"), false);
        equal(matches.invoke(null, 99001, 10123, new String[] { "org.example.app" }, "org.example.app"), true);
        equal(matches.invoke(null, -1, 10123, new String[] { "org.example.app" }, "org.example.app"), false);
        Method running = helper.getDeclaredMethod("runningState", int.class, boolean.class, boolean.class); running.setAccessible(true);
        for (boolean processes : new boolean[] { false, true }) for (boolean services : new boolean[] { false, true }) {
            equal(running.invoke(null, 1, processes, services), true);
            equal(running.invoke(null, 0, processes, services), processes && services ? Boolean.FALSE : null);
        }
        System.out.println("PASS: WX boundaries, Overlay absent/invalid/unsupported, process identity/profile isolation, Running partial visibility.");
    }
}
