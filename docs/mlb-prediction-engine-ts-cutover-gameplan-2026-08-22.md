# MLB prediction engine — TS cutover gameplan

Follow-up to `docs/mlb-prediction-engine-python-port-gameplan-2026-08-21.md`
(Phases A-G, all complete and live). This covers the three things flagged as
outstanding when that plan finished: the actual TS cutover (Python and TS
currently run two independent, convergent-but-parallel systems, not one),
Phase H (`modelFit.ts`), and the smaller pieces deferred out of Phases E-G.

No code written yet — this is the plan, for approval before Phase I starts.

---

## 1. Where things actually stand

Phases A-G built a complete, independently-tested MLB prediction pipeline in
Python (Elo, sim engine, gameModel math, pick-lock capture/grading, market
lines) and wired it into `SequentialQueue` as real, always-on jobs. Verified
live in production (2026-08-21/22): Python's `job_mlb_odds_lines_cycle`
captured real final locks for 15 real games TS's own request-triggered
`route.ts` hadn't gotten to yet.

But Phase G took a deliberate shortcut to avoid risky surgery on
`adapter.ts`: it **reads** `gameModel`/`elo` from the snapshot TS already
computes and publishes, rather than having Python compute them
independently. The practical result:

| Data | Who writes it today | Who reads it |
|---|---|---|
| `team_elo_history` | TS only (`snapshotRebuild.ts`) | TS (`adapter.ts`), Python (indirectly, via the snapshot) |
| `pitcher_game_score_history` | TS only | TS only |
| `game_picks` (captures) | **Both** TS (`route.ts`) and Python (`job_mlb_odds_lines_cycle`) | Both |
| `game_picks` (grading) | **Both** TS (`snapshotRebuild.ts`) and Python (`job_grade_finished_mlb_picks`) | Both |
| `odds_cache` (game lines) | **Both** TS (on page load) and Python (`job_mlb_game_lines`) | Both |
| `gameModel`/`elo` (the numbers themselves) | TS only, computed live in `adapter.ts` | TS, and Python reads TS's output |

Rows 3-5 are already safely redundant (idempotent guards, harmless races) —
that's a real, working intermediate state, not a bug. Rows 1-2 and 6 are
where TS is still the *only* system, which is what makes the cutover real
surgery rather than a formality: Python can't take over writing
`gameModel`/`elo` until it can compute them itself, and it can't compute
them itself without several inputs never ported (team season stats,
standings, weather, lineup platoon factor).

---

## 2. New audit findings (this pass)

Grounded in `lib/sports/mlb/adapter.ts`, not assumed:

- **`getTeamSeasonStats`, `getStandings`, `rankTeams`** already exist in
  `statsapi.ts` (read in full during Phase B's original audit, just not
  in-scope then) — same `_cached_json` pattern every other `predict/statsapi.py`
  function already uses. Low-risk, mechanical port.
- **`getHandedness`** (statsapi.ts) — same story, needed for platoon factor.
- **`lineupPlatoonFactor`** (`adapter.ts:168-207`) — per-batter vs-handedness
  wOBA ratio, needs game logs (have), starters-by-game + pitcher handedness
  (new), `sumHittingCounts`/`wobaFromCounts` helpers (not yet located in
  detail — read during Phase M, not guessed here).
- **`weatherRunsFactor`** (`adapter.ts:244-247`) — trivial pure math
  (temperature-only, dome-venue exclusion list, ±8% cap). Layer-0-simple.
- **`getWeather`** (`lib/weather/openMeteo.ts`) — Open-Meteo, free, no key.
  A genuinely new provider surface, but MLB's model only needs current
  temperature at the venue, not the full forecast feature set TS's version
  exposes — a narrow, low-risk slice to port.
- **`teamContext`/`starterInfo`** (`adapter.ts:2164-2193`) — thin lookups
  over standings/team-stats/pitcher-stats maps; no new data source, just
  composition once the above exist.

Net: nothing here is architecturally hard, but it's real, un-ported surface
area — roughly comparable in size to Phases B-C combined.

---

## 3. Phase order

### Phase I — Python independently maintains Elo + pitcher Game Score
**Risk: low. No TS changes.**

Wire the already-built, already-tested `elo_model.update_elo_for_finished_game`
and `log_pitcher_game_score` (Phase C) into a real job — same shape as
`job_grade_finished_mlb_picks` (Phase E): read today's finished games via
`predict.statsapi.get_schedule_range`, call the two functions per finished
game/starter. Idempotent (`UNIQUE` constraints already in place), so running
alongside TS's own writes is safe from day one.

Validation: scoped DB test with fake game/pitcher ids (same precedent as
`test_elo_and_pitcher_game_score.py`), then a live run confirming Python's
rows agree with TS's for the same real games (they're computing the same
formula from the same inputs — should match exactly, not just be plausible).

### Phase J — Stop TS's own Elo + pitcher-score writes
**Risk: low-medium. First real TS code edit — deletions, not additions.**

Once Phase I is confirmed healthy in production (check `health_check.py`'s
own staleness/failure detection over a real multi-day window, not just one
run), remove the `updateEloForFinishedGame`/`logPitcherGameScore` call sites
from `snapshotRebuild.ts`. `team_elo_history`/`pitcher_game_score_history`
keep flowing, now from Python alone.

Gate: don't start this phase until Phase I has run unattended, successfully,
across at least a few real game days — a single clean test run is not enough
confidence to remove TS's only writer of a table `adapter.ts` reads on every
live page load.

### Phase K — Port the remaining team-level statsapi functions
**Risk: low. Mechanical, same pattern as Phase B.**

`get_team_season_stats`, `get_standings`, `rank_teams`, `get_handedness` →
`predict/statsapi.py`. Cross-validate against live TS the same way Phase B
did (transpile, hit the real Stats API from both languages, diff).

### Phase L — Port weather (temperature-only) + `weatherRunsFactor`
**Risk: low. New provider, narrow scope.**

New `predict/weather.py`: a minimal Open-Meteo client (venue coordinates →
current temperature only, not TS's full forecast surface) plus the pure
`weather_runs_factor` function. Cross-validate the pure function against TS
directly; spot-check the live weather fetch against a few real venues.

### Phase M — Python computes gameModel + Elo independently
**Risk: medium. Real composition work, needs real-game validation.**

Build `predict/game_model_cache.py` (name tentative): `lineup_platoon_factor`,
`team_context`, `starter_info`, composing Phases B/C/K/L's primitives into
the same `gameModel`+`elo` shape `adapter.ts` currently produces per game.

Validation bar: for a real day's real games, Python's computed
`homeWinProb`/`awayWinProb`/`homeExpectedRuns`/`awayExpectedRuns`/diagnostics
and `elo` fields must match TS's live snapshot values within float tolerance
— not just "look reasonable." This is the load-bearing check for everything
downstream; get it wrong here and every later phase inherits the error
silently.

### Phase N — Persist Python's gameModel/Elo to Postgres
**Risk: low. New table, additive only — nothing reads it yet.**

New table (e.g. `mlb_game_model_cache`, `UNIQUE(sport, game_id)`) +
`write_game_model_cache`/`read_game_model_cache` in `db.py`. Wire Phase M's
computation into a job on the same ~5min cadence as `job_mlb_odds_lines_cycle`
(or fold into that job directly, since it already runs per-game each cycle).

### Phase O — Cut `adapter.ts` over to reading Postgres
**Risk: high. Real surgery on a 2321-line file serving live production pages.**

Modify `gameModelFor`/the Elo-lookup closure in `adapter.ts` to read Phase N's
table instead of calling `computeMoneylineModel`/`getCurrentElo` live —
**with a live-compute fallback** when Python's row is missing or stale
(a transitional safety net, not a permanent dual-path), so a Python outage
degrades to today's behavior instead of breaking the page. Remove the
fallback only after Phase N has run reliably for a real stretch.

This phase needs actual verification against the running app (Team/Game
Detail pages, screenshot-checked) before being called done — type-checking
and unit tests don't prove the live page renders the same numbers.

### Phase P — Remove `route.ts`'s own pick-lock cycle
**Risk: low, but only after Phase O is stable.**

Once `adapter.ts` reads from Postgres (Phase O confirmed stable),
`runMoneylineLockFromSnapshot`/`runTotalLockFromLines`/`attachPricesFromLines`
in `route.ts` are redundant with `job_mlb_odds_lines_cycle` — remove them.
This is the phase where "two systems" actually becomes one.

### Phase Q — The deferred polish pieces
**Risk: low. Independent of everything above — can run anytime, including
in parallel.**

- `logGameOddsHistory` — port so Python's `get_earliest_observed_total_point`
  reads (Phase G) aren't solely dependent on TS still running.
- `logTotalPredictionsFromLines` — calibration logging.
- `attachPricesFromLines` — reference-price display, folds into Phase P
  naturally since it's already being removed from `route.ts` there.

### Phase H — `modelFit.ts` training/backfill
**Risk: low-medium. Independent track — doesn't block, and isn't blocked
by, Phases I-Q.** Can be scheduled wherever convenient; kept last here only
because it was already explicitly deprioritized in the original gameplan.

---

## 4. What's explicitly still out of scope

NFL game lines (SharpAPI board + TheRundown), `getSportsGameOddsGameLine`,
OddsHarvester — no Python NFL prediction pipeline exists to consume them.
Not part of this plan; would be its own project if NFL prediction ever gets
built out in Python.

---

## 5. Sequencing summary

```
Phase I (Elo/pitcher-score job) ──▶ Phase J (remove TS's writes)
Phase K (team stats) ─┐
Phase L (weather)     ├──▶ Phase M (gameModel composition) ──▶ Phase N (persist) ──▶ Phase O (adapter.ts cutover) ──▶ Phase P (route.ts cutover)
                       ┘
Phase Q (polish)   — independent, anytime
Phase H (modelFit) — independent, anytime
```

I and K/L can start immediately and run in any order relative to each other.
J needs I proven stable first. M needs K+L done. N needs M. O needs N proven
stable. P needs O proven stable in the live app, not just passing tests.
