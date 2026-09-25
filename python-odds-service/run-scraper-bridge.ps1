# Starts the scraper bridge (P6 of the odds build) and watches it. Run by the
# "LinesmithScraperBridge" scheduled task at logon and every 5 minutes; the
# same shape as the odds-scraper's run-scraper.ps1 (its P0 watchdog):
#   - no bridge process running                      -> start it, exit
#   - running, bridge_status.json last_cycle_at
#     <= 300 s old                                   -> healthy, exit
#   - running, no status yet and the process started
#     < 600 s ago                                    -> starting, exit
#   - anything else                                  -> stalled: log, stop, start
# The bridge is started DETACHED and this script exits, so the task never sits
# "Running" and every 5-minute trigger gets its check (the scraper's P0 lesson).
#
#   -Restart   stop and start it now (e.g. to load new code); logged as such.
#   -Stop      stop it and do not start it (the heartbeat drill).
#
# Dot-sourcing this file only defines the functions.
param([switch]$Restart, [switch]$Stop)

$StaleSeconds = 300
$StartupGraceSeconds = 600
$ScraperData = 'C:\Users\occy3\Documents\odds-scraper\data'
$StatusPath = Join-Path $ScraperData 'bridge_status.json'
$LogPath = Join-Path $ScraperData 'bridge_watchdog.log'

function Get-BridgeDecision {
    param($Status, $ProcessStarted, [datetime]$Now = (Get-Date).ToUniversalTime(),
          [int]$Stale = $StaleSeconds, [int]$Grace = $StartupGraceSeconds)
    if ($Status -and $Status.last_cycle_at) {
        try { $at = [DateTimeOffset]::Parse([string]$Status.last_cycle_at).UtcDateTime } catch { return 'stalled' }
        if ($ProcessStarted -and $at -lt ([datetime]$ProcessStarted).ToUniversalTime()) {
            # the file is from an earlier process: judge by this one's age
        } elseif (($Now - $at).TotalSeconds -le $Stale) { return 'healthy' }
    }
    if ($ProcessStarted) {
        $age = ($Now - ([datetime]$ProcessStarted).ToUniversalTime()).TotalSeconds
        if ($age -lt $Grace) { return 'starting' }
    }
    return 'stalled'
}

function Get-BridgeProcesses {
    @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
      Where-Object { $_.CommandLine -like '*scraper_bridge_run.py*' -and $_.CommandLine -notlike '*--provider-prefix*' })
}

function Start-Bridge {
    Start-Process -FilePath cmd.exe -WorkingDirectory $root -WindowStyle Hidden `
        -ArgumentList '/c', ".venv\Scripts\python.exe -u scraper_bridge_run.py >> `"$ScraperData\bridge.out.log`" 2>> `"$ScraperData\bridge.err.log`""
}

function Stop-Bridge($procs, $now) {
    foreach ($p in $procs) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop }
        catch { Add-Content $LogPath "$($now.ToString('o')) could not stop $($p.ProcessId): $_" }
    }
}

function Invoke-BridgeWatchdog {
    $now = (Get-Date).ToUniversalTime()
    $procs = Get-BridgeProcesses
    if ($Stop) {
        Add-Content $LogPath "$($now.ToString('o')) stop requested ($($procs.Count) process(es))"
        Stop-Bridge $procs $now
        return 0
    }
    if ($procs.Count -eq 0) {
        Add-Content $LogPath "$($now.ToString('o')) not running -> start"
        Start-Bridge
        return 0
    }
    $status = $null
    try { $status = Get-Content $StatusPath -Raw -ErrorAction Stop | ConvertFrom-Json } catch { }
    $started = ($procs | Sort-Object CreationDate | Select-Object -First 1).CreationDate
    $decision = if ($Restart) { 'restart' } else { Get-BridgeDecision -Status $status -ProcessStarted $started }
    if ($decision -in 'healthy', 'starting') { return 0 }
    Add-Content $LogPath ("{0} {1} last_cycle_at={2} lag_s={3} last_error={4}" -f $now.ToString('o'), $decision,
        $(if ($status) { $status.last_cycle_at } else { 'none' }), $(if ($status) { $status.lag_s } else { '' }),
        $(if ($status) { $status.last_error } else { '' }))
    Stop-Bridge $procs $now
    Start-Sleep -Seconds 3
    Start-Bridge
    Add-Content $LogPath "$((Get-Date).ToUniversalTime().ToString('o')) started"
    return 0
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($MyInvocation.InvocationName -ne '.') {
    Set-Location $root
    exit (Invoke-BridgeWatchdog)
}
