import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { shellQuote as q, checkDataTarget, type DeviceShell } from './app-data-backup.js'
import type { AndroidApp } from './apps-protocol.js'
import type { RestoreTree } from './restore-tar.js'

export async function apkFingerprints(app: Pick<AndroidApp, 'packageName' | 'userId'>, shell: DeviceShell) {
  const paths = (await shell(`pm path --user ${app.userId} ${q(app.packageName)}`)).trim().split(/\r?\n/).map(s => s.startsWith('package:') ? s.slice(8) : '')
  if (!paths.length || paths.length > 128 || paths.some(p => !p.startsWith('/') || /[\x00-\x1f]/.test(p)) || new Set(paths).size !== paths.length) throw new Error('Cannot verify installed APK files.')
  const hashes: string[] = []
  for (const file of paths) {
    const match = /^([a-f0-9]{64})\s+/i.exec(await shell(`sha256sum ${q(file)}`))
    if (!match) throw new Error('Cannot verify installed APK checksum.')
    hashes.push(match[1].toLowerCase())
  }
  return hashes.sort()
}
function guard(root: string) {
  const alias = root.replace(/^\/data\/user\/0\//, '/data/data/')
  return `test -d ${q(root)} && test ! -L ${q(root)} || exit 61; case "$(readlink -f ${q(root)})" in ${q(root)}|${q(alias)}) ;; *) exit 62;; esac; `
}
function eachChild(root: string, body: string, preserveCache = false, preserveLib = false) {
  return `for f in ${q(root)}/* ${q(root)}/.[!.]* ${q(root)}/..?*; do test -e "$f" || test -L "$f" || continue; case "\${f##*/}" in .adb-vault-restore-*${preserveCache ? '|cache|code_cache' : ''}${preserveLib ? '|lib' : ''}) continue;; esac; ${body}; done; `
}
export interface DataRestoreOutcome { restored: string[]; warnings: string[] }
export class DataRestoreFailure extends Error {
  constructor(message: string, public recovery: string[], public rolledBack: boolean, public mayHaveChanged = false) { super(message) }
}
// All destination roots come from dataRoots(), never arbitrary paths in an archive.
export async function restoreDataTrees(app: AndroidApp, trees: RestoreTree[], expectedApks: string[], rootAccess: boolean,
  shell: DeviceShell, push: (local: string, remote: string) => Promise<void>, progress: (message: string) => void,
  signal: AbortSignal): Promise<DataRestoreOutcome> {
  if (!trees.length || !expectedApks.length) throw new Error('This copy lacks APK identity evidence. Create a new backup before restoring its files.')
  if (trees.some(t => t.private) && !rootAccess) throw new Error('Root on the phone and granted Shell access are required for internal data/cache restoration.')
  await checkDataTarget(app, shell)
  if (JSON.stringify(await apkFingerprints(app, shell)) !== JSON.stringify([...expectedApks].sort())) throw new Error('Installed APK files differ from the backup. Install the matching APK/APKS first; no data was changed.')
  if ((await shell(`am get-started-user-state ${app.userId}`, rootAccess)).trim() !== 'RUNNING_UNLOCKED') throw new Error('Unlock the destination Android profile first.')
  if (rootAccess && !/^uid=0\b/.test(await shell('id', true))) throw new Error('Root access was not granted.')
  await shell(`command -v tar >/dev/null; command -v sha256sum >/dev/null; ${trees.some(t => t.private) ? 'command -v restorecon >/dev/null;' : ''}`, rootAccess)
  const uuid = randomUUID(), remote = `/data/local/tmp/adb-vault-restore-${uuid}`
  const plans: { tree: RestoreTree; job: string; gid: number; created: boolean; started: boolean; prepared: boolean }[] = []
  // Validate every destination before stopping the app or creating staging directories.
  for (const tree of trees) {
    const r = tree.targetRoot, parent = r.slice(0, r.lastIndexOf('/'))
    const existence = (await shell(`if test -L ${q(r)}; then exit 63; elif test -e ${q(r)}; then ${guard(r)} echo EXISTS; else ${guard(parent)} echo ABSENT; fi`, rootAccess)).trim()
    if (!['EXISTS', 'ABSENT'].includes(existence)) throw new Error('Cannot determine destination directory state.')
    if (tree.private && existence === 'ABSENT') throw new Error('Private destination directory is missing. Open the installed app once, then stop it and retry.')
    await shell(`${guard(existence === 'EXISTS' ? r : parent)} test -r ${q(existence === 'EXISTS' ? r : parent)} && test -w ${q(existence === 'EXISTS' ? r : parent)} && test -x ${q(existence === 'EXISTS' ? r : parent)}; ${existence === 'EXISTS' ? `test -z "$(find ${q(r)} -mindepth 1 -maxdepth 1 -name '.adb-vault-restore-*' -print -quit)" || exit 64;` : ''}`, rootAccess)
    let gid = app.uid
    if (tree.private) {
      const owner = /^(\d+):(\d+)$/.exec((await shell(`stat -c '%u:%g' ${q(r)}`, true)).trim())
      if (!owner || Number(owner[1]) !== app.uid || ![app.uid, app.uid + 10000].includes(Number(owner[2]))) throw new Error('Unexpected owner/group on the destination data directory.')
      gid = Number(owner[2])
    }
    plans.push({ tree, job: `${r}/.adb-vault-restore-${uuid}`, gid, created: existence === 'ABSENT', started: false, prepared: false })
  }
  let remoteCreated = false, mutationStarted = false
  try {
    progress('Stopping the application and staging verified files…')
    await shell(`am force-stop --user ${app.userId} ${q(app.packageName)}`)
    remoteCreated = true; await shell(`umask 077; mkdir ${q(remote)}`)
    for (const [i, p] of plans.entries()) {
      signal.throwIfAborted()
      const archive = `${remote}/${i}.tar`, hash = createHash('sha256')
      for await (const chunk of createReadStream(p.tree.file, { signal })) hash.update(chunk)
      const sha = hash.digest('hex')
      await push(p.tree.file, archive)
      await shell(`chmod 600 ${q(archive)}; test "$(sha256sum ${q(archive)} | cut -d ' ' -f 1)" = ${q(sha)} || exit 65`)
      const r = p.tree.targetRoot
      if (p.created) await shell(`${guard(r.slice(0, r.lastIndexOf('/')))} mkdir ${q(r)}`, rootAccess)
      p.prepared = true; await shell(`${guard(r)} umask 077; mkdir ${q(p.job)}; touch ${q(p.job + '/owned')}; mkdir ${q(p.job + '/old')}`, rootAccess)
      await shell(`${guard(r)} ${guard(p.job)} test -f ${q(p.job + '/owned')}; tar --no-same-owner -xf ${q(archive)} -C ${q(p.job)}; test -d ${q(p.job + '/payload')}; ${p.tree.private ? `chown -R ${app.uid}:${p.gid} ${q(p.job + '/payload')};` : ''}`, rootAccess)
    }
    // Recheck target identity immediately before replacing any existing file.
    await checkDataTarget(app, shell)
    if (JSON.stringify(await apkFingerprints(app, shell)) !== JSON.stringify([...expectedApks].sort())) throw new Error('Application changed during restore preparation.')
    for (const p of plans) {
      progress(`Restoring ${p.tree.component}: ${p.tree.targetRoot}`)
      mutationStarted = true; p.started = true
      const r = p.tree.targetRoot
      await shell(`${guard(r)} ${guard(p.job)} test -f ${q(p.job + '/owned')}; ${guard(p.job + '/payload')} ${guard(p.job + '/old')} ` +
        eachChild(r, `mv -- "$f" ${q(p.job + '/old/')}`, p.tree.preserveCache, p.tree.private && p.tree.component === 'data') +
        `touch ${q(p.job + '/placing')}; ` + eachChild(p.job + '/payload', `mv -- "$f" ${q(r + '/')}`) +
        `${p.tree.private ? `restorecon -RF ${q(r)};` : ''} touch ${q(p.job + '/committed')}; echo RESTORED`, rootAccess).then(output => { if (output.trim() !== 'RESTORED') throw new Error('Restore completion was not confirmed.') })
    }
  } catch (error) {
    const recovery: string[] = []; let uncertain = false
    // A live unchanged transport may roll back. A lost/replaced transport is never redirected.
    for (const p of [...plans].reverse()) {
      if (!p.prepared) continue
      try {
        const r = p.tree.targetRoot
        if (p.started) await shell(`${guard(r)} ${guard(p.job)} test -f ${q(p.job + '/owned')}; ${guard(p.job + '/old')} if test -f ${q(p.job + '/placing')}; then ` + eachChild(r, 'rm -rf -- "$f"', p.tree.preserveCache, p.tree.private && p.tree.component === 'data') + 'fi; ' +
          eachChild(p.job + '/old', `mv -- "$f" ${q(r + '/')}`) + `${p.tree.private ? `restorecon -RF ${q(r)};` : ''}`, rootAccess)
        await shell(`${guard(r)} ${guard(p.job)} test -f ${q(p.job + '/owned')}; rm -rf -- ${q(p.job)}`, rootAccess)
        if (p.created) await shell(`${guard(r)} rmdir ${q(r)}`, rootAccess)
      } catch { recovery.push(p.job); if (p.started) uncertain = true }
    }
    if (remoteCreated) { try { await shell(`rm -rf -- ${q(remote)}`) } catch { recovery.push(remote) } }
    const message = error instanceof Error ? error.message : String(error)
    throw new DataRestoreFailure(`${message} ${recovery.length ? 'Recovery files may remain on the phone; do not delete them before checking the result.' : mutationStarted ? 'Previous files were restored. The app remains stopped.' : 'No existing files were replaced. The app may remain stopped.'}`, recovery, mutationStarted && !uncertain, uncertain)
  }
  const warnings: string[] = []
  for (const p of plans) try { await shell(`${guard(p.tree.targetRoot)} ${guard(p.job)} test -f ${q(p.job + '/owned')}; rm -rf -- ${q(p.job)}`, rootAccess) } catch { warnings.push(`Restored, but temporary recovery files remain: ${p.job}`) }
  try { await shell(`rm -rf -- ${q(remote)}`) } catch { warnings.push(`Temporary archives remain: ${remote}`) }
  return { restored: [...new Set(trees.map(t => t.component))], warnings }
}
