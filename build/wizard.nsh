!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

; The QA build has a different app ID, registry keys, shortcuts and profile.
!if "${APP_ID}" == "dev.adbvault.installer.qa"
  !define ADBV_PROFILE_NAME "adb-vault-installer-qa"
!else
  !define ADBV_PROFILE_NAME "adb-vault"
!endif

Var adbPortable
Var adbDesktop
Var adbMenu
Var adbPage
Var adbInstallRadio
Var adbPortableRadio
Var adbDesktopCheck
Var adbMenuCheck
Var adbInstalledDir
Var adbPortableDir
Var adbRemoveData
Var adbRemoveCheck
Var adbFolderError

; Never kill the app or an active phone operation from the installer.
!macro customCheckAppRunning
  ${Do}
    nsProcess::_FindProcess "${APP_EXECUTABLE_FILENAME}"
    Pop $0
    ${If} $0 == 603
      ${Break}
    ${EndIf}
    ${If} ${Silent}
      SetErrorLevel 2
      Quit
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Close ${PRODUCT_NAME} and its screen windows, then click Retry to continue. Setup will not stop your phone operations." IDRETRY +3
    SetErrorLevel 2
    Quit
  ${Loop}
!macroend

!macro customInit
  StrCpy $adbPortable 0
  StrCpy $adbDesktop 1
  StrCpy $adbMenu 1
  StrCpy $adbInstalledDir $INSTDIR
  SetShellVarContext current
  StrCpy $adbPortableDir "$DOCUMENTS\${PRODUCT_NAME} Portable"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/PORTABLE" $1
  ${IfNot} ${Errors}
    StrCpy $adbPortable 1
    StrCpy $adbDesktop 0
    StrCpy $adbMenu 0
    StrCpy $installMode CurrentUser
    SetShellVarContext current
    StrCpy $INSTDIR $adbPortableDir
    !insertmacro GetDParameter $1
    ${If} $1 != ""
      StrCpy $INSTDIR $1
    ${EndIf}
  ${Else}
    ReadRegDWORD $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VaultDesktopShortcut
    ${IfNot} ${Errors}
      StrCpy $adbDesktop $1
    ${EndIf}
    ReadRegDWORD $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VaultMenuShortcut
    ${IfNot} ${Errors}
      StrCpy $adbMenu $1
    ${EndIf}
  ${EndIf}
  ${GetOptions} $0 "/DESKTOP=" $1
  ${IfNot} ${Errors}
    StrCpy $adbDesktop $1
  ${EndIf}
  ${GetOptions} $0 "/STARTMENU=" $1
  ${IfNot} ${Errors}
    StrCpy $adbMenu $1
  ${EndIf}
!macroend

!macro customWelcomePage
  Page custom AdbModePage AdbModeLeave
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${If} $adbPortable == 1
      Abort
    ${EndIf}
  !endif
!macroend

!macro customPageAfterChangeDir
  Page custom AdbOptionsPage AdbOptionsLeave
!macroend

!macro customFinishPage
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"
  !define MUI_FINISHPAGE_RUN_FUNCTION AdbLaunch
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Open the portable folder"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION AdbOpenFolder
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW AdbFinishShow
  !insertmacro MUI_PAGE_FINISH
  Function AdbFinishShow
    ${If} $adbPortable != 1
      ShowWindow $mui.FinishPage.ShowReadme ${SW_HIDE}
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  ${If} $adbDesktop != 1
    WinShell::UninstShortcut "$newDesktopLink"
    Delete "$newDesktopLink"
  ${EndIf}
  ${If} $adbMenu != 1
    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
  ${EndIf}
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VaultDesktopShortcut $adbDesktop
  WriteRegDWORD SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" VaultMenuShortcut $adbMenu
  StrCpy $launchLink "$appExe"
!macroend

!ifndef BUILD_UNINSTALLER
Function AdbModePage
  ${If} ${UAC_IsInnerInstance}
  ${OrIf} ${isUpdated}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Choose how to use ${PRODUCT_NAME}" "Install on this PC or create a portable folder."
  nsDialogs::Create 1018
  Pop $adbPage
  ${NSD_CreateRadioButton} 0 6u 100% 20u "Install on this computer"
  Pop $adbInstallRadio
  ${NSD_CreateLabel} 12u 30u 94% 30u "Register the app in Windows, choose shortcuts and update an existing installation. Settings stay in your Windows user profile."
  Pop $0
  ${NSD_CreateRadioButton} 0 72u 100% 20u "Portable - extract to a folder"
  Pop $adbPortableRadio
  ${NSD_CreateLabel} 12u 96u 94% 42u "Keep settings, notes, game profiles and downloaded components in the data folder beside the EXE. No Windows installation or uninstaller is registered."
  Pop $0
  ${If} $adbPortable == 1
    ${NSD_Check} $adbPortableRadio
  ${Else}
    ${NSD_Check} $adbInstallRadio
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function AdbModeLeave
  ${NSD_GetState} $adbPortableRadio $0
  ${If} $0 != $adbPortable
    ${If} $0 == 1
      StrCpy $adbInstalledDir $INSTDIR
      StrCpy $INSTDIR $adbPortableDir
      StrCpy $adbDesktop 0
      StrCpy $adbMenu 0
      StrCpy $installMode CurrentUser
      SetShellVarContext current
    ${Else}
      StrCpy $adbPortableDir $INSTDIR
      StrCpy $INSTDIR $adbInstalledDir
      StrCpy $adbDesktop 1
      StrCpy $adbMenu 1
    ${EndIf}
  ${EndIf}
  StrCpy $adbPortable $0
FunctionEnd

Function AdbOptionsPage
  !insertmacro MUI_HEADER_TEXT "Shortcuts" "Choose which shortcuts to create."
  nsDialogs::Create 1018
  Pop $adbPage
  ${NSD_CreateCheckbox} 0 12u 100% 20u "Create a desktop shortcut"
  Pop $adbDesktopCheck
  ${NSD_SetState} $adbDesktopCheck $adbDesktop
  ${NSD_CreateCheckbox} 0 42u 100% 20u "Create a Start menu shortcut"
  Pop $adbMenuCheck
  ${NSD_SetState} $adbMenuCheck $adbMenu
  ${If} $adbPortable == 1
    ${NSD_CreateLabel} 0 82u 100% 50u "Portable shortcuts point to the selected folder. Recreate them if you move it. Existing data in this portable folder will be kept."
  ${Else}
    ${NSD_CreateLabel} 0 82u 100% 50u "Your settings, notes and game profiles will be kept when updating. Close ADB Vault before continuing."
  ${EndIf}
  Pop $0
  nsDialogs::Show
FunctionEnd

Function AdbOptionsLeave
  ${NSD_GetState} $adbDesktopCheck $adbDesktop
  ${NSD_GetState} $adbMenuCheck $adbMenu
FunctionEnd

Function AdbValidateDestination
  StrCpy $adbFolderError "Choose a dedicated folder for ADB Vault."
  ; NSIS GetFullPathName also probes the last path component and can return an
  ; empty string for a not-yet-created folder. The Win32 API only resolves it.
  StrCpy $2 $INSTDIR
  System::Call 'kernel32::GetFullPathNameW(w r2, i ${NSIS_MAX_STRLEN}, w .r3, p 0)i.r4'
  ${If} $4 == 0
  ${OrIf} $4 >= ${NSIS_MAX_STRLEN}
    StrCpy $adbFolderError "This folder path could not be resolved. Choose a valid destination folder."
    Goto AdbBadFolder
  ${EndIf}
  StrCpy $INSTDIR $3
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == $0
  ${OrIf} $INSTDIR == "$0\"
    Goto AdbBadFolder
  ${EndIf}
  ; Normalize a trailing separator before comparing protected/install folders.
  ${Do}
    StrCpy $1 $INSTDIR 1 -1
    ${If} $1 != "\"
      ${Break}
    ${EndIf}
    StrCpy $INSTDIR $INSTDIR -1
  ${Loop}
  ${GetParent} "$INSTDIR" $0
  ${If} $0 == ""
  ${OrIf} $INSTDIR == $WINDIR
  ${OrIf} $INSTDIR == $PROFILE
  ${OrIf} $INSTDIR == $DOCUMENTS
  ${OrIf} $INSTDIR == $APPDATA
  ${OrIf} $INSTDIR == $LOCALAPPDATA
  ${OrIf} $INSTDIR == $PROGRAMFILES
  ${OrIf} $INSTDIR == $PROGRAMFILES64
    Goto AdbBadFolder
  ${EndIf}
  ${If} $adbPortable == 1
    ${If} ${FileExists} "$INSTDIR\${UNINSTALL_FILENAME}"
      StrCpy $adbFolderError "This folder contains an installed copy. Choose Install to update it, or choose another folder for Portable."
      Goto AdbBadFolder
    ${EndIf}
    ${If} ${FileExists} "$INSTDIR\portable-mode"
      Return
    ${EndIf}
  ${Else}
    ${If} ${FileExists} "$INSTDIR\portable-mode"
      StrCpy $adbFolderError "This folder contains a portable copy. Choose Portable to update it, or choose another folder for Install."
      Goto AdbBadFolder
    ${EndIf}
    ${If} $INSTDIR == $perUserInstallationFolder
    ${OrIf} $INSTDIR == $perMachineInstallationFolder
      Return
    ${EndIf}
  ${EndIf}
  FindFirst $0 $1 "$INSTDIR\*"
  ${DoWhile} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      StrCpy $adbFolderError "This folder contains other files. Choose an empty folder or your existing ADB Vault installation folder."
      FindClose $0
      Goto AdbBadFolder
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
  Return
  AdbBadFolder:
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$adbFolderError$\r$\n$\r$\nFolder: $INSTDIR"
    ${EndIf}
    SetErrorLevel 3
    Abort
FunctionEnd

Function AdbExtractPortable
  !insertmacro customCheckAppRunning
  InitPluginsDir
  SetShellVarContext current
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
  ; Extract to staging first. Copy never deletes the existing data directory.
  SetCompress off
  File /oname=$PLUGINSDIR\portable.7z "${APP_64}"
  SetCompress ${COMPRESS}
  CreateDirectory "$PLUGINSDIR\portable-payload"
  SetOutPath "$PLUGINSDIR\portable-payload"
  Nsis7z::Extract "$PLUGINSDIR\portable.7z"
  IfFileExists "$PLUGINSDIR\portable-payload\${APP_EXECUTABLE_FILENAME}" 0 AdbPortableFailed
  ClearErrors
  CopyFiles /SILENT "$PLUGINSDIR\portable-payload\*" "$INSTDIR"
  IfErrors AdbPortableFailed
  SetOutPath "$INSTDIR"
  ClearErrors
  FileOpen $0 "$INSTDIR\portable-mode" w
  IfErrors AdbPortableFailed
  FileWrite $0 "ADB Vault portable profile marker. Keep beside the EXE.$\r$\n"
  FileClose $0
  IfErrors AdbPortableFailed
  StrCpy $appExe "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  StrCpy $launchLink $appExe
  ${If} $adbDesktop == 1
    CreateShortcut "$DESKTOP\${PRODUCT_NAME} Portable.lnk" "$appExe" "" "$appExe"
  ${EndIf}
  ${If} $adbMenu == 1
    CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME} Portable.lnk" "$appExe" "" "$appExe"
  ${EndIf}
  Return
  AdbPortableFailed:
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Portable extraction could not finish. Check free space and folder permissions, then retry. Your data folder was kept."
    ${EndIf}
    SetErrorLevel 4
    Abort
FunctionEnd

Function AdbLaunch
  ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
FunctionEnd

Function AdbOpenFolder
  ${StdUtils.ExecShellAsUser} $0 "$INSTDIR" "open" ""
FunctionEnd

!endif

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.AdbDataPage un.AdbDataLeave
!macroend

!macro customUnInit
  StrCpy $adbRemoveData 0
  ${IfNot} ${isUpdated}
    ${GetParameters} $0
    ${GetOptions} $0 "--delete-app-data" $1
    ${IfNot} ${Errors}
      StrCpy $adbRemoveData 1
    ${EndIf}
  ${EndIf}
!macroend

Function un.AdbDataPage
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "Personal data" "Keep your settings unless you choose to remove them."
  nsDialogs::Create 1018
  Pop $adbPage
  ${NSD_CreateLabel} 0 6u 100% 48u "The application will be removed. Your settings, personal app notes, game control profiles and downloaded components are kept by default."
  Pop $0
  ${NSD_CreateCheckbox} 0 65u 100% 25u "Also delete my settings, notes, presets and downloaded components"
  Pop $adbRemoveCheck
  ${NSD_Uncheck} $adbRemoveCheck
  ${NSD_CreateLabel} 0 106u 100% 42u "This applies only to the current Windows user's ADB Vault profile. Other users' profiles, external tools and exported phone backups are kept."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function un.AdbDataLeave
  ${NSD_GetState} $adbRemoveCheck $adbRemoveData
FunctionEnd

Function un.AdbRemoveUserData
  ${If} $adbRemoveData != 1
  ${OrIf} ${isUpdated}
    Return
  ${EndIf}
  SetShellVarContext current
  StrCpy $0 "$APPDATA\${ADBV_PROFILE_NAME}"
  ; Fixed profile directory only; never follow a redirected profile root.
  System::Call 'kernel32::GetFileAttributesW(w r0)i.r1'
  IntOp $1 $1 & 0x400
  ${If} $1 == 0
    RMDir /r "$0"
  ${Else}
    DetailPrint "Profile is redirected or absent; personal data was preserved."
  ${EndIf}
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
FunctionEnd
