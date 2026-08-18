#!/usr/bin/env bash
# Run OddsHarvester sidecar — Linux / macOS / Docker host
#
# Usage:
#   ./scripts/run-oddsharvester.sh baseball live
#   ./scripts/run-oddsharvester.sh baseball upcoming 20260810

set -euo pipefail

SPORT="${1:-baseball}"
MODE="${2:-live}"
DATE="${3:-}"

declare -A LEAGUES=(
    [baseball]="usa-mlb"
    [basketball]="usa-nba"
    [ice-hockey]="usa-nhl"
    [american-football]="usa-nfl"
    [football]="england-premier-league"
)

LEAGUE="${LEAGUES[$SPORT]:-}"
LEAGUE_ARG=""
if [ -n "$LEAGUE" ]; then
    LEAGUE_ARG="-l $LEAGUE"
fi

DATE_ARG=""
OUTPUT_FILE="${SPORT}_${MODE}.json"
if [ -n "$DATE" ]; then
    DATE_ARG="-d $DATE"
    OUTPUT_FILE="${SPORT}_${MODE}_${DATE}.json"
fi

echo "=== OddsHarvester: $SPORT / $MODE ==="

docker run --rm -v "$(pwd)/data:/out" oddsharvester \
    "$MODE" -s "$SPORT" $LEAGUE_ARG $DATE_ARG \
    -m moneyline,over_under \
    --headless --preview-only \
    -o "/out/$OUTPUT_FILE"

echo "Done → data/$OUTPUT_FILE"
