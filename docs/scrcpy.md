# Screen & audio

ADB Vault launches the official scrcpy component installed or located in Components.

## Where to use it

- **Connection → Actions → Mirror screen** starts normal mirroring with saved defaults.
- **Connection → Actions → Screen & recording** chooses Phone screen, Virtual display or Camera, and optionally records to MKV/MP4.
- **Settings → Screen & audio** saves picture, sound, window and input defaults. Changes affect the next launch.
- **Apps → Actions → Virtual display** opens the selected app on a virtual display, including when exactly one row is checked. This is available for the current Android user; the backend rechecks it and never switches profiles. Toolbar **Virtual display** and **Screen & recording → Virtual display** preselect the app shown in Apps after validating it against the current phone's launchable-app list; another app can still be chosen.
- **Open windows** in Connection, Apps or Settings lists each owned window with its number, app name/package, phone, start time and recording path. **Finish recording / Close session** targets only that window. Closing the scrcpy window itself also ends its session.

Supported controls: maximum resolution, FPS limit, video bit rate, H.264/H.265/AV1, device audio, audio duplication, microphone or mute, fullscreen, always on top, physical display off, stay awake while charging, read-only viewing, clipboard autosync, SDK/UHID keyboard and mouse, and UHID gamepads. Virtual displays support resolution, density and window-following size when installed scrcpy supports it. Camera capture offers facing/ID, resolution, FPS, initial zoom, torch and separate preview/recording rotations.

## Keyboard, mouse & gamepad

The input block is visible before picture settings in Phone screen and Virtual display. Choose a preset, then adjust individual devices if needed:

- **Apps & touch:** standard keyboard and touch/pointer mouse; no gamepad forwarding.
- **Keyboard & mouse games:** a physical keyboard and relative mouse through UHID. Press and release **left Alt** to capture/release the cursor. **Left Alt + K** opens Android's hardware keyboard layout settings.
- **Gamepad games:** forwards controllers connected to the PC by USB or Bluetooth; standard keyboard and touch/pointer mouse remain available for menus. Focus the scrcpy window to interact with its app.

Physical keyboard, mouse and gamepad can be combined. The Android app must support the chosen devices; this does not map WASD or controller buttons to screen touches. For touch/pointer input, right-click means Back, while Shift + right-click forwards a right-click to the app. See the official [keyboard](https://github.com/Genymobile/scrcpy/blob/master/doc/keyboard.md), [mouse](https://github.com/Genymobile/scrcpy/blob/master/doc/mouse.md) and [gamepad](https://github.com/Genymobile/scrcpy/blob/master/doc/gamepad.md) documentation.

Settings → Screen & audio saves input defaults; launch-dialog overrides affect only that session. Existing preferences retain their values and receive the compatible touch/pointer mouse default. View-only and Camera do not forward these devices. Unsupported physical-input options block launch with an explanation and can be reset without updating scrcpy. Open windows shows the configured input modes, not a claim that a physical controller is connected.

UHID depends on firmware permissions. On Android 14 and older, routing physical input between displays may depend on device focus; use standard keyboard and touch/pointer if input goes to the wrong display. Current scrcpy explicitly associates UHID ports with the target display on Android 15+ ([implementation](https://github.com/Genymobile/scrcpy/blob/master/server/src/main/java/com/genymobile/scrcpy/control/UhidManager.java)).

## Session defaults

The quick Mirror action always uses Phone screen and never starts a recording. Recording and app-launch selection are not persisted. Multiple virtual windows can run on one phone, alongside one Phone screen window and one Camera window. No fixed virtual-window limit is imposed; firmware and hardware determine the practical limit. Reopening the same Android app can move its existing activity instead of creating another instance. Device audio is phone-wide, so choose No sound in additional windows to avoid duplicate playback.

**On-screen keyboard** defaults to **In the virtual window**. **On the phone** selects the main display instead. This preference is saved in Settings → Screen & audio and can be overridden for one launch. Existing saved preferences receive the new default without losing other settings. Each controlled virtual launch passes the selected `--display-ime-policy=local|fallback`; other modes are unaffected. If the installed scrcpy lacks the flag, choose On the phone or update scrcpy. It does not silently ignore a requested local keyboard.

## Compatibility

The installed executable's `--help` supplies capabilities; an updated executable invalidates the cache. The backend validates every option and reads the actual Android SDK before starting. It does not download components or request root automatically.

- Device audio: Android 11+. Android 11 must be unlocked at start. Older phones use video only with an explanation.
- Audio on phone and PC together: Android 13+; applications can block capture.
- Camera: Android 12+. Camera sizes, FPS, codecs and UHID input also depend on the device firmware.
- Windows camera capture means preview/recording, not registration as a Windows webcam.
- Some Xiaomi firmware requires its additional USB debugging security setting for input control.
- Virtual-display app launch uses scrcpy's current-user behavior. Managed/secondary profiles are not silently redirected. Apps without a launcher or with display restrictions may not open there; scrcpy output is retained in Activity.

## Recording and shutdown

Recording requires a new filename that is not already being recorded by another owned window. Capture uses a unique temporary file beside the destination. On a normal exit, the completed file is published without overwriting a destination created meanwhile. If capture fails or publication cannot finish, Activity gives the retained capture path and scrcpy diagnostic output. Window numbers and names identify each session in Activity.

On Windows, Close session requests a normal window close so scrcpy can finalize the recording. App shutdown also attempts this first; forced termination is a last resort for an unresponsive process and may leave an incomplete capture. MKV is the default. Session start/end and recording output paths are logged in Activity; ordinary operation history persists them.

## Camera controls

Opening **Screen & recording → Camera** reads the selected phone's camera modes with `--list-camera-sizes`, without opening a capture or replacing a running session. The Camera ID picker lists individual lenses; capture sizes and normal FPS follow that lens. High-speed capture is opt-in and has a separate size/FPS list (for example 120/240 FPS when reported). It requires an explicit size and a scrcpy version with `--camera-high-speed`. Changing lenses from a high-speed session returns to automatic size and 30 FPS.

Reading or refreshing the catalog does not change saved or launch settings. Existing values absent from the list remain visible. Unsupported scrcpy versions, failed reads and incomplete phone declarations retain the standard choices and custom size/FPS entry. Firmware declarations are suggestions, not proof that the encoder can capture a mode; after a failed capture, turn off high-speed mode and try Automatic size at 30 FPS. Mode lists belong to the selected connection and late results are discarded after leaving the camera dialog or changing transport. General Settings still stores manual defaults; phone-specific lists are shown at launch.

The camera-mode update passes the build, 52 backend checks (camera catalog, sessions and shutdown), and 37 distinct browser checks across screen options, the live camera panel and Touch controls. Custom input validation was checked separately after fixing the field's accessible name. Packaged code and renderer assets were verified against the build. `node scripts/check-camera-modes-hardware.mjs` reads characteristics without starting capture; no phone was connected during this update, so actual camera modes and high-speed capture remain unverified on hardware.

Starting a camera session opens a compact, draggable **Camera controls** window above other windows. It stays attached to that session through stream changes and closes when the session ends. Hiding the panel leaves capture running; reopen it with **Open windows → Live controls**. The panel has its own sandboxed preload: commands can target only its assigned session.

- **Zoom in/out, Torch on/off, Rotate left/right** act on the running camera window without restarting it. On Windows, a single hidden helper delivers the fixed scrcpy shortcuts to the owned SDL window, checking its PID, full title and class. It does not use global keyboard injection or change the focused application. Torch commands are explicit on/off actions; the panel does not pretend to know the camera's actual torch state or zoom ratio.
- **Camera** selects Back, Front or External. **Sound** selects no audio, phone microphone or device audio. Changing either briefly closes and reopens the stream, because the scrcpy process cannot change these launch options live. A camera change clears a manual camera ID and resets initial zoom/torch for the newly selected camera.
- **Start recording** chooses a new file before closing the current preview. **Stop recording · keep preview** finalizes the recording and opens a preview. If camera/sound changes while recording, the panel first explains and confirms that the old file will be saved and capture will continue in another file. Cancelling the new-file picker leaves the current recording running. If finalization fails, the captured temporary file is retained and another stream is not automatically started; Activity contains the error and capture path.

The panel always explains the short restart and that live adjustments may reset. Preview rotations do not change recording orientation. Closing the camera entirely remains a separate action from hiding the panel or stopping recording.

In Screen & recording → Camera, **Initial zoom** selects 0.5×, 1×, 1.5×, 2×, 3×, 5× or 10×. The actual supported range depends on the selected camera; the presets do not imply that every phone supports each value. **Start with torch on** requires a flash on that camera. These settings are launch options, not live controls for an existing window.

**Preview rotation** and **Recording rotation** accept 0°, 90°, 180° and 270° clockwise. Recording defaults to **Same as preview at start**, resolved when launching; an explicit recording rotation stays independent. Preview uses `--display-orientation`, while recording uses `--record-orientation` only when recording is enabled. No camera setting is passed to phone-screen or virtual-display launches.

While the camera window is focused, use **left Alt + ↑ / ↓** for zoom, **left Alt + T** to turn the torch on, **left Alt + Shift + T** to turn it off, and **left Alt + ← / →** to rotate the preview. Preview rotation shortcuts do not change the recording orientation. Controls & shortcuts shows camera-specific commands in Camera mode; it does not show Android Home/Back or volume controls there.

Settings → Screen & audio persists these defaults. Older saved preferences receive 1× zoom, torch off, original preview rotation and recording matching the initial preview, preserving other valid preferences. Unsupported controls are detected from installed scrcpy capabilities; saved unsupported values can be reset, and the launch is blocked with an explanation until resolved. A nondefault recording rotation does not block a preview-only session. Choose **Phone microphone** explicitly if camera recording should include microphone audio.

## Validation

### Touch mapping for games

Open a virtual display with **Apps & touch**. **Open Touch controls automatically** is on by default: once the virtual display is ready, the saved game layout starts in Play, or the editor opens if there is no layout. Turn this launch option off for ordinary apps. Native keyboard/mouse/gamepad presets do not start touch mappings. **Top toolbar menu (⋮) → Open windows → Touch controls** still opens the editor manually. Closing the overlay keeps it closed until explicitly reopened or a new session starts. Running windows also appear at the top of Screen & recording and in Apps Actions when rows are checked. The transparent editor sits over that exact scrcpy window. Drag markers onto the game's buttons; assign keys, mouse buttons or standard gamepad buttons. A movement zone maps four editable direction keys and optionally the left stick. A look zone maps captured mouse motion and optionally the right stick; radius and sensitivity are editable.

**Shooter**, **Racing**, **Platformer** and **Empty layout** create editable starting profiles. Creating a template preserves existing profiles. Rename, duplicate or delete profiles; changes save automatically for the phone, Android user, game package and portrait/landscape orientation. Templates require positioning for each game's HUD. Up to eight controls can operate simultaneously, plus direct mouse touch.

**Play** activates assignments and captures the mouse when a look zone exists. The toolbar's **Hotkeys** button lets each profile assign keyboard keys or combinations to **Release cursor**, **Open editor**, **Play / Menu** and **Show / hide controls**. Defaults are **left Alt**, **F8**, **F9** and **F10**. **Escape** always releases input and restores the toolbar. Use **− F10** or the assigned panel shortcut to hide the toolbar without stopping game input; press the shortcut again to restore it. Conflicting game bindings or duplicate hotkeys are explained before saving. Existing game bindings on F9/F10 are preserved and take priority over these new defaults.

A modifier used alone, such as **Alt**, triggers its shortcut on release; **Alt + Shift** does not trigger the default Alt shortcut. Editor fields keep normal keyboard input. **Menu** allows direct mouse taps/drags. Dragging a marker hides its settings until you click a marker or reopen Edit. Closing the overlay returns to scrcpy's native controls. Native UHID/gamepad forwarding must be off when using the overlay to avoid duplicate input. Changing phone resolution/rotation pauses input; manually rotating the scrcpy preview while the editor is closed requires reopening the virtual display before mapping.

Switching windows releases held inputs without leaving Play or revealing a hidden toolbar. Returning to the game resumes keyboard mappings without pressing Play again. A look zone shows **Click the game to capture mouse** when mouse capture needs restoring; the activation click does not fire a game binding. Gamepads must return to neutral before resuming. Explicit Menu/Escape remains Menu after switching windows. The owned Windows overlay receives focus when the user returns through the game window's title bar or taskbar. Hiding the toolbar keeps the input window active.

The bundled shell helper injects multi-pointer MotionEvents into the owned virtual display only. It pins the display's unique identity and Android user; a missing 500 ms heartbeat cancels held pointers. Blur, disconnect, resize, profile change and overlay closure release controls. Stale input epochs are ignored after cancellation/rotation. No root or installed phone app is required. Android may restrict injection; the overlay reports these errors. Gamepad mapping uses Chromium's standard controller layout.

Run `node --test scripts/touch-controls.test.mjs scripts/device-screen.test.mjs`, `npm test -- tests/touch-controls.spec.ts tests/screen-controls.spec.ts`, `node scripts/check-camera-native-dock.mjs --touch`, and `node scripts/check-touch-focus-desktop.mjs`. The focus test uses its own Windows fixtures, the production overlay/IPC and a mock Android transport. `scripts/check-touch-stream-hardware.mjs` tests Android input routing without installing an APK; `scripts/check-touch-hardware.mjs` additionally uses a temporary test-only APK when installation is permitted. Real game layouts and a physical controller still need game-specific verification.

Automated tests cover safe arguments, unsupported features, Android requirements, exact phone targeting, profile mismatch, cancelled save pickers, duplicate sessions, graceful closure, recording preservation, settings persistence, UI modes and app actions. Run `node --test scripts/device-screen.test.mjs scripts/exit-operations.test.mjs` after compiling Electron, and `npm test -- tests/screen-controls.spec.ts tests/toolbar.spec.ts`.

The multi-window and keyboard-location update has build/type checking only; functional testing is deferred to the next stage. That stage should cover independent closure/failure/recording of several windows on one phone, closing ADB Vault with several sessions, keyboard policy in both locations, saved preferences, and an older scrcpy without the IME option. USB/Wi-Fi and screen-off behavior require separate hardware checks.

The camera-controls update passes the build/type checks, 13 device-screen backend tests and 6 screen-controls browser tests. These cover independent/matched rotations, recording-only arguments, zoom/torch validation and capability gating, isolation from screen modes, preference migration/persistence, older scrcpy recovery, launch payloads and dialog layout. Camera zoom, flash and recorded orientation on real hardware are not yet verified.

The live-panel update adds owned-window command validation, concurrent control rejection, camera/sound replacement, picker cancellation, transport changes, recording start/split/stop and failed-finalization checks. Browser coverage includes all live buttons, change confirmations, pending/error states and compact layout. `node scripts/check-camera-window-control.mjs` checks the six shortcuts against the installed SDL3 library using a hidden test window, without global input or a phone. `node scripts/check-camera-panels.mjs` checks the built panel in Electron, its restricted IPC, hide/reopen, stable window during replacement and closure at session end. These checks do not verify a physical phone's camera, flash, audio or encoder.

Hardware checks still require a connected phone: play audio, operate UHID devices, open an app on a virtual display, capture both cameras, and play back a finished recording. Feature detection does not prove firmware support.

Official references: [video](https://github.com/Genymobile/scrcpy/blob/master/doc/video.md), [audio](https://github.com/Genymobile/scrcpy/blob/master/doc/audio.md), [recording](https://github.com/Genymobile/scrcpy/blob/master/doc/recording.md), [virtual display](https://github.com/Genymobile/scrcpy/blob/master/doc/virtual-display.md), [camera](https://github.com/Genymobile/scrcpy/blob/master/doc/camera.md), [gamepad](https://github.com/Genymobile/scrcpy/blob/master/doc/gamepad.md).
