import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import yazl from 'yazl'
import { AndroidDiagnosticsService, parseLogcat } from '../dist-electron/android-diagnostics.js'
import { parseBatteryUsage } from '../dist-electron/battery-usage.js'

const target = { id: 'wifi:PHONE', serial: '192.168.1.7:40000', transportId: '7' }
const ok = stdout => ({ stdout, stderr: '', code: 0 })
const log = '--------- beginning of main\n10-13 09:20:00.001  123  125 E AndroidRuntime: FATAL EXCEPTION: main\n10-13 09:20:00.002  123  125 E AndroidRuntime: at com.example.Main.open(Main.java:1)\n10-13 09:20:00.003  444  445 I App: hello'
const battery = ['9,0,i,vers,36,219,15,15', '9,0,i,uid,10123,com.example.one', '9,0,i,uid,10123,com.example.shared', '9,0,i,uid,1010123,com.example.work', '9,10123,l,pwi,uid,12.5,0,0,0', '9,10123,l,awl,40000,12000', '9,10123,l,wl,partial tag,0,f,0,-1,-1,-1,18000,p,3,0,15000,18000,5000,bp,1,0,5000,5000,0,w,0,-1,-1,-1', '9,10123,l,wua,"alarm,tag",4', '9,10123,l,wua,second,2', '9,10123,l,apk,6,com.example.one,service1,1,1,1', '9,10123,l,apk,6,com.example.one,service2,1,1,1', '9,1010123,l,pwi,uid,0', '9,10123,u,pwi,uid,99', '9,0,l,pwi,screen,22'].join('\n')
function fixture(options = {}) {
  const connection = { busy: false, devices: [{ ...target, name: 'Phone', hardwareId: 'PHONE', status: 'connected' }] }, calls = [], events = []
  const runner = async (file, args, timeout, input, env, config) => { calls.push({ file, args, timeout, config }); return options.run ? options.run(args, config) : ok(args.includes('batterystats') ? battery : log) }
  const service = new AndroidDiagnosticsService(() => 'adb.exe', () => connection, e => events.push(e), options.save || (async () => null), runner)
  return { service, connection, calls, events }
}
async function directory(t) {
  await mkdir('desktop-test-results', { recursive: true })
  const root = await mkdtemp(path.resolve('desktop-test-results/android-diagnostics-'))
  t.after(async () => { assert.equal(path.dirname(root), path.resolve('desktop-test-results')); await rm(root, { recursive: true, force: true }) })
  return root
}
async function zip(file, name = 'bugreport-phone.txt') {
  const archive = new yazl.ZipFile(); archive.addBuffer(Buffer.from('Android system diagnostic report'), name)
  const saving = pipeline(archive.outputStream, createWriteStream(file)); archive.end(); await saving
}

test('battery usage preserves shared UID, profiles, estimates and independent wake metrics without counting apk services twice', () => {
  const result = parseBatteryUsage(battery), first = result.rows[0]
  assert.equal(result.rows.length, 2); assert.equal(first.uid, 10123); assert.equal(first.estimatedMah, 12.5)
  assert.deepEqual(first.packages, ['com.example.one', 'com.example.shared'])
  assert.equal(first.partialMs, 40000); assert.equal(first.backgroundMs, 12000); assert.equal(first.wakeups, 6)
  assert.deepEqual(first.wakelocks, [{ name: 'partial tag', milliseconds: 18000, count: 3 }])
  assert.equal(first.alarms[0].name, 'alarm,tag'); assert.equal(result.rows[1].estimatedMah, 0)
  assert.equal(result.rows[1].wakeups, null); assert.equal(result.rows[1].uid, 1010123)
})
test('unsupported and denied battery output is explicit; missing aggregates never become zero or sums of overlapping locks', () => {
  assert.throws(() => parseBatteryUsage('Permission Denial: not allowed'), /did not return/)
  assert.throws(() => parseBatteryUsage('10,0,i,vers,1,2,3'), /not supported/)
  const data = parseBatteryUsage('9,10123,l,wl,A,10,f,1,800,p,2,0,w,0\n9,10123,l,wl,B,0,f,0,900,p,1,0,w,0')
  assert.equal(data.rows[0].partialMs, null); assert.equal(data.rows[0].estimatedMah, null)
  assert.equal(data.rows[0].wakelocks.length, 2); assert.match(data.issues.join(' '), /overlap/)
  const empty = parseBatteryUsage('9,0,i,vers,36,219,15,15'); assert.equal(empty.rows.length, 0); assert.ok(empty.issues.length)
})
test('logcat parses severity and multiline traces, retains unstructured records and bounds visible rows', () => {
  assert.equal(parseLogcat(log)[0].level, 'E'); assert.equal(parseLogcat(log)[1].pid, '123')
  assert.equal(parseLogcat('unstructured text')[0].message, 'unstructured text')
  const many = parseLogcat(Array.from({ length: 2100 }, (_, i) => `line ${i}`).join('\n'))
  assert.equal(many.length, 2000); assert.equal(many[0].message, 'line 100')
})
test('collectors do nothing before Start and use read-only commands pinned to the exact transport', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0)
  f.service.start('logcat', target, 'crash'); await f.service.wait()
  assert.deepEqual(f.calls[0].args, ['-t', '7', 'logcat', '-d', '-t', '2000', '-v', 'threadtime', '-b', 'crash', '*:V'])
  assert.equal(f.service.state.logcat.lines.length, 3); assert.equal(f.service.state.job.status, 'success')
  f.service.start('battery', target); await f.service.wait()
  assert.deepEqual(f.calls[1].args, ['-t', '7', 'shell', 'dumpsys', 'batterystats', '--charged', '--checkin'])
  assert.equal(f.service.state.battery.rows.length, 2)
})
test('stale target and unauthorized phone never issue diagnostic commands', () => {
  const f = fixture(); assert.throws(() => f.service.start('logcat', { ...target, transportId: '8' }), /changed/)
  f.connection.devices[0].status = 'unauthorized'; assert.throws(() => f.service.start('battery', target), /Connect/)
  assert.equal(f.calls.length, 0)
})
test('transport changes abort collection and discard late output', async () => {
  let release
  const f = fixture({ run: async () => new Promise(resolve => { release = () => resolve(ok(log)) }) })
  f.service.start('logcat', target); await new Promise(resolve => setImmediate(resolve))
  f.connection.devices[0].transportId = '8'; f.service.contextChanged(); release(); await f.service.wait()
  assert.equal(f.calls[0].config.signal.aborted, true); assert.equal(f.service.state.logcat, null)
  assert.equal(f.service.state.job.status, 'error'); assert.match(f.service.state.job.message, /connection changed/)
})
test('cancellation prevents overlaps, uses the operation ID and allows an explicit retry', async () => {
  const f = fixture({ run: async (_args, config) => new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) })
  f.service.start('battery', target); await new Promise(resolve => setImmediate(resolve))
  assert.throws(() => f.service.start('logcat', target), /Finish or cancel/)
  f.service.cancel('old-id'); assert.equal(f.calls[0].config.signal.aborted, false)
  f.service.cancel(f.service.state.job.id); await f.service.wait()
  assert.equal(f.service.state.job.status, 'cancelled'); assert.equal(f.service.busy, false)
  f.service.start('battery', target); await new Promise(resolve => setImmediate(resolve)); await f.service.shutdown()
  assert.equal(f.calls.length, 2); assert.equal(f.service.busy, false)
})
test('command refusal and timeout stay failures without a success log or a fabricated empty snapshot', async () => {
  for (const run of [async () => ({ ...ok(''), code: 1, stderr: 'Access denied' }), async () => { throw new Error('Command timed out.') }]) {
    const f = fixture({ run }); f.service.start('logcat', target); await f.service.wait()
    assert.equal(f.service.state.job.status, 'error'); assert.equal(f.service.state.logcat, null)
    assert.equal(f.events.some(e => e.type === 'activity' && e.tone === 'success'), false)
  }
})
test('cancelled or stale save picker never starts a bug report', async () => {
  const f = fixture(); f.service.start('bugreport', target); await f.service.wait(); assert.equal(f.calls.length, 0)
  assert.equal(f.service.state.job.status, 'cancelled')
  const g = fixture({ save: async () => { g.connection.devices[0].transportId = '9'; return 'report.zip' } })
  g.service.start('bugreport', target); await g.service.wait(); assert.equal(g.calls.length, 0); assert.equal(g.service.state.job.status, 'error')
})
test('bug report replaces the chosen file only after receiving a valid archive and clears temporary files', async t => {
  const root = await directory(t), file = path.join(root, 'chosen.zip'); await writeFile(file, 'old report')
  const f = fixture({ save: async () => file, run: async args => { await zip(args.at(-1)); return ok('report generated') } })
  f.service.start('bugreport', target); await f.service.wait()
  assert.equal(f.service.state.job.status, 'success'); assert.deepEqual(f.calls[0].args.slice(0, 3), ['-t', '7', 'bugreport'])
  assert.equal((await readFile(file)).readUInt32LE(0), 0x04034b50)
  assert.deepEqual(await readdir(root), ['chosen.zip']); assert.equal(f.service.reportPath(f.service.state.job.id), file)
  assert.throws(() => f.service.reportPath('old-id'), /No saved/)
})
test('invalid or unrelated ZIP report does not overwrite an existing report', async t => {
  const root = await directory(t), file = path.join(root, 'chosen.zip'); await writeFile(file, 'keep this')
  for (const make of [p => writeFile(p, 'partial'), p => zip(p, 'unrelated.txt')]) {
    const f = fixture({ save: async () => file, run: async args => { await make(args.at(-1)); return ok('') } })
    f.service.start('bugreport', target); await f.service.wait()
    assert.equal(f.service.state.job.status, 'error'); assert.equal(await readFile(file, 'utf8'), 'keep this'); assert.deepEqual(await readdir(root), ['chosen.zip'])
  }
})
test('cancelled bug report cleans its partial output and never overwrites the destination', async t => {
  const root = await directory(t), file = path.join(root, 'chosen.zip'); await writeFile(file, 'keep this')
  let started
  const ready = new Promise(resolve => { started = resolve })
  const f = fixture({ save: async () => file, run: async (args, config) => { await writeFile(args.at(-1), 'partial'); started(); return new Promise((_resolve, reject) => config.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) } })
  f.service.start('bugreport', target); await ready; f.service.cancel(f.service.state.job.id); await f.service.wait()
  assert.equal(f.service.state.job.status, 'cancelled'); assert.match(f.service.state.job.message, /Android may continue/)
  assert.equal(await readFile(file, 'utf8'), 'keep this'); assert.deepEqual(await readdir(root), ['chosen.zip'])
})
test('log export saves the captured snapshot without further ADB access and rejects a stale snapshot token', async t => {
  const root = await directory(t), file = path.join(root, 'log.txt')
  const f = fixture({ save: async () => file }); f.service.start('logcat', target); await f.service.wait()
  await assert.rejects(f.service.exportLog('old'), /snapshot changed/)
  await f.service.exportLog(f.service.state.logcat.capturedAt)
  assert.match(await readFile(file, 'utf8'), /FATAL EXCEPTION/); assert.equal(f.calls.length, 1); assert.deepEqual(await readdir(root), ['log.txt'])
})
