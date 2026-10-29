import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { ApkAnalysis } from '../electron/database-protocol'

const mib = 1024 ** 2
const artifacts: ApkAnalysis['artifacts'] = [
  { path: '/data/app/sample/base.apk', dexFiles: 1, classes: 10, complete: true, errors: [], size: { bytes: 60 * mib, categories: { code: 42 * mib, native: 0, resources: 12 * mib, assets: 4 * mib, other: 2 * mib } } },
  { path: '/data/app/sample/split.config.arm64_v8a.apk', dexFiles: 0, classes: 0, complete: true, errors: [], size: { bytes: 54 * mib, categories: { code: 0, native: 54 * mib, resources: 0, assets: 0, other: 0 } } },
  { path: '/data/app/sample/split.config.xxhdpi.apk', dexFiles: 0, classes: 0, complete: true, errors: [], size: { bytes: 6 * mib, categories: { code: 0, native: 0, resources: 6 * mib, assets: 0, other: 0 } } },
]
async function show(page: Page, artifacts: ApkAnalysis['artifacts']) {
  await page.evaluate(artifacts => {
    const apps = window.backendTest.snapshot.apps, details = apps.details!
    window.backendTest.emit({ type: 'apps', apps: { ...apps, details: { ...details, data: { ...details.data!, analysis: {
      status: artifacts.some(a => a.size?.categories === null) ? 'partial' : 'complete', revision: 'a'.repeat(40), classes: 10, artifacts,
      trackers: [], libraries: [], native: [], unidentifiedNative: [], issues: [],
    } } } } })
  }, artifacts)
}
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'phone', serial: 'phone', name: 'Phone', status: 'connected', android: '16', method: 'USB', endpoint: 'phone', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'phone' })
  await page.evaluate(() => {
    window.backendTest.snapshot.apps.apps = [{ packageName: 'org.example.size', label: 'Size sample', versionName: '1', versionCode: 1, uid: 10001, userId: 0, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/sample/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }]
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Size sample', exact: true }).dblclick()
})

test('APK composition shows proportional categories, exact bytes and split contributions without inner scrolling', async ({ page }) => {
  await show(page, artifacts)
  const panel = page.getByRole('region', { name: 'APK size composition', exact: true })
  await expect(panel).toContainText('Total APK size')
  await expect(panel.getByText('120 MiB', { exact: true })).toBeVisible()
  await expect(panel).toContainText('3 / 3 APK files measured')
  const bar = panel.getByRole('group', { name: 'Size by category' })
  const code = bar.getByRole('img', { name: /^Code · DEX: 44[,\s]040[,\s]192 bytes, 35%$/ })
  await expect(code).toHaveAttribute('title', /^Code · DEX · 44[,\s]040[,\s]192 bytes · 35%$/)
  await expect(bar.getByRole('img')).toHaveCount(5)
  await panel.scrollIntoViewIfNeeded()
  const barBox = (await bar.boundingBox())!, codeBox = (await code.boundingBox())!
  expect(codeBox.width / barBox.width).toBeCloseTo(0.35, 2)
  const files = panel.getByRole('list', { name: 'APK file sizes' })
  await expect(files.getByRole('listitem')).toHaveCount(3)
  await expect(files).toContainText('60 MiB · 50%')
  await expect(files).toContainText('54 MiB · 45%')
  await expect(files).toContainText('6 MiB · 5%')
  expect(await panel.evaluate(el => el.scrollHeight === el.clientHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/apk-composition.png' })
  await panel.getByRole('button', { name: 'About APK sizes' }).click()
  await expect(panel).toContainText('stored ZIP entry sizes')
  await expect(panel).toContainText('Excludes app data, cache')
  await panel.getByRole('button', { name: 'About APK sizes' }).click()
  await page.setViewportSize({ width: 1000, height: 680 })
  await panel.scrollIntoViewIfNeeded()
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight === el.clientHeight)).toBe(true)
  await page.screenshot({ path: 'test-results/apk-composition-narrow.png' })
  expect(await page.evaluate(() => window.backendTest.requests.some(r => r.type === 'apps.scan'))).toBe(false)
})

test('APK composition distinguishes unreadable contents, missing sizes and old scan results', async ({ page }) => {
  const partial = structuredClone(artifacts)
  partial[1].size = { bytes: 54 * mib, categories: null, error: 'APK entry limit reached' }
  partial[2].size = { bytes: null, categories: null, error: 'Access denied' }
  await show(page, partial)
  const panel = page.getByRole('region', { name: 'APK size composition', exact: true })
  await expect(panel).toContainText('Known APK size')
  await expect(panel).toContainText('114 MiB')
  await expect(panel).toContainText('2 / 3 APK files measured')
  await expect(panel).toContainText('Partial size breakdown · 1 / 3 APK files classified')
  await expect(panel).toContainText('Not classified')
  await expect(panel).toContainText('APK entry limit reached')
  await expect(panel).toContainText('Access denied')
  await expect(panel.getByRole('group', { name: 'Size by category' }).getByRole('img', { name: /^Not classified:/ })).toHaveCount(1)
  await show(page, [{ ...artifacts[0], size: { bytes: null, categories: null, error: 'Access denied' } }])
  await expect(panel).toContainText('Unavailable')
  await expect(panel.getByRole('group', { name: 'Size by category' })).toHaveCount(0)
  await expect(panel.locator('.apk-size-legend')).toHaveCount(0)
  await show(page, [{ ...artifacts[0], size: undefined }])
  await expect(panel).toContainText('Size composition has not been collected. Use Actions → Scan APKs.')
  await expect(panel).not.toContainText('0 B')
})

test('single APK zero and tiny categories remain readable without rounding up their bar widths', async ({ page }) => {
  await show(page, [{ ...artifacts[0], size: { bytes: 10000, categories: { code: 1, native: 0, resources: 0, assets: 0, other: 9999 } } }])
  const panel = page.getByRole('region', { name: 'APK size composition', exact: true })
  await expect(panel.getByRole('img', { name: 'Code · DEX: 1 bytes, <0.1%', exact: true })).toHaveCount(1)
  await expect(panel.getByRole('list', { name: 'APK file sizes' })).toHaveCount(0)
  await expect(panel.locator('.apk-size-legend')).toContainText('0 B')
  await show(page, [{ ...artifacts[0], size: { bytes: 0, categories: { code: 0, native: 0, resources: 0, assets: 0, other: 0 } } }])
  await expect(panel.getByRole('group', { name: 'Size by category' })).toHaveCount(0)
  await expect(panel).not.toContainText('NaN')
})
