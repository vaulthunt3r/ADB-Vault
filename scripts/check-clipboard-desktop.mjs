import { _electron as electron } from '@playwright/test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

const profile = path.resolve('desktop-test-results', `clipboard-${Date.now()}`)
await mkdir(profile, { recursive: true })
await writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: {}, known: [], stopAdbOnExit: false, appsOptions: { early: false } }))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env })
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.desktop?.writeClipboard === 'function')
  assert.ok(page.url().startsWith('file:'))
  // Keep the user's clipboard untouched if it contains non-text formats.
  const native = await app.evaluate(async ({ clipboard }) => {
    globalThis.clipboardTest = { original: clipboard.writeText, previous: null, last: null, fail: false }
    const textOnly = (await clipboard.read()).every(item => item.types.every(type => type === 'text/plain'))
    if (textOnly) globalThis.clipboardTest.previous = await clipboard.readText()
    clipboard.writeText = async text => {
      await new Promise(resolve => setTimeout(resolve, 50))
      if (globalThis.clipboardTest.fail) throw new Error('Test clipboard unavailable')
      if (textOnly) await globalThis.clipboardTest.original(text)
      globalThis.clipboardTest.last = text
    }
    return textOnly
  })
  const sample = 'ADB Vault — буфер\n/data/app/example/base.apk'
  await page.evaluate(text => window.desktop.writeClipboard(text), sample)
  assert.equal(await app.evaluate(() => globalThis.clipboardTest.last), sample)
  await app.evaluate(() => { globalThis.clipboardTest.fail = true })
  assert.equal(await page.evaluate(async () => {
    try { await window.desktop.writeClipboard('Must fail'); return false } catch { return true }
  }), true)
  assert.equal(await app.evaluate(() => globalThis.clipboardTest.last), sample)
  if (native) assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), sample)
  for (const value of [42, null, 'x'.repeat(1_000_001)]) {
    assert.equal(await page.evaluate(async value => {
      try { await window.desktop.writeClipboard(value); return false } catch { return true }
    }, value), true)
  }
  assert.equal(await app.evaluate(() => globalThis.clipboardTest.last), sample)
  console.log(`PASS: file:// renderer → trusted clipboard IPC, Unicode/newlines, invalid payload rejection.${native ? ' Native Windows clipboard roundtrip passed.' : ' OS write skipped to preserve non-text clipboard; native API call verified.'}`)
} finally {
  await app.evaluate(async ({ clipboard }) => {
    const saved = globalThis.clipboardTest
    if (!saved) return
    clipboard.writeText = saved.original
    if (saved.previous !== null && await clipboard.readText() === saved.last) await clipboard.writeText(saved.previous)
    delete globalThis.clipboardTest
  }).catch(() => {})
  await app.close()
}
