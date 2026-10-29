package dev.adbvault.helper;

import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.Parcel;
import android.os.Process;
import org.json.JSONObject;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Explicit package operations. Main remains the read-only inventory entry point.
 * No all-users flags, permission escalation, alternate mutation or automatic retry. */
public final class PackageActions {
    private static Class<?> type(String name) throws Exception { return Class.forName(name); }
    private static Object service(String name, String iface) throws Exception {
        IBinder binder = (IBinder) type("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, name);
        return type(iface + "$Stub").getMethod("asInterface", IBinder.class).invoke(null, binder);
    }
    public static JSONObject context() throws Exception {
        String permission = "unknown";
        try {
            int result = (Integer) type("android.app.ActivityManager").getMethod("checkUidPermission", String.class, int.class)
                .invoke(null, "android.permission.INTERNAL_DELETE_CACHE_FILES", Process.myUid());
            permission = result == 0 ? "granted" : "denied";
        } catch (Exception ignored) { }
        return new JSONObject().put("fingerprint", Build.FINGERPRINT).put("sdk", Build.VERSION.SDK_INT)
            .put("callerUid", Process.myUid()).put("cachePermission", permission);
    }
    private static JSONObject snapshot(Object pm, String pkg, int user) throws Exception {
        Class<?> iface = type("android.content.pm.IPackageManager");
        PackageInfo info;
        try { info = (PackageInfo) iface.getMethod("getPackageInfo", String.class, long.class, int.class).invoke(pm, pkg, 0x2000L, user); }
        catch (NoSuchMethodException old) { info = (PackageInfo) iface.getMethod("getPackageInfo", String.class, int.class, int.class).invoke(pm, pkg, 0x2000, user); }
        JSONObject value = new JSONObject().put("installed", false);
        if (info == null || info.applicationInfo == null) return value;
        ApplicationInfo app = info.applicationInfo;
        boolean apkAvailable = true;
        try {
            java.util.ArrayList<String> files = new java.util.ArrayList<String>();
            files.add(app.sourceDir);
            if (app.splitSourceDirs != null) java.util.Collections.addAll(files, app.splitSourceDirs);
            for (String file : files) {
                if (file == null) { apkAvailable = false; break; }
                android.system.StructStat stat = android.system.Os.stat(file);
                if (!android.system.OsConstants.S_ISREG(stat.st_mode) || stat.st_size <= 0) { apkAvailable = false; break; }
            }
        } catch (Throwable unavailable) { apkAvailable = false; }
        return value.put("installed", (app.flags & ApplicationInfo.FLAG_INSTALLED) != 0).put("enabled", app.enabled)
            .put("apkAvailable", apkAvailable)
            .put("uid", app.uid).put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode)
            .put("system", (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
    }
    private static final class Callback extends Binder {
        final CountDownLatch done = new CountDownLatch(1);
        final String descriptor, pkg;
        volatile boolean success;
        volatile Intent intent;
        Callback(String descriptor, String pkg) { this.descriptor = descriptor; this.pkg = pkg; attachInterface(null, descriptor); }
        @Override protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) throws android.os.RemoteException {
            if (code == INTERFACE_TRANSACTION) { if (reply != null) reply.writeString(descriptor); return true; }
            if (code != FIRST_CALL_TRANSACTION) return super.onTransact(code, data, reply, flags);
            data.enforceInterface(descriptor);
            if (descriptor.equals("android.content.pm.IPackageDataObserver")) {
                String target = data.readString(); success = data.readInt() != 0 && pkg.equals(target);
            } else {
                data.readInt();
                intent = data.readInt() != 0 ? Intent.CREATOR.createFromParcel(data) : null;
                success = intent != null && pkg.equals(intent.getStringExtra(PackageInstaller.EXTRA_PACKAGE_NAME))
                    && intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1000) == PackageInstaller.STATUS_SUCCESS;
            }
            if (reply != null) reply.writeNoException();
            done.countDown(); return true;
        }
        Object asInterface() throws Exception { return type(descriptor + "$Stub").getMethod("asInterface", IBinder.class).invoke(null, this); }
        void await(JSONObject result) throws Exception {
            if (!done.await(25, TimeUnit.SECONDS)) { result.put("outcome", "uncertain").put("message", "Android did not deliver a completion callback."); return; }
            result.put("outcome", success ? "confirmed" : "failed").put("message", intent == null ? (success ? "Android confirmed cleanup." : "Android rejected cleanup.") : String.valueOf(intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)));
        }
    }
    public static void main(String[] args) {
        JSONObject result = new JSONObject(); boolean dispatched = false;
        try {
            if (args.length != 6) throw new IllegalArgumentException("Expected action, package, user, expected UID, expected version and keep-data flag");
            String action = args[0], pkg = args[1]; int user = Integer.parseInt(args[2]);
            if (!pkg.matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*") || pkg.length() > 255 || user < 0 || user > 99999 || !args[5].matches("true|false")) throw new IllegalArgumentException("Invalid target");
            if (Process.myUid() != 2000 && Process.myUid() != 0) throw new SecurityException("Requires shell or explicitly granted root");
            result.put("protocol", 1).put("packageName", pkg).put("userId", user).put("action", action).put("context", context());
            Object pm = service("package", "android.content.pm.IPackageManager"); Class<?> pmType = type("android.content.pm.IPackageManager");
            JSONObject before = snapshot(pm, pkg, user); result.put("state", before);
            if (action.equals("inspect") || action.equals("inspect-restore")) { result.put("outcome", "confirmed"); }
            else {
                if (!before.getBoolean("installed") || before.getInt("uid") != Integer.parseInt(args[3]) || before.getLong("versionCode") != Long.parseLong(args[4])) throw new IllegalStateException("Application changed. Refresh applications before trying again.");
                if (action.equals("disable") || action.equals("enable")) {
                    Method method = pmType.getMethod("setApplicationEnabledSetting", String.class, int.class, int.class, int.class, String.class);
                    dispatched = true; method.invoke(pm, pkg, action.equals("disable") ? 3 : 1, 0, user, "com.android.shell");
                    result.put("outcome", "confirmed");
                } else if (action.equals("clear-data") || action.equals("clear-cache")) {
                    Class<?> observerType = type("android.content.pm.IPackageDataObserver"); Callback callback = new Callback(observerType.getName(), pkg);
                    Object observer = callback.asInterface();
                    if (action.equals("clear-cache")) {
                        if (!context().getString("cachePermission").equals("granted")) throw new SecurityException("Cache clearing requires verified INTERNAL_DELETE_CACHE_FILES permission. No data was deleted.");
                        Method method = pmType.getMethod("deleteApplicationCacheFilesAsUser", String.class, int.class, observerType);
                        dispatched = true; method.invoke(pm, pkg, user, observer);
                    } else {
                        Object am = service("activity", "android.app.IActivityManager");
                        Method method = type("android.app.IActivityManager").getMethod("clearApplicationUserData", String.class, boolean.class, observerType, int.class);
                        dispatched = true; boolean accepted = (Boolean) method.invoke(am, pkg, false, observer, user);
                        if (!accepted) { result.put("outcome", "failed").put("message", "Android did not accept app data clearing."); System.out.println(result.toString()); System.exit(0); }
                    }
                    callback.await(result);
                } else if (action.equals("uninstall")) {
                    Class<?> installerType = type("android.content.pm.IPackageInstaller"); Object installer = pmType.getMethod("getPackageInstaller").invoke(pm);
                    PackageInstaller wrapper;
                    try { wrapper = (PackageInstaller) PackageInstaller.class.getConstructor(installerType, String.class, String.class, int.class).newInstance(installer, "com.android.shell", null, user); }
                    catch (NoSuchMethodException old) { wrapper = (PackageInstaller) PackageInstaller.class.getConstructor(installerType, String.class, int.class).newInstance(installer, "com.android.shell", user); }
                    Callback receiver = new Callback("android.content.IIntentSender", pkg);
                    IntentSender sender = (IntentSender) IntentSender.class.getConstructor(type("android.content.IIntentSender")).newInstance(receiver.asInterface());
                    Method method = PackageInstaller.class.getMethod("uninstall", String.class, int.class, IntentSender.class);
                    // DELETE_SYSTEM_APP keeps firmware APK and limits removal to this user. Never DELETE_ALL_USERS.
                    int flags = (before.getBoolean("system") ? 4 : 0) | (Boolean.parseBoolean(args[5]) ? 1 : 0);
                    dispatched = true; method.invoke(wrapper, pkg, flags, sender); receiver.await(result);
                } else throw new IllegalArgumentException("Unsupported package action");
            }
        } catch (Throwable e) {
            while (e instanceof InvocationTargetException && e.getCause() != null) e = e.getCause();
            try { result.put("outcome", e instanceof SecurityException ? "denied" : dispatched ? "uncertain" : "failed").put("message", e.getClass().getName() + ": " + e.getMessage()); } catch (Exception ignored) { }
        }
        try { result.put("dispatched", dispatched); } catch (Exception ignored) { }
        System.out.println(result.toString()); System.exit(0);
    }
}
