# Daily Picks: full player-prop model build, all sports, all 3 model types (game / player prop / rare market) + simulated $10 bankroll + Today's Picks UI

**You have zero context from the conversation that produced this document. Read this whole file
before touching any code — it is written to be fully self-contained.** A separate historical
player-gamelog data pull (a different, ~5-hour background job, on a different Claude Code session/
account) is running in parallel against this same repo's database right now — do not duplicate it,
do not worry about it finishing, and do not touch `player_game_history`'s row *contents*. Your job is
architecture: by the time you're done, every sport should have all three pick models (game picks,
player props, rare markets) fully built, wired, and producing real picks the moment that other pull's
data lands — with **zero further code changes needed** once it does. If a sport still has no rows in
`player_game_history` when you finish, that sport should show a clean empty state, not an error, not
missing code.

## Mission

Linesmith is a sports-betting research app (`C:\Users\occy3\Documents\line-buddy`) covering MLB,
Golf, NFL, CFB, NBA, NHL, Soccer (EPL+MLS), and Tennis. MLB already has a complete, working "Today's
Picks" feature — the reference implementation for everything below. Nothing equivalent exists for
any other sport, and no sport anywhere tracks real dollar profit/loss (only a bankroll *fraction* via
Kelly staking exists today, never a dollar figure).

**The ask**: build the same 3-model daily-picks system for every sport (MLB stays as reference/gets
minor consistency tweaks; Golf and Tennis are out of scope — Golf has no "daily games" concept, and
Tennis needs its own separate design not covered here), each with:
1. **Game picks** — moneyline (+ total) winner picks for every real game that day.
2. **Player props** — top 10 daily player-prop picks.
3. **Rare markets** — top 5 "exciting, low-probability" picks (MLB's home runs is the existing
   template).

...plus a simulated flat **$10 bet** on every locked pick, so the app shows real, honest
profitability per model type (separate P&L for games / player props / rare markets, **plus** a
combined per-sport total — four numbers per sport) — not just win/loss record, which can look good
while still losing money on bad prices.

## Architecture decision you must follow: one unified data source, not per-sport special cases

A `player_game_history` table already exists (built and live-tested the same session this doc came
from) — real per-player, per-game stat rows, schema below. **Every sport's player-prop scoring reads
from this table**, via an already-built adapter function, **not** from a live per-player ESPN
gamelog fetch. This is the single most important architectural decision in this whole build: it's
what makes "wire everything now, data arrives later" literally true, because every sport uses the
exact same read path regardless of whether that sport's rows exist yet.

```sql
-- supabase/migrations/20260827060000_player_game_history.sql (already applied)
CREATE TABLE IF NOT EXISTS player_game_history (
  id            BIGSERIAL PRIMARY KEY,
  sport         TEXT NOT NULL,
  athlete_id    TEXT NOT NULL,
  team_id       TEXT,
  season        INT NOT NULL,
  event_id      TEXT NOT NULL,
  game_date     DATE NOT NULL,
  opponent_id   TEXT,
  is_home       BOOLEAN NOT NULL,
  stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sport, athlete_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_player_game_history_lookup
  ON player_game_history (sport, athlete_id, season, game_date);
```

```python
# python-odds-service/src/db.py — already built, already live-tested
@dataclass
class PlayerGameHistoryInput:
    sport: str
    athlete_id: str
    team_id: str | None
    season: int
    event_id: str
    game_date: str
    opponent_id: str | None
    is_home: bool
    stats: dict[str, float]

async def write_player_game_history(rows: list[PlayerGameHistoryInput]) -> int: ...
async def fetch_player_games_from_db(sport: str, athlete_id: str, season: int | None = None) -> list["PlayerGameStat"]: ...
```

`fetch_player_games_from_db` returns the exact same `PlayerGameStat` shape
(`predict/generic_player_gamelog.py`) that every scoring function in this codebase already consumes
— `event_id, game_date, opponent_id, is_home, stats: dict`. This is why the swap is "free": nothing
downstream of this function needs to know or care whether the row came from a live fetch or a
persisted table.

**You must also build an ongoing freshness job** (Phase 0 below) — the separate 5-hour pull is a
one-time historical backfill; something needs to keep `player_game_history` current with each new
day's completed games, forever, for every sport, using the same game-based (boxscore) approach the
backfill uses — not the live per-player ESPN gamelog endpoint, which is confirmed broken for CFB and
Soccer (tested live: consistent errors against real athlete IDs) and is being made structurally
redundant here anyway now that every sport reads from the DB uniformly.

## Everything real and already built — reuse it, don't rebuild it

### Scoring math (all real, all live-tested, do not modify without a real reason)

- **`predict/edge_model.py`** — `compute_model_probability`, Beta-Binomial posterior. Real
  `PRIOR_STRENGTH` dict per dimension, `shifted_prior_mean` for matchup nudging.
- **`predict/prop_score.py`** — `compute_prop_score`, the 0-100 score + letter grade. Real weights:
  `WEIGHT_M=0.3, WEIGHT_E=0.35, WEIGHT_P=0.25, WEIGHT_X=0.1`.
- **`predict/live_edge.py`** — `resolve_candidate_edge` (3-tier sharp/consensus/none market edge),
  and **`real_line_for(rows, subject_id, market_key) -> float | None`** — critical: this resolves the
  REAL live per-player line from `prop_odds` before falling back to any static default. Counting-stat
  props (points, yards, goals — anything not MLB) are priced *per player* by real sportsbooks, unlike
  MLB's genuinely standardized fixed thresholds (total bases O/U 1.5 for every batter). A real,
  confirmed bug was found and fixed the same session this doc came from: passing a static fallback
  line directly into `resolve_candidate_edge` silently finds zero live prices for nearly every real
  player, because the price lookup requires an *exact* line match. Always resolve `real_line_for`
  first; only fall back to a static default when it returns `None`.
- **`predict/generic_prop_score.py`** — `DimensionConfig` (dimension name, ESPN-shaped stat field
  name, fallback line), `build_candidate(games, config, league_rate, subject_id, prop_rows,
  user_sportsbook, defense_index=None, opponent_abbr=None, position_group=None) ->
  GenericPropCandidate`. This is THE function every sport's production job calls per player per
  stat. Already resolves `real_line_for` internally — you don't need to call it yourself.
- **`predict/generic_matchup_defense.py`** — the X (matchup-favorability) signal. Real, live-proven
  opponent-defense-allowed leaderboards for **NBA and NHL only** today (`TeamDefenseAllowed`,
  `matchup_favorable(index, opponent_abbr, position_group) -> bool | None`). Both endpoints
  (`api-web.nhle.com` for NHL, `site.api.espn.com/.../basketball/nba` for NBA) were re-verified live
  against real payloads. NFL/CFB/Soccer have none yet — see Phase 3.
- **`predict/generic_dimension_configs.py`** — real, live-verified `NBA_DIMENSIONS`, `NHL_DIMENSIONS`,
  `NFL_DIMENSIONS` lists. Every `dimension` string is a real canonical market key from
  `entity_resolution.CANONICAL_MARKET_KEYS` (not a guess — `resolve_candidate_edge` can never find a
  live price for a dimension that isn't a real market key). Every `espn_stat_name` was confirmed live
  against a real ESPN gamelog response before being written (see the file's own header comment for
  the exact athlete IDs tested). Use this file as your literal template for CFB/Soccer's configs.
- **`predict/prop_candidates.py`**'s **`RARE_EVENT_FLOOR`** — the real admission-gate pattern MLB's
  home-run/triples/stolen-bases picks use: `{"base": 0.25, "favorable_matchup": 0.2,
  "tough_matchup": 0.35}`, applied only to `interest_side="over"` markets — a candidate only gets
  generated at all if the player's own recent Over rate clears this (matchup-adjusted) floor. This is
  what keeps "rare market" picks meaningfully rare rather than everyone "passing" because the raw
  event is uncommon for everyone.
- **`predict/home_run_model.py`** — MLB's rare-market model is **not** a separate model from scratch.
  It's a calibrated logistic-regression *extension* of the generic Beta-Binomial `home-runs`
  probability (`edge_model.compute_model_probability`'s own output is literally one of its four input
  features, alongside park factor, pitcher-matchup, and lineup-slot). It only goes live if it beats
  the plain Beta-Binomial baseline on a real holdout Brier score; otherwise it silently falls back to
  the baseline. **You do not need a bespoke fitted model per sport to ship rare markets** — the
  generic scorer + `RARE_EVENT_FLOOR` is a real, legitimate v1, same "disclosed-not-fitted" status as
  every other constant in this codebase.

### Game-level pick lifecycle (all real, all sport-generic already in code)

- **`predict/game_pick_lock.py`** — `grade_finished_game_picks(sport, ...)` is already generic (takes
  a `sport` param) — its only real caller today (`jobs.py`) just hardcodes `"mlb"`. Two capture slots
  per market: `initial` (≥6am America/Chicago) and `final` (within 3h of commence time) — no price is
  captured at this stage, only `side`/`prob`/`line`.
- **`db.py`** (all confirmed sport-generic, no MLB-specific logic):
  ```python
  async def ensure_game_pick_row(identity: GamePickIdentity) -> None: ...       # db.py:1407
  async def attach_moneyline_price(sport, game_id, slot, side, american_odds) -> None: ...  # db.py:1576
  async def attach_total_price(sport, game_id, slot, side, american_odds) -> None: ...      # db.py:1592
  async def capture_moneyline_pick(c: MoneylinePickCapture) -> None: ...        # db.py:1707
  async def capture_total_pick(c: TotalPickCapture) -> None: ...                # db.py:1747
  async def grade_game_pick(g: GamePickGrade) -> None: ...                      # db.py:1780 (WHERE graded_at IS NULL guard, idempotent)
  ```
- Real price is attached **separately**, later, by `predict/odds_lines_cycle.py`'s
  `attach_prices_from_lines()`, which matches live `GameLine` odds against an already-captured
  `game_picks` row by `game_id` + side, `UPDATE ... WHERE {col}_price IS NULL` (idempotent, fills
  once). **Verify live whether this already runs across all sports or is MLB-only in practice** —
  not confirmed as of this doc; check before assuming either way.
- **`predict/generic_pick_capture.py`** (already built, already running as `genericCaptureJob` in
  `jobs.py`'s `JOB_REGISTRY`, every 5 min) — captures moneyline+total picks into `game_picks` for
  NFL/CFB/NBA/NHL/Soccer-EPL/Soccer-MLS already, using `generic_team_elo.py`'s blended predictions.
  **Real rows already exist for these 6 sports today** — they are just never graded (see Phase 1).
- **`predict/staking.py`** — pure, sport-agnostic Kelly math (`kelly_fraction`, `cap_exposure`,
  `min_edge_gate`). `db.attach_total_kelly_stake` exists in `db.py` but **has zero real callers
  anywhere** — a pre-existing dead/unwired piece, not something you need to fix, just don't assume it
  does anything today.
- **`app/api/picks/game-history/route.ts`**'s `toView()` (lines ~70-124) is the real shaping layer
  the frontend reads — it already computes a Kelly `stake` fraction here; this is where you add the
  new derived `simulatedProfit` field (see Phase 1). Note a real, pre-existing bug: this route's own
  `GamePickView`/`MoneylinePickView` interfaces include `probLower`/`probUpper`/`stake` that
  `components/useGamePickRecord.ts`'s client-side type is missing — fix this drift while you're in
  the file.

### Player-prop pick lifecycle (real, but currently unbounded — no curation exists)

- **`pick_history`** table (`sport, subject_id, subject_name, dimension, category, market_key, line,
  game_id, sample_size, ..., model_prob, market_prob, edge, price_source, bookmaker,
  price_captured_at, outcome, actual_value, graded_at, prop_score, score_grade, ...`) — real, already
  sport-generic (has a `sport` column), `UNIQUE(sport, subject_id, dimension, category, game_id)`.
- **`predict/prop_pick_history.py`**'s `log_snapshot_candidates(sport, candidates)` → `db.log_surfaced`
  — the real write function every candidate goes through, `INSERT ... ON CONFLICT DO NOTHING`
  (first-surfaced-wins for the day). Already sport-generic.
- `jobs.py`'s `job_compute_mlb_prop_predictions` → `prop_candidates.build_todays_candidates` is the
  real MLB production job template — it generates a candidate for essentially every real
  batter/pitcher stat-market combo on the day's slate with **no top-N selection inside Python at
  all**. `pick_history` is a genuinely unbounded stream by design; curation happens downstream.
- **Top-N selection happens in the TS API layer, not Python.** `app/api/mlb/home-run-candidates/
  route.ts` is the real, only precedent: `TOP_N = 15`, then
  `.filter(c => c.dimension === 'home-runs').map(...).sort((a,b) => b.prob - a.prob).slice(0, TOP_N)`
  against the already-cached slate snapshot's `modelProb` field. This is the literal pattern to
  generalize for every sport's top-10 props / top-5 rare-markets routes.
- **Verify live whether player-prop grading (`pick_history.outcome`/`actual_value`) already has a
  generic path or is MLB-only in practice** — not confirmed as of this doc.

### Frontend (real, MLB-only today, the literal template to generalize)

- **`components/TodaysPicksModal.tsx`** — `TodaysPicksButton({ sport, date })`. Already takes a
  generic `sport: Sport` prop. Two tabs today: `'games'` (works for any sport already —
  `useGamePickHistory(sport, ...)` reads `/api/picks/game-history`) and `'homeRuns'`
  (**hardcoded** `showHomeRunsTab = sport === 'mlb'`, fetches `/api/mlb/home-run-candidates`, renders
  `TopHomeRunCandidates` using the shared `ScanCard` component). No player-props tab exists for any
  sport, including MLB — this is genuinely new UI, not something to find and extend.
- Season-record header line today: `ML {w}-{l} · O/U {w}-{l}` (win/loss only) — this is where the
  four new P&L numbers go (Phase 7/8).

---

## Build order — 9 phases, each with a real live-verification step. Do not start a phase before the previous one's verification passes.

### Phase 0 — Ongoing freshness job for `player_game_history`

Build a recurring job (new file, e.g. `predict/generic_freshness_job.py`, registered in `jobs.py`'s
`JOB_REGISTRY` the same way every other job is) that, for every sport in scope, finds yesterday's/
today's newly-completed real games (reuse `generic_pick_capture.fetch_scheduled_games`, filter to
finished), fetches each game's boxscore, extracts every player's stats, and writes them via
`write_player_game_history` — the exact same game-based approach
`docs/historical-player-gamelog-pull-2026-08-27.md` describes for the one-time backfill, just scoped
to "yesterday/today" instead of a multi-year range. **Reuse whichever boxscore parsers the historical
pull session builds** (check that session's real, finished code for NBA/NHL — already proven in
`generic_matchup_defense.py` — plus its new football and soccer parsers) rather than writing your own
second copy. If that other session's work isn't done/committed yet when you reach this phase, build
NBA/NHL's freshness job first (parsers already exist and are proven), and football/soccer once their
parsers exist — check `git log`/the actual files before assuming either way.

**Real coordination checkpoint**: the field names in `player_game_history.stats` for football and
soccer are decided by whichever session builds those parsers first. Before writing Phase 2's CFB/
Soccer dimension configs, **query a real row** (`SELECT stats FROM player_game_history WHERE sport =
'cfb' LIMIT 1`, once one exists) and match your `espn_stat_name` values to the *real* keys actually
present — don't guess field names the way this doc's football/soccer suggestions below are only
provisional.

**Verification**: after a real run, `SELECT sport, COUNT(*) FROM player_game_history GROUP BY sport`
shows real, growing counts for whichever sports have real completed games recently.

### Phase 1 — Game-pick grading + price-attach, generalized

1. New `job_grade_finished_generic_picks` in `jobs.py`, mirroring `generic_pick_capture.py`'s
   `_APP_SPORT_BY_KEY` loop shape, calling `game_pick_lock.grade_finished_game_picks` for each of
   NFL/CFB/NBA/NHL/Soccer-EPL/Soccer-MLS using ESPN final scores (not `statsapi.py`, MLB-only) —
   register in `JOB_REGISTRY` alongside (not merged with) the existing MLB-only grading job.
2. Verify live whether `attach_prices_from_lines()` already covers all sports; generalize if not.
3. `app/api/picks/game-history/route.ts`: add derived `simulatedProfit` to `toView()` — 
   `decimal = americanToDecimalOdds(price); profit = outcome === 'win' ? 10 * (decimal - 1) : outcome === 'loss' ? -10 : null`.
   Fix the `useGamePickRecord.ts` type drift (add the missing `probLower`/`probUpper`/`stake` fields).

**Verification**: real graded rows for a non-MLB sport; hand-check a few real picks' price+outcome
against the computed P&L number by hand.

### Phase 2 — Dimension configs, all 6 sports

- NBA/NHL/NFL: already done (`predict/generic_dimension_configs.py`) — no change needed except
  repointing their production job (Phase 4) at `fetch_player_games_from_db`.
- CFB: same real canonical market keys as NFL (`entity_resolution.py` groups them under one shared
  set: `passing-yards`, `passing-tds`, `rushing-yards`, `rushing-tds`, `receiving-yards`,
  `receptions`, `receiving-tds`, `interceptions-thrown`, etc.) — same `DimensionConfig` list, `sport`
  tag changed to `"cfb"`, `espn_stat_name` values matched against Phase 0's real coordination
  checkpoint.
- Soccer (EPL/MLS): real canonical keys already exist in `entity_resolution.py`: `assists`, `shots`,
  `shots-on-target`, `goals-assists`, `tackles`, `passes-attempted`, `dribbles-attempted`,
  `crosses-attempted`, `yellow-cards`, `saves`. Build `SOCCER_DIMENSIONS` once Phase 0's real field
  names are confirmed — do not guess ESPN-style field names the way NBA/NHL/NFL's were confirmed via
  a live gamelog curl; soccer's names come from the historical-pull session's own boxscore parser,
  verify against real rows.

**Verification**: for each new sport, run its dimension configs through `build_candidate` by hand
against a few real players once real rows exist — same spot-check style already proven for
NBA/NHL/NFL (see `predict/generic_dimension_configs.py`'s own test methodology if you want the exact
pattern: fetch real games, loop every `DimensionConfig`, print `sample_size`/`model_prob`/`score`,
confirm no crashes and sane numbers, confirm a position without a given stat cleanly returns
`sample_size=0` rather than erroring).

### Phase 3 — X (matchup-favorability) signal, remaining 3 sports

NBA/NHL already done. Real, separate technical work per sport, not blocked by data:

- **NFL**: build the same ESPN-boxscore-aggregation approach `generic_matchup_defense.py` already
  proves out for NBA/NHL (opponent's boxscore stats aggregated by position group, rolling L15
  window, prior-season fallback) — extend that same file with NFL's own position-group buckets
  (offense positions: QB/RB/WR/TE — decide the real bucketing before writing code, mirroring how
  `_nba_position_group`/`_nhl_position_group` already do this). No new external dependency, same
  ESPN data family already proven live.
- **CFB**: needs a real CFBD API integration in Python — check whether `CFBD_API_KEY` already exists
  in this service's environment (the TS side, `lib/sports/cfb/cfbd.ts`, already has one — confirm
  whether it can be reused or a separate key/rate budget is needed for Python). Port
  `lib/sports/cfb/teamDefenseAllowed.ts`'s real logic (uncommitted TS reference implementation,
  built from `loadCfbdTeamContext`'s already-proven-live CFBD calls).
- **Soccer**: needs a new Understat scraper ported to Python. EPL has a real TS reference
  (`lib/sports/soccer/understat.ts`'s `buildUnderstatTeamDefenseIndex`) — port it. MLS has **no**
  Understat coverage at all; either accept no X-signal for MLS, or find/evaluate an alternate data
  source before building anything for MLS specifically.

**Verification, per sport**: same live-endpoint-proof discipline already used for NBA/NHL — curl/
verify every new endpoint against a real response before writing a parser, then prove a real
worse-defense opponent measurably raises a test candidate's score and a better-defense opponent
lowers it (see `generic_matchup_defense.py`'s own build for the exact before/after comparison
methodology to replicate).

### Phase 4 — Production job: real picks, every sport, every day

New job (or one per sport, same shape), for each sport each day:
1. Get real scheduled games (`generic_pick_capture.fetch_scheduled_games`).
2. Resolve both teams' real rosters (`generic_player_gamelog.fetch_roster_athlete_ids`).
3. For each athlete: pull their real history via `fetch_player_games_from_db` (Phase 0's table, NOT
   a live fetch — this is the whole point of Phase 0/the unified architecture).
4. Run every applicable `DimensionConfig` (Phase 2) through `build_candidate`, passing the sport's
   X-signal `defense_index`/`opponent_abbr`/`position_group` when available (Phase 3).
5. Write real candidates to `pick_history` via `db.log_surfaced` (already sport-generic, confirmed).

**Verification**: real rows land in `pick_history` for every sport that has real rows in
`player_game_history` to work from; sports still waiting on real data correctly produce zero
candidates (not an error) — confirm this is a clean no-op, not a crash, for at least one
still-empty sport.

### Phase 5 — Rare-market picks (top 5), every sport

Mechanical for MLB (existing)/NFL/CFB (`anytime-td`)/Soccer (`anytime-goalscorer`) once Phase 4
exists for that sport — reuse `RARE_EVENT_FLOOR`'s admission-gate pattern with each sport's real
market key.

**NHL (`goals`)**: move `goals` out of `NHL_DIMENSIONS` (the regular player-props pool) into this
sport's rare-market list instead, so the same real bet doesn't surface in both tabs — apply the same
`RARE_EVENT_FLOOR`-style admission gate MLB's HR pick uses (a real "anytime goalscorer" framing, not
just "any player who might score").

**NBA (triple-double)**: real, disclosed new architecture. `history_entries()`/`build_candidate()`
today only support a single-field threshold (`g.stats[stat_name] > line`). Build a new derived-
condition path: a function that, given one `PlayerGameStat`, returns a real boolean
(`points >= 10 and rebounds >= 10 and assists >= 10`), producing the same `HistoryEntry` shape
`history_entries()` already outputs (`category="over"` if true, `"under"` if false) — feed that into
the same `compute_model_probability`/`compute_prop_score` pipeline unchanged. **Live-verify against a
real known triple-double game** (pick a real player/date with a documented triple-double, confirm
your derived function returns `True` for that exact game) before trusting it broadly.

**Verification, per sport**: real top-5 lists, generally lower-probability than the top-10 props list
(spot-check they're not just duplicating the top of Phase 6's list).

### Phase 6 — Top-10 daily player-prop picks

Generalize `app/api/mlb/home-run-candidates/route.ts`'s real filter+sort+slice pattern: new route
(one per sport, or one sport-parameterized route — your choice, but keep it consistent with how this
codebase already handles per-sport API routes, see CLAUDE.md's own `cachedRoute()` convention for
GET handlers doing non-trivial computation), filtering `pick_history` to today's real rows for that
sport (excluding whatever dimension Phase 5 already claimed for the rare-market tab), sorted by
`prop_score`/model edge descending, sliced to top 10.

**Verification**: real top-10 list for at least one fully-wired sport (start with NBA or NHL — both
already have Phase 2/3/4 built), sane highest-edge-first order.

### Phase 7 — Simulated $10 bankroll, all three pick types

Same derived-value approach as Phase 1 (`decimal = americanToDecimal(price); profit = outcome ===
'win' ? 10*(decimal-1) : outcome === 'loss' ? -10 : null`), applied to `pick_history` rows (player
props + rare markets) once they have a real price + graded outcome. Verify live whether prop grading
already has a generic path (check for the write side of `pick_history.outcome`/`actual_value` —
likely an MLB-only job today, mirroring the same gap Phase 1 found for `game_picks`); generalize the
same way if needed.

Expose **four numbers per sport**: games P&L, player-props P&L, rare-markets P&L, and a combined
sport total (sum of the three) — not one blended figure. This was an explicit, deliberate user
decision: blending them would hide which model (if any) is actually profitable, which is the entire
point of this feature.

**Verification**: hand-check a few real graded prop/rare-market picks' price+outcome against the
displayed P&L, same discipline as Phase 1.

### Phase 8 — Frontend: "Today's Picks" for every sport

- Replace `TodaysPicksModal.tsx`'s hardcoded `showHomeRunsTab = sport === 'mlb'` with a real 3-tab
  structure (Games / Player Props / Rare Markets) for every sport with any real data — tab label per
  sport, not a generic placeholder: "Home Runs" (MLB), "Anytime TD" (NFL/CFB), "Triple-Doubles"
  (NBA), "Goals" (NHL), "Anytime Goalscorer" (Soccer).
- New Player Props tab component, mirroring `TopHomeRunCandidates`'s real shape (fetch, `ScanCard`
  list, loading/error/empty states) against Phase 6's new endpoint.
- Header record line: show all four Phase 7 numbers, not the current win/loss-only line.
- **MLB's own Home Runs tab changes from Top 15 to Top 5** for consistency with the new shared shape
  across every sport — a real, deliberate change to existing MLB behavior, not an oversight. Do this
  explicitly, don't leave MLB at a different N than everyone else.
- Sports with zero real data yet show a clear, real "not available yet" empty state per tab — not a
  crash, not a silently-empty list rendered as if it were normal. This is what makes "fully wired,
  just waiting on data" visibly true in the running app, not just true in the code.

**Verification**: live browser check (start a dev server, actually open the modal) for at least one
fully-wired sport (NBA or NHL) — all 3 tabs render real numbers, the 4-number P&L header is correct,
and a sport still waiting on real data (e.g. CFB, if Phase 0-3 aren't finished for it yet) shows the
real empty state, not an error.

---

## Critical files, by phase

- Phase 0: new `predict/generic_freshness_job.py`, `jobs.py`, `db.py` (`write_player_game_history`
  already exists)
- Phase 1: `predict/game_pick_lock.py`, `jobs.py`, `db.py`, `predict/odds_lines_cycle.py`,
  `app/api/picks/game-history/route.ts`, `components/useGamePickRecord.ts`
- Phase 2: `predict/generic_dimension_configs.py`, `entity_resolution.py`
- Phase 3: `predict/generic_matchup_defense.py`, new `cfbd.py`/Understat module for Python,
  `lib/sports/cfb/teamDefenseAllowed.ts` and `lib/sports/soccer/understat.ts` (TS references to port)
- Phase 4: `predict/generic_pick_capture.py`, `predict/generic_player_gamelog.py`,
  `predict/generic_prop_score.py`, `predict/prop_pick_history.py`, `jobs.py`
- Phase 5: `predict/prop_candidates.py` (`RARE_EVENT_FLOOR` pattern reference), new derived-condition
  helper for NBA's triple-double
- Phase 6: `app/api/mlb/home-run-candidates/route.ts` (pattern to generalize)
- Phase 7: same files as Phase 1
- Phase 8: `components/TodaysPicksModal.tsx`

## Real, non-code dependencies — flag these explicitly, don't silently work around them

- CFB's X-signal (Phase 3) needs a real `CFBD_API_KEY` for the Python service — confirm whether the
  TS side's existing key can be reused before assuming you need a new one.
- Soccer's dimension-config field names (Phase 2) depend on the historical-pull session's real,
  possibly-still-in-progress boxscore parser choices — a coordination point, verify against real
  rows, don't guess in advance.
- The whole system's real pick *volume* depends on the separate 5-hour historical pull (running now,
  different session) actually finishing — every phase above is buildable and verifiable-as-wired
  today using whatever real data already exists (today's/recent real games via Phase 0's freshness
  job can produce some real rows on its own, independent of the historical backfill), but full depth
  won't exist until that pull lands. This is by design, not a blocker to finishing this build.

Work through the phases in order. Verify each one live before moving to the next — this codebase's
established discipline throughout is "prove it against real data, not a theoretical shape," and
several real bugs (a broken gamelog endpoint, a stale ESPN teams-list, a line-matching bug that would
have silently killed the market-edge signal for five sports) were only caught this way. Don't skip
the verification steps to move faster; they're what makes "fully complete outside of new data" a true
statement rather than an assumption.
