# Run OddsHarvester sidecar — Windows (PowerShell)
#
# Usage:
#   .\scripts\run-oddsharvester.ps1 -Sport baseball -Mode live
#   .\scripts\run-oddsharvester.ps1 -Sport baseball -Mode upcoming -Date 20260810

param(
    [string]$Sport = "baseball",
    [string]$Mode = "live",
    [string]$Date = ""
)

$leagues = @{
    baseball          = "usa-mlb"
    basketball        = "usa-nba"
    "ice-hockey"      = "usa-nhl"
    "american-football" = "usa-nfl"
    football          = "england-premier-league"
    tennis            = ""
}

$league = $leagues[$Sport] ?? ""
if (-not $league -and $Sport -notin @("tennis")) {
    Write-Warning "No league mapping for sport '$Sport' — add one to this script."
}

$leagueArg = if ($league) { "-l $league" } else { "" }
$dateArg = if ($Date) { "-d $Date" } else { "" }
$outputFile = if ($Date) { "${Sport}_${Mode}_${Date}.json" } else { "${Sport}_${Mode}.json" }

$cmd = "docker run --rm -v `"$PWD/data:/out`" oddsharvester $Mode -s $Sport $leagueArg $dateArg -m moneyline,over_under --headless --preview-only -o /out/$outputFile"

Write-Host "Running: $cmd" -ForegroundColor Cyan
Invoke-Expression $cmd
