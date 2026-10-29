export interface ConfirmationApplication {
  label: string; packageName: string; iconPng?: string | null; system?: boolean
  note?: string; skipped?: boolean
}
export interface ConfirmationContent {
  title: string
  confirmLabel: string
  tone: 'danger' | 'warning' | 'normal'
  description: string
  context?: { label: string; value: string }[]
  applications?: ConfirmationApplication[]
  selection?: { total: number; affected: number; skipped: number }
  effects: string[]
  warnings?: string[]
  details?: string[]
  termsUrl?: string
}
export interface ConfirmationPrompt extends ConfirmationContent { id: string }
export interface ConfirmationState { revision: number; prompt: ConfirmationPrompt | null }
