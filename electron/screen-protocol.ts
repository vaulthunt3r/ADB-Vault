export type ScreenMode = 'display' | 'virtual' | 'camera'
export type CameraRotation = 0 | 90 | 180 | 270
export const cameraCommands = ['zoom-in', 'zoom-out', 'torch-on', 'torch-off', 'rotate-left', 'rotate-right'] as const
export type CameraCommand = typeof cameraCommands[number]
export type CameraUpdate = { kind: 'camera'; facing: 'back' | 'front' | 'external' } | { kind: 'audio'; audio: ScreenPreferences['audio'] } | { kind: 'record'; enabled: boolean } | { kind: 'refresh' }
export interface CameraInfo { id: string; facing: 'back' | 'front' | 'external' | 'unknown'; zoom?: { min: number; max: number }; sizes?: string[]; fps?: number[]; highSpeedModes?: { size: string; fps: number[] }[] }
export interface CameraPanelLayout { docked: boolean; collapsed?: boolean; shortcut: string; shortcutAvailable: boolean }
export type CameraPanelRequest = { kind: 'control'; command: CameraCommand } | { kind: 'zoom'; value: number } | { kind: 'update'; update: CameraUpdate; confirmedSplit?: boolean } | { kind: 'stop' } | { kind: 'always-on-top'; enabled: boolean }
export interface CameraPanelBridge {
  state(): Promise<ScreenSession | null>
  hide(): Promise<void>
  layout(change?: { docked?: boolean; collapsed?: boolean; shortcut?: string }): Promise<CameraPanelLayout>
  onLayout(listener: (layout: CameraPanelLayout) => void): () => void
  request(request: CameraPanelRequest): Promise<{ ok: boolean; error?: string }>
  subscribe(listener: (session: ScreenSession | null) => void): () => void
}
export function validateCameraUpdate(value: unknown): asserts value is CameraUpdate {
  if (!value || typeof value !== 'object') throw new Error('Invalid camera change.')
  const o = value as Record<string, unknown>
  if (o.kind === 'refresh' || o.kind === 'camera' && ['back', 'front', 'external'].includes(o.facing as string) || o.kind === 'audio' && ['off', 'device', 'duplicate', 'mic'].includes(o.audio as string) || o.kind === 'record' && typeof o.enabled === 'boolean') return
  throw new Error('Invalid camera change.')
}
export interface ScreenPreferences {
  maxSize: number; maxFps: number; bitRate: number; codec: 'h264' | 'h265' | 'av1'
  audio: 'off' | 'device' | 'duplicate' | 'mic'
  fullscreen: boolean; alwaysOnTop: boolean; screenOff: boolean; stayAwake: boolean
  control: boolean; keyboard: 'sdk' | 'uhid'; mouse: 'sdk' | 'uhid'; gamepad: boolean; clipboard: boolean
  virtualSize: string; virtualDpi: number; flexDisplay: boolean
  displayImePolicy: 'local' | 'fallback'
  cameraFacing: 'back' | 'front' | 'external'; cameraId: string; cameraSize: string; cameraFps: number
  cameraHighSpeed: boolean
  cameraZoom: number; cameraTorch: boolean; cameraPreviewRotation: CameraRotation; cameraRecordRotation: CameraRotation | 'preview'
}
export interface ScreenLaunch extends ScreenPreferences {
  mode: ScreenMode; record: boolean; recordFormat: 'mkv' | 'mp4'; timeLimit: number
  application?: { packageName: string; userId: number }
  touchControls?: boolean
}
export interface ScreenCapabilities { version: string; flags: string[] }
export interface ScreenSession {
  id: string; deviceId: string; deviceName: string; mode: ScreenMode; startedAt: string
  deviceSerial?: string; hardwareId?: string; title?: string; stopping?: boolean
  alwaysOnTop?: boolean; canSetAlwaysOnTop?: boolean
  recording?: string; application?: string; applicationLabel?: string
  input?: Pick<ScreenPreferences, 'control' | 'keyboard' | 'mouse' | 'gamepad'>
  virtualDisplayId?: number
  touchControls?: boolean
  cameraControls?: CameraCommand[]; controlling?: boolean
  cameras?: CameraInfo[]; cameraZoom?: { current?: number; min?: number; max?: number }
  camera?: { facing: ScreenPreferences['cameraFacing']; id: string; audio: ScreenPreferences['audio']; recordFormat: 'mkv' | 'mp4' }; restarting?: boolean
}
export const screenModeLabels: Record<ScreenMode, string> = { display: 'Phone screen', virtual: 'Virtual display', camera: 'Camera' }
export function screenSessionMatchesDevice(session: ScreenSession, device: { id: string; serial: string; hardwareId?: string }) {
  return session.deviceId === device.id || session.deviceSerial === device.serial || !!session.hardwareId && session.hardwareId === device.hardwareId
}
export const screenDefaults: ScreenPreferences = {
  maxSize: 0, maxFps: 0, bitRate: 8, codec: 'h264', audio: 'device',
  fullscreen: false, alwaysOnTop: false, screenOff: false, stayAwake: false,
  control: true, keyboard: 'sdk', mouse: 'sdk', gamepad: false, clipboard: true,
  virtualSize: '1920x1080', virtualDpi: 0, flexDisplay: false,
  displayImePolicy: 'local',
  cameraFacing: 'back', cameraId: '', cameraSize: '', cameraFps: 30, cameraHighSpeed: false,
  cameraZoom: 1, cameraTorch: false, cameraPreviewRotation: 0, cameraRecordRotation: 'preview',
}
export function cameraControlsError(o: ScreenPreferences, capabilities: ScreenCapabilities, recording: boolean): string | null {
  const requirements: [boolean, string, string][] = [
    [!!o.cameraHighSpeed, 'camera-high-speed', 'high-speed camera capture'],
    [o.cameraZoom !== 1, 'camera-zoom', 'initial zoom'],
    [o.cameraTorch, 'camera-torch', 'starting with the torch on'],
    [o.cameraPreviewRotation !== 0, 'display-orientation', 'preview rotation'],
    [recording && (o.cameraRecordRotation === 'preview' ? o.cameraPreviewRotation : o.cameraRecordRotation) !== 0, 'record-orientation', 'recording rotation'],
  ]
  const missing = requirements.find(([needed, flag]) => needed && !capabilities.flags.includes(`--${flag}`))
  if (!missing && o.cameraHighSpeed && !o.cameraSize) return 'Choose an explicit capture size for high-speed camera capture.'
  return missing ? `This scrcpy version does not support ${missing[2]}. Update scrcpy in Components or reset this camera option.` : null
}
export function screenLaunch(preferences: ScreenPreferences = screenDefaults): ScreenLaunch {
  return { ...preferences, mode: 'display', record: false, recordFormat: 'mkv', timeLimit: 0, touchControls: true }
}
export function supportsTouchControls(input?: Pick<ScreenPreferences, 'control' | 'keyboard' | 'mouse' | 'gamepad'>) {
  return !!input?.control && input.keyboard === 'sdk' && input.mouse === 'sdk' && !input.gamepad
}
export function screenInputError(o: ScreenPreferences, capabilities: ScreenCapabilities): string | null {
  if (!o.control) return null
  const missing = ([['keyboard', o.keyboard === 'uhid'], ['mouse', o.mouse === 'uhid'], ['gamepad', o.gamepad]] as const)
    .find(([flag, needed]) => needed && !capabilities.flags.includes(`--${flag}`))
  return missing ? `This scrcpy version does not support physical ${missing[0]} input. Update scrcpy in Components or change the input settings.` : null
}
export function validateScreenLaunch(value: unknown): asserts value is ScreenLaunch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid screen settings.')
  const o = value as Record<string, unknown>
  if (o.touchControls !== undefined && typeof o.touchControls !== 'boolean') throw new Error('Invalid touch controls setting.')
  if (o.cameraHighSpeed !== undefined && typeof o.cameraHighSpeed !== 'boolean') throw new Error('Invalid high-speed camera setting.')
  const oneOf = (key: string, choices: unknown[]) => { if (!choices.includes(o[key])) throw new Error(`Invalid screen setting: ${key}.`) }
  const integer = (key: string, min: number, max: number) => { if (!Number.isSafeInteger(o[key]) || (o[key] as number) < min || (o[key] as number) > max) throw new Error(`Invalid screen setting: ${key}.`) }
  oneOf('mode', ['display', 'virtual', 'camera']); oneOf('audio', ['off', 'device', 'duplicate', 'mic']); oneOf('codec', ['h264', 'h265', 'av1'])
  oneOf('keyboard', ['sdk', 'uhid']); oneOf('mouse', ['sdk', 'uhid']); oneOf('cameraFacing', ['back', 'front', 'external']); oneOf('recordFormat', ['mkv', 'mp4'])
  oneOf('displayImePolicy', ['local', 'fallback'])
  oneOf('cameraPreviewRotation', [0, 90, 180, 270]); oneOf('cameraRecordRotation', ['preview', 0, 90, 180, 270])
  if (typeof o.cameraZoom !== 'number' || !Number.isFinite(o.cameraZoom) || o.cameraZoom < 0.1 || o.cameraZoom > 100) throw new Error('Invalid camera zoom. Use a value between 0.1 and 100.')
  for (const key of ['fullscreen', 'alwaysOnTop', 'screenOff', 'stayAwake', 'control', 'gamepad', 'clipboard', 'flexDisplay', 'cameraTorch', 'record']) oneOf(key, [true, false])
  integer('maxSize', 0, 8192); integer('maxFps', 0, 240); integer('bitRate', 1, 200); integer('virtualDpi', 0, 960); integer('cameraFps', 1, 1000); integer('timeLimit', 0, 86400)
  for (const key of ['virtualSize', 'cameraSize']) {
    if (typeof o[key] !== 'string' || o[key] !== '' && !/^\d{2,4}x\d{2,4}$/.test(o[key] as string)) throw new Error(`Use width × height for ${key}.`)
    if (o[key] && (o[key] as string).split('x').some(n => Number(n) < 64 || Number(n) > 8192)) throw new Error('Display dimensions must be between 64 and 8192 pixels.')
  }
  if (typeof o.cameraId !== 'string' || !/^[a-zA-Z0-9_.:-]{0,64}$/.test(o.cameraId)) throw new Error('Invalid camera ID.')
  if (o.application !== undefined) {
    const app = o.application as ScreenLaunch['application']
    if (o.mode !== 'virtual' || !app || typeof app.packageName !== 'string' || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(app.packageName) || app.packageName.length > 255 || !Number.isSafeInteger(app.userId) || app.userId < 0) throw new Error('Invalid application for virtual display.')
  }
}
