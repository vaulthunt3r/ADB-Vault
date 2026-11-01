import type { BadgeCheck } from '../../electron/app-details-protocol'
import { bloatwareAssessment } from '../lib/bloatware'

const fieldLabels: Record<string, string> = {
  label: "Application name", description: "Description", type: 'Category', warning: "Warning",
  dependencies: "Depends on", required_by: "Required by", suggestions: 'Alternatives reference', removal: "Source value",
}

export function BloatwareDetails({ check }: { check: BadgeCheck }) {
  const assessment = bloatwareAssessment(check)
  // Preserve unknown source values so a future database category is never presented as safe.
  const items = check.items.filter(item => item.name !== 'removal' || assessment.value === null)
  return <>
    <div className="bloatware-assessment" role="group" aria-label="Removal assessment from Android Debloat List">
      <span className="field-label">Source assessment · Android Debloat List</span>
      <strong className={`status-badge ${assessment.tone}`}>{assessment.label}</strong>
      <p>{assessment.description}</p>
    </div>
    <dl className="app-badge-items">{items.map((item, index) => <div key={`${item.name}-${index}`}>
      <dt>{Object.hasOwn(fieldLabels, item.name) ? fieldLabels[item.name] : item.name}</dt><dd>{item.value}</dd>
    </div>)}</dl>
    <p className="app-badge-attribution">{check.reason}</p>
  </>
}
