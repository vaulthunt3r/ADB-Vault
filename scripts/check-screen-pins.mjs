// Real framed Win32 windows and sandboxed pin popups, offscreen; no phone input.
import { _electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
const profile = await mkdtemp(path.resolve('desktop-test-results/screen-pins-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('scripts/fixtures/screen-pins-host.mjs'), `--user-data-dir=${profile}`], env, timeout: 30000 })
const script = `
$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class PinTest {
 public delegate IntPtr Proc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Class { public uint style; public Proc proc; public int cls,win; public IntPtr instance,icon,cursor,background; public string menu,name; }
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref Class c);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr inst,IntPtr param);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint extra; }
 [DllImport("user32.dll")] static extern int GetMessage(out Msg msg,IntPtr window,uint first,uint last);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg msg);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h,uint message,IntPtr w,IntPtr l);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetStyle(IntPtr h,int index);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetStyle(IntPtr h,int index,IntPtr value);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint command);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref Point p);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 static Proc proc=DefWindowProc; static Dictionary<string,IntPtr> windows=new Dictionary<string,IntPtr>();
 public static void Start() { var ready=new System.Threading.ManualResetEvent(false); var thread=new System.Threading.Thread(()=>{ SetThreadDpiAwarenessContext(new IntPtr(-4)); var c=new Class { proc=proc,name="SDL_CaptionPinTest" }; RegisterClass(ref c); int y=100; foreach(string id in new[]{"display","virtual","camera","replacement"}){ windows[id]=CreateWindowEx(0,c.name,"ADB Vault — Caption pin "+id,0x10CF0000,20000,y,500,280,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);y+=300;} ready.Set(); Msg msg; while(GetMessage(out msg,IntPtr.Zero,0,0)>0)DispatchMessage(ref msg); });thread.IsBackground=true;thread.Start();ready.WaitOne(); }
 public static object Inspect(string key) { SetThreadDpiAwarenessContext(new IntPtr(-4)); IntPtr h=windows.ContainsKey(key)?windows[key]:new IntPtr(Convert.ToInt64(key,16)); Rect r,c;GetWindowRect(h,out r);GetClientRect(h,out c);var p=new Point();ClientToScreen(h,ref p);return new {x=r.Left,y=r.Top,width=r.Right-r.Left,height=r.Bottom-r.Top,clientX=p.X,clientY=p.Y,clientWidth=c.Right,clientHeight=c.Bottom,topmost=(GetStyle(h,-20).ToInt64()&8)!=0,noActivate=(GetStyle(h,-20).ToInt64()&0x08000000)!=0,previous=GetWindow(h,3).ToInt64().ToString("x"),foreground=GetForegroundWindow().ToInt64().ToString("x")}; }
 public static void Move(string key,int y) { SetWindowPos(windows[key],IntPtr.Zero,20000,y,0,0,0x215); }
 public static void Fullscreen(string key,bool enabled) { SetStyle(windows[key],-16,new IntPtr(enabled?0x90000000L:0x10CF0000L));SetWindowPos(windows[key],IntPtr.Zero,0,0,0,0,0x237); }
 public static void Show(string key,int command) { ShowWindow(windows[key],command); }
 public static void Close(string key) { SendMessage(windows[key],0x10,IntPtr.Zero,IntPtr.Zero); }
}
'@
[PinTest]::Start(); [PinTest]::Show('display',8); [PinTest]::Show('display',8); [Console]::Out.WriteLine('ready')
while($null -ne ($line=[Console]::In.ReadLine())) {
 try { $r=$line|ConvertFrom-Json; switch($r.op){'move'{[PinTest]::Move($r.key,$r.y)} 'fullscreen'{[PinTest]::Fullscreen($r.key,$r.enabled)} 'show'{[PinTest]::Show($r.key,$r.command)} 'close'{[PinTest]::Close($r.key)}}; [Console]::Out.WriteLine(([PinTest]::Inspect($r.key)|ConvertTo-Json -Compress)) }
 catch { [Console]::Out.WriteLine((@{error=$_.Exception.Message}|ConvertTo-Json -Compress)) }
}
`
const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let output = '', errors = ''
child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { errors += data })
const command = async value => {
  const replies = () => output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
  const count = replies().length; child.stdin.write(JSON.stringify(value) + '\n')
  await expect.poll(() => { if (child.exitCode !== null) throw new Error(errors); return replies().length }, { timeout: 10000 }).toBe(count + 1)
  const result = replies().at(-1); assert.ok(!result.error, result.error); return result
}
try {
  await expect.poll(() => { if (child.exitCode !== null) throw new Error(errors); return output.includes('ready') }, { timeout: 15000 }).toBe(true)
  await expect.poll(() => app.evaluate(() => !!globalThis.pinsReady)).toBe(true)
  assert.ok(await app.evaluate((_electron, pid) => globalThis.pinNative.inspect(pid, 'ADB Vault — Caption pin display'), child.pid), 'Native helper compiles and finds the target')
  await app.evaluate((_electron, pid) => globalThis.initializePins(pid), child.pid)
  const pins = () => app.windows().filter(p => p.url().includes('screen-pin.html'))
  await expect.poll(() => pins().length).toBe(3)
  const page = mode => pins().find(p => p.url().endsWith(`#session=${mode}`))
  const handle = mode => app.evaluate(({ BrowserWindow }, mode) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith(`#session=${mode}`)).getNativeWindowHandle().readBigUInt64LE().toString(16), mode)
  const visible = mode => app.evaluate(({ BrowserWindow }, mode) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith(`#session=${mode}`)).isVisible(), mode)
  const inspect = key => command({ op: 'inspect', key })
  for (const mode of ['display', 'virtual', 'camera']) {
    await expect.poll(() => visible(mode), { timeout: 20000 }).toBe(true)
    const owner = await inspect(mode), pin = await inspect(await handle(mode))
    assert.equal(pin.noActivate, true)
    assert.ok(pin.x >= owner.x && pin.x + pin.width <= owner.x + owner.width)
    assert.ok(pin.y >= owner.y && pin.y + pin.height <= owner.clientY, JSON.stringify({ owner, pin }))
    const button = page(mode).getByRole('button', { name: 'Always on top' })
    await expect(button).toBeEnabled()
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    const pinned = await inspect(mode)
    assert.equal(pinned.topmost, true); assert.equal(pinned.foreground, owner.foreground)
    assert.equal((await inspect(await handle(mode))).topmost, true)
    const pinnedButton = await inspect(await handle(mode))
    assert.ok(pinnedButton.y + pinnedButton.height <= owner.clientY, 'Pinning must not enlarge the caption button')
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'false')
    assert.equal((await inspect(mode)).topmost, false)
  }
  const game = page('virtual'), gameHandle = await handle('virtual')
  await command({ op: 'move', key: 'virtual', y: 850 })
  await expect.poll(async () => (await inspect(gameHandle)).y).toBeGreaterThan(850)
  await command({ op: 'fullscreen', key: 'virtual', enabled: true })
  await expect.poll(async () => { const o = await inspect('virtual'), p = await inspect(gameHandle); return p.y > o.clientY && p.x > o.x + o.width / 2 }).toBe(true)
  await game.getByRole('button').click(); await expect(game.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  const overlay = await app.evaluate(() => globalThis.addTestTouch())
  await expect.poll(async () => (await inspect(overlay)).previous).toBe(gameHandle)
  await game.getByRole('button').click(); await expect(game.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(async () => (await inspect(overlay)).previous).toBe(gameHandle)
  assert.equal((await inspect(gameHandle)).topmost, false)
  await game.getByRole('button').click(); await expect(game.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  await command({ op: 'show', key: 'virtual', command: 6 })
  await expect.poll(() => visible('virtual')).toBe(false)
  await command({ op: 'show', key: 'virtual', command: 4 })
  await expect.poll(() => visible('virtual')).toBe(true)
  await app.evaluate(() => { globalThis.pinFailure = 'The screen window is busy.' })
  await game.getByRole('button').click()
  await expect(game.getByRole('button')).toHaveAttribute('title', 'The screen window is busy.')
  await expect(game.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  await app.evaluate(() => { globalThis.pinFailure = ''; globalThis.pinSessions[2].restarting = true; globalThis.screenPins.sync(globalThis.pinSessions) })
  await expect.poll(() => visible('camera')).toBe(false)
  await app.evaluate(async (_electron, pid) => { await globalThis.pinNative.releaseCamera(pid, globalThis.pinTitles.camera); globalThis.pinTitles.camera = 'ADB Vault — Caption pin replacement' }, child.pid)
  await command({ op: 'close', key: 'camera' })
  await app.evaluate(() => { globalThis.pinSessions[2].restarting = false; globalThis.screenPins.sync(globalThis.pinSessions) })
  await expect.poll(() => visible('camera')).toBe(true)
  await page('camera').getByRole('button').click(); await expect(page('camera').getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  assert.equal((await inspect('replacement')).topmost, true)
  await app.evaluate(() => globalThis.screenPins.sync([])); await expect.poll(() => pins().length).toBe(0)
  await writeFile(path.join(profile, 'result.json'), JSON.stringify({ passed: true, modes: 3, captionPlacement: true, nonactivating: true, fullscreen: true, minimizeRestore: true, restart: true, errorPreservesState: true }, null, 2))
  console.log(`PASS: automatic pin on all three windows; real topmost toggles, caption/fullscreen placement, native movement, no focus theft, minimize/restore, error state, replacement and cleanup. ${profile}`)
} catch (error) {
  console.error(await app.evaluate(({ BrowserWindow }) => ({ dockError: globalThis.pinDockError, windows: BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), url: w.webContents.getURL(), visible: w.isVisible(), loading: w.webContents.isLoading() })) })))
  throw error
} finally { child.kill(); await app.close() }
