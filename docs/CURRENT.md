# CURRENT — pick up here

**Phase 6 is IN PROGRESS and close.** Track A complete. Track B complete except
6.10's last two thirds. Track C: 6.13 done, **6.14 and 6.15 untouched — they are
the bulk of what is left**. Track D: 6.16/6.17/6.19 done, 6.23 blocked,
6.21/6.24 open. Phases 4 and 5 complete, gates passed.

**Read `docs/audit-remediation-plan.md` Phase 6 for the plan; §11 is the phase
log and the only place a task counts as done. Trust §11 and `git log` over this
file if they disagree.**

## 1. What just happened (2026-08-30, sessions two and three)

Sixteen commits, `2469b2c`..`ae9081e`. **TS tests 106 → 197, plus 22 new Python
assertions.** `tsc` clean, `npm run build` passes, and everything claimed below
was checked against live data or a rendered page — not just compiled.

| Task | State |
|---|---|
| 6.6 Statcast | **COMPLETE** — 2,135,564 rows, 2024-26, zero failed windows. Wired and rendering. |
| 6.7 NBA/NHL shots | **COMPLETE** — both tables, ingesters, jobs, routes, roles. |
| 6.8 nflverse PBP | **ingest + route done, NOT on the page** — see §3. |
| 6.9 soccer shot map | **COMPLETE** — renders, EPL-only by design. |
| 6.10 weather | **NFL + CFB done.** Soccer impossible; park factors and sims untouched. |
| 6.13 Player Detail | **DONE** — MLB fills 5 of 6 roles; four sports fill `binarySplit`; NBA/NHL/soccer fill `spatialGrid`. |
| 6.16 line movement | **COMPLETE** — route + chart, verified drawing. |
| 6.17 price freshness | **COMPLETE** — verified live. |
| 6.19 backfill labelling | **COMPLETE** — four readers fixed. |
| 6.23 book lag | **BLOCKED, not buildable** — see §4. |
| Render worker | **DEPLOYED**, live on `ec2f465`. Needs another deploy — §3.6. |

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**Five defects this phase rendered cleanly and were only found by opening the
page or measuring the data. `tsc` and the whole test suite passed every one.**

1. A strike-zone caption counted zones the grid excluded — `n=3` above nine
   cells reading "no data".
2. Two cards on one page printed the same statistic two ways (`.717` / `0.796`).
3. A home/away card read "Home 0 (n=5) vs Away 28 (n=267)" through a
   both-sides-non-empty check.
4. `PlayerDetail` told users for nineteen days that **"Movement history isn't
   tracked"** while 670,478 rows accumulated behind it.
5. `StatTable` accepted a `lowerIsBetter` flag whose body was
   `r.lowerIsBetter ? raw : raw`.

**And one I got wrong myself.** I built the movement chart to break its line on
empty buckets, arguing it in code, commit and tests. Then I read the writer:
`prop_odds_history` is **log-on-change**, so an empty bucket means the price
HELD. The chart is now a step series. *A plausible general principle applied
without checking the writer is how you ship a confident wrong answer.*

**A test that mirrors the code agrees with the code's bugs.** Twice a test
re-implemented the rule it was checking; reverting the real function failed
nothing. Fault-inject every guard — and when an injection PASSES, the test does
not discriminate. That happened four times this session, and each time the fix
was a better fixture, not a better assertion.

## 3. NEXT ACTIONS, in order

1. **Finish 6.8 — six lines.** Ingest, table, job, read path, route and hook are
   built and verified through HTTP; only the adapter wiring is missing. Copy
   what NHL/NBA already do: build `spatialGrid` in
   `lib/sports/nfl/adapters/playerDetailAdapter.ts` from `useNflTargetMap`, and
   call the hook in `PlayerDetail.tsx` beside `useNbaShotProfile`. Payload to
   build against, already verified: receiver `00-0036900`, season 2024 → 175
   targets, 127 completions, 8.7 mean air yards, 0 unplaced.
2. **6.14 Team Detail and 6.15 Game Detail — the bulk of what remains.**
   Untouched. Measure the boards against what `TeamDetail.tsx`/`GameDetail.tsx`
   already render before building; this plan's premises have now been wrong
   **six** times.
3. **6.10's last two thirds** — `park_factors` generalised beyond MLB, and
   `game_sim_cache` (192 rows, `sport` column already exists, only `mlb`
   populated).
4. **6.21 user-facing CLV**, then **6.24** (de-vig, correlated props, DFS).
5. **Backfill the three new tables** when the seasons start. All operator
   commands, all resumable, none on a schedule:
   - `./.venv/Scripts/python.exe -u src/nhl_shots.py backfill 20242025`
   - `./.venv/Scripts/python.exe -u src/nba_shots.py backfill 2024-10-22 2025-04-13`
   - `./.venv/Scripts/python.exe -u src/nfl_pbp.py backfill 2023 2025`
6. **REDEPLOY THE RENDER WORKER.** Three new jobs (`ingestNhlShotsJob`,
   `ingestNbaShotsJob`, `ingestNflPbpJob`) are in `JOB_REGISTRY` and are **not
   running** until you do. `autoDeploy: no`; the call is in §7.

## 4. Blocked, and why — do not re-attempt without new data

**6.23 book-lag analysis is NOT DERIVABLE.** The plan says "derivable today from
`prop_odds_history`. No new data." It is not. `observed_at` is the PROVIDER'S
POLL TIME, not the moment a book moved: **126,977 rows over 24 hours share 426
distinct timestamps**, and one real batch stamps 477 rows across 7 books at a
single instant. Propline alone writes 17 of the books that way. A lead-lag
leaderboard on this ranks books by which provider polls them and how often —
running it gave every book a score between 0.000 and 0.212. `delay_seconds` does
not rescue it (Propline reports none across 84,964 rows; SharpAPI reports a
constant 60, which is a declared feed delay). **Needs a provider returning a
per-book `last_update`. Operator decision, not more work.**

**Soccer weather is impossible from ESPN.** `indoor` is present on 16/16 NFL and
25/25 CFB events and **entirely absent** for MLS and EPL. MLS has real domes, so
`!indoor` would print wind and rain for a game played under a roof. Needs a
checked per-venue roof list.

**Not fixed, needs its own task: 53% of `pitcher-strikeouts` rows in
`prop_odds_history` carry no line** — 52,024 of 98,434, mostly fanduel (37,714),
fanatics (13,882), draftkings (3,027). "Over" nothing is not a bet. That is in
the Python ingest path.

## 5. What is running

**A dev server on port 3000 belongs to ANOTHER session.** `npm run build` ran
alongside it many times without the `.next/` lock that blocked session one.
**The in-app Browser pane cannot reach it** — every navigation collapses to `/`.
**Playwright MCP reaches it fine; use that.**

Seven `harvester_scrape.py` scheduled tasks on a ~20-minute cycle. Each shows as
two PIDs and **that is one process** — `.venv/Scripts/python.exe` is a 274 KB
redirector stub whose child is the real interpreter (measured: 4.6 MB / 1 thread
/ 0s CPU against 91.8 MB / 10 threads / 3.1s CPU). The old "duplicate process"
warning is retired; do not spend time on it.

## 6. Things that will bite again

**Measure the READ, never just the WRITE.** Every Phase 4 gate defect had passed
a VERIFY that checked the write and never the read.

**A guardrail that has never rejected anything is not known to work.**

**A test written from the same mistaken model as the code agrees with the bug.**
See §2.

**A non-empty side is not a balanced one.** Presence checks (`n > 0`, `n >= 3`)
pass structurally broken data. Where the real world constrains the shape — league
teams play a balanced schedule — check the SHAPE, not just presence.

**Sentinels are not nulls.** ESPN encodes a missing NBA coordinate as
`-214748340`, which is finite and passes every null check; 55 of 250 shooting
plays carried it and it made the mean two-point distance 72,623,934 feet. And
`Number('')` is **0**, which is finite — that put soccer shots on the player's
own goal line.

**Establish geometry from ground truth.** NBA's basket sits at (25,0) in feet
because threes measured 26.6 ft and twos 12.9 against a real 22–23.75 ft line.
NHL's `x` sign alternates by attacking end, so the fold is a 180° rotation, not
`abs(x)`.

- **Out of season is the default state of most sports.** NBA and NHL return zero
  candidates until October; CFB's slate emptied mid-session. Check the calendar
  before diagnosing.
- **`prop_odds_history` is LOG-ON-CHANGE.** Silence means unchanged, not unseen.
- **The dimension is not the market key.** `hit-in-game` is stored as `hits`;
  use `candidateDimensionToMarketKey`.
- **`/api/props/*` is rate-limited at 10/min as "provider".** Page-load reads
  need the `page-read` class, declared BEFORE the provider rule.
- **Different tables, different vocabulary.** `player_game_history` uses
  `soccer_epl`/`tennis_atp`; `pick_history` uses `soccer`/`tennis`.
- **`player_game_history` numbers are float TEXT.** Cast `::numeric`.
- **Tennis ids can be compound** (`2725-2434`, 19% of ATP rows).
- **Savant zones 11-14 are OUTSIDE the 3x3.**
- **A long heredoc breaks this shell.** Use `git commit -F`.
- **`ps aux | grep` shows no command lines in Git Bash.** Use
  `Get-CimInstance Win32_Process`.
- **The DB pool caps at 15 connections** — a `.mjs` query hung this session from
  too many open clients. Close them.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 7. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `gate*.mjs`, `runmig.mjs` are gitignored. **`node runmig.mjs <path>` applies a
  migration.** `.env.local` has no `DIRECT_URL`, so DDL also goes through `:6543`.
- **Supabase PRO plan**, 8 GB included. Was 2,234 MB; 6.6 added ~2.1M pitch rows
  and 6.7/6.8 added three more tables. **Re-measure before assuming headroom.**
- **RLS off on 7 of 41 tables** — the `*_backup_*`/quarantine four plus
  `job_locks` and `mlb_prop_model_cache`.
- **Tests:** `npm test` (**197**), and each
  `./.venv/Scripts/python.exe -u src/test_*.py` from `python-odds-service/`. No
  pytest. **Do not run the whole Python sweep at once — several tests hit the
  network/DB and it exceeds a two-minute timeout.**
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. After any push
  touching `python-odds-service/`: `POST /v1/services/$SRV/deploys` with
  `RENDER_API_KEY` from `.env.local`, then confirm `"status":"live"` on your
  commit sha. ~90s.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's and must never be staged.

## 8. Operator decisions taken — do not reopen

**2026-08-29:** Officials/umpires CUT. Tennis point-level data CUT. NBA/NHL shot
coordinates APPROVED (6.7 — now built).

**2026-08-30:** 6.5 let it accrue, no `pick_history` backfill. Statcast depth
2024 onwards. New sourcing tables are **Python-written**. Primitive port list:
all 14. 6.3 accepted as six new fields. 6.11 needs no purchase. 6.18 skipped
(remains a launch blocker). 6.20 and 6.22 moved to Phase 7 — they need a graded
record that does not exist yet. Golf gets no game page, so 6.15 ships **seven**
sports.

## 9. Known not done

1. **6.8's adapter wiring** — §3, item 1.
2. **6.14 and 6.15** — untouched, and the largest remaining work.
3. **Duplicate React keys can silently omit prop rows** —
   `GolfScheduleView.tsx:1244` and `TennisScheduleView.tsx:529` omit the game id
   from the key. One-line fix, still unowned.
4. **The three new ingest tables hold one game / one season each** — enough to
   verify the pipeline, not enough to render for most players. See §3 item 5.
5. **NHL grades three units, not four** — no situational time-on-ice.
6. **MLB's `binarySplit` stays null** — vs LHP/RHP needs a platoon split this app
   does not store. Home/away is already a venue filter chip there.
7. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
8. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account is out of bounds.
9. **374 stale `soccer:understat:player:` v1/v2 rows** in `snapshot_cache` (the
   live key is `:v3:`). Harmless, never swept.
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
