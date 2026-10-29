import { createHash } from 'node:crypto'
import { open, mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { powershell } from './process.js'

const hosts = new Set(['dl.google.com', 'api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'aka.ms', 'download.visualstudio.microsoft.com', 'download.microsoft.com'])
export async function officialResponse(url: string, signal: AbortSignal) {
  for (let hop = 0; hop < 6; hop++) {
    const target = new URL(url)
    if (target.protocol !== 'https:' || !hosts.has(target.hostname) || target.username || target.password) throw new Error('Unsupported download source.')
    const response = await fetch(target, { signal, redirect: 'manual', headers: { 'User-Agent': 'ADB-Vault/0.1' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location'); await response.body?.cancel()
      if (!next) throw new Error('Download redirect has no destination.')
      url = new URL(next, target).href; continue
    }
    if (!response.ok) throw new Error(`Download server returned HTTP ${response.status}.`)
    return response
  }
  throw new Error('Too many download redirects.')
}
export async function officialText(url: string) {
  const response = await officialResponse(url, AbortSignal.timeout(20000))
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Empty server response.')
  let bytes = 0; const chunks: Uint8Array[] = []
  for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 20_000_000) { await reader.cancel(); throw new Error('Metadata is too large.') }; chunks.push(value) }
  return Buffer.concat(chunks).toString('utf8')
}
export async function download(url: string, destination: string, expected: { size?: number; digest?: string; algorithm?: string }, progress: (n: number) => void) {
  const response = await officialResponse(url, AbortSignal.timeout(300000))
  const total = expected.size || Number(response.headers.get('content-length')) || 0
  if (total > 500_000_000) throw new Error('Package exceeds the download size limit.')
  await mkdir(path.dirname(destination), { recursive: true })
  const handle = await open(destination, 'wx')
  const hash = createHash(expected.algorithm === 'sha1' ? 'sha1' : 'sha256')
  let received = 0
  try {
    if (!response.body) throw new Error('The server returned no download body.')
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length; if (received > 500_000_000) throw new Error('Download exceeds the size limit.')
      hash.update(chunk); await handle.writeFile(chunk); progress(total ? Math.min(99, Math.round(received / total * 100)) : 0)
    }
    if (expected.size && received !== expected.size) throw new Error('Incomplete download: package size does not match the publisher metadata.')
    if (expected.digest && hash.digest('hex').toLowerCase() !== expected.digest.toLowerCase()) throw new Error('Package checksum does not match the publisher metadata.')
  } catch (error) { await handle.close(); await rm(destination, { force: true }); throw error }
  await handle.close(); progress(100)
}
export async function extractZip(zip: string, destination: string) {
  await mkdir(destination, { recursive: true })
  await powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath($env:ADB_VAULT_EXTRACT)+[IO.Path]::DirectorySeparatorChar
$archive=[IO.Compression.ZipFile]::OpenRead($env:ADB_VAULT_ARCHIVE)
try {
  $total=0L
  foreach($entry in $archive.Entries) {
    $target=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$entry.FullName))
    if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':')) { throw 'Unsafe path in package' }
    $total+=$entry.Length
    if($total -gt 1500000000) { throw 'Expanded package exceeds size limit' }
  }
} finally { $archive.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory($env:ADB_VAULT_ARCHIVE,$env:ADB_VAULT_EXTRACT)`, { ADB_VAULT_ARCHIVE: zip, ADB_VAULT_EXTRACT: destination }, 60000)
}
export async function validateMicrosoftInstaller(file: string) {
  const result = await powershell(`$s=Get-AuthenticodeSignature -LiteralPath $env:ADB_VAULT_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'Microsoft installer signature validation failed' }; 'verified'`, { ADB_VAULT_INSTALLER: file })
  return result === 'verified'
}
export async function packageVersion(folder: string) { try { return (await readFile(path.join(folder, 'source.properties'), 'utf8')).match(/Pkg\.Revision\s*=\s*([\d.]+)/)?.[1] } catch { return undefined } }
