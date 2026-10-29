// Progress is advisory. parseAppsOutput still validates the entire response before accepting a list.
export class AppsProgressReader {
  private buffer = ''
  private total: number | null = null
  private packages = new Set<string>()
  constructor(private userId: number, private version: string, private report: (completed: number, total: number) => void) {}
  push(chunk: string) {
    this.buffer += chunk
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1)
      if (!line) continue
      if (line.length > 200_000) throw new Error('Apps record exceeds its size limit.')
      const record = JSON.parse(line)
      if (this.total === null) {
        if (record.type !== 'header' || record.protocolVersion !== 1 || record.helperVersion !== this.version || record.userId !== this.userId || !Number.isInteger(record.total) || record.total < 0 || record.total > 10000) throw new Error('Invalid Apps progress header.')
        this.total = record.total; this.report(0, record.total)
      } else if (record.type === 'app') {
        if (record.userId !== this.userId || typeof record.packageName !== 'string' || !/^[\w]+(?:\.[\w]+)*$/.test(record.packageName) || this.packages.has(record.packageName) || this.packages.size >= this.total) throw new Error('Invalid Apps progress record.')
        this.packages.add(record.packageName); this.report(this.packages.size, this.total)
      }
    }
    if (this.buffer.length > 200_000) throw new Error('Apps record exceeds its size limit.')
  }
}
