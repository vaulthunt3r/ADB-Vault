import { test, expect, type Page } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'

const seed: AndroidApp = { packageName: 'org.example.alpha', label: 'Alpha', userId: 0, uid: 10123, enabled: true, system: false, updatedSystemApp: false, debuggable: false, stopped: false, suspended: false, enabledState: 0, versionName: '1', versionCode: 1, sourceDir: '/data/app/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, iconPng: null, splitCount: 0 }
const mark = (page: Page, name: string) => page.getByRole('checkbox', { name: `Select ${name} (org.example.${name.toLowerCase()})`, exact: true })
const preview = (page: Page) => page.getByRole('dialog', { name: 'Import preset', exact: true })
async function file(page: Page, names: string[] | 'invalid' | null) {
  await page.evaluate(names => { window.backendTest.presetFile = names === null || names === 'invalid' ? names : { format: 'adb-vault-app-preset', version: 1, name: 'My apps', createdAt: '2026-10-04T10:00:00Z', device: { name: 'Old phone', identity: 'old' }, profile: { id: 10, name: 'Work' }, applications: names.map(name => ({ label: name, packageName: `org.example.${name.toLowerCase()}` })) } }, names)
}
async function open(page: Page) {
  await page.getByRole('group', { name: 'Application selection', exact: true }).getByRole('button', { name: /^Backup/ }).click()
  await page.getByRole('button', { name: 'Import preset…', exact: true }).click()
}
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'phone', serial: 'phone', name: 'Phone', method: 'USB', status: 'connected', android: '16', endpoint: 'phone', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'phone' })
  await page.evaluate(seed => { window.backendTest.snapshot.apps.apps = ['Alpha', 'Beta'].map(label => ({ ...seed, label, packageName: `org.example.${label.toLowerCase()}` })) }, seed)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
})

test('import is reachable with no marks, previews source/missing apps and applies only selection', async ({ page }) => {
  await file(page, ['Alpha', 'Missing'])
  await page.getByRole('button', { name: 'Backup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Import preset…', exact: true }).click()
  await expect(preview(page)).toContainText('Old phone · Work · ID 10')
  await expect(preview(page)).toContainText('1 found · 1 missing')
  await expect(page.locator('[aria-label="Application selection"]')).toContainText('Selected 0')
  await page.screenshot({ path: 'test-results/preset-import.png' })
  const requests = await page.evaluate(() => window.backendTest.requests.length)
  await preview(page).getByRole('button', { name: 'Apply selection' }).click()
  await expect(mark(page, 'Alpha')).toBeChecked(); await expect(mark(page, 'Beta')).not.toBeChecked()
  expect(await page.evaluate(() => window.backendTest.requests.length)).toBe(requests)
})

test('Back preserves marks; Apply replaces them and preserves filters unless explicitly cleared', async ({ page }) => {
  await mark(page, 'Beta').check()
  await page.getByRole('searchbox', { name: 'Search applications' }).fill('Beta')
  await file(page, ['Alpha']); await open(page)
  await expect(preview(page)).toContainText('1 found applications are hidden')
  await preview(page).getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(mark(page, 'Beta')).toBeChecked()
  await open(page)
  await preview(page).getByRole('button', { name: 'Apply selection' }).click()
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toHaveValue('Beta')
  await expect(mark(page, 'Beta')).not.toBeChecked()
  await expect(page.getByRole('group', { name: 'Application selection', exact: true })).toContainText('1 hidden by filters')
  await open(page)
  await preview(page).getByRole('checkbox', { name: 'Clear filters and search to show imported applications' }).check()
  await preview(page).getByRole('button', { name: 'Apply selection' }).click()
  await expect(page.getByRole('searchbox', { name: 'Search applications' })).toHaveValue('')
  await expect(mark(page, 'Alpha')).toBeChecked()
})

test('unmatched presets cannot clear marks; cancelled and invalid imports do not reuse previews', async ({ page }) => {
  await mark(page, 'Beta').check()
  await file(page, ['Missing']); await open(page)
  await expect(preview(page).getByRole('button', { name: 'Apply selection' })).toBeDisabled()
  await expect(preview(page)).toContainText('Your current selection will be kept')
  await preview(page).getByRole('button', { name: 'Back', exact: true }).click()
  await file(page, 'invalid'); await page.getByRole('button', { name: 'Import preset…' }).click()
  await expect(page.getByRole('dialog')).toContainText('Unsupported preset format')
  await expect(preview(page)).toHaveCount(0)
  await file(page, null); await page.getByRole('button', { name: 'Import preset…' }).click()
  await expect(preview(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(mark(page, 'Beta')).toBeChecked()
})

test('preview follows removed apps and cannot apply after a profile switch or disconnect', async ({ page }) => {
  await file(page, ['Alpha']); await open(page)
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, apps: window.backendTest.snapshot.apps.apps.filter(app => app.packageName.endsWith('beta')) } }))
  await expect(preview(page)).toContainText('0 found · 1 missing')
  await expect(preview(page).getByRole('button', { name: 'Apply selection' })).toBeDisabled()
  await page.evaluate(seed => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, userId: 10, apps: [{ ...seed, userId: 10 }] } }), seed)
  await expect(preview(page).getByRole('button', { name: 'Apply selection' })).toBeDisabled()
  await connectionEvent(page, { devices: [], activeDeviceId: null })
  await expect(preview(page).getByRole('button', { name: 'Apply selection' })).toBeDisabled()
  await expect(preview(page)).toContainText('no longer active')
})
