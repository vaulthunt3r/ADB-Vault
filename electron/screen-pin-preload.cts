const { ipcRenderer: pinIpc } = require('electron')
type PinState = { enabled: boolean; busy: boolean; error: string }
window.addEventListener('DOMContentLoaded', () => {
  const button = document.querySelector('button')!
  let received = false, pending = false, state: PinState = { enabled: false, busy: true, error: '' }
  const render = (value: PinState) => {
    state = value; button.disabled = value.busy || pending
    button.setAttribute('aria-pressed', String(value.enabled))
    button.setAttribute('aria-busy', String(value.busy || pending))
    button.dataset.error = String(!!value.error)
    button.title = value.error || (value.enabled ? 'Unpin this window' : 'Keep this window above other windows')
  }
  pinIpc.on('screen-pin:state', (_event: unknown, value: PinState) => { received = true; render(value) })
  void pinIpc.invoke('screen-pin:state').then((value: PinState) => { if (!received) render(value) }).catch((e: Error) => render({ ...state, busy: false, error: e.message }))
  button.addEventListener('click', async () => {
    if (pending || state.busy) return
    pending = true; render(state)
    try { state = await pinIpc.invoke('screen-pin:toggle') }
    catch (e) { state = { ...state, error: String(e) } }
    finally { pending = false; render(state) }
  })
})
