import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { checked, run } from './process.js'
import { validatePoints, type TouchGeometry, type TouchPoint } from './touch-protocol.js'
import type { DeviceScreenService } from './device-screen.js'
import { validateTouchInput, type TouchInput } from './touch-input.js'

export class TouchStream {
  geometry?: TouchGeometry
  private child?: ChildProcessWithoutNullStreams
  private closed = false
  private remote = `/data/local/tmp/adb-vault-touch-${randomUUID()}.jar`
  private controller = new AbortController()
  private selector: string[]
  private target: ReturnType<DeviceScreenService['touchTarget']>
  private checkTimer?: ReturnType<typeof setInterval>
  private startup?: ReturnType<typeof setTimeout>
  private sequence = 0
  private pending = new Map<number, { resolve: (text?: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private directory: string, private targetNow: () => ReturnType<DeviceScreenService['touchTarget']>, private notify: (geometry?: TouchGeometry, error?: string) => void) {
    this.target = targetNow()
    this.selector = this.target.device.transportId ? ['-t', this.target.device.transportId] : ['-s', this.target.device.serial]
  }
  private current() {
    if (this.closed) throw new Error('Touch controls are closed.')
    const next = this.targetNow(), old = this.target
    if (next.adb !== old.adb || next.pid !== old.pid || next.displayId !== old.displayId || next.device.serial !== old.device.serial || next.device.transportId !== old.device.transportId || next.device.hardwareId !== old.device.hardwareId || next.userId !== old.userId) throw new Error('The phone connection or display changed. Reopen touch controls.')
  }
  async start() {
    try {
      const jar = path.join(this.directory, 'manager-server.jar')
      const [manifest, bytes] = await Promise.all([readFile(path.join(this.directory, 'helper-manifest.json'), 'utf8'), readFile(jar)])
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (JSON.parse(manifest).sha256 !== hash) throw new Error('Android helper verification failed.')
      this.current()
      checked(await run(this.target.adb, [...this.selector, 'push', jar, this.remote], 30000, undefined, undefined, { signal: this.controller.signal }))
      this.current()
      const remoteHash = checked(await run(this.target.adb, [...this.selector, 'shell', 'sha256sum', this.remote], 10000)).split(/\s/)[0]
      if (remoteHash !== hash) throw new Error('Android helper upload verification failed.')
      this.current()
      const child = this.child = spawn(this.target.adb, [...this.selector, 'shell', '-T', `CLASSPATH=${this.remote} app_process / dev.adbvault.helper.TouchServer ${this.target.displayId} ${this.target.userId}`], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.setEncoding('utf8'); child.stderr.resume()
      child.stdout.on('data', chunk => {
        if (this.closed) return
        output += chunk
        if (output.length > 131072) { this.fail('Invalid touch helper reply.'); return }
        for (let end; (end = output.indexOf('\n')) >= 0;) {
          const line = output.slice(0, end); output = output.slice(end + 1)
          if (!line.trim().startsWith('{')) continue // app_process may emit a VM banner.
          try {
            const data = JSON.parse(line)
            if (data.type === 'input-result') {
              const pending = this.pending.get(data.id)
              if (!pending) continue
              this.pending.delete(data.id); clearTimeout(pending.timer)
              if (data.ok === true && (data.text === undefined || typeof data.text === 'string' && data.text.length <= 8192)) pending.resolve(data.text)
              else pending.reject(new Error(typeof data.error === 'string' ? data.error.slice(0, 500) : 'Android rejected text input.'))
              continue
            }
            if (data.type === 'error') throw new Error(String(data.message))
            if (data.type !== 'state' || data.displayId !== this.target.displayId || ![data.width, data.height, data.epoch].every(n => Number.isInteger(n) && n > 0) || data.width > 32768 || data.height > 32768 || ![0, 1, 2, 3].includes(data.rotation) || typeof data.uniqueId !== 'string' || data.uniqueId.length > 512 || this.geometry && data.uniqueId !== this.geometry.uniqueId) throw new Error('Invalid virtual display identity.')
            clearTimeout(this.startup); this.geometry = data; this.notify(data)
          } catch (error) { this.fail(String(error)); return }
        }
      })
      child.on('error', error => this.fail(error.message)); child.stdin.on('error', error => this.fail(error.message))
      child.on('exit', () => { if (!this.closed) this.fail('Touch connection ended. Reopen touch controls.') })
      this.startup = setTimeout(() => this.fail('Touch helper did not start. Check the phone connection.'), 15000)
      this.checkTimer = setInterval(() => { try { this.current() } catch (error) { this.fail(String(error)) } }, 250)
    } catch (error) { if (!this.closed) this.fail(String(error)); else void this.cleanRemote() }
  }
  frame(epoch: number, points: TouchPoint[]) {
    if (this.closed || !this.child || !this.geometry || epoch !== this.geometry.epoch) return
    this.current(); validatePoints(points)
    if (this.child.stdin.writableLength > 16384) { this.fail('Touch connection is too slow. Input released.'); return }
    this.child.stdin.write(JSON.stringify({ epoch, points }) + '\n')
  }
  release() { if (this.geometry && !this.closed && this.child?.stdin.writable) this.child.stdin.write(JSON.stringify({ epoch: this.geometry.epoch, points: [] }) + '\n') }
  input(epoch: number, input: TouchInput): Promise<string | undefined> {
    this.current(); validateTouchInput(input)
    if (!this.geometry || epoch !== this.geometry.epoch || !this.child?.stdin.writable) throw new Error('The display changed. Select the text field again.')
    if (this.pending.size >= 64 || this.child.stdin.writableLength > 65536) throw new Error('Typing is faster than the phone connection. Wait and try again.')
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail('Text input timed out. Reopen window controls before typing again.') }, 8000)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin.write(JSON.stringify({ type: 'input', id, epoch, input }) + '\n')
    })
  }
  private fail(message: string) { if (this.closed) return; this.notify(undefined, message); this.close() }
  private async cleanRemote() { await run(this.target.adb, [...this.selector, 'shell', 'rm', '-f', this.remote], 5000).catch(() => {}) }
  close() {
    if (this.closed) return
    this.release(); this.closed = true; this.controller.abort(); clearInterval(this.checkTimer); clearTimeout(this.startup)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Window input connection closed.')) }
    this.pending.clear()
    const child = this.child; this.child = undefined
    if (child) {
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), 1200); timer.unref()
      child.once('close', () => { clearTimeout(timer); void this.cleanRemote() })
    } else void this.cleanRemote()
  }
}
