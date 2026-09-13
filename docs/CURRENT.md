# CURRENT — pick up here

**Phases 1–4 COMPLETE. Phase 5 OPEN (monitoring only). Phase 6 CLOSED (measured
NO). Phase 7 ACTIVE — gameplan approved, step 1 is next.**

`docs/master-plan-2026-09-06.md` is the authority on build order. Phase 6 and
Phase 7 both carry **audit notes correcting premises that were measured false** —
read those before trusting any number in a phase brief.

---

## THE ONE HABIT THAT KEEPS PAYING: audit a phase's premises before building

Phase 6 had **four** false premises. Phase 7 has **two**. In both cases a day of
checking saved weeks of building on sand. Every phase brief was written before
Phase 5 moved data into the Parquet corpus, so **any claim about where data
lives is stale by default.**

---

# Phase 7 — NBA — ACTIVE

## Audit, 2026-09-13 — two premises false

| plan says | measured | |
|---|---|---|
| `nba_shot_events` holds 219,873 rows | **219,873** exactly | ✅ |
| possessions from FGA/FTA/TOV/OREB in player rows | all four present | ✅ |
| 100% result coverage | 24,934 games, all scored, 2007–2026 | ✅ |
| "24,705 **priced** games, dense 2008–2019 and 2021–2025" | **5,301 games with odds, ZERO before 2022** | ❌ |
| "props thinnest… 4,480 graded player-games" | **36,335 two-sided, 96.3% gradeable** | ❌ |

```
NBA games WITH ODDS, by season
  2022    538      2024  1,326      2026    834
  2023  1,266      2025  1,337      2007-2021: ZERO
```

**Results are plentiful; PRICES are the scarce thing** — the same shape as CFB,
where 13,659 games had spread *lines* and 75 had real *prices*. A model is
graded against prices.

**THE NBA GAME-LINE CLV GATE CANNOT BE BUILT.** `odds_archive` for nba has
**zero `captured_at` and zero `open_line`** across all 81,023 espn_core rows, so
there is no way to tell when a price was taken and "closing line" is undefined.
A second source (`sbr`, 39,114 rows) has **null `event_ref`** and cannot be
joined to results at all — that is also what produced a misleading 2007 minimum
game_date against zero games per season.

**PROPS ARE THE ONLY PATH WITH A REAL GATE**, which inverts the plan:

```
36,335 two-sided props -> 34,998 joined to a player result (96.3%)
  Total Points                        6,653 props  327 athletes
  Total Rebounds                      5,195        315
  Total 3-Point Field Goals           3,809        264
  Total Points and Rebounds           3,598        304
  Total Assists                       3,546        259
  Total Points, Rebounds and Assists  3,366        293
```

## APPROVED GAMEPLAN (operator approved 2026-09-13)

**Step 1 — Build the prop training set.** Join the 36,335 two-sided props to
player results; ~35,000 rows, ONE season (2025-10-21 → 2026-06-14), 355
athletes. **Gate: de-vig the two-sided prices and compare implied probability to
the realised over-rate.** The market should come out near-calibrated. This is
the same self-validation trick that caught nothing wrong in CFB (residual mean
−0.03 over 13,650 games); if it comes out skewed, the join or the de-vig is
wrong, not the market.

**Step 2 — Build the MINUTES model first.** The plan's own note that "an NBA
prop model is mostly a minutes model" is right: points/rebounds/assists are
roughly rate × minutes and minutes are the volatile part. Possessions from
FGA/FTA/TOV/OREB (all confirmed present in `player_game_history.stats`).

**Step 3 — Rate stats per minute**, combined with projected minutes into a
distribution per prop.

**Step 4 — The edge test**, identical in shape to CFB step 3: does
model-minus-line predict outcome-minus-line? Walk-forward WITHIN the season,
Wilson intervals, −110 break-even (52.38%) drawn on every bucket, pushes
excluded.

**Step 5 — Write the game-line decision.** Not a model — a recorded decision
that NBA game lines have no timing data, so CLV is unmeasurable, and either we
start capturing timestamps going forward or the game model waits.

**Step 6 — Wire into a job**, only if step 4 passes.

**RISK TO STATE UP FRONT: one season is thin.** 36,335 props are ~355 athletes
over one year, heavily correlated within players and within nights. Expect
"promising, needs another season" rather than a clean yes.

---

# Phase 5 — OPEN, monitoring only

Left open at the operator's direction to retest egress over several days rather
than close on one reading.

| ceiling | state |
|---|---|
| database | **CLEARED and SUSTAINABLE** — 42.4%, prune loop closed, runs daily |
| worker RAM | **CLEARED** — 185 MB resting, trending −305 MB over 32h |
| egress | **halved, not yet at target — WATCH THIS** |

```
  before the fixes   ~19.1 GB/day
  2026-09-13          7.051 GB at ~17h  ->  ~10 GB/day projected
  target              <= 8.3 GB/day
```

The graph's shape confirms it: 35–67 GB/day late August, ~19 GB through 07–12
Sep, ~7 on the 13th.

**WHAT TO CHECK:** the Supabase egress graph, over several days. One day is not
a trend and 13 Sep was partly a deploy day. **There is no API token for it — the
operator must look.**

**THE LARGEST REMAINING LEVER, independent of any byte estimate:**
`SELECT fetched_at FROM snapshot_cache` runs **424,958 times/day** — 5 calls a
second, by far the highest call count of anything. It is the blob cache's
validation query. Memoising it in-process for a few seconds would collapse burst
reads of one key into one query, with no staleness risk beyond seconds (the
payload is already versioned by `fetched_at`). **NOT BUILT. Size unknown.**

## What shipped in Phase 5 (all deployed, all gated)

- **blob validation-cache** — `read_snapshot`/`read_snapshot_with_age` ask
  Postgres only for `fetched_at` and serve the payload from local disk when the
  stamp matches. **99.5% hit rate in production.** Disk, not memory, to protect
  the RAM ceiling.
- **prop archive server-side** — `INSERT … SELECT`; 36,361 rows, 7 sports, 0
  mismatches.
- **closing-lines archive server-side** — 2,104 rows, 0 mismatches, 6.62s on the
  worker.
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
- **corpusFreshness heartbeat** — `refresh_corpus` now writes
  `job_health_checks['corpus_refresh']`; the check reads it. The old alarm sat
  BELOW the floor of normal operation (250k threshold vs ~407k rows per cycle)
  and went red every cycle regardless of health.

---

## MEASUREMENT LESSONS — read before measuring anything

**1. A SHORT WINDOW CANNOT PROVE A QUERY IS DEAD.** A query running 73×/day
appears **0.35 times** in 420 seconds. On that basis a query was declared dead;
it was the largest line on the bill.

**2. A MINIMUM-CALL THRESHOLD DOES NOT CATCH A BURSTY JOB.** A burst produces
many calls in a short span — the same signature as a high steady rate. A 600s
window reported 99M rows/day for a query whose lifetime rate is 7.4M. **Cross-
check window rate against lifetime rate (`rows / stats_since`); disagreement
>3× means discard the window figure, not average it.**

**3. THE WIDTH MODEL FAILS IN BOTH DIRECTIONS.** Flat 109 B/row said 4.08
GB/day (undercounts JSONB `stats` rows at ~600 B); per-table width said 24.63
(charges `SELECT fetched_at` the full 39,510 B `snapshot_cache` row for an
8-byte timestamp). The graph said ~10. **A correct estimator needs
SELECTED-COLUMN widths. Nobody has built one.**

**4. psutil WIRE MEASUREMENT FAILS BELOW A FEW MB.** `SELECT 1` measured at
19,417 B/call, which is impossible — `net_io_counters` sees all machine traffic
and 500 queries take ~30s. It worked for a 4,173-row query where payload
dominated.

**5. BLOCKS TOUCHED ARE NOT BYTES SENT.** `shared_blks` counts index and heap
pages; it was off by 100×.

**THE RULE: the Supabase graph is the authority on bytes. The RANKING from
pg_stat_statements is actionable; its absolute numbers are not.**

---

# Phase 6 — CLOSED, measured NO

Ridge margin rating, 13,650 games, refit per season-week with no leakage, 90-cell
sweep. Three benchmarks all negative: vs closing spread (t +0.23), vs opening
spread (t +0.20), and predicting the market's own move (t −0.77, mildly
anti-correlated).

The high-edge band is recorded rather than buried: monotone 51.59 → 55.00%
across thresholds, balanced by side, sensible by week — but every Wilson interval
spans break-even, **2024 sits at 49.08%**, ROI is +0.74%, and validating it would
need **~80 seasons**. Unfalsifiable at CFB volumes.

**Pre-registered reopening hypothesis: week 5+, |edge| ≥ 16, large spreads. Test
that and nothing else.** Closes the APPROACH, not the sport — reopening needs
new features, not a re-fit, the same rule as tennis.

Tooling kept: `build_cfb_training_set.py`, `fit_cfb_ratings.py`,
`sweep_cfb_ratings.py`, `test_cfb_edge.py`, `test_cfb_edge_open.py`,
`test_cfb_high_edge.py`.

---

## PARKED — cfb harvester and provider coverage

Deferred at the operator's request; all measured, none urgent.

- **cfb discovery cost FIXED** — was walking all 85 league fixtures at >21s each
  into the 1800s cap. Now filtered via schema.org JSON-LD from the league page.
  **STILL OPEN:** the fallback filter only takes 85 → 72 (we track 166 cfb
  games), so at 12–21s/page it completes on a good day and times out on a slow
  one. **The real fix is bounded rotation** — scrape the N most imminent games
  per cycle; the task fires every ~20 min so the slate still gets covered.
- **Blocked/dashed moneylines are silently discarded.** A real cfb page returns
  `{"1": "-", "2": "41.00", "blocked_outcomes": ["1","2"]}` — books will not
  price an FBS-vs-FCS mismatch two-way. `_parse_decimal_odds("-")` returns None,
  indistinguishable from a parse failure. Count them explicitly.
- **SharpAPI 429s mid-pagination** (page 12, free tier 12 req/min), which is the
  leading explanation for cfb's thin game-line coverage. Correlated, **not proven
  causal**.
- **Propline's absence from cfb is DELIBERATE** and documented in
  `provider_matrix.py`: 1+N requests per cycle means a 178-game slate is ~179
  requests vs SharpAPI's 1. Do not "fix" without redoing that arithmetic.

---

## OPEN ITEMS

- **`refreshTier1` overruns its interval** — 171.75s against 150s, but only on
  the cycle where all five provider throttle windows open at once (most cycles
  it finishes in ~2.5s). The red I originally flagged was caused by my own
  deploy restarts. Optional improvement: make the staleness rule
  `2 × interval + last_run_duration`.
- **`price` holds a copy of `line` on espn_core spread rows** (`line = -30.5,
  price = -30`); zero of 988 are plausible odds. Phase 9 sourcing already lists
  "implausible price excluded with a test" — the guard is that a price outside
  ±100…100000 is not a price.
- **The corpus refresh and harvester only run while the operator's machine is
  awake.** 3 missed corpus runs and 3 stale harvester sports were both just the
  laptop being closed. That is Phase 10 scope ("move OddsHarvester off the
  laptop") arriving early.

---

## STANDING CONSTRAINTS

- **Ask before deploying to Render.** (The operator granted blanket API-deploy
  permission for the 2026-09-12/13 egress work specifically; that does not carry
  forward.)
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **Back up before deleting.** `prune_corpus` satisfies this by verifying every
  row is in the corpus by id and content fingerprint before deleting, and
  refusing outright while the corpus is local-only.
- The Postgres pooler caps at **15 connections** — check for running fits before
  starting DB work.
- Python tests are standalone scripts: `.venv/Scripts/python.exe <file>.py`.
- Corpus reads cost ~300 MB of RAM and are **barred from the Render worker** —
  they run on the operator's machine (`refresh_corpus`, `build_history_prefix`,
  and all Phase 6/7 fitting).
- **At ~92% context, stop and hand off** by rewriting this file.
