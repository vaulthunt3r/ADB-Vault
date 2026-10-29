# APK inspection tools

APK Inspector runs locally and does not execute inspected application code.

- `inspector-tools/aapt2.exe` and `inspector-tools/apksigner.jar` come from Android SDK Build Tools 35.0.0. Their upstream notices are distributed unmodified in `inspector-tools/ANDROID-NOTICE.txt`. AAPT2 and apksig sources: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/ and https://android.googlesource.com/platform/tools/apksig/.
- The private Java runtime is generated with `jlink` from the checksum-verified project-local Eclipse Temurin 17 Windows x64 JDK. It includes `java.base`, `java.logging`, `java.xml`, `jdk.crypto.ec` and `jdk.zipfs`. Runtime module notices and licences are retained in `inspector-tools/runtime/legal`; upstream notices and exact version information are in `JAVA-NOTICE.txt` and `JAVA-release.txt`. OpenJDK uses GPL v2 with the Classpath Exception; see the distributed module licence files. Source and release downloads: https://adoptium.net/temurin/releases/?version=17 and https://github.com/adoptium/temurin17-binaries/releases.
- Detection signatures reuse the existing App Manager databases and their separately distributed notices. Matches are heuristic and are not a malware verdict.

`npm run inspector:setup` builds this bundle from the existing `npm run helper:setup` toolchain. `inspector-tools/manifest.json` records SHA-256 and size of every bundled file; `npm run inspector:check` verifies them before application builds. Packaged tools are external resources and are loaded from the application's own resource directory, never from an inspected APK.
