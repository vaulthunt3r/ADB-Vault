import java.io.*;
import java.lang.reflect.*;
import java.nio.*;
import java.util.*;

/** Synthetic DEX tests run on the host; no installed APK code is executed. */
public final class DexReaderTest {
    private static Method reader;
    private static byte[] dex(String... names) throws Exception {
        int n = names.length, data = 112 + n * 40;
        ByteArrayOutputStream strings = new ByteArrayOutputStream(); int[] offsets = new int[n];
        for (int i = 0; i < n; i++) {
            offsets[i] = data + strings.size(); String descriptor = "L" + names[i].replace('.', '/') + ";";
            int len = descriptor.length(); do { int b = len & 127; len >>>= 7; strings.write(b | (len > 0 ? 128 : 0)); } while (len > 0);
            ByteArrayOutputStream encoded = new ByteArrayOutputStream(); new DataOutputStream(encoded).writeUTF(descriptor);
            strings.write(encoded.toByteArray(), 2, encoded.size() - 2); strings.write(0);
        }
        ByteBuffer b = ByteBuffer.allocate(data + strings.size()).order(ByteOrder.LITTLE_ENDIAN);
        b.put(new byte[] {'d','e','x','\n','0','3','9',0}); b.putInt(32, b.capacity()); b.putInt(36,112); b.putInt(40,0x12345678);
        b.putInt(56,n); b.putInt(60,112); b.putInt(64,n); b.putInt(68,112+n*4); b.putInt(96,n); b.putInt(100,112+n*8);
        for(int i=0;i<n;i++){b.putInt(112+i*4, offsets[i]); b.putInt(112+n*4+i*4,i); b.putInt(112+n*8+i*32,i);}
        b.position(data);b.put(strings.toByteArray());return b.array();
    }
    private static Set<String> read(byte[] bytes) throws Exception { LinkedHashSet<String> names = new LinkedHashSet<>(); reader.invoke(null, bytes, names); return names; }
    private static void rejects(byte[] bytes) throws Exception { try { read(bytes); throw new AssertionError("Malformed DEX accepted"); } catch (InvocationTargetException expected) { if (!(expected.getCause() instanceof Exception)) throw expected; } }
    public static void main(String[] args) throws Exception {
        reader = Class.forName("dev.adbvault.helper.Main").getDeclaredMethod("dexClasses", byte[].class, LinkedHashSet.class); reader.setAccessible(true);
        if (!read(dex("org.acra.Example", "org.example.Имя", "org.acra.Example")).equals(new LinkedHashSet<>(Arrays.asList("org.acra.Example", "org.example.Имя")))) throw new AssertionError("Class decoding/deduplication failed");
        byte[] invalid = dex("org.example.App"); invalid[4] = '9'; rejects(invalid);
        invalid = dex("org.example.App"); ByteBuffer.wrap(invalid).order(ByteOrder.LITTLE_ENDIAN).putInt(100, Integer.MAX_VALUE); rejects(invalid);
        invalid = dex("org.example.App"); ByteBuffer.wrap(invalid).order(ByteOrder.LITTLE_ENDIAN).putInt(116, 10000); rejects(invalid);
        invalid = dex("org.example.App"); rejects(Arrays.copyOf(invalid, invalid.length - 1));
        rejects(dex("a".repeat(1025)));
        Method nativeReader = Class.forName("dev.adbvault.helper.Main").getDeclaredMethod("nativeHeader", InputStream.class); nativeReader.setAccessible(true);
        byte[] elf = new byte[20]; elf[0]=127;elf[1]='E';elf[2]='L';elf[3]='F';elf[4]=2;elf[5]=1;elf[18]=(byte)183;
        if (!nativeReader.invoke(null,new ByteArrayInputStream(elf)).toString().contains("ELF64 · AArch64")) throw new AssertionError("ELF machine not decoded");
        elf[5]=2;elf[18]=0;elf[19]=40;
        if (!nativeReader.invoke(null,new ByteArrayInputStream(elf)).toString().contains("ARM · big endian")) throw new AssertionError("ELF endianness not decoded");
        if (!nativeReader.invoke(null,new ByteArrayInputStream(new byte[2])).toString().contains("Invalid ELF")) throw new AssertionError("Truncated ELF accepted");
        System.out.println("PASS: DEX definitions, MUTF-8, duplicates, invalid headers/offsets/types/truncation/name limits; ELF architecture/endianness/truncation.");
    }
}
