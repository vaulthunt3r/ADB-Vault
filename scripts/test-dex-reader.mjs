import { readFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
const tools = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8'))
const output = 'android-helper/build/tests'; await mkdir(output, { recursive: true })
async function run(file, args) {
  const child = spawn(file, args, { windowsHide: true, stdio: 'inherit' })
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`DEX tests exited ${code}`))) })
}
await run(tools.javac, ['-encoding', 'UTF-8', '-cp', 'android-helper/build/classes', '-d', output, 'scripts/DexReaderTest.java', 'scripts/ApkAddressesTest.java', 'scripts/ApkSizeTest.java'])
await run(tools.java, ['-cp', [output, 'android-helper/build/classes', tools.android].join(path.delimiter), 'DexReaderTest'])
await run(tools.java, ['-cp', [output, 'android-helper/build/classes'].join(path.delimiter), 'ApkAddressesTest'])
await run(tools.java, ['-cp', [output, 'android-helper/build/classes'].join(path.delimiter), 'ApkSizeTest'])
