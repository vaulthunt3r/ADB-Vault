import { ActionIndicator } from './ui'
import { AppVirtualDisplayAction } from './AppVirtualDisplayAction'
import { FileOutput, Pause, Play, Power, Square, Trash2 } from 'lucide-react'
import { batchActionIds, batchActionLabels, batchSkipReason } from '../../electron/app-actions-protocol'
import { useAppsStore } from '../store/useAppsStore'
import { useAppsSelectionStore } from '../store/useAppsSelectionStore'
import { requestBackend } from '../lib/backend'
import { openAppsBackup } from '../lib/appPresets'
import { AppsClearActions } from './AppsClearActions'
import { Fragment, useEffect, useState } from 'react'
import { KeepAppData, PackageActionBadge, PackageActionControls } from './PackageActionControls'
import { packageActionIds, type PackageAction, type PackageActionOptions } from '../../electron/package-actions-protocol'


export function AppsBatchActions({ ready }: { ready: boolean }) {
  const { apps, deviceId, userId } = useAppsStore(), { packages, clear } = useAppsSelectionStore()
  const chosen = apps.filter(a => packages.has(a.packageName))
  const [options, setOptions] = useState<PackageActionOptions>({})
  const [keepData, setKeepData] = useState(false)
  useEffect(() => { setOptions({}); setKeepData(false) }, [deviceId, userId])
  return <>
    <h3>{"Selected "}{chosen.length}{" applications"}</h3>
    <p className="apps-filter-help">Actions apply to checked rows, including those hidden by filters.</p>
    <PackageActionControls value={options} onChange={setOptions} disabled={!ready} />
    <div className="apps-action-group">
      {chosen.length === 1 && <AppVirtualDisplayAction app={chosen[0]} ready={ready} />}
      <button className="button secondary" disabled={!ready || !chosen.length} onClick={() => openAppsBackup('marked', true)}><FileOutput size={15} />Backup ({chosen.length})<ActionIndicator /></button>
      {batchActionIds.filter(action => !action.startsWith('clear-')).map(action => {
        const eligible = chosen.filter(a => !batchSkipReason(action, a, apps)).length, skipped = chosen.length - eligible
        const Icon = action === 'force-stop' ? Square : action === 'suspend' ? Pause : action === 'unsuspend' ? Play : action === 'enable' || action === 'disable' ? Power : Trash2
        const actionOptions = packageActionIds.includes(action as PackageAction) ? { ...options, ...(action === 'uninstall' ? { keepData } : {}) } : undefined
        return <Fragment key={action}>
          {action === 'uninstall' && <KeepAppData checked={keepData} disabled={!ready} onChange={setKeepData} />}
          <button className={`button secondary ${action === 'uninstall' ? 'app-action-destructive' : ''}`} disabled={!ready || !eligible} title={`${eligible} will run${skipped ? ` · ${skipped} skipped (already in this state or unavailable)` : ''}`} onClick={() => void requestBackend({ type: 'apps.batchAction', plan: { id: deviceId!, userId: userId!, packages: chosen.map(a => a.packageName), action, options: actionOptions } })}><Icon size={15} />{batchActionLabels[action]} ({eligible}){skipped > 0 && <small> · {skipped}{" skipped"}</small>}</button>
          {actionOptions && <PackageActionBadge apps={chosen} action={action as PackageAction} options={actionOptions} />}
        </Fragment>
      })}
      <AppsClearActions key={`${deviceId}:${userId}:${chosen.map(a => a.packageName).sort().join(',')}`} chosen={chosen} ready={ready} options={options} />
    </div>
    <button className="text-button" disabled={!ready} onClick={clear}>Clear selection</button>
  </>
}
