// Production TouchPanels with native Windows focus and hit-testing. Only the
// Android stream is a fixture; no phone or existing application is touched.
import { _electron, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const profile = await mkdtemp(path.resolve('desktop-test-results/touch-focus-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ADB_VAULT_SMOKE_TEST
const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('scripts/fixtures/touch-focus-host.mjs'), `--user-data-dir=${profile}`], env, timeout: 30000 })
const script = `
$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class TouchFocusTest {
 public delegate IntPtr Proc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Class { public uint style; public Proc proc; public int cls,win; public IntPtr instance,icon,cursor,background; public string menu,name; }
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref Class c);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr inst,IntPtr param);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
 [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x,y; public uint extra; }
 [DllImport("user32.dll")] static extern int GetMessage(out Msg msg,IntPtr window,uint first,uint last);
 [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref Msg msg);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
 [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
 [StructLayout(LayoutKind.Sequential)] struct Rect { public int l,t,r,b; }
 [StructLayout(LayoutKind.Sequential)] struct Point { public int x,y; }
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point p);
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] static extern uint MapVirtualKey(uint key,uint map);
 static Proc proc=DefWindowProc; static IntPtr window;
 public static void Start() { var ready=new System.Threading.ManualResetEvent(false); var thread=new System.Threading.Thread(()=>{ SetThreadDpiAwarenessContext(new IntPtr(-4)); var c=new Class { proc=proc,name="SDL_TouchFocusTest",background=new IntPtr(6) }; RegisterClass(ref c); window=CreateWindowEx(8,c.name,"ADB Vault — Touch focus test",0x10CF0000,460,120,800,600,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero); ready.Set(); Msg msg; while(GetMessage(out msg,IntPtr.Zero,0,0)>0)DispatchMessage(ref msg); });thread.IsBackground=true;thread.Start();ready.WaitOne();if(window==IntPtr.Zero)throw new Exception("Window creation failed"); }
 public static void Click(string handle) { SetThreadDpiAwarenessContext(new IntPtr(-4)); var target=handle=="owner"?window:new IntPtr(Convert.ToInt64(handle,16)); Rect r;GetWindowRect(target,out r);var point=new Point {x=(r.l+r.r)/2,y=r.t+12};if(GetAncestor(WindowFromPoint(point),2)!=target)throw new Exception("Owned test window is covered; no click sent");Point previous;GetCursorPos(out previous);SetCursorPos(point.x,point.y);try { if(GetAncestor(WindowFromPoint(point),2)!=target)throw new Exception("Owned test window moved; no click sent");mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero); }finally{SetCursorPos(previous.x,previous.y);} }
 public static void Show() { ShowWindow(window,8); ShowWindow(window,8); }
 public static void Focus() { Click("owner"); }
 public static string Hit(string handle) { SetThreadDpiAwarenessContext(new IntPtr(-4)); IntPtr panel=new IntPtr(Convert.ToInt64(handle,16)); Rect r;GetWindowRect(panel,out r);return GetAncestor(WindowFromPoint(new Point { x=(r.l+r.r)/2,y=(r.t+r.b)/2 }),2).ToInt64().ToString("x"); }
 public static void Key(string handle,int key,bool up) { var target=new IntPtr(Convert.ToInt64(handle,16)); if(GetForegroundWindow()!=target)throw new Exception("Test overlay is not foreground"); uint flags=(MapVirtualKey((uint)key,0)<<16)|1u|(up?0xC0000000u:0u); PostMessage(target,up?0x101u:0x100u,new IntPtr(key),new IntPtr((long)flags)); }
}
'@
[TouchFocusTest]::Start(); [TouchFocusTest]::Show(); [Console]::Out.WriteLine('ready')
while($null -ne ($line=[Console]::In.ReadLine())) { $r=$line | ConvertFrom-Json; if($r.action -eq 'focus'){[TouchFocusTest]::Focus();$result='focused'} elseif($r.action -eq 'click'){[TouchFocusTest]::Click($r.handle);$result='clicked'} elseif($r.action -eq 'hit'){$result=[TouchFocusTest]::Hit($r.handle)} elseif($r.action -eq 'key'){[TouchFocusTest]::Key($r.handle,$r.key,$r.up);$result='sent'} else {break}; [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress)) }
`
const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
let output = '', errors = '', ready = false
const replies = []
child.stdout.on('data', data => { output += data; for (let i; (i = output.indexOf('\n')) >= 0;) { const line = output.slice(0, i).trim(); output = output.slice(i + 1); if (line === 'ready') ready = true; else replies.push(JSON.parse(line)) } })
child.stderr.on('data', data => { errors += data })
async function command(request) { const count = replies.length; child.stdin.write(`${JSON.stringify(request)}\n`); await expect.poll(() => { if(child.exitCode !== null) throw new Error(errors); return replies.length }, { timeout: 5000 }).toBe(count + 1); return replies[count] }
const overlays = () => app.windows().filter(p => p.url().includes('#touch-session='))
try {
  await expect.poll(() => { if(child.exitCode !== null) throw new Error(errors); return ready }, { timeout: 15000 }).toBe(true)
  await expect.poll(() => app.evaluate(() => globalThis.touchReady)).toBe(true)
  await app.evaluate(async (_electron, pid) => { await globalThis.initializeTouch(pid); globalThis.touchPanels.sync([globalThis.touchSession]) }, child.pid)
  assert.equal(overlays().length, 0, 'Wait for a display ID before automatic launch')
  for (const patch of [{ touchControls: false }, { input: { control: true, keyboard: 'uhid', mouse: 'sdk', gamepad: false } }, { stopping: true }]) {
    await app.evaluate((_electron, patch) => globalThis.touchPanels.sync([{ ...globalThis.touchSession, virtualDisplayId: 5, ...patch }]), patch)
    assert.equal(overlays().length, 0)
  }
  await app.evaluate(() => { globalThis.touchSession.virtualDisplayId = 5; globalThis.touchPanels.sync([globalThis.touchSession]) })
  await expect.poll(() => overlays().length).toBe(1)
  const page = overlays()[0]
  // Playwright otherwise emulates document focus even for background pages.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false })
  await expect(page.locator('.touch-root')).toHaveClass(/mode-play/, { timeout: 20000 })
  const handle = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#touch-session=')); w.show(); w.focus(); return w.getNativeWindowHandle().readBigUInt64LE().toString(16) })
  const otherHandle = await app.evaluate(() => { globalThis.otherWindow.setAlwaysOnTop(true); return globalThis.otherWindow.getNativeWindowHandle().readBigUInt64LE().toString(16) })
  await command({ action: 'focus' })
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  await expect(page.getByText('Game controls active', { exact: true })).toBeVisible()
  await page.keyboard.press('F10')
  await expect(page.locator('.touch-toolbar')).toHaveCount(0)
  await expect.poll(() => command({ action: 'hit', handle })).toBe(handle)
  await page.keyboard.down('KeyW')
  await expect.poll(() => app.evaluate(() => globalThis.touchFrames.at(-1)?.length)).toBe(1)
  for (let cycle = 0; cycle < 3; cycle++) {
    await app.evaluate(() => { globalThis.otherWindow.show(); globalThis.otherWindow.focus() })
    await command({ action: 'click', handle: otherHandle })
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false)
    await expect.poll(() => app.evaluate(() => globalThis.touchFrames.at(-1))).toEqual([])
    await page.keyboard.up('KeyW')
    await command({ action: 'focus' })
    await expect.poll(() => page.evaluate(() => document.hasFocus()), { timeout: 5000 }).toBe(true)
    await expect(page.locator('.touch-root')).toHaveClass(/mode-play/)
    await expect(page.locator('.touch-toolbar')).toHaveCount(0)
    assert.deepEqual(await app.evaluate(() => globalThis.touchFrames.at(-1)), [], 'Do not replay the held key')
    await page.keyboard.down('KeyW')
    await expect.poll(() => app.evaluate(() => globalThis.touchFrames.at(-1)?.length)).toBe(1)
  }
  await page.keyboard.up('KeyW')
  await command({ action: 'key', handle, key: 0x79, up: false }); await command({ action: 'key', handle, key: 0x79, up: true })
  await expect(page.getByText('Game controls active', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape'); await expect(page.getByText('Typing · PC layout', { exact: true })).toBeVisible()
  await command({ action: 'click', handle: otherHandle }); await command({ action: 'focus' })
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  await expect(page.getByText('Typing · PC layout', { exact: true })).toBeVisible()
  await page.keyboard.press('F8'); await page.getByLabel('New from template').selectOption('shooter')
  await page.getByRole('button', { name: 'Game controls: Off', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true)
  await app.evaluate(() => globalThis.otherWindow.focus())
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false)
  await command({ action: 'focus' }); await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true)
  await expect(page.locator('.touch-root')).toHaveClass(/mode-play/)
  await page.locator('.touch-stage').click({ position: { x: 200, y: 200 } })
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Close window controls', exact: true }).click()
  await expect.poll(() => overlays().length).toBe(0)
  await app.evaluate(() => globalThis.touchPanels.sync([globalThis.touchSession]))
  assert.equal(overlays().length, 0, 'Explicit close must not auto-reopen the overlay')
  await app.evaluate(() => globalThis.touchPanels.open(globalThis.touchSession.id))
  await expect.poll(() => overlays().length).toBe(1)
  const reopened = overlays()[0]
  await expect(reopened.locator('.touch-root')).toHaveClass(/mode-menu/, { timeout: 20000 })
  assert.equal(await reopened.evaluate(() => !!document.pointerLockElement), false, 'Reopening must not capture the mouse without a click')
  await reopened.keyboard.press('F8')
  await reopened.getByLabel('New from template').selectOption('racing')
  await reopened.getByRole('button', { name: 'Game controls: Off', exact: true }).click()
  await reopened.getByRole('button', { name: 'Close window controls', exact: true }).click()
  await expect.poll(() => overlays().length).toBe(0)
  await app.evaluate(() => globalThis.touchPanels.open(globalThis.touchSession.id))
  await expect.poll(() => overlays().length).toBe(1)
  await expect(overlays()[0].locator('.touch-root')).toHaveClass(/mode-play/, { timeout: 20000 })
  await overlays()[0].getByRole('button', { name: 'Close window controls', exact: true }).click()
  await expect.poll(() => overlays().length).toBe(0)
  await writeFile(path.join(profile, 'result.json'), JSON.stringify({ passed: true, autoStart: true, savedLayout: true, manualReopenStartsPlay: true, hiddenHitTest: true, focusCycles: 3, heldKeysReleased: true, explicitMenuPreserved: true, lookRecapture: true, closedStaysClosed: true }, null, 2))
  console.log(`PASS: automatic and manually reopened saved layout, hidden overlay native hit-test, 3 native focus cycles, keys released and Play resumed, explicit Menu retained, click to recapture, explicit close retained. ${profile}`)
} finally { child.kill(); await app.close() }
