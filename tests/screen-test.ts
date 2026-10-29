import { test as browserTest, _electron as electron } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Use the desktop engine for screen controls when the system browser cannot run.
export const test = process.env.ADB_VAULT_TEST_ELECTRON === '1' ? browserTest.extend({
  page: async ({ viewport }, use, testInfo) => {
    const root = testInfo.outputPath('electron')
    await mkdir(root, { recursive: true })
    const main = path.join(root, 'main.cjs')
    await writeFile(main, `const {app,BrowserWindow}=require('electron'); app.whenReady().then(()=>{const w=new BrowserWindow({width:${viewport?.width || 1440},height:${viewport?.height || 940},show:false,webPreferences:{contextIsolation:false,nodeIntegration:false,backgroundThrottling:false}});w.loadURL('about:blank');});`)
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)); delete env.ELECTRON_RUN_AS_NODE
    const app = await electron.launch({ args: [main, `--user-data-dir=${path.join(root, 'profile')}`], env, timeout: 30000 })
    try { await use(await app.firstWindow()) } finally { await app.close() }
  },
}) : browserTest
