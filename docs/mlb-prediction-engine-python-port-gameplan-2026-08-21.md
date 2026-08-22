# MLB Prediction Engine — Full Python Port Gameplan

Scope: port the ENTIRE MLB game-level prediction pipeline to Python — Elo, the
simulation engine, the game/totals model, pick-locking, and the game-lines
(moneyline/spread/total) fetch that feeds it. Not a partial "fetch only"
migration — this replaces the reasoning from earlier in this session that
recommended splitting fetch (Python) from modeling (TS). That reasoning
optimized for least work, not the right architecture, and was retracted.

Two research agents did a deep, file-by-file audit of every file in scope
(worktree-isolated, so their database-layer findings were briefly stale
relative to this session's uncommitted Postgres cutover — corrected below,
see §0). Their full findings are preserved in this doc; nothing here is
guessed.

---

## 0. Corrected starting conditions (verified directly, not from the agent reports)

Both research agents, reading an isolated git worktree, reported `lib/db/client.ts`
as SQLite-backed (`better-sqlite3`) and flagged "which database does this even
talk to" as a real open question. **That's stale** — their worktree didn't
include this session's uncommitted Phase 1 Postgres cutover. Verified directly
against the real working tree:

- `lib/db/client.ts` imports `pgGet, pgAll, pgRun, pgTransaction` from
  `./pgClient` — already fully Postgres, not SQLite (`lib/db/client.ts:1-25`).
- `lib/db/pgClient.ts` connects via `process.env.DATABASE_URL`
  (`pgClient.ts:34`) — **the exact same env var** `python-odds-service/src/config.py`
  already reads (`config.py:45`).
- **Every table this port needs already exists** in the real Postgres schema
  (`supabase/migrations/20260818201108_initial_schema.sql`): `game_picks` (251),
  `park_factors` (313), `game_sim_cache` (335), `team_elo_history` (347),
  `pitcher_game_score_history` (363).

**Net effect: there is no database architecture question at all.** TS and
Python already share one real Postgres database with every needed table live.
This port needs new Python *functions* (mirroring `lib/db/client.ts`'s real,
current Postgres-dialect queries — not translating from SQLite), not a new
database, new schema, or new connection mechanism.

---

## 1. Real file inventory and sizes

| File | Lines | I/O |
|---|---|---|
| `lib/sports/mlb/simEngine.ts` | 389 | none — pure math |
| `lib/sports/mlb/gameModel.ts` | 461 | none — pure math |
| `lib/core/logisticRegression.ts` | 291 | none — pure math |
| `lib/core/probabilityBlend.ts` | 24 | none — pure math |
| `lib/sports/mlb/simRates.ts` | 336 | live MLB Stats API only |
| `lib/sports/mlb/eloModel.ts` | 463 | live MLB Stats API + Postgres |
| `lib/sports/mlb/simGame.ts` | 150 | Postgres read only (`park_factors`) |
| `lib/sports/mlb/gameSimCache.ts` | 108 | Postgres read/write (`game_sim_cache`) |
| `lib/core/gamePickLock.ts` | 282 | Postgres read/write (`game_picks`) |
| **Total** | **2,504** | |

Plus, from the previous turn's finding (game-lines fetch, not yet audited to
this depth): `lib/odds/oddsApi.ts` (the-odds-api), `getSportsGameOddsGameLine`
(`sportsGameOdds.ts:238`), `lib/odds/merge.ts`. OddsHarvester is confirmed
dead — excluded entirely, not part of this port.

Explicitly **out of scope for this pass**: `lib/sports/mlb/modelFit.ts` (the
training/backfill side — fits the weights this pipeline consumes). It depends
on everything above plus historical-season walks, and matches this codebase's
existing "admin/backfill/model-fitting routes, not on the live path"
convention (CLAUDE.md). Sequenced as a later phase, not blocking live
prediction.

---

## 2. Real dependency layers (from the two audits, cross-checked against each other and against §0's correction)

### Layer 0 — Pure math, zero I/O (port first)
`simEngine.ts`, `gameModel.ts`, `logisticRegression.ts`, `probabilityBlend.ts`
— 1,165 lines, zero database or live-API dependency between them. Every
function is a deterministic transform of caller-supplied numbers. This is
the exact shape `entity_resolution.py` was tonight — highest-confidence,
lowest-risk starting point, and cross-validatable the same proven way (copy
real TS logic into a throwaway script, diff structurally against the Python
port on identical inputs, per this session's established methodology).

Real correctness details from the audit that matter for the port, not
optional cleanup:
- `simEngine.ts`'s `advanceState` uses **deterministic** (not probabilistic)
  runner-advancement rules — a disclosed v1 simplification
  (`docs/mlb-sim-engine-plan.md` §1), not a bug to "fix" during porting.
- `dirichletShrunkVector` is a real, load-bearing per-category independent
  Beta shrinkage, deliberately *not* a true Dirichlet-multinomial posterior
  (`simEngine.ts:200-224`'s own comment explains why) — a "more correct"
  Dirichlet implementation during porting would be a silent behavior change.
- `logisticRegression.ts`'s `sigmoid` clamps `z>35→1`/`z<-35→0` to avoid
  overflow — **more necessary in Python than JS**, since `math.exp` raises
  `OverflowError` where JS silently returns `Infinity`. Must port verbatim.
- `logisticRegression.ts`'s matrix inversion (Gauss-Jordan, hand-rolled) vs.
  a `numpy.linalg.inv` rewrite is a real decision, not a wash — a rewrite
  changes numerical behavior at the margins for already-stored
  `model_weights` rows. Recommend a literal port first; a numpy-native
  version can be a deliberate, separately-validated follow-up if performance
  demands it.
- `poissonOverProbability`'s PMF is built term-by-term specifically to avoid
  overflow — same "literal port, not a scipy shortcut" reasoning applies.

### Layer 1 — Live MLB Stats API access (genuinely new Python work)
Real functions needed from `statsapi.ts`, confirmed by both audits as having
**zero** existing Python equivalent (`game_context.py` never calls the MLB
Stats API directly — it only reads a TS-populated Postgres snapshot):
- `getPeopleWithGameLogs` — batched (40 ids/batch), concurrency-limited (3),
  field-trimmed (`fields=` allow-list cut payload ~6x, `statsapi.ts:297-322`)
  — this specific tuning is hard-won (the comment documents it fixed a real
  silent-data-loss bug from request timeouts) and must be preserved, not
  just "call the endpoint."
- `getLeagueBatterSeasonRows`, `getLeagueStartingPitcherStats`,
  `getLeaguePitcherRolePools`, `getActiveRoster` — season-wide aggregate
  pulls, various TTLs (30min-1hr, in-process cache).
- `getScheduleRange` — used only by `eloModel.backfillElo`.
- `getLiveFeed` — deliberately **uncached** ("the only genuinely live data in
  the app," `statsapi.ts:225-236`), used only by `eloModel.logPitcherGameScore`.
- `easternDate` — pure timezone conversion, no network call.

### Layer 2 — Data-fetching orchestration (depends on Layer 1)
- `simRates.ts` — outcome-rate vector builders (league/lineup/pitcher/bullpen),
  calling Layer 1 functions, shrinking via Layer 0's `dirichletShrunkVector`.
- `eloModel.ts` — Elo ratings + rest/travel/pitcher-Game-Score adjustments.
  Depends on Layer 1 (`getScheduleRange`, `getLiveFeed`, `easternDate`) and
  Postgres (`team_elo_history`, `pitcher_game_score_history`). **Dead import
  found**: `getMostRecentEloGame` is imported but never used anywhere in the
  file — don't port unless another real caller needs it (check first).

### Layer 3 — Simulation orchestration (depends on Layer 0 + 2)
- `simGame.ts` — `simulateGameForContext` (live, per-real-matchup, N=4000)
  and `simulateTeamMatchup` (historical backfill, N=300 — `modelFit.ts:73`,
  deliberately far lower, "thousands of historical games at 10,000 sims each
  would make a full backfill impractically slow").
- `gameSimCache.ts` — `ensureGameSims`, the live per-game cache orchestrator.
  Runs its per-game loop **sequentially, not concurrently** — deliberate,
  because the simulation itself is CPU-bound synchronous work on Node's
  single thread (`gameSimCache.ts:63-66`'s own comment). **This reasoning
  needs explicit re-evaluation for the Python port** — Python has real
  multiprocessing/multi-core options Node doesn't, so "sequential because
  single-threaded" may not be the right call once ported; worth a deliberate
  decision, not a reflexive same-shape copy.

### Layer 4 — Pick locking (depends on Layer 0's outputs — already-computed probabilities)
- `gamePickLock.ts` — capture/grade cycle. Depends only on `probabilityBlend`
  (Layer 0) and Postgres (`game_picks`).
- **Real, genuine improvement available here, not just a language swap**: the
  file's own header comment says its 6am/3-hours-before capture windows are
  currently evaluated *opportunistically* — "this app currently runs only
  while someone has it open... both windows are 'due' checks evaluated at
  call time, not a real clock alarm." Python's `SequentialQueue` is already a
  real, persistent, always-on scheduler (proven all night). Porting this
  makes captures genuinely more correct — real timed windows, not "whichever
  page load happens to land near 6am." We already have a working precedent
  for the exact timezone mechanics this needs: `gameday.py`'s
  `_CENTRAL = ZoneInfo("America/Chicago")` backstop, built and verified live
  earlier tonight.

### Layer 5 — The orchestrator (replaces `adapter.ts`'s live-compute + `app/api/odds/lines/route.ts`)
Today, `lib/sports/mlb/adapter.ts` computes gameModel/Elo/sim results live as
part of the whole MLB snapshot rebuild (confirmed: `adapter.ts:67-70` imports
`ensureGameSims`/`computeMoneylineModel`/Elo functions, feeding
`gameModel: gameModelFor(g)` into the snapshot at line 2290 — the same giant
payload this session already fixed compression for). Separately,
`app/api/odds/lines/route.ts` fetches game lines live and runs the full
pick-lock cycle inline, per page request, uncached.

Post-port: a new Python job (own cadence, own `ProviderSpec`-style entries
for the game-lines fetch) computes everything and writes `game_picks`/
`team_elo_history`/`game_sim_cache`/`pitcher_game_score_history` rows
directly to the shared Postgres. `adapter.ts` and `/api/odds/lines` shrink to
reads — the same shift already proven for props (`/api/props/lines` reads
directly from Postgres rather than calling providers itself).

**Real, not-yet-answered question this raises**: `adapter.ts` builds gameModel/
Elo/sim data as one part of the much larger MLB snapshot (player stats, props
matching, etc. — all unrelated to game-lines). Extracting just this slice
without disturbing the rest of that snapshot builder is real surgery, not a
delete. This needs its own careful look during Phase G below, not assumed
away here.

---

## 3. Real open questions, stated plainly (not decided yet)

1. **N=4000's real throughput has never been measured — anywhere.** Both the
   plan doc and the code comments confirm this explicitly (`gameSimCache.ts:28-30`
   references a "Phase 8 perf ceiling check" informally, no logged number
   exists). Must be measured fresh in Python before committing to a live
   cadence — could be a pure-Python loop or numpy-vectorized; the real
   number decides which.
2. **Randomness/seeding**: TS uses unseeded `Math.random()` in every real
   call site (`defaultRng` in `simGame.ts:59`) — there's no existing seeded
   behavior to preserve bit-for-bit. Python is free to choose
   (`numpy.random.default_rng()` recommended) without a compatibility
   constraint.
3. **Sequential vs. concurrent simulation** (Layer 3) — TS's "sequential
   because single-threaded" reasoning doesn't automatically transfer to
   Python. Worth a deliberate call once real throughput (open question 1) is
   known.
4. **Literal port vs. numpy-native rewrite** for `logisticRegression.ts`'s
   matrix math — literal port preserves exact compatibility with stored
   `model_weights`; a rewrite is faster/more idiomatic but is a genuine
   behavior change requiring its own validation pass. Recommend literal port
   for Phase A, revisit only if profiling says it matters.
5. **The game-lines fetch specifics** (the-odds-api's real endpoint/shape,
   `getSportsGameOddsGameLine`'s exact billing/shape) — flagged last turn,
   not yet audited to the same depth as the model/sim files. Needs its own
   focused pass before Phase F below.

---

## 4. Validation approach (matching this session's own established bar)

- **Layer 0 (pure math)**: structural diff against real TS outputs on
  identical inputs — the exact proven method from tonight's `entity_resolution.py`
  cross-validation, not a new technique.
- **Layer 1/2 (live API)**: field-by-field cross-check of real MLB Stats API
  responses against TS's parsing — same rigor already used for every odds
  provider ported tonight (verified field names against current TS source,
  not reconstructed from memory).
- **Layer 3 (simulation)**: not bit-for-bit (randomness isn't seeded) —
  statistical agreement instead: same real inputs should produce a
  `homeWinProb`/`expectedTotal` within noise bounds of the TS output at
  matched N, checked live against a handful of real, current games.
- **Layer 4 (pick-lock)**: real DB read/write tests against the actual
  Postgres `game_picks` table, mirroring `test_write_prop_odds.py`'s real
  upsert-behavior verification (same table, both apps, no separate test DB).

---

## 5. Proposed phase order (for approval — no code written yet)

- **Phase A** — Layer 0 pure math port + cross-validation
  (`sim_engine.py`, `game_model.py`, `logistic_regression.py`,
  `probability_blend.py`). Zero DB/API risk, fastest to prove correct,
  matches the entity-resolution precedent exactly.
- **Phase B** — MLB Stats API access in Python (the ~7 real `statsapi.ts`
  functions from Layer 1), preserving the batching/concurrency/field-trimming
  tuning, not just the endpoints.
- **Phase C** — `sim_rates.py` + `elo_model.py` (depends on B), including the
  Postgres read/write functions for `team_elo_history`/`pitcher_game_score_history`.
- **Phase D** — `sim_game.py` + `game_sim_cache.py` (depends on A + C) —
  includes the real N=4000 throughput measurement (open question 1) and the
  sequential-vs-concurrent decision (open question 3) before this is
  considered done.
- **Phase E** — `game_pick_lock.py` (depends on A), wired into
  `SequentialQueue` for real timed 6am/3-hours-before captures — the genuine
  correctness upgrade from §2's Layer 4.
- **Phase F** — game-lines fetch (the-odds-api, `getSportsGameOddsGameLine`)
  as new `ProviderSpec`s, feeding Phase E's market-blend input. Needs its own
  focused audit first (open question 5).
- **Phase G** — the new orchestrating Python job tying B-F together;
  `adapter.ts`/`app/api/odds/lines/route.ts` cut over to reading Postgres
  instead of computing live — the real surgery flagged in §2 Layer 5, done
  carefully since `adapter.ts` does much more than just this.
- **Phase H** (explicitly later, lower priority, matches this codebase's
  existing admin/backfill convention) — `modelFit.ts`'s training/backfill
  logic. Not on the live path; doesn't block A-G.

Each phase gets the same treatment as tonight's odds work: real cross-
validation before being called done, not design reasoning alone.
