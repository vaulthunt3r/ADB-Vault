import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCameraList, parseCameraModes, selectCamera, cameraLogReader } from '../dist-electron/camera-info.js'

test('camera modes keep normal and high-speed declarations scoped to each lens', () => {
  const cameras = parseCameraModes(`scrcpy 5.0.1
[server] INFO: List of cameras:
    --camera-id=0 (back, 4000x3000, fps={15, 30, 60}, zoom-range=[0,5, 10])
        - 1920x1080
        - 1280x720
        - 1920x1080
      High speed capture (--camera-high-speed):
        - 1920x1080 (fps={120})
        - 1280x720 (fps={120, 240})
    --camera-id=1 (front, 2000x1500, fps={30})
        - 640x480
    --camera-id=usb (external, 1280x720)
        (none)`)
  assert.deepEqual(cameras[0], { id: '0', facing: 'back', zoom: { min: .5, max: 10 }, fps: [15, 30, 60], sizes: ['1920x1080', '1280x720'], highSpeedModes: [{ size: '1920x1080', fps: [120] }, { size: '1280x720', fps: [120, 240] }] })
  assert.deepEqual(cameras[1], { id: '1', facing: 'front', fps: [30], sizes: ['640x480'], highSpeedModes: [] })
  assert.deepEqual(cameras[2], { id: 'usb', facing: 'external', fps: [], sizes: [], highSpeedModes: [] })
})

test('camera mode parser accepts old lists and filters unusable declarations without inventing support', () => {
  const [camera] = parseCameraModes('List of cameras:\n --camera-id=0 (back, 4000x3000, fps={0, -1, 30, 30, 9000, bad})\n - 32x32\n - 9999x9999\n - 640x480\n High speed capture (--camera-high-speed):\n - 1280x720 (fps={120, 240})\n - 1280x720 (fps={240, 960})')
  assert.deepEqual(camera.sizes, ['640x480']); assert.deepEqual(camera.fps, [30])
  assert.deepEqual(camera.highSpeedModes, [{ size: '1280x720', fps: [120, 240, 960] }])
  assert.deepEqual(parseCameraModes('List of cameras:\n (none)'), [])
  assert.throws(() => parseCameraModes('List of cameras:\n (access denied)'), /Could not read/)
  assert.throws(() => parseCameraModes('unrecognized output'), /Could not read/)
})
import { cameraPanelBounds } from '../dist-electron/camera-docking.js'

test('camera catalog handles optional metadata, decimal commas, missing cameras and denied enumeration', () => {
  const cameras = parseCameraList('[server] INFO: List of cameras:\n --camera-id=0 (back, 4000x3000, fps={15, 30}, zoom-range=[0,5, 10])\n --camera-id=usb.1 (external, 640x480)\n --camera-id=1 (front, 2000x1500, zoom-range=[1, 4])')
  assert.deepEqual(cameras, [{ id: '0', facing: 'back', zoom: { min: .5, max: 10 } }, { id: 'usb.1', facing: 'external' }, { id: '1', facing: 'front', zoom: { min: 1, max: 4 } }])
  assert.equal(selectCamera(cameras, '1', 'back').id, '1')
  assert.equal(selectCamera(cameras, '', 'external').id, 'usb.1')
  assert.throws(() => selectCamera(cameras.slice(0, 1), '', 'external'), /External camera not detected/)
  assert.deepEqual(parseCameraList('List of cameras:\n (none)'), [])
  for (const output of ['Device disconnected', 'List of cameras:\n (access denied)', 'List of cameras:\n unsupported format']) assert.throws(() => parseCameraList(output))
})

test('scrcpy feedback tolerates split chunks, ANSI and multiple lines without inventing readings', () => {
  const lines = [], read = cameraLogReader(line => lines.push(line))
  read('\x1b[32m[server] INFO: Set camera zo'); read('om: 1.18\x1b[0m\r\nTexture: 640x480\npartial')
  assert.deepEqual(lines, ['[server] INFO: Set camera zoom: 1.18', 'Texture: 640x480'])
})

test('docking uses available side and keeps controls on-screen with negative monitor coordinates', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1080 }, panel = { x: 0, y: 0, width: 460, height: 680 }
  assert.deepEqual(cameraPanelBounds({ x: 100, y: 100, width: 700, height: 900 }, panel, work), { x: 808, y: 100, width: 460, height: 680 })
  assert.equal(cameraPanelBounds({ x: 1100, y: 500, width: 800, height: 500 }, panel, work).x, 632)
  assert.deepEqual(cameraPanelBounds(work, panel, work), { x: 1460, y: 0, width: 460, height: 680 })
  const small = { x: -600, y: -300, width: 600, height: 500 }
  assert.deepEqual(cameraPanelBounds(small, panel, small), { x: -460, y: -300, width: 460, height: 500 })
})
