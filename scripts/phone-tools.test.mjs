import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PhoneToolsService } from '../dist-electron/phone-tools.js'
import { parsePhoneToolsOutput, formatPhoneExport } from '../dist-electron/phone-tools-output.js'
import { validatePhoneToolsRequest, validatePhoneText } from '../dist-electron/phone-tools-protocol.js'
import { collectExitOperations, requestExitOperation } from '../dist-electron/exit-operations.js'
import { target, contacts, calls, sms, response, sampleText } from './fixtures/phone-tools.mjs'

const helper = path.resolve('android-helper/dist')
const digest = JSON.parse(await readFile(path.join(helper, 'helper-manifest.json'), 'utf8')).sha256
const read = { type: 'phoneTools.read', kind: 'contacts', target, range: {} }
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
function fixture(options = {}) {
  const connection = { busy: false, activeDeviceId: 'phone', devices: [{ ...target, name: 'Test phone', status: 'connected', hardwareId: 'phone-1' }] }
  const commands = [], events = [], saves = []
  const service = new PhoneToolsService(options.helper || helper, () => 'adb.exe', () => connection, event => events.push(event),
    async (...args) => { saves.push(args); return options.save ? options.save(...args) : null },
    async (file, args, timeout, input, env, config) => {
      commands.push({ file, args, input, timeout, config })
      assert.deepEqual(args.slice(0, 2), ['-t', '7'])
      let stdout = ''
      if (args.includes('ro.build.version.sdk')) stdout = String(options.sdk ?? 36)
      else if (args.includes('get-current-user')) stdout = '0'
      else if (args.at(-1).includes('app_process')) {
        if (options.collect) return options.collect({ args, input, config })
        const operation = args.at(-1).split('PhoneTools ')[1].split(' ')[0]
        stdout = response(operation)
        config.onStdout?.(stdout)
      } else if (args.at(-1).includes('if [ -f')) stdout = options.upload ? '' : digest + '  helper.jar'
      else if (args.includes('sha256sum')) stdout = (options.badUpload ? 'WRONG' : digest) + '  helper.jar'
      else assert.ok(args.includes('push') || args.at(-1).includes('mkdir -p') || args.at(-1).includes('chmod 444'), args.join(' '))
      return { stdout, stderr: '', code: 0 }
    })
  return { service, connection, commands, events, saves }
}
const snapshot = (kind, rows) => ({ id: '00000000-0000-4000-8000-000000000001', kind, rows, target, deviceName: '<Phone>', userId: 0, capturedAt: '2026-10-20T10:00:00Z', range: {} })

test('complete protocol preserves Unicode, multiline SMS and native rich vCards', () => {
  for (const [kind, rows] of Object.entries({ contacts, calls, sms })) assert.deepEqual(parsePhoneToolsOutput(response(kind), kind, 0).rows, rows)
  assert.equal(parsePhoneToolsOutput(response('clipboard-read'), 'clipboard-read', 0).clipboard, sampleText)
  assert.equal(parsePhoneToolsOutput(response('clipboard-read', { text: '' }), 'clipboard-read', 0).clipboard, '')
  assert.deepEqual(parsePhoneToolsOutput(response('contacts', { rows: [] }), 'contacts', 0).rows, [])
})
test('partial, mismatched, duplicate, unverified and malformed replies never become data', () => {
  const valid = response('contacts')
  for (const data of [
    valid.replace(/{"type":"done".*\n$/, ''), valid.replace('"count":2', '"count":1'),
    valid.replace('"userId":0', '"userId":10'), valid.replace('"protocol":1', '"protocol":2'),
    response('contacts', { rows: [contacts[0], contacts[0]] }), response('contacts', { rows: sms }),
    valid + '{"type":"record"}\n', '{"type":"record"}\n', '{broken',
  ]) assert.throws(() => parsePhoneToolsOutput(data, 'contacts', 0))
  assert.throws(() => parsePhoneToolsOutput(response('clipboard-write').replace('"verified":true', '"verified":false'), 'clipboard-write', 0), /confirm/)
  assert.throws(() => parsePhoneToolsOutput(response('clipboard-read', { text: '😀'.repeat(70000) }), 'clipboard-read', 0))
  assert.throws(() => parsePhoneToolsOutput('{"type":"error","message":"Android access denied."}\n', 'sms', 0), /access denied/)
})
test('export escapes CSV formulas and HTML but preserves original JSON and vCard fields', () => {
  const csv = formatPhoneExport(snapshot('contacts', contacts), contacts, 'csv')
  assert.ok(csv.startsWith('\ufeff')); assert.ok(csv.includes("\"'=SUM(1,2)\"")); assert.ok(csv.includes('"Ирина, ""Work"""'))
  assert.ok(csv.includes("\"'+79001234567\n+79007654321\""))
  const vcf = formatPhoneExport(snapshot('contacts', contacts), contacts, 'vcf')
  assert.equal(vcf.match(/BEGIN:VCARD/g).length, 2); assert.ok(vcf.includes('BDAY:1990-01-02\r\n')); assert.ok(!/(?<!\r)\n/.test(vcf))
  const json = JSON.parse(formatPhoneExport(snapshot('sms', sms), sms, 'json'))
  assert.deepEqual(json.records, sms); assert.equal(json.recordCount, 1)
  const html = formatPhoneExport(snapshot('sms', sms), sms, 'html')
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes('&lt;Phone&gt;'))
  assert.ok(html.includes('Привет 👋\n')); assert.ok(html.includes("default-src 'none'"))
  const callCsv = formatPhoneExport(snapshot('calls', calls), calls, 'csv')
  assert.ok(callCsv.includes('"42","Incoming","SIM 1"'))
})
test('invalid input and stale targets are rejected before any ADB command', () => {
  const f = fixture()
  for (const patch of [{ range: { from: 10, to: 5 } }, { kind: 'contacts', range: { from: 1 } }, { range: { from: -1 } }, { kind: 'mms' }, { target: { ...target, transportId: '-s OTHER' } }]) assert.throws(() => f.service.read({ ...read, ...patch }))
  assert.throws(() => f.service.read({ ...read, target: { ...target, serial: 'OTHER' } }), /changed/)
  for (const text of [null, 'a\0b', '😀'.repeat(70000)]) assert.throws(() => validatePhoneText(text))
  for (const ids of [[], ['1', '1'], ['not-id']]) assert.throws(() => validatePhoneToolsRequest({ type: 'phoneTools.export', snapshotId: snapshot('sms', sms).id, ids, format: 'json' }))
  assert.equal(f.commands.length, 0)
})
test('read verifies helper and current user, publishes progress and logs no personal content', async () => {
  const f = fixture({ upload: true })
  f.service.read(read); await f.service.wait()
  assert.equal(f.service.state.job.status, 'success'); assert.deepEqual(f.service.state.data.rows, contacts)
  assert.equal(f.service.state.job.completed, 2); assert.equal(f.service.state.data.userId, 0)
  assert.ok(f.commands.some(c => c.args.includes('push')))
  assert.ok(f.events.filter(e => e.type === 'phoneTools').length >= 3)
  assert.ok(!JSON.stringify(f.events.filter(e => e.type === 'activity')).includes('Ирина'))
})
test('integrity mismatch and unsupported Android cannot start a provider query', async () => {
  for (const options of [{ upload: true, badUpload: true }, { sdk: 25 }]) {
    const f = fixture(options); f.service.read(read); await f.service.wait()
    assert.equal(f.service.state.job.status, 'error'); assert.equal(f.service.state.data, null)
    assert.ok(!f.commands.some(c => c.args.at(-1).includes('app_process')))
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'adb-vault-phone-integrity-'))
  await writeFile(path.join(directory, 'helper-manifest.json'), JSON.stringify({ protocolVersion: 1, helperVersion: '0.1.0', sha256: 'wrong' }))
  await writeFile(path.join(directory, 'manager-server.jar'), 'test')
  const f = fixture({ helper: directory }); f.service.read(read); await f.service.wait()
  assert.match(f.service.state.job.message, /verification/); assert.equal(f.commands.length, 0)
})
test('clipboard text only travels through stdin and Android must verify writes', async () => {
  const f = fixture()
  f.service.clipboard({ type: 'phoneTools.clipboard.write', target, text: sampleText }); await f.service.wait()
  assert.equal(f.service.state.job.status, 'success')
  const command = f.commands.at(-1)
  assert.equal(JSON.parse(command.input).text, sampleText)
  assert.ok(!JSON.stringify(command.args).includes('Привет'))
  f.service.clipboard({ type: 'phoneTools.clipboard.read', target }); await f.service.wait()
  assert.equal(f.service.state.clipboard.text, sampleText)
  const bad = fixture({ collect: async () => ({ stdout: response('clipboard-write').replace('"verified":true', '"verified":false'), stderr: '', code: 0 }) })
  bad.service.clipboard({ type: 'phoneTools.clipboard.write', target, text: 'test' }); await bad.service.wait()
  assert.equal(bad.service.state.job.status, 'error')
})
test('permission denial clears an earlier snapshot and is not reported as empty data', async () => {
  let denied = false
  const f = fixture({ collect: async () => ({ stdout: denied ? '{"type":"error","message":"Android access denied."}\n' : response('contacts'), stderr: 'private diagnostic', code: denied ? 1 : 0 }) })
  f.service.read(read); await f.service.wait(); assert.equal(f.service.state.data.rows.length, 2)
  denied = true; f.service.read(read); await f.service.wait()
  assert.equal(f.service.state.data, null); assert.equal(f.service.state.job.status, 'error'); assert.match(f.service.state.job.message, /access denied/)
  assert.ok(!JSON.stringify(f.events.filter(e => e.type === 'activity')).includes('private diagnostic'))
})
test('device replacement cancels without redirecting, while active selection is independent', async () => {
  const started = deferred(), finished = deferred()
  let signal
  const f = fixture({ collect: async ({ config }) => { signal = config.signal; started.resolve(); await finished.promise; return { stdout: response('contacts'), stderr: '', code: 0 } } })
  f.service.read(read); await started.promise
  f.connection.activeDeviceId = 'other'; f.service.contextChanged(); assert.equal(signal.aborted, false)
  f.connection.devices[0].transportId = '8'; f.service.contextChanged(); assert.equal(signal.aborted, true)
  finished.resolve(); await f.service.wait()
  assert.equal(f.service.state.data, null); assert.equal(f.service.state.job.status, 'error'); assert.match(f.service.state.job.message, /connection changed/)
})
test('cancel and shutdown wait for the helper and never publish partial records', async () => {
  for (const shutdown of [false, true]) {
    const started = deferred()
    const f = fixture({ collect: ({ config }) => new Promise((resolve, reject) => {
      started.resolve(); config.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    f.service.read(read); await started.promise
    assert.throws(() => f.service.read(read), /current/); assert.throws(() => f.service.clear(), /current/)
    f.service.cancel('old-id'); assert.equal(f.service.state.job.status, 'running')
    if (shutdown) await f.service.shutdown()
    else { f.service.cancel(f.service.state.job.id); await f.service.wait() }
    assert.equal(f.service.state.job.status, 'cancelled'); assert.equal(f.service.state.data, null); assert.equal(f.service.busy, false)
    if (shutdown) assert.throws(() => f.service.read(read), /closing/)
  }
})
test('selected local export still works after disconnection, with no extra ADB commands', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'adb-vault-phone-export-')), destination = path.join(directory, 'contacts.vcf')
  const f = fixture({ save: async () => destination })
  f.service.read(read); await f.service.wait()
  const snapshotId = f.service.state.data.id, count = f.commands.length
  for (const patch of [{ ids: ['99'] }, { format: 'html' }, { snapshotId: snapshot('sms', sms).id }]) assert.throws(() => f.service.export({ type: 'phoneTools.export', snapshotId, ids: ['1'], format: 'vcf', ...patch }))
  assert.equal(f.saves.length, 0)
  f.connection.devices = []
  f.service.export({ type: 'phoneTools.export', snapshotId, ids: ['1'], format: 'vcf' }); await f.service.wait()
  assert.equal(f.service.state.job.status, 'success'); assert.equal(await readFile(destination, 'utf8'), contacts[0].vcard)
  assert.equal(f.commands.length, count); assert.equal(f.service.savedPath(f.service.state.job.id), destination)
  assert.deepEqual(await readdir(directory), ['contacts.vcf'])
})
test('cancelling a pending save preserves an existing destination and leaves no temporary files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'adb-vault-phone-cancel-')), destination = path.join(directory, 'contacts.csv'), selected = deferred()
  await writeFile(destination, 'original')
  const f = fixture({ save: () => selected.promise })
  f.service.read(read); await f.service.wait()
  f.service.export({ type: 'phoneTools.export', snapshotId: f.service.state.data.id, ids: 'all', format: 'csv' })
  await Promise.resolve(); f.service.cancel(f.service.state.job.id); selected.resolve(destination); await f.service.wait()
  assert.equal(await readFile(destination, 'utf8'), 'original'); assert.equal(f.service.state.job.status, 'cancelled')
  assert.deepEqual(await readdir(directory), ['contacts.csv'])
})
test('phone work participates in the existing exit prompt', () => {
  const state = { apps: { status: 'idle' }, connection: { busy: false, devices: [] }, phoneTools: { job: { status: 'running' } } }
  assert.ok(collectExitOperations(state).some(label => /Clipboard|phone/.test(label)))
  assert.ok(requestExitOperation['phoneTools.export'])
  state.phoneTools.job.status = 'success'; assert.deepEqual(collectExitOperations(state), [])
})
