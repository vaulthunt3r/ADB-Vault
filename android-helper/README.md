# Android application inventory helper

Own Java collector, normally run as the authenticated ADB shell through `app_process`. No APK is installed and no launcher icon/service is created. Inventory and ordinary Details do not use root. The separate opt-in root-details mode below reads additional metadata without changing system files.

## Build

The optional `--root-details <package> <expectedUid> <userId>` mode requires UID 0 and checks PackageManager identity before reading. It returns one bounded `root-details` JSON record with tri-state `badgeChecks` for SSAID, Hidden, SAF, active Systemless mounts and legacy KeyStore filenames. Modern KeyStore aliases and Magisk DenyList are collected separately by the desktop through fixed read-only commands. The desktop verifies the helper SHA-256 inside the privileged invocation and validates the returned package/user/UID. Root failures preserve ordinary ADB Details. The setting defaults to off; denied access is cached until toggled off/on. Identifier values and key aliases are not written to hardware-test reports. Private key material is never read.

The ready-to-run DEX JAR and SHA-256 manifest in `dist/` are part of the project. Normal `npm install`, `npm run dev` and Windows packaging do not require a Java/Android toolchain. `helper:check` rejects missing, modified or stale artifacts.

To change the helper on Windows:

```powershell
npm run helper:setup
npm run helper:build
npm run helper:check
```

Setup downloads publisher-checksummed portable Temurin JDK 17, Android platform 35 and build-tools 35.0.0 into `.tools/helper/`. It changes neither PATH nor global SDK/JDK installations. Google SDK tools are covered by the [Android SDK License Agreement](https://developer.android.com/studio/terms). Compilation uses javac followed by [D8](https://developer.android.com/tools/d8), targeting API 26. Keep `dist/manager-server.jar` and `dist/helper-manifest.json` together when distributing the source project.

## Session and protocol 1

`electron/apps-collector.ts` verifies the bundled JAR, queries device API level/current foreground Android user and available profiles, selects the requested profile (or current user on first load), checks the cached remote SHA-256, and uploads only on mismatch. A new upload is hash-checked and made read-only before replacing `/data/local/tmp/android-manager/manager-server.jar`.

One ADB shell invocation then runs:

```text
CLASSPATH=/data/local/tmp/android-manager/manager-server.jar app_process / dev.adbvault.helper.Main <userId>
```

Optional flags before `<userId>`: `--no-icons` skips drawable/PNG work (`iconSkipped: true`); `--storage` queries `StorageStatsManager.queryStatsForPackage` for the exact user and app storage volume. `dataBytes` includes `cacheBytes`. A genuine zero remains zero; failed queries return null and `storageError`, while `storageRequested: false` means the option was off. A permission denial is reused for the remainder of that profile to avoid hundreds of denied calls. No permission grants, root or companion installation are performed. Collection remains subject to the existing watchdog.

UTF-8 stdout is JSONL; Java diagnostics go to stderr. There are no per-application ADB calls or APK/image pulls. Every line is an object:

1. `header`: `protocolVersion: 1`, `helperVersion: "0.1.0"`, `userId`, `sdk`, `locale`, `iconSize: 96`, `total`.
2. `app`: fields in `electron/apps-protocol.ts`; `iconPng` is base64 PNG or null. `iconError`/`labelError` describe per-package fallback. Unavailable nullable metadata uses JSON null.
3. `complete`: package `count`, warning count, device-side `elapsedMs`.

A fatal error produces an `error` record and a nonzero exit. Desktop rejects incompatible versions, duplicate packages, wrong users, invalid metadata/icons and incomplete streams. Maximum transfer is 64 MB, maximum record 200,000 characters, maximum list 10,000 packages. Collection times out after 120 seconds in the helper / 130 seconds at the host. Closing the ADB pipe stops output; the watchdog bounds a stalled remote process. Cancellation, device changes and disconnections discard stale results. The helper exits after collection; its cached file remains for reuse.

## Data and compatibility

PackageManager supplies labels in the device locale, application flags, versions, enabled state, installation timestamps and extra metadata. Classification uses `FLAG_SYSTEM` and `FLAG_UPDATED_SYSTEM_APP`, including updated system APKs located under `/data/app`. Disabled and direct-boot packages are included. Each Android Drawable is rendered to a 96×96 bitmap and encoded on-device. Icons/labels that cannot be read retain the package in the list with an explicit diagnostic; the UI shows a fallback icon.

`apkSizeBytes` sums `Os.stat().st_size` for the unique base APK and `splitSourceDirs` paths without pulling or reading their contents. Failure for any file produces null plus `sizeError`, never a partial sum. `splitCount` reports installed splits; it does not identify an original APKS/XAPK/APKM archive. APK size excludes data/cache, extracted native libraries and optimized code. Metadata errors are separate from icon/label warning counts. The optional fields extend protocol 1 compatibly; the source/artifact hash checks force the rebuilt helper to be uploaded.

The desktop selects one profile returned by `pm list users` and passes its explicit ID to the helper. This includes accessible users, work profiles and OEM spaces; inventory is not merged across profiles. Package UID user ranges are validated against the requested ID. Selecting a profile never starts, unlocks or switches users. Restricted profiles can return errors; unlocking/resuming must be done on the phone. `stopped` is a package flag, not process liveness. Timestamps and installer come from Android and may be absent or reflect firmware defaults.

The shell context is initialized through ActivityThread, with shell application identity. On the tested MediaTek ROM, the app-only AsyncDrawableCache fails outside a normal app lifecycle; its optimization is disabled **inside this helper process** using reflection. No global property is changed. This private-framework integration follows the same general approach as [scrcpy's context initialization](https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/Workarounds.java), but this collector is separate code. OEM/Android compatibility needs device testing; Android 16 is verified, API 26 is the build/runtime minimum, not a claim that every intervening ROM has been tested.

## Tests

```powershell
npm run test:backend
npm test -- tests/apps.spec.ts
node scripts/check-apps-hardware.mjs
node scripts/check-helper-icons.mjs
node scripts/check-apps-desktop.mjs
```

The last three require an authorized connected phone and verified ADB in the ADB Vault profile. Hardware checks compare PackageManager coverage, cache reuse and process termination. The icon probe builds a separate test JAR, tests PNG/WebP decoding and Vector/Adaptive drawable rendering, then removes that test JAR from the phone. It is excluded from the shipped application. Desktop checks use a disposable profile and real Electron IPC. Local test output may include package/device identifiers and is not part of release resources.

## Optional background profile loading

`electron/apps.ts` coordinates collectors and session-only profile caches. Settings chooses on-demand loading (default) or sequential preloading after the first successful Apps read. Only the selected profile inventory is sent to the renderer, plus cache/queue status. Selecting an uncached profile interrupts background work and gives the selection priority. Late cancelled results are discarded. Background errors do not replace the foreground list and are attempted once per queue cycle. Disconnection/device change clears every cached profile. Refresh bypasses the selected profile cache; Android users are never started or unlocked automatically.
