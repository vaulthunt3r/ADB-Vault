import { t } from "../lib/i18n"
import { Bot } from 'lucide-react'
export function AppsLoadingState() {
  return <div className="device-required apps-reading">
    <div className="apps-reading-robot" aria-hidden="true"><Bot size={44} strokeWidth={1.6} /><span /></div>
    <h2>{t("Reading applications")}</h2><p>{t("The application list will appear here when reading finishes.")}</p>
  </div>
}
