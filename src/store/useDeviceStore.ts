import { create } from 'zustand'
import { createDeviceWorkspace, demoDevices, type ConnectionMethod, type ConnectionScenario, type DemoDevice, type DeviceId, type DeviceWorkspace } from '../lib/deviceData'
import { useAppStore } from './useAppStore'

type WorkScope = 'apps' | 'files'
interface Operation { scope: WorkScope; label: string; progress: number }
interface DeviceState {
  devices: DemoDevice[]; activeDeviceId: DeviceId | null; selectedDeviceId: DeviceId
  connectionScenario: ConnectionScenario; scanning: boolean
  workspaces: Record<DeviceId, DeviceWorkspace>; selectedAppId: string | null; selectedFileId: string | null; folder: string
  operation: Operation | null; appFailure: boolean; fileFailure: boolean; operationError: { scope: WorkScope; message: string } | null
  selectDevice: (id: DeviceId) => void
  setConnectionScenario: (scenario: ConnectionScenario) => void
  scan: () => Promise<void>
  connect: (id: DeviceId, method?: ConnectionMethod, endpoint?: string) => Promise<void>
  disconnect: (id: DeviceId) => void
  selectApp: (id: string | null, details?: boolean) => void
  selectFile: (id: string | null, details?: boolean) => void
  goToFolder: (id: string) => void
  setFailure: (scope: WorkScope, fail: boolean) => void
  perform: (scope: WorkScope, label: string, change?: (workspace: DeviceWorkspace) => DeviceWorkspace) => Promise<boolean>
  appAction: (action: 'install' | 'launch' | 'stop' | 'uninstall', id?: string) => Promise<boolean>
  fileAction: (action: 'upload' | 'download' | 'folder' | 'rename' | 'delete', value?: string) => Promise<boolean>
}
let generation = 0
let sequence = 0
const connectionRuns = new Map<DeviceId, number>()
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const log = (text: string, tone: 'info' | 'success' | 'warning' = 'info') => useAppStore.getState().log(text, tone)
const notify = (text: string) => useAppStore.getState().notify(text)
function showDetails() { useAppStore.getState().showInspector('details') }

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: demoDevices.map(device => ({ ...device })), activeDeviceId: null, selectedDeviceId: 'pixel', connectionScenario: 'normal', scanning: false,
  workspaces: { pixel: createDeviceWorkspace(), galaxy: createDeviceWorkspace() }, selectedAppId: 'org.telegram.messenger', selectedFileId: null, folder: 'root',
  operation: null, appFailure: false, fileFailure: false, operationError: null,
  selectDevice: id => {
    const device = get().devices.find(item => item.id === id)!
    set({ selectedDeviceId: id })
    if (device.status === 'connected' && id !== get().activeDeviceId) {
      generation++
      if (get().operation) { notify("Demo operation cancelled: active device changed."); log('Pending operation cancelled: active device changed.', 'warning') }
      set({ activeDeviceId: id, selectedAppId: null, selectedFileId: null, folder: 'root', operation: null, operationError: null })
    }
  },
  setConnectionScenario: connectionScenario => set({ connectionScenario }),
  scan: async () => {
    if (get().scanning) return
    set({ scanning: true })
    log('Scanning for USB devices (simulated).')
    await delay(900)
    set(state => ({ scanning: false, devices: state.devices.map(device => device.id === 'pixel' && !['connected', 'connecting'].includes(device.status) ? { ...device, status: 'available', lastSeen: "Available now" } : device) }))
    notify("Scan complete. Pixel 8 is available in the demo environment.")
  },
  connect: async (id, method, endpoint) => {
    const device = get().devices.find(item => item.id === id)!
    if (device.status === 'connecting') return
    if (device.status === 'connected') get().disconnect(id)
    const token = ++sequence
    const scenario = get().connectionScenario
    connectionRuns.set(id, token)
    set(state => ({ selectedDeviceId: id, devices: state.devices.map(item => item.id === id ? { ...item, method: method ?? item.method, endpoint: endpoint ?? item.endpoint, status: 'connecting' } : item) }))
    log(`${device.name}: connecting via ${method ?? device.method} (simulated).`)
    await delay(1200)
    if (connectionRuns.get(id) !== token) return
    const status = scenario === 'normal' ? 'connected' : scenario === 'failure' ? 'failed' : scenario
    set(state => ({ devices: state.devices.map(item => item.id === id ? { ...item, status, known: true, lastSeen: status === 'connected' ? "Just now" : item.lastSeen } : item) }))
    if (status === 'connected') { get().selectDevice(id); notify(`${device.name} connected. Demo Apps and Files are ready.`) }
    else notify(`${device.name}: ${status}. Review the recovery instructions in Connection.`)
    log(`${device.name}: ${status} (simulated).`, status === 'connected' ? 'success' : 'warning')
  },
  disconnect: id => {
    connectionRuns.set(id, ++sequence)
    const name = get().devices.find(item => item.id === id)!.name
    const active = get().activeDeviceId === id
    if (active) generation++
    if (active && get().operation) log('Pending demo operation cancelled on disconnect.', 'warning')
    set(state => ({ devices: state.devices.map(item => item.id === id ? { ...item, status: 'disconnected', lastSeen: "Just now" } : item), ...(active ? { activeDeviceId: null, operation: null, selectedAppId: null, selectedFileId: null, folder: 'root', operationError: null } : {}) }))
    log(`${name}: disconnected (simulated).`)
    notify(`${name} disconnected.`)
    const { section, setSection } = useAppStore.getState()
    if (active && (section === 'apps' || section === 'files')) {
      set({ selectedDeviceId: id })
      setSection('connection')
    }
  },
  selectApp: (selectedAppId, details = false) => { set({ selectedAppId }); if (details) showDetails() },
  selectFile: (selectedFileId, details = false) => { set({ selectedFileId }); if (details) showDetails() },
  goToFolder: folder => {
    const id = get().activeDeviceId
    if (id && (folder === 'root' || get().workspaces[id].files.some(file => file.id === folder && file.kind === 'folder'))) set({ folder, selectedFileId: null })
  },
  setFailure: (scope, fail) => set(scope === 'apps' ? { appFailure: fail, operationError: null } : { fileFailure: fail, operationError: null }),
  perform: async (scope, label, change) => {
    const id = get().activeDeviceId
    if (!id || get().devices.find(device => device.id === id)?.status !== 'connected' || get().operation) return false
    const token = ++generation
    const fail = scope === 'apps' ? get().appFailure : get().fileFailure
    set({ operation: { scope, label, progress: 0 }, operationError: null })
    log(`${label} on ${get().devices.find(device => device.id === id)!.name} (simulated).`)
    for (const progress of [25, 55, 80, 100]) {
      await delay(220)
      if (generation !== token || get().activeDeviceId !== id) return false
      set({ operation: { scope, label, progress } })
    }
    if (fail) {
      const message = `${label} failed in the demo. No data changed. Choose “Success” and retry.`
      set({ operation: null, operationError: { scope, message } }); log(message, 'warning'); return false
    }
    if (change) set(state => ({ workspaces: { ...state.workspaces, [id]: change(state.workspaces[id]) } }))
    set({ operation: null }); log(`${label} complete (simulated).`, 'success'); notify(`${label} complete — simulated, no real device or computer files changed.`)
    return true
  },
  appAction: async (action, id) => {
    const deviceId = get().activeDeviceId
    if (!deviceId) return false
    const app = get().workspaces[deviceId].apps.find(item => item.id === (id ?? get().selectedAppId))
    if (action !== 'install' && (!app || action === 'uninstall' && app.system)) return false
    const label = action === 'install' ? "Install Pocket Notes APK" : `${{ launch: "Launch", stop: "Force stop", uninstall: "Uninstall" }[action]} ${app!.name}`
    const success = await get().perform('apps', label, workspace => ({ ...workspace, apps: action === 'install' ? [...workspace.apps.filter(item => item.id !== 'dev.demo.notes'), { id: 'dev.demo.notes', name: 'Pocket Notes', version: '1.0.0', size: "8 MB", system: false, running: false }] : action === 'uninstall' ? workspace.apps.filter(item => item.id !== app!.id) : workspace.apps.map(item => item.id === app!.id ? { ...item, running: action === 'launch' } : item) }))
    if (success && action === 'install') set({ selectedAppId: 'dev.demo.notes' })
    if (success && action === 'uninstall') set({ selectedAppId: null })
    return success
  },
  fileAction: async (action, value) => {
    const { activeDeviceId, selectedFileId, folder, workspaces } = get()
    if (!activeDeviceId) return false
    const files = workspaces[activeDeviceId].files
    const file = files.find(item => item.id === selectedFileId)
    if (['rename', 'delete', 'download'].includes(action) && !file) return false
    if (action === 'download' && file?.kind === 'folder') return false
    const name = value?.trim() ?? (action === 'upload' ? `demo-note-${++sequence}.txt` : '')
    if (['folder', 'rename'].includes(action)) {
      if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name) || name.length > 128) { notify("Enter a valid name (1–128 characters, no slashes)."); return false }
      if (files.some(item => item.parent === (action === 'rename' ? file!.parent : folder) && item.name === name && item.id !== (action === 'rename' ? file!.id : ''))) { notify("An item with that name already exists in this folder."); return false }
    }
    const label = `${{ upload: "Upload sample file", download: "Download", folder: "Create folder", rename: "Rename", delete: "Delete" }[action]}${file && !['upload', 'folder'].includes(action) ? ` ${file.name}` : ''}`
    const success = await get().perform('files', label, workspace => {
      let updated = workspace.files
      if (action === 'upload' || action === 'folder') updated = [...updated, { id: `demo-${++sequence}`, parent: folder, name, kind: action === 'folder' ? 'folder' : 'file', size: action === 'folder' ? '—' : "1 KB", modified: "Just now", ...(action === 'upload' ? { content: 'This sample upload only exists in the demo workspace.' } : {}) }]
      if (action === 'rename') updated = updated.map(item => item.id === file!.id ? { ...item, name, modified: "Just now" } : item)
      if (action === 'delete') {
        const removed = new Set([file!.id])
        let size = 0
        while (size !== removed.size) { size = removed.size; updated.forEach(item => { if (removed.has(item.parent)) removed.add(item.id) }) }
        updated = updated.filter(item => !removed.has(item.id))
      }
      return { ...workspace, files: updated }
    })
    if (success && action === 'delete') set({ selectedFileId: null })
    return success
  },
}))
