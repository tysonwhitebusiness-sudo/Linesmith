# Model build plan — infrastructure and models, one sequence

**Written 2026-09-02.** Supersedes the sequencing in `docs/model-rebuild-plan.md`
§7; that document's §1 (the four bars) and §5 (the two-system split) still
govern. Absorbs and replaces `docs/model-infrastructure-2026-09-02.md`.

This is **the** plan: every model, every piece of infrastructure those models
need, and the surface that renders them, in one ordered sequence. Infrastructure
is not a separate track — each piece sits at the point where something actually
needs it, because a plan you abandon halfway to go run a different plan is how
steps get skipped.

The locked model choices come from two artifacts the operator approved on
2026-09-01 and are reproduced here rather than re-argued:

- Game models — `https://claude.ai/code/artifact/edaa8640-b66f-4ec5-9e2c-99f11f0ad4c8`
- Prop models — `https://claude.ai/code/artifact/56c16cd2-99d5-429c-a93b-99e39cc88833`

**Scope, stated plainly.** In: all seven sports' game models, all four viable
sports' prop models, the archival bridge, the six never-run feeders, monitoring,
capacity, entity/market canonicalisation, the replay procedure, and the UI that
surfaces the output. Out, deliberately and with reasons in §3 *Not scheduled*:
golf, CFB and soccer props, buying data, OddsHarvester, and a Render deploy.

---

## 0. Pre-flight audit — read this before anything else

Two audits on 2026-09-02: one of every table these models would read, one of the
running system. Both found real problems.

### 0.1 A counting trap — the recorded counts were already right

**`CURRENT.md`'s numbers are correct and this audit confirms them.** The trap is
recorded because it caught this audit and will catch the next one.

`event_ref` is **NULL** for the SBR (NBA/NHL) and football-data (EPL/MLS)
sources — 0.0% populated against 100% everywhere else. Counting games as
`DISTINCT (event_ref, game_date)` collapses each season to its distinct *dates*:
NBA 2013 comes back as 209 games when it is 1,323. The error is silent, passes
every structural check, and looks like a plausible answer.

**Use `DISTINCT (game_date, home_team_id, away_team_id)`** for any per-game count
spanning sources. Confirmed at that key:

| Sport | Moneyline | Spread | Total | Dense seasons |
|---|---|---|---|---|
| MLB | **31,780** | 22,013 | 31,778 | 2010–2026 (continuous, see 0.6) |
| NBA | **24,705** | 24,700 | 24,701 | 2008–2019, 2021–2025 |
| NHL | **24,336** | 15,947 | 24,336 | 2008–2019, 2021–2025 |
| CFB | 4,017 | **13,569** | 13,065 | 2021–2025 |
| NFL | 5,355 | **7,336** | 7,336 | 2006–2025 |
| MLS | **6,397** | 871 | 871 | 2012–2026 |
| EPL | **4,200** | 400 | 400 | 2016–2025 |

Two structural checks pass cleanly: **rows per game is exactly 2.00** on every
two-way moneyline and total (3.00 for soccer moneyline — the draw), so no market
carries a duplicated or missing side; and **96.7%–100% of priced games reach a
result**.

### 0.2 No postseason game has ever entered `player_game_history`

Two filters, one per discovery path, both meaning *regular season only*:

```python
# backfill_player_game_history.py:592  (NHL)
if g.get("gameType") != 2:        # 2 = regular season, 3 = playoffs
    continue
# backfill_player_game_history.py:559  (every ESPN sport)
if cfg.espn_regular_only and s.get("type") != 2:
    continue
# ...and espn_regular_only defaults to True (line 79)
```

`predict/generic_freshness_job.py` mirrors both by design — its docstring says it
uses "the same completed/regular-season filters". So this is the **ongoing**
ingest path, not a stale backfill, and it will drop every postseason again next
season.

| Sport | History ends | Odds end | Gap | Priced games with no history |
|---|---|---|---|---|
| NHL | 2026-04-16 | 2026-06-15 | 60d | 172 |
| NBA | 2026-04-13 | 2026-06-14 | 62d | 91 |
| NFL | 2026-01-05 | 2026-02-08 | 34d | 129 |

**43,678 props can never be graded** — NHL 17,092, NBA 25,662, NFL 924. It is
also most of why NHL props join to an outcome at only 49.6% where MLB reaches
85.9%. And it biases what remains: playoff hockey and basketball have different
rotations, pace and intensity, and they are systematically absent.

Fixed in **Phase 0**.

### 0.3 The training archive is frozen — new games never enter it

```
odds_archive        1,587,670 rows   100% written in the last 24h   (the import)
prop_odds_archive   1,805,340 rows   100% written in the last 24h   (the import)
game_result           172,647 rows   100% written in the last 24h   (the import)

prop_odds             253,716 rows   written 0.0h ago               (live jobs)
game_odds_book_lines    8,995 rows   written 0.0h ago               (live jobs)
```

Every row in the three training tables arrived in one import. Nothing writes them
on a schedule — the only code touching `odds_archive` outside the loaders is
`lib/sports/mlb/gameModelBackfill.ts`, itself a backfill. Meanwhile the
`JOB_REGISTRY` provider jobs run fine and write to two tables **no model reads**.

Three consequences, all fatal to a system meant to improve:

1. **Every model decays from its first day.** It trains on a frozen snapshot and
   is asked about a world that keeps moving.
2. **No backtest can include a game played after 2026-09-01.** The CLV evidence
   base — the only instrument for bar 3 — never grows.
3. **Retraining is pointless.** Re-fitting identical data produces an identical
   model.

`player_game_history` is the partial exception: `genericPlayerHistoryFreshnessJob`
runs every 30 minutes and is healthy. It is the one training table with a real
forward feed — and even it drops every postseason (0.2).

Fixed in **Phase 1**.

### 0.4 The running system: 53 jobs monitored, 18 unhealthy

The Render worker **is** running. Each of the 18 was read individually.

**Six model-input feeders have never run once.** Each feeds a phase below.

| Job | Feeds | Scheduled in |
|---|---|---|
| `injurySnapshotJob` | Daily availability | **Phase 0** — cannot be bought retroactively |
| `ingestNhlShotsJob` | NHL shot coordinates | Phase 4 — empty-net and OT detection |
| `ingestStatcastPitchesJob` | MLB pitch data | Phase 5 — the skill-vs-luck prior |
| `ingestNbaShotsJob` | NBA shot coordinates | Phase 6 |
| `ingestNflPbpJob` | nflverse play-by-play | Phase 8 |
| `venueFactorsJob` | Non-MLB venue effects | Phase 1 (cheap, no dependency) |

**OddsHarvester is fully blocked.** All six sport scrapes return zero records
against real scheduled games — `cfb` 0 for 177, `tennis` 0 for 1,250, and so on;
an anti-bot block. `gameOddsBookLinesFreshness` confirms the effect: CFB's
freshest book line is **34 hours old**.

**Four jobs failing or stale:**

| Job | State | Fixed in |
|---|---|---|
| `refreshTennisAtpJob` | Fails every run — `CheckViolationError` on `prop_odds_side_valid`: writes `side='home'` for an `aces` market, which is over/under. WTA is fine | Phase 2 |
| `computeMlbGameModelJob` | Fails every run — `DataError: invalid input for query argument $2: 140 (expected str, got int)` | Phase 5 |
| `refreshSportsGameOddsJob` | Stale — last run **849 minutes** ago against a 180-minute threshold | Phase 1e |
| `snapshotCacheSize` | Largest payload **11.4 MB**, over the 10 MB limit | Phase 1e |

### 0.4b The odds pipeline is running at a fraction of what it pays for

Audited 2026-09-02 from code and live tables — **`docs/odds-sources-2026-09-02.md`
holds the full sport-by-sport table and the verification commands.** What it
changes for this plan:

- **NFL, CFB and NBA have no live odds at all**, and CFB has 96 games in the
  current window. Their providers are wired correctly in `jobs.py` but disabled
  at runtime: **five provider KEYS are required by `config.py` and undeclared in
  `render.yaml`**, four of which exist in `.env.local`. `env_bool` defaults to
  True, so the `*_ENABLED` flags are harmless — it is `and bool(KEY)` that gates.
  Those providers work on the operator's machine and are silently off on the
  worker. Live spend confirms it: all four last recorded spend **2026-08-21**.
- **NHL has no odds job at all** — not broken, never built.
- **SharpAPI is wired to 2 of 8 sports** despite covering all eight and being the
  only provider with no budget ceiling. Probed live: `football/ncaaf` and
  `tennis/atp|wta` both return real props and game lines, contradicting the old
  capability matrix in four places.
- **ParlayAPI cannot produce game lines** — props only. So for NFL/CFB/NBA the
  single game-line producer is `sportsgameodds_multisport`, and its missing key
  removes game lines with no second path.

This matters to Phase 1 directly: **the archival bridge reads
`game_odds_book_lines`, and for four sports there is nothing in it to archive.**
A bridge built before the pipeline is restored would capture MLB, soccer and
tennis and silently skip the rest.

### 0.5 Capacity

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

`prop_odds` alone took 69,263 rows in 24 hours. Reclaim is scheduled in Phase 1e.

### 0.6 Resolved 2026-09-02 — MLB 2022–2024 now has raw prices

This section originally concluded the three missing seasons could never support
EV or CLV, because `historical_odds` holds them already de-vigged (summing to
exactly 1.0000). **That was wrong.** The de-vigging happens in
`lib/sports/mlb/historicalOddsIngest.ts` on the way *in*, and the source CSV was
on disk at `data/historical-odds-import/mlb_games_odds_2021_2025_all_books_long.csv`
— 205,475 rows, raw American prices per book for six books, zero nulls on any
close price, 100% with a final score, and `start_date_utc` for a real
`event_start`.

`python-odds-service/import_mlb_long_csv.py` loads it at source priority 85 —
below `espn_core` (90) and `sbr` (100), so it is purely additive where a price
already existed. **2022 gains 2,384 games, 2023 2,430, 2024 2,428.** It also
brings a **two-sided priced run line**, which the ESPN rows are not (0.7).

Verified against the overlap years and against outcomes: `espn_core` corr
**0.9288** / mean-abs-diff **0.0191**, `sbr_mlb` 0.8113 / 0.0319, and on the
newly-filled seasons the de-vigged price tracks the realised home win rate inside
1.5pp in every populated bucket (0.490 → 0.475, 0.632 → 0.631, 0.703 → 0.717).

Two limits, both measured: **no doubleheaders** (~2% of a season's second games
absent) and it stops at 2025.

### 0.7 ESPN spread rows carry only the home side

| Sport | Source | Sides stored | Prices |
|---|---|---|---|
| MLB | sbr_mlb + mlb_long_csv | home + away | two-sided |
| NHL | sbr | home + away | 9,485 / 9,486 |
| NFL | nflverse | home + away | 5,407 / 7,388 |
| **NBA** | espn_core + sbr | **home only** | 18,214 of 56,668 |
| **EPL / MLS** | espn_core | **home only** | 400 / 870 |
| **CFB** | cfbd | home + away | **zero prices — lines only** |

Totals are unaffected — ESPN stores both `over` and `under`. It is specific to
spread. Where one side is missing **the spread cannot be de-vigged**, so NBA,
EPL, MLS and CFB spread models are judged against the posted line and a single
price, not a fair two-way probability.

### 0.8 Resolved 2026-09-02 — tennis surface is loaded

The approved model is **surface-weighted Elo**, and surface was in no table. It
was in the tennis-data.co.uk workbooks the whole time, on **100% of 57,386
matches** — Hard 33,850, Clay 16,729, Grass 6,807, plus `Court` Outdoor 50,295 /
Indoor 7,091. `import_tennis.py` dropped both deliberately and said why in its
own docstring: *"there is no column for them in either shared table"* — which
named the fix it was waiting for.

Migration `20260902120000` adds `surface` and `court` to **`game_result`**, beside
`venue`: surface is a property of the event, not of a price, so on `odds_archive`
it would repeat across 448,914 rows instead of 56,386. `model_game_odds` already
joins `game_result`, so the model reads it through a join it already does.

Verified three ways, because a populated column is not a correct one. The extremes
are real specialists (Medvedev hard .732 / clay .558; Delbonis clay .531 / hard
.286). A permutation control preserving the true 59/29/12 marginal gives a mean
clay-hard gap of 0.0516 against the real 0.0767. And decisively: a player's
clay-vs-hard gap **before** 2021 correlates **0.5262** with the same player's gap
**after** 2021, across 38 players. A mislabelled join cannot persist across years.

### 0.9 Market names need canonicalising

| Sport | Distinct `type_name` | Markets carrying 90% of volume |
|---|---|---|
| MLB | 36 | 22 |
| NBA | 41 | 11 |
| NFL | 70 | 23 |
| NHL | 20 | 11 |

A prerequisite for training any prop model across sources. The head is short:
**11 markets cover 90% of NBA and NHL.** Scheduled in Phase 4, before the first
prop model.

### 0.10 Confirmed present and good

- **`player_game_history`: 2.80M rows**, 9 sports — MLB 727,613 / NHL 724,002 /
  NBA 279,661 / CFB 274,207 / NFL 226,629 / EPL 168,773 / tennis 264,448 /
  MLS 134,349.
- **Stat keys are sufficient** for every model below: MLB has full
  plate-appearance batting and pitching; NHL has `toiMinutes` on 100% of rows
  plus `sog`, `goals`, `saves`, `isGoalie`; NBA has `minutes` and every counting
  stat; NFL has 57 keys including all `passing.*`, `receiving.receivingTargets`
  and `rushing.rushingAttempts`.
- **Props reaching a graded outcome**: MLB 1,083,266 (85.9%), NBA 183,408
  (86.4%), NFL 147,241 (93.9%), CFB 39,751 (88.3%), EPL 36,082 (56.5%), NHL
  34,171 (49.6%, and 0.2 explains the shortfall).
- **The harness exists** — `predict/walkforward.py`, `predict/clv_backtest.py`,
  `predict/platt_calibration.py`, `predict/model_benchmark.py`,
  `run_walkforward.py` and the `shadow` flag. It produced every measurement in
  `model-rebuild-plan.md`.

### 0.11 Confirmed absent — do not plan around these

- **NFL/CFB snap counts** — 57 NFL keys, none measure snaps. Targets and carries
  are the better exposure measure for the markets that trade (Phase 8).
- **Soccer minutes** — `isStarter`, `subIns`, `appearances` only.
- **Tennis serve data** — no aces, double faults or first-serve percentage.
- **MLS prop crosswalk** — 4.5% joinable, 60 athletes. MLS props are out of scope.

---

## 1. The standard

1. **Graded** — it predicts something that gets settled against a real outcome.
2. **Beats the base rate** for that market.
3. **Beats the market price, out-of-time.** The only bar that matters commercially.
4. **Calibrated** — when it says 60%, 60% happens, checked in buckets.

Three non-negotiables:

- **Market probability is never a feature.** The old MLB moneyline model's
  largest coefficient was `marketProbCentered` at 3.5170, which is why it tied
  the market and reported edge that was its own noise.
- **The thing that decides whether a model ships is not the thing that fitted
  it.** Walk-forward, out-of-time, no exceptions.
- **Everything ships behind the `shadow` flag** until it clears bar 3 on held-out
  data. That flag already caught the home-run model adding 0.4% and kept it off
  the page with no human involved.

**One calibration on bar 3 for props.** Measured on 235,210 graded MLB props, the
archive's closing price is *not* sharper than its opening price — Brier 0.2020
close against 0.2013 open, across every market tested. Beating this close is a
**softer bar** than beating an NFL sides close and must not be reported as
equivalent. It also means line movement is a weak prop feature: 69% of prices
moved and the movement predicted nothing.

---

## 2. Three engines and one harness

Seven sports, three pieces of machinery. The phases below are mostly
configuration of this section.

| Engine | What it does | Sports |
|---|---|---|
| **Scoring-rate** | Attack/defence ratings; probability of every scoreline | EPL · MLS · NHL · MLB |
| **Margin** | Team strength in points, predicting the score difference | NBA · CFB · NFL |
| **Head-to-head** | One rating per competitor, updated after each result | Tennis |

**The training-set builder.** One function per sport returning *(game, features,
outcome, closing price)* with a hard as-of guarantee: **every feature computed
only from games that finished before the modelled game started**. `event_start`
now exists on all four tables, which is what makes this checkable rather than
assumed. The leakage guard is not optional and already has a test to extend
(`test_leakage_guard.py`) — the generic-sports job once built "predictions" from
game logs that already contained the outcome.

**The walk-forward harness.** Expanding window: fit on seasons 1..n, predict n+1,
roll forward. Measured cost, from `run_walkforward.py`'s own docstring: **one MLB
season's training set takes ~8.5 minutes**, so a full 16-season run is a
multi-hour operation. It is deliberately not in `JOB_REGISTRY` — the queue's
per-job timeout is 10 minutes — and stays a human-triggered CLI. Do not try to
schedule fitting.

**The CLV backtest.** `predict/clv_backtest.py`. For every pick, compare the
price available when the pick was made against the close. This is the bar-3
instrument, and it needs roughly **hundreds** of bets to detect a real edge
against roughly **10,000** for a raw ROI measurement — the whole argument for
judging on CLV rather than profit.

**Calibration.** `predict/platt_calibration.py`, fitted on a held-out slice,
never the training fold. Reported in buckets, never as an average — an average
can be perfect while every band is wrong in alternating directions, which is
exactly what the old prop model did saying 0.93 and delivering 0.686.

**The ship gate.** A model leaves `shadow` only when, on data it never saw, it
clears bars 1, 2 and 4, **and** clears bar 3 over a sample reported with its own
size, **and** — for props — passes the rank-correlation check in §4. Failing to
ship is a real outcome and gets written down.

**What gets deleted** (from `model-rebuild-plan.md` §6, unchanged): every row of
`model_weights` and `model_calibration`, the `edge_model` / `prop_score` /
`good_bets` / `live_edge` scoring layer, the generic six-sport prop pipeline, and
golf's model layer. Nothing a user can see breaks — the edge badge already
returns null, confidence is hardcoded null, the score grade renders an empty div.

---

## 3. The sequence

One ordered list, in two blocks. **Phase 1 fixes the entire odds system and is
finished before any model work begins** — an operator decision on 2026-09-02, and
the right one: every model downstream trains on what that phase produces, and the
archival bridge has nothing to archive for four sports until it lands. Phases 2–8
are the models, each carrying the model-input feeder it needs. Phase 9 surfaces
them.

Build order merges the two approved orders, which differ — the game artifact said
tennis → soccer → NBA, the prop artifact MLB → NHL → NFL → NBA. The merge groups
**by engine**, so each is built once and pointed at its second sport immediately,
and so MLB's game model precedes the props that fall out of it. **Flagged as a
deviation for approval**, since neither approved order is followed exactly.

---

### Phase 0 — Stop the bleeding

No model work. Two items, both losing data every day they wait.

**0a. `injurySnapshotJob`.** The only genuinely irreversible item in this
document. Odds and box scores can be re-sourced years later — this session did
exactly that for MLB 2022–24. **Availability history cannot be bought back at any
price.** It has been in `JOB_REGISTRY` since 2026-09-01 and has produced nothing.

**0b. The postseason filters.** Accept season type 3 and NHL `gameType` 3 in both
discovery paths (`backfill_player_game_history.py:559` and `:592`), then re-run
the backfill for affected seasons.

> **Verify, don't assume:** NHL `player_game_history` must reach 2026-06-15
> rather than 2026-04-16, and the NHL prop join rate must move off 49.6% toward
> MLB's 85.9%. If it does not, the filter was not the whole cause.

---

### Phase 1 — The odds system

**Operator decision 2026-09-02: the entire odds system is fixed before any model
work begins.** The reasoning is the plan's own: Phase 1's archival bridge reads
`game_odds_book_lines`, and that table is **empty for NFL, CFB, NBA and NHL**.
A bridge built first would faithfully archive MLB, soccer and tennis and silently
skip half the project. Every model downstream inherits whatever this phase
produces, so it is finished — and verified — before Phase 2 starts.

Full detail, measurements and verification commands live in
`docs/odds-sources-2026-09-02.md`. What follows is the sequence and its gates.

#### 1a. Stop the daily burn — `job_tier1` cadence

`refreshTier1` demands **~18× Propline's entire daily budget every day**:
`fetch_propline` issues 1 + 2N requests, the job runs every 2.5 minutes (576
cycles/day), and a 15-game slate makes that 17,856 requests against a 1,000 cap.
The cap is gone in ~80 minutes and Propline contributes nothing for the other 23
hours.

- **Cache the `/markets` list** — half of Propline's spend, no behaviour change.
- **Route `job_tier1` through `gameday.should_fetch_paid_providers()`** — every
  other paid job already does; this is the only one that does not, and it is the
  one where Propline runs.
- **Give Propline its own cadence** so it stops inheriting SharpAPI's. An
  uncapped provider and a daily-capped one cannot share an interval.

Cheapest, highest-value step in the phase, and it needs no operator action.

#### 1b. Render keys — operator action

Five provider KEYS are required by `config.py` and undeclared in `render.yaml`;
four exist in `.env.local`. Plus the five `PARLAYAPI_*_SOFT_CAP` values, also
undeclared, so the 20% margin task 5.9 built **does not exist on the worker**.
Until this lands, NFL/CFB/NBA have no live odds at all.

#### 1c. The capability matrix

Replace the five hand-written per-sport spec builders with one declared table of
`(provider, sport) → vendor tokens`. Six providers across eight sports would
otherwise be 48 hand-written spec constructions — the exact duplication that let
two of four jobs ship with no rate-limit check. **Adding a sport becomes a
column; adding a provider becomes a row.**

#### 1d. Widen coverage onto what is already paid for

Measured utilisation: SharpAPI 2 of 8 sports, The Odds API 1 of 8, Propline 3 of
a 54-sport catalogue, and `_SGO_LEAGUE_IDS` omits NHL although SGO serves it.

- **SharpAPI to all 8 sports** — the only uncapped provider (12/min, no daily
  cap), covering every sport with both props and game lines. It becomes the
  polling floor under everything.
- **Propline 3 → 8**, **NHL into `_SGO_LEAGUE_IDS`**, **The Odds API beyond MLB**.
- **Build `refreshNhlJob`** — NHL is the one sport with no odds job at all.

#### 1e. Deduplicate before consensus — do this before widening lands

Six providers returning DraftKings means six DraftKings rows for one game.
Averaged naively, DraftKings is weighted six times and **every de-vigged
consensus is wrong**, silently. Measured: the union is 19 prop books and 23
game-line books, against 32 and 37 summed — so 13 and 14 are duplicates.

> **One row per `(sport, event, market, side, bookmaker)` for consensus**,
> collapsing by `source_priority`. Keep every provider's row for provenance.
> `model_game_odds` already does exactly this — extend it, do not invent a
> second pattern.

Ordered before 1f deliberately: widening without it produces a consensus *more*
wrong than today's.

#### 1f. Key pools and the proximity scheduler

**Key pools, not per-sport keys.** All five ParlayAPI keys return the identical
405-sport catalogue — a key is quota, not coverage. Per-sport labelling strands
it: NFL's key exhausts while CFB's sits idle and NFL goes dark anyway. Pool them,
first-with-remaining-quota wins, each keeping its own `provider_id` so
`try_reserve_daily`/`monthly` work unchanged. Proven safe: on 2026-08-30
`propline` and `propline_2` each spent 1,000 the same day from the same worker.

**Cadence follows game proximity, not a clock** (decided; see
`odds-sources-2026-09-02.md` §15 for why a clock was rejected). Each provider
declares a budget; the scheduler spreads it proportionally to where games
actually are. Measured limits:

| Provider | Budget | Role |
|---|---|---|
| SharpAPI | none — 12/min, **5 concurrent** | Continuous polling floor, all 8 sports |
| Propline | 1,000/day, resets 00:00 UTC | Hot-window sweeps — it carries the books |
| ParlayAPI | 1,000/month ≈ 33/day | **Last 3 ticks before each start cluster** — depth at the close |
| The Odds API | **500/month ≈ 16/day** | Scarcest in the stack — reserved, not spread |

#### 1g. Monitoring that would have caught this

- **`produced_rows` in the health contract.** `healthy = ok and not stale` let
  `refreshNflJob` and `refreshCfbJob` report healthy for **twelve days** while
  producing nothing.
- **`gameday.skip_summary()` must stop returning a successful run shape.** A job
  that never fetches must be distinguishable from one that fetched.
- **`archiveFreshness` and `captureLatency`** — the checks that would have caught
  the frozen archive on day one.
- **`probe_all_providers.py` as a scheduled gate** — fail when a declared
  `(provider, sport)` pair stops resolving. A vendor renaming a league becomes a
  failing check rather than a sport going dark.

#### 1h. The archival bridge

Only now, because it archives what 1a–1g produce.

**Upsert continuously; do not capture at a moment.** A job firing at each game's
`event_start` loses that game's closing line permanently on one missed tick.
Instead keep upserting while the game has not started; when it starts, updates
stop and whatever is in the row **is** the close.

```sql
ON CONFLICT (sport, event_ref, game_date, market, side, bookmaker, source)
DO UPDATE SET price = EXCLUDED.price, line = EXCLUDED.line,
              captured_at = now()
-- THE FREEZE. Postgres enforces it, not application logic.
WHERE odds_archive.event_start > now();
```

Degrades gracefully, idempotent by construction, and blocks in-play
contamination by two independent mechanisms (the freeze predicate and
`is_live_book()`). Cheaper too — upserting pays the per-game cost once, not once
per tick, which keeps it under ~200 MB/year against 2,551 MB of headroom.

Plus `archiveResultsJob` (settled scores, 4h after start), a `captured_at`
column on both archive tables, and `event_start` populated for **all eight
sports** — currently MLB only, and also what the proximity scheduler in 1f needs.

While here: truncate `odds_import_staging` (270 MB, already promoted), give
`prop_odds_history` a retention rule **longer than the replay window**, cover the
oversized `mlb:full-raw` snapshot keys, and start `venueFactorsJob`.

---

### The gate out of Phase 1

**Run `python scripts/gate/gate10_phase1_odds.py`.** It is executable, not a
checklist, so "Phase 1 is done" is a measurement rather than a claim — and it is
expected to FAIL until 1f lands, which is how it defines done.

1. **Every (provider, sport) the vendor supports is activated.** Compares what we
   CALL against what the vendors' own catalogues SUPPORT. A cell may be excused
   only with a stated reason — SGO genuinely serves no EPL and no tennis; there
   is no `PARLAYAPI_NHL_KEY` — so "not wired" stays distinguishable from "cannot
   be wired". Nothing compared these two before, which is how NFL and CFB ran
   with no provider for twelve days behind green health checks. *On its first
   run this caught a real gap nobody had noticed: ParlayAPI serves MLB and
   `PARLAYAPI_MLB_KEY` was set, but MLB's row never called it.*
2. **Keys are pooled, not labelled by sport.** No `provider_id` may encode a
   sport, and a `KEY_POOLS` declaration must exist. All five ParlayAPI keys
   return the identical 405-sport catalogue, so a key is a budget bucket, not a
   coverage grant — labelling one `PARLAYAPI_NFL_KEY` strands its quota when NFL
   is quiet and starves NFL when it is not.
3. **Every sport has fresh book lines** in the last 24h from a
   non-OddsHarvester source.
4. **The bridge is running and capturing near the close** — `live_capture` rows
   exist and median `captured_at → event_start` is **under 15 minutes** per
   sport. Presence is not quality: a price captured six hours early is archived,
   fresh, and not a closing line.
5. **No provider is over its measured cap** — measured from vendor headers, not
   config defaults.

Plus `gate9_model_readiness.mjs` on the widened data.

---

### Phase 2 — Tennis · surface-weighted Elo

**Why first among models.** Simplest engine, most matches, fewest moving parts.
It proves the whole chain — fit, walk-forward, calibrate, compare to the close —
on the easiest possible case before that chain is trusted anywhere harder. And it
trains entirely on data already in the database.

**Simply.** Elo is the chess rating. Everyone starts at 1500; beat someone
stronger and you gain a lot, lose to someone weaker and you drop a lot. The gap
between two ratings converts to a win probability. It suits tennis better than
any sport here because a match is *only two players* — no lineup, no teammates,
no coach — so a single number really can describe a competitor.

**In detail.** After each match, `R_new = R_old + K·(S − E)`, where
`E = 1 / (1 + 10^((R_opp − R)/400))`. Ratings are kept per surface AND overall,
and the number used for a prediction is a blend of the two — clay and grass are
close to different sports, and one rating averaged across them is wrong in both
directions.

#### Verified data (re-measured 2026-09-04, not carried from the audit)

| | |
|---|---|
| Matches | **56,386** — 29,119 ATP / 27,267 WTA, 2015-01-04 → 2026-08-30 |
| Surface | **100%** — Hard 60%, Clay 29%, Grass 12% |
| Both player names present | **56,386 of 56,386** (100%) |
| Joinable to a closing moneyline | **56,340** |
| Odds rows | 448,914 (231,383 ATP / 217,531 WTA), single source `tennis_data` |
| Opening prices | **0** — see 2.5 |
| Crosswalk entries | 588 ATP + 598 WTA = **1,186** (live serving only, not training) |

Matches per year are a steady ~5,000, with one exception that drives 2.3.

---

#### 2.1 Pre-fit audit — surname+initial collisions (do this FIRST)

Player identity in this data is **surname + initial**: `Duckworth J.`,
`Fery A.`. That is 100% populated, so training is fully viable on names alone
with no crosswalk. But it is a LOSSY key: two distinct players sharing a surname
and an initial silently merge into one Elo rating, and the merged rating is
wrong for both of them for as long as both are active.

1,507 distinct home-side names over eleven years suggests it is mostly clean,
but "mostly" is not a finding. Before any fit:

- Group the name universe by `(surname, initial)` and list every key whose
  matches span an implausible career length, or whose ranking-and-results pattern
  shows two separate active periods.
- Cross-check the worst candidates against `athlete_crosswalk`, where two ESPN
  athlete ids mapping to one tennis-data name is direct evidence of a collision.
- Output a collision list with match counts. **Decide per case**: split into two
  synthetic ids, or drop.

**Why this is first and not a footnote.** A collision does not produce an error
or an obviously bad number — it produces a plausible rating for a player who
does not exist. It cannot be detected downstream by calibration, because a
merged rating is still internally consistent. It is only findable here.

**RESULT — run 2026-09-04, `python-odds-service/audit_tennis_name_collisions.py`,
exit 0.** Four independent checks; re-runnable.

- **8 confirmed collisions, all cross-tour**: `Trevisan M.` (136 player-slots),
  `Beck A.` (112), `Pereira T.` (48), `Wong C.` (34), `Gonzalez M.` (20),
  `Harrison C.` (13), `Mayo A.` (2), `Sanchez M.` (2). A name in both ATP and
  WTA is provably two people.
  **Decision: key every rating on `(sport, name)`.** That resolves all eight at
  once and is correct independently — ATP and WTA are separate competitive pools
  and must never share a rating. **2.2 must do this; it is not optional.**
- **Crosswalk contradictions: none.** No tennis name maps to more than one ESPN
  athlete id. Covers 1,186 of 1,765 names, so this is evidence for those and
  silent on the rest.
- **Integrity: clean.** 0 matches with the same name on both sides.
- **Volume: clean.** Busiest name is 77 matches/yr (`Bautista R.`), under the
  ~90 bar. `Zverev A.` at 731 matches is Alexander, correctly separated from
  `Zverev M.` (Mischa) by the initial — the classic case the key handles.

**A heuristic tried and REJECTED: activity gaps.** At a >2y gap with >=15
matches either side it returns 13 candidates, and every one is a real player
with a documented break — Wozniacki (retired 2020, returned 2023); Pironkova,
Sevastova and Rodina (maternity); Haddad Maia (suspension); Konjuh (injury). In
tennis a multi-year absence is ordinary, so the signal is ~100% false positive.
Kept out of the script deliberately, with those names listed in `CAREER_BREAKS`,
so a future reader does not re-derive the same dead end. Note these same breaks
are exactly what 2.3's time-based reversion rule handles — the two agree.

#### 2.2 The rating engine — per-surface blend, fitted per surface

Three surface ratings (Hard, Clay, Grass) plus one overall, per player. The
prediction rating is:

```
R_used(surface) = w[surface] · R_surface + (1 − w[surface]) · R_overall
```

**`w` is fitted PER SURFACE, not as one global weight.** This is a change from
the original plan and the data forces it: grass is ~600 matches a year, ~6,700
across the whole span, spread over 1,500+ names. Most players have single-digit
career grass matches, so a standalone grass rating is mostly noise and the blend
has to lean hard on the overall rating. Hard courts are 60% of all play and can
support a much higher surface weight. One global `w` would be a compromise that
is too aggressive on grass and too timid on hard.

Fitted parameters: `K` (one, global) and `w_hard`, `w_clay`, `w_grass`. Four
numbers. Fit by maximising log-likelihood on the scored years, never on burn-in.

**RESULT — built 2026-09-04.** `src/predict/tennis_elo.py`, tests in
`src/test_tennis_elo.py`, all passing.

Ratings keyed on `(sport, name)` per 2.1. Per-surface blend weights. Reversion
on read. **No home-advantage term** — measured, the "home" player wins 50.3% of
56,386 matches, 1.4 standard errors off a coin flip, so home/away is column
order only. That check doubled as the leakage test: a winner-first column would
have shown up here as ~100%.

**Smoke run over all 56,386 real matches, replayed in 0.5s**, 46,256 scored
after burn-in. Unfitted defaults give **log-loss 0.6256, accuracy 63.9%** (a coin
flip is 0.693). Top ratings are the right names, which is the strongest
available sanity check on a cold-start rating system:

- ATP — Sinner 2199, Alcaraz 2107, Djokovic 1930, Zverev 1920, Federer 1914
- WTA — Barty 2024, Sabalenka 2002, Rybakina 1976, Swiatek 1953, Gauff 1948

**A bug the tests caught, worth recording.** The first version updated `overall`
before reading the surface base. Since `surface_rating()` falls back to
`overall` for a surface never played, a player's FIRST match on a surface took
the ALREADY-UPDATED overall as its base — the result landed in that rating
twice, 1523.2 where 1512.0 is correct, a 47% overshoot. It never raised and the
number looked plausible. Fixed by reading every pre-match rating before writing
any.

**Open question for 2.4: the overall rating does not decay when idle.** Barty
tops the WTA list having retired in 2022. Harmless for training — a retired
player is in no future match — but it means a COMEBACK resumes on a stale
rating, and the surface reversion cannot help because it reverts toward that
same stale overall. Tennis has many comebacks; 2.1 catalogued thirteen. An
overall-decay term would be a sixth fitted parameter. **Not guessed at here —
fit and measure it in 2.4.**

#### 2.3 The 2020 grass gap — an explicit decay rule, chosen up front

Wimbledon 2020 was cancelled. Measured:

```
2019   4,954 matches   clay 1,455  grass  622  hard 2,877
2020   2,292 matches   clay   728  grass    0  hard 1,564
2021   4,843 matches   clay 1,411  grass  578  hard 2,854
```

**Zero grass matches in 2020**, so every grass rating goes untouched for roughly
eighteen months (2019 Wimbledon → 2021 Wimbledon) while the players themselves
carry on changing. Left alone, the model walks into 2021 Wimbledon holding
2019 ratings and treating them as current.

**The rule: time-based reversion toward the overall rating, applied on read, not
on a schedule.** When a surface rating is used, revert it toward that player's
current overall rating in proportion to time elapsed since their last match on
that surface:

```
R_surface_effective = R_surface + (R_overall_now − R_surface) · min(1, months_idle / H)
```

`H` (months to full reversion) is a fifth fitted parameter. This is preferable to
a hardcoded 2020 patch for three reasons: it is not special-cased to one event,
so it also covers a player who simply skips a clay season; it degrades smoothly
rather than at a cliff; and it uses the overall rating, which DID keep updating
through 2020, as the source of truth rather than freezing or resetting to 1500.

Sanity check after fitting: grass predictions for 2021 Wimbledon should be
measurably better with the rule on than off. If they are not, the rule is
carrying no weight and `H` should be reported as such rather than quietly kept.

#### 2.4 Train and test — burn-in 2015–2016, first scored year 2017

Elo is naturally online, so walk-forward is nearly free: replay matches in
chronological order and score each one on the rating that existed *before* it.
No row is ever scored on information from its own future.

**2015 AND 2016 are burn-in — scored on nothing, used only to move ratings off
1500.** The original plan started scoring at 2016, leaving a single season of
burn-in. One season is thin: a player who debuts late in 2015 enters 2016 with a
handful of matches and a rating still near its initial value, and scoring those
matches measures the burn-in, not the model. Two seasons gets the great majority
of the active tour to a settled rating.

Scored years: **2017 through 2026** (2026 partial, through 2026-08-30). That is
roughly 45,000 scored matches — ample.

Report per year, never pooled only: log-loss, Brier, accuracy, and calibration in
deciles. A single pooled number hides a model that was good until 2021 and drifted
after, which is exactly the failure that matters for something about to run live.

**RESULT — 2.3 and 2.4 run together 2026-09-04, `fit_tennis_elo.py`.**
Burn-in <2017 | train 2017-2022 | held out 2023+ (19,150 matches the optimiser
never saw).

| | log-loss | brier | acc |
|---|---|---|---|
| unfitted defaults | 0.62317 | 0.21753 | 64.2% |
| fitted, 5 params | **0.62210** | 0.21707 | 64.6% |
| fitted, 6 params (+overall decay) | 0.62170 | 0.21698 | 64.4% |

Fitted: `k=35.06 w_hard=0.304 w_clay=0.429 w_grass=0.379`.

**Significance, paired and out-of-sample** — the number that decides how much of
this to believe:

```
fitted5 - baseline   -0.00107   SE 0.00053   t = -2.01
fitted6 - baseline   -0.00147   SE 0.00058   t = -2.56
fitted6 - fitted5    -0.00040   SE 0.00022   t = -1.81
```

**Fitting helps, significantly but barely.** ~0.001 log-loss. Anyone reading
64.6% accuracy as a strong result should note the unfitted engine already gave
64.2%.

**The 6th parameter does not earn its place.** Overall idle decay fits to 144.6
months and fails to beat the 5-parameter model (t = -1.81). Adopting it would
also mean selecting on the held-out set. **5-parameter model adopted**, and
those values are now the `EloParams` defaults.

**2.3's answer: the reversion rule is NOT supported as designed.** Fitted
freely the horizon runs to the 1200-month bound (5-param) or 216 months
(6-param), against 11.6 years of data — the 18-month prior was ~10x too
aggressive. Kept at that near-off setting on one piece of evidence: on grass
alone, weak reversion beats none (0.62078 vs 0.62225). That is a subgroup
chosen after the fact and not significance-tested. On the 2021 Wimbledon
fortnight it was designed for, n=385 and the signal is mixed — log-loss
marginally better, accuracy marginally worse. **Recorded as weak, not as a win.**

**A rationale that was simply wrong.** 2.2 argued hard courts, at 60% of play,
would support the HIGHEST surface weight. The fit says hard is the LOWEST
(0.304 vs clay 0.429, grass 0.379). Hard is the default surface, so the overall
rating already largely IS a hard-court rating and a separate one adds little;
clay and grass differ from it and carry distinct signal. Per-surface weights
survive, the reasoning behind them did not.

**Stability is good.** Per-year held-out 0.6192-0.6241 across 2023-2026, no
drift. Per-surface 0.6207-0.6236, uniform.

**A methodological note for later phases.** The first fit returned the clip
bound (120 months) in BOTH solutions. A parameter pinned to its boundary is not
a fitted parameter — it is the optimiser stopped mid-descent — and reporting it
as fitted would have been wrong. Widening to 1200 changed the answer and the
conclusion. **Check every fitted parameter against its bounds before believing
it.**

#### 2.5 Ship gate — beat the close, NOT CLV

**The original gate said "positive CLV against the closing moneyline." That is
not measurable for tennis and never was.** All 448,914 tennis odds rows carry a
closing price and **zero** carry an opening price. CLV compares an entry price to
a later close; with no entry price there is nothing to compute. Reporting a
"CLV" number here would be reporting something else under a borrowed name.

What the data does support, because every match carries three closing series
(`bet365`, `market_avg`, `market_max`):

- **Accuracy gate — beat the consensus close.** De-vig `market_avg` into a fair
  probability and compare the model's probability against it. The model must
  have lower log-loss than the closing consensus on held-out years. This is a
  hard bar: the closing line is the strongest public forecast available, and
  most models do not clear it.
- **Economic gate — ROI at best price.** Simulate flat-stake bets wherever the
  model's edge over the de-vigged `market_avg` exceeds a threshold, priced at
  `market_max`. Report ROI with a confidence interval, per year and pooled.
- **Calibration gate.** Bucketed calibration on held-out years; predicted 60%
  must win about 60%.

Be explicit in every write-up that this is **cross-sectional price dispersion**
(best available price vs consensus at the same moment), not time-based line
movement. The two are routinely conflated and they measure different things.

Ship only if the accuracy gate passes. ROI without it is a sample-size artifact.

**RESULT — run 2026-09-04, `ship_gate_tennis.py`. GATE 1 FAILED. DO NOT SHIP.**

19,025 held-out matches (2023+) with a consensus close.

| | log-loss | accuracy |
|---|---|---|
| model | 0.62444 | 64.4% |
| **market_avg** (de-vigged) | **0.59143** | **67.8%** |
| **pinnacle** (de-vigged) | **0.59187** | **67.7%** |

```
model - market_avg   +0.03301   SE 0.00160   t = +20.68
model - pinnacle     +0.03361   SE 0.00181   t = +18.55
```

**The market wins by twenty standard errors.** This is not a near miss or a
tuning gap. A `pinnacle` series (53,007 rows) was found in the archive and is
reported alongside `market_avg` deliberately — beating a soft benchmark while
losing to the sharp one would be a result manufactured by choosing the
benchmark. Both say the same thing.

**Gate 2 — calibration, and the check that makes the failure conclusive.** The
model shows a mild S-shape: it under-predicts underdogs (0.1-0.2 bucket
predicted 0.156, actual 0.202) and over-predicts favourites (0.7-0.8 predicted
0.747, actual 0.718) — classic overconfidence, i.e. ratings too dispersed.

That is fixable, so it was fixed and re-measured before concluding anything.
Platt scaling fitted on TRAIN only (a=0.914, shrinking toward 0.5 as expected)
moved held-out log-loss 0.62444 -> 0.62347. **It recovered 0.00097 of a 0.03301
gap — 3%.** The deficit is not miscalibration. It is information the model does
not have: injury, fatigue, travel, motivation, H2H, in-tournament form, all of
which the closing line contains.

**Gate 3 — ROI at `market_max`, and the most damning number here:**

```
edge >  0%   19,024 bets   -4.92%
edge >  2%   15,559 bets   -4.89%
edge >  5%   10,900 bets   -5.24%
edge > 10%    5,480 bets   -9.04%
```

ROI gets WORSE as the edge filter tightens. If the model held any real signal,
filtering to its most confident disagreements with the market should improve
returns. It does the reverse, which is the signature of those "edges" being
noise — and precisely why gate 3 is informational and gate 1 decides.

**What Phase 2 achieved anyway, which was its stated purpose.** Tennis went
first to prove the chain — fit, walk-forward, calibrate, compare to the close —
on the simplest possible engine before that chain is trusted anywhere harder.
The chain works, and its first real verdict was a clean, well-measured NEGATIVE
rather than a false positive. A pipeline that cannot return "no" is not a
pipeline worth having.

**Decision required before Phase 3.** Options: (a) accept that surface-weighted
Elo alone does not beat a tennis closing line and move to soccer having proven
the chain, or (b) extend the tennis model with the information the market has
and Elo does not. This plan's own exit gate says ship only on gate 1, so
shipping as-is is not among them.

#### 2.6 Serving — OUT OF SCOPE, closed 2026-09-04

Serving is the delivery mechanism for a model that **failed gate 3**. Building
it would be building the pipe for something decided not to deliver, so it is
closed unbuilt rather than mechanically ticked.

The requirement it carried is not wrong and is not lost: **a match with an
unresolvable player must produce NO PREDICTION, never a prediction against a
default 1500 rating**, because a 1500 default is indistinguishable from a real
rating downstream and would quietly publish a coin flip as model output. That is
a safety property of ANY tennis model, so if tennis is ever revisited with more
features, this comes back with it. `athlete_crosswalk` resolves 588 ATP and 598
WTA players — 87.0% / 84.6% of slots — so ~13-15% of live matches would hit it.

#### PHASE 2 CLOSED — chain proven, model rejected

| # | gate | |
|---|---|---|
| 1 | Collision audit run and resolved | PASS |
| 2 | Walk-forward 2017-2026, per-year metrics | PASS |
| 3 | Beats de-vigged `market_avg` on log-loss | **FAIL** — t=+20.68 the wrong way |
| 4 | Calibration within tolerance in deciles | PASS — worst bucket +0.046, inside 5% |
| 5 | ROI at `market_max` with an interval | PASS (reported, informational) |
| 6 | Unresolvable player -> no prediction | OUT OF SCOPE (above) |

Phase 2's purpose was to prove the chain — fit, walk-forward, calibrate, compare
to the close — on the simplest engine before trusting it anywhere harder. **The
chain works and its first verdict was a clean measured NO.** A pipeline that
cannot return "no" is not worth having, and this one returned it at t=20 with
the calibration confound explicitly ruled out (Platt recovered 3% of the gap).

#### What is NOT in this phase

- No live tennis odds work. Tennis currently runs on SharpAPI alone (both its
  props and game-lines endpoints are the same vendor and key). That single-vendor
  risk is **accepted, deliberately, by the operator on 2026-09-04**.
- No `refreshTennisAtpJob` fix. The original plan listed it as failing every run
  on a `side='home'` over/under aces market; re-measured 2026-09-04, both
  `refreshTennisAtpJob` and `refreshTennisWtaJob` report `ok=True`. If it
  recurs it is its own item, not Phase 2 scope.
- No player-level props. Match-winner moneyline only.

#### Exit gate for Phase 2

1. Collision audit run, collision list resolved, decision recorded per case.
2. Walk-forward 2017–2026 complete, metrics reported per year.
3. Model beats de-vigged `market_avg` on log-loss across held-out years.
4. Calibration within tolerance in deciles.
5. ROI at `market_max` reported with an interval — informational, not a gate.
6. Unresolvable-player behaviour implemented as "no prediction".

---

### Phase 3 — Soccer, EPL + MLS · Dixon-Coles

**Why second.** It builds the scoring-rate engine Phases 4 and 5 reuse — three
sports from one build. It is also a genuinely richer model than Phase 2's Elo:
Elo compresses a team to one number, Dixon-Coles gives every team an attack rate
and a defence rate and predicts the whole scoreline distribution. Phase 2 lost
its gate by 0.033 log-loss against the close; that is the bar, and a
scoring-rate model has more to say than a rating did.

**Simply.** Every team gets two numbers: **attack** and **defence**. Expected
goals for the home side = home attack x away defence x a home-advantage bump;
same the other way. Assume goals arrive at random at those rates, compute the
probability of every scoreline — 0-0, 1-0, 2-1 — then add up the cells where
home wins for a moneyline, the cells over 2.5 for a total. One fit, every market.

**In detail.** Poisson with the two Dixon-Coles corrections, the soccer standard
since 1997 because both are small formula changes for real gains: a **low-score
correction** (`tau`, on 0-0/1-0/0-1/1-1), because cautious teams produce those
four scorelines more often than independent Poisson allows; and **exponential
time decay** (`xi`), so recent matches count more.

#### Verified data (measured 2026-09-04, not carried from the audit)

| | EPL | MLS |
|---|---|---|
| Matches | **4,601** | **7,001** |
| Span | 2015-08-08 → 2026-08-31 | 2012-03-10 → 2026-08-30 |
| Final scores present | **100%** | **100%** |
| Home / draw / away | 44.2% / 24.0% / 31.8% | 49.0% / 25.1% / 25.9% |
| Moneyline rows per side | ~13,340 | ~20,880 |
| **Opening prices** | **~7,200 (54%)** | **~1,300 (6%), draw 0** |
| Books | pinnacle 12,030, bet365 8,040, marketavg/marketmax 8,040 | marketmax 18,390 |
| Totals (over/under) | 551 | 1,411 |

**Home advantage is real here, unlike tennis** — 44.2% / 49.0% against tennis's
50.3% coin flip. The Dixon-Coles home term is earned from this data rather than
inherited from the literature, and the same check doubles as Phase 2.2's leakage
test.

---

#### 3.1 — Club identity: canonicalise and de-duplicate  **[BLOCKER]**

**Nothing may be fitted before this.** A second source, `espn_core`, began
ingesting in 2025 alongside `footballdata`, with a different naming convention:

```
footballdata:  'Wolves'                   'Man United'         'Brighton'
espn_core:     'Wolverhampton Wanderers'  'Manchester United'  'Brighton & Hove Albion'
```

EPL 2025 holds 378 `footballdata` + 186 `espn_core` rows against a 380-match
season; MLS 2025 holds 540 + 541.

Two harms, the second worse:

1. **Double-counted matches** from 2025 — the most recent and most relevant data.
2. **Every club split into two teams.** 'Wolves' and 'Wolverhampton Wanderers'
   each get their own attack and defence rating fitted on half the data. This is
   Phase 2.1's collision inverted — there two players shared one identity, here
   one club holds two — and far larger: 2.1 touched 8 names, this touches every
   club in both leagues across 2025-2026.

**It hides from the obvious check.** De-duplicating on `(date, home, away)`
catches only 94 EPL and 167 MLS groups against 186 and 541 `espn_core` rows,
because the names do not match.

**Deliverable:** an explicit canonical club-name map (35 EPL + 31 MLS names —
small enough to verify by eye), a de-duplication rule, a recorded
source-precedence decision, and a re-runnable audit in the shape of
`audit_tennis_name_collisions.py`.

**No fuzzy matching.** 'Manchester United' and 'Manchester City' share a prefix
and are different clubs, as do several 'Sporting'/'Real'/'Atletico' sides in MLS.

**Done when:** duplicate count is zero, every club resolves to one identity, and
the audit re-runs clean.

**RESULT — done 2026-09-04.** `src/predict/soccer_teams.py` (map + loader),
`src/test_soccer_teams.py`, `audit_soccer_duplicates.py` (re-runnable, exit 0).

**Canonicalisation exposed 4x more duplication than the raw-name check.**

| | raw names | canonical clubs | duplicate groups found |
|---|---|---|---|
| EPL | 48 | **35** (13 aliases) | **400** — vs 94 on raw names |
| MLS | 48 | **31** (15 aliases) | **604** — vs 167 on raw names |

**All 400 and all 604 duplicate groups AGREE on the final score**, so collapsing
is lossless rather than a silent tiebreak. That was checked explicitly, not
assumed — two sources that contradicted each other would need a different fix.

**The odds table was affected too, and would have failed silently.**
`odds_archive` carries both spellings ('Bournemouth' / 'AFC Bournemouth',
'CF Montreal' / 'CF Montréal'), so a ship gate joining un-canonicalised names
loses rows to a non-join rather than an error. The map closes there: **0 orphan
odds clubs** in either league.

**Two exhibition sides found and excluded**: `MLS All-Stars` and
`Liga MX All-Stars`, 2 matches. An All-Star game says nothing about club
strength and must never train a model that estimates it.

**Loaded result:** EPL 4,200 matches / 35 clubs, MLS 6,395 / 31 clubs. Home and
draw rates barely moved after de-duplication (EPL 44.2->44.4%, 24.0->23.7%),
confirming the duplicates were representative rather than skewed. **These match
the plan's original 4,200 / 6,397 figures** — that audit had counted correctly;
the 4,601 / 7,001 raw counts include the duplicates.

`load_soccer_matches()` is the ONE place canonicalisation, exhibition filtering
and de-duplication are applied, so 3.2, 3.3 and 3.5 cannot drift apart on the
rule. Precedence is `footballdata` over `espn_core` (longer history, majority of
rows); MLS keeps 265 `espn_core` matches footballdata does not have, so the rule
prefers rather than discards.

**The fix's own risk is tested.** `test_soccer_teams.py` asserts INJECTIVITY —
no two aliases may share a target — because a mapping typo sending both
Manchester clubs to one string would merge United and City into a single team,
raise nothing, and produce a plausible rating for a club that does not exist.
That is 3.1's own failure mode reintroduced by its fix.

**Still true after this step:** the duplicate rows remain in `game_result`.
This removes them on the way out. Anything reading that table directly for these
sports still reads double from 2025 onward.

#### 3.2 — The Dixon-Coles engine

Per team `attack` and `defence`; global `home_advantage`, `tau`, `xi`.

```
lambda_home = exp(attack_home - defence_away + home_advantage)
lambda_away = exp(attack_away - defence_home)
P(i, j)     = tau(i, j) * Poisson(i; lambda_home) * Poisson(j; lambda_away)
```

A 0..10 goal grid gives the three-way moneyline and any total from one fit.
**Identifiability needs a constraint (mean attack = 0)** — without it the
likelihood has a flat direction and the optimiser wanders along it, which is the
Phase 2.4 boundary lesson wearing different clothes.

**Deliverable:** a pure, IO-free, tested module — `predict/dixon_coles.py` —
mirroring `predict/tennis_elo.py`. Tests assert the properties that fail
silently: the tau correction only touches the four low scorelines, probabilities
over the grid sum to ~1, home advantage raises home win probability, time decay
weights recent matches more, and the mean-attack constraint holds after fitting.

**Done when:** tests pass and a fit on one season produces sane ratings — the
recognisable-names check that validated Phase 2.2.

**RESULT — built 2026-09-04.** `src/predict/dixon_coles.py`, tests in
`src/test_dixon_coles.py`, all passing.

**Synthetic recovery — the test that makes the engine believable.** From 6,000
matches generated by known parameters, the fit recovers them:

```
home_advantage   truth 0.280  ->  0.251
Strong attack    truth +0.45  ->  +0.449      defence +0.35 -> +0.287
Weak   attack    truth -0.45  ->  -0.430      defence -0.35 -> -0.352
```

A model that cannot recover its own truth on clean data is not believable on
real data. This one can, with both orderings intact.

**Real EPL fit, 760 matches (2023-08 → 2025-05), 4.4s:**

| strongest | | weakest | |
|---|---|---|---|
| Arsenal | +0.702 | Southampton | −1.344 |
| Man City | +0.539 | Sheffield United | −1.215 |
| Liverpool | +0.512 | Leicester | −1.044 |
| Newcastle | +0.131 | Ipswich | −0.984 |

Every one of the bottom five was relegated in that window. Sample predictions:
Man City v Sheffield United 0.922 / 0.056 / 0.022; Arsenal v Liverpool
0.470 / 0.257 / 0.273 — a close top-two match with a realistic draw rate.

**`home_advantage` fitted to 0.133, well below the classic literature's
~0.25-0.30.** That is not obviously a bug: Premier League home advantage has
declined markedly since 2020, and this window is 2023-25. Worth watching in 3.4
across the full history — if the older seasons fit a visibly larger term, the
decline is real and time decay will handle it; if not, something is wrong with
the term. **Flagged rather than assumed either way.**

`rho` fitted to −0.021, small and negative, consistent with the literature
(Dixon-Coles found ≈ −0.13 on 1990s English football; modern estimates are
smaller).

**Cost note for 3.3:** 4.4s for 760 matches over 24 clubs. A per-matchweek
rolling refit across EPL's ~1,365 held-out matches is ~36 refits ≈ 3 minutes,
but the fit is over ALL prior matches, so cost grows with history. MLS is larger
on both axes. Budget accordingly, and prefer per-matchweek over per-match.

**Tests cover the failures that would be silent:** tau touching only the four
low-score cells; the grid summing to 1; rho = 0 reducing EXACTLY to independent
Poisson (the null the model must contain); and identifiability — a shifted
attack vector producing identical rates, which is why the mean attack is pinned
to zero. Without that pin the likelihood is flat along "add c to every attack
and defence" and the optimiser returns wildly different parameters that fit
identically. That is Phase 2.4's boundary lesson in a different costume.

#### 3.3 — Rolling-refit walk-forward harness

**Structurally different from Phase 2 and the main reason this phase is more
work.** Elo is online: one pass, each match updates ratings, and scoring is
nearly free. Dixon-Coles is a batch maximum-likelihood fit, so a walk-forward
means **refitting as of each test date on prior matches only**.

Refit per matchweek (not per match) for tractability; state the cadence and its
cost. There is no burn-in period — time decay handles recency — but there is a
minimum history before a fit is meaningful, and that threshold is a decision to
record, not to discover mid-run.

**Chronology asserted in code, never assumed** — the same guard as
`tennis_elo.replay()`.

**Done when:** the harness produces a prediction for every held-out match using
only prior data, and refuses out-of-order input.

#### 3.4 — Fit and measure

Fit **each league separately**. They share an engine, not a parameter set: MLS's
home advantage is visibly larger (49.0% vs 44.2%), which is what long-haul
travel in a continental league should produce.

- **EPL** — fit through 2023-12-31, held out 2024+ (~1,365 matches)
- **MLS** — fit through 2023-12-31, held out 2024+ (~2,247 matches)

Report log-loss, Brier and accuracy **per year and per outcome**, never pooled
only. **Check every fitted parameter against its bounds before believing it** —
Phase 2.4's first fit returned the clip bound in both solutions and widening it
changed the conclusion.

**Done when:** parameters are fitted, off their bounds, and held-out metrics are
reported per year.

#### 3.5 — Ship gate

In order of authority:

1. **ACCURACY.** Beat de-vigged **pinnacle** (12,030 EPL rows, the sharp
   reference) **and** `marketavg`. Both reported — beating a soft benchmark while
   losing to the sharp one is a result manufactured by choosing the benchmark.
   Paired significance test, out of sample.
2. **CALIBRATION, SEPARATELY FOR HOME / DRAW / AWAY.** The draw is where Poisson
   models fail, and at ~24-25% of all matches an aggregate hides it.
3. **CLV — and here it is genuinely measurable, for EPL.** ~54% opening-price
   coverage against tennis's zero, so this project can report real time-based
   CLV for the first time. **MLS is beat-the-close only** (~6%, zero on the
   draw). Do not average the two into one "soccer CLV".
4. **ROI at `marketmax`**, informational, swept by edge threshold with the
   **monotonicity check** — Phase 2.5's single most diagnostic number was ROI
   getting *worse* as the filter tightened (-4.92% → -9.04%), the signature of
   edges being noise.

**Fix calibration and re-measure before declaring any failure.** In 2.5 Platt
recovered only 3% of the gap, which is what made that negative conclusive rather
than premature.

**Naming trap:** soccer books are `marketavg` / `marketmax` — no underscore —
where tennis uses `market_avg` / `market_max`. Code copied from
`ship_gate_tennis.py` will silently match zero rows.

**Done when:** gate 1 passes or fails on a paired test, with calibration ruled
out as the cause.

#### 3.6 — Totals, gated separately

551 EPL and 1,411 MLS priced over/unders, all carrying opening prices. Gate
separately from the moneyline and expect too small a sample for a confident
verdict. **Report the interval; do not ship a total on 551 rows.**

#### 3.7 — Serving  **[not started until 3.5 passes]**

Phase 2.6 established the rule: serving is the delivery mechanism for a model
that has cleared its gate, and building it first is building a pipe for
something that may not be delivered. Deferred by design, not forgotten.

#### What is NOT in this phase

- **No expected-goals model.** They predict better and need shot-location data
  not held and not cheaply bought.
- No cup competitions, no other leagues.

#### Exit gate for Phase 3

1. Club canonicalisation and de-duplication complete, audit re-runnable,
   source-precedence recorded (3.1).
2. Engine tested, sane ratings on a known season (3.2).
3. Rolling-refit walk-forward complete for both leagues, metrics per year (3.3, 3.4).
4. All fitted parameters verified off their bounds (3.4).
5. Model beats de-vigged pinnacle AND marketavg on log-loss, held out (3.5).
6. Calibration within tolerance **separately** for home, draw and away (3.5).
7. CLV reported for EPL, beat-the-close for MLS, **not averaged** (3.5).
8. ROI swept by edge threshold with monotonicity reported (3.5).

---

### Phase 4 — NHL · Dixon-Coles on regulation goals, then the first prop model

**Infrastructure first:**

- **`ingestNhlShotsJob`** (never run). The game model needs a way to identify
  empty-net and overtime goals; the 177,961 stored shot events are the likely
  source and this must be verified before the model work starts.
- **Market canonicalisation** (0.9) — a prerequisite for any prop model across
  sources, and this is the first one. NHL's head is short: 11 of 20 markets carry
  90%.

#### 4a. Game model, and two traps

**Empty-net goals.** A team losing by one pulls its goalie in the last two
minutes. Those goals happen *because of the score*, not because one team is
better; fed in raw, ratings absorb game-state noise as strength.

**Overtime and shootouts.** Tied after 60, the winner comes from 3-on-3 or a
shootout — near a coin flip, unrelated to the strength being modelled. So model
the 60 minutes, then add the tie case separately.

**Data.** 24,336 priced games, dense 2008–2019 and 2021–2025, 99.9% reaching a
result.

**Ship gate.** Positive CLV against the closing moneyline. Some books price NHL
three-way on regulation, which is the market this model natively produces.

#### 4b. Prop model — shots on goal first

**Simply.** Three ingredients in order of importance: **volume** (how many
chances), **rate** (how good per chance), **shape** (how much it bounces around,
which turns an expectation into P(over the line)).

**Why NHL is the best standalone prop case.** `toiMinutes` on **all 724,002
rows** — perfect coverage of the field that matters most — and **71% of NHL props
are two-sided** (48,758 of 68,880), the highest ratio in the project, so the vig
can be stripped properly rather than guessed at.

**In detail.** Project time on ice from recent games and role. Project shots per
minute from the player's rate, shrunk toward his position's mean by a sample-size
weight. Multiply for expected shots; Poisson for goals, negative binomial for
shots (overdispersed). Shots on goal is the right first market: high-volume,
driven by ice time and shooting rate, far less random than goals.

**Do not forget the offset.** NHL props join `player_game_history` at **−1 day** —
ESPN stamps UTC, the NHL API reports local time. Joining at zero silently loses
35% of the data. Derived against real dates and asserted by gate 7.7.

---

### Phase 5 — MLB · plate-appearance Monte Carlo, game and props from one engine

**Infrastructure first: `ingestStatcastPitchesJob`** (never run). Statcast is the
skill-vs-luck prior below.

**Why here.** The largest prop evidence base in the project by a factor of seven,
and the props are a by-product of the game model rather than a second build.

**Simply.** Take both lineups and the starting pitchers. For each plate
appearance, draw an outcome — single, walk, strikeout, home run — from a
distribution built out of that batter's skill, that pitcher's skill, and the park.
Play nine innings. Repeat ten thousand times. The share of runs where the home
team wins is the moneyline; the share where the total cleared is the total.

**And every run produces a full line for every batter** — hits, total bases, home
runs, RBIs — so the entire player-prop surface falls out of the same engine. That
is why this was chosen over a run-rate model, which gives game markets and nothing
else.

**In detail.** The per-PA outcome distribution comes from a log5-style combination
of batter rate, pitcher rate and league baseline, adjusted by park. Base-out state
advances through a standard transition model. Batting order can be inferred from
PA counts.

**Statcast is a prior, not the input.** It covers 4,069 of 31,781 priced games, so
it cannot drive the simulation. What it can do: `estimated_woba` separates skill
from luck, so use the overlap to learn how much of a player's line is signal, then
shrink the eleven-season estimates toward it.

**Not optional.** The 2019 ball and the 2023 pitch clock changed how many runs a
season produces. Player estimates must be **per-season against a league
baseline**, or a 2016 hitter looks better than he was.

**Data.** 1.87M plate appearances (2016–2026) across 727,613 player-game rows;
31,780 priced games on a now-continuous 2010–2026 history (0.6); 1,083,266 props
joining to an outcome; 36 markets, 22 carrying 90%.

**Ship gate.** Game model: positive CLV against the closing moneyline and total.
Props: the rank check in §4, plus bar 3 per market with the §1 caveat about the
softness of the prop close. **MLB is the only sport with a sample large enough to
tell whether the whole prop approach works — if it fails here, it is not tried
elsewhere.**

**Also fix here:** `computeMlbGameModelJob`, failing every run on an
int-where-string argument. It belongs to the layer being rebuilt.

---

### Phase 6 — NBA · pace × efficiency, then minutes × rate

**Infrastructure first: `ingestNbaShotsJob`** (never run).

**Simply.** Basketball has a clean underlying structure: **points = possessions ×
points per possession**. Describe each team with a pace and an efficiency
(offence and defence), multiply out for a projected score both ways. The
difference gives a spread and, through a curve, a win probability; the sum gives
the total. Two numbers per team, both markets. A pile-of-statistics regression
would use the same information less cleanly.

**Buildable today.** Possessions are not stored, but the standard estimate needs
field-goal attempts, free-throw attempts, turnovers and offensive rebounds — all
four already in the player rows.

**Data.** 24,705 priced games, dense 2008–2019 and 2021–2025, 100% result
coverage.

**The props, honestly.** Evidence is the thinnest of the four viable sports —
4,480 graded player-games, a sixteenth of MLB's. And **minutes are the least
predictable part**: a blowout, a rest day or foul trouble moves a points prop more
than anything about the player's skill. Any NBA prop model is mostly a minutes
model wearing a costume, and it should be built knowing that.

**Constrained by 0.7** — spread is home-side only, so it is judged against the
posted line, not a de-vigged probability. Moneyline and total are the primary
gates.

---

### Phase 7 — College football · ratings on margin

**The spread is the market here.** Moneylines exist only from 2021 (4,017 games);
spreads go back to 2013 (13,569). Model what there is three times more of, and
what people actually bet.

**In detail.** A ridge or least-squares rating on margin: each team gets a
strength in points, the model predicts `home − away + home_field`, and the
residual against the closing spread is the signal. Cap or shrink blowout margins
so a 60-point win does not dominate the fit.

**Why this is easier than it looks.** The talent gaps are enormous — a top program
against a small school is a 40-point favourite — and that wide range makes team
strength easy to measure. The signal is loud in a way it never is in the NFL.

**Constrained by 0.7** — CFBD spread rows carry lines but **zero prices**, so CLV
can only be measured on the 2025–26 ESPN rows. A real limit on the ship gate, not
to be papered over.

**CFB props are out of scope** — zero of 45,000 rows are two-sided.

---

### Phase 8 — NFL · margin-adjusted Elo, plus targets-based props

**Infrastructure first: `ingestNflPbpJob`** (never run).

**Why last.** The NFL is where the temptation to over-build is strongest and the
payoff smallest — the most attention from the sharpest money, the least data of
any sport here. The pick is deliberately modest: ratings move by *how much* you
won by, with diminishing returns so blowouts do not dominate. Play-by-play
simulation would overfit 7,336 games, in the worst possible market to spend the
hardest effort.

**Data.** 7,336 spread and total games back to 1999, 5,355 moneyline, dense
2006–2025, 98.0% reaching a result. Both spread sides are priced (nflverse), so
NFL spread **can** be de-vigged, unlike NBA/EPL/CFB.

**Props — correcting the rebuild plan.** `model-rebuild-plan.md` §8 says NFL is
blocked on snap counts. **That is wrong.** There are 58,152 rows carrying
`receiving.receivingTargets` and 29,878 carrying `rushing.rushingAttempts`, and
for the markets that actually trade, **targets are a better exposure measure than
snaps** — receiving yards, receptions and longest reception are the top three by
volume, and a snap spent blocking contributes nothing to any of them. A target is
the opportunity.

**One market needs different machinery.** **Longest reception** is the *maximum*
of several draws, not a sum, so it needs an extreme-value treatment rather than a
count distribution. Second-biggest NFL market by volume, worth doing properly.

**Also needs care.** Milestone alt-lines are off by one — a line of 2.0 means
"≥2", which is over 1.5, not over 2.5.

---

### Phase 9 — Surfacing: the two boards

**Neither the model plan nor the infrastructure plan covered this, and without it
none of the work above reaches a user.** The model layer currently produces
374,173 graded prop predictions, an ordering on two lists, and a pick side with no
number — and every probability, edge and confidence figure is computed, written to
Postgres, and **discarded at the render boundary**. That was the right call for a
model measured as worthless. It stops being right the moment a model clears the
ship gate.

The work, in dependency order:

1. **The betting board** — ranks by modelled edge. Rank shown, probability not
   (§4).
2. **The stats board** — ranks by projected production, same engine underneath.
3. **Market filter on both**, per sport. This generalises the old five-player
   home-run list rather than special-casing it: every sport's rankings filter by
   market, and the home-run list becomes one instance of that.
4. **Un-suppress the render paths that were switched off** — `EdgeBadge` in
   `OddsChip.tsx` returns null across four call sites, `GameHeroCard` hardcodes
   `mlPercent`/`totalPercent` to null, `TodaysPicksModal` renders the score grade
   into an empty div. Each comes back **only** for a sport whose model has cleared
   the gate, never globally.
5. **The prompt system.** The eight-phase prompt work was built on the assumption
   that models would not be used, and that assumption has changed. It needs
   revisiting against what the boards actually surface — noted during planning,
   deferred to here deliberately, and this is the phase where it lands.

Built per sport as each model ships, not as one big-bang release. A sport whose
model never clears bar 3 simply never gets a board, and the page keeps rendering
exactly what it renders today.

---

### Not scheduled — and why

**OddsHarvester.** An earlier draft of this plan said it was "anti-bot, not a
code fix, and every sport it covers has a working provider." **Both halves were
wrong** — CFB had no other game-line source at all, and the anti-bot attribution
was the health check's own hedge (*"possible"*) repeated as a diagnosis; the
actual evidence (dropdown timeout, page height 0) fits an OddsPortal markup
change equally well. It is now handled by Phase 0c, which removes the dependency
by giving CFB a live provider rather than by fixing the scraper.

**Buying data** — NFL snaps and soccer minutes — only after the system has proved
itself. Three of the four rejected advanced options (xG, optical tracking,
point-by-point tennis) are blocked by *availability*, not difficulty, and in two
cases are not sold to individuals at any price.

**Golf.** Its model layer is being deleted (§2) and not replaced here. 1.03M shot
events across three tournaments is deep, not wide.

**CFB and soccer props.** Not viable — see §4.

**A Render deploy** requires operator approval and is not assumed by any phase.

---

## 4. Props: build a probability, show a rank

`model-rebuild-plan.md` §5B chose a pure grader, and its reasoning was explicit: a
grader can ship on data in hand, while a probability claim has to wait until it
can be tested against historical prices. **That constraint no longer exists** —
the sourcing round delivered 1.8M historical prop prices, 443,990 two-sided in MLB
alone, and the open/close test confirmed both ends are genuine pre-game prices.

- **Internally**, a probability, held to bar 3 against the closing price. It is
  measurable now, so it gets measured.
- **On screen**, an ordering. A rank makes no claim that can be wrong in front of
  a user. The previous model layer got into trouble showing confident percentages
  it could not support; this avoids repeating that without giving up the ability
  to measure.

**Two boards, one engine.** The betting board ranks by modelled edge; the stats
board by projected production. Same numbers underneath, two audiences — people
here for advice, and people here to analyse. Built in Phase 9.

**The guardrail.** "Not a probability on screen" is not "not falsifiable." The
honest test for a ranking is **rank correlation**: do higher-ranked situations
produce better outcomes than lower-ranked ones, on games the model never saw?
Cheap on the existing harness, and it is what stops a rank quietly becoming a
vibe. Hold it from the first commit.

**Viability, decided.** MLB, NHL, NFL and NBA are viable. **CFB and soccer are
not** — CFB has zero two-sided prices; soccer has zero two-sided prices *and* no
minutes played, so a 20-minute substitute and a 90-minute starter are identical
rows, which is exactly the distinction a prop model exists to make.

**Props are the expensive end.** Prop prices sum to 1.066–1.079 against
1.029–1.056 on game lines — a **3.3–4.0 point** edge needed to break even, roughly
double the game-line bar. Props are less carefully priced *and* cost more to play.

---

## 5. Replay, rebuild, and how a refit actually improves anything

**Every loader is idempotent by the same contract**: `clear_source(pool, SOURCE,
tables=(...))` deletes that source's own rows before writing.
`import_mlb_sbr.py` changed its `event_ref` between runs, the old rows were a
different key, survived `ON CONFLICT DO NOTHING`, and 28,057 offered rows became
55,756 landed. **A loader that cannot clear its own output is not idempotent
whatever its INSERT says.**

This session hit the same class of bug again, which is why it is stated plainly:
`import_tennis.py`'s clear is behind `--truncate`, so the first re-run with
surface wrote **nothing** — every row hit `ON CONFLICT DO NOTHING` against rows
already there, the column stayed 100% NULL, and the log reported "56,386 offered".
**Verify the value landed, not the offered count.**

**Rebuild order**, all reproducible from files and tables on disk:

| Step | Source | Command |
|---|---|---|
| 1 | SBR xlsx 2010-21 | `python import_mlb_sbr.py` |
| 2 | Long CSV 2021-25 | `python import_mlb_long_csv.py` |
| 3 | nflverse / CFBD / football-data | their loaders |
| 4 | tennis xlsx | `python import_tennis.py --truncate` |
| 5 | ESPN props | `python import_props.py --truncate` |
| 6 | live captures | replay from `prop_odds_history` within its retention window |

Step 6 has a horizon. Beyond `prop_odds_history`'s retention the archive is the
only copy — the argument for treating it as append-only and backing it up
separately from the live set.

**How new data improves a model**, because "ingest more" is not by itself a loop:

1. The bridge accumulates real closing lines, captured at a known time, with
   `captured_at` proving when.
2. The CLV backtest runs on games the model has never seen — genuinely new events,
   not a re-split. `clvSummaryJob` already runs hourly and is healthy; it has
   simply had nothing new to read.
3. Refit on a schedule measured in **months**, not days. Fitting is a multi-hour
   human-triggered CLI and deliberately not a queue job.
4. A refit ships only if it beats the incumbent on out-of-time CLV, behind the
   `shadow` flag.
5. If it does not beat the incumbent, the incumbent stays. Recording that is the
   point of the loop, not a failure of it.

**The archive growing is what makes step 2 possible, and step 2 is the only thing
that can tell you whether any of this works.** That is why the bridge is Phase 1
and not an afterthought.

---

## 6. The stopping rule

Restated from `model-rebuild-plan.md` §7.6 and worth keeping: **the later phases
proceed only once one model has actually beaten a closing line.** If none has,
that is the answer worth having before four more builds. Tennis and soccer are
cheap enough to be that test; MLB and NFL are not.
