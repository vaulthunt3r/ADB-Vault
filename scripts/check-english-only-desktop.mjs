import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { _electron as electron, expect } from '@playwright/test'
const profile = await fs.mkdtemp(path.resolve('desktop-test-results/english-desktop-profile-'))
await fs.writeFile(path.join(profile, 'backend.json'), JSON.stringify({ language: 'uk', paths: {}, known: [], stopAdbOnExit: false, appsOptions: { early: false } }))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
const executablePath = path.resolve(process.argv[2] || 'release/english-only-20261025/win-unpacked/ADB Vault.exe')
let app
const errors = []
try {
  for (let launch = 0; launch < 2; launch++) {
    app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 90000 })
    const runtimeVersion = await app.evaluate(() => process.versions.electron)
    if (process.env.ADB_VAULT_EXPECT_ELECTRON) assert.equal(runtimeVersion, process.env.ADB_VAULT_EXPECT_ELECTRON)
    // Startup detection may still be active on a fast smoke run. Accept only the
    // test instance's exit prompt without showing a native modal on the desktop.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1)
        if (options.title !== 'Operations are active' || options.buttons?.[1] !== 'Close safely') throw new Error('Unexpected test dialog')
        return { response: 1, checkboxChecked: false }
      }
    })
    const page = await app.firstWindow()
    page.on('pageerror', e => errors.push(e.message))
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true })).toBeAttached()
    const welcome = page.getByRole('complementary', { name: 'Welcome to ADB Vault' })
    if (launch === 0) {
      await expect(welcome).toBeVisible()
      await welcome.getByRole('button', { name: 'Not now', exact: true }).click()
      await page.getByRole('button', { name: 'Quick tour', exact: true }).click()
      await page.locator('dialog.interface-tour').getByRole('button', { name: 'Skip tour', exact: true }).click()
    } else {
      await expect(welcome).toHaveCount(0)
      await expect(page.locator('dialog.interface-tour')).toHaveCount(0)
    }
    const icon = await app.evaluate(({ app: runtime, nativeImage }) => {
      const image = nativeImage.createFromPath(runtime.getAppPath() + '/dist/app-icon.png')
      return { empty: image.isEmpty(), size: image.getSize() }
    })
    assert.deepEqual(icon, { empty: false, size: { width: 256, height: 256 } })
    const snapshot = await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))
    assert.equal(Object.hasOwn(snapshot.snapshot, 'language'), false)
    const rejected = await page.evaluate(() => window.desktop.request({ type: 'settings.language', language: 'ru' }))
    assert.equal(rejected.ok, false)
    assert.match(rejected.error, /Unsupported request/)
    // Exercise persistence through real IPC without focusing or showing the window.
    const saved = await page.evaluate(() => window.desktop.request({ type: 'settings.stopAdbOnExit', enabled: false }))
    assert.equal(saved.ok, true)
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible())), false)
    console.log(`PASS: launch ${launch + 1}, Electron ${runtimeVersion}, English interface and hidden window; closing isolated test instance.`)
    await app.close(); app = undefined
  }
  const saved = JSON.parse(await fs.readFile(path.join(profile, 'backend.json'), 'utf8'))
  assert.equal(Object.hasOwn(saved, 'language'), false)
  assert.equal(saved.stopAdbOnExit, false)
  assert.deepEqual(errors, [])
  console.log('PASS: hidden packaged application stays English, loads its icon, preserves skipped-tour and other settings after restart; no renderer errors.')
} finally { if (app) await app.close() }
