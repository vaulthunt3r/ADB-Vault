import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

test.beforeEach(async ({ page }) => { await installBackendFixture(page); await page.goto('/') })

test('component checks disable conflicting actions before release metadata arrives and recover on failure', async ({ page }) => {
  await page.getByRole('button', { name: 'Select Google USB Driver' }).click()
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'components.detect') {
        window.backendTest.requests.push(r)
        await new Promise<void>(resolve => window.addEventListener('release-check', () => resolve(), { once: true }))
        return { ok: false, snapshot: window.backendTest.snapshot, error: 'Release service unavailable.' }
      }
      return original(r)
    }
  })
  const check = page.getByRole('button', { name: 'Check components', exact: true })
  const toolbar = page.getByLabel('Workspace toolbar')
  await expect(toolbar.getByRole('button', { name: 'Check components', exact: true })).toHaveCount(1)
  await expect(page.locator('.components-section').getByRole('button', { name: 'Check components', exact: true })).toHaveCount(0)
  const before = await check.boundingBox()
  await check.click(); await expect(check).toBeDisabled()
  expect(await check.boundingBox()).toEqual(before)
  await expect(page.getByRole('button', { name: 'Install / Repair All', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Install driver: Google USB Driver', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Locate manually', exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('release-check')))
  await expect(check).toBeEnabled()
  await expect(page.getByRole('status')).toContainText('Release service unavailable')
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'components.detect').length)).toBe(1)
})

test('manual component location prevents duplicate submit and displays backend failures in the dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Select Google USB Driver' }).click()
  await page.getByRole('button', { name: 'Locate manually', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Component folder', exact: true }).fill('C:\\Missing tools')
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'components.locate') await new Promise<void>(resolve => window.addEventListener('release-locate', () => resolve(), { once: true }))
      return original(r)
    }
  })
  await dialog.getByRole('button', { name: 'Use this folder', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Checking folder…', exact: true })).toBeDisabled()
  await dialog.press('Escape'); await expect(dialog).toBeVisible()
  await dialog.locator('form').dispatchEvent('submit')
  await page.evaluate(() => window.dispatchEvent(new Event('release-locate')))
  await expect(dialog.getByRole('alert')).toContainText('does not contain a valid executable')
  await expect(dialog.getByRole('textbox', { name: 'Component folder', exact: true })).toHaveValue('C:\\Missing tools')
  await expect(dialog.getByRole('button', { name: 'Use this folder', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'components.locate').length)).toBe(1)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).not.toBeVisible()
})
test('missing ADB can be located from Components and Connection without opening the inspector', async ({ page }) => {
  const choose = page.getByRole('button', { name: 'Use existing ADB', exact: true })
  await expect(choose).toHaveCount(0)
  await page.evaluate(() => {
    const fixture = window.backendTest
    fixture.emit({ type: 'components', components: fixture.snapshot.components.map(c => c.id === 'adb' ? { ...c, status: 'Not installed', location: null } : c) })
    fixture.emit({ type: 'connection', connection: { ...fixture.snapshot.connection, adbAvailable: false } })
    window.desktop!.locate = async kind => kind === 'adb-file' ? 'C:\\SDK tools\\adb.exe' : 'C:\\SDK tools'
  })
  await choose.click()
  const dialog = page.getByRole('dialog', { name: 'Use existing ADB' })
  const input = dialog.getByLabel('ADB file or folder')
  await dialog.getByRole('button', { name: 'Choose folder…' }).click()
  await expect(input).toHaveValue('C:\\SDK tools')
  await dialog.getByRole('button', { name: 'Choose adb.exe…' }).click()
  await expect(input).toHaveValue('C:\\SDK tools\\adb.exe')
  await input.fill('"C:\\SDK tools\\adb.exe"')
  await dialog.getByRole('button', { name: 'Use this ADB' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'components.locate', id: 'adb', folder: 'C:\\SDK tools\\adb.exe' })
  await dialog.press('Escape')
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact:true }).click()
  await choose.click()
  await expect(dialog).toBeVisible()
})

test('ADB diagnostics waits for component work and a failed automatic check does not loop', async ({ page }) => {
  // Move away from the initially selected ADB before simulating a different installation.
  await page.getByRole('button', { name: 'Select Google USB Driver' }).click()
  await page.evaluate(() => {
    const fixture = window.backendTest
    fixture.requests.length = 0
    fixture.emit({ type: 'components', components: fixture.snapshot.components.map(c => c.id === 'adb' ? { ...c, location: 'C:\\New SDK\\platform-tools' } : c) })
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'components.detect') await new Promise<void>(resolve => window.addEventListener('release-components', () => resolve(), { once: true }))
      if (r.type === 'components.adbDiagnostics') {
        window.backendTest.requests.push(r)
        return { ok: false, snapshot: window.backendTest.snapshot, error: 'Diagnostic service unavailable.' }
      }
      return original(r)
    }
  })
  const check = page.getByRole('button', { name: 'Check components', exact: true })
  await check.click()
  await page.getByRole('button', { name: 'Select Android Debug Bridge', exact: true }).click()
  const refresh = page.getByLabel('ADB diagnostics').getByRole('button', { name: 'Refresh', exact: true })
  await expect(refresh).toBeDisabled()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'components.adbDiagnostics').length)).toBe(0)
  await page.evaluate(() => window.dispatchEvent(new Event('release-components')))
  await expect(page.getByRole('status')).toContainText('Diagnostic service unavailable')
  await expect(refresh).toBeEnabled()
  await check.click(); await page.evaluate(() => window.dispatchEvent(new Event('release-components')))
  await expect(check).toBeEnabled()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'components.adbDiagnostics').length)).toBe(1)
})

test('a new device transport gets firmware data even while the previous UI request is finishing', async ({ page }) => {
  await page.evaluate(() => {
    const original = window.desktop!.request
    let reads = 0
    window.desktop!.request = async r => {
      if (r.type === 'connection.info' && ++reads === 1) {
        window.backendTest.requests.push(r)
        const connection = window.backendTest.snapshot.connection
        connection.devices[0].info = { status: 'loading', collectedAt: null, fields: {} }
        window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
        await new Promise<void>(resolve => window.addEventListener('release-info', () => resolve(), { once: true }))
        return { ok: true, snapshot: window.backendTest.snapshot }
      }
      const reply = await original(r)
      if (r.type === 'connection.info') reply.snapshot.connection.devices[0].info!.fields.model = 'Current session model'
      return reply
    }
  })
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'PHONE', transportId: '2', name: 'Test phone', android: '16', status: 'connected', method: 'USB', endpoint: 'PHONE', lastSeen: '2026-10-12T12:00:00Z', known: true, canDetach: false, root: { status: 'not-detected', message: 'Not rooted', checkedAt: null } }] })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await expect(page.getByText('Reading device properties…', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const connection = window.backendTest.snapshot.connection
    connection.devices[0].transportId = '3'; connection.devices[0].info = undefined
    window.backendTest.emit({ type: 'connection', connection: structuredClone(connection) })
  })
  await expect(page.getByText('Current session model', { exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('release-info')))
  await expect(page.getByText('Current session model', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.info').length)).toBe(2)
})

test('QR creation has a pending state and can be cancelled before its result arrives', async ({ page }) => {
  await page.evaluate(() => {
    const original = window.desktop!.request
    let attempt = 0
    window.desktop!.request = async r => {
      if (r.type === 'connection.qr') {
        window.backendTest.requests.push(r)
        const event = `release-qr-${++attempt}`
        await new Promise<void>(resolve => window.addEventListener(event, () => resolve(), { once: true }))
        return { ok: true, snapshot: window.backendTest.snapshot }
      }
      return original(r)
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('button', { name: 'Create QR code', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Creating QR code…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel QR session', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Create QR code', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Create QR code', exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event('release-qr-1')))
  await expect(page.getByRole('button', { name: 'Creating QR code…', exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('release-qr-2')))
  await expect(page.getByRole('button', { name: 'Create QR code', exact: true })).toBeEnabled()
  await expect(page.getByRole('img', { name: 'Wireless debugging pairing QR code', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.qr' || r.type === 'connection.cancelQr').map(r => r.type))).toEqual(['connection.qr', 'connection.cancelQr', 'connection.qr'])
})

test('pending component work also blocks conflicting phone actions after changing workspace', async ({ page }) => {
  await connectionEvent(page, { devices: [{ id: 'USB1', serial: 'USB1', transportId: '7', name: 'Test phone', status: 'connected', android: '16', method: 'USB', endpoint: 'USB1', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'USB1' })
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'components.detect') await new Promise<void>(resolve => window.addEventListener('release-components', () => resolve(), { once: true }))
      return original(r)
    }
  })
  await page.getByRole('button', { name: 'Check components', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  for (const name of ['Screenshot', 'Restart', 'Power off']) await expect(page.getByRole('tabpanel').getByRole('button', { name, exact: true })).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('release-components')))
  for (const name of ['Screenshot', 'Restart', 'Power off']) await expect(page.getByRole('tabpanel').getByRole('button', { name, exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'connection.screen' || r.type === 'connection.power'))).toHaveLength(0)
})
