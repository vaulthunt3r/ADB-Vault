# Local application detection

## Data sources

Bundled App Manager revision: `2d9223a7a541ad40ec927e429d7a9ab58d27a90d`.

| Dataset | Entries | Usage |
| --- | ---: | --- |
| Tracker signatures | 989 | Manifest components and DEX class names; Exodus/ETIP entries curated by App Manager. `²` means ETIP-only. |
| Library signatures | 3,829 | Java/Kotlin DEX classes, names and library categories. |
| Native library signatures | 211 | Regular expressions over `.so` filenames, including tracker classification. |
| Android Debloat List | 4,801 | Exact package-ID classifications, warnings and dependency information. |
| Alternatives | 46 | Supplementary suggestions attached to matching debloat records. |

Counts are signature rows, not unique vendors. The matching sources are the generated datasets shipped by App Manager, rather than an independent live Exodus feed. Raw files, pinned upstream paths, SHA-256 digests and GPL/AGPL licences are included in `electron/data/app-manager/`. The `sources/` directory also includes the corresponding upstream library/debloat source data and generation scripts for the bundled revision. These PHP scripts are source material only and are never executed by ADB Vault.

## Interface

Components has a **Detection databases** group. The four rows share one consistent dataset revision. Their Actions offer **Check for updates**, **Update databases**, **Restore bundled databases**, and **Open database files / licences**. Packages are not installed on Android. The standalone source files are outside the Electron ASAR in Windows builds so Explorer can open them.

Update checks fetch official GitHub commit metadata and the five data files at that immutable commit. Unrelated repository changes do not produce an update notification. All files are bounded, parsed and validated together before activation. A new folder and atomic active-pointer change preserve the previous verified set on network, schema or write errors. Checksums detect local corruption; they are not a separate upstream cryptographic signature. GitHub API rate limits or network errors leave the active database usable. Updates are explicit, not a startup download. Restore selects the bundled snapshot and persists the choice.

Apps → double-click application → Details:

* The **tracker badge** counts distinct matched manifest component class names, using literal substring matching as in App Manager. It lists component kinds, matched labels and Android enabled state. Blocking means disabled through Android; App Manager's own rule database is not inspected.
* The **Bloatware** badge uses an exact package match. Its dialog shows original classification, warnings, dependencies and available alternatives. This is informational; it does not recommend or perform removal.
* **Actions → Analyze → Scan APKs** runs a separate deep scan for the highlighted application when there are no checked rows. Results remain in **About application → APK analysis**; opening Actions alone does not read APKs. Every standard `classes.dex`, `classes2.dex`, etc. in the base APK and installed splits is inspected for defined classes. All `.so` entries, including files in assets and nonstandard directories, are matched by filename. Their ELF header supplies bitness, machine architecture and endianness; invalid or unreadable headers are identified explicitly. Results include matched signatures, per-signature unique class counts, native filenames/ABI evidence and unknown native filenames. Clicking a match opens its evidence without an accordion.
* **Domains & URLs** lists HTTP(S) URLs and candidate domains from DEX strings, UTF-8/UTF-16 compiled resource/XML string pools, and supported text files in `assets/` and `res/`. Includes installed splits. Two views share search by address/source, individual copying and Copy filtered (all matching rows, including other pages). Every finding has APK/entry evidence. There are 20 rows per page, using the surrounding page's scrolling instead of an internal list scrollbar; addresses are plain text, never automatically visited. An information button explains coverage and the offline IANA source. A missing result from an older helper asks for a new scan instead of claiming zero findings.

* **APK size composition** shows one proportional color bar and a size/percentage legend for DEX code, native `.so` libraries, resources (`res/` and `resources.arsc`), remaining assets, and Other. File type takes priority over directory for DEX and `.so`. Every APK's contribution is also listed for split applications. The list uses the page's scrolling, with no extra window or internal scrollbar.

Size accounting uses [stored ZIP entry sizes](https://docs.oracle.com/javase/8/docs/api/java/util/zip/ZipEntry.html#getCompressedSize--) during the existing entry walk, without decompressing extra files or transferring APKs to the computer. The difference between the physical APK file size and all entry payloads is included in Other (headers, index, signing block, alignment). Complete category totals equal the physical file size, and base plus splits are summed once. This concerns APK file size, a distinction also used by [Android's APK Analyzer](https://developer.android.com/studio/debug/apk-analyzer?hl=en); it excludes data/cache, extracted files, estimated store download size and the enclosing exported APKS archive. Signing data is only counted as bytes, not parsed or verified in this stage.

Unknown entry sizes, enumeration limits and changed files cannot produce a fabricated complete breakdown. Known-size APKs with unavailable contents appear as Not classified. Files with unknown size are excluded from the chart with an explicit partial/known-size label and per-file reason. Old helper results request a fresh scan. Percentages are rounded for display; bar widths use the underlying byte ratios. Exact byte counts are available by hover, with category names/values in the accessible chart and legend.

Domain candidates use the bundled [IANA TLD snapshot](https://data.iana.org/TLD/tlds-alpha-by-domain.txt) in `electron/domain-tlds.ts`, without DNS queries. Host casing/IDNs and URL formatting are normalized; repeated addresses retain evidence across files. Typical Java/Android namespaces and file extensions are excluded from bare-domain candidates, conservatively omitting ambiguous strings. An explicit HTTP(S) URL still supports those domain names and literal IP/localhost targets. This is not a traffic history, domain reputation database, proof of tracking or a complete list of destinations. Strings assembled at runtime, encrypted content and native binary strings are outside address-scan coverage.

Address collection is bounded to 2,000 candidates, eight source files per candidate, 2,048 characters per address, 65,536 characters per DEX/resource string, 64 MiB processed text, and 8 MiB per resource/text file (32 MiB total). Limits, malformed data and unreadable files retain findings with an explicit partial result. Android string formats follow the [DEX specification](https://source.android.com/docs/core/runtime/dex-format) and [AOSP resource structures](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/androidfw/include/androidfw/ResourceTypes.h). The helper source-integrity check covers all three Java files.

Implemented stages: domains/URLs and APK size composition. Remaining expansion order: network security configuration; comparisons between saved versions; signing certificates/signature verification last.

Class matches and manifest-component counts are different quantities; they are deliberately not combined in one badge. Duplicate class names across APKs are counted once. The evidence dialog shows up to 1,000 class names per signature and explicitly indicates when the full count is larger. Native signature counts represent unique filenames; evidence may contain several ABI/APK occurrences of the same filename.

## Execution and limits

The existing authenticated ADB helper reads APK ZIP entries on the device. It parses DEX metadata directly; it does not load or execute target classes and does not install a companion application. No APK, application list or scan result is uploaded. The desktop matcher runs in a worker with a 30-second deadline and 256 MiB heap bound. Switching device/profile or cancelling collection prevents stale results from being published.

Supported production DEX formats: 035, 037, 038, 039, 040. Unsupported versions (including experimental 041 containers), malformed files and permission denials are explicit errors, not clean results. Limits: 128 MiB per DEX, 512 MiB decompressed DEX total, 250,000 unique classes, 10,000 native entries, 200,000 ZIP entries and 32 MB response. The helper has a 120-second watchdog. Partial reads retain findings with a **Partial scan** label and file-specific reasons. A scan failure preserves ordinary About information.

This is signature detection, not proof of runtime tracking or a malware verdict. Renamed/obfuscated classes, encrypted payloads and code loaded from outside the installed APKs can escape recognition. Results can differ from another App Manager installation because of dataset revision, APK version, splits or privileged blocking rules. Network signatures, antivirus uploads and root-only badge collectors are not part of these local App Manager dataset matching levels.

## Validation commands

```powershell
npm run test:backend
npm run test:dex
npx playwright test tests/apps.spec.ts tests/app-view.spec.ts
npx playwright test tests/apk-addresses.spec.ts
npx playwright test tests/apk-composition.spec.ts
npm run build
```

With an authorized connected device and the named apps installed:

```powershell
node scripts/check-app-details.mjs --scan ru.fourpda.client com.android.chrome
node scripts/check-analysis-desktop.mjs
```

`test:dex` requires the helper toolchain (`npm run helper:setup`) and compiled helper classes (`npm run helper:build`). Normal app startup uses the already built helper JAR.
