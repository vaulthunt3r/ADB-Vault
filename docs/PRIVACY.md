# Privacy and network behavior

ADB Vault stores settings, known device connections, personal app notes,
game-control profiles, caches and downloaded components locally. Installed mode
uses the normal per-user application profile. Portable mode uses `data/` beside
the executable. ADB authorization keys are managed by ADB in its usual location;
moving Portable does not transfer those keys automatically.

There is no ADB Vault account, analytics service or cloud synchronization.
Internet access is used for component/version lookups, requested downloads and
detection database updates. Looking up an application online opens the selected
website with the chosen query. Scanner preparation exports APK files locally;
the user uploads them manually on the scanner's website.

Connected-device operations use ADB over USB or the selected network connection.
Phone clipboard, contacts, call history and SMS tools read data only when
requested; Android and firmware restrictions apply. Loaded provider records
remain in memory until cleared/replaced or the application closes. Explicit
exports write them to the destination selected by the user.

Operation history and diagnostics can include package names, filenames and
connection information. Backups can contain application data. These files are
not encrypted by ADB Vault. Inspect and redact them before sharing.

Uninstalling keeps the current user's settings by default. The optional removal
checkbox deletes that profile; external exports, tool folders and other Windows
users' profiles are retained. Portable removal means deleting its folder after
saving any data you want to keep.
