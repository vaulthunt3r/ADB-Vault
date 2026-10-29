import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'phone', serial: 'phone', name: 'Phone', status: 'connected', android: '16', method: 'USB', endpoint: 'phone', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'phone' })
  await page.evaluate(() => {
    window.backendTest.snapshot.apps.apps = [{ packageName: 'org.example.addresses', label: 'Address sample', versionName: '1', versionCode: 1, uid: 10001, userId: 0, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/addresses/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }]
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: /^Details for / }).first().dblclick()
  await page.evaluate(() => {
    const apps = window.backendTest.snapshot.apps, details = apps.details!
    window.backendTest.emit({ type: 'apps', apps: { ...apps, details: { ...details, data: { ...details.data!, analysis: {
      status: 'complete', revision: 'a'.repeat(40), classes: 10, artifacts: [{ path: '/base.apk', dexFiles: 1, classes: 10, complete: true, errors: [] }], trackers: [], libraries: [], native: [], unidentifiedNative: [], issues: [],
      addresses: { status: 'complete', files: 3, issues: [], domains: Array.from({ length: 56 }, (_, i) => ({ value: `api${String(i).padStart(2, '0')}.example.com`, sources: [{ apk: '/base.apk', entry: 'classes.dex' }] })), urls: [{ value: 'https://api01.example.com/path?q=%3Cscript%3E', sources: [{ apk: '/split.config.apk', entry: 'assets/config.json' }] }] },
    } } } } })
  })
})

test('addresses filter, paginate and copy locally with source evidence', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Domains and URLs', exact: true })
  await expect(panel).toContainText('Not a connection history')
  const list = panel.getByRole('list', { name: 'Found addresses' })
  await expect(list.getByRole('listitem')).toHaveCount(20)
  expect(await list.evaluate(el => el.scrollHeight === el.clientHeight && getComputedStyle(el).overflowY === 'visible')).toBe(true)
  await list.getByRole('listitem').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/apk-addresses-single-scroll.png' })
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(20)
  await panel.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(list.getByRole('listitem')).toHaveCount(16)
  await panel.getByRole('button', { name: 'Copy filtered' }).click()
  expect(await page.evaluate(() => window.backendTest.clipboardWrites.at(-1)?.split('\n').length)).toBe(56)
  await panel.getByRole('searchbox', { name: 'Search addresses' }).fill('api01')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await panel.getByRole('button', { name: 'Copy api01.example.com', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('api01.example.com')
  await panel.getByRole('button', { name: 'URLs (1)', exact: true }).click()
  await expect(list).toContainText('split.config.apk · assets/config.json')
  await expect(list.getByRole('link')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Copy filtered' }).click()
  expect(await page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('https://api01.example.com/path?q=%3Cscript%3E')
  await panel.getByRole('searchbox').fill('no-such-address')
  await expect(panel).toContainText('No addresses match this search')
  await expect(panel.getByRole('button', { name: 'Copy filtered' })).toBeDisabled()
  await panel.getByRole('searchbox').fill('')
  await panel.getByRole('button', { name: 'About address scanning' }).click()
  await expect(panel).toContainText('IANA')
  await expect(panel).toContainText('Native binary strings')
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'apps.scan'))).toBe(false)
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/apk-addresses.png' })
  await page.setViewportSize({ width: 1000, height: 680 })
  await panel.getByRole('button', { name: 'About address scanning' }).click()
  await list.scrollIntoViewIfNeeded()
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await list.evaluate(el => el.scrollHeight === el.clientHeight && getComputedStyle(el).overflowY === 'visible')).toBe(true)
  await page.screenshot({ path: 'test-results/apk-addresses-narrow.png' })
})

test('empty partial scans and old results never claim that an app contains no addresses', async ({ page }) => {
  const panel = page.getByRole('region', { name: 'Domains and URLs', exact: true })
  await page.evaluate(() => {
    const apps = window.backendTest.snapshot.apps, details = apps.details!, analysis = details.data!.analysis!
    window.backendTest.emit({ type: 'apps', apps: { ...apps, details: { ...details, data: { ...details.data!, analysis: { ...analysis, status: 'partial', addresses: { status: 'partial', files: 1, issues: ['Resource scan byte limit reached.'], domains: [], urls: [] } } } } } })
  })
  await expect(panel).toContainText('Partial address scan')
  await expect(panel).toContainText('Resource scan byte limit reached')
  await expect(panel).toContainText('No addresses found in the inspected portion')
  await page.evaluate(() => {
    const apps = window.backendTest.snapshot.apps, details = apps.details!
    window.backendTest.emit({ type: 'apps', apps: { ...apps, details: { ...details, data: { ...details.data!, analysis: { ...details.data!.analysis!, addresses: undefined } } } } })
  })
  await expect(panel).toContainText('Addresses have not been scanned')
})
