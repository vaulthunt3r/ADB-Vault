package dev.adbvault.helper;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Bounded, read-only string collection. No DNS, HTTP, class loading or code execution. */
public final class ApkAddresses {
    private static final Pattern URL = Pattern.compile("(?i)(?<![a-z0-9+.-])https?://[^\\s<>\"'`\\\\\\x00-\\x1f]+", Pattern.UNICODE_CASE);
    private static final Pattern HOST = Pattern.compile("(?:\\*\\.)?(?:[\\p{L}\\p{N}][\\p{L}\\p{N}-]{0,62}\\.)+[\\p{L}][\\p{L}\\p{N}-]{1,62}\\.?");
    private static final Pattern QUOTED_HOST = Pattern.compile("[\"'>]([^\"'<>\\s]{3,254})[\"'<]");
    private static final Pattern NAMESPACE = Pattern.compile("(?i)^(?:(?:com|org|net|io|dev)\\.[^.]+\\.|(?:android|java|javax|kotlin|kotlinx)\\.).*");
    private static boolean bareHost(String value) { return value.length() <= 254 && HOST.matcher(value).matches() && !NAMESPACE.matcher(value).matches() && !value.toLowerCase(Locale.ROOT).matches(".*\\.(apk|apks|arsc|dex|so|java|class|xml|json|txt|js|css|html|zip|rar|tar|png|jpg|gif|svg|map|properties|md)"); }
    private static final int MAX_CANDIDATES = 2000, MAX_SOURCES = 8, MAX_STRING = 65536;
    public final LinkedHashMap<String, List<String[]>> candidates = new LinkedHashMap<>();
    public final LinkedHashSet<String> issues = new LinkedHashSet<>();
    public int files = 0;
    private long resourceBytes = 0, characters = 0;

    public void issue(String message) { if (issues.size() < 30) issues.add(message.length() > 1000 ? message.substring(0, 1000) : message); }
    private void add(String value, String apk, String entry) {
        if (value.length() > 2048) { issue("Addresses longer than 2048 characters were skipped."); return; }
        List<String[]> sources = candidates.get(value);
        if (sources == null) {
            if (candidates.size() >= MAX_CANDIDATES) { issue("Address candidate limit reached; some addresses were omitted."); return; }
            sources = new ArrayList<>(); candidates.put(value, sources);
        }
        for (String[] source : sources) if (source[0].equals(apk) && source[1].equals(entry)) return;
        if (sources.size() >= MAX_SOURCES) { issue("Some addresses have more than 8 source files; only the first 8 are shown."); return; }
        sources.add(new String[] { apk, entry });
    }
    private void scan(String text, String apk, String entry) throws Exception {
        characters += text.length();
        if (characters > 64L * 1024 * 1024) throw new Exception("Address string limit reached.");
        // JSON often escapes slashes. Keep matching local strings; never decode or visit addresses.
        String value = text.replace("\\/", "/");
        Matcher urls = URL.matcher(value);
        while (urls.find()) add(urls.group(), apk, entry);
        String host = value.trim();
        if (bareHost(host)) add(host, apk, entry);
        Matcher quoted = QUOTED_HOST.matcher(value);
        while (quoted.find()) if (bareHost(quoted.group(1))) add(quoted.group(1), apk, entry);
    }
    private static int u16(byte[] bytes, int offset, int end) throws Exception {
        range(offset, 2, end); return (bytes[offset] & 255) | (bytes[offset + 1] & 255) << 8;
    }
    private static int u32(byte[] bytes, int offset, int end) throws Exception {
        range(offset, 4, end);
        long n = (bytes[offset] & 255L) | (bytes[offset + 1] & 255L) << 8 | (bytes[offset + 2] & 255L) << 16 | (bytes[offset + 3] & 255L) << 24;
        if (n > Integer.MAX_VALUE) throw new Exception("String table integer exceeds limit.");
        return (int) n;
    }
    private static void range(int offset, long length, int end) throws Exception {
        if (offset < 0 || length < 0 || offset + length > end) throw new Exception("Invalid string table range.");
    }
    public void dex(byte[] bytes, String apk, String entry) throws Exception {
        files++;
        if (bytes.length < 112 || bytes[0] != 'd' || bytes[1] != 'e' || bytes[2] != 'x' || bytes[3] != '\n' || bytes[7] != 0) throw new Exception("Unsupported DEX string header.");
        String version = new String(bytes, 4, 3, StandardCharsets.US_ASCII);
        if (!java.util.Arrays.asList("035", "037", "038", "039", "040").contains(version) || u32(bytes, 32, bytes.length) != bytes.length || u32(bytes, 36, bytes.length) != 112 || u32(bytes, 40, bytes.length) != 0x12345678) throw new Exception("Unsupported DEX string layout.");
        int count = u32(bytes, 56, bytes.length), table = u32(bytes, 60, bytes.length);
        range(table, (long) count * 4, bytes.length);
        if (count > 1000000) throw new Exception("DEX string count limit reached.");
        for (int i = 0; i < count; i++) {
            int offset = u32(bytes, table + i * 4, bytes.length), shift = 0, b; long length = 0;
            do { range(offset, 1, bytes.length); b = bytes[offset++] & 255; if (shift == 28 && (b & 240) != 0) throw new Exception("Invalid DEX string length."); length |= (long) (b & 127) << shift; shift += 7; } while ((b & 128) != 0 && shift <= 28);
            if ((b & 128) != 0) throw new Exception("Invalid DEX string length.");
            if (length > MAX_STRING) { issue("DEX strings longer than 65536 characters were skipped."); continue; }
            StringBuilder value = new StringBuilder((int) length);
            for (int n = 0; n < length; n++) {
                range(offset, 1, bytes.length); b = bytes[offset++] & 255;
                if (b > 0 && b < 128) value.append((char) b);
                else if ((b & 224) == 192) {
                    range(offset, 1, bytes.length); if ((bytes[offset] & 192) != 128) throw new Exception("Invalid DEX MUTF-8.");
                    int ch = ((b & 31) << 6) | (bytes[offset++] & 63);
                    if (ch != 0 && ch < 128) throw new Exception("Invalid DEX MUTF-8."); value.append((char) ch);
                } else if ((b & 240) == 224) {
                    range(offset, 2, bytes.length); if ((bytes[offset] & 192) != 128 || (bytes[offset + 1] & 192) != 128) throw new Exception("Invalid DEX MUTF-8.");
                    int ch = ((b & 15) << 12) | ((bytes[offset++] & 63) << 6) | (bytes[offset++] & 63);
                    if (ch < 2048) throw new Exception("Invalid DEX MUTF-8."); value.append((char) ch);
                } else throw new Exception("Invalid DEX MUTF-8.");
            }
            range(offset, 1, bytes.length); if (bytes[offset] != 0) throw new Exception("Unterminated DEX string.");
            scan(value.toString(), apk, entry);
        }
    }
    private static int length(byte[] bytes, int[] cursor, int end, boolean utf8) throws Exception {
        int first = utf8 ? (rangeByte(bytes, cursor, end)) : u16(bytes, cursor[0], end);
        if (!utf8) cursor[0] += 2;
        int flag = utf8 ? 128 : 32768;
        if ((first & flag) == 0) return first;
        int second = utf8 ? rangeByte(bytes, cursor, end) : u16(bytes, cursor[0], end);
        if (!utf8) cursor[0] += 2;
        long result = ((long) (first & (flag - 1)) << (utf8 ? 8 : 16)) | second;
        if (result > Integer.MAX_VALUE) throw new Exception("Resource string length exceeds limit.");
        return (int) result;
    }
    private static int rangeByte(byte[] bytes, int[] cursor, int end) throws Exception { range(cursor[0], 1, end); return bytes[cursor[0]++] & 255; }
    private void pool(byte[] bytes, int start, int header, int end, String apk, String entry) throws Exception {
        if (header < 28) throw new Exception("Invalid resource string pool.");
        int count = u32(bytes, start + 8, end), styles = u32(bytes, start + 12, end), flags = u32(bytes, start + 16, end);
        int data = u32(bytes, start + 20, end), styleStart = u32(bytes, start + 24, end);
        range(start + header, ((long) count + styles) * 4, end);
        if (count == 0) return;
        if (count > 250000 || data < header + ((long) count + styles) * 4 || data >= end - start) throw new Exception("Invalid resource string data.");
        int dataEnd = styleStart == 0 ? end : start + styleStart;
        if (dataEnd < start + data || dataEnd > end) throw new Exception("Invalid resource styles offset.");
        boolean utf8 = (flags & 256) != 0;
        for (int i = 0; i < count; i++) {
            int relative = u32(bytes, start + header + i * 4, end);
            if (relative >= dataEnd - start - data) throw new Exception("Invalid resource string offset.");
            int[] cursor = { start + data + relative };
            int chars = length(bytes, cursor, dataEnd, utf8), size = utf8 ? length(bytes, cursor, dataEnd, true) : chars;
            if (chars > MAX_STRING) { issue("Resource strings longer than 65536 characters were skipped."); continue; }
            long byteSize = utf8 ? size : (long) size * 2;
            range(cursor[0], byteSize + (utf8 ? 1 : 2), dataEnd);
            if (bytes[cursor[0] + (int) byteSize] != 0 || (!utf8 && bytes[cursor[0] + (int) byteSize + 1] != 0)) throw new Exception("Unterminated resource string.");
            String value = (utf8 ? StandardCharsets.UTF_8 : StandardCharsets.UTF_16LE).newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, cursor[0], (int) byteSize)).toString();
            if (value.length() != chars) throw new Exception("Invalid resource string length.");
            scan(value, apk, entry);
        }
    }
    private void chunks(byte[] bytes, int start, int end, int depth, String apk, String entry) throws Exception {
        if (depth > 4) throw new Exception("Resource nesting limit reached.");
        while (start < end) {
            int type = u16(bytes, start, end), header = u16(bytes, start + 2, end), size = u32(bytes, start + 4, end);
            if (header < 8 || size < header) throw new Exception("Invalid resource chunk.");
            range(start, size, end);
            if (type == 1) pool(bytes, start, header, start + size, apk, entry);
            else if (type == 2 || type == 3 || type == 512) chunks(bytes, start + header, start + size, depth + 1, apk, entry);
            start += size;
        }
    }
    public void resources(byte[] bytes, String apk, String entry) throws Exception {
        files++;
        int type = u16(bytes, 0, bytes.length);
        if ((type != 2 && type != 3) || u32(bytes, 4, bytes.length) != bytes.length) throw new Exception("Invalid compiled resource header.");
        chunks(bytes, 0, bytes.length, 0, apk, entry);
    }
    public void text(byte[] bytes, String apk, String entry) throws Exception {
        files++;
        java.nio.charset.Charset charset = StandardCharsets.UTF_8; int start = 0;
        if (bytes.length >= 2 && bytes[0] == (byte) 255 && bytes[1] == (byte) 254) { charset = StandardCharsets.UTF_16LE; start = 2; }
        else if (bytes.length >= 2 && bytes[0] == (byte) 254 && bytes[1] == (byte) 255) { charset = StandardCharsets.UTF_16BE; start = 2; }
        scan(charset.newDecoder().onMalformedInput(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes, start, bytes.length - start)).toString(), apk, entry);
    }
    public static boolean supported(String name) {
        return name.equals("resources.arsc") || name.equals("AndroidManifest.xml") || ((name.startsWith("res/") || name.startsWith("assets/")) && name.toLowerCase(Locale.ROOT).matches(".*\\.(xml|json|txt|html?|js|css|properties|csv|ya?ml|ini|conf|config)"));
    }
    public void file(ZipFile zip, ZipEntry entry, String apk) {
        try {
            if (entry.getSize() < 0 || entry.getSize() > 8L * 1024 * 1024 || resourceBytes + entry.getSize() > 32L * 1024 * 1024) throw new Exception("Resource scan byte limit reached (8 MiB per file, 32 MiB total).");
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.min(entry.getSize(), 32768));
            try (InputStream input = zip.getInputStream(entry)) {
                byte[] buffer = new byte[32768]; int n;
                while ((n = input.read(buffer)) != -1) {
                    resourceBytes += n;
                    if (out.size() + (long) n > 8L * 1024 * 1024 || resourceBytes > 32L * 1024 * 1024) throw new Exception("Resource scan byte limit reached.");
                    out.write(buffer, 0, n);
                }
            }
            byte[] bytes = out.toByteArray();
            if (entry.getName().equals("resources.arsc") || (bytes.length >= 8 && bytes[0] == 3 && bytes[1] == 0)) resources(bytes, apk, entry.getName());
            else text(bytes, apk, entry.getName());
        } catch (Exception error) { issue(apk + " · " + entry.getName() + ": " + error.getMessage()); }
    }
}
