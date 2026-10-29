import { randomUUID } from 'node:crypto'
import type { AdbConsoleRequest, AdbConsoleState, ConsoleRun } from './adb-console-protocol.js'
import { validateConsoleRun } from './adb-console-protocol.js'
import type { BackendEvent, ConnectionSnapshot, DeviceRecord } from './contracts.js'
import { run, type Runner } from './process.js'

// Parse ADB arguments without invoking a Windows shell. Backslashes in Windows
// paths stay literal; quotes group arguments and \" / \' escape matching quotes.
export function consoleArguments(mode: 'adb' | 'shell', command: string): string[] {
  if (mode === 'shell') return ['shell', '-T', command]
  const source = command.trim().replace(/^adb(?:\.exe)?(?:\s+|$)/i, '')
  if (/^shell(?:\s|$)/.test(source)) {
    let body = source.slice(5).trim()
    const options: string[] = []
    // Preserve the command after ADB's own shell flags, including remote pipes,
    // redirects and quotes. No PTY is allocated because this console has no stdin.
    for (let match; (match = /^(-[Tnx])(?:\s+|$)/.exec(body));) {
      if (match[1] !== '-T') options.push(match[1])
      body = body.slice(match[0].length).trimStart()
    }
    if (!body || body.startsWith('-')) throw new Error('Enter a shell command. Interactive terminal options are not supported.')
    // Commands pasted as adb shell "entire command" use one local quoted
    // argument, whereas quotes inside an unwrapped command belong to Android.
    if ((body[0] === '"' || body[0] === "'") && splitArguments(body).length === 1) body = splitArguments(body)[0]
    if (!body.trim()) throw new Error('Enter a shell command.')
    return ['shell', '-T', ...options, body]
  }
  const args = splitArguments(source)
  if (!args.length) throw new Error('Enter an ADB command, for example shell getprop ro.product.model.')
  if (args[0].startsWith('-')) throw new Error('Use the phone selector to choose the target. Enter the ADB command without global options.')
  return args
}
function splitArguments(source: string) {
  const args: string[] = []
  let value = '', quote = '', started = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\' && quote && source[i + 1] === quote) { value += source[++i]; started = true }
    else if (quote) { if (c === quote) quote = ''; else value += c }
    else if (c === '"' || c === "'") { quote = c; started = true }
    else if (/\s/.test(c)) { if (started) { args.push(value); value = ''; started = false } }
    else { value += c; started = true }
  }
  if (quote) throw new Error('Close the quoted argument before running the command.')
  if (started) args.push(value)
  return args
}

export class AdbConsoleService {
  state: AdbConsoleState = { revision: 0, run: null, history: [] }
  private controller?: AbortController
  private work?: Promise<void>
  private captured?: DeviceRecord
  private executable?: string
  private timer?: ReturnType<typeof setTimeout>
  private interrupted = ''
  private closing = false
  get busy() { return !!this.work }
  constructor(private adb: () => string | null, private connection: () => ConnectionSnapshot,
    private emit: (event: BackendEvent) => void, private runner: Runner = run) {}
  private publish() {
    clearTimeout(this.timer); this.timer = undefined
    this.state.revision++
    this.emit({ type: 'adbConsole', state: structuredClone(this.state) })
  }
  private append(stream: 'stdout' | 'stderr', text: string) {
    const job = this.state.run!
    // Render text only, not terminal control sequences or HTML.
    text = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    if (!text) return
    const last = job.output.at(-1)
    if (last?.stream === stream) last.text += text
    else job.output.push({ stream, text })
    let excess = job.output.reduce((n, part) => n + part.text.length, 0) - 65536
    while (excess > 0 && job.output.length) {
      job.truncated = true
      const part = job.output[0], remove = Math.min(excess, part.text.length)
      part.text = part.text.slice(remove); excess -= remove
      if (!part.text) job.output.shift()
    }
    if (!this.timer) this.timer = setTimeout(() => this.publish(), 100)
  }
  private assertCurrent() {
    const d = this.captured!, current = this.connection().devices.find(item => item.id === d.id)
    if (this.adb() !== this.executable || !current || current.status !== 'connected' || current.serial !== d.serial || current.transportId !== d.transportId || current.hardwareId !== d.hardwareId) throw new Error('The device connection changed. Command stopped.')
  }
  contextChanged() {
    if (!this.busy) return
    try { this.assertCurrent() } catch (error) {
      this.interrupted = (error as Error).message
      this.controller?.abort()
    }
  }
  start(request: Extract<AdbConsoleRequest, { type: 'console.run' }>) {
    validateConsoleRun(request)
    if (this.closing) throw new Error('ADB Vault is closing.')
    if (this.busy) throw new Error('Stop the current console command first.')
    const connection = this.connection(), device = connection.devices.find(d => d.id === request.target.id)
    if (!device || device.status !== 'connected' || connection.busy) throw new Error('Connect the selected phone first.')
    if (device.serial !== request.target.serial || device.transportId !== request.target.transportId) throw new Error('The device connection changed. Select the phone again.')
    const executable = this.adb()
    if (!executable) throw new Error('Install or locate ADB in Components first.')
    const args = consoleArguments(request.mode, request.command)
    this.captured = { ...device }; this.executable = executable
    this.controller = new AbortController(); this.interrupted = ''
    this.state.run = { id: randomUUID(), mode: request.mode, command: request.command, target: { ...request.target },
      deviceName: device.name, status: 'running', startedAt: new Date().toISOString(), exitCode: null, output: [], truncated: false, message: 'Running…' }
    this.state.history = [{ mode: request.mode, command: request.command }, ...this.state.history.filter(h => h.mode !== request.mode || h.command !== request.command)].slice(0, 50)
    this.work = Promise.resolve().then(() => this.execute(args, request.timeout)).finally(() => {
      this.work = undefined; this.controller = undefined; this.publish()
    })
    this.publish()
  }
  private async execute(args: string[], timeout: number) {
    const job = this.state.run!, signal = this.controller!.signal
    const target = job.target, selector = target.transportId ? ['-t', target.transportId] : ['-s', target.serial]
    let stdoutSeen = false, stderrSeen = false
    try {
      this.assertCurrent()
      const result = await this.runner(this.executable!, [...selector, ...args], timeout, undefined, undefined, {
        signal, maxOutputBytes: 1_000_000, maxStderrBytes: 1_000_000,
        onStdout: text => { stdoutSeen = true; this.append('stdout', text) },
        onStderr: text => { stderrSeen = true; this.append('stderr', text) },
      })
      if (!stdoutSeen) this.append('stdout', result.stdout)
      if (!stderrSeen) this.append('stderr', result.stderr)
      job.exitCode = result.code
      if (signal.aborted) throw new Error('Command stopped.')
      job.status = result.code === 0 ? 'success' : 'error'
      job.message = `Exited with code ${result.code}.`
    } catch (error) {
      job.status = this.interrupted ? 'error' : signal.aborted ? 'cancelled' : 'error'
      job.message = this.interrupted || (signal.aborted ? 'Stopped. Changes already made by the command are not undone.' : error instanceof Error ? error.message : String(error))
    } finally { job.endedAt = new Date().toISOString() }
  }
  stop(id: string) {
    if (!this.busy || this.state.run?.id !== id) return
    this.state.run.status = 'stopping'; this.state.run.message = 'Stopping…'
    this.controller?.abort(); this.publish()
  }
  clear() {
    if (this.busy) throw new Error('Stop the current command before clearing the console.')
    this.state.run = null; this.state.history = []; this.publish()
  }
  async wait() { await this.work }
  async shutdown() { this.closing = true; this.controller?.abort(); await this.work; clearTimeout(this.timer) }
}
