import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, rename, rm, stat, link, copyFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import type { BackendEvent, ConnectionSnapshot, DeviceRecord } from './contracts.js'
import { checked, run, powershell, type Runner } from './process.js'
import { screenLaunch, validateScreenLaunch, screenModeLabels, screenSessionMatchesDevice, cameraCommands, validateCameraUpdate, type CameraCommand, type CameraUpdate, type ScreenLaunch, type ScreenCapabilities, type ScreenSession } from './screen-protocol.js'
import { parseScreenCapabilities, screenArguments } from './screen-options.js'
import { WindowsCameraControls, type CameraControlPort } from './camera-window-control.js'
import { cameraLogReader, parseCameraList, parseCameraModes, selectCamera } from './camera-info.js'
import type { CameraInfo } from './screen-protocol.js'
import { cameraZoomSteps, closestZoomIndex } from './camera-zoom.js'
import { parseScreenApplications, type ScreenApplications } from './screen-applications.js'

export const screenActions = ['open', 'screenshot', 'wake', 'sleep'] as const
export type ScreenAction = typeof screenActions[number]
export type ScreenTarget = Pick<DeviceRecord, 'id' | 'serial' | 'transportId'>
type Launch = (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; windowsHide: boolean; shell: false; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess
type Session = { child: ChildProcess; done: Promise<void>; view: ScreenSession; device: DeviceRecord; options: ScreenLaunch; windowTitle: string; stopping?: boolean; controlling?: boolean; restarting?: boolean; finished?: boolean; recordingFailed?: boolean; cameraReady?: boolean }
async function closeWindow(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform !== 'win32') { child.kill('SIGINT'); return }
  // WM_CLOSE lets SDL finish the recorder; TerminateProcess (child.kill on Windows) does not.
  await powershell(`$process = Get-Process -Id ${Number(child.pid)} -ErrorAction SilentlyContinue; if ($process -and !$process.CloseMainWindow()) { throw 'Close the scrcpy window to finish this session.' }`)
}

export class DeviceScreenService {
  busy = false
  closing = false
  private sessions = new Map<string, Session>()
  private windowNumber = 0
  get activeSessionCount() { return this.sessions.size }
  get state() { return [...this.sessions.values()].map(s => ({ ...s.view, stopping: !!s.stopping, controlling: !!s.controlling, restarting: !!s.restarting })) }
  private capabilityCache?: { key: string; value: ScreenCapabilities }
  private controller = new AbortController()
  constructor(private adbPath: () => string | null, private scrcpyPath: () => string | null,
    private connection: () => ConnectionSnapshot, private emit: (event: BackendEvent) => void,
    private savePath: (name: string) => Promise<string | null>, private runner: Runner = run, private launch: Launch = spawn,
    private closeChild: (child: ChildProcess) => Promise<void> = closeWindow,
    private cameraPort: CameraControlPort = new WindowsCameraControls()) {}

  private changed() { this.emit({ type: 'screenSessions', sessions: this.state }) }
  async screenWindow(id: string) {
    const s = this.sessions.get(id)
    if (this.closing || !s || s.finished || s.stopping || s.restarting || !s.child.pid) return null
    return await this.cameraPort.inspect?.(s.child.pid, s.windowTitle) ?? null
  }
  async dockScreenPin(id: string, handle: string, title: string) {
    const s = this.sessions.get(id)
    if (this.closing || !s || s.finished || s.stopping || s.restarting || !s.child.pid || !this.cameraPort.dockPanel) throw new Error('The screen window is not ready.')
    await this.cameraPort.dockPanel(handle, title, s.child.pid, s.windowTitle, true)
  }
  touchTarget(id: string) {
    const s = this.sessions.get(id), adb = this.adbPath()
    if (this.closing || !s || s.finished || s.stopping || !s.child.pid || s.view.mode !== 'virtual' || !s.options.application || !s.view.virtualDisplayId || !adb) throw new Error('Wait for the virtual display to open, then try again.')
    const live = this.device(s.device)
    if (live.hardwareId !== s.device.hardwareId) throw new Error('The phone identity changed. Reopen the virtual display.')
    if (!s.options.control || s.options.keyboard !== 'sdk' || s.options.mouse !== 'sdk' || s.options.gamepad) throw new Error('Restart this virtual display with the Apps & touch input preset to use touch mapping.')
    return { adb, device: { ...s.device }, displayId: s.view.virtualDisplayId, userId: s.options.application.userId, packageName: s.options.application.packageName, pid: s.child.pid, title: s.windowTitle, textInput: true }
  }
  async touchWindow(id: string) {
    const target = this.touchTarget(id)
    return await this.cameraPort.inspect?.(target.pid, target.title) ?? null
  }
  async dockTouchPanel(id: string, handle: string, title: string, enabled: boolean) {
    if (!this.cameraPort.dockPanel) throw new Error('Touch overlays require Windows.')
    const target = enabled ? this.touchTarget(id) : null
    await this.cameraPort.dockPanel(handle, title, target?.pid || 0, target?.title || '', enabled)
  }
  async cameraWindow(id: string) {
    const session = this.sessions.get(id)
    if (!session || session.finished || session.restarting || !session.child.pid || session.view.mode !== 'camera') return null
    const window = await this.cameraPort.inspect?.(session.child.pid, session.windowTitle) ?? null
    // scrcpy 5 removed the old "Texture:" log. Its video window is shown only
    // after the first frame. The default zoom is 1; non-default zoom is logged.
    if (window?.visible && this.sessions.get(id) === session && !session.finished && !session.restarting && !session.controlling && !session.cameraReady) {
      session.cameraReady = true
      if (session.options.cameraZoom === 1 && session.view.cameraZoom?.current === undefined) {
        session.view.cameraZoom = { ...session.view.cameraZoom, current: 1 }; this.changed()
      }
    }
    return window
  }
  async moveCameraPanel(handle: string, title: string, x: number, y: number) {
    if (this.closing || !this.cameraPort.movePanel) throw new Error('Camera panels are unavailable.')
    await this.cameraPort.movePanel(handle, title, x, y)
  }
  async dockCameraPanel(id: string, handle: string, title: string, enabled: boolean) {
    const session = this.sessions.get(id)
    if (this.closing || !this.cameraPort.dockPanel) throw new Error('Camera panels are unavailable.')
    if (enabled && (!session || session.finished || session.restarting || !session.child.pid || session.view.mode !== 'camera')) throw new Error('Camera window is not ready.')
    await this.cameraPort.dockPanel(handle, title, session?.child.pid || 0, session?.windowTitle || '', enabled)
  }
  private async cameras(target: ScreenTarget, adb: string): Promise<CameraInfo[]> {
    const device = this.device(target), executable = this.scrcpyPath()
    if (!executable) throw new Error('Install or locate scrcpy in Components.')
    const result = await this.runner(executable, [`--serial=${device.serial}`, '--list-cameras'], 15000, undefined, { ADB: adb, ...(device.transportId ? { ANDROID_TRANSPORT_ID: device.transportId } : {}) }, { signal: this.controller.signal })
    checked(result); this.device(target)
    return parseCameraList(`${result.stdout}\n${result.stderr}`)
  }
  async cameraModes(target: ScreenTarget): Promise<CameraInfo[]> {
    if (this.closing) throw new Error('ADB Vault is closing.')
    const device = { ...this.device(target) }, adb = this.adbPath(), executable = this.scrcpyPath()
    if (!adb || !executable) throw new Error('Install or locate ADB and scrcpy in Components.')
    const caps = await this.capabilities()
    if (!caps.flags.includes('--list-camera-sizes')) throw new Error('Update scrcpy to read camera modes. Manual settings are still available.')
    this.device(target)
    const result = await this.runner(executable, [`--serial=${device.serial}`, '--list-camera-sizes'], 20000, undefined, { ADB: adb, ...(device.transportId ? { ANDROID_TRANSPORT_ID: device.transportId } : {}) }, { signal: this.controller.signal })
    checked(result); this.device(target)
    return parseCameraModes(`${result.stdout}\n${result.stderr}`)
  }
  async capabilities(): Promise<ScreenCapabilities> {
    if (this.closing) throw new Error('ADB Vault is closing.')
    const executable = this.scrcpyPath()
    if (!executable) throw new Error('Install or locate scrcpy in Components to open screen control.')
    const info = await stat(executable).catch(() => null)
    const key = `${executable}:${info?.mtimeMs}:${info?.size}`
    if (this.capabilityCache?.key === key) return this.capabilityCache.value
    const result = await this.runner(executable, ['--help'], 10000, undefined, undefined, { signal: this.controller.signal })
    checked(result)
    const value = parseScreenCapabilities(`${result.stdout}\n${result.stderr}`)
    this.capabilityCache = { key, value }; return value
  }
  async applications(target: ScreenTarget): Promise<ScreenApplications> {
    if (this.closing) throw new Error('ADB Vault is closing.')
    const device = { ...this.device(target) }, adb = this.adbPath(), executable = this.scrcpyPath()
    if (!adb || !executable) throw new Error('Install or locate ADB and scrcpy in Components.')
    const caps = await this.capabilities()
    if (!caps.flags.includes('--list-apps')) throw new Error('Update scrcpy in Components to choose an application here.')
    const selector = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
    const currentUser = async () => {
      this.device(target)
      const user = checked(await this.runner(adb, [...selector, 'shell', 'am', 'get-current-user'], 10000, undefined, undefined, { signal: this.controller.signal })).trim()
      if (!/^\d{1,5}$/.test(user)) throw new Error('Could not read the current Android profile.')
      return Number(user)
    }
    const userId = await currentUser()
    const result = await this.runner(executable, [`--serial=${device.serial}`, '--list-apps'], 30000, undefined, { ADB: adb, ...(device.transportId ? { ANDROID_TRANSPORT_ID: device.transportId } : {}) }, { signal: this.controller.signal })
    checked(result)
    if (await currentUser() !== userId) throw new Error('The Android profile changed. Refresh the application list.')
    this.device(target)
    return { userId, applications: parseScreenApplications(`${result.stdout}\n${result.stderr}`) }
  }
  async setAlwaysOnTop(id: string, enabled: boolean) {
    if (this.closing) throw new Error('ADB Vault is closing.')
    if (typeof enabled !== 'boolean') throw new Error('Invalid window pin setting.')
    const session = this.sessions.get(id)
    if (!session || session.finished) throw new Error('This screen session has ended.')
    if (session.stopping || session.restarting || session.controlling) throw new Error('Wait for the screen change to finish.')
    if (!session.child.pid || !session.view.canSetAlwaysOnTop || !this.cameraPort.setAlwaysOnTop) throw new Error('Live window pinning is unavailable.')
    session.controlling = true; this.changed()
    try {
      await this.cameraPort.setAlwaysOnTop(session.child.pid, session.windowTitle, enabled)
      if (this.closing || session.finished || this.sessions.get(id) !== session) throw new Error('This screen session has ended.')
      session.view.alwaysOnTop = enabled
      session.options.alwaysOnTop = enabled
    } finally { session.controlling = false; if (this.sessions.get(id) === session) this.changed() }
  }
  async stop(id: string) {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.restarting || session.controlling) throw new Error('Wait for the screen change to finish.')
    if (session.stopping) return
    session.stopping = true
    this.changed()
    try {
      await this.closeChild(session.child)
      if (!await this.wait(session, 6000)) throw new Error('scrcpy is still finishing. Close its window to save the recording and end the session.')
    } finally { session.stopping = false; if (this.sessions.has(id)) this.changed() }
  }
  async cameraControl(id: string, command: CameraCommand) {
    if (!cameraCommands.includes(command)) throw new Error('Unsupported live camera command.')
    const session = this.cameraSession(id)
    if (!session.view.cameraControls?.includes(command)) throw new Error('This live control is unavailable. Update scrcpy in Components.')
    if (!session.child.pid) throw new Error('The camera process is not ready.')
    session.controlling = true; this.changed()
    try { await this.cameraPort.send(session.child.pid, session.windowTitle, command) }
    finally { session.controlling = false; if (this.sessions.get(id) === session) this.changed() }
  }
  private cameraSession(id: string) {
    if (this.closing) throw new Error('ADB Vault is closing.')
    const session = this.sessions.get(id)
    if (!session || session.view.mode !== 'camera' || session.finished) throw new Error('This camera session has ended.')
    if (session.stopping || session.restarting || session.controlling) throw new Error('Wait for the camera change to finish.')
    return session
  }
  async cameraZoom(id: string, value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid camera zoom.')
    const session = this.cameraSession(id), zoom = session.view.cameraZoom
    const steps = cameraZoomSteps(zoom?.min, zoom?.max)
    if (!steps.length || !session.child.pid || !session.view.cameraControls?.includes('zoom-in') || !session.view.cameraControls.includes('zoom-out')) throw new Error('Live zoom is unavailable for this camera.')
    if (value < steps[0] || value > steps.at(-1)!) throw new Error('Zoom is outside this camera’s range.')
    const target = steps[closestZoomIndex(steps, value)], deadline = Date.now() + 15000
    session.controlling = true; this.changed()
    try {
      for (let count = 0; count < 160; count++) {
        if (this.closing || session.finished || this.sessions.get(id) !== session || session.child.exitCode !== null) throw new Error('The camera session has ended.')
        const current = session.view.cameraZoom?.current
        if (current !== undefined && Math.abs(current - target) < target * 0.0001) return
        // When the initial value was not logged, one live step obtains a real
        // reading (even at a limit), then subsequent steps approach the target.
        const direction = current === undefined ? 'zoom-out' : target > current ? 'zoom-in' : 'zoom-out'
        await this.cameraPort.send(session.child.pid, session.windowTitle, direction)
        const feedbackDeadline = Math.min(deadline, Date.now() + 2000)
        while (!this.closing && !session.finished && session.view.cameraZoom?.current === current && Date.now() < feedbackDeadline) await new Promise(resolve => setTimeout(resolve, 20))
        const next = session.view.cameraZoom?.current
        if (next === current || Date.now() >= deadline) throw new Error('The camera did not confirm the requested zoom. The displayed value is the last reported value.')
        if (next === undefined) throw new Error('Camera zoom feedback was lost.')
        if (current !== undefined && (direction === 'zoom-in' && next > target || direction === 'zoom-out' && next < target)) return // Different scrcpy increment: retain the actual reading.
      }
      throw new Error('Camera zoom adjustment reached its step limit.')
    } finally { session.controlling = false; if (this.sessions.get(id) === session) this.changed() }
  }
  async updateCamera(id: string, update: CameraUpdate, confirmedSplit = false) {
    validateCameraUpdate(update)
    const session = this.cameraSession(id)
    if (this.busy) throw new Error('Wait for the current screen operation.')
    if (session.options.record && update.kind !== 'record' && update.kind !== 'refresh' && !confirmedSplit) throw new Error('Changing camera or sound saves the current recording and continues in a new file. Confirm this change first.')
    const options = { ...session.options }
    if (update.kind === 'camera') { options.cameraFacing = update.facing; options.cameraId = ''; options.cameraTorch = false; options.cameraZoom = 1 }
    // A high-speed size/FPS pair belongs to the previous lens. Preserve the
    // existing normal-mode behavior when no high-speed mode was selected.
    if (update.kind === 'camera' && options.cameraHighSpeed) { options.cameraHighSpeed = false; options.cameraSize = ''; options.cameraFps = 30 }
    if (update.kind === 'audio') options.audio = update.audio
    if (update.kind === 'record') options.record = update.enabled
    if (!options.record) options.timeLimit = 0
    const target = { id: session.device.id, serial: session.device.serial, transportId: session.device.transportId }
    const device = this.device(target), adb = this.adbPath()
    if (!adb) throw new Error('Install or locate ADB first.')
    this.busy = true; session.restarting = update.kind !== 'refresh'; session.controlling = update.kind === 'refresh'; this.changed()
    try {
      const cameras = await this.cameras(target, adb)
      session.view.cameras = cameras
      if (update.kind === 'refresh') {
        const current = cameras.find(camera => camera.id === session.view.camera?.id)
        session.view.cameraZoom = { current: session.view.cameraZoom?.current, ...current?.zoom }
        return
      }
      const camera = selectCamera(cameras, options.cameraId, options.cameraFacing)
      options.cameraId = camera.id
      const caps = await this.capabilities()
      // Validate before ending a working preview or recording.
      const selector = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
      const sdk = checked(await this.runner(adb, [...selector, 'shell', 'getprop', 'ro.build.version.sdk'], 10000, undefined, undefined, { signal: this.controller.signal })).trim()
      if (!/^\d+$/.test(sdk)) throw new Error('Could not determine the Android version.')
      screenArguments(options, caps, Number(sdk), options.record ? 'recording.mkv' : undefined)
      let destination: string | undefined
      if (options.record) {
        const chosen = await this.pickRecording(device, options)
        if (!chosen) return
        destination = chosen
      }
      this.device(target)
      if (session.finished || this.sessions.get(id) !== session) throw new Error('The camera session ended while choosing the file.')
      // An owned Win32 popup is destroyed with its owner. Release the panel
      // before replacing scrcpy, then attach it to the replacement window.
      if (session.child.pid) await this.cameraPort.releaseCamera?.(session.child.pid, session.windowTitle)
      await this.closeChild(session.child)
      if (!await this.wait(session, 6000)) throw new Error('The camera is still finishing. Try again after its window closes.')
      if (session.recordingFailed) throw new Error('The previous recording could not be finalized. Its capture was preserved; see Activity before starting another session.')
      await this.openScreen(target, { ...device }, adb, options, undefined, { session, destination, cameras })
    } catch (error) {
      this.log(session.device, `Camera change: ${error instanceof Error ? error.message : error}`, 'warning')
      throw error
    } finally {
      this.busy = false; session.restarting = false; session.controlling = false
      if (this.sessions.get(id) === session && session.finished) this.sessions.delete(id)
      this.changed()
    }
  }
  private wait(session: Session, milliseconds: number) {
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), milliseconds)
      void session.done.then(() => { clearTimeout(timer); resolve(true) })
    })
  }

  private device(target: ScreenTarget) {
    if (this.closing) throw new Error('ADB Vault is closing.')
    const state = this.connection(), device = state.devices.find(d => d.id === target.id)
    if (state.busy) throw new Error('Wait for the connection operation to finish.')
    if (!device || device.status !== 'connected') throw new Error('Connect the selected phone first.')
    if (device.serial !== target.serial || device.transportId !== target.transportId) throw new Error('The connection changed. Select the phone and try again.')
    return device
  }
  private log(device: DeviceRecord, text: string, tone: 'info' | 'success' | 'warning' = 'info') {
    this.emit({ type: 'activity', source: 'connection', device: device.serial, text: `${device.name}: ${text}`, tone })
  }
  async execute(target: ScreenTarget, action: ScreenAction, options: ScreenLaunch = screenLaunch(), applicationLabel?: string): Promise<string | null> {
    if (!screenActions.includes(action)) throw new Error('Unsupported screen action.')
    if (action === 'open') validateScreenLaunch(options)
    if (this.busy) throw new Error('Wait for the current screen operation.')
    const device = { ...this.device(target) }, adb = this.adbPath()
    if (!adb) throw new Error('Install or locate ADB in Components first.')
    this.busy = true
    try {
      if (action === 'open') return await this.openScreen(target, device, adb, options, applicationLabel)
      const selector = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
      if (action === 'screenshot') return await this.screenshot(target, device, adb, selector)
      const result = await this.runner(adb, [...selector, 'shell', 'input', 'keyevent', action === 'wake' ? 'KEYCODE_WAKEUP' : 'KEYCODE_SLEEP'], 10000, undefined, undefined, { signal: this.controller.signal })
      checked(result)
      if (/error|exception|denied|not found|usage:/i.test(`${result.stdout}\n${result.stderr}`)) throw new Error(result.stderr || result.stdout)
      const message = action === 'wake' ? 'Wake screen requested' : 'Sleep screen requested'
      this.log(device, message); return message
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log(device, `${action}: ${message}`, 'warning'); throw new Error(message)
    } finally { this.busy = false }
  }
  private async screenshot(target: ScreenTarget, device: DeviceRecord, adb: string, selector: string[]) {
    const name = device.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80).replace(/[. ]+$/, '') || 'Phone'
    const destination = await this.savePath(`${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    if (!destination) return null
    this.device(target) // The picker may remain open while the phone disconnects.
    if (path.extname(destination).toLowerCase() !== '.png') throw new Error('Choose a PNG file name.')
    const temporary = path.join(path.dirname(destination), `.adb-vault-${randomUUID()}.png.tmp`)
    try {
      checked(await this.runner(adb, [...selector, 'exec-out', 'screencap', '-p'], 20000, undefined, undefined, { stdoutFile: temporary, signal: this.controller.signal }))
      const size = (await stat(temporary)).size
      if (size < 45 || size > 50_000_000) throw new Error('Android returned an invalid or oversized screenshot.')
      const file = await open(temporary, 'r')
      try {
        const head = Buffer.alloc(24), tail = Buffer.alloc(12)
        await file.read(head, 0, 24, 0); await file.read(tail, 0, 12, size - 12)
        if (!head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || head.toString('ascii', 12, 16) !== 'IHDR' || !head.readUInt32BE(16) || !head.readUInt32BE(20) || !tail.equals(Buffer.from('0000000049454e44ae426082', 'hex'))) throw new Error('Android did not return a complete PNG screenshot. Protected content may not be capturable.')
      } finally { await file.close() }
      if (this.closing) throw new Error('ADB Vault is closing.')
      await rename(temporary, destination)
      this.log(device, `Screenshot saved: ${destination}`, 'success')
      return `Screenshot saved: ${destination}`
    } finally { await rm(temporary, { force: true }).catch(() => {}) }
  }
  private async pickRecording(device: DeviceRecord, options: ScreenLaunch) {
    const name = device.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) || 'Phone'
    const picked = await this.savePath(`${name}-${options.mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.${options.recordFormat}`)
    if (!picked) return null
    if (path.extname(picked).toLowerCase() !== `.${options.recordFormat}`) throw new Error(`Choose a .${options.recordFormat} file name.`)
    const normalized = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
    if (this.state.some(s => s.recording && normalized(s.recording) === normalized(picked))) throw new Error('Another window is recording to this file. Choose a different recording name.')
    try { await stat(picked); throw new Error('This recording file already exists. Choose a new name to keep the previous recording.') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    return picked
  }
  private async openScreen(target: ScreenTarget, device: DeviceRecord, adb: string, options: ScreenLaunch, applicationLabel?: string, replacement?: { session: Session; destination?: string; cameras: CameraInfo[] }) {
    if (options.mode === 'virtual' && !options.application) throw new Error('Choose an application before starting a virtual display.')
    if (options.mode !== 'virtual' && this.state.some(s => s.id !== replacement?.session.view.id && screenSessionMatchesDevice(s, device) && s.mode === options.mode)) throw new Error(`${screenModeLabels[options.mode]} is already open for this phone. Close that window before starting another ${screenModeLabels[options.mode].toLowerCase()} session. Virtual windows can stay open.`)
    const caps = await this.capabilities(), executable = this.scrcpyPath()!
    const selector = device.transportId ? ['-t', device.transportId] : ['-s', device.serial]
    const shell = async (args: string[]) => checked(await this.runner(adb, [...selector, 'shell', ...args], 10000, undefined, undefined, { signal: this.controller.signal })).trim()
    this.device(target)
    const sdkText = await shell(['getprop', 'ro.build.version.sdk'])
    if (!/^\d+$/.test(sdkText)) throw new Error('Could not determine the Android version. Reconnect the phone and try again.')
    const checkProfile = async () => {
      if (!options.application) return
      const current = await shell(['am', 'get-current-user'])
      if (!/^\d+$/.test(current) || Number(current) !== options.application.userId) throw new Error('scrcpy starts apps in the phone’s current Android user. Select that profile in Apps; another profile will not be launched automatically.')
    }
    await checkProfile()
    if (options.application) {
      const { packageName, userId } = options.application
      let launchable = false
      for (const category of ['LAUNCHER', 'LEANBACK_LAUNCHER']) {
        const resolved = await shell(['cmd', 'package', 'resolve-activity', '--brief', '--user', String(userId), '-a', 'android.intent.action.MAIN', '-c', `android.intent.category.${category}`, '-p', packageName])
        if (resolved.split(/\r?\n/).some(line => line.trim().startsWith(`${packageName}/`) && /^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(line.trim()))) { launchable = true; break }
      }
      if (!launchable) throw new Error('This application is disabled or has no accessible launcher in the current Android profile. Refresh the application list.')
    }
    // Validate features before opening a save dialog or launching a phone-side server.
    screenArguments(options, caps, Number(sdkText), options.record ? 'recording.mkv' : undefined)
    const cameras = options.mode === 'camera' ? replacement?.cameras || await this.cameras(target, adb) : undefined
    const camera = cameras ? selectCamera(cameras, options.cameraId, options.cameraFacing) : undefined
    if (camera) options = { ...options, cameraId: camera.id, cameraFacing: camera.facing === 'unknown' ? options.cameraFacing : camera.facing }
    let destination: string | undefined, temporary: string | undefined
    if (options.record) {
      const picked = replacement?.destination || await this.pickRecording(device, options)
      if (!picked) return null
      if (path.extname(picked).toLowerCase() !== `.${options.recordFormat}`) throw new Error(`Choose a .${options.recordFormat} file name.`)
      const normalizedPath = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)
      if (this.state.some(s => s.recording && normalizedPath(s.recording) === normalizedPath(picked))) throw new Error('Another window is recording to this file. Choose a different recording name.')
      try { await stat(picked); throw new Error('This recording file already exists. Choose a new name to keep the previous recording.') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
      destination = picked
      temporary = path.join(path.dirname(picked), `.adb-vault-${randomUUID()}.${options.recordFormat}`)
      // Check write access before starting capture; reserve a unique staging path.
      const file = await open(temporary, 'wx'); await file.close()
    }
    try { this.device(target); await checkProfile(); this.device(target) }
    catch (error) { if (temporary) await rm(temporary, { force: true }); throw error }
    const { args, notes } = screenArguments(options, caps, Number(sdkText), temporary)
    const title = replacement?.session.view.title || `Window ${++this.windowNumber} · ${applicationLabel || options.application?.packageName || screenModeLabels[options.mode]}`
    const view: ScreenSession = { id: replacement?.session.view.id || randomUUID(), deviceId: device.id, deviceSerial: device.serial, hardwareId: device.hardwareId, deviceName: device.name, title, mode: options.mode, startedAt: new Date().toISOString(), recording: destination, application: options.application?.packageName, applicationLabel,
      alwaysOnTop: options.alwaysOnTop, canSetAlwaysOnTop: process.platform === 'win32' && !!this.cameraPort.setAlwaysOnTop,
      ...(options.mode !== 'camera' ? { input: { control: options.control, keyboard: options.keyboard, mouse: options.mouse, gamepad: options.gamepad } } : {}),
      ...(options.mode === 'virtual' ? { touchControls: options.touchControls !== false } : {}),
      ...(camera ? { cameras, cameraZoom: { ...camera.zoom } } : {}),
      ...(options.mode === 'camera' ? { camera: { facing: options.cameraFacing, id: options.cameraId, audio: options.audio, recordFormat: options.recordFormat }, cameraControls: process.platform === 'win32' ? cameraCommands.filter(command => command.startsWith('zoom') ? caps.flags.includes('--camera-zoom') : command.startsWith('torch') ? caps.flags.includes('--camera-torch') : true) : [] } : {}),
    }
    const log = (text: string, tone: 'info' | 'success' | 'warning' = 'info') => this.log(device, `${title}: ${text}`, tone)
    let child: ChildProcess
    const windowTitle = `ADB Vault — ${device.name} — ${title}${options.record ? ' · Recording' : ''}`
    try { child = this.launch(executable, [`--serial=${device.serial}`, `--window-title=${windowTitle}`, ...args], {
      cwd: path.dirname(executable), env: { ...process.env, ADB: adb, ...(device.transportId ? { ANDROID_TRANSPORT_ID: device.transportId } : {}) }, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    }) } catch (error) { if (temporary) await rm(temporary, { force: true }); throw error }
    let output = '', failedToStart = false
    const cameraLine = (line: string) => {
      const display = /New display:.*\(id=(\d+)\)/.exec(line)
      if (options.mode === 'virtual' && display && Number(display[1]) > 0 && this.sessions.get(view.id) === session && !session.finished) { view.virtualDisplayId = Number(display[1]); this.changed() }
      if (!camera || this.sessions.get(view.id) !== session || session.finished) return
      const zoom = /Set camera zoom: ([\d.eE+-]+)/.exec(line)
      if (zoom && Number.isFinite(Number(zoom[1])) && Number(zoom[1]) > 0) view.cameraZoom = { ...view.cameraZoom, current: Number(zoom[1]) }
      else if (/Texture:|New texture:/.test(line) && options.cameraZoom === 1 && view.cameraZoom?.current === undefined) view.cameraZoom = { ...view.cameraZoom, current: 1 }
      else if (/Camera error|Camera configuration error/.test(line)) view.cameraZoom = { ...view.cameraZoom, current: undefined }
      else return
      session.cameraReady = true
      this.changed()
    }
    for (const pipe of [child.stdout, child.stderr]) {
      const read = cameraLogReader(cameraLine)
      pipe?.on('data', chunk => { output = (output + String(chunk)).slice(-4000); read(chunk) })
    }
    let session!: Session
    const done = new Promise<void>(resolve => {
      child.once('close', code => { void (async () => {
        if (!failedToStart) {
          if (temporary && destination) {
            try {
              if (code !== 0 || !(await stat(temporary)).size) throw new Error('Recording did not finish normally.')
              // Never overwrite an existing recording, including a file created during capture.
              try { await link(temporary, destination) }
              catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error; await copyFile(temporary, destination, constants.COPYFILE_EXCL) }
              await rm(temporary, { force: true })
              log(`Recording saved: ${destination}`, 'success')
            } catch (error) { session.recordingFailed = true; log(`${error instanceof Error ? error.message : error} Recording may be incomplete; captured data kept at ${temporary}. ${output.trim()}`, 'warning') }
          } else log(code === 0 ? 'Screen control closed.' : `scrcpy stopped (${code ?? 'disconnected'}). ${output.trim() || 'Check the phone connection and scrcpy in Components.'}`, code === 0 ? 'info' : 'warning')
        }
      })().finally(() => { session.finished = true; if (!session.restarting && this.sessions.get(view.id) === session) this.sessions.delete(view.id); this.changed(); resolve() }) })
      child.once('error', () => { failedToStart = true; session.finished = true; if (!session.restarting && this.sessions.get(view.id) === session) this.sessions.delete(view.id); this.changed(); if (temporary) void rm(temporary, { force: true }).catch(() => {}); resolve() })
    })
    session = { child, done, view, device, options: { ...options }, windowTitle }
    this.sessions.set(view.id, session); this.changed()
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    log(`scrcpy ${options.mode} started.${destination ? ` Recording to ${destination}.` : ''}${notes.length ? ` ${notes.join(' ')}` : ''}`)
    return `Opening ${options.mode === 'virtual' ? 'a virtual display' : options.mode === 'camera' ? 'the phone camera' : 'screen control'} in scrcpy…${notes.length ? ` ${notes.join(' ')}` : ''}`
  }
  async shutdown() {
    this.closing = true; this.controller.abort()
    this.cameraPort.shutdown()
    const sessions = [...this.sessions.values()]
    await Promise.all(sessions.map(async session => {
      await this.closeChild(session.child).catch(() => {})
      if (!await this.wait(session, 6000)) { session.child.kill(); await this.wait(session, 3000) }
    }))
  }
}
