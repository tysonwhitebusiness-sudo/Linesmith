# CURRENT — pick up here

**Phase 6 is IN PROGRESS. Track A is COMPLETE** (6.1, 6.1b, 6.2, 6.2b, 6.3,
6.4). 6.5, 6.11 and 6.12 are resolved. **6.6 is DONE and wired** — its backfill
is running, not paused. Track B's remaining sourcing (6.7-6.10), most of Track
C (6.13 is part-done, 6.14/6.15 untouched) and all of Track D remain. Phases 4
and 5: complete, gates passed.

**Read `docs/audit-remediation-plan.md` Phase 6 for the plan; §11 is the phase
log and the only place a task counts as done. Trust §11 and `git log` over this
file if they disagree.**

## 1. What just happened (2026-08-30, second build session of Phase 6)

Two commits, `9b0e1a1`..`c77ffb9`. **TS tests 106 -> 126. All passing, `tsc`
clean, `npm run build` passes.** Every claim below was checked in a browser
against live rows, not just compiled.

| Task | State | Commit |
|---|---|---|
| 6.6 backfill resumed | **running**, 1.24M rows | — |
| 6.6 read path wired — MLB `usageMix` + `spatialGrid` | **done** | `9b0e1a1` |
| 6.13 `binarySplit` for CFB/NBA/NHL/soccer | **done** | `c77ffb9` |
| `StatTable.lowerIsBetter` removed | **done** | `c77ffb9` |

### THE "DUPLICATE PYTHON PROCESS" WORRY IS RETIRED

`.venv/Scripts/python.exe` is a **274 KB redirector stub** that execs the base
interpreter as a CHILD process. Measured: PID 5080 held 4.6 MB, 1 thread, 0s
CPU; its child 12028 held 91.8 MB, 10 threads, 3.1s CPU, same creation second.
**One logical process. No doubled request rate** — and that is why killing one
killed both. Same for the `harvester_scrape.py` pair. Do not spend time on it.

### THREE MORE WRONG-NUMBER-RENDERS-CLEANLY DEFECTS

Two of these could not have been caught by a test written beforehand. It took
opening the page.

1. **The strike zone counted zones it did not draw.** Jackson Merrill's real
   2026 profile has all its expected-wOBA rows in Savant's OUTSIDE quadrants
   (11-14). The 3x3 correctly excluded them, so the card drew nine cells reading
   "no data" under a caption saying "n=3". A test summing the same set the
   builder summed would have agreed with the bug.
2. **Two cards on one page, one statistic, two conventions** — the grid printed
   `.717`, the mix printed `0.796`. `UsageMixRole.valueFormat` now exists for
   the same reason `SpatialGridRole.format` is required.
3. **A non-empty side is not a balanced one.** See §2b.

### 2b. THE SOCCER HOME/AWAY DEFECT — FOUND AND **FIXED** (`33e7389`)

`/getPlayerData/{id}` returns a player's WHOLE CAREER across every club.
`understat.ts` resolved venue as `m.h_team === understatTeamTitle`, comparing
every historical fixture against the player's **current** club — so every match
before their latest transfer recorded as away, and `opponent` resolved to the
player's own former club.

Fixed by reading `groups.season` out of the same response (no extra request):
one entry per season carrying that season's club, as a **SET** because a
mid-season transfer lists two (Salah's 2014 is Fiorentina and Chelsea; a single
value left 16 of his 399 matches unresolved).

Measured live, through the app, before and after:

| | before | after |
|---|---|---|
| home share across the EPL slate | 3,228 / 13,013 = **19.9%** | 46,047 / 45,992 = **50.0%** |
| unresolved | — | **0** |
| split cards rendering | 304 of 593 eligible | **671 of 671** |

Callum Wilson's page, which is what exposed it: was "Home 0 (n=5) vs Away 28
(n=267)", now "Home 29% (n=139) vs Away 27% (n=133)".

`isHome` and `opponent` are now **three-valued** — a match whose season resolves
to neither side is `null`, and `null` is not `false`. The cache key is bumped to
`:v2:` because every stored entry held the old wrong values; 374 stale v1 rows
remain in `snapshot_cache` and are harmless but could be swept.

**The `toVenueBinarySplit` 25% ratio guard stays.** It is not redundant now that
the data is right — it is the thing that would catch the NEXT resolution
failure, in this provider or another. It suppresses nothing on live EPL today.

### `opponentUnit` for NFL/NBA/NHL/CFB would be a DUPLICATE, not a fill

The plan implies building it from their defense-allowed rows. Those rows are
**already rendered** by `matchupExplorer` on the same page. MLB is the genuine
case — its `opponentUnit` is the opposing STARTER and its explorer is the
lineup, two entities. Checked before building; do not re-derive this.

## 2. The backfill is RUNNING — do not restart it blindly

`mlb_pitch_events` at **1.24M rows**: 2024 complete (746,576, through
2024-10-30), 2025 in progress (484,141, through 2025-07-18), 2026 at 4,420.
Target 2024-2026, roughly 2.1M. Check before doing anything:

```
Get-CimInstance Win32_Process -Filter "Name like '%python%'" | Select ProcessId,ParentProcessId,CommandLine
```

If it has stopped, resume with the same one command — it is **resumable by
construction**, idempotent on `(game_pk, at_bat_number, pitch_number)`:

```
cd python-odds-service
./.venv/Scripts/python.exe -u src/statcast_pitches.py backfill
```

It re-fetches windows already stored (writes are no-ops), so restarting costs
time, not data. Progress:
`SELECT season, count(*), max(game_date) FROM mlb_pitch_events GROUP BY 1;`

**THE WORKER IS DEPLOYED** — `dep-da9rh44s728c73ek4tig`, status `live` on
commit `ec2f465`, confirmed. `ingestStatcastPitchesJob` runs hourly and keeps
the last 3 days current, so 2026 fills on its own from here regardless of the
historical sweep.

## 3. What is running

**A dev server on port 3000 belongs to ANOTHER session.** This session did not
start it and did not kill it. `npm run build` ran fine alongside it three times,
so the `.next/` lock that blocked the whole first session did not recur — but
the in-app Browser pane could not reach it (every navigation collapsed to `/`).
**Playwright MCP reaches it fine**; use that for verification.

The Statcast backfill (§2). **Seven** `harvester_scrape.py` scheduled tasks on
a ~20-minute cycle — each shows as two PIDs and that is one process, see §1.

## 4. Next actions

1. ~~Deploy the Render worker~~ — **DONE**, `dep-da9rh44s728c73ek4tig` is live
   on `ec2f465`. `ingestStatcastPitchesJob` runs hourly now, so 2026 fills on
   its own and MLB's pitch cards stop showing n=1 samples.
2. **Finish 6.13.** MLB fills 4 of 6 roles; CFB/NBA/NHL/soccer fill 1. Still
   open, with what was measured about each:
   - `conditions` for the outdoor sports — NOT yet checked whether NFL/CFB/
     soccer snapshots carry weather the way MLB's `active.context.weather` does.
     Measure before building.
   - `careerH2H` — every adapter already computes `windows.h2h`, but that is
     **already rendered** in the window-box row. Decide whether a per-meeting
     card adds anything before building a second view of one number.
   - `usageMix`/`spatialGrid` for other sports need 6.7/6.9 sourcing first.
   - **Do NOT build `opponentUnit` for NFL/NBA/NHL/CFB** — §1 explains why.
3. **6.14 Team Detail and 6.15 Game Detail** — untouched.
5. **6.7 NBA/NHL shots, 6.8 nflverse PBP, 6.9 Understat shots, 6.10 generalise
   weather/park/sims.** All four endpoints confirmed reachable.
6. **6.16 needs a route built first** — `/api/props/line-history` does not
   exist. The data does: `prop_odds_history`, 613,814 rows.
7. **Track D's remainder** (6.17, 6.19, 6.21, 6.23, 6.24).

## 5. Things that will bite again

**Measure the READ, never just the WRITE.** Every defect the Phase 4 gate found
had passed a VERIFY that checked the write and never the read. This session's
new tests all assert the *wiring* or the *rendered output*, and every one was
fault-injected — each fails by name when its target is reverted.

**A guardrail that has never rejected anything is not known to work.**

**A TEST WRITTEN FROM THE SAME MISTAKEN MODEL AS THE CODE AGREES WITH THE BUG.**
Two of this session's three defects were invisible to `tsc` AND to any test I
would have written first, because the test would have summed the same wrong set
the builder summed. Both surfaced within seconds of opening the page. Render it
before believing it.

**A non-empty side is not a balanced one.** A presence check (`n > 0`, or even
`n >= 3`) passes data that is structurally broken. Where the real world
constrains the shape — league teams play a balanced schedule — check the SHAPE,
not just presence.


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
- **Two `next dev` servers cannot share `.next/`.** (Did not recur this
  session — three builds ran alongside another session's dev server.)
- **The in-app Browser pane could not reach another session's dev server** —
  every navigation collapsed to `/`. Playwright MCP reached it fine.
- **The "two Python processes" thing is NOT real** — `.venv/Scripts/python.exe`
  is a redirector stub and the second PID is its own child. Measured; see §1.
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
2. **374 stale `soccer:understat:player:` v1 rows in `snapshot_cache`** —
   harmless (the live key is `:v2:`) but never swept. See §2b.
3. **`opponentUnit` is filled for MLB only**, and correctly so — for
   NFL/NBA/NHL/CFB it would duplicate `matchupExplorer` (§1). Soccer, tennis
   and golf have no source for it at all yet.
4. **NHL grades three units, not four.** Power play and penalty kill need
   situational time-on-ice, which the stored keys do not carry.
5. **MLB grades two units** (Hitting, Pitching) — no league-wide ranked
   fielding or bullpen aggregate exists to grade from.
6. **MLB total residual, ~1 point** — Q40, accepted deliberately.
7. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
8. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account is out of bounds.
9. **`snapshot_cache` is 183 MB across 3,167 rows.**
10. **2,380 duplicate observation groups in `game_odds_history`.**
11. **No push alerting; rate limiting is per-process** — Phase 8.
12. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 10. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 (Q25) |
