import path from 'node:path'
import { checked, run, type CommandResult, type Runner } from './process.js'

/** Stop local ADB clients before stopping the server, and reject late background work. */
export class AdbLifecycle {
  private controller = new AbortController()
  private pending = new Set<Promise<CommandResult>>()
  private shutdownPromise?: Promise<void>
  private lastAdbPath: string | null = null
  closing = false
  constructor(private execute: Runner = run) {}

  readonly runner: Runner = (file, args, timeout, input, env, options) => {
    if (this.closing) return Promise.reject(new Error('ADB Vault is closing.'))
    const isAdb = /^adb(?:\.exe)?$/i.test(path.basename(file))
    if (!isAdb) return this.execute(file, args, timeout, input, env, options)
    this.lastAdbPath = file
    const signal = options?.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal
    // ADB defaults to one-second TCP keepalives; Windows resets after ten missed replies.
    // Wi-Fi can deliver idle replies in bursts. Give them time to arrive without polling
    // Android or reconnecting. This only configures a server started by our child process;
    // an existing server and explicit environment overrides remain untouched.
    const adbEnv = process.platform === 'win32'
      ? { ADB_TCP_KEEPALIVE_INTERVAL: process.env.ADB_TCP_KEEPALIVE_INTERVAL ?? '5', ...env }
      : env
    const command = this.execute(file, args, timeout, input, adbEnv, { ...options, signal })
    this.pending.add(command)
    void command.then(() => this.pending.delete(command), () => this.pending.delete(command))
    return command
  }

  shutdown(stopServer: boolean): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.closing = true
    this.controller.abort()
    this.shutdownPromise = (async () => {
      await Promise.allSettled([...this.pending])
      if (stopServer && this.lastAdbPath) checked(await this.execute(this.lastAdbPath, ['kill-server'], 5000))
    })()
    return this.shutdownPromise
  }
}
