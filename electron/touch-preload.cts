const { contextBridge: touchContext, ipcRenderer: touchIpc } = require('electron')
touchContext.exposeInMainWorld('touchDesk', {
  state: () => touchIpc.invoke('touch:state'),
  setAlwaysOnTop: (enabled: unknown) => touchIpc.invoke('touch:always-on-top', enabled),
  profiles: (orientation: unknown, profiles?: unknown) => touchIpc.invoke('touch:profiles', orientation, profiles),
  frame: (epoch: unknown, points: unknown) => touchIpc.send('touch:frame', epoch, points),
  input: (epoch: unknown, input: unknown) => touchIpc.invoke('touch:input', epoch, input),
  close: () => touchIpc.invoke('touch:close'),
  subscribe: (listener: (state: unknown) => void) => {
    const handler = (_event: unknown, state: unknown) => listener(state)
    touchIpc.on('touch:state', handler); return () => touchIpc.removeListener('touch:state', handler)
  },
  onFocus: (listener: (focused: boolean) => void) => {
    const handler = (_event: unknown, focused: boolean) => listener(focused)
    touchIpc.on('touch:focus', handler); return () => touchIpc.removeListener('touch:focus', handler)
  },
})
