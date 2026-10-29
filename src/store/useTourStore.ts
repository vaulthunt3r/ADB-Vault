import { create } from 'zustand'

const key = 'adb-vault-tour-v1'
function firstVisit() {
  try { return !localStorage.getItem(key) && !localStorage.getItem('adb-vault-layout') && !localStorage.getItem('adb-vault-appearance') }
  catch { return false }
}
function remember() { try { localStorage.setItem(key, 'seen') } catch { /* Optional cosmetic preference. */ } }

export const useTourStore = create<{ open: boolean; welcome: boolean; start: () => void; close: () => void; dismiss: () => void }>(set => ({
  open: false, welcome: firstVisit(),
  start: () => { remember(); set({ open: true, welcome: false }) },
  close: () => set({ open: false }),
  dismiss: () => { remember(); set({ welcome: false }) },
}))
