import { test, expect, type Page } from '@playwright/test'
import { connectionEvent, installBackendFixture } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'
const app: AndroidApp = { packageName: 'org.example.notes', label: 'Notes', versionName: '1', versionCode: 1, uid: 10001, userId: 0, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/base.apk', firstInstallTime: 1, lastUpdateTime: 1, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }
const details = (page: Page) => page.getByRole('region', { name: 'Application details', exact: true })
async function inventory(page: Page) {
  await page.evaluate(() => {
    const state = window.backendTest.snapshot.apps
    state.details!.data!.components = [
      { name: 'org.example.notes.Main', type: 'Activity', enabled: true, exported: true, processName: 'org.example.notes', directBootAware: false },
      { name: 'org.example.notes.Shortcut', type: 'Activity', enabled: false, exported: true, targetActivity: 'org.example.notes.Main' },
      { name: 'org.example.notes.Sync', type: 'Service', enabled: false, exported: false, permission: 'android.permission.BIND_JOB_SERVICE' },
      { name: 'org.example.notes.Boot', type: 'Receiver', enabled: null, exported: false, directBootAware: true },
      { name: 'org.example.notes.Files', type: 'Provider', enabled: true, exported: false, authority: 'org.example.notes.files', readPermission: 'org.example.READ', writePermission: 'org.example.WRITE' },
    ]
    state.details!.data!.requestedPermissions = [
      { name: 'android.permission.INTERNET', granted: true, protectionLevel: 0, declaringPackage: 'android', label: 'Доступ к сети', description: 'Описание из Android' },
      { name: 'android.permission.CAMERA', granted: false, protectionLevel: 1, flags: 0, definitionFlags: 0, declaringPackage: 'android', label: 'Camera', description: 'Take pictures' },
      { name: 'org.example.UNKNOWN', granted: null, protectionLevel: null, declaringPackage: null, label: null, description: null },
    ]
    window.backendTest.emit({ type: 'apps', apps: { ...state } })
  })
}
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'USB1', serial: 'USB1', name: 'Phone', status: 'connected', android: '16', method: 'USB', endpoint: 'USB1', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'USB1' })
  await page.evaluate(app => { window.backendTest.snapshot.apps.apps = [app, { ...app, uid: 10002, packageName: 'org.example.other', label: 'Other' }] }, app)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Notes', exact: true }).dblclick()
  await expect(details(page).getByRole('tab', { name: 'About application' })).toHaveAttribute('aria-selected', 'true')
  await expect(details(page).getByRole('region', { name: 'Application information' })).toContainText('arm64-v8a')
  await inventory(page)
})
test('all component tabs show real fields, search and copy without rereading the device', async ({ page }) => {
  const view = details(page)
  const before = await page.evaluate(() => window.backendTest.requests.length)
  await view.getByRole('tab', { name: 'Activities', exact: true }).click()
  await expect(view.getByRole('list', { name: 'Activities' }).getByRole('listitem')).toHaveCount(2)
  await view.getByRole('searchbox').fill('Shortcut')
  await expect(view.getByRole('listitem')).toHaveCount(1)
  await expect(view.getByRole('listitem')).toContainText('Alias target')
  await view.getByRole('button', { name: 'Copy org.example.notes.Shortcut', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('org.example.notes.Shortcut')
  await view.getByRole('tab', { name: 'Services', exact: true }).click()
  await expect(view.getByRole('searchbox')).toHaveValue('')
  await expect(view.getByRole('listitem')).toContainText('BIND_JOB_SERVICE')
  await expect(view.getByRole('listitem')).toContainText('Disabled')
  await view.getByRole('tab', { name: 'Receivers', exact: true }).click()
  await expect(view.getByRole('listitem')).toContainText('State unavailable')
  await view.getByRole('tab', { name: 'Providers', exact: true }).click()
  await expect(view.getByRole('listitem')).toContainText('org.example.notes.files')
  await expect(view.getByRole('listitem')).toContainText('org.example.WRITE')
  expect(await page.evaluate(() => window.backendTest.requests.length)).toBe(before)
  await page.screenshot({ path: 'test-results/app-providers.png' })
})
test('permissions preserve denied and unknown states, localized labels and keyboard tab navigation', async ({ page }) => {
  const view = details(page)
  await view.getByRole('tab', { name: 'About application' }).focus(); await page.keyboard.press('End')
  await expect(view.getByRole('tab', { name: 'Used permissions' })).toBeFocused()
  const rows = view.getByRole('listitem')
  await expect(rows.filter({ hasText: 'android.permission.CAMERA' })).toContainText('Denied')
  await expect(rows.filter({ hasText: 'org.example.UNKNOWN' })).toContainText('Unknown')
  await expect(rows.filter({ hasText: 'android.permission.INTERNET' })).toContainText('Доступ к сети')
  await view.getByRole('searchbox').fill('missing'); await expect(view.getByText('No matches.', { exact: true })).toBeVisible()
  await view.getByRole('searchbox').fill('')
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await view.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/app-permissions-narrow.png' })
  await view.getByRole('tab', { name: 'Used permissions' }).focus(); await page.keyboard.press('Home')
  await expect(view.getByRole('tab', { name: 'About application' })).toBeFocused()
})
test('global refresh rereads the open application and preserves the active tab', async ({ page }) => {
  const view = details(page)
  await view.getByRole('tab', { name: 'Services', exact: true }).click()
  const reads = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.details').length)
  await expect(view.getByRole('button', { name: 'Refresh details', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh applications', exact: true }).click()
  await expect(view).toBeVisible()
  await expect(view.getByRole('tab', { name: 'Services', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.details').length)).toBe(reads + 1)
  await inventory(page)
  await expect(view.getByRole('listitem')).toContainText('org.example.notes.Sync')
})

test('empty, unavailable and refreshed inventories are distinct and another app resets the tab', async ({ page }) => {
  const view = details(page)
  await view.getByRole('tab', { name: 'Services', exact: true }).click()
  await page.evaluate(() => { const state = window.backendTest.snapshot.apps; state.details!.data!.components = []; window.backendTest.emit({ type: 'apps', apps: { ...state } }) })
  await expect(view.getByText('No services declared.')).toBeVisible()
  await view.getByRole('tab', { name: 'Used permissions' }).click()
  await page.evaluate(() => { const state = window.backendTest.snapshot.apps; delete state.details!.data!.requestedPermissions; window.backendTest.emit({ type: 'apps', apps: { ...state } }) })
  await expect(view.getByText('Information unavailable. Use Refresh applications to retry.')).toBeVisible()
  await inventory(page); await expect(view.getByRole('listitem')).toHaveCount(3)
  await view.getByRole('button', { name: 'Back to Apps' }).click()
  await page.getByRole('button', { name: 'Details for Other', exact: true }).dblclick()
  await expect(details(page).getByRole('tab', { name: 'About application' })).toHaveAttribute('aria-selected', 'true')
})

test('permission switches grant and revoke with the keyboard, retain the tab/search and record Activity without a full refresh', async ({ page }) => {
  const view = details(page)
  await view.getByRole('tab', { name: 'Used permissions' }).click()
  await view.getByRole('searchbox').fill('CAMERA')
  const before = await page.evaluate(() => window.backendTest.requests.length)
  const control = view.getByRole('switch', { name: 'Permission android.permission.CAMERA', exact: true })
  await expect(control).toHaveAttribute('aria-checked', 'false')
  await control.focus(); await page.keyboard.press('Space')
  await expect(control).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Space')
  await expect(control).toHaveAttribute('aria-checked', 'false')
  await expect(view.getByRole('searchbox')).toHaveValue('CAMERA')
  await expect(view.getByRole('tab', { name: 'Used permissions' })).toHaveAttribute('aria-selected', 'true')
  const requests = await page.evaluate(n => window.backendTest.requests.slice(n), before)
  expect(requests).toEqual([
    { type: 'apps.permission', id: 'USB1', userId: 0, packageName: app.packageName, permission: 'android.permission.CAMERA', expectedGranted: false, granted: true },
    { type: 'apps.permission', id: 'USB1', userId: 0, packageName: app.packageName, permission: 'android.permission.CAMERA', expectedGranted: true, granted: false },
  ])
  await page.getByRole('navigation').getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Session events' }).getByRole('button', { name: 'Event: Change permission · 1 applications', exact: true })).toHaveCount(2)
})

test('protected permissions explain the restriction and never issue a change request', async ({ page }) => {
  const view = details(page)
  await view.getByRole('tab', { name: 'Used permissions' }).click()
  const normal = view.getByRole('switch', { name: 'Permission android.permission.INTERNET', exact: true })
  await expect(normal).toBeDisabled()
  await view.getByRole('button', { name: 'About changing android.permission.INTERNET', exact: true }).click()
  await expect(view.getByText('Managed by Android. Only runtime permissions can be changed here.', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    const s = window.backendTest.snapshot.apps
    s.details!.data!.requestedPermissions!.find(p => p.name === 'android.permission.CAMERA')!.flags = 4
    window.backendTest.emit({ type: 'apps', apps: { ...s } })
  })
  await expect(view.getByRole('switch', { name: 'Permission android.permission.CAMERA', exact: true })).toBeDisabled()
  await view.getByRole('button', { name: 'About changing android.permission.CAMERA', exact: true }).click()
  await expect(view.getByText('Fixed by a device or profile administrator.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.permission'))).toHaveLength(0)
  await page.screenshot({ path: 'test-results/permission-controls-restrictions.png' })
})

test('pending permission changes prevent repeat submission, keep existing state, and show backend errors inline', async ({ page }) => {
  const view = details(page)
  await view.getByRole('tab', { name: 'Used permissions' }).click()
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async request => {
      if (request.type !== 'apps.permission') return original(request)
      window.backendTest.requests.push(request)
      await new Promise(resolve => setTimeout(resolve, 800))
      return { ok: false, error: 'Android rejected this permission change.', snapshot: window.backendTest.snapshot }
    }
  })
  const control = view.getByRole('switch', { name: 'Permission android.permission.CAMERA', exact: true })
  await control.click()
  await expect(control).toContainText('Updating…')
  await expect(control).toBeDisabled()
  await expect(control).toHaveAttribute('aria-checked', 'false')
  await expect(view.getByRole('alert')).toContainText('Android rejected this permission change.')
  await expect(control).toBeEnabled()
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'apps.permission'))).toHaveLength(1)
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await view.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})
