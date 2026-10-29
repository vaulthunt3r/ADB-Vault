package dev.adbvault.helper;

import java.io.File;
import java.util.Locale;
import java.util.zip.ZipEntry;

/** Counts stored ZIP payload sizes during the existing entry walk; never inflates files. */
public final class ApkSize {
    public static final String[] KEYS = { "code", "native", "resources", "assets", "other" };
    private static final long MAX_SAFE = 9007199254740991L;
    private final File file;
    private final long modified;
    private final long[] counts = new long[KEYS.length];
    private long payload = 0;
    private boolean finished = false;
    public long bytes;
    public String error;

    public ApkSize(File file) {
        this.file = file;
        modified = file.lastModified();
        bytes = file.isFile() ? file.length() : -1;
        if (bytes < 0 || bytes > MAX_SAFE) { bytes = -1; fail("APK file size is unavailable."); }
    }
    public void fail(String reason) { if (error == null) error = reason == null ? "APK size collection failed." : reason.substring(0, Math.min(reason.length(), 1000)); }
    public static int category(ZipEntry entry) {
        String name = entry.getName().toLowerCase(Locale.ROOT);
        if (entry.isDirectory()) return 4;
        if (name.endsWith(".dex")) return 0;
        if (name.endsWith(".so")) return 1;
        if (name.equals("resources.arsc") || name.startsWith("res/")) return 2;
        if (name.startsWith("assets/")) return 3;
        return 4;
    }
    public void add(ZipEntry entry) {
        if (finished) { fail("APK entries changed after size collection."); return; }
        if (error != null) return;
        long stored = entry.getCompressedSize();
        if (stored < 0 || stored > bytes - payload) { fail("ZIP entry sizes are unavailable or exceed the APK file size."); return; }
        counts[category(entry)] += stored;
        payload += stored;
    }
    public void finish() {
        if (finished) return;
        finished = true;
        if (!file.isFile() || file.length() != bytes || file.lastModified() != modified) {
            bytes = -1;
            fail("APK file changed during size collection. Scan again.");
        }
        if (error == null) counts[4] += bytes - payload; // Headers, index, signing block, alignment and other container bytes.
    }
    public long[] categories() { return finished && error == null ? counts.clone() : null; }
}
