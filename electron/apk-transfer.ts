import type { DeviceRecord } from './contracts.js'

export interface ApkTransferInfo {
  method: 'adb-pull' | 'exec-out'
  compression: 'default' | 'zstd' | 'none'
  fallbackReason?: string
}

// One session per export/backup. Never reuse capabilities after reconnecting.
export class ApkTransferSession {
  private selection?: ApkTransferInfo
  constructor(private enabled: boolean) {}
  async prepare(method: DeviceRecord['method'], command: (args: string[]) => Promise<string>): Promise<ApkTransferInfo> {
    if (!this.enabled || method !== 'Wi-Fi') return { method: 'adb-pull', compression: 'default' }
    if (!this.selection) {
      let output: string
      try { output = await command(['features']) }
      catch (error) {
        // Old clients can lack this query. Transport failures must remain failures.
        if (!(error instanceof Error) || !/^adb: unknown command features\s*$/.test(error.message)) throw error
        return this.selection = { method: 'adb-pull', compression: 'default', fallbackReason: 'ADB does not support the features query.' }
      }
      const features = new Set(output.trim().split(/[\s,]+/))
      this.selection = features.has('sendrecv_v2') && features.has('sendrecv_v2_zstd')
        ? { method: 'adb-pull', compression: 'zstd' }
        : { method: 'adb-pull', compression: 'default', fallbackReason: 'Zstd transfer is not supported by this ADB/device connection.' }
    }
    return { ...this.selection }
  }
  unsupported(error: unknown): ApkTransferInfo | undefined {
    // Do not retry timeouts, disconnected transports, disk errors or corrupt data.
    if (this.selection?.compression !== 'zstd' || !(error instanceof Error) || !/^adb: error: unexpected compression type zstd\s*$/.test(error.message)) return
    this.selection = { method: 'adb-pull', compression: 'default', fallbackReason: 'ADB rejected Zstd compression.' }
    return { ...this.selection }
  }
}
