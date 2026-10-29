import type { BadgeCheck } from '../../electron/app-details-protocol'

export const bloatwareAssessments = [
  { value: 'delete', label: 'Removal allowed', tone: 'success', badgeTone: 'green', description: 'The source lists this package as removable. Review its description and dependencies for your device.' },
  { value: 'replace', label: 'Replacement required', tone: 'info', badgeTone: 'blue', description: 'The source recommends replacing this application before removing it.' },
  { value: 'caution', label: 'Use caution', tone: 'warning', badgeTone: 'orange', description: 'Removal may affect other features. Review the warnings and dependencies below.' },
  { value: 'unsafe', label: 'Unsafe to remove', tone: 'error', badgeTone: 'red', description: 'The source warns that removing this package can break system functions.' },
] as const
const unavailable = { value: null, label: 'Assessment unavailable', tone: 'neutral', badgeTone: 'neutral', description: 'The source does not provide a recognised removal assessment. Inclusion in the database alone does not mean this application is safe to remove.' } as const

export function bloatwareAssessment(check?: BadgeCheck | null) {
  const value = check?.items.find(item => item.name === 'removal')?.value
  return check?.present === true ? bloatwareAssessments.find(assessment => assessment.value === value) ?? unavailable : unavailable
}
