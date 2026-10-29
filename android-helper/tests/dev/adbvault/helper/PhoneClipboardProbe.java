package dev.adbvault.helper;

import android.content.ClipboardManager;
import android.content.Context;
import android.os.Process;
import org.json.JSONObject;

/** Device regression probe. Only checks clipboard availability; never reads or writes its content. */
public final class PhoneClipboardProbe {
    public static void main(String[] args) {
        try {
            int userId = Integer.parseInt(args[0]);
            int currentUser = (Integer) Class.forName("android.app.ActivityManager").getMethod("getCurrentUser").invoke(null);
            if (currentUser != userId) throw new IllegalStateException("Android user changed.");
            Context context = Main.context(userId);
            ClipboardManager original = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
            JSONObject result = new JSONObject().put("uid", Process.myUid()).put("androidUser", userId);
            try {
                original.hasPrimaryClip();
                result.put("before", "allowed");
            } catch (SecurityException failure) {
                result.put("before", failure.getMessage());
            }
            ClipboardManager corrected = PhoneClipboard.manager(context);
            corrected.hasPrimaryClip();
            // The description call follows the same package/user attribution as the text getter.
            // Discard it without inspecting or printing labels or other clipboard data.
            corrected.getPrimaryClipDescription();
            result.put("after", "allowed").put("clipboardContentChanged", false);
            System.out.println(result.toString());
            System.exit(0);
        } catch (Throwable failure) {
            while (failure instanceof java.lang.reflect.InvocationTargetException && failure.getCause() != null) failure = failure.getCause();
            System.err.println(failure.getClass().getSimpleName() + ": " + failure.getMessage());
            System.exit(1);
        }
    }
}
