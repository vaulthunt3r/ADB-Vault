import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, copyFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { prepareRestoreTrees } from '../dist-electron/restore-tar.js'
import { restoreDataTrees, DataRestoreFailure } from '../dist-electron/app-data-restore.js'
import { sha } from './restore-fixture.mjs'

const execute = promisify(execFile), pkg = 'org.example.notes', source = 'data/user/0/' + pkg, target = '/data/user/11/' + pkg
import { tar } from './restore-fixture.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'adb-vault-data-restore-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'data.tar'), stage = path.join(root, 'stage'); await mkdir(stage)
  const signal = new AbortController().signal
  const prepare = (entries, part = 'data', roots = ['/' + source]) => writeFile(file, tar(entries)).then(() => prepareRestoreTrees(file, pkg, 0, 11, part, roots, stage, signal))
  return { root, file, stage, signal, prepare }
}
test('normalizes source profile paths to destination roots and strips archived owner/mode privileges', async t => {
  const f = await fixture(t), trees = await f.prepare([{ name: source, type: '5' }, { name: source + '/files', type: '5' }, { name: source + '/files/text', data: Buffer.from('hello'), mode: 0o4755 }])
  assert.equal(trees[0].targetRoot, target); const output = await readFile(trees[0].file)
  assert.equal(output.subarray(0, 7).toString(), 'payload'); assert.ok(!output.includes(Buffer.from(source)))
  assert.equal(output.subarray(1024 + 100, 1024 + 107).toString(), '0000755')
})
test('retains Android-managed private lib instead of restoring obsolete APK paths', async t => {
  const f = await fixture(t), trees = await f.prepare([{ name: source, type: '5' }, { name: source + '/lib', type: '2' }, { name: source + '/files', type: '5' }, { name: source + '/files/value', data: Buffer.from('user data') }])
  assert.ok(!(await readFile(trees[0].file)).includes(Buffer.from('payload/lib')))
})
for (const kind of ['traversal', 'absolute', 'symlink', 'hardlink', 'device', 'duplicate', 'outside', 'cache', 'file-parent', 'reserved']) test(`rejects ${kind} before device access`, async t => {
  const f = await fixture(t); let entries = [{ name: source, type: '5' }, { name: source + '/item', data: Buffer.from('data') }]
  if (kind === 'traversal') entries[1].name = source + '/../escape'
  if (kind === 'absolute') entries[1].name = '/' + source + '/file'
  if (kind === 'symlink') entries[1].type = '2'
  if (kind === 'hardlink') entries[1].type = '1'
  if (kind === 'device') entries[1].type = '3'
  if (kind === 'duplicate') entries.push(entries[1])
  if (kind === 'outside') entries[1].name = 'data/user/0/org.other.app/item'
  if (kind === 'cache') entries[1].name = source + '/cache/item'
  if (kind === 'file-parent') entries.push({ name: source + '/item/child', data: Buffer.from('data') })
  if (kind === 'reserved') entries[1].name = source + '/.adb-vault-restore-test'
  await assert.rejects(f.prepare(entries))
})
test('rejects truncated TAR, missing roots and undeclared root aliases', async t => {
  const f = await fixture(t)
  await writeFile(f.file, tar([{ name: source, type: '5' }]).subarray(0, 600))
  await assert.rejects(prepareRestoreTrees(f.file, pkg, 0, 11, 'data', ['/' + source], f.stage, f.signal), /Incomplete/)
  await rm(path.join(f.stage, 'data-0.restore.tar'), { force: true })
  await assert.rejects(f.prepare([{ name: source + '/item', data: Buffer.from('a') }]), /Missing/)
  await assert.rejects(f.prepare([{ name: source, type: '5' }], 'data', ['/data/user/0/org.other.app']), /outside/)
})

// Run the real generated POSIX replacement/rollback scripts against an isolated local
// filesystem. Android-only pm/id/chown/restorecon are mocked, never a real ADB device.
async function filesystemDevice(t, options = {}) {
  const f = await fixture(t), fsroot = path.join(f.root, 'phone'), approot = path.join(fsroot, 'app'), temporary = path.join(fsroot, 'tmp')
  await mkdir(path.join(approot, 'cache'), { recursive: true }); await mkdir(temporary, { recursive: true })
  await writeFile(path.join(approot, 'original'), 'old data'); await writeFile(path.join(approot, 'cache', 'keep'), 'old cache'); await writeFile(path.join(approot, 'lib'), 'managed library placeholder')
  const trees = options.parts?.length ? [] : await f.prepare([{ name: source, type: '5' }, { name: source + '/restored', data: Buffer.from('new data') }])
  const mappings = [[target, approot]]
  for (const part of options.parts || []) {
    const saved = part === 'cache' ? source + '/cache' : `storage/emulated/0/Android/${part}/${pkg}`
    const dest = part === 'cache' ? target + '/cache' : `/storage/emulated/11/Android/${part}/${pkg}`
    const local = part === 'cache' ? path.join(approot, 'cache') : path.join(fsroot, part, pkg)
    await mkdir(options.absentExternal && part !== 'cache' ? path.dirname(local) : local, { recursive: true })
    if (!options.absentExternal || part === 'cache') await writeFile(path.join(local, 'original'), 'old ' + part)
    mappings.unshift([dest, local])
    const file = path.join(f.root, part + '.tar')
    await writeFile(file, tar([{ name: saved, type: '5' }, { name: saved + '/restored', data: Buffer.from('new ' + part) }]))
    trees.push(...await prepareRestoreTrees(file, pkg, 0, 11, part, ['/' + saved], f.stage, f.signal))
  }
  const commands = [], pushed = [], apk = Buffer.from('same APK'), hash = sha(apk).sha256
  let offline = false, commits = 0
  const posix = p => process.platform === 'win32' ? '/' + p[0].toLowerCase() + p.slice(2).replaceAll('\\', '/') : p
  const map = command => mappings.reduce((s, [remote, local]) => s.replaceAll(remote, posix(local)), command).replaceAll('/storage/emulated/11/Android/obb', posix(path.join(fsroot, 'obb'))).replaceAll('/storage/emulated/11/Android/media', posix(path.join(fsroot, 'media'))).replaceAll('/data/local/tmp', posix(temporary))
  const shell = async (command, root) => {
    commands.push({ command, root })
    if (offline) throw new Error('Connection lost')
    if (command.startsWith('pm list packages')) return `package:${pkg} uid:1110123${options.shared ? '\npackage:org.shared.app uid:1110123' : ''}`
    if (command.startsWith('pm path')) return 'package:/data/app/base.apk'
    if (command.startsWith('sha256sum')) return (options.wrongApk ? '0'.repeat(64) : hash) + '  /data/app/base.apk'
    if (command.startsWith('am get-started')) return options.locked ? 'RUNNING_LOCKED' : 'RUNNING_UNLOCKED'
    if (command === 'id') return 'uid=0(root)'
    if (command.startsWith('am force-stop')) return ''
    if (command.startsWith('stat -c')) return '1110123:1110123'
    const commit = command.includes('echo RESTORED'); if (commit) commits++
    const restorecon = options.failCommit && commit && commits === (options.failAt || 1) ? 'return 1' : ':'
    if (options.failAt && commit && commits === options.failAt && !command.includes('restorecon')) throw new Error('Injected commit failure')
    const script = `set -e; chown() { :; }; restorecon() { ${restorecon}; }; ` + map(command)
    const result = await execute(process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash', ['--noprofile', '--norc', '-c', script], { windowsHide: true, timeout: 30000 })
    if (options.disconnectCommit && commit) { offline = true; throw new Error('Connection lost after replacing files') }
    return result.stdout.trim()
  }
  const app = { packageName: pkg, uid: 1110123, userId: 11 }
  const push = async (local, remote) => { pushed.push(remote); await copyFile(local, remote.replace('/data/local/tmp', temporary)) }
  const restore = () => restoreDataTrees(app, trees, [hash], !options.noRoot, shell, push, () => {}, f.signal)
  return { ...f, app, approot, fsroot, trees, commands, pushed, restore, hash, shell, push }
}
test('real shell replacement preserves app root and unselected cache, removes recovery copies only after success', async t => {
  const f = await filesystemDevice(t), result = await f.restore()
  assert.deepEqual(result.restored, ['data']); assert.equal(await readFile(path.join(f.approot, 'restored'), 'utf8'), 'new data')
  await assert.rejects(readFile(path.join(f.approot, 'original')), /ENOENT/)
  assert.equal(await readFile(path.join(f.approot, 'cache', 'keep'), 'utf8'), 'old cache')
  assert.equal(await readFile(path.join(f.approot, 'lib'), 'utf8'), 'managed library placeholder')
  assert.ok(!(await readdir(f.approot)).some(n => n.startsWith('.adb-vault-restore-')))
  assert.ok(f.commands.some(c => c.command.includes('chown -R 1110123:1110123')))
})
test('real shell rollback restores original files after relabelling failure', async t => {
  const f = await filesystemDevice(t, { failCommit: true })
  await assert.rejects(f.restore(), e => e instanceof DataRestoreFailure && e.rolledBack && !e.mayHaveChanged)
  assert.equal(await readFile(path.join(f.approot, 'original'), 'utf8'), 'old data'); await assert.rejects(readFile(path.join(f.approot, 'restored')), /ENOENT/)
  assert.equal(await readFile(path.join(f.approot, 'cache', 'keep'), 'utf8'), 'old cache')
})
test('disconnect after commit retains old files and reports uncertain outcome', async t => {
  const f = await filesystemDevice(t, { disconnectCommit: true })
  await assert.rejects(f.restore(), e => e instanceof DataRestoreFailure && e.mayHaveChanged && e.recovery.some(p => p.startsWith(target)))
  const job = (await readdir(f.approot)).find(n => n.startsWith('.adb-vault-restore-'))
  assert.equal(await readFile(path.join(f.approot, job, 'old', 'original'), 'utf8'), 'old data')
})
for (const option of ['wrongApk', 'locked', 'shared']) test(`${option} fails before stopping or pushing`, async t => {
  const f = await filesystemDevice(t, { [option]: true }); await assert.rejects(f.restore())
  assert.equal(f.pushed.length, 0); assert.ok(!f.commands.some(c => c.command.startsWith('am force-stop')))
})
test('private restoration without root is rejected before any commands', async t => {
  const f = await filesystemDevice(t)
  await assert.rejects(restoreDataTrees(f.app, f.trees, [f.hash], false, f.shell, f.push, () => {}, f.signal), /Root/)
  assert.equal(f.commands.length, 0)
})

test('cache replacement leaves app data untouched', async t => {
  const f = await filesystemDevice(t, { parts: ['cache'] }); await f.restore()
  assert.equal(await readFile(path.join(f.approot, 'original'), 'utf8'), 'old data')
  assert.equal(await readFile(path.join(f.approot, 'cache', 'restored'), 'utf8'), 'new cache')
  await assert.rejects(readFile(path.join(f.approot, 'cache', 'keep')), /ENOENT/)
})
test('OBB and media restore through shell into new external app directories', async t => {
  const f = await filesystemDevice(t, { parts: ['obb', 'media'], absentExternal: true, noRoot: true }); const result = await f.restore()
  assert.deepEqual(result.restored, ['obb', 'media'])
  for (const part of ['obb', 'media']) assert.equal(await readFile(path.join(f.fsroot, part, pkg, 'restored'), 'utf8'), 'new ' + part)
  assert.ok(!f.commands.some(c => c.root))
})
test('a later component failure rolls back the already committed cache and preserves other components', async t => {
  const f = await filesystemDevice(t, { parts: ['cache', 'obb', 'media'], failAt: 2 })
  await assert.rejects(f.restore(), e => e instanceof DataRestoreFailure && e.rolledBack && !e.mayHaveChanged)
  assert.equal(await readFile(path.join(f.approot, 'cache', 'keep'), 'utf8'), 'old cache')
  for (const part of ['obb', 'media']) assert.equal(await readFile(path.join(f.fsroot, part, pkg, 'original'), 'utf8'), 'old ' + part)
  for (const tree of f.trees) assert.ok(!(await readdir(tree.component === 'cache' ? path.join(f.approot, 'cache') : path.join(f.fsroot, tree.component, pkg))).some(n => n.startsWith('.adb-vault-restore-')))
})
