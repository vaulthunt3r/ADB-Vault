import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ConnectionService } from '../dist-electron/connections.js'
import { AdbDiagnosticsService } from '../dist-electron/adb-diagnostics.js'
const config = JSON.parse(await readFile(path.join(process.env.APPDATA, 'adb-vault', 'backend.json'), 'utf8'))
const executable = path.join(config.paths.adb, 'adb.exe')
const diagnostics = new AdbDiagnosticsService(() => executable, () => {})
await diagnostics.refresh()
const connection = new ConnectionService({ data: { known: [] }, save: async () => {} }, () => executable, () => {})
await connection.scan()
for (const device of connection.state.devices.filter(d => d.status === 'connected')) await connection.inspect(device.id)
const report = { checkedAt: new Date().toISOString(), diagnostics: diagnostics.state, devices: connection.state.devices.map(d => ({ name: d.name, method: d.method, status: d.status, android: d.android, info: d.info })) }
await mkdir('desktop-test-results/diagnostics', { recursive: true })
await writeFile('desktop-test-results/diagnostics/report.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ diagnosticsIssues: report.diagnostics.issues, services: report.diagnostics.services.length, devices: report.devices.map(d => ({ name: d.name, method: d.method, status: d.info?.status, fields: Object.keys(d.info?.fields || {}) })) }, null, 2))
