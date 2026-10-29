import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AppActionsService, validateBatchAction } from '../dist-electron/app-actions.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'
const ok = stdout => ({ code: 0, stdout, stderr: '' })
function fixture(options = {}) {
  const apps = { ...emptyApps(), deviceId: 'phone', userId: 10, status: 'ready', profiles: [{ id: 10, name: 'Work' }], apps: ['alpha', 'beta', 'gamma'].map((name, i) => ({ packageName: `org.example.${name}`, label: name, userId: 10, uid: 1010001 + i, versionCode: 1, enabled: i !== 1, system: i === 2 })) }
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'serial', transportId: '7', hardwareId: 'hardware', name: 'Phone', status: 'connected' }] }
  const calls = [], confirmations = [], refreshed = []
  const service = new AppActionsService(() => 'adb', () => connection, () => apps, s => options.publish?.(s, service), () => {}, {
    confirm: async () => { throw Error('Individual confirmation must not be repeated') }, exportFolder: async () => null,
    confirmBatch: async s => { confirmations.push(structuredClone(s)); return options.confirm ? options.confirm(s, connection, apps) : true },
  }, async target => { refreshed.push(target); if (service.state.action === 'uninstall') apps.apps = apps.apps.filter(a => a.packageName !== target.packageName); if (options.refresh) options.refresh(apps) }, async (_exe, args) => {
    calls.push(args); const command = args.at(-1)
    if (options.runner) { const r = await options.runner(command, service); if (r !== undefined) return r }
    if (command.includes("'path'")) return ok('package:/data/app/base.apk')
    if (command.startsWith('pm list packages')) return ok(apps.apps.map(a => `package:${a.packageName} uid:${a.uid}`).join('\n'))
    if (command.includes("'help'")) return ok('clear [--user USER_ID] [--cache-only] PACKAGE')
    if (command.includes("'enable'")) return ok('new state: enabled')
    if (command.includes("'disable-user'")) return ok('new state: disabled-user')
    if (command.includes("'force-stop'")) return ok('')
    return ok('Success')
  })
  const run = action => service.executeBatch({ id: 'phone', userId: 10, packages: apps.apps.map(a => a.packageName), action })
  return { service, apps, connection, calls, confirmations, refreshed, run }
}
test('batch Freeze/Unfreeze skips matching states and keeps the Android profile', async () => {
  for (const action of ['suspend', 'unsuspend']) {
    const f = fixture({ runner: command => {
      if (command.includes("'help'")) return ok('suspend [--user USER_ID] PACKAGE\nunsuspend [--user USER_ID] PACKAGE')
      if (command.includes(`'${action}'`)) return ok(`Package org.example.${action === 'suspend' ? 'alpha' : 'gamma'} new suspended state: ${action === 'suspend'}`)
    } })
    f.apps.apps.forEach((app, i) => { app.suspended = i === 2 })
    await f.run(action)
    assert.equal(f.service.state.status, 'success')
    assert.equal(f.confirmations.length, 1)
    assert.deepEqual(f.service.state.batch.items.map(item => item.status), action === 'suspend' ? ['success', 'skipped', 'skipped'] : ['skipped', 'skipped', 'success'])
    assert.deepEqual(f.calls.at(-1), ['-t', '7', 'shell', `'pm' '${action}' '--user' '10' 'org.example.${action === 'suspend' ? 'alpha' : 'gamma'}'`])
  }
})
test('Freeze with an unconfirmed result stops the batch and does not offer a blind retry', async () => {
  const f = fixture({ runner: command => command.includes("'help'") ? ok('suspend [--user USER_ID] PACKAGE') : command.includes("'suspend'") ? ok('') : undefined })
  await f.run('suspend')
  assert.deepEqual(f.service.state.batch.items.map(item => item.status), ['error', 'skipped', 'cancelled'])
  assert.equal(f.service.state.batch.items[0].uncertain, true)
  assert.equal(f.calls.filter(args => args.at(-1).includes("'suspend'")).length, 1)
})

test('batch enable skips enabled apps with one confirmation and pins profile/transport', async () => {
  const f = fixture(); await f.run('enable'); assert.equal(f.confirmations.length, 1)
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['skipped', 'success', 'skipped'])
  assert.equal(f.calls.length, 2); assert.deepEqual(f.calls.at(-1), ['-t', '7', 'shell', "'pm' 'enable' '--user' '10' 'org.example.beta'"])
})
test('native cancellation and changed target issue no device commands', async () => {
  for (const change of [false, true]) {
    const f = fixture({ confirm: (_s, c) => { if (change) c.devices[0].transportId = '8'; return change } }); await f.run('uninstall')
    assert.equal(f.calls.length, 0); assert.equal(f.service.state.status, 'cancelled')
  }
})
test('uninstall queue survives each application disappearing from inventory', async () => {
  const f = fixture(); await f.run('uninstall'); assert.equal(f.service.state.status, 'success'); assert.equal(f.refreshed.length, 3); assert.equal(f.apps.apps.length, 0)
  assert.equal(f.calls.filter(a => a.at(-1).includes("'uninstall'")).length, 3)
})
test('clear data and cache retain live UID guards and never fall back from cache to data', async () => {
  for (const action of ['clear-data', 'clear-cache']) {
    const f = fixture(); f.apps.apps[2].uid = 1001000; await f.run(action)
    assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'success', 'skipped'])
    const commands = f.calls.filter(a => a.at(-1).includes("'clear'")); assert.equal(commands.length, 2)
    assert.equal(commands.every(a => a.at(-1).includes("'--cache-only'")), action === 'clear-cache')
  }
  const f = fixture({ runner: c => c.includes("'help'") ? ok('clear [--user USER_ID] PACKAGE') : undefined }); await f.run('clear-cache')
  assert.equal(f.calls.some(a => a.at(-1).includes("'clear'")), false)
})
test('known shared UID cleanup is skipped, but other selected apps run', async () => {
  const f = fixture(); f.apps.apps[1].uid = f.apps.apps[0].uid; await f.run('clear-data')
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['skipped', 'skipped', 'success'])
})
test('ordinary Android failure continues and retry does not repeat successful apps', async () => {
  let failed = false
  const f = fixture({ runner: c => { if (!failed && c.includes("'disable-user'") && c.includes('alpha')) { failed = true; return ok('Failure [not allowed]') } } })
  await f.run('disable'); assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['error', 'skipped', 'success'])
  await f.service.retryBatch(); assert.equal(f.service.state.status, 'success'); assert.equal(f.service.state.batch.items.length, 1)
})

test('a long Android denial is a definite failure and does not falsely stop the batch as uncertain', async () => {
  const f = fixture({ runner: c => c.includes("'disable-user'") && c.includes('alpha') ? { code: 1, stdout: '', stderr: 'java.lang.SecurityException: Cannot disable a protected package: org.example.alpha\n' + '\tat com.android.server.pm.PackageManagerService.setEnabledSettings(PackageManagerService.java:4254)\n'.repeat(40) } : undefined })
  await f.run('disable')
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['error', 'skipped', 'success'])
  assert.equal(f.service.state.batch.items[0].uncertain, false)
  assert.match(f.service.state.batch.items[0].message, /^java.lang.SecurityException: Cannot disable a protected package/)
})
test('stop finishes current action, rejects concurrent action and marks the rest not started', async () => {
  const f = fixture({ runner: async (c, service) => { if (c.includes("'force-stop'")) { service.cancel(); await assert.rejects(service.execute({ id: 'phone', userId: 10, packageName: 'org.example.beta' }, 'enable'), /Wait/) } } })
  await f.run('force-stop'); assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'cancelled', 'cancelled'])
})
test('transport loss during mutation stops queue and excludes uncertain app from retry', async () => {
  let first = true
  const f = fixture({ runner: c => { if (first && c.includes("'uninstall'")) { first = false; throw Error('connection lost') } } })
  await f.run('uninstall'); assert.equal(f.service.state.batch.items[0].uncertain, true); assert.equal(f.service.state.batch.items[1].status, 'cancelled')
  await f.service.retryBatch(); assert.deepEqual(f.service.state.batch.items.map(i => i.packageName), ['org.example.beta', 'org.example.gamma'])
})
test('changes to queued app identity skip it after confirmation', async () => {
  const f = fixture({ refresh: apps => { apps.apps[1].versionCode++ } }); await f.run('force-stop'); assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'skipped', 'success'])
})
test('batch validation refuses unsupported actions, injection and duplicate packages', () => {
  const valid = { id: 'phone', userId: 10, action: 'disable', packages: ['org.example.a'] }
  for (const patch of [{ action: 'launch' }, { packages: [] }, { packages: ['org.example.a', 'org.example.a'] }, { packages: ['a;reboot'] }, { userId: -1 }]) assert.throws(() => validateBatchAction({ ...valid, ...patch }))
})

function externalRunner(command) {
  if (command === "su -c 'id'" || command === 'id') return ok('uid=0(root)')
  const folder = command.match(/\/storage\/emulated\/10\/Android\/(?:obb|media)\/org\.example\.[a-z]+/)?.[0]
  if (command.includes('echo ABSENT')) return ok(folder)
  if (command.includes('ls -Zd')) return ok('context ' + folder)
  if (command.includes('-exec rm -rf --')) return ok('')
}
for (const part of ['obb', 'media']) {
  test(`batch ${part} uses only confirmed per-app/profile paths, with shell or enabled root`, async () => {
    for (const root of [false, true]) {
      const f = fixture({ runner: externalRunner }); f.apps.options.root = root
      if (root) f.connection.devices[0].root = { status: 'available', method: 'su' }
      await f.run(`clear-${part}`)
      assert.equal(f.confirmations.length, 1)
      assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'success', 'success'])
      const deletions = f.calls.filter(a => a.at(-1).includes('-exec rm -rf --'))
      assert.equal(deletions.length, 3)
      for (const [index, args] of deletions.entries()) {
        assert.deepEqual(args.slice(0, 4), ['-t', '7', 'shell', '-T'])
        const command = args.at(-1), folder = `/storage/emulated/10/Android/${part}/${f.apps.apps[index].packageName}`
        assert.ok(command.includes(folder)); assert.ok(command.includes('readlink -f')); assert.ok(command.includes('-mindepth 1 -maxdepth 1'))
        assert.equal(command.startsWith('su -c'), root)
        assert.ok(!command.includes('/Android/data/')); assert.ok(!command.includes('/storage/emulated/0/'))
      }
      assert.equal(f.refreshed.length, 3)
    }
  })
  test(`batch ${part} cancellation and unsafe UIDs never delete files`, async () => {
    const cancelled = fixture({ confirm: () => false, runner: externalRunner }); await cancelled.run(`clear-${part}`)
    assert.equal(cancelled.calls.length, 0)
    const f = fixture({ runner: externalRunner }); f.apps.apps[0].uid = 1001000; f.apps.apps[2].uid = f.apps.apps[1].uid
    assert.throws(() => f.run(`clear-${part}`), /unavailable for all/)
    assert.equal(f.calls.length, 0)
  })
}
test('absent external folders make no mutations; access denial before deletion can continue safely', async () => {
  const f = fixture({ runner: c => {
    if (c.includes('echo ABSENT') && c.includes('alpha')) return ok('ABSENT')
    if (c.includes('echo ABSENT') && c.includes('beta')) return { code: 1, stdout: '', stderr: 'Permission denied' }
    return externalRunner(c)
  } })
  await f.run('clear-media')
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'error', 'success'])
  assert.equal(f.service.state.batch.items[1].uncertain, false)
  const mutations = f.calls.filter(a => /force-stop|-exec rm/.test(a.at(-1)))
  assert.equal(mutations.length, 2); assert.ok(mutations.every(a => a.at(-1).includes('gamma')))
})
test('partial external cleanup stops the queue and retry excludes the uncertain application', async () => {
  let fail = true
  const f = fixture({ runner: c => {
    if (fail && c.includes('-exec rm -rf --')) { fail = false; return { code: 1, stdout: '', stderr: 'Permission denied after deleting some files' } }
    return externalRunner(c)
  } })
  await f.run('clear-obb')
  assert.equal(f.service.state.batch.items[0].uncertain, true)
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['error', 'cancelled', 'cancelled'])
  await f.service.retryBatch()
  assert.deepEqual(f.service.state.batch.items.map(i => i.packageName), ['org.example.beta', 'org.example.gamma'])
  assert.equal(f.service.state.status, 'success')
})
test('external cleanup stop finishes current app; path mismatch never deletes a directory', async () => {
  const f = fixture({ runner: (c, service) => { if (c.includes('-exec rm -rf --')) service.cancel(); return externalRunner(c) } })
  await f.run('clear-media')
  assert.deepEqual(f.service.state.batch.items.map(i => i.status), ['success', 'cancelled', 'cancelled'])
  const g = fixture({ runner: c => c.includes('echo ABSENT') ? ok('/storage/emulated/10/Android/media/another.package') : externalRunner(c) })
  await g.run('clear-media')
  assert.equal(g.calls.some(a => /force-stop|-exec rm/.test(a.at(-1))), false)
  assert.ok(g.service.state.batch.items.every(i => i.status === 'error' && !i.uncertain))
})
test('combined cleanup confirms once, includes cache in data, and refreshes once per app', async () => {
  const f = fixture({ runner: externalRunner })
  await f.service.executeBatch({ id: 'phone', userId: 10, packages: f.apps.apps.map(a => a.packageName), action: 'clear-storage', cleanup: ['media', 'cache', 'data', 'obb'] })
  assert.equal(f.confirmations.length, 1)
  assert.deepEqual(f.confirmations[0].batch.cleanup, ['data', 'obb', 'media'])
  assert.equal(f.calls.filter(a => a.at(-1).includes("'clear'")).length, 3)
  assert.equal(f.calls.some(a => a.at(-1).includes('--cache-only')), false)
  assert.equal(f.calls.filter(a => a.at(-1).includes('-exec rm')).length, 6)
  assert.equal(f.refreshed.length, 3)
  assert.ok(f.service.state.batch.items.every(i => i.status === 'success' && i.steps.length === 3 && i.steps.every(s => s.status === 'success')))
})
test('combined cleanup on an unrooted phone keeps denied data separate from accessible external folders', async () => {
  const f = fixture({ runner: c => {
    if (c.includes("'clear'")) return ok('java.lang.SecurityException: PID 5747 does not have permission android.permission.CLEAR_APP_USER_DATA to clear data of package org.example.alpha')
    return externalRunner(c)
  } })
  f.apps.options.root = true
  await f.service.executeBatch({ id: 'phone', userId: 10, packages: ['org.example.alpha', 'org.example.beta'], action: 'clear-storage', cleanup: ['data', 'obb', 'media'] })
  assert.ok(f.service.state.batch.items.every(i => i.status === 'error' && !i.uncertain))
  for (const item of f.service.state.batch.items) assert.deepEqual(item.steps.map(s => s.status), ['error', 'success', 'success'])
  assert.equal(f.calls.some(args => /\bsu\b/.test(args.join(' '))), false)
  assert.equal(f.calls.filter(args => args.at(-1).includes("'clear'")).length, 2)
  assert.equal(f.calls.filter(args => args.at(-1).includes('-exec rm')).length, 4)
})

test('combined cleanup retries failed categories without repeating completed ones', async () => {
  let fail = true
  const f = fixture({ runner: c => {
    if (fail && c.includes("'clear'") && c.includes('alpha')) { fail = false; return ok('Failure [Permission denied]') }
    return externalRunner(c)
  } })
  await f.service.executeBatch({ id: 'phone', userId: 10, packages: ['org.example.alpha'], action: 'clear-storage', cleanup: ['data', 'media'] })
  assert.equal(f.service.state.status, 'error')
  assert.deepEqual(f.service.state.batch.items[0].steps.map(s => s.status), ['error', 'success'])
  const firstId = f.service.state.operationId
  f.calls.length = 0
  await f.service.retryBatch()
  assert.notEqual(f.service.state.operationId, firstId)
  assert.equal(f.service.state.status, 'success')
  assert.deepEqual(f.confirmations[1].batch.items[0].steps.map(s => s.part), ['data'])
  assert.equal(f.calls.some(a => a.at(-1).includes('-exec rm')), false)
})
test('combined cleanup stops after all categories of the current app, but uncertain deletion stops immediately', async () => {
  for (const uncertain of [false, true]) {
    const f = fixture({ runner: (c, service) => {
      if (c.includes('-exec rm') && c.includes('/obb/')) {
        if (uncertain) return { code: 1, stdout: '', stderr: 'Permission denied after partial deletion' }
        service.cancel()
      }
      return externalRunner(c)
    } })
    await f.service.executeBatch({ id: 'phone', userId: 10, packages: f.apps.apps.map(a => a.packageName), action: 'clear-storage', cleanup: ['obb', 'media'] })
    assert.deepEqual(f.service.state.batch.items[0].steps.map(s => s.status), uncertain ? ['error', 'cancelled'] : ['success', 'success'])
    assert.equal(f.service.state.batch.items[0].uncertain, uncertain)
    assert.equal(f.service.state.batch.items[1].status, 'cancelled')
  }
})
test('combined cleanup validates categories before access; cancellation issues no commands', async () => {
  const base = { id: 'phone', userId: 10, packages: ['org.example.alpha'], action: 'clear-storage' }
  for (const cleanup of [undefined, [], ['invalid'], ['cache', 'cache'], 'data']) assert.throws(() => validateBatchAction({ ...base, cleanup }), /categories/)
  assert.throws(() => validateBatchAction({ ...base, action: 'uninstall', cleanup: ['data'] }), /require Clear storage/)
  const f = fixture({ confirm: () => false })
  await f.service.executeBatch({ ...base, cleanup: ['data', 'obb'] })
  assert.equal(f.calls.length, 0)
  assert.ok(f.service.state.batch.items[0].steps.every(s => s.status === 'cancelled'))
})
