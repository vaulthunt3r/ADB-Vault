package dev.adbvault.helper;

import android.content.ClipboardManager;
import android.content.Context;
import android.content.ContextWrapper;
import android.os.Build;
import android.os.Process;
import java.lang.reflect.Field;

/** Attributes clipboard calls to the authenticated shell process, including cached framework services. */
final class PhoneClipboard {
    private static final String PACKAGE = "com.android.shell";

    static ClipboardManager manager(Context base) {
        Context context = Build.VERSION.SDK_INT >= 31 ? new ModernShellContext(base) : new ShellContext(base);
        ClipboardManager manager = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager == null) throw new IllegalStateException("Android clipboard service is unavailable.");
        return manager;
    }

    private static class ShellContext extends ContextWrapper {
        ShellContext(Context base) { super(base); }
        @Override public String getPackageName() { return PACKAGE; }
        @Override public String getOpPackageName() { return PACKAGE; }
        @Override public Context getApplicationContext() { return this; }
        @Override public String getAttributionTag() { return null; }

        @Override public Object getSystemService(String name) {
            Object service = super.getSystemService(name);
            if (service == null || !(CLIPBOARD_SERVICE.equals(name) || "semclipboard".equals(name))) return service;
            // ClipboardManager retains its own context; merely wrapping the caller is insufficient.
            // AOSP calls getOpPackageName() on this context for both getPrimaryClip/setPrimaryClip.
            // https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/content/ClipboardManager.java
            for (Class<?> type = service.getClass(); type != null; type = type.getSuperclass()) {
                try {
                    Field field = type.getDeclaredField("mContext");
                    field.setAccessible(true); field.set(service, this);
                    return service;
                } catch (NoSuchFieldException ignored) {
                    // Some vendor services subclass the framework manager.
                } catch (IllegalAccessException failure) {
                    throw new IllegalStateException("Cannot initialize the Android clipboard for ADB shell.", failure);
                }
            }
            throw new IllegalStateException("This Android clipboard service does not expose a supported context.");
        }
    }

    // Keep the API 31 type out of the class loaded by older Android versions.
    @android.annotation.TargetApi(31)
    private static final class ModernShellContext extends ShellContext {
        ModernShellContext(Context base) { super(base); }
        @Override public android.content.AttributionSource getAttributionSource() {
            return new android.content.AttributionSource.Builder(Process.myUid()).setPackageName(PACKAGE).build();
        }
    }
}
