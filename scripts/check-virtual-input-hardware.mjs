// Bounded, windowless check: creates an owned virtual Settings display and reads input-device metadata.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { DeviceScreenService } from '../dist-electron/device-screen.js'
import { screenLaunch } from '../dist-electron/screen-protocol.js'
import { parseDevices } from '../dist-electron/connections.js'
import { run, checked, powershell } from '../dist-electron/process.js'

const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(saved.paths.adb, 'adb.exe'), scrcpy = path.join(saved.paths.scrcpy, 'scrcpy.exe')
async function checkPhone() {
const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
assert.equal(devices.length, 1, 'Connect exactly one phone for this check.')
const device = devices[0], shell = async args => checked(await run(adb, ['-t', device.transportId, 'shell', ...args], 15000))
const root = await mkdtemp(path.resolve('desktop-test-results/virtual-input-'))
const capture = path.join(root, 'test.mkv')
const userId = Number((await shell(['am', 'get-current-user'])).trim())
const connection = { devices, activeDeviceId: device.id, scanning: false, busy: false, error: null, message: '', qr: null, adbAvailable: true }
let output = '', child, complete
const events = []
const service = new DeviceScreenService(() => adb, () => scrcpy, () => connection, e => { if (e.type !== 'screenSessions') events.push(e) }, async () => capture, run,
  (file, args, options) => {
    child = spawn(file, [...args, '--no-window'], options)
    child.stdout.on('data', c => { output += c }); child.stderr.on('data', c => { output += c })
    complete = new Promise(resolve => child.once('close', code => resolve(code)))
    return child
  })
let report
try {
  await service.execute(device, 'open', { ...screenLaunch(), mode: 'virtual', virtualSize: '800x600', maxFps: 30, audio: 'off', clipboard: false, keyboard: 'uhid', mouse: 'uhid', gamepad: true, record: true, timeLimit: 12, application: { packageName: 'com.android.settings', userId } })
  let input = '', blocks = [], keyboardDetected = false, mouseDetected = false
  for (let attempt = 0; attempt < 10; attempt++) {
    input = await shell(['dumpsys', 'input'])
    const lines = input.split(/\r?\n/)
    blocks = []
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*Device \d+: scrcpy\s*$/.test(lines[i])) continue
      const indentation = lines[i].search(/\S/), block = [lines[i]]
      for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].search(/\S/) > indentation); j++) block.push(lines[j])
      blocks.push(block.join('\n'))
    }
    const sources = blocks.map(block => Number.parseInt(/Sources:\s*0x([a-f\d]+)/i.exec(block)?.[1] || '0', 16))
    keyboardDetected = blocks.some(block => /^\s*Sources:.*\bKEYBOARD\b/m.test(block)) || sources.some(source => (source & 0x101) === 0x101)
    mouseDetected = blocks.some(block => /^\s*Sources:.*\bMOUSE\b/m.test(block)) || sources.some(source => (source & 0x2002) === 0x2002)
    if (keyboardDetected && mouseDetected) break
    if (child.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  const inputMetadata = input.split(/\r?\n/).filter(line => /scrcpy|uniqueId.*virtual|port=.*displayUniqueId/i.test(line)).map(line => line.trim())
  const code = await Promise.race([complete, new Promise((_, reject) => setTimeout(() => reject(new Error('scrcpy time limit did not close the test session.')), 20000))])
  report = { userId, keyboardDetected, mouseDetected, exitCode: code, inputMetadata, devices: blocks, output, events }
  await writeFile('desktop-test-results/virtual-input-hardware.json', JSON.stringify(report, null, 2))
  assert.equal(code, 0, output)
  assert.ok(report.keyboardDetected && report.mouseDetected, output + '\n' + inputMetadata.join('\n'))
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (child && child.exitCode === null) { child.kill(); await complete }
  await service.shutdown()
  // A video sink is required by scrcpy for a windowless virtual display; discard this test capture.
  await rm(capture, { force: true })
}
return report
}

const report = process.argv.includes('--verify-saved') ? JSON.parse(await readFile('desktop-test-results/virtual-input-hardware.json', 'utf8')) : await checkPhone()
// Android 16 spells out source names; recheck existing captured evidence without opening another display.
report.keyboardDetected = report.keyboardDetected || report.devices.some(block => /^\s*Sources:.*\bKEYBOARD\b/m.test(block))
report.mouseDetected = report.mouseDetected || report.devices.some(block => /^\s*Sources:.*\bMOUSE\b/m.test(block))
assert.ok(report.keyboardDetected && report.mouseDetected)
assert.equal(report.exitCode, 0)
assert.ok(report.devices.some(block => /AssociatedDisplayUniqueIdByPort:\s*virtual:/.test(block)))

// SDL reads physical PC controller availability; no synthetic buttons or global input.
const controllers = await powershell(`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class VaultInputSDL {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] public static extern bool SetDllDirectory(string path);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] [return: MarshalAs(UnmanagedType.I1)] public static extern bool SDL_Init(uint flags);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] public static extern IntPtr SDL_GetGamepads(out int count);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_free(IntPtr value);
 [DllImport("SDL3.dll",CallingConvention=CallingConvention.Cdecl)] public static extern void SDL_Quit();
}
'@
[void][VaultInputSDL]::SetDllDirectory('${path.dirname(scrcpy).replaceAll("'", "''")}')
if (![VaultInputSDL]::SDL_Init(8192)) { throw 'Could not query SDL controllers.' }
try { $count=0; $list=[VaultInputSDL]::SDL_GetGamepads([ref]$count); [VaultInputSDL]::SDL_free($list); Write-Output $count } finally { [VaultInputSDL]::SDL_Quit() }
`)
report.pcGamepads = Number(controllers.trim())
await writeFile('desktop-test-results/virtual-input-hardware.json', JSON.stringify(report, null, 2))
console.log(`SDL PC gamepads detected: ${report.pcGamepads}`)
console.log('PASS: Android registered keyboard and mouse on the owned virtual display; the session closed normally.')
