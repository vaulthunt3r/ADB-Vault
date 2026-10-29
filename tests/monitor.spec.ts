import { test, expect } from '@playwright/test'
import { installBackendFixture, connectionEvent } from './backend-fixture'
import { networkRate } from '../src/lib/monitor'
import type { MonitorPoint } from '../src/store/useMonitorStore'

test('network rate rejects gaps, resets, interface changes and reboot', () => {
  const point = (time: number, received: number, uptime: number): MonitorPoint => ({ time, sample: { id: 'phone', tab: 'network', time, issues: [], network: { interfaces: [{ name: 'wlan0', received, sent: 0 }], addresses: [], uptime } } })
  const a = point(1000, 500, 1), b = point(3000, 2500, 3)
  expect(networkRate([a, b], 1, 'wlan0', 'received')).toBe(1000)
  expect(networkRate([a, b], 1, 'tun0', 'received')).toBeNull()
  expect(networkRate([a, { time: 2000, sample: null }, b], 2, 'wlan0', 'received')).toBeNull()
  expect(networkRate([a, point(3000, 100, 3)], 1, 'wlan0', 'received')).toBeNull()
  expect(networkRate([a, point(3000, 2500, 0.5)], 1, 'wlan0', 'received')).toBeNull()
})

test.beforeEach(async ({ page }) => {
  await installBackendFixture(page); await page.goto('/')
  await connectionEvent(page, { activeDeviceId: 'phone', devices: [{ id: 'phone', name: 'Redmi test', serial: 'serial', transportId: '7', android: '14', status: 'connected', method: 'Wi-Fi', endpoint: 'serial', known: true, canDetach: true, lastSeen: '' }] })
  await page.evaluate(() => {
    const request = window.desktop!.request; let index = 0
    window.desktop!.request = async r => {
      if (r.type !== 'monitor.read') return request(r)
      window.backendTest.requests.push(r); index++
      return { ok: true, snapshot: window.backendTest.snapshot, monitor: {
        id: r.id, tab: r.tab, time: Date.now(), issues: r.tab === 'battery' ? ['Current: Permission denied'] : [],
        ...(r.tab === 'processes' ? { cpu: { total: 18 + index, window: 'CPU usage from 3000ms to 1000ms ago:' }, processes: [{ pid: 100, name: 'com.example.notes', cpu: 5, rss: 104857600 }, { pid: 101, name: 'system_server', cpu: null, rss: 209715200 }] } : {}),
        ...(r.tab === 'memory' ? { memory: { total: 8589934592, available: 3221225472, free: 1073741824, cached: 2147483648, swapTotal: 2147483648, swapFree: 1073741824 }, processes: [{ pid: 100, name: 'com.example.notes', cpu: null, rss: 104857600 }] } : {}),
        ...(r.tab === 'battery' ? { battery: { level: 75, temperature: 31.5, voltage: 4.1, current: null, status: 'Discharging', health: 'Good', power: [], technology: 'Li-ion' } } : {}),
        ...(r.tab === 'network' ? { network: { interfaces: [{ name: 'wlan0', received: index * 1048576, sent: index * 1024 }, { name: 'tun0', received: index * 2048, sent: index * 512 }], addresses: ['3: wlan0 inet 192.168.1.113/24'], uptime: Date.now() / 1000 } } : {}),
      } }
    }
  })
  await page.getByRole('button', { name: 'Monitor', exact: true }).click()
})

test('views show real-shaped samples, pause stops polling and layout fits compact window', async ({ page }) => {
  await expect(page.getByRole('cell', { name: 'com.example.notes' })).toBeVisible()
  await page.getByLabel('Search processes').fill('system')
  await expect(page.getByRole('cell', { name: 'com.example.notes' })).toHaveCount(0)
  await page.getByLabel('Search processes').clear()
  await page.getByRole('tab', { name: 'Memory', exact: true }).click()
  await expect(page.locator('.monitor-content')).toContainText('5 GiB')
  await page.getByRole('tab', { name: 'Battery', exact: true }).click()
  await expect(page.locator('.monitor-content')).toContainText('75%')
  await expect(page.locator('.monitor-content')).toContainText('Unavailable')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.getByLabel('Monitor interval').selectOption('2')
  const count = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read').length)
  await page.waitForTimeout(2300)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read').length)).toBe(count)
  await page.screenshot({ path: 'test-results/monitor-battery.png' })
  await page.setViewportSize({ width: 1000, height: 680 })
  expect(await page.locator('main').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  await expect(page.getByRole('tab', { name: 'Network', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/monitor-compact.png' })
})

test('network waits for a pair of samples and keeps interface counters separate', async ({ page }) => {
  await page.getByLabel('Monitor interval').selectOption('2')
  await page.getByRole('tab', { name: 'Network', exact: true }).click()
  await expect(page.getByLabel('Network interface')).toHaveValue('wlan0')
  await expect(page.locator('.monitor-content')).toContainText('Waiting for samples')
  await expect(page.locator('.monitor-content')).toContainText('/s', { timeout: 6000 })
  await page.getByLabel('Network interface').selectOption('tun0')
  await expect(page.locator('.monitor-content')).toContainText('KiB')
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(page.locator('.monitor-metrics')).not.toContainText('Waiting for samples')
  await page.screenshot({ path: 'test-results/monitor-network.png' })
})

test('disconnect halts reads and device change clears old measurements', async ({ page }) => {
  await expect(page.getByRole('cell', { name: 'com.example.notes' })).toBeVisible()
  const before = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read').length)
  await connectionEvent(page, { devices: [{ id: 'phone', name: 'Redmi test', serial: 'serial', transportId: '7', android: '14', status: 'offline', method: 'Wi-Fi', endpoint: 'serial', known: true, canDetach: true, lastSeen: '' }] })
  await expect(page.locator('.monitor-status')).toContainText('Disconnected')
  await page.getByLabel('Monitor interval').selectOption('2'); await page.waitForTimeout(2200)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read').length)).toBe(before)
  await connectionEvent(page, { activeDeviceId: null, devices: [] })
  await expect(page.getByRole('cell', { name: 'com.example.notes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeDisabled()
  await connectionEvent(page, { activeDeviceId: 'other', devices: [] })
  await expect(page.getByRole('cell', { name: 'com.example.notes' })).toHaveCount(0)
})

test('leaving Monitor stops reads and tabs support keyboard navigation', async ({ page }) => {
  await expect(page.getByRole('cell', { name: 'com.example.notes' })).toBeVisible()
  await page.getByRole('tab', { name: 'Processes', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: 'Memory', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.monitor-content')).toContainText('5 GiB')
  await page.getByLabel('Monitor interval').selectOption('2')
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  const count = await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read').length)
  await page.waitForTimeout(2300)
  expect(await page.evaluate(() => window.backendTest.requests.filter(r => r.type === 'monitor.read').length)).toBe(count)
})
