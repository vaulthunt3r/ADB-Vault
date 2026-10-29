// Opt-in hardware benchmark. Never installs/stops apps or changes the ADB server.
// Uses one exclusive temporary directory on shared storage for staged transfers.
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { AdbLifecycle } from '../dist-electron/adb-lifecycle.js'
import { checked } from '../dist-electron/process.js'
import { parseDevices } from '../dist-electron/connections.js'
import { archiveStreamCommand, finalizeArchiveStream } from '../dist-electron/app-data-backup.js'

const [serial, identity, repeatText = '3', profile = 'methods'] = process.argv.slice(2)
const repeats = Number(repeatText)
if (!serial || !identity || !Number.isInteger(repeats) || repeats < 1 || repeats > 5 || !['methods', 'compression'].includes(profile)) throw new Error('Usage: node scripts/benchmark-apk-transfer.mjs SERIAL HARDWARE_ID [1..5 rounds] [methods|compression]')
const runId = randomUUID(), quote = value => `'${value.replace(/'/g, `'\\''`)}'`
const root = path.resolve('desktop-test-results', 'apk-transfer-benchmark', runId)
await fs.mkdir(root, { recursive: true })
const config = JSON.parse(await fs.readFile(path.join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'))
const adb = path.join(config.paths.adb, 'adb.exe'), life = new AdbLifecycle()
const report = { runId, profile, startedAt: new Date().toISOString(), serial, identity, repeats, adbVersion: '', model: '', method: '', samples: [], trials: [], summary: [], cleanup: [], notes: [
  'One connected transport, sequential transfers, rotated method order, no app/data changes or root request.',
  'Pull default and -Z compared; exec-out is an uncompressed binary stream with a checked exit-status trailer.',
  'Every successful transfer is verified against a fresh device SHA-256; checksums warm source filesystem caches.',
  'Transfer time excludes checksums and staging. Verified total includes device hash, staging, transfer, local hash and stage-file removal; excludes path discovery and report writes.',
  'APK files only; this benchmark does not measure APKS packaging, private data or full batch UI overhead.',
] }
const reportFile = path.join(root, 'report.json')
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n')
let args, createdStage = false, stopped = false
const stageDirectory = `/sdcard/.adb-vault-benchmark-${runId}`, stageFile = `${stageDirectory}/sample.apk`
process.on('SIGINT', () => { stopped = true; console.log('Stopping after the current transfer and cleanup.') })
const elapsed = start => Math.round((performance.now() - start) * 10) / 10
async function command(commandArgs, options) {
  const result = await life.runner(adb, [...args, ...commandArgs], 180000, undefined, undefined, options)
  checked(result)
  return result
}
async function shell(script, options) { return (await command(['shell', '-T', script], options)).stdout.trim() }
async function confirmIdentity() {
  if (await shell('getprop ro.serialno') !== identity) throw new Error('The selected hardware identity changed; benchmark stopped.')
}
async function deviceDigest(source) {
  const result = await shell(`sha256sum ${quote(source)}`)
  const sha = result.match(/^([a-f0-9]{64})\s/i)?.[1]?.toLowerCase()
  if (!sha) throw new Error('Device did not return a SHA-256 digest.')
  return sha
}
async function localDigest(file) {
  const hash = createHash('sha256'); let bytes = 0
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length }
  return { bytes, sha256: hash.digest('hex') }
}
const methods = profile === 'compression' ? ['pull-default', 'pull-uncompressed', 'pull-zstd', 'pull-lz4'] : ['pull-default', 'pull-uncompressed', 'staged-default', 'staged-uncompressed', 'exec-out']
const median = values => { const v = [...values].sort((a, b) => a - b); return v.length % 2 ? v[Math.floor(v.length / 2)] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2 }
try {
  report.adbVersion = checked(await life.runner(adb, ['version'], 5000))
  const device = parseDevices(checked(await life.runner(adb, ['devices', '-l'], 5000))).find(d => d.serial === serial && d.status === 'connected')
  if (!device?.transportId) throw new Error('Selected device has no connected transport.')
  args = ['-t', device.transportId]
  await confirmIdentity()
  report.model = await shell('getprop ro.product.model')
  report.method = device.method
  if (await shell('am get-current-user') !== '0') throw new Error('Benchmark expects Android user 0.')
  const candidates = [
    { name: 'system-large', packageName: 'com.android.systemui', filename: null },
    ...(profile === 'compression' ? [{ name: 'split-native-large', packageName: 'com.google.android.youtube', filename: 'split_config.arm64_v8a.apk' }] : [
      { name: 'split-small', packageName: 'com.google.android.youtube', filename: 'split_config.ru.apk' },
      { name: 'vendor-denied', packageName: 'com.jiiov.fingerprint_factorytest', filename: null },
    ]),
  ]
  for (const candidate of candidates) {
    const paths = (await shell(`pm path --user 0 ${quote(candidate.packageName)}`)).split(/\r?\n/).filter(v => v.startsWith('package:')).map(v => v.slice(8))
    const source = candidate.filename ? paths.find(p => p.endsWith('/' + candidate.filename)) : paths[0]
    if (!source || !source.startsWith('/') || !source.endsWith('.apk') || /[\r\n\x00]/.test(source)) throw new Error(`Missing source for ${candidate.name}`)
    const bytes = Number(await shell(`stat -c %s ${quote(source)}`))
    if (!Number.isSafeInteger(bytes) || bytes < 4 || bytes > 256 * 1024 * 1024) throw new Error('Unexpected APK size.')
    report.samples.push({ ...candidate, source, bytes, sha256: await deviceDigest(source) })
  }
  // mkdir without -p refuses an existing path. Cleanup only touches sample.apk and this directory.
  if (methods.some(m => m.startsWith('staged-'))) {
    await shell(`mkdir ${quote(stageDirectory)}`); createdStage = true
    report.stagingDirectory = stageDirectory
  }
  await save()
  console.log(JSON.stringify({ phase: 'ready', reportFile, samples: report.samples.map(s => ({ name: s.name, bytes: s.bytes })) }))
  for (let round = 0; round < repeats; round++) {
    for (const sample of report.samples) {
      await confirmIdentity()
      const order = methods.map((_, i) => methods[(i + round * (methods.length === 5 ? 2 : 1)) % methods.length])
      for (const method of order) {
        if (stopped) throw new Error('Benchmark stopped by the user.')
        const file = path.join(root, `${sample.name}-${round}-${method}.apk`)
        if (path.dirname(path.resolve(file)) !== root) throw new Error('Invalid local staging path.')
        const staged = method.startsWith('staged-')
        const trial = { sample: sample.name, round: round + 1, method, bytes: sample.bytes, status: 'running', deviceChecksumMs: 0, stagingMs: 0, transferMs: 0, verificationMs: 0, cleanupMs: 0, verifiedTotalMs: 0 }
        const start = performance.now()
        try {
          let phase = performance.now()
          const expected = await deviceDigest(sample.source)
          trial.deviceChecksumMs = elapsed(phase)
          if (expected !== sample.sha256) throw new Error('Source APK changed during the benchmark.')
          if (staged) {
            phase = performance.now()
            await shell(`cp -- ${quote(sample.source)} ${quote(stageFile)}`)
            trial.stagingMs = elapsed(phase)
          }
          phase = performance.now()
          if (method === 'exec-out') {
            const token = randomUUID()
            const result = await command(['exec-out', archiveStreamCommand(`cat -- ${quote(sample.source)}`, token)], { stdoutFile: file })
            if (result.stderr.trim()) throw new Error(result.stderr)
            await finalizeArchiveStream(file, token)
          } else {
            const compression = method.endsWith('uncompressed') ? ['-Z'] : method === 'pull-zstd' ? ['-z', 'zstd'] : method === 'pull-lz4' ? ['-z', 'lz4'] : []
            const result = await command(['pull', ...compression, staged ? stageFile : sample.source, file])
            trial.adbOutput = [result.stdout, result.stderr].filter(Boolean).join('\n')
          }
          trial.transferMs = elapsed(phase)
          phase = performance.now()
          const copy = await localDigest(file)
          trial.verificationMs = elapsed(phase)
          if (copy.bytes !== sample.bytes || copy.sha256 !== expected) throw new Error('Copied bytes / SHA-256 mismatch.')
          trial.sha256 = copy.sha256
          trial.status = 'verified'
        } catch (error) {
          trial.status = 'error'; trial.error = error.message
        } finally {
          if (staged) {
            const phase = performance.now()
            try { await shell(`rm -f -- ${quote(stageFile)}`) }
            catch (error) { trial.cleanupError = error.message; stopped = true }
            trial.cleanupMs = elapsed(phase)
          }
          trial.verifiedTotalMs = elapsed(start)
          report.trials.push(trial)
          // All per-trial copies are disposable; the SHA and timings remain in report.json.
          await fs.rm(file, { force: true })
          await save()
          console.log(JSON.stringify(trial))
        }
        if (trial.status === 'error' && !/Permission denied/i.test(trial.error || '')) throw new Error(trial.error)
      }
    }
  }
  for (const sample of report.samples) {
    if (await deviceDigest(sample.source) !== sample.sha256) throw new Error('Source APK changed after transfer; comparisons are invalid.')
    for (const method of methods) {
      const trials = report.trials.filter(t => t.sample === sample.name && t.method === method)
      const ok = trials.filter(t => t.status === 'verified')
      report.summary.push({ sample: sample.name, method, verified: ok.length, failed: trials.length - ok.length, ...(ok.length ? {
        medianTransferMs: median(ok.map(t => t.transferMs)), medianVerifiedTotalMs: median(ok.map(t => t.verifiedTotalMs)),
        medianDeviceChecksumMs: median(ok.map(t => t.deviceChecksumMs)), medianStagingMs: median(ok.map(t => t.stagingMs)), medianVerificationMs: median(ok.map(t => t.verificationMs)),
        medianTransferMiBps: Math.round(sample.bytes / 1048576 / (median(ok.map(t => t.transferMs)) / 1000) * 100) / 100,
        minVerifiedTotalMs: Math.min(...ok.map(t => t.verifiedTotalMs)), maxVerifiedTotalMs: Math.max(...ok.map(t => t.verifiedTotalMs)),
      } : {}) })
    }
  }
  report.status = 'complete'
} catch (error) {
  report.status = 'error'; report.error = error.message; process.exitCode = 1
} finally {
  if (createdStage) {
    try {
      await confirmIdentity()
      await shell(`rm -f -- ${quote(stageFile)} && rmdir ${quote(stageDirectory)}`)
      report.cleanup.push({ path: stageDirectory, removed: true })
    } catch (error) { report.cleanup.push({ path: stageDirectory, removed: false, error: error.message }); process.exitCode = 1 }
  }
  report.finishedAt = new Date().toISOString()
  await save()
  console.log(JSON.stringify({ status: report.status, error: report.error, reportFile, cleanup: report.cleanup, summary: report.summary }))
  await life.shutdown(false)
}
