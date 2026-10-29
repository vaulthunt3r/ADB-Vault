// Reuse the checksum-verified project-local SDK/JDK from helper:setup.
import { access, cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
const paths = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8'))
const sdk = path.dirname(path.dirname(paths.d8)), jdk = path.dirname(path.dirname(paths.java))
const destination = path.resolve('inspector-tools')
await mkdir(destination, { recursive: true })
const run = (file, args) => new Promise((resolve, reject) => { const child = spawn(file, args, { windowsHide: true, stdio: 'inherit' }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Tool exited ${code}`))) })
try { await access(path.join(destination, 'runtime', 'bin', 'java.exe')) }
catch { await run(path.join(jdk, 'bin', 'jlink.exe'), ['--module-path', path.join(jdk, 'jmods'), '--add-modules', 'java.base,java.logging,java.xml,jdk.crypto.ec,jdk.zipfs', '--strip-debug', '--no-header-files', '--no-man-pages', '--compress=2', '--output', path.join(destination, 'runtime')]) }
await cp(path.join(sdk, 'lib', 'apksigner.jar'), path.join(destination, 'apksigner.jar'))
await cp(path.join(sdk, 'aapt2.exe'), path.join(destination, 'aapt2.exe'))
await cp(path.join(sdk, 'NOTICE.txt'), path.join(destination, 'ANDROID-NOTICE.txt'))
await cp(path.join(jdk, 'NOTICE'), path.join(destination, 'JAVA-NOTICE.txt'))
await cp(path.join(jdk, 'release'), path.join(destination, 'JAVA-release.txt'))
const files = {}
async function inventory(dir) { for (const e of await readdir(dir, { withFileTypes: true })) { const file = path.join(dir, e.name); if (e.isDirectory()) await inventory(file); else if (e.name !== 'manifest.json') { const bytes = await readFile(file); files[path.relative(destination, file).replaceAll('\\', '/')] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } } }
await inventory(destination)
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ sdk: 'Android Build Tools 35.0.0', java: 'Eclipse Temurin 17 (see JAVA-release.txt)', modules: 'java.base,java.logging,java.xml,jdk.crypto.ec,jdk.zipfs', sources: ['https://dl.google.com/android/repository/build-tools_r35_windows.zip', 'https://adoptium.net/temurin/releases/?version=17'], files }, null, 2))
console.log(`Inspector tools ready: ${Object.values(files).reduce((n, f) => n + f.bytes, 0)} bytes; runtime includes module licence notices.`)
