package dev.adbvault.helper;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.pm.PackageManager;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.CallLog;
import android.provider.ContactsContract;
import android.provider.Telephony;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Explicit, short-lived phone reads and plain-text clipboard writes as authenticated ADB shell.
 * Never grants permissions, changes roles, reads provider databases directly or requests root. */
public final class PhoneTools {
    private static final int MAX_RECORDS = 20000, MAX_TEXT = 262144, MAX_OUTPUT = 64000000;
    private static final PrintWriter OUTPUT = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8), true);
    private static int outputBytes;

    private static void emit(JSONObject value) throws Exception {
        String line = value.toString();
        outputBytes += line.getBytes(StandardCharsets.UTF_8).length + 1;
        if (outputBytes > MAX_OUTPUT) throw new IllegalStateException("Collection exceeds 64 MB. Use a smaller date range.");
        OUTPUT.println(line);
        if (OUTPUT.checkError()) System.exit(2);
    }
    private static String read(InputStream stream, int limit) throws Exception {
        ByteArrayOutputStream data = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int count; (count = stream.read(buffer)) != -1;) {
            if (data.size() + count > limit) throw new IllegalStateException("A phone record exceeds the supported size.");
            data.write(buffer, 0, count);
        }
        return new String(data.toByteArray(), StandardCharsets.UTF_8);
    }
    private static String string(Cursor cursor, String column) {
        int index = cursor.getColumnIndexOrThrow(column);
        return cursor.isNull(index) ? "" : cursor.getString(index);
    }
    private static long integer(Cursor cursor, String column) {
        int index = cursor.getColumnIndexOrThrow(column);
        return cursor.isNull(index) ? 0 : cursor.getLong(index);
    }
    private static void progress(int count, int total) throws Exception {
        if (count == 0 || count == total || count % 50 == 0) emit(new JSONObject().put("type", "progress").put("completed", count).put("total", total));
    }
    private static Cursor query(ContentResolver resolver, Uri uri, String[] projection, String selection, String[] args, String order) {
        Cursor cursor = resolver.query(uri, projection, selection, args, order);
        if (cursor == null) throw new IllegalStateException("Android did not return a data cursor. Access may be restricted by this device.");
        return cursor;
    }
    private static void checkCount(int count) {
        if (count > MAX_RECORDS) throw new IllegalStateException("More than 20,000 records. Use a smaller date range for calls or SMS.");
    }
    private static int contacts(ContentResolver resolver) throws Exception {
        Map<String, JSONObject> contacts = new LinkedHashMap<>();
        Map<String, String> lookups = new LinkedHashMap<>();
        try (Cursor cursor = query(resolver, ContactsContract.Contacts.CONTENT_URI,
                new String[] { "_id", "lookup", "display_name" }, null, null, "_id ASC")) {
            checkCount(cursor.getCount());
            while (cursor.moveToNext()) {
                String id = string(cursor, "_id");
                contacts.put(id, new JSONObject().put("kind", "contacts").put("id", id).put("name", string(cursor, "display_name"))
                    .put("phones", new JSONArray()).put("emails", new JSONArray()).put("organizations", new JSONArray()));
                lookups.put(id, string(cursor, "lookup"));
            }
        }
        // One data query for the table preview. The native vCard below preserves richer fields.
        String phone = ContactsContract.CommonDataKinds.Phone.CONTENT_ITEM_TYPE;
        String email = ContactsContract.CommonDataKinds.Email.CONTENT_ITEM_TYPE;
        String organization = ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE;
        try (Cursor cursor = query(resolver, ContactsContract.Data.CONTENT_URI,
                new String[] { "contact_id", "mimetype", "data1" }, "mimetype IN (?,?,?)",
                new String[] { phone, email, organization }, null)) {
            while (cursor.moveToNext()) {
                JSONObject contact = contacts.get(string(cursor, "contact_id"));
                if (contact == null) continue;
                String mime = string(cursor, "mimetype"), value = string(cursor, "data1");
                if (value.isEmpty()) continue;
                JSONArray values = contact.getJSONArray(mime.equals(phone) ? "phones" : mime.equals(email) ? "emails" : "organizations");
                if (values.length() >= 1000) throw new IllegalStateException("A contact contains too many fields.");
                values.put(value);
            }
        }
        progress(0, contacts.size());
        int completed = 0;
        for (Map.Entry<String, JSONObject> entry : contacts.entrySet()) {
            String lookup = lookups.get(entry.getKey());
            if (lookup == null || lookup.isEmpty()) throw new IllegalStateException("A contact changed during collection. Refresh contacts.");
            Uri uri = ContactsContract.Contacts.CONTENT_VCARD_URI.buildUpon().appendPath(lookup)
                .appendQueryParameter(ContactsContract.Contacts.QUERY_PARAMETER_VCARD_NO_PHOTO, "true").build();
            try (AssetFileDescriptor descriptor = resolver.openAssetFileDescriptor(uri, "r")) {
                if (descriptor == null) throw new IllegalStateException("Android could not export a contact as vCard.");
                try (InputStream input = descriptor.createInputStream()) { entry.getValue().put("vcard", read(input, 1000000)); }
            }
            emit(new JSONObject().put("type", "record").put("record", entry.getValue()));
            progress(++completed, contacts.size());
        }
        return completed;
    }
    private static int messages(ContentResolver resolver, boolean sms, long from, long to) throws Exception {
        Uri uri = sms ? Telephony.Sms.CONTENT_URI : CallLog.Calls.CONTENT_URI;
        String[] columns = sms
            ? new String[] { "_id", "address", "date", "date_sent", "type", "body", "read", "sub_id", "thread_id" }
            : new String[] { "_id", "number", "name", "date", "duration", "type", CallLog.Calls.PHONE_ACCOUNT_ID };
        String selection = "date >= ? AND date < ?";
        int completed = 0;
        try (Cursor cursor = query(resolver, uri, columns, selection, new String[] { String.valueOf(from), String.valueOf(to) }, "date DESC, _id DESC")) {
            int total = cursor.getCount(); checkCount(total); progress(0, total);
            while (cursor.moveToNext()) {
                checkCount(completed + 1);
                JSONObject row = new JSONObject().put("kind", sms ? "sms" : "calls").put("id", string(cursor, "_id"))
                    .put("date", integer(cursor, "date")).put("type", integer(cursor, "type"));
                if (sms) row.put("address", string(cursor, "address")).put("body", string(cursor, "body"))
                    .put("dateSent", integer(cursor, "date_sent")).put("read", integer(cursor, "read") != 0)
                    .put("subscription", string(cursor, "sub_id")).put("threadId", string(cursor, "thread_id"));
                else row.put("number", string(cursor, "number")).put("name", string(cursor, "name"))
                    .put("duration", integer(cursor, "duration")).put("account", string(cursor, CallLog.Calls.PHONE_ACCOUNT_ID));
                emit(new JSONObject().put("type", "record").put("record", row));
                progress(++completed, total);
            }
        }
        return completed;
    }
    private static void clipboardAccess(Context context) {
        if (Build.VERSION.SDK_INT >= 29 && context.checkPermission("android.permission.READ_CLIPBOARD_IN_BACKGROUND", Process.myPid(), Process.myUid()) != PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("This phone does not allow ADB to read the clipboard in the background. Use clipboard sharing in the screen window.");
    }
    private static String clipboardText(Context context, ClipboardManager manager) {
        clipboardAccess(context);
        ClipData clip = manager.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) return "";
        if (clip.getItemCount() != 1 || clip.getItemAt(0).getText() == null)
            throw new IllegalStateException("The Android clipboard contains files or another non-text format.");
        String value = clip.getItemAt(0).getText().toString();
        if (value.indexOf('\0') >= 0 || value.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT)
            throw new IllegalStateException("Android clipboard text exceeds 256 KiB or contains null characters.");
        return value;
    }
    public static void main(String[] args) {
        try {
            if (Process.myUid() != 0 && Process.myUid() != 2000) throw new SecurityException("Start this helper through authenticated ADB.");
            if (args.length < 2) throw new IllegalArgumentException("Missing phone action or Android user.");
            String operation = args[0];
            if (!operation.equals("contacts") && !operation.equals("calls") && !operation.equals("sms") && !operation.equals("clipboard-read") && !operation.equals("clipboard-write"))
                throw new IllegalArgumentException("Unsupported phone action.");
            int userId = Integer.parseInt(args[1]);
            if (userId < 0 || userId > 99999) throw new IllegalArgumentException("Invalid Android user.");
            int currentUser = (Integer) Class.forName("android.app.ActivityManager").getMethod("getCurrentUser").invoke(null);
            if (currentUser != userId) throw new IllegalStateException("The active Android user changed. Reopen the action.");
            Context context = PhoneContext.create(userId);
            emit(new JSONObject().put("type", "hello").put("protocol", 1).put("operation", operation).put("userId", userId));
            int count = 0;
            if (operation.startsWith("clipboard-")) {
                ClipboardManager manager = PhoneClipboard.manager(context);
                if (operation.equals("clipboard-read")) emit(new JSONObject().put("type", "clipboard").put("text", clipboardText(context, manager)));
                else {
                    String value = new JSONObject(read(System.in, 2000000)).getString("text");
                    if (value.indexOf('\0') >= 0 || value.getBytes(StandardCharsets.UTF_8).length > MAX_TEXT) throw new IllegalArgumentException("Invalid clipboard text.");
                    // Verify read access before writing so a denied read cannot leave an unverified mutation.
                    clipboardAccess(context);
                    manager.setPrimaryClip(ClipData.newPlainText("ADB Vault", value));
                    if (!value.equals(clipboardText(context, manager))) throw new IllegalStateException("Android did not confirm the clipboard update. The clipboard may have changed.");
                    emit(new JSONObject().put("type", "written").put("verified", true));
                }
            } else if (operation.equals("contacts")) count = contacts(new PhoneContentResolver(context, userId));
            else {
                if (args.length != 4) throw new IllegalArgumentException("Missing date range.");
                long from = Long.parseLong(args[2]), to = Long.parseLong(args[3]);
                if (from < 0 || to > 4102444800000L || from >= to) throw new IllegalArgumentException("Invalid date range.");
                count = messages(new PhoneContentResolver(context, userId), operation.equals("sms"), from, to);
            }
            emit(new JSONObject().put("type", "done").put("count", count));
            System.exit(0);
        } catch (Throwable failure) {
            while (failure instanceof java.lang.reflect.InvocationTargetException && failure.getCause() != null) failure = failure.getCause();
            String message = failure instanceof org.json.JSONException ? "Invalid helper input or phone response."
                : (failure instanceof SecurityException ? "Android access denied: " : "") + String.valueOf(failure.getMessage());
            try { OUTPUT.println(new JSONObject().put("type", "error").put("message", message.length() > 1000 ? message.substring(0, 1000) : message).toString()); } catch (Exception ignored) { }
            System.exit(1);
        }
    }
}
