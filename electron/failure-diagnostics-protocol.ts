export interface FailureDiagnostic {
  id: string; operationId: string; createdAt: string; updatedAt: string
  title: string; deviceId: string; deviceName: string; userId: number; profileName: string
  status: 'running' | 'partial' | 'error' | 'cancelled'; message: string; cause: string
  packageName?: string; appLabel?: string; stage: string; failed: number; total: number
  saved: boolean; saveError?: string
}
export interface DiagnosticCommand {
  startedAt: string; finishedAt?: string; executable: string; args: string[]; stage: string
  packageName?: string; elapsedMs?: number; code?: number; error?: string; stdout?: string; stderr?: string
}
export interface DiagnosticObservation {
  at: string; connection: { activeDeviceId: string | null; status?: string; serial?: string; transportId?: string; method?: string }
  processes?: { pid: number; parentPid: number; startedAt: string; server: boolean }[]; processError?: string
}
export interface FailureDiagnosticReport {
  format: 'adb-vault-failure-diagnostic'; version: 1; summary: FailureDiagnostic
  environment: { platform: string; arch: string; electron?: string; appVersion: string; zstd: boolean }
  commands: DiagnosticCommand[]; observations: DiagnosticObservation[]
  failures: { packageName: string; label: string; message?: string }[]
  adbLog: { path: string; tail?: string; error?: string }; notes: string[]
}
