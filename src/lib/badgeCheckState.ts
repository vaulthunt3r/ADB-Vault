import type { BadgeCheck } from '../../electron/app-details-protocol'
import type { BadgeKey } from './appDetails'

export function badgeCheckState(key: BadgeKey, check: BadgeCheck, rootEnabled: boolean) {
  if (check.present !== null) return check.present ? "Present" : "Not present"
  if (key === 'magiskHide') return "Not supported"
  if (/unsupported|not supported|not implemented|requires Android|requires API|requires a supported|supported Magisk installation not detected|NoSuchMethod|NoSuchField|ClassNotFoundException|keystore_cli_v2.*(?:not found|inaccessible)/i.test(check.reason)) return "Not supported"
  const rootChecks = ['ssaid', 'keyStore', 'magiskDenyList', 'systemless', 'hidden', 'saf']
  if (!rootEnabled && rootChecks.includes(key)) return "Root required"
  if (rootEnabled && rootChecks.includes(key) && /^Enable (?:root|Settings)/.test(check.reason)) return "Not checked"
  if (/root (?:was unavailable|access was not granted)|allow Shell in your root manager/i.test(check.reason)) return "Root access required"
  if (/permission|access denied|securityexception|not allowed/i.test(check.reason)) return "Access denied"
  if (/not collected|not been collected|not been checked|not checked|has not run|not run/i.test(check.reason)) return "Not checked"
  return "Unavailable"
}
