# Verification scope

ADB Vault 0.1.0 is the first public preview for Windows x64. Passing automated
checks does not establish compatibility with every phone, Android version,
driver, network or security product.

## Existing runtime validation

- Production TypeScript/renderer/Electron builds and Android helper integrity checks.
- Backend and UI regression suites for device binding, applications, files, screen controls, touch mappings, text input, optional tour and English-only UI.
- Isolated packaged launches and Portable relocation with settings retained.
- Native Windows taskbar/icon inspection, including accessible ICO and AppUserModelID metadata.
- 41 native installer assertions covering current-user installation, a fresh default folder, portable extraction, updates, shortcuts, running-app refusal and data retention/removal.
- Release payload privacy checks, EXE/ZIP integrity and SHA-256 verification.

Physical checks during development used a small number of Android devices.
They included package reads/exports, provider access, screen sessions and mixed
Unicode input on an Android 16 device. Test records and real device identifiers
are intentionally not part of the public source repository.

## Release-preparation checks

The publication preparation validates a clean exported source tree, lockfile
installation, build, selected backend/UI checks, documentation links, generated
third-party notices and final source/binary hashes. Screenshots are rendered from
synthetic fixtures, not a personal phone/profile. The local preparation report
records the exact checks completed for the candidate.

## Remaining coverage

- The final visible installer flow and all-users elevation under a separate Windows account have not received a full interactive retest after the destination fix.
- Broad OEM/Android-version coverage is not established. API 26 is the helper's target minimum, not a certification matrix.
- Root, managed/secondary profiles, device cameras, provider restrictions and native gamepad support need device-specific validation.
- Builds are unsigned. No SmartScreen reputation or third-party antivirus certification is claimed.
- No external security audit or network penetration test has been performed.

See [development instructions](docs/DEVELOPMENT.md) for repeatable commands and
[release notes](docs/releases/v0.1.0.md) for the user-facing limitations.
