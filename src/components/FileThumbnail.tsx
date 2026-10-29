import { t } from "../lib/i18n"
import { useEffect, useRef, useState } from 'react'
import { File } from 'lucide-react'
import type { FileEntry, FileLocation } from '../../electron/files-protocol'
import { thumbnailImage, thumbnailKey } from '../../electron/file-thumbnail-protocol'
import { subscribeThumbnail } from '../lib/fileThumbnails'

export function FileThumbnail({ entry, location, enabled }: { entry: FileEntry; location: FileLocation; enabled: boolean }) {
  const element = useRef<HTMLSpanElement>(null), [image, setImage] = useState<{ key: string; src?: string }>()
  const key = thumbnailKey({ ...location, path: entry.path }, entry.fingerprint)
  const src = image?.key === key ? image.src : undefined
  useEffect(() => {
    if (!enabled || !thumbnailImage(entry) || !element.current) return
    let release: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(([item]) => {
      clearTimeout(timer)
      if (!item.isIntersecting) { release?.(); release = undefined; return }
      timer = setTimeout(() => {
        if (!release) release = subscribeThumbnail({ ...location, path: entry.path }, entry.fingerprint, src => setImage({ key, src }))
      }, 120)
    }, { root: element.current.closest('.fm-list') })
    observer.observe(element.current)
    return () => { clearTimeout(timer); observer.disconnect(); release?.() }
  }, [key, enabled]) // Identity includes source, transport, root mode, path and fingerprint.
  return <span ref={element} className="fm-thumbnail" title={src ? undefined : t("Image previews: PNG, JPEG, WebP, GIF, BMP and AVIF up to 32 MB. Files must be readable with the current access.")}>{src ? <img src={src} alt="" onError={() => setImage(undefined)} /> : <File size={34} />}</span>
}
