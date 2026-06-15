<#
  Register a daily Windows Scheduled Task that runs backup.ps1.
  Run once (as your normal user):

      powershell -ExecutionPolicy Bypass -File backup\register-task.ps1

  Change the time with -At, e.g. -At 02:30
  Remove later with:  Unregister-ScheduledTask -TaskName "MemoryLane Backup" -Confirm:$false
#>
param(
  [string]$At = "03:00",
  [string]$TaskName = "MemoryLane Backup"
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "backup.ps1"
if (-not (Test-Path $script)) { throw "backup.ps1 not found at $script" }

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$script`""
$trigger  = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Description "Daily local backup of Supabase Postgres + photo bucket" -Force

Write-Host "[register] task '$TaskName' scheduled daily at $At"
Write-Host "[register] run now to test:  Start-ScheduledTask -TaskName '$TaskName'"
