# About application: badge audit

Updated 2026-10-04. The catalogue has **29 entries: 28 with collection paths and 1 with an unimplemented collector (MagiskHide).** This includes Overlay and a separate Systemless indicator. This does not mean every collected tag works on every Android version, profile or firmware. Permission denial and unsupported APIs remain unavailable, never a negative result.

**Systemless** is shown separately from the Android User/System flags, with active Magisk mount evidence. A catalogue entry, legend description or colour setting alone does not implement detection.

## Reference sources

- [Official manual, section 2.2.2.2 Tags](https://muntashir.dev/AppManager/en/)
- [PackageUtils: usesPlayAppSigning](https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/java/io/github/muntashirakon/AppManager/utils/PackageUtils.java)
- [AppInfoViewModel: collection and conditions](https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/java/io/github/muntashirakon/AppManager/details/info/AppInfoViewModel.java)
- [AppInfoFragment: tags, dialogs and colour selection](https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/java/io/github/muntashirakon/AppManager/details/info/AppInfoFragment.java)
- [Android 10 execution restrictions](https://developer.android.com/about/versions/10/behavior-changes-10#execute-permission)
- [AOSP PackageInfo: overlay metadata](https://github.com/aosp-mirror/platform_frameworks_base/blob/master/core/java/android/content/pm/PackageInfo.java)
- [AOSP ActivityManagerService: process visibility](https://github.com/aosp-mirror/platform_frameworks_base/blob/master/services/core/java/com/android/server/am/ActivityManagerService.java)
- [App Manager semantic colours](https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/java/io/github/muntashirakon/AppManager/utils/appearance/ColorCodes.java) and [base palette](https://github.com/MuntashirAkon/AppManager/blob/master/libcore/ui/src/main/res/values/colors.xml)

These are moving upstream references, consulted on the audit date. Collectors are independently implemented. Dataset revisions are pinned separately in `electron/data/app-manager/NOTICE.md`.

## Coverage in ADB Vault

“Collected” means a real query or analysis exists, subject to device access. “Partial” identifies a known difference from upstream. Checks do not change blocking rules, permissions or backups.

| Badge | Current implementation | Remaining work / limitation |
| --- | --- | --- |
| Tracker info | Collected from unique manifest components matched to tracker signatures; click for evidence. | Android disabled state is used, not App Manager's private rule store. Deep DEX/native findings are separate; see `DETECTION.md`. |
| Application type | Partial: User, System, Updated system from framework flags. | Systemless is a separate indicator here. Updated system is combined here; upstream can show Updated app separately. |
| Systemless | Root: installed source APK and active module APK have the same filesystem device/inode. | Disabled, removed and skip_mount modules are excluded. Custom mount schemes and updated APKs outside the mounted system path are not classified. |
| Split APK info | Partial: split count, names, paths and available sizes. | No classification by language, density or ABI. Base APK is excluded from the count. |
| Debuggable | Collected from Android flag. | Not proof of an attached debugger. |
| Test only | Collected from Android flag. | No collector gap identified. |
| No code | Collected from absence of HAS_CODE. | No collector gap identified. |
| Large heap | Collected from Android request flag. | Not measured memory use. |
| Open links | Partial: profile-specific Android 12+ domain state and supported hosts. | Our red state requires allowed handling and a selected/verified domain. Upstream uses the handling flag for colour; these can differ. |
| Running | Collected from processes and live services, matched by exact package and Android profile. | Cached processes count. Missing full visibility or a failed query yields unavailable unless the other query found positive evidence. Snapshot only, not a live monitor. No dumpsys fallback on restricted devices yet. |
| Stopped | Collected from Android stopped flag. | Independent of process lifetime. |
| Disabled | Collected from profile-specific enabled state. | No Enabled badge is added. |
| Suspended | Collected from Android suspended flag; Freeze/Unfreeze actions manage Android suspension. | Separate from Disabled; suspension does not guarantee that background services stop. |
| Personal | User-created coloured labels and notes, shared by package name across phones. | User observations, not detection or safety verdicts. Original phone, profile, app version and timestamps are retained; manage through Personal or Apps → Personal database. |
| Hidden | Collected using profile-specific PackageManager query. | Permission refusal is unavailable. |
| MagiskHide | Unimplemented. | Needs supported Magisk integration and privileged/root access; installed Magisk alone is insufficient. |
| MagiskDenyList | Root: exact package/process membership from Magisk CLI; enforcement state in evidence. | Modern Magisk only; a saved rule does not imply enforcement. Package rules can apply across profiles. |
| WX | Collected using Android API 29+ with Target SDK below 29. Dialog shows both API levels. | Compatibility rule for execution from the app directory, not a measurement of memory mappings or exploitation. Invalid API data remains unavailable. |
| Bloatware | Collected by exact package match in Android Debloat List. | Evidence includes classification, warnings, dependencies and alternatives. System status alone is not bloatware evidence. |
| KeyStore | Root: Android 12+ system keystore_cli_v2 as the selected UID; older systems expose only matching legacy entry filenames. | Unsupported/missing CLI or denied access is unavailable. Shared-UID packages share entries. No key material is collected. Legacy path not hardware-tested. |
| Backup | Local catalogue of published APK/APKS and Data/Cache/OBB/Media TAR exports, including entries in group ZIP archives. Matched by stable device identity, Android user and package; click for saved components, version, timestamp and path. | Only completed components count, including those retained from partial jobs. Presets and absent/failed components do not count. Presence, size and modification time are rechecked every 10 seconds and on detail/badge opening or Apply; no repeated content hashing. Missing/modified files are excluded, prior unindexed exports are not scanned. No root required. |
| No battery optimisation | Collected using PowerManager exemption query. | OEM/permission restrictions may limit access. |
| Sensors disabled | Collected from SensorService UID state. | UID idle is not necessarily an explicit user restriction; shared UID affects interpretation. |
| Net policy | Collected using NetworkPolicyManager; numeric/symbolic evidence. | Permission-dependent and shared by apps using the same UID. |
| SSAID | Root: existing UID record from the selected user's settings_ssaid.xml, including Android binary XML support. | Never exposes the system userkey, substitutes the shell ID, creates or resets an identifier. Shared-UID apps may share a record. |
| SAF | Collected using persisted URI grants for package/user. | Missing privileged permission is unavailable. |
| Play App Signing | Collected from the exact manifest stamp pair; click for both fields. | Heuristic only; see below. No root or extra database needed. |
| Xposed | Partial: legacy metadata and modern Xposed entries in installed APKs. | Possible module, not activation. No claim of parity with all upstream module details. |
| Static Shared Library | Partial: framework ApplicationInfo query. | Enumeration of installed library versions is missing. |
| Overlay | Collected from framework overlay target. Dialog: target, overlayable name, category, priority, static flag. | Resource overlay, not draw-over-apps permission. Does not claim current activation. Optional field failures do not hide a confirmed target. |

The remaining unimplemented catalogue entry is legacy MagiskHide. Backup now uses ADB Vault's own export catalogue. Root enables the implemented privileged collectors; it does not imply that a badge is present.

## Play App Signing rule

The helper requests metadata for the selected Android profile and checks both values exactly:

| Manifest key | Required value |
| --- | --- |
| `com.android.stamp.type` | `STAMP_TYPE_DISTRIBUTION_APK` |
| `com.android.stamp.source` | `https://play.google.com/store` |

This follows the upstream metadata heuristic. Matching markers suggest possible Play App Signing. They do not authenticate an APK, validate its certificate or cryptographically verify a source stamp. Installer identity is not consulted. Missing or different markers do not prove that Play App Signing was not used.

- Both strings match: show the badge and evidence dialog.
- Missing or different strings: no badge; the legend reports a negative result for this marker check.
- Unexpected types or read failure: no badge; the legend reports unavailable.

Evidence values are bounded to 512 characters before display. No APK upload, permission grant, remote lookup or device configuration change is needed. Refresh details after updating the desktop app; the helper hash causes the new JAR to be transferred when needed.

## Colours and interaction

Trackers default to orange, or dark cyan when all matched components are confirmed disabled in Android. Open links uses red/dark cyan/neutral under the conditions above. WX uses red, Running purple, and Overlay neutral, following the upstream colour roles. Running uses the upstream light palette value #EA80FC with black text; WX uses ADB Vault's existing accessible red. Bloatware reflects the Android Debloat List removal assessment: `delete` green, `replace` blue, `caution` orange, `unsafe` red; missing or unknown assessments stay neutral. The tooltip and evidence dialog retain the assessment text and source warnings. Zero Cool uses coloured text on black for these variants. Custom overrides win outside Zero Cool. Other tags currently have neutral defaults. **This is not full colour/theme parity with App Manager**, which has additional rules and separate dark resources.

Settings → Badges offers 38 persisted overrides across the 29 catalogue entries and their variants, plus 5 General filter choices. The four recognised Bloatware assessments have independent overrides; the original `bloatware` override remains for the generic filter and unknown assessment. Existing saved overrides are preserved. Colours do not change detection. The legend lists meanings and per-app results; evidence opens in a modal without accordions. Details navigation is unchanged.

Each variant now has independent background and text overrides. Auto preserves theme/default text when no background override exists and chooses black/white contrast for a custom background. Custom permits any text color, including white; switching back to Auto removes only the text override. Per-badge/all reset removes both. Old saved background colors are preserved. Legend results distinguish missing root, unsupported collectors/APIs, denied access and checks not yet run from confirmed absence; reasons remain visible.

## Follow-up priorities (not implemented by this change)

1. Without root: remaining split/library metadata; consider a read-only fallback for Running when framework visibility is restricted.
2. Visual parity: compare upstream semantic colour rules and themes, then agree on defaults without overwriting user overrides.
3. Privileged compatibility: legacy KeyStore hardware validation, other Android versions and custom mount systems; MagiskHide remains unimplemented.
4. Backup: implemented for newly registered APK/APKS exports; data/cache/OBB/media are supported; historical export indexing and restoration remain future work.

## Validation

`npm run helper:build` builds the helper. `npm run test:play-signing` exercises the actual Java classifier for positive, absent, partial, malformed and near-match metadata, plus evidence bounds. Backend protocol tests preserve true/false/unavailable states. Renderer tests cover evidence, keyboard close/focus return, absent badges and legend states. Tests do not establish compatibility with every OEM firmware.

Verified on 2026-09-30: production build passed; Java checks passed; 7 Details backend tests and 3 selected renderer tests passed. A real Wi-Fi device (profile 0) returned matching markers for Chrome and YouTube, and missing markers for 4PDA and Android Settings. The normal Details reader uploaded the verified helper as needed. This validates metadata collection, not cryptographic signing. Repeat with `node scripts/check-play-signing-hardware.mjs`; the local report is `desktop-test-results/badges/play-signing.json`.

The next collector batch adds `npm run test:badges` for actual Java WX boundaries, unsupported/malformed Overlay metadata, exact process-package membership, cross-profile isolation, isolated-process UIDs, and partial-visibility tri-state results. `node scripts/check-badges-hardware.mjs` verified a resource overlay against OverlayManager, WX on an installed Target SDK 28 package, process-only Running for Chrome/4PDA and processes plus services for System UI on Android API 36 over Wi-Fi. No apps were started/stopped and no overlay or permission settings were changed. Report: `desktop-test-results/badges/collectors.json`.

This batch passed the Java collector tests, 7 Details backend tests, 6 selected renderer tests and the final production build. The Overlay dialog screenshot was visually inspected; settings persistence, custom colours, keyboard dismissal and unknown-vs-negative states were covered in renderer tests.

## Root collector validation (2026-09-30)

Root is opt-in under Settings → Apps and runs only for selected-app Details. The helper hash is verified again inside the privileged command. Package, profile and UID are checked before accepting results. Denied root is cached until the setting is toggled off/on; normal ADB data is retained. Hidden/SAF root queries only replace unavailable shell results. Tests cover identity mismatch, malformed metadata, denial/retry, exact DenyList package membership and preservation of ordinary checks.

`node scripts/check-root-badges-hardware.mjs` verified read-only collection on Redmi Note 4, Android 13, Magisk 31.0: SSAID exists for 4PDA/Google Play; KeyStore has zero/two entries respectively; Hidden and SAF return false without access errors; neither app is in DenyList or an active module mount. Reports omit identifier/alias/URI values. At that hardware audit date, Backup and legacy MagiskHide were unimplemented. Local Backup support was added on 2026-10-04.

After the user enabled modules, `node scripts/check-root-coverage-hardware.mjs` audited all 622 installed packages in profile 0, with no failed APK stat reads. BCR (`com.chiller3.bcr`) matched the active module APK by device/inode and the production Details reader confirmed Systemless=true. DenyList contained zero rules, so a positive DenyList case remains unverified on hardware. Legacy KeyStore also remains hardware-unverified. The check changes no module, app or DenyList settings; report: `desktop-test-results/root-device/coverage.json`.

Reference approaches: [App Manager KeyStoreUtils](https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/java/io/github/muntashirakon/AppManager/utils/KeyStoreUtils.java), [SSAID settings](https://github.com/MuntashirAkon/AppManager/blob/master/app/src/main/java/io/github/muntashirakon/AppManager/ssaid/SsaidSettings.java), and [Magisk command-line tools](https://topjohnwu.github.io/Magisk/tools.html). Our Systemless check additionally requires matching mounted file identity, not just module APK presence.

## Data licensing

Official tracker/library/native datasets retain GPL-3.0-or-later; debloat data and alternatives retain AGPL-3.0-or-later. Revisions, hashes, notices and full licence texts are included in `electron/data/app-manager/NOTICE.md`. The MIT declaration for original project code does not relicense these datasets. This change introduces no new third-party database or dependency.
