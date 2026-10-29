import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'phone', serial: 'phone', name: 'Phone', method: 'USB', status: 'connected', android: '16', endpoint: 'phone', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'phone' })
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Restore application', exact: true }).click()
})

test('one unified list selects one or all apps without a mode switch; only saved components appear', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true })
  await dialog.getByRole('button', { name: 'Open backup…' }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Restore several applications' })).toHaveCount(0)
  await expect(dialog.getByRole('combobox')).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', { name: 'OBB', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', { name: 'Media', exact: true })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Restore selected (0)…' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(dialog).toContainText('Selected 2 of 2')
  await expect(dialog).toContainText('Not in backup: Application files (APK / APKS)')
  await dialog.getByRole('checkbox', { name: 'Restore Beta', exact: true }).uncheck()
  await page.screenshot({ path: 'test-results/restore-unified-mixed.png' })
  await dialog.getByRole('button', { name: 'Restore selected (1)…' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.restoreBatch'))).toEqual([{ type: 'apps.restoreBatch', plan: { packages: ['org.example.alpha'], components: ['apk'] } }])
})

test('APK-only copies have no redundant format checkbox and support multiple and single app backups', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true })
  await dialog.getByRole('button', { name: 'Open backup…' }).click()
  await page.evaluate(() => { const s = window.backendTest.snapshot.restore!; window.backendTest.emit({ type: 'restore', state: { ...s, applications: s.applications.map(a => ({ ...a, components: ['apk'], installable: true })) } }) })
  await expect(dialog.getByRole('group', { name: 'What to restore' })).toHaveCount(0)
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click()
  await page.screenshot({ path: 'test-results/restore-unified-apk.png' })
  await dialog.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await page.evaluate(() => { const s = window.backendTest.snapshot.restore!; window.backendTest.emit({ type: 'restore', state: { ...s, applications: s.applications.slice(0, 1) } }) })
  await dialog.getByRole('checkbox', { name: 'Restore Alpha', exact: true }).check()
  await dialog.getByRole('button', { name: 'Restore selected (1)…' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toMatchObject({ type: 'apps.restoreBatch', plan: { packages: ['org.example.alpha'], components: ['apk'] } })
})

test('data-only restore stays opt-in and requires phone root; no APK is silently included', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true })
  await dialog.getByRole('button', { name: 'Open backup…' }).click()
  await page.evaluate(() => { const s = window.backendTest.snapshot.restore!; window.backendTest.emit({ type: 'restore', state: { ...s, applications: s.applications.slice(1) } }) })
  await expect(dialog.getByRole('checkbox', { name: /Application files/ })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: 'Restore Beta', exact: true }).check()
  const data = dialog.getByRole('checkbox', { name: /^App data/ })
  await expect(data).not.toBeChecked(); await expect(data).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Restore selected (1)…' })).toBeDisabled()
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, options: { ...window.backendTest.snapshot.apps.options, root: true } } }))
  await data.check()
  await dialog.getByRole('button', { name: 'Restore selected (1)…' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toMatchObject({ type: 'apps.restoreBatch', plan: { packages: ['org.example.beta'], components: ['data'] } })
})

test('root absence and disconnected destination block private or all restoration respectively', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true })
  await dialog.getByRole('button', { name: 'Open backup…' }).click()
  await page.evaluate(() => {
    const s = window.backendTest.snapshot
    window.backendTest.emit({ type: 'apps', apps: { ...s.apps, options: { ...s.apps.options, root: true } } })
    window.backendTest.emit({ type: 'connection', connection: { ...s.connection, devices: s.connection.devices.map(d => ({ ...d, root: { status: 'not-detected', message: 'No root', checkedAt: null } })) } })
  })
  await expect(dialog.getByRole('checkbox', { name: /^App data/ })).toBeDisabled()
  await expect(dialog.getByRole('checkbox', { name: /^Cache/ })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'Restore Alpha', exact: true }).check()
  await connectionEvent(page, { activeDeviceId: null, devices: [] })
  await expect(dialog.getByRole('button', { name: 'Restore selected (1)…' })).toBeDisabled()
})

test('help appears only on click and closes with Escape without closing the restore window', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true }), help = page.getByRole('dialog', { name: 'Restoration help', exact: true })
  await expect(help).not.toBeVisible()
  const trigger = dialog.getByRole('button', { name: 'Restoration help', exact: true })
  await trigger.hover(); await expect(help).not.toBeVisible()
  await trigger.click(); await expect(help).toBeVisible()
  await expect(help).toContainText('manifest JSON'); await expect(help).toContainText('Closing this window keeps restoration running')
  await page.screenshot({ path: 'test-results/restore-help.png' })
  await page.keyboard.press('Escape'); await expect(help).not.toBeVisible(); await expect(dialog).toBeVisible()
  await trigger.click(); await help.getByRole('button', { name: 'Close restoration help' }).click()
  await expect(trigger).toBeFocused()
})

test('progress survives closing and stopping waits for the current application', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true })
  await dialog.getByRole('button', { name: 'Open backup…' }).click()
  await dialog.getByRole('button', { name: 'Select all', exact: true }).click()
  await dialog.getByRole('button', { name: 'Restore selected (2)…' }).click()
  await expect(dialog.getByRole('button', { name: 'Open backup…' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'Android profile' })).toBeDisabled()
  await page.getByRole('button', { name: 'Restoring applications', exact: true }).click()
  await expect(dialog.getByRole('progressbar', { name: 'Restoring applications', exact: true })).toHaveAttribute('aria-valuenow', '0')
  await expect(dialog.locator('.operation-chip').getByRole('button')).toHaveCount(0)
  await expect(dialog.locator('.operation-progress-track')).toHaveCount(0)
  await expect(dialog.locator('.operation-chip')).toContainText('0 of 2 processed')
  const chipBox = (await dialog.locator('.operation-chip').boundingBox())!
  const stopBox = (await dialog.getByRole('button', { name: 'Stop after current application', exact: true }).boundingBox())!
  expect(stopBox.y - chipBox.y - chipBox.height).toBeGreaterThanOrEqual(8)
  await page.screenshot({ path: 'test-results/restore-panel-chip.png' })
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.restoreCancel'))).toEqual([])
  await dialog.getByRole('button', { name: 'Stop after current application', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Stopping after current application…' })).toBeDisabled()
  await expect(dialog.locator('.operation-chip')).toHaveAttribute('data-status', 'stopping')
  await expect(dialog.locator('.lattice-loader')).toHaveCount(0)
})

test('errors and recovery paths remain visible, while unsafe outcomes cannot be retried', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Restore application', exact: true })
  await dialog.getByRole('button', { name: 'Open backup…' }).click()
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.restore!
    window.backendTest.emit({ type: 'restore', state: { ...s, status: 'partial', operation: 'batch', message: '1 completed · 1 failed', batch: { finished: 2, stopRequested: false, items: s.applications.map((a, n) => ({ ...a, components: ['apk'], completed: n ? [] : ['apk'], status: n ? 'error' : 'success', message: n ? 'Android rejected installation' : 'Application installed.' })) } } })
  })
  await expect(dialog.getByRole('alert')).toContainText('Android rejected installation')
  await expect(dialog.getByRole('button', { name: 'Retry unfinished…' })).toBeVisible()
  await page.evaluate(() => { const s = window.backendTest.snapshot.restore!; window.backendTest.emit({ type: 'restore', state: { ...s, batch: { ...s.batch!, items: s.batch!.items.map(i => i.status === 'error' ? { ...i, uncertain: true, recoveryPaths: ['/data/user/0/recovery-test'] } : i) } } }) })
  await expect(dialog.getByRole('button', { name: 'Retry unfinished…' })).toHaveCount(0)
  await expect(dialog.getByRole('alert')).toContainText('/data/user/0/recovery-test')
})

test('export entry opens the same restore list', async ({ page }) => {
  await page.getByRole('dialog', { name: 'Restore application', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  await page.getByRole('dialog', { name: 'Export applications' }).getByRole('button', { name: 'Restore…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Restore application', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Export applications' })).toHaveCount(0)
})
