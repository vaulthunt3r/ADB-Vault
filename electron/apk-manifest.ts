import type { InspectedManifest, ManifestNode } from './apk-inspector-protocol.js'
const android = 'http://schemas.android.com/apk/res/android'
// Bounded Android binary XML reader. Attribute namespaces are kept distinct.
export function readManifestTree(data: Buffer): ManifestNode {
  const invalid = (): never => { throw new Error('Invalid or unsupported binary APK manifest.') }
  if (data.length < 8 || data.length > 8_000_000 || data.readUInt16LE(0) !== 3 || data.readUInt16LE(2) !== 8 || data.readUInt32LE(4) !== data.length) invalid()
  let strings: string[] | undefined, root: ManifestNode | undefined
  const stack: ManifestNode[] = []
  const str = (i: number): string => strings && i < strings.length ? strings[i] : invalid()
  for (let p = 8; p < data.length;) {
    if (p + 8 > data.length) invalid()
    const type = data.readUInt16LE(p), header = data.readUInt16LE(p + 2), size = data.readUInt32LE(p + 4), end = p + size
    if (header < 8 || size < header || end > data.length) invalid()
    if (type === 1) {
      if (strings || header < 28) invalid()
      const count = data.readUInt32LE(p + 8), styles = data.readUInt32LE(p + 12), utf8 = !!(data.readUInt32LE(p + 16) & 256), start = data.readUInt32LE(p + 20), styleStart = data.readUInt32LE(p + 24), stringEnd = styleStart ? p + styleStart : end
      if (count > 100000 || start < header + (count + styles) * 4 || start > size || stringEnd > end || stringEnd < p + start) invalid()
      strings = []
      for (let i = 0; i < count; i++) {
        let at = p + start + data.readUInt32LE(p + header + i * 4)
        const length = () => {
          if (at + (utf8 ? 1 : 2) > stringEnd) invalid()
          let n = utf8 ? data[at++] : data.readUInt16LE(at); if (!utf8) at += 2
          const flag = utf8 ? 128 : 32768
          if (n & flag) { if (at + (utf8 ? 1 : 2) > stringEnd) invalid(); const low = utf8 ? data[at++] : data.readUInt16LE(at); if (!utf8) at += 2; n = (n & (flag - 1)) * (utf8 ? 256 : 65536) + low }
          return n
        }
        let n = length(); if (utf8) n = length(); else n *= 2
        if (n > 1000000 || at + n + (utf8 ? 1 : 2) > stringEnd || (utf8 ? data[at + n] : data.readUInt16LE(at + n)) !== 0) invalid()
        strings.push(data.subarray(at, at + n).toString(utf8 ? 'utf8' : 'utf16le'))
      }
    } else if (type === 0x102) {
      if (header !== 16 || size < 36 || stack.length > 64) invalid()
      const node: ManifestNode = { name: str(data.readUInt32LE(p + 20)), attributes: Object.create(null), children: [] }
      const start = data.readUInt16LE(p + 24), stride = data.readUInt16LE(p + 26), count = data.readUInt16LE(p + 28)
      if (start < 20 || stride !== 20 || 16 + start + count * stride > size) invalid()
      for (let i = 0; i < count; i++) {
        const at = p + 16 + start + i * stride, ns = data.readUInt32LE(at), name = str(data.readUInt32LE(at + 4)), raw = data.readUInt32LE(at + 8), kind = data[at + 15], v = data.readUInt32LE(at + 16)
        const namespace = ns === 0xffffffff ? '' : str(ns), key = namespace === android ? 'android:' + name : namespace ? `{${namespace}}${name}` : name
        if (Object.hasOwn(node.attributes, key)) invalid()
        node.attributes[key] = kind === 3 ? str(v) : kind === 0x12 ? String(v !== 0) : kind === 0x10 || kind === 0x11 ? String(v) : kind === 1 ? '@0x' + v.toString(16) : raw !== 0xffffffff ? str(raw) : `type${kind}:0x${v.toString(16)}`
      }
      if (stack.length) stack.at(-1)!.children.push(node); else { if (root) invalid(); root = node }
      stack.push(node)
    } else if (type === 0x103) {
      if (header !== 16 || size < 24 || stack.pop()?.name !== str(data.readUInt32LE(p + 20))) invalid()
    }
    p = end
  }
  if (!root || root.name !== 'manifest' || stack.length) invalid()
  return root!
}
export function inspectManifest(data: Buffer): InspectedManifest {
  const root = readManifestTree(data), a = root.attributes, app = root.children.find(n => n.name === 'application'), sdk = root.children.find(n => n.name === 'uses-sdk')?.attributes ?? {}
  const packageName = a.package
  if (!packageName || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(packageName)) throw new Error('APK manifest has no valid package name.')
  const name = (s: string) => s.startsWith('.') ? packageName + s : s.includes('.') || !s ? s : packageName + '.' + s
  const canonical = (n: ManifestNode): string => JSON.stringify({ name: n.name, attributes: Object.fromEntries(Object.entries(n.attributes).sort()), children: n.children.map(canonical).sort() })
  return { packageName, versionName: a['android:versionName'] ?? '', versionCode: a['android:versionCode'] ? String(BigInt(a['android:versionCodeMajor'] ?? 0) * 4294967296n + BigInt(a['android:versionCode'])) : '', split: a.split ?? '', minSdk: sdk['android:minSdkVersion'] ?? '1', targetSdk: sdk['android:targetSdkVersion'] ?? sdk['android:minSdkVersion'] ?? '1', application: app?.attributes ?? {},
    permissions: root.children.filter(n => /^uses-permission(?:-sdk-?\d+)?$/.test(n.name)).map(n => ({ name: `${n.attributes['android:name'] ?? '(unnamed)'}${n.name !== 'uses-permission' ? ` (${n.name})` : ''}`, attributes: n.attributes })),
    features: root.children.filter(n => ['uses-feature', 'uses-library', 'uses-configuration'].includes(n.name)).concat(app?.children.filter(n => n.name === 'uses-library') ?? []).map(canonical).sort(),
    components: (app?.children ?? []).filter(n => ['activity', 'activity-alias', 'service', 'receiver', 'provider'].includes(n.name)).map(n => ({ kind: n.name, name: name(n.attributes['android:name'] ?? ''), attributes: n.attributes, filters: n.children.filter(c => ['intent-filter', 'meta-data', 'grant-uri-permission', 'path-permission'].includes(c.name)).map(canonical).sort() })),
  }
}
