# Using ADB Vault

## First launch

Use **Components** to find existing tools or download missing ones. ADB and
Fastboot are provided together. scrcpy enables phone screen, virtual display,
camera and audio sessions. Driver/runtime installation is separate from the
application installer and is needed only on some computers.

Connect a phone in **Connection**, authorize USB debugging on the phone, and
select it. Wi-Fi access depends on the device and network. The selected phone is
shared across workspaces; app operations also use the selected Android profile.
The optional Quick tour is an overview of all seven workspaces and key controls.
It can be skipped, closed, or replayed from the question-mark title-bar button.

## Applications and APKs

Search by name/package or paste multiple package IDs into the existing search
field. Select an application to see Details and Actions. Double-click it to open
its component and permission inventories. Personal notes are stored by package
and remain visible when that package is seen on another phone; source device and
record dates provide context.

Badges summarize observations, not certainty. Open their legends to understand
scope and limitations. A bloatware classification is not advice to remove a
package. Disabling and freezing differ: disabled packages cannot normally be
launched, while freezing uses Android's suspension mechanism. Support and
restrictions differ by package and firmware.

Export APKs and supported data components through Actions. Internal protected
data/cache operations require root and the appropriate unlocked profile. An APK
copy does not include app data. Review the reported contents of each backup.
Split applications may require all APK parts. Restoring a system package removed
for a user depends on its files still being present on the phone.

**Find online** offers configurable search websites and scanner pages. Scanner
preparation saves APKs locally and opens the website; uploading is manual.
Local APK Inspector and version comparison do not require a phone and do not
execute inspected Android applications. Detection is heuristic.

## Screen, virtual display and camera

Open **Connection → Actions → Screen & recording**. An application's Actions
also offers a virtual display with that application selected. Hardware and ROM
support determine available display and camera options.

Use Typing for text input with the PC layout. Game controls are optional touch
mappings for applications without native input support; edit their layout,
bindings, presets and hotkeys from the window's controls. Check the displayed
hotkeys because they can be customized. Gamepad forwarding requires native
support in the Android application unless touch mappings are configured.

Use the window's pin control for always-on-top. Each open session has controls
for closing it. Closing ADB Vault follows its shutdown behavior and prompts for
active work when necessary. ADB debugging and the phone's own settings are not
automatically reset by closing a screen window.

## Files, monitoring and commands

Files provides two panels with independent PC/phone sources. Review both paths
before copying, moving or deleting. Existing folder destinations support the
available conflict choices; general recursive folder merging is not promised.
Some protected device locations need explicit root access.

Monitor collects available statistics while its view is active. Missing readings
are marked unavailable. Battery estimates, process visibility and network data
depend on Android and firmware. Monitoring itself can affect the measured load.

Console runs a command on the selected phone, with visible output, a timeout and
stop control. It is not a persistent interactive terminal. Stopping the local
client does not necessarily undo an Android command that has already started.
Activity keeps operation results and available diagnostics.

## Installation, updates and data

Setup offers installed and portable modes; use separate dedicated folders.
Installed mode can create desktop/Start menu shortcuts and an uninstaller.
Portable mode keeps its profile in `data/` beside the executable. Portable
shortcuts need recreating if the folder moves.

Before updating, close ADB Vault and its screen windows and back up the profile.
Run Setup over an existing installation of the same type, or extract a new
Portable ZIP separately and copy your existing `data/` folder into it. Keep the
`portable-mode` marker. External tool and export paths may need selecting again
when moving to another PC.

Installed data normally lives under `%APPDATA%\adb-vault`. Portable data lives
beside the EXE. Uninstall keeps personal data by default; deleting it is an
explicit, unchecked option. Exported backups and external tools are retained.
There is no dedicated settings export/import feature in this release.

## Limitations

- Windows x64 is the supported desktop target. macOS, Linux and Windows ARM64 builds are not provided.
- The interface is English only; device-provided labels retain their original language.
- The Android helper targets Android 8/API 26 and newer. This is a technical minimum, not a claim that every Android release or OEM has been tested.
- Camera, virtual display, physical input, provider exports, root and package-management behavior depend on Android/firmware permissions.
- A locked phone, Wi-Fi sleep or a dropped connection may interrupt operations. Check results before retrying.
- APK detection is not an antivirus verdict; absence of a signature is not proof of safety.
- Exports are unencrypted. Contacts/SMS/call exports and backups may contain private data.
- The first Windows release is unsigned and has limited physical-device coverage. See [verification scope](../VERIFICATION.md).
