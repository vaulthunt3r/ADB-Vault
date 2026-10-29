package dev.adbvault.helper;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.VectorDrawable;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.ColorDrawable;
import java.io.ByteArrayOutputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Field;
import org.json.JSONObject;

/** Device-only test entry point, excluded from the distributed helper. */
public final class IconProbe {
    public static void main(String[] args) throws Exception {
        Method contextMethod = Main.class.getDeclaredMethod("context", int.class); contextMethod.setAccessible(true);
        Context context = (Context) contextMethod.invoke(null, Integer.parseInt(args[0]));
        Method render = Main.class.getDeclaredMethod("icon", Drawable.class); render.setAccessible(true);
        JSONObject results = new JSONObject();
        Bitmap original = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888); original.eraseColor(0xff26846b);
        for (Bitmap.CompressFormat format : new Bitmap.CompressFormat[] { Bitmap.CompressFormat.PNG, Bitmap.CompressFormat.WEBP }) {
            ByteArrayOutputStream encoded = new ByteArrayOutputStream(); original.compress(format, 100, encoded);
            byte[] bytes = encoded.toByteArray(); Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            check(render, new BitmapDrawable(context.getResources(), decoded)); results.put(format.toString(), true); decoded.recycle();
        }
        original.recycle();
        check(render, new AdaptiveIconDrawable(new ColorDrawable(0xff26846b), new ColorDrawable(0xffdddddd))); results.put("AdaptiveIconDrawable", true);
        boolean vector = false;
        for (Field field : android.R.drawable.class.getFields()) {
            try { Drawable drawable = context.getDrawable(field.getInt(null)); if (drawable instanceof VectorDrawable) { check(render, drawable); vector = true; break; } }
            catch (RuntimeException ignored) { }
        }
        if (!vector) throw new IllegalStateException("No framework VectorDrawable available for this test");
        results.put("VectorDrawable", true);
        System.out.println(results.toString()); System.exit(0);
    }
    private static void check(Method render, Drawable drawable) throws Exception {
        String png = (String) render.invoke(null, drawable);
        byte[] bytes = android.util.Base64.decode(png, android.util.Base64.DEFAULT);
        Bitmap result = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (result == null || result.getWidth() != 96 || result.getHeight() != 96) throw new IllegalStateException("Invalid icon rendering");
        result.recycle();
    }
}
