import { clipboard, ClipboardItem, nativeImage } from 'electron'

export async function copyScreenshotImage(file: string) {
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) throw new Error('The captured PNG could not be decoded.')
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
}
