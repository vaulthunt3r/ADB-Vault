import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import { samples, sampleText } from '../scripts/fixtures/phone-tools.mjs'
import type { PhoneToolsState } from '../electron/phone-tools-protocol'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'TEST', transportId: '7', name: 'Test phone', status: 'connected', android: '16', method: 'USB', endpoint: 'TEST', lastSeen: '', known: true, canDetach: true }] })
  await page.evaluate(({ samples, sampleText }) => {
    const original = window.desktop!.request
    const data: PhoneToolsState = window.backendTest.snapshot.phoneTools = { revision: 0, job: null, data: null, clipboard: null }
    window.desktop!.readClipboard = async () => sampleText
    window.desktop!.request = async r => {
      if (!r.type.startsWith('phoneTools.')) return original(r)
      window.backendTest.requests.push(r)
      if (r.type === 'phoneTools.read' || r.type === 'phoneTools.clipboard.read' || r.type === 'phoneTools.clipboard.write') {
        const kind = r.type === 'phoneTools.read' ? r.kind : 'clipboard'
        data.job = { id: crypto.randomUUID(), kind, action: r.type === 'phoneTools.clipboard.write' ? 'write' : 'read', target: r.target, deviceName: 'Test phone', status: 'success', startedAt: new Date().toISOString(), message: 'Read completed.' }
        if (r.type === 'phoneTools.read') data.data = { id: crypto.randomUUID(), kind: r.kind, target: r.target, deviceName: 'Test phone', userId: 0, capturedAt: new Date().toISOString(), range: r.range, rows: samples[r.kind] }
        if (r.type === 'phoneTools.clipboard.read') data.clipboard = { id: crypto.randomUUID(), target: r.target, userId: 0, text: 'С Android\nSecond line 👋' }
      }
      if (r.type === 'phoneTools.export' && data.job) { data.job = { ...data.job, id: crypto.randomUUID(), action: 'export', message: 'Selected records saved.', status: 'success', output: 'C:\\Test\\export.' + r.format } }
      if (r.type === 'phoneTools.cancel' && data.job) { data.job.status = 'cancelled'; data.job.message = 'Operation cancelled.' }
      if (r.type === 'phoneTools.clear') { data.job = null; data.data = null; data.clipboard = null }
      data.revision++
      window.backendTest.emit({ type: 'phoneTools', state: structuredClone(data) })
      return { ok: true, snapshot: window.backendTest.snapshot }
    }
  }, { samples, sampleText })
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
})

test('clipboard transfers are explicit, preserve text and draft, and generate QR locally', async ({ page }) => {
  await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type.startsWith('phoneTools.')))).toEqual([])
  const text = page.getByLabel('Clipboard text')
  await page.getByRole('button', { name: 'Paste from PC', exact: true }).click()
  await expect(text).toHaveValue(sampleText)
  await page.getByRole('button', { name: 'Send to Android', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.clipboard.write').at(-1))).toMatchObject({ text: sampleText, target: { id: 'phone', serial: 'TEST', transportId: '7' } })
  await page.getByRole('button', { name: 'Get from Android', exact: true }).click()
  await expect(text).toHaveValue('С Android\nSecond line 👋')
  await page.getByRole('button', { name: 'Copy to PC', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('С Android\nSecond line 👋')
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click()
  await expect(page.getByAltText('QR code containing the clipboard text')).toHaveAttribute('src', /^data:image\/png;base64,/)
  await page.getByRole('dialog').screenshot({ path: 'desktop-test-results/phone-clipboard.png' })
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
  await expect(text).toHaveValue('С Android\nSecond line 👋')
  await text.fill('x'.repeat(4000))
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('too long for one QR')
})

test('contacts load on demand, search and select locally, and export only chosen IDs', async ({ page }) => {
  await page.getByRole('button', { name: 'Export contacts', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.read'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Load data', exact: true }).click()
  await expect(page.getByRole('table')).toContainText('Ирина')
  await page.getByLabel('Select record 2').check()
  await page.getByLabel('Phone export format').selectOption('csv')
  await page.getByRole('button', { name: 'Export selected (1)…', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.export').at(-1))).toMatchObject({ ids: ['2'], format: 'csv' })
  await page.getByLabel('Search phone data').fill('Ирина')
  await expect(page.getByText('1 matching · 0 selected', { exact: true })).toBeVisible()
  await page.getByLabel('Phone export format').selectOption('vcf')
  await page.getByRole('button', { name: 'Export matching (1)…', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.export').at(-1))).toMatchObject({ ids: ['1'], format: 'vcf' })
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.read'))).toHaveLength(1)
  await page.getByRole('dialog').screenshot({ path: 'desktop-test-results/phone-contacts.png' })
  await page.getByRole('button', { name: 'Clear loaded data', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Load data', exact: true })).toBeVisible()
})

test('SMS date bounds include the end day, changed ranges require refresh and bodies stay plain text', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 })
  await page.getByRole('button', { name: 'Export SMS', exact: true }).click()
  await page.getByLabel('Export from date').fill('2026-10-19')
  await page.getByLabel('Export through date').fill('2026-10-18')
  await expect(page.getByRole('button', { name: 'Load data', exact: true })).toBeDisabled()
  await page.getByLabel('Export through date').fill('2026-10-20')
  await page.getByRole('button', { name: 'Load data', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.read').at(-1))).toMatchObject({
    kind: 'sms', range: { from: new Date('2026-10-19T00:00:00').getTime(), to: new Date('2026-10-21T00:00:00').getTime() },
  })
  await expect(page.getByRole('table')).toContainText('<script>alert("test")</script>&')
  await page.getByLabel('Phone export format').selectOption('html')
  await page.getByRole('button', { name: 'Export matching (1)…', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.export').at(-1))).toMatchObject({ ids: ['21'], format: 'html' })
  await page.getByRole('dialog').screenshot({ path: 'desktop-test-results/phone-sms-narrow.png' })
  const box = await page.getByRole('dialog').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(900)
  await page.getByLabel('Export through date').fill('2026-10-21')
  await expect(page.getByRole('button', { name: 'Export matching (1)…', exact: true })).toBeDisabled()
  await expect(page.getByText('Refresh data to apply the changed date range before exporting.')).toBeVisible()
})

test('lost connection disables device reads while keeping local export available', async ({ page }) => {
  await page.getByRole('button', { name: 'Export call log', exact: true }).click()
  await page.getByRole('button', { name: 'Load data', exact: true }).click()
  await connectionEvent(page, { activeDeviceId: null, devices: [] })
  await expect(page.getByRole('button', { name: 'Refresh data', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Export matching (1)…', exact: true })).toBeEnabled()
  await page.getByLabel('Phone export format').selectOption('json')
  await page.getByRole('button', { name: 'Export matching (1)…', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'phoneTools.export').at(-1))).toMatchObject({ ids: ['11'], format: 'json' })
})

test('empty data and denied access are distinct and a running job can be cancelled', async ({ page }) => {
  await page.getByRole('button', { name: 'Export SMS', exact: true }).click()
  await page.getByRole('button', { name: 'Load data', exact: true }).click()
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.phoneTools!
    s.data!.rows = []; s.revision++
    window.backendTest.emit({ type: 'phoneTools', state: structuredClone(s) })
  })
  await expect(page.getByText('No SMS records were returned for this selection.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export matching (0)…', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.phoneTools!
    s.data = null; s.job!.status = 'error'; s.job!.message = 'Android access denied.'; s.revision++
    window.backendTest.emit({ type: 'phoneTools', state: structuredClone(s) })
  })
  await expect(page.getByRole('alert')).toContainText('Android access denied.')
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.phoneTools!
    s.job!.status = 'running'; s.job!.message = 'Reading SMS…'; s.revision++
    window.backendTest.emit({ type: 'phoneTools', state: structuredClone(s) })
  })
  await expect(page.getByRole('button', { name: 'Load data', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel operation', exact: true }).click()
  await expect(page.getByText('Operation cancelled.', { exact: true })).toBeVisible()
})

test('offline clipboard and QR remain available without a selected phone', async ({ page }) => {
  await connectionEvent(page, { activeDeviceId: null, devices: [] })
  await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
  await page.getByLabel('Clipboard text').fill('https://example.test/')
  await expect(page.getByRole('button', { name: 'Send to Android', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Get from Android', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Show QR code', exact: true }).click()
  await expect(page.getByAltText('QR code containing the clipboard text')).toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type.startsWith('phoneTools.')))).toHaveLength(0)
})

test('background clipboard read preserves its captured target and pauses Monitor', async ({ page }) => {
  await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
  await page.getByLabel('Clipboard text').fill('draft')
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.phoneTools!
    s.job = { id: crypto.randomUUID(), kind: 'clipboard', action: 'read', target: { id: 'phone', serial: 'TEST', transportId: '7' }, deviceName: 'Test phone', status: 'running', message: 'Reading clipboard…', startedAt: new Date().toISOString() }
    s.revision++
    window.backendTest.emit({ type: 'phoneTools', state: structuredClone(s) })
  })
  await expect(page.getByLabel('Clipboard text', { exact: true })).toBeDisabled()
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Monitor', exact: true }).click()
  await expect(page.getByText('Paused during phone data collection', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read'))).toHaveLength(0)
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.phoneTools!
    s.job!.status = 'success'; s.job!.message = 'Text received.'
    s.clipboard = { id: crypto.randomUUID(), target: s.job!.target, text: 'Received while closed', userId: 0 }; s.revision++
    window.backendTest.emit({ type: 'phoneTools', state: structuredClone(s) })
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Theme Git Dark', exact: true }).click()
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Clipboard', exact: true }).click()
  await expect(page.getByLabel('Clipboard text')).toHaveValue('Received while closed')
  await page.getByRole('dialog').screenshot({ path: 'desktop-test-results/phone-clipboard-dark.png' })
})
