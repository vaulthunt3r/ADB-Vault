import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { Storage } from './storage.js'
import type { ExportDestinationSettings } from './app-backup-protocol.js'

export class ExportDestination {
  private changing = false
  constructor(private storage: Storage, private choose: (current: string | null) => Promise<string | null>) {}
  get settings(): ExportDestinationSettings { return this.storage.data.exportDestination ?? { mode: 'ask', folder: null } }
  private async usable(folder: string) {
    try {
      const resolved = await realpath(folder)
      if (!(await stat(resolved)).isDirectory()) throw new Error('Not a folder')
      await access(resolved, constants.W_OK)
      return resolved
    } catch { throw new Error('The export folder is unavailable or not writable. Choose another folder in Settings > Apps > Export destination.') }
  }
  private async save(next: ExportDestinationSettings) {
    const previous = this.storage.data.exportDestination
    this.storage.data.exportDestination = next
    try { await this.storage.save() } catch (error) { this.storage.data.exportDestination = previous; throw error }
  }
  async configure(mode: 'ask' | 'fixed', chooseFolder = false) {
    if (this.changing) throw new Error('Finish choosing the export folder first.')
    this.changing = true
    try {
      let folder = this.settings.folder
      if (mode === 'fixed') {
        if (!folder || chooseFolder) {
          const chosen = await this.choose(folder)
          if (!chosen) return // Cancelling keeps both the previous mode and folder.
          folder = chosen
        }
        folder = await this.usable(folder)
      }
      await this.save({ mode, folder })
    } finally { this.changing = false }
  }
  async resolve() {
    const { mode, folder } = this.settings
    if (mode === 'fixed') {
      if (!folder) throw new Error('Choose an export folder in Settings > Apps > Export destination.')
      return this.usable(folder)
    }
    const chosen = await this.choose(folder)
    return chosen ? this.usable(chosen) : null
  }
}
