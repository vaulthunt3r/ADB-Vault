import { createHash } from 'node:crypto'
import type { CommandError } from './process.js'

export function missingSha256(error: unknown): boolean {
  const result = (error as CommandError | null)?.commandResult
  return result?.code === 127 && /sha256sum.*(?:not found|inaccessible)|unknown command.*sha256sum/i.test(result.stderr + result.stdout)
}

/** Verify the same helper bytes on ROMs without sha256sum; never execute an unverified upload. */
export async function helperChecksum(command: (args: string[]) => Promise<string>, remote: string, optional = false): Promise<string> {
  if (!/^\/data\/local\/tmp\/android-manager\/manager-server\.jar(?:\.[a-z-]+)?$/.test(remote)) throw new Error('Invalid Android helper path.')
  try {
    const output = await command(optional ? ['shell', `if [ -f ${remote} ]; then sha256sum ${remote}; fi`] : ['shell', 'sha256sum', remote])
    return output.split(/\s+/)[0]
  } catch (error) {
    if (!missingSha256(error)) throw error
  }
  // Android 7's toolbox has od. Hex preserves binary bytes through the text runner;
  // hash locally, bound the response, and retain every caller's device/cancellation checks.
  const output = (await command(['shell', 'od', '-An', '-v', '-tx1', '-N', '524289', remote])).trim()
  if (!output || output.length > 2_000_000 || !/^[a-f0-9]{2}(?:\s+[a-f0-9]{2})*$/i.test(output)) throw new Error('Invalid Android helper verification response.')
  const bytes = Buffer.from(output.replace(/\s+/g, ''), 'hex')
  if (bytes.length > 524288) throw new Error('Android helper exceeds its verification size limit.')
  return createHash('sha256').update(bytes).digest('hex')
}
