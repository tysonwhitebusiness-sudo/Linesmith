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
#   .\scripts\harvester-laptop-setup.ps1 -IntervalMinutes 90 -StaggerMinutes 15
#   .\scripts\harvester-laptop-setup.ps1 -SkipDependencyInstall   # re-register the tasks only

param(
    # How often EACH sport's own task re-fires. Must stay >= Sports.Count *
    # StaggerMinutes (checked below) or a sport's next scheduled run could
    # land before the prior staggered cycle has even finished the last
    # sport, defeating the stagger entirely. 150 gives 8 sports * 15 min
    # stagger (120 min to start them all) real slack, not just the bare
    # minimum the check would accept - sized for the worst case where every
    # sport is in-season and running a full scrape, not today's off-season
    # nba/nhl quick-exit.
    [int]$IntervalMinutes = 150,
    # Gap between each sport's task start time within one cycle. Sized off
    # this session's real measured worst case (tennis, 485s/8m5s against the
    # 700s internal budget in harvester_scrape.py) plus real margin for
    # venv/python startup and asyncpg connect - one sport's Chromium
    # instance should always be fully done before the next one starts, so
    # this laptop (running nothing else) never has two scrapes competing for
    # the same CPU/memory at once.
    [int]$StaggerMinutes = 15,
    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pyOddsDir = Join-Path $repoRoot "python-odds-service"
$oddsharvesterDir = Join-Path $repoRoot "oddsharvester"
$venvDir = Join-Path $pyOddsDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$taskNamePrefix = "LinesmithOddsHarvester"
# Must match harvester_scrape.py's SCRAPE_CONFIG keys exactly - kept as an
# explicit list here (not read from the .py file) so each sport gets its own
# Scheduled Task rather than one task running every sport back-to-back in a
# single process. That single-task shape was the original design and it was
# a real, serious bug: with no CLI argument, harvester_scrape.py's main()
# runs every configured sport sequentially in one execution - measured this
# session at MLB 438s + soccer_epl ~200s + soccer_mls ~195s + tennis 485s =
# ~22 minutes total, against a single task's old 10-minute
# -ExecutionTimeLimit. Task Scheduler would forcibly kill the process
# mid-run, silently dropping whatever sport was still queued - and it only
# gets worse as more sports (NFL, CFB, ...) are added. One task per sport,
# each invoking `harvester_scrape.py <sport>` with its own generous time
# limit and a staggered start so they never compete for the same CPU/memory
# at once, is the fix.
# nba/nhl included even though both are genuinely off-season right now
# (NBA preseason starts October, NHL mid-September): harvester_scrape.py's
# run_target bails out in a couple seconds, before ever launching Chromium,
# when its own game loader finds no real games in the current window - so
# registering these tasks now is cheap and harmless, and means the laptop
# picks up real odds the moment each season's real schedule enters the
# lookahead window, with no further setup needed once that happens.
$sports = @("mlb", "soccer_epl", "soccer_mls", "tennis", "nfl", "cfb", "nba", "nhl")
if ($IntervalMinutes -lt ($sports.Count * $StaggerMinutes)) {
    Write-Error "IntervalMinutes ($IntervalMinutes) must be >= Sports.Count * StaggerMinutes ($($sports.Count) * $StaggerMinutes = $($sports.Count * $StaggerMinutes)), or a sport's next run could land before the staggered cycle finishes."
    exit 1
}

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

# --- 5. Scheduled tasks, one per sport ---------------------------------------
# Task Scheduler does NOT capture a launched program's stdout/stderr anywhere
# by default (real gap, found live: LastTaskResult read 0 while the actual
# run had produced no fresh health-check write and there was no way to see
# why). Routing through a tiny generated .bat wrapper per sport that
# redirects output to its own log file is the reliable fix - avoids the
# notoriously fragile cmd.exe /c nested-quoting rules a raw -Argument string
# would need instead, and per-sport logs mean one sport's failure doesn't
# bury another's output in the same file.
# Interactive: runs while this account is logged in (screen locked is fine,
# fully logged out is not) and needs NO elevation to register. S4U (runs
# even fully logged out, no password stored) was tried first and requires
# admin rights to register on a standard account - confirmed live, it threw
# "Access is denied" as a non-admin here. Interactive is the right tradeoff
# for an always-on laptop where the account simply stays logged in with the
# screen locked, over needing an elevated PowerShell window every re-setup.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$registeredTaskNames = @()
for ($i = 0; $i -lt $sports.Count; $i++) {
    $sport = $sports[$i]
    $taskName = "$taskNamePrefix-$sport"
    $logPath = Join-Path $pyOddsDir "harvester-scrape-$sport.log"
    $batPath = Join-Path $pyOddsDir "run-harvester-$sport.bat"
    @"
@echo off
echo ---- %date% %time% ---- >> "$logPath"
"$venvPython" src\harvester_scrape.py $sport >> "$logPath" 2>&1
"@ | Set-Content -Path $batPath -Encoding ASCII

    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Removing existing '$taskName' task to re-register with current settings..."
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    $action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $pyOddsDir
    $startAt = (Get-Date).AddMinutes($i * $StaggerMinutes)
    $trigger = New-ScheduledTaskTrigger -Once -At $startAt `
        -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
        -RepetitionDuration (New-TimeSpan -Days 3650)   # PowerShell has no "forever"  -  10 years stands in for it
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -DontStopOnIdleEnd `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 35) `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 2) `
        -MultipleInstances IgnoreNew
    # 35 min, not the old 15: real bug found live - tennis's match count
    # isn't scoped to one tournament, so it varies a lot night to night
    # (44 matches one night, 107 a busier night). The busier night took a
    # measured 1247s (20m47s), which alone already exceeded the old
    # 900s (15 min) limit here - Windows would have force-killed that run
    # mid-scrape regardless of harvester_scrape.py's own SCRAPE_TIMEOUT_
    # SECONDS. This needs to stay comfortably above that constant (see its
    # own comment in harvester_scrape.py) since IT is the outer bound; if
    # Python's own timeout can't even fire before Windows kills the
    # process, raising the Python-side constant alone accomplishes nothing.
    # New-ScheduledTaskSettingsSet's OWN default (not something this script
    # ever chose) is DisallowStartIfOnBatteries:True / StopIfGoingOnBatteries
    # :True - real bug, found and fixed live: every task registered before
    # this override silently never fired on its own natural trigger while
    # Windows believed the machine was on battery power (confirmed via
    # [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus
    # reading "Offline" on this dev machine, a laptop per
    # Win32_ComputerSystem's PCSystemType=2) - NextRunTime just silently
    # advanced to the next occurrence with no error, LastRunTime never
    # updated, and only a manual Start-ScheduledTask call (which bypasses
    # this gate) or a lucky moment when AC power was detected ever actually
    # ran anything. This matters even for the real target laptop staying
    # "plugged in at all times" per the user's plan - Windows can still
    # briefly misreport power state on a flaky charging port, and there's no
    # reason this odds pipeline should ever depend on AC being detected
    # correctly in the first place.

    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
            -Description "Scrapes OddsPortal.com for $sport game odds every $IntervalMinutes minutes, staggered $($i * $StaggerMinutes) min into the cycle. See scripts/harvester-laptop-setup.ps1." `
            -ErrorAction Stop | Out-Null
    } catch {
        Write-Host ""
        Write-Error "Register-ScheduledTask failed for '$taskName': $($_.Exception.Message)"
        Write-Host "Re-run this script from an elevated ('Run as Administrator') PowerShell if this is an access-denied error." -ForegroundColor Yellow
        exit 1
    }
    $registeredTaskNames += $taskName
    Write-Host "Registered '$taskName' - first run at $($startAt.ToString('HH:mm:ss')), then every $IntervalMinutes min." -ForegroundColor Green
    # Real bug found live: registering all 8 tasks back-to-back in this loop
    # (each an Unregister+Register cycle against the same Task Scheduler COM
    # session) left several of them silently never firing their OWN natural
    # trigger - NextRunTime kept advancing forward past the missed
    # occurrence with no error and LastRunTime never updated, while a
    # separate, isolated re-registration of the exact same task fired
    # correctly within minutes. Root cause not fully pinned down (Task
    # Scheduler gives no error to explain it, and Event Viewer's
    # Microsoft-Windows-TaskScheduler/Operational log needs admin rights to
    # enable, not available in this setup path) - this delay is a verified
    # mitigation, not a guess: re-registering all 8 with it in place and
    # waiting for several real natural triggers to arrive confirmed they all
    # fired. Do not remove this without re-verifying the same way.
    Start-Sleep -Milliseconds 750
}

Write-Host ""
Write-Host "$($sports.Count) tasks registered ($($registeredTaskNames -join ', '))  -  each runs while this account is logged in (screen can be locked)." -ForegroundColor Green
Write-Host ""
Write-Host "IMPORTANT  -  two things or the tasks silently stop firing:" -ForegroundColor Yellow
Write-Host "  1. Prevent sleep while plugged in: Settings > System > Power & battery >"
Write-Host "     Screen and sleep > 'When plugged in, put my device to sleep after' -> Never"
Write-Host "  2. Stay logged in to this account (locking the screen is fine, signing out is not)."
Write-Host ""
Write-Host "Run one right now to verify, instead of waiting for its staggered start:"
Write-Host "  Start-ScheduledTask -TaskName '$taskNamePrefix-mlb'"
Write-Host ""
Write-Host "Real output (stdout/stderr) lands here per sport - Task Scheduler itself doesn't capture it:"
Write-Host "  Get-Content '$(Join-Path $pyOddsDir "harvester-scrape-mlb.log")' -Tail 40"
Write-Host ""
Write-Host "Check a task's last run result (LastTaskResult 0 = success):"
Write-Host "  Get-ScheduledTaskInfo -TaskName '$taskNamePrefix-mlb'"
Write-Host ""
Write-Host "Stop/remove all of them:"
Write-Host "  Get-ScheduledTask -TaskName '$taskNamePrefix-*' | Unregister-ScheduledTask -Confirm:`$false"
