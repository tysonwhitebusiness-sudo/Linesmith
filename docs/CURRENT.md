# CURRENT — pick up here

**Phase 6 is IN PROGRESS. Track A is COMPLETE** (6.1, 6.1b, 6.2, 6.2b, 6.3,
6.4). 6.5, 6.11 and 6.12 are resolved. 6.6 is built and its backfill is
**paused partway — one command resumes it, see the section below**. Track B's
remaining sourcing (6.7-6.10), all of Track C (the three pages) and all of
Track D are still to do. Phases 4 and 5: complete, gates passed.

**Read `docs/audit-remediation-plan.md` Phase 6 for the plan; §11 is the phase
log and the only place a task counts as done. Trust §11 and `git log` over this
file if they disagree.**

## 1. What just happened (2026-08-30, first build session of Phase 6)

Fourteen commits, `9bf9580`..`522eaea`. **TS tests 48 → 106, plus 8 new
Python tests. All passing, `tsc` clean, `npm run build` passes.**

**§11 of the plan now has the Phase 6 log entry** — that is the authoritative
record of what counts as done.

| Task | State | Commit |
|---|---|---|
| 6.1 `unitGrades` | **done** | `9bf9580` |
| 6.2 collapse `statComparison` + season rollup | **done** | `3e4eac2` |
| 6.1b/6.2b fill NBA/NHL/tennis blocks | **done** | `7a89e21` |
| 6.2 correct `CLAUDE.md` §4 | **done** | `c6ff8ec` |
| 6.5 diagnosis | **decided: let it accrue** | `0168ad2`, `2e4f2b2` |
| 6.4 `components/charts/` | **done** | `1a1ee36` |
| 6.11 re-scoped, 6.12 verified and dropped | **done** | `2e4f2b2` |
| 6.3 the six roles | **done** (types + MLB's two fillable) | `3e07317` |
| 6.6 Statcast ingester + read path | **built; backfill paused** | `b2ebf8f`, `d8705c6` |
| **Client-bundle fix** — every page was 500ing | **fixed + guarded** | `b5900af`, `2a74fb2` |
| 6.13 render the six roles | **started** | `522eaea` |

### THE DEFECT THIS PHASE PAID FOR

**A value import from a database module into anything a client component
reaches bundles `pg` for the browser and breaks EVERY page — and `tsc` plus
all 103 unit tests pass it.** Introduced twice (6.1 and 6.2b), survived six
commits, because another session's `next dev` held `.next/` so no build could
run. Split the pure parts out (`seasonAggregateShapes.ts`, `nflUnitGrades.ts`)
and guarded by `tests/client-bundle-boundary.test.ts`, which checks the import
FORM — `import type` is erased, a value import is not.

**`npm run build` is now required before claiming any UI work is done.** tsc
plus unit tests demonstrably is not enough.

**FOUR OF THE PLAN'S OWN TASK PREMISES WERE WRONG**, and each cost real work
to discover: 6.2's ("all seven sports populate `rankings`" — only MLB and NFL
do), 6.3's ("rename four fields" — they do not exist; it is six new ones),
6.5's (below), and 6.16's (`/api/props/line-history` "has no frontend
consumer" — **that route does not exist at all**). Re-measure a task's stated
premise before building on it.

### 6.5 — DECIDED. Let it accrue.

Operator, 2026-08-30: **option 1**. No backfill is built and none should be.
CFB and NFL resume in September, NBA and NHL in October, and from then the six
sports fill on their own with real, priced, leakage-free rows. **Re-check
`pick_history` per sport in mid-September** before assuming anything about the
boards' Edge and Model % blocks. The reasoning, preserved:

**6.5's premise was wrong and the task cannot proceed as written.** Full
reasoning is in the plan under 6.5; the short version:

- **The pipeline is not broken.** Running it produced 131 soccer candidates;
  grading took soccer from 0 to 215 of 381 graded within hours.
- **NFL, CFB, NBA and NHL have ZERO scheduled games today or tomorrow.** They
  are between seasons. An empty `pick_history` is correct behaviour.
- **A backfill cannot produce an edge.** `prop_odds_history` starts 2026-08-11
  and holds soccer, tennis and MLB subjects only — there is no historical
  prop-odds record for those four sports at any date. Reconstructed rows would
  have `model_prob` but no `market_prob`, `edge` or `price`, which are exactly
  the fields the boards read.
- **It also collides with the leakage guard** (P3 H4, task 2.2), which exists
  because `player_game_history` contains the outcome once a game has started.

**Still true for any future writer: the current model writes
`model_source = NULL` and ten scoring readers filter on exactly
`model_source IS NULL`.** Anything backfilling into `pick_history` needs its
own sentinel decided before a single row is written.

## 2. THE ONE THING TO RESUME — 6.6's Statcast backfill

`mlb_pitch_events` is live and the ingester works, but the historical sweep is
**paused at 156,796 rows, 2024 through 2024-04-18**. Target is 2024-2026,
roughly 2.1M rows. Resume with one command — it is **resumable by
construction**, since the write is idempotent on
`(game_pk, at_bat_number, pitch_number)`:

```
cd python-odds-service
./.venv/Scripts/python.exe -u src/statcast_pitches.py backfill
```

Expect 2-3 hours. It re-fetches windows already stored (the writes are
no-ops), so nothing is lost by restarting. Progress:
`SELECT season, count(*), max(game_date) FROM mlb_pitch_events GROUP BY 1;`

**WATCH FOR A DUPLICATE PROCESS.** Starting it produced **two** running
processes — one from `.venv`, one from system Python 3.12 — the same
duplication already seen with `harvester_scrape.py mlb`. Correctness is safe
but it doubles the request rate against a free public endpoint we do not own.
Check with `Get-CimInstance Win32_Process` and read `CommandLine`. Killing one
killed both, so verify after.

The hourly `ingestStatcastPitchesJob` keeps the last 3 days current
regardless, so the current season stays fresh even if the sweep is never
finished.

**THE WORKER HAS NOT BEEN REDEPLOYED.** This session pushed changes to
`python-odds-service/` and Render is `autoDeploy: no`, so
`ingestStatcastPitchesJob` is not running yet. See §6 for the deploy call.

## 3. What is running

**A dev server is up on port 3000, started by this session** (the operator
authorised killing the other session's, which had held `.next/` and blocked
every build). Pages verified live: `/`, `/mlb`, `/nhl`, `/nba` all 200,
`/api/season-ranks?sport=nhl` returns 32 real teams,
`/api/mlb/pitch-profile` 200, and `/mlb/player/701538` renders the new role
cards with real data.

**Seven** `harvester_scrape.py` scheduled tasks on a ~20-minute cycle. **Two
`harvester_scrape.py mlb` processes were running simultaneously** — one from
`.venv`, one from system Python 3.12. Racing. Not touched; flagged for the
operator.

## 4. Next actions

1. **Resume 6.6's backfill and deploy the worker** (§2). Neither is done.
2. **Wire MLB's `usageMix` and `spatialGrid`.** 6.3 left both `null` for want
   of a source; 6.6 now provides one. `lib/sports/mlb/pitchProfile.ts` and
   `/api/mlb/pitch-profile` are built and verified against real rows — what is
   missing is a hook plus the two role objects in
   `mlb/adapters/playerDetailAdapter.ts`. **Show `xwobaSample`, never
   `ballsInPlay`, beside an xwOBA**: only 22% of balls in play carry one.
3. **Track C — the three pages** (6.13/6.14/6.15). The bulk of what remains,
   and now unblocked: the primitives and the roles both exist.
4. **6.7 NBA/NHL shots, 6.8 nflverse PBP, 6.9 Understat shots, 6.10 generalise
   weather/park/sims.** All four upstream endpoints were confirmed reachable
   this session. 6.7 and 6.9 fill `spatialGrid` for four more sports.
5. **6.16 needs a route built first** — `/api/props/line-history` does not
   exist. The data does: `prop_odds_history`, 613,814 rows. `SeriesChart` and
   `Sparkline` are ready to consume it.
6. **Track D's remainder** (6.17, 6.19, 6.21, 6.23, 6.24). 6.18 is skipped per
   the operator; 6.20 and 6.22 wait on a real record.

## 5. Things that will bite again

**Measure the READ, never just the WRITE.** Every defect the Phase 4 gate found
had passed a VERIFY that checked the write and never the read. This session's
new tests all assert the *wiring* or the *rendered output*, and every one was
fault-injected — each fails by name when its target is reverted.

**A guardrail that has never rejected anything is not known to work.**

**A dead consumer cannot report that its input vanished.** After any change
that renames or re-derives a value, grep the tree for consumers, including code
nothing currently calls.

**Quote the number the decision actually rests on** — propagate it through to
what a user sees before putting it in front of someone.

- **"healthy — 0 rows written" is ambiguous** and `health_check.py` cannot tell
  a stuck job from an empty slate. `scripts/diagnose/sport-slate-today.py`
  answers it in one run.
- **Out of season is the default state of most sports.** On 2026-08-30 only
  MLB, CFB (week 1), soccer and tennis had fixtures. Four of eight sports being
  empty is usually a calendar fact, not a bug — check before diagnosing.
- **Different tables, different vocabulary.** `player_game_history` uses
  `soccer_epl`/`soccer_mls` and `tennis_atp`/`tennis_wta`; `pick_history` and
  `game_odds_book_lines` use `soccer`/`tennis`. Mixing them silently returns
  zero rows.
- **`player_game_history` numbers are float TEXT.** `stats->>'match_won'` is
  `"0.0"`, so `::int` throws. Cast `::numeric`.
- **Tennis ids can be compound.** A doubles pairing is one `athlete_id` like
  `2725-2434` — 19% of ATP rows. They must not enter a singles ranking pool.
- **`is_major` is 0.0 on every tennis row**, both tours, every season. Tennis
  has **seven** usable keys, not eight.
- **Tennis `subjectId` is `espn:tennis:{id}`**; the table stores the bare id.
- **`player_game_history` has no index for a team-season rollup** — it is
  `(sport, athlete_id, season, game_date)`. A rollup is a scan: NHL 11.7s, NBA
  3.0s, tennis 37s. Fine behind `cachedRoute`, never on a render path.
- **`estimated_woba` is not null on pitches that were not put in play.** 332 of
  3,619 non-in-play pitches carried a value, 218 of them 0.0. Filter on
  `description = 'hit_into_play'`, NOT on `estimated_woba IS NOT NULL` — the
  naive average reads zone 1 as .281 against a true .367.
- **Only 22% of balls in play carry an `estimated_woba`** (5,031 of 22,574).
  The number to show beside an xwOBA is `xwobaSample`, not `ballsInPlay`.
- **Savant's zone codes 11-14 are the OUTSIDE quadrants**, not part of the 3x3.
- **Two `next dev` servers cannot share `.next/`.**
- **Long-running Python here can start TWICE** — once from `.venv`, once from
  system Python 3.12. Seen with both `harvester_scrape.py` and the Statcast
  backfill. Check `Get-CimInstance Win32_Process` before and after starting one.
- **A long heredoc breaks this shell** (>~120 lines, or an apostrophe in a
  `<<'EOF'` block used with `&&` chaining). Write long commit messages to a
  file and use `git commit -F`.
- **`ps aux | grep` in Git Bash does not show command lines.** Use
  `Get-CimInstance Win32_Process` and read `CommandLine`.
- **`withJobLock` is a LEASE TABLE, not an advisory lock.**
- **Postgres UNIQUE treats NULLs as distinct.**
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 6. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `gate*.mjs`, `runmig.mjs` are gitignored. `.env.local` has no `DIRECT_URL`,
  so DDL also goes through `:6543`.
- **The database is on the Supabase PRO plan**, not Free — `CURRENT.md` and the
  stored memory both said Free and were wrong. **Size is 2,234 MB**
  (`player_game_history` 1,589 MB, `snapshot_cache` 183 MB, `prop_odds_history`
  157 MB, `pick_history` 107 MB). 6.6's Statcast backfill adds to this; budget
  it against Pro's 8 GB included.
- **RLS is off on 7 of 41 tables**, not 31/35 — the four `*_backup_*`/quarantine
  tables plus `job_locks` and `mlb_prop_model_cache`.
- **Tests:** `npm test` (**96**) and `./.venv/Scripts/python.exe -u src/test_x.py`
  from `python-odds-service/`. **20** hermetic Python tests. No pytest.
  The test glob now matches `*.test.tsx` as well as `*.test.ts` — it did not
  before, and a `.tsx` suite would have been silently skipped in CI.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. After any
  push touching `python-odds-service/`: `POST /v1/services/$SRV/deploys` with
  `RENDER_API_KEY` from `.env.local`, then confirm `"status":"live"` on your
  commit sha. ~90s.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's and must never be staged.

## 7. Operator decisions taken — do not reopen

**2026-08-29:** Officials/umpires **CUT**. Tennis point-level data **CUT**.
NBA/NHL shot coordinates **APPROVED** (6.7).

**2026-08-30:**

0. **6.5 — let it accrue.** No pick_history backfill; the seasons starting is
   what that task needed.
1. Tennis "Games won by set" — **replaced** (it is not derivable; `games_won`
   is a match total with no per-set breakdown). Now sets-won rate by tier plus
   match shape.
2. 6.12's tennis match stats — **verify against the ESPN summary**, drop what
   is not really there.
3. Statcast depth — **2024 onwards**, three seasons.
4. New sourcing tables — **Python writes them**; the TS fetchers are untouched.
5. 6.5 — **diagnose before backfilling**. Done; see §1.
6. Primitive port list — **all 14**, no consolidation.
7. `sport === 'x'` gate — **narrow the wording AND fix the real render-path
   branches** (`PlayerDetail.tsx` 965, 1001, 1164, 1923, 1985).
8. 6.2 — **Option B**: collapse and fill the blanks. Done.
9. 6.3 — **accept six new fields**, it is not a rename.
10. 6.11 — operator said spend; **superseded by measurement**, no purchase
    needed (see §3.4).
11. 6.18 compliance — **skipped for Phase 6**, remains a launch blocker.
12. 6.20 — **hold** until there is a real record.
13. Golf — **no game page**; `app/golf/schedule` is its equivalent, so 6.15
    ships **seven** sports.

## 8. Phase 6 design reference

The four committed, self-contained boards are the specification. Open them
directly; rebuild with `node docs/design/build-{per-sport,team-detail,game-detail}.mjs`.

- `docs/design/chart-grammar.html` — the primitives (holds the two **unfixed**
  originals; the fixes are in `build-lib.mjs` and now in `components/charts/`).
- `player-detail-per-sport.html`, `team-detail-per-sport.html`,
  `game-detail-per-sport.html`.
- `docs/design/phase6-data-gap-audit.md` — the sourcing evidence.

**The six universal ROLES** (6.3, still to build — six NEW fields, not renames):
`opponentUnit`, `usageMix`, `spatialGrid`, `binarySplit`, `conditions`,
`careerH2H`. Each carries its own title, labels and cells from the sport's
adapter; the component renders a title and a grid and never learns what a
strike zone is.

**Page counts differ by sport and that is the answer, not a gap:** Player 8,
Team 6 (tennis and golf have no team), Game 7 (golf's equivalent is the
schedule).

## 9. Known not done

1. **Duplicate React keys can silently omit prop rows** —
   `GolfScheduleView.tsx:1244` and `TennisScheduleView.tsx:529` omit the game
   id from the key, and a player can have candidates for two games. One-line
   fix, still unowned.
2. **6.3's six role fields** — the largest remaining Track A item.
3. **NHL grades three units, not four.** Power play and penalty kill need
   situational time-on-ice, which the stored keys do not carry.
4. **MLB grades two units** (Hitting, Pitching) — no league-wide ranked
   fielding or bullpen aggregate exists to grade from.
5. **MLB total residual, ~1 point** — Q40, accepted deliberately.
6. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
7. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account is out of bounds.
8. **`snapshot_cache` is 183 MB across 3,167 rows.**
9. **2,380 duplicate observation groups in `game_odds_history`.**
10. **No push alerting; rate limiting is per-process** — Phase 8.
11. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 10. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 (Q25) |
