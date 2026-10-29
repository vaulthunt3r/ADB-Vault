import dev.adbvault.helper.ApkAddresses;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

/** Synthetic inputs only. No phone, network, Android APIs or application execution. */
public final class ApkAddressesTest {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private interface Attempt { void run() throws Exception; }
    private static void rejects(Attempt task) throws Exception { try { task.run(); throw new AssertionError("Malformed input accepted"); } catch (Exception expected) {} }
    private static void leb(ByteArrayOutputStream out, int n) { do { int b=n&127; n>>>=7; out.write(b | (n>0?128:0)); } while(n>0); }
    private static byte[] dex(String... values) throws Exception {
        int data=112+values.length*4; ByteArrayOutputStream strings=new ByteArrayOutputStream(); int[] offsets=new int[values.length];
        for(int i=0;i<values.length;i++) {
            offsets[i]=data+strings.size(); leb(strings,values[i].length());
            // Modified UTF-8, including embedded null and surrogate pairs.
            for(char c:values[i].toCharArray()) {
                if(c>0 && c<128) strings.write(c);
                else if(c<2048){strings.write(192|(c>>6));strings.write(128|(c&63));}
                else {strings.write(224|(c>>12));strings.write(128|((c>>6)&63));strings.write(128|(c&63));}
            }
            strings.write(0);
        }
        ByteBuffer b=ByteBuffer.allocate(data+strings.size()).order(ByteOrder.LITTLE_ENDIAN);
        b.put(new byte[]{'d','e','x','\n','0','3','9',0});b.putInt(32,b.capacity());b.putInt(36,112);b.putInt(40,0x12345678);b.putInt(56,values.length);b.putInt(60,112);
        for(int i=0;i<values.length;i++)b.putInt(112+i*4,offsets[i]); b.position(data);b.put(strings.toByteArray());return b.array();
    }
    private static void len8(ByteArrayOutputStream out,int n){if(n>=128)out.write(128|(n>>8));out.write(n&255);}
    private static byte[] resource(boolean utf8, int type, String... values) throws Exception {
        ByteArrayOutputStream strings=new ByteArrayOutputStream();int[] offsets=new int[values.length];
        for(int i=0;i<values.length;i++) {
            offsets[i]=strings.size();byte[] bytes=values[i].getBytes(utf8?StandardCharsets.UTF_8:StandardCharsets.UTF_16LE);
            if(utf8){len8(strings,values[i].length());len8(strings,bytes.length);}else{strings.write(values[i].length()&255);strings.write(values[i].length()>>8);}
            strings.write(bytes);strings.write(0);if(!utf8)strings.write(0);
        }
        int data=28+values.length*4,size=data+strings.size(),rootHeader=type==2?12:8;
        ByteBuffer b=ByteBuffer.allocate(rootHeader+size).order(ByteOrder.LITTLE_ENDIAN);
        b.putShort(0,(short)type);b.putShort(2,(short)rootHeader);b.putInt(4,b.capacity());
        int p=rootHeader;b.putShort(p,(short)1);b.putShort(p+2,(short)28);b.putInt(p+4,size);b.putInt(p+8,values.length);b.putInt(p+16,utf8?256:0);b.putInt(p+20,data);
        for(int i=0;i<values.length;i++)b.putInt(p+28+i*4,offsets[i]);b.position(p+data);b.put(strings.toByteArray());return b.array();
    }
    public static void main(String[] args) throws Exception {
        ApkAddresses scan=new ApkAddresses();
        byte[] dex=dex("Lcom/example/Class;","https://API.example.com/path?a=1", "api.example.org", "prefix\u0000https://unicode.example.com/путь", "", "android.app", "android.permission.CAMERA", "com.google.android", "resources.arsc", "picture.png");
        scan.dex(dex,"/base.apk","classes.dex");scan.dex(dex,"/split.apk","classes2.dex");
        check(scan.candidates.size()==3,"DEX strings/descriptor exclusion");
        check(scan.candidates.get("https://API.example.com/path?a=1").size()==2,"Split provenance deduplication");
        for(boolean utf8:new boolean[]{true,false})for(int type:new int[]{2,3}) {
            scan.resources(resource(utf8,type,"https://resource.example.net/🦊","cdn.example.org","x".repeat(130)),"/base.apk",utf8?"resources.arsc":"res/xml/config.xml");
        }
        check(scan.candidates.containsKey("https://resource.example.net/🦊"),"UTF-8/UTF-16 resource strings");
        check(scan.candidates.containsKey("cdn.example.org"),"Bare resource domain");
        scan.resources(resource(true,3),"/base.apk","empty.xml");
        scan.text("{\"url\":\"https:\\/\\/assets.example.com/v1\",\"host\":\"assets.example.org\"}".getBytes(StandardCharsets.UTF_8),"/split.apk","assets/config.json");
        check(scan.candidates.containsKey("https://assets.example.com/v1"),"Escaped JSON URL");
        check(scan.candidates.containsKey("assets.example.org"),"Quoted JSON host");
        check(!ApkAddresses.supported("assets/picture.png") && ApkAddresses.supported("assets/config.json"),"Supported text files only");
        rejects(()->scan.dex(new byte[3],"/a","dex"));
        byte[] bad=dex("https://example.com");ByteBuffer.wrap(bad).order(ByteOrder.LITTLE_ENDIAN).putInt(112,Integer.MAX_VALUE);rejects(()->scan.dex(bad,"/a","dex"));
        byte[] terminated=dex("https://example.com");terminated[terminated.length-1]=1;rejects(()->scan.dex(terminated,"/a","dex"));
        byte[] invalid=resource(true,3,"https://example.com");ByteBuffer.wrap(invalid).order(ByteOrder.LITTLE_ENDIAN).putInt(8+28,Integer.MAX_VALUE);rejects(()->scan.resources(invalid,"/a","xml"));
        byte[] truncated=resource(false,2,"https://example.com");rejects(()->scan.resources(Arrays.copyOf(truncated,truncated.length-1),"/a","arsc"));
        rejects(()->scan.text(new byte[]{(byte)0xc3,0},"/a","txt"));
        ApkAddresses bounded=new ApkAddresses();
        bounded.dex(dex("x".repeat(65537),"https://after.example.com"),"/base.apk","classes.dex");
        check(!bounded.issues.isEmpty() && bounded.candidates.containsKey("https://after.example.com"),"Oversized strings explicitly skipped without losing later strings");
        for(int i=0;i<2010;i++)bounded.text(("https://h"+i+".example.com").getBytes(StandardCharsets.UTF_8),"/base.apk","assets/config.txt");
        check(bounded.candidates.size()==2000 && bounded.issues.stream().anyMatch(s->s.contains("candidate limit")),"Candidate cap");
        ApkAddresses sources=new ApkAddresses();
        for(int i=0;i<10;i++)sources.text("https://same.example.com".getBytes(StandardCharsets.UTF_8),"/split"+i+".apk","config.txt");
        check(sources.candidates.values().iterator().next().size()==8 && !sources.issues.isEmpty(),"Source cap");
        Path zipped=Files.createTempFile("apk-address-test-",".apk");
        try {
            try(ZipOutputStream zip=new ZipOutputStream(Files.newOutputStream(zipped))) {
                zip.putNextEntry(new ZipEntry("assets/config.json"));zip.write("{\"api\":\"https://zip.example.com\"}".getBytes(StandardCharsets.UTF_8));zip.closeEntry();
                zip.putNextEntry(new ZipEntry("assets/large.txt"));zip.write(new byte[8*1024*1024+1]);zip.closeEntry();
            }
            ApkAddresses packed=new ApkAddresses();
            try(ZipFile zip=new ZipFile(zipped.toFile())){packed.file(zip,zip.getEntry("assets/config.json"),"/split.apk");packed.file(zip,zip.getEntry("assets/large.txt"),"/split.apk");}
            check(packed.candidates.containsKey("https://zip.example.com") && packed.issues.stream().anyMatch(s->s.contains("byte limit")),"ZIP resources and bounded inflation");
        } finally {Files.delete(zipped);}
        System.out.println("PASS: APK addresses from DEX, UTF-8/UTF-16 resources and text assets; split provenance, malformed inputs and bounded partial results.");
    }
}
