import type { FileLocation } from '../../electron/files-protocol'
import { thumbnailKey } from '../../electron/file-thumbnail-protocol'
import { filesRequest } from '../store/useFilesStore'

type Listener = (src?: string) => void
type Job = { key: string; location: FileLocation; fingerprint: string; listeners: Set<Listener>; requestId?: string }
const jobs = new Map<string, Job>(), cache = new Map<string, { src?: string; expires: number }>()
const active = new Set<Job>()
let cacheBytes = 0

async function resizePreview(src: string) {
  const image = new Image()
  image.src = src
  await image.decode()
  const ratio = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

function remember(key: string, src?: string) {
  cacheBytes -= (cache.get(key)?.src?.length || 0) * 2
  cache.delete(key)
  cache.set(key, { src, expires: Date.now() + (src ? 10 * 60_000 : 15_000) })
  cacheBytes += (src?.length || 0) * 2
  while (cache.size > 160 || cacheBytes > 12_000_000) {
    const first = cache.keys().next().value!
    cacheBytes -= (cache.get(first)?.src?.length || 0) * 2
    cache.delete(first)
  }
}

function pump() {
  for (const job of jobs.values()) {
    if (active.size >= 2) break
    if (job.requestId || !job.listeners.size || job.location.kind === 'device' && [...active].some(other => other.location.kind === 'device')) continue
    active.add(job)
    job.requestId = crypto.randomUUID()
    void filesRequest({ type: 'files.thumbnail', location: job.location, fingerprint: job.fingerprint, requestId: job.requestId })
      .then(async reply => {
        if (!job.listeners.size) return
        const src = reply.thumbnail ? await resizePreview(reply.thumbnail) : undefined
        if (!job.listeners.size) return
        remember(job.key, src)
        for (const listener of job.listeners) listener(src)
      }).catch(() => { if (job.listeners.size) remember(job.key) })
      .finally(() => { active.delete(job); if (jobs.get(job.key) === job) jobs.delete(job.key); pump() })
  }
}

/** Shared by both panes: two previews total, one phone transfer, memory-only LRU cache. */
export function subscribeThumbnail(location: FileLocation, fingerprint: string, listener: Listener) {
  const key = thumbnailKey(location, fingerprint), cached = cache.get(key)
  if (cached && cached.expires > Date.now()) {
    cache.delete(key); cache.set(key, cached)
    listener(cached.src)
    return () => {}
  }
  let job = jobs.get(key)
  if (!job) { job = { key, location, fingerprint, listeners: new Set() }; jobs.set(key, job) }
  const subscribed = job
  subscribed.listeners.add(listener)
  pump()
  return () => {
    subscribed.listeners.delete(listener)
    if (subscribed.listeners.size) return
    if (jobs.get(key) === subscribed) jobs.delete(key)
    if (subscribed.requestId && active.has(subscribed)) void filesRequest({ type: 'files.thumbnail.cancel', requestId: subscribed.requestId }).catch(() => {})
  }
}
