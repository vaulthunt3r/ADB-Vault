import { test, expect } from '@playwright/test'
import { connectionEvent, installBackendFixture } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'
const app: AndroidApp = { packageName: 'org.example.notes', label: 'Notes', versionName: '1', versionCode: 1, uid: 1010001, userId: 10, enabled: true, system: false, updatedSystemApp: false, sourceDir: '/data/app/notes/base.apk', firstInstallTime: 0, lastUpdateTime: 0, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null, actionContext: { fingerprint: 'build', sdk: 36, callerUid: 2000, cachePermission: 'denied' }, actionEvidence: [{ device: 'USB1', fingerprint: 'build', userId: 10, packageName: 'org.example.notes', versionCode: 1, action: 'disable', method: 'shell', root: false, keepData: false, outcome: 'denied', message: 'Firmware denied disabling this app.', at: '2026-10-16T15:00:00Z' }] }
test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'USB1', serial: 'USB1', name: 'Phone', status: 'connected', android: '16', method: 'USB', endpoint: 'USB1', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'USB1' })
  await page.evaluate(app => { Object.assign(window.backendTest.snapshot.apps, { apps: [app], userId: 10, profiles: [{ id: 10, name: 'Work', managed: true, running: true }] }) }, app)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Notes', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
})
test('badges stay beside actions, without a manual method selector', async ({ page }) => {
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText('Restricted', { exact: true })).toHaveCount(1)
  await expect(panel.getByText('Unknown', { exact: true })).toHaveCount(1)
  await expect(page.getByRole('combobox', { name: 'Package actions method' })).toHaveCount(0)
  await panel.getByRole('checkbox', { name: 'Keep data when uninstalling' }).check()
  await panel.getByRole('button', { name: 'Uninstall from profile', exact: true }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toEqual({ type: 'apps.action', id: 'USB1', userId: 10, packageName: app.packageName, action: 'uninstall', options: { keepData: true } })
  await panel.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(panel.getByText('Restricted', { exact: true })).toHaveCount(2)
  await expect(panel.getByRole('checkbox', { name: /Cache/ })).not.toBeChecked()
  await page.screenshot({ path: 'test-results/package-actions-automatic.png' })
})
test('cleanup selects methods automatically, with no keep-data option leaking into clearing', async ({ page }) => {
  const panel = page.getByRole('tabpanel')
  await panel.getByRole('checkbox', { name: 'Keep data when uninstalling' }).check()
  await panel.getByRole('button', { name: 'Clear', exact: true }).click()
  await panel.getByRole('checkbox', { name: /App data/ }).check()
  await panel.getByRole('button', { name: 'Clear selected' }).click()
  expect(await page.evaluate(() => window.backendTest.requests.at(-1))).toMatchObject({ type: 'apps.batchAction', plan: { action: 'clear-storage', cleanup: ['data'], options: {} } })
})

test('badge reflects the final automatic method result, including equal timestamps', async ({ page }) => {
  await page.evaluate(app => {
    const evidence = app.actionEvidence![0]
    window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, apps: [{ ...app, actionEvidence: [
      { ...evidence, outcome: 'failed', message: 'Unknown command: disable-user' },
      { ...evidence, method: 'api', outcome: 'confirmed', message: 'Disabled for this profile · verified on device.' },
    ] }] } })
  }, app)
  const panel = page.getByRole('tabpanel')
  await expect(panel.getByText('Available', { exact: true })).toHaveCount(1)
  await expect(panel.getByText('Restricted', { exact: true })).toHaveCount(0)
  await expect(panel.getByText('Unknown', { exact: true })).toHaveCount(1)
})
