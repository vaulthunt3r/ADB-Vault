// Only the definition table supplies class matches; referenced framework classes do not.
export function inspectDex(data: Buffer, onString: (value: string) => void): string[] {
  const fail = (): never => { throw new Error('Invalid or unsupported DEX file.') }
  if (data.length < 112 || !/^dex\n0(?:35|37|38|39|40)\0$/.test(data.subarray(0, 8).toString('latin1')) || data.readUInt32LE(32) !== data.length || data.readUInt32LE(36) !== 112 || data.readUInt32LE(40) !== 0x12345678) fail()
  const table = (at: number, stride: number, limit: number) => {
    const count = data.readUInt32LE(at), start = data.readUInt32LE(at + 4)
    if (count > limit || start + count * stride > data.length || count && start < 112) fail()
    return { count, start }
  }
  const strings = table(56, 4, 2_000_000), types = table(64, 4, 65536), classes = table(96, 32, 250000)
  let total = 0
  const values: string[] = []
  for (let i = 0; i < strings.count; i++) {
    let p = data.readUInt32LE(strings.start + i * 4), ended = false
    if (p < 112) fail()
    for (let n = 0; n < 5; n++) { if (p >= data.length) fail(); if (!(data[p++] & 128)) { ended = true; break } }
    if (!ended) fail()
    const end = data.indexOf(0, p)
    if (end < 0 || end - p > 1_000_000) fail()
    total += end - p; if (total > 96_000_000) throw new Error('DEX string budget exceeded.')
    const value = data.subarray(p, end).toString('utf8')
    values.push(value); if (value.length <= 8192) onString(value)
  }
  const result: string[] = []
  for (let i = 0; i < classes.count; i++) {
    const type = data.readUInt32LE(classes.start + i * 32)
    if (type >= types.count) fail()
    const string = data.readUInt32LE(types.start + type * 4)
    if (string >= values.length) fail()
    const value = values[string]
    if (!/^L[^;]+;$/.test(value) || value.length > 4096) fail()
    result.push(value.slice(1, -1).replaceAll('/', '.'))
  }
  return result
}
