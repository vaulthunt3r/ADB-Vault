import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { run, checked } from '../dist-electron/process.js'
import { actionOutput } from '../dist-electron/app-actions.js'
import { runPackageAction } from '../dist-electron/package-actions.js'
// The previously user-approved Mi Video/profile 0 only. No data clearing in this validation.
assert.ok(process.argv.includes('--approved-mi-video-user-0'), 'Explicit hardware-test opt-in required')
const serial = 'adb-qkwcvcbaj7p7pbyx-OH7cRr._adb-tls-connect._tcp'
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe'), folder = 'desktop-test-results/package-methods-production'
await mkdir(folder, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-'), report = { started: new Date().toISOString(), cases: [], commands: [] }
const remote = '/data/local/tmp/adb-vault-package-methods-validation.jar'
const save = () => writeFile(path.join(folder, `${stamp}.json`), JSON.stringify(report, null, 2))
async function command(args, timeout = 20000) {
  args = args.map(a => a.replaceAll('/data/local/tmp/android-manager/manager-server.jar', remote))
  const result = await run(adb, ['-s', serial, ...args], timeout)
  report.commands.push({ args, ...result }); await save()
  checked(result)
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
  return args.some(a => a.includes('dev.adbvault.helper.PackageActions ')) ? output : actionOutput(output)
}
const shell = (script, timeout) => command(['shell', '-T', script], timeout)
async function identity() {
  assert.equal((await shell('getprop ro.build.version.incremental')).trim(), 'OS3.0.303.0.WOGRUXM')
  assert.equal((await shell('id -u')).trim(), '2000')
}
async function inspect(userId = 0) {
  const output = await shell(`CLASSPATH=${remote} app_process / dev.adbvault.helper.PackageActions inspect com.miui.videoplayer ${userId} 0 0 false`)
  return JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')))
}
await identity()
await command(['push', path.resolve('android-helper/dist/manager-server.jar'), remote], 30000)
const original = await inspect(), other = await inspect(11)
assert.equal(original.outcome, 'confirmed'); assert.equal(original.state.installed, true)
assert.equal(original.context.cachePermission, 'denied', 'Unexpected cache permission; do not actually clear anything')
const app = { packageName: 'com.miui.videoplayer', userId: 0, ...original.state }
report.before = original; report.otherProfileBefore = other
try {
  for (const method of ['shell', 'api']) {
    for (const action of ['disable', 'clear-cache', 'uninstall']) {
      await identity()
      const row = { method, action, keepData: action === 'uninstall' }
      try {
        row.message = await runPackageAction(app, action, { method, ...(action === 'uninstall' ? { keepData: true } : {}) }, { directory: 'android-helper/dist', observe: (...evidence) => { row.evidence = evidence } }, command, shell)
        row.outcome = 'confirmed'
      } catch (error) { row.message = error.message; row.outcome = error.outcome || 'error' }
      row.after = await inspect(); report.cases.push(row); await save()
      if (action === 'uninstall') {
        assert.equal(row.outcome, 'confirmed'); assert.equal(row.after.state.installed, false)
        await identity(); await shell('cmd package install-existing --user 0 com.miui.videoplayer')
        const restored = await inspect(); assert.equal(restored.state.installed, true); assert.equal(restored.state.versionCode, original.state.versionCode)
      } else { assert.equal(row.outcome, 'denied'); assert.equal(row.after.state.enabled, original.state.enabled) }
      assert.deepEqual((await inspect(11)).state, other.state)
    }
  }
} finally {
  await identity()
  if (!(await inspect()).state.installed) await shell('cmd package install-existing --user 0 com.miui.videoplayer')
  report.after = await inspect(); report.otherProfileAfter = await inspect(11); await save()
  assert.deepEqual(report.after.state, original.state)
  await shell(`rm -f ${remote} ${remote}.actions-new`)
}
console.log(JSON.stringify({ report: path.join(folder, `${stamp}.json`), cases: report.cases.map(({ method, action, outcome }) => ({ method, action, outcome })) }, null, 2))
