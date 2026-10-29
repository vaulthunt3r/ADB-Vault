import type { ScreenCapabilities, ScreenLaunch } from './screen-protocol.js'
import { cameraControlsError, screenInputError, supportsTouchControls, validateScreenLaunch } from './screen-protocol.js'

export function parseScreenCapabilities(output: string): ScreenCapabilities {
  const version = output.match(/\bscrcpy\s+(\d+(?:\.\d+)+)/i)?.[1]
  const flags = [...new Set(output.match(/--[a-z][a-z0-9-]+/g) || [])]
  if (!version || !flags.includes('--serial')) throw new Error('Could not read scrcpy capabilities. Check the scrcpy installation in Components.')
  return { version, flags }
}

export function screenArguments(options: ScreenLaunch, capabilities: ScreenCapabilities, sdk: number, recording?: string) {
  validateScreenLaunch(options)
  const args: string[] = [], notes: string[] = [], o = options
  const inputError = o.mode !== 'camera' && screenInputError(o, capabilities)
  if (inputError) throw new Error(inputError)
  if (o.application && !o.control) throw new Error('Opening an app on a virtual display requires Control the phone. Enable it for this launch.')
  const has = (flag: string) => capabilities.flags.includes(`--${flag}`)
  const add = (flag: string, value?: string | number) => {
    if (!has(flag)) throw new Error(`scrcpy ${capabilities.version} does not support ${flag}. Update scrcpy in Components or change this setting.`)
    args.push(`--${flag}${value === undefined ? '' : `=${value}`}`)
  }
  if (o.mode === 'camera') {
    if (sdk < 31) throw new Error('Camera capture requires Android 12 or newer.')
    const cameraError = cameraControlsError(o, capabilities, o.record)
    if (cameraError) throw new Error(cameraError)
    add('video-source', 'camera')
    if (o.cameraId) add('camera-id', o.cameraId); else add('camera-facing', o.cameraFacing)
    if (o.cameraSize) add('camera-size', o.cameraSize)
    if (o.cameraFps !== 30) add('camera-fps', o.cameraFps)
    if (o.cameraHighSpeed) add('camera-high-speed')
    if (o.cameraZoom !== 1) add('camera-zoom', o.cameraZoom)
    if (o.cameraTorch) add('camera-torch')
    if (o.cameraPreviewRotation) add('display-orientation', o.cameraPreviewRotation)
    const recordRotation = o.cameraRecordRotation === 'preview' ? o.cameraPreviewRotation : o.cameraRecordRotation
    if (o.record && recordRotation) add('record-orientation', recordRotation)
  } else if (o.mode === 'virtual') {
    add('new-display', o.virtualSize || o.virtualDpi ? `${o.virtualSize}${o.virtualDpi ? `/${o.virtualDpi}` : ''}` : undefined)
    if (o.flexDisplay && o.control) add('flex-display')
    if (o.control) {
      if (has('display-ime-policy')) add('display-ime-policy', o.displayImePolicy)
      else if (o.displayImePolicy === 'local') throw new Error('This scrcpy version cannot place the keyboard in a virtual window. Update scrcpy in Components or choose On the phone for On-screen keyboard.')
    }
    if (o.application) add('start-app', o.application.packageName)
  }
  if (o.maxSize && !(o.mode === 'camera' && o.cameraSize)) add('max-size', o.maxSize)
  if (o.maxFps && o.mode !== 'camera') add('max-fps', o.maxFps)
  if (o.bitRate !== 8) add(has('video-bit-rate') ? 'video-bit-rate' : 'bit-rate', `${o.bitRate}M`)
  if (o.codec !== 'h264') add('video-codec', o.codec)
  if (o.fullscreen) add('fullscreen')
  if (o.alwaysOnTop) add('always-on-top')
  if (o.mode !== 'camera') {
    if (!o.control) add('no-control')
    else {
      if (o.screenOff && o.mode === 'display') add('turn-screen-off')
      if (o.stayAwake) add('stay-awake')
      if (o.keyboard === 'uhid') add('keyboard', 'uhid')
      if (o.mouse === 'uhid') add('mouse', 'uhid')
      if (o.gamepad) add('gamepad', 'uhid')
      // Window controls use Android paste for Unicode. Do not echo every typed
      // character back into the PC clipboard; Ctrl+C/V are handled explicitly.
      if (!o.clipboard || o.mode === 'virtual' && supportsTouchControls(o)) add('no-clipboard-autosync')
    }
  }
  if (o.audio === 'off' || sdk < 30) {
    if (has('no-audio')) add('no-audio')
    if (o.audio !== 'off') notes.push('Audio is unavailable before Android 11; starting video only.')
  } else if (!has('no-audio')) {
    if (o.audio !== 'device') throw new Error('This scrcpy version has no audio support. Update it in Components.')
    notes.push('This scrcpy version has no audio support; starting video only.')
  } else {
    if (o.audio === 'duplicate') {
      if (sdk < 33) throw new Error('Playing sound on both phone and computer requires Android 13 or newer.')
      add('audio-dup')
    } else if (o.audio === 'mic') add('audio-source', 'mic')
    // Camera mode otherwise defaults to microphone: explicitly honor the selected source.
    else if (o.mode === 'camera') add('audio-source', 'output')
    if (sdk === 30) notes.push('Unlock the phone before starting audio on Android 11.')
  }
  if (o.record) {
    if (!recording) throw new Error('Choose a recording destination first.')
    add('record', recording)
  }
  if (o.timeLimit) add('time-limit', o.timeLimit)
  return { args, notes }
}
