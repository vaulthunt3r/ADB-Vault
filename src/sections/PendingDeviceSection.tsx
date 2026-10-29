import { t } from "../lib/i18n"
import { File, Grid2X2 } from 'lucide-react'
export function PendingDeviceSection({ section }: { section: 'apps' | 'files' }) {
  const Icon = section === 'apps' ? Grid2X2 : File
  return <section className="section-content"><div className="section-heading"><div><div className="eyebrow section-eyebrow">{t("DEVICE WORKSPACE")}</div><h1>{section === 'apps' ? t("Apps") : t("File Manager")}<span className="heading-period">.</span></h1><p>{t("Real device operations are not enabled in this section yet.")}</p></div></div><div className="device-required"><Icon size={32} /><h2>{t("Backend integration is pending")}</h2><p>{t("Components and Connection are live. This section will be connected in the next stage; it does not display sample data from your phone.")}</p></div></section>
}
