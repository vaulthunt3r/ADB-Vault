import dev.adbvault.helper.ApkSize;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Synthetic APK containers only; checks compressed sizes and complete/partial accounting. */
public final class ApkSizeTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void entry(ZipOutputStream zip, String name, int count, boolean stored) throws Exception {
        byte[] data = new byte[count]; Arrays.fill(data, (byte) 7);
        ZipEntry entry = new ZipEntry(name);
        if (stored) { CRC32 crc = new CRC32(); crc.update(data); entry.setMethod(ZipEntry.STORED); entry.setSize(count); entry.setCompressedSize(count); entry.setCrc(crc.getValue()); }
        zip.putNextEntry(entry); zip.write(data); zip.closeEntry();
    }
    private static ApkSize scan(File file) throws Exception {
        ApkSize size = new ApkSize(file);
        try (ZipFile zip = new ZipFile(file)) { Enumeration<? extends ZipEntry> entries = zip.entries(); while (entries.hasMoreElements()) size.add(entries.nextElement()); }
        size.finish(); return size;
    }
    public static void main(String[] args) throws Exception {
        Path file = Files.createTempFile(Paths.get("android-helper/build/tests"), "size-", ".apk");
        Path empty = Files.createTempFile(Paths.get("android-helper/build/tests"), "size-empty-", ".apk");
        try {
            try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(file))) {
                entry(zip, "classes.dex", 100000, false);
                entry(zip, "assets/extra.dex", 100, true);
                entry(zip, "lib/arm64-v8a/libengine.so", 1000, true);
                entry(zip, "assets/libextra.so", 200, true);
                entry(zip, "res/raw/picture.bin", 300, true);
                entry(zip, "resources.arsc", 400, true);
                entry(zip, "assets/models.bin", 500, true);
                entry(zip, "AndroidManifest.xml", 150, true);
                entry(zip, "assets/", 0, false);
            }
            ApkSize size = scan(file.toFile()); long[] c = size.categories();
            check(size.error == null && c != null, "Complete APK must have categories");
            check(c[0] > 100 && c[0] < 1000, "DEX must use compressed bytes, including asset DEX");
            check(c[1] == 1200, "Native libraries in lib and assets counted once");
            check(c[2] == 700 && c[3] == 500, "Resources and remaining assets");
            check(c[4] > 150, "Other must include manifest and ZIP overhead");
            check(Arrays.stream(c).sum() == Files.size(file), "Categories must equal exact physical APK size");
            size.finish(); check(Arrays.equals(c, size.categories()), "Finishing twice must not double-count overhead");
            check(ApkSize.category(new ZipEntry("res/raw/libexample.so")) == 1, "Known file type takes priority over folder");
            ApkSize partial = new ApkSize(file.toFile()); partial.fail("APK entry limit reached"); partial.finish();
            check(partial.categories() == null && partial.bytes == Files.size(file), "Interrupted inventory must not label unread contents as Other");
            ApkSize unknown = new ApkSize(file.toFile()); unknown.add(new ZipEntry("classes.dex")); unknown.finish();
            check(unknown.categories() == null && unknown.error != null, "Unknown entry size must not become zero");
            ApkSize invalid = new ApkSize(file.toFile()); ZipEntry forged = new ZipEntry("assets/big"); forged.setCompressedSize(Files.size(file) + 1); invalid.add(forged); invalid.finish();
            check(invalid.categories() == null, "Oversized/overlapping payload sum must be rejected");
            try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(empty))) { }
            ApkSize onlyContainer = scan(empty.toFile());
            check(onlyContainer.categories()[4] == Files.size(empty), "Empty ZIP consists entirely of container bytes");
            ApkSize changed = new ApkSize(file.toFile()); Files.write(file, new byte[] { 0 }, StandardOpenOption.APPEND); changed.finish();
            check(changed.bytes == -1 && changed.categories() == null, "Changed file must not report stale totals");
            ApkSize missing = new ApkSize(new File(file.toString() + ".missing")); missing.finish();
            check(missing.bytes == -1 && missing.categories() == null && missing.error != null, "Missing file is unavailable, not empty");
            System.out.println("PASS: APK compressed-size categories, asset type precedence, container overhead, partial/unknown/invalid sizes and changed/missing files.");
        } finally { Files.deleteIfExists(file); Files.deleteIfExists(empty); }
    }
}
