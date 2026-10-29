import { message } from "../lib/i18n"
import { t } from "../lib/i18n"
import { Palette, RotateCcw } from 'lucide-react'
import { useAppearanceStore } from '../store/useAppearanceStore'
import { getActiveTheme } from '../lib/themes'
import { StatusLegend } from '../sections/AppearanceSection'

export function AppearanceInspector() {
  const { themeId, setTheme, terminalMode, terminalColor, terminalPinned } = useAppearanceStore()
  const theme = getActiveTheme(themeId, terminalMode, terminalColor)
  return <>
    <div className="inspector-section-label"><span className="eyebrow">{t("APPEARANCE")}</span></div>
    <div className="section-inspector-icon"><Palette size={25} /></div>
    <h2 className="section-inspector-title">{theme.name}</h2><p className="component-description">{message(theme.description)}</p>
    <dl className="metadata"><div><dt>{t("Mode")}</dt><dd>{theme.mode === 'dark' ? t("Dark") : t("Light")}</dd></div><div><dt>{t("Saving")}</dt><dd>{terminalMode ? terminalPinned ? t("Pinned across restarts") : t("This session only") : t("Automatic")}</dd></div></dl>
    <div className="appearance-inspector-swatches">{[['bg', t("Workspace")], ['sidebar', t("Sidebars")], ['selected', t("Selection")], ['accent', t("Accent")]].map(([key, label]) => {
      const color = key === 'sidebar' ? theme.navigationBackground ?? theme.colors[key] : theme.colors[key]
      return <div key={key}><i style={{ background: color }} /><span>{label}</span><code>{color}</code></div>
    })}</div>
    <StatusLegend /><div className="recovery-actions"><button className="button secondary" disabled={theme.id === 'sage'} onClick={() => setTheme('sage')}><RotateCcw size={14} />{t("Restore Soft Sage")}</button></div>
  </>
}
