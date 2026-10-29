package dev.adbvault.helper;

import android.app.Application;
import android.app.Instrumentation;
import android.app.usage.StorageStats;
import android.app.usage.StorageStatsManager;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.os.Looper;
import android.os.UserHandle;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayOutputStream;
import java.io.PrintWriter;
import java.io.OutputStreamWriter;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.util.List;
import java.util.Locale;
import java.util.LinkedHashSet;

/** Short-lived, read-only PackageManager collector running as authenticated ADB shell. */
public final class Main {
    public static final int PROTOCOL = 1;
    public static final String VERSION = "0.1.0";
    private static final int ICON_SIZE = 96;
    private static final PrintWriter OUTPUT = new PrintWriter(new OutputStreamWriter(System.out, java.nio.charset.StandardCharsets.UTF_8), true);

    private static void emit(JSONObject value) {
        OUTPUT.println(value.toString());
        if (OUTPUT.checkError()) System.exit(2); // Disconnected ADB pipe: stop collecting.
    }

    static Context context(int userId) throws Exception {
        Looper.prepareMainLooper();
        Class<?> activityThread = Class.forName("android.app.ActivityThread");
        Object thread = activityThread.getMethod("systemMain").invoke(null);
        Context system = (Context) activityThread.getMethod("getSystemContext").invoke(thread);
        Constructor<UserHandle> constructor = UserHandle.class.getDeclaredConstructor(int.class);
        constructor.setAccessible(true);
        Context user = (Context) Context.class.getMethod("createContextAsUser", UserHandle.class, int.class)
                .invoke(system, constructor.newInstance(userId), 0);
        // Attribute framework calls to the actual shell package, not an installed companion.
        Context shell = user.createPackageContext("com.android.shell", Context.CONTEXT_IGNORE_SECURITY);
        // OEM resource caches consult ActivityThread.currentPackageName()/currentProcessName().
        // app_process has no normal bindApplication phase, so provide the shell identity locally.
        Class<?> bindingClass = Class.forName("android.app.ActivityThread$AppBindData");
        Constructor<?> bindingConstructor = bindingClass.getDeclaredConstructor();
        bindingConstructor.setAccessible(true);
        Object binding = bindingConstructor.newInstance();
        for (String name : new String[] { "appInfo", "processName" }) {
            Field field = bindingClass.getDeclaredField(name); field.setAccessible(true);
            field.set(binding, name.equals("appInfo") ? shell.getApplicationInfo() : "com.android.shell");
        }
        Field bound = activityThread.getDeclaredField("mBoundApplication"); bound.setAccessible(true); bound.set(thread, binding);
        Application application = Instrumentation.newApplication(Application.class, shell);
        Field initial = activityThread.getDeclaredField("mInitialApplication");
        initial.setAccessible(true);
        initial.set(thread, application);
        try {
            // MediaTek's app-only drawable cache dereferences uninitialized state in app_process.
            // Disable this optimization in OUR process only; never change a system property.
            Field feature = Class.forName("com.mediatek.res.AsyncDrawableCache").getDeclaredField("sFeatureConfig");
            feature.setAccessible(true); feature.set(null, "0");
        } catch (ReflectiveOperationException ignored) { /* Other OEMs do not have this cache. */ }
        return shell;
    }

    private static String icon(Drawable drawable) throws Exception {
        Bitmap bitmap = Bitmap.createBitmap(ICON_SIZE, ICON_SIZE, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(bitmap);
            drawable.setBounds(0, 0, ICON_SIZE, ICON_SIZE);
            drawable.draw(canvas); // Bitmap, vector, layered and adaptive drawables use the same path.
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)) throw new Exception("PNG encoding failed");
            return Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally { bitmap.recycle(); }
    }

    private static String error(Throwable value) {
        // Binder attaches a RemoteException containing only a remote stack trace.
        // Keep the real SecurityException message; unwrap reflection wrappers only.
        while ((value instanceof java.lang.reflect.InvocationTargetException || value instanceof ExceptionInInitializerError)
                && value.getCause() != null) value = value.getCause();
        return value.getClass().getSimpleName() + ": " + String.valueOf(value.getMessage());
    }

    private static void applicationIcon(PackageManager pm, ApplicationInfo app, JSONObject entry) throws Throwable {
        Drawable drawable;
        String png;
        try {
            drawable = pm.getApplicationIcon(app);
            png = icon(drawable);
        } catch (Throwable themedFailure) {
            try {
                // Some OEM theme engines require a normally bound app process. The APK
                // resource is still readable by Shell, including vector/adaptive/split icons.
                // Resource-only loading never launches the app or executes its code.
                if (app.icon == 0) drawable = pm.getDefaultActivityIcon();
                else {
                    android.content.res.Resources resources = pm.getResourcesForApplication(app);
                    android.content.res.Resources.Theme theme = resources.newTheme();
                    theme.applyStyle(android.R.style.Theme_DeviceDefault, true);
                    if (app.theme != 0) theme.applyStyle(app.theme, true);
                    drawable = resources.getDrawable(app.icon, theme);
                }
                png = icon(drawable);
            } catch (Throwable resourceFailure) {
                resourceFailure.addSuppressed(themedFailure);
                throw resourceFailure;
            }
        }
        entry.put("iconType", drawable.getClass().getSimpleName()).put("iconPng", png);
    }

    private static void issue(JSONArray issues, String area, Throwable failure) throws Exception {
        issues.put(new JSONObject().put("area", area).put("message", error(failure)));
    }
    private static void field(JSONObject fields, String name, Object value) throws Exception {
        if (value != null && !String.valueOf(value).isEmpty()) fields.put(name, String.valueOf(value));
    }
    private static void path(JSONArray paths, String name, String value) throws Exception {
        if (value != null && !value.isEmpty()) paths.put(new JSONObject().put("name", name).put("path", value));
    }
    private static JSONObject installer(PackageManager pm, String role, String name) throws Exception {
        String label = null;
        if (name != null) try { label = String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(name, 0))); } catch (Exception ignored) { }
        return new JSONObject().put("role", role).put("packageName", name == null ? JSONObject.NULL : name).put("label", label == null ? JSONObject.NULL : label);
    }
    private static JSONObject traffic(Context context, int type, int uid, long start, long end) throws Exception {
        android.app.usage.NetworkStatsManager manager = context.getSystemService(android.app.usage.NetworkStatsManager.class);
        if (manager == null) throw new IllegalStateException("Network statistics unavailable");
        // The system-created manager may retain an "android" context in app_process.
        // Attribute this helper's queries to its actual shell UID, without granting permissions.
        Field managerContext = android.app.usage.NetworkStatsManager.class.getDeclaredField("mContext");
        managerContext.setAccessible(true);
        managerContext.set(manager, new android.content.ContextWrapper(context) {
            public String getOpPackageName() { return "com.android.shell"; }
            public String getPackageName() { return "com.android.shell"; }
        });
        android.app.usage.NetworkStats stats = manager.queryDetailsForUid(type, null, start, end, uid);
        if (stats == null) throw new IllegalStateException("Network statistics query returned no result");
        long rx = 0, tx = 0;
        try {
            android.app.usage.NetworkStats.Bucket bucket = new android.app.usage.NetworkStats.Bucket();
            while (stats.hasNextBucket()) {
                if (!stats.getNextBucket(bucket)) break;
                rx = Math.addExact(rx, bucket.getRxBytes()); tx = Math.addExact(tx, bucket.getTxBytes());
            }
        } finally { stats.close(); }
        return new JSONObject().put("rx", rx).put("tx", tx);
    }
    /** A targeted snapshot; no icon reads, app launches or system settings changes. */
    private static void rootDetails(Context context, String name, int userId, int expectedUid) throws Exception {
        if (android.os.Process.myUid() != 0) throw new SecurityException("Root access was not granted");
        PackageManager pm = context.getPackageManager();
        PackageInfo pkg = pm.getPackageInfo(name, PackageManager.MATCH_DISABLED_COMPONENTS);
        int uid = pkg.applicationInfo.uid;
        if (uid != expectedUid || uid / 100000 != userId) throw new SecurityException("Application UID changed; refresh applications");
        JSONObject checks = new JSONObject();
        if (Build.VERSION.SDK_INT < 31) try {
            java.io.File store = new java.io.File("/data/misc/keystore/user_" + userId);
            String[] names = store.list();
            if (names == null) throw new java.io.IOException("Legacy KeyStore directory is unavailable");
            JSONArray rows = new JSONArray();
            for (String entry : names) if (entry.startsWith(uid + "_") || entry.startsWith("." + uid + "_")) {
                if (rows.length() >= 1024) throw new java.io.IOException("Too many KeyStore aliases");
                rows.put(badgeItem("Entry filename", entry));
            }
            checks.put("keyStore", badgeCheck(rows.length() > 0, "Legacy Android KeyStore filenames for this UID. No file contents or key material are read.", rows));
        } catch (Exception e) { checks.put("keyStore", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            // Never expose the per-user secret used to derive identifiers.
            if (name.equals("android")) throw new UnsupportedOperationException("The system user key is not an application SSAID");
            java.io.File file = new java.io.File("/data/system/users/" + userId + "/settings_ssaid.xml");
            if (!file.isFile() || !file.canRead()) throw new java.io.IOException("SSAID store is unavailable");
            if (file.length() > 4_000_000) throw new java.io.IOException("SSAID store exceeds the read limit");
            JSONArray rows = new JSONArray();
            try (java.io.InputStream input = new java.io.FileInputStream(file)) {
                org.xmlpull.v1.XmlPullParser parser;
                if (Build.VERSION.SDK_INT >= 31) parser = (org.xmlpull.v1.XmlPullParser) android.util.Xml.class.getMethod("resolvePullParser", java.io.InputStream.class).invoke(null, input);
                else { parser = android.util.Xml.newPullParser(); parser.setInput(input, "UTF-8"); }
                for (int event = parser.getEventType(); event != org.xmlpull.v1.XmlPullParser.END_DOCUMENT; event = parser.next()) {
                    if (event == org.xmlpull.v1.XmlPullParser.DOCDECL) throw new java.io.IOException("Unexpected XML document declaration");
                    if (event == org.xmlpull.v1.XmlPullParser.START_TAG && "setting".equals(parser.getName()) && String.valueOf(uid).equals(parser.getAttributeValue(null, "name"))) {
                        String value = parser.getAttributeValue(null, "value");
                        if (value == null || !value.matches("[0-9a-fA-F]{16}")) throw new java.io.IOException("Invalid application SSAID record");
                        rows.put(badgeItem("SSAID · User " + userId + " · UID " + uid, value));
                    }
                }
            }
            checks.put("ssaid", badgeCheck(rows.length() > 0, "Existing app/user SSAID record, read through root. Shared-UID apps may share the record. No identifier was generated or changed.", rows));
        } catch (Exception e) { checks.put("ssaid", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            Constructor<UserHandle> c = UserHandle.class.getDeclaredConstructor(int.class); c.setAccessible(true);
            boolean hidden = (Boolean) PackageManager.class.getMethod("getApplicationHiddenSettingAsUser", String.class, UserHandle.class).invoke(pm, name, c.newInstance(userId));
            checks.put("hidden", badgeCheck(hidden, "Android hidden state for the selected profile, read through root.", new JSONArray()));
        } catch (Exception e) { checks.put("hidden", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            if (Build.VERSION.SDK_INT < 29) throw new UnsupportedOperationException("URI grant inspection requires Android 10 or newer");
            Object binder = Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "uri_grants");
            Object manager = Class.forName("android.app.IUriGrantsManager$Stub").getMethod("asInterface", android.os.IBinder.class).invoke(null, binder);
            Object slice = Class.forName("android.app.IUriGrantsManager").getMethod("getGrantedUriPermissions", String.class, int.class).invoke(manager, name, userId);
            List<?> grants = (List<?>) slice.getClass().getMethod("getList").invoke(slice);
            JSONArray rows = new JSONArray();
            if (grants.size() > 1024) throw new IllegalStateException("Too many URI grants");
            for (Object grant : grants) rows.put(badgeItem(String.valueOf(grant.getClass().getField("uri").get(grant)), "Persisted URI grant"));
            checks.put("saf", badgeCheck(rows.length() > 0, "Persisted URI grants for this app/profile, read through root.", rows));
        } catch (Exception e) { checks.put("saf", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            java.io.File root = new java.io.File("/data/adb/modules");
            java.io.File[] modules = root.listFiles();
            if (modules == null) throw new java.io.IOException("Magisk module directory is unavailable");
            if (modules.length > 512) throw new java.io.IOException("Too many modules");
            JSONArray rows = new JSONArray();
            String source = pkg.applicationInfo.sourceDir;
            for (java.io.File module : modules) {
                if (!module.isDirectory() || !module.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) continue;
                if (new java.io.File(module, "disable").exists() || new java.io.File(module, "remove").exists() || new java.io.File(module, "skip_mount").exists()) continue;
                String relative = source != null && source.startsWith("/system/") ? source.substring(1) : source != null && (source.startsWith("/product/") || source.startsWith("/vendor/") || source.startsWith("/system_ext/")) ? "system" + source : null;
                if (relative == null) continue;
                java.io.File apk = new java.io.File(module, relative);
                // Require the live APK and the module file to be the same mounted inode.
                if (apk.isFile()) {
                    StructStat live = Os.stat(source), overlay = Os.stat(apk.getPath());
                    if (live.st_dev == overlay.st_dev && live.st_ino == overlay.st_ino) rows.put(badgeItem(module.getName(), source));
                }
            }
            checks.put("systemless", badgeCheck(rows.length() > 0, "Installed APK matches an active Magisk module mount. Disabled, removed and skip_mount modules are excluded; custom mount systems are not inspected.", rows));
        } catch (Exception e) { checks.put("systemless", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        emit(new JSONObject().put("type", "root-details").put("protocolVersion", PROTOCOL).put("packageName", name).put("userId", userId).put("uid", uid).put("badgeChecks", checks));
    }

    private static void details(Context context, String name, int userId, boolean storage, boolean permissions) throws Exception {
        PackageManager pm = context.getPackageManager();
        PackageInfo pkg = pm.getPackageInfo(name, PackageManager.MATCH_DISABLED_COMPONENTS | PackageManager.MATCH_DIRECT_BOOT_AWARE | PackageManager.MATCH_DIRECT_BOOT_UNAWARE | PackageManager.GET_META_DATA | PackageManager.GET_ACTIVITIES | PackageManager.GET_RECEIVERS | PackageManager.GET_SERVICES | PackageManager.GET_PROVIDERS | (permissions ? PackageManager.GET_PERMISSIONS : 0));
        ApplicationInfo app = pkg.applicationInfo;
        if (app == null || app.uid / 100000 != userId) throw new IllegalStateException("Application profile mismatch");
        JSONObject fields = new JSONObject(), badges = new JSONObject();
        JSONArray issues = new JSONArray(), flags = new JSONArray(), paths = new JSONArray(), splits = new JSONArray(), installers = new JSONArray(), links = new JSONArray();
        JSONObject badgeChecks = collectBadgeChecks(context, pm, pkg);
        JSONArray components = new JSONArray();
        collectComponents(pm, pkg.activities, "Activity", components);
        collectComponents(pm, pkg.receivers, "Receiver", components);
        collectComponents(pm, pkg.services, "Service", components);
        collectComponents(pm, pkg.providers, "Provider", components);
        JSONArray requestedPermissions = permissions ? collectRequestedPermissions(pm, pkg) : null;
        field(fields, "processName", app.processName); field(fields, "sharedUserId", pkg.sharedUserId);
        field(fields, "flagsHex", String.format(Locale.ROOT, "0x%08X", app.flags));
        java.util.TreeSet<String> flagNames = new java.util.TreeSet<String>();
        for (Field f : ApplicationInfo.class.getFields()) if (f.getName().startsWith("FLAG_") && f.getType() == int.class && java.lang.reflect.Modifier.isStatic(f.getModifiers())) {
            try { int mask = f.getInt(null); if (mask != 0 && (app.flags & mask) == mask) flagNames.add(f.getName()); } catch (Exception ignored) { }
        }
        for (String flagName : flagNames) flags.put(flagName);
        badges.put("testOnly", (app.flags & ApplicationInfo.FLAG_TEST_ONLY) != 0)
              .put("noCode", (app.flags & ApplicationInfo.FLAG_HAS_CODE) == 0)
              .put("largeHeap", (app.flags & ApplicationInfo.FLAG_LARGE_HEAP) != 0)
              .put("debuggable", (app.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0)
              .put("disabled", !app.enabled)
              .put("suspended", (app.flags & ApplicationInfo.FLAG_SUSPENDED) != 0)
              .put("stopped", (app.flags & ApplicationInfo.FLAG_STOPPED) != 0)
              .put("system", (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0)
              .put("updatedSystem", (app.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0);
        path(paths, "Base APK", app.sourceDir);
        path(paths, "APK directory", app.sourceDir == null ? null : new java.io.File(app.sourceDir).getParent());
        path(paths, "Data directory", app.dataDir);
        try { Field f = ApplicationInfo.class.getDeclaredField("credentialProtectedDataDir"); f.setAccessible(true); path(paths, "Credential-protected data", (String) f.get(app)); }
        catch (Exception failure) { issue(issues, "Credential-protected data", failure); }
        path(paths, "Device-protected data", app.deviceProtectedDataDir);
        path(paths, "Native libraries", app.nativeLibraryDir);
        if (app.splitSourceDirs != null) for (int i = 0; i < app.splitSourceDirs.length; i++) {
            String split = app.splitSourceDirs[i]; Object bytes = JSONObject.NULL;
            try { StructStat stat = Os.stat(split); if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size < 0) throw new IllegalStateException("Not a regular APK file"); bytes = stat.st_size; }
            catch (Exception failure) { issue(issues, "Split APK size", failure); }
            splits.put(new JSONObject().put("name", pkg.splitNames != null && i < pkg.splitNames.length ? pkg.splitNames[i] : new java.io.File(split).getName()).put("path", split).put("bytes", bytes));
        }
        try {
            android.content.Intent launch = pm.getLaunchIntentForPackage(name);
            if (launch == null) launch = pm.getLeanbackLaunchIntentForPackage(name);
            field(fields, "mainActivity", launch == null || launch.getComponent() == null ? null : launch.getComponent().flattenToShortString());
        } catch (Exception failure) { issue(issues, "Main activity", failure); }
        for (String key : new String[] { "primaryCpuAbi", "secondaryCpuAbi", "seInfo", "seInfoUser", "zygotePreloadName" }) try {
            Field f = ApplicationInfo.class.getDeclaredField(key); f.setAccessible(true); field(fields, key, f.get(app));
        } catch (Exception failure) { issue(issues, key, failure); }
        try { field(fields, "hiddenApiPolicy", ApplicationInfo.class.getMethod("getHiddenApiEnforcementPolicy").invoke(app)); }
        catch (Exception failure) { issue(issues, "Hidden API policy", failure); }
        try { badges.put("staticSharedLibrary", ApplicationInfo.class.getMethod("isStaticSharedLibrary").invoke(app)); }
        catch (Exception failure) { badges.put("staticSharedLibrary", JSONObject.NULL); issue(issues, "Static shared library", failure); }
        try { Constructor<UserHandle> c = UserHandle.class.getDeclaredConstructor(int.class); c.setAccessible(true); badges.put("hidden", PackageManager.class.getMethod("getApplicationHiddenSettingAsUser", String.class, UserHandle.class).invoke(pm, name, c.newInstance(userId))); }
        catch (Exception failure) { badges.put("hidden", JSONObject.NULL); issue(issues, "Hidden state", failure); }
        try {
            android.os.PowerManager power = context.getSystemService(android.os.PowerManager.class);
            if (power == null) throw new IllegalStateException("Power service unavailable");
            badges.put("batteryExempt", power.isIgnoringBatteryOptimizations(name));
        } catch (Exception failure) { badges.put("batteryExempt", JSONObject.NULL); issue(issues, "Battery optimisation", failure); }
        if (Build.VERSION.SDK_INT >= 30) try {
            android.content.pm.InstallSourceInfo source = pm.getInstallSourceInfo(name);
            installers.put(installer(pm, "Installer of record", source.getInstallingPackageName()));
            installers.put(installer(pm, "Initiating installer", source.getInitiatingPackageName()));
            installers.put(installer(pm, "Originating source", source.getOriginatingPackageName()));
        } catch (Exception failure) { issue(issues, "Install source", failure); }
        else {
            try { installers.put(installer(pm, "Installer of record", pm.getInstallerPackageName(name))); }
            catch (Exception failure) { issue(issues, "Installer", failure); }
            issues.put(new JSONObject().put("area", "Install source").put("message", "Initiating and originating packages require Android 11 or newer."));
        }
        if (Build.VERSION.SDK_INT >= 31) try {
            android.content.pm.verify.domain.DomainVerificationManager manager = context.getSystemService(android.content.pm.verify.domain.DomainVerificationManager.class);
            if (manager == null) throw new IllegalStateException("Domain verification service unavailable");
            android.content.pm.verify.domain.DomainVerificationUserState state = manager.getDomainVerificationUserState(name);
            badges.put("openLinks", state != null && !state.getHostToStateMap().isEmpty());
            if (state != null) {
                field(fields, "linkHandling", state.isLinkHandlingAllowed() ? "Allowed" : "Not allowed");
                boolean approved = false;
                for (Integer status : state.getHostToStateMap().values()) if (status == 1 || status == 2) approved = true;
                badges.put("openLinksByDefault", state.isLinkHandlingAllowed() && approved);
                for (java.util.Map.Entry<String, Integer> host : state.getHostToStateMap().entrySet()) links.put(new JSONObject().put("host", host.getKey()).put("state", host.getValue() == 2 ? "Verified" : host.getValue() == 1 ? "Selected" : "Not approved"));
            }
        } catch (Exception failure) { badges.put("openLinks", JSONObject.NULL); issue(issues, "App links", failure); }
        else { badges.put("openLinks", JSONObject.NULL); issues.put(new JSONObject().put("area", "App links").put("message", "Domain verification details require Android 12 or newer.")); }
        JSONObject sizes = new JSONObject().put("requested", storage).put("appBytes", JSONObject.NULL).put("dataBytes", JSONObject.NULL).put("cacheBytes", JSONObject.NULL);
        if (storage) try {
            StorageStatsManager manager = context.getSystemService(StorageStatsManager.class);
            if (manager == null) throw new IllegalStateException("Storage statistics unavailable");
            Constructor<UserHandle> constructor = UserHandle.class.getDeclaredConstructor(int.class); constructor.setAccessible(true);
            StorageStats stats = manager.queryStatsForPackage(app.storageUuid, name, constructor.newInstance(userId));
            sizes.put("appBytes", stats.getAppBytes()).put("dataBytes", stats.getDataBytes()).put("cacheBytes", stats.getCacheBytes());
        } catch (Exception failure) { issue(issues, "Storage", failure); }
        long end = System.currentTimeMillis(), start = Math.max(0, end - 30L * 24 * 60 * 60 * 1000);
        JSONObject network = new JSONObject().put("start", start).put("end", end).put("wifi", JSONObject.NULL).put("mobile", JSONObject.NULL);
        try { network.put("wifi", traffic(context, android.net.ConnectivityManager.TYPE_WIFI, app.uid, start, end)); }
        catch (Exception failure) { issue(issues, "Wi-Fi traffic", failure); }
        try { network.put("mobile", traffic(context, android.net.ConnectivityManager.TYPE_MOBILE, app.uid, start, end)); }
        catch (Exception failure) { issue(issues, "Mobile traffic", failure); }
        emit(new JSONObject().put("type", "details").put("protocolVersion", PROTOCOL).put("packageName", name).put("userId", userId).put("uid", app.uid)
             .put("fields", fields).put("badges", badges).put("flags", flags).put("paths", paths).put("splits", splits).put("installers", installers)
             .put("storage", sizes).put("network", network).put("links", links).put("issues", issues).put("badgeChecks", badgeChecks).put("components", components).put("requestedPermissions", requestedPermissions));
    }

    private static JSONObject badgeCheck(Object present, String reason, JSONArray items) throws Exception {
        return new JSONObject().put("present", present).put("reason", reason).put("items", items);
    }
    private static JSONObject badgeItem(String name, String value) throws Exception { return new JSONObject().put("name", name).put("value", value); }
    private static String failureMessage(Exception failure) {
        Throwable cause = failure; while (cause.getCause() != null) cause = cause.getCause();
        return cause.getClass().getSimpleName() + ": " + String.valueOf(cause.getMessage());
    }
    private static void collectComponents(PackageManager pm, android.content.pm.ComponentInfo[] entries, String type, JSONArray output) throws Exception {
        if (entries == null) return;
        for (android.content.pm.ComponentInfo entry : entries) {
            Object enabled = JSONObject.NULL;
            try {
                int state = pm.getComponentEnabledSetting(new android.content.ComponentName(entry.packageName, entry.name));
                enabled = state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT ? entry.enabled : state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
            } catch (Exception ignored) { }
            JSONObject row = new JSONObject().put("name", entry.name).put("type", type).put("enabled", enabled)
                .put("exported", entry.exported).put("directBootAware", entry.directBootAware)
                .put("processName", nullableText(entry.processName));
            if (entry instanceof android.content.pm.ActivityInfo) {
                android.content.pm.ActivityInfo activity = (android.content.pm.ActivityInfo) entry;
                row.put("permission", nullableText(activity.permission)).put("targetActivity", nullableText(activity.targetActivity));
            } else if (entry instanceof android.content.pm.ServiceInfo) {
                row.put("permission", nullableText(((android.content.pm.ServiceInfo) entry).permission));
            } else if (entry instanceof android.content.pm.ProviderInfo) {
                android.content.pm.ProviderInfo provider = (android.content.pm.ProviderInfo) entry;
                row.put("authority", nullableText(provider.authority)).put("readPermission", nullableText(provider.readPermission)).put("writePermission", nullableText(provider.writePermission));
            }
            output.put(row);
        }
    }
    private static Object nullableText(CharSequence value) {
        if (value == null) return JSONObject.NULL;
        String text = value.toString();
        return text.length() <= 8192 ? text : text.substring(0, 8189) + "...";
    }
    private static JSONArray collectRequestedPermissions(PackageManager pm, PackageInfo pkg) throws Exception {
        JSONArray output = new JSONArray();
        if (pkg.requestedPermissions == null) return output;
        java.lang.reflect.Method getFlags = null;
        UserHandle permissionUser = null;
        try {
            getFlags = PackageManager.class.getMethod("getPermissionFlags", String.class, String.class, UserHandle.class);
            Constructor<UserHandle> constructor = UserHandle.class.getDeclaredConstructor(int.class);
            constructor.setAccessible(true);
            permissionUser = constructor.newInstance(pkg.applicationInfo.uid / 100000);
        } catch (Exception ignored) { /* Unknown restrictions must not be treated as editable. */ }
        for (int i = 0; i < pkg.requestedPermissions.length; i++) {
            String name = pkg.requestedPermissions[i];
            Object granted = pkg.requestedPermissionsFlags != null && i < pkg.requestedPermissionsFlags.length
                ? Boolean.valueOf((pkg.requestedPermissionsFlags[i] & PackageInfo.REQUESTED_PERMISSION_GRANTED) != 0) : JSONObject.NULL;
            JSONObject row = new JSONObject().put("name", name).put("granted", granted).put("protectionLevel", JSONObject.NULL)
                .put("declaringPackage", JSONObject.NULL).put("label", JSONObject.NULL).put("description", JSONObject.NULL)
                .put("flags", JSONObject.NULL).put("definitionFlags", JSONObject.NULL);
            try { if (getFlags != null && permissionUser != null) row.put("flags", getFlags.invoke(pm, name, pkg.packageName, permissionUser)); }
            catch (Exception ignored) { }
            try {
                android.content.pm.PermissionInfo info = pm.getPermissionInfo(name, 0);
                row.put("protectionLevel", info.protectionLevel).put("definitionFlags", info.flags).put("declaringPackage", nullableText(info.packageName));
                try { row.put("label", nullableText(info.loadLabel(pm))); } catch (Exception ignored) { }
                try { row.put("description", nullableText(info.loadDescription(pm))); } catch (Exception ignored) { }
            } catch (Exception ignored) { /* Undefined or inaccessible permission metadata remains unknown. */ }
            output.put(row);
        }
        return output;
    }
    private static void permissionState(Context context, String name, int userId) throws Exception {
        PackageManager pm = context.getPackageManager();
        PackageInfo pkg = pm.getPackageInfo(name, PackageManager.GET_PERMISSIONS);
        if (pkg.applicationInfo == null || pkg.applicationInfo.uid / 100000 != userId) throw new IllegalStateException("Application profile mismatch");
        String[] shared = pm.getPackagesForUid(pkg.applicationInfo.uid);
        if (shared == null) throw new IllegalStateException("Application UID unavailable");
        long version = Build.VERSION.SDK_INT >= 28 ? pkg.getLongVersionCode() : pkg.versionCode;
        emit(new JSONObject().put("type", "permissions").put("protocolVersion", PROTOCOL).put("packageName", name).put("userId", userId)
            .put("uid", pkg.applicationInfo.uid).put("versionCode", version).put("targetSdk", pkg.applicationInfo.targetSdkVersion)
            .put("sharedUidPackages", new JSONArray(java.util.Arrays.asList(shared))).put("requestedPermissions", collectRequestedPermissions(pm, pkg)));
    }
    // Manifest stamp heuristic, not certificate verification or proof of Play enrolment.
    private static Boolean playSigningState(Object type, Object source) {
        if ((type != null && !(type instanceof String)) || (source != null && !(source instanceof String))) return null;
        return "STAMP_TYPE_DISTRIBUTION_APK".equals(type) && "https://play.google.com/store".equals(source);
    }
    private static String stampValue(Object value) {
        if (value == null) return "Not declared";
        if (!(value instanceof String)) return "Invalid metadata type";
        String text = (String) value;
        return text.length() <= 512 ? text : text.substring(0, 512) + "… (truncated)";
    }
    private static Boolean wxState(int sdk, int targetSdk) {
        if (sdk <= 0 || targetSdk <= 0) return null;
        return sdk >= 29 && targetSdk < 29;
    }
    private static String overlayTarget(Object pkg) throws Exception {
        Object value = pkg.getClass().getField("overlayTarget").get(pkg);
        if (value == null) return null;
        if (!(value instanceof String) || ((String) value).isEmpty()) throw new IllegalStateException("Invalid overlay target metadata");
        return (String) value;
    }
    private static void overlayField(JSONArray rows, Object pkg, String label, String fieldName) throws Exception {
        String value;
        try {
            Object raw = pkg.getClass().getField(fieldName).get(pkg);
            value = raw == null ? "Not declared" : String.valueOf(raw);
        } catch (Exception failure) { value = "Unavailable: " + failureMessage(failure); }
        rows.put(badgeItem(label, value));
    }
    private static boolean matchesProcess(int uid, int targetUid, String[] packages, String targetPackage) {
        if (uid < 0 || targetUid < 0 || uid / 100000 != targetUid / 100000 || packages == null) return false;
        for (String name : packages) if (targetPackage.equals(name)) return true;
        return false;
    }
    private static Boolean runningState(int matches, boolean processesComplete, boolean servicesComplete) {
        return matches > 0 ? Boolean.TRUE : processesComplete && servicesComplete ? Boolean.FALSE : null;
    }
    private static JSONObject runningCheck(Context context, PackageInfo pkg) throws Exception {
        android.app.ActivityManager manager = context.getSystemService(android.app.ActivityManager.class);
        JSONArray rows = new JSONArray(); StringBuilder limitations = new StringBuilder();
        boolean processesComplete = false, servicesComplete = false;
        boolean visible = context.checkSelfPermission("android.permission.REAL_GET_TASKS") == PackageManager.PERMISSION_GRANTED
                && (pkg.applicationInfo.uid / 100000 == android.os.Process.myUid() / 100000
                    || context.checkSelfPermission("android.permission.INTERACT_ACROSS_USERS_FULL") == PackageManager.PERMISSION_GRANTED);
        if (manager == null || !visible) return badgeCheck(JSONObject.NULL,
                "Full process/service visibility for the selected Android profile is unavailable to this ADB session.", rows);
        LinkedHashSet<String> seen = new LinkedHashSet<String>();
        try {
            List<android.app.ActivityManager.RunningAppProcessInfo> processes = manager.getRunningAppProcesses();
            if (processes == null) throw new IllegalStateException("Process query returned no list");
            for (android.app.ActivityManager.RunningAppProcessInfo process : processes) {
                if (process.pid > 0 && matchesProcess(process.uid, pkg.applicationInfo.uid, process.pkgList, pkg.packageName)
                        && seen.add("process:" + process.pid) && rows.length() < 256)
                    rows.put(badgeItem(process.processName == null ? pkg.packageName : process.processName,
                            "Process · PID " + process.pid + " · UID " + process.uid));
            }
            processesComplete = true;
        } catch (Exception failure) { limitations.append(" Process list unavailable: ").append(failureMessage(failure)); }
        try {
            List<android.app.ActivityManager.RunningServiceInfo> services = manager.getRunningServices(10000);
            if (services == null) throw new IllegalStateException("Service query returned no list");
            for (android.app.ActivityManager.RunningServiceInfo service : services) {
                if (service.pid > 0 && service.service != null && matchesProcess(service.uid, pkg.applicationInfo.uid,
                        new String[] { service.service.getPackageName() }, pkg.packageName)
                        && seen.add("service:" + service.service.flattenToString()) && rows.length() < 256)
                    rows.put(badgeItem(service.service.getClassName(), "Service · PID " + service.pid + " · UID " + service.uid + (service.foreground ? " · foreground" : "")));
            }
            servicesComplete = services.size() < 10000;
            if (!servicesComplete) limitations.append(" Service list reached its limit.");
        } catch (Exception failure) { limitations.append(" Service list unavailable: ").append(failureMessage(failure)); }
        Boolean present = runningState(rows.length(), processesComplete, servicesComplete);
        String reason = "Snapshot of Android application processes and services for the selected profile. Cached processes also count; this does not mean the app is on screen. Refresh details to recheck.";
        if (rows.length() == 256) reason += " Evidence is limited to 256 entries.";
        return badgeCheck(present == null ? JSONObject.NULL : present, reason + limitations, rows);
    }
    private static JSONObject collectBadgeChecks(Context context, PackageManager pm, PackageInfo pkg) throws Exception {
        JSONObject checks = new JSONObject(); ApplicationInfo app = pkg.applicationInfo;
        Boolean wx = wxState(Build.VERSION.SDK_INT, app.targetSdkVersion);
        checks.put("wx", badgeCheck(wx == null ? JSONObject.NULL : wx,
                "App Manager compatibility rule: Android API 29+ and Target SDK below 29. This indicates the legacy app-directory execution exception, not measured writable/executable memory or active exploitation.",
                new JSONArray().put(badgeItem("Android API", String.valueOf(Build.VERSION.SDK_INT)))
                        .put(badgeItem("Target SDK", String.valueOf(app.targetSdkVersion)))));
        try {
            String target = overlayTarget(pkg);
            JSONArray rows = new JSONArray();
            if (target != null) {
                rows.put(badgeItem("Target package", target));
                overlayField(rows, pkg, "Target overlayable", "targetOverlayableName");
                overlayField(rows, pkg, "Category", "overlayCategory");
                overlayField(rows, pkg, "Priority", "overlayPriority");
                try { rows.put(badgeItem("Static overlay", Boolean.TRUE.equals(pkg.getClass().getMethod("isStaticOverlayPackage").invoke(pkg)) ? "Yes" : "No")); }
                catch (Exception failure) { rows.put(badgeItem("Static overlay", "Unavailable: " + failureMessage(failure))); }
            }
            checks.put("overlay", badgeCheck(target != null, "Android declares a resource overlay target. This is not the permission to draw over other apps and does not establish whether the overlay is currently enabled.", rows));
        } catch (Exception failure) { checks.put("overlay", badgeCheck(JSONObject.NULL, failureMessage(failure), new JSONArray())); }
        try {
            Object stampType = app.metaData == null ? null : app.metaData.get("com.android.stamp.type");
            Object stampSource = app.metaData == null ? null : app.metaData.get("com.android.stamp.source");
            Boolean present = playSigningState(stampType, stampSource);
            JSONArray rows = new JSONArray().put(badgeItem("com.android.stamp.type", stampValue(stampType)))
                    .put(badgeItem("com.android.stamp.source", stampValue(stampSource)));
            String reason = present == null ? "Stamp metadata has an unexpected type; the check is unavailable."
                    : present ? "Manifest stamp metadata matches the Play distribution markers used by App Manager. This suggests possible Play App Signing; no certificate or cryptographic source stamp verification was performed."
                    : "Play distribution markers were not found as an exact pair. This does not prove that Play App Signing is not used. Installer identity is not used for this check.";
            checks.put("playAppSigning", badgeCheck(present == null ? JSONObject.NULL : present, reason, rows));
        } catch (Exception e) { checks.put("playAppSigning", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            checks.put("running", runningCheck(context, pkg));
        } catch (Exception e) { checks.put("running", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            Object manager = context.getSystemService("netpolicy");
            if (manager == null) throw new IllegalStateException("Network policy service unavailable");
            Class<?> type = Class.forName("android.net.NetworkPolicyManager");
            int policy = (Integer) type.getMethod("getUidPolicy", int.class).invoke(manager, app.uid);
            JSONArray rows = new JSONArray();
            for (Field f : type.getFields()) if (f.getName().startsWith("POLICY_") && f.getType() == int.class) {
                int mask = f.getInt(null); if (mask != 0 && (policy & mask) == mask) rows.put(badgeItem(f.getName(), String.valueOf(mask)));
            }
            if (policy != 0 && rows.length() == 0) rows.put(badgeItem("Policy bitmask", String.valueOf(policy)));
            checks.put("netPolicy", badgeCheck(policy != 0, "Android network policy for UID " + app.uid + "; shared-UID applications share this policy.", rows));
        } catch (Exception e) { checks.put("netPolicy", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            if (Build.VERSION.SDK_INT < 29) throw new UnsupportedOperationException("URI grant inspection requires Android 10 or newer.");
            Object binder = Class.forName("android.os.ServiceManager").getMethod("getService", String.class).invoke(null, "uri_grants");
            Class<?> api = Class.forName("android.app.IUriGrantsManager");
            Object manager = Class.forName("android.app.IUriGrantsManager$Stub").getMethod("asInterface", android.os.IBinder.class).invoke(null, binder);
            Object slice = api.getMethod("getGrantedUriPermissions", String.class, int.class).invoke(manager, pkg.packageName, app.uid / 100000);
            List<?> grants = (List<?>) slice.getClass().getMethod("getList").invoke(slice);
            JSONArray rows = new JSONArray();
            for (Object grant : grants) {
                Object uri = grant.getClass().getField("uri").get(grant);
                rows.put(badgeItem(String.valueOf(uri), "Persisted URI grant"));
            }
            checks.put("saf", badgeCheck(rows.length() > 0, "Persisted storage URI grants for this package and profile.", rows));
        } catch (Exception e) { checks.put("saf", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        try {
            boolean xposed = app.metaData != null && app.metaData.getBoolean("xposedmodule", false);
            JSONArray rows = new JSONArray();
            if (xposed) for (String key : new String[] { "xposeddescription", "xposedminversion", "xposedscope" }) if (app.metaData.containsKey(key)) rows.put(badgeItem(key, String.valueOf(app.metaData.get(key))));
            // Modern modules declare entry metadata inside their APK, without executing any code.
            java.util.ArrayList<String> apks = new java.util.ArrayList<String>(); apks.add(app.sourceDir);
            if (app.splitSourceDirs != null) java.util.Collections.addAll(apks, app.splitSourceDirs);
            for (String apk : apks) try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(apk)) {
                for (String entry : new String[] { "META-INF/xposed/java_init.list", "META-INF/xposed/native_init.list" }) if (zip.getEntry(entry) != null) { xposed = true; rows.put(badgeItem(entry, "Module entry metadata present")); }
            }
            checks.put("xposed", badgeCheck(xposed, "Module metadata indicates a possible Xposed module; activation is not implied.", rows));
        } catch (Exception e) { checks.put("xposed", badgeCheck(JSONObject.NULL, failureMessage(e), new JSONArray())); }
        return checks;
    }

    // Read class definitions directly from DEX. Never load or execute application code.
    private static int dexInt(byte[] bytes, int offset) throws Exception {
        if (offset < 0 || offset > bytes.length - 4) throw new Exception("DEX offset outside file");
        long n = (bytes[offset] & 255L) | (bytes[offset + 1] & 255L) << 8 | (bytes[offset + 2] & 255L) << 16 | (bytes[offset + 3] & 255L) << 24;
        if (n > Integer.MAX_VALUE) throw new Exception("DEX integer exceeds limit");
        return (int) n;
    }
    private static void dexRange(byte[] bytes, int offset, int count, int width) throws Exception {
        if (offset < 0 || count < 0 || (long) offset + (long) count * width > bytes.length) throw new Exception("Invalid DEX table range");
    }
    private static void dexClasses(byte[] bytes, LinkedHashSet<String> classes) throws Exception {
        if (bytes.length < 112 || bytes[0] != 'd' || bytes[1] != 'e' || bytes[2] != 'x' || bytes[3] != '\n' || bytes[7] != 0) throw new Exception("Unsupported DEX header");
        String version = new String(bytes, 4, 3, java.nio.charset.StandardCharsets.US_ASCII);
        if (!java.util.Arrays.asList("035", "037", "038", "039", "040").contains(version)) throw new Exception("Unsupported DEX version " + version);
        if (dexInt(bytes, 32) != bytes.length || dexInt(bytes, 36) != 112 || dexInt(bytes, 40) != 0x12345678) throw new Exception("Invalid DEX header or byte order");
        int strings = dexInt(bytes, 56), stringOffset = dexInt(bytes, 60), types = dexInt(bytes, 64), typeOffset = dexInt(bytes, 68), count = dexInt(bytes, 96), classOffset = dexInt(bytes, 100);
        dexRange(bytes, stringOffset, strings, 4); dexRange(bytes, typeOffset, types, 4); dexRange(bytes, classOffset, count, 32);
        for (int i = 0; i < count; i++) {
            int type = dexInt(bytes, classOffset + i * 32);
            if (type >= types) throw new Exception("Invalid class type");
            int string = dexInt(bytes, typeOffset + type * 4);
            if (string >= strings) throw new Exception("Invalid type string");
            int offset = dexInt(bytes, stringOffset + string * 4), length = 0, shift = 0, b;
            do { if (offset >= bytes.length || shift > 28) throw new Exception("Invalid string length"); b = bytes[offset++] & 255; length |= (b & 127) << shift; shift += 7; } while ((b & 128) != 0);
            if (length < 2 || length > 1024) throw new Exception("Class name exceeds limit");
            StringBuilder name = new StringBuilder(length);
            for (int ch = 0; ch < length; ch++) {
                if (offset >= bytes.length) throw new Exception("Truncated class name");
                b = bytes[offset++] & 255;
                if (b > 0 && b < 128) name.append((char) b);
                else if ((b & 224) == 192) {
                    if (offset >= bytes.length || (bytes[offset] & 192) != 128) throw new Exception("Invalid MUTF-8");
                    name.append((char) (((b & 31) << 6) | (bytes[offset++] & 63)));
                } else if ((b & 240) == 224) {
                    if (offset + 1 >= bytes.length || (bytes[offset] & 192) != 128 || (bytes[offset + 1] & 192) != 128) throw new Exception("Invalid MUTF-8");
                    name.append((char) (((b & 15) << 12) | ((bytes[offset++] & 63) << 6) | (bytes[offset++] & 63)));
                } else throw new Exception("Invalid MUTF-8 class name");
            }
            if (offset >= bytes.length || bytes[offset] != 0 || name.charAt(0) != 'L' || name.charAt(length - 1) != ';') throw new Exception("Invalid class descriptor");
            if (classes.size() >= 250000) throw new Exception("Class inventory limit reached");
            classes.add(name.substring(1, length - 1).replace('/', '.'));
        }
    }
    private static String nativeHeader(java.io.InputStream input) throws Exception {
        byte[] header = new byte[20]; int offset = 0, n;
        while (offset < header.length && (n = input.read(header, offset, header.length - offset)) != -1) offset += n;
        if (offset < 20 || header[0] != 127 || header[1] != 'E' || header[2] != 'L' || header[3] != 'F' || (header[4] != 1 && header[4] != 2) || (header[5] != 1 && header[5] != 2)) return "Invalid ELF header; filename match only";
        int machine = header[5] == 1 ? (header[18] & 255) | (header[19] & 255) << 8 : (header[19] & 255) | (header[18] & 255) << 8;
        String isa = machine == 3 ? "x86" : machine == 62 ? "x86-64" : machine == 40 ? "ARM" : machine == 183 ? "AArch64" : machine == 243 ? "RISC-V" : "machine " + machine;
        return (header[4] == 1 ? "ELF32" : "ELF64") + " · " + isa + (header[5] == 1 ? " · little endian" : " · big endian");
    }
    private static void scanApks(Context context, String name, int userId) throws Exception {
        PackageManager pm = context.getPackageManager(); PackageInfo pkg = pm.getPackageInfo(name, 0);
        ApplicationInfo app = pkg.applicationInfo;
        if (app == null || app.uid / 100000 != userId) throw new Exception("Package profile mismatch");
        LinkedHashSet<String> paths = new LinkedHashSet<>(), classes = new LinkedHashSet<>();
        paths.add(app.sourceDir); if (app.splitSourceDirs != null) java.util.Collections.addAll(paths, app.splitSourceDirs);
        JSONArray artifacts = new JSONArray(), natives = new JSONArray(); long bytesRead = 0; int entriesRead = 0;
        ApkAddresses addresses = new ApkAddresses();
        for (String apk : paths) {
            JSONArray errors = new JSONArray(); int dexFiles = 0, before = classes.size();
            ApkSize size = new ApkSize(new java.io.File(apk));
            try (java.util.zip.ZipFile zip = new java.util.zip.ZipFile(apk)) {
                java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = zip.entries();
                while (entries.hasMoreElements()) {
                    java.util.zip.ZipEntry entry = entries.nextElement(); String entryName = entry.getName();
                    if (++entriesRead > 200000) throw new Exception("APK entry limit reached");
                    size.add(entry);
                    if (!entry.isDirectory() && ApkAddresses.supported(entryName)) addresses.file(zip, entry, apk);
                    if (!entry.isDirectory() && entryName.endsWith(".so")) {
                        if (natives.length() >= 10000) throw new Exception("Native library limit reached");
                        String elf;
                        try (java.io.InputStream input = zip.getInputStream(entry)) { elf = nativeHeader(input); }
                        catch (Exception e) { elf = "ELF header unavailable: " + e.getMessage(); errors.put(entryName + ": " + elf); }
                        natives.put(new JSONObject().put("apk", apk).put("path", entryName).put("elf", elf));
                    }
                    if (!entryName.matches("classes([2-9]|[1-9][0-9]+)?\\.dex")) continue;
                    dexFiles++;
                    try {
                        if (entry.getSize() < 0 || entry.getSize() > 128L * 1024 * 1024 || bytesRead + entry.getSize() > 512L * 1024 * 1024) throw new Exception("DEX byte limit reached");
                        ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(entry.getSize(), 1024 * 1024));
                        try (java.io.InputStream input = zip.getInputStream(entry)) {
                            byte[] buffer = new byte[32768]; int n;
                            while ((n = input.read(buffer)) != -1) { bytesRead += n; if (out.size() + (long) n > 128L * 1024 * 1024 || bytesRead > 512L * 1024 * 1024) throw new Exception("DEX byte limit reached"); out.write(buffer, 0, n); }
                        }
                        byte[] dex = out.toByteArray();
                        try { addresses.dex(dex, apk, entryName); }
                        catch (Exception e) { addresses.issue(apk + " · " + entryName + ": " + e.getMessage()); }
                        dexClasses(dex, classes);
                    } catch (Exception e) { errors.put(entryName + ": " + e.getMessage()); }
                }
            } catch (Exception e) { errors.put(String.valueOf(e.getMessage())); size.fail(String.valueOf(e.getMessage())); }
            size.finish();
            long[] counts = size.categories();
            JSONObject categories = new JSONObject();
            if (counts != null) for (int i = 0; i < ApkSize.KEYS.length; i++) categories.put(ApkSize.KEYS[i], counts[i]);
            JSONObject sizeJson = new JSONObject().put("bytes", size.bytes < 0 ? JSONObject.NULL : size.bytes).put("categories", counts == null ? JSONObject.NULL : categories);
            if (size.error != null) { sizeJson.put("error", size.error); errors.put("Size composition: " + size.error); }
            artifacts.put(new JSONObject().put("path", apk).put("dexFiles", dexFiles).put("classes", classes.size() - before).put("complete", errors.length() == 0).put("errors", errors).put("size", sizeJson));
        }
        PackageInfo after = pm.getPackageInfo(name, 0);
        if (after.lastUpdateTime != pkg.lastUpdateTime || !after.applicationInfo.sourceDir.equals(app.sourceDir)) throw new Exception("Application changed during scan. Refresh and retry.");
        JSONArray candidates = new JSONArray();
        for (java.util.Map.Entry<String, java.util.List<String[]>> candidate : addresses.candidates.entrySet()) {
            JSONArray sources = new JSONArray();
            for (String[] source : candidate.getValue()) sources.put(new JSONObject().put("apk", source[0]).put("entry", source[1]));
            candidates.put(new JSONObject().put("value", candidate.getKey()).put("sources", sources));
        }
        emit(new JSONObject().put("type", "scan").put("protocolVersion", PROTOCOL).put("packageName", name).put("userId", userId).put("uid", app.uid).put("classes", new JSONArray(classes)).put("artifacts", artifacts).put("native", natives)
            .put("addresses", new JSONObject().put("candidates", candidates).put("files", addresses.files).put("issues", new JSONArray(addresses.issues))));
    }

    public static void main(String[] args) {
        // Reserve stdout for the versioned protocol, redirect Java/framework diagnostics.
        System.setOut(System.err);
        Thread watchdog = new Thread(new Runnable() { public void run() {
            try { Thread.sleep(120000); } catch (InterruptedException ignored) { return; }
            System.err.println("Apps helper exceeded its 120 second deadline.");
            System.exit(3);
        } }, "apps-deadline");
        watchdog.setDaemon(true); watchdog.start();
        try {
            if (args.length < 1 || !args[args.length - 1].matches("[0-9]{1,5}")) throw new IllegalArgumentException("Expected Android user ID");
            boolean icons = true, storage = false, permissions = false;
            String detailPackage = null, scanPackage = null, rootPackage = null, singlePackage = null, permissionPackage = null;
            int expectedUid = -1;
            for (int i = 0; i < args.length - 1; i++) {
                if (args[i].equals("--no-icons")) icons = false;
                else if (args[i].equals("--package") && i + 1 < args.length - 1 && args[i + 1].matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*")) singlePackage = args[++i];
                else if (args[i].equals("--root-details") && i + 2 < args.length - 1 && args[i + 1].matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*") && args[i + 2].matches("[0-9]{1,10}")) { rootPackage = args[++i]; expectedUid = Integer.parseInt(args[++i]); }
                else if (args[i].equals("--storage")) storage = true;
                else if (args[i].equals("--permissions")) permissions = true;
                else if (args[i].equals("--permission-state") && i + 1 < args.length - 1 && args[i + 1].matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*")) permissionPackage = args[++i];
                else if (args[i].equals("--details") && i + 1 < args.length - 1 && args[i + 1].matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*")) detailPackage = args[++i];
                else if (args[i].equals("--scan") && i + 1 < args.length - 1 && args[i + 1].matches("[A-Za-z0-9_]+(\\.[A-Za-z0-9_]+)*")) scanPackage = args[++i];
                else throw new IllegalArgumentException("Unknown collection option");
            }
            int userId = Integer.parseInt(args[args.length - 1]);
            long started = android.os.SystemClock.elapsedRealtime();
            Context context = context(userId);
            if (permissionPackage != null) { permissionState(context, permissionPackage, userId); System.exit(0); return; }
            if (rootPackage != null) { rootDetails(context, rootPackage, userId, expectedUid); System.exit(0); return; }
            if (scanPackage != null) { scanApks(context, scanPackage, userId); System.exit(0); return; }
            if (detailPackage != null) { details(context, detailPackage, userId, storage, permissions); System.exit(0); return; }
            PackageManager pm = context.getPackageManager();
            StorageStatsManager stats = storage ? context.getSystemService(StorageStatsManager.class) : null;
            Constructor<UserHandle> userConstructor = UserHandle.class.getDeclaredConstructor(int.class);
            userConstructor.setAccessible(true);
            UserHandle statsUser = userConstructor.newInstance(userId);
            String storageDenied = null;
            int flags = PackageManager.MATCH_DISABLED_COMPONENTS | PackageManager.MATCH_DIRECT_BOOT_AWARE | PackageManager.MATCH_DIRECT_BOOT_UNAWARE | PackageManager.MATCH_UNINSTALLED_PACKAGES;
            List<PackageInfo> packages;
            if (singlePackage == null) packages = pm.getInstalledPackages(flags);
            else {
                packages = new java.util.ArrayList<PackageInfo>();
                try { packages.add(pm.getPackageInfo(singlePackage, flags)); }
                catch (PackageManager.NameNotFoundException removed) { /* Removed from this profile. */ }
            }
            emit(new JSONObject().put("type", "header").put("protocolVersion", PROTOCOL).put("helperVersion", VERSION)
                    .put("userId", userId).put("sdk", Build.VERSION.SDK_INT).put("locale", Locale.getDefault().toLanguageTag())
                    .put("iconSize", ICON_SIZE).put("total", packages.size()));
            int count = 0, warnings = 0;
            JSONObject actionContext = PackageActions.context();
            for (PackageInfo pkg : packages) {
                ApplicationInfo app = pkg.applicationInfo;
                if (app == null) throw new IllegalStateException("Missing ApplicationInfo for " + pkg.packageName);
                JSONObject entry = new JSONObject().put("actionContext", actionContext).put("type", "app").put("packageName", pkg.packageName)
                        .put("versionName", pkg.versionName == null ? JSONObject.NULL : pkg.versionName)
                        .put("versionCode", Build.VERSION.SDK_INT >= 28 ? pkg.getLongVersionCode() : (long) pkg.versionCode)
                        .put("uid", app.uid).put("userId", userId).put("enabled", app.enabled)
                        .put("system", (app.flags & ApplicationInfo.FLAG_SYSTEM) != 0)
                        .put("updatedSystemApp", (app.flags & ApplicationInfo.FLAG_UPDATED_SYSTEM_APP) != 0)
                        .put("sourceDir", app.sourceDir == null ? JSONObject.NULL : app.sourceDir)
                        .put("firstInstallTime", pkg.firstInstallTime).put("lastUpdateTime", pkg.lastUpdateTime)
                        .put("targetSdk", app.targetSdkVersion).put("minSdk", app.minSdkVersion)
                        .put("debuggable", (app.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                        .put("suspended", (app.flags & ApplicationInfo.FLAG_SUSPENDED) != 0)
                        .put("stopped", (app.flags & ApplicationInfo.FLAG_STOPPED) != 0);
                entry.put("splitCount", app.splitSourceDirs == null ? 0 : app.splitSourceDirs.length);
                try {
                    if (app.sourceDir == null) throw new IllegalStateException("Base APK location unavailable");
                    LinkedHashSet<String> paths = new LinkedHashSet<String>();
                    paths.add(app.sourceDir);
                    if (app.splitSourceDirs != null) for (String split : app.splitSourceDirs) paths.add(split);
                    long bytes = 0;
                    for (String apk : paths) {
                        StructStat stat = Os.stat(apk);
                        if (!OsConstants.S_ISREG(stat.st_mode) || stat.st_size <= 0) throw new IllegalStateException("APK size unavailable");
                        bytes = Math.addExact(bytes, stat.st_size);
                    }
                    entry.put("apkSizeBytes", bytes);
                } catch (Exception failure) { entry.put("apkSizeBytes", JSONObject.NULL).put("sizeError", error(failure)); }
                try { entry.put("label", String.valueOf(pm.getApplicationLabel(app))); }
                catch (Throwable failure) { entry.put("label", pkg.packageName).put("labelError", error(failure)); warnings++; }
                if (icons) try {
                    applicationIcon(pm, app, entry);
                } catch (Throwable failure) { if (warnings < 3) failure.printStackTrace(System.err); entry.put("iconPng", JSONObject.NULL).put("iconError", error(failure)); warnings++; }
                else entry.put("iconPng", JSONObject.NULL).put("iconSkipped", true);
                boolean installed = (app.flags & ApplicationInfo.FLAG_INSTALLED) != 0;
                entry.put("installed", installed);
                entry.put("storageRequested", storage && installed);
                if (storage && installed) {
                    entry.put("dataBytes", JSONObject.NULL).put("cacheBytes", JSONObject.NULL);
                    if (storageDenied != null) entry.put("storageError", storageDenied);
                    else try {
                        if (stats == null) throw new IllegalStateException("Storage statistics service unavailable");
                        StorageStats sizes = stats.queryStatsForPackage(app.storageUuid, pkg.packageName, statsUser);
                        entry.put("dataBytes", sizes.getDataBytes()).put("cacheBytes", sizes.getCacheBytes());
                    } catch (Exception failure) {
                        String reason = error(failure); entry.put("storageError", reason);
                        if (failure instanceof SecurityException) storageDenied = reason;
                    }
                }
                try { entry.put("enabledState", pm.getApplicationEnabledSetting(pkg.packageName)); }
                catch (RuntimeException ignored) { entry.put("enabledState", JSONObject.NULL); }
                try { String installer = pm.getInstallerPackageName(pkg.packageName); entry.put("installer", installer == null ? JSONObject.NULL : installer); }
                catch (RuntimeException ignored) { entry.put("installer", JSONObject.NULL); }
                emit(entry); count++;
            }
            emit(new JSONObject().put("type", "complete").put("count", count).put("warnings", warnings)
                    .put("elapsedMs", android.os.SystemClock.elapsedRealtime() - started));
            System.exit(0);
        } catch (Throwable failure) {
            try { emit(new JSONObject().put("type", "error").put("message", error(failure))); } catch (Exception ignored) { }
            failure.printStackTrace(System.err);
            System.exit(1);
        }
    }
}
