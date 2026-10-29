import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { ApkSignature } from './apk-inspector-protocol.js'
export async function runInspectorTool(file: string, args: string[], signal: AbortSignal, limit = 4_000_000) {
  signal.throwIfAborted()
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const env = { ...process.env }; delete env.JAVA_TOOL_OPTIONS; delete env.JDK_JAVA_OPTIONS; delete env._JAVA_OPTIONS
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env })
    const out: Buffer[] = [], err: Buffer[] = []; let size = 0, failure: Error | undefined
    const stop = (error: Error) => { failure ??= error; child.kill() }
    const abort = () => stop(new Error('APK inspection cancelled.'))
    const timer = setTimeout(() => stop(new Error('Android APK tool timed out.')), 60000)
    signal.addEventListener('abort', abort, { once: true })
    const read = (chunks: Buffer[]) => (chunk: Buffer) => { size += chunk.length; if (size > limit) stop(new Error('Android tool output exceeds its limit.')); else chunks.push(chunk) }
    child.stdout.on('data', read(out)); child.stderr.on('data', read(err))
    child.once('error', e => { failure = e })
    child.once('close', code => { clearTimeout(timer); signal.removeEventListener('abort', abort); failure ? reject(failure) : resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }) })
  })
}
export function parseApkSignature(code: number | null, stdout: string, stderr: string): ApkSignature {
  const signers = [...stdout.matchAll(/^Signer #(\d+) certificate SHA-256 digest: ([a-f\d]{64})\s*$/gim)].map(m => ({ name: stdout.match(new RegExp(`^Signer #${m[1]} certificate DN: (.+)$`, 'm'))?.[1]?.trim() ?? `Signer ${m[1]}`, sha256: m[2].toLowerCase() }))
  const verified = code === 0 && /^Verifies\s*$/m.test(stdout) && signers.length > 0
  return { status: verified ? 'verified' : 'invalid', signers, schemes: [...stdout.matchAll(/^Verified using (.+?): true\s*$/gm)].map(m => m[1]), diagnostics: (stdout + '\n' + stderr).trim().slice(0, 24000) }
}
export async function verifyApk(file: string, directory: string, signal: AbortSignal): Promise<ApkSignature> {
  try {
    const java = path.join(directory, 'runtime', 'bin', 'java.exe'), jar = path.join(directory, 'apksigner.jar')
    await access(java); await access(jar)
    const result = await runInspectorTool(java, ['-Xmx256m', '-Dfile.encoding=UTF-8', '-jar', jar, 'verify', '--verbose', '--print-certs', file], signal)
    return parseApkSignature(result.code, result.stdout, result.stderr)
  } catch (error) { signal.throwIfAborted(); return { status: 'unavailable', signers: [], schemes: [], diagnostics: String(error) } }
}
export async function apkLabel(file: string, directory: string, signal: AbortSignal) {
  try { const result = await runInspectorTool(path.join(directory, 'aapt2.exe'), ['dump', 'badging', file], signal); return { label: result.code === 0 ? result.stdout.match(/^application-label:'(.*)'\r?$/m)?.[1] ?? result.stdout.match(/^application: label='(.*)' icon='/m)?.[1] ?? '' : '', issue: result.code === 0 ? '' : 'Application label could not be resolved by aapt2.' } }
  catch (error) { signal.throwIfAborted(); return { label: '', issue: `Application label unavailable: ${String(error)}` } }
}
