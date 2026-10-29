import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'PHONE', transportId: '7', name: 'Test phone', status: 'connected', android: '16', method: 'Wi-Fi', endpoint: 'PHONE', lastSeen: '', known: true, canDetach: true }] })
  await page.evaluate(() => {
    const original = window.desktop!.request
    const data = window.backendTest.snapshot.androidDiagnostics = { job: null, logcat: null, battery: null } as import('../electron/android-diagnostics-protocol').AndroidDiagnosticsState
    const emit = () => window.backendTest.emit({ type: 'androidDiagnostics', state: structuredClone(data) })
    window.desktop!.request = async r => {
      if (!r.type.startsWith('androidDiagnostics.')) return original(r)
      window.backendTest.requests.push(r)
      if (r.type === 'androidDiagnostics.start') {
        data.job = { id: '00000000-0000-4000-8000-000000000001', kind: r.kind, target: r.target, deviceName: 'Test phone', status: r.kind === 'bugreport' ? 'running' : 'success', startedAt: '2026-10-13T09:00:00Z', message: r.kind === 'bugreport' ? 'Android is generating the report. Total progress is unavailable.' : 'Collection completed.' }
        if (r.kind === 'logcat') data.logcat = { target: r.target, buffer: r.buffer || 'default', capturedAt: '2026-10-13T09:01:00Z', limit: 2000, raw: 'full raw log', lines: [
          { time: '10-13 09:00:00.001', pid: '123', tid: '123', level: 'E', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main' },
          { time: '10-13 09:00:00.002', pid: '123', tid: '123', level: 'E', tag: 'AndroidRuntime', message: 'at com.example.Main.start(Main.java:1)' },
          { time: '10-13 09:00:00.003', pid: '444', tid: '444', level: 'I', tag: 'Player', message: 'Playback started' },
        ] }
        if (r.kind === 'battery') data.battery = { target: r.target, capturedAt: '2026-10-13T09:02:00Z', issues: ['Missing values are unavailable.'], rows: [
          { uid: 10123, packages: ['com.example.music', 'com.example.shared'], estimatedMah: 12.5, partialMs: 60000, backgroundMs: 12000, wakeups: 4, wakelocks: [{ name: 'Music wake lock', milliseconds: 12000, count: 3 }], alarms: [{ name: 'Sync alarm', count: 4 }] },
          { uid: 1010124, packages: ['com.example.work'], estimatedMah: null, partialMs: 1000, backgroundMs: null, wakeups: null, wakelocks: [], alarms: [] },
        ] }
      }
      if (r.type === 'androidDiagnostics.cancel' && data.job) { data.job.status = 'cancelled'; data.job.message = 'Collection cancelled. Android may continue generating its report on the phone.' }
      emit(); return { ok: true, snapshot: window.backendTest.snapshot }
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
})

test('Logcat captures only on request, filters locally and exports the full snapshot', async ({ page }) => {
  await page.getByRole('button', { name: 'Android logs (Logcat)', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Android logs · Logcat', exact: true })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'androidDiagnostics.start'))).toBe(false)
  await dialog.getByRole('button', { name: 'Read logs', exact: true }).click()
  await expect(dialog.getByText('Playback started', { exact: true })).toBeVisible()
  await dialog.getByLabel('Log severity').selectOption('errors')
  await expect(dialog.getByText('Playback started', { exact: true })).toHaveCount(0)
  await expect(dialog.getByText('FATAL EXCEPTION: main', { exact: true })).toBeVisible()
  await dialog.getByLabel('Search Android logs').fill('Main.java')
  await expect(dialog.getByText('FATAL EXCEPTION: main', { exact: true })).toHaveCount(0)
  await expect(dialog.getByText('at com.example.Main.start(Main.java:1)', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Save full snapshot…', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type.startsWith('androidDiagnostics.')))).toEqual([
    { type: 'androidDiagnostics.start', kind: 'logcat', target: { id: 'phone', serial: 'PHONE', transportId: '7' }, buffer: 'default' },
    { type: 'androidDiagnostics.exportLog', capturedAt: '2026-10-13T09:01:00Z' },
  ])
  await dialog.getByLabel('Search Android logs').clear()
  await dialog.getByLabel('Log buffer').selectOption('crash'); await dialog.getByRole('button', { name: 'Refresh logs', exact: true }).click()
  await expect(dialog).toContainText('Crash buffer')
  await page.screenshot({ path: 'test-results/android-logcat.png' })
})

test('Logcat handles empty buffers and visible backend failure with retry', async ({ page }) => {
  await page.getByRole('button', { name: 'Android logs (Logcat)', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await page.evaluate(() => {
    const original = window.desktop!.request; let fail = true
    window.desktop!.request = async r => {
      if (r.type !== 'androidDiagnostics.start') return original(r)
      if (fail) { fail = false; return { ok: false, error: 'Android denied access to the log.', snapshot: window.backendTest.snapshot } }
      const reply = await original(r); window.backendTest.snapshot.androidDiagnostics!.logcat!.lines = []
      window.backendTest.emit({ type: 'androidDiagnostics', state: structuredClone(window.backendTest.snapshot.androidDiagnostics!) }); return reply
    }
  })
  await dialog.getByRole('button', { name: 'Read logs', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Android denied access')
  await dialog.getByRole('button', { name: 'Read logs', exact: true }).click()
  await expect(dialog).toContainText('Android returned no records in this buffer.')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
})

test('bug report runs in the background, reopens from the toolbar and supports cancellation and saved-file reveal', async ({ page }) => {
  await page.getByRole('button', { name: 'Bug report', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Android bug report', exact: true })
  await expect(dialog).toContainText('Nothing is uploaded')
  await dialog.getByRole('button', { name: 'Save bug report…', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Save bug report…', exact: true })).toBeDisabled()
  await expect(dialog).toContainText('Total progress is unavailable')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Power off', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Collecting bug report', exact: true }).click()
  await dialog.getByRole('button', { name: 'Cancel collection', exact: true }).click()
  await expect(dialog).toContainText('Collection cancelled')
  await dialog.getByRole('button', { name: 'Save bug report…', exact: true }).click()
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.androidDiagnostics!
    Object.assign(state.job!, { status: 'success', message: 'Bug report saved.', output: 'C:\\Reports\\phone.zip' })
    window.backendTest.emit({ type: 'androidDiagnostics', state: structuredClone(state) })
  })
  await dialog.getByRole('button', { name: 'Show saved report', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toMatchObject({ type: 'androidDiagnostics.reveal' })
  await page.screenshot({ path: 'test-results/android-bugreport.png' })
})

test('an open diagnostic dialog never redirects to a replacement connection', async ({ page }) => {
  await page.getByRole('button', { name: 'Android logs (Logcat)', exact: true }).click()
  await page.evaluate(() => {
    const c = window.backendTest.snapshot.connection; c.devices[0].transportId = '8'
    window.backendTest.emit({ type: 'connection', connection: structuredClone(c) })
  })
  await expect(page.getByRole('dialog')).toContainText('Reopen the action')
  await expect(page.getByRole('button', { name: 'Read logs', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Android logs (Logcat)', exact: true }).click()
  await page.getByRole('button', { name: 'Read logs', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'androidDiagnostics.start').at(-1))).toMatchObject({ target: { transportId: '8' } })
})

test('battery usage is explicit, distinguishes shared profiles and missing metrics, and survives navigation', async ({ page }) => {
  await page.getByRole('navigation').getByRole('button', { name: 'Monitor', exact: true }).click()
  await page.getByRole('tab', { name: 'Battery', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Battery usage by application', exact: true })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'androidDiagnostics.start'))).toBe(false)
  await panel.getByRole('button', { name: 'Read battery usage', exact: true }).click()
  await expect(panel).toContainText('Shared UID'); await expect(panel).toContainText('Profile 10')
  await expect(panel.getByRole('row').filter({ hasText: 'com.example.work' })).toContainText('Unavailable')
  await panel.getByText('Wake locks and alarms', { exact: true }).click()
  await expect(panel).toContainText('Music wake lock'); await expect(panel).toContainText('Sync alarm')
  await panel.getByLabel('Search battery usage').fill('work')
  await expect(panel.getByRole('row').filter({ hasText: 'com.example.music' })).toHaveCount(0)
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Monitor', exact: true }).click()
  await expect(panel).toContainText('com.example.music')
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'androidDiagnostics.start').length)).toBe(1)
  await page.setViewportSize({ width: 1000, height: 760 })
  await panel.scrollIntoViewIfNeeded()
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/android-battery-usage.png' })
})

test('battery collection can still be cancelled after another device is selected', async ({ page }) => {
  await page.evaluate(() => {
    const data = window.backendTest.snapshot.androidDiagnostics!
    data.job = { id: '00000000-0000-4000-8000-000000000001', kind: 'battery', target: { id: 'phone', serial: 'PHONE', transportId: '7' }, deviceName: 'First phone', status: 'running', startedAt: '2026-10-13T09:00:00Z', message: 'Reading battery usage…' }
    window.backendTest.emit({ type: 'androidDiagnostics', state: structuredClone(data) })
    const c = window.backendTest.snapshot.connection
    c.activeDeviceId = 'other'; c.devices.push({ ...c.devices[0], id: 'other', serial: 'OTHER', transportId: '8', name: 'Second phone' })
    window.backendTest.emit({ type: 'connection', connection: structuredClone(c) })
  })
  await page.getByRole('button', { name: 'Reading battery usage', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Battery usage by application', exact: true })
  await expect(panel).toContainText('First phone: Reading battery usage')
  await panel.getByRole('button', { name: 'Cancel collection', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toMatchObject({ type: 'androidDiagnostics.cancel', jobId: '00000000-0000-4000-8000-000000000001' })
})
