import { officialText } from '../dist-electron/downloads.js'
import { platformPackage } from '../dist-electron/components.js'
const pkg = platformPackage(await officialText('https://dl.google.com/android/repository/repository2-3.xml'))
const release = JSON.parse(await officialText('https://api.github.com/repos/Genymobile/scrcpy/releases/latest'))
const archive = release.assets.find(a => /^scrcpy-win64-v[\d.]+\.zip$/.test(a.name))
console.log(JSON.stringify({ platformTools: pkg, scrcpy: { version: release.tag_name, url: archive?.browser_download_url, digest: archive?.digest, size: archive?.size } }, null, 2))
if (!archive?.digest) process.exitCode = 1
