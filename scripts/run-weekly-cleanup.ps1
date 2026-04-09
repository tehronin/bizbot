param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

function Write-Log {
  param(
    [string]$Message,
    [string]$LogFile
  )

  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $line | Tee-Object -FilePath $LogFile -Append | Out-Null
}

$npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue)?.Source
if (-not $npmCommand) {
  $npmCommand = (Get-Command npm -ErrorAction SilentlyContinue)?.Source
}

if (-not $npmCommand) {
  throw "npm was not found on PATH. Weekly cleanup cannot run."
}

$logRoot = Join-Path $env:LOCALAPPDATA "BizBot\cleanup-logs"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$logFile = Join-Path $logRoot ("weekly-cleanup-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

Write-Log "Starting BizBot weekly cleanup in $RepoRoot" $logFile

Push-Location $RepoRoot
try {
  Write-Log "Dry-run: npm run cleanup:junk:dry-run" $logFile
  & $npmCommand run cleanup:junk:dry-run 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Dry-run cleanup failed with exit code $LASTEXITCODE"
  }

  Write-Log "Cleanup: npm run cleanup:junk" $logFile
  & $npmCommand run cleanup:junk 2>&1 | Tee-Object -FilePath $logFile -Append | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Cleanup failed with exit code $LASTEXITCODE"
  }

  Write-Log "Weekly cleanup completed successfully" $logFile
}
finally {
  Pop-Location
}
