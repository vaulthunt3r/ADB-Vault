import assert from 'node:assert/strict'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { extractFile } from '@electron/asar'
import { verifyApk, apkLabel } from '../dist-electron/apk-inspector-tools.js'
const releaseName = process.argv[2] || 'apk-inspector-20261021'
assert.match(releaseName, /^[a-z0-9-]+$/)
const root = path.resolve('release', releaseName, 'win-unpacked'), archive = path.join(root, 'resources/app.asar')
const digest = value => createHash('sha256').update(value).digest('hex'), checked = []
for (const name of (await readdir('dist-electron')).filter(n => /\.(?:js|cjs)$/.test(n))) {
  const file = path.join('dist-electron', name)
  assert.equal(digest(extractFile(archive, path.normalize(file))), digest(await readFile(file)), file); checked.push(file)
}
for (const file of ['dist/index.html', ...(await readdir('dist/assets')).filter(name => /\.(js|css)$/.test(name)).map(name => 'dist/assets/' + name)]) {
  assert.equal(digest(extractFile(archive, path.normalize(file))), digest(await readFile(file)), file); checked.push(file)
}
for (const name of ['manager-server.jar', 'helper-manifest.json']) {
  assert.equal(digest(await readFile(path.join(root, 'resources/android-helper', name))), digest(await readFile(path.join('android-helper/dist', name))), name); checked.push('resources/android-helper/' + name)
}
const tools = path.join(root, 'resources/inspector-tools'), manifest = JSON.parse(await readFile('inspector-tools/manifest.json', 'utf8'))
for (const [file, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(path.join(tools, file)); assert.equal(bytes.length, expected.bytes, file); assert.equal(digest(bytes), expected.sha256, file); checked.push('resources/inspector-tools/' + file)
}
const fixtures = JSON.parse(await readFile('desktop-test-results/apk-inspector-fixtures/latest.json', 'utf8')), signal = new AbortController().signal
const signature = await verifyApk(fixtures.before, tools, signal), label = await apkLabel(fixtures.before, tools, signal)
assert.equal(signature.status, 'verified', signature.diagnostics); assert.equal(label.label, 'Inspector Fixture 1')
const executable = path.join(root, 'ADB Vault.exe')
const report = { verified: true, executable, bytes: (await stat(executable)).size, sha256: digest(await readFile(executable)), packagedToolsExecuted: true, checked }
await writeFile(`desktop-test-results/${releaseName}-verification.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, checked: checked.length }, null, 2))
