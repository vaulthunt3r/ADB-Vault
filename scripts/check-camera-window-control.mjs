// Integration check against the installed SDL library, without a phone or global input.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { WindowsCameraControls } from '../dist-electron/camera-window-control.js'
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const folder = /\.exe$/i.test(saved.paths.scrcpy) ? path.dirname(saved.paths.scrcpy) : saved.paths.scrcpy
const title = 'ADB Vault — Camera control test'
const script = `
$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new()
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TestSDL {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool SDL_Init(uint flags);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_CreateWindow([MarshalAs(UnmanagedType.LPUTF8Str)] string title,int w,int h,ulong flags);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool SDL_PollEvent(IntPtr value);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_DestroyWindow(IntPtr window);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_Quit();
}
'@
[void][TestSDL]::SetDllDirectory($env:VAULT_SDL_TEST)
if(![TestSDL]::SDL_Init(32)){throw 'SDL initialization failed'}
$window=[TestSDL]::SDL_CreateWindow('ADB Vault — Camera control test',320,180,8)
$other=[TestSDL]::SDL_CreateWindow('ADB Vault — Other pin test',320,180,8)
if($window -eq [IntPtr]::Zero){throw 'SDL window failed'}
$event=[Runtime.InteropServices.Marshal]::AllocHGlobal(128)
try {
 [Console]::Out.WriteLine('ready')
 $until=[DateTime]::UtcNow.AddSeconds(20)
 while([DateTime]::UtcNow -lt $until) {
  while([TestSDL]::SDL_PollEvent($event)) {
   $kind=[Runtime.InteropServices.Marshal]::ReadInt32($event,0)
   if($kind -eq 768){[Console]::Out.WriteLine(('{"key":'+[Runtime.InteropServices.Marshal]::ReadInt32($event,28)+',"mod":'+[Runtime.InteropServices.Marshal]::ReadInt16($event,32)+'}'))}
  }
  Start-Sleep -Milliseconds 5
 }
} finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($event); [TestSDL]::SDL_DestroyWindow($window); [TestSDL]::SDL_Quit() }
`
const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, VAULT_SDL_TEST: folder }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', stderr = ''
child.stdout.on('data', data => { output += String(data) }); child.stderr.on('data', data => { stderr += String(data) })
const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; if (child.exitCode !== null) throw new Error(stderr || output); await new Promise(r => setTimeout(r, 50)) } throw new Error('Timed out: ' + output + stderr) }
const controls = new WindowsCameraControls()
try {
 await waitFor(() => output.includes('ready'))
 assert.equal(await controls.inspect(child.pid, title + ' wrong'), null)
 const bounds = await controls.inspect(child.pid, title)
 assert.ok(bounds.width >= 320 && bounds.height >= 180)
 assert.equal(bounds.visible, false)
 assert.equal(bounds.foreground, false)
 assert.equal(bounds.alwaysOnTop, false)
 await assert.rejects(controls.setAlwaysOnTop(child.pid, title + ' wrong', true), /not ready|closed/)
 await assert.rejects(controls.setAlwaysOnTop(child.pid, title, 'true'), /Invalid/)
 for (const enabled of [true, false, true, false]) {
   await controls.setAlwaysOnTop(child.pid, title, enabled)
   const state = await controls.inspect(child.pid, title)
   assert.deepEqual(state, { ...bounds, alwaysOnTop: enabled })
   assert.equal((await controls.inspect(child.pid, 'ADB Vault — Other pin test')).alwaysOnTop, false)
 }
 await assert.rejects(controls.send(child.pid, title + ' wrong', 'zoom-in'), /not ready|closed/)
 for (const command of ['zoom-in', 'zoom-out', 'torch-on', 'torch-off', 'rotate-left', 'rotate-right']) await Promise.all([controls.inspect(child.pid, title), controls.send(child.pid, title, command)])
 await waitFor(() => output.split('\n').filter(line => line.startsWith('{')).length >= 13)
 const keys = output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
 for (const key of [1073741906, 1073741905, 1073741904, 1073741903]) assert.ok(keys.some(e => e.key === key && (e.mod & 0x100)), JSON.stringify(keys))
 assert.ok(keys.some(e => e.key === 116 && (e.mod & 0x100) && !(e.mod & 3)), JSON.stringify(keys))
 assert.ok(keys.some(e => e.key === 116 && (e.mod & 0x100) && (e.mod & 3)), JSON.stringify(keys))
 console.log('PASS: live pin/unpin changes the exact SDL window, preserves bounds/visibility/focus and leaves another SDL window unchanged; all six camera shortcuts still work. No phone operation.')
} finally { controls.shutdown(); child.kill() }
