/// <reference types="vite/client" />
import type { DesktopBridge } from '../electron/contracts'
declare global { interface Window { desktop?: DesktopBridge; cameraDesk?: import('../electron/screen-protocol').CameraPanelBridge; touchDesk?: import('../electron/touch-protocol').TouchBridge } }
export {}
