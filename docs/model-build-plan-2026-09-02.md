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

**RESULT — built 2026-09-04.** `src/predict/dc_walkforward.py`, tests in
`src/test_dc_walkforward.py`, all passing.

**It did not finish in ten minutes on the first attempt, and the fix was
structural.** L-BFGS-B has no analytic gradient here, so it finite-differences:
35 clubs is 72 parameters, hence 73 likelihood evaluations per gradient step,
each looping every match in Python. The likelihood is now vectorised with numpy
(`_FitArrays` + `_neg_ll_fast`), with the scalar `log_likelihood` kept as the
readable reference.

**>10 min (never finished) → 55.8s.** A test asserts the two paths agree to 1e-6
across every rho and xi combination, because a speed change that alters the
answer is a bug, not an optimisation.

**Real EPL walk-forward, held out 2024+:**

```
964 matches scored, 0 skipped thin
87 refits in 55.8s (0.64s each), 0 hit the iteration cap
training set grew 3,236 -> 4,199 matches
log-loss 1.02749   top-pick accuracy 49.5%
```

Three-way log-loss, so the references are ln(3) = 1.0986 for uniform and ~1.066
for always predicting the base rates. The model beats both — it has real signal
before any hyperparameter is fitted, which is more than Phase 2's Elo could say
at the same stage.

**3.2's flagged question is answered.** `home_advantage` fitted to **0.198** over
the full 2015-2026 history against **0.133** on 2023-25 alone. Premier League
home advantage really has declined since 2020 — the low value was a real effect,
not a broken term. **This is a direct argument for fitting `xi` in 3.4:** time
decay would down-weight the older, higher-home-advantage seasons rather than
averaging across a structural break.

**The harness's tests are all about leakage**, since leakage is the failure that
makes every downstream number better and meaningless: a match is predicted by a
fit trained STRICTLY BEFORE its own date (not "on or before", which lets a
same-day fixture inform itself; not "before the last refit", which would include
matches played in between); out-of-order input raises; and thin history is
skipped rather than scored on a meaningless fit.

Warm starting is verified to be a speed measure only — cold and warm runs agree
to 0.0000 — and the harness reports `refits_hitting_cap` so non-convergence
cannot hide behind it.

**Cost note for 3.4:** 0.64s per EPL refit at 3,200-4,200 training matches.
MLS is larger on both axes (6,395 matches, 31 clubs) and 3.4 must also sweep
`xi`, which multiplies the whole walk-forward by the number of candidate values.
Budget for that rather than discovering it mid-run — this step already cost one
timeout by not doing so.

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

**RESULT — fitted 2026-09-04, `fit_soccer_dc.py`.** Three windows, because `xi`
is a hyperparameter: history <2022, **SELECT 2022-2023** (where xi is chosen),
**HELD OUT 2024+** (which chose nothing).

**Time decay earns its place, independently, in both leagues:**

| | no decay | fitted `xi=0.002` | delta |
|---|---|---|---|
| **EPL** | 1.02771 / 49.5% | **0.98837 / 52.0%** | −0.0393 |
| **MLS** | 1.08094 / 44.4% | **1.05787 / 46.6%** | −0.0231 |

Both leagues chose `xi = 0.002` (347-day half-life) **independently, and in the
interior of the sweep** — worse on both sides, not at an edge. That is Phase
2.4's bounds check passing rather than being skipped. No fitted parameter sits
at a bound; 0 of 87 EPL and 0 of 94 MLS refits hit the iteration cap.

`home_advantage`: **EPL 0.185, MLS 0.241.** MLS higher, as continental travel
predicts — the reason the plan fits the leagues separately rather than sharing
one parameter set. `rho`: EPL −0.0755, MLS −0.0431, both comfortably inside
[−0.25, 0.25].

Three-way references: ln(3) = 1.0986 uniform, ~1.066 base rates. EPL at 0.98837
clears both. **MLS at 1.05787 clears uniform but only roughly matches base
rates** — a much weaker result, and worth remembering when reading 3.5.

**A defect found and fixed: the fit was ill-posed for stale clubs.** Under a
347-day half-life a long-relegated club carries ~0 decay-weighted matches, so
its two parameters are unconstrained. Before shrinkage EPL's "strongest" club
was **Hull at +3.64** and its weakest **Coventry at −4.99**, against Arsenal at
+1.21. L2 shrinkage toward the league mean (`L2_PENALTY = 0.05`) is the
principled fix — an unconstrained club goes to the mean, the honest estimate for
a club with no recent evidence — and it halved the extremes.

Adding it broke the fast-vs-scalar agreement test, correctly: the penalty
belongs to the OBJECTIVE, not the likelihood. It is now an explicit term with
`l2=0` used for the comparison, because a likelihood with a prior silently baked
in is one nobody can check.

**Shrinkage alone did not fix the ranking, and the measurement says it need
not.** Hull still ranked above Arsenal on ~6 recent matches. Measured: 12 EPL
clubs sit under 10 effective matches (Middlesbrough 0.0, Stoke 0.1, Swansea
0.1). They appear in **39 of 964 held-out fixtures (4.0%)**, and held-out
log-loss is BETTER including them (0.98837) than excluding them (0.99632) —
those fixtures are lopsided and easy to call. MLS has exactly one such club
(Chivas USA, defunct) and **zero** affected fixtures.

So it was a REPORTING problem, not a prediction one, and the fix is to stop the
table lying: strongest/weakest now rank only clubs with >= 10 effective matches
and name the rest as too thin to rank. **The model was not bent to chase a
cosmetic symptom.**

**Per year (held out), EPL:** 2024 0.96086, 2025 0.97199, **2026 1.06512**. The
2026 figure is 214 matches of a partial season and is meaningfully worse than
either full year. Sample size or real drift — per-year reporting exists so it
cannot hide in a pooled average, and 3.5 should check whether the same gap
appears against the market.

**Per outcome, mean P(assigned to the actual result):** EPL home 0.475, draw
0.238, away 0.386; MLS home 0.473, draw 0.250, away 0.290. The draw sits near
its base rate (24-25%) in both leagues rather than being systematically crushed,
which is the failure Poisson models usually show — but 3.5 gates draw
calibration separately regardless, because "near the base rate" is not
"calibrated".

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

**RESULT — run 2026-09-04, `ship_gate_soccer.py`. GATE 1 FAILED, both leagues.
DO NOT SHIP — but this is a far closer result than Phase 2.**

| | n | model | market | model − market | t |
|---|---|---|---|---|---|
| EPL vs **pinnacle** | 774 | 0.97210 | **0.94904** | +0.02305 | **+3.05** |
| EPL vs marketavg | 964 | 0.98837 | **0.96654** | +0.02184 | **+3.32** |
| MLS vs **pinnacle** | 1,047 | 1.05432 | **1.02813** | +0.02619 | **+4.37** |
| MLS vs marketavg | 1,375 | 1.05493 | **1.02300** | +0.03193 | **+6.10** |

**The market still wins, but by roughly a sixth of tennis's margin.** Phase 2.5
lost at t=+20.68; Dixon-Coles loses at t=+3.05. That is a real improvement from
a richer model, and it is the strongest argument so far that the engine — which
Phases 4 and 5 reuse — is worth having even though this gate failed.

Both benchmarks are reported for the same reason as 2.5: beating a soft one
while losing to the sharp one would be a result manufactured by choosing the
benchmark. Pinnacle and marketavg agree.

**Calibration was fixed first, so the failure is conclusive rather than
premature.** Temperature scaling fitted on the SELECT window only:

- EPL `T = 1.04` — the model is already nearly calibrated in this sense.
  Recovered **−0.00009** of a 0.02167 gap. Nothing.
- MLS `T = 1.34`. Recovered **0.00204** of 0.03192 — 6%.

Per-bucket calibration was out of tolerance on home and away (EPL worst gap
0.054, MLS 0.088) while the **draw was the best-calibrated outcome in both
leagues** (EPL 0.033, MLS 0.023). That is the opposite of the expected Poisson
failure and is the reason 3.5 gates the three outcomes separately: an aggregate
would have hidden which outcome was actually mis-priced.

**CLV — the project's first real time-based measurement.** EPL pinnacle carries
opening prices on 100% of 12,030 rows, so this is genuine open-to-close
movement, not tennis's cross-sectional substitute:

```
n = 774   mean CLV −0.00092 (de-vigged probability)   SE 0.00104   t = −0.88
```

**The line does not move toward the model's picks.** If the model held
information the market lacked, the close would drift its way. It does not — flat
to slightly negative, indistinguishable from zero. This is independent
confirmation of gate 1 from a completely different measurement, and it is the
cleanest evidence in either phase.

MLS has zero opening prices on every benchmark book, so it is beat-the-close
only. **Not averaged with EPL.**

**ROI at `marketmax` — the monotonicity signature again:**

```
EPL   0% edge  1,417 bets   −0.01%      MLS   0% edge  2,184 bets   −6.27%
      2% edge    968 bets   −4.53%            2% edge  1,403 bets  −11.57%
      5% edge    486 bets  −11.28%            5% edge    684 bets  −13.71%
```

EPL is essentially break-even betting everything and gets steadily worse as the
edge filter tightens — the same signature Phase 2.5 found, and the same
conclusion: the model's most confident disagreements with the market are its
worst bets. The 10% rows (EPL −6.04% on 144 bets, MLS +0.88% on 218) are noise
at that sample size and should not be read as a reversal.

**What Phase 3 achieved.** A scoring-rate engine that Phases 4 and 5 reuse, a
rolling-refit harness with the leakage rule enforced in code, the project's
first genuine CLV measurement, and a club-identity fix that removed 400 EPL and
604 MLS duplicate matches. The model closed most of the distance to the market
that Elo could not — and still lost.

**Decision required before Phase 4.** The plan's exit gate says gate 1 decides,
so shipping as-is is not available. Either accept that a pure scoring-rate model
does not beat a soccer closing line and carry the engine into NHL (Phase 4),
where the market is thinner and the same engine may fare better, or extend the
soccer model with what the market has and this does not.

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

### Phase 4 — NHL · the first prop model, and a game model with a real constraint

**Why NHL, and why the ORDER IS REVERSED from the original plan.** Phases 2 and
3 were the only two phases with no props, and both lost their gate against the
two most efficient markets in the project — tennis at t=+20.68, EPL soccer at
t=+3.05. The evidence says game lines in liquid markets are a hard target and
props are where both the softer market and this project's data advantage
actually sit. **So 4b (props) is promoted ahead of 4a (game model), and the two
are explicitly decoupled: the prop model does not depend on the game model, and
a game-line failure must not block it.**

#### Verified data (measured 2026-09-04, not carried from the audit)

| | |
|---|---|
| Games | **24,889**, 2007-09-29 → 2026-06-15, 100% scored, **0 ties** |
| Home win rate | **54.3%** — the highest in the project; the home term is earned |
| Sources | `sbr` 18,204 (2007-2022), `espn_core` 6,685 (2021-2026) |
| Player rows | **724,002**, 3,119 athletes, 2010-2026 |
| `toiMinutes` coverage | **100.0%** (724,002 of 724,002) |
| Other player stats | `sog`, `goals`, `assists`, `points`, `hits`, `blockedShots`, `shifts`, `pim`, `plusMinus`, `giveaways`, `takeaways` |
| Shot events | 177,961 rows with `period`, `period_seconds`, `x_coord`, `y_coord` — **2024-09 → 2025-06 only** |
| Prop lines | one season, 2025-10 → 2026-06 |

**The defining asymmetry of this phase: training data is sixteen years deep,
evaluation data is one season.** 724,002 player-games to learn rates from, but
only ~7,918 shots-on-goal lines to test against. Every sample-size decision
below follows from that, and it is the opposite shape to Phases 2 and 3.

---

#### 4.1 — Team identity: canonicalise, de-duplicate, exclude non-clubs **[BLOCKER]**

**The same defect Phase 3.1 found, and worse.** 84 distinct team names for a
32-team league, because two sources overlap with different conventions:

```
sbr        city only:   'Boston'        'Anaheim'       'Arizona'   'Arizonas'
espn_core  full name:   'Boston Bruins' 'Anaheim Ducks' 'Arizona Coyotes'
```

`sbr` runs 2007-2022, `espn_core` 2021-2026, and **1,316 espn_core rows fall
inside sbr's range** (2021-01 → 2022-11). A raw-name duplicate check finds only
8 groups — the same trap as soccer, where canonicalisation revealed 4x more.

Three distinct problems, not one:

1. **Two conventions**, as above.
2. **`'Arizonas'` — a typo variant** of `'Arizona'` inside a single source.
   Fuzzy matching would catch this one and merge Manchester clubs elsewhere; the
   explicit map catches it safely.
3. **INTERNATIONAL TEAMS.** `espn_core` carries `'Canada'` and `'Finland'` —
   the 4 Nations Face-Off, February 2025. These are not NHL clubs and must be
   excluded exactly as soccer's `MLS All-Stars` were. A tournament of national
   sides tells you nothing about club strength.

Relocations are a real modelling question, not a mapping one: `'Atlanta'`
(Thrashers, moved to Winnipeg in 2011) and Arizona → Utah (2024) are the same
franchise but arguably not the same team. **Decide and record whether a
relocation keeps its rating**, rather than letting the name map decide silently.

**Deliverable:** explicit map, exclusion set, source precedence, and a
re-runnable audit in the shape of `audit_soccer_duplicates.py` — including the
injectivity test, because a typo merging two real franchises is this step's own
failure mode reintroduced by its fix.

**Done when:** 84 names resolve to the right franchise count, zero duplicates
survive canonicalisation, the odds side closes with no orphans, and the audit
re-runs clean.

**RESULT — done 2026-09-04.** `src/predict/nhl_teams.py` (map + loader),
`src/test_nhl_teams.py`, `audit_nhl_duplicates.py` (re-runnable, exit 0).

**A FULL TABLE SCAN CAME FIRST**, after a Phase 3 correction where soccer was
described as score-only while 168,803 player rows sat unused. All 55 tables were
swept for NHL data:

| table | NHL rows | |
|---|---|---|
| `player_game_history` | 724,002 | the prop foundation, `toiMinutes` 100% |
| `odds_import_staging` | **333,189** | **not previously known** — pre-resolution staging, 3 markets, 24 books, 2007-2026 |
| `odds_archive` | 330,930 | |
| `nhl_shot_events` | 177,961 | `period`, `x_coord`, `y_coord` — one season |
| `prop_odds_archive` | 68,880 | |
| `game_result` | 24,889 | |
| `team_elo_history` | 2,996 | |
| `athlete_crosswalk` | 864 | |
| `injury_report` | **226** | **live snapshot only** — 96 athletes, 2026-09-01..09-04 |
| `venue_factors` | 64 | `goals` only, 33 teams, factors 0.842-1.169 |

Two of those change later steps. **`injury_report` is a four-day live snapshot,
not history** — usable for serving, useless in a backtest, so no NHL step may
plan a walk-forward around it. And **`venue_factors` carries a `stat_key`
column but only `goals` for NHL**; extending it to `sog` would capture the
documented arena scorer-bias in shot counting, which bears directly on 4.5.

**The identity problem was worse than soccer's.** 84 names for a 32-team league,
from three distinct causes rather than one:

- **Two conventions** — `sbr` city-only (2007-2022) vs `espn_core` full names
  (2021-2026), overlapping on 1,316 rows.
- **Whitespace and typo variants inside ONE source** — `LosAngeles`,
  `NewJersey`, `NYRangers`, `NYIslanders`, `SanJose`, `St.Louis`, `TampaBay`,
  `WinnipegJets`, three spellings of Seattle, and `Arizonas`.
- **Eight entities that are not clubs** — `Canada`/`Finland`/`Sweden`/`USA`
  (2025 4 Nations Face-Off) and `Team Hughes`/`MacKinnon`/`Matthews`/`McDavid`
  (All-Star Game rosters). 9 games excluded.

**Franchise continuity, decided and recorded:** Phoenix → Arizona → Utah Hockey
Club → Utah Mammoth is ONE franchise, as is Atlanta → Winnipeg. A relocation
carries the roster, and the roster is what the rating describes. Canonical form
is the CURRENT identity so history flows into the team that exists today.

**THE AUDIT CAUGHT A BUG IN ITS OWN DE-DUPLICATION RULE, and this is the
finding worth carrying forward.** It flagged 6 duplicate groups that disagreed
on the score. Soccer's equivalent had zero, so the instinct was that two sources
contradicted each other. They did not — **all six were the SAME source, and all
six were two DISTINCT games sharing a date**:

```
2021-01-31  Carolina v Dallas   espn_core 4-1  event_ref 401272220
2021-01-31  Carolina v Dallas   espn_core 4-3  event_ref 401272230
```

All in the COVID-shortened 2020-21 season. **`(date, home, away)` is not a
unique key for NHL**, and collapsing on it would have silently deleted eight
real games and called it de-duplication. The loader now keeps one row per
distinct `event_ref` within a date/team group, and the audit distinguishes "two
real games" from "a genuine conflict" instead of flagging both.

**Loaded result:** 24,758 games, **exactly 32 franchises**, 2007-09-29 →
2026-06-15, home win 54.3%. **Zero orphans** on `odds_archive` (76 raw names)
AND `odds_import_staging` (86) — the map closes on every table that carries a
name.

**The test invariant had to differ from soccer's.** `test_soccer_teams` asserts
injectivity — no two aliases may share a target — but six NHL names map to
`Utah` on purpose, and every franchise legitimately carries both an espn full
name and an sbr whitespace variant. So counting collisions proves nothing. The
invariant that holds: **every alias is either a spelling variant of its own
canonical or a declared franchise merge.** That still catches a typo mapping
`Boston Bruins` to `Buffalo`, which a collision count would not.

#### 4.2 — The regulation-vs-final decision **[the plan's premise is not available]**

The original plan says to *"model the 60 minutes, then add the tie case
separately"*, and that is the right model — overtime and shootouts are near
coin-flips unrelated to team strength, so folding them into ratings feeds
noise in as skill.

**But regulation scores are not in the data.** `game_result` holds FINAL scores
only, which is why it shows **0 ties across 24,889 games**. Regulation score is
derivable only from `nhl_shot_events` (it carries `period`), and **that table
covers one season: 2024-09 → 2025-06.**

So the choice is explicit and must be made before any fitting:

- **(a) Model final results** over all 24,889 games, accepting that ~23% of NHL
  games are decided in OT/shootout and that noise enters the ratings.
- **(b) Model regulation** over one season only — correct target, ~1,300 games.
- **(c) Model final results but DOWN-WEIGHT one-goal margins**, as a cheap proxy
  for the empty-net and OT distortion, over the full history.

**Recommendation: (a) with the empty-net caveat recorded, then test (c).** (b)
trades a 19x sample reduction for a cleaner target and will not support a
walk-forward.

**The empty-net trap has the same shape.** A team trailing by one pulls its
goalie; those goals happen because of the score, not because a team is better.
Identifying them also needs shot events, so it too is only possible on one
season. Record it as a known bias in (a) rather than pretending it is handled.

**Also verify a stale claim:** the plan lists `ingestNhlShotsJob` as *never
run*, yet 177,961 shot rows exist for 2024-25. Establish what populated them and
whether it still runs, before depending on that table for anything.

**DECISION — made 2026-09-04 on measurement, not principle: MODEL FINAL SCORES
over all 24,758 games. Option (a).**

**What was measured first:**

| | |
|---|---|
| Games reaching OT/shootout | **308 of 1,503 — 20.5%** |
| NHL moneyline shape | **2-way** (67,027 home / 67,030 away, no draw side) |
| Regulation goals/game | 5.89 |
| Goals with NULL `goalie_id` | 597 of 9,258 — **6.4%** |
| ...in the last 2 min of period 3 | **437** — the empty-net signature |
| Games with shot events | **1,503** (2024-09 → 2025-06) |

**The argument that settles it: the market prices the FINAL result.** The NHL
moneyline is two-way with no draw side, because after OT and a shootout every
game has a winner. A regulation model answers a different question than the one
the market is asking, so its probabilities could not be compared to the price
without an OT model bolted on afterwards to convert them.

**And the OT noise is SYMMETRIC.** A shootout is close to a coin flip, which
means the market cannot predict it either. Those 20.5% of games compress the
edge available to anyone, but they do not put this model at a relative
disadvantage — which is the only thing that matters when the gate is "beat the
close". Modelling regulation would remove noise from our side of a comparison
whose other side still contains it.

Sample weight decides the rest: **24,758 games against 1,503** is a 16x
advantage, and option (b) could not support a walk-forward at all.

**Two biases accepted, recorded, and quantified rather than waved at:**

1. **20.5% of results carry coin-flip information.** Ratings will absorb some
   OT/shootout outcomes as if they were skill. Irreducible under option (a).
2. **~4.7% of goals are late empty-netters** (437 of 9,258). A team trailing by
   one pulls its goalie, concedes, and the margin reads 2 instead of 1 — which
   inflates the winner's attack and deflates the loser's defence for reasons of
   game state, not strength. Identifiable ONLY on the 1,503-game shot-events
   window, so it cannot be corrected across the full history.

**A cheap validation is available and named here so it is not forgotten.** On
the 1,503 games that DO have shot events, regulation scores can be reconstructed
(`period <= 3`) and empty-netters removed (`goalie_id IS NULL` late in period
3). Fitting a regulation-target model there and comparing it to the final-target
model on the same games would show whether the two biases cost anything real. It
is 1,503 games, so it can only detect a large effect — worth running if 4.4
fails narrowly, not worth blocking on now.

**`ingestNhlShotsJob` provenance: RESOLVED, and the plan's claim was stale.**
It is listed as *never run*, but a run breadcrumb exists at
`python-harness:job-run:ingestNhlShotsJob`, **2026-09-05 01:45:43** — it is
scheduled and running. What it does not do is backfill: coverage is 2024-09 →
2025-06 only, which is why every shot-event-dependent option above is limited to
one season. That is a lookback limitation, not a missing job.

#### 4.3 — Game model: reuse the Dixon-Coles engine

`predict/dixon_coles.py` already does this — attack, defence, home advantage,
low-score correction, time decay — and needs no changes for hockey beyond
recognising that goals-per-game is ~3 rather than ~1.4.

Reuse `dc_walkforward.py` unchanged. Refit weekly. Fit `xi` on a SELECT window
that excludes the held-out years, exactly as 3.4 did.

**Home advantage should come out high** — NHL's 54.3% is the largest in the
project — which doubles as this phase's leakage check.

**Done when:** walk-forward completes, every parameter is verified off its
bounds, and the strongest/weakest clubs are recognisable to someone who follows
the sport.

**RESULT — fitted 2026-09-04, `fit_nhl_dc.py`.** The Dixon-Coles engine was
reused unchanged for hockey; only the draw handling is NHL-specific and lives in
the fit script, not the shared engine.

| | log-loss | brier | acc |
|---|---|---|---|
| no decay | 0.69075 | 0.24878 | 53.6% |
| **fitted `xi=0.004`** | **0.67390** | 0.24060 | **57.2%** |

References for a two-way market: ln(2) = 0.6931 for a coin flip, and **0.6893
for always predicting the 54.3% home base rate.** The undecayed model (0.69075)
is WORSE than the base rate — it adds nothing. With decay it clears it by
0.0154. **Time decay is not a refinement here; it is the entire contribution.**

`xi = 0.004` (173-day half-life) sits in the INTERIOR of a monotonic, unimodal
sweep — 0.68950, 0.66901, 0.66363, **0.66225**, 0.66577, 0.67835 — with 0 of 169
refits hitting the iteration cap. Decay is roughly twice as fast as soccer's
0.002, which is what a compressed season with more roster churn should produce.

**THE DRAW DOES NOT TRANSFER, and handling it is the one NHL-specific piece.**
An NHL final score never ties, so the model's `P(draw)` is not a draw
prediction — it is a prediction that the game REACHES overtime, and it must be
split to answer the two-way question the market asks. `P_OT_HOME = 0.5` is a
**deliberate non-measurement**: `nhl_shot_events` keys games by NHL API id
(`2024010001`) while `game_result` uses ESPN's (`401685327`), no crosswalk
exists, and bridging on (date, team pair) resolves only 473 of 1,503 games — a
subset visibly biased at 59.8% home wins against the true 54.3%. An OT split
from it (62.1%, n=87) would describe the join, not hockey.

**A REAL BUG IN THE SHARED ENGINE, found because NHL broke an accident.** The
first fit returned `rho` pinned at +0.2500 — and at hockey rates that gives
`tau(0,0) = 1 - 9.5(0.25) = -1.37` and a score matrix with **P(0-0) =
-0.00289**. A negative probability.

It hid because NHL final scores are never tied: no 0-0 row exists, the `m00`
mask is empty, and the likelihood never evaluated `tau(0,0)` at all. Soccer never
exposed it because 0-0 is common there, so the constraint was enforced
incidentally. **The engine was correct by accident for two phases.**

**The first fix made it worse, and that is worth recording.** Rejecting invalid
`rho` with a `1e18` return is a DISCONTINUITY, and L-BFGS-B is gradient-based:
`exp()` overflowed, 13 of 169 refits hit the cap, the sweep went non-monotonic,
and decay appeared to make held-out WORSE. Every one of those symptoms was the
fix, not the sport. Replaced with a **box constraint derived from the sport's own
scoring rate** and passed to the optimiser via `bounds=`:

```
soccer_epl  1.55/1.27 goals per side  ->  rho box [-0.2500, +0.2279]
soccer_mls  1.71/1.21                 ->  rho box [-0.2500, +0.2170]
nhl         3.04/2.78                 ->  rho box [-0.1478, +0.0532]
```

Soccer is unaffected — its fitted values (-0.0755 EPL, -0.0431 MLS) sit far
inside.

**AND THE BOUNDS CHECK ITSELF WAS WRONG.** It reported "no parameter is at a
bound" while `rho` sat at **+0.05316 against a box maximum of +0.0532** —
because it compared against the GLOBAL cap (+-0.25) rather than the box that
actually binds. Phase 2.4's lesson recurring inside the check written to catch
it. Now fixed to test the binding box.

**So `rho` IS pinned, and what it is doing is informative.** `tau(1,1) = 0.947`
suppresses 1-1 — a scoreline NHL never records. The low-score correction is being
pressed into service to fight a diagonal that tie-free data never shows, and it
saturates because tau touches only four cells rather than the whole diagonal.
Probabilities stay valid (`tau(0,0) = 0.551`), but **rho is not freely fitted and
should not be reported as though it were.** This is the structural cost of 4.2's
decision to model final scores, now measured rather than anticipated.

**Team rankings are credible; the LEVELS are not meaningful.** With mean-attack
pinned to zero and no intercept, the defence terms absorb the league scoring
rate, so `attack + defence` sits near `-log(3) = -1.1` for every club. Read it as
an ordering only:

- strongest — Colorado, Carolina, Tampa Bay, Buffalo, Dallas
- weakest — Seattle, Calgary, San Jose, Chicago, Vancouver

San Jose and Chicago at the bottom is right for this window. **Buffalo at fourth
is the outlier** and worth a second look in 4.4 — at a 173-day half-life the fit
is dominated by a short recent window, which can flatter a hot streak.

**Per year (held out):** 2024 0.66138, 2025 0.68206, 2026 0.68211. The 2026 row
is 768 games of a partial season.

#### 4.4 — Game ship gate

Identical discipline to 3.5: beat the de-vigged close on log-loss, paired and
out of sample, against the sharpest available book AND a consensus; calibration
fixed and re-measured before any failure is declared; ROI swept by edge with the
monotonicity check.

**Expect this to fail, and let that be cheap.** Two phases of evidence say
ratings-only models lose to liquid closing lines. It is run because the engine
is already built and the marginal cost is a few hours, not because it is likely
to pass. **It must not gate 4.5.**

**RESULT — run 2026-09-04, `ship_gate_nhl.py`. GATE 1 FAILED — by the smallest
margin in the project — but GATE 3 RETURNED THE FIRST POSITIVE CLV.**

| | n | model | market | model − market | t |
|---|---|---|---|---|---|
| vs consensus | 3,600 | 0.67365 | **0.66438** | +0.00927 | **+5.07** |
| vs `espnbet` | 2,601 | 0.66889 | **0.65934** | +0.00956 | +4.43 |

Accuracy: model 57.3% against consensus 58.9%.

**The gap is the smallest yet — 0.0093, against soccer's 0.0218 and tennis's
0.0330.** The t-statistic is higher than soccer's only because n is nearly four
times larger; in effect size this is the closest a model has come.

**GATE 3 — CLV IS POSITIVE AND SIGNIFICANT, the first time in this project:**

```
n = 2,601   mean CLV +0.00160   SE 0.00057   t = +2.81
```

**The line moves TOWARD the model's picks after they are made.** Tennis had no
opening prices at all; EPL soccer measured −0.00092 (t=−0.88), indistinguishable
from zero. This is different in kind: the model holds information the OPENING
line does not.

**But it must be squared with gates 1 and 4, and the reconciliation is the
finding.** The model beats the OPENING line's direction while still losing to
the CLOSING line's accuracy. Both are true, and together they say: the model is
picking up the same signal sharp money does — it moves the same way — but less
of it than the close eventually accumulates.

**The magnitude settles what that is worth.** +0.0016 in probability is about
0.16%, against a hold of roughly 4-5%. A real edge against the open, an order of
magnitude too small to pay for the vig. Which is exactly what gate 4 shows:

```
edge  0%   3,600 bets    −0.51%
edge  2%   2,503 bets    −2.03%
edge  5%   1,130 bets    −4.64%
edge 10%     222 bets   −15.09%
```

Monotonically worse as the filter tightens — the same signature as tennis and
soccer. Positive CLV does not rescue a negative ROI when the CLV is a tenth the
size of the margin.

**Calibration was fixed first, so the failure is conclusive.** Temperature
scaling fitted on the SELECT window only: `T = 1.06`, recovering **0.00024 of
the 0.00923 gap — 2.6%**. Consistent with tennis (3%) and soccer (0-6%): the
deficit is information, not calibration.

**A leakage trap caught before it did damage.** `espnbetliveodds` carries 1,756
held-out events — more than draftkings — and they are IN-GAME prices that
already know the score. 3,694 such rows were dropped before anything was
computed. Including them would not have produced a weak benchmark; it would have
produced a superhuman market and a hopeless model, and the number would have
looked plausible.

**Two structural caveats on the benchmark itself.** NHL has **no `pinnacle` and
no `marketavg`/`marketmax`** — soccer's benchmark books do not exist in this
sport, so the consensus is built from whatever books cover each game, and the
**median is 1 book per game**. A one-book "consensus" is just that book. The
`espnbet` comparison (2,601 events, t=+4.43) is the cleaner of the two and
agrees. Separately, `sbrconsensus` — 35,750 rows at 100% opening coverage — ends
in 2022-11, before the held-out window, and would be the better benchmark if the
window ever moves earlier.

**Does not block 4.5.** The plan decoupled the prop model from the game model
precisely so this result could not stop it, and nothing here changes that.

#### 4.5 — Prop engine, built and proven on shots on goal **[the real objective]**

**This step builds the ENGINE, on one market. 4.8 extends it to the other
five** — volume x rate x shape is market-agnostic, and the whole reason to build
it properly is that swapping which stat it projects covers the rest.

**Why shots on goal first**, and it is not availability — Total Goals has more
rows. It is that shots are **high-volume and ice-time-driven**, so the estimate
rests on a rate that can actually be measured, where a 0.5-goal line is close to
a coin flip on a bounce.

**Three ingredients, in order of importance:**

- **Volume** — projected time on ice. `toiMinutes` is present on 100% of
  724,002 rows, which is why NHL is the right first prop sport.
- **Rate** — shots per minute, from the player's own history, **shrunk toward
  his position's mean by a sample-size weight**. A fourth-liner with three
  games must not carry a superstar's rate because of one good night.
- **Shape** — turning an expectation into P(over the line). Shots are
  overdispersed relative to Poisson, so use a negative binomial and fit the
  dispersion rather than assuming it.

**THE JOIN OFFSET.** NHL props join `player_game_history` at **−1 day**: ESPN
stamps UTC, the NHL API reports local time. Joining at zero silently loses ~35%
of the data. **Assert this in code with a row-count check**, do not leave it as
a comment — a 35% silent loss is exactly the kind of thing that looks like a
weak model rather than a broken join.

**RESULT — built 2026-09-04.** `src/predict/nhl_props.py` (engine + loader),
`src/test_nhl_props.py`, all passing.

**THE JOIN WAS THE HARD PART, AND THE PLAN'S DESCRIPTION OF IT WAS INCOMPLETE
IN A WAY THAT WOULD HAVE BLOCKED THE WHOLE STEP.**

The plan says NHL props join `player_game_history` at −1 day, and that joining
at zero silently loses 35%. Both halves are true. Neither is sufficient, because
**there is no direct join at all**:

```
prop_odds_archive.athlete_id    ESPN id      '2273'
player_game_history.athlete_id  NHL API id   '8470621'
```

Measured: a direct join returns **ZERO rows at every offset from −2 to +2**.
`athlete_crosswalk` is the bridge, resolving 864 of 885 prop athletes (97.6%),
and `prop_odds_archive.athlete_name` is NULL on every NHL row so there is no
name fallback. Only once the crosswalk is in place does the date question exist
at all — and then the plan's −1 is confirmed exactly: **4,169 rows (52.7%) at −1
against 2,709 (34.2%) at 0**, the ~35% loss it warned about.

**A fixed offset is still not the best rule.** Over the 7,863 resolvable rows:

| | rows | |
|---|---|---|
| game on BOTH −1 and 0 (ambiguous) | 761 | 9.7% |
| only −1 | 3,408 | 43.3% |
| only 0 | 1,948 | 24.8% |
| NEITHER — player did not play | 1,746 | 22.2% |

An **unambiguous** rule — −1 where only −1 exists, 0 where only 0 exists, drop
where both do — yields **5,356 usable rows (68.1%)** against a fixed offset's
4,169. The 9.7% ambiguous are dropped rather than guessed: an NHL player plays
every ~2 days, so choosing between two adjacent games would silently attach the
wrong outcome, which is worse than a smaller sample. The 22.2% who did not play
are not a defect — a prop is posted before the lineup is known, and a scratched
player has no shot count to score either way.

**WHY THERE IS NO EXACT JOIN, and it is the same gap as 4.3.**
`prop_odds_archive.event_ref` matches `game_result.event_ref` on **100%** of
rows, and `player_game_history` carries an `event_id` on 100% of its 724,002
rows — but that column is the NHL API's game id (`2025021311`) while `event_ref`
is ESPN's (`401801798`). **This database has an athlete crosswalk and no game
crosswalk.** The same gap blocked 4.3's overtime measurement (only 473 of 1,503
games bridged, and that subset biased). **Building one is the single
highest-value piece of plumbing NHL is missing** — it would give an exact prop
join, the empty-net correction 4.2 had to accept as a known bias, and the xG
model flagged as this phase's strongest future candidate.

**Loaded result:** 5,356 usable rows, 346 players, 2025-10-07 → 2026-04-16.
**0 goalies dropped** — no goalie carries a shots-on-goal prop — and 0 rows
missing stats. Mean actual SOG 2.27 on 18.9 minutes (league rate 0.1202/min),
and an actual over rate of **51.5%**, which is what a balanced market should
produce.

Lines are concentrated: 1.5 (2,891), 2.5 (2,050), 3.5 (342), 0.5 (66), 4.5 (7).

**End-to-end sanity, strictly-before-only, players with >= 5 prior games:**

```
projected 1-2  ->  n=  734   mean actual 1.80
projected 2-3  ->  n=2,694   mean actual 2.28
projected 3-4  ->  n=  441   mean actual 3.28
correlation(projection, actual) = 0.2560
```

Cleanly monotonic. The correlation is modest because single-game shot counts are
dominated by variance; the bucket ordering is the more informative check. **Mean
projected 2.410 against mean actual 2.306 — a 4.5% over-projection** that 4.6
should address rather than leave to calibration.

**The tests target what would look plausible while being wrong.** The negative
binomial is checked against `scipy.stats.nbinom` rather than against itself — a
subtly wrong recurrence still returns values in [0,1] and nothing downstream
would notice. Shrinkage is asserted to actually shrink (2 games at 0.25/min
gives 0.1417, near the league's 0.12; 44 games gives 0.2261, near its own rate),
because a weight that silently resolved to 1 would make the model most confident
exactly where it has least evidence. And a large dispersion is asserted to
reduce to Poisson — the null the shape parameter has to beat.

#### 4.6 — Prop walk-forward and fit

Same no-leakage rule as 3.3: a player's projection uses only games played
**strictly before** the match date. Chronology asserted in code.

**The sample-size decision must be made here, up front.** Training is sixteen
years deep; evaluation is ~7,918 shots-on-goal lines from one season across 423
players. Decide before running what effect size would be believable at that n,
because a promising ROI inside its own confidence interval is not a result.
Phase 2.5's ROI table is the cautionary example — the 10% row looked positive
and was noise at n=144.

**RESULT — fitted 2026-09-05, `fit_nhl_props.py`.**

**The sample-size decision was made BEFORE running**, as the plan requires:
cutoff 2025-11-08, **SELECT 1,558 / HELD OUT 2,312**, at which the paired SE of
a log-loss difference is ~0.0007 and **a gap of ~0.0015 is detectable at t=2**.
Anything inside that band is a tie, not a weak signal.

**The split had to sit inside one season.** Prop collection is far narrower than
the date range implies: **5,086 of 5,356 rows (95%) fall in October–November
2025**, December onward nearly empty. There is no second season to hold out.

**Fitted: `toi_window=5`, `shrink_k=10`, `dispersion=4.0`.** Every value sits in
the INTERIOR of its grid — no edge warning fired.

| held out (n=2,312) | log-loss | acc | projection bias |
|---|---|---|---|
| unfitted (all-history TOI, Poisson) | 0.68864 | 54.8% | +2.0% |
| **fitted** | **0.68582** | **55.6%** | +2.1% |
| market (de-vigged, n=2,139) | **0.67414** | | |

Fitting gains 0.0028 held-out — above the 0.0015 detection threshold, so real.
The market sits 0.0117 below the model, also well above threshold. **4.7 tests
that properly; it is shown here only for orientation.**

**THE NEGATIVE BINOMIAL EARNS ITS PLACE, measured rather than assumed.** Poisson
was inside the search as `dispersion = 1e6`, and it is clearly worse:

```
dispersion   2.0:0.68936   4.0:0.68610   6.0:0.68635
            10.0:0.68740  20.0:0.68888   Poisson:0.69121
```

A clean interior optimum at 4.0, with Poisson the worst value on the grid.
Shots on goal really are overdispersed, and modelling them as Poisson costs
0.005 log-loss — more than three times the detection threshold.

**A HYPOTHESIS OF MINE THAT WAS WRONG, and the measurement says so.** 4.5
recorded a 4.5% over-projection, and I attributed it to ice time being a ROLE
that changes within days while an all-season average smooths the change away.
The `toi_window` sweep says that is essentially irrelevant:

```
toi_window   all:0.68627   5:0.68610   10:0.68613   20:0.68627
```

A 0.00017 spread across the whole range — an order of magnitude below the
detection threshold. Recent-form ice time is not what was wrong.

**What was actually wrong was the league fallback constant.** 4.5 used
`LEAGUE_SOG_PER_MIN = 0.13` where the measured rate is **0.12089**, and
computing league constants from the SELECT window cut the bias from +4.5% to
+2.0%. The residual +2.1% survives every parameter setting, so it is not a
tuning problem — most likely a selection effect, since props are quoted on
players expected to play a normal shift and some fraction of them do not.

`shrink_k = 10` has a clear interior optimum (5:0.68731, 10:0.68610, 20:0.68789,
40:0.69119), which is worth noting because it is the one parameter guarding
against a hot callup carrying a superstar's rate.

**No leakage:** every projection uses only games played strictly before the
prop's own game, accumulated in one chronological pass, with the ordering
asserted rather than assumed. League constants are computed from SELECT rows
only — using all rows would have leaked the held-out period's scoring
environment into the model's fallback.

#### 4.7 — Prop ship gate

Same authority order as every gate in this plan: accuracy first, calibration
ruled out, then economics.

**Two-sided props only.** Measured: `Total Shots on Goal` is 74.9% two-sided
with 74.9% carrying opening prices, so most of the sample can be properly
de-vigged. **The Milestone markets are 0% two-sided** — Goals, Points, Assists
and Shots-on-Goal Milestones, ~2,000 rows each, over-only. With no under price
the vig cannot be stripped and any "edge" is partly the margin. **Excluded from
the gate**, exactly as tennis's one-sided props were.

**CLV is available here** — 74.9% of shots-on-goal rows carry opening prices, so
report real open-to-close movement as 3.5 did for EPL, not a substitute.

**RESULT — run 2026-09-05, `ship_gate_nhl_props.py`. GATE 1 FAILED. But gates 3
and 4 are the first positive results in this project, and they point somewhere
the gate was not designed to look.**

**Gate 1 — accuracy vs the de-vigged close: FAILED.**

```
model 0.68337   market 0.67414
model - market  +0.00922   SE 0.00304   t = +3.03   MARKET BEATS
accuracy: model 56.2%   market 58.0%
detectable at t=2: 0.00609   (the gap exceeds it, so the loss is real)
```

**Gate 2 — calibration was badly out and fixing it was not enough.** The
0.3-0.4 bucket predicted 0.363 and delivered 0.469, a +0.106 gap. Temperature
scaling fitted on SELECT only gave `T = 1.58` — a large correction, the model is
materially overconfident — and recovered **+0.00137 of the 0.00922 gap (15%)**.
More than tennis (3%) or soccer (0-6%), and still nowhere near enough:
calibrated, the model still loses at t=+3.28.

**Gate 3 — CLV +0.01696, SE 0.00150, t = +11.33.** An order of magnitude larger
than the NHL game model's +0.00160, and large enough that it was not believed
without a control:

```
unconditional drift toward OVER   -0.00129   t = -0.84   (no systematic drift)
model picks OVER                   46.9%                 (not one-sided)
CLV of an ALWAYS-OVER null        -0.00129
CLV of the model                  +0.01696
model edge over the null          +0.01825
```

So it is not an artefact of lines drifting one way while the model leans that
way. **The model's side selection genuinely predicts which way the line moves.**

**Gate 4 — and here the two results stop contradicting each other.** Priced at
the CLOSE, ROI is negative and degrades as the filter tightens (-5.02% at any
edge to -7.14% above 10%) — the same signature as every previous phase. Priced
at the **OPEN**, it inverts:

| edge | bets | ROI | SE | t |
|---|---|---|---|---|
| 0% | 2,139 | +1.12% | 2.48% | +0.45 |
| 2% | 1,648 | +4.10% | 2.95% | +1.39 |
| 5% | 1,043 | +7.42% | 4.04% | +1.84 |
| **10%** | **445** | **+22.84%** | 7.80% | **+2.93** |

**Monotonically INCREASING** — the first time in this project. Tennis, soccer
and the NHL game model all went the other way, which is the signature of edges
being noise. This is the signature of edges being real.

The two gates are consistent once the timing is explicit: CLV is measured
open-to-close, and gate 4's original form priced bets at the close — *after* the
move it was measuring. Bet at the open, and the movement is captured.

**WHAT THIS DOES AND DOES NOT SAY.** The model is NOT better than the market at
predicting shots on goal — gate 1 says so at t=+3.03, with calibration ruled
out. What it is better than is **the market's FIRST GUESS**, and the market
corrects toward it. That is a real and monetisable distinction, and it is not
the thing this gate was built to detect.

**Caveats that must travel with this result:**

- **One market, one sport, ~7 weeks.** 2,139 held-out rows from a single
  season's Oct-Nov window.
- **The significance rests on the smallest bucket.** n=445 at the 10% threshold,
  ROI +22.84% with SE 7.80% — a 95% interval of roughly [7%, 38%]. Positive
  throughout, but imprecise. Four thresholds were tested, so a Bonferroni-style
  correction puts the bar near t=2.5; +2.93 clears it, but not comfortably.
- **"Bet at the open" is untested as an execution assumption.** Opening prices
  are recorded here, but whether they are obtainable at size, and for how long,
  is not something this data can answer. Limits are typically lowest at open.
- **Gate 1 still failed**, and the plan says gate 1 decides. On the stated
  criterion this does not ship.

**The honest conclusion is that the gate was measuring the wrong thing for this
strategy.** "Beat the closing line on log-loss" tests whether the model knows
more than the market. Capturing line movement from the open tests whether it
knows more than the market's opening estimate — a much lower and, on this
evidence, achievable bar.

#### 4.8 — Extend to the remaining two-sided markets

**Shots on goal proves the machinery; it is not the product.** Volume x rate x
shape is market-agnostic, so once 4.7 shows it clears a gate on one market, the
same engine covers the rest by swapping which stat it projects. Extending BEFORE
4.7 would mean building six markets on machinery not yet known to work.

**Every market maps to a stat we already hold** (measured 2026-09-04, 200-row
sample of `player_game_history`):

| market | prop rows | two-sided | stat | window | verdict |
|---|---|---|---|---|---|
| Total Shots on Goal | 7,918 | 74.9% | `sog` | 10/25-06/26 | **first (4.5)** |
| Total Points | 8,881 | 75.5% | `points` | 10/25-06/26 | **derive, do not fit** |
| Total Assists | 8,768 | 75.2% | `assists` | 10/25-06/26 | good |
| Total Goals | 14,366 | 100% | `goals` | **10/25-12/25** | short window |
| Total Blocked Shots | 2,497 | 72.9% | `blockedShots` | 10/25-06/26 | thin |
| Total Hits | 2,811 | 100% | `hits` | **10/25-12/25** | short window |
| Total PP Points | 6,272 | 71.2% | `powerPlayGoals` only | 10/25-06/26 | **weakest** |
| *Milestones (4 markets)* | ~8,600 | **0%** | — | — | **excluded** |

**Four things this table decides, none of which are obvious from row counts:**

**Points must be DERIVED, not fitted.** A point is a goal or an assist. Fitting
goals, assists and points as three independent models produces three
probabilities that contradict each other — P(points > 1.5) inconsistent with the
goal and assist distributions it is made of. Model goals and assists, then
convolve. This also gets points for free rather than as a third fit.

**Power play points is the weakest case and should be last or dropped.**
`powerPlayGoals` is present, but there is **no power-play ice time and no
power-play assists** in the data. Volume is the first ingredient of the model and
for this market it is missing — a PP points projection without PP minutes is
mostly guessing at which unit a player is on. Do not spend the effort until the
others are done, and record it as data-limited rather than model-limited.

**Total Goals and Total Hits stop in December 2025.** Both show 100% two-sided
and a healthy row count, which makes them look like the best candidates until
you notice the window is three months against the others' nine. That is a
provider dropping the market partway through the season. **A market that is no
longer collected cannot be served**, so establish whether collection resumed
before building either.

**Goalies must be excluded from every skater market.** `player_game_history`
carries goalie rows in the same table, flagged `isGoalie` (~5.5% of rows) and
carrying `saves` / `shotsAgainst` / `powerPlayGoalsAgainst` instead of skater
stats. A goalie's `sog` is not a shot he took. Filter on the flag, and assert the
filtered count rather than trusting it.

**Distributions differ by market and should not be assumed.** Shots, hits and
blocks are overdispersed counts — negative binomial, with the dispersion fitted
rather than assumed. Goals and assists are low-count with most lines at 0.5, so
the distribution matters far less than the rate; getting the expectation right is
nearly the whole job there.

**Done when:** each extended market has its own walk-forward, its own gate result
reported separately (never pooled across markets — a strong shots model would
otherwise hide a broken hits model), and any market that fails is recorded as
failed rather than quietly dropped.

**RESULT — run 2026-09-05, `fit_nhl_props_all.py`. Two of six markets clear the
stats bar, and SHOTS ON GOAL IS NOT ONE OF THEM.**

| market | held out | log-loss | acc | ordering | calib gap | **STATS** | betting |
|---|---|---|---|---|---|---|---|
| **Total Points** | 2,615 | 0.66918 | 58.6% | monotone | **0.013** | **PASS** | market, t=+2.76 |
| **Total Assists** | 2,574 | 0.63674 | 64.8% | monotone | **0.026** | **PASS** | market, t=+2.92 |
| Total Shots on Goal | 2,312 | 0.68582 | 55.6% | monotone | 0.057 | **FAIL** | market, t=+3.03 |
| Total Hits | 849 | 0.68447 | 57.2% | monotone | 0.067 | FAIL | tie, t=+0.77 |
| Total Goals | 5,217 | 0.39835 | 84.9% | monotone | 0.131 | FAIL | market, t=+3.43 |
| Total Blocked Shots | 668 | 0.70100 | 52.7% | **NOT monotone** | 0.160 | FAIL | tie, t=+1.38 |

**A CORRECTION TO THE PHASE 9 REWRITE.** That section states "NHL's
shots-on-goal model clears this bar today." **It does not.** After temperature
correction its worst calibration bucket is off by **0.057** against a 0.05
tolerance — a narrow miss, but a miss, and it was asserted without being
measured against the bar it was being asserted for. **Points and Assists clear;
shots on goal does not.**

**Ordering holds nearly everywhere, calibration is what fails.** Five of six
markets are monotone — higher projections really do produce higher outcomes.
Only Blocked Shots inverts (projected 1-2 → 1.83, projected 2-3 → 1.81), on the
smallest sample (n=668), and it fails the calibration gap badly too (0.160).

**The distribution finding is the useful one for Phases 5-8.** Poisson wins
outright for Points, Assists, Goals and Blocked Shots (`dispersion` fitted to
the 1e6 Poisson limit); only Shots on Goal (4.0) and Hits (2.0) need real
overdispersion. The pattern is volume: **high-count events are overdispersed,
low-count events are not.** 4.6 concluded the negative binomial "earns its
place" from shots alone — true there, and not general. Any market averaging
under ~1 event per game should start at Poisson.

**Total Hits needs `T = 2.57`** — by far the largest correction of any market,
meaning the raw model is severely overconfident there. It still fails the gap
afterwards.

**Two "ties" on the betting bar are low power, not parity.** Blocked Shots
(t=+1.38, n=668) and Hits (t=+0.77, n=849) are the two smallest samples. At
those sizes the test cannot separate a real gap from none; they are unresolved,
not equal.

**Total Power Play Points EXCLUDED, and for a stronger reason than the plan
gave.** The plan called it data-limited for lack of power-play ice time.
Measured, it is worse: the market settles on power-play goals PLUS power-play
assists, and the database carries only `powerPlayGoals`. Mean 0.08 against an
apparent over rate of 7.9% — **the computed outcome is not the outcome the bet
settles on**, so both sides of the comparison are wrong. It cannot be scored at
all, let alone modelled.

**Still unresolved: Points was fitted DIRECTLY, not derived.** 4.8's design says
points must be convolved from goals and assists so the three cannot contradict
each other. Fitted directly it passes the stats bar, but the consistency problem
remains — P(points > 1.5) is not guaranteed coherent with the goal and assist
distributions it is made of. Worth doing before the board shows all three side
by side, where a user could see them disagree.

#### 4.9 — Serving **[not started until 4.7 passes]**

The rule 2.6 established and 3.7 kept: serving is built after a gate passes.

#### What is NOT in this phase

- **No xG model**, despite `nhl_shot_events` carrying real `x_coord`/`y_coord` —
  the only sport in this project where true xG is possible. It covers one season,
  which is too little to fit and test. **Recorded as the strongest future
  candidate**, not as scope.
- No goalie model. No team totals. No multi-market parlay correlation.

#### Exit gate for Phase 4

1. Team canonicalisation complete, internationals excluded, relocation policy
   recorded, audit re-runnable (4.1).
2. Regulation-vs-final decision made and recorded WITH its known bias (4.2).
3. `ingestNhlShotsJob` provenance established (4.2).
4. Game walk-forward complete, parameters off their bounds (4.3).
5. Game gate run and reported — pass or fail, it does not block the props (4.4).
6. Prop model built, the −1 day join asserted by row count, not comment (4.5).
7. Prop walk-forward with no leakage, sample-size threshold agreed in advance (4.6).
8. Prop gate: beats the de-vigged close on two-sided markets, calibration ruled
   out, CLV reported, Milestone markets excluded (4.7).
9. Engine extended to the remaining two-sided markets, each gated and reported
   SEPARATELY, points derived from goals+assists rather than fitted, goalies
   filtered by assertion, and any failing market recorded as failed (4.8).

---

#### 4.10 — The NHL stats board **[the shared surface, plus the first sport]**

**This is what makes Phase 4 finish on a screen rather than in a document.**

Builds the shared surface (board component, render plumbing, compliance strings,
no-edge-language enforcement, betting-board suppression) and lands NHL on it.

**The markets that ship are the ones 4.8 measured as clearing the stats bar:
Total Points (T=1.22) and Total Assists (T=1.07).** Shots on goal, goals, hits
and blocked shots do not clear and are held back — a board that shows an
uncalibrated projection alongside a calibrated one teaches the user nothing
about which to trust.

**It does NOT wait on 4.7.** 4.7 failed its gate and that gate governs the
BETTING board only. Points and Assists clear the stats bar on their own terms —
monotone ordering and calibration gaps of 0.013 and 0.026 after correction.

**Blocked by compliance, not by modelling.** `audit-phase-5.md` records no
privacy policy, no jurisdiction notice and no "not financial advice" disclaimer
anywhere in the app. Those ship first or nothing does.

**Done when:** an NHL shots-on-goal ranking is visible, calibrated, carries no
edge language, and the betting surfaces are still suppressed.

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

### Surfacing — the two boards, on DIFFERENT bars

**THE TWO BOARDS ANSWER DIFFERENT QUESTIONS AND ARE GATED DIFFERENTLY. This is
the correction to a rule that was never a design decision.**

The old rule — *no model output is rendered that has not cleared bar 3* — came
from Track E of `audit-remediation-plan.md`, added 2026-08-31, and was flagged
**the next day** as describing "a SUPPRESSION STATE, not a test": it passed only
because nothing tried to render, and it was marked NEEDS REWRITING BEFORE
ANYTHING SHIPS. It was written when the app showed no model output at all,
because the *previous* models were genuinely broken — soccer predicting 0.583
for assists where 0.064 happens, golf storing a Brier of 0 on 147 of 149 rows.

That rule was then carried into this plan unchanged and enforced across Phases
2, 3 and 4, which is why four phases produced nothing a user can see. **Corrected
here.**

---

#### 9a. The stats board — SHIPS REGARDLESS OF ANY MARKET COMPARISON

**What it says:** "we think this player has the most value." A ranking and a
projection. It is our opinion, stated as an opinion.

**What it does NOT say:** that the market is wrong, that a bet is profitable, or
that anyone will make money. It makes no claim against a price, so a price is
not the thing that validates it.

**Therefore it is NOT gated on beating the close, and never was going to be
usefully gated that way.** Requiring a projection to beat a trillion-dollar
market before it can be shown is a category error: it holds an opinion product
to a betting product's standard.

**Its bar is HONESTY, not edge:**

1. **Calibrated.** If it says a player projects to 3 shots, players it says that
   about should average about 3. Measured against outcomes, not against a price.
2. **Overconfidence corrected.** NHL's prop model needs `T = 1.58` to be
   calibrated (4.7); apply the correction rather than shipping a number known to
   be too sharp.
3. **Uncertainty visible.** A projection built on 5 prior games must not look
   like one built on 50. Show the evidence behind it.
4. **No edge language anywhere.** No "+X% edge", no implied probability against a
   price, no profit framing. The moment it compares itself to a market it stops
   being a stats board.

**Measured in 4.8: Total POINTS and Total ASSISTS clear this bar. Shots on goal
does NOT** — its worst calibration bucket is off by 0.057 against a 0.05
tolerance after correction. An earlier version of this section asserted shots on
goal cleared, which was stated before it had been measured against the bar.

  Points   n=2,615  58.6% accurate  monotone  calibration gap 0.013  PASS
  Assists  n=2,574  64.8% accurate  monotone  calibration gap 0.026  PASS

#### 9b. The betting board — STILL GATED on beating the close

**What it says:** "this price is wrong and here is the edge." That IS a claim
against the market, so the market is exactly what validates it.

**Bar unchanged:** beats the de-vigged closing line, out of sample, paired, with
calibration ruled out first. Nothing has cleared it yet — tennis (t=+20.68),
soccer (t=+3.05), NHL games (t=+5.07), NHL props (t=+3.03) all failed.

`EdgeBadge`, edge percentages, and any profit framing stay suppressed until a
sport clears. **A sport can therefore have a stats board and no betting board,
and that is the expected state for all of them right now.**

#### 9d. The line that must not be crossed

The distinction holding this apart is not cosmetic and is the reason two bars
exist at all: **a ranking is an opinion, an edge is a claim about someone else's
price.** A stats board that starts quoting implied probabilities against a
market has silently become a betting board without passing its gate — which is
the same failure as the old blanket rule, running the other way.

Compliance strings, jurisdiction notice and a "not financial advice" disclaimer
are required on both (`audit-phase-5.md` records that none currently exist).

---

### Why surfacing is no longer a phase (was Phase 9)

**This is no longer a phase, and that change matters more than it looks.**

As Phase 9 it sat after MLB, NBA, CFB and NFL while its own text said "built per
sport as each model ships, not as one big-bang release" — a contradiction that
resolved in favour of the position on the page. The consequence: **a sport phase
ended at a gate result, which is a number in a document.** Phases 2, 3 and 4
finished without a user seeing anything.

There was a defensible reason under the old blanket gate: if nothing renders
until a model beats the market, you do not know whether you are building a
surface for anything at all — building it during tennis would have meant
building it for a model that then failed. **That argument dies with the gate
split.** The stats board ships regardless now, so there is always something to
surface, and deferring is delay rather than caution.

#### What is built ONCE (the shared surface)

Built with the first sport that needs it, which is NHL:

1. The board component and its render plumbing.
2. **Compliance: privacy policy, jurisdiction notice, "not financial advice"
   disclaimer.** `audit-phase-5.md` records that NONE of these exist. **This
   blocks anything user-facing, on either board, regardless of sport.**
3. Enforcement that no edge language reaches the stats board (§9d).
4. The betting-board suppression logic — `EdgeBadge`, edge percentages and
   profit framing stay off per sport until that sport clears bar 3.

#### What each sport phase carries (per sport, every time)

Every sport phase now ENDS with its board, not with a gate result:

- the sport's data adapter onto the shared board,
- its market filter,
- its calibration constant (NHL's is `T = 1.58`, measured in 4.7),
- its accuracy-and-ordering check against outcomes,
- and only if bar 3 was cleared, its betting board.

**A phase is not done when its gate reports. It is done when something is on a
screen.**

#### Where the work now lives

| | |
|---|---|
| **4.10** | NHL stats board — the shared build plus the first sport |
| **5.x** | MLB phase ends with an MLB board |
| **6.x** | NBA phase ends with an NBA board |
| **7.x** | CFB phase ends with a CFB board |
| **8.x** | NFL phase ends with an NFL board |

The prompt system revisit (old Phase 9 item 5) moves to 4.10, since it has to
match what the first real board actually surfaces rather than a hypothetical one.
