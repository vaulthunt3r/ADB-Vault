import { open } from 'node:fs/promises'
import type { AndroidApp } from './apps-protocol.js'
import type { BackupPart } from './app-backup-protocol.js'
import { validateAppTarget } from './app-details-protocol.js'

export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
export type DataPart = Exclude<BackupPart, 'apk'>
export type DeviceShell = (command: string, root?: boolean, file?: string) => Promise<string>

// Windows adb shell can translate LF bytes even with -T. exec-out is binary-safe,
// but lacks shell-v2 exit status, so require a unique terminal status frame.
export function archiveStreamCommand(command: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid archive stream token.')
  return `${command}; __adb_vault_status=$?; printf '\\nADB_VAULT_EXPORT_${token}:%s\\n' "$__adb_vault_status"`
}
export async function finalizeArchiveStream(file: string, token: string) {
  const handle = await open(file, 'r+')
  try {
    const { size } = await handle.stat(), tail = Buffer.alloc(Math.min(size, 128))
    await handle.read(tail, 0, tail.length, size - tail.length)
    const match = new RegExp(`\\nADB_VAULT_EXPORT_${token}:(\\d{1,3})\\n$`).exec(tail.toString('latin1'))
    if (!match) throw new Error('Archive stream ended without a completion status. No complete copy was saved.')
    if (match[1] !== '0') throw new Error(`Android archive command failed (exit ${match[1]}). No complete copy was saved.`)
    await handle.truncate(size - Buffer.byteLength(match[0], 'latin1'))
  } finally { await handle.close() }
}

export async function checkDataTarget(app: AndroidApp, shell: DeviceShell) {
  validateAppTarget(app.packageName, app.userId)
  if (!Number.isSafeInteger(app.uid) || app.uid % 100000 < 10000) throw new Error('Data operations on core Android UIDs are not supported yet.')
  const list = await shell(`pm list packages -U --user ${app.userId}`)
  const rows = list.trim().split(/\r?\n/).map(line => /^package:([\w.]+) uid:(\d+)$/.exec(line.trim()))
  if (!rows.length || rows.some(row => !row)) throw new Error('Cannot verify package UID ownership.')
  const own = rows.find(row => row![1] === app.packageName)
  if (!own || Number(own[2]) !== app.uid || Math.floor(app.uid / 100000) !== app.userId) throw new Error('Package UID changed. Refresh Apps before retrying.')
  if (rows.filter(row => Number(row![2]) === app.uid).length !== 1) throw new Error('Shared-UID applications are not supported for data operations yet.')
}

export function dataRoots(app: AndroidApp, part: DataPart) {
  validateAppTarget(app.packageName, app.userId)
  const { packageName: pkg, userId: user } = app
  const bases = [`/data/user/${user}/${pkg}`, `/data/user_de/${user}/${pkg}`, `/storage/emulated/${user}/Android/data/${pkg}`]
  return part === 'data' ? bases : part === 'cache' ? bases.flatMap(base => [`${base}/cache`, `${base}/code_cache`]) : [`/storage/emulated/${user}/Android/${part}/${pkg}`]
}

export interface DataPlan { part: DataPart; roots: string[]; absent: string[]; root: boolean; selinux: string[] }
export async function planData(app: AndroidApp, part: DataPart, root: boolean, shell: DeviceShell): Promise<DataPlan> {
  if ((part === 'data' || part === 'cache') && !root) throw new Error('Internal data and cache require root enabled in Settings > Apps.')
  if (part === 'data' || part === 'cache') {
    if ((await shell(`am get-started-user-state ${app.userId}`, root)).trim() !== 'RUNNING_UNLOCKED') throw new Error('Unlock the selected Android profile before copying private data.')
  }
  const roots: string[] = [], absent: string[] = [], selinux: string[] = []
  for (const directory of dataRoots(app, part)) {
    const base = directory.startsWith('/storage/') ? `/storage/emulated/${app.userId}` : directory.startsWith('/data/user_de/') ? `/data/user_de/${app.userId}` : `/data/user/${app.userId}`
    // Check access to the parent hierarchy so permission denial cannot look like an absent directory.
    const parents = directory.slice(base.length + 1).split('/').slice(0, -1)
    let script = `test -r ${shellQuote(base)} && test -x ${shellQuote(base)} || exit 41; `
    let parent = base
    for (const piece of parents) { parent += '/' + piece; script += `if test -e ${shellQuote(parent)}; then test -d ${shellQuote(parent)} && test -r ${shellQuote(parent)} && test -x ${shellQuote(parent)} || exit 42; fi; ` }
    script += `if test -L ${shellQuote(directory)}; then exit 43; elif test ! -e ${shellQuote(directory)}; then echo ABSENT; else test -d ${shellQuote(directory)} && test -r ${shellQuote(directory)} && test -x ${shellQuote(directory)} || exit 44; readlink -f ${shellQuote(directory)}; fi`
    const resolved = (await shell(script, root)).trim()
    if (resolved === 'ABSENT') { absent.push(directory); continue }
    const ceAlias = app.userId === 0 ? directory.replace('/data/user/0/', '/data/data/') : directory
    if (resolved !== directory && resolved !== ceAlias) throw new Error('Unexpected data directory or symlink. No files were copied or removed.')
    roots.push(resolved)
    selinux.push((await shell(`ls -Zd ${shellQuote(resolved)}`, root)).trim())
  }
  // CE data must exist for a meaningful data backup; optional DE/external/cache roots may be absent.
  if (part === 'data' && absent.includes(dataRoots(app, part)[0])) throw new Error('Internal app data directory is unavailable.')
  return { part, roots, absent, root, selinux }
}

export async function captureData(plan: DataPlan, file: string, shell: DeviceShell) {
  if (!plan.roots.length) return false
  const excluded = plan.part === 'data' ? plan.roots.flatMap(dir => ['cache', 'code_cache'].map(name => `--exclude=${shellQuote(dir.slice(1) + '/' + name)}`)).join(' ') : ''
  // No -h: symlinks are stored, never traversed. Relative members preserve original Android paths.
  await shell(`tar -c -f - ${excluded} -C / ${plan.roots.map(dir => shellQuote(dir.slice(1))).join(' ')}`, plan.root, file)
  await validateTar(file)
  return true
}

// Validate framing/checksums without extracting files or loading large archives in memory.
export async function validateTar(file: string) {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    if (size < 1024 || size % 512) throw new Error('Incomplete data archive.')
    const header = Buffer.alloc(512); let offset = 0, zero = 0, entries = 0
    while (offset < size) {
      if ((await handle.read(header, 0, 512, offset)).bytesRead !== 512) throw new Error('Incomplete archive header.')
      offset += 512
      if (header.every(byte => byte === 0)) { zero++; continue }
      if (zero) throw new Error('Unexpected data after archive end.')
      const octal = (start: number, end: number) => {
        const text = header.subarray(start, end).toString('ascii').replace(/\0/g, '').trim()
        if (!/^[0-7]+$/.test(text)) throw new Error('Unsupported archive number.')
        return Number.parseInt(text, 8)
      }
      const expected = octal(148, 156)
      const sum = header.reduce((n, b, i) => n + (i >= 148 && i < 156 ? 32 : b), 0)
      if (sum !== expected) throw new Error('Data archive header checksum failed.')
      let bytes: number
      if (header[124] & 128) {
        let value = BigInt(header[124] & 127)
        for (const byte of header.subarray(125, 136)) value = (value << 8n) + BigInt(byte)
        bytes = Number(value)
      } else bytes = octal(124, 136)
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Unsupported archive entry size.')
      offset += Math.ceil(bytes / 512) * 512; entries++
    }
    if (offset !== size || zero < 2 || !entries) throw new Error('Truncated or empty data archive.')
  } finally { await handle.close() }
}

export async function clearExternal(plan: DataPlan, shell: DeviceShell) {
  if (plan.part !== 'obb' && plan.part !== 'media') throw new Error('Invalid external cleanup target.')
  for (const root of plan.roots) {
    // Recheck the exact canonical directory in the same shell immediately before deletion.
    await shell(`test ! -L ${shellQuote(root)} && test "$(readlink -f ${shellQuote(root)})" = ${shellQuote(root)} && test -d ${shellQuote(root)} || exit 45; find ${shellQuote(root)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`, plan.root)
  }
}
