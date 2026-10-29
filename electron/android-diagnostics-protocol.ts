import type { DeviceRecord } from './contracts.js'

export type DiagnosticTarget = Pick<DeviceRecord, 'id' | 'serial' | 'transportId'>
export type AndroidDiagnosticKind = 'logcat' | 'bugreport' | 'battery'
export type LogBuffer = 'default' | 'crash'
export interface AndroidDiagnosticJob {
  id: string; kind: AndroidDiagnosticKind; target: DiagnosticTarget; deviceName: string
  status: 'running' | 'success' | 'error' | 'cancelled'; message: string; startedAt: string; endedAt?: string
  output?: string
}
export interface AndroidLogLine { time: string; pid: string; tid: string; level: string; tag: string; message: string }
export interface AndroidLogSnapshot {
  target: DiagnosticTarget; capturedAt: string; buffer: LogBuffer; lines: AndroidLogLine[]; limit: number; raw: string
}
export interface BatteryUsageRow {
  uid: number; packages: string[]; estimatedMah: number | null; partialMs: number | null; backgroundMs: number | null
  wakeups: number | null; wakelocks: { name: string; milliseconds: number; count: number | null }[]
  alarms: { name: string; count: number }[]
}
export interface BatteryUsageSnapshot {
  target: DiagnosticTarget; capturedAt: string; rows: BatteryUsageRow[]; issues: string[]
}
export interface AndroidDiagnosticsState {
  job: AndroidDiagnosticJob | null; logcat: AndroidLogSnapshot | null; battery: BatteryUsageSnapshot | null
}
export type AndroidDiagnosticsRequest =
  | { type: 'androidDiagnostics.start'; kind: AndroidDiagnosticKind; target: DiagnosticTarget; buffer?: LogBuffer }
  | { type: 'androidDiagnostics.cancel' | 'androidDiagnostics.reveal'; jobId: string }
  | { type: 'androidDiagnostics.exportLog'; capturedAt: string }
