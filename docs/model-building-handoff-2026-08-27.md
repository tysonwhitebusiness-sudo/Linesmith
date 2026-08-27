# Handoff: resuming market-centric model building (2026-08-27)

Paste this whole file as your first message in the new chat.

## Where this picks up

We were building **market-centric prediction models per sport** (moneyline, totals, player prop scores) when we realized the underlying **odds system itself** was broken — the Python Render worker had been silently dead for 4 days, several providers were discarding real game-line data, and most sports had no working bookmaker-comparison grid at all. That detour became a full odds-architecture-rebuild project (8 phases), which just finished tonight. The odds system is now the *foundation* the model work sits on — it's done, verified, and should not need revisiting. This chat should resume model building directly.

## What the odds-rebuild fixed (context, not the task)

- Recovered game-line data (moneyline/spread/total) that 4 of 5 player-prop providers were fetching and silently discarding.
- Built a shared source-of-truth table (`game_odds_book_lines`, Postgres) that every provider (OddsHarvester, SharpAPI, Propline, SportsGameOdds, the-odds-api, ESPN) writes into, keyed by `(sport, game_id, market, side, bookmaker, source)`.
- Built the real read path: `readGameOddsBookLines`/`getBestGameOddsLine` in `lib/db/client.ts`, merge policy = freshest `fetched_at` wins per bookmaker/market/side.
- Rebuilt the bookmaker-comparison grid (`components/GameLine.tsx`'s `BookmakerBreakdown`) and the player-props line-shopping panel (`components/PropOddsPanel.tsx`) for every sport.
- Fixed a real bug tonight: best-price selection (`lib/odds/display.ts`) had no plausibility bound and could pick a garbage outlier row as the "best" price — capped at decimal 30.
- Live-verified all 7 applicable sports tonight (MLB/NFL/CFB/Soccer/Tennis fully; NHL/NBA deferred until their seasons start — real ESPN coverage exists, just nothing to test against yet). Golf has no game-lines concept and was never in scope for this.
- Fixed the health-check monitoring system (`python-odds-service/src/health_check.py`, a Render cron job) — was failing on Supavisor's session-mode connection cap all night; switched it to a transaction-mode pooler connection (port 6543, `DB_POOLER_MODE=transaction`). Confirmed green on Render itself, not just locally.
- Along the way, settled real Postgres connection-pool sizes: TS app (`lib/db/pgClient.ts`) `max: 6`, Python worker (`python-odds-service/src/db.py`) `max_size: 3` — these sum to the real measured budget (~9 of the pooler's 15 slots; ~6 are permanent Supabase platform overhead). Don't casually bump these back up without re-measuring; going higher reproduces real `EMAXCONNSESSION` failures, confirmed live twice tonight.
- All of tonight's changes are committed and pushed to `main`.

## What's genuinely next: per-sport model building

**MLB and Golf already have real, fitted prediction models** — this is the template/reference for what "done" looks like:
- `python-odds-service/src/predict/elo_model.py`, `mlb_bradley_terry.py`, `mlb_mlp.py`, `mlb_stacking.py`, `mlb_tree_models.py`, `mlb_model_candidates.py`, `walkforward.py` (the fitting/activation CLI), `game_model.py`/`game_model_cache.py` (game-level moneyline/total model), `prop_candidates.py`/`prop_score.py` (player prop scoring), `home_run_model.py`, `good_bets.py`, `market_trust.py`, `edge_model.py`.
- Real DB tables: `model_weights` (fitted, versioned, activated via `run_walkforward.py --activate`), `mlb_game_model_cache`, `pick_history`, `game_picks` (moneyline/total lock cycle with Kelly-stake sizing, `lib/core/kelly.ts`).

**NFL/CFB/NBA/NHL/Soccer/Tennis have none of this yet** — confirmed by checking `python-odds-service/src/predict/` directly tonight: every model file there is MLB- or golf-specific, zero `nfl_*`/`cfb_*`/`nba_*`/`nhl_*`/`soccer_*`/`tennis_*` model files exist. Those sports currently have working odds/props/UI infrastructure (Scan, Player Detail, Game Detail all render real data) but **no actual statistical model** generating moneyline probabilities, total predictions, or player-prop scores — whatever "picks" or "predictions" they show, if any, are not from a fitted model the way MLB's are.

**The actual task for the new chat**: build the market-centric model layer (moneyline, totals, player prop scores) for the remaining sports, most likely following MLB's own architecture as the pattern (Elo/game-model/prop-scoring split, `model_weights` table, `run_walkforward.py`-style fitting CLI) — but confirm with the user which sport to start with and whether MLB's exact shape should be mirrored per-sport or adapted, since e.g. NHL/NFL/CFB/Soccer/Tennis have different real statistical shapes (win probability isn't 1:1 with baseball's log5/Bradley-Terry approach necessarily).

## Architecture conventions to follow (don't rediscover these)

- `CLAUDE.md` at the repo root documents two real conventions already established and enforced: (1) every new API route with a live external fetch/computation must go through `cachedRoute()` or the direct-SQLite-plus-`triggerFreshen()` pattern, not a hand-rolled third approach; (2) every new sport added to `PlayerDetail`/`TeamDetail`/`GameDetail` gets exactly one adapter file (`lib/sports/{sport}/adapters/{component}Adapter.ts`), never a `sport === 'x'` branch inside the shared component. Read it before writing new sport-specific code.
- `python-odds-service/`'s job-runner architecture (`job_runner.py`, `ProviderSpec`, `JOB_REGISTRY` in `jobs.py`) is the same "one shared runner, declared list of providers" pattern — model-fitting jobs should very likely follow an equivalent declarative shape once there's more than one sport's worth.

## Known, deliberately out-of-scope items (don't re-open these)

- NHL/NBA visual verification of the odds grid — deferred until their real seasons start. There's a reminder card in `/diagnostics` with a detailed resume prompt already built for this.
- A large separate pile of uncommitted files (`components/NbaLiveTab.tsx`, `NhlLiveTab.tsx`, `SoccerLiveTab.tsx`, `TennisLiveTab.tsx`, `MatchupExplorerCard.tsx`, tennis schedule/rankings/weather, team-defense-allowed, etc.) — this is a *different*, already-built "matchup card rebuild" project from a prior session, unrelated to both the odds rebuild and the upcoming model work. Its own NBA pipeline was flagged as unverified. Not touched tonight; a separate decision for whenever it's relevant.
