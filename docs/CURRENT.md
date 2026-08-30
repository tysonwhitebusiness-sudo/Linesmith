# CURRENT — pick up here

**Phase 6 is IN PROGRESS.** Track A complete. Track B complete except 6.10's
last two thirds. Track C: 6.13 done, **6.14 partly (the rating block), 6.15
untouched and now the largest single item left**. Track D: 6.16/6.17/6.19 done,
6.23 blocked, 6.21/6.24 open. Phases 4 and 5 complete, gates passed.

**Read `docs/audit-remediation-plan.md` Phase 6 for the plan; §11 is the phase
log and the only place a task counts as done. Trust §11 and `git log` over this
file if they disagree.**

## 1. What just happened (2026-08-30, session four)

Three commits, `e4c2745`..`f54ad33`. **TS tests 197 → 226.** `tsc` clean,
`npm run build` clean, and everything below was checked against live rows or a
rendered page.

| Task | State |
|---|---|
| 6.8 nflverse PBP | **COMPLETE** — target map renders; 2025 backfilled (17,582 events). |
| 6.14 rating block | **BUILT** — `team_elo_history`'s 88,774 rows reach a page for the first time. Six sports. |
| Render worker | **DEPLOYED and live on `e4c2745`.** Needs ONE MORE deploy — §3.1. |
| `refreshTier1` | **FIXED in the tree, NOT deployed.** It is failing in production right now. |
| 6.23 book lag | **STILL BLOCKED** — unchanged, see §4. |

## 2. THE SINGLE MOST IMPORTANT THING TO CARRY FORWARD

**I got a diagnosis wrong, went a long way on it, and the tell was a column I
was not looking at.**

`refreshTier1` was failing on `mlb / total / under / point=5.5`. A 5.5 total is
completely ordinary baseball, so task 5.4's `gobl_point_plausible` band of
[6, 14] looks too tight — and I measured it: 37,881 settled games in
`historical_odds` carry totals from **4.7 to 19.63**, 105 of them below 6, with
a clean gap to a corrupt 100–104 cluster. That is a real measurement, it is
correct, and the conclusion drawn from it was wrong.

**The tell is the PRICE, not the point.** Under 5.5 at **-225** implies 69%; a
real nine-inning under 5.5 sits near 20–25%. It is an alternate-scope market — a
team total or a first-five-innings line — landing in the game-total slot, which
is precisely what 5.4's own migration comment describes. Widening the band would
have quietly readmitted the entire class of data 5.4 exists to exclude.

*Measuring the field you suspect is not the same as measuring the row. The
adjacent column is where the answer was.*

**Two more tests that did not discriminate, both bad FIXTURES, not bad
assertions.** Fault injection caught both (details in §11). One asserted
something structurally unreachable; one used two seasons where the shape needs
three. **When an injection PASSES, the test does not discriminate** — that is
now six occurrences across two sessions, and every single fix was a better
fixture.

**A sibling sport's solution is only copyable when the two sports share an id
space.** 6.8 was handed over as "six lines, copy NHL/NBA". NHL and NBA parse the
shooter id out of `subjectId` in the browser; NFL cannot, because `subjectId` is
`espn:football:{athleteId}`, `nfl_target_events.receiver_id` is a GSIS id, and
the crosswalk reads the database.

## 3. NEXT ACTIONS, in order

1. **REDEPLOY THE RENDER WORKER — the odds cycle is broken until you do.**
   `refreshTier1` is failing in production on every run and writing none of its
   ~1,500 rows. The fix is committed (`f54ad33`) and not deployed. Call is in §7.
   The previous deploy (`e4c2745`) is live and did register the three ingest
   jobs; this is a second, separate deploy for the Python fix.
2. **Confirm the three ingest jobs have actually run.** They are registered —
   `ingestNhlShotsJob` and `ingestNbaShotsJob` hourly, `ingestNflPbpJob` daily —
   but none had come due when checked at 17:25. Breadcrumbs live in
   `snapshot_cache` under `python-harness:job-run:%`, **not** a `job_run_log`
   table; that table does not exist.
3. **6.15 Game Detail, eight sports.** Untouched, and now the largest single
   item. **Measure the board against what `GameDetail.tsx` already renders before
   building** — this plan's premises have now been wrong **eight** times, twice
   in this session alone on 6.14's board.
4. **6.14's remaining blocks.** Only the rating block is built. The board's other
   verdicts were already done (`unitGrades`) or stale; re-measure before trusting
   the rest of its twenty.
5. **6.10's last two thirds** — `park_factors` beyond MLB, and `game_sim_cache`.
6. **6.21 user-facing CLV**, then **6.24**.
7. **Backfill the ingest tables** when the seasons start. Operator commands, all
   resumable, none scheduled:
   - `./.venv/Scripts/python.exe -u src/nhl_shots.py backfill 20242025`
   - `./.venv/Scripts/python.exe -u src/nba_shots.py backfill 2024-10-22 2025-04-13`
   - `./.venv/Scripts/python.exe -u src/nfl_pbp.py backfill 2023 2024`
     (**2025 is already done** — 17,582 events.)

## 4. Blocked, and why — do not re-attempt without new data

**6.23 book-lag analysis is NOT DERIVABLE.** Unchanged from session three.
`observed_at` is the PROVIDER'S POLL TIME, not the moment a book moved:
**126,977 rows over 24 hours share 426 distinct timestamps**, one batch stamping
477 rows across 7 books at a single instant. `delay_seconds` does not rescue it.
**Needs a provider returning a per-book `last_update`. Operator decision.**

**Soccer weather is impossible from ESPN.** `indoor` is on 16/16 NFL and 25/25
CFB events and entirely absent for MLS and EPL. MLS has real domes, so `!indoor`
would print wind and rain for a game under a roof.

**53% of `pitcher-strikeouts` rows in `prop_odds_history` carry no line** —
52,024 of 98,434, mostly fanduel (37,714). "Over" nothing is not a bet. Needs its
own task, in the Python ingest path.

## 5. What is running

**A dev server on port 3000 belongs to ANOTHER session.** `npm run build` runs
alongside it fine. **The in-app Browser pane cannot reach it** — every navigation
collapses to `/`. **Playwright MCP reaches it fine; use that.**

Seven `harvester_scrape.py` scheduled tasks on a ~20-minute cycle. Each shows as
two PIDs and **that is one process** — the `.venv` launcher is a redirector stub.
Retired warning; do not spend time on it.

## 6. Things that will bite again

**Measure the READ, never just the WRITE.** And **measure the ROW, not just the
field you suspect** — §2.

**A deploy reporting `"status":"live"` is not a job having run.** That is how
`refreshTier1`'s failure was found at all.

**A guardrail that has never rejected anything is not known to work.** The new
`test_book_line_rejection.py` runs against REAL Postgres deliberately: the batch
abort comes from Postgres' transaction semantics, so a mock reproduces nothing.

**A test written from the same mistaken model as the code agrees with the bug**,
and a fixture that cannot fail is not a test. Six occurrences now.

**`SeriesChart` builds its x scale from `values.length` and reuses it for every
`context` line.** A context series even one element longer runs off the frame.
Nothing type-checks it. Pad every series to one width with `NaN`.

**`zeroBased` on `SeriesChart` has no default, deliberately.** An Elo series
spanning 130 points collapses to a flat strip against a zero axis and still
renders cleanly.

**`team_elo_history.team_id` is NOT unique across sports** — 43 ids, four
leagues, 27,591 rows. Always filter on `sport`. TS's three Elo readers do not,
and are safe only because every caller is MLB's (see §9.3).

**The latest season is not always a drawable one.** Every league spends its
opening weeks with 1–2 games on the board and a full season behind it.

**Different tables, different vocabulary.** `team_elo_history` says
`soccer_epl`/`soccer_mls`; `player_game_history` says `soccer_epl`/`tennis_atp`;
`pick_history` says `soccer`/`tennis`.

- **Out of season is the default state of most sports.** NBA/NHL return zero
  candidates until October.
- **`prop_odds_history` is LOG-ON-CHANGE.** Silence means unchanged, not unseen.
- **The dimension is not the market key.** Use `candidateDimensionToMarketKey`.
- **`/api/props/*` is rate-limited at 10/min as "provider".** Page-load reads
  need the `page-read` class, declared BEFORE the provider rule.
- **`player_game_history` numbers are float TEXT.** Cast `::numeric`.
- **Savant zones 11-14 are OUTSIDE the 3x3.**
- **Sentinels are not nulls**, and `Number('')` is `0`, which is finite.
- **A long heredoc breaks this shell** — it truncates silently mid-file. Use the
  Write tool for anything long, and `git commit -F`.
- **`ps aux | grep` shows no command lines in Git Bash.** Use
  `Get-CimInstance Win32_Process`.
- **The DB pool caps at 15 connections.** Close your `.mjs` clients.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 7. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `gate*.mjs`, `runmig.mjs` are gitignored. **`node runmig.mjs <path>` applies a
  migration.** `.env.local` has no `DIRECT_URL`, so DDL also goes through `:6543`.
- **Supabase PRO plan**, 8 GB included. **Re-measure before assuming headroom.**
- **Cache-busting is often the missing step.** A new adapter field will not
  appear until the snapshot cache is cleared —
  `DELETE FROM snapshot_cache WHERE cache_key = 'nfl:snapshot'`. This cost real
  time twice this session.
- **Tests:** `npm test` (**226**), and each
  `./.venv/Scripts/python.exe -u src/test_*.py` from `python-odds-service/`. No
  pytest. **Do not run the whole Python sweep at once** — several hit the
  network/DB and exceed a two-minute timeout.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. After any push
  touching `python-odds-service/`:
  `POST /v1/services/$SRV/deploys` with `RENDER_API_KEY` from `.env.local`, then
  confirm `"status":"live"` on your commit sha. ~90s, six polls at 15s.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's and must never be staged.

## 8. Operator decisions taken — do not reopen

**2026-08-29:** Officials/umpires CUT. Tennis point-level data CUT. NBA/NHL shot
coordinates APPROVED.

**2026-08-30:** 6.5 let it accrue, no `pick_history` backfill. Statcast depth
2024 onwards. New sourcing tables are **Python-written**. Primitive port list:
all 14. 6.3 accepted as six new fields. 6.11 needs no purchase. 6.18 skipped
(remains a launch blocker). 6.20 and 6.22 moved to Phase 7. Golf gets no game
page, so 6.15 ships **seven** sports. Render worker redeploy approved and done
for `e4c2745`.

## 9. Known not done

1. **`refreshTier1`'s fix is undeployed** — §3.1. Production is still broken.
2. **6.15 untouched**, and 6.14 has only its rating block.
3. **TS's three Elo readers ignore `sport`** — `getCurrentElo`,
   `getLatestEloBeforeSeason`, `getMostRecentEloGame` in `lib/db/client.ts`.
   Latent, not live: every caller is MLB's and MLBAM ids do not collide. Python
   already filters correctly. **Fix before anything non-MLB reads Elo.**
4. **Duplicate React keys can silently omit prop rows** —
   `GolfScheduleView.tsx:1244` and `TennisScheduleView.tsx:529` omit the game id
   from the key. One-line fix, still unowned.
5. **The three ingest tables hold one or two seasons each** — see §3.7.
6. **NHL grades three units, not four** — no situational time-on-ice.
7. **MLB's `binarySplit` stays null** — vs LHP/RHP needs a platoon split this app
   does not store.
8. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
9. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account is out of bounds.
10. **374 stale `soccer:understat:player:` v1/v2 rows** in `snapshot_cache`.
11. **2,380 duplicate observation groups in `game_odds_history`.**
12. **No push alerting; rate limiting is per-process** — Phase 8.
13. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.
14. **NBA has 37 and NFL 34 distinct team ids in `team_elo_history`** against 30
    and 32 real franchises — a handful of 1–3 row exhibition/all-star entries.
    Harmless for a per-team read; never swept.

## 10. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 (Q25) |
