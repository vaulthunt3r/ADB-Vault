// Opt-in hardware check: uses the real application profile and real ADB.
// Pass --accept-sdk-license only after reviewing and accepting Google's SDK terms.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'vite'
import { _electron as electron } from '@playwright/test'

const accept = process.argv.includes('--accept-sdk-license')
const server = await createServer({ server: { port: 5175, strictPort: true } })
await server.listen()
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5175' }
delete env.ELECTRON_RUN_AS_NODE
delete env.ADB_VAULT_SMOKE_TEST
let app
try {
  app = await electron.launch({ args: ['.'], env })
  console.log('Application profile:', await app.evaluate(({ app }) => app.getPath('userData')))
  const page = await app.firstWindow()
  await page.waitForFunction(() => !!window.desktop)
  const request = data => page.evaluate(data => window.desktop.request(data), data)
  let result
  for (let n = 0; n < 60; n++) {
    result = await request({ type: 'snapshot' })
    if (!result.snapshot.components.some(c => c.status === 'Checking')) break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  let adb = result.snapshot.components.find(c => c.id === 'adb')
  if (!adb.location || adb.version === '—') {
    assert.ok(accept, 'ADB is missing. Review the Android SDK License Agreement before installing.')
    // Explicit CLI consent applies only to this one Platform Tools dialog.
    await app.evaluate(({ dialog }) => {
      const original = dialog.showMessageBox.bind(dialog)
      dialog.showMessageBox = async (...args) => {
        const options = args.at(-1)
        if (options?.title === 'Install components' && options?.message === 'Install adb?') {
          dialog.showMessageBox = original
          return { response: 2, checkboxChecked: false }
        }
        return original(...args)
      }
    })
    console.log('Installing official Platform Tools with explicit SDK license consent…')
    result = await request({ type: 'components.action', id: 'adb', action: 'install' })
    assert.ok(result.ok, result.error)
    adb = result.snapshot.components.find(c => c.id === 'adb')
  }
  console.log('Verified components:', JSON.stringify(result.snapshot.components.filter(c => ['adb', 'fastboot'].includes(c.id)).map(c => ({ id: c.id, version: c.version, status: c.status, location: c.location }))))
  await page.getByRole('navigation').getByRole('button', { name: 'Connection', exact: true }).click()
  let previous = ''
  for (let n = 0; n < 45; n++) {
    result = await request({ type: 'connection.scan' })
    const devices = result.snapshot.connection.devices.filter(d => d.method === 'USB' && d.status !== 'disconnected')
    const report = JSON.stringify({ devices: devices.map(d => ({ name: d.name, status: d.status, android: d.android, canDetach: d.canDetach })), error: result.snapshot.connection.error })
    if (report !== previous) { console.log('USB:', report); previous = report }
    if (devices.some(d => d.status === 'connected')) break
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  const cableCycle = { requested: process.argv.includes('--cable-cycle'), disconnected: false, reconnected: false }
  if (cableCycle.requested) {
    const device = result.snapshot.connection.devices.find(d => d.method === 'USB' && d.status === 'connected')
    assert.ok(device, 'Cable cycle requires a connected USB device.')
    assert.equal(device.known, true, 'Successful device should enter Known devices.')
    console.log('Cable check: unplug for 5 seconds, then reconnect. Waiting up to 90 seconds…')
    for (let n = 0; n < 45; n++) {
      result = await request({ type: 'connection.scan' })
      const current = result.snapshot.connection.devices.find(d => d.id === device.id)
      if (!cableCycle.disconnected && current?.status === 'disconnected') {
        cableCycle.disconnected = true
        assert.equal(result.snapshot.connection.activeDeviceId, null)
        assert.equal(current.known, true)
        console.log('PASS: cable loss clears active device and preserves Known devices.')
      }
      if (cableCycle.disconnected && current?.status === 'connected') {
        cableCycle.reconnected = true
        console.log('PASS: USB reconnection detected automatically.'); break
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  await mkdir('desktop-test-results', { recursive: true })
  await writeFile('desktop-test-results/usb-hardware.json', JSON.stringify({ checkedAt: new Date().toISOString(), cableCycle, snapshot: result.snapshot }, null, 2))
  await page.screenshot({ path: 'desktop-test-results/usb-hardware.png' })
  console.log('Hardware check complete; actual results saved in desktop-test-results/usb-hardware.json')
} finally {
  await server.close()
  if (app) {
    const child = app.process()
    // The ADB daemon can inherit pipe handles from Electron on Windows.
    // Close only the test's pipe readers after Electron exits; keep ADB running.
    const timer = setTimeout(() => {
      if (child.exitCode !== null) for (const stream of child.stdio) stream?.destroy()
    }, 3000)
    try { await app.close() } finally { clearTimeout(timer) }
  }
}
