import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyApps } from '../dist-electron/apps-protocol.js'
import { collectExitOperations, exitOperationLabels as labels, requestExitOperation } from '../dist-electron/exit-operations.js'
import { CloseCoordinator } from '../dist-electron/close-coordinator.js'

const idle = () => ({ apps: emptyApps(), components: [{ status: 'Checking' }], files: { tasks: [] }, connection: { devices: [], busy: false, scanning: true, qr: null } })
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('idle connection polling, connected devices and completed work do not need confirmation', () => {
  const s = idle()
  s.connection.devices = [{ status: 'connected', info: { status: 'ready' }, root: { status: 'available' } }]
  s.files.tasks = ['success', 'partial', 'error', 'cancelled'].map(status => ({ status }))
  s.backup = { status: 'complete' }; s.restore = { status: 'ready' }; s.appAction = { status: 'success' }
  s.fileSearch = { status: 'complete' }; s.androidDiagnostics = { job: { status: 'success' } }
  assert.deepEqual(collectExitOperations(s), [])
})

test('queued, running, paused and conflict tasks all need confirmation', () => {
  for (const status of ['queued', 'running', 'paused', 'conflict']) {
    const s = idle(); s.files.tasks = [{ status }]
    assert.deepEqual(collectExitOperations(s), [labels.files], status)
  }
})

test('detached jobs across workspaces remain visible after their IPC request returns', () => {
  const cases = [
    ['inspector', s => { s.apkInspector = { before: { status: 'loading' }, after: { status: 'empty' } } }],
    ['backup', s => { s.backup = { status: 'running' } }],
    ['search', s => { s.fileSearch = { status: 'running' } }],
    ['actions', s => { s.appAction = { status: 'running' } }],
    ['collection', s => { s.apps.status = 'loading' }],
    ['collection', s => { s.apps.backgroundUserId = 0 }],
    ['details', s => { s.apps.details = { status: 'loading' } }],
    ['details', s => { s.apps.details = { status: 'ready', data: { analysis: { status: 'running' } } } }],
    ['badges', s => { s.apps.badgeRead = { status: 'running' } }],
    ['components', s => { s.adbDiagnostics = { status: 'loading' } }],
    ['connection', s => { s.connection.busy = true }],
    ['deviceInfo', s => { s.connection.devices = [{ info: { status: 'loading' } }] }],
    ['deviceInfo', s => { s.connection.devices = [{ root: { status: 'checking' } }] }],
    ['fastboot', s => { s.fastboot = { busy: true } }],
    ...['logcat', 'bugreport', 'battery'].map(kind => ['diagnostics', s => { s.androidDiagnostics = { job: { status: 'running', kind } } }]),
    ...['opening', 'verifying', 'confirming', 'installing', 'restoring', 'batch'].map(status => ['restore', s => { s.restore = { status } }]),
  ]
  for (const [key, change] of cases) { const s = idle(); change(s); assert.deepEqual(collectExitOperations(s), [labels[key]], key) }
})

test('live QR pairing and Mirror screen sessions are counted, expired QR is not', () => {
  const s = idle()
  for (const status of ['waiting', 'pairing']) {
    s.connection.qr = { status, expiresAt: Date.now() + 60000 }
    assert.deepEqual(collectExitOperations(s, [], 2), [labels.qr, labels.mirror])
  }
  s.connection.qr.expiresAt = Date.now() - 1
  assert.deepEqual(collectExitOperations(s), [])
})

test('pending IPC covers operations without a busy flag and coalesces duplicate entries', () => {
  const requests = ['components.action', 'components.locate', 'connection.pair', 'connection.power', 'connection.screen',
    'apps.savePreset', 'apps.installOpen', 'files.clipboard.write', 'files.network.connect', 'files.network.scan',
    'files.properties', 'files.preview', 'files.thumbnail', 'monitor.read', 'network.connections',
    'diagnostics.export', 'androidDiagnostics.exportLog', 'settings.exportFolder']
  const pending = requests.map(type => requestExitOperation[type])
  assert.ok(pending.every(Boolean))
  const s = idle(); s.backup = { status: 'running' }
  assert.deepEqual(collectExitOperations(s, pending), [...new Set(pending)].map(key => labels[key]))
  assert.equal(requestExitOperation.snapshot, null)
  assert.equal(requestExitOperation['apps.cancelBackup'], null)
  assert.equal(requestExitOperation['files.thumbnail.cancel'], null)
})

test('Keep working leaves operations untouched; a later close can be confirmed', async () => {
  let confirmations = 0, stops = 0, exits = 0
  const close = new CloseCoordinator(() => ['Backup'], async () => ++confirmations > 1,
    async () => { stops++ }, () => { exits++ }, async () => assert.fail('Unexpected error'))
  await close.request(); assert.equal(stops, 0); assert.equal(exits, 0); assert.equal(close.ready, false)
  await close.request(); assert.equal(stops, 1); assert.equal(exits, 1); assert.equal(close.ready, true)
})

test('repeated close/quit coalesce and the window is kept until cleanup finishes', async () => {
  const answer = deferred(), stopped = deferred()
  let prompts = 0, stops = 0, exits = 0
  const close = new CloseCoordinator(() => ['Copy'], () => { prompts++; return answer.promise },
    () => { stops++; return stopped.promise }, () => { exits++ }, async () => {})
  const first = close.request()
  assert.equal(close.request(), first); assert.equal(prompts, 1)
  answer.resolve(true); await Promise.resolve()
  assert.equal(stops, 1); assert.equal(exits, 0); assert.equal(close.ready, false)
  assert.equal(close.request(), first)
  stopped.resolve(); await first
  assert.equal(exits, 1); await close.request(); assert.equal(exits, 1)
})

test('new operation categories during a prompt require updated consent', async () => {
  const firstAnswer = deferred(), shown = []
  let active = ['Copy'], stops = 0
  const close = new CloseCoordinator(() => active, items => { shown.push(items); return shown.length === 1 ? firstAnswer.promise : Promise.resolve(false) },
    async () => { stops++ }, () => assert.fail('Must stay open'), async () => {})
  const closing = close.request(); active = ['Copy', 'Install']; firstAnswer.resolve(true); await closing
  assert.deepEqual(shown, [['Copy'], ['Copy', 'Install']]); assert.equal(stops, 0)
})

test('completed operations do not cause a redundant confirmation', async () => {
  let active = ['Copy'], prompts = 0, exits = 0
  const close = new CloseCoordinator(() => active, async () => { prompts++; active = []; return true },
    async () => {}, () => { exits++ }, async () => {})
  await close.request(); assert.equal(prompts, 1); assert.equal(exits, 1)
})

test('idle close needs no prompt but still awaits cleanup', async () => {
  const events = []
  const close = new CloseCoordinator(() => [], async () => assert.fail('No prompt at idle'),
    async () => { events.push('cleanup') }, () => events.push('exit'), async () => {})
  await close.request(); assert.deepEqual(events, ['cleanup', 'exit'])
})

test('prompt failure never grants permission to interrupt work', async () => {
  const errors = []
  const close = new CloseCoordinator(() => ['Backup'], async () => { throw new Error('Dialog failed') },
    async () => assert.fail('Must not cancel'), () => assert.fail('Must not exit'), async error => { errors.push(error.message); throw new Error('Log unavailable') })
  await close.request(); assert.equal(close.ready, false); assert.deepEqual(errors, ['Dialog failed'])
})

test('cleanup failures are reported and do not leave the application stuck in closing', async () => {
  const events = []
  const close = new CloseCoordinator(() => [], async () => true,
    async () => { throw new Error('Cleanup failed') }, () => events.push('exit'), async error => { events.push(error.message) })
  await close.request(); assert.deepEqual(events, ['Cleanup failed', 'exit']); assert.equal(close.ready, true)
})
