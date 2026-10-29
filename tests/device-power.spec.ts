import { test, expect } from '@playwright/test'
import { connectionEvent, installBackendFixture } from './backend-fixture'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'USB1', serial: 'USB1', transportId: '7', name: 'Test phone', status: 'connected', android: '16', method: 'USB', endpoint: 'USB1', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'USB1' })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
})

test('power off requires explicit confirmation with loss of control warning and cancel is harmless', async ({ page }) => {
  await page.getByRole('button', { name: 'Power off', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Power off phone?' })
  await expect(dialog).toContainText('Test phone')
  await expect(dialog).toContainText('shut down completely')
  await expect(dialog).toContainText('lose all control')
  await expect(dialog).toContainText('cannot turn it back on')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.screenshot({ path: 'test-results/device-power-off.png' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.power'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Power off', exact: true }).click()
  await dialog.getByRole('button', { name: 'Power off phone', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.power'))).toEqual([{ type: 'connection.power', id: 'USB1', serial: 'USB1', transportId: '7', mode: 'shutdown', confirmed: true }])
  await expect(dialog).not.toBeVisible()
})

test('restart mode changes the warning and sends only the confirmed mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Restart', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Restart phone', exact: true })
  await expect(dialog.getByRole('radio', { name: 'Android', exact: true })).toBeChecked()
  await dialog.getByRole('radio', { name: 'Recovery', exact: true }).check()
  await expect(dialog).toContainText('choose Reboot system on the phone')
  await dialog.getByRole('radio', { name: 'Bootloader / Fastboot', exact: true }).check()
  await expect(dialog).toContainText('Normal ADB control will be unavailable')
  await dialog.getByRole('button', { name: 'Restart phone', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.power').map(r => r.mode))).toEqual(['bootloader'])
})

test('connection replacement disables confirmation until the dialog is reopened', async ({ page }) => {
  await page.getByRole('button', { name: 'Power off', exact: true }).click()
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.connection
    window.backendTest.emit({ type: 'connection', connection: { ...state, devices: state.devices.map(d => ({ ...d, transportId: '8' })) } })
  })
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Power off phone', exact: true })).toBeDisabled()
  await expect(page.getByRole('dialog')).toContainText('connection changed')
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.power'))).toHaveLength(0)
})

test('power actions are disabled during app operations and for an offline phone', async ({ page }) => {
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, status: 'loading' } }))
  await expect(page.getByRole('button', { name: 'Power off', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, status: 'idle' } })
    const connection = window.backendTest.snapshot.connection
    window.backendTest.emit({ type: 'connection', connection: { ...connection, devices: connection.devices.map(d => ({ ...d, status: 'offline' })) } })
  })
  await expect(page.getByRole('button', { name: 'Power off', exact: true })).toBeDisabled()
})

test('backend refusal stays in the confirmation dialog and never reports success', async ({ page }) => {
  await page.evaluate(() => {
    const request = window.desktop!.request
    window.desktop!.request = async input => input.type === 'connection.power'
      ? { ok: false, error: 'Power command was denied by Android.', snapshot: window.backendTest.snapshot }
      : request(input)
  })
  await page.getByRole('button', { name: 'Power off', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Power off phone', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Power command was denied by Android.')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()
})
