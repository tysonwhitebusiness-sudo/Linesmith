# Model data infrastructure — making it a working system going forward

**Written 2026-09-02.** Companion to `docs/model-build-plan-2026-09-02.md`, whose
§2.6 named this problem in one paragraph and did not design the fix. This is the
design.

The question it answers: **once a model is built, what keeps it fed, honest and
improving — without a human running a loader by hand?** Today the answer is
"nothing", and that is not a gap in the plan, it is the plan's largest single
risk.

---

## 1. Measured state — 2026-09-02

The Render worker **is** running. 53 jobs are monitored by `health_check.py`.
**35 are healthy. 18 are not.** That is not a monitoring artifact; each one was
read individually.

### 1a. Six model-input feeders have NEVER RUN

These are not peripheral. Each one feeds a model the build plan depends on.

| Job | Feeds | Consequence of it never running |
|---|---|---|
| `ingestStatcastPitchesJob` | MLB pitch-level Statcast | Phase 4's skill-vs-luck prior has no fresh input |
| `ingestNhlShotsJob` | NHL shot coordinates | Phase 3 needs these to identify empty-net and OT goals |
| `ingestNbaShotsJob` | NBA shot coordinates | Phase 5 loses shot quality |
| `ingestNflPbpJob` | nflverse play-by-play | Phase 7's only route to snap-adjacent context |
| `injurySnapshotJob` | Daily availability | **Cannot be bought retroactively.** Every day it does not run is permanently lost |
| `venueFactorsJob` | Non-MLB venue effects | Home advantage stays a single global constant |

`injurySnapshotJob` is the urgent one. Odds and box scores can be re-sourced
years later — this session did exactly that for MLB 2022-24. Availability
history cannot. It has been in `JOB_REGISTRY` since 2026-09-01 and has produced
nothing.

### 1b. OddsHarvester is fully blocked

All six sport scrapes report the same thing:

```
oddsharvester_scrape_cfb          0 records returned for 177 scheduled game(s) — possible anti-bot block
oddsharvester_scrape_tennis       0 records returned for 1250 scheduled game(s) — possible anti-bot block
oddsharvester_scrape_mlb          0 records for 15 | nfl 0 for 16 | epl 0 for 10 | mls 0 for 29
```

`gameOddsBookLinesFreshness` confirms the downstream effect: **CFB's freshest
book line is 34 hours old**, and OddsHarvester contributed 361 rows in seven
days across everything.

### 1c. Four jobs failing or stale

| Job | State |
|---|---|
| `refreshTennisAtpJob` | **Fails every run** — `CheckViolationError` on `prop_odds_side_valid`: it writes `side='home'` for an `aces` market, which is over/under. WTA is fine |
| `computeMlbGameModelJob` | **Fails every run** — `DataError: invalid input for query argument $2: 140 (expected str, got int)` |
| `refreshSportsGameOddsJob` | Stale — last run **849 minutes** ago against a 180-minute threshold |
| `snapshotCacheSize` | Largest single payload **11.4 MB**, over the 10 MB limit (`mlb:full-raw:2026-09-01`) |

### 1d. Capacity

**5,641 MB of 8,192 MB — 69% full, 2,551 MB of headroom.**

| Table | Size |
|---|---|
| `player_game_history` | 1,730 MB |
| `odds_archive` | 1,116 MB |
| `prop_odds_archive` | 621 MB |
| `mlb_pitch_events` | 448 MB |
| `snapshot_cache` | 334 MB |
| `prop_odds_history` | 323 MB |
| `odds_import_staging` | 270 MB |

`prop_odds` alone took **69,263 rows in the last 24 hours**. Anything this
design adds has to fit in 2,551 MB, and §7 is where that is accounted for.

---

## 2. The core problem: two disconnected worlds

This is the finding that matters most, restated precisely.

```
        WHAT THE LIVE JOBS WRITE              WHAT THE MODELS READ
        ────────────────────────              ────────────────────
        prop_odds            (0.0h ago)       prop_odds_archive   ┐
        game_odds_book_lines (0.0h ago)       odds_archive        │ 100% written
        prop_odds_history                     game_result         ┘ by one import
        injury_report                         player_game_history   (partly fed)

                    ✗ NO PATH BETWEEN THEM ✗
```

Every row in `odds_archive`, `prop_odds_archive` and `game_result` was written
by the 2026-09-01 import. Nothing writes them on a schedule. The only code that
touches `odds_archive` outside the loaders is
`lib/sports/mlb/gameModelBackfill.ts`, itself a backfill.

Three consequences, all fatal to a system that is supposed to improve:

1. **Every model decays from its first day.** It trains on a frozen snapshot and
   is asked about a world that keeps moving.
2. **No backtest can include a game played after 2026-09-01.** The CLV evidence
   base — the only instrument for bar 3 — never grows.
3. **Retraining is pointless.** Re-fitting on identical data produces an
   identical model. The whole "train, measure, improve" loop is inert.

`player_game_history` is the partial exception: `genericPlayerHistoryFreshnessJob`
runs every 30 minutes and is healthy. It is the one training table with a real
forward feed — and even it drops every postseason (§5).

---

## 3. Target architecture

One rule, borrowed from CLAUDE.md's existing convention and extended:
**live tables are the working set; archive tables are the immutable record; one
scheduled job promotes the first into the second.**

```
 PROVIDERS ──▶ JOB_REGISTRY jobs ──▶  prop_odds              ┐
 (ESPN, SGO,                          game_odds_book_lines   │ LIVE
  ParlayAPI,                          injury_report          │ mutable, current
  Propline...)                                               ┘ retention-bounded
                                              │
                                              │  ◀── §4 THE ARCHIVAL BRIDGE
                                              ▼
                                       odds_archive          ┐
                                       prop_odds_archive     │ ARCHIVE
                                       game_result           │ append-only
                                       player_game_history   ┘ the training set
                                              │
                                              ▼
                                       model_game_odds (view)
                                              │
                                              ▼
                              walk-forward · CLV backtest · calibration
                                              │
                                              ▼
                                    model_weights (shadow → live)
```

Nothing above the bridge changes. The provider-job architecture, `ProviderSpec`,
`run_provider_specs`, the cap reservations — all of it already works and is not
in scope here. What is missing is the arrow in the middle.

---

## 4. The archival bridge

Two jobs. Both follow the existing `JOB_REGISTRY` shape, so `health_check.py`
picks them up with no edit of its own.

### 4a. `archiveClosingLinesJob` — every 5 minutes

**The design decision that matters: continuously upsert, do not capture at a
moment.**

The obvious design is a job that fires at each game's `event_start` and snapshots
the price. It is wrong. Games start at arbitrary times, the queue is sequential,
and a worker restart or a slow tick means that game's closing line is **lost
permanently and unrecoverably** — there is no way to go back and ask what the
price was ten minutes before first pitch.

Instead: for every game that has not yet started, keep upserting the current
price. When the game starts, updates stop, and whatever is in the row **is** the
closing line. Nothing has to happen at the right instant.

```sql
INSERT INTO odds_archive
  (sport, event_ref, game_date, event_start, home_team_id, away_team_id,
   market, side, line, price, bookmaker, source, source_priority,
   is_live, booksum, ml_flag, captured_at)
VALUES (...)
ON CONFLICT (sport, event_ref, game_date, market, side, bookmaker, source)
DO UPDATE SET price = EXCLUDED.price, line = EXCLUDED.line,
              booksum = EXCLUDED.booksum, ml_flag = EXCLUDED.ml_flag,
              captured_at = now()
-- THE FREEZE. Postgres enforces it, not application logic: once the game has
-- started this predicate is false and the row can never be overwritten again.
WHERE odds_archive.event_start > now();
```

Properties this buys:

- **Degrades gracefully.** A missed tick makes the close staler, not absent, and
  `event_start - captured_at` measures exactly how stale. A missed *window*
  would have made it absent and unmeasurable.
- **Idempotent by construction.** Re-running writes the same rows.
- **In-play prices cannot contaminate the training set**, by two independent
  mechanisms: the freeze predicate, and `is_live_book()` on the bookmaker name.
  Both, because the 48,489-row in-play finding was invisible in the aggregate
  and cost a whole audit cycle to find.

**Source**: `live_capture`, distinct from every imported source, so archived-live
rows are always separable from imported history. **Priority**: 95 — above
`espn_core` (90) because it is a real captured close, below `sbr` (100).

**Props** follow exactly the same shape, `prop_odds` → `prop_odds_archive`, keyed
on `(sport, event_ref, game_date, athlete_id, type_name, line, source)`.

**Two things it must get right**, both learned the hard way here:
`COALESCE(event_ref,'')` must be in the natural key or doubleheaders silently
collapse (524 games did), and every write must route through `db.write_*` so
`canonical_bookmaker` normalisation happens at the shared writer (33 spellings
for 22 books, `fanduel`/`FanDuel`/`Fanduel` splitting 750 rows three ways).

### 4b. `archiveResultsJob` — every 15 minutes

For any game whose `event_start` passed more than 4 hours ago with no
`game_result` row: fetch the final score, write it. Reuses the scoreboard fetches
the grading jobs already make. Writes `event_start`, `venue`, and — for tennis —
`surface` and `court`, which now exist as columns.

The 4-hour delay is deliberate: it is longer than any sport here runs, so a
score is final rather than in-progress when it lands.

### 4c. A new column: `captured_at`

`odds_archive` and `prop_odds_archive` need `captured_at timestamptz`. It is what
makes capture quality measurable — the distribution of
`event_start - captured_at` is the health metric for the whole bridge, and
without it a systematically-30-minutes-early "close" looks identical to a good
one.

This is the same class of gap as the `event_start` work: the reason the imported
prop archive's "close" is no sharper than its open is precisely that nobody knows
when it was captured.

---

## 5. The postseason fix

Two filters, both meaning *regular season only*:

```python
# backfill_player_game_history.py:592  (NHL)
if g.get("gameType") != 2:              # 2 = regular, 3 = playoffs
# backfill_player_game_history.py:559  (every ESPN sport)
if cfg.espn_regular_only and s.get("type") != 2:
# ...espn_regular_only defaults to True at :79
```

`predict/generic_freshness_job.py` mirrors both by design, so this is the
**ongoing** path and it will drop every postseason again next season.

**The fix**: accept season type 3 and NHL `gameType` 3 in both discovery paths,
then re-run the backfill for affected seasons. Unblocks 43,678 ungradeable props
(NHL 17,092, NBA 25,662, NFL 924) and stops the recurrence.

**Verification, not assumption**: after the fix, NHL `player_game_history` must
reach 2026-06-15 rather than 2026-04-16, and the NHL prop join rate must move off
49.6% toward MLB's 85.9%. If it does not, the filter was not the whole cause.

---

## 6. Monitoring — what has to change

`health_check.py` works, and this audit is evidence: it correctly flagged all six
never-run jobs, both failures, and the stale one. Three gaps remain.

### 6a. A cap-blocked job reports healthy

`health_check.py:105` is `healthy = ok and not stale`. A job that runs on time
and does nothing because its provider budget is exhausted is **healthy** by that
definition. `propline` and `oddsapiio` burn their entire daily cap within 20–70
minutes of the 04:00 UTC reset, so both contribute **zero** prices during US game
hours — and nothing reports it.

**Fix**: add `produced_rows` to the health contract. A job that has written zero
rows across its last N runs while games were scheduled is unhealthy, whatever its
exit status. This is the same shape as the OddsHarvester check, which already
does exactly this ("0 records returned for 177 scheduled games") and is why that
failure is visible at all.

### 6b. Nothing watches the bridge itself

Two new checks, both freshness-style, matching `gameOddsBookLinesFreshness`:

- **`archiveFreshness`** — the newest `captured_at` in `odds_archive` must be
  within one interval. This is the check that would have caught the frozen
  archive on day one instead of an audit finding it a month later.
- **`captureLatency`** — the median `event_start - captured_at` over the last 7
  days, per sport. Alarms if the median close is captured more than 15 minutes
  before start. Measures *quality*, not just presence.

### 6c. Nothing watches the training set's shape

`gate9_model_readiness.mjs` asserts the things that would produce a good-looking
worthless model — no oracle bookmaker, calibration, spread sign, key uniqueness.
It runs by hand. **Make it a scheduled check.** Its assertions are exactly the
ones that break silently as new data arrives from a new source.

---

## 7. Capacity

2,551 MB of headroom, and this design adds to a table that is already 1,116 MB.

**What the bridge costs.** Roughly 60 games/day across all sports × ~20 books ×
~6 (market, side) rows = ~7,200 archive rows/day, plus props at perhaps 10× that.
Because it **upserts rather than appends**, the per-game cost is paid once, not
once per tick — this is a second, independent reason for the continuous-upsert
design. Estimated **under 200 MB/year**, which fits.

**What has to be reclaimed to make room.** Three candidates, in order:

1. **`odds_import_staging` — 270 MB.** A staging table whose contents have all
   been promoted. Truncate after the promotion gates pass.
2. **`prop_odds_history` — 323 MB, and it has no retention rule at all**
   (265,771 rows in a single day). It needs one. But note the interaction: this
   table is the *only* place from which a missed closing line could be
   reconstructed, so its retention window must be **longer than** the bridge's
   replay window (§8), not shorter. Set it deliberately, not by size alone.
3. **`snapshot_cache` — 334 MB**, with a single 11.4 MB payload already over the
   10 MB limit. `retentionJob` is healthy and running; its rules need to cover
   the oversized `mlb:full-raw` keys.

**The data-sales decision blocks none of this.** Retention here bounds the *live*
tables; the archive is append-only and is exactly the asset that has resale
value. Trimming the working set does not touch it.

---

## 8. Replay and rebuild

A pipeline that cannot be rebuilt is a pipeline nobody can safely change.

**Every loader is idempotent by the same contract**: `clear_source(pool, SOURCE,
tables=(...))` deletes that source's own rows before writing. This is not
theoretical — `import_mlb_sbr.py` changed its `event_ref` between runs, the old
rows were a different key, survived `ON CONFLICT DO NOTHING`, and 28,057 offered
rows became 55,756 landed. **A loader that cannot clear its own output is not
idempotent whatever its INSERT says.**

This session hit the same class of bug twice more, which is why it is stated so
plainly: `import_tennis.py`'s clear is behind `--truncate`, so the first re-run
with surface wrote **nothing** — every row hit `ON CONFLICT DO NOTHING` against
the rows already there, and the column stayed 100% NULL while the log cheerfully
reported "56,386 offered".

**Rebuild order**, all reproducible from files and tables on disk:

| Step | Source | Command |
|---|---|---|
| 1 | SBR xlsx 2010-21 | `python import_mlb_sbr.py` |
| 2 | Long CSV 2021-25 | `python import_mlb_long_csv.py` |
| 3 | nflverse / CFBD / football-data | their loaders |
| 4 | tennis xlsx | `python import_tennis.py --truncate` |
| 5 | ESPN props | `python import_props.py --truncate` |
| 6 | live captures | replay from `prop_odds_history` within its retention window |

Step 6 is the one with a horizon. Beyond `prop_odds_history`'s retention, the
archive is the only copy — which is the argument for treating it as
append-only and backing it up separately from the live set.

---

## 9. Rollout order

Each step has a verification that must pass before the next begins. Deploys
require operator approval and are not taken here.

| # | Change | Verified by |
|---|---|---|
| 1 | Fix the two postseason filters; re-run backfill | NHL history reaches 2026-06-15; NHL prop join moves off 49.6% |
| 2 | Add `captured_at` to both archive tables | Migration applies; existing rows NULL, which is correct |
| 3 | `archiveClosingLinesJob` + `archiveResultsJob` | `odds_archive` gains rows with `source='live_capture'` for today's games; freeze predicate blocks a post-start overwrite in a rolled-back transaction |
| 4 | `archiveFreshness` + `captureLatency` checks | Both appear in `health_check.py` output; median capture latency < 15 min |
| 5 | Fix `refreshTennisAtpJob` (`side` for `aces`) | Job goes healthy; ATP prop rows appear |
| 6 | Fix `computeMlbGameModelJob` (int/str `$2`) | Job goes healthy |
| 7 | Start the six never-run feeders | Each reports rows written; `injurySnapshotJob` **first**, it is the only irreplaceable one |
| 8 | Reclaim `odds_import_staging`, set `prop_odds_history` retention | DB below 60%; retention window > replay window |
| 9 | `produced_rows` in the health contract | A deliberately cap-blocked job reports unhealthy |
| 10 | Schedule `gate9_model_readiness` | Runs clean on a schedule |

**Steps 1–4 are the ones the model plan is blocked on.** 5–10 are real and should
happen, but a model can be built and honestly measured once the bridge exists and
is monitored.

**OddsHarvester is deliberately not in this list.** It is fully blocked by
anti-bot measures across all six sports, the fix is not a code change, and every
sport it covers has at least one working provider. It is a degradation, not a
blocker, and it should not hold up the bridge.

---

## 10. How new data actually improves a model

Worth stating, because "ingest more data" is not by itself an improvement loop.

1. **The bridge accumulates real closing lines**, captured at a known time, with
   `captured_at` proving when.
2. **The CLV backtest runs on games the model has never seen** — not a re-split
   of the training set, but genuinely new events. `clvSummaryJob` already runs
   hourly and is healthy; it has simply had nothing new to read.
3. **Refit on a schedule measured in months, not days.** Fitting is a
   multi-hour, human-triggered CLI (`run_walkforward.py`) and deliberately not a
   queue job — the queue's per-job timeout is 10 minutes and one MLB season's
   training set alone takes ~8.5 minutes to build.
4. **A refit ships only if it beats the incumbent on out-of-time CLV**, behind
   the `shadow` flag, which already works and already caught the home-run model
   adding 0.4%.
5. **If it does not beat the incumbent, the incumbent stays.** Recording that is
   the point of the loop, not a failure of it.

The honest summary: **the archive growing is what makes step 2 possible, and step
2 is the only thing that can tell you whether any of this works.** That is why
the bridge is the first thing built and not the last.
