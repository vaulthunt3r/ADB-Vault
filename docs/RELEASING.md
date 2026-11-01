# Publishing a release

## Repository preparation

The source export uses an explicit file allowlist in `scripts/source-files.mjs`.
The `.gitignore` also excludes profiles, generated build output, caches,
hardware reports, research notes and source backups. Never upload the entire
development directory or initialize a commit without reviewing its file list.

```powershell
npm run check:source
npm run notices:generate -- --check
npm run source:export
```

This creates a clean `github-ready/ADB-Vault/` source tree and a source ZIP beside
it. It does not upload, choose a GitHub owner or create a remote repository.
Validate a clean copy using [DEVELOPMENT.md](DEVELOPMENT.md). Do not copy
`node_modules`, `.tools`, `inspector-tools` or personal profiles into Git.

Choose the GitHub owner and repository name at publication time. Initialize the
clean tree on branch `main`, review the staged files, commit using the author's
chosen Git identity, then add the actual remote and push. Do not insert guessed
account names or emails into the project. The prepared initial repository has
no remote; no credentials are stored in it.

Enable **private vulnerability reporting** in the repository's security settings
before announcing it. GitHub Actions has read-only repository permissions.
Normal CI runs fixture tests; no workflow connects to a phone or publishes a
release automatically. The manually dispatched release workflow only builds
downloadable artifacts for review.

## Binary/source preparation

Run the required build and tests, then:

```powershell
npm run build:distribution
node scripts/prepare-java-source.mjs
npm run source:export
node scripts/prepare-release-assets.mjs release github-ready/ADB-Vault-0.1.2-Source.zip .tools/publication
```

Use fresh output directories when repeating a release: source export and Portable
packaging refuse overwrites. `prepare-release-assets` audits the binary payload,
verifies the corresponding Java source checksum, copies both source assets and
generates SHA-256 for all downloads. Preserve the complete matching Java source
archive alongside the binaries; an upstream link alone is not our distribution
method for this release.

Check that the prepared source's runtime files match the compiled code. Keep the
helper JAR/manifest together. Review all generated notices when dependencies,
datasets or binary tools change. Do not label the entire bundle MIT.

## GitHub Release

Create tag **v0.1.2** from the validated source commit and a release marked **Latest** titled
**ADB Vault 0.1.2 — Smaller Windows download**. Use
[docs/releases/v0.1.2.md](releases/v0.1.2.md) as the release body. Upload exactly:

1. `ADB-Vault-0.1.2-Windows-x64-Setup.exe`
2. `ADB-Vault-0.1.2-Windows-x64-Portable.zip`
3. `ADB-Vault-0.1.2-Source.zip`
4. `OpenJDK17U-jdk-sources_17.0.20.1_1.tar.gz`
5. `third-party-sources.json`
6. `SHA256SUMS.txt`

Do not upload `win-unpacked`, builder diagnostics, blockmaps, test profiles or
internal verification logs. Verify the downloaded checksums after uploading.
The source ZIP is optional for users but retained as the exact reviewed snapshot.
Code signing is not configured; do not describe the preview as signed or broadly
certified. Record any checks that were not run in the release report.
