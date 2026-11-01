import { useEffect, useRef, useState } from 'react'
import { ArrowDownWideNarrow, Check } from 'lucide-react'
import type { FolderView, PaneSide } from '../store/useFilesStore'
import { IconButton } from './ui'

const fields = [['name', "Name"], ['size', "Size"], ['type', "Type"], ['modified', "Date modified"]] as const

export function FileSortMenu({ side, prefs, change, onOpen }: { side: PaneSide; prefs: FolderView; change: (patch: Partial<FolderView>) => void; onOpen: () => void }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); root.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus() }
  useEffect(() => {
    if (!open) return
    root.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return <div className="fm-sort-control" ref={root}>
    <IconButton label={`Sort ${side} files`} title={`Sort: ${fields.find(([id]) => id === prefs.sort)?.[1]} · ${prefs.descending ? "Descending" : "Ascending"}`} aria-haspopup="menu" aria-expanded={open} onClick={() => { if (!open) onOpen(); setOpen(!open) }}><ArrowDownWideNarrow size={15} /></IconButton>
    {open && <div className="fm-sort-menu" role="menu" aria-label={`Sort ${side} files`} onKeyDown={event => {
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'Tab') setOpen(false)
      else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length]?.focus()
      }
    }}>
      <div role="group" aria-label="Sort by">{fields.map(([sort, label]) => <button key={sort} role="menuitemradio" aria-checked={prefs.sort === sort} onClick={() => { change({ sort }); close() }}><span>{label}</span>{prefs.sort === sort && <Check size={14} />}</button>)}</div>
      <div role="separator" />
      <div role="group" aria-label="Sort direction">{[false, true].map(descending => <button key={String(descending)} role="menuitemradio" aria-checked={prefs.descending === descending} onClick={() => { change({ descending }); close() }}><span>{descending ? "Descending" : "Ascending"}</span>{prefs.descending === descending && <Check size={14} />}</button>)}</div>
      <small>Folders first</small>
    </div>}
  </div>
}
