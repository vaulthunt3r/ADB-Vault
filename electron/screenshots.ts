import { copyFile, mkdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { Storage } from './storage.js'
import { screenshotSettings, validateScreenshotOptions, type ScreenshotSettings } from './screenshot-protocol.js'

export type ScreenshotResult = { message: string; warning?: boolean }
export class Screenshots {
  constructor(private storage: Storage, private defaultFolder: string, private ports: {
    chooseFolder: (current: string) => Promise<string | null>
    saveAs: (file: string) => Promise<string | null>
    copyImage: (file: string) => void | Promise<void>
    openFolder: (folder: string) => Promise<void>
  }) {}
  get settings(): ScreenshotSettings {
    const settings = screenshotSettings(this.storage.data.screenshots)
    return { ...settings, folder: settings.folder && path.isAbsolute(settings.folder) ? settings.folder : this.defaultFolder }
  }
  private async persist(settings: ScreenshotSettings) {
    const previous = this.storage.data.screenshots
    this.storage.data.screenshots = settings
    try { await this.storage.save() } catch (error) { this.storage.data.screenshots = previous; throw error }
  }
  async configure(options: Omit<ScreenshotSettings, 'folder'>) {
    validateScreenshotOptions(options)
    await this.persist({ folder: this.storage.data.screenshots?.folder ?? null, saveToFile: options.saveToFile, copyToClipboard: options.copyToClipboard, askWhereToSave: options.askWhereToSave })
  }
  async chooseFolder() {
    const folder = await this.ports.chooseFolder(this.settings.folder!)
    if (!folder) return
    if (!path.isAbsolute(folder)) throw new Error('Choose an absolute screenshot folder.')
    await this.persist({ ...this.settings, folder })
  }
  async openFolder() {
    const folder = this.settings.folder!
    await mkdir(folder, { recursive: true })
    await this.ports.openFolder(folder)
  }
  async deliver(file: string, name: string): Promise<ScreenshotResult | null> {
    const settings = this.settings
    let destination = settings.saveToFile ? path.join(settings.folder!, name) : null
    if (settings.saveToFile && settings.askWhereToSave) {
      destination = await this.ports.saveAs(destination!)
      if (!destination) return null
      if (path.extname(destination).toLowerCase() !== '.png') throw new Error('Choose a PNG file name.')
    }
    let copied = false, saved = false
    const errors: string[] = []
    if (settings.copyToClipboard) {
      try { await this.ports.copyImage(file); copied = true }
      catch (error) { errors.push(`Could not copy image: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (destination) {
      try {
        await mkdir(path.dirname(destination), { recursive: true })
        if (settings.askWhereToSave) {
          // Only an explicit Save as dialog may replace an existing file.
          const temporary = path.join(path.dirname(destination), `.adb-vault-${randomUUID()}.png.tmp`)
          try { await copyFile(file, temporary, constants.COPYFILE_EXCL); await rename(temporary, destination) }
          finally { await rm(temporary, { force: true }).catch(() => {}) }
        } else {
          const base = destination
          for (let index = 0; ; index++) {
            destination = index ? `${base.slice(0, -4)}-${index}.png` : base
            try { await copyFile(file, destination, constants.COPYFILE_EXCL); break }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || index >= 999) throw error }
          }
        }
        saved = true
      } catch (error) { errors.push(`Could not save PNG: ${error instanceof Error ? error.message : String(error)}`) }
    }
    if (!saved && !copied) throw new Error(errors.join(' ') || 'Screenshot was not saved or copied.')
    const message = saved ? `Screenshot saved${copied ? ' and copied to clipboard' : ''}: ${destination}` : 'Screenshot copied to clipboard.'
    return { message: [message, ...errors].join(' '), warning: errors.length > 0 }
  }
}
