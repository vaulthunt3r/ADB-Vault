import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
const tools = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8'))
const sources = ['android-helper/src/dev/adbvault/helper/Main.java', 'android-helper/src/dev/adbvault/helper/ApkAddresses.java', 'android-helper/src/dev/adbvault/helper/ApkSize.java', 'android-helper/src/dev/adbvault/helper/PackageActions.java', 'android-helper/src/dev/adbvault/helper/PhoneTools.java', 'android-helper/src/dev/adbvault/helper/PhoneClipboard.java', 'android-helper/src/dev/adbvault/helper/PhoneContext.java']
sources.push('android-helper/src/dev/adbvault/helper/PhoneContentResolver.java', 'android-helper/stubs/android/content/IContentProvider.java')
sources.push('android-helper/src/dev/adbvault/helper/TouchServer.java')
const output = path.resolve('android-helper/dist')
await mkdir(output, { recursive: true }); await mkdir('android-helper/build', { recursive: true })
// Fresh output prevents removed/renamed nested classes from leaking into later builds.
const classes = await mkdtemp(path.resolve('android-helper/build/classes-'))
async function run(file, args) {
  const child = spawn(file, args, { windowsHide: true, stdio: 'inherit' })
  child.on('error', error => { throw error })
  if (await new Promise(resolve => child.on('exit', resolve)) !== 0) throw new Error('Helper compilation failed')
}
await run(tools.javac, ['-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', tools.android, '-d', classes, ...sources])
// Include only our package. Hidden Android signatures are compile-time stubs, never runtime classes.
await run(tools.jar, ['cf', 'android-helper/build/classes.jar', '-C', classes, 'dev'])
await run(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--release', '--min-api', '26', '--lib', tools.android, '--output', path.join(output, 'manager-server.jar'), 'android-helper/build/classes.jar'])
const hash = data => createHash('sha256').update(data).digest('hex')
await writeFile(path.join(output, 'helper-manifest.json'), JSON.stringify({ protocolVersion: 1, helperVersion: '0.1.0', minSdk: 26, sha256: hash(await readFile(path.join(output, 'manager-server.jar'))), sourceSha256: hash(Buffer.concat(await Promise.all(sources.map(source => readFile(source))))) }, null, 2))
console.log('Built Android helper and SHA-256 manifest.')
