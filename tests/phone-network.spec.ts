import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import { geoipComponent } from '../electron/network-protocol'

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await page.evaluate(component => window.backendTest.emit({ type: 'components', components: [...window.backendTest.snapshot.components, component] }), geoipComponent)
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Phone', serial: 'serial', transportId: '7', android: '14', status: 'connected', method: 'Wi-Fi', endpoint: 'serial', known: true, canDetach: true, lastSeen: '' }] })
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, deviceId: 'phone', currentUserId: 0, profiles: [
    { id: 0, name: 'Personal', managed: false, running: true },
    { id: 10, name: 'Office', managed: true, running: true },
    { id: 11, name: 'Second space', managed: false, running: false },
  ] } }))
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'network.connections') {
        window.backendTest.requests.push(r)
        const common = { protocol: 'TCP' as const, family: 4 as const, localAddress: '192.168.1.2', localPort: 50000, remotePort: 443, state: 'Established', ip: { scope: 'Public / other' } }
        return { ok: true, snapshot: window.backendTest.snapshot, phoneConnections: { target: r.target, time: Date.now(), issues: [], geoip: 'GeoIP not loaded', sockets: [
          { ...common, key: 'a', uid: 10123, userId: 0, packages: ['com.example.browser'], remoteAddress: '8.8.8.8' },
          { ...common, key: 'b', uid: 1010123, userId: 10, packages: ['com.example.work', 'com.example.shared'], remoteAddress: '1.1.1.1' },
          { ...common, key: 'c', uid: 0, userId: 0, packages: [], remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', ip: { scope: 'Unspecified' } },
        ] } }
      }
      return original(r)
    }
  })
  await page.getByRole('button', { name: 'Monitor', exact: true }).click()
  await page.getByRole('tab', { name: 'Network', exact: true }).click()
  await page.getByRole('button', { name: 'Connections', exact: true }).click()
})

test('phone connections expose UID/profile attribution, filters and optional GeoIP', async ({ page }) => {
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '0.0.0.0:0', exact: true })).toHaveCount(0)
  await expect(page.getByText('UID 1010123 · Office · ID 10 · Work profile · Shared UID · 2 possible owners')).toBeVisible()
  expect(await page.getByText('UID 1010123 · Office · ID 10 · Work profile · Shared UID · 2 possible owners').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.getByText('Shared UID · 2 possible owners', { exact: true })).toHaveAttribute('title', 'These applications share the same UID. The available data cannot identify which one opened this connection.')
  await expect(page.getByLabel('Connection profile', { exact: true }).locator('option')).toHaveText(['All Android profiles', 'Personal · ID 0 · Current', 'Office · ID 10 · Work profile', 'Second space · ID 11'])
  await page.getByLabel('Connection profile', { exact: true }).selectOption('10')
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toHaveCount(0)
  await page.getByLabel('Filter connections', { exact: true }).fill('shared')
  await expect(page.getByRole('button', { name: '1.1.1.1:443', exact: true })).toBeVisible()
  await page.getByLabel('Filter connections', { exact: true }).clear()
  await page.getByLabel('Connection profile', { exact: true }).selectOption('')
  await page.getByLabel('Include listening / unconnected').check()
  await expect(page.getByRole('button', { name: '0.0.0.0:0', exact: true })).toBeVisible()
  await expect(page.getByText('No destination address', { exact: true })).toHaveAttribute('title', /waiting for incoming connections/)
  await expect(page.getByRole('button', { name: 'Check route', exact: true })).toHaveCount(0)
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, deviceId: 'another-phone' } }))
  await expect(page.getByLabel('Connection profile', { exact: true }).locator('option')).toHaveText(['All Android profiles', 'Profile · ID 0', 'Profile · ID 10'])
  await expect(page.getByRole('button', { name: 'Configure GeoIP' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Configure GeoIP', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Locate MMDB files', exact: true }).first()).toBeVisible()
})

test('addresses copy directly with mouse or keyboard without a separate action panel', async ({ page }) => {
  await page.getByRole('button', { name: '8.8.8.8:443', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('8.8.8.8')
  await page.getByRole('button', { name: '192.168.1.2:50000', exact: true }).first().press('Enter')
  await expect.poll(() => page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('192.168.1.2')
  await page.getByRole('button', { name: '1.1.1.1:443', exact: true }).press('Space')
  await expect.poll(() => page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('1.1.1.1')
  await expect(page.getByRole('region', { name: 'IP information' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Copy IP/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Check route', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'network.trace'))).toEqual([])
})

test('Country and Network are separate, flags load offline and network text copies its ASN', async ({ page }) => {
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toBeVisible()
  await expect(page.locator('.country-flag')).toHaveCount(0)
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      const reply = await original(r)
      if (!reply.ok) return reply
      if (reply.phoneConnections) {
        reply.phoneConnections.geoip = 'Country database loaded'
        reply.phoneConnections.sockets[0].ip = { scope: 'Public / other', countryCode: 'US', country: 'United States', organization: 'Google LLC', asn: 15169 }
        reply.phoneConnections.sockets[1].ip = { scope: 'Public / other', countryCode: 'ZZ', country: 'Unknown country' }
        reply.phoneConnections.sockets.push({ ...reply.phoneConnections.sockets[0], key: 'private', remoteAddress: '192.168.1.1', ip: { scope: 'Private network' } })
      }
      return reply
    }
  })
  await page.getByRole('button', { name: 'Refresh connections', exact: true }).click()
  await expect(page.locator('.network-sockets th')).toHaveText(['Application / UID', 'Remote address', 'Protocol / state', 'Country', 'Network', 'Local address'])
  await expect(page.locator('.network-sockets .country-flag')).toHaveCount(1)
  const publicRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: '8.8.8.8:443', exact: true }) })
  await expect(publicRow.getByRole('cell').nth(3)).toHaveText('United States (US)')
  await expect(publicRow.getByRole('cell').nth(4)).toContainText('Google LLC')
  await publicRow.getByRole('button', { name: /Google LLC/ }).click()
  await expect.poll(() => page.evaluate(() => window.backendTest.clipboardWrites.at(-1))).toBe('Google LLC · AS15169')
  await expect(page.getByText('Local / private network', { exact: true })).toHaveAttribute('title', /Wi-Fi network or inside a VPN/)
  await expect(page.locator('.country-flag')).toHaveCount(1)
  await expect.poll(() => page.locator('.country-flag').evaluateAll(images => images.every(img =>
    img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 && (img.src.startsWith(location.origin + '/') || img.src.startsWith('data:image/svg+xml')),
  ))).toBe(true)
  await page.screenshot({ path: 'desktop-test-results/phone-network-table.png' })
})

test('application icons and labels match package, Android UID and phone', async ({ page }) => {
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 36
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#246d53'; ctx.fillRect(0, 0, 36, 36)
    const app = { packageName: 'com.example.browser', label: 'Browser', uid: 1010123, userId: 10, enabled: true, system: false, updatedSystemApp: false, versionName: '1', versionCode: 1, sourceDir: '/data/app/base.apk', firstInstallTime: 1, lastUpdateTime: 1, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: canvas.toDataURL('image/png').split(',')[1] }
    window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, status: 'ready', deviceId: 'phone', userId: 10, apps: [app] } })
  })
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: '8.8.8.8:443', exact: true }) })
  await expect(row).toBeVisible()
  await expect(row.locator('.android-app-icon img')).toHaveCount(0)
  await expect(row.locator('.network-app-placeholder')).toHaveCount(1)
  await page.evaluate(() => {
    const apps = window.backendTest.snapshot.apps
    window.backendTest.emit({ type: 'apps', apps: { ...apps, userId: 0, apps: apps.apps.map(app => ({ ...app, uid: 10123, userId: 0 })) } })
  })
  await expect(row.getByText('Browser', { exact: true })).toBeVisible()
  await expect.poll(() => row.locator('.android-app-icon img').evaluate(img => img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0)).toBe(true)
  await page.evaluate(() => window.backendTest.emit({ type: 'apps', apps: { ...window.backendTest.snapshot.apps, deviceId: 'another-phone' } }))
  await expect(row.locator('.android-app-icon img')).toHaveCount(0)
  await expect(row.getByText('Browser', { exact: true })).toHaveCount(0)
  await expect(row.getByText('com.example.browser', { exact: true })).toBeVisible()
})

test('Apps action opens connections filtered to the chosen application and profile', async ({ page }) => {
  await page.evaluate(() => {
    const base = window.backendTest.snapshot.apps
    window.backendTest.emit({ type: 'apps', apps: { ...base, status: 'ready', deviceId: 'phone', userId: 10, apps: [{ packageName: 'com.example.work', label: 'Work app', uid: 1010123, userId: 10, enabled: true, system: false, updatedSystemApp: false, versionName: '1', versionCode: 1, sourceDir: '/data/app/base.apk', firstInstallTime: 1, lastUpdateTime: 1, targetSdk: 35, minSdk: 26, installer: null, enabledState: 0, suspended: false, stopped: false, debuggable: false, iconPng: null }] } })
  })
  await page.getByRole('navigation').getByRole('button', { name: 'Apps', exact: true }).click()
  await page.getByRole('button', { name: 'Details for Work app', exact: true }).click()
  await page.getByRole('tab', { name: 'Actions', exact: true }).click()
  await page.getByRole('button', { name: 'Network connections', exact: true }).click()
  await expect(page.getByRole('button', { name: '1.1.1.1:443', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Connection profile', { exact: true })).toHaveValue('10')
  await page.getByRole('button', { name: 'Clear app filter' }).click()
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toBeVisible()
})

test('leaving the view cancels pending phone reading and switching transport drops old addresses', async ({ page }) => {
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => {
      if (r.type === 'network.connections') { window.backendTest.requests.push(r); return new Promise(() => {}) }
      return original(r)
    }
  })
  await page.getByRole('button', { name: 'Refresh connections', exact: true }).click()
  await expect(page.getByText('Reading phone sockets…', { exact: true })).toBeVisible()
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Phone', serial: 'serial', transportId: '8', android: '14', status: 'connected', method: 'Wi-Fi', endpoint: 'serial', known: true, canDetach: true, lastSeen: '' }] })
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'network.cancel').length)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  const count = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'network.connections').length)
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'network.connections').length)).toBe(count)
})

test('snapshot errors retain the previous reading and do not pretend the phone has no connections', async ({ page }) => {
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const original = window.desktop!.request
    window.desktop!.request = async r => r.type === 'network.connections' ? { ok: false, snapshot: window.backendTest.snapshot, error: 'Phone read timed out' } : original(r)
  })
  await page.getByRole('button', { name: 'Refresh connections', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Phone read timed out')
  await expect(page.getByText(/Showing the last successful reading/)).toBeVisible()
  await expect(page.getByRole('button', { name: '8.8.8.8:443', exact: true })).toBeVisible()
})
