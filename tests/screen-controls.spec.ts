import { expect, type Page } from '@playwright/test'
import { test } from './screen-test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'

test.setTimeout(90_000)
const phone = { id: 'screen-phone', serial: '192.168.1.2:4444', name: 'Screen test phone', method: 'Wi-Fi' as const, status: 'connected' as const, android: '16', endpoint: '192.168.1.2:4444', lastSeen: '', known: true, canDetach: true, transportId: '7' }
async function ready(page: Page) {
  await connectionEvent(page, { devices: [phone], activeDeviceId: phone.id })
  await page.evaluate(() => window.backendTest.emit({ type: 'components', components: window.backendTest.snapshot.components.map(c => c.id === 'scrcpy' ? { ...c, location: 'C:/scrcpy', version: '3.3.4', status: 'Installed' } : c) }))
}
async function enableCameraControls(page: Page) {
  await page.evaluate(() => {
    const request = window.desktop!.request
    window.desktop!.request = async value => {
      const reply = await request(value)
      if (value.type === 'connection.screenCapabilities' && reply.ok && reply.screenCapabilities) return { ...reply, screenCapabilities: { version: '5.0.1', flags: [...reply.screenCapabilities.flags, '--camera-zoom', '--camera-torch', '--display-orientation', '--record-orientation'] } }
      return reply
    }
  })
}
async function openDialog(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Screen & recording', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Screen & recording' })
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  return dialog
}

async function enableCameraModes(page: Page, fail = false) {
  await page.evaluate(fail => {
    const request = window.desktop!.request
    window.desktop!.request = async value => {
      const reply = await request(value)
      if (value.type === 'connection.screenCapabilities' && reply.ok && reply.screenCapabilities) return { ...reply, screenCapabilities: { version: '5.0.1', flags: [...reply.screenCapabilities.flags, '--list-camera-sizes', '--camera-high-speed'] } }
      if (value.type === 'connection.cameraModes') return fail ? { ok: false, snapshot: window.backendTest.snapshot, error: 'Camera access unavailable.' } : { ok: true, snapshot: window.backendTest.snapshot, cameraModes: [
        { id: '0', facing: 'back', sizes: ['1920x1080', '1280x720'], fps: [30, 60], highSpeedModes: [{ size: '1920x1080', fps: [120] }, { size: '1280x720', fps: [120, 240] }] },
        { id: '1', facing: 'front', sizes: ['640x480'], fps: [24, 30], highSpeedModes: [] },
      ] }
      return reply
    }
  }, fail)
}

test('phone-reported camera modes follow the lens and distinguish high-speed size and FPS pairs', async ({ page }) => {
  await enableCameraModes(page)
  const dialog = await openDialog(page)
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'connection.cameraModes'))).toBe(false)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByText('2 cameras reported by this phone.', { exact: false })).toBeVisible()
  const size = dialog.getByRole('combobox', { name: 'Capture size', exact: true }), fps = dialog.getByRole('combobox', { name: 'Camera frame rate', exact: true })
  await expect(size).toHaveValue(''); await expect(fps).toHaveValue('30')
  await dialog.getByRole('combobox', { name: 'Camera ID', exact: true }).selectOption('1')
  expect(await size.locator('option').allTextContents()).toContain('640x480')
  expect(await size.locator('option').allTextContents()).not.toContain('1920x1080')
  expect(await fps.locator('option').allTextContents()).toContain('24 FPS')
  await dialog.getByRole('combobox', { name: 'Camera ID', exact: true }).selectOption('0')
  await dialog.getByRole('checkbox', { name: /^High-speed capture/ }).check()
  await expect(size).toHaveValue('1920x1080'); await expect(fps).toHaveValue('120')
  expect(await fps.locator('option').allTextContents()).not.toContain('240 FPS')
  await size.selectOption('1280x720'); await fps.selectOption('240')
  await dialog.getByRole('button', { name: 'Refresh camera modes' }).click()
  await expect(dialog.getByRole('button', { name: 'Refresh camera modes' })).toBeEnabled()
  await expect(size).toHaveValue('1280x720'); await expect(fps).toHaveValue('240')
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await size.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/camera-phone-modes.png' })
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ id: phone.id, serial: phone.serial, transportId: '7', options: { mode: 'camera', cameraId: '0', cameraHighSpeed: true, cameraSize: '1280x720', cameraFps: 240, record: false } })
})

test('camera mode read failure preserves saved launch settings and supports manual sizes', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-screen', JSON.stringify({ version: 1, state: { preferences: { cameraFacing: 'front', cameraSize: '1920x1080', cameraFps: 60, bitRate: 16 } } })))
  await page.reload(); await ready(page); await enableCameraModes(page, true)
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByText(/Camera access unavailable/)).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Capture size', exact: true })).toHaveValue('1920x1080')
  await expect(dialog.getByRole('combobox', { name: 'Camera frame rate', exact: true })).toHaveValue('60')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  await dialog.getByRole('combobox', { name: 'Capture size', exact: true }).selectOption('manual')
  await dialog.getByRole('textbox', { name: 'Custom capture size', exact: true }).fill('1600x900')
  await dialog.getByRole('combobox', { name: 'Camera frame rate', exact: true }).selectOption('manual')
  await dialog.getByRole('spinbutton', { name: 'Custom camera frame rate', exact: true }).fill('25')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { cameraFacing: 'front', cameraSize: '1600x900', cameraFps: 25, cameraHighSpeed: false, bitRate: 16 } })
})

test('editing a custom camera mode never resets unrelated saved preferences', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  await page.getByRole('combobox', { name: 'Maximum resolution', exact: true }).selectOption('2560')
  await page.getByRole('combobox', { name: 'Capture size', exact: true }).selectOption('manual')
  const customSize = page.getByRole('textbox', { name: 'Custom capture size', exact: true })
  await customSize.fill('1600x')
  await page.getByRole('combobox', { name: 'Camera frame rate', exact: true }).focus()
  await expect(page.getByText(/The previous size is kept/)).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Maximum resolution', exact: true })).toHaveValue('2560')
  await customSize.fill('1600x900')
  await page.getByRole('combobox', { name: 'Camera frame rate', exact: true }).selectOption('manual')
  await page.getByRole('spinbutton', { name: 'Custom camera frame rate', exact: true }).fill('25')
  await page.getByRole('combobox', { name: 'Initial zoom', exact: true }).focus()
  await page.reload(); await ready(page)
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Maximum resolution', exact: true })).toHaveValue('2560')
  await expect(dialog.getByRole('combobox', { name: 'Capture size', exact: true })).toHaveValue('1600x900')
  await expect(dialog.getByRole('combobox', { name: 'Camera frame rate', exact: true })).toHaveValue('25')
})

test('camera catalog reply after leaving Camera cannot change the next launch', async ({ page }) => {
  await enableCameraModes(page)
  await page.evaluate(() => {
    const request = window.desktop!.request
    window.desktop!.request = async value => {
      const reply = await request(value)
      if (value.type === 'connection.cameraModes') await new Promise<void>(resolve => { (window as unknown as { finishCameraRead: () => void }).finishCameraRead = resolve })
      return reply
    }
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByText('Reading this phone’s camera modes…')).toBeVisible()
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishCameraRead?: () => void }).finishCameraRead)).toBe('function')
  await dialog.getByRole('button', { name: 'Phone screen', exact: true }).click()
  await page.evaluate(() => (window as unknown as { finishCameraRead: () => void }).finishCameraRead())
  await expect(dialog.getByRole('button', { name: 'Phone screen', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'display', cameraHighSpeed: false, cameraSize: '', cameraFps: 30 } })
})
test.beforeEach(async ({ page, baseURL }) => { await installBackendFixture(page); await page.goto(baseURL!, { timeout: 60000, waitUntil: 'domcontentloaded' }); await ready(page) })

test('virtual input presets are visible, can be combined and dispatch the selected devices', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Application to open', exact: true }).selectOption('org.example.player')
  const input = dialog.getByRole('group', { name: 'Keyboard, mouse & gamepad', exact: true })
  const automaticTouch = dialog.getByRole('checkbox', { name: /^Open window controls automatically/ })
  await expect(automaticTouch).toBeChecked()
  await automaticTouch.uncheck(); await expect(automaticTouch).not.toBeChecked(); await automaticTouch.check()
  await expect(input.getByRole('combobox', { name: 'Mouse', exact: true })).toBeVisible()
  await input.getByRole('combobox', { name: 'Input preset', exact: true }).selectOption('gamepad')
  await expect(automaticTouch).toBeDisabled(); await expect(automaticTouch).not.toBeChecked()
  await expect(input.getByRole('checkbox', { name: /^Forward PC gamepads/ })).toBeChecked()
  await input.getByRole('combobox', { name: 'Input preset', exact: true }).selectOption('desktop')
  await expect(input.getByRole('combobox', { name: 'Keyboard', exact: true })).toHaveValue('uhid')
  await expect(input.getByRole('combobox', { name: 'Mouse', exact: true })).toHaveValue('uhid')
  await expect(input).toContainText('Press and release left Alt')
  await input.getByRole('checkbox', { name: /^Forward PC gamepads/ }).check()
  await expect(input.getByRole('combobox', { name: 'Input preset', exact: true })).toHaveValue('custom')
  await page.setViewportSize({ width: 1000, height: 750 })
  await input.scrollIntoViewIfNeeded()
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/virtual-display-native-input.png' })
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'virtual', keyboard: 'uhid', mouse: 'uhid', gamepad: true, application: { packageName: 'org.example.player', userId: 0 } } })
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('adb-vault-screen') || '{}').state?.preferences?.mouse)).not.toBe('uhid')
})

test('virtual touch auto-start can be disabled for an ordinary application', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Application to open', exact: true }).selectOption('org.example.player')
  await dialog.getByRole('checkbox', { name: /^Open window controls automatically/ }).uncheck()
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'virtual', touchControls: false, keyboard: 'sdk', mouse: 'sdk', gamepad: false } })
})

test('old preferences keep picture and keyboard choices, and new mouse settings persist', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-screen', JSON.stringify({ version: 1, state: { preferences: { maxSize: 1280, audio: 'off', keyboard: 'uhid', gamepad: true } } })))
  await page.reload(); await ready(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Mouse', exact: true })).toHaveValue('sdk')
  await expect(page.getByRole('combobox', { name: 'Keyboard', exact: true })).toHaveValue('uhid')
  await page.getByRole('combobox', { name: 'Mouse', exact: true }).selectOption('uhid')
  await page.getByRole('checkbox', { name: /^Control the phone/ }).uncheck()
  await expect(page.getByRole('combobox', { name: 'Mouse', exact: true })).toBeDisabled()
  await page.getByRole('checkbox', { name: /^Control the phone/ }).check()
  await page.reload(); await ready(page)
  const dialog = await openDialog(page)
  await expect(dialog.getByRole('combobox', { name: 'Mouse', exact: true })).toHaveValue('uhid')
  await expect(dialog.getByRole('combobox', { name: 'Maximum resolution', exact: true })).toHaveValue('1280')
  await expect(dialog.getByRole('combobox', { name: /^Sound source/ })).toHaveValue('off')
  await expect(dialog.getByRole('checkbox', { name: /^Forward PC gamepads/ })).toBeChecked()
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByRole('group', { name: 'Keyboard, mouse & gamepad', exact: true })).toHaveCount(0)
})

test('unavailable saved physical mouse input blocks launch until changed', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-screen', JSON.stringify({ version: 1, state: { preferences: { mouse: 'uhid' } } })))
  await page.reload(); await ready(page)
  await page.evaluate(() => {
    const request = window.desktop!.request
    window.desktop!.request = async value => {
      const reply = await request(value)
      if (value.type === 'connection.screenCapabilities' && reply.ok && reply.screenCapabilities) return { ...reply, screenCapabilities: { ...reply.screenCapabilities, flags: reply.screenCapabilities.flags.filter(f => f !== '--mouse') } }
      return reply
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Screen & recording', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Screen & recording' })
  await expect(dialog.getByRole('alert')).toContainText('physical mouse')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('combobox', { name: 'Input preset', exact: true }).locator('option[value="desktop"]')).toHaveAttribute('disabled', '')
  await dialog.getByRole('combobox', { name: 'Input preset', exact: true }).selectOption('apps')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'connection.screen'))).toBe(false)
})

test('virtual display requires an explicit app selection in the launch dialog', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  const select = dialog.getByRole('combobox', { name: 'Application to open', exact: true })
  await expect(select).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await dialog.getByRole('searchbox', { name: 'Find an application' }).fill('player')
  await select.selectOption('org.example.player')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  await page.screenshot({ path: 'test-results/virtual-display-app-picker.png' })
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  const requests = await page.evaluate(() => window.backendTest.requests)
  expect(requests.find(r => r.type === 'connection.screenApplications')).toEqual({ type: 'connection.screenApplications', id: phone.id, serial: phone.serial, transportId: phone.transportId })
  expect(requests.filter(r => r.type === 'connection.screen').at(-1)).toMatchObject({ options: { mode: 'virtual', control: true, application: { packageName: 'org.example.player', userId: 0 } } })
})

test('changing capture mode clears the virtual app and revisiting virtual requires a fresh selection', async ({ page }) => {
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Application to open' }).selectOption('org.example.player')
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Application to open' })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Phone screen', exact: true }).click()
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  const launch = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))
  expect(launch).toMatchObject({ options: { mode: 'display' } })
  expect(launch?.type === 'connection.screen' && launch.options?.application).toBeUndefined()
})

test('app-list failures can be retried, and stale phone connections cannot launch the selected app', async ({ page }) => {
  await page.evaluate(() => {
    const request = window.desktop!.request
    let fail = true
    window.addEventListener('test-allow-app-list', () => { fail = false }, { once: true })
    window.desktop!.request = async value => {
      if (value.type === 'connection.screenApplications' && fail) return { ok: false, snapshot: window.backendTest.snapshot, error: 'Could not read applications. Try again.' }
      return request(value)
    }
  })
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Could not read applications')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('test-allow-app-list')))
  await dialog.getByRole('button', { name: 'Refresh launchable applications' }).click()
  await dialog.getByRole('combobox', { name: 'Application to open' }).selectOption('org.example.browser')
  await connectionEvent(page, { devices: [{ ...phone, transportId: '8' }], activeDeviceId: phone.id })
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('combobox', { name: 'Application to open' })).toHaveValue('')
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'connection.screen'))).toBe(false)
})

test('screen defaults persist and quick Mirror uses them without starting recording', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  await page.getByRole('combobox', { name: 'Maximum resolution', exact: true }).selectOption('1920')
  await page.getByRole('combobox', { name: /^Sound source/ }).selectOption('duplicate')
  await page.getByText('Window & controls', { exact: true }).click()
  await page.getByRole('checkbox', { name: /^Forward PC gamepads/ }).check()
  await page.reload(); await ready(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  await expect(page.getByRole('combobox', { name: /^Sound source/ })).toHaveValue('duplicate')
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('tabpanel').getByRole('button', { name: 'Mirror screen', exact: true }).click()
  const request = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))
  expect(request).toMatchObject({ id: phone.id, serial: phone.serial, transportId: '7', action: 'open', options: { audio: 'duplicate', maxSize: 1920, gamepad: true, mode: 'display', record: false } })
})

test('mode selection, recording and responsive themed dialog dispatch exact settings', async ({ page }) => {
  await enableCameraControls(page)
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: /^Resize Android display/ })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('front')
  await dialog.getByRole('combobox', { name: 'Capture size', exact: true }).selectOption('1920x1080')
  await dialog.getByRole('combobox', { name: /^Sound source/ }).selectOption('off')
  await dialog.getByRole('combobox', { name: 'Initial zoom', exact: true }).selectOption('2')
  await dialog.getByRole('combobox', { name: 'Preview rotation', exact: true }).selectOption('90')
  await dialog.getByRole('combobox', { name: 'Recording rotation', exact: true }).selectOption('180')
  await dialog.getByRole('checkbox', { name: /^Start with torch on/ }).check()
  await dialog.getByRole('checkbox', { name: /^Record this session/ }).check()
  await dialog.getByRole('combobox', { name: 'Stop automatically', exact: true }).selectOption('300')
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  const box = (await dialog.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(680)
  await page.screenshot({ path: 'test-results/scrcpy-camera-options.png' })
  await dialog.getByRole('button', { name: 'Start recording…', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'camera', cameraFacing: 'front', cameraSize: '1920x1080', cameraZoom: 2, cameraTorch: true, cameraPreviewRotation: 90, cameraRecordRotation: 180, audio: 'off', record: true, recordFormat: 'mkv', timeLimit: 300 } })
  await page.getByRole('button', { name: 'Terminal mode', exact: true }).dblclick()
  const terminal = await openDialog(page)
  await terminal.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(terminal).toHaveCSS('border-radius', '0px')
  expect(await terminal.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  await page.screenshot({ path: 'test-results/scrcpy-terminal-options.png' })
})

test('camera defaults migrate, persist, and camera shortcuts are distinct from phone controls', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-screen', JSON.stringify({ version: 1, state: { preferences: { maxSize: 1920, audio: 'off', cameraFacing: 'front' } } })))
  await page.reload(); await ready(page); await enableCameraControls(page)
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('group', { name: 'Settings categories' }).getByRole('button', { name: 'Screen & audio', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Maximum resolution', exact: true })).toHaveValue('1920')
  await expect(page.getByRole('combobox', { name: 'Initial zoom', exact: true })).toHaveValue('1')
  await expect(page.getByRole('combobox', { name: 'Recording rotation', exact: true })).toHaveValue('preview')
  await page.getByRole('combobox', { name: 'Initial zoom', exact: true }).selectOption('1.5')
  await page.getByRole('combobox', { name: 'Preview rotation', exact: true }).selectOption('270')
  await page.getByRole('checkbox', { name: /^Start with torch on/ }).check()
  await page.reload(); await ready(page); await enableCameraControls(page)
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Initial zoom', exact: true })).toHaveValue('1.5')
  await expect(dialog.getByRole('combobox', { name: 'Preview rotation', exact: true })).toHaveValue('270')
  await expect(dialog.getByRole('checkbox', { name: /^Start with torch on/ })).toBeChecked()
  await dialog.getByText('Controls & shortcuts', { exact: true }).click()
  await expect(dialog.getByText('Camera: zoom in / out', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Home / Back / recent apps', { exact: true })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: /^Record this session/ }).check()
  await dialog.getByRole('button', { name: 'Start recording…', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'camera', maxSize: 1920, audio: 'off', cameraFacing: 'front', cameraZoom: 1.5, cameraTorch: true, cameraPreviewRotation: 270, cameraRecordRotation: 'preview', record: true } })
})

test('older scrcpy explains unsupported saved camera controls and allows resetting them', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('adb-vault-screen', JSON.stringify({ version: 1, state: { preferences: { cameraZoom: 2, cameraTorch: true, cameraPreviewRotation: 90, cameraRecordRotation: 180 } } })))
  await page.reload(); await ready(page)
  const dialog = await openDialog(page)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('initial zoom')
  await dialog.getByRole('combobox', { name: 'Initial zoom', exact: true }).selectOption('1')
  await dialog.getByRole('checkbox', { name: /^Start with torch on/ }).uncheck()
  await expect(dialog.getByRole('checkbox', { name: /^Start with torch on/ })).toBeDisabled()
  await dialog.getByRole('combobox', { name: 'Preview rotation', exact: true }).selectOption('0')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  await dialog.getByRole('checkbox', { name: /^Record this session/ }).check()
  await expect(dialog.getByRole('button', { name: 'Start recording…', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('recording rotation')
  await dialog.getByRole('combobox', { name: 'Recording rotation', exact: true }).selectOption('preview')
  await expect(dialog.getByRole('button', { name: 'Start recording…', exact: true })).toBeEnabled()
})

test('a changed phone transport prevents launch and Stop targets an owned session', async ({ page }) => {
  const dialog = await openDialog(page)
  await connectionEvent(page, { devices: [{ ...phone, transportId: '9' }], activeDeviceId: phone.id })
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('connection changed')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.evaluate(id => window.backendTest.emit({ type: 'screenSessions', sessions: [{ id: 'session-one', deviceId: id, deviceName: 'Screen test phone', mode: 'display', startedAt: new Date().toISOString(), recording: 'D:/video.mkv' }] }), phone.id)
  await page.getByRole('button', { name: 'Finish recording', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screenStop').at(-1))).toEqual({ type: 'connection.screenStop', sessionId: 'session-one' })
})

test('Apps opens the chosen application on a virtual display and refuses other profiles', async ({ page }) => {
  const app: AndroidApp = { packageName: 'org.example.player', label: 'Example player', versionName: '1', versionCode: 1, uid: 10001, userId: 0, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/player/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }
  await page.evaluate(app => { window.backendTest.snapshot.apps.apps = [app] }, app)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Example player', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  const action = page.getByRole('button', { name: 'Virtual display', exact: true })
  await action.click()
  const dialog = page.getByRole('dialog', { name: 'Screen & recording' })
  await expect(dialog.getByRole('button', { name: 'Virtual display', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.getByRole('button', { name: 'Camera', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'virtual', application: { packageName: app.packageName, userId: 0 } } })
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, currentUserId: 10 } }))
  await expect(action).toBeDisabled()
})

const contextApp: AndroidApp = { packageName: 'org.example.player', label: 'Example player', versionName: '1', versionCode: 1, uid: 10001, userId: 0, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/player/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }
async function toolbarScreen(page: Page, name: string) {
  await page.getByLabel('Workspace toolbar').getByRole('button', { name: 'More toolbar actions', exact: true }).click()
  await page.getByRole('dialog', { name: 'Toolbar actions', exact: true }).getByRole('button', { name, exact: true }).click()
  return page.getByRole('dialog', { name: 'Screen & recording', exact: true })
}
test('toolbar keeps application context from its card, allows changing the app, and ignores it outside Apps', async ({ page }) => {
  await page.evaluate(app => { window.backendTest.snapshot.apps.apps = [app] }, contextApp)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Example player', exact: true }).dblclick()
  const dialog = await toolbarScreen(page, 'Virtual display')
  await expect(dialog.getByRole('combobox', { name: 'Application to open', exact: true })).toHaveValue(contextApp.packageName)
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
  await dialog.getByRole('combobox', { name: 'Application to open', exact: true }).selectOption('org.example.browser')
  await dialog.getByRole('button', { name: 'Refresh launchable applications', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Application to open', exact: true })).toHaveValue('org.example.browser')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { application: { packageName: 'org.example.browser', userId: 0 } } })
  await toolbarScreen(page, 'Screen & recording')
  await expect(dialog.getByRole('button', { name: 'Phone screen', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Application to open', exact: true })).toHaveValue(contextApp.packageName)
  await dialog.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Virtual display', exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Application to open', exact: true })).toHaveValue(contextApp.packageName)
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { mode: 'virtual', application: { packageName: contextApp.packageName, userId: 0 } } })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await toolbarScreen(page, 'Virtual display')
  await expect(dialog.getByRole('combobox', { name: 'Application to open', exact: true })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
})
test('toolbar never substitutes the same package from another Android profile', async ({ page }) => {
  await page.evaluate(app => { window.backendTest.snapshot.apps.apps = [app] }, { ...contextApp, userId: 11 })
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, userId: 11, currentUserId: 0 } }))
  await page.getByRole('button', { name: 'Details for Example player', exact: true }).click()
  const dialog = await toolbarScreen(page, 'Virtual display')
  await expect(dialog.getByRole('status')).toContainText('another Android profile')
  await expect(dialog.getByRole('combobox', { name: 'Application to open', exact: true })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
})
test('single checked application exposes Virtual display in Actions without enabling a bulk launch', async ({ page }) => {
  const other = { ...contextApp, packageName: 'org.example.browser', label: 'Browser' }
  await page.evaluate(apps => { window.backendTest.snapshot.apps.apps = apps }, [contextApp, other])
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Select Example player (org.example.player)', exact: true }).check()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  const action = page.getByRole('button', { name: 'Virtual display', exact: true })
  await expect(action).toBeEnabled(); await action.click()
  const dialog = page.getByRole('dialog', { name: 'Screen & recording', exact: true })
  await expect(dialog).toContainText('Example player · Profile ID 0')
  await dialog.getByRole('button', { name: 'Start', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen').at(-1))).toMatchObject({ options: { application: { packageName: contextApp.packageName, userId: 0 } } })
  await page.evaluate(id => window.backendTest.emit({ type: 'screenSessions', sessions: [{ id: 'checked-player', deviceId: id, deviceName: 'Screen test phone', mode: 'virtual', virtualDisplayId: 8, application: 'org.example.player', startedAt: new Date().toISOString() }] }), phone.id)
  await page.getByRole('button', { name: 'Window controls', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.touchControls').at(-1))).toEqual({ type: 'connection.touchControls', sessionId: 'checked-player' })
  await page.getByRole('checkbox', { name: 'Select Browser (org.example.browser)', exact: true }).check()
  await expect(action).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Select Browser (org.example.browser)', exact: true }).uncheck()
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, apps: window.backendTest.snapshot.apps.apps.map(a => ({ ...a, enabled: false })) } }))
  await expect(action).toBeDisabled()
})

test('Open windows in the toolbar exposes touch controls for the exact session and updates while open', async ({ page }) => {
  await toolbarScreen(page, 'Open windows')
  const windows = page.getByRole('dialog', { name: 'Open windows', exact: true })
  await expect(windows.getByRole('status')).toContainText('No windows are open')
  await page.evaluate(id => window.backendTest.emit({ type: 'screenSessions', sessions: [
    { id: 'game-one', title: 'Game one', deviceId: id, deviceName: 'Screen test phone', mode: 'virtual', virtualDisplayId: 8, application: 'org.example.player', startedAt: new Date().toISOString() },
    { id: 'game-two', title: 'Game two', deviceId: 'other-phone', deviceName: 'Other phone', mode: 'virtual', virtualDisplayId: 9, application: 'org.example.browser', startedAt: new Date().toISOString() },
    { id: 'starting', title: 'Starting game', deviceId: id, deviceName: 'Screen test phone', mode: 'virtual', startedAt: new Date().toISOString() },
  ] }), phone.id)
  await expect(windows.getByRole('group', { name: 'Starting game', exact: true }).getByRole('button', { name: 'Window controls' })).toBeDisabled()
  await windows.getByRole('group', { name: 'Game two', exact: true }).getByRole('button', { name: 'Window controls' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.touchControls').at(-1))).toEqual({ type: 'connection.touchControls', sessionId: 'game-two' })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'connection.screen'))).toBe(false)
  await page.setViewportSize({ width: 1000, height: 750 })
  expect(await windows.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'desktop-test-results/open-windows-touch-controls.png' })
  await page.keyboard.press('Escape')
  await expect(windows).not.toBeVisible()
  const launch = await openDialog(page)
  await expect(launch.getByRole('group', { name: 'Game one', exact: true }).getByRole('button', { name: 'Window controls' })).toBeInViewport()
  await expect(launch.getByRole('group', { name: 'Game two', exact: true })).toHaveCount(0)
  await launch.getByRole('button', { name: 'Cancel', exact: true }).click()
  await toolbarScreen(page, 'Open windows')
  await page.evaluate(() => window.backendTest.emit({ type: 'screenSessions', sessions: [] }))
  await expect(windows.getByRole('status')).toContainText('No windows are open')
})

test('Always on top targets each screen mode independently and shows confirmed pin state', async ({ page }) => {
  await toolbarScreen(page, 'Open windows')
  await page.evaluate(() => {
    const sessions = (['display', 'virtual', 'camera'] as const).map(mode => ({ id: mode, title: mode, deviceId: 'phone', deviceName: 'Phone', mode, startedAt: new Date().toISOString(), canSetAlwaysOnTop: true, alwaysOnTop: mode === 'camera' }))
    window.backendTest.emit({ type: 'screenSessions', sessions })
    const request = window.desktop!.request
    window.desktop!.request = async value => {
      const reply = await request(value)
      if (value.type === 'connection.screenOnTop') {
        if (value.sessionId === 'virtual') return { ok: false, error: 'Window is not ready.', snapshot: reply.snapshot }
        sessions.find(s => s.id === value.sessionId)!.alwaysOnTop = value.enabled
        window.backendTest.emit({ type: 'screenSessions', sessions })
      }
      return reply
    }
  })
  const windows = page.getByRole('dialog', { name: 'Open windows', exact: true })
  const row = (name: string) => windows.getByRole('group', { name, exact: true })
  const pin = (name: string) => row(name).getByRole('button', { name: 'Always on top', exact: true })
  await expect(pin('camera')).toHaveAttribute('aria-pressed', 'true')
  await pin('display').click()
  await expect(pin('display')).toHaveAttribute('aria-pressed', 'true')
  await expect(pin('virtual')).toHaveAttribute('aria-pressed', 'false')
  await pin('camera').click()
  await expect(pin('camera')).toHaveAttribute('aria-pressed', 'false')
  await expect(pin('display')).toHaveAttribute('aria-pressed', 'true')
  await pin('virtual').click()
  await expect(row('virtual').getByRole('alert')).toHaveText('Window is not ready.')
  await expect(pin('virtual')).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screenOnTop'))).toEqual([
    { type: 'connection.screenOnTop', sessionId: 'display', enabled: true },
    { type: 'connection.screenOnTop', sessionId: 'camera', enabled: false },
    { type: 'connection.screenOnTop', sessionId: 'virtual', enabled: true },
  ])
  await page.setViewportSize({ width: 1000, height: 750 })
  expect(await windows.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'desktop-test-results/window-pins.png' })
})
