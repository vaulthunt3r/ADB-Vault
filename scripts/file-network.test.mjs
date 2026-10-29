import test from 'node:test'
import assert from 'node:assert/strict'
import { networkPath, networkRoot, fileParentPath, fileBreadcrumbs } from '../dist-electron/file-locations.js'
import { NetworkFolders, NETWORK_CONNECT_SCRIPT, NETWORK_CONNECT_DECLARATION } from '../dist-electron/file-network.js'
import { validateLocation, validateFilePlan, FileIO } from '../dist-electron/files.js'
import { powershell } from '../dist-electron/process.js'

const local = path => ({ kind: 'local', path })
test('SMB paths retain share roots and URL-encoded names through navigation', () => {
  const folder = networkPath('smb://NAS/Shared%20files/Фото%20семьи')
  assert.equal(folder, '\\\\NAS\\Shared files\\Фото семьи')
  assert.equal(networkRoot(folder), '\\\\NAS\\Shared files')
  assert.equal(fileParentPath(local(folder)), '\\\\NAS\\Shared files')
  assert.equal(fileParentPath(local('\\\\NAS\\Shared files')), '')
  assert.equal(fileParentPath(local('C:\\Downloads')), 'C:\\')
  assert.equal(fileParentPath(local('C:\\')), '')
  assert.equal(fileParentPath({ kind: 'device', path: '/' }), '/')
  assert.deepEqual(fileBreadcrumbs(local(folder)), [{ name: '\\\\NAS\\Shared files', path: '\\\\NAS\\Shared files' }, { name: 'Фото семьи', path: folder }])
})
test('SMB parser refuses device paths, credentials, ports and traversal instead of normalizing them away', () => {
  for (const p of ['\\\\?\\C:\\secret', '\\\\.\\pipe\\x', '\\\\server', '\\\\server\\IPC$', '\\\\server\\share\\..\\x', 'smb://user:password@host/share', 'smb://host:445/share', 'smb://host/share/%2e%2e/x', 'smb://host/share/%2fother', 'smb://host/share/%5cother', 'smb://host/share?password=secret', '\\\\host\\share\\file:ads']) assert.throws(() => networkPath(p), p)
})
test('Windows file validation accepts a disk share but confines operations to the selected folder', { skip: process.platform !== 'win32' }, async () => {
  const root = local('\\\\NAS\\Share'), item = { path: root.path + '\\item.txt', fingerprint: 'fp' }
  assert.equal(validateLocation(root), root)
  assert.doesNotThrow(() => validateFilePlan({ action: 'delete', source: root, confirmed: true, conflict: 'ask', items: [item] }))
  assert.throws(() => validateFilePlan({ action: 'delete', source: root, confirmed: true, conflict: 'ask', items: [{ ...item, path: '\\\\NAS\\Share-elsewhere\\item.txt' }] }), /outside/)
  const io = new FileIO(() => null, () => ({ devices: [] }))
  await assert.rejects(io.remove(root, true), /root is not allowed/)
})
test('network sign-in uses native Windows UI with no password or interpolated address in the script', { skip: process.platform !== 'win32' }, async () => {
  const calls = [], runner = async (exe, args, timeout, input, env, options) => { calls.push({ exe, args, timeout, input, env, options }); return { code: 0, stdout: JSON.stringify({ code: 0, message: 'OK' }), stderr: '' } }
  const network = new NetworkFolders(runner, async () => [])
  assert.equal(await network.connect("smb://NAS/Shared%20files/folder's", true, '456'), "\\\\NAS\\Shared files\\folder's")
  assert.equal(calls[0].env.ADB_VAULT_SHARE, '\\\\NAS\\Shared files'); assert.equal(calls[0].env.ADB_VAULT_SHARE_PROMPT, '1'); assert.equal(calls[0].env.ADB_VAULT_SHARE_OWNER, '456')
  assert.equal(calls[0].input, undefined); assert.equal(calls[0].timeout, 120000)
  const script = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le'); assert.ok(!script.includes('Shared files')); assert.match(script, /WNetAddConnection3W/); assert.match(script, /\$null, \$null, \$flags/)
})
test('network cancellation and credential conflicts keep existing sessions intact; shutdown cancels the helper', { skip: process.platform !== 'win32' }, async () => {
  const cancelled = new NetworkFolders(async () => ({ code: 0, stdout: '{"code":1223,"message":"cancelled"}', stderr: '' }), async () => [])
  assert.equal(await cancelled.connect('\\\\NAS\\Share', false), undefined)
  const denied = new NetworkFolders(async () => ({ code: 0, stdout: '{"code":1219,"message":"conflict"}', stderr: '' }), async () => [])
  await assert.rejects(denied.connect('\\\\NAS\\Share', false), /Existing connections were not disconnected/)
  let signal
  const hanging = new NetworkFolders(async (_file, _args, _timeout, _input, _env, options) => { signal = options.signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) }, async () => [])
  const connecting = hanging.connect('\\\\NAS\\Share', false), rejected = assert.rejects(connecting, /cancelled/)
  await assert.rejects(hanging.connect('\\\\NAS\\Share', false), /Finish/)
  await hanging.shutdown(); await rejected; assert.equal(signal.aborted, true)
})
test('native network declarations compile on Windows without making any network connection', { skip: process.platform !== 'win32' }, async () => {
  const declarations = NETWORK_CONNECT_DECLARATION
  const output = await powershell(declarations + "[VaultNetwork].GetMethod('WNetAddConnection3W').Name", undefined, 20000)
  assert.equal(output.trim(), 'WNetAddConnection3W')
})


test('normal opening reuses the exact mapped share and never authorizes a Windows sign-in popup', { skip: process.platform !== 'win32' }, async () => {
  const mappings = [{ path: '\\\\NAS\\Media', drive: 'K:', addresses: ['192.168.1.1'] }], calls = []
  let reads = 0
  const service = new NetworkFolders(async (_exe, args, timeout, _input, env) => { calls.push({ args, timeout, env }); return { code: 0, stdout: '{"code":0,"message":"existing access"}', stderr: '' } }, async () => { reads++; return mappings })
  assert.equal(await service.connect('\\\\192.168.1.1\\Media\\Photos', false), '\\\\NAS\\Media\\Photos')
  assert.equal(await service.connect('\\\\192.168.1.1\\Media', false), '\\\\NAS\\Media')
  assert.equal(reads, 1)
  assert.equal(calls[0].env.ADB_VAULT_FOLDER, '\\\\NAS\\Media\\Photos'); assert.equal(calls[0].env.ADB_VAULT_SHARE_PROMPT, '0')
  const script = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le')
  assert.ok(script.indexOf('EnumerateFileSystemEntries') < script.indexOf('WNetAddConnection3W'))
  assert.match(script, /\$flags = \[uint32\]0/); assert.doesNotMatch(script, /\$flags = \[uint32\]8/)
  assert.equal(await service.connect('\\\\192.168.1.137\\Media', false), '\\\\192.168.1.137\\Media', 'an unrelated IP must never be redirected to an existing drive')
  await service.connect('\\\\192.168.1.1\\Media', true)
  assert.equal(calls.at(-1).env.ADB_VAULT_SHARE, '\\\\192.168.1.1\\Media'); assert.equal(calls.at(-1).env.ADB_VAULT_SHARE_PROMPT, '1')
})
