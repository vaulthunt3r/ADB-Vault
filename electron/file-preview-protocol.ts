export type FilePreviewKind = 'image' | 'video' | 'audio' | 'text'
export interface FilePreview { kind: FilePreviewKind; url?: string; text?: string }
const types: Record<string, [FilePreviewKind, string]> = {
  png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'],
  gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], avif: ['image', 'image/avif'], bmp: ['image', 'image/bmp'],
  mp4: ['video', 'video/mp4'], m4v: ['video', 'video/mp4'], webm: ['video', 'video/webm'], ogv: ['video', 'video/ogg'], mov: ['video', 'video/quicktime'], mkv: ['video', 'video/x-matroska'],
  mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], aac: ['audio', 'audio/aac'], wav: ['audio', 'audio/wav'], flac: ['audio', 'audio/flac'], ogg: ['audio', 'audio/ogg'], opus: ['audio', 'audio/ogg'],
}
export function previewType(name: string): [FilePreviewKind, string] | undefined {
  const ext = name.split('.').at(-1)?.toLowerCase() || ''
  if (/^(txt|md|log|json|xml|csv|ini|cfg|conf|yaml|yml|js|ts|css|html|htm|svg|sh|py|java|kt|toml|srt|vtt)$/.test(ext)) return ['text', 'text/plain']
  return types[ext]
}
