import { t } from "../lib/i18n"
import { Pin } from 'lucide-react'
import './window-pin-button.css'

export function WindowPinButton({ enabled, disabled, compact, onClick }: { enabled?: boolean; disabled?: boolean; compact?: boolean; onClick: () => void }) {
  return <button className={`button secondary window-pin${enabled ? " window-pinned" : ''}`} aria-label={t("Always on top")} aria-pressed={!!enabled} disabled={disabled} title={enabled ? t("Pinned above other windows · click to unpin") : t("Keep this window above other windows")} onClick={onClick}><Pin size={16} />{!compact && t("Always on top")}</button>
}
