#!/usr/bin/env bash
# Weekly logical backup — Phase 0.1 of docs/audit-remediation-plan.md.
#
# Why this exists even though Supabase Pro now takes daily backups: those
# protect against Supabase's failures, not against yours. A DELETE you run by
# hand is still your problem seven days later. 8.1 says to keep this.
#
# Scope is the nine tables no public source can regenerate — your own graded
# predictions, the line-movement dataset, fitted weights, and user data.
# Deliberately NOT the whole database: snapshot_cache and prop_odds are
# rebuildable from providers and would multiply the dump size for nothing.
#
# STOPGAP. This runs on one laptop, via Task Scheduler, and therefore inherits
# every problem 8.7 already names for OddsHarvester: no run when the lid is
# shut, no monitoring, no alert when it stops. Phase 8 moves it somewhere
# always-on. Until then a backup that usually happens beats one dump from
# August.
#
# Verify a dump before trusting it. The restore drill is in the Phase 0 log:
# restore into a scratch cluster and compare count(*) per table against source.
set -u

REPO="C:/Users/occy3/Documents/line-buddy"
PGBIN="/c/Program Files/PostgreSQL/17/bin"
OUT_DIR="C:/Users/occy3/Documents/line-buddy-backups"
KEEP=8  # ~2 months of weeklies

cd "$REPO" || { echo "[backup] cannot cd to $REPO"; exit 1; }
mkdir -p "$OUT_DIR"

URL=$(grep -m1 '^DATABASE_URL=' .env.local | sed 's/^DATABASE_URL=//' | tr -d '\r' | sed 's/^"//; s/"$//')
[ -n "$URL" ] || { echo "[backup] no DATABASE_URL in .env.local"; exit 1; }
# pg_dump needs session state, so force the session-mode pooler port. .env.local
# points at :6543 (transaction mode) for the app — see Phase 0.5.
URL=$(echo "$URL" | sed 's/:6543\//:5432\//')

STAMP=$(date +%Y%m%d-%H%M)
FILE="$OUT_DIR/linesmith-$STAMP.dump"
LOG="$OUT_DIR/weekly-backup.log"

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') starting backup -> $FILE"
  "$PGBIN/pg_dump.exe" "$URL" \
    -t public.pick_history \
    -t public.prop_odds_history \
    -t public.game_odds_history \
    -t public.model_weights \
    -t public.game_picks \
    -t public.historical_odds \
    -t public.player_game_history \
    -t public.bets \
    -t public.picks \
    --no-owner --no-acl -Fc -f "$FILE"
  RC=$?

  if [ $RC -ne 0 ]; then
    echo "!!! pg_dump FAILED with exit $RC — no new backup this week"
    exit $RC
  fi

  SIZE=$(stat -c%s "$FILE" 2>/dev/null || echo 0)
  echo "    ok: $SIZE bytes"
  # A dump that is suspiciously small is worse than an obvious failure, because
  # it looks like success. The real one is ~44MB; anything under 1MB means
  # pg_dump wrote a header and little else.
  if [ "$SIZE" -lt 1000000 ]; then
    echo "!!! dump is only $SIZE bytes — treat as FAILED, do not trust it"
    exit 1
  fi

  # Prune old dumps, newest kept.
  ls -1t "$OUT_DIR"/linesmith-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "    pruning $old"
    rm -f "$old"
  done
  echo "=== done, $(ls -1 "$OUT_DIR"/linesmith-*.dump 2>/dev/null | wc -l) dump(s) retained"
} 2>&1 | tee -a "$LOG"
