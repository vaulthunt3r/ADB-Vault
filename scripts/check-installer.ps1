param([string]$Build = 'desktop-test-results/unified-installer-qa-build')
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaBuild = [IO.Path]::GetFullPath((Join-Path $workspace $Build))
if (-not $qaBuild.StartsWith((Join-Path $workspace 'desktop-test-results\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Only an isolated QA build is allowed.' }
$qaName = 'ADB Vault Installer QA'
$setup = Join-Path $qaBuild 'ADB-Vault-0.1.0-Windows-x64-Setup.exe'
$metadata = (Get-Item -LiteralPath $setup).VersionInfo
if ($metadata.ProductName -ne $qaName) { throw 'Refusing to test a production installer.' }
$root = Join-Path $workspace ('desktop-test-results\installer-run-' + [Guid]::NewGuid().ToString('N'))
$portable = Join-Path $root 'Portable folder'
$installed = Join-Path $root 'Installed folder'
$defaultInstalled = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "Programs\$qaName"
$profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'adb-vault-installer-qa'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$menu = [Environment]::GetFolderPath('Programs')
$desktopLink = Join-Path $desktop "$qaName.lnk"
$menuLink = Join-Path $menu "$qaName.lnk"
$portableLink = Join-Path $desktop "$qaName Portable.lnk"
$realBackend = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'adb-vault\backend.json'
$realHash = if (Test-Path -LiteralPath $realBackend) { (Get-FileHash -LiteralPath $realBackend).Hash } else { '' }
$checks = [Collections.Generic.List[string]]::new()
function Assert($condition, [string]$label) { if (-not $condition) { throw $label }; $checks.Add($label); Write-Output "PASS: $label" }
function Registrations {
  @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | ForEach-Object { Get-ItemProperty $_.PSPath } | Where-Object { $_.DisplayName -eq "$qaName 0.1.0" })
}
function Run([string]$exe, [string]$arguments, [int]$expected = 0) {
  $process = Start-Process -FilePath $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(120000)) { throw "Installer timeout, owned PID $($process.Id)" }
  $process.Refresh()
  if ($process.ExitCode -ne $expected) { throw "Expected exit $expected, received $($process.ExitCode): $arguments" }
}
function Uninstall([string]$options = '', [string]$destination = $installed) {
  $uninstaller = Join-Path $destination "Uninstall $qaName.exe"
  $runner = Join-Path $root ('uninstall-' + [Guid]::NewGuid().ToString('N') + '.exe')
  Copy-Item -LiteralPath $uninstaller -Destination $runner
  Run $runner "/S /currentuser $options _?=$destination"
}
function CheckLink([string]$link, [string]$target) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($link)
  Assert ($shortcut.TargetPath -eq $target) "Shortcut targets the chosen EXE: $([IO.Path]::GetFileName($link))"
}
Assert (-not (Test-Path -LiteralPath $profile)) 'QA profile did not exist before testing'
Assert ((Registrations).Count -eq 0) 'No existing QA registration'
Assert (-not (Test-Path -LiteralPath $defaultInstalled)) 'Default QA destination does not exist before testing'
foreach ($link in @($desktopLink, $menuLink, $portableLink, (Join-Path $menu "$qaName Portable.lnk"))) { if (Test-Path -LiteralPath $link) { throw "Existing QA shortcut: $link" } }
New-Item -ItemType Directory -Path $root | Out-Null
try {
  # Do NOT pass /D: NSIS creates a /D destination during .onInit, hiding the
  # missing-folder bug seen in the interactive wizard. Validate the untouched
  # default path and let the actual install create it only afterwards.
  Write-Output 'Testing installation into the nonexistent default folder...'
  Run $setup '/S /currentuser /DESKTOP=0 /STARTMENU=0'
  Assert (Test-Path -LiteralPath (Join-Path $defaultInstalled "$qaName.exe")) 'Install accepted and created the missing default folder'
  $defaultRegistration = @(Registrations)
  Assert ($defaultRegistration.Count -eq 1) 'Default installation created one QA registration'
  $registeredFolder = Get-ItemPropertyValue -LiteralPath (Join-Path 'HKCU:\Software' $defaultRegistration[0].PSChildName) -Name InstallLocation
  Assert ($registeredFolder -eq $defaultInstalled) 'Default installation registered the expected folder'
  Uninstall -destination $defaultInstalled
  Assert (-not (Test-Path -LiteralPath $defaultInstalled)) 'Default QA installation was removed after the regression check'
  Assert ((Registrations).Count -eq 0) 'Default-folder regression check left no registration'

  Write-Output 'Testing portable extraction and update...'
  Run $setup "/S /PORTABLE /D=$portable"
  $portableExe = Join-Path $portable "$qaName.exe"
  Assert (Test-Path -LiteralPath $portableExe) 'Portable executable extracted'
  Assert (Test-Path -LiteralPath (Join-Path $portable 'portable-mode')) 'Portable marker created'
  Assert (-not (Test-Path -LiteralPath (Join-Path $portable "Uninstall $qaName.exe"))) 'Portable has no uninstaller'
  Assert (-not (Test-Path -LiteralPath (Join-Path $portable 'data'))) 'Portable contains no preloaded profile'
  Assert ((Registrations).Count -eq 0) 'Portable did not register an installation'
  Assert (-not (Test-Path -LiteralPath $portableLink)) 'Portable shortcuts default to off'
  New-Item -ItemType Directory -Path (Join-Path $portable 'data\components') | Out-Null
  Set-Content -LiteralPath (Join-Path $portable 'data\qa-settings.json') -Value '{"keep":true}'
  Set-Content -LiteralPath (Join-Path $portable 'data\components\qa-tool.txt') -Value 'keep component'
  Run $setup "/S /PORTABLE /DESKTOP=1 /STARTMENU=1 /D=$portable"
  Assert ((Get-Content -LiteralPath (Join-Path $portable 'data\qa-settings.json') -Raw).Trim() -eq '{"keep":true}') 'Portable update preserved settings'
  Assert (Test-Path -LiteralPath (Join-Path $portable 'data\components\qa-tool.txt')) 'Portable update preserved components'
  CheckLink $portableLink $portableExe
  CheckLink (Join-Path $menu "$qaName Portable.lnk") $portableExe
  Run $setup "/S /currentuser /D=$portable" 3
  Assert (Test-Path -LiteralPath (Join-Path $portable 'data\qa-settings.json')) 'Install mode rejected a portable folder without changing its data'
  $occupied = Join-Path $root 'Unrelated folder'
  New-Item -ItemType Directory -Path $occupied | Out-Null
  Set-Content -LiteralPath (Join-Path $occupied 'keep.txt') -Value 'untouched'
  Run $setup "/S /PORTABLE /D=$occupied" 3
  Assert ((Get-ChildItem -LiteralPath $occupied).Count -eq 1) 'Unrelated nonempty folder was rejected'

  Write-Output 'Testing installed mode, shortcuts and uninstall...'
  Run $setup "/S /currentuser /DESKTOP=0 /STARTMENU=0 /D=$installed"
  $installedExe = Join-Path $installed "$qaName.exe"
  Assert (Test-Path -LiteralPath $installedExe) 'Installed executable exists'
  Assert (Test-Path -LiteralPath (Join-Path $installed "Uninstall $qaName.exe")) 'Uninstaller created'
  Assert (-not (Test-Path -LiteralPath (Join-Path $installed 'portable-mode'))) 'Installed mode has no portable marker'
  Assert ((Registrations).Count -eq 1) 'Exactly one QA installation registered'
  Assert (-not (Test-Path -LiteralPath $desktopLink)) 'Desktop shortcut can be disabled'
  Assert (-not (Test-Path -LiteralPath $menuLink)) 'Start menu shortcut can be disabled'
  Run $setup "/S /PORTABLE /D=$installed" 3
  New-Item -ItemType Directory -Path $profile | Out-Null
  Set-Content -LiteralPath (Join-Path $profile 'qa-settings.json') -Value '{"keep":true}'
  Run $setup "/S /currentuser /DESKTOP=1 /STARTMENU=1 /D=$installed"
  Assert (Test-Path -LiteralPath (Join-Path $profile 'qa-settings.json')) 'Installed update preserved the profile'
  CheckLink $desktopLink $installedExe
  CheckLink $menuLink $installedExe
  Run $setup "/S /currentuser /D=$installed"
  Assert ((Test-Path -LiteralPath $desktopLink) -and (Test-Path -LiteralPath $menuLink)) 'Update remembered shortcut preferences'

  # Run Electron's Node mode only. Never start the Android backend or a UI.
  $holdScript = Join-Path $root 'hold.cjs'
  Set-Content -LiteralPath $holdScript -Value 'setInterval(() => {}, 1000)'
  $savedNodeMode = $env:ELECTRON_RUN_AS_NODE
  $env:ELECTRON_RUN_AS_NODE = '1'
  $held = Start-Process -FilePath $installedExe -ArgumentList ('"' + $holdScript + '"') -WindowStyle Hidden -PassThru
  $env:ELECTRON_RUN_AS_NODE = $savedNodeMode
  try {
    Start-Sleep -Milliseconds 400
    Assert (-not $held.HasExited) 'Owned QA process is running'
    Run $setup "/S /currentuser /D=$installed" 2
    Assert (-not $held.HasExited) 'Update refused the running app without terminating it'
  } finally { if (-not $held.HasExited) { $held.Kill(); $held.WaitForExit() } }

  Uninstall
  Assert (-not (Test-Path -LiteralPath $installedExe)) 'Uninstall removed application files'
  Assert (Test-Path -LiteralPath (Join-Path $profile 'qa-settings.json')) 'Default uninstall preserved personal data'
  Assert ((Registrations).Count -eq 0) 'Uninstall removed the QA registration'
  Assert ((-not (Test-Path -LiteralPath $desktopLink)) -and (-not (Test-Path -LiteralPath $menuLink))) 'Uninstall removed installed shortcuts'
  Run $setup "/S /currentuser /DESKTOP=0 /STARTMENU=0 /D=$installed"
  Uninstall '--delete-app-data --updated'
  Assert (Test-Path -LiteralPath (Join-Path $profile 'qa-settings.json')) 'Upgrade uninstall never removes personal data'
  Run $setup "/S /currentuser /DESKTOP=0 /STARTMENU=0 /D=$installed"
  Uninstall '--delete-app-data'
  Assert (-not (Test-Path -LiteralPath $profile)) 'Explicit data removal removed only the QA profile'
  Assert (Test-Path -LiteralPath (Join-Path $occupied 'keep.txt')) 'Unrelated files were preserved'
  Assert (Test-Path -LiteralPath (Join-Path $portable 'data\qa-settings.json')) 'Separate portable profile was preserved'
  $afterHash = if (Test-Path -LiteralPath $realBackend) { (Get-FileHash -LiteralPath $realBackend).Hash } else { '' }
  Assert ($afterHash -eq $realHash) 'Working ADB Vault backend settings were unchanged'
} finally {
  foreach ($link in @($portableLink, (Join-Path $menu "$qaName Portable.lnk"))) {
    if (Test-Path -LiteralPath $link) {
      $shell = New-Object -ComObject WScript.Shell
      if ($shell.CreateShortcut($link).TargetPath -eq (Join-Path $portable "$qaName.exe")) { Remove-Item -LiteralPath $link }
    }
  }
  $qaCache = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'adb-vault-installer-qa-updater'))
  $cachedSetup = Join-Path $qaCache 'installer.exe'
  if ((Test-Path -LiteralPath $cachedSetup) -and -not ((Get-Item -LiteralPath $qaCache).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    if ((Get-FileHash -LiteralPath $cachedSetup).Hash -eq (Get-FileHash -LiteralPath $setup).Hash) {
      Remove-Item -LiteralPath $cachedSetup
      if (@(Get-ChildItem -LiteralPath $qaCache -Force).Count -eq 0) { Remove-Item -LiteralPath $qaCache }
    }
  }
  [pscustomobject]@{ checks = $checks.ToArray(); completed = $checks.Contains('Working ADB Vault backend settings were unchanged'); root = $root } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'report.json')
  Write-Output "Report: $root\report.json"
}
