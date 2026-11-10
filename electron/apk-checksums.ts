import { validateAppTarget } from './app-details-protocol.js'
import { preparePackageHelper, type PackageCommand } from './package-actions.js'

interface ApkChecksum { source: string; sha256: string; bytes: number }
export function parseApkChecksums(output: string, packageName: string, userId: number, paths: string[]): Map<string, ApkChecksum> {
  const records = output.split(/\r?\n/).filter(line => line.startsWith('{'))
  if (records.length !== 1 || records[0].length > 2_000_000) throw new Error('Incomplete APK checksum response.')
  const value = JSON.parse(records[0])
  if (value?.type === 'error') throw new Error(`Android helper: ${String(value.message).slice(0, 500)}`)
  if (value?.type !== 'apk-checksums' || value.protocolVersion !== 1 || value.packageName !== packageName || value.userId !== userId || !Array.isArray(value.files) || value.files.length !== paths.length) throw new Error('APK checksum response does not match the selected application/profile.')
  const files = new Map<string, ApkChecksum>()
  for (const file of value.files) {
    if (!file || !paths.includes(file.source) || files.has(file.source) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error('Invalid APK checksum or changed APK set.')
    files.set(file.source, file)
  }
  return files
}

export async function collectApkChecksums(directory: string, command: PackageCommand, packageName: string, userId: number, paths: string[]) {
  validateAppTarget(packageName, userId)
  const remote = await preparePackageHelper({ directory }, command)
  // Only a package/profile is accepted; the helper resolves its APK paths through PackageManager.
  const output = await command(['shell', `CLASSPATH=${remote} app_process / dev.adbvault.helper.Main --checksums ${packageName} ${userId}`], 130000)
  return parseApkChecksums(output, packageName, userId, paths)
}
