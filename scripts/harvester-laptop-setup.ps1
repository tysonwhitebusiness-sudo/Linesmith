# One-time setup for running the OddsHarvester scraper on a dedicated,
# always-on machine  -  the replacement for the GitHub Actions workflow after
# real evidence (workflow 89041102402) showed OddsPortal hard-blocking
# GitHub's shared runner IPs with HTTP 429. A residential IP (this laptop's)
# doesn't share that problem.
#
# Run this from PowerShell, from inside a full clone of this repo, on the
# machine that will run the scrape (NOT this dev machine unless that's
# genuinely the laptop in question). No admin rights needed for the normal
# path  -  see the troubleshooting notes at the bottom if registration fails.
#
# Usage:
#   .\scripts\harvester-laptop-setup.ps1
#   .\scripts\harvester-laptop-setup.ps1 -IntervalMinutes 30
#   .\scripts\harvester-laptop-setup.ps1 -SkipDependencyInstall   # re-register the task only

param(
    [int]$IntervalMinutes = 20,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pyOddsDir = Join-Path $repoRoot "python-odds-service"
$oddsharvesterDir = Join-Path $repoRoot "oddsharvester"
$venvDir = Join-Path $pyOddsDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$taskName = "LinesmithOddsHarvester"

Write-Host "== OddsHarvester laptop setup ==" -ForegroundColor Cyan
Write-Host "Repo root: $repoRoot"

# --- 1. Python check -------------------------------------------------------
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Error "Python not found on PATH. Install Python 3.12+ from https://www.python.org/downloads/ (check 'Add python.exe to PATH' during install), then re-run this script."
    exit 1
}
$versionOutput = & python --version 2>&1
if ($versionOutput -notmatch "Python 3\.(1[2-9]|[2-9]\d)") {
    Write-Warning "Detected '$versionOutput'  -  this needs Python 3.12+. Continuing anyway, but expect failures if it's older."
}

# --- 2. Virtual environment --------------------------------------------------
if (-not (Test-Path $venvPython)) {
    Write-Host "Creating virtual environment at $venvDir..."
    & python -m venv $venvDir
    if ($LASTEXITCODE -ne 0) { Write-Error "venv creation failed."; exit 1 }
}

# --- 3. Dependencies ---------------------------------------------------------
if (-not $SkipDependencyInstall) {
    Write-Host "Installing python-odds-service dependencies..."
    & $venvPython -m pip install --upgrade pip --quiet
    & $venvPython -m pip install -r (Join-Path $pyOddsDir "requirements.txt")
    if ($LASTEXITCODE -ne 0) { Write-Error "requirements.txt install failed."; exit 1 }

    Write-Host "Installing oddsharvester package..."
    & $venvPython -m pip install $oddsharvesterDir
    if ($LASTEXITCODE -ne 0) { Write-Error "oddsharvester install failed."; exit 1 }

    Write-Host "Installing Playwright's Chromium (no --with-deps on Windows  -  that flag is Linux-apt-specific, not needed here)..."
    & $venvPython -m playwright install chromium
    if ($LASTEXITCODE -ne 0) { Write-Error "Playwright browser install failed."; exit 1 }
}

# --- 4. Database credential check -------------------------------------------
# config.py already reads .env.local at the repo root as a local-dev
# fallback (same file the Next.js app uses)  -  nothing new to build here,
# just make sure it's actually present with the right key before the
# scheduled task silently fails to connect.
$envLocalPath = Join-Path $repoRoot ".env.local"
if (-not (Test-Path $envLocalPath)) {
    Write-Warning "No .env.local at $envLocalPath."
    Write-Warning "Create it with one line:  DATABASE_URL=<same value your dev machine's .env.local uses>"
    Write-Warning "The scheduled task will fail to reach the database until this exists  -  copy the value yourself, don't paste it anywhere else."
} elseif (-not (Select-String -Path $envLocalPath -Pattern "^DATABASE_URL=" -Quiet)) {
    Write-Warning "$envLocalPath exists but has no DATABASE_URL line  -  add one before the scheduled task can write to the database."
} else {
    Write-Host "DATABASE_URL found in .env.local." -ForegroundColor Green
}

# --- 5. Scheduled task -------------------------------------------------------
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing '$taskName' task to re-register with current settings..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $venvPython -Argument "src\harvester_scrape.py" -WorkingDirectory $pyOddsDir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)   # PowerShell has no "forever"  -  10 years stands in for it
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 2) `
    -MultipleInstances IgnoreNew
# S4U: runs whether the user is logged in or not, WITHOUT storing a Windows
# password anywhere (this script never handles or sees one)  -  needs "Log on
# as a batch job" rights, already granted by default to standard accounts on
# most Windows editions. If registration fails, see troubleshooting below.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description "Scrapes OddsPortal.com for game odds every $IntervalMinutes minutes. See scripts/harvester-laptop-setup.ps1." | Out-Null

Write-Host ""
Write-Host "Task '$taskName' registered  -  runs every $IntervalMinutes minutes, starting now, whether logged in or not." -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT  -  prevent sleep while plugged in, or the task silently stops firing:" -ForegroundColor Yellow
Write-Host "  Settings > System > Power & battery > Screen and sleep > 'When plugged in, put my device to sleep after' -> Never"
Write-Host ""
Write-Host "Run it once right now to verify, instead of waiting $IntervalMinutes minutes:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "Check its last run result (LastTaskResult 0 = success):"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$taskName'"
Write-Host ""
Write-Host "Stop/remove it entirely:"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Host ""
Write-Host "Troubleshooting: if Register-ScheduledTask above failed with an access-denied" -ForegroundColor DarkGray
Write-Host "error, re-run this script from an elevated ('Run as Administrator') PowerShell." -ForegroundColor DarkGray
