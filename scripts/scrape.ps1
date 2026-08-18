# Run OddsHarvester directly (no Docker needed)
# Usage: .\scripts\scrape.ps1 -Mode live
#        .\scripts\scrape.ps1 -Mode upcoming -Date 20260811

param(
    [string]$Mode = "live",
    [string]$Date = ""
)

$dateArg = if ($Date) { "-d $Date" } else { "" }
$outputFile = if ($Date) { "baseball_${Mode}_${Date}.json" } else { "baseball_${Mode}.json" }

$dataDir = (Get-Item "$PSScriptRoot\..\data").FullName
$outputPath = "$dataDir\$outputFile"

Push-Location "$PSScriptRoot\..\oddsharvester"
try {
    $cmd = "uv run python -m oddsharvester $Mode -s baseball -m home_away,over_under_9_0 --headless --preview-only -o `"$outputPath`" $dateArg"
    Write-Host "Running: $cmd" -ForegroundColor Cyan
    Invoke-Expression $cmd
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Done! Output: data/$outputFile" -ForegroundColor Green
    }
} finally {
    Pop-Location
}
