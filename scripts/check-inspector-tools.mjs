import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const root = path.resolve('inspector-tools'), manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
const toolchain = JSON.parse(await readFile('build/toolchain.json', 'utf8'))
const javaRelease = await readFile(path.join(root, 'JAVA-release.txt'), 'utf8')
if (!javaRelease.includes(`JAVA_RUNTIME_VERSION="${toolchain.javaVersion}"`)) throw new Error('Java runtime does not match the pinned toolchain and corresponding source notice.')
for (const required of ['aapt2.exe', 'apksigner.jar', 'runtime/bin/java.exe', 'ANDROID-NOTICE.txt', 'JAVA-NOTICE.txt']) if (!manifest.files[required]) throw new Error(`Missing APK inspector tool: ${required}. Run npm run inspector:setup.`)
for (const [file, expected] of Object.entries(manifest.files)) {
  if (!/^[a-zA-Z0-9._/-]+$/.test(file) || file.split('/').some(p => !p || p === '..')) throw new Error('Invalid inspector tool manifest path.')
  const data = await readFile(path.join(root, file))
  if (data.length !== expected.bytes || createHash('sha256').update(data).digest('hex') !== expected.sha256) throw new Error(`APK inspector tool integrity mismatch: ${file}`)
}
console.log('APK inspector runtime and Android tools verified.')
