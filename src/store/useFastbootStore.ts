import { create } from 'zustand'
import type { FastbootSnapshot } from '../../electron/fastboot-protocol'

export const useFastbootStore = create<FastbootSnapshot & { selectedSerial: string | null }>(() => ({
  devices: [], busy: false, checkedAt: null, error: null, message: '', selectedSerial: null,
}))
