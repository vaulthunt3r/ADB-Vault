import { expect } from '@playwright/test'
import { test } from './screen-test'
import type { CameraPanelRequest, ScreenSession } from '../electron/screen-protocol'

test.setTimeout(90_000)
declare global { interface Window { cameraTest: { session: ScreenSession; requests: CameraPanelRequest[]; hidden: boolean; error?: string; emit(session: ScreenSession): void } } }
const camera: ScreenSession = { id: 'camera-one', deviceId: 'phone', deviceName: 'Test phone', mode: 'camera', canSetAlwaysOnTop: true, alwaysOnTop: false, title: 'Window 1 · Camera', startedAt: '2026-10-17T16:00:00Z', camera: { facing: 'back', id: '', audio: 'mic', recordFormat: 'mkv' }, cameraControls: ['zoom-in', 'zoom-out', 'torch-on', 'torch-off', 'rotate-left', 'rotate-right'] }
test.beforeEach(async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 336, height: 440 })
  await page.addInitScript(session => {
    const listeners = new Set<(session: ScreenSession) => void>()
    let layout = { docked: true, collapsed: false, shortcut: 'Ctrl+Alt+C', shortcutAvailable: true }
    window.cameraTest = { session, requests: [], hidden: false, emit(value) { this.session = value; listeners.forEach(listener => listener(value)) } }
    window.cameraDesk = {
      state: async () => window.cameraTest.session,
      hide: async () => { window.cameraTest.hidden = true },
      layout: async change => (layout = { ...layout, ...change }),
      onLayout: () => () => {},
      subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      request: async request => { window.cameraTest.requests.push(request); return window.cameraTest.error ? { ok: false, error: window.cameraTest.error } : { ok: true } },
    }
    localStorage.setItem('adb-vault-appearance', JSON.stringify({ version: 1, state: { themeId: 'azure' } }))
  }, camera)
  await page.goto(`${baseURL}/#camera-session=camera-one`)
  await expect(page.getByText('Live preview', { exact: true })).toBeVisible()
})

test('Always on top stays in sync in both camera layouts without changing the recording', async ({ page }) => {
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, alwaysOnTop: false, canSetAlwaysOnTop: true, recording: 'D:/Videos/keep.mkv' }))
  const pin = page.getByRole('button', { name: 'Always on top', exact: true })
  await pin.click()
  expect(await page.evaluate(() => window.cameraTest.requests)).toEqual([{ kind: 'always-on-top', enabled: true }])
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, alwaysOnTop: true }))
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: 'desktop-test-results/camera-pin.png' })
  await page.getByRole('button', { name: 'Collapse camera controls', exact: true }).click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await pin.click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'always-on-top', enabled: false })
  expect(await page.evaluate(() => window.cameraTest.session.recording)).toBe('D:/Videos/keep.mkv')
})

test('live controls send actions during preview and expose camera, sound and recording changes', async ({ page }) => {
  for (const [label, command] of [['Zoom in', 'zoom-in'], ['Zoom out', 'zoom-out'], ['Torch on', 'torch-on'], ['Torch off', 'torch-off'], ['Rotate left', 'rotate-left'], ['Rotate right', 'rotate-right']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'control', command })
  }
  await page.getByRole('button', { name: 'Camera & sound', exact: true }).click()
  await page.getByRole('combobox', { name: 'Live camera' }).selectOption('front')
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'update', update: { kind: 'camera', facing: 'front' } })
  await page.getByRole('combobox', { name: 'Live sound' }).selectOption('off')
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'update', update: { kind: 'audio', audio: 'off' } })
  await page.getByRole('button', { name: 'Start recording · MKV' }).click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'update', update: { kind: 'record', enabled: true } })
  await expect(page.getByText(/Changing camera, sound or recording briefly restarts/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/live-camera-panel.png' })
})

test('recording changes require confirmation, cancellation preserves recording, and stop keeps preview', async ({ page }) => {
  await page.getByRole('button', { name: 'Camera & sound', exact: true }).click()
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, recording: 'D:/Videos/first.mkv' }))
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Live camera' }).selectOption('front')
  const confirm = page.getByRole('alertdialog', { name: 'Continue recording in a new file?' })
  await expect(confirm).toBeVisible()
  expect(await page.evaluate(() => window.cameraTest.requests.length)).toBe(0)
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Live sound' }).selectOption('off')
  await expect(confirm).toContainText('Cancelling the file picker keeps this recording running.')
  await page.screenshot({ path: 'test-results/live-camera-confirmation.png' })
  await confirm.getByRole('button', { name: 'Save and switch…' }).click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'update', update: { kind: 'audio', audio: 'off' }, confirmedSplit: true })
  // The fixture leaves state unchanged, as a cancelled save dialog would.
  await expect(page.getByText('Recording', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop recording · keep preview' }).click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'update', update: { kind: 'record', enabled: false } })
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, recording: undefined }))
  await expect(page.getByRole('button', { name: 'Start recording · MKV' })).toBeVisible()
})

test('unavailable controls, pending changes and errors stay scoped to the live panel', async ({ page }) => {
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, cameraControls: ['rotate-left', 'rotate-right'], restarting: true }))
  await expect(page.getByText('Restarting stream…', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rotate left', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Camera & sound', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Live camera' })).toBeDisabled()
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.evaluate(() => { window.cameraTest.error = 'The camera window has closed.'; window.cameraTest.emit({ ...window.cameraTest.session, restarting: false }) })
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Rotate left', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The camera window has closed.')
  await page.getByRole('button', { name: 'Hide camera controls' }).click()
  expect(await page.evaluate(() => window.cameraTest.hidden)).toBe(true)
  expect(await page.evaluate(() => window.cameraTest.requests.some(r => r.kind === 'stop'))).toBe(false)
  await page.getByRole('button', { name: 'Back to controls' }).click()
  await page.getByRole('button', { name: 'Close camera', exact: true }).click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'stop' })
})

test('zoom limits, detected cameras, docking and editable shortcut are clear in the live panel', async ({ page }) => {
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, cameras: [{ id: '0', facing: 'back' }, { id: '1', facing: 'front' }], cameraZoom: { current: .5, min: .5, max: 10 } }))
  await expect(page.getByLabel('Current zoom')).toHaveText('0.5×')
  await expect(page.locator('.camera-zoom-scale')).toContainText('0.5×')
  await expect(page.locator('.camera-zoom-scale')).toContainText('10×')
  const slider = page.getByRole('slider', { name: 'Camera zoom' })
  await slider.focus(); await slider.press('End')
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'zoom', value: 10 })
  // A request must not fabricate a confirmed current reading.
  await expect(page.getByLabel('Current zoom')).toHaveText('0.5×')
  await page.getByRole('button', { name: 'Camera & sound', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Live camera' }).locator('option[value="external"]')).toHaveJSProperty('disabled', true)
  await page.getByRole('button', { name: 'Refresh cameras', exact: true }).click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'update', update: { kind: 'refresh' } })
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, cameraZoom: { current: 10, min: .5, max: 10 } }))
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await expect(page.getByText('Maximum zoom', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Detach camera controls', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Attach camera controls', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Panel', exact: true }).click()
  const shortcut = page.getByRole('button', { name: 'Change camera controls shortcut', exact: true })
  await shortcut.click(); await shortcut.press('Control+Alt+F8')
  await expect(shortcut).toHaveText('Ctrl + Alt + F8')
  await page.screenshot({ path: 'test-results/camera-docking-zoom.png' })
  await page.setViewportSize({ width: 336, height: 400 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(shortcut).toBeInViewport()
})

test('all camera pages and the collapsed toolbar fit without vertical or horizontal scrolling', async ({ page }) => {
  const fits = async () => {
    expect(await page.locator('.camera-panel').evaluate(root => {
      const bounds = root.getBoundingClientRect()
      return [...root.querySelectorAll<HTMLElement>('button, input, select, p')].every(el => { const r = el.getBoundingClientRect(); return !r.width || r.right <= bounds.right + 1 && r.bottom <= bounds.bottom + 1 }) && root.scrollHeight <= root.clientHeight + 1 && root.scrollWidth <= root.clientWidth + 1
    })).toBe(true)
  }
  for (const theme of ['vault-blue', 'terminal']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    for (const label of ['Controls', 'Camera & sound', 'Panel']) { await page.getByRole('button', { name: label, exact: true }).click(); await fits() }
  }
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, cameraZoom: { current: 1, min: .5, max: 10 } }))
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await page.screenshot({ path: 'test-results/camera-compact-controls.png' })
  const togglePosition = await page.getByRole('button', { name: 'Collapse camera controls' }).boundingBox()
  await page.getByRole('button', { name: 'Collapse camera controls' }).click()
  await page.setViewportSize({ width: 64, height: 440 }); await fits()
  await page.screenshot({ path: 'test-results/camera-toolstrip.png' })
  const expand = page.getByRole('button', { name: 'Expand camera controls', exact: true })
  expect(await expand.boundingBox()).toEqual(togglePosition)
  await expect(expand.locator('svg.lucide-chevrons-left')).toBeVisible()
  await expand.click()
  await page.setViewportSize({ width: 336, height: 440 }); await fits()
  await expect(page.getByRole('button', { name: 'Collapse camera controls' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse camera controls' }).click()
  await page.setViewportSize({ width: 64, height: 440 })
  await page.getByRole('button', { name: 'Camera and sound settings', exact: true }).click()
  await page.setViewportSize({ width: 336, height: 440 })
  await expect(page.getByRole('combobox', { name: 'Live camera' })).toBeVisible()
})

test('zoom slider remains usable when scrcpy has not logged the initial zoom', async ({ page }) => {
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, cameraZoom: { min: 1, max: 10 } }))
  const slider = page.getByRole('slider', { name: 'Camera zoom' })
  await expect(slider).toBeEnabled()
  await expect(page.getByLabel('Current zoom', { exact: true })).toHaveText('—')
  await slider.focus(); await slider.press('End')
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'zoom', value: 10 })
  await expect(page.getByLabel('Current zoom', { exact: true })).toHaveText('—')
  await page.evaluate(() => window.cameraTest.emit({ ...window.cameraTest.session, cameraZoom: { current: 10, min: 1, max: 10 } }))
  await expect(page.getByLabel('Current zoom', { exact: true })).toHaveText('10×')
})

test('camera stays English with a legacy language setting and storage events', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-language', 'ru'))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  expect(await page.evaluate(() => window.cameraTest.requests.at(-1))).toEqual({ kind: 'control', command: 'zoom-in' })
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'adb-vault-language', newValue: 'uk' })))
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.cameraTest.session.id)).toBe('camera-one')
  expect(await page.evaluate(() => localStorage.getItem('adb-vault-language'))).toBeNull()
})
