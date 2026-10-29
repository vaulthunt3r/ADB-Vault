import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Exercise the real main-window close hook with isolated preferences and fake ADB.
// No real server, device or existing application instance is touched.
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/shutdown-'))
const harness = path.join(root, 'main.mjs')
await writeFile(harness, `
import { appendFileSync } from 'node:fs';
import { Backend } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/backend.js')).href)};
import { run } from ${JSON.stringify(pathToFileURL(path.resolve('dist-electron/process.js')).href)};
Backend.prototype.initialize = async function () {
  this.storage.data.stopAdbOnExit = process.env.EXIT_TEST_STOP === 'true';
  this.lifecycle.execute = async (file, args, timeout, input, env, options) => {
    if (args[0] === 'kill-server') {
      appendFileSync(process.env.EXIT_TEST_LOG, 'kill-server\\n');
      await new Promise(resolve => setTimeout(resolve, 100));
      appendFileSync(process.env.EXIT_TEST_LOG, 'server-stopped\\n');
      return { code: 0, stdout: '', stderr: '' };
    }
    try {
      const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
      return await run(process.execPath, ['-e', 'console.log(process.pid);setInterval(()=>{},1000)'], 20000, undefined, childEnv, {
        ...options, onStdout: chunk => appendFileSync(process.env.EXIT_TEST_LOG, 'client-pid:' + chunk.trim() + '\\n')
      });
    } finally { appendFileSync(process.env.EXIT_TEST_LOG, 'client-ended\\n'); }
  };
  void this.lifecycle.runner('adb.exe', ['devices']).catch(() => {});
};
await import(${JSON.stringify(pathToFileURL(path.resolve('dist-electron/main.js')).href)});
`)

for (const stop of [true, false]) {
  const log = path.join(root, `events-${stop}.txt`)
  const profile = path.join(root, `profile-${stop}`)
  await writeFile(log, '')
  const env = { ...process.env, ADB_VAULT_SMOKE_TEST: '1', EXIT_TEST_STOP: String(stop), EXIT_TEST_LOG: log }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  let desktop
  try {
    desktop = await electron.launch({ args: [harness, `--user-data-dir=${profile}`], env })
    const page = await desktop.firstWindow()
    await page.waitForFunction(() => !!window.desktop)
    for (let i = 0; i < 100 && !(await readFile(log, 'utf8')).includes('client-pid:'); i++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.match(await readFile(log, 'utf8'), /client-pid:\d+/)
    const closed = desktop.waitForEvent('close', { timeout: 12000 })
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await closed
    desktop = null
    const events = await readFile(log, 'utf8')
    assert.match(events, /client-ended/)
    if (stop) assert.match(events, /client-ended\r?\nkill-server\r?\nserver-stopped/)
    else assert.doesNotMatch(events, /kill-server|server-stopped/)
    const pid = Number(events.match(/client-pid:(\d+)/)[1])
    assert.throws(() => process.kill(pid, 0))
    console.log(`PASS: window close cancels the client and ${stop ? 'awaits server shutdown' : 'preserves the server'}.`)
  } finally { if (desktop) await desktop.close() }
}
