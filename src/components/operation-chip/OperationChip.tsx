import { useEffect, useId, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, CircleAlert, Clock3, Pause, Square, X } from 'lucide-react'
import './operation-chip.css'

// Adapted from React Bits Call Chip and Lattice Loader (David Haz).
// See third-party-notices/react-bits.txt. Progress is measured, never simulated.
export interface OperationChipProps {
  label: string
  message?: string
  status?: string
  statusText?: string
  progress?: number
  measurement?: string
  progressLabel?: string
  unknownText?: string
  startedAt?: number
  icon?: ReactNode
  accessibleLabel?: string
  onOpen?: () => void
  layout?: 'inline' | 'panel' | 'toolbar'
  trailing?: ReactNode
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return <span className="operation-chip__timer" title="Elapsed time (including waits)" aria-label={`Elapsed time: ${time}`} aria-live="off">{time}</span>
}

export function LatticeLoader() {
  return <span className="lattice-loader" aria-hidden="true">
    {[1, 2, 3, 0, 1, 2, 1, 2, 3].map((step, index) => <span className="lattice-loader__cell" key={index} style={{ animationDelay: `${step * 120 - 864}ms` }} />)}
  </span>
}

export function OperationChip({ label, message, status = 'running', statusText = 'Running', progress, measurement, progressLabel = 'Overall operation progress', unknownText = 'Total not yet known', startedAt, icon, accessibleLabel, onOpen, layout = 'inline', trailing }: OperationChipProps) {
  const descriptionId = useId()
  const measured = progress !== undefined && Number.isFinite(progress)
  const percent = measured ? Math.min(100, Math.max(0, progress)) : undefined
  const working = status === 'running'
  const finished = ['success', 'partial', 'error', 'cancelled', 'interrupted'].includes(status)
  const glyph = status === 'success' ? <Check />
    : ['error', 'partial', 'attention', 'interrupted'].includes(status) ? <CircleAlert />
      : status === 'paused' ? <Pause /> : status === 'queued' ? <Clock3 />
        : status === 'stopping' ? <Square /> : status === 'cancelled' ? <X />
          : working && !measured ? <LatticeLoader /> : icon
  const phase = (!finished || layout === 'panel') && statusText !== 'Running' && statusText !== label ? statusText : undefined
  const content = <>
      <span className="operation-chip__glyph" aria-hidden="true">{glyph}</span>
      <span className="operation-chip__content">
        <span className="operation-chip__heading"><span className="operation-chip__label">{label}</span>
          {measurement && layout !== 'toolbar' && <span className="workspace-progress-measure">{measurement}</span>}
          {phase && <span className="operation-chip__phase">{phase}</span>}
        </span>
        {layout === 'toolbar' && measurement ? <span className="workspace-progress-measure">{measurement}</span> : message && message !== label && message !== phase && <span className="operation-chip__message">{message}</span>}
      </span>
      {!finished && startedAt !== undefined && Number.isFinite(startedAt) && <Elapsed startedAt={startedAt} />}
  </>
  const title = [label, phase && phase, message, measurement ? measurement : !finished ? unknownText : ''].filter(Boolean).join('\n')
  return <div className="operation-chip" data-status={status} data-measured={measured} data-layout={layout} data-interactive={!!onOpen}
    role={onOpen ? undefined : 'group'} aria-label={onOpen ? undefined : accessibleLabel ? accessibleLabel : label} aria-describedby={onOpen ? undefined : descriptionId}>
    {measured && <span className="operation-chip__progress" role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={measurement || ''}>
      <span className="call-chip__fill" style={{ '--chip-fraction': (percent ?? 0) / 100 } as CSSProperties} aria-hidden="true" />
    </span>}
    {onOpen ? <button type="button" className="workspace-progress-open operation-chip__open" onClick={onOpen} aria-label={accessibleLabel ? accessibleLabel : label} aria-describedby={descriptionId} title={`${title}\nShow details`}>{content}</button> : <div className="operation-chip__open" title={title}>{content}</div>}
    {trailing && <span className="operation-chip__actions">{trailing}</span>}
    <span className="operation-chip__sr" id={descriptionId}>{statusText}</span>
    {!measured && !finished && <span className="operation-chip__sr">{unknownText}</span>}
  </div>
}
