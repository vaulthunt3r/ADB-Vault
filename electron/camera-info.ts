import type { CameraInfo } from './screen-protocol.js'

// scrcpy's camera listing reads CameraCharacteristics without opening a capture.
export function parseCameraList(output: string): CameraInfo[] {
  if (!output.includes('List of cameras:') || /\(access denied\)/i.test(output)) throw new Error('Could not read the phone’s cameras. The current stream was kept. Check the connection and camera access.')
  const cameras: CameraInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /--camera-id=([a-zA-Z0-9_.:-]{1,64})\s+\((front|back|external|unknown),/.exec(line)
    if (!match) continue
    const camera: CameraInfo = { id: match[1], facing: match[2] as CameraInfo['facing'] }
    const range = /zoom-range=\[([\d.,]+),\s+([\d.,]+)\]/.exec(line)
    if (range) {
      const min = Number(range[1].replace(',', '.')), max = Number(range[2].replace(',', '.'))
      if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) camera.zoom = { min, max }
    }
    if (!cameras.some(c => c.id === camera.id)) cameras.push(camera)
  }
  if (!cameras.length && !/\(none\)/.test(output)) throw new Error('scrcpy returned an unreadable camera list. Update scrcpy in Components.')
  return cameras
}

export function selectCamera(cameras: CameraInfo[], id: string, facing: string) {
  const camera = id ? cameras.find(c => c.id === id) : cameras.find(c => c.facing === facing)
  if (!camera) throw new Error(id ? `Camera ${id} is not reported by this phone. Refresh the camera list.` : `${facing === 'external' ? 'External camera not detected. Connect a compatible camera to the phone' : `No ${facing} camera was reported by this phone`}, then refresh the camera list. The current stream was kept.`)
  return camera
}

// --list-camera-sizes reports normal FPS per camera, and high-speed FPS per
// listed size. Keep these sections separate; declarations are not a capture test.
export function parseCameraModes(output: string): CameraInfo[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
  const cameras = parseCameraList(clean)
  const rates = (line: string) => [...new Set((/fps=\{([^}]*)\}/.exec(line)?.[1] || '').split(',').map(v => Number(v.trim())).filter(v => Number.isInteger(v) && v > 0 && v <= 1000))].sort((a, b) => a - b)
  let current: CameraInfo | undefined, highSpeed = false
  for (const line of clean.split(/\r?\n/)) {
    if (line.includes('--camera-id=')) {
      current = cameras.find(c => c.id === /--camera-id=([a-zA-Z0-9_.:-]{1,64})\s/.exec(line)?.[1])
      highSpeed = false
      if (current) { current.fps = rates(line); current.sizes = []; current.highSpeedModes = [] }
      continue
    }
    if (!current) continue
    if (line.includes('High speed capture')) { highSpeed = true; continue }
    const size = /^\s*- (\d{2,4}x\d{2,4})(?:\s|$)/.exec(line)?.[1]
    if (!size || size.split('x').some(v => Number(v) < 64 || Number(v) > 8192)) continue
    if (highSpeed) {
      const fps = rates(line), previous = current.highSpeedModes!.find(mode => mode.size === size)
      if (previous) previous.fps = [...new Set([...previous.fps, ...fps])].sort((a, b) => a - b)
      else current.highSpeedModes!.push({ size, fps })
    } else if (!current.sizes!.includes(size)) current.sizes!.push(size)
  }
  return cameras
}

// Read complete lines from each stream separately: pipe chunks need not end at a newline.
export function cameraLogReader(onLine: (line: string) => void) {
  let pending = ''
  return (chunk: unknown) => {
    pending += String(chunk)
    let end: number
    while ((end = pending.indexOf('\n')) >= 0) { onLine(pending.slice(0, end).replace(/\x1b\[[0-9;]*m/g, '').trim()); pending = pending.slice(end + 1) }
    pending = pending.slice(-8000)
  }
}
