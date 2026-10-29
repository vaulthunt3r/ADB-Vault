import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { cameraCommands, type CameraCommand } from './screen-protocol.js'
import { CAMERA_NATIVE_DOCK } from './camera-native-dock.js'

// Commands are scoped to the owned SDL window. Never inject global keystrokes or
// choose a target by the foreground window; the user's keyboard focus stays put.
export const CAMERA_WINDOW_SCRIPT = `
$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
try {
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static partial class VaultCameraWindow {
  delegate bool EnumProc(IntPtr window, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int size);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr key, IntPtr flags);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  public static void MovePanel(uint pid, string handle, string title, int x, int y) {
    IntPtr window=new IntPtr(Convert.ToInt64(handle,16));
    uint owner; GetWindowThreadProcessId(window,out owner);
    var name=new StringBuilder(1024); GetWindowText(window,name,name.Capacity);
    var cls=new StringBuilder(128); GetClassName(window,cls,cls.Capacity);
    if(owner!=pid || name.ToString()!=title || !title.StartsWith("Camera controls · ADB Vault · ", StringComparison.Ordinal) || !cls.ToString().StartsWith("Chrome_WidgetWin", StringComparison.Ordinal)) throw new Exception("The camera panel changed or closed. No window was moved.");
    IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      Rect rect;
      if(!GetWindowRect(window,out rect)) throw new Exception("The camera panel has closed.");
      // SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER.
      // Relative movement preserves the invisible Windows frame inset as well.
      if(!SetWindowPos(window,IntPtr.Zero,rect.Left+x,rect.Top+y,0,0,0x215)) throw new Exception("Windows could not move the camera panel.");
    } finally { if(previous!=IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
  }
  public static object Inspect(uint pid, string title) {
    IntPtr previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try {
      IntPtr target=Find(pid,title); Rect rect;
      if(target==IntPtr.Zero || !GetWindowRect(target,out rect)) return null;
      return new { x=rect.Left, y=rect.Top, width=rect.Right-rect.Left, height=rect.Bottom-rect.Top, minimized=IsIconic(target), visible=IsWindowVisible(target), foreground=GetForegroundWindow()==target, alwaysOnTop=(GetOwner(target,-20).ToInt64() & 8)!=0 };
    } finally { if(previous!=IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
  }
  public static void AlwaysOnTop(uint pid, string title, bool enabled) {
    IntPtr target=Find(pid,title);
    if(target==IntPtr.Zero || !Matches(target,pid,title)) throw new Exception("The screen window is not ready or has closed. Try again after it appears.");
    // Match our attached panels explicitly: hidden owned popups do not always
    // inherit a later topmost change. Never activate, move or resize windows.
    lock(dockLock) {
      bool previous=(GetOwner(target,-20).ToInt64() & 8)!=0;
      var panels=new System.Collections.Generic.List<Dock>();
      foreach(var dock in docks.Values) if(dock.camera==target && Matches(dock.panel,dock.panelPid,dock.panelTitle)) panels.Add(dock);
      try {
        if(!SetWindowPos(target,new IntPtr(enabled ? -1 : -2),0,0,0,0,0x213)) throw new Exception("Windows could not change the window pin.");
        foreach(var dock in panels) if(!SetWindowPos(dock.panel,new IntPtr(enabled ? -1 : -2),0,0,0,0,0x213)) throw new Exception("Windows could not pin the attached controls.");
        if(!Matches(target,pid,title) || ((GetOwner(target,-20).ToInt64() & 8)!=0)!=enabled) throw new Exception("The screen window did not confirm the pin change.");
      } catch {
        if(Matches(target,pid,title)) SetWindowPos(target,new IntPtr(previous ? -1 : -2),0,0,0,0,0x213);
        foreach(var dock in panels) if(Matches(dock.panel,dock.panelPid,dock.panelTitle)) SetWindowPos(dock.panel,new IntPtr(previous ? -1 : -2),0,0,0,0,0x213);
        throw;
      }
    }
  }
  static IntPtr Find(uint pid, string title) {
    IntPtr target=IntPtr.Zero;
    EnumWindows(delegate(IntPtr window, IntPtr param) {
      uint owner; GetWindowThreadProcessId(window,out owner);
      if(owner!=pid) return true;
      var name=new StringBuilder(1024); GetWindowText(window,name,name.Capacity);
      var cls=new StringBuilder(128); GetClassName(window,cls,cls.Capacity);
      if(name.ToString()==title && cls.ToString().StartsWith("SDL", StringComparison.Ordinal)) { target=window; return false; }
      return true;
    },IntPtr.Zero);
    return target;
  }
  static void Key(IntPtr window, int key, int scan, bool up, bool extended) {
    long flags=1L | ((long)scan << 16) | (extended ? 1L << 24 : 0) | (up ? 3L << 30 : 0);
    if(!PostMessage(window, up ? 0x101U : 0x100U, new IntPtr(key), new IntPtr(flags))) throw new Exception("Windows could not deliver the camera control.");
  }
  public static void Send(uint pid, string title, string command) {
    int key, scan; bool extended=false, shift=false;
    switch(command) {
      case "zoom-in": key=0x26; scan=0x48; extended=true; break;
      case "zoom-out": key=0x28; scan=0x50; extended=true; break;
      case "rotate-left": key=0x25; scan=0x4b; extended=true; break;
      case "rotate-right": key=0x27; scan=0x4d; extended=true; break;
      case "torch-on": key=0x54; scan=0x14; break;
      case "torch-off": key=0x54; scan=0x14; shift=true; break;
      default: throw new Exception("Unsupported live camera command.");
    }
    IntPtr target=Find(pid,title);
    if(target==IntPtr.Zero) throw new Exception("The camera window is not ready or has closed. Try again after the preview appears.");
    uint check; GetWindowThreadProcessId(target,out check);
    if(check!=pid) throw new Exception("The camera window changed. No command was sent.");
    Key(target,0x12,0x38,false,false);
    try {
      if(shift) Key(target,0x10,0x2a,false,false);
      Key(target,key,scan,false,extended);
    } finally {
      Key(target,key,scan,true,extended);
      if(shift) Key(target,0x10,0x2a,true,false);
      Key(target,0x12,0x38,true,false);
    }
  }
}
${CAMERA_NATIVE_DOCK}
'@
[Console]::Out.WriteLine('{"ready":true}')
while($null -ne ($line=[Console]::In.ReadLine())) {
  try {
    $request=$line | ConvertFrom-Json
    if ($request.command -eq 'release-camera') {
      [VaultCameraWindow]::ReleaseCamera([uint32]$request.pid,[string]$request.title)
      [Console]::Out.WriteLine('{"ok":true}')
    } elseif ($request.command -eq 'dock-panel') {
      [VaultCameraWindow]::DockPanel([uint32]$request.pid,[string]$request.handle,[string]$request.title,[uint32]$request.cameraPid,[string]$request.cameraTitle,[bool]$request.enabled)
      [Console]::Out.WriteLine('{"ok":true}')
    } elseif ($request.command -eq 'move-panel') {
      [VaultCameraWindow]::MovePanel([uint32]$request.pid,[string]$request.handle,[string]$request.title,[int]$request.x,[int]$request.y)
      [Console]::Out.WriteLine('{"ok":true}')
    } elseif ($request.command -eq 'always-on-top') {
      [VaultCameraWindow]::AlwaysOnTop([uint32]$request.pid,[string]$request.title,[bool]$request.enabled)
      [Console]::Out.WriteLine('{"ok":true}')
    } elseif ($request.command -eq 'inspect') {
      $bounds=[VaultCameraWindow]::Inspect([uint32]$request.pid,[string]$request.title)
      [Console]::Out.WriteLine((@{ok=$true;bounds=$bounds} | ConvertTo-Json -Compress))
    } else {
      [VaultCameraWindow]::Send([uint32]$request.pid,[string]$request.title,[string]$request.command)
      [Console]::Out.WriteLine('{"ok":true}')
    }
  } catch { [Console]::Out.WriteLine((@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`

export interface CameraWindowState { x: number; y: number; width: number; height: number; minimized: boolean; visible: boolean; foreground: boolean; alwaysOnTop?: boolean }
export interface CameraControlPort {
  send(pid: number, title: string, command: CameraCommand): Promise<void>
  setAlwaysOnTop?(pid: number, title: string, enabled: boolean): Promise<void>
  inspect?(pid: number, title: string): Promise<CameraWindowState | null>
  movePanel?(handle: string, title: string, x: number, y: number): Promise<void>
  dockPanel?(handle: string, title: string, pid: number, cameraTitle: string, enabled: boolean): Promise<void>
  releaseCamera?(pid: number, title: string): Promise<void>
  shutdown(): void
}
export class WindowsCameraControls implements CameraControlPort {
  private child?: ChildProcessWithoutNullStreams
  private ready?: Promise<void>
  private rejectReady?: (error: Error) => void
  private startup?: ReturnType<typeof setTimeout>
  private pending?: { resolve: (bounds: CameraWindowState | null) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false
  private start() {
    if (this.closed) return Promise.reject(new Error('Camera controls are closing.'))
    if (this.ready) return this.ready
    let resolveReady!: () => void
    const ready = this.ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; this.rejectReady = reject })
    // Bootstrap over stdin: the native helper exceeds Windows' command-line
    // limit once docking is included. Only our fixed script is loaded here.
    const bootstrap = '& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))))'
    const child = this.child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', bootstrap], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    this.startup = setTimeout(() => this.fail(new Error('Camera controls took too long to start. Try again.')), 15000)
    let output = '', stderr = '', initialized = false
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-1500) })
    child.stdout.on('data', data => {
      if (this.child !== child) return
      output += data
      if (output.length > 16000) { this.fail(new Error('Invalid camera control reply.')); return }
      let end: number
      while ((end = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, end).trim(); output = output.slice(end + 1)
        if (!line) continue
        try {
          const reply = JSON.parse(line)
          if (!initialized && reply.ready === true) { initialized = true; clearTimeout(this.startup); this.rejectReady = undefined; resolveReady(); continue }
          const pending = this.pending
          if (!initialized || !pending || typeof reply.ok !== 'boolean') throw new Error('Invalid camera control reply.')
          clearTimeout(pending.timer); this.pending = undefined
          if (reply.ok) pending.resolve(reply.bounds || null); else pending.reject(new Error(String(reply.error || 'Camera control failed.')))
        } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); return }
      }
    })
    child.once('error', error => { if (this.child === child) this.fail(error) })
    child.stdin.on('error', error => { if (this.child === child) this.fail(error) })
    child.once('exit', () => { if (this.child === child) this.fail(new Error(stderr || 'Camera controls stopped. Try again.')) })
    child.stdin.write(Buffer.from(CAMERA_WINDOW_SCRIPT, 'utf8').toString('base64') + '\n')
    return ready
  }
  private fail(error: Error) {
    clearTimeout(this.startup); this.rejectReady?.(error); this.rejectReady = undefined
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined }
    const child = this.child; this.child = undefined; this.ready = undefined; child?.kill()
  }
  async send(pid: number, title: string, command: CameraCommand) {
    await this.enqueue(pid, title, command)
  }
  inspect(pid: number, title: string) { return this.enqueue(pid, title, 'inspect') }
  async setAlwaysOnTop(pid: number, title: string, enabled: boolean) {
    if (!Number.isSafeInteger(pid) || pid < 1 || typeof title !== 'string' || !title.startsWith('ADB Vault — ') || title.length > 1000 || typeof enabled !== 'boolean') throw new Error('Invalid screen pin target.')
    const result = this.queue.then(() => this.request({ pid, title, enabled, command: 'always-on-top' }))
    this.queue = result.catch(() => {}); await result
  }
  async releaseCamera(pid: number, title: string) { await this.enqueue(pid, title, 'release-camera') }
  async dockPanel(handle: string, title: string, cameraPid: number, cameraTitle: string, enabled: boolean) {
    if (!/^[0-9a-f]{1,16}$/.test(handle) || !(title.startsWith('Camera controls · ADB Vault · ') || title.startsWith('Touch controls · ADB Vault · ') || title.startsWith('Screen pin · ADB Vault · ')) || title.length > 200 || !Number.isSafeInteger(cameraPid) || enabled && (cameraPid < 1 || !cameraTitle.startsWith('ADB Vault — ') || cameraTitle.length > 1000)) throw new Error('Invalid camera docking target.')
    const result = this.queue.then(() => this.request({ pid: process.pid, handle, title, cameraPid, cameraTitle, enabled, command: 'dock-panel' }))
    this.queue = result.catch(() => {}); await result
  }
  async movePanel(handle: string, title: string, x: number, y: number) {
    if (!/^[0-9a-f]{1,16}$/.test(handle) || !title.startsWith('Camera controls · ADB Vault · ') || title.length > 200 || ![x, y].every(n => Number.isSafeInteger(n) && Math.abs(n) < 1_000_000)) throw new Error('Invalid camera panel position.')
    const result = this.queue.then(() => this.request({ pid: process.pid, handle, title, x, y, command: 'move-panel' }))
    this.queue = result.catch(() => {})
    await result
  }
  private enqueue(pid: number, title: string, command: CameraCommand | 'inspect' | 'release-camera') {
    const result = this.queue.then(() => this.execute(pid, title, command))
    this.queue = result.catch(() => {})
    return result
  }
  private async execute(pid: number, title: string, command: CameraCommand | 'inspect' | 'release-camera') {
    if (!Number.isSafeInteger(pid) || pid < 1 || typeof title !== 'string' || !title.startsWith('ADB Vault — ') || title.length > 1000 || command !== 'inspect' && command !== 'release-camera' && !cameraCommands.includes(command)) throw new Error('Invalid live camera target or command.')
    return this.request({ pid, title, command })
  }
  private async request(value: Record<string, string | number | boolean>) {
    if (process.platform !== 'win32') throw new Error('Live camera buttons require Windows. Use shortcuts in the camera window.')
    await this.start()
    if (this.closed) throw new Error('Camera controls are closing.')
    if (this.pending) throw new Error('Wait for the current camera control.')
    return new Promise<CameraWindowState | null>((resolve, reject) => {
      this.pending = { resolve, reject, timer: setTimeout(() => this.fail(new Error('Camera control timed out. Try again.')), 3000) }
      this.child!.stdin.write(JSON.stringify(value) + '\n', 'utf8', error => { if (error) this.fail(error) })
    })
  }
  shutdown() { this.closed = true; this.fail(new Error('Camera controls are closing.')) }
}
