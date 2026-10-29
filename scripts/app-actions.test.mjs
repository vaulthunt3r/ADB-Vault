import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { AppActionsService, parseApkPaths, actionOutput } from '../dist-electron/app-actions.js'
import { ApkTransferSession } from '../dist-electron/apk-transfer.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'

const apk = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('test APK content')])
const digest = createHash('sha256').update(apk).digest('hex')
const target = { id: 'PHONE', userId: 11, packageName: 'org.example.app' }
const ok = stdout => ({ code: 0, stderr: '', stdout })
const shellTokens = command => command.slice(1, -1).split("' '")

test('restore-existing confirms target, skips installed-path lookup, verifies identity and refreshes once', async () => {
  const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
  for (const mode of ['success', 'cancel', 'missing', 'changed', 'denied', 'lost-reply', 'unverified', 'timeout-unchanged', 'switch']) {
    let reads = 0, mutations = 0
    const f = fixture({ accept: mode !== 'cancel', packageAccess: { directory: 'android-helper/dist' }, runner: async args => {
      const command = args.at(-1)
      if (command.includes('sha256sum')) return ok(manifest.sha256 + ' file')
      if (command.includes('helper.PackageActions')) {
        reads++
        if (reads > 1 && mode === 'unverified') throw new Error('connection lost')
        if (mode === 'switch') f.connection.activeDeviceId = 'OTHER'
        return ok(JSON.stringify({ protocol: 1, action: 'inspect-restore', packageName: target.packageName, userId: 11, context: { fingerprint: 'test-build', sdk: 36, callerUid: 2000, cachePermission: 'denied' }, state: { installed: reads > 1 && !['denied', 'timeout-unchanged'].includes(mode), apkAvailable: mode !== 'missing', uid: 1110001, versionCode: mode === 'changed' ? 43 : 42 }, outcome: 'confirmed' }))
      }
      if (command.includes("'install-existing'")) {
        mutations++; assert.equal(command, "'pm' 'install-existing' '--user' '11' 'org.example.app'")
        if (['lost-reply', 'timeout-unchanged'].includes(mode)) throw new Error('connection timed out')
        return ok(mode === 'denied' ? 'java.lang.SecurityException: Permission denied' : 'Package installed for user: 11')
      }
      throw Error('Unexpected command ' + command)
    } })
    f.apps.removedApps = [{ ...f.apps.apps[0], installed: false, versionCode: 42, actionContext: { fingerprint: 'test-build' } }]; f.apps.apps = []
    await f.service.execute(target, 'install-existing')
    assert.equal(f.confirmations[0][0], 'install-existing')
    assert.equal(mutations, ['cancel', 'missing', 'changed', 'switch'].includes(mode) ? 0 : 1, mode)
    assert.equal(f.service.state.status, mode === 'cancel' ? 'cancelled' : ['success', 'lost-reply'].includes(mode) ? 'success' : 'error', mode)
    if (['unverified', 'timeout-unchanged'].includes(mode)) assert.equal(f.service.state.uncertain, true)
    if (mode === 'denied') assert.match(f.service.state.message, /Permission denied/)
    if (mutations) assert.equal(f.refreshed(), 1)
    assert.equal(f.calls.some(args => /'path'|'enable'|'disable-user'|'uninstall'|'clear'|su -c/.test(args.at(-1))), false)
  }
})

test('production action adapter parses an API denial as a reason, not a raw JSON error', async () => {
  const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
  const observations = []
  const f = fixture({ packageAccess: { directory: 'android-helper/dist', observe: (...args) => observations.push(args) }, runner: async args => {
    const command = args.at(-1)
    if (command.includes('sha256sum')) return ok(manifest.sha256 + ' file')
    if (command.includes('helper.PackageActions')) {
      const action = command.match(/PackageActions '([^']+)'/)[1]
      return ok(JSON.stringify({ protocol: 1, action, packageName: target.packageName, userId: 11, context: { fingerprint: 'test-build', sdk: 36, callerUid: 2000, cachePermission: 'denied' }, state: { installed: true, enabled: true, uid: 1110001, versionCode: 42 }, outcome: action === 'inspect' ? 'confirmed' : 'denied', ...(action === 'inspect' ? {} : { message: 'java.lang.SecurityException: Cannot disable system packages.' }) }))
    }
  } })
  f.apps.apps[0].versionCode = 42
  await f.service.execute(target, 'disable', undefined, false, { method: 'api' })
  assert.equal(f.service.state.status, 'error'); assert.equal(f.service.state.uncertain, false)
  assert.match(f.service.state.message, /^java.lang.SecurityException: Cannot disable system packages\./)
  assert.equal(f.service.state.message.includes('"protocol"'), false)
  assert.equal(observations[0][4], 'denied')
  assert.equal(f.calls.filter(args => args.at(-1).includes("PackageActions 'disable'")).length, 1)
})
test('scanner preparation keeps every verified APK with identifiable names, including reordered base', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-scan-'))
  const f = fixture({ folder, paths: ['/data/app/example/split_config.apk', '/data/app/example/base.apk'] })
  await f.service.execute(target, 'export', undefined, true)
  assert.equal(f.service.state.status, 'success')
  const manifest = JSON.parse(await readFile(path.join(f.service.state.exportPath, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.files.map(f => f.file), ['org.example.app.split-000.apk', 'org.example.app.apk'])
  assert.ok(manifest.files.every(f => f.sha256 === digest))
  assert.equal(f.calls.filter(c => c[2] === 'pull').length, 2)
  assert.equal(f.calls.some(c => /force-stop|clear|su -c/.test(c.join(' '))), false)
})
function fixture(options = {}) {
  const app = { packageName: target.packageName, label: 'Example', userId: 11, uid: 1110001, enabled: true, suspended: false, system: false }
  const apps = { ...emptyApps(), status: 'ready', deviceId: target.id, userId: 11, apps: [app], profiles: [{ id: 11, name: 'Unsafe' }] }
  const connection = { activeDeviceId: target.id, devices: [{ id: target.id, status: 'connected', name: 'Phone', serial: 'SERIAL', transportId: '7', method: options.method || 'USB' }] }
  const calls = [], confirmations = [], events = [], logs = []; let refreshed = 0
  const remote = options.paths || ['/data/app/example/base.apk', '/data/app/example/split_config.apk']
  const runner = async (file, args, timeout, input, env, controls) => {
    calls.push(args)
    assert.deepEqual(args.slice(0, 2), ['-t', '7'])
    if (options.runner) { const result = await options.runner(args, controls); if (result !== undefined) return result }
    if (args[2] === 'features') return ok(options.features ?? 'sendrecv_v2\nsendrecv_v2_zstd\n')
    if (args[2] === 'pull') { await writeFile(args.at(-1), options.corrupt ? Buffer.from('not an apk') : apk); return ok('1 file pulled') }
    const tokens = shellTokens(args[3])
    if (tokens[0] === 'sha256sum') return ok(`${digest}  ${tokens[1]}`)
    if (tokens[1] === 'path') return ok(remote.map(p => `package:${p}`).join('\n'))
    if (tokens[2] === 'resolve-activity') return ok(`${target.packageName}/.MainActivity`)
    if (tokens[2] === 'query-activities') return ok(tokens.includes('android.intent.category.LAUNCHER') ? `${target.packageName}/.MainActivity` : 'No activities found')
    if (tokens[0] === 'am') return ok(tokens[1] === 'start' ? 'Status: ok' : '')
    if (tokens[1] === 'uninstall') return ok('Success')
    if (['enable', 'disable-user'].includes(tokens[1])) return ok(`Package ${target.packageName} new state: ${tokens[1] === 'enable' ? 'enabled' : 'disabled-user'}`)
    throw new Error(`Unexpected command ${JSON.stringify(args)}`)
  }
  const service = new AppActionsService(() => 'adb.exe', () => connection, () => apps, state => events.push(state), (text, tone) => logs.push({ text, tone }), {
    confirm: async (...args) => { confirmations.push(args); return options.confirm ? options.confirm() : options.accept !== false },
    exportFolder: async () => options.folder ?? null,
  }, async () => { refreshed++; if (options.refreshFailure) throw new Error('read failed') }, runner, undefined, () => new ApkTransferSession(options.zstd === true), options.packageAccess)
  return { service, apps, connection, calls, confirmations, events, logs, refreshed: () => refreshed }
}

for (const action of ['suspend', 'unsuspend']) {
  const help = 'suspend [--user USER_ID] PACKAGE\nunsuspend [--user USER_ID] PACKAGE'
  test(`${action} uses the selected profile, verifies Android state and refreshes without changing enabled state`, async () => {
    const f = fixture({ runner: async args => {
      if (args.at(-1).includes("'help'")) return ok(help)
      if (args.at(-1).includes(`'${action}'`)) return ok(`Package ${target.packageName} new suspended state: ${action === 'suspend'}`)
    } })
    f.apps.apps[0].suspended = action === 'unsuspend'
    await f.service.execute(target, action)
    assert.equal(f.service.state.status, 'success'); assert.equal(f.service.state.uncertain, false)
    assert.equal(f.confirmations.length, action === 'suspend' ? 1 : 0)
    assert.deepEqual(shellTokens(f.calls.at(-1)[3]), ['pm', action, '--user', '11', target.packageName])
    assert.equal(f.refreshed(), 1)
    assert.equal(f.calls.some(args => /'enable'|'disable-user'|'clear'|'force-stop'|su -c/.test(args.at(-1))), false)
  })
  test(`${action} rejects unsupported firmware, policy refusal and unconfirmed output`, async () => {
    for (const scenario of ['unsupported', 'refused', 'missing', 'different-package', 'denied', 'transport']) {
      const f = fixture({ runner: async args => {
        const command = args.at(-1)
        if (command.includes("'help'")) return ok(scenario === 'unsupported' ? 'enable [--user USER_ID] PACKAGE' : help)
        if (command.includes(`'${action}'`)) {
          if (scenario === 'transport') throw Error('connection lost')
          return ok(scenario === 'refused' ? `Package ${target.packageName} new suspended state: ${action !== 'suspend'}` : scenario === 'different-package' ? `Package org.other new suspended state: ${action === 'suspend'}` : scenario === 'denied' ? 'SecurityException: permission denied' : '')
        }
      } })
      await f.service.execute(target, action)
      assert.equal(f.service.state.status, 'error', scenario)
      assert.equal(f.calls.some(args => args.at(-1).includes(`'${action}'`)), scenario !== 'unsupported', scenario)
      assert.equal(f.service.state.uncertain === true, ['missing', 'different-package', 'transport'].includes(scenario), scenario)
      assert.equal(f.refreshed(), scenario === 'unsupported' ? 0 : 1, scenario)
    }
  })
}
test('freezing cancels before device access and aborts when the profile changes during support detection', async () => {
  const cancelled = fixture({ accept: false }); await cancelled.service.execute(target, 'suspend')
  assert.equal(cancelled.calls.length, 0); assert.equal(cancelled.service.state.status, 'cancelled')
  let f
  f = fixture({ runner: async args => { if (args.at(-1).includes("'help'")) { f.apps.userId = 0; return ok('suspend [--user USER_ID] PACKAGE') } } })
  await f.service.execute(target, 'suspend')
  assert.equal(f.service.state.status, 'error')
  assert.equal(f.calls.some(args => args.at(-1).includes("'suspend'")), false)
})

test('launch resolves the exact package in the selected profile and pins the ADB transport', async () => {
  const f = fixture(); await f.service.execute(target, 'launch')
  assert.equal(f.service.state.status, 'success'); assert.equal(f.confirmations.length, 0)
  const commands = f.calls.filter(a => a[2] === 'shell').map(a => shellTokens(a[3]))
  assert.deepEqual(commands[0], ['pm', 'path', '--user', '11', target.packageName])
  assert.deepEqual(commands.at(-1), ['am', 'start', '-W', '--user', '11', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-f', '0x10200000', '-n', target.packageName + '/.MainActivity'])
  assert.equal(f.refreshed(), 1)
})
test('app settings use the exact package URI and explicit profile', async () => {
  const f = fixture(); await f.service.execute(target, 'settings')
  assert.deepEqual(shellTokens(f.calls.at(-1)[3]), ['am', 'start', '-W', '--user', '11', '-a', 'android.settings.APPLICATION_DETAILS_SETTINGS', '-d', `package:${target.packageName}`])
  assert.equal(f.service.state.status, 'success')
})

test('operation identity stays stable through progress and changes on the next action', async () => {
  const f = fixture(); await f.service.execute(target, 'launch')
  const first = f.service.state.operationId
  assert.ok(first); assert.ok(Number.isFinite(Date.parse(f.service.state.startedAt)))
  assert.ok(f.events.every(e => e.operationId === first))
  await f.service.execute(target, 'launch')
  assert.notEqual(f.service.state.operationId, first)
})

for (const [action, sdk, intent] of [
  ['notifications', 26, ['-a', 'android.settings.APP_NOTIFICATION_SETTINGS', '--es', 'android.provider.extra.APP_PACKAGE', target.packageName]],
  ['open-links', 31, ['-a', 'android.settings.APP_OPEN_BY_DEFAULT_SETTINGS', '-d', `package:${target.packageName}`]],
]) {
  const component = 'com.android.settings/.AppSettings'
  const runner = async args => args[3]?.includes("'getprop'") ? ok(String(sdk)) : args[3]?.includes("'resolve-activity'") ? ok(component) : undefined
  test(`${action} checks support and opens the exact profile without refreshing Apps`, async () => {
    const f = fixture({ runner }); await f.service.execute(target, action)
    const commands = f.calls.map(a => shellTokens(a[3]))
    assert.deepEqual(commands.at(-2), ['cmd', 'package', 'resolve-activity', '--brief', '--user', '11', ...intent])
    assert.deepEqual(commands.at(-1), ['am', 'start', '-W', '--user', '11', ...intent, '-n', component])
    assert.equal(f.service.state.status, 'success'); assert.equal(f.refreshed(), 0); assert.equal(f.confirmations.length, 0)
  })
  test(`${action} never starts an unavailable screen or bypasses Android errors`, async () => {
    for (const scenario of ['old', 'unknown', 'missing', 'denied']) {
      const f = fixture({ runner: async args => {
        if (args[3]?.includes("'getprop'")) return ok(scenario === 'old' ? String(sdk - 1) : scenario === 'unknown' ? '' : String(sdk))
        if (args[3]?.includes("'resolve-activity'")) return ok(scenario === 'missing' ? 'No activity found' : component)
        if (args[3]?.startsWith("'am'")) return ok('SecurityException: permission denied')
      } })
      await f.service.execute(target, action)
      assert.equal(f.service.state.status, 'error', scenario)
      assert.equal(f.refreshed(), 0)
      assert.equal(f.calls.some(a => a[3]?.startsWith("'am'")), scenario === 'denied')
    }
  })
  test(`${action} stops if the profile changes during support detection`, async () => {
    let f
    f = fixture({ runner: async args => {
      if (args[3]?.includes("'resolve-activity'")) f.apps.userId = 0
      return runner(args)
    } })
    await f.service.execute(target, action)
    assert.equal(f.service.state.status, 'error')
    assert.equal(f.calls.some(a => a[3]?.startsWith("'am'")), false)
  })
}
test('applications with no launcher are not launched through a fallback target', async () => {
  const f = fixture({ runner: async args => args[3]?.includes("'query-activities'") ? ok('No activities found') : undefined })
  await f.service.execute(target, 'launch')
  assert.equal(f.service.state.status, 'error'); assert.equal(f.calls.some(a => a[3]?.startsWith("'am'")), false)
})

test('launch stops if the selected profile changes while querying entry screens', async () => {
  let f
  f = fixture({ runner: async args => {
    if (args[3]?.includes("'query-activities'")) { f.apps.userId = 0; return ok(target.packageName + '/.Main') }
  } })
  await f.service.execute(target, 'launch')
  assert.equal(f.service.state.status, 'error')
  assert.equal(f.calls.some(args => args[3]?.startsWith("'am'")), false)
})
test('force stop, disable and uninstall require confirmation; cancel runs no commands', async () => {
  for (const action of ['force-stop', 'disable', 'uninstall']) {
    const f = fixture({ accept: false }); await f.service.execute(target, action)
    assert.equal(f.confirmations[0][1].userId, 11); assert.equal(f.confirmations[0][3], 'Unsafe')
    assert.equal(f.service.state.status, 'cancelled'); assert.deepEqual(f.calls, [])
  }
})
test('management targets one profile and refreshes only after confirmed success', async () => {
  for (const [action, tool, cmd] of [['force-stop', 'am', 'force-stop'], ['disable', 'pm', 'disable-user'], ['enable', 'pm', 'enable'], ['uninstall', 'pm', 'uninstall']]) {
    const f = fixture(); await f.service.execute(target, action)
    assert.equal(f.service.state.status, 'success')
    assert.deepEqual(shellTokens(f.calls.at(-1)[3]), [tool, cmd, '--user', '11', target.packageName])
    assert.equal(f.refreshed(), 1)
  }
})
test('a profile change while confirmation is open prevents execution', async () => {
  let f; f = fixture({ confirm: () => { f.apps.userId = 0; return true } })
  await f.service.execute(target, 'uninstall')
  assert.equal(f.service.state.status, 'error'); assert.deepEqual(f.calls, [])
})
test('a replacement transport while confirming prevents execution', async () => {
  let f; f = fixture({ confirm: () => { f.connection.devices[0].transportId = '8'; return true } })
  await f.service.execute(target, 'disable')
  assert.equal(f.service.state.status, 'error'); assert.deepEqual(f.calls, [])
})
test('malformed targets and unknown actions are rejected before ADB', async () => {
  const f = fixture()
  await assert.rejects(f.service.execute({ ...target, packageName: 'org.example;reboot' }, 'launch'))
  await assert.rejects(f.service.execute({ ...target, userId: -1 }, 'uninstall'))
  await assert.rejects(f.service.execute(target, 'erase-all'))
  assert.deepEqual(f.calls, [])
})
test('Android error text including stderr with exit code zero is not reported as success', async () => {
  const f = fixture({ runner: async args => args[3]?.startsWith("'am'") ? { code: 0, stdout: 'Starting: Intent', stderr: 'Error: Activity not started' } : undefined })
  await f.service.execute(target, 'settings')
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.message, /Activity not started/)
  assert.equal(f.refreshed(), 0)
  assert.throws(() => actionOutput('Failure [DELETE_FAILED_DEVICE_POLICY_MANAGER]'))
})
test('a successful action remains successful if automatic refresh fails', async () => {
  const f = fixture({ refreshFailure: true }); await f.service.execute(target, 'disable')
  assert.equal(f.service.state.status, 'success'); assert.match(f.service.state.message, /could not be refreshed/)
})

test('Disable retains Android denial reasons without suggesting a lost connection or trying root', async () => {
  for (const code of [0, 1]) {
    const reason = 'java.lang.SecurityException: Cannot disable a protected package: org.example.app'
    const f = fixture({ runner: async args => args[3]?.includes("'disable-user'") ? { code, stdout: '', stderr: reason + '\n\tat com.android.server.pm.PackageManagerService.setEnabledSettings(PackageManagerService.java:4254)'.repeat(40) } : undefined })
    await f.service.execute(target, 'disable')
    assert.equal(f.service.state.status, 'error')
    assert.ok(f.service.state.message.startsWith(reason))
    assert.doesNotMatch(f.service.state.message, /connection|transport/i)
    assert.equal(f.calls.filter(args => args[3]?.includes("'disable-user'")).length, 1)
    assert.equal(f.calls.some(args => /su|uninstall/.test(args[3])), false)
    assert.equal(f.refreshed(), 0)
  }
})

test('Disable transport failures still advise checking the app state before retrying', async () => {
  const f = fixture({ runner: async args => args[3]?.includes("'disable-user'") ? { code: 1, stdout: '', stderr: 'error: device offline' } : undefined })
  await f.service.execute(target, 'disable')
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.message, /Check the app state before repeating/)
})
test('APK export includes all splits and a checksum manifest, without overwriting older exports', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-'))
  const f = fixture({ folder }); await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'success')
  const output = f.service.state.exportPath
  assert.deepEqual((await readdir(output)).sort(), ['base.apk', 'manifest.json', 'split-001.apk'])
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
  assert.equal(manifest.userId, 11); assert.equal(manifest.includesApplicationData, false); assert.equal(manifest.files.length, 2)
  assert.equal(manifest.files[1].sha256, digest)
  for (const file of manifest.files) {
    assert.deepEqual(Object.keys(file.timingsMs), ['deviceChecksum', 'transfer', 'localVerification'])
    assert.ok(Object.values(file.timingsMs).every(ms => Number.isInteger(ms) && ms >= 0))
  }
  const messages = f.events.map(event => event.message)
  const checksum = messages.findIndex(message => message.includes('Reading checksum on device: base.apk'))
  const copying = messages.findIndex(message => message.includes('Copying to computer: base.apk'))
  const verifying = messages.findIndex(message => message.includes('Verifying copied APK: base.apk'))
  assert.ok(checksum >= 0 && copying > checksum && verifying > copying)
  assert.ok(messages.some(message => message.includes('Copying to computer: split-001.apk')))
  await f.service.execute(target, 'export')
  assert.notEqual(f.service.state.exportPath, output)
  assert.equal((await readdir(folder)).length, 2)
})
test('single APK export produces one APK and a manifest', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-'))
  const f = fixture({ folder, paths: ['/system/app/Example/Example.apk'] }); await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'success'); assert.equal(f.service.state.total, 1)
  assert.deepEqual((await readdir(f.service.state.exportPath)).sort(), ['base.apk', 'manifest.json'])
})
test('corrupt or incomplete exports are removed without a completed folder', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-'))
  const f = fixture({ folder, corrupt: true }); await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'error'); assert.deepEqual(await readdir(folder), [])
})
test('vendor APK export falls back only from a remote pull denial to a verified non-root shell stream', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-')), remote = "/vendor/app/O'Brien/Example.apk"
  const f = fixture({ folder, paths: [remote], runner: async (args, controls) => {
    if (args[2] === 'pull') { await writeFile(args[4], 'partial pull'); return { code: 1, stdout: '', stderr: `adb: error: failed to stat remote object '${remote}': Permission denied` } }
    if (controls.stdoutFile) {
      assert.equal(args[2], 'exec-out'); assert.ok(args[3].startsWith("cat -- '/vendor/app/O'\\''Brien/Example.apk';"))
      const token = args[3].match(/ADB_VAULT_EXPORT_([a-f0-9-]{36})/)[1]
      await writeFile(controls.stdoutFile, Buffer.concat([apk, Buffer.from(`\nADB_VAULT_EXPORT_${token}:0\n`)]), { flag: 'wx' }); return ok('')
    }
  } })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.deepEqual(await readFile(path.join(f.service.state.exportPath, 'base.apk')), apk)
  assert.equal(JSON.parse(await readFile(path.join(f.service.state.exportPath, 'manifest.json'), 'utf8')).files[0].sha256, digest)
  assert.ok(f.events.some(e => e.message.includes('Copying through Android shell')))
  assert.equal(f.calls.some(args => /su -c|chmod|setenforce|reconnect|kill-server/.test(args.join(' '))), false)
})

test('shell export failures and checksum mismatches never publish incomplete APKs', async () => {
  for (const problem of ['denied', 'stderr', 'hash', 'disconnect', 'missing-frame', 'remote-failure']) {
    const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-'))
    let f
    f = fixture({ folder, paths: ['/vendor/app/Example.apk'], runner: async (args, controls) => {
      if (args[2] === 'pull') return { code: 1, stdout: '', stderr: "adb: error: failed to stat remote object '/vendor/app/Example.apk': Permission denied" }
      if (controls.stdoutFile) {
        const token = args[3].match(/ADB_VAULT_EXPORT_([a-f0-9-]{36})/)[1]
        const body = problem === 'hash' ? Buffer.concat([apk, Buffer.from('changed')]) : apk
        await writeFile(controls.stdoutFile, Buffer.concat([body, problem === 'missing-frame' ? Buffer.alloc(0) : Buffer.from(`\nADB_VAULT_EXPORT_${token}:${problem === 'remote-failure' ? 1 : 0}\n`)]))
        if (problem === 'disconnect') f.connection.devices[0].transportId = '8'
        return { code: problem === 'denied' ? 1 : 0, stdout: '', stderr: ['denied', 'stderr'].includes(problem) ? 'cat: Permission denied' : '' }
      }
    } })
    await f.service.execute(target, 'export')
    assert.notEqual(f.service.state.status, 'success', problem); assert.deepEqual(await readdir(folder), [])
  }
})

test('pull disconnects, timeouts and local permission errors do not trigger another transfer', async () => {
  for (const error of ['error: device offline', 'Command timed out.', 'adb: error: cannot create local file: Permission denied', "adb: error: failed to stat remote object '/vendor/app/Example.apk': Permission denied\nerror: connection reset"]) {
    const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-'))
    const f = fixture({ folder, paths: ['/vendor/app/Example.apk'], runner: async (args, controls) => {
      assert.equal(controls.stdoutFile, undefined)
      if (args[2] === 'pull') throw new Error(error)
    } })
    await f.service.execute(target, 'export'); assert.equal(f.service.state.status, 'error'); assert.deepEqual(await readdir(folder), [])
  }
})

test('an APK checksum mismatch is rejected and cleaned up', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-'))
  const f = fixture({ folder, runner: async args => args[3]?.startsWith("'sha256sum'") ? ok('a'.repeat(64) + '  file.apk') : undefined })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'error'); assert.deepEqual(await readdir(folder), [])
})
test('a changing APK set invalidates the whole export', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-')); let reads = 0
  const f = fixture({ folder, runner: async args => args[3]?.startsWith("'pm' 'path'") && ++reads > 1 ? ok('package:/data/app/new/base.apk') : undefined })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'error'); assert.deepEqual(await readdir(folder), [])
})
test('cancelling the folder dialog creates no files or ADB requests', async () => {
  const f = fixture(); await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'cancelled'); assert.deepEqual(f.calls, [])
})
test('shutdown cancels an in-flight pull and waits for partial file cleanup', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-action-test-')); let pulling
  const started = new Promise(resolve => { pulling = resolve })
  const f = fixture({ folder, runner: async (args, controls) => {
    if (args[2] !== 'pull') return undefined
    await writeFile(args[4], apk)
    return new Promise((resolve, reject) => { controls.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); pulling() })
  } })
  const action = f.service.execute(target, 'export'); await started
  await assert.rejects(f.service.execute(target, 'uninstall'), /current application action/)
  await f.service.shutdown(); await action
  assert.equal(f.service.state.status, 'cancelled'); assert.equal(f.service.busy, false)
  assert.deepEqual(await readdir(folder), [])
})
test('path parsing refuses traversal, duplicates and diagnostic text', () => {
  for (const output of ['package:/data/../secret.apk', 'package:relative.apk', 'package:/a.apk\npackage:/a.apk', 'Error: unknown user', '']) assert.throws(() => parseApkPaths(output))
})


for (const action of ['clear-cache', 'clear-data', 'clear-obb', 'clear-media']) {
  test(`${action} cancellation sends no device commands`, async () => {
    const f = fixture({ accept: false }); await f.service.execute(target, action)
    assert.equal(f.calls.length, 0); assert.equal(f.service.state.status, 'cancelled')
    assert.equal(f.confirmations[0][0], action)
  })
}
function cleanupRunner({ cache = true, shared = false } = {}) {
  return async args => {
    if (args[3] === '-T' && args[4].startsWith('pm list packages')) return ok('package:org.example.app uid:1110001' + (shared ? '\npackage:org.example.other uid:1110001' : ''))
    const cmd = shellTokens(args[3])
    if (cmd[1] === 'help') return ok(cache ? 'clear [--user USER_ID] [--cache-only] PACKAGE' : 'clear [--user USER_ID] PACKAGE')
    if (cmd[1] === 'clear') return ok('Success')
  }
}
test('cache clearing checks advertised capability before issuing per-profile clear --cache-only', async () => {
  const f = fixture({ runner: cleanupRunner() }); await f.service.execute(target, 'clear-cache')
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.deepEqual(shellTokens(f.calls.at(-1)[3]), ['pm', 'clear', '--user', '11', '--cache-only', target.packageName])
  assert.equal(f.refreshed(), 1)
})
test('unsupported cache clearing never falls back to data clearing', async () => {
  const f = fixture({ runner: cleanupRunner({ cache: false }) }); await f.service.execute(target, 'clear-cache')
  assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, /does not advertise/)
  assert.equal(f.calls.some(a => a[3].includes("'clear'")), false)
})
test('data clearing targets one profile; shared UID is refused', async () => {
  const f = fixture({ runner: cleanupRunner() }); await f.service.execute(target, 'clear-data')
  assert.deepEqual(shellTokens(f.calls.at(-1)[3]), ['pm', 'clear', '--user', '11', target.packageName])
  const g = fixture({ runner: cleanupRunner({ shared: true }) }); await g.service.execute(target, 'clear-data')
  assert.equal(g.service.state.status, 'error'); assert.match(g.service.state.message, /Shared-UID/)
  assert.equal(g.calls.some(a => a[3].includes("'clear'")), false)
})


for (const part of ['obb', 'media']) {
  test(`clear-${part} deletes only verified primary package folder after confirmation`, async () => {
    const folder = `/storage/emulated/11/Android/${part}/${target.packageName}`
    const f = fixture({ runner: async args => {
      if (args[3] !== '-T') return undefined
      const cmd = args[4]
      if (cmd.startsWith('pm list packages')) return ok('package:org.example.app uid:1110001')
      if (cmd.includes('echo ABSENT')) return ok(folder)
      if (cmd.startsWith('ls -Zd')) return ok('context ' + folder)
      if (cmd.includes('find ')) return ok('')
    } })
    await f.service.execute(target, `clear-${part}`)
    assert.equal(f.service.state.status, 'success', f.service.state.message)
    const deleteCommand = f.calls.find(args => args[4]?.includes('find '))[4]
    assert.ok(deleteCommand.includes(`find '${folder}' -mindepth 1 -maxdepth 1`))
    assert.ok(deleteCommand.includes('readlink -f'))
    assert.ok(!deleteCommand.includes('/storage/emulated/0'))
    assert.equal(f.refreshed(), 1)
  })
}


test('cache cleanup can use explicitly enabled root, without changing its scope', async () => {
  const f = fixture({ runner: async args => {
    if (args[3] === '-T' && args[4].startsWith('su -c')) return ok(args[4].includes(' id') || args[4] === "su -c 'id'" ? 'uid=0(root)' : 'Success')
    return cleanupRunner()(args)
  } })
  f.apps.options.root = true
  f.connection.devices[0].root = { status: 'available', method: 'su' }
  await f.service.execute(target, 'clear-cache')
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.ok(f.calls.at(-1)[4].startsWith('su -c'))
  assert.ok(f.calls.at(-1)[4].includes('--cache-only'))
})


test('a root preference from another phone never requests su without confirmed access on this phone', async () => {
  for (const root of [undefined, { status: 'checking' }, { status: 'detected', method: 'su' }, { status: 'not-detected' }, { status: 'denied', method: 'su' }, { status: 'error' }, { status: 'available' }]) {
    for (const action of ['clear-cache', 'clear-obb', 'clear-media']) {
      const f = fixture({ runner: async args => {
        if (args.at(-1).includes('echo ABSENT')) return ok('ABSENT')
        return cleanupRunner()(args)
      } })
      f.apps.options.root = true; f.connection.devices[0].root = root
      await f.service.execute(target, action)
      assert.equal(f.service.state.status, 'success', f.service.state.message)
      assert.equal(f.calls.some(args => /\bsu\b/.test(args.join(' '))), false, `${action}: ${root?.status}`)
      assert.equal(f.calls.some(args => args.at(-1).includes('-exec rm')), false)
    }
  }
})

test('cleanup revalidates known root before mutation and supports an already-root ADB shell', async () => {
  for (const method of ['adb', 'su']) {
    for (const allowed of [false, true]) {
      const f = fixture({ runner: async args => {
        if (args.at(-1) === 'id' || args.at(-1) === "su -c 'id'") return ok(allowed ? 'uid=0(root)' : 'uid=2000(shell)')
        if (args[3] === '-T' && args.at(-1).includes("'clear'")) return ok('Success')
        return cleanupRunner()(args)
      } })
      f.apps.options.root = true; f.connection.devices[0].root = { status: 'available', method }
      await f.service.execute(target, 'clear-cache')
      assert.equal(f.service.state.status, allowed ? 'success' : 'error')
      assert.equal(f.calls.some(args => args.at(-1).includes("'clear'")), allowed)
      if (method === 'adb') assert.equal(f.calls.some(args => /\bsu\b/.test(args.join(' '))), false)
    }
  }
})

test('CLEAR_APP_USER_DATA denial is preserved and does not trigger root escalation or another clear', async () => {
  const reason = 'java.lang.SecurityException: PID 5747 does not have permission android.permission.CLEAR_APP_USER_DATA to clear data of package org.example.app'
  const f = fixture({ runner: async args => args.at(-1).includes("'clear'") ? ok(reason) : cleanupRunner()(args) })
  f.apps.options.root = true
  await f.service.execute(target, 'clear-data')
  assert.equal(f.service.state.status, 'error')
  assert.equal(f.service.state.message, reason)
  assert.equal(f.calls.filter(args => args.at(-1).includes("'clear'")).length, 1)
  assert.equal(f.calls.some(args => /\bsu\b/.test(args.join(' '))), false)
})

test('experimental Zstd negotiates once for every split, verifies hashes and rechecks on the next export', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-zstd-'))
  const f = fixture({ folder, zstd: true, method: 'Wi-Fi' })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.equal(f.calls.filter(c => c[2] === 'features').length, 1)
  assert.ok(f.calls.filter(c => c[2] === 'pull').every(c => c[3] === '-z' && c[4] === 'zstd'))
  const manifest = JSON.parse(await readFile(path.join(f.service.state.exportPath, 'manifest.json'), 'utf8'))
  assert.equal(manifest.files.length, 2)
  for (const file of manifest.files) {
    assert.equal(file.sha256, digest)
    assert.deepEqual(await readFile(path.join(f.service.state.exportPath, file.file)), apk)
    assert.deepEqual(file.transfer, { method: 'adb-pull', compression: 'zstd' })
  }
  assert.ok(f.events.some(e => e.message.includes('(Zstd)')))
  await f.service.execute(target, 'export')
  assert.equal(f.calls.filter(c => c[2] === 'features').length, 2)
})

for (const scenario of [
  { name: 'off by default', method: 'Wi-Fi', probes: 0 },
  { name: 'USB unaffected', method: 'USB', zstd: true, probes: 0 },
  { name: 'missing Zstd support', method: 'Wi-Fi', zstd: true, features: 'sendrecv_v2', probes: 1 },
  { name: 'missing sync-v2 support', method: 'Wi-Fi', zstd: true, features: 'sendrecv_v2_zstd', probes: 1 },
]) test(`APK transfer: ${scenario.name} uses normal copying`, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-zstd-'))
  const f = fixture({ folder, ...scenario })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.equal(f.calls.filter(c => c[2] === 'features').length, scenario.probes)
  assert.ok(f.calls.filter(c => c[2] === 'pull').every(c => c.length === 5))
})

test('unsupported Zstd flag cleans partial file, retries normally once and keeps that choice for remaining splits', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-zstd-'))
  let fallback = false
  const f = fixture({ folder, method: 'Wi-Fi', zstd: true, runner: async args => {
    if (args[2] === 'pull' && args[3] === '-z') {
      await writeFile(args.at(-1), 'partial')
      fallback = true
      return { code: 1, stdout: '', stderr: 'adb: error: unexpected compression type zstd\n' }
    }
    if (fallback && args[2] === 'pull') {
      await assert.rejects(readFile(args.at(-1)), { code: 'ENOENT' })
      fallback = false
    }
  } })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'success', f.service.state.message)
  assert.equal(f.calls.filter(c => c[2] === 'pull' && c[3] === '-z').length, 1)
  assert.equal(f.calls.filter(c => c[2] === 'pull' && c.length === 5).length, 2)
  const manifest = JSON.parse(await readFile(path.join(f.service.state.exportPath, 'manifest.json'), 'utf8'))
  assert.ok(manifest.files.every(file => file.transfer.compression === 'default' && file.transfer.fallbackReason && file.sha256 === digest))
})

for (const stage of ['features', 'pull']) test(`Zstd ${stage} transport failure is not retried or disguised as incompatibility`, async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-zstd-'))
  const f = fixture({ folder, zstd: true, method: 'Wi-Fi', runner: async args => args[2] === stage ? { code: 1, stdout: '', stderr: 'error: device offline' } : undefined })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.message, /offline/)
  assert.equal(f.calls.filter(c => c[2] === 'pull').length, stage === 'features' ? 0 : 1)
  assert.deepEqual(await readdir(folder), [])
})

test('cancel or transport replacement during the Zstd probe prevents any APK copy', async () => {
  for (const cancel of [true, false]) {
    const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-zstd-'))
    const f = fixture({ folder, zstd: true, method: 'Wi-Fi', runner: async args => {
      if (args[2] === 'features') {
        if (cancel) f.service.cancel()
        else f.connection.devices[0].transportId = '8'
        return ok('sendrecv_v2\nsendrecv_v2_zstd')
      }
    } })
    await f.service.execute(target, 'export')
    assert.equal(f.service.state.status, 'cancelled')
    assert.equal(f.calls.some(c => c[2] === 'pull'), false)
    assert.deepEqual(await readdir(folder), [])
  }
})

test('Zstd checksum mismatch fails without normal-copy retry or published output', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'adb-vault-zstd-'))
  const f = fixture({ folder, zstd: true, method: 'Wi-Fi', runner: async args => args[3]?.startsWith("'sha256sum'") ? ok('a'.repeat(64) + '  base.apk') : undefined })
  await f.service.execute(target, 'export')
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.message, /verification failed/)
  assert.equal(f.calls.filter(c => c[2] === 'pull').length, 1)
  assert.deepEqual(await readdir(folder), [])
})
