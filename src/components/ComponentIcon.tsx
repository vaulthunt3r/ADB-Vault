import { Database, Blocks, Cpu, Monitor, Terminal, Usb } from 'lucide-react'
import type { ComponentId } from '../lib/components'

const icons = { adb: Terminal, fastboot: Cpu, driver: Usb, runtime: Blocks, scrcpy: Monitor, geoip: Database, 'db-trackers': Database, 'db-libraries': Database, 'db-native': Database, 'db-bloatware': Database }
export function ComponentIcon({ id, large = false }: { id: ComponentId; large?: boolean }) {
  const Icon = icons[id]
  return <span className={`component-icon ${id} ${large ? 'large' : ''}`}><Icon size={large ? 25 : 21} strokeWidth={1.65} /></span>
}
