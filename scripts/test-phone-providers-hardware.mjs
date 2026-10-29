// Explicit opt-in, pinned transport. Reports statuses/counts only; never saves phone records.
// --read-records additionally exercises the production collector and both export formats in memory.
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { run, checked } from '../dist-electron/process.js'
import { parseDevices } from '../dist-electron/connections.js'
import { parsePhoneToolsOutput, formatPhoneExport } from '../dist-electron/phone-tools-output.js'
import { phoneExportFormats } from '../dist-electron/phone-tools-protocol.js'

async function main() {
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
  const root = await mkdtemp(path.resolve('desktop-test-results/phone-providers-'))
  await mkdir(path.join(root, 'classes')); await mkdir(path.join(root, 'dex'))
  checked(await run(tools.javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', tools.android, '-cp', 'android-helper/build/classes.jar', '-d', path.join(root, 'classes'), 'android-helper/tests/dev/adbvault/helper/PhoneProvidersProbe.java'], 30000))
  checked(await run(tools.jar, ['cf', path.join(root, 'probe-classes.jar'), '-C', path.join(root, 'classes'), '.'], 30000))
  checked(await run(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', tools.android, '--output', path.join(root, 'dex/probe.jar'), 'android-helper/build/classes.jar', path.join(root, 'probe-classes.jar')], 30000))
  const remote = `/data/local/tmp/adb-vault-providers-probe-${randomUUID()}.jar`
  async function upload(local) {
    checked(await run(adb, [...selector, 'push', local, remote], 30000))
    const expected = createHash('sha256').update(await readFile(local)).digest('hex')
    assert.equal(checked(await run(adb, [...selector, 'shell', 'sha256sum', remote])).split(/\s+/)[0], expected)
  }
  try {
    await upload(path.join(root, 'dex/probe.jar'))
    const probe = await run(adb, [...selector, 'shell', '-T', `CLASSPATH=${remote} app_process / dev.adbvault.helper.PhoneProvidersProbe ${currentUser}`], 30000)
    const report = JSON.parse(probe.stdout.split(/\r?\n/).find(line => line.startsWith('{')) || '{}')
    await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    assert.equal(probe.code, 0, 'Provider attribution probe failed.')
    for (const kind of ['contacts', 'calls', 'sms']) assert.equal(report[kind]?.after, 'allowed')
    assert.equal(report.clipboardAccess, 'allowed')

    if (process.argv.includes('--read-records')) {
      // Use the actual distributable JAR for full collection, not the probe's combined classes.
      await upload(path.resolve('android-helper/dist/manager-server.jar'))
      const to = Date.now(), from = to - 7 * 86400000
      report.production = {}
      for (const kind of ['contacts', 'calls', 'sms']) {
        const rangeArgs = kind === 'contacts' ? '' : ` ${from} ${to}`
        const result = await run(adb, [...selector, 'shell', '-T', `CLASSPATH=${remote} app_process / dev.adbvault.helper.PhoneTools ${kind} ${currentUser}${rangeArgs}`], 120000, undefined, undefined, { maxOutputBytes: 64000000 })
        // Do not call checked(): an error could otherwise include collected personal rows.
        const parsed = parsePhoneToolsOutput(result.stdout, kind, Number(currentUser))
        assert.equal(result.code, 0, `${kind} collector did not finish successfully.`)
        const snapshot = { id: randomUUID(), kind, target: { id: 'probe', serial, transportId: device.transportId }, deviceName: 'Hardware test', userId: Number(currentUser), capturedAt: new Date().toISOString(), range: kind === 'contacts' ? {} : { from, to }, rows: parsed.rows }
        const formats = {}
        for (const format of phoneExportFormats[kind]) {
          const output = formatPhoneExport(snapshot, parsed.rows, format)
          assert.ok(typeof output === 'string', `${kind}/${format} did not produce text.`)
          if (format === 'json') assert.equal(JSON.parse(output).recordCount, parsed.rows.length)
          if (format === 'vcf') assert.equal((output.match(/BEGIN:VCARD/g) || []).length, parsed.rows.length)
          formats[format] = 'passed'
        }
        report.production[kind] = { status: 'passed', count: parsed.rows.length, formats }
        console.log(JSON.stringify({ kind, ...report.production[kind] }))
        parsed.rows.length = 0
        result.stdout = ''; result.stderr = ''
        await writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2))
      }
    }
    console.log(root)
  } finally {
    checked(await run(adb, [...selector, 'shell', 'rm', '-f', remote]))
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
