import { parentPort, workerData } from 'node:worker_threads'
import { analyzeInventory, parseScan } from './apk-analysis.js'
try { parentPort!.postMessage({ data: analyzeInventory(parseScan(workerData.output, workerData.packageName, workerData.userId), workerData.database) }) }
catch (error) { parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
