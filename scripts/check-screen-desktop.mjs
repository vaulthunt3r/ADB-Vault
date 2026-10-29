// Hidden packaged-app smoke check with a disposable profile; no phone operations.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'))
assert.ok(saved.paths.scrcpy, 'An installed scrcpy is needed for this local smoke check.')
await mkdir('desktop-test-results', { recursive: true })
const profile = await mkdtemp(path.resolve('desktop-test-results/screen-profile-'))
await writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: { scrcpy: saved.paths.scrcpy }, known: [], stopAdbOnExit: false, appsOptions: { early: false, root: false } }))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
const releaseName = process.argv[2] || 'virtual-input-20261022'
assert.match(releaseName, /^[a-z0-9-]+$/)
const app = await electron.launch({ executablePath: path.resolve('release', releaseName, 'win-unpacked/ADB Vault.exe'), args: [`--user-data-dir=${profile}`], env })
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.webContents.setBackgroundThrottling(false)))
  const page = await app.firstWindow(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await expect(page.getByRole('heading', { name: 'Component Center.' })).toBeVisible({ timeout: 30000 })
  let capabilities
  await expect.poll(async () => {
    const reply = await page.evaluate(() => window.desktop.request({ type: 'connection.screenCapabilities' }))
    if (reply.ok && reply.screenCapabilities) { capabilities = reply.screenCapabilities; return true }
    return false
  }, { timeout: 60000, intervals: [1000] }).toBe(true)
  assert.ok(capabilities.flags.includes('--new-display')); assert.ok(capabilities.flags.includes('--record'))
  const invalid = await page.evaluate(() => window.desktop.request({ type: 'connection.screen', id: 'test', serial: 'test', action: 'open', options: { mode: '--shell' } }))
  assert.equal(invalid.ok, false); assert.match(invalid.error, /Invalid screen/)
  const invalidPin = await page.evaluate(() => window.desktop.request({ type: 'connection.screenOnTop', sessionId: 'test', enabled: 'true' }))
  assert.equal(invalidPin.ok, false); assert.match(invalidPin.error, /Invalid window pin/)
  const missingPin = await page.evaluate(() => window.desktop.request({ type: 'connection.screenOnTop', sessionId: 'not-an-owned-session', enabled: true }))
  assert.equal(missingPin.ok, false); assert.match(missingPin.error, /session has ended/)
  const sessions = await page.evaluate(() => window.desktop.request({ type: 'snapshot' }))
  assert.deepEqual(sessions.snapshot.screenSessions, [])
  await page.getByLabel('Workspace toolbar').getByRole('button', { name: 'More toolbar actions', exact: true }).click()
  await page.getByRole('dialog', { name: 'Toolbar actions', exact: true }).getByRole('button', { name: 'Open windows', exact: true }).click()
  const windows = page.getByRole('dialog', { name: 'Open windows', exact: true })
  await expect(windows.getByRole('status')).toContainText('No windows are open')
  await expect(windows).toContainText('Touch controls')
  await page.keyboard.press('Escape')
  await expect(windows).not.toBeVisible()
  const noSession = await page.evaluate(() => window.desktop.request({ type: 'connection.screenStop', sessionId: 'not-an-owned-session' }))
  assert.equal(noSession.ok, true)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  await expect(page.getByText(`scrcpy ${capabilities.version} · installed options detected`, { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Maximum resolution', exact: true })).toBeVisible()
  const input = page.getByRole('group', { name: 'Keyboard, mouse & gamepad', exact: true })
  await input.getByRole('combobox', { name: 'Input preset', exact: true }).selectOption('desktop')
  await expect(input.getByRole('combobox', { name: 'Keyboard', exact: true })).toHaveValue('uhid')
  await expect(input.getByRole('combobox', { name: 'Mouse', exact: true })).toHaveValue('uhid')
  await input.getByRole('checkbox', { name: /^Forward PC gamepads/ }).check()
  await expect(input.getByRole('combobox', { name: 'Input preset', exact: true })).toHaveValue('custom')
  await expect(input).toContainText('Press and release left Alt')
  // Hidden Windows windows may not produce compositor frames; show this disposable profile without taking focus.
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(1100, 900); window.showInactive() })
  await input.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(profile, 'input-controls.png'), timeout: 30000 })
  assert.deepEqual(errors, [])
  console.log(`PASS: packaged Electron, scrcpy ${capabilities.version} capabilities, validated IPC, session snapshot, Open windows entry and physical keyboard/mouse/gamepad settings. No phone operations were started. Evidence: ${profile}`)
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) }).catch(() => {})
  await app.close()
}
