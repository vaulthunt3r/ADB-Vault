import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { spawn } from 'node:child_process'

if (!process.versions.electron) {
  const { default: executable } = await import('electron')
  await mkdir('desktop-test-results', { recursive: true })
  const profile = await mkdtemp(path.resolve('desktop-test-results/notifications-electron-'))
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [path.resolve('scripts/check-notifications-electron.mjs'), `--user-data-dir=${profile}`], { env, windowsHide: true, stdio: 'inherit' })
  const timeout = setTimeout(() => child.kill(), 30000)
  child.on('error', error => { console.error(error); clearTimeout(timeout); process.exitCode = 1 })
  child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1 })
} else {
  const { app } = await import('electron')
  // Electron waits for the ESM entrypoint before emitting ready; do not await ready at module scope.
  void (async () => {
    let backend
    try {
    await app.whenReady()
    const { Backend } = await import('../dist-electron/backend.js')
    const { Storage } = await import('../dist-electron/storage.js')
    const { defaultNotificationSettings } = await import('../dist-electron/notifications-protocol.js')
    const storage = new Storage(app.getPath('userData')); await storage.load()
    storage.data.stopAdbOnExit = false
    let tested = 0
    // Do not initialize ADB or other services: this check only exercises the real request contract.
    backend = new Backend(storage, () => {}, path.resolve('android-helper/dist'), async () => { tested++ })
    assert.deepEqual(backend.snapshot().notifications, defaultNotificationSettings())
    const settings = { ...defaultNotificationSettings(), desktop: false, sound: false, backgroundOnly: true }
    settings.events['apps-loaded'] = { desktop: true, sound: false }
    settings.events['file-copy'] = { desktop: false, sound: true }
    backend.fastboot.state.busy = true
    assert.equal((await backend.request({ type: 'settings.notifications', settings })).ok, true)
    backend.fastboot.state.busy = false
    assert.deepEqual(backend.snapshot().notifications, settings)
    const restored = new Storage(storage.root); await restored.load()
    assert.deepEqual(restored.data.notifications, settings)
    assert.equal((await backend.request({ type: 'settings.notifications', settings: { sound: 'false' } })).ok, false)
    assert.deepEqual(backend.snapshot().notifications, settings)
    const save = storage.save.bind(storage)
    storage.save = async () => { throw new Error('Simulated disk failure') }
    assert.equal((await backend.request({ type: 'settings.notifications', settings: defaultNotificationSettings() })).ok, false)
    assert.deepEqual(backend.snapshot().notifications, settings)
    storage.save = save
    assert.equal((await backend.request({ type: 'notifications.test' })).ok, true)
    assert.equal(tested, 1)
    await backend.history.close(true); await storage.flush()
    console.log('Electron notification settings: validated requests, independent saved toggles, persistence, busy-operation access, save rollback and test dispatch passed. No phone operations or desktop banners were started.')
    app.exit(0)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })()
}
