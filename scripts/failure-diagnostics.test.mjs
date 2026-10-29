import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { FailureDiagnosticsService } from '../dist-electron/failure-diagnostics.js'
import { run } from '../dist-electron/process.js'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/failure-diagnostics-'))
async function fixture() {
  const directory = await mkdtemp(path.join(root, 'case-')), log = path.join(directory, 'adb.log'), events = []
  await writeFile(log, 'ADB server startup\nerror: connection reset\nsecret=hidden-value\n')
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Test phone', serial: 'wifi-phone', status: 'connected', transportId: '2', method: 'Wi-Fi' }] }
  let pid = 100
  const service = new FailureDiagnosticsService(directory, () => connection, () => 'Owner', () => true, event => events.push(event), async () => [{ pid, parentPid: 1, startedAt: String(pid), server: true }], log)
  await service.load()
  const state = { operationId: randomUUID(), startedAt: new Date().toISOString(), id: 'phone', userId: 0, name: 'User', format: 'auto', operation: 'backup', status: 'running', message: 'Classic: Copying base.apk', completed: 0, total: 2, items: [{ packageName: 'org.classic', label: 'Classic', status: 'running' }, { packageName: 'org.other', label: 'Other', status: 'pending' }] }
  return { directory, connection, state, service, events, changePid: () => { pid = 200 } }
}
test('failed backup persists raw error, context, server observations and linked report across restart/export', async () => {
  const f = await fixture()
  f.service.observe(f.state)
  const wrapped = f.service.wrap(async () => ({ code: 1, stdout: 'adb.exe: no device with transport id 2', stderr: '[ 25%] base.apk' }))
  assert.equal((await wrapped('adb.exe', ['-t', '2', 'pull', '/data/app/base.apk', 'backup.apk'], 1000)).code, 1)
  f.connection.devices[0].status = 'offline'; f.service.connectionChanged(); f.changePid()
  f.service.observe({ ...f.state, status: 'error', message: 'Backup interrupted: Device disconnected.', items: [{ ...f.state.items[0], status: 'error', message: 'no device with transport id 2' }, { ...f.state.items[1], status: 'cancelled' }] })
  await f.service.flush()
  // Follow-up is local only and can observe a replacement server after interruption.
  await new Promise(resolve => setTimeout(resolve, 2700))
  await f.service.shutdown()
  assert.equal(f.service.summaries.length, 1)
  const summary = f.service.summaries[0], report = await f.service.read(summary.id)
  assert.equal(summary.saved, true); assert.equal(summary.operationId, f.state.operationId)
  assert.equal(summary.packageName, 'org.classic'); assert.equal(summary.stage, 'Classic: Copying base.apk')
  assert.match(summary.cause, /connection was lost/)
  assert.match(report.commands[0].stdout, /no device with transport/); assert.equal(report.commands[0].code, 1)
  assert.ok(report.observations.some(o => o.processes?.some(p => p.pid === 100)))
  assert.ok(report.observations.some(o => o.processes?.some(p => p.pid === 200)))
  assert.ok(report.observations.some(o => o.connection.status === 'offline'))
  assert.match(report.adbLog.tail, /connection reset/); assert.doesNotMatch(report.adbLog.tail, /hidden-value/)
  const restart = new FailureDiagnosticsService(f.directory, () => f.connection, () => 'Owner', () => false, () => {})
  await restart.load(); assert.equal(restart.summaries[0].id, summary.id)
  const exported = path.join(f.directory, 'exported.json'); await restart.export(summary.id, exported)
  assert.equal(JSON.parse(await readFile(exported, 'utf8')).summary.operationId, f.state.operationId)
  await assert.rejects(restart.read('../adb.log'), /Invalid diagnostic/)
  await restart.shutdown()
})
test('successful fallback and user cancellation do not create failure reports', async () => {
  for (const status of ['complete', 'cancelled']) {
    const f = await fixture(); f.service.observe(f.state)
    await f.service.wrap(async () => ({ code: 1, stdout: '', stderr: 'Permission denied' }))('adb.exe', ['pull'])
    f.service.observe({ ...f.state, status, message: status, items: f.state.items.map(item => ({ ...item, status: status === 'complete' ? 'success' : 'cancelled' })) })
    await f.service.shutdown()
    assert.deepEqual(f.service.summaries, [])
    assert.deepEqual(await readdir(path.join(f.directory, 'failure-diagnostics')), [])
  }
})
test('a failed application retains its stage/command when later applications finish successfully', async () => {
  const f = await fixture(); f.service.observe(f.state)
  const wrapped = f.service.wrap(async () => ({ code: 1, stdout: '', stderr: 'Permission denied' }))
  await wrapped('adb.exe', ['pull', 'failed.apk'])
  const failed = { ...f.state.items[0], status: 'error', message: 'Permission denied' }
  f.service.observe({ ...f.state, items: [failed, f.state.items[1]] })
  f.service.observe({ ...f.state, message: 'Other: Copying another.apk', items: [failed, { ...f.state.items[1], status: 'running' }] })
  const success = f.service.wrap(async () => ({ code: 0, stdout: 'PRIVATE_CONTENT_NOT_RECORDED', stderr: '' }))
  for (let i = 0; i < 70; i++) await success('adb.exe', ['shell', 'probe-' + i])
  f.service.observe({ ...f.state, status: 'partial', message: '1 failed', items: [failed, { ...f.state.items[1], status: 'success' }] })
  await f.service.shutdown()
  const report = await f.service.read(f.service.summaries[0].id)
  assert.equal(report.summary.packageName, 'org.classic'); assert.equal(report.summary.stage, f.state.message)
  assert.ok(report.commands.some(c => c.args.includes('failed.apk') && c.stderr === 'Permission denied'))
  assert.ok(report.commands.length <= 80); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_CONTENT_NOT_RECORDED/)
})
test('diagnostic storage failures are surfaced without changing command results or throwing into backup', async () => {
  const f = await fixture(); await f.service.shutdown()
  const invalid = path.join(f.directory, 'not-a-directory'); await writeFile(invalid, 'file')
  const service = new FailureDiagnosticsService(invalid, () => f.connection, () => 'Owner', () => false, () => {}, async () => { throw Error('Process access denied') }, 'missing.log')
  service.observe(f.state)
  const result = await service.wrap(async () => ({ code: 2, stdout: '', stderr: 'Disk full' }))('adb.exe', ['pull'])
  assert.equal(result.code, 2)
  service.observe({ ...f.state, status: 'error', message: 'Disk full', items: [{ ...f.state.items[0], status: 'error', message: 'Disk full' }] })
  await service.shutdown()
  assert.equal(service.summaries[0].saved, false); assert.ok(service.summaries[0].saveError)
})
test('timeout preserves command output for the automatic diagnostic report', async () => {
  const f = await fixture(); f.service.observe(f.state)
  const wrapped = f.service.wrap(run)
  await assert.rejects(wrapped(process.execPath, ['-e', 'process.stderr.write("transfer stalled");setInterval(()=>{},100)'], 700), /timed out/)
  f.service.observe({ ...f.state, status: 'error', message: 'Command timed out.', items: [{ ...f.state.items[0], status: 'error', message: 'Command timed out.' }] })
  await f.service.shutdown()
  const report = await f.service.read(f.service.summaries[0].id)
  assert.match(report.commands[0].error, /timed out/); assert.equal(report.commands[0].stderr, 'transfer stalled')
})

test('retention preserves the latest 50 reports; unfinished reports do not appear as running after restart', async () => {
  const f = await fixture(); f.service.observe(f.state)
  f.service.observe({ ...f.state, status: 'error', message: 'Unknown failure' })
  await f.service.shutdown()
  const report = await f.service.read(f.service.summaries[0].id)
  const directory = path.join(f.directory, 'failure-diagnostics'), ids = []
  await writeFile(path.join(directory, 'unrelated.txt'), 'keep')
  for (let i = 0; i < 52; i++) {
    const id = randomUUID(); ids.push(id)
    await writeFile(path.join(directory, id + '.json'), JSON.stringify({ ...report, summary: { ...report.summary, id, status: 'running', createdAt: new Date(Date.now() + i * 1000 + 60000).toISOString() } }))
  }
  const restart = new FailureDiagnosticsService(f.directory, () => f.connection, () => 'Owner', () => false, () => {})
  await restart.load()
  assert.equal(restart.summaries.length, 50); assert.equal(restart.summaries[0].id, ids[51])
  assert.ok(restart.summaries.every(item => item.status === 'error' && item.message.includes('final outcome was not recorded')))
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, 50)
  assert.equal(await readFile(path.join(directory, 'unrelated.txt'), 'utf8'), 'keep')
  await restart.shutdown()
})
