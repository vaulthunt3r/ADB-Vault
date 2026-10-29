import { _electron, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
const profile = await mkdtemp(path.resolve('desktop-test-results/touch-overlay-'))
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ADB_VAULT_SMOKE_TEST
const app = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('scripts/fixtures/touch-panels-host.mjs'), `--user-data-dir=${profile}`], env, timeout: 30000 })
try {
  await expect.poll(() => app.evaluate(() => { if (globalThis.touchFailure) throw new Error(globalThis.touchFailure); return globalThis.touchReady }), { timeout: 25000 }).toBe(true)
  const page = app.windows().find(p => p.url().includes('#touch-session=')) || await app.waitForEvent('window')
  await expect(page.getByLabel('New from template')).toBeEnabled({ timeout: 20000 })
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgba(0, 0, 0, 0)')
  await page.getByLabel('New from template').selectOption('shooter')
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#touch-session=')); w.show(); w.focus() })
  await page.screenshot({ path: path.join(profile, 'editor.png') })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true)
  await page.keyboard.press('AltLeft')
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false)
  await expect(page.getByText('Menu · click to touch', { exact: true })).toBeVisible()
  await page.keyboard.press('F8')
  await expect(page.getByLabel('Profile name')).toHaveValue('Shooter')
  await expect.poll(() => page.evaluate(() => document.querySelector('.touch-inspector footer')?.textContent)).toContain('Saved')
  const geometry = await page.evaluate(async () => (await window.touchDesk.state()).geometry)
  assert.deepEqual([geometry.width, geometry.height].sort((a, b) => a - b), [720, 1280], 'Apps may request portrait; mapping follows the actual display orientation')
  await page.getByRole('button', { name: 'Close touch controls' }).click()
  await expect.poll(() => app.windows().filter(p => p.url().includes('#touch-session=')).length).toBe(0)
  assert.equal(await app.evaluate(() => globalThis.touchScreens.state.length), 1, 'Closing editor preserves the virtual display')
  await app.evaluate(() => globalThis.touchPanels.open(globalThis.touchScreens.state[0].id))
  await expect.poll(() => app.windows().filter(p => p.url().includes('#touch-session=')).length).toBe(1)
  const reopened = app.windows().find(p => p.url().includes('#touch-session='))
  await expect(reopened.getByRole('textbox', { name: 'Profile name', exact: true })).toHaveValue('Shooter', { timeout: 15000 })
  await writeFile('desktop-test-results/touch-overlay.json', JSON.stringify({ passed: true, profile, geometry, screenshot: path.join(profile, 'editor.png'), pointerLock: true, altRelease: true, persisted: true }, null, 2))
  console.log(`PASS: transparent editor over real scrcpy window, pointer capture, Alt release, F8 edit, saved profiles across close/reopen. Screenshot: ${profile}/editor.png`)
} finally {
  await app.evaluate(async () => { globalThis.touchPanels?.shutdown(); await globalThis.touchScreens?.shutdown() }).catch(() => {})
  await app.close()
}
