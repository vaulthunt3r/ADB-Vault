import { File, Grid2X2 } from 'lucide-react'
export function PendingDeviceSection({ section }: { section: 'apps' | 'files' }) {
  const Icon = section === 'apps' ? Grid2X2 : File
  return <section className="section-content"><div className="section-heading"><div><div className="eyebrow section-eyebrow">DEVICE WORKSPACE</div><h1>{section === 'apps' ? "Apps" : "File Manager"}<span className="heading-period">.</span></h1><p>Real device operations are not enabled in this section yet.</p></div></div><div className="device-required"><Icon size={32} /><h2>Backend integration is pending</h2><p>Components and Connection are live. This section will be connected in the next stage; it does not display sample data from your phone.</p></div></section>
}
