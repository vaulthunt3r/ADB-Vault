import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import yazl from 'yazl'
import { openRestoreZip } from '../../dist-electron/restore-zip.js'

export async function createApkFixtures() {
  await mkdir('desktop-test-results/apk-inspector-fixtures', { recursive: true })
  const root = await mkdtemp(path.resolve('desktop-test-results/apk-inspector-fixtures/run-'))
  const tools = JSON.parse(await readFile('.tools/helper/paths.json', 'utf8')), sdk = path.dirname(path.dirname(tools.d8))
  const run = (file, args) => new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b)
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(file)} (${code}): ${output}`)))
  })
  const key = path.join(root, 'test-only.p12'), rotatedKey = path.join(root, 'rotated-test-only.p12')
  for (const keystore of [key, rotatedKey]) await run(path.join(path.dirname(tools.java), 'keytool.exe'), ['-genkeypair', '-keystore', keystore, '-storepass', 'test-password', '-keypass', 'test-password', '-alias', 'test-only', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=ADB Vault Test Fixture'])
  const sign = (file, output, keystore = key) => run(tools.java, ['-jar', path.join(sdk, 'lib/apksigner.jar'), 'sign', '--ks', keystore, '--ks-pass', 'pass:test-password', '--key-pass', 'pass:test-password', '--v4-signing-enabled', 'false', '--out', output, file])
  const files = { root }
  for (const [index, version] of ['before', 'after'].entries()) {
    const folder = path.join(root, version); await mkdir(folder)
    const assets = path.join(folder, 'assets'); await mkdir(assets)
    await writeFile(path.join(assets, 'endpoint.json'), JSON.stringify({ url: index ? 'https://new.example.org/api' : 'https://old.example.org/api' }))
    const manifest = path.join(folder, 'AndroidManifest.xml')
    await writeFile(manifest, `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="dev.adbvault.inspectorfixture" android:versionCode="${index + 1}" android:versionName="${index + 1}.0"><uses-sdk android:minSdkVersion="23" android:targetSdkVersion="${index ? 35 : 33}"/><uses-permission android:name="android.permission.INTERNET"/>${index ? '<uses-permission android:name="android.permission.CAMERA"/>' : '<uses-permission android:name="android.permission.READ_CONTACTS" android:maxSdkVersion="32"/>'}<application android:label="Inspector Fixture ${index + 1}" android:debuggable="${!index}"><activity android:name=".MainActivity" android:exported="${!index}"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>${index ? '<service android:name=".NewService" android:exported="false"/>' : ''}</application></manifest>`)
    const linked = path.join(folder, 'linked.apk')
    await run(path.join(sdk, 'aapt2.exe'), ['link', '--manifest', manifest, '-I', tools.android, '-A', assets, '-o', linked])
    const java = path.join(folder, 'FirebaseAnalytics.java'), classes = path.join(folder, 'classes'), dex = path.join(folder, 'dex'); await mkdir(classes); await mkdir(dex)
    await writeFile(java, `package com.google.firebase.analytics; public class FirebaseAnalytics { public String endpoint() { return "https://fixture.example.com/api/${index}"; } }`)
    await run(tools.javac, ['--release', '8', '-d', classes, java])
    await run(tools.java, ['-cp', tools.d8, 'com.android.tools.r8.D8', '--min-api', '23', '--output', dex, path.join(classes, 'com/google/firebase/analytics/FirebaseAnalytics.class')])
    const zip = new yazl.ZipFile(), source = await openRestoreZip(linked, undefined, 'apk')
    for (const name of source.names) zip.addBuffer(await source.buffer(name, 8_000_000), name)
    source.close()
    zip.addBuffer(await readFile(path.join(dex, 'classes.dex')), 'classes.dex')
    zip.addBuffer(Buffer.from('fixture native library, never executed'), `lib/${index ? 'arm64-v8a' : 'armeabi-v7a'}/libfixture.so`)
    for (let i = 0; i < 125; i++) zip.addBuffer(Buffer.from(`fixture ${i} ${index}`), `assets/pagination/item-${i}.txt`)
    const unsigned = path.join(folder, 'unsigned.apk'); zip.end(); await pipeline(zip.outputStream, createWriteStream(unsigned))
    const signed = path.join(root, `${version} fixture.apk`); await sign(unsigned, signed); files[version] = signed
    if (!index) files.unsigned = unsigned
    else { files.rotated = path.join(root, 'rotated.apk'); await sign(unsigned, files.rotated, rotatedKey) }
  }
  const source = await openRestoreZip(files.before, undefined, 'apk'), zip = new yazl.ZipFile()
  for (const name of source.names) zip.addBuffer(name === 'assets/endpoint.json' ? Buffer.from('{"url":"https://tampered.example.org/"}') : await source.buffer(name, 8_000_000), name)
  source.close(); zip.end(); files.tampered = path.join(root, 'tampered.apk'); await pipeline(zip.outputStream, createWriteStream(files.tampered))
  files.malformed = path.join(root, 'broken.apk'); await writeFile(files.malformed, 'This is not an APK file.')
  await writeFile(path.resolve('desktop-test-results/apk-inspector-fixtures/latest.json'), JSON.stringify(files, null, 2))
  return files
}
