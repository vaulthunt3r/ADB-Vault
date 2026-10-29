import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  const manifest = JSON.parse(await readFile('android-helper/dist/helper-manifest.json', 'utf8'))
  const sources = ['android-helper/src/dev/adbvault/helper/Main.java', 'android-helper/src/dev/adbvault/helper/ApkAddresses.java', 'android-helper/src/dev/adbvault/helper/ApkSize.java', 'android-helper/src/dev/adbvault/helper/PackageActions.java', 'android-helper/src/dev/adbvault/helper/PhoneTools.java', 'android-helper/src/dev/adbvault/helper/PhoneClipboard.java', 'android-helper/src/dev/adbvault/helper/PhoneContext.java']
  sources.push('android-helper/src/dev/adbvault/helper/PhoneContentResolver.java', 'android-helper/stubs/android/content/IContentProvider.java')
  sources.push('android-helper/src/dev/adbvault/helper/TouchServer.java')
  if (manifest.protocolVersion !== 1 || manifest.helperVersion !== '0.1.0' || manifest.sha256 !== hash(await readFile('android-helper/dist/manager-server.jar')) || manifest.sourceSha256 !== hash(Buffer.concat(await Promise.all(sources.map(source => readFile(source)))))) throw new Error('Helper source or artifact has changed.')
} catch (error) { throw new Error(`Android helper is missing or stale. Run npm run helper:setup then npm run helper:build. ${error.message}`) }
