// Explicitly invoked to refresh public screenshots, using synthetic devices/apps.
import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import type { AndroidApp } from '../electron/apps-protocol'

test('capture public documentation screenshots using fixture data only', async ({ page }) => {
  await installBackendFixture(page)
  await page.addInitScript(() => {
    localStorage.setItem('adb-vault-tour-v1', 'seen')
    localStorage.setItem('adb-vault-appearance', JSON.stringify({ state: { themeId: 'vault-blue', density: 'compact' }, version: 1 }))
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await connectionEvent(page, { devices: [{ id: 'DEMO', serial: 'DEMO', name: 'Demo phone', status: 'connected', android: '16', method: 'USB', endpoint: 'DEMO', lastSeen: '', known: true, canDetach: false }], activeDeviceId: 'DEMO' })
  const names = ['Browser', 'Calculator', 'Calendar', 'Camera', 'Clock', 'Files', 'Gallery', 'Music', 'Notes', 'Settings', 'Translator', 'Weather']
  const apps: AndroidApp[] = names.map((label, index) => ({ packageName: `org.example.${label.toLowerCase()}`, label, versionName: `${index % 3 + 1}.0.0`, versionCode: index + 1, uid: 10001 + index, userId: 0, enabled: true, system: ['Camera', 'Settings'].includes(label), updatedSystemApp: false, sourceDir: '/data/app/example/base.apk', firstInstallTime: 1760000000000, lastUpdateTime: 1761000000000, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }))
  await page.evaluate(apps => { window.backendTest.snapshot.apps.apps = apps }, apps)
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await expect(page.getByRole('table', { name: 'Installed applications' })).toBeVisible()
  await page.getByRole('button', { name: 'Details for Notes', exact: true }).click()
  await mkdir('docs/images', { recursive: true })
  await page.screenshot({ path: 'docs/images/apps.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Terminal mode', exact: true }).dblclick()
  await expect(page.getByRole('table', { name: 'Installed applications' })).toHaveCSS('color', 'rgb(125, 255, 153)')
  await page.mouse.move(1430, 895)
  await expect(page.locator('.terminal-activation')).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({ path: 'docs/images/zero-cool.png', animations: 'disabled' })
})
