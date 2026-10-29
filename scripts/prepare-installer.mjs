import fs from 'node:fs/promises'
import path from 'node:path'

// Keep electron-builder's upgrade/elevation behavior; fail on changed template
// anchors instead of silently shipping an incompatible installer after an update.
const base = 'node_modules/app-builder-lib/templates/nsis'
const out = 'build/generated'
await fs.mkdir(out, { recursive: true })
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('NSIS template changed: ' + before.slice(0, 100))
  return source.replace(before, after)
}
let main = await fs.readFile(path.join(base, 'installer.nsi'), 'utf8')
main = main.replaceAll('\r\n', '\n')
main = replaceOnce(main, '!include "allowOnlyOneInstallerInstance.nsh"', '!ifndef BUILD_UNINSTALLER\n  Var appExe\n  Var launchLink\n!endif\n!include "${BUILD_RESOURCES_DIR}\\wizard.nsh"\n!include "allowOnlyOneInstallerInstance.nsh"')
main = replaceOnce(main, '!else\n  Var appExe\n  Var launchLink\n!endif', '!endif')
main = replaceOnce(main, '!include "assistedInstaller.nsh"', '!include "${BUILD_RESOURCES_DIR}\\generated\\assistedInstaller.nsh"')
main = replaceOnce(main, '!ifdef BUILD_UNINSTALLER\n  !ifmacrodef customUnInstallSection\n    !define MUI_COMPONENTSPAGE_NODESC\n    !insertmacro MUI_UNPAGE_COMPONENTS\n  !endif\n!endif', '')
main = replaceOnce(main, '    # If we\'re running a silent upgrade', '    Call AdbValidateDestination\n    ${If} $adbPortable == 1\n      Call AdbExtractPortable\n    ${Else}\n    # If we\'re running a silent upgrade')
main = replaceOnce(main, '    !include "installSection.nsh"', '    !include "installSection.nsh"\n    ${EndIf}')
// A custom NSIS script does not get electron-builder's separate signed-uninstaller
// pass. Compile both halves together and use NSIS WriteUninstaller at install time.
main = replaceOnce(main, '!ifdef BUILD_UNINSTALLER\n  !include "uninstaller.nsh"\n!endif', '!define BUILD_UNINSTALLER\n!include "${BUILD_RESOURCES_DIR}\\generated\\uninstaller.nsh"\n!undef BUILD_UNINSTALLER')
main = replaceOnce(main, '!insertmacro addLangs', '!define BUILD_UNINSTALLER\n!insertmacro customUnWelcomePage\n!insertmacro PAGE_INSTALL_MODE\n!insertmacro MUI_UNPAGE_INSTFILES\n!insertmacro MUI_UNPAGE_FINISH\n!undef BUILD_UNINSTALLER\nShowUninstDetails nevershow\n!insertmacro addLangs')
main = replaceOnce(main, '!include "installSection.nsh"', '!include "${BUILD_RESOURCES_DIR}\\generated\\installSection.nsh"')
let uninstall = (await fs.readFile(path.join(base, 'uninstaller.nsh'), 'utf8')).replaceAll('\r\n', '\n')
const start = uninstall.indexOf('  Var /GLOBAL isDeleteAppData\n')
const end = uninstall.indexOf('  DeleteRegKey SHELL_CONTEXT', start)
if (start < 0 || end < 0) throw new Error('NSIS uninstaller data-removal block changed')
uninstall = uninstall.slice(0, start) + '  Call un.AdbRemoveUserData\n\n' + uninstall.slice(end)
uninstall = replaceOnce(uninstall, '!insertmacro CHECK_APP_RUNNING', '!insertmacro customCheckAppRunning')
await fs.writeFile(path.join(out, 'installer.nsi'), main)
await fs.writeFile(path.join(out, 'uninstaller.nsh'), uninstall)
let assisted = (await fs.readFile(path.join(base, 'assistedInstaller.nsh'), 'utf8')).replaceAll('\r\n', '\n')
assisted = replaceOnce(assisted, '!include multiUserUi.nsh', '!include "${BUILD_RESOURCES_DIR}\\generated\\multiUserUi.nsh"')
assisted = replaceOnce(assisted, '    !include StrContains.nsh', '')
assisted = replaceOnce(assisted, '    !insertmacro MUI_PAGE_DIRECTORY', '    !define MUI_PAGE_CUSTOMFUNCTION_LEAVE AdbDirectoryLeave\n    !insertmacro MUI_PAGE_DIRECTORY')
const from = assisted.indexOf('    # pageDirectory leave')
const to = assisted.indexOf('    FunctionEnd', from)
if (from < 0 || to < 0) throw new Error('NSIS directory page changed')
// Read the actual edit control: NSIS may not have copied it into INSTDIR yet.
// Abort from LEAVE keeps the user on the directory page; PRE would skip a page.
assisted = assisted.slice(0, from) + '    Function AdbDirectoryLeave\n      ${NSD_GetText} $mui.DirectoryPage.Directory $INSTDIR\n      Call AdbValidateDestination\n      SetErrorLevel 0\n' + assisted.slice(to)
await fs.writeFile(path.join(out, 'assistedInstaller.nsh'), assisted)
let multiUserUi = (await fs.readFile(path.join(base, 'multiUserUi.nsh'), 'utf8')).replaceAll('\r\n', '\n')
multiUserUi = replaceOnce(multiUserUi, '  Var MultiUser.InstallModePage\n', '  !ifndef ADBV_MULTIUSER_VARS\n  !define ADBV_MULTIUSER_VARS\n  Var MultiUser.InstallModePage\n')
multiUserUi = replaceOnce(multiUserUi, '  Var MultiUser.InstallModePage.ReturnValue\n', '  Var MultiUser.InstallModePage.ReturnValue\n  !endif\n')
await fs.writeFile(path.join(out, 'multiUserUi.nsh'), multiUserUi)
let installSection = await fs.readFile(path.join(base, 'installSection.nsh'), 'utf8')
installSection = replaceOnce(installSection, '!include installer.nsh', '!include "${BUILD_RESOURCES_DIR}\\generated\\installFiles.nsh"')
await fs.writeFile(path.join(out, 'installSection.nsh'), installSection)
let installFiles = await fs.readFile(path.join(base, 'include/installer.nsh'), 'utf8')
installFiles = replaceOnce(installFiles, 'File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"', 'WriteUninstaller "$INSTDIR\\${UNINSTALL_FILENAME}"')
await fs.writeFile(path.join(out, 'installFiles.nsh'), installFiles)
console.log('Prepared unified installer using the installed electron-builder templates.')
