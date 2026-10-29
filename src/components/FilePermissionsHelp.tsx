import { t } from "../lib/i18n"
import { permissionGroups } from '../lib/filePermissions'

export function FilePermissionsHelp({ mode, folders }: { mode: string; folders: boolean }) {
  const groups = permissionGroups(mode, folders)
  return <div className="file-permissions-help" id="file-permissions-help">
    <p>{t("Three digits, in order: ")}<strong>{t("Owner · Group · Others")}</strong>{t(". Each digit adds the allowed actions: ")}<strong>{t("Read 4 + Write 2 + Execute 1")}</strong>{t("; 0 means no permissions.")}</p>
    {groups.length > 0 && <dl aria-label={t("Permission meaning")}>{groups.map(g => <div key={g.label}><dt>{g.label} <strong>{g.digit}</strong></dt><dd>{g.text}</dd></div>)}</dl>}
    <p><strong>644:</strong>{t(" owner reads and writes; group and others only read. ")}<strong>755:</strong>{t(" owner reads, writes and executes; group and others read and execute.")}</p>
    <p>{t("For folders: read lists names, write allows creating/removing entries, and execute means entering/traversing. Folder operations can require both write and execute. 644 does not grant folder traversal.")}</p>
  </div>
}
