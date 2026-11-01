import { useEffect, useId, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'

export function RestoreHelp({ installing = false }: { installing?: boolean }) {
  const title = installing ? "Installation help" : "Restoration help"
  const id = useId(), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const position = () => {
    if (!button.current || !panel.current) return
    const rect = button.current.getBoundingClientRect(), width = Math.min(380, innerWidth - 24)
    const below = innerHeight - rect.bottom - 16, above = rect.top - 16, bottom = below >= 260 || below >= above
    Object.assign(panel.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`, top: bottom ? `${rect.bottom + 7}px` : 'auto', bottom: bottom ? 'auto' : `${innerHeight - rect.top + 7}px`, maxHeight: `${Math.max(120, bottom ? below : above)}px` })
  }
  useEffect(() => { if (!open) return; window.addEventListener('resize', position); return () => window.removeEventListener('resize', position) }, [open])
  return <>
    <button ref={button} type="button" className="icon-button" aria-label={title} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" popoverTarget={id}><Info size={16} /></button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={title} className="apps-view-popover restore-help" onToggle={e => { setOpen(e.newState === 'open'); if (e.newState === 'open') position() }}>
      <div className="apps-popover-heading"><strong>{title}</strong><button className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={() => { panel.current?.hidePopover(); button.current?.focus() }}><X size={15} /></button></div>
      {installing ? <>
        <p><strong>Choose files</strong><br />Choose one or several APK/APKS files, including a mixture. An APKS must contain one application’s base APK and splits for a compatible device. Bundletool archives with multiple device variants are not supported yet. Separate split APK files cannot be installed alone.</p>
        <p><strong>Review and install</strong><br />All chosen applications are marked initially. Uncheck any you do not want to install. Filenames, package names and version codes identify the files. Installation needs no backup manifest or root access. Confirm the destination phone and profile before installation.</p>
        <p><strong>Existing applications</strong><br />Android checks signatures and compatibility. Existing applications may be updated, including shared APK code used by other profiles. No uninstall or downgrade fallback is attempted.</p>
        <p><strong>Progress</strong><br />Close keeps the queue running; reopen it from the top progress bar. Stop finishes the current application. Retry includes safe failed or unstarted applications only. Completed installations are not rolled back. Check uncertain outcomes on the phone before trying again.</p>
      </> : <>
      <p><strong>Open a backup</strong><br />Choose the manifest JSON beside your APK/APKS files, or a backup ZIP. The files are found automatically. A selection preset JSON is not a backup.</p>
      <p><strong>Choose applications</strong><br />Mark one, several or Select all. Only saved components are offered. If the backup contains only APK/APKS, marking the applications is enough.</p>
      <p><strong>Choose what to restore</strong><br />APK/APKS installs the application itself. App data includes saved settings; cache, OBB and media are separate choices. Missing components stay unchanged. Internal data/cache require root on the phone, Shell permission and root operations enabled in Settings → Apps.</p>
      <p><strong>Before replacement</strong><br />Copies are verified automatically. You confirm the selected apps and components before changes. APK/APKS is installed first when selected. Restoring files requires matching APKs and an unlocked profile; existing files in selected saved directories are replaced. Keystore keys and system-managed accounts are not restored.</p>
      <p><strong>Progress</strong><br />Closing this window keeps restoration running. Reopen it from the top progress bar. Stop finishes the current application before stopping the queue. Completed apps are not rolled back if another fails.</p>
      </>}
    </div>
  </>
}
