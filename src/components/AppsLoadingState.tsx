import { Bot } from 'lucide-react'
export function AppsLoadingState() {
  return <div className="device-required apps-reading">
    <div className="apps-reading-robot" aria-hidden="true"><Bot size={44} strokeWidth={1.6} /><span /></div>
    <h2>Reading applications</h2><p>The application list will appear here when reading finishes.</p>
  </div>
}
