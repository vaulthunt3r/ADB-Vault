// .cts compiles to .cjs for Electron's sandboxed preload context.
const { contextBridge, ipcRenderer, webUtils } = require('electron')
contextBridge.exposeInMainWorld('desktop', {
  apkPath: (file: File): string => webUtils.getPathForFile(file),
  writeClipboard: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),
  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:readText'),
  control: (command: 'minimize' | 'maximize' | 'close') => ipcRenderer.invoke('window:control', command),
  locate: (): Promise<string | null> => ipcRenderer.invoke('component:locate'),
  request: (request: unknown) => ipcRenderer.invoke('backend:request', request),
  subscribe: (listener: (event: unknown) => void) => {
    const handler = (_event: unknown, data: unknown) => listener(data)
    ipcRenderer.on('backend:event', handler)
    return () => ipcRenderer.removeListener('backend:event', handler)
  },
})
