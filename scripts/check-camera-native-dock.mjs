// Two owned test windows: an offscreen SDL-class fixture and a hidden Electron
// panel. No phone connection, input injection, or user windows are involved.
import { _electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const profile = await mkdtemp(path.resolve('desktop-test-results/camera-native-dock-'))
const touch = process.argv.includes('--touch')
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('scripts/fixtures/camera-panels-host.mjs'), `--user-data-dir=${profile}`], env, timeout: 30000 })
const script = `
$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class DockTest {
 public delegate IntPtr Proc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Class { public uint style; public Proc proc; public int cls,win; public IntPtr instance,icon,cursor,background; public string menu,name; }
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref Class c);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr inst,IntPtr param);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint extra; }
 [DllImport("user32.dll")] static extern int GetMessage(out Msg msg,IntPtr window,uint first,uint last);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg msg);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetStyle(IntPtr h,int index);
 public static bool Topmost(string handle) { return (GetStyle(new IntPtr(Convert.ToInt64(handle,16)),-20).ToInt64() & 8)!=0; }
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 static Proc proc=DefWindowProc; static IntPtr window;
 public static void Start() { var ready=new System.Threading.ManualResetEvent(false); var thread=new System.Threading.Thread(()=>{ SetThreadDpiAwarenessContext(new IntPtr(-4)); var c=new Class { proc=proc,name="SDL_DockingTest" }; RegisterClass(ref c); window=CreateWindowEx(0,c.name,"ADB Vault — Native dock test",0x10000000,20000,100,320,180,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero); ready.Set(); Msg msg; while(GetMessage(out msg,IntPtr.Zero,0,0)>0)DispatchMessage(ref msg); });thread.IsBackground=true;thread.Start();ready.WaitOne();if(window==IntPtr.Zero)throw new Exception("Window creation failed"); }
 public static void Move(int y) { SetWindowPos(window,IntPtr.Zero,20000,y,0,0,0x215); }
 public static void Show() { ShowWindow(window,8); ShowWindow(window,8); }
 public static void Stop() { DestroyWindow(window); }
}
'@
[DockTest]::Start(); [DockTest]::Show(); [Console]::Out.WriteLine('ready')
try { while($null -ne ($line=[Console]::In.ReadLine())) { if($line.StartsWith('pin:')){[Console]::Out.WriteLine((@{topmost=[DockTest]::Topmost($line.Substring(4))}|ConvertTo-Json -Compress));continue}; if($line -eq 'close'){[DockTest]::Stop();[Console]::Out.WriteLine('closed');break}; [DockTest]::Move([int]$line); [Console]::Out.WriteLine('moved') } } finally { [DockTest]::Stop() }
`
const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let output = '', errors = ''
child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { errors += data })
try {
 await expect.poll(() => { if(child.exitCode !== null) throw new Error(errors); return output.includes('ready') }, { timeout: 15000 }).toBe(true)
 await expect.poll(() => app.evaluate(() => !!globalThis.cameraPanelManager)).toBe(true)
 await app.evaluate(() => globalThis.cameraPanelManager.sync([{ id:'native', deviceId:'test', deviceName:'Test', mode:'camera', startedAt:new Date().toISOString() }]))
 await expect.poll(() => app.windows().length).toBe(2)
 const before = await app.evaluate(async ({ BrowserWindow }, { pid, touch }) => {
   const window=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#camera-session='))
   if(touch) { window.setResizable(true); window.setTitle('Touch controls · ADB Vault · native'); }
   const handle=window.getNativeWindowHandle().readBigUInt64LE().toString(16)
   globalThis.dockTestPanel={handle,title:window.getTitle(),id:window.id}
   await globalThis.cameraNativeControls.dockPanel(handle,window.getTitle(),pid,'ADB Vault — Native dock test',true)
   return window.getBounds()
 }, { pid: child.pid, touch })
 const bounds = () => app.evaluate(({ BrowserWindow })=>BrowserWindow.fromId(globalThis.dockTestPanel.id)?.getBounds())
 await expect.poll(async ()=>(await bounds())?.y).not.toBe(before.y)
 const first=await bounds()
 const pin = enabled => app.evaluate(async (_electron, { pid, enabled }) => { await globalThis.cameraNativeControls.setAlwaysOnTop(pid, 'ADB Vault — Native dock test', enabled) }, { pid: child.pid, enabled })
 const panelPinned = async () => {
   const replies = () => output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
   const count = replies().length
   child.stdin.write(`pin:${await app.evaluate(() => globalThis.dockTestPanel.handle)}\n`)
   await expect.poll(() => replies().length).toBe(count + 1)
   return replies().at(-1).topmost
 }
 await pin(true); assert.equal(await panelPinned(), true, 'Owned panel must follow the pinned window')
 await pin(false); assert.equal(await panelPinned(), false, 'Owned panel must follow unpinning')
 // No follow() calls: movement must arrive through WinEventHook alone.
 for(let i=0;i<80;i++) child.stdin.write(`${120+i}\n`)
 await expect.poll(() => output.split('moved').length-1).toBe(80)
 await expect.poll(async ()=>(await bounds()).y).toBeGreaterThan(first.y+35)
 const after=await bounds()
 assert.ok(Math.abs(after.width-(touch ? first.width : before.width))<=1 && Math.abs(after.height-(touch ? first.height : before.height))<=1, JSON.stringify({before,after}))
 if(touch) assert.ok(after.x > 10000 && after.width < 400 && after.height < 250, JSON.stringify(after))
 await pin(true); assert.equal(await panelPinned(), true)
 await app.evaluate(async (_electron,pid)=>{const p=globalThis.dockTestPanel;await globalThis.cameraNativeControls.dockPanel(p.handle,p.title,pid,'ADB Vault — Native dock test',false)},child.pid)
 assert.equal(await panelPinned(), false, 'Detaching from a pinned window clears the inherited pin')
 const detached=await bounds(); child.stdin.write('300\n')
 await pin(true); assert.equal(await panelPinned(), false, 'Detached panel must stay independent')
 await pin(false)
 await expect.poll(()=>output.split('moved').length-1).toBe(81)
 await new Promise(r=>setTimeout(r,200)); assert.deepEqual(await bounds(),detached)
 await assert.rejects(app.evaluate(async (_electron,pid)=>{const p=globalThis.dockTestPanel;await globalThis.cameraNativeControls.dockPanel(p.handle,p.title,pid,'ADB Vault — Wrong test title',true)},child.pid),/not ready/)
 await app.evaluate(async (_electron,pid)=>{
   const p=globalThis.dockTestPanel
   await globalThis.cameraNativeControls.dockPanel(p.handle,p.title,pid,'ADB Vault — Native dock test',true)
   await globalThis.cameraNativeControls.releaseCamera(pid,'ADB Vault — Native dock test')
 },child.pid)
 child.kill(); await expect.poll(()=>child.exitCode !== null || child.signalCode !== null).toBe(true)
 assert.ok(await bounds(), 'Panel must survive closing the released camera during a stream restart')
 console.log(`PASS: ${touch ? 'touch overlay matches the SDL client area and' : 'camera panel'} native events follow 80 moves without polling or size drift; detach, wrong-target protection and survival across shutdown verified.`)
} finally { child.kill(); await app.close() }
