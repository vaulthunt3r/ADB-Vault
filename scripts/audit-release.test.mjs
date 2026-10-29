import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPackage } from '@electron/asar'
import { auditRelease } from './audit-release.mjs'

test('release gate accepts clean current code and rejects profiles, identifiers and stale code', async () => {
  const previous = process.cwd()
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'adb-vault-release-audit-'))
  try {
    process.chdir(root)
    await fs.mkdir('dist')
    await fs.mkdir('dist-electron')
    await fs.mkdir('dist/assets')
    await fs.writeFile('dist/assets/styles.css', 'body { color: black }')
    await fs.writeFile('dist/index.html', '<h1>ADB Vault</h1>')
    await fs.writeFile('dist-electron/main.js', 'export const version = 1')
    await fs.mkdir('payload')
    await fs.cp('dist', 'payload/dist', { recursive: true })
    await fs.cp('dist-electron', 'payload/dist-electron', { recursive: true })
    await fs.mkdir('out/win-unpacked/resources', { recursive: true })
    await createPackage('payload', 'out/win-unpacked/resources/app.asar')
    assert.equal((await auditRelease('out')).result, 'PASS')
    const leaked = 'out/win-unpacked/backend.json'
    await fs.writeFile(leaked, '{}')
    await assert.rejects(auditRelease('out'), /profile/)
    await fs.unlink(leaked)
    await fs.writeFile('comparison-profile.json', JSON.stringify({ known: [{ serial: 'synthetic_test_device_7426' }] }))
    await fs.writeFile('out/win-unpacked/accidental-log.txt', 'synthetic_test_device_7426')
    await assert.rejects(auditRelease('out', 'comparison-profile.json'), /identity\/path match/)
    await fs.unlink('out/win-unpacked/accidental-log.txt')
    await fs.writeFile('dist-electron/main.js', 'export const version = 2')
    await assert.rejects(auditRelease('out'), /Stale packaged/)
  } finally {
    process.chdir(previous)
    // root is the exact directory created above, never a computed user path.
    await fs.rm(root, { recursive: true, force: true })
  }
})
