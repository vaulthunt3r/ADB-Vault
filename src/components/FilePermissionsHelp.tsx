import { permissionGroups } from '../lib/filePermissions'

export function FilePermissionsHelp({ mode, folders }: { mode: string; folders: boolean }) {
  const groups = permissionGroups(mode, folders)
  return <div className="file-permissions-help" id="file-permissions-help">
    <p>{"Three digits, in order: "}<strong>Owner · Group · Others</strong>{". Each digit adds the allowed actions: "}<strong>Read 4 + Write 2 + Execute 1</strong>; 0 means no permissions.</p>
    {groups.length > 0 && <dl aria-label="Permission meaning">{groups.map(g => <div key={g.label}><dt>{g.label} <strong>{g.digit}</strong></dt><dd>{g.text}</dd></div>)}</dl>}
    <p><strong>644:</strong>{" owner reads and writes; group and others only read. "}<strong>755:</strong>{" owner reads, writes and executes; group and others read and execute."}</p>
    <p>For folders: read lists names, write allows creating/removing entries, and execute means entering/traversing. Folder operations can require both write and execute. 644 does not grant folder traversal.</p>
  </div>
}
