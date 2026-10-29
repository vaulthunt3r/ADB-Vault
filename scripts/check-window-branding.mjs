import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { _electron as electron } from '@playwright/test'

const run = promisify(execFile)
const input = process.argv[2]
const inspectOnly = process.argv.includes('--inspect')
const development = input === '--dev'
const executablePath = development ? (await import('electron')).default : path.resolve(input)
const profile = await fs.mkdtemp(path.resolve('desktop-test-results/window-branding-'))
await fs.writeFile(path.join(profile, 'backend.json'), JSON.stringify({ paths: {}, known: [], stopAdbOnExit: false, appsOptions: { early: false } }))
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
let instance
try {
  instance = await electron.launch({ executablePath, args: [...(development ? ['.'] : []), `--user-data-dir=${profile}`], env, timeout: 90000 })
  await instance.firstWindow()
  const state = await instance.evaluate(({ app, BrowserWindow, dialog }) => {
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1)
      if (options.title !== 'Operations are active') throw new Error('Unexpected test dialog')
      return { response: 1, checkboxChecked: false }
    }
    const windows = BrowserWindow.getAllWindows()
    const handle = windows[0].getNativeWindowHandle()
    return { handle: (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16), hidden: windows.every(w => !w.isVisible()), appPath: app.getAppPath() }
  })
  assert.equal(state.hidden, true)
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('scripts/read-window-branding.ps1'), '-Handle', state.handle, '-Output', profile], { windowsHide: true, maxBuffer: 1024 * 1024 })
  const report = JSON.parse(stdout.replace(/^\uFEFF/, ''))
  await fs.writeFile(path.join(profile, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, profile }, null, 2))
  if (!inspectOnly) {
    for (const icon of report.icons) assert.ok(icon.green > icon.opaque * 0.3, `Expected ADB Vault's green ${icon.kind} window icon`)
    assert.equal(report.appId, development ? 'dev.adbvault.desktop.dev' : 'dev.adbvault.desktop')
    assert.equal(report.relaunchName, 'ADB Vault')
    assert.ok(report.relaunchIcon && !report.relaunchIcon.includes('.asar'))
    assert.match(report.relaunchIcon, /\.ico,0$/i)
    const iconFile = report.relaunchIcon.replace(/,0$/, '')
    assert.ok((await fs.readFile(iconFile)).equals(await fs.readFile('build/icon.ico')), 'Windows must be able to read the bundled ADB Vault ICO directly')
    assert.ok(report.relaunchCommand.startsWith(`"${executablePath}"`))
    if (development) assert.ok(report.relaunchCommand.includes(state.appPath))
    console.log('PASS: native small/large icons and Windows taskbar identity use ADB Vault branding; the test window stayed hidden.')
  }
} finally { if (instance) await instance.close() }
