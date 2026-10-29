# Contributing

Read [the development guide](docs/DEVELOPMENT.md) before changing the code.
Use a small, focused change and explain its purpose and validation. Keep the UI
in English. Never commit phone exports, device identifiers, logs from a real
profile, private APKs, credentials or signing keys.

For a bug report, include the ADB Vault version, Windows version, connection
method, Android version and phone model if relevant. Describe reproducible steps,
expected behavior and actual behavior. Redact serial numbers, IP addresses,
personal filenames, contact information and other private content.

Automated tests should use fixtures and isolated profiles. Hardware checks must
be explicitly invoked against a device you own and understand; they are not part
of CI. Do not change device permissions or run destructive actions in tests by
default. See [verification scope](VERIFICATION.md).

Run `npm run check:source`, `npm run build` and the tests appropriate to your
change. Changes to the helper require `npm run helper:build`. Changes to runtime
tools or dependencies require updated hashes and third-party notices.

Original contributions are provided under the project's MIT licence. Preserve
all third-party notices and the separately licensed material described in
[NOTICE.md](NOTICE.md). Do not copy code whose distribution terms are unclear.
