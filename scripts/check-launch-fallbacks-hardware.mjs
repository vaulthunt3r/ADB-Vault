// Opens only these three landing screens in the current profile; never runs services or switches users.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchApplication } from '../dist-electron/app-launch.js'
import { actionOutput } from '../dist-electron/app-actions.js'
import { parseDevices } from '../dist-electron/connections.js'
import { checked, run } from '../dist-electron/process.js'

const settings = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(settings.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l']))).filter(d => d.status === 'connected')
assert.equal(devices.length, 1, 'Connect exactly one phone.')
const device = devices[0]
const rawShell = async (args, timeout = 30000) => checked(await run(adb, ['-t', device.transportId, 'shell', ...args], timeout))
const userId = Number((await rawShell(['am', 'get-current-user'])).trim())
assert.equal(userId, 0, 'This fixture checks the owner profile; it never switches profiles.')
const results = []
for (const packageName of ['com.google.android.healthconnect.controller', 'com.miui.screenrecorder', 'com.miui.misound', 'com.android.bluetooth', 'com.xiaomi.mi_connect_service']) {
  const calls = [], result = { packageName }
  try {
    result.component = await launchApplication(packageName, userId, async (args, timeout) => {
      assert.equal(Number((await rawShell(['am', 'get-current-user'])).trim()), userId, 'Profile changed during the check.')
      calls.push(args)
      return actionOutput(await rawShell(args, timeout))
    })
    result.confirmed = true
  } catch (error) { result.confirmed = false; result.reason = error.message }
  result.startAttempts = calls.filter(args => args[0] === 'am').length
  assert.ok(calls.every(args => args[args.indexOf('--user') + 1] === String(userId)))
  results.push(result)
  console.log(JSON.stringify(result))
}
await writeFile('desktop-test-results/launch-fallbacks-hardware.json', JSON.stringify({ checkedAt: new Date().toISOString(), userId, results }, null, 2))
assert.ok(results.slice(0, 3).every(r => r.confirmed), 'A landing screen did not launch; inspect the saved result.')
assert.ok(results.slice(3).every(r => !r.confirmed && r.startAttempts === 0 && /No launchable screen/.test(r.reason)))
