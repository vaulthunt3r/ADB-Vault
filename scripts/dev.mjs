import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import electron from 'electron'
await import('./check-helper.mjs')

const compiler = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.electron.json'], { stdio: 'inherit' })
const code = await new Promise(resolve => compiler.on('exit', resolve))
if (code !== 0) process.exit(code ?? 1)
await import('./preload.mjs')
const server = await createServer()
await server.listen()
server.printUrls()
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true })
const close = async () => { child.kill(); await server.close() }
child.on('exit', async code => { await server.close(); process.exit(code ?? 0) })
child.on('error', async error => { console.error(error); await close(); process.exit(1) })
process.on('SIGINT', close)
process.on('SIGTERM', close)
