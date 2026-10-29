// Build a device-only icon probe separately; never include it in production resources.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { run, checked } from '../dist-electron/process.js'
const tools = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8'))
await mkdir('android-helper/build/probe-classes', { recursive: true })
const cmd = async (exe, args) => checked(await run(exe, args, 60000))
await cmd(tools.javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', tools.android, '-classpath', 'android-helper/build/classes', '-d', 'android-helper/build/probe-classes', 'android-helper/tests/dev/adbvault/helper/IconProbe.java'])
await cmd(tools.jar, ['cf', 'android-helper/build/probe-classes.jar', '-C', 'android-helper/build/probe-classes', '.'])
await cmd(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', tools.android, '--classpath', 'android-helper/build/classes.jar', '--output', 'android-helper/build/icon-probe.jar', 'android-helper/build/probe-classes.jar'])
const profile = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(profile.paths.adb, 'adb.exe')
const devices = (await cmd(adb, ['devices'])).split(/\r?\n/).filter(line => /\sdevice$/.test(line))
if (!devices.length) throw new Error('No connected device')
const serial = devices[0].split(/\s/)[0], prefix = ['-s', serial]
const userId = await cmd(adb, [...prefix, 'shell', 'am', 'get-current-user'])
if (!/^\d{1,5}$/.test(userId)) throw new Error('Invalid Android user')
const remote = '/data/local/tmp/android-manager/icon-probe.jar'
try {
  await cmd(adb, [...prefix, 'push', 'android-helper/build/icon-probe.jar', remote])
  await cmd(adb, [...prefix, 'shell', 'chmod', '444', remote])
  const output = await cmd(adb, [...prefix, 'shell', `CLASSPATH=/data/local/tmp/android-manager/manager-server.jar:${remote} app_process / dev.adbvault.helper.IconProbe ${userId}`])
  const result = JSON.parse(output)
  await writeFile('desktop-test-results/apps/icon-probe.json', JSON.stringify(result, null, 2)); console.log(output)
} finally { await cmd(adb, [...prefix, 'shell', 'rm', '-f', remote]) }
