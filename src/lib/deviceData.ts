export type DeviceId = 'pixel' | 'galaxy'
export type ConnectionStatus = 'available' | 'connecting' | 'connected' | 'disconnected' | 'unauthorized' | 'offline' | 'failed'
export type ConnectionMethod = 'USB' | 'Wi-Fi' | 'QR'
export type ConnectionScenario = 'normal' | 'unauthorized' | 'offline' | 'failure'
export interface DemoDevice { id: DeviceId; name: string; serial: string; android: string; method: ConnectionMethod; status: ConnectionStatus; endpoint: string; lastSeen: string; known: boolean }
export interface DemoApp { id: string; name: string; version: string; size: string; system: boolean; running: boolean }
export interface DemoFile { id: string; parent: string; name: string; kind: 'folder' | 'file'; size: string; modified: string; content?: string }
export interface DeviceWorkspace { apps: DemoApp[]; files: DemoFile[] }
export const demoDevices: DemoDevice[] = [
  { id: 'pixel', name: 'Pixel 8', serial: '32081FDH2002', android: '15', method: 'USB', status: 'available', endpoint: "USB · Port 1", lastSeen: "Available now", known: true },
  { id: 'galaxy', name: 'Galaxy S23', serial: 'R5CW20DEMO', android: '14', method: 'Wi-Fi', status: 'disconnected', endpoint: '192.168.1.42:5555', lastSeen: "Yesterday, 18:42", known: true },
]

export function createDeviceWorkspace(): DeviceWorkspace {
  return {
    apps: [
      { id: 'com.android.settings', name: 'Settings', version: '15', size: "42 MB", system: true, running: true },
      { id: 'com.google.android.GoogleCamera', name: 'Camera', version: '9.6', size: "186 MB", system: true, running: false },
      { id: 'com.android.chrome', name: 'Chrome', version: '131.0', size: "248 MB", system: false, running: false },
      { id: 'org.telegram.messenger', name: 'Telegram', version: '11.4', size: "164 MB", system: false, running: true },
      { id: 'com.spotify.music', name: 'Spotify', version: '8.9', size: "112 MB", system: false, running: false },
      { id: 'com.google.android.documentsui', name: 'Files', version: '15', size: "18 MB", system: true, running: false },
    ],
    files: [
      { id: 'dcim', parent: 'root', name: 'DCIM', kind: 'folder', size: '—', modified: "Today, 10:24" },
      { id: 'download', parent: 'root', name: 'Download', kind: 'folder', size: '—', modified: "Today, 09:18" },
      { id: 'documents', parent: 'root', name: 'Documents', kind: 'folder', size: '—', modified: "Yesterday, 17:03" },
      { id: 'music', parent: 'root', name: 'Music', kind: 'folder', size: '—', modified: "Sep 21, 14:06" },
      { id: 'welcome', parent: 'root', name: 'Readme.txt', kind: 'file', size: "1 KB", modified: "Today, 10:00", content: 'Welcome to your demo device.\n\nThese files only exist in this prototype. Uploads, downloads, renaming, and deletion never touch your computer or a real phone.' },
      { id: 'camera', parent: 'dcim', name: 'Camera', kind: 'folder', size: '—', modified: "Today, 10:24" },
      { id: 'photo', parent: 'camera', name: 'IMG_20260925_102400.jpg', kind: 'file', size: '3.8 MB', modified: "Today, 10:24" },
      { id: 'pdf', parent: 'download', name: 'Travel-notes.pdf', kind: 'file', size: "248 KB", modified: "Today, 09:18" },
      { id: 'notes', parent: 'documents', name: 'Notes.txt', kind: 'file', size: "2 KB", modified: "Yesterday, 17:03", content: "Demo notes\n\n• Test a connection\n• Browse applications\n• Explore file operations" },
    ],
  }
}

export function folderTrail(files: DemoFile[], folder: string): { id: string; name: string }[] {
  const trail = [{ id: 'root', name: 'Internal storage' }]
  let current = files.find(file => file.id === folder)
  const ancestors: { id: string; name: string }[] = []
  while (current) { ancestors.unshift({ id: current.id, name: current.name }); current = files.find(file => file.id === current!.parent) }
  return [...trail, ...ancestors]
}
export function validEndpoint(host: string, port: string) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) && host.split('.').every(part => Number(part) <= 255) && /^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535
}
