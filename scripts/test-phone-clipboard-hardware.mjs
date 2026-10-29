// Explicit opt-in, bound to one serial. Checks permission/attribution only; no clipboard content is read or written.
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { run, checked } from '../dist-electron/process.js'
import { parseDevices } from '../dist-electron/connections.js'
const serial = process.argv.find(arg => arg.startsWith('--serial='))?.slice(9)
assert.ok(serial, 'Pass --serial=<connected phone serial> explicitly.')
const profile = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(profile.paths.adb, 'adb.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'])))
const device = devices.find(item => item.serial === serial && item.status === 'connected')
assert.ok(device?.transportId, 'The requested phone is not connected with an identified transport.')
const selector = ['-t', device.transportId]
const currentUser = checked(await run(adb, [...selector, 'shell', 'am', 'get-current-user'])).trim()
assert.match(currentUser, /^\d{1,5}$/)
const tools = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8'))
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/clipboard-context-'))
await mkdir(path.join(root, 'classes')); await mkdir(path.join(root, 'dex'))
checked(await run(tools.javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', tools.android, '-cp', 'android-helper/build/classes.jar', '-d', path.join(root, 'classes'), 'android-helper/tests/dev/adbvault/helper/PhoneClipboardProbe.java'], 30000))
checked(await run(tools.jar, ['cf', path.join(root, 'probe-classes.jar'), '-C', path.join(root, 'classes'), '.'], 30000))
checked(await run(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', tools.android, '--output', path.join(root, 'dex/probe.jar'), 'android-helper/build/classes.jar', path.join(root, 'probe-classes.jar')], 30000))
const local = path.join(root, 'dex/probe.jar'), remote = `/data/local/tmp/adb-vault-clipboard-probe-${randomUUID()}.jar`
try {
  checked(await run(adb, [...selector, 'push', local, remote], 30000))
  const expected = createHash('sha256').update(await readFile(local)).digest('hex')
  assert.equal(checked(await run(adb, [...selector, 'shell', 'sha256sum', remote])).split(/\s+/)[0], expected)
  const result = checked(await run(adb, [...selector, 'shell', '-T', `CLASSPATH=${remote} app_process / dev.adbvault.helper.PhoneClipboardProbe ${currentUser}`], 30000))
  const report = JSON.parse(result.split(/\r?\n/).find(line => line.startsWith('{')))
  assert.equal(report.after, 'allowed'); assert.equal(report.clipboardContentChanged, false)
  await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2)); console.log(root)
} finally {
  checked(await run(adb, [...selector, 'shell', 'rm', '-f', remote]))
}
