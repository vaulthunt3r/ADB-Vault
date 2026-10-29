import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { portableMarker, portableProfilePath, configurePortableProfile } from '../dist-electron/portable-profile.js'
import { Storage } from '../dist-electron/storage.js'

test('portable marker isolates the profile; explicit user-data-dir and development keep their own profiles', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-portable-path-'))
  const executable = path.join(folder, 'ADB Vault.exe')
  assert.equal(portableProfilePath(executable, true, false), undefined)
  await fs.writeFile(path.join(folder, portableMarker), '')
  const root = path.join(folder, 'data')
  assert.equal(portableProfilePath(executable, true, false), root)
  assert.equal(portableProfilePath(executable, true, true), undefined)
  assert.equal(portableProfilePath(executable, false, false), undefined)
  const paths = {}
  configurePortableProfile({ setPath: (key, value) => { paths[key] = value }, setAppLogsPath: value => { paths.logs = value } }, root)
  assert.equal(paths.userData, root)
  for (const key of ['sessionData', 'crashDumps', 'logs']) {
    assert.equal(path.dirname(paths[key]), root)
    assert.equal((await fs.stat(paths[key])).isDirectory(), true)
  }
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.write-check-')), false)
  const invalidRoot = path.join(folder, 'file')
  await fs.writeFile(invalidRoot, '')
  assert.throws(() => configurePortableProfile({ setPath: () => assert.fail('Must not fall back'), setAppLogsPath: () => assert.fail() }, invalidRoot))
})

test('managed tools follow a moved profile while external paths remain unchanged', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-portable-move-'))
  const original = path.join(folder, 'original', 'data'), relocated = path.join(folder, 'relocated', 'data')
  const storage = new Storage(original)
  await storage.load()
  storage.data.paths = {
    adb: path.join(original, 'components', 'adb-test', 'files', 'platform-tools'),
    fastboot: path.join(original, 'components', 'adb-test', 'files', 'platform-tools'),
    scrcpy: path.join(original, 'components', 'scrcpy-test', 'files'),
    driver: path.join(folder, 'external-driver'),
  }
  await storage.save()
  await fs.mkdir(relocated, { recursive: true })
  await fs.copyFile(path.join(original, 'backend.json'), path.join(relocated, 'backend.json'))
  const moved = new Storage(relocated)
  await moved.load()
  for (const id of ['adb', 'fastboot', 'scrcpy']) assert.equal(moved.data.paths[id], path.join(relocated, path.relative(original, storage.data.paths[id])))
  assert.equal(moved.data.paths.driver, storage.data.paths.driver)
  // Relocation remains valid after multiple moves, while a newly selected
  // external component drops its previous managed mapping on save.
  moved.data.paths.scrcpy = path.join(folder, 'external-scrcpy')
  await moved.save()
  const saved = JSON.parse(await fs.readFile(path.join(relocated, 'backend.json'), 'utf8'))
  assert.equal(Object.hasOwn(saved.managedPaths, 'scrcpy'), false)
  assert.equal(path.isAbsolute(saved.managedPaths.adb), false)
  saved.managedPaths.adb = '../escaped'
  saved.managedPaths.fastboot = path.join(folder, 'escaped')
  await fs.writeFile(path.join(relocated, 'backend.json'), JSON.stringify(saved))
  const invalid = new Storage(relocated)
  await invalid.load()
  assert.equal(invalid.data.paths.adb, moved.data.paths.adb)
  assert.equal(invalid.data.paths.fastboot, moved.data.paths.fastboot)
  // An older installed profile without managedPaths retains absolute paths.
  delete saved.managedPaths
  await fs.writeFile(path.join(relocated, 'backend.json'), JSON.stringify(saved))
  const legacy = new Storage(relocated)
  await legacy.load()
  assert.deepEqual(legacy.data.paths, moved.data.paths)
})
