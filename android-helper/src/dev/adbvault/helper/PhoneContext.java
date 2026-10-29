package dev.adbvault.helper;

import android.content.Context;
import android.os.UserHandle;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

/** A fresh shell application context for phone providers and services. */
final class PhoneContext {
    static Context create(int userId) throws Exception {
        return from(Main.context(userId), userId);
    }

    static Context from(Context shell, int userId) throws Exception {
        // createPackageContext() inherits the system container's "android" op package.
        // Its resolver caches that identity before our ActivityThread binding is installed.
        // Build a normal app context from the shell LoadedApk instead: the framework then
        // initializes both the resolver's legacy package and modern AttributionSource itself.
        // https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/app/ContextImpl.java
        Class<?> contextImpl = Class.forName("android.app.ContextImpl");
        Class<?> activityThread = Class.forName("android.app.ActivityThread");
        Class<?> loadedApk = Class.forName("android.app.LoadedApk");
        Field packageInfo = contextImpl.getDeclaredField("mPackageInfo");
        packageInfo.setAccessible(true);
        Object thread = activityThread.getMethod("currentActivityThread").invoke(null);
        Method create = contextImpl.getDeclaredMethod("createAppContext", activityThread, loadedApk);
        create.setAccessible(true);
        Context application = (Context) create.invoke(null, thread, packageInfo.get(shell));

        // app_process runs as user 0; retain the explicitly selected foreground Android user.
        Constructor<UserHandle> constructor = UserHandle.class.getDeclaredConstructor(int.class);
        constructor.setAccessible(true);
        Context context = (Context) Context.class.getMethod("createContextAsUser", UserHandle.class, int.class)
                .invoke(application, constructor.newInstance(userId), 0);
        if (!"com.android.shell".equals(context.getPackageName())
                || !"com.android.shell".equals(context.getOpPackageName())
                || ((Integer) Context.class.getMethod("getUserId").invoke(context)) != userId)
            throw new IllegalStateException("Cannot initialize phone access for the selected Android user.");
        return context;
    }
}
