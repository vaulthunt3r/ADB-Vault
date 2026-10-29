import { spawn } from 'node:child_process'
import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'

export interface CommandResult { stdout: string; stderr: string; code: number }
export interface CommandError extends Error { commandResult?: CommandResult }
export type Runner = (file: string, args: string[], timeout?: number, input?: string, env?: NodeJS.ProcessEnv, options?: { maxOutputBytes?: number; maxStderrBytes?: number; signal?: AbortSignal; onStdout?: (chunk: string) => void; onStderr?: (chunk: string) => void; onStdoutBytes?: (bytes: number) => void; stdoutFile?: string }) => Promise<CommandResult>
export const run: Runner = (file, args, timeout = 12000, input, env, options) => new Promise((resolve, reject) => {
  if (options?.signal?.aborted) { reject(new Error('Operation cancelled.')); return }
  const child = spawn(file, args, { windowsHide: true, shell: false, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', finished = false, stdoutBytes = 0, stderrBytes = 0
  let terminationError: Error | undefined, terminationTimer: ReturnType<typeof setTimeout> | undefined
  const limit = options?.maxOutputBytes || 2_000_000
  const timer = setTimeout(() => terminate(new Error('Command timed out. Check the device and try again.')), timeout)
  const done = (error?: Error, code = -1) => {
    if (finished) return
    finished = true; clearTimeout(timer); clearTimeout(terminationTimer); options?.signal?.removeEventListener('abort', abort)
    const result = { stdout: stdout.trim(), stderr: stderr.trim(), code }
    if (error) reject(Object.assign(error, { commandResult: result })); else resolve(result)
  }
  const terminate = (error: Error) => {
    if (finished || terminationError) return
    terminationError = error
    child.kill()
    // Wait for process exit so shutdown cannot race an ADB client still starting its server.
    terminationTimer = setTimeout(() => done(error), 2000)
  }
  const abort = () => terminate(new Error('Operation cancelled.'))
  options?.signal?.addEventListener('abort', abort, { once: true })
  child.on('error', error => done(error))
  const saved = options?.stdoutFile ? pipeline(child.stdout, createWriteStream(options.stdoutFile, { flags: 'wx', mode: 0o600 }), { signal: options.signal }) : Promise.resolve()
  if (options?.stdoutFile && options.onStdoutBytes) child.stdout.on('data', (chunk: Buffer) => { try { options.onStdoutBytes!(chunk.length) } catch (e) { terminate(e instanceof Error ? e : new Error(String(e))) } })
  void saved.catch(error => terminate(error))
  child.on('close', code => { void saved.then(() => done(terminationError, code ?? -1), error => done(terminationError || error)) })
  if (!options?.stdoutFile) child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  if (!options?.stdoutFile) child.stdout.on('data', data => {
    if (finished || terminationError) return
    stdout += data; stdoutBytes += Buffer.byteLength(data)
    if (stdoutBytes > limit) { terminate(new Error('Command output exceeded its limit.')); return }
    try { options?.onStdout?.(data) } catch (error) { terminate(error instanceof Error ? error : new Error(String(error))) }
  })
  child.stderr.on('data', data => {
    if (finished || terminationError) return
    stderr += data; stderrBytes += Buffer.byteLength(data)
    if (stderrBytes > (options?.maxStderrBytes || 2_000_000)) { terminate(new Error('Command output exceeded its limit.')); return }
    try { options?.onStderr?.(data) } catch (error) { terminate(error instanceof Error ? error : new Error(String(error))) }
  })
  child.stdin.on('error', () => {})
  child.stdin.end(input)
})
export function checked(result: CommandResult) {
  if (result.code !== 0) {
    // ADB prints progress on stderr. It must not hide an error on stdout or
    // become the entire failure message when a transfer exits unexpectedly.
    const diagnostic = (value: string) => value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/[\r\n]+/).filter(line => !/^\s*\[\s*\d+%\]/.test(line)).join('\n').trim()
    const details = [diagnostic(result.stderr), diagnostic(result.stdout)].filter(Boolean).join('\n')
    const progressOnly = /\[\s*\d+%\]/.test(result.stderr + result.stdout)
    // Android puts the exception and its reason before the Java stack trace.
    // Keep both ends: the cause at the start and any final transport error.
    const excerpt = details.length > 1200 ? `${details.slice(0, 800)}\n… [output truncated] …\n${details.slice(-350)}` : details
    throw Object.assign(new Error(excerpt || `Command exited with code ${result.code}.${progressOnly ? ' File transfer ended before completion; ADB returned progress only, without an error reason.' : ''}`), { commandResult: result })
  }
  return result.stdout || result.stderr
}
export function powershell(script: string, env?: NodeJS.ProcessEnv, timeout = 20000, runner: Runner = run) {
  const file = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const preamble = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new(); "
  return runner(file, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(preamble + script, 'utf16le').toString('base64')], timeout, undefined, env).then(checked)
}
