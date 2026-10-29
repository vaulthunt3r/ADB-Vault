package dev.adbvault.helper;

import android.content.Context;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.os.SystemClock;
import android.view.Display;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.MotionEvent;
import android.view.KeyEvent;
import android.view.KeyCharacterMap;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Timer;
import java.util.TimerTask;
import org.json.JSONArray;
import org.json.JSONObject;

/** A shell-owned, display-bound touch stream. EOF and a missing heartbeat cancel every finger. */
public final class TouchServer {
    private final DisplayManager displays;
    private final Context context;
    private ClipboardManager textClipboard;
    private final int displayId, userId;
    private final String uniqueId;
    private final Object input;
    private final Method inject, setDisplay, currentUser;
    private final ArrayList<Finger> fingers = new ArrayList<Finger>();
    private int width, height, rotation, epoch = 1;
    private long downTime, lastFrame = SystemClock.uptimeMillis();
    private boolean closed;
    private static final class Finger {
        final int id; final float x, y;
        Finger(int id, float x, float y) { this.id=id; this.x=x; this.y=y; }
    }
    private TouchServer(int id, int user) throws Exception {
        if (id <= 0 || user < 0) throw new IllegalArgumentException("A virtual display is required.");
        displayId=id; userId=user;
        context = Main.context(user);
        displays=(DisplayManager)context.getSystemService(Context.DISPLAY_SERVICE);
        Display display=displays.getDisplay(id);
        if (display==null || !display.getName().toLowerCase(java.util.Locale.ROOT).contains("scrcpy")) throw new Exception("The scrcpy display is no longer available.");
        uniqueId=identity(display);
        Class<?> manager;
        try { manager=Class.forName("android.hardware.input.InputManagerGlobal"); }
        catch (ClassNotFoundException e) { manager=Class.forName("android.hardware.input.InputManager"); }
        input=manager.getMethod("getInstance").invoke(null);
        inject=manager.getMethod("injectInputEvent", InputEvent.class, int.class);
        setDisplay=InputEvent.class.getMethod("setDisplayId", int.class);
        currentUser=Class.forName("android.app.ActivityManager").getMethod("getCurrentUser");
        check();
    }
    private static String identity(Display display) throws Exception { return (String)Display.class.getMethod("getUniqueId").invoke(display); }
    private void check() throws Exception {
        Display display=displays.getDisplay(displayId);
        if (display==null || !display.isValid() || !uniqueId.equals(identity(display)) || ((Integer)currentUser.invoke(null)).intValue()!=userId) throw new Exception("The display or Android profile changed. Reopen touch controls.");
        Point size=new Point(); display.getRealSize(size);
        if (size.x<=0 || size.y<=0) throw new Exception("The display has no usable size.");
        if (width!=size.x || height!=size.y || rotation!=display.getRotation()) {
            cancel(); width=size.x; height=size.y; rotation=display.getRotation(); epoch++;
            status("Display ready.");
        }
    }
    private void status(String message) throws Exception {
        System.out.println(new JSONObject().put("type","state").put("width",width).put("height",height).put("rotation",rotation).put("epoch",epoch).put("displayId",displayId).put("uniqueId",uniqueId).put("message",message).toString());
        System.out.flush();
    }
    private int index(int id) { for(int i=0;i<fingers.size();i++) if(fingers.get(i).id==id) return i; return -1; }
    private void event(int action) throws Exception {
        int count=fingers.size(); if(count==0) return;
        long now=SystemClock.uptimeMillis();
        if(action==MotionEvent.ACTION_DOWN) downTime=now;
        MotionEvent.PointerProperties[] properties=new MotionEvent.PointerProperties[count];
        MotionEvent.PointerCoords[] coords=new MotionEvent.PointerCoords[count];
        for(int i=0;i<count;i++) {
            Finger finger=fingers.get(i);
            properties[i]=new MotionEvent.PointerProperties(); properties[i].id=finger.id; properties[i].toolType=MotionEvent.TOOL_TYPE_FINGER;
            coords[i]=new MotionEvent.PointerCoords(); coords[i].x=finger.x*(width-1); coords[i].y=finger.y*(height-1); coords[i].pressure=1; coords[i].size=0.05f;
        }
        MotionEvent event=MotionEvent.obtain(downTime,now,action,count,properties,coords,0,0,1,1,0,0,InputDevice.SOURCE_TOUCHSCREEN,0);
        try {
            setDisplay.invoke(event,displayId);
            // WAIT_FOR_RESULT reports rejected injection without waiting for the app to finish dispatch.
            if(!Boolean.TRUE.equals(inject.invoke(input,event,1))) throw new Exception("Android rejected touch input on this display.");
        } finally { event.recycle(); }
    }
    private void cancel() {
        try { event(MotionEvent.ACTION_CANCEL); } catch(Exception ignored) { }
        fingers.clear();
    }
    private synchronized void frame(JSONObject command) throws Exception {
        if(closed) return;
        check();
        if(command.getInt("epoch")!=epoch) { cancel(); return; }
        JSONArray points=command.getJSONArray("points");
        if(points.length()>10) throw new Exception("Too many simultaneous touches.");
        ArrayList<Finger> next=new ArrayList<Finger>(); boolean[] ids=new boolean[10];
        for(int i=0;i<points.length();i++) {
            JSONObject point=points.getJSONObject(i); int id=point.getInt("id"); double x=point.getDouble("x"),y=point.getDouble("y");
            if(id<0 || id>=10 || ids[id] || Double.isNaN(x) || Double.isNaN(y) || x<0 || x>1 || y<0 || y>1) throw new Exception("Invalid touch coordinates.");
            ids[id]=true; next.add(new Finger(id,(float)x,(float)y));
        }
        lastFrame=SystemClock.uptimeMillis();
        // Release disappearing pointers before adding new ones; stable pointer IDs survive array reordering.
        for(int i=fingers.size()-1;i>=0;i--) if(!ids[fingers.get(i).id]) {
            event(fingers.size()==1 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_POINTER_UP | (i<<MotionEvent.ACTION_POINTER_INDEX_SHIFT)); fingers.remove(i);
        }
        boolean moved=false;
        for(Finger finger:next) {
            int i=index(finger.id);
            if(i>=0) { Finger old=fingers.set(i,finger); moved|=old.x!=finger.x || old.y!=finger.y; }
            else { fingers.add(finger); event(fingers.size()==1 ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_POINTER_DOWN | ((fingers.size()-1)<<MotionEvent.ACTION_POINTER_INDEX_SHIFT)); }
        }
        if(moved) event(MotionEvent.ACTION_MOVE);
    }
    private void key(int code, int meta) throws Exception {
        long time = SystemClock.uptimeMillis();
        try {
            keyEvent(new KeyEvent(time, time, KeyEvent.ACTION_DOWN, code, 0, meta, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD));
        } finally {
            keyEvent(new KeyEvent(time, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0, meta, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD));
        }
    }
    private ClipboardManager clipboard() throws Exception {
        android.app.KeyguardManager keyguard = (android.app.KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        if (keyguard != null && keyguard.isDeviceLocked()) throw new Exception("Unlock the phone to type or copy text with the PC layout.");
        // Touch/display lookup can use the shell system context. Clipboard
        // construction needs a fresh app context, before OEM services cache it.
        if (textClipboard == null) textClipboard = PhoneClipboard.manager(PhoneContext.from(context, userId));
        return textClipboard;
    }
    private void keyEvent(InputEvent event) throws Exception {
        setDisplay.invoke(event, displayId);
        // Finish dispatch before the next command can replace the clipboard.
        if (!Boolean.TRUE.equals(inject.invoke(input, event, 2))) throw new Exception("Android rejected keyboard input on this display.");
    }
    private static int keyCode(String key) throws Exception {
        switch(key) {
            case "Backspace": return KeyEvent.KEYCODE_DEL;
            case "Delete": return KeyEvent.KEYCODE_FORWARD_DEL;
            case "Enter": return KeyEvent.KEYCODE_ENTER;
            case "Tab": return KeyEvent.KEYCODE_TAB;
            case "ArrowUp": return KeyEvent.KEYCODE_DPAD_UP;
            case "ArrowDown": return KeyEvent.KEYCODE_DPAD_DOWN;
            case "ArrowLeft": return KeyEvent.KEYCODE_DPAD_LEFT;
            case "ArrowRight": return KeyEvent.KEYCODE_DPAD_RIGHT;
            case "Home": return KeyEvent.KEYCODE_MOVE_HOME;
            case "End": return KeyEvent.KEYCODE_MOVE_END;
            case "PageUp": return KeyEvent.KEYCODE_PAGE_UP;
            case "PageDown": return KeyEvent.KEYCODE_PAGE_DOWN;
            case "Escape": return KeyEvent.KEYCODE_BACK;
            case "SelectAll": return KeyEvent.KEYCODE_A;
            case "Copy": return KeyEvent.KEYCODE_COPY;
            case "Cut": return KeyEvent.KEYCODE_CUT;
            default: throw new Exception("Unsupported editing key.");
        }
    }
    private synchronized void inputCommand(JSONObject command) throws Exception {
        int id = command.getInt("id");
        JSONObject reply = new JSONObject().put("type", "input-result").put("id", id);
        try {
            check();
            if (closed || id <= 0 || command.getInt("epoch") != epoch) throw new Exception("The display changed. Select the text field again.");
            JSONObject data = command.getJSONObject("input");
            String type = data.getString("type");
            if (type.equals("text")) {
                String text = data.getString("text");
                if (text.length() == 0 || text.length() > 8192 || text.indexOf(0) >= 0) throw new Exception("Invalid input text.");
                ClipboardManager clipboard = clipboard();
                ClipData clip = ClipData.newPlainText("ADB Vault typing", text);
                android.os.PersistableBundle extras = new android.os.PersistableBundle();
                extras.putBoolean("android.content.extra.IS_SENSITIVE", true); clip.getDescription().setExtras(extras);
                clipboard.setPrimaryClip(clip);
                ClipData actual = clipboard.getPrimaryClip();
                if (actual == null) throw new Exception("Android returned no clipboard after setting text.");
                if (actual.getItemCount() != 1 || actual.getItemAt(0).getText() == null) throw new Exception("Android returned a non-text clipboard.");
                if (!text.contentEquals(actual.getItemAt(0).getText())) throw new Exception("Android returned a different clipboard after setting text.");
                key(KeyEvent.KEYCODE_PASTE, 0);
            } else if (type.equals("key")) {
                String name = data.getString("key");
                int meta = (data.optBoolean("shift") ? KeyEvent.META_SHIFT_ON : 0) | (data.optBoolean("control") || name.equals("SelectAll") ? KeyEvent.META_CTRL_ON : 0);
                boolean copy = name.equals("Copy") || name.equals("Cut");
                ClipboardManager clipboard = copy ? clipboard() : null;
                ClipData before = copy ? clipboard.getPrimaryClip() : null;
                key(keyCode(name), meta);
                if (copy) {
                    ClipData clip = clipboard.getPrimaryClip();
                    if (clip != null && clip.getItemCount() > 0 && (before == null || before.getItemCount() == 0 || clip.getDescription().getTimestamp() != before.getDescription().getTimestamp() || !java.util.Objects.equals(clip.getDescription().getLabel(), before.getDescription().getLabel()) || !java.util.Objects.equals(clip.getItemAt(0).getText(), before.getItemAt(0).getText()))) {
                        CharSequence text = clip.getItemAt(0).getText();
                        if (text != null && text.length() <= 8192) reply.put("text", text.toString());
                    }
                }
            } else if (type.equals("scroll")) {
                double x=data.getDouble("x"), y=data.getDouble("y"), dx=data.getDouble("dx"), dy=data.getDouble("dy");
                if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(dx) || !Double.isFinite(dy) || x<0 || x>1 || y<0 || y>1 || Math.abs(dx)>10 || Math.abs(dy)>10) throw new Exception("Invalid scroll input.");
                MotionEvent.PointerProperties p = new MotionEvent.PointerProperties(); p.id=0; p.toolType=MotionEvent.TOOL_TYPE_MOUSE;
                MotionEvent.PointerCoords c = new MotionEvent.PointerCoords(); c.x=(float)(x*(width-1)); c.y=(float)(y*(height-1));
                c.setAxisValue(MotionEvent.AXIS_HSCROLL, (float)dx); c.setAxisValue(MotionEvent.AXIS_VSCROLL, (float)dy);
                long now=SystemClock.uptimeMillis();
                MotionEvent event=MotionEvent.obtain(now,now,MotionEvent.ACTION_SCROLL,1,new MotionEvent.PointerProperties[]{p},new MotionEvent.PointerCoords[]{c},0,0,1,1,0,0,InputDevice.SOURCE_MOUSE,0);
                try { keyEvent(event); } finally { event.recycle(); }
            } else throw new Exception("Unsupported window input.");
            reply.put("ok", true);
        } catch (Exception error) {
            Throwable cause = error;
            while (cause.getCause() != null && cause.getCause() != cause) cause = cause.getCause();
            String detail = cause.getMessage();
            reply.put("ok", false).put("error", "Android input: " + cause.getClass().getSimpleName() + (detail == null ? "" : ": " + detail.substring(0, Math.min(300, detail.length()))));
        }
        // Never echo typed text in acknowledgements or diagnostics.
        System.out.println(reply.toString()); System.out.flush();
    }
    private synchronized void tick() {
        if(closed) return;
        try {
            check();
            if(!fingers.isEmpty() && SystemClock.uptimeMillis()-lastFrame>500) { cancel(); epoch++; status("Held input released after a connection delay."); }
        } catch(Exception error) { fail(error); }
    }
    private synchronized void fail(Exception error) {
        cancel(); closed=true;
        try { System.out.println(new JSONObject().put("type","error").put("message",error.getMessage()==null ? error.toString() : error.getMessage()).toString()); System.out.flush(); } catch(Exception ignored) { }
    }
    public static void main(String[] args) {
        TouchServer server=null; Timer timer=new Timer(true);
        try {
            server=new TouchServer(Integer.parseInt(args[0]),Integer.parseInt(args[1]));
            final TouchServer active=server;
            Runtime.getRuntime().addShutdownHook(new Thread(new Runnable(){ public void run(){ synchronized(active){ active.cancel(); } } }));
            timer.schedule(new TimerTask(){ public void run(){ active.tick(); } },100,100);
            BufferedReader reader=new BufferedReader(new InputStreamReader(System.in,"UTF-8"));
            // Bound the line before allocating JSON. A corrupt peer cannot grow the input buffer indefinitely.
            StringBuilder line=new StringBuilder(); int c;
            while(!server.closed && (c=reader.read())!=-1) {
                if(c=='\n') { if(line.length()>0) { JSONObject command = new JSONObject(line.toString()); if (command.optString("type").equals("input")) server.inputCommand(command); else server.frame(command); } line.setLength(0); }
                else { if(line.length()>=65536) throw new Exception("Input frame is too large."); line.append((char)c); }
            }
        } catch(Exception error) {
            if(server!=null) server.fail(error);
            else { try { System.out.println(new JSONObject().put("type","error").put("message",error.toString()).toString()); } catch(Exception ignored) {} }
        } finally { timer.cancel(); if(server!=null) synchronized(server){ server.closed=true; server.cancel(); } }
    }
}
