import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { OperationHistory } from '../dist-electron/operation-history.js'
import { emptyApps } from '../dist-electron/apps-protocol.js'

await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/history-progress-'))
let messages = 0, bytes = 0
const history = new OperationHistory(root, value => { messages++; bytes += Buffer.byteLength(JSON.stringify(value)) })
await history.initialize()
const context = { connection: { devices: [] }, apps: emptyApps() }
for (let i = 0; i < 30; i++) history.capture({ type: 'activity', source: 'system', tone: 'info', text: `Earlier operation ${i}: ` + 'x'.repeat(1000) }, context)
const state = { operationId: 'synthetic-backup', startedAt: new Date().toISOString(), id: 'phone', userId: 0, operation: 'backup', format: 'auto', name: 'System', status: 'running', message: 'Preparing', completed: 0, total: 358, items: Array.from({ length: 358 }, (_, i) => ({ packageName: `org.example.app${i}`, label: `Application ${i}`, status: i ? 'pending' : 'running' })) }
messages = 0; bytes = 0
const start = performance.now()
for (let i = 0; i < 500; i++) history.capture({ type: 'backup', state: { ...state, message: `Copying split ${i}`, currentFile: { completed: i, total: 500 } } }, context)
history.capture({ type: 'backup', state: { ...state, status: 'complete', message: 'Complete', completed: 358, items: state.items.map(i => ({ ...i, status: 'success' })) } }, context)
const captureMs = performance.now() - start
await history.close(true)
const result = { scenario: '500 synthetic progress events; 358 apps; 30 previous entries', messages, bytes, captureMs: Math.round(captureMs), finalStatus: history.snapshot().activity[0].operation.status }
await writeFile(path.join(root, 'measurement.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result)); console.log(root)
