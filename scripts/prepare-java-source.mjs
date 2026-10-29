// Publish the matching complete upstream source alongside the binary releases.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
const name = 'OpenJDK17U-jdk-sources_17.0.20.1_1.tar.gz'
const url = `https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/${name}`
const root = path.resolve(process.argv[2] || '.tools/publication')
await fs.mkdir(root, { recursive: true })
async function download(url) {
  console.log(`Downloading ${new URL(url).pathname.split('/').at(-1)}…`)
  const response = await fetch(url, { signal: AbortSignal.timeout(900000) })
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`)
  const chunks = []; let received = 0; let milestone = 32 * 1024 * 1024
  for await (const chunk of response.body) {
    chunks.push(chunk); received += chunk.length
    if (received >= milestone) { console.log(`Received ${Math.round(received / 1048576)} MiB`); milestone += 32 * 1024 * 1024 }
  }
  return Buffer.concat(chunks)
}
const expected = (await download(url + '.sha256.txt')).toString().trim().split(/\s+/)[0]
if (!/^[a-f0-9]{64}$/i.test(expected)) throw new Error('Invalid upstream SHA-256 file')
if (expected !== '21e2a065d244ab048e737f21af5d1fc74daaeb6707de36477ead8db1dca71214') throw new Error('Upstream source differs from the reviewed release')
let bytes = await fs.readFile(path.join(root, name)).catch(() => null)
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
  // Cache bounded ranges so a slow/interrupted download does not restart at zero.
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) })
  if (!head.ok) throw new Error(`Source metadata: HTTP ${head.status}`)
  const size = Number(head.headers.get('content-length'))
  if (!Number.isSafeInteger(size) || size < 1 || size > 512 * 1024 * 1024) throw new Error('Unexpected Java source size')
  const chunkSize = 8 * 1024 * 1024, chunks = Math.ceil(size / chunkSize)
  console.log(`Complete source: ${Math.ceil(size / 1048576)} MiB in ${chunks} resumable ranges`)
  const parts = Array.from({ length: chunks }, (_, i) => path.join(root, `${name}.part-${i}`))
  let next = 0
  async function worker() {
    for (;;) {
      const index = next++; if (index >= chunks) return
      const start = index * chunkSize, end = Math.min(size, start + chunkSize) - 1
      if ((await fs.stat(parts[index]).catch(() => null))?.size === end - start + 1) continue
      const response = await fetch(head.url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(300000) })
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}`) throw new Error('Server did not honor source range')
      await pipeline(response.body, createWriteStream(parts[index]))
      if ((await fs.stat(parts[index])).size !== end - start + 1) throw new Error('Truncated source range')
      console.log(`Source range ${index + 1}/${chunks} saved`)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  const combined = path.join(root, name + '.assembling')
  const output = await fs.open(combined, 'w')
  try { for (const part of parts) for await (const chunk of createReadStream(part)) await output.write(chunk) } finally { await output.close() }
  bytes = await fs.readFile(combined)
}
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Java source checksum mismatch')
await fs.writeFile(path.join(root, name), bytes)
await fs.writeFile(path.join(root, 'java-source.json'), JSON.stringify({ name, url, sha256: expected, bytes: bytes.length, version: '17.0.20.1+1' }, null, 2) + '\n')
console.log(`Verified complete Java sources: ${name} (${bytes.length} bytes)`)
