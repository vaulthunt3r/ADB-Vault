import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { sourceFiles } from './source-files.mjs'

export async function checkSource(root = process.cwd(), comparisonProfile) {
  root = path.resolve(root)
  const files = await sourceFiles(root)
  const selected = new Set(files)
  const identities = new Set()
  function add(value) {
    if (typeof value !== 'string' || value.length < 6) return
    identities.add(value.toLowerCase())
    identities.add(value.replaceAll('\\', '/').toLowerCase())
    identities.add(value.replaceAll('\\', '\\\\').toLowerCase())
  }
  add(root); add(process.env.USERPROFILE); add(process.env.USERNAME)
  let compared = 0
  if (comparisonProfile) {
    const profile = JSON.parse(await fs.readFile(comparisonProfile, 'utf8'))
    for (const device of profile.known || []) for (const value of [device.serial, device.hardwareId, device.endpoint, ...(device.aliases || [])]) {
      if (typeof value === 'string' && value.length >= 6) { add(value); compared++ }
    }
  }
  const inventory = []
  const failures = []
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true })
  if (tracked.status === 0) for (const file of tracked.stdout.split('\0').filter(Boolean)) {
    if (!selected.has(file)) failures.push(`${file}: tracked file is outside the publication allowlist`)
  }
  const privateName = /(^|\/)(?:\.env(?:\..*)?|adbkey(?:\.pub)?|backend\.json|app-notes\.json|Cookies|Login Data|Local Storage|Session Storage|touch-profiles)(?:\/|$)|\.(?:pfx|p12|pem)$/i
  const secret = /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|\bgh[pousr]_[a-zA-Z0-9]{25,}\b|\bgithub_pat_[a-zA-Z0-9_]{35,}\b|\bAKIA[A-Z0-9]{16}\b/
  for (const file of files) {
    const bytes = await fs.readFile(path.join(root, file))
    if (privateName.test(file) || bytes.length >= 90 * 1024 * 1024) failures.push(`${file}: forbidden name or oversized source file`)
    const text = bytes.toString('utf8')
    const lower = text.toLowerCase(), wide = bytes.toString('utf16le').toLowerCase()
    if ([...identities].some(value => lower.includes(value) || wide.includes(value))) failures.push(`${file}: local identity match (value withheld)`)
    if (secret.test(text)) failures.push(`${file}: possible secret (value withheld)`)
    // Preserve upstream source snapshots; their links refer to the upstream repo.
    if (file.endsWith('.md') && !file.startsWith('electron/data/app-manager/')) for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const link = match[1]
      if (/^(https?:|mailto:|#)/i.test(link)) continue
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(link.split('#')[0])))
      if (!selected.has(target)) failures.push(`${file}: link outside published source: ${target}`)
    }
    inventory.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  if (failures.length) throw new Error('Source publication check failed:\n' + failures.join('\n'))
  console.log(JSON.stringify({ result: 'PASS', sourceFiles: files.length, bytes: inventory.reduce((n, f) => n + f.bytes, 0), knownIdentifiersCompared: compared, identityMatches: 0, secretPatternMatches: 0, brokenLocalLinks: 0 }))
  return inventory
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkSource(process.cwd(), process.argv[2])
