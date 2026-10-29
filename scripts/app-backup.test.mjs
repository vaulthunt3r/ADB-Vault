import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, writeFile, realpath, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { open as openZip } from 'yauzl'
import { AppBackupService, apkArtifactStem, parsePreset, validateBackupRequest, validatePresetName } from '../dist-electron/app-backup.js'
import { BackupCatalog } from '../dist-electron/backup-catalog.js'
import { archiveStreamCommand, finalizeArchiveStream, validateTar, planData } from '../dist-electron/app-data-backup.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'

const apk = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.from('backup fixture APK')])
const sha = createHash('sha256').update(apk).digest('hex')
const ok = stdout => ({ code: 0, stdout, stderr: '' })
const tokens = args => args[3].slice(1, -1).split("' '")
const selection = { id: 'phone', userId: 11, packages: ['org.example.one', 'org.example.two'], name: 'user', format: 'auto' }
async function fixture(options = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'adb-vault-backup-')))
  const catalogue = options.catalogue ? new BackupCatalog(path.join(root, '.catalogue')) : undefined
  await catalogue?.load()
  const connection = { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Redmi Note 14', serial: 'SERIAL', hardwareId: 'HARDWARE', transportId: '7', status: 'connected', method: options.method || 'USB' }] }
  const apps = { ...emptyApps(), status: 'ready', deviceId: 'phone', userId: 11, profiles: [{ id: 11, name: 'Work' }], apps: selection.packages.map((packageName, i) => ({ packageName, label: `App ${i}`, versionName: '1', versionCode: 1, uid: 1110001 + i, system: false, minSdk: 26, targetSdk: 35, userId: 11, enabled: true, suspended: false })) }
  const calls = [], events = []; let loadPath = null
  const service = new AppBackupService(() => 'adb.exe', () => connection, () => apps, state => { events.push(state); options.publish?.(state) }, () => {}, {
    folder: async () => options.folder ? options.folder() : root,
    presetFile: async () => loadPath,
  }, async (_file, args, _timeout, _input, _env, controls) => {
    calls.push(args); assert.deepEqual(args.slice(0, 2), ['-t', '7'])
    const override = await options.runner?.(args, controls); if (override !== undefined) return override
    if (args[2] === 'features') return ok('sendrecv_v2\nsendrecv_v2_zstd\n')
    if (args[2] === 'pull') { await writeFile(args.at(-1), options.corrupt?.(args.at(-2)) ? Buffer.from('broken') : apk); return ok('pulled') }
    const cmd = tokens(args)
    if (cmd[0] === 'pm' && cmd[1] === 'path') {
      assert.equal(cmd[3], String(apps.userId))
      return ok(`package:/data/app/${cmd[4]}/base.apk${cmd[4].endsWith('two') ? `\npackage:/data/app/${cmd[4]}/split.apk` : ''}`)
    }
    if (cmd[0] === 'sha256sum') return ok(`${sha}  ${cmd[1]}`)
    throw new Error(`Unexpected ADB command ${args}`)
  }, catalogue, undefined, () => options.zstd === true)
  return { catalogue, root, service, connection, apps, calls, events, setLoad: file => { loadPath = file } }
}
async function unzip(file) {
  const zip = await new Promise((resolve, reject) => openZip(file, { lazyEntries: true }, (error, zip) => error ? reject(error) : resolve(zip)))
  const entries = {}
  return new Promise((resolve, reject) => {
    zip.on('error', reject); zip.on('end', () => resolve(entries))
    zip.on('entry', entry => zip.openReadStream(entry, async (error, stream) => {
      if (error) { reject(error); return }
      try { const chunks = []; for await (const chunk of stream) chunks.push(chunk); entries[entry.fileName] = Buffer.concat(chunks); zip.readEntry() } catch (error) { reject(error) }
    })); zip.readEntry()
  })
}

async function reports(output) {
  const names = (await readdir(output)).filter(name => name.startsWith('manifest-') && name.endsWith('.json'))
  return Promise.all(names.map(async name => JSON.parse(await readFile(path.join(output, name), 'utf8'))))
}

test('preset saves are fixed selections, versioned, readable and never overwrite previous content', async () => {
  const f = await fixture(); await f.service.execute(selection, true)
  assert.equal(f.service.state.status, 'complete'); assert.equal(f.calls.length, 0)
  const original = f.service.state.presetPath, text = await readFile(original, 'utf8')
  const preset = parsePreset(text)
  assert.equal(path.basename(original), 'user.json')
  assert.equal(path.basename(path.dirname(original)), 'Profile 11 - Work')
  assert.match(path.basename(path.dirname(path.dirname(original))), /^Redmi Note 14-/)
  assert.deepEqual(preset.applications.map(app => app.packageName), selection.packages)
  assert.equal(preset.profile.id, 11)
  await f.service.execute({ ...selection, packages: [selection.packages[0]] }, true)
  assert.notEqual(f.service.state.presetPath, original); assert.equal(await readFile(original, 'utf8'), text)
  f.setLoad(original); f.apps.apps.pop(); await f.service.loadPreset('phone', 11)
  assert.deepEqual(f.service.preview.matched, [selection.packages[0]])
  assert.deepEqual(f.service.preview.missing, [selection.packages[1]])
  assert.equal(f.calls.length, 0)
})

test('preset import cancellation and invalid files clear old previews without device commands', async () => {
  const f = await fixture(); await f.service.execute(selection, true)
  const presetPath = f.service.state.presetPath
  f.setLoad(presetPath); await f.service.loadPreset('phone', 11)
  assert.ok(f.service.preview)
  f.setLoad(null); await f.service.loadPreset('phone', 11)
  assert.equal(f.service.preview, null)
  const invalid = path.join(f.root, 'invalid.json'); await writeFile(invalid, '{broken')
  f.setLoad(invalid); await assert.rejects(f.service.loadPreset('phone', 11))
  assert.equal(f.service.preview, null)
  assert.equal(f.service.busy, false)
  f.setLoad(presetPath); f.apps.apps = []
  await f.service.loadPreset('phone', 11)
  assert.deepEqual(f.service.preview.matched, [])
  assert.deepEqual(f.service.preview.missing, selection.packages)
  assert.equal(f.calls.length, 0)
})

test('Auto saves APK/APKS directly in the named folder with one complete report and no preset', async () => {
  const f = await fixture(); await f.service.execute({ ...selection, name: undefined, folderName: 'User' }, false)
  assert.equal(f.service.state.status, 'complete', f.service.state.message)
  const output = f.service.state.outputDirectory
  assert.equal(path.basename(output), 'User')
  assert.equal(path.basename(path.dirname(output)), 'Profile 11 - Work')
  assert.match(path.basename(path.dirname(path.dirname(output))), /^Redmi Note 14-/)
  assert.equal(f.service.state.presetPath, undefined)
  const names = await readdir(output)
  assert.equal(names.length, 3)
  assert.ok(names.includes('App 0.apk')); assert.ok(names.includes('App 1.apks'))
  assert.ok((await readdir(output, { withFileTypes: true })).every(entry => entry.isFile()))
  assert.deepEqual(await readFile(path.join(output, 'App 0.apk')), apk)
  const archive = path.join(output, 'App 1.apks'), entries = await unzip(archive)
  assert.deepEqual(entries['base.apk'], apk); assert.deepEqual(entries['split-001.apk'], apk)
  assert.equal(JSON.parse(entries['meta.sai_v2.json']).split_apk, true)
  assert.equal(JSON.parse(entries['meta.sai_v1.json']).package, selection.packages[1])
  const [report] = await reports(output), metadata = report.items[1]
  assert.equal(report.version, 2); assert.equal(report.profile.id, 11)
  assert.equal(metadata.artifactIntegrity.sha256, createHash('sha256').update(await readFile(archive)).digest('hex'))
  assert.equal(metadata.files.length, 2); assert.equal(report.contents.internalData, false)
  assert.equal(metadata.artifact, 'App 1.apks')
  assert.ok(metadata.files.every(file => Number.isInteger(file.timingsMs.transfer)))
  assert.equal(report.preset, undefined)
  assert.equal(report.status, 'complete'); assert.equal(report.contents.cache, false)
  assert.ok(report.items.every(item => item.status === 'success' && !item.folder))
  await f.service.execute({ ...selection, folderName: 'User' }, false)
  assert.equal(f.service.state.outputDirectory, output)
  assert.equal((await reports(output)).length, 2)
  assert.deepEqual(await readFile(path.join(output, 'App 0.apk')), apk)
  assert.deepEqual(await readFile(path.join(output, 'App 0 (org.example.one).apk')), apk)
})

test('same-named profiles keep loose backups, ZIPs and presets separate without touching previous exports', async () => {
  const f = await fixture()
  const outputs = []
  for (const userId of [0, 11]) {
    f.apps.userId = userId
    f.apps.profiles = [{ id: userId, name: 'Work' }]
    f.apps.apps = f.apps.apps.map(app => ({ ...app, userId }))
    const request = { ...selection, userId }
    await f.service.execute(request, false)
    assert.equal(f.service.state.status, 'complete', f.service.state.message)
    const output = f.service.state.outputDirectory
    outputs.push(output)
    assert.equal(path.basename(path.dirname(output)), `Profile ${userId} - Work`)
    assert.deepEqual(await readFile(path.join(output, 'App 0.apk')), apk)
    assert.equal((await reports(output))[0].profile.id, userId)

    await f.service.execute({ ...request, zip: true }, false)
    assert.equal(f.service.state.status, 'complete', f.service.state.message)
    assert.equal(f.service.state.archivePath, path.join(path.dirname(output), 'user.zip'))
    assert.equal(JSON.parse((await unzip(f.service.state.archivePath))['manifest.json']).profile.id, userId)

    await f.service.execute(request, true)
    assert.equal(f.service.state.presetPath, path.join(path.dirname(output), 'user.json'))
    assert.equal(parsePreset(await readFile(f.service.state.presetPath, 'utf8')).profile.id, userId)
  }
  assert.notEqual(outputs[0], outputs[1])
  assert.equal(path.dirname(path.dirname(outputs[0])), path.dirname(path.dirname(outputs[1])))
  for (const output of outputs) {
    assert.deepEqual(await readFile(path.join(output, 'App 0.apk')), apk)
    assert.equal((await reports(output)).length, 1)
  }
})

test('profile names are safe path segments and legacy device-level presets remain importable', async () => {
  const f = await fixture()
  f.apps.profiles[0].name = '../../CON:Work? '
  await f.service.execute(selection, true)
  assert.equal(f.service.state.status, 'complete', f.service.state.message)
  const presetFile = f.service.state.presetPath
  const profileDirectory = path.dirname(presetFile), deviceDirectory = path.dirname(profileDirectory)
  assert.equal(path.dirname(deviceDirectory), f.root)
  assert.equal(path.basename(profileDirectory), 'Profile 11 - .._.._CON_Work_')
  const text = await readFile(presetFile, 'utf8'), legacyFile = path.join(deviceDirectory, 'user.json')
  await writeFile(legacyFile, text)
  f.setLoad(legacyFile); await f.service.loadPreset('phone', 11)
  assert.deepEqual(f.service.preview.matched, selection.packages)
  await f.service.execute(selection, true)
  assert.equal(await readFile(legacyFile, 'utf8'), text)
})

test('APK and APKS modes skip other layouts before any checksum or pull, using live paths', async () => {
  for (const format of ['apk', 'apks']) {
    const f = await fixture()
    // Deliberately stale cached metadata must not decide what gets copied.
    f.apps.apps[0].splitCount = 4; f.apps.apps[1].splitCount = 0
    await f.service.execute({ ...selection, format }, false)
    assert.equal(f.service.state.status, 'complete', f.service.state.message)
    const savedIndex = format === 'apk' ? 0 : 1, skippedIndex = 1 - savedIndex
    assert.equal(f.service.state.items[savedIndex].status, 'success')
    assert.equal(f.service.state.items[skippedIndex].status, 'skipped')
    assert.match(f.service.state.message, /Saved files for 1 applications.*1 skipped/)
    assert.equal(f.service.state.completed, 2)
    const skippedPackage = selection.packages[skippedIndex]
    assert.ok(!f.calls.some(args => args[2] === 'pull' && args[3].includes(skippedPackage)))
    assert.ok(!f.calls.some(args => args[2] === 'shell' && tokens(args)[0] === 'sha256sum' && args[3].includes(skippedPackage)))
    const output = f.service.state.outputDirectory, names = await readdir(output)
    assert.equal(names.length, 2) // One artifact and one report, no partial folders or loose base.
    assert.ok(names.includes(`App ${savedIndex}.${format}`))
    const [report] = await reports(output)
    assert.equal(report.items[skippedIndex].status, 'skipped')
    assert.equal(report.items[skippedIndex].artifact, undefined)
    if (format === 'apk') assert.deepEqual(await readFile(path.join(output, 'App 0.apk')), apk)
    else {
      const entries = await unzip(path.join(output, 'App 1.apks'))
      assert.deepEqual(entries['base.apk'], apk); assert.deepEqual(entries['split-001.apk'], apk)
    }
  }
})

test('no matching layouts completes with an explicit empty result, without copying any APK', async () => {
  const f = await fixture()
  await f.service.execute({ ...selection, packages: [selection.packages[1]], format: 'apk' }, false)
  assert.equal(f.service.state.status, 'complete')
  assert.equal(f.service.state.items[0].status, 'skipped')
  assert.match(f.service.state.message, /No applications match/)
  assert.ok(!f.calls.some(args => args[2] === 'pull'))
  assert.equal((await readdir(f.service.state.outputDirectory)).length, 1)
})

test('group ZIP contains APK/APKS and the report, preserves bytes and does not overwrite previous archives', async () => {
  const f = await fixture()
  await f.service.execute({ ...selection, zip: true }, false)
  assert.equal(f.service.state.status, 'complete', f.service.state.message)
  const archive = f.service.state.archivePath
  assert.equal(path.basename(archive), 'user.zip')
  assert.equal(path.basename(path.dirname(archive)), 'Profile 11 - Work')
  assert.match(path.basename(path.dirname(path.dirname(archive))), /^Redmi Note 14-/)
  assert.deepEqual(await readdir(f.service.state.outputDirectory), ['user.zip'])
  const entries = await unzip(archive)
  assert.deepEqual(Object.keys(entries).sort(), ['App 0.apk', 'App 1.apks', 'manifest.json'])
  assert.deepEqual(entries['App 0.apk'], apk)
  const nested = path.join(f.root, 'nested.apks'); await writeFile(nested, entries['App 1.apks'])
  const splits = await unzip(nested)
  assert.deepEqual(splits['base.apk'], apk); assert.deepEqual(splits['split-001.apk'], apk)
  const report = JSON.parse(entries['manifest.json'])
  assert.equal(report.status, 'complete'); assert.equal(report.packaging, 'zip')
  for (const item of report.items) assert.equal(item.artifactIntegrity.sha256, createHash('sha256').update(entries[item.artifact]).digest('hex'))
  assert.ok(f.events.some(state => state.phase === 'archiving' && state.status === 'running'))
  const original = await readFile(archive)
  await f.service.execute({ ...selection, zip: true }, false)
  assert.notEqual(f.service.state.archivePath, archive)
  assert.deepEqual(await readFile(archive), original)
})

test('group ZIP includes only current successful apps and reports skipped or failed items', async () => {
  for (const format of ['apk', 'apks']) {
    const f = await fixture()
    await f.service.execute({ ...selection, format, zip: true }, false)
    const entries = await unzip(f.service.state.archivePath)
    const index = format === 'apk' ? 0 : 1
    assert.deepEqual(Object.keys(entries).sort(), [`App ${index}.${format}`, 'manifest.json'])
    assert.equal(JSON.parse(entries['manifest.json']).items[1 - index].status, 'skipped')
  }
  const f = await fixture({ corrupt: remote => remote.includes(selection.packages[0]) })
  await f.service.execute({ ...selection, zip: true }, false)
  assert.equal(f.service.state.status, 'partial')
  const entries = await unzip(f.service.state.archivePath)
  assert.deepEqual(Object.keys(entries).sort(), ['App 1.apks', 'manifest.json'])
  assert.equal(JSON.parse(entries['manifest.json']).status, 'partial')
  assert.equal(JSON.parse(entries['manifest.json']).items[0].status, 'error')
})

test('ZIP packaging leaves earlier loose exports untouched and never includes them', async () => {
  const f = await fixture()
  await f.service.execute(selection, false)
  const output = f.service.state.outputDirectory, names = await readdir(output)
  const originals = await Promise.all(names.map(name => readFile(path.join(output, name))))
  await f.service.execute({ ...selection, packages: [selection.packages[0]], zip: true }, false)
  assert.deepEqual(await readdir(output), names)
  for (const [i, name] of names.entries()) assert.deepEqual(await readFile(path.join(output, name)), originals[i])
  const entries = await unzip(f.service.state.archivePath)
  assert.equal(Object.keys(entries).length, 2)
  assert.ok(!Object.keys(entries).some(name => name.endsWith('.apks')))
})

test('cancelling ZIP finalization preserves downloaded copies and no archive is published', async () => {
  let f
  f = await fixture({ publish: state => { if (state.phase === 'archiving') f.service.cancel() } })
  await f.service.execute({ ...selection, zip: true }, false)
  assert.equal(f.service.state.status, 'cancelled')
  assert.equal(f.service.state.archivePath, undefined)
  assert.match(f.service.state.message, /Completed files are kept/)
  const names = await readdir(f.service.state.outputDirectory)
  assert.ok(names.includes('App 0.apk')); assert.ok(names.includes('App 1.apks'))
  assert.ok(!names.some(name => name.startsWith('.zip-')))
  assert.ok(!(await readdir(path.dirname(f.service.state.outputDirectory))).some(name => name.endsWith('.zip')))
})

test('all-skipped ZIP selection does not produce an empty archive', async () => {
  const f = await fixture()
  await f.service.execute({ ...selection, packages: [selection.packages[1]], format: 'apk', zip: true }, false)
  assert.equal(f.service.state.archivePath, undefined)
  assert.equal(f.service.state.status, 'complete')
  assert.match(f.service.state.message, /No applications match/)
  assert.ok(!f.calls.some(args => args[2] === 'pull'))
  assert.throws(() => validateBackupRequest({ ...selection, zip: 'yes' }), /ZIP/)
  assert.throws(() => validateBackupRequest({ ...selection, zip: true }, true), /ZIP/)
})

test('named APK artifacts are filesystem-safe and never expose loose splits in Auto', async () => {
  assert.equal(apkArtifactStem('App: / Test?', 'org.example.one'), 'App_ _ Test_')
  assert.equal(apkArtifactStem('... ', 'org.example.one'), 'org.example.one')
  assert.equal(apkArtifactStem('CON', 'org.example.one'), '_CON')
  assert.equal(apkArtifactStem('Notes.apk', 'org.example.one'), 'Notes')
  assert.ok(apkArtifactStem('a'.repeat(200), 'org.example.one').length <= 80)
  for (const label of ['4PDA', 'base', 'Заметки']) {
    const f = await fixture()
    f.apps.apps.forEach(app => { app.label = label })
    await f.service.execute(selection, false)
    assert.equal(f.service.state.status, 'complete', f.service.state.message)
    for (const [index, pkg] of selection.packages.entries()) {
      const folder = f.service.state.outputDirectory
      const artifact = `${label}.${index === 0 ? 'apk' : 'apks'}`
      assert.ok((await readdir(folder)).includes(artifact))
      const report = (await reports(folder))[0].items.find(item => item.packageName === pkg)
      assert.equal(report.artifact, artifact)
      if (index === 0) { assert.equal(report.files[0].file, artifact); assert.deepEqual(await readFile(path.join(folder, artifact)), apk) }
      else assert.deepEqual((await unzip(path.join(folder, artifact)))['base.apk'], apk)
    }
  }
})

test('legacy formats still export complete sets without per-package folders', async () => {
  for (const format of ['zip', 'files']) {
    const f = await fixture(); await f.service.execute({ ...selection, format }, false)
    assert.equal(f.service.state.status, 'complete', f.service.state.message)
    const output = f.service.state.outputDirectory
    for (const item of (await reports(output))[0].items) {
      if (item.artifact.endsWith('.apk')) assert.deepEqual(await readFile(path.join(output, item.artifact)), apk)
      else {
        const entries = await unzip(path.join(output, item.artifact))
        assert.deepEqual(entries['base.apk'], apk)
        if (item.packageName.endsWith('two')) assert.deepEqual(entries['split-001.apk'], apk)
      }
    }
    assert.ok((await readdir(output, { withFileTypes: true })).every(entry => entry.isFile()))
  }
})

test('same labels, case differences and existing files never overwrite each other', async () => {
  const f = await fixture()
  f.apps.apps[0].label = 'Notes'; f.apps.apps[1].label = 'notes'
  await f.service.execute({ ...selection, format: 'zip' }, false)
  assert.equal(f.service.state.status, 'complete', f.service.state.message)
  const output = f.service.state.outputDirectory
  const artifacts = f.service.state.items.map(item => item.artifact)
  assert.equal(new Set(artifacts.map(name => name.toLowerCase())).size, 2)
  const originals = await Promise.all(artifacts.map(name => readFile(path.join(output, name))))
  await f.service.execute({ ...selection, format: 'zip' }, false)
  assert.equal(f.service.state.status, 'complete', f.service.state.message)
  assert.equal((await reports(output)).length, 2)
  for (const [i, name] of artifacts.entries()) assert.deepEqual(await readFile(path.join(output, name)), originals[i])
  assert.ok((await readdir(output, { withFileTypes: true })).every(entry => entry.isFile()))
})

test('one corrupt APK produces a partial report and does not stop the remaining apps', async () => {
  const f = await fixture({ corrupt: remote => remote.includes(selection.packages[0]) }); await f.service.execute(selection, false)
  assert.equal(f.service.state.status, 'partial')
  assert.deepEqual(f.service.state.items.map(item => item.status), ['error', 'success'])
  assert.equal(f.service.state.completed, 2)
  const names = await readdir(f.service.state.outputDirectory)
  assert.ok(!names.includes('App 0.apk')); assert.ok(names.includes('App 1.apks')); assert.ok(!names.some(name => name.startsWith('.partial-')))
})

test('cancel preserves completed packages and records cancelled remaining entries', async () => {
  let f
  f = await fixture({ publish: state => { if (state.items[0]?.status === 'success') f.service.cancel() } })
  await f.service.execute(selection, false)
  assert.equal(f.service.state.status, 'cancelled')
  assert.deepEqual(f.service.state.items.map(item => item.status), ['success', 'cancelled'])
  assert.deepEqual(await readFile(path.join(f.service.state.outputDirectory, 'App 0.apk')), apk)
  const report = (await reports(f.service.state.outputDirectory))[0]
  assert.equal(report.status, 'cancelled'); assert.equal(report.items[1].status, 'cancelled')
})

test('shutdown aborts an in-flight pull and cleans its temporary folder', async () => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const f = await fixture({ runner: async (args, controls) => {
    if (args[2] !== 'pull') return
    await writeFile(args[4], apk)
    return new Promise((resolve, reject) => { controls.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); started() })
  } })
  const job = f.service.execute(selection, false); await ready
  await assert.rejects(f.service.execute(selection, true), /Wait/)
  await f.service.shutdown(); await job
  assert.equal(f.service.state.status, 'cancelled'); assert.equal(f.service.busy, false)
  assert.ok(!(await readdir(f.service.state.outputDirectory)).some(name => name.startsWith('.partial-')))
})

test('changing the profile while choosing a folder never copies APKs', async () => {
  let f
  f = await fixture({ folder: async () => { f.apps.userId = 0; return f.root } }); await f.service.execute(selection, false)
  assert.equal(f.service.state.status, 'error'); assert.match(f.service.state.message, /profile changed/); assert.equal(f.calls.length, 0); assert.deepEqual(await readdir(f.root), [])
})

test('device transport replacement during a pull prevents publication of its package', async () => {
  let f
  f = await fixture({ runner: async args => { if (args[2] === 'pull') f.connection.devices[0].transportId = '8' } })
  await f.service.execute(selection, false)
  assert.equal(f.service.state.status, 'error')
  assert.match(f.service.state.message, /ADB connection changed/)
  assert.ok(!f.service.state.items.some(item => item.status === 'success'))
})

test('invalid selections, path traversal and malformed imports are rejected', async () => {
  const f = await fixture()
  assert.doesNotThrow(() => validateBackupRequest({ ...selection, name: undefined }))
  assert.throws(() => validateBackupRequest({ ...selection, name: undefined }, true), /preset name/)
  assert.throws(() => f.service.execute({ ...selection, name: undefined }, true), /preset name/)
  assert.deepEqual(await readdir(f.root), [])
  for (const name of ['../outside', 'C:\\outside', 'CON', 'name.', ' name', '']) assert.throws(() => validatePresetName(name))
  for (const request of [{ ...selection, packages: ['org.example;calc'] }, { ...selection, packages: [selection.packages[0], selection.packages[0]] }, { ...selection, userId: -1 }, { ...selection, format: 'exe' }, { ...selection, folderName: '../outside' }, { ...selection, folderName: '' }]) assert.throws(() => validateBackupRequest(request))
  await assert.rejects(f.service.execute({ ...selection, packages: ['org.missing'] }, false), /selection/)
  await f.service.execute(selection, true)
  const valid = JSON.parse(await readFile(f.service.state.presetPath, 'utf8'))
  for (const value of [{ ...valid, version: 2 }, { ...valid, name: '..' }, { ...valid, applications: [...valid.applications, valid.applications[0]] }, { ...valid, profile: { id: -1, name: 'x' } }]) assert.throws(() => parsePreset(JSON.stringify(value)))
  assert.throws(() => parsePreset(' '.repeat(4_000_001)), /limit/)
})

test('an existing device junction cannot redirect backup writes', async () => {
  const f = await fixture()
  const deviceFolder = `Redmi Note 14-${createHash('sha256').update('HARDWARE').digest('hex').slice(0, 8)}`
  const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'adb-vault-outside-')))
  await symlink(outside, path.join(f.root, deviceFolder), 'junction')
  await f.service.execute(selection, true)
  assert.equal(f.service.state.status, 'error'); assert.deepEqual(await readdir(outside), [])
})


test('Backup badge persists only successful APK exports, scoped by hardware and Android profile', async () => {
  const f = await fixture({ catalogue: true })
  const device = f.connection.devices[0], app = f.apps.apps[0]
  assert.equal(f.catalogue.check(device, app).present, false)
  await f.service.execute(selection, true)
  assert.equal(f.catalogue.check(device, app).present, false, 'preset alone is not a backup')
  await f.service.execute({ ...selection, format: 'apk' }, false)
  assert.equal(f.catalogue.check(device, app).present, true, JSON.stringify(f.service.state))
  assert.equal(f.catalogue.check(device, f.apps.apps[1]).present, false, 'skipped split app has no copy')
  const restarted = new BackupCatalog(path.join(f.root, '.catalogue')); await restarted.load()
  const check = restarted.check(device, app)
  assert.equal(check.present, true)
  assert.ok(check.items.some(i => i.value.includes('Matches installed version')))
  assert.equal(restarted.check({ ...device, hardwareId: 'OTHER' }, app).present, false)
  assert.equal(restarted.check(device, { ...app, userId: 0 }).present, false)
  assert.equal(restarted.check({ ...device, serial: 'NEW_WIFI', transportId: '99' }, app).present, true)
  assert.equal(restarted.check({ ...device, hardwareId: undefined, method: 'Wi-Fi' }, app).present, null)
  assert.ok(restarted.check(device, { ...app, versionCode: 2 }).items.some(i => i.value.includes('Different from installed version')))
  const location = check.items.find(i => i.name === 'Location')
  assert.equal(location.backupFile, location.value)
  assert.equal(await restarted.revealPath(location.backupFile), location.value)
  await assert.rejects(restarted.revealPath(path.join(f.root, 'unregistered.apk')), /not in the local catalogue/)
  await rm(check.items.find(i => i.name === 'Location').value)
  await assert.rejects(restarted.revealPath(location.backupFile), /moved or deleted/)
  await restarted.refresh()
  assert.equal(restarted.check(device, app).present, false, 'deleted artifacts must disappear')
})

test('ZIP badge points to published archive entries and rejects a modified or removed archive', async () => {
  const f = await fixture({ catalogue: true })
  await f.service.execute({ ...selection, zip: true }, false)
  const device = f.connection.devices[0]
  for (const app of f.apps.apps) {
    const check = f.catalogue.check(device, app)
    assert.equal(check.present, true)
    assert.equal(check.items.filter(i => i.name === 'Location').length, 1, 'temporary loose record was replaced')
    assert.equal(check.items.find(i => i.name === 'Location').value, f.service.state.archivePath)
    assert.equal(await f.catalogue.revealPath(check.items.find(i => i.name === 'Location').backupFile), f.service.state.archivePath)
    assert.ok(check.items.find(i => i.name === 'Archive entry'))
  }
  await writeFile(f.service.state.archivePath, 'modified ZIP')
  await f.catalogue.refresh()
  assert.equal(f.catalogue.check(device, f.apps.apps[0]).present, false)
  await rm(f.service.state.archivePath)
  const restarted = new BackupCatalog(path.join(f.root, '.catalogue')); await restarted.load()
  assert.equal(restarted.check(device, f.apps.apps[1]).present, false)
})

test('partial exports index only verified successful files; cancelled ZIP retains loose backup badge', async () => {
  const f = await fixture({ catalogue: true, corrupt: remote => remote.includes('org.example.two') })
  await f.service.execute(selection, false)
  assert.equal(f.service.state.status, 'partial')
  assert.equal(f.catalogue.check(f.connection.devices[0], f.apps.apps[0]).present, true)
  assert.equal(f.catalogue.check(f.connection.devices[0], f.apps.apps[1]).present, false)
  let service
  const g = await fixture({ catalogue: true, publish: state => { if (state.phase === 'archiving') service.cancel() } })
  service = g.service
  await g.service.execute({ ...selection, zip: true }, false)
  assert.equal(g.service.state.status, 'cancelled')
  const check = g.catalogue.check(g.connection.devices[0], g.apps.apps[0])
  assert.equal(check.present, true)
  assert.ok(check.items.find(i => i.name === 'Location').value.endsWith('.apk'))
  assert.equal(check.items.some(i => i.name === 'Archive entry'), false)
})


test('catalogue save failure does not lose completed ZIP or loose recovery copies', async () => {
  const f = await fixture({ catalogue: true })
  f.catalogue.record = async () => { throw new Error('Disk write denied') }
  await f.service.execute({ ...selection, zip: true }, false)
  assert.equal(f.service.state.status, 'complete')
  assert.match(f.service.state.message, /catalogue could not be saved/)
  assert.ok((await readFile(f.service.state.archivePath)).length > 0)
  assert.deepEqual(await readFile(path.join(f.service.state.outputDirectory, 'user', 'App 0.apk')), apk)
  assert.equal(f.catalogue.check(f.connection.devices[0], f.apps.apps[0]).present, false)
})


function tarFixture() {
  const header = Buffer.alloc(512)
  header.write('data/user/11/org.example.one/files/example')
  header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
  header.write('00000000004\0', 124); header.write('00000000000\0', 136)
  header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257)
  const sum = header.reduce((n, b) => n + b, 0)
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return Buffer.concat([header, Buffer.from('data'), Buffer.alloc(508), Buffer.alloc(1024)])
}
function dataRunner(options = {}) {
  return async (args, controls) => {
    const binary = args[2] === 'exec-out'
    if (!binary && args[3] !== '-T') return undefined
    const framed = binary ? args[3] : args[4]
    const raw = binary ? framed.split('; __adb_vault_status=')[0] : framed
    const cmd = raw.startsWith('su -c ') ? raw.slice(7, -1).replaceAll("'\\''", "'") : raw
    if (cmd.startsWith('pm path --user')) return ok('package:/data/app/base.apk')
    if (cmd.startsWith('sha256sum')) return ok(sha + '  /data/app/base.apk')
    if (cmd.startsWith('pm list packages')) return ok('package:org.example.one uid:1110001\npackage:org.example.two uid:1110002')
    if (cmd === 'id') return ok(options.noRoot ? 'uid=2000(shell)' : 'uid=0(root)')
    if (cmd === 'tar --help') return ok('tar --exclude PATTERN -c -f -C')
    if (cmd.startsWith('am get-started-user-state')) return ok(options.locked ? 'RUNNING_LOCKED' : 'RUNNING_UNLOCKED')
    if (cmd.includes('echo ABSENT')) {
      if (options.denied && cmd.includes('/Android/media/')) return { code: 41, stdout: '', stderr: 'Permission denied' }
      const directory = /readlink -f '([^']+)'/.exec(cmd)?.[1]
      return ok(options.absent ? 'ABSENT' : directory)
    }
    if (cmd.startsWith('ls -Zd')) return ok('u:object_r:app_data_file:s0 test')
    if (cmd.startsWith('am force-stop')) return ok('')
    if (cmd.startsWith('tar -c')) {
      assert.ok(controls.stdoutFile)
      if (options.stream) return options.stream(cmd, controls)
      await writeFile(controls.stdoutFile, Buffer.concat([tarFixture(), Buffer.from('\n' + /ADB_VAULT_EXPORT_[a-f0-9-]+/.exec(framed)[0] + ':0\n')]))
      return ok('')
    }
    throw new Error('Unexpected data command: ' + cmd)
  }
}
const allContents = { apk: false, data: true, cache: true, obb: true, media: true }

test('data-only backup saves independent parts in ZIP and reports their exact contents in Backup', async () => {
  const f = await fixture({ catalogue: true, runner: dataRunner() }); f.apps.options.root = true
  await f.service.execute({ ...selection, packages: [selection.packages[0]], contents: allContents, stopApps: true, zip: true }, false)
  assert.equal(f.service.state.status, 'complete', f.service.state.message + JSON.stringify(f.service.state.items))
  const entries = await unzip(f.service.state.archivePath)
  assert.deepEqual(Object.keys(entries).sort(), ['App 0.cache.tar', 'App 0.data.tar', 'App 0.media.tar', 'App 0.obb.tar', 'manifest.json'])
  const report = JSON.parse(entries['manifest.json'])
  assert.equal(report.contents.apk, false)
    assert.equal(report.items[0].artifacts.length, 4)
    assert.deepEqual(report.items[0].dataApkSha256, [sha])
    assert.match(report.dataArchive.restoration, /matching installed APKs/)
  assert.equal(f.calls.some(a => a[2] === 'pull'), false)
  const tarCommands = f.calls.filter(a => a[2] === 'exec-out').map(a => a[3])
  assert.match(tarCommands[0], /--exclude=/)
  assert.ok(tarCommands.every(cmd => !cmd.includes(' -h ')))
  assert.equal(f.service.state.items[0].parts.every(p => p.status === 'saved'), true)
  const check = f.catalogue.check(f.connection.devices[0], f.apps.apps[0])
  assert.equal(check.present, true)
  assert.deepEqual(check.items.filter(i => i.name === 'Contents').map(i => i.value), ['App data (without cache)', 'Cache and code cache', 'OBB', 'Media'])
})

test('private copies require root and stop consent; locked profiles fail before stopping', async () => {
  const f = await fixture({ runner: dataRunner({ locked: true }) })
  const req = { ...selection, contents: allContents, stopApps: true }
  assert.throws(() => validateBackupRequest({ ...req, stopApps: false }), /Confirm stopping/)
  await assert.rejects(f.service.execute(req, false), /Enable root/)
  assert.equal(f.calls.length, 0)
  f.apps.options.root = true
  await f.service.execute(req, false)
  assert.equal(f.service.state.status, 'partial')
  assert.match(f.service.state.items[0].message, /Unlock/)
  assert.equal(f.calls.some(a => a[4]?.startsWith('am force-stop')), false)
})

test('partial external copy indexes only available parts; permission denial is never absence', async () => {
  const f = await fixture({ catalogue: true, runner: dataRunner({ denied: true }) })
  await f.service.execute({ ...selection, packages: [selection.packages[0]], contents: { ...allContents, data: false, cache: false }, stopApps: true, allowPartial: true, zip: true }, false)
  assert.equal(f.service.state.status, 'partial')
  const parts = f.service.state.items[0].parts
  assert.equal(parts.find(p => p.component === 'media').status, 'error')
  assert.equal(parts.find(p => p.component === 'obb').status, 'saved')
  assert.ok(f.service.state.archivePath, 'successful components of a partial app are packed')
  assert.deepEqual(f.catalogue.check(f.connection.devices[0], f.apps.apps[0]).items.filter(i => i.name === 'Contents').map(i => i.value), ['OBB'])
})

test('cancelled data stream never publishes a partial TAR or claims Backup', async () => {
  let service
  const f = await fixture({ catalogue: true, runner: dataRunner({ stream: async (_cmd, controls) => { await writeFile(controls.stdoutFile, tarFixture().subarray(0, 512)); service.cancel(); throw new Error('Cancelled') } }) })
  service = f.service
  await service.execute({ ...selection, packages: [selection.packages[0]], contents: { apk: false, data: false, cache: false, obb: true, media: false }, stopApps: true }, false)
  assert.equal(service.state.status, 'cancelled')
  assert.equal(f.catalogue.check(f.connection.devices[0], f.apps.apps[0]).present, false)
  assert.equal((await readdir(service.state.outputDirectory)).some(name => name.endsWith('.tar') || name.startsWith('.partial-')), false)
})

test('TAR validation rejects broken checksums, truncation and stdout contamination', async () => {
  const f = await fixture(), file = path.join(f.root, 'test.tar')
  await writeFile(file, tarFixture()); await validateTar(file)
  const bad = tarFixture(); bad[10] ^= 1
  for (const bytes of [bad, tarFixture().subarray(0, 512), Buffer.concat([Buffer.from('su banner'), tarFixture()])]) {
    await writeFile(file, bytes); await assert.rejects(validateTar(file))
  }
})

test('data directory symlinks outside the package are refused', async () => {
  await assert.rejects(planData({ packageName: 'org.example.one', userId: 11 }, 'obb', false, async () => '/storage/emulated/0/Android/obb/other.app'), /Unexpected data directory/)
})


test('partial mode continues data components after a corrupt APK; default mode stops the app', async () => {
  for (const allowPartial of [false, true]) {
    const f = await fixture({ catalogue: true, runner: dataRunner(), corrupt: () => true })
    await f.service.execute({ ...selection, packages: [selection.packages[0]], contents: { apk: true, data: false, cache: false, obb: true, media: false }, stopApps: true, allowPartial }, false)
    assert.equal(f.service.state.status, 'partial')
    const parts = f.service.state.items[0].parts
    assert.equal(parts.find(p => p.component === 'apk').status, 'error')
    assert.equal(parts.some(p => p.component === 'obb' && p.status === 'saved'), allowPartial)
    assert.equal(f.catalogue.check(f.connection.devices[0], f.apps.apps[0]).present, allowPartial)
  }
})


test('binary archive framing requires successful remote completion and preserves all payload bytes', async () => {
  const f = await fixture(), file = path.join(f.root, 'framed.tar'), token = '12345678-1234-1234-1234-123456789abc'
  assert.match(archiveStreamCommand('tar -c -f - example', token), /__adb_vault_status=\$\?/)
  const bytes = Buffer.from([0, 10, 13, 10, 255]), marker = `\nADB_VAULT_EXPORT_${token}:0\n`
  await writeFile(file, Buffer.concat([bytes, Buffer.from(marker)]))
  await finalizeArchiveStream(file, token); assert.deepEqual(await readFile(file), bytes)
  for (const suffix of ['', marker.slice(0, -1), marker.replace(':0', ':1'), marker.replace(token, '00000000-0000-0000-0000-000000000000')]) {
    await writeFile(file, Buffer.concat([tarFixture(), Buffer.from(suffix)]))
    await assert.rejects(finalizeArchiveStream(file, token))
  }
})


test('experimental Wi-Fi batch shares one feature probe and preserves verified APK/APKS content and reports', async () => {
  const f = await fixture({ zstd: true, method: 'Wi-Fi' })
  await f.service.execute(selection, false)
  assert.equal(f.service.state.status, 'complete', f.service.state.message)
  assert.equal(f.calls.filter(c => c[2] === 'features').length, 1)
  const pulls = f.calls.filter(c => c[2] === 'pull')
  assert.equal(pulls.length, 3)
  assert.ok(pulls.every(c => c[3] === '-z' && c[4] === 'zstd'))
  const [report] = await reports(f.service.state.outputDirectory)
  for (const item of report.items) {
    assert.equal(item.status, 'success')
    assert.ok(item.files.every(file => file.sha256 === sha && file.transfer.compression === 'zstd'))
  }
  const names = await readdir(f.service.state.outputDirectory)
  const single = names.find(n => n.endsWith('.apk'))
  assert.deepEqual(await readFile(path.join(f.service.state.outputDirectory, single)), apk)
  const split = await unzip(path.join(f.service.state.outputDirectory, names.find(n => n.endsWith('.apks'))))
  assert.deepEqual(split['base.apk'], apk)
  assert.deepEqual(split['split-001.apk'], apk)
  await f.service.execute(selection, true)
  assert.equal(f.calls.filter(c => c[2] === 'features').length, 1, 'Saving a preset must not access the device')
})


for (const reason of ["adb.exe: no device with transport id '7'", 'error: device offline', 'adb: error: connection reset']) {
  test(`backup stops immediately on ${reason}, even before polling notices a disconnect`, async () => {
    const f = await fixture({ method: 'Wi-Fi', zstd: true, runner: async args => {
      if (args[2] === 'pull' && args.at(-2).includes('org.example.two')) return { code: 1, stderr: '[ 25%] /data/app/base.apk', stdout: reason }
    } })
    f.apps.apps.push({ ...f.apps.apps[0], packageName: 'org.example.three', label: 'Not started' })
    await f.service.execute({ ...selection, packages: [...selection.packages, 'org.example.three'], allowPartial: true }, false)
    assert.equal(f.service.state.status, 'error')
    assert.match(f.service.state.message, /Backup interrupted: ADB connection lost/)
    assert.ok(f.service.state.message.includes(reason))
    assert.deepEqual(f.service.state.items.map(item => item.status), ['success', 'error', 'cancelled'])
    assert.match(f.service.state.items[2].message, /Not started/)
    assert.equal(f.calls.some(args => args.join(' ').includes('org.example.three')), false)
    assert.equal(f.calls.filter(args => args[2] === 'pull').length, 2)
    assert.deepEqual(await readFile(path.join(f.service.state.outputDirectory, 'App 0.apk')), apk)
    assert.equal((await reports(f.service.state.outputDirectory))[0].status, 'error')
    assert.ok(!(await readdir(f.service.state.outputDirectory)).some(name => name.startsWith('.partial-')))
  })
}
