// Read-only smoke check for explicitly named local APK samples; no ADB commands.
import { ApkInspectorService } from '../dist-electron/apk-inspector.js'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
const inputs = process.argv.slice(2)
if (!inputs.length) throw new Error('Pass one or more APK file paths.')
await mkdir('desktop-test-results', { recursive: true })
const root = await mkdtemp(path.resolve('desktop-test-results/local-apk-check-')), results = []
const service = new ApkInspectorService(root, () => undefined, () => {})
try {
  for (const input of inputs) {
    service.open('before', path.resolve(input))
    while (service.busy) await new Promise(resolve => setTimeout(resolve, 50))
    const state = service.state.before
    if (state.status !== 'ready') throw new Error(state.message)
    const a = state.result
    results.push({ name: a.name, packageName: a.manifest.packageName, label: a.label, bytes: a.bytes, signature: a.signature.status, schemes: a.signature.schemes, permissions: a.manifest.permissions.length, components: a.manifest.components.length, classes: a.analysis?.classes, analysis: a.analysis?.status, entries: a.entries.length, issues: a.issues })
    service.clear('before')
  }
  await writeFile(path.join(root, 'result.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ root, results }, null, 2))
} finally { await service.shutdown() }
