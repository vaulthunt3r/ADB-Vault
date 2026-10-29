import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js'
import { _electron as electron, expect } from '@playwright/test'

const output = path.resolve(process.argv[2] || 'release')
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'))
const archive = path.join(output, `ADB-Vault-${version}-Windows-x64-Portable.zip`)
const testRoot = await fs.mkdtemp(path.resolve('desktop-test-results/portable-distribution-'))
const unpack = spawn(await getPath7za(), ['x', archive, `-o${testRoot}`, '-y'], { windowsHide: true, stdio: 'ignore' })
assert.equal(await new Promise((resolve, reject) => { unpack.on('error', reject); unpack.on('exit', resolve) }), 0)
let folder = path.join(testRoot, 'ADB Vault Portable')
const data = path.join(folder, 'data')
assert.equal((await fs.stat(path.join(folder, 'portable-mode'))).isFile(), true)
await assert.rejects(fs.stat(data), { code: 'ENOENT' })
await fs.mkdir(data)
// Isolated test settings prevent the test instance from shutting down a shared
// ADB server. No existing user profile is copied, read or modified.
await fs.writeFile(path.join(data, 'backend.json'), JSON.stringify({ paths: {}, known: [], stopAdbOnExit: false, appsOptions: { early: false } }))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
let app
const errors = []
try {
  for (let run = 0; run < 2; run++) {
    app = await electron.launch({ executablePath: path.join(folder, 'ADB Vault.exe'), env, timeout: 90000 })
    const actual = await app.evaluate(({ app: runtime, dialog, BrowserWindow }) => {
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1)
        if (options.title !== 'Operations are active' || options.buttons?.[1] !== 'Close safely') throw new Error('Unexpected dialog')
        return { response: 1, checkboxChecked: false }
      }
      return { profile: runtime.getPath('userData'), session: runtime.getPath('sessionData'), logs: runtime.getPath('logs'), hidden: BrowserWindow.getAllWindows().every(window => !window.isVisible()) }
    })
    assert.equal(actual.profile, path.join(folder, 'data'))
    assert.equal(actual.session, path.join(folder, 'data', 'session'))
    assert.equal(actual.logs, path.join(folder, 'data', 'logs'))
    assert.equal(actual.hidden, true)
    const page = await app.firstWindow()
    page.on('pageerror', error => errors.push(error.message))
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true })).toBeAttached()
    if (run === 0) {
      await page.evaluate(() => localStorage.setItem('portable-smoke', 'persists-after-folder-move'))
      const result = await page.evaluate(() => window.desktop.request({ type: 'settings.stopAdbOnExit', enabled: false }))
      assert.equal(result.ok, true)
    } else {
      assert.equal(await page.evaluate(() => localStorage.getItem('portable-smoke')), 'persists-after-folder-move')
      const saved = JSON.parse(await fs.readFile(path.join(folder, 'data', 'backend.json'), 'utf8'))
      assert.equal(saved.stopAdbOnExit, false)
    }
    await app.close(); app = undefined
    if (run === 0) {
      const moved = path.join(testRoot, 'Moved portable copy')
      // Move only this test's extracted directory, after its process has closed.
      for (const candidate of [folder, moved]) assert.equal(path.dirname(path.resolve(candidate)), testRoot)
      await fs.rename(folder, moved)
      folder = moved
    }
  }
  assert.deepEqual(errors, [])
  console.log('PASS: portable ZIP contains no profile; both hidden launches use adjacent data/session/logs, and renderer/backend settings survive moving the folder. No renderer errors.')
  console.log(`Test copy: ${folder}`)
} finally { if (app) await app.close() }
