import { Activity, AppWindow, BookUser, Cable, Camera, Clipboard, ClipboardList, FileDown, FileInput, FileOutput, FileSearch, FolderOpen, ListChecks, ListTodo, MessageSquare, MonitorSmartphone, Moon, Phone, Power, RefreshCw, RotateCw, ScanLine, Search, Settings2, ShieldCheck, SlidersHorizontal, Sun, Unplug, Usb } from 'lucide-react'
import type { ToolbarActionId, ToolbarScope } from '../lib/toolbar'

const icons = { workspace: ListChecks, screenshot: ScanLine, mirror: MonitorSmartphone, screenOptions: Settings2, virtualDisplay: AppWindow, openWindows: AppWindow, camera: Camera, cameraControls: SlidersHorizontal, wake: Sun, sleep: Moon, logcat: ClipboardList, bugreport: FileDown, tasks: ListTodo, activity: Activity, connection: Cable,
  restart: RotateCw, powerOff: Power, clipboard: Clipboard, contacts: BookUser, calls: Phone, sms: MessageSquare, root: ShieldCheck, deviceInfo: RefreshCw, reconnect: RefreshCw, disconnect: Unplug, findDevices: Search, fastboot: Usb, localApks: FileSearch, install: FileInput, backup: FileOutput, restore: FolderOpen }
export function ToolbarActionIcon({ id, scope, size = 18 }: { id: ToolbarActionId; scope?: ToolbarScope; size?: number }) {
  const Icon = id === 'workspace' && scope === 'apps' ? RefreshCw : icons[id]
  return <Icon size={size} aria-hidden="true" />
}
