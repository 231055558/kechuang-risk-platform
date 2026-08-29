param(
  [string]$TaskName = "KeChuang Risk Platform"
)

$ErrorActionPreference = "Stop"
$startupScript = Join-Path $PSScriptRoot "start-at-login.ps1"
$powerShell = Join-Path $PSHOME "powershell.exe"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$argument = "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startupScript`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Starts the local KeChuang risk platform and bundled read-only graph at sign-in." `
  -User $currentUser `
  -RunLevel Limited `
  -Force | Out-Null

Write-Output "Registered scheduled task: $TaskName"
