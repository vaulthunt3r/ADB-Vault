# Development and builds

## Prerequisites

Use **Windows 10/11 x64**, **Node.js 24 LTS**, npm and Git. Use the committed
`package-lock.json` with `npm ci`. Electron is pinned to **45.0.0**.

The checkout contains the Android helper source and its integrity-checked JAR.
The generated Java/Android inspection runtime is deliberately excluded from Git.
Prepare it once before building:

```powershell
npm ci
npm run desktop:setup
npm run helper:setup
npm run inspector:setup
npm run build
```

`helper:setup` downloads the pinned Temurin JDK and Android platform/build-tools
into `.tools/helper`, verifies publisher checksums and leaves system PATH/Java
unchanged. Downloading/using the Android SDK tools requires accepting their
[upstream terms](https://developer.android.com/studio/terms). Inspect those terms
before running setup. `inspector:setup` assembles a private runtime with retained
notices. Initial downloads and Windows packaging require internet access.

`desktop:setup` explicitly installs the matching Electron binary when npm does
not run that package's install step; it reuses a verified download cache and is
safe to repeat. Do not use a different Electron binary with this lockfile.

## Run

```powershell
npm run dev
```

The renderer uses a local Vite server on port 5173. React/CSS reload live. Restart
after changing Electron code, dependencies or the helper. `npm run dev:web`
provides a browser preview; it cannot perform native device operations.
Development launch uses the normal development profile; for isolated validation
use the packaged test scripts and their explicit temporary profiles.

## Modify the Android helper

```powershell
npm run helper:build
npm run helper:check
```

Commit both source changes and the regenerated `android-helper/dist` JAR/manifest.
See [android-helper/README.md](../android-helper/README.md). The hash check covers
the helper source, protocol and compiled artifact. It also depends on exact
source bytes: `.gitattributes` preserves helper and upstream dataset bytes
without checkout line-ending conversion.

## Validate

```powershell
npm run check:source
npm run build
npm run test:backend
npm test -- tests/interface-tour.spec.ts tests/english-only.spec.ts tests/confirmation.spec.ts
```

Browser tests use Microsoft Edge by default. Set `PLAYWRIGHT_CHANNEL=chromium`
and install Playwright Chromium if Edge is unavailable. Test fixtures simulate
devices; CI does not connect to a phone. Some scripts named `hardware`, `phone`
or `usb` use real equipment and are deliberately not run by CI.

`npm run notices:generate` regenerates the bundled npm notices from installed
lockfile versions. Use `--check` to verify without changing them. New third-party
code must keep its attribution and compatible distribution terms.

## Package Windows

```powershell
npm run build:distribution
```

This creates Setup, Portable ZIP and SHA-256 hashes in `release/`. Setup offers
installed and portable modes. The generated NSIS templates are checked against
the locked electron-builder version. They are not committed to Git.
The pipeline has `--publish never`; it does not upload anything.

Use a new release output directory or move previous artifacts aside before
creating another Portable ZIP; packaging intentionally refuses to overwrite it.
Do not include working profiles or `.tools` in a distribution. The payload audit
runs before Portable packaging. For local identity comparison, the audit accepts
an optional profile JSON path and logs counts rather than matched values.

Before publishing binaries, fetch the matching Java source, include all files
listed in the release notes and follow [RELEASING.md](RELEASING.md). Windows code
signing is not configured. Secrets/signing keys must never be committed.
