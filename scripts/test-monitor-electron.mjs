import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/monitor-'))
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
globalThis.monitorTest = { commands: [] };
Backend.prototype.initialize = async function () {
  this.storage.data.stopAdbOnExit = false;
  this.components.adbPath = () => 'adb.exe';
  this.connection.state = { ...this.connection.state, activeDeviceId: 'test', devices: [{ id: 'test', serial: 'test-serial', transportId: '7', name: 'Test phone', status: 'connected', method: 'USB' }] };
  this.lifecycle.execute = async (_file, args) => {
    globalThis.monitorTest.commands.push(args);
    const output = {
      'ps -A -o PID,RSS,NAME': 'PID RSS NAME\\n123 2048 com.example',
      'dumpsys cpuinfo': 'CPU usage from 3000ms to 1000ms ago:\\n 2% 123/com.example: 2% user\\n 5% TOTAL: 5% user',
      'cat /proc/meminfo': 'MemTotal: 8000 kB\\nMemAvailable: 3000 kB',
      'dumpsys battery': 'level: 80\\nscale: 100\\nstatus: 3',
      'cat /sys/class/power_supply/battery/current_now': '-100000',
      'cat /proc/net/dev': 'wlan0: 1024 1 0 0 0 0 0 0 2048 1 0 0 0 0 0 0',
      'ip -o addr show': '3: wlan0 inet 192.168.1.2/24',
      'cat /proc/uptime': '500.00 900.00'
    };
    if (!(args.at(-1) in output)) throw new Error('Unexpected command');
    return { code: 0, stdout: output[args.at(-1)], stderr: '' };
  };
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)
const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let desktop
try {
  desktop = await electron.launch({ args: [harness, `--user-data-dir=${path.join(root, 'profile')}`], env })
  const page = await desktop.firstWindow()
  await page.waitForFunction(() => !!window.desktop)
  for (const tab of ['processes', 'memory', 'battery', 'network']) {
    const reply = await page.evaluate(tab => window.desktop.request({ type: 'monitor.read', id: 'test', tab }), tab)
    assert.equal(reply.ok, true); assert.equal(reply.monitor.tab, tab); assert.deepEqual(reply.monitor.issues, [])
    if (tab === 'processes') { assert.equal(reply.monitor.cpu.total, 5); assert.equal(reply.monitor.processes[0].cpu, 2) }
    if (tab === 'battery') assert.equal(reply.monitor.battery.level, 80)
  }
  const before = await desktop.evaluate(() => globalThis.monitorTest.commands.length)
  for (const input of [{ type: 'monitor.read', id: 'test', tab: 'battery; rm -rf /' }, { type: 'monitor.read', id: 'wrong', tab: 'memory' }]) {
    const reply = await page.evaluate(input => window.desktop.request(input), input); assert.equal(reply.ok, false)
  }
  assert.equal(await desktop.evaluate(() => globalThis.monitorTest.commands.length), before)
  console.log('Monitor Electron IPC passed: four views, pinned transport, invalid tab/target rejected without commands.')
} finally { await desktop?.close() }
