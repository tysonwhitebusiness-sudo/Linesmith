# One-time setup for the CORPUS REFRESH scheduled task (Phase 5.S.8).
#
# WHY THIS IS A SCHEDULED TASK AND NOT A JOB_REGISTRY ENTRY.
# `corpus_store.py` measured the export at ~280 MB peak RSS for a single
# partition (312 MB on `prop_odds_history` the day this was written) against a
# 512 MB Render plan shared with 37 other jobs. That is not a preference, it is
# an arithmetic exclusion. The export runs here, beside OddsHarvester's tasks.
#
# WHY IT MATTERS THAT IT RUNS AT ALL.
# Before 5.S.8 the corpus was a convenience: `prop_odds_history` held
# everything, and a stale export cost nothing. Now Postgres keeps a 14-day hot
# window and the corpus is the ONLY copy of anything older. `prune_corpus`
# refuses to delete a row it cannot see in the corpus, so a stalled export
# never LOSES data - it just silently stops reclaiming space while the table
# grows at ~123 MB/day. Silent is the problem; `health_check.py`'s
# corpusFreshness check is the alarm, and this task is what keeps it quiet.
#
# Usage:
#   .\scripts\corpus-refresh-setup.ps1
#   .\scripts\corpus-refresh-setup.ps1 -IntervalMinutes 720
#   .\scripts\corpus-refresh-setup.ps1 -Remove

param(
    # SIX HOURS, not hourly and not daily.
    #
    # Not hourly: an incremental refresh re-exports the one OPEN partition and
    # re-uploads it whole (measured 45s / 2.1 MB against 623s / 28.8 MB for a
    # full rebuild). Hourly would spend 24 of those a day to bank a few
    # thousand rows.
    #
    # Not daily: the window that matters is the RETENTION boundary, not the
    # clock. A row must reach the corpus before it ages out of the 14-day hot
    # window, and six hours leaves that enormous margin while still bounding
    # how much sits in exactly one place.
    [int]$IntervalMinutes = 360,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pyOddsDir = Join-Path $repoRoot "python-odds-service"
$venvPython = Join-Path $pyOddsDir ".venv\Scripts\python.exe"
$taskName = "LinesmithCorpusRefresh"

if ($Remove) {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed '$taskName'."
    } else {
        Write-Host "'$taskName' is not registered."
    }
    return
}

if (-not (Test-Path $venvPython)) {
    Write-Error "No venv at $venvPython. Create it in python-odds-service first."
}

# The .env.local this reads lives in the repo root and holds CORPUS_S3_*.
# Checked here rather than discovered at 3am by a task that exits non-zero:
# `corpus_location` raises CorpusNotConfigured instead of silently falling back
# to a local directory, which is correct and also invisible from Task Scheduler.
$envLocal = Join-Path $repoRoot ".env.local"
if (-not (Test-Path $envLocal)) {
    Write-Error "No .env.local at $envLocal - the refresh needs CORPUS_URI and CORPUS_S3_*."
}
$corpusConfigured = (Select-String -Path $envLocal -Pattern '^CORPUS_URI=s3://' -Quiet)
if (-not $corpusConfigured) {
    Write-Warning "CORPUS_URI in .env.local is not an s3:// location. The refresh will export locally and upload nothing."
}

# Task Scheduler captures NO stdout/stderr by default - the harvester setup
# found this live, with LastTaskResult reading 0 while the run had produced
# nothing and left no way to see why. Same fix: a tiny .bat wrapper that
# redirects into its own log.
$logPath = Join-Path $pyOddsDir "corpus-refresh.log"
$batPath = Join-Path $pyOddsDir "run-corpus-refresh.bat"
@"
@echo off
echo ---- %date% %time% ---- >> "$logPath"
"$venvPython" refresh_corpus.py --prune >> "$logPath" 2>&1
"@ | Set-Content -Path $batPath -Encoding ASCII

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing '$taskName' to re-register with current settings..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Interactive + Limited, matching the harvester setup: registers without admin
# rights on a standard account, and runs while the account is logged in with
# the screen locked. S4U needs elevation to register and was rejected there for
# the same reason.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive -RunLevel Limited
$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $pyOddsDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)   # PowerShell has no "forever"
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 60) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew
# 60 minutes covers a FULL rebuild (623s measured) with room for a cold cache
# or a slow uplink, not just the 45s incremental case. IgnoreNew because two
# concurrent exports would write the same partition files.

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Settings $settings -Principal $principal `
        -Description "Linesmith: incremental corpus export + upload (Phase 5.S.8)" | Out-Null
} catch {
    Write-Error "Register-ScheduledTask failed for '$taskName': $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Registered '$taskName', every $IntervalMinutes minutes."
Write-Host "  log:  $logPath"
Write-Host "  bat:  $batPath"
Write-Host ""
Write-Host "Verify without waiting for the trigger:"
Write-Host "  Start-ScheduledTask -TaskName $taskName"
Write-Host "  Get-Content '$logPath' -Tail 20"
Write-Host ""
Write-Host "Check lag at any time (cheap, exports nothing):"
Write-Host "  cd '$pyOddsDir'; .\.venv\Scripts\python.exe refresh_corpus.py --check"
