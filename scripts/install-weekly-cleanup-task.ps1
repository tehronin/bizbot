param(
  [string]$TaskName = "BizBot Weekly Junk Cleanup",
  [ValidateSet("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN")]
  [string]$DayOfWeek = "SUN",
  [string]$At = "04:00"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runnerScript = Join-Path $repoRoot "scripts\run-weekly-cleanup.ps1"

if (-not (Test-Path -LiteralPath $runnerScript)) {
  throw "Missing cleanup runner script: $runnerScript"
}

$triggerDay = switch ($DayOfWeek) {
  "MON" { "Monday" }
  "TUE" { "Tuesday" }
  "WED" { "Wednesday" }
  "THU" { "Thursday" }
  "FRI" { "Friday" }
  "SAT" { "Saturday" }
  "SUN" { "Sunday" }
}

$startBoundary = [datetime]::ParseExact($At, "HH:mm", $null)
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}"' -f $runnerScript, $repoRoot)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $triggerDay -At $startBoundary
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description "Weekly BizBot generated-artifact cleanup" -Force | Out-Null

Write-Output ("Installed scheduled task '{0}' for {1} at {2}." -f $TaskName, $DayOfWeek, $At)
