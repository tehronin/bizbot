param(
  [string]$TaskName = "BizBot Weekly Junk Cleanup"
)

$ErrorActionPreference = "Stop"

if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  Write-Output ("Scheduled task '{0}' was not present." -f $TaskName)
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Output ("Removed scheduled task '{0}'." -f $TaskName)
