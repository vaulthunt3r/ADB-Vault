import { readFile, mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
const runtime = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8'))
const output = 'android-helper/build/tests'
await mkdir(output, { recursive: true })
async function run(file, args) {
  const child = spawn(file, args, { windowsHide: true, stdio: 'inherit' })
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Badge collector tests exited ${code}`))) })
}
await run(runtime.javac, ['-encoding', 'UTF-8', '-d', output, 'scripts/BadgeCollectorsTest.java'])
await run(runtime.java, ['-cp', [output, 'android-helper/build/classes', runtime.android].join(path.delimiter), 'BadgeCollectorsTest'])
