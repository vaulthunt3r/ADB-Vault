import { create } from 'zustand'
import { emptyInspectorSlot, type ApkInspectorState } from '../../electron/apk-inspector-protocol'
export const useApkInspectorStore = create<ApkInspectorState & { receive: (state: ApkInspectorState) => void }>((set, get) => ({
  revision: -1, before: emptyInspectorSlot(), after: emptyInspectorSlot(),
  receive: state => { if (state.revision > get().revision) set(state) },
}))
