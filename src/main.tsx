import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { CameraPanel } from './components/CameraPanel'
import { TouchPanel } from './components/TouchPanel'
import './styles.css'
import './workspace.css'
import './appearance.css'
import './apps.css'
import './density.css'
import './diagnostics.css'
import './monitor.css'
import { applyTheme, applyZenMode, applyCornerStyle, getActiveTheme } from './lib/themes'
import { useAppearanceStore } from './store/useAppearanceStore'

// Remove the preference left by early development builds, including in detached windows.
try { localStorage.removeItem('adb-vault-language') } catch { /* Storage may be unavailable. */ }

applyTheme(getActiveTheme(useAppearanceStore.getState().themeId, useAppearanceStore.getState().terminalMode, useAppearanceStore.getState().terminalColor))
applyZenMode(useAppearanceStore.getState().zenMode)
applyCornerStyle(useAppearanceStore.getState().cornerStyle)

function AppRoot() {
  return window.location.hash.startsWith('#camera-session=') ? <CameraPanel /> : window.location.hash.startsWith('#touch-session=') ? <TouchPanel /> : <App />
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AppRoot /></React.StrictMode>)
import './web-services.css'

import './files.css'

import './android-diagnostics.css'
import './theme-variants.css'
import './theme-families.css'
import './zen.css'
import './terminal-mode.css'
