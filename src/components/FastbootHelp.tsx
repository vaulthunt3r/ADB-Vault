import { useEffect, useId, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'

export function FastbootHelp() {
  const id = useId(), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const position = () => {
    if (!button.current || !panel.current) return
    const rect = button.current.getBoundingClientRect(), width = Math.min(400, innerWidth - 24)
    const below = innerHeight - rect.bottom - 16, above = rect.top - 16, bottom = below >= 340 || below >= above
    Object.assign(panel.current.style, { width: `${width}px`, left: `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`, top: bottom ? `${rect.bottom + 7}px` : 'auto', bottom: bottom ? 'auto' : `${innerHeight - rect.top + 7}px`, maxHeight: `${Math.max(120, bottom ? below : above)}px` })
  }
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [open])
  return <>
    <button ref={button} type="button" className="icon-button" title="About Fastboot" aria-label="About Fastboot" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" popoverTarget={id}><Info size={16} /></button>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label="About Fastboot" className="apps-view-popover fastboot-help" onToggle={event => { setOpen(event.newState === 'open'); if (event.newState === 'open') position() }}>
      <div className="apps-popover-heading"><strong>About Fastboot</strong><button type="button" className="icon-button" aria-label="Close Fastboot help" onClick={() => { panel.current?.hidePopover(); button.current?.focus() }}><X size={15} /></button></div>
      <p>Read bootloader information and restart a phone back into Android or another supported boot mode while normal Android ADB control is unavailable.</p>
      <p><strong>Enter Fastboot</strong><br />With Android connected, use Connection → Actions → Restart… → Bootloader / Fastboot. Then connect the phone by USB.</p>
      <p><strong>Find the phone</strong><br />Find Fastboot devices searches for phones already in Bootloader or Fastbootd. Searching does not change the phone’s mode.</p>
      <p><strong>Return to Android</strong><br />Select the found phone → Actions → Restart… → Android. After startup, unlock the phone and reconnect ADB if needed.</p>
      <p>Root is not required. Supported modes depend on the phone; Windows may need a Fastboot USB driver. Flashing and bootloader unlocking are not available here.</p>
    </div>
  </>
}
