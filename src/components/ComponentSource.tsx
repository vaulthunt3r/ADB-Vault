import { t } from "../lib/i18n"
import { Copy } from 'lucide-react'
import type { ComponentRecord } from '../../electron/contracts'
import { requestBackend } from '../lib/backend'
import { copyText } from '../lib/clipboard'
import { useAppStore } from '../store/useAppStore'

export function ComponentSource({ component }: { component: ComponentRecord }) {
  if (!component.sourceUrl) return null
  const sourceUrl = component.sourceUrl
  return <div className="component-source">
    <dt>{t("Source")}</dt>
    <dd>
      <a className="component-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer" title={t("Open source in browser")} onClick={event => {
        if (window.desktop) {
          event.preventDefault()
          void requestBackend({ type: 'components.source', id: component.id })
        }
      }}><span>{sourceUrl}</span></a>
      <button className="icon-button" aria-label={t("Copy source URL")} title={t("Copy source URL")} onClick={() => void copyText(sourceUrl).then(
        () => useAppStore.getState().notify("Copied"),
        () => useAppStore.getState().notify("Could not copy to the clipboard."),
      )}><Copy size={14} aria-hidden="true" /></button>
    </dd>
  </div>
}
