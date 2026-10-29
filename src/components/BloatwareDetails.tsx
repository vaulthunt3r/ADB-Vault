import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import type { BadgeCheck } from '../../electron/app-details-protocol'
import { bloatwareAssessment } from '../lib/bloatware'

const fieldLabels: Record<string, string> = {
  get label() { return t("Application name") }, get description() { return t("Description") }, type: 'Category', get warning() { return t("Warning") },
  get dependencies() { return t("Depends on") }, get required_by() { return t("Required by") }, suggestions: 'Alternatives reference', get removal() { return t("Source value") },
}

export function BloatwareDetails({ check }: { check: BadgeCheck }) {
  const assessment = bloatwareAssessment(check)
  // Preserve unknown source values so a future database category is never presented as safe.
  const items = check.items.filter(item => item.name !== 'removal' || assessment.value === null)
  return <>
    <div className="bloatware-assessment" role="group" aria-label={t("Removal assessment from Android Debloat List")}>
      <span className="field-label">{t("Source assessment · Android Debloat List")}</span>
      <strong className={`status-badge ${assessment.tone}`}>{t(assessment.label)}</strong>
      <p>{message(assessment.description)}</p>
    </div>
    <dl className="app-badge-items">{items.map((item, index) => <div key={`${item.name}-${index}`}>
      <dt>{Object.hasOwn(fieldLabels, item.name) ? t(fieldLabels[item.name]) : item.name}</dt><dd>{item.value}</dd>
    </div>)}</dl>
    <p className="app-badge-attribution">{message(check.reason)}</p>
  </>
}
