import { databaseIds, type DatabaseId } from './database-protocol.js'
import type { ComponentRecord } from './contracts.js'
export function installationTargets(records: ComponentRecord[]) {
  return [...new Set(records.filter(c => !['Installed', 'Detected', 'Manual action required'].includes(c.status)).map(c => c.id === 'fastboot' ? 'adb' as const : c.id))]
}
export const componentCatalog: ComponentRecord[] = [
  { id: 'adb', name: 'Android Debug Bridge', subtitle: 'Device communication · Platform Tools', description: 'Connect and communicate with Android devices. ADB and Fastboot are supplied together in the official Google Platform Tools package.', publisher: 'Google', group: 'Core components', sourceUrl: 'https://developer.android.com/tools/releases/platform-tools' },
  { id: 'fastboot', name: 'Fastboot', subtitle: 'Bootloader tool · Platform Tools', description: 'Included with Platform Tools. Connection can find USB Fastboot devices, read their information and restart them into Android or supported boot modes. Flashing and bootloader unlocking are not included.', publisher: 'Google', group: 'Core components', sourceUrl: 'https://developer.android.com/tools/releases/platform-tools' },
  { id: 'driver', name: 'Google USB Driver', subtitle: 'Google devices only · OEM drivers may differ', description: 'Google USB driver package. Other manufacturers may require their own driver. Downloading an INF is not the same as installing it in Windows.', publisher: 'Google', group: 'Optional components', sourceUrl: 'https://developer.android.com/studio/run/win-usb' },
  { id: 'runtime', name: 'Visual C++ Runtime', subtitle: 'Microsoft x64 runtime · if required by tools', description: 'Detects the installed Visual C++ v14 x64 runtime. Installation uses the signed Microsoft redistributable and may request Windows administrator approval.', publisher: 'Microsoft', group: 'Optional components', sourceUrl: 'https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist' },
  { id: 'scrcpy', name: 'scrcpy', subtitle: 'Screen, audio and recording', description: 'Detects or downloads the official Windows x64 scrcpy release. Use Connection → Actions → Screen & recording for mirroring, virtual displays and camera capture. Defaults are in Settings → Screen & audio.', publisher: 'Genymobile', group: 'Optional components', sourceUrl: 'https://github.com/Genymobile/scrcpy' },
].map(item => ({ ...item, version: '—', targetVersion: '—', size: '—', status: 'Not detected', location: null, progress: 0 })) as ComponentRecord[]

const names = ['Tracker signatures', 'Library signatures', 'Native library signatures', 'Bloatware database']
const databaseSourcePaths: Record<DatabaseId, string> = {
  'db-trackers': 'app/src/main/res/values/trackers.xml',
  'db-libraries': 'app/src/main/res/values/libs.xml',
  'db-native': 'app/src/main/res/values/native_libs.xml',
  'db-bloatware': 'app/src/main/assets/debloat.json',
}
export function databaseSourceUrl(id: DatabaseId, revision = 'master') {
  return `https://github.com/MuntashirAkon/AppManager/blob/${encodeURIComponent(revision)}/${databaseSourcePaths[id]}`
}
const descriptions = ['Manifest components and DEX classes. Includes Exodus and ETIP signatures curated by App Manager; ² denotes ETIP-only entries.', 'Java/Kotlin library classes and categories from App Manager.', 'Native .so file signatures, including tracker classification, from App Manager.', 'Package classifications, warnings, dependencies and alternatives from Android Debloat List. This is information, not an instruction to remove a package.']
export const databaseCatalog: ComponentRecord[] = databaseIds.map((id, i) => ({ id, name: names[i], subtitle: 'Local analysis · App Manager datasets', description: descriptions[i], publisher: 'App Manager / dataset contributors', group: 'Detection databases', version: '—', targetVersion: '—', size: '—', status: 'Checking', location: null, progress: 0, sourceUrl: databaseSourceUrl(id) }))
