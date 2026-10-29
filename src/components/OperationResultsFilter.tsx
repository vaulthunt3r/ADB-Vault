import { t } from "../lib/i18n"
import { CircleAlert } from 'lucide-react'

export function OperationResultsFilter({ total, failed, onlyFailed, onChange }: {
  total: number; failed: number; onlyFailed: boolean; onChange: (value: boolean) => void
}) {
  if (!failed) return null
  return <div className="operation-results-filter" role="group" aria-label={t("Filter application results")}>
    <button className="button secondary" aria-pressed={!onlyFailed} onClick={() => onChange(false)}>{t("All (")}{total})</button>
    <button className="button secondary result-failure-toggle" aria-pressed={onlyFailed} onClick={() => onChange(true)}><CircleAlert size={14} aria-hidden="true" />{t("Failed (")}{failed})</button>
  </div>
}
