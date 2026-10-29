// Opt-in hardware check on the one connected phone. No desktop input or windows.
// Uses an owned virtual display, appends/removes only our test text, and restores
// the Android text clipboard. No clipboard or existing field content is logged.
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { DeviceScreenService } from '../dist-electron/device-screen.js'
import { TouchStream } from '../dist-electron/touch-stream.js'
import { parseDevices } from '../dist-electron/connections.js'
import { screenLaunch } from '../dist-electron/screen-protocol.js'
import { checked, run } from '../dist-electron/process.js'
const delay = ms => new Promise(r => setTimeout(r, ms))
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(saved.paths.adb, 'adb.exe'), scrcpy = path.join(saved.paths.scrcpy, 'scrcpy.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
assert.equal(devices.length, 1, 'Exactly one connected phone is required.')
const device = devices[0], selector = ['-t', device.transportId]
const userId = Number(checked(await run(adb, [...selector, 'shell', 'am', 'get-current-user'])).trim())
let child, stream, initialClipboard, captureError = '', changedClipboard = false, output = ''
const service = new DeviceScreenService(() => adb, () => scrcpy, () => ({ devices, activeDeviceId: device.id, busy: false }), () => {}, async () => path.resolve(`desktop-test-results/window-typing-${Date.now()}.mkv`), run,
  (file, args, options) => { child = spawn(file, [...args, '--no-window'], options); child.stdout.on('data', c => output = (output + c).slice(-3000)); child.stderr.on('data', c => output = (output + c).slice(-3000)); return child })
const clipboard = async (operation, text) => {
  const result = checked(await run(adb, [...selector, 'shell', '-T', `CLASSPATH=${stream.remote} app_process / dev.adbvault.helper.PhoneTools clipboard-${operation} ${userId}`], 15000, text === undefined ? undefined : JSON.stringify({ text })))
  const messages = result.split(/\r?\n/).filter(l => l.startsWith('{')).map(l => JSON.parse(l))
  if (messages.some(m => m.type === 'error')) throw new Error('Clipboard test setup failed.')
  return messages.find(m => m.type === 'clipboard')?.text
}
try {
  await service.execute(device, 'open', { ...screenLaunch(), mode: 'virtual', virtualSize: '1200x800', maxFps: 15, audio: 'off', clipboard: false, record: true, timeLimit: 20, application: { packageName: 'dev.davidv.translator', userId } })
  for (let i=0; i<150 && !service.state[0]?.virtualDisplayId; i++) { assert.equal(child.exitCode, null, output); await delay(100) }
  const session = service.state[0]; assert.ok(session?.virtualDisplayId)
  // Repeated tests must not reuse a task left on another Android display.
  checked(await run(adb, [...selector, 'shell', 'am', 'start', '--display', String(session.virtualDisplayId), '-f', '0x18000000', '-n', 'dev.davidv.translator/.MainActivity'], 15000))
  stream = new TouchStream(path.resolve('android-helper/dist'), () => service.touchTarget(session.id), (_geometry, error) => { if (error) captureError = error })
  await stream.start()
  for (let i=0; i<150 && !stream.geometry && !captureError; i++) await delay(100)
  assert.ok(stream.geometry, captureError)
  initialClipboard = await clipboard('read'); assert.equal(typeof initialClipboard, 'string')
  let focused = false
  for (let attempt=0; attempt<30; attempt++) {
    const status = checked(await run(adb, [...selector, 'shell', 'dumpsys', 'input'], 10000))
    focused = !!status.split('FocusedWindows:')[1]?.split('\n').slice(0, 8).some(line => line.includes(`displayId=${session.virtualDisplayId}, name=`) && line.includes('dev.davidv.translator'))
    if (focused) break
    await delay(200)
  }
  assert.ok(focused, 'Translator has no focused window on the test display.')
  await delay(1200)
  checked(await run(adb, [...selector, 'shell', 'input', '-d', String(session.virtualDisplayId), 'tap', '150', '165'], 10000))
  await delay(700)
  const input = value => { if (captureError) throw new Error(captureError); return stream.input(stream.geometry.epoch, value) }
  await input({ type: 'key', key: 'End', control: true })
  const sample = ' Проверка ABC 123'
  changedClipboard = true
  for (const text of sample) await input({ type: 'text', text })
  await clipboard('write', 'ADB Vault copy verification')
  await input({ type: 'key', key: 'SelectAll' }); await delay(80)
  const copied = await input({ type: 'key', key: 'Copy' })
  const copiedText = copied ?? await clipboard('read')
  assert.ok(typeof copiedText === 'string' && copiedText.endsWith(sample), `The Android text field did not return the expected Unicode suffix (copy acknowledged: ${copied !== undefined}; clipboard changed: ${copiedText !== 'ADB Vault copy verification'}).`)
  await input({ type: 'key', key: 'End', control: true })
  for (const _char of sample) await input({ type: 'key', key: 'Backspace' })
  await input({ type: 'key', key: 'SelectAll' }); await delay(80)
  await input({ type: 'key', key: 'Copy' })
  await input({ type: 'key', key: 'End', control: true })
  await writeFile('desktop-test-results/window-typing-phone-result.json', JSON.stringify({ passed: true, displayId: session.virtualDisplayId, unicode: true, perCharacter: true, mixedText: true, copy: true, backspace: true, desktopInputUsed: false }, null, 2))
  console.log('PASS: actual Android Translator accepted Cyrillic/Latin text; selection, copy and Backspace worked. No desktop input used.')
} finally {
  if (changedClipboard && initialClipboard !== undefined && stream) await clipboard('write', initialClipboard).catch(() => console.error('Could not restore the Android text clipboard.'))
  stream?.close()
  if (child?.exitCode === null) await new Promise(resolve => child.once('close', resolve))
  await service.shutdown()
}
