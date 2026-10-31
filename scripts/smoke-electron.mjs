import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { _electron as electron, expect } from '@playwright/test'
const compiler = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'], { stdio: 'inherit', windowsHide: true })
assert.equal(await new Promise(resolve => compiler.on('exit', resolve)), 0)
await import('./preload.mjs')
const profile = path.resolve('desktop-test-results', `profile-${Date.now()}`)
await mkdir(profile, { recursive: true })
await writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: {}, known: [], stopAdbOnExit: false, appsOptions: { early: false } }))
const server = await createServer({ server: { port: 5174, strictPort: true } }); await server.listen()
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5174', ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE
const launchOptions = { args: ['.', `--user-data-dir=${profile}`], env, ...(process.env.ADB_VAULT_TEST_EXECUTABLE ? { executablePath: path.resolve(process.env.ADB_VAULT_TEST_EXECUTABLE) } : {}) }
let app
async function closeTestWindow(instance) {
  // The hidden test window may still be checking components after a restart.
  await instance.evaluate(({ dialog }) => {
    const original = dialog.showMessageBox.bind(dialog)
    dialog.showMessageBox = (...args) => {
      const index = args.at(-1)?.buttons?.indexOf('Close safely') ?? -1
      return index >= 0 ? Promise.resolve({ response: index, checkboxChecked: false }) : original(...args)
    }
  })
  await instance.close()
}
try {
  app = await electron.launch(launchOptions)
  console.log('Electron runtime:', await app.evaluate(() => process.versions.electron))
  let page = await app.firstWindow({ timeout: 90000 }); const errors = []; page.on('pageerror', e => errors.push(e.message))
  await expect(page.getByRole('heading', { name: 'Component Center.' })).toBeVisible({ timeout: 20000 })
  assert.deepEqual(await page.evaluate(() => Object.keys(window.desktop).sort()), ['apkPath', 'control', 'locate', 'readClipboard', 'request', 'subscribe', 'writeClipboard'])
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  await expect.poll(async () => { const r = await page.evaluate(() => window.desktop.request({ type: 'snapshot' })); return r.snapshot.components.some(c => c.status === 'Checking') }, { timeout: 60000 }).toBe(false)
  const invalid = await page.evaluate(() => window.desktop.request({ type: 'shell', command: 'whoami' })); assert.equal(invalid.ok, false)
  const invalidId = await page.evaluate(() => window.desktop.request({ type: 'components.open', id: '../unknown' })); assert.equal(invalidId.ok, false)
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async (_owner, options) => ({ canceled: false, filePaths: [options.properties.includes('openFile') ? folder + '\\adb.exe' : folder] })
  }, profile)
  await page.getByRole('button', { name: 'Locate manually', exact: true }).click()
  await page.getByRole('button', { name: 'Choose adb.exe…' }).click()
  await expect(page.getByLabel('ADB file or folder')).toHaveValue(profile + '\\adb.exe')
  await page.getByRole('button', { name: 'Choose folder…' }).click()
  await expect(page.getByLabel('ADB file or folder')).toHaveValue(profile)
  await page.getByRole('button', { name: 'Use this ADB' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await expect(page.getByLabel('Next connection result')).toHaveCount(0)
  await page.screenshot({ path: 'desktop-test-results/real-electron-connection.png' })
  const actual = await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))
  await writeFile('desktop-test-results/host-detection.json', JSON.stringify(actual.snapshot, null, 2))
  console.log('Host detection:', JSON.stringify(actual.snapshot.components.map(c => ({ id: c.id, status: c.status, version: c.version, location: c.location }))))
  console.log('Actual ADB devices:', actual.snapshot.connection.devices.length)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings' }).click(); await page.getByRole('button', { name: 'Theme Git Dark', exact: true }).click()
  await page.getByRole('button', { name: 'Left sidebar: expanded; show icons' }).click(); await page.getByRole('button', { name: 'Right sidebar: expanded; collapse' }).click()
  await closeTestWindow(app); app = await electron.launch(launchOptions); page = await app.firstWindow({ timeout: 90000 })
  await expect(page.getByRole('button', { name: 'Left sidebar: icons; expand' })).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'git-dark')
  assert.deepEqual(errors, [])
  console.log('PASS: real Electron backend initialization, Windows detection, restricted IPC, native folder picker, rejection of invalid component paths, and persistence. No packages were installed by this test.')
} catch (error) {
  if (app) {
    const page = await app.firstWindow()
    console.error('Failed renderer:', page.url(), await page.locator('body').innerText().catch(() => 'Body unavailable'))
    await page.screenshot({ path: 'desktop-test-results/smoke-failed.png' }).catch(() => {})
  }
  throw error
} finally { if (app) await closeTestWindow(app); await server.close() }
