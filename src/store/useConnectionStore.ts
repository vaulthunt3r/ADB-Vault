import { create } from 'zustand'
import { useFastbootStore } from './useFastbootStore'
import type { ConnectionSnapshot } from '../../electron/contracts'
import { requestBackend } from '../lib/backend'
const pendingInfo = new Map<string, Promise<boolean>>()
let qrRequestGeneration = 0
export function readDeviceInfo(id: string): Promise<boolean> {
  const device = useConnectionStore.getState().devices.find(d => d.id === id)
  const key = JSON.stringify([id, device?.serial, device?.transportId, device?.hardwareId])
  const pending = pendingInfo.get(key)
  if (pending) return pending
  const request = requestBackend({ type: 'connection.info', id }).finally(() => pendingInfo.delete(key))
  pendingInfo.set(key, request)
  return request
}
interface ConnectionState extends ConnectionSnapshot {
  qrCreating: boolean
  manualScanning: boolean
  errorNotice: { text: string } | null
  dismissError: () => void
  selectedDeviceId: string | null
  scan: () => Promise<boolean>; selectDevice: (id: string) => void
  connect: (host: string, port: string) => Promise<boolean>
  pair: (host: string, port: string, code: string) => Promise<boolean>
  reconnect: (id: string) => Promise<boolean>; disconnect: (id: string) => Promise<boolean>
  forget: (id: string) => Promise<boolean>
  newQr: () => Promise<boolean>; cancelQr: () => Promise<boolean>
}
export const useConnectionStore = create<ConnectionState>((set, get) => ({
  qrCreating: false,
  manualScanning: false,
  errorNotice: null, dismissError: () => set({ errorNotice: null }),
  devices: [], activeDeviceId: null, selectedDeviceId: null, scanning: false, busy: false, error: null, message: '', qr: null, adbAvailable: false,
  scan: async () => {
    if (get().manualScanning) return false
    set({ manualScanning: true })
    try { return await requestBackend({ type: 'connection.scan' }) }
    finally { set({ manualScanning: false }) }
  },
  selectDevice: id => { useFastbootStore.setState({ selectedSerial: null }); set({ selectedDeviceId: id }); void requestBackend({ type: 'connection.select', id }) },
  connect: (host, port) => requestBackend({ type: 'connection.connect', host, port }),
  pair: (host, port, code) => requestBackend({ type: 'connection.pair', host, port, code }),
  reconnect: id => requestBackend({ type: 'connection.reconnect', id }),
  disconnect: id => requestBackend({ type: 'connection.disconnect', id }),
  forget: id => requestBackend({ type: 'connection.forget', id }),
  newQr: async () => {
    if (get().qrCreating) return false
    const generation = ++qrRequestGeneration
    set({ qrCreating: true })
    try { return await requestBackend({ type: 'connection.qr' }) }
    finally { if (generation === qrRequestGeneration) set({ qrCreating: false }) }
  },
  cancelQr: () => {
    ++qrRequestGeneration
    set({ qrCreating: false })
    return requestBackend({ type: 'connection.cancelQr' })
  },
}))
