export interface ScreenshotSettings {
  folder: string | null
  saveToFile: boolean
  copyToClipboard: boolean
  askWhereToSave: boolean
}
export const screenshotDefaults: ScreenshotSettings = { folder: null, saveToFile: true, copyToClipboard: true, askWhereToSave: false }
export function screenshotSettings(value: unknown): ScreenshotSettings {
  const source = value && typeof value === 'object' ? value as Partial<ScreenshotSettings> : {}
  const result = { ...screenshotDefaults }
  for (const key of ['saveToFile', 'copyToClipboard', 'askWhereToSave'] as const) if (typeof source[key] === 'boolean') result[key] = source[key]
  if (typeof source.folder === 'string' && source.folder.length > 0 && source.folder.length <= 4096 && !/[\x00-\x1f]/.test(source.folder)) result.folder = source.folder
  if (!result.saveToFile && !result.copyToClipboard) result.copyToClipboard = true
  return result
}
export function validateScreenshotOptions(value: unknown): asserts value is Omit<ScreenshotSettings, 'folder'> {
  if (!value || typeof value !== 'object') throw new Error('Invalid screenshot settings.')
  const options = value as ScreenshotSettings
  if (['saveToFile', 'copyToClipboard', 'askWhereToSave'].some(key => typeof options[key as keyof ScreenshotSettings] !== 'boolean')) throw new Error('Invalid screenshot settings.')
  if (!options.saveToFile && !options.copyToClipboard) throw new Error('Choose a file, the clipboard, or both for screenshots.')
}
export function screenshotHint(settings: ScreenshotSettings) {
  return `${settings.saveToFile ? settings.copyToClipboard ? 'Save a PNG and copy the image to the Windows clipboard.' : 'Save the phone screen as a PNG image.' : 'Copy the phone screen image to the Windows clipboard.'} Change the destination in Settings → Screen & audio.`
}
