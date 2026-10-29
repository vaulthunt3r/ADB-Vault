// A bounded reader for the root manifest attributes in Android's binary XML format.
// Format reference: AOSP androidfw/ResourceTypes.h. No resources or code are executed.
export function readApkIdentity(data: Buffer) {
  const invalid = () => { throw new Error('Invalid or unsupported APK manifest.') }
  if (data.length < 8 || data.length > 8_000_000 || data.readUInt16LE(0) !== 3 || data.readUInt16LE(2) !== 8 || data.readUInt32LE(4) !== data.length) invalid()
  let strings: string[] | undefined
  for (let offset = 8; offset < data.length;) {
    if (offset + 8 > data.length) invalid()
    const type = data.readUInt16LE(offset), header = data.readUInt16LE(offset + 2), size = data.readUInt32LE(offset + 4), end = offset + size
    if (header < 8 || size < header || end > data.length) invalid()
    if (type === 1) {
      if (strings || header < 28) invalid()
      const count = data.readUInt32LE(offset + 8), styles = data.readUInt32LE(offset + 12), utf8 = !!(data.readUInt32LE(offset + 16) & 256), start = data.readUInt32LE(offset + 20)
      const styleStart = data.readUInt32LE(offset + 24), stringEnd = styleStart ? offset + styleStart : end
      if (count > 100000 || start < header + (count + styles) * 4 || start > size || stringEnd > end || stringEnd < offset + start) invalid()
      strings = []
      for (let i = 0; i < count; i++) {
        let pos = offset + start + data.readUInt32LE(offset + header + i * 4)
        const length = () => {
          if (pos + (utf8 ? 1 : 2) > stringEnd) return invalid()
          let n = utf8 ? data[pos++] : data.readUInt16LE(pos); if (!utf8) pos += 2
          const flag = utf8 ? 128 : 32768
          if (n & flag) { if (pos + (utf8 ? 1 : 2) > stringEnd) return invalid(); const low = utf8 ? data[pos++] : data.readUInt16LE(pos); if (!utf8) pos += 2; n = (n & (flag - 1)) * (utf8 ? 256 : 65536) + low }
          return n
        }
        let n = length(); if (utf8) n = length(); else n *= 2
        if (n > 1000000 || pos + n + (utf8 ? 1 : 2) > stringEnd || (utf8 ? data[pos + n] : data.readUInt16LE(pos + n)) !== 0) invalid()
        strings.push(data.subarray(pos, pos + n).toString(utf8 ? 'utf8' : 'utf16le'))
      }
    }
    if (type === 0x102) {
      if (!strings || header !== 16 || size < 36) invalid()
      const str = (index: number) => { if (index >= strings!.length) return invalid(); return strings![index] }
      if (str(data.readUInt32LE(offset + 20)) !== 'manifest') invalid()
      const attrStart = data.readUInt16LE(offset + 24), attrSize = data.readUInt16LE(offset + 26), count = data.readUInt16LE(offset + 28)
      if (attrStart < 20 || attrSize !== 20 || 16 + attrStart + count * attrSize > size) invalid()
      const attrs = new Map<string, string | number>()
      for (let i = 0; i < count; i++) {
        const p = offset + 16 + attrStart + i * attrSize, ns = data.readUInt32LE(p), name = str(data.readUInt32LE(p + 4)), raw = data.readUInt32LE(p + 8), kind = data[p + 15], value = data.readUInt32LE(p + 16)
        const namespace = ns === 0xffffffff ? '' : str(ns)
        const key = `${namespace}:${name}`
        if (attrs.has(key)) invalid()
        if (kind === 3) attrs.set(key, str(value))
        else if (kind === 0x10 || kind === 0x11) attrs.set(key, value)
        else if (raw !== 0xffffffff) attrs.set(key, str(raw))
      }
      const android = 'http://schemas.android.com/apk/res/android:'
      const packageName = attrs.get(':package'), split = attrs.get(':split') ?? '', low = attrs.get(android + 'versionCode'), high = attrs.get(android + 'versionCodeMajor') ?? 0
      if (typeof packageName !== 'string' || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(packageName) || packageName.length > 255 || typeof split !== 'string' || typeof low !== 'number' || typeof high !== 'number') invalid()
      const versionCode = Number(high) * 4294967296 + Number(low)
      if (!Number.isSafeInteger(versionCode)) invalid()
      return { packageName: packageName as string, split: split as string, versionCode }
    }
    offset = end
  }
  return invalid()
}
