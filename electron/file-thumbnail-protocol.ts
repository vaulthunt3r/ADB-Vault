import type { FileEntry, FileLocation } from './files-protocol.js'

export const thumbnailMaxBytes = 32_000_000
export const thumbnailImage = (entry: Pick<FileEntry, 'kind' | 'name' | 'size'>) => entry.kind === 'file' && entry.size > 0 && entry.size <= thumbnailMaxBytes && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(entry.name)
export const thumbnailKey = (location: FileLocation, fingerprint: string) => JSON.stringify([location.kind, location.id, location.serial, location.transportId, !!location.root, location.path, fingerprint])
