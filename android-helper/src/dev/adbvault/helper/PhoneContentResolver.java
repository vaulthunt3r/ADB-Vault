package dev.adbvault.helper;

import android.content.ContentResolver;
import android.content.Context;
import android.content.IContentProvider;
import android.os.Binder;
import android.os.IBinder;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/** Provider references acquired as an external shell client, not an AMS-registered application. */
final class PhoneContentResolver extends ContentResolver {
    private final Object activityManager;
    private final Method acquire, release;
    private final int userId;
    private final Map<IContentProvider, List<Lease>> leases = new IdentityHashMap<>();

    private static final class Lease {
        final String authority;
        final IBinder token = new Binder();
        Lease(String authority) { this.authority = authority; }
    }

    PhoneContentResolver(Context context, int userId) throws Exception {
        super(context);
        this.userId = userId;
        // Same external-provider lifecycle used by Android's "content" shell command:
        // https://github.com/aosp-mirror/platform_frameworks_base/blob/master/cmds/content/src/com/android/commands/content/Content.java
        activityManager = Class.forName("android.app.ActivityManager").getMethod("getService").invoke(null);
        Class<?> api = Class.forName("android.app.IActivityManager");
        Method get, remove;
        try { get = api.getMethod("getContentProviderExternal", String.class, int.class, IBinder.class, String.class); }
        catch (NoSuchMethodException older) { get = api.getMethod("getContentProviderExternal", String.class, int.class, IBinder.class); }
        try { remove = api.getMethod("removeContentProviderExternalAsUser", String.class, IBinder.class, int.class); }
        catch (NoSuchMethodException older) {
            // Older removal APIs implicitly select the shell's user (0). Do not misroute cleanup.
            if (userId != 0) throw new IllegalStateException("This Android version cannot export another user's phone data through ADB.");
            remove = api.getMethod("removeContentProviderExternal", String.class, IBinder.class);
        }
        acquire = get; release = remove;
    }

    private static RuntimeException failure(Exception error) {
        Throwable cause = error instanceof InvocationTargetException ? error.getCause() : error;
        if (cause instanceof RuntimeException) return (RuntimeException) cause;
        return new IllegalStateException("Cannot access the Android phone data provider.", cause);
    }

    private synchronized IContentProvider acquire(String authority) {
        if (!authority.equals("com.android.contacts") && !authority.equals("call_log") && !authority.equals("sms"))
            throw new IllegalArgumentException("Unsupported phone data provider.");
        Lease lease = new Lease(authority);
        Object holder = null;
        try {
            holder = acquire.getParameterTypes().length == 4
                ? acquire.invoke(activityManager, authority, userId, lease.token, "ADB Vault")
                : acquire.invoke(activityManager, authority, userId, lease.token);
            if (holder == null) return null;
            IContentProvider provider = (IContentProvider) holder.getClass().getField("provider").get(holder);
            if (provider == null) {
                holder = null;
                remove(lease);
                return null;
            }
            List<Lease> refs = leases.get(provider);
            if (refs == null) { refs = new ArrayList<>(); leases.put(provider, refs); }
            refs.add(lease);
            return provider;
        } catch (Exception error) {
            if (holder != null) {
                try { remove(lease); } catch (RuntimeException cleanup) { error.addSuppressed(cleanup); }
            }
            throw failure(error);
        }
    }

    private void remove(Lease lease) {
        try {
            if (release.getParameterTypes().length == 3) release.invoke(activityManager, lease.authority, lease.token, userId);
            else release.invoke(activityManager, lease.authority, lease.token);
        } catch (Exception error) { throw failure(error); }
    }

    private synchronized boolean release(IContentProvider provider) {
        List<Lease> refs = leases.get(provider);
        if (refs == null || refs.isEmpty()) return false;
        Lease lease = refs.get(refs.size() - 1);
        remove(lease);
        refs.remove(refs.size() - 1);
        if (refs.isEmpty()) leases.remove(provider);
        return true;
    }

    synchronized int activeProviderCount() {
        int count = 0;
        for (List<Lease> refs : leases.values()) count += refs.size();
        return count;
    }

    // These are framework overrides omitted from public SDK stubs.
    protected IContentProvider acquireProvider(Context context, String authority) { return acquire(authority); }
    protected IContentProvider acquireUnstableProvider(Context context, String authority) { return acquire(authority); }
    public boolean releaseProvider(IContentProvider provider) { return release(provider); }
    public boolean releaseUnstableProvider(IContentProvider provider) { return release(provider); }
    public void unstableProviderDied(IContentProvider provider) { /* ContentResolver releases the reference in its finally block. */ }
}
