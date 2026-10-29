import type { BackendEvent } from './contracts.js'
import { actionOperation, backupOperation, restoreOperation, operationSummary } from './activity-operation.js'
import { fileActionLabel } from './files-protocol.js'
import { notificationChannels, type NotificationChannels, type NotificationSettings, type OperationAlert } from './notifications-protocol.js'

/** Live transitions only: snapshots and saved history never generate alerts. */
export class OperationNotifications {
  private states = new Map<string, string>()
  private devices = new Map<string, string>()
  private connectionSeen = false
  private pending: OperationAlert[] = []
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  constructor(private settings: () => NotificationSettings, private focused: () => boolean, private deliver: (alert: OperationAlert, channels: NotificationChannels) => void) {}

  private transition(key: string, status: string, alert: OperationAlert) {
    const previous = this.states.get(key)
    this.states.delete(key); this.states.set(key, status)
    if (this.states.size > 2000) this.states.delete(this.states.keys().next().value!)
    if (!previous || previous === status || !['running', 'queued', 'paused', 'conflict'].includes(previous)) return
    if (['success', 'partial', 'error', 'conflict'].includes(status)) this.enqueue(alert)
  }
  private allowed(alert: OperationAlert) {
    const settings = this.settings()
    const channels = notificationChannels(settings, alert.event)
    return !this.stopped && (channels.desktop || channels.sound) && (!settings.backgroundOnly || !this.focused())
  }
  private enqueue(alert: OperationAlert) {
    if (!this.allowed(alert)) return
    this.pending.push(alert)
    // Coalesce a burst of short jobs; never produce one alert per batch item.
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), 800); this.timer.unref() }
  }
  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const alerts = this.pending.filter(a => this.allowed(a)); this.pending = []
    if (!alerts.length) return
    const settings = this.settings()
    const desktop = alerts.filter(a => notificationChannels(settings, a.event).desktop)
    const sound = alerts.filter(a => notificationChannels(settings, a.event).sound)
    const desktopSound = desktop.some(a => notificationChannels(settings, a.event).sound)
    // Sound-only events must not leak into desktop summaries, nor produce a second sound.
    if (desktop.length) this.deliver(this.summary(desktop), { desktop: true, sound: desktopSound })
    if (sound.length && !desktopSound) this.deliver(this.summary(sound), { desktop: false, sound: true })
  }
  private summary(alerts: OperationAlert[]): OperationAlert {
    return alerts.length === 1 ? alerts[0] : {
      event: alerts[0].event, title: `${alerts.length} operation updates`, category: alerts.find(a => a.category !== 'completed')?.category || 'completed',
      body: alerts.slice(0, 3).map(a => a.title).join('\n') + (alerts.length > 3 ? `\nAnd ${alerts.length - 3} more. See Activity and Files tasks.` : ''),
      destination: alerts.every(a => a.destination === alerts[0].destination) ? alerts[0].destination : 'activity', taskPanel: alerts.some(a => a.taskPanel),
    }
  }
  capture(event: BackendEvent) {
    if (this.stopped) return
    if (event.type === 'backup' || event.type === 'restore' || event.type === 'appAction') {
      const state = event.state
      const op = event.type === 'backup' ? backupOperation(event.state, state.id, `Profile ${state.userId}`)
        : event.type === 'restore' ? restoreOperation(event.state) : actionOperation(event.state, state.id, `Profile ${state.userId}`)
      if (op) this.transition(op.key, op.status, {
        event: op.status !== 'success' ? 'apps-error' : event.type === 'backup' ? event.state.operation === 'preset' ? 'apps-preset' : 'apps-backup'
          : event.type === 'restore' ? event.state.sourceKind === 'install' ? 'apps-install' : 'apps-restore' : 'apps-action',
        title: `${op.title} ${op.status === 'success' ? 'completed' : op.status === 'partial' ? 'completed with issues' : 'failed'}`,
        body: operationSummary(op), destination: 'activity', category: op.status === 'success' ? 'completed' : 'problems',
      })
    } else if (event.type === 'files') {
      for (const task of event.state.tasks) this.transition('file:' + task.id, task.status, {
        event: task.status === 'conflict' ? 'file-conflict' : task.status !== 'success' ? 'file-error' : task.action === 'copy' ? 'file-copy' : task.action === 'move' ? 'file-move' : task.action === 'delete' ? 'file-delete' : 'file-change',
        title: `${fileActionLabel[task.action]} ${task.status === 'conflict' ? 'needs your decision' : task.status === 'success' ? 'completed' : task.status === 'partial' ? 'completed with issues' : 'failed'}`,
        body: task.status === 'conflict' ? 'A destination name already exists. Open Files tasks to choose what to do.'
          : `${task.completed} / ${task.items.length} selected items finished.${task.status !== 'success' ? ' See Files tasks for details.' : ''}`,
        destination: 'files', taskPanel: true, category: task.status === 'success' ? 'completed' : 'problems',
      })
    } else if (event.type === 'androidDiagnostics' && event.state.job) {
      const job = event.state.job
      const label = { logcat: 'Android log', battery: 'Battery report', bugreport: 'Bug report' }[job.kind]
      this.transition('diagnostic:' + job.id, job.status, { title: `${label} ${job.status === 'success' ? 'ready' : 'failed'}`, body: job.message,
        event: job.status === 'success' ? `diagnostic-${job.kind}` : 'diagnostic-error',
        destination: job.kind === 'battery' ? 'monitor' : 'connection', category: job.status === 'success' ? 'completed' : 'problems' })
    } else if (event.type === 'fileSearch') {
      const s = event.state
      this.transition('search:' + s.id, s.status === 'complete' ? 'success' : s.status, {
        event: s.status !== 'complete' ? 'file-error' : s.operation === 'index' ? 'file-index' : 'file-search',
        title: `${s.operation === 'index' ? 'File index' : 'File search'} ${s.status === 'complete' ? 'ready' : 'failed'}`,
        body: s.status === 'complete' ? `${s.matched} matches · ${s.scanned} objects checked` : s.message, destination: 'files', category: s.status === 'complete' ? 'completed' : 'problems',
      })
    } else if (event.type === 'apps') {
      const s = event.apps
      if (s.deviceId) {
        const profile = s.profiles.find(p => p.id === s.userId)?.name || `Profile ${s.userId}`
        if (s.status === 'loading' && this.states.get(`apps:${s.deviceId}`) !== 'running') this.enqueue({ event: 'apps-reading', title: 'Reading applications', body: s.userId === null ? 'Checking Android profiles…' : profile, destination: 'apps', category: 'completed' })
        this.transition(`apps:${s.deviceId}`, s.status === 'loading' ? 'running' : s.status === 'ready' ? 'success' : s.status, {
          event: s.status === 'ready' ? 'apps-loaded' : 'apps-error',
          title: s.status === 'ready' ? 'Applications loaded' : 'Reading applications failed', body: s.status === 'ready' ? `${profile} · ${s.apps.length} applications` : s.error || s.message,
          destination: 'apps', category: s.status === 'ready' ? 'completed' : 'problems',
        })
        if (s.badgeRead) this.transition(`badges:${s.deviceId}:${s.userId}`, s.badgeRead.status === 'complete' ? (s.badgeRead.failed ? 'partial' : 'success') : s.badgeRead.status, {
          event: s.badgeRead.failed ? 'apps-error' : 'apps-scanned',
          title: s.badgeRead.failed ? 'Application scan completed with issues' : 'Application scan completed',
          body: `${s.badgeRead.completed} / ${s.badgeRead.total} applications checked · ${s.badgeRead.failed} failed`, destination: 'apps', category: s.badgeRead.failed ? 'problems' : 'completed',
        })
        const details = s.details, analysis = details?.data?.analysis
        if (details && analysis) this.transition(`apk-scan:${details.deviceId}:${details.userId}:${details.packageName}`, analysis.status === 'complete' ? 'success' : analysis.status, {
          event: analysis.status === 'complete' ? 'apps-apk-scan' : 'apps-error',
          title: analysis.status === 'complete' ? 'Scan APKs completed' : analysis.status === 'partial' ? 'Scan APKs completed with issues' : 'Scan APKs failed',
          body: `${details.packageName}${analysis.error ? '\n' + analysis.error : ''}`, destination: 'apps', category: analysis.status === 'complete' ? 'completed' : 'problems',
        })
      }
    } else if (event.type === 'components') {
      for (const component of event.components) {
        const key = 'component:' + component.id
        if (['Downloading', 'Installing'].includes(component.status)) this.states.set(key, 'running')
        else if (component.status !== 'Checking') {
          const success = ['Installed', 'Detected', 'Package ready'].includes(component.status)
          this.transition(key, success ? 'success' : 'error', { event: success ? 'component-ready' : 'component-error', title: `${component.name}: ${component.status}`, body: component.message || 'Open Components for details.', destination: 'components', category: success ? 'completed' : 'problems' })
        }
      }
    } else if (event.type === 'connection') {
      const current = new Map(event.connection.devices.map(d => [d.id, d.status]))
      for (const [id, previous] of this.devices) if (previous === 'connected' && (!current.has(id) || ['disconnected', 'offline', 'unauthorized'].includes(current.get(id)!))) {
        const device = event.connection.devices.find(d => d.id === id)
        this.enqueue({ event: 'device-disconnected', title: 'Device disconnected', body: `${device?.name || id}: ${device?.status || 'disconnected'}. Check Connection before continuing.`, destination: 'connection', category: 'disconnected' })
      }
      if (this.connectionSeen) for (const device of event.connection.devices) if (device.status === 'connected' && this.devices.get(device.id) !== 'connected') {
        this.enqueue({ event: 'device-connected', title: 'Device connected', body: `${device.name} · ${device.method}`, destination: 'connection', category: 'completed' })
      }
      this.connectionSeen = true
      this.devices = current
    }
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.pending = []; this.states.clear(); this.devices.clear() }
}
