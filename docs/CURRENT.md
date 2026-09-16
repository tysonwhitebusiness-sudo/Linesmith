# CURRENT — pick up here

**Phases 1–4 COMPLETE. Phase 5 OPEN (monitoring only). Phase 6 CLOSED (CFB,
measured NO). Phase 7 CLOSED 2026-09-13 (NBA: props measured NO, game model not
built, decision recorded). Phase 8 EXECUTED 2026-09-13: all five operator
decisions done and deployed; three checks owed before closing it.
Research pages: R1-R5 and R6.1 (MLB) signed off; R6.2 (NFL/CFB), R6.3 (soccer),
R6.4 (tennis), R6.5 (NBA/NHL) and R6.6 (golf) complete — **R6 done** — with
live renders owed on the next slates; R7 (team page) next (second track, below).**

`docs/master-plan-2026-09-06.md` is the authority on build order **and now holds
the full Phase 6 and Phase 7 close-outs**, including the numbers, the decisions
and the reopen conditions. Don't duplicate them here.

**Second track, APPROVED 2026-09-14: research pages.**
`docs/audit-2026-09-13/research-pages-master-plan.md` rebuilds the player, team
and game pages to the G2 mockups (`docs/design/phase-g2/`), phases R0–R11. It
covers only those pages and adds no new surface; the model and product order
above is unchanged. That thread's own baton is
`docs/audit-2026-09-13/RESUME-PROMPT.md`; read it before any R-phase work.

---

## THE ONE HABIT THAT KEEPS PAYING: audit a phase's premises before building

Phase 6's brief had four false premises, and Phase 7's had four more, one of
which (prices stop after six weeks) decided the phase. Every brief was written
before Phase 5 moved data into the Parquet corpus, so **any claim about where data
lives, or how much of it there is, is stale by default.**

The second habit, which Phase 7 added: **pre-register a test in a commit before
the code that runs it exists.** It turned a "promising pocket" into a recorded
untestable, instead of a false positive.

---

# START HERE — the exact next action

## Research pages track — R6 COMPLETE 2026-09-16 (every sport); R7 next

R1-R5 and R6.1 signed off; R6.2-R6.6 done. **R7 (team page rebuild) STARTED
2026-09-16 on the operator's go-ahead: Step 0 done and recorded in the plan's R7
section. R7-C1: results & schedule read each league's schedule, not
`game_result` (preseason, postseason, no OTL, MLB gaps). Sub-phases R7.1
(skeleton on MLB) → R7.2 football → R7.3 NBA/NHL → R7.4 soccer, stop after each.
**R7.1 and R7.2 SIGNED OFF; R7.3 (NBA, NHL) COMPLETE 2026-09-16, awaiting sign-off.** Also fixed: the NHL team-id map sent Utah to its old id (59, not 68). R7.1: `/api/team-research` +
`buildTeamResearch` + `TeamResearchPage`; MLB, NFL, CFB, NBA and NHL team pages use it; soccer still
renders the old `TeamDetail` until R7.4, which then deletes it. Record in the
plan's R7 section. R2-F7 fixed.** The handoff is
`docs/audit-2026-09-13/RESUME-PROMPT.md`; the record is the plan's status block.

- **R6 audit, 2026-09-16** (after R6.6, before R7): four cross-sport defects,
  all fixed in one commit. (1) The live card marked an under still below its
  line as HIT (green check) in every builder; an under cannot hit while the game
  is on — one rule, `liveLineHit` in `lib/sports/shared/liveLine.ts`.
  (2) `repriceAtMainLine` attached the OVER's price to a re-lined MLB under /
  no-hit / no-run. (3) NFL and CFB each carried a copy of live-card pricing and
  NBA/NHL had none (stale line, no price) — one `liveLinePricing`, four callers.
  (4) Only NFL's section followed the early-season rule; NBA, NHL, soccer and
  tennis opened on the newest season under a hero saying it showed last season.
  Every section now opens on the page's scope season (`sectionOpeningSeason`),
  numbering checked per sport. Also: `soccer/understat` cache key namespaced
  `route:`, four server reads added to the bundle-boundary test. Rendered
  Haaland, Cunha, MLS, Lamb, SGA, MacKinnon, Alcaraz, Sabalenka; 528 tests,
  tsc and build clean.
  - **The dev server's render workers died mid-check** ("Jest worker
    encountered 2 child process exceptions"): every route 500'd, including
    pages that had rendered a minute earlier. A restart fixed it. If a whole
    sweep 500s at once, restart before debugging.

- **R6.6:** golf had no research at all (no `player_game_history`); it now
  reads its own tables through `/api/golf/player-research` — Scoring (recent
  rounds, scoring by par) and Shot profile (the 2020-2022 seed: driving,
  first-putt distance, putting, make % by distance, by lie). Measured first:
  the round tables hold only the three 2026 playoff events; the seed's
  `tournament_id` repeats every year, so a hole needs the season (G2 merged
  them); a putt's distance is its roll, not its start; and the hole `category`
  column misfiles eagles and doubles (R6-F12). The old lie grid chain is deleted.

- **R6.5:** NBA's shot chart on a real half court and NHL's rink map, both from
  every located attempt (new `/api/nba/shots`, `/api/nhl/shots`), with a zone
  table whose last column is points per shot, a shot-type table, and — for NHL —
  **the league's own season totals**, off the landing the bio already fetches,
  reaching back to 2015-16 where this app's history starts in 2023. A goalie
  takes no shots, so that read falls back to `goalie_id` and the card becomes
  "Shots faced". Two of the plan's premises turned out stale and are corrected
  there: both shot tables hold the CURRENT season, and the NHL totals were
  already parsed. **R6-F9 and C4 are now done for every sport.** The 3x3 grid
  both pages used is deleted with its whole chain (two routes, two hooks, two
  reads, two shapes files, two test files) after grepping showed this page was
  its only caller.
  - **One app-breaking bug, fixed in the same commit:** importing
    `isNhlGameLive` from `nhle.ts` pulled `pg` into the client bundle — `tsc`
    and 504 tests passed, the dev server returned 500 on every route. The
    predicates moved to a client-safe `gameStates.ts` and the boundary test now
    lists `nhle.ts`.

- **R6.4:** "Surface & serve" from the TennisMyLife archive (new
  `/api/tennis/archive`, resolved by name) — by surface with today's court
  marked, **by level** (slam / Masters 1000 / 500 / 250, with the deepest round
  reached, which is R6-F3 answered on the page), ranking at each match, and
  serve against return as a 10-match rolling pair. The section states how far
  the archive reaches, because it lags: the ATP file ends 2026-08-30 with the US
  Open missing. Tennis also re-prices on the current main line (R6-F9 closed for
  it), fills the game-state card with set scores and says point-by-point is not
  held, and fills the game log's unnamed opponents from the archive.
  Rendering caught three defects, all fixed: a ranking axis that printed the
  same rank twice, copy that said "he" on a WTA page, and an "@ / vs" prefix
  plus a Home/Away split on a sport with no home side.

- **R6.3:** an outfield player's "Chances & finishing" draws every Understat
  shot on the attacking half (new `/api/soccer/understat`, resolved by name),
  with finishing by body part, goals against xG and per 90 by season; a keeper
  gets the not-held state; MLS says Understat does not cover it. Soccer also
  re-prices on the current main line, fills the live card (score, clock and
  events only) and opens on the market its position plays for.

- **R6.2:** a receiver's "Usage & depth" and a quarterback's "Where he throws"
  draw every located pass at its own air yards (new `/api/nfl/targets`, keyed
  by the page's own ESPN id); CFB says what is not held; NFL and CFB re-price
  on the current main line and fill the game-state card. The old target-map
  route, grid, hook and the rail's NFL season card are deleted.
- **Hero and live card reworked 2026-09-15** (operator pivot, `35d6be5`): the
  hero is dense rather than two thin columns with a gap, the live card is its
  own section under the hero with the sport's situation and a lines table that
  tints a cleared line, and the player page has one card header instead of two.
  Plan and mockups: `docs/design/hero-live-rework.md`, `docs/design/hero-live/`.
- **OWED Thursday 2026-09-18:** NFL's game-state card and its prop block on a
  player with a market — no live game or priced NFL player was on the slate
  when they landed. CFB's, Saturday 2026-09-19.
- **OWED next EPL match day:** soccer's live card, and R2-F9 — the
  `soccer:snapshot:epl` row does write, but today's slate was empty (~0 MB), so
  the 22 MB write is still unproven.
- **OWED the next tennis match day:** tennis's game-state card (set scores) and
  its re-priced line. Nothing was on the ATP or WTA slate on 2026-09-15, so all
  three verified players rendered the no-market path.
- **OWED at the next tournament:** golf's prop block and live view, which have
  always been held for one.
- **OWED in October:** NBA's and NHL's game-state cards and their re-priced
  lines. Neither league is in season, so both sub-phases rendered the no-market
  path; the plan always marked these two unverified until October.

- **R6.1d:** the player page names one line (R2's main line, re-priced from
  current rows; MLB's model chip names its own board line), a started game's
  prices are the ones at the start, line movement is pinned to that line, all
  odds sit in an "Odds & prices" section, and a sport-neutral game-state card
  replaces the MLB-only live block.
- **R6.1a:** the player is the page for every sport — hero from the league bio,
  Seasons / Trends / Splits / Game log from every season of
  `player_game_history`, the prop block as one section. Nothing deployed (no
  Python change). Verified against all 24 G2 player datasets and refereed
  against the leagues.
- **Affects the model track (Python writers, not fixed in R6):**
  - R6-F5: MLB `game_result` has no game pk before the 2026-08 live capture,
    dates night games by UTC and misses some games, so it cannot be joined to
    MLB games by date (25 of Witt's 449 took a neighbour's score). The player
    page reads StatsAPI finals instead. Anything else joining MLB results by
    date inherits the error.
  - R6-F3 (**answered on the page in R6.4** — By level reads TennisMyLife's own
    `level` column): `is_major` is 0 on every tennis row (`backfill_player_game_history.py:854`
    looks for "grand slam" in slam names).
  - R6-F4: MLB history stores no sacrifice flies, so OBP from it is over PA.
  - **R6-F11: `nfl_target_events.interception` is false on all 36,375 rows**
    (the writer never sets it), so the NFL sections state that interceptions
    are not held rather than showing an all-zero column.
  - **R6-F8: ParlayAPI files a pitcher's strikeouts under `batter-strikeouts`
    (29 pitchers on 2026-09-15) and walks allowed under `walks` (9).** Pitcher
    markets miss those books; a market-mapping fix in the Python writer.
  - **R6-F7: the pitch corpus holds some games only in part.** 281 of 2,229
    regular-season 2026 games in `corpus/mlb_pitch_events` have under three
    pitch rows per plate appearance, every month, 2025 too; Statcast rollups
    cover 91-94% of a hitter's plate appearances (Judge: 14 Statcast HR to 18
    in the box scores). Every corpus-based model input inherits this. The
    player page states the coverage.
- **Still for the model track from R5:** R5-F5, the worker OOM loop (512 MB,
  4-9 kills an hour since 2026-09-11). Read the service's `server_failed`
  events before touching jobs. R5-F1/F2/F4 and 5e as recorded in the plan.
- `mlb:full-raw:<date>` rows are no longer written (R6-F2); the existing
  Python prune removes the old ones after three days — they were among the
  large `snapshot_cache` rows Phase 5 flagged.

**Owed:** MLB live state (R8) before the
regular season ends late September; a look at `refreshCfbJob` on Saturday
2026-09-19.

Each R-phase ends with a stop for sign-off (plan §2).

## Model track — Phase 8

**Phase 8 — all five decisions DONE and deployed 2026-09-13.** Close the phase once the owed checks below are done, then read the master plan for Phase 9. Decisions and
progress (audit detail in the master plan's Phase 8 section, 8.0–8.3):

| # | decision | state |
|---|---|---|
| 1 | fix soccer bridge key bug + deploy | **DONE + DEPLOYED** (99d65f2, deploy dep-dajhgne7bikc73c3ol20). Verified in prod: first-ever soccer live_capture rows, EPL 803 / MLS 953 at 21:42:55 UTC |
| 2 | delete the golf model layer; keep leaderboard, Match Winner lines, schedule, shot profile; back up golf tables first | **DONE + DEPLOYED** bc18db2. Prediction tables left frozen (operator). Backup CSVs at `python-odds-service/golf_model_layer_backup_20260913/` (local, uncommitted) |
| 3 | `golf_shot_events` (230 MB): keep for now | no action |
| 4 | stop soccer generic-Elo picks | **DONE + DEPLOYED** 669eefa; verified in prod and on the page |
| 5 | BUILD tennis capture (player resolution for the bridge) | **DONE + DEPLOYED** c34dacd + de8ccca. Verified in prod 22:54 UTC: 57 tennis_wta closes; results ATP 232 / WTA 362; 13 retirements/walkovers skipped as designed; no insert failures |

**Checks still owed:**
- **Golf with a live field:** the golf Scan and PlayerDetail have not been
  rendered since the model was removed, because no tournament was in progress.
  Open them during the next event.
- **`orphanJobBreadcrumbs` will name `golfPredictionsJob`.** That's the rename,
  deliberate, not a dropped job.
- **Reversed-orientation bug (de8ccca):** fixed going forward, but how many
  archived closes it mis-sided in team sports is UNMEASURED; see the master
  plan's 8.3 decisions note.

**Worker is live at `c34dacd`** (Render deploy dep-dajiiae7bikc73c78ltg, 22:53 UTC).
Three API deploys went out this session, each approved first: 99d65f2, then
bc18db2, then c34dacd.

---

# Phase 7 — NBA — CLOSED 2026-09-13 (full record in the master plan)

One-paragraph version: priced props cover only six weeks (2025-10-21 →
2025-12-01). A rate × minutes model was built on `count_prop_engine` with a
walk-forward minutes model that beats rolling-5 by 6%. It is calibrated, but the
pre-registered edge test FAILED: ROI −8.78%, 7.25pt worse than always betting the
under. The "edge" was the model's shrinkage toward 50%. **Reopen props only with a
full season of prices AND an active-roster feed.** H2 (Total Assists 55–60% fade
the over) is pre-registered for 2026-27 prices. The game model was not built;
timestamped NBA closes start accumulating from tip-off via the archival bridge
with no new work.

**Checks to run once the 2026-27 season starts (late October):**
1. `odds_archive` rows with `source='live_capture'`, `sport='nba'`, non-null
   `captured_at`. This confirms the bridge captures NBA; it's unverified until
   real games run.
2. `prop_odds_archive` nba rows keep non-null `over_price`/`under_price` past
   December. The DraftKings switch zeroed them last season.

Scripts (all in `python-odds-service/`): `build_nba_prop_training_set.py`,
`build_nba_player_panel.py`, `fit_nba_minutes.py`, `fit_nba_prop_rates.py`,
`test_nba_prop_edge.py`. Local artefacts `nba_panel.parquet`,
`nba_props_train.csv`, `nba_minutes_pred.parquet`, `nba_prop_probs.csv` exist on
the operator's machine. `nba_prop_probs.csv` is **not** gitignored; don't commit
it.

**Any NBA prop-to-result join must use `event_ref`**, not `(athlete_id,
game_date)`: 1,863 pairs carry two real games under one date.

---

# Phase 5 — OPEN, monitoring only

Left open at the operator's direction to retest egress over several days rather
than close on one reading.

| ceiling | state |
|---|---|
| database | **WATCH — growing again**, see below |
| worker RAM | **CLEARED** — 248 MB resting of 512, peak 380 across 40 jobs |
| egress | **halved, not yet at target — OPERATOR MUST LOOK** |

```
  before the fixes   ~19.1 GB/day
  2026-09-13          7.051 GB at ~17h  ->  ~10 GB/day projected
  target              <= 8.3 GB/day
```

**WHAT TO CHECK:** the Supabase egress graph, over several days. One day is not
a trend and 13 Sep was partly a deploy day. **There is no API token for it — the
operator must look.** This was NOT checked during the 2026-09-13 session.

**DATABASE GROWTH MOVED THE WRONG WAY and this is new.** `health_check` on
2026-09-13 read **3,571 MB (43.6%), +164.1 MB/day over 2.6d, 28 days of
headroom**. The previous handoff recorded the prune loop as closed and the
ceiling as "CLEARED and SUSTAINABLE" at 42.4%. It is growing at 164 MB/day —
much better than the +469.6 it was, but **not flat, and 28 days is not a lot.**
Nobody has looked at what is growing.

**Known contributor, routed here from R2 (2026-09-14):** `snapshot_cache` holds
several very large, very old rows — `mlb:full-raw:*` at 79/78/52 MB and
`mlb:snapshot:2026-08-16` at 22 MB, 29 days old. Check whether anything still
reads those keys before pruning them.

**THE LARGEST REMAINING EGRESS LEVER, independent of any byte estimate:**
`SELECT fetched_at FROM snapshot_cache` runs **424,958 times/day** — 5 a second,
by far the highest call count of anything. It is the blob cache's validation
query. Memoising it in-process for a few seconds would collapse burst reads of
one key into one query, with no staleness risk beyond seconds (the payload is
already versioned by `fetched_at`). **NOT BUILT. Size unknown.**

## What shipped in Phase 5 (all deployed, all gated)

- **blob validation-cache** — `read_snapshot`/`read_snapshot_with_age` ask
  Postgres only for `fetched_at` and serve the payload from local disk when the
  stamp matches. **99.5% hit rate in production.** Disk, not memory, to protect
  the RAM ceiling.
- **prop archive server-side** — `INSERT … SELECT`; 36,361 rows, 7 sports, 0
  mismatches.
- **closing-lines archive server-side** — 2,104 rows, 0 mismatches, 6.62s.
- **hot-window aggregation** — `load_hot_window_agg`; 1,958,099 rows → 17,118
  (99.1% fewer). Gated at 17,118 athlete-markets, 0 diffs, plus
  `summary == prefix + hot` on 15,642.
- **team-elo per-game read** — was loading the whole sport then discarding all
  but one game, *while being called once per game* (12,432 calls/day).
- **reference points server-side** — and it fixed a NON-DETERMINISM: 68
  candidate rows share 4 `fetched_at` values, books disagree (8.0/8.5/9.5), so
  "freshest wins" returned whatever an unordered SELECT gave first. Now each
  book's freshest quote then the MEDIAN across books; `percentile_disc` so the
  answer is a really-quoted line. Differed from the old pick on 39% of keys.
- **corpus prune loop closed** — `refresh_corpus --prune` runs `prune_corpus`
  daily after export+upload. Before this the database grew +469.6 MB/day with 10
  days of headroom, because the 7,282 → 3,200 MB reduction came from running
  those tools BY HAND and nothing repeated them.
- **corpusFreshness heartbeat** — the old alarm sat BELOW the floor of normal
  operation (250k threshold vs ~407k rows per cycle) and went red every cycle
  regardless of health.

---

## MEASUREMENT LESSONS — read before measuring anything

**1. A SHORT WINDOW CANNOT PROVE A QUERY IS DEAD.** A query running 73×/day
appears **0.35 times** in 420 seconds. On that basis a query was declared dead;
it was the largest line on the bill.

**2. A MINIMUM-CALL THRESHOLD DOES NOT CATCH A BURSTY JOB.** A 600s window
reported 99M rows/day for a query whose lifetime rate is 7.4M. **Cross-check
window rate against lifetime rate (`rows / stats_since`); disagreement >3× means
discard the window figure, not average it.**

**3. THE WIDTH MODEL FAILS IN BOTH DIRECTIONS.** Flat 109 B/row said 4.08
GB/day; per-table width said 24.63; the graph said ~10. **A correct estimator
needs SELECTED-COLUMN widths. Nobody has built one.**

**4. psutil WIRE MEASUREMENT FAILS BELOW A FEW MB.** `SELECT 1` measured at
19,417 B/call, which is impossible.

**5. BLOCKS TOUCHED ARE NOT BYTES SENT.** `shared_blks` counts index and heap
pages; it was off by 100×.

**THE RULE: the Supabase graph is the authority on bytes. The RANKING from
pg_stat_statements is actionable; its absolute numbers are not.**

**6. A 100%-OF-EXPECTED JOIN IS A BUG, NOT A SUCCESS.** Step 1 returned 100.4%
and that is the only reason a wrong-game grading bug was ever seen. **Print the
ratio, not just the count.**

---

# Phase 6 — CLOSED, measured NO

Ridge margin rating, 13,650 games, refit per season-week with no leakage, 90-cell
sweep. Three benchmarks all negative: vs closing spread (t +0.23), vs opening
spread (t +0.20), and predicting the market's own move (t −0.77).

The high-edge band is recorded rather than buried: monotone 51.59 → 55.00%
across thresholds, balanced by side, sensible by week — but every Wilson interval
spans break-even, **2024 sits at 49.08%**, ROI is +0.74%, and validating it would
need **~80 seasons**. Unfalsifiable at CFB volumes.

**Pre-registered reopening hypothesis: week 5+, |edge| ≥ 16, large spreads. Test
that and nothing else.** Closes the APPROACH, not the sport.

Tooling kept: `build_cfb_training_set.py`, `fit_cfb_ratings.py`,
`sweep_cfb_ratings.py`, `test_cfb_edge.py`, `test_cfb_edge_open.py`,
`test_cfb_high_edge.py`.

---

## health_check, as of 2026-09-13

5 failing, **none of them new breakage**:
- `refreshNbaJob`, `refreshNhlJob` — cold-tier skips, **off-season, expected**.
- `refreshCfbJob` + `harvesterScrapes: cfb` — the parked cfb discovery issue below.
- `databaseGrowth` — see Phase 5. **This is the one worth attention.**

`corpusFreshness` healthy (export ran 0.8h before the check). `workerMemory`
healthy. The laptop was awake, so the usual "corpus and harvester go stale when
the machine is closed" did not apply this time.

---

## PARKED — Scan at phone width

Scan pages overflow a 400px screen (`/mlb` 776px, `/soccer/mls` 837px), found
in R2's sign-off pass. Scan is out of the research-pages plan's scope, so no
R-phase owns it. The player/game/team pages' top bar was fixed in `fcaef2c`;
Scan's own layout was not.

## PARKED — cfb harvester and provider coverage

Deferred at the operator's request; all measured, none urgent.

- **cfb discovery cost FIXED** — was walking all 85 league fixtures at >21s each
  into the 1800s cap. Now filtered via schema.org JSON-LD. **STILL OPEN:** the
  fallback filter only takes 85 → 72 (we track 166 cfb games), so it completes on
  a good day and times out on a slow one. **The real fix is bounded rotation** —
  scrape the N most imminent games per cycle.
- **Blocked/dashed moneylines are silently discarded.** A real cfb page returns
  `{"1": "-", "2": "41.00", "blocked_outcomes": ["1","2"]}`.
  `_parse_decimal_odds("-")` returns None, indistinguishable from a parse
  failure. Count them explicitly.
- **SharpAPI 429s mid-pagination** (page 12, free tier 12 req/min) — the leading
  explanation for cfb's thin game-line coverage. Correlated, **not proven causal**.
- **Propline's absence from cfb is DELIBERATE** and documented in
  `provider_matrix.py`: 1+N requests per cycle means a 178-game slate is ~179
  requests vs SharpAPI's 1. Do not "fix" without redoing that arithmetic.

---

## OPEN ITEMS

- **`refreshTier1` overruns its interval** — 171.75s against 150s, but only on
  the cycle where all five provider throttle windows open at once. Optional fix:
  make the staleness rule `2 × interval + last_run_duration`.
- **`price` holds a copy of `line` on espn_core spread rows** (`line = -30.5,
  price = -30`); zero of 988 are plausible odds. The guard is that a price
  outside ±100…100000 is not a price.
- **`athlete_name` is NULL on every NBA prop row** — all 25,420. `athlete_id`
  joins fine, but any diagnostic built on the prop set prints blank names until
  something backfills them.
- **The corpus refresh and harvester only run while the operator's machine is
  awake.** That is Phase 10 scope ("move OddsHarvester off the laptop") arriving
  early.

---

## STANDING CONSTRAINTS

- **Ask before deploying to Render.** Note `render.yaml` has **`autoDeploy:
  false`**, so `git push` does NOT deploy — pushing is safe and does not need
  permission.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's. Add named files only (`git add docs/CURRENT.md` is fine).
- **Back up before deleting.** `prune_corpus` verifies every row is in the corpus
  by id and content fingerprint before deleting, and refuses while the corpus is
  local-only.
- The Postgres pooler caps at **15 connections** — check for running fits before
  starting DB work.
- Python tests and fits are standalone scripts: `.venv/Scripts/python.exe <file>.py`.
- Corpus reads cost ~300 MB of RAM and are **barred from the Render worker** —
  they run on the operator's machine. `fit_nba_minutes.py` peaks around **850 MB**
  and takes ~25 minutes; it needs no database connection at all (parquet only).
- **Do not pipe a long Python run through `tail`** — it buffers everything and
  you get no output until the process exits. Use `-u` and redirect to a file.
- **At ~92% context, stop and hand off** by rewriting this file.
