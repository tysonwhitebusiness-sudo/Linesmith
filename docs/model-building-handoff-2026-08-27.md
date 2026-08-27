# Handoff: resuming market-centric model building (2026-08-27)

Paste this whole file as your first message in the new chat.

## Where this picks up

We were building **market-centric prediction models per sport** (moneyline, totals, player prop scores — validated against sharp closing lines like Pinnacle, per real research on Closing Line Value, not outcome-accuracy alone) when we realized the underlying **odds system itself** was broken — the Python Render worker had been silently dead for 4 days, several providers were discarding real game-line data, and most sports had no working bookmaker-comparison grid at all. That detour became a full odds-architecture-rebuild project (8 phases), which just finished tonight. The odds system is now the *foundation* the model work sits on — it's done, verified, and should not need revisiting. This chat should resume the market-centric pivot directly, starting from `docs/mlb-market-centric-model-gameplan-2026-08-27.md`.

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

## What's genuinely next: the market-centric pivot, then per-sport model building

**Correction to this doc's original framing**: MLB is NOT a finished reference to copy. Its blend weights (`probability_blend.py`'s `MARKET_BLEND_WEIGHT`/`ELO_BLEND_WEIGHT`) are explicitly disclosed-but-never-fit placeholders, and its `walkforward.py` fitting harness scores outcome accuracy (log-loss/Brier) only — no Closing Line Value validation exists anywhere in the codebase today. The user's own research says betting markets (sharp closing lines specifically, Pinnacle as the reference) are the real anchor a model should be validated against, not outcome accuracy — the same conclusion that made an earlier reference tool ("quant-predictor")'s Pinnacle-paired-comparison + CLV backtest its strongest validation piece. See **`docs/mlb-market-centric-model-gameplan-2026-08-27.md`** — the actual, grounded gameplan for this pivot (audited against real code and real live data: 113 graded MLB picks, 18,453-row price-history log, 84 confirmed-live Pinnacle rows). Read that doc in full before starting model work; it supersedes this section.

**What DOES already exist and is real** (the building blocks the gameplan above works from, not a finished product): `python-odds-service/src/predict/elo_model.py`, `mlb_bradley_terry.py`, `mlb_mlp.py`, `mlb_stacking.py`, `mlb_tree_models.py`, `mlb_model_candidates.py`, `walkforward.py` (sport-agnostic fitting/CV harness — reusable, not MLB-specific), `game_model.py`/`game_model_cache.py`, `prop_candidates.py`/`prop_score.py`, `home_run_model.py`, `good_bets.py`, `market_trust.py` (a real, working Brier-Skill-Score trust-tiering pattern worth reusing for CLV validation too), `edge_model.py`. DB tables: `model_weights`, `mlb_game_model_cache`, `pick_history`, `game_picks` (has real open/close-shaped price pairs already — 102 rows with both `ml_initial_price` and `ml_final_price`).

**NFL/CFB/NBA/NHL/Soccer/Tennis have none of this yet** — confirmed by checking `python-odds-service/src/predict/` directly: every model file there is MLB- or golf-specific, zero `nfl_*`/`cfb_*`/`nba_*`/`nhl_*`/`soccer_*`/`tennis_*` model files exist. Those sports have working odds/props/UI infrastructure but no statistical model generating moneyline probabilities, total predictions, or player-prop scores yet.

**The actual task for the new chat**: work through `docs/mlb-market-centric-model-gameplan-2026-08-27.md`'s phases for MLB first (Phase 0's baseline CLV audit is the concrete starting point — it uses only data that already exists, no new code required to get a first real number). Once that pivot is proven on MLB, the *template* other sports inherit is the validation methodology (market-as-anchor, CLV-validated deviation signal, `walkforward.py`'s reusable fold harness) — not MLB's specific model files verbatim, since other sports' real statistical shape differs.

## Architecture conventions to follow (don't rediscover these)

- `CLAUDE.md` at the repo root documents two real conventions already established and enforced: (1) every new API route with a live external fetch/computation must go through `cachedRoute()` or the direct-SQLite-plus-`triggerFreshen()` pattern, not a hand-rolled third approach; (2) every new sport added to `PlayerDetail`/`TeamDetail`/`GameDetail` gets exactly one adapter file (`lib/sports/{sport}/adapters/{component}Adapter.ts`), never a `sport === 'x'` branch inside the shared component. Read it before writing new sport-specific code.
- `python-odds-service/`'s job-runner architecture (`job_runner.py`, `ProviderSpec`, `JOB_REGISTRY` in `jobs.py`) is the same "one shared runner, declared list of providers" pattern — model-fitting jobs should very likely follow an equivalent declarative shape once there's more than one sport's worth.

## Known, deliberately out-of-scope items (don't re-open these)

- NHL/NBA visual verification of the odds grid — deferred until their real seasons start. There's a reminder card in `/diagnostics` with a detailed resume prompt already built for this.
- A large separate pile of uncommitted files (`components/NbaLiveTab.tsx`, `NhlLiveTab.tsx`, `SoccerLiveTab.tsx`, `TennisLiveTab.tsx`, `MatchupExplorerCard.tsx`, tennis schedule/rankings/weather, team-defense-allowed, etc.) — this is a *different*, already-built "matchup card rebuild" project from a prior session, unrelated to both the odds rebuild and the upcoming model work. Its own NBA pipeline was flagged as unverified. Not touched tonight; a separate decision for whenever it's relevant.
