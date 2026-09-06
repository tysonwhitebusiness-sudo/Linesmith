# CURRENT — pick up here

## Read `docs/master-plan-2026-09-06.md` first

It supersedes the phase numbering in `model-build-plan-2026-09-02.md` and the
track lettering in `audit-remediation-plan.md`. Those keep their measured results
and reasoning; the master plan owns the ORDER. `docs/unbuilt-inventory-2026-09-06.md`
is the evidence behind it.

**Next action: Phase 1 (Consolidation).** Nothing new gets built until it lands.

## State as of 2026-09-06

`tsc` clean, **347 tests, 0 fail**, production build exit 0, working tree clean.

**Two sports have validated prop models. Seven do not.**

| | markets ranking | with a calibrated probability |
|---|---|---|
| MLB | 11 | 9 |
| NHL | 5 | 4 |

Tennis was built and REJECTED (t=+20.68). Soccer failed its gate (t=+3.05). Golf
has a legacy layer the audit lists for deletion. NBA, CFB, NFL not started. **No
game model in this project has ever passed a gate.**

## What is running right now

- **Prod on :3000** (`linesmith-prod`, rebuilt from HEAD 2026-09-06). It replaced
  an older `next start` that was serving a stale build.
- **Dev on :56605** (`linesmith-dev`).
- Both can be stopped; nothing depends on them.

## Two live bugs, neither from Phase 5

1. **Scan's Odds column is blank.** `/api/props/lines?sport=mlb` returns zero
   rows while `prop_odds` holds 615,998 rows written minutes earlier. The route
   walks the MLB snapshot's game contexts and calls `readPropOddsForGame` per id,
   so a game_id mismatch is the likely cause — `prop_odds.game_id` holds 6-digit
   provider ids like `182557`. NOT confirmed; I stopped short of proving it.
2. **The database is 79% full** — 6,459 MB of 8,192, up ~1.2 GB in a week. This
   already killed a fit run with `DiskFullError`. `work_mem` is 3,500 kB, so any
   large join spills to disk; 34 GB of temp files have been written across 1,070
   files. `prop_odds_history` (823 MB) and `odds_import_staging` (270 MB) are the
   first prune candidates. Deleting data is the operator's call.

## Open operator decisions

1. **Whether `Model %` appears beside `IP` on Scan.** It lets anyone subtract the
   two and read an edge, which is a claim no model here has earned. The plan
   defers to the operator rather than deciding.
2. **`app/privacy/page.tsx` must be read before any public exposure.** Accurate
   to the codebase, but retention terms and jurisdiction live outside the repo.

## Standing constraints

- **Do not deploy to Render without asking.**
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **A numeric id matching the expected shape is not evidence it is the right
  id.** Verified twice more this week: 399 MLB ids matched by shape and **0.00%**
  landed on the right game date; the crosswalk join lands 89%.
- **Subtract before adding.** The audit prescribed deletions that never happened,
  so every correct new thing sits beside an old wrong one. That is the mechanism
  behind "every time we build something the app regresses another way."
