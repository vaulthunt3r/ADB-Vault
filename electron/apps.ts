import type { SignatureDatabase } from './signature-database.js'
import { AppsCollector } from './apps-collector.js'
import { emptyApps, type AppsSnapshot, type AppsLoadingMode, type AppsOptions } from './apps-protocol.js'
import type { BackendEvent, ConnectionSnapshot } from './contracts.js'
import { run, type Runner } from './process.js'
import { AppDetailsReader } from './app-details.js'
import { appBadgeEvidence, type AppDetails } from './app-details-protocol.js'
import type { PermissionSnapshot } from './app-permissions-protocol.js'
import type { AppActionTarget } from './app-actions-protocol.js'

interface Job { collector: AppsCollector; background: boolean; userId?: number }
// One foreground inventory plus session-only caches. Only this coordinator publishes UI state.
export class AppsService {
  state = emptyApps()
  private cache = new Map<number, AppsSnapshot>()
  private attempted = new Set<number>()
  private job?: Job
  private actionCollector?: AppsCollector
  private earlyAttempted: string | null = null
  private revision = 0
  private detailsReader: AppDetailsReader
  private badgeJob?: { reader: AppDetailsReader; serial: string; transportId?: string }
  get readingBadges() { return !!this.badgeJob }
  constructor(private helperDirectory: string, private adbPath: () => string | null, private connection: () => ConnectionSnapshot, private emit: (event: BackendEvent) => void, private runner: Runner = run, private database?: () => SignatureDatabase | undefined) {
    this.detailsReader = new AppDetailsReader(helperDirectory, adbPath, connection, () => this.state, details => { this.state = { ...this.state, details }; if (details?.status === 'ready' && details.data) this.rememberBadges(details.data); this.publish() }, runner, database)
  }
  private rememberBadges(data: AppDetails) {
    this.state = { ...this.state, badgeEvidence: { ...this.state.badgeEvidence, [data.packageName]: appBadgeEvidence(data) } }
    this.cacheBadges()
  }
  applyPermissions(target: AppActionTarget, permissions: PermissionSnapshot | null) {
    if (this.state.deviceId !== target.id || this.state.userId !== target.userId) return
    const details = this.state.details
    if (details?.packageName !== target.packageName || details.userId !== target.userId || !details.data) return
    this.state = { ...this.state, details: { ...details, collectedAt: new Date().toISOString(), data: { ...details.data, requestedPermissions: permissions?.requestedPermissions } } }
    this.publish()
  }
  private cacheBadges() {
    const saved = this.state.userId === null ? undefined : this.cache.get(this.state.userId)
    if (saved) this.cache.set(this.state.userId!, { ...saved, badgeEvidence: this.state.badgeEvidence, badgeRead: this.state.badgeRead })
  }
  cancelBadges() {
    if (!this.badgeJob) return
    const job = this.badgeJob; this.badgeJob = undefined; job.reader.clear()
    if (this.state.badgeRead) this.state = { ...this.state, badgeRead: { ...this.state.badgeRead, status: 'cancelled' } }
    this.cacheBadges(); this.publish()
  }
  async readBadges(id: string, userId: number) {
    this.validate(id, userId)
    if (this.readingBadges || this.state.status !== 'ready' || this.state.userId !== userId || this.state.deviceId !== id) throw new Error('Select a loaded profile before reading badges.')
    this.stopJob()
    const device = this.connection().devices.find(d => d.id === id)!
    let failed = false
    const reader = new AppDetailsReader(this.helperDirectory, this.adbPath, this.connection, () => this.state, details => {
      if (this.badgeJob !== job) return
      if (details?.status === 'ready' && details.data) this.rememberBadges(details.data)
      if (details?.status === 'error') failed = true
    }, this.runner, this.database)
    const job = { reader, serial: device.serial, transportId: device.transportId }; this.badgeJob = job
    const packages = this.state.apps.map(app => app.packageName)
    this.state = { ...this.state, badgeEvidence: {}, badgeRead: { status: 'running', completed: 0, total: packages.length, failed: 0 } }
    this.cacheBadges(); this.publish()
    try {
      for (const packageName of packages) {
        if (this.badgeJob !== job) return
        failed = false
        try { await reader.read(id, userId, packageName, false, false) } catch { failed = true }
        if (this.badgeJob !== job) return
        const progress = this.state.badgeRead!
        this.state = { ...this.state, badgeRead: { ...progress, completed: progress.completed + 1, failed: progress.failed + (failed ? 1 : 0) } }
        this.cacheBadges(); this.publish()
      }
      this.state = { ...this.state, badgeRead: { ...this.state.badgeRead!, status: 'complete' } }
      this.cacheBadges(); this.publish()
      this.emit({ type: 'activity', source: 'apps', device: device.serial, tone: this.state.badgeRead!.failed ? 'warning' : 'success', text: `Badge information: ${packages.length - this.state.badgeRead!.failed}/${packages.length} applications read for user ${userId}. Individual checks may be unavailable.` })
    } finally { if (this.badgeJob === job) { this.badgeJob = undefined; this.schedule() } }
  }
  inspect(id: string, userId: number, packageName: string, scan = false) { return this.detailsReader.read(id, userId, packageName, scan) }
  private publish() {
    this.state = { ...this.state, cachedUserIds: [...this.cache.keys()], backgroundUserId: this.job?.background ? this.job.userId ?? null : null }
    this.emit({ type: 'apps', apps: this.state })
  }
  private stopJob() {
    this.cancelBadges()
    this.actionCollector?.cancel(); this.actionCollector = undefined
    const job = this.job; this.job = undefined
    if (job?.background && job.userId !== undefined) this.attempted.delete(job.userId)
    job?.collector.cancel()
  }
  connectionChanged(connection: ConnectionSnapshot) {
    const active = connection.devices.find(d => d.id === connection.activeDeviceId && d.status === 'connected')
    if (this.badgeJob && (!active || active.serial !== this.badgeJob.serial || active.transportId !== this.badgeJob.transportId)) this.cancelBadges()
    if (this.earlyAttempted !== active?.id) this.earlyAttempted = null
    if (this.state.deviceId && (connection.activeDeviceId !== this.state.deviceId || !connection.devices.some(d => d.id === this.state.deviceId && d.status === 'connected'))) {
      this.detailsReader.clear(); this.stopJob(); this.cache.clear(); this.attempted.clear()
      this.state = { ...emptyApps(), options: this.state.options, loadingMode: this.state.loadingMode }; this.publish()
    }
    this.startEarly(connection)
  }
  private startEarly(connection = this.connection()) {
    const id = connection.activeDeviceId
    if (!this.state.options.early || !id || connection.busy || connection.scanning || this.job || this.earlyAttempted === id
      || !connection.devices.some(d => d.id === id && d.status === 'connected')) return
    this.earlyAttempted = id
    if (this.state.deviceId === id && this.state.status !== 'idle') return
    void this.refresh(id).catch(() => { /* Published once; scans must not retry failed collections. */ })
  }
  configureOptions(options: AppsOptions) {
    this.cancelBadges()
    if (!['icons', 'early', 'storage'].every(key => typeof options[key as keyof AppsOptions] === 'boolean')) throw new Error('Invalid Apps options.')
    if (options.root !== undefined && typeof options.root !== 'boolean') throw new Error('Invalid root option.')
    if (!!options.root !== !!this.state.options.root) { this.detailsReader.clear(); this.detailsReader.resetRootAccess(); this.cache.clear(); this.state = { ...this.state, badgeEvidence: {}, badgeRead: undefined } }
    const changed = options.icons !== this.state.options.icons || options.storage !== this.state.options.storage
    if (changed) { this.detailsReader.clear(); this.revision++; this.cache.clear(); this.attempted.clear() }
    this.state = { ...this.state, options: { ...options } }; this.publish()
    this.startEarly()
  }
  configure(mode: AppsLoadingMode) {
    if (mode !== 'selected' && mode !== 'preload') throw new Error('Invalid Apps loading mode.')
    this.state = { ...this.state, loadingMode: mode }
    if (mode === 'selected' && this.job?.background) this.stopJob()
    if (mode === 'preload') this.attempted.clear()
    this.publish(); this.schedule()
  }
  cancel() {
    this.detailsReader.clear()
    const foreground = this.job && !this.job.background
    this.stopJob()
    if (foreground || this.state.status !== 'ready') this.state = { ...this.state, progress: null, apps: [], status: 'idle', error: null, collectedAt: null, message: 'Collection cancelled.' }
    this.publish()
  }
  private validate(deviceId: string, userId?: number) {
    if (userId !== undefined && (!Number.isInteger(userId) || userId < 0 || userId > 99999)) throw new Error('Invalid Android profile ID.')
    const c = this.connection()
    if (c.activeDeviceId !== deviceId || !c.devices.some(d => d.id === deviceId && d.status === 'connected')) throw new Error('Select a connected device before reading applications.')
    if (this.state.deviceId && this.state.deviceId !== deviceId) this.connectionChanged(c)
  }
  async selectProfile(deviceId: string, userId: number) {
    this.cancelBadges()
    this.validate(deviceId, userId)
    this.detailsReader.clear()
    const saved = this.cache.get(userId)
    if (saved && this.state.profiles.some(p => p.id === userId)) {
      if (this.job && !this.job.background) this.stopJob()
      this.state = { ...saved, options: this.state.options, profiles: this.state.profiles, currentUserId: this.state.currentUserId, profilesError: this.state.profilesError, loadingMode: this.state.loadingMode, preloadErrors: this.state.preloadErrors }
      this.publish(); this.schedule(); return
    }
    if (this.job && !this.job.background) this.stopJob()
    await this.refresh(deviceId, userId)
  }
  async refresh(deviceId: string, userId?: number) {
    this.validate(deviceId, userId)
    if (this.job && !this.job.background) throw new Error('Apps collection is already running.')
    this.detailsReader.clear()
    this.earlyAttempted = deviceId
    this.stopJob()
    const target = userId ?? this.state.userId
    if (target !== null && target !== undefined) this.cache.delete(target)
    await this.collect(deviceId, userId ?? this.state.userId ?? undefined, false)
  }
  async refreshAfterAction(deviceId: string, userId: number, packageName: string) {
    this.validate(deviceId, userId)
    if (this.state.deviceId !== deviceId || this.state.userId !== userId || this.state.status !== 'ready') throw new Error('Application context changed.')
    this.stopJob()
    const device = this.connection().devices.find(d => d.id === deviceId)!
    const transport = device.transportId, serial = device.serial
    // This collector is private: its loading/progress events must never replace the visible inventory.
    const collector = new AppsCollector(this.helperDirectory, this.adbPath, this.connection, () => {}, this.runner)
    this.actionCollector = collector
    try {
      await collector.refresh(deviceId, userId, this.state.options, packageName)
      const current = this.connection().devices.find(d => d.id === deviceId && d.status === 'connected')
      if (this.actionCollector !== collector || collector.state.status !== 'ready' || this.state.deviceId !== deviceId || this.state.userId !== userId || this.connection().activeDeviceId !== deviceId || !current || current.serial !== serial || current.transportId !== transport) throw new Error('Application context changed.')
      const updated = collector.state.apps[0]
      const removed = collector.state.removedApps?.[0]
      const badgeEvidence = { ...this.state.badgeEvidence }; delete badgeEvidence[packageName]
      this.state = { ...this.state, badgeEvidence, apps: this.state.apps.some(app => app.packageName === packageName) ? this.state.apps.flatMap(app => app.packageName === packageName ? updated ? [updated] : [] : [app]) : updated ? [...this.state.apps, updated] : this.state.apps }
      this.state.removedApps = [...(this.state.removedApps || []).filter(app => app.packageName !== packageName), ...(removed ? [removed] : [])]
      if (this.state.details?.packageName === packageName) this.detailsReader.clear()
      this.cache.set(userId, { ...this.state, details: null })
      this.publish()
    } catch (error) {
      // Retain the current table on failure, but do not reuse an outdated profile cache later.
      if (this.state.deviceId === deviceId) this.cache.delete(userId)
      throw error
    } finally {
      if (this.actionCollector === collector) { this.actionCollector = undefined; this.publish(); this.schedule() }
    }
  }
  private schedule() {
    if (this.state.loadingMode !== 'preload' || this.job || this.actionCollector || this.badgeJob || this.state.status !== 'ready' || !this.state.deviceId) return
    const next = this.state.profiles.find(p => p.id !== this.state.userId && !this.cache.has(p.id) && !this.attempted.has(p.id))
    if (!next) return
    this.attempted.add(next.id)
    void this.collect(this.state.deviceId, next.id, true).catch(() => { /* Background errors are published per profile. */ })
  }
  private async collect(deviceId: string, userId: number | undefined, background: boolean) {
    const revision = this.revision, options = { ...this.state.options }
    const collector = new AppsCollector(this.helperDirectory, this.adbPath, this.connection, event => {
      if (this.job !== job) return
      if (event.type !== 'apps') { this.emit(event); return }
      if (!background) {
        this.state = { ...event.apps, options: this.state.options, loadingMode: this.state.loadingMode, preloadErrors: this.state.preloadErrors }
        this.publish()
      }
    }, this.runner)
    collector.state = { ...this.state }
    const job: Job = { collector, background, userId }; this.job = job; this.publish()
    try {
      await collector.refresh(deviceId, userId, options)
      if (this.job !== job || collector.state.status !== 'ready' || collector.state.userId === null) return
      const result = collector.state
      for (const id of this.cache.keys()) if (!result.profiles.some(p => p.id === id)) this.cache.delete(id)
      if (revision === this.revision) this.cache.set(result.userId!, result)
      const errors = { ...this.state.preloadErrors }; delete errors[result.userId!]
      this.state = { ...this.state, profiles: result.profiles, currentUserId: result.currentUserId, preloadErrors: errors }
    } catch (error) {
      if (this.job !== job) return
      if (background && userId !== undefined) {
        const message = error instanceof Error ? error.message : String(error)
        this.state = { ...this.state, preloadErrors: { ...this.state.preloadErrors, [userId]: message } }
        this.emit({ type: 'activity', text: `Profile ${userId} preload failed: ${message}`, tone: 'warning' })
      } else {
        if (userId !== undefined) this.cache.delete(userId)
        throw error
      }
    } finally {
      if (this.job === job) { this.job = undefined; this.publish(); this.schedule() }
    }
  }
}
