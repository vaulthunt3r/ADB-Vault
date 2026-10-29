import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MonitorService, parseMemory, parseProcesses, parseCpu, parseBattery, parseNetwork } from '../dist-electron/monitor.js'

test('memory distinguishes available, free, cache and unsupported fields', () => {
  const m = parseMemory('MemTotal: 8000 kB\nMemAvailable: 3000 kB\nMemFree: 500 kB\nCached: 2000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB')
  assert.equal(m.total, 8192000); assert.equal(m.available, 3072000); assert.equal(m.free, 512000)
  assert.equal(parseMemory('Permission denied').total, null)
  assert.equal(parseMemory('MemTotal: 100 kB\nMemFree: 10 kB').available, null)
  assert.equal(parseMemory('MemTotal: 100 kB\nMemAvailable: 101 kB').available, null)
})
test('process output uses explicit columns and does not convert missing readings into zero', () => {
  assert.deepEqual(parseProcesses('PID RSS NAME\n 12 2048 com.example\n 13 - system_server'), [
    { pid: 12, name: 'com.example', rss: 2097152, cpu: null }, { pid: 13, name: 'system_server', rss: null, cpu: null },
  ])
  assert.deepEqual(parseProcesses('ps: invalid option'), [])
  const c = parseCpu('CPU usage from 3000ms to 1000ms ago:\n 2.5% 12/com.example: 1% user\n 10% TOTAL: 6% user + 4% kernel')
  assert.equal(c.total, 10); assert.equal(c.processes.get(12).cpu, 2.5)
  assert.equal(parseCpu('Permission denial').total, null)
})
test('battery scales charge and units without guessing missing current', () => {
  const b = parseBattery(' level: 40\n scale: 80\n temperature: 315\n voltage: 4200\n status: 2\n USB powered: true\n health: 2', '-1200000')
  assert.equal(b.level, 50); assert.equal(b.temperature, 31.5); assert.equal(b.voltage, 4.2); assert.equal(b.current, -1200); assert.deepEqual(b.power, ['USB'])
  assert.equal(parseBattery('', 'Permission denied').level, null); assert.equal(parseBattery('', '').current, null)
})
test('network counters are separate interfaces with safe byte counts', () => {
  const fields = '1024 1 0 0 0 0 0 0 2048 1 0 0 0 0 0 0'
  assert.deepEqual(parseNetwork(`Inter-| Receive | Transmit\n wlan0: ${fields}\n tun0: ${fields}`).map(i => i.name), ['wlan0', 'tun0'])
  assert.deepEqual(parseNetwork('Permission denied'), [])
})
const connection = () => ({ activeDeviceId: 'phone', devices: [{ id: 'phone', serial: 'serial', transportId: '7', status: 'connected' }] })
test('collector only reads chosen view, pins transport, and preserves partial results', async () => {
  const calls = [], state = connection()
  const service = new MonitorService(() => 'adb.exe', () => state, async (_file, args) => {
    calls.push(args); if (args.at(-1).includes('current_now')) return { code: 1, stdout: '', stderr: 'Permission denied' }
    return { code: 0, stdout: 'level: 50\nscale: 100', stderr: '' }
  })
  const s = await service.read('phone', 'battery')
  assert.equal(s.battery.level, 50); assert.equal(s.battery.current, null); assert.equal(s.issues.length, 1)
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].slice(0, 3), ['-t', '7', 'shell'])
  assert.ok(calls.every(c => !c.join(' ').includes('su ')))
})
test('collector rejects changed context, disconnected devices, and overlapping reads', async () => {
  const state = connection(); let release
  const gate = new Promise(resolve => { release = resolve })
  const service = new MonitorService(() => 'adb', () => state, async () => { await gate; return { code: 0, stdout: '', stderr: '' } })
  const first = service.read('phone', 'memory')
  await assert.rejects(service.read('phone', 'network'), /still being collected/)
  state.devices[0].transportId = '8'; release()
  await assert.rejects(first, /changed/)
  state.devices[0].status = 'offline'
  await assert.rejects(service.read('phone', 'battery'), /connected device/)
})
test('unavailable process report cannot appear as an empty successful measurement', async () => {
  const service = new MonitorService(() => 'adb', connection, async () => ({ code: 0, stdout: 'Permission Denial', stderr: '' }))
  const s = await service.read('phone', 'processes')
  assert.equal(s.cpu.total, null); assert.deepEqual(s.processes, []); assert.equal(s.issues.length, 2)
})
