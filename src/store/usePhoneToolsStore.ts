import { t } from "../lib/i18n"
import { create } from 'zustand'
import type { DeviceRecord } from '../../electron/contracts'
import { samePhoneTarget, type PhoneDataKind, type PhoneToolsRequest, type PhoneToolsState, type PhoneToolsTarget } from '../../electron/phone-tools-protocol'
import { requestBackend } from '../lib/backend'

export interface PhoneToolsView { kind: PhoneDataKind | 'clipboard'; target: PhoneToolsTarget | null; name: string }
interface State extends PhoneToolsState {
  view: PhoneToolsView | null; pending: boolean; error: string; clipboardDraft: string; clipboardDraftTarget: PhoneToolsTarget | null
  receive: (state: PhoneToolsState) => void
  open: (kind: PhoneToolsView['kind'], device?: Pick<DeviceRecord, 'id' | 'serial' | 'transportId' | 'name'>) => void
  request: (request: PhoneToolsRequest) => Promise<void>
  cancel: () => Promise<void>
}
export const usePhoneToolsStore = create<State>((set, get) => ({
  revision: -1, job: null, data: null, clipboard: null, view: null, pending: false, error: '', clipboardDraft: '', clipboardDraftTarget: null,
  receive: state => {
    const current = get()
    if (state.revision < current.revision) return
    const clipboardDraft = state.clipboard && state.clipboard.id !== current.clipboard?.id && samePhoneTarget(current.clipboardDraftTarget, state.clipboard.target) ? state.clipboard.text : current.clipboardDraft
    set({ ...state, clipboardDraft })
  },
  open: (kind, device) => {
    const target = device ? { id: device.id, serial: device.serial, transportId: device.transportId } : null
    const current = get(), same = target === null && current.clipboardDraftTarget === null || samePhoneTarget(current.clipboardDraftTarget, target)
    set({ view: { kind, target, name: device?.name || t("This computer") }, error: '',
      ...(kind === 'clipboard' ? { clipboardDraftTarget: target, clipboardDraft: same ? current.clipboardDraft : samePhoneTarget(current.clipboard?.target, target) ? current.clipboard!.text : '' } : {}) })
  },
  request: async request => {
    if (get().pending) return
    set({ pending: true, error: '' })
    try { await requestBackend(request, error => set({ error })) }
    finally { set({ pending: false }) }
  },
  cancel: async () => { const job = get().job; if (job?.status === 'running') await requestBackend({ type: 'phoneTools.cancel', jobId: job.id }, error => set({ error })) },
}))
