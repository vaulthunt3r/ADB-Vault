const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('cameraDesk', {
  state: () => ipcRenderer.invoke('camera:state'),
  hide: () => ipcRenderer.invoke('camera:hide'),
  layout: (change: unknown) => ipcRenderer.invoke('camera:layout', change),
  onLayout: (listener: (layout: unknown) => void) => {
    const handler = (_event: unknown, layout: unknown) => listener(layout)
    ipcRenderer.on('camera:layout', handler)
    return () => ipcRenderer.removeListener('camera:layout', handler)
  },
  request: (request: unknown) => ipcRenderer.invoke('camera:request', request),
  subscribe: (listener: (session: unknown) => void) => {
    const handler = (_event: unknown, session: unknown) => listener(session)
    ipcRenderer.on('camera:state', handler)
    return () => ipcRenderer.removeListener('camera:state', handler)
  },
})
