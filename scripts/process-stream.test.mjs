import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checked, run } from '../dist-electron/process.js'

test('command errors retain the Android exception before a long stack and final transport errors', () => {
  const result = { code: 1, stderr: 'java.lang.SecurityException: Cannot disable a protected package: com.example.app\n' + '\tat com.android.server.pm.PackageManagerService.setEnabledSettings(PackageManagerService.java:4254)\n'.repeat(40), stdout: 'error: device offline' }
  assert.throws(() => checked(result), error => {
    assert.match(error.message, /^java.lang.SecurityException: Cannot disable a protected package/)
    assert.match(error.message, /output truncated/)
    assert.match(error.message, /error: device offline$/)
    assert.ok(error.message.length <= 1200)
    assert.equal(error.commandResult, result)
    return true
  })
})

test('command errors still filter ADB progress and preserve errors from either stream', () => {
  assert.throws(() => checked({ code: 1, stderr: '[ 25%] /data/app/base.apk\r[ 30%] /data/app/base.apk', stdout: 'Permission denied' }), /^Error: Permission denied$/)
  assert.throws(() => checked({ code: 1, stderr: '[ 25%] /data/app/base.apk', stdout: '' }), /progress only, without an error reason/)
  assert.equal(checked({ code: 0, stdout: 'Success', stderr: '' }), 'Success')
})

test('binary stdout streams unchanged beyond text limits and does not overwrite existing files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adb-vault-stream-')), file = path.join(root, 'data.tar')
  const bytes = Buffer.alloc(3_000_000, 255); bytes[1] = 0; bytes[2] = 13; bytes[3] = 10
  const result = await run(process.execPath, ['-e', 'const b=Buffer.alloc(3000000,255);b[1]=0;b[2]=13;b[3]=10;process.stdout.write(b)'], 10000, undefined, undefined, { stdoutFile: file })
  assert.equal(result.code, 0); assert.equal(result.stdout, '')
  assert.deepEqual(await readFile(file), bytes)
  await assert.rejects(run(process.execPath, ['-e', 'process.stdout.write("replace")'], 10000, undefined, undefined, { stdoutFile: file }))
  assert.deepEqual(await readFile(file), bytes)
})

test('binary stream cancellation and remote failure are surfaced, not success', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'adb-vault-stream-'))
  const controller = new AbortController()
  const task = run(process.execPath, ['-e', 'setInterval(()=>process.stdout.write(Buffer.alloc(1024)),10)'], 10000, undefined, undefined, { stdoutFile: path.join(root, 'partial.tar'), signal: controller.signal })
  setTimeout(() => controller.abort(), 150)
  await assert.rejects(task)
  const failed = await run(process.execPath, ['-e', 'process.stdout.write("partial");process.stderr.write("denied");process.exitCode=1'], 10000, undefined, undefined, { stdoutFile: path.join(root, 'failed.tar') })
  assert.equal(failed.code, 1); assert.equal(failed.stderr, 'denied')
})
