import java.lang.reflect.Method;
import java.util.Objects;

/** Executes the actual helper heuristic on the host, without Android service calls. */
public final class PlaySigningTest {
    public static void main(String[] args) throws Exception {
        Class<?> helper = Class.forName("dev.adbvault.helper.Main");
        Method state = helper.getDeclaredMethod("playSigningState", Object.class, Object.class);
        state.setAccessible(true);
        String type = "STAMP_TYPE_DISTRIBUTION_APK", source = "https://play.google.com/store";
        Object[][] cases = {
            {type, source, true}, {null, null, false}, {type, null, false}, {null, source, false},
            {"", "", false}, {type.toLowerCase(), source, false}, {type, source + "/", false},
            {type, "http://play.google.com/store", false}, {type, source + ".example.org", false},
            {" " + type, source, false}, {type, "com.android.vending", false},
            {42, source, null}, {type, true, null}
        };
        for (Object[] test : cases) if (!Objects.equals(state.invoke(null, test[0], test[1]), test[2]))
            throw new AssertionError("Incorrect stamp state for " + test[0] + ", " + test[1]);
        Method value = helper.getDeclaredMethod("stampValue", Object.class); value.setAccessible(true);
        if (!value.invoke(null, source).equals(source)) throw new AssertionError("Evidence changed");
        if (!value.invoke(null, (Object) null).equals("Not declared")) throw new AssertionError("Missing evidence");
        String huge = new String(new char[9000]).replace('\0', 'x');
        if (((String) value.invoke(null, huge)).length() > 550) throw new AssertionError("Unbounded evidence");
        System.out.println("PASS: Play stamp pair, missing/partial/invalid metadata, exact matching and bounded evidence.");
    }
}
