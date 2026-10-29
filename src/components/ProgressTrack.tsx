export function ProgressTrack({ completed, total, label, text }: { completed?: number; total?: number; label: string; text?: string }) {
  const percent = total && total > 0 && completed !== undefined ? Math.max(0, Math.min(100, completed / total * 100)) : undefined
  return <div className={`operation-progress-track${percent === undefined ? " indeterminate" : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={text}><span style={percent === undefined ? undefined : { width: `${percent}%` }} /></div>
}
