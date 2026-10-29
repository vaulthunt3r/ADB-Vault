import { fileParentPath } from '../../electron/file-locations'
import { fileBase, type FileEntry, type FileLocation } from '../../electron/files-protocol'
import { thumbnailImage } from '../../electron/file-thumbnail-protocol'

export function fileAlbums(entries: FileEntry[], location: FileLocation) {
  const albums = new Map<string, { entry: FileEntry; cover: FileEntry; count: number }>()
  for (const file of entries) {
    const folder = fileParentPath({ ...location, path: file.path }), album = albums.get(folder)
    if (album) {
      album.count++; album.entry.modified = Math.max(album.entry.modified, file.modified)
      if (thumbnailImage(file) && (!thumbnailImage(album.cover) || file.modified > album.cover.modified)) album.cover = file
    }
    else albums.set(folder, { count: 1, cover: file, entry: { name: fileBase(folder), path: folder, kind: 'directory', size: 0, modified: file.modified, fingerprint: '' } })
  }
  return albums
}
