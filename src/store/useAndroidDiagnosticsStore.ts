import { create } from 'zustand'
import type { AndroidDiagnosticKind, AndroidDiagnosticsState, DiagnosticTarget, LogBuffer } from '../../electron/android-diagnostics-protocol'
import type { DeviceRecord } from '../../electron/contracts'
import { requestBackend } from '../lib/backend'

interface State extends AndroidDiagnosticsState {
  view: { kind: 'logcat' | 'bugreport'; target: DiagnosticTarget; name: string } | null
  pending: boolean; error: string | null; errorKind: AndroidDiagnosticKind | null; errorTarget: DiagnosticTarget | null
  open: (kind: 'logcat' | 'bugreport', device: Pick<DeviceRecord, 'id' | 'serial' | 'transportId' | 'name'>) => void
  start: (kind: AndroidDiagnosticKind, target: DiagnosticTarget, buffer?: LogBuffer) => Promise<void>
  cancel: () => Promise<void>
}
export const useAndroidDiagnosticsStore = create<State>((set, get) => ({
  job: null, logcat: null, battery: null, view: null, pending: false, error: null, errorKind: null, errorTarget: null,
  open: (kind, d) => set({ view: { kind, target: { id: d.id, serial: d.serial, transportId: d.transportId }, name: d.name }, error: null }),
  start: async (kind, target, buffer) => {
    if (get().pending || get().job?.status === 'running') return
    set({ pending: true, error: null, errorKind: kind, errorTarget: target })
    try { await requestBackend({ type: 'androidDiagnostics.start', kind, target, buffer }, error => set({ error })) }
    finally { set({ pending: false }) }
  },
  cancel: async () => { const job = get().job; if (job?.status === 'running') await requestBackend({ type: 'androidDiagnostics.cancel', jobId: job.id }) },
}))
export function sameDiagnosticTarget(a: DiagnosticTarget | undefined, b: DiagnosticTarget | undefined) { return !!a && !!b && a.id === b.id && a.serial === b.serial && a.transportId === b.transportId }
