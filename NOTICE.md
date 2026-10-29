# Licences and third-party material

The original ADB Vault code is licensed under [MIT](LICENSE). This does not
relicense third-party code, artwork, datasets or binary tools. The source tree
and Windows distributions contain material under the following separate terms.

| Material | Terms and accompanying notices |
| --- | --- |
| React, React DOM, Lucide, Zustand, TanStack Table, QR and backend libraries | Exact installed versions and full notices in [NPM-DEPENDENCIES.txt](third-party-notices/NPM-DEPENDENCIES.txt). |
| React Bits adaptations | **MIT + Commons Clause**, not plain MIT. Applies to Decrypted Text and the operation-chip adaptations; see [react-bits.txt](third-party-notices/react-bits.txt). Redistribution as an independent component collection is restricted. |
| Optional theme palettes | Authors and MIT notices in [THEME-PALETTES.txt](third-party-notices/THEME-PALETTES.txt). |
| Flag icons | [MIT notice](public/third-party/flag-icons-LICENSE.txt). |
| Application mark | Lucide Command icon, [ISC](third-party-notices/lucide-LICENSE.txt). |
| Detection databases | GPL-3.0-or-later and AGPL-3.0-or-later. Exact revisions, original data, generator sources and licences are in [electron/data/app-manager](electron/data/app-manager/NOTICE.md). These files are distributed separately from the matching engine. |
| Android APK inspection tools | AAPT2/apksig and their dependencies: upstream notices retained in the generated `inspector-tools/ANDROID-NOTICE.txt`. See [APK-INSPECTOR.md](third-party-notices/APK-INSPECTOR.md). |
| Private Java runtime | Eclipse Temurin / OpenJDK, GPL v2 with Classpath Exception and module-specific notices. The matching complete source archive accompanies Windows release assets. See [SOURCE-CODE.md](third-party-notices/SOURCE-CODE.md). |
| Electron / Chromium | The Windows payload includes Electron's licence and Chromium's third-party notices. |
| Installer templates | [electron-builder MIT licence](third-party-notices/electron-builder-LICENSE.txt); NSIS tool notices remain with its distribution. |

ADB, Fastboot, scrcpy, USB drivers and Visual C++ redistributables are obtained
separately through Components or located on the user's computer. Their upstream
licences and installation terms apply. ADB Vault is not affiliated with Google,
Genymobile, Eclipse Adoptium, or the projects credited above.

References: [Android SDK agreement, section 3.5](https://developer.android.com/studio/terms),
[Temurin licence information](https://adoptium.net/docs/faq),
[React Bits licence](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md).
