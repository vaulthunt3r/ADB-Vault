package dev.adbvault.helper;

import android.content.Context;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.os.Process;
import android.provider.CallLog;
import android.provider.ContactsContract;
import android.provider.Telephony;
import org.json.JSONObject;

/** Zero-row queries reproduce attribution errors without reading personal records. */
public final class PhoneProvidersProbe {
    private static String query(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { "_id" }, "_id < 0", null, null)) {
            if (cursor == null) return "No cursor";
            if (cursor.getCount() != 0) return "Unexpected rows";
            return "allowed";
        } catch (Exception failure) {
            return failure.getClass().getSimpleName() + ": " + failure.getMessage();
        }
    }

    public static void main(String[] args) {
        try {
            int userId = Integer.parseInt(args[0]);
            int currentUser = (Integer) Class.forName("android.app.ActivityManager").getMethod("getCurrentUser").invoke(null);
            if (currentUser != userId) throw new IllegalStateException("Android user changed.");
            Context original = Main.context(userId);
            Context corrected = PhoneContext.from(original, userId);
            PhoneContentResolver resolver = new PhoneContentResolver(corrected, userId);
            JSONObject result = new JSONObject().put("uid", Process.myUid()).put("androidUser", userId)
                .put("originalPackage", original.getOpPackageName()).put("correctedPackage", corrected.getOpPackageName());
            String[] names = { "contacts", "calls", "sms" };
            Uri[] uris = { ContactsContract.Contacts.CONTENT_URI, CallLog.Calls.CONTENT_URI, Telephony.Sms.CONTENT_URI };
            boolean passed = true;
            for (int i = 0; i < names.length; i++) {
                String before = query(original.getContentResolver(), uris[i]), after = query(resolver, uris[i]);
                result.put(names[i], new JSONObject().put("before", before).put("after", after));
                passed &= after.equals("allowed");
            }
            // Exercise the production phone context with the existing clipboard correction too.
            PhoneClipboard.manager(corrected).hasPrimaryClip();
            int active = resolver.activeProviderCount();
            passed &= active == 0;
            result.put("clipboardAccess", "allowed").put("activeProviderReferences", active).put("phoneDataChanged", false);
            System.out.println(result.toString());
            System.exit(passed ? 0 : 1);
        } catch (Throwable failure) {
            while (failure instanceof java.lang.reflect.InvocationTargetException && failure.getCause() != null) failure = failure.getCause();
            System.err.println(failure.getClass().getSimpleName() + ": " + failure.getMessage());
            System.exit(1);
        }
    }
}
