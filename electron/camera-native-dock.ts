// Runs on its own Win32 message thread inside the camera helper. No Electron
// bounds round-trips: SWP_NOSIZE keeps the panel stable at fractional DPI.
export const CAMERA_NATIVE_DOCK = `
public static partial class VaultCameraWindow {
  delegate void WinEventProc(IntPtr hook, uint evt, IntPtr hwnd, int obj, int child, uint thread, uint time);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEventProc callback, uint pid, uint tid, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint extra; }
  [DllImport("user32.dll")] static extern int GetMessage(out Msg msg, IntPtr window, uint first, uint last);
  [DllImport("user32.dll")] static extern bool PeekMessage(out Msg msg, IntPtr window, uint first, uint last, uint remove);
  [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint message, UIntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] static extern IntPtr SetOwner(IntPtr window, int index, IntPtr owner);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetOwner(IntPtr window, int index);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int size; public Rect monitor, work; public uint flags; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int size);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
  class Dock { public IntPtr panel, camera, owner; public uint panelPid, cameraPid; public string panelTitle, cameraTitle; }
  static readonly object dockLock=new object();
  static readonly System.Collections.Generic.Dictionary<IntPtr,Dock> docks=new System.Collections.Generic.Dictionary<IntPtr,Dock>();
  static readonly System.Threading.ManualResetEvent dockReady=new System.Threading.ManualResetEvent(false);
  static System.Threading.Thread dockThread;
  static uint dockThreadId;
  static bool dockHooksReady;
  static WinEventProc dockCallback;
  static bool Matches(IntPtr window, uint pid, string title) {
    uint actual; GetWindowThreadProcessId(window,out actual);
    var name=new StringBuilder(1024); GetWindowText(window,name,name.Capacity);
    return actual==pid && name.ToString()==title;
  }
  static Rect VisibleRect(IntPtr window, Rect fallback) { Rect visible; return DwmGetWindowAttribute(window,9,out visible,Marshal.SizeOf(typeof(Rect)))==0 && visible.Right>visible.Left && visible.Bottom>visible.Top ? visible : fallback; }
  static void FollowDock(Dock dock) {
    if(!Matches(dock.panel,dock.panelPid,dock.panelTitle) || !Matches(dock.camera,dock.cameraPid,dock.cameraTitle)) return;
    if(IsIconic(dock.camera) || !IsWindowVisible(dock.camera)) return; // Owned popup follows minimize/restore natively.
    Rect camera, panel; if(!GetWindowRect(dock.camera,out camera) || !GetWindowRect(dock.panel,out panel)) return;
    if(dock.panelTitle.StartsWith("Screen pin · ADB Vault · ",StringComparison.Ordinal)) {
      Rect client, buttons; var origin=new Point();
      if(!GetClientRect(dock.camera,out client) || !ClientToScreen(dock.camera,ref origin)) return;
      Rect frame=VisibleRect(dock.camera,camera);
      double scale=Math.Max(96U,GetDpiForWindow(dock.camera))/96.0;
      int gap=Math.Max(2,(int)Math.Round(2*scale)), pinWidth=(int)Math.Ceiling(30*scale), pinHeight=(int)Math.Ceiling(26*scale);
      int pinX,pinY,caption=origin.Y-frame.Top;
      if((GetOwner(dock.camera,-16).ToInt64() & 0xC00000)!=0 && caption>gap*2) {
        pinHeight=Math.Min(pinHeight,caption-gap*2);
        // DWM supplies the real caption button bounds, including DPI and theme.
        bool hasButtons=DwmGetWindowAttribute(dock.camera,5,out buttons,Marshal.SizeOf(typeof(Rect)))==0 && buttons.Right>buttons.Left && buttons.Left>pinWidth+gap;
        pinX=hasButtons ? camera.Left+buttons.Left-pinWidth-gap : frame.Left+(int)Math.Round(32*scale);
        pinY=frame.Top+(caption-pinHeight)/2;
      } else { pinX=origin.X+client.Right-pinWidth-gap*3; pinY=origin.Y+gap*3; }
      pinX=Math.Max(frame.Left+gap,Math.Min(pinX,frame.Right-pinWidth-gap));
      // The dedicated popup is smaller than a normal caption. Skip the normal
      // WM_WINDOWPOSCHANGING minimum-track-size adjustment for this button only.
      if(panel.Left!=pinX || panel.Top!=pinY || panel.Right-panel.Left!=pinWidth || panel.Bottom-panel.Top!=pinHeight) SetWindowPos(dock.panel,IntPtr.Zero,pinX,pinY,pinWidth,pinHeight,0x614);
      // Insert above this window's highest popup, preserving unrelated windows
      // above the group. This also works with an unfocused pinned touch overlay.
      IntPtr first=IntPtr.Zero;
      EnumWindows(delegate(IntPtr window,IntPtr param) {
        if(window==dock.camera || window==dock.panel || GetOwner(window,-8)==dock.camera) { first=window; return false; }
        return true;
      },IntPtr.Zero);
      if(first!=IntPtr.Zero && first!=dock.panel) {
        IntPtr before=GetWindow(first,3);
        if(before!=IntPtr.Zero && (GetOwner(before,-20).ToInt64() & 8)!=(GetOwner(dock.panel,-20).ToInt64() & 8)) before=IntPtr.Zero;
        SetWindowPos(dock.panel,before,0,0,0,0,0x213);
      }
      return;
    }
    if(dock.panelTitle.StartsWith("Touch controls · ADB Vault · ",StringComparison.Ordinal)) {
      Rect client; var point=new Point();
      if(!GetClientRect(dock.camera,out client) || !ClientToScreen(dock.camera,ref point)) return;
      int w=client.Right-client.Left,h=client.Bottom-client.Top;
      if(w>0 && h>0 && (panel.Left!=point.X || panel.Top!=point.Y || panel.Right-panel.Left!=w || panel.Bottom-panel.Top!=h)) SetWindowPos(dock.panel,IntPtr.Zero,point.X,point.Y,w,h,0x214);
      // Returning through the SDL taskbar/title bar must activate its input
      // overlay. Never take focus from a different app or interrupt dragging.
      if(IsWindowVisible(dock.panel) && (GetAsyncKeyState(1)&0x8000)==0 && GetForegroundWindow()==dock.camera) {
        if(!SetForegroundWindow(dock.panel)) {
          uint pid; uint source=GetWindowThreadProcessId(dock.camera,out pid), current=GetCurrentThreadId();
          if(source!=current && AttachThreadInput(current,source,true)) {
            try { if(GetForegroundWindow()==dock.camera) SetForegroundWindow(dock.panel); }
            finally { AttachThreadInput(current,source,false); }
          }
        }
      }
      return;
    }
    camera=VisibleRect(dock.camera,camera);
    Rect visible=VisibleRect(dock.panel,panel);
    var monitor=new MonitorInfo { size=Marshal.SizeOf(typeof(MonitorInfo)) };
    if(!GetMonitorInfo(MonitorFromWindow(dock.camera,2),ref monitor)) return;
    int width=visible.Right-visible.Left, height=visible.Bottom-visible.Top;
    int right=camera.Right, left=camera.Left-width;
    int x=right+width<=monitor.work.Right ? right : left>=monitor.work.Left ? left : monitor.work.Right-width;
    x=Math.Max(monitor.work.Left,Math.Min(x,monitor.work.Right-width));
    int y=Math.Max(monitor.work.Top,Math.Min(camera.Top,monitor.work.Bottom-height));
    // Coordinates refer to the visible frame; preserve native frame insets.
    x+=panel.Left-visible.Left; y+=panel.Top-visible.Top;
    if(x!=panel.Left || y!=panel.Top) SetWindowPos(dock.panel,IntPtr.Zero,x,y,0,0,0x215);
  }
  static void FollowAll(IntPtr camera) {
    lock(dockLock) {
      var removed=new System.Collections.Generic.List<IntPtr>();
      var pins=new System.Collections.Generic.List<Dock>();
      foreach(var dock in docks.Values) {
        if(camera!=IntPtr.Zero && camera!=dock.camera && GetOwner(camera,-8)!=dock.camera) continue;
        if(!Matches(dock.panel,dock.panelPid,dock.panelTitle)) { removed.Add(dock.panel); continue; }
        if(!Matches(dock.camera,dock.cameraPid,dock.cameraTitle)) { SetOwner(dock.panel,-8,dock.owner); removed.Add(dock.panel); continue; }
        if(camera==IntPtr.Zero || camera==dock.camera || GetOwner(camera,-8)==dock.camera) {
          if(dock.panelTitle.StartsWith("Screen pin · ADB Vault · ",StringComparison.Ordinal)) pins.Add(dock);
          else FollowDock(dock);
        }
      }
      foreach(var pin in pins) FollowDock(pin);
      foreach(var panel in removed) docks.Remove(panel);
    }
  }
  static void DockLoop() {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    dockThreadId=GetCurrentThreadId(); Msg msg; PeekMessage(out msg,IntPtr.Zero,0,0,0);
    dockCallback=delegate(IntPtr hook,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time) { if(obj==0 && child==0) FollowAll(hwnd); };
    IntPtr location=SetWinEventHook(0x800B,0x800B,IntPtr.Zero,dockCallback,0,0,0);
    IntPtr restored=SetWinEventHook(0x0017,0x0017,IntPtr.Zero,dockCallback,0,0,0);
    IntPtr foreground=SetWinEventHook(0x0003,0x0003,IntPtr.Zero,dockCallback,0,0,0);
    dockHooksReady=location!=IntPtr.Zero && restored!=IntPtr.Zero && foreground!=IntPtr.Zero;
    dockReady.Set();
    while(GetMessage(out msg,IntPtr.Zero,0,0)>0) { if(msg.message==0x8001) FollowAll(IntPtr.Zero); }
    UnhookWinEvent(location); UnhookWinEvent(restored); UnhookWinEvent(foreground);
  }
  public static void ReleaseCamera(uint pid,string title) {
    lock(dockLock) {
      var removed=new System.Collections.Generic.List<IntPtr>();
      foreach(var dock in docks.Values) if(dock.cameraPid==pid && dock.cameraTitle==title) {
        if(Matches(dock.panel,dock.panelPid,dock.panelTitle)) SetOwner(dock.panel,-8,dock.owner);
        removed.Add(dock.panel);
      }
      foreach(var panel in removed) docks.Remove(panel);
    }
  }
  public static void DockPanel(uint panelPid,string handle,string panelTitle,uint cameraPid,string cameraTitle,bool enabled) {
    IntPtr panel=new IntPtr(Convert.ToInt64(handle,16));
    var cls=new StringBuilder(128); GetClassName(panel,cls,cls.Capacity);
    if(!Matches(panel,panelPid,panelTitle) || !(panelTitle.StartsWith("Camera controls · ADB Vault · ",StringComparison.Ordinal) || panelTitle.StartsWith("Touch controls · ADB Vault · ",StringComparison.Ordinal) || panelTitle.StartsWith("Screen pin · ADB Vault · ",StringComparison.Ordinal)) || !cls.ToString().StartsWith("Chrome_WidgetWin",StringComparison.Ordinal)) throw new Exception("The controls panel changed or closed.");
    lock(dockLock) {
      Dock old; docks.TryGetValue(panel,out old);
      if(!enabled) {
        if(old!=null) { SetOwner(panel,-8,old.owner); docks.Remove(panel); }
        // The native pin is independent of Electron's cached z-order state.
        // A detached controls panel must return to the normal window group.
        SetWindowPos(panel,new IntPtr(-2),0,0,0,0,0x213);
        return;
      }
      IntPtr camera=Find(cameraPid,cameraTitle);
      if(camera==IntPtr.Zero) throw new Exception("The camera window is not ready.");
      if(old!=null && old.camera==camera && old.cameraPid==cameraPid && old.cameraTitle==cameraTitle) { PostThreadMessage(dockThreadId,0x8001,UIntPtr.Zero,IntPtr.Zero); return; }
      IntPtr previousOwner=old!=null?old.owner:GetOwner(panel,-8);
      if(previousOwner==camera) previousOwner=IntPtr.Zero; // Recover after helper restart.
      var dock=new Dock { panel=panel,camera=camera,panelPid=panelPid,cameraPid=cameraPid,panelTitle=panelTitle,cameraTitle=cameraTitle,owner=previousOwner };
      SetOwner(panel,-8,camera); docks[panel]=dock;
      // Match the camera's z-order policy without clearing an explicitly
      // requested always-on-top camera window (GWL_EXSTYLE / WS_EX_TOPMOST).
      bool topmost=(GetOwner(camera,-20).ToInt64() & 8)!=0;
      SetWindowPos(panel,new IntPtr(topmost ? -1 : -2),0,0,0,0,0x213);
      if(dockThread==null) { dockThread=new System.Threading.Thread(DockLoop); dockThread.IsBackground=true; dockThread.Start(); }
    }
    if(!dockReady.WaitOne(3000) || !dockHooksReady) throw new Exception("Camera docking did not start.");
    PostThreadMessage(dockThreadId,0x8001,UIntPtr.Zero,IntPtr.Zero);
  }
}
`
