// Read-only camera characteristics check. Never starts video/audio capture.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DeviceScreenService } from '../dist-electron/device-screen.js'
import { parseDevices } from '../dist-electron/connections.js'
import { run, checked } from '../dist-electron/process.js'

const saved = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault/backend.json'), 'utf8'))
const executable = (location, name) => /\.exe$/i.test(location) ? location : path.join(location, name)
const adb = executable(saved.paths.adb, 'adb.exe'), scrcpy = executable(saved.paths.scrcpy, 'scrcpy.exe')
const devices = parseDevices(checked(await run(adb, ['devices', '-l'], 10000))).filter(device => device.status === 'connected')
assert.equal(devices.length, 1, 'Connect exactly one phone for this read-only check.')
const device = devices[0]
const service = new DeviceScreenService(() => adb, () => scrcpy, () => ({ devices, busy: false }), () => {}, async () => null)
try {
  const cameras = await service.cameraModes(device)
  assert.ok(cameras.length, 'The phone did not report cameras.')
  assert.ok(cameras.some(camera => camera.sizes?.length), 'The phone did not report capture sizes.')
  assert.equal(service.activeSessionCount, 0)
  const folder = path.resolve('desktop-test-results/camera-modes-20261023')
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, 'phone-modes.json'), JSON.stringify({ scrcpy: await service.capabilities(), cameras }, null, 2))
  console.log(JSON.stringify(cameras.map(camera => ({ id: camera.id, facing: camera.facing, sizes: camera.sizes?.length, fps: camera.fps, highSpeed: camera.highSpeedModes })), null, 2))
} finally { await service.shutdown() }
