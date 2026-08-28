# Linesmith — System Inventory (Phase 1)

> **Purpose:** a factual map of what exists, built from the code, the live Postgres
> schema, the running config, and the Render/Supabase control planes. This is
> discovery only — no severity ranking, no recommendations. Phases 2–5 audit
> against this.
>
> **Compiled:** 2026-08-27, ~19:30 UTC, by an independent auditor with repo +
> DB + Render API access.
>
> **App name:** the repo/dir is `line-buddy`; `package.json`, the UI, and every
> audit doc call it **Linesmith**. Same thing.

---

## 0. Read this first — three facts that colour everything below

1. **The app is genuinely single-user today.** `auth.users` has exactly one row
   (the operator, `tysonwhitebusiness@gmail.com`, id `038048de-…c89f936`). Every
   user-owned table (`picks`, `bets`, `watchlist`, `tracked_lines`, `watch_links`)
   is empty or near-empty (`bets` = 2 rows). The whole thing has been built and
   run as one person's tool.

2. **The working tree is far ahead of the last commit, and the live DB is ahead
   of committed code.** `git status` shows **94 tracked files changed
   (+6,418 / −1,778), 5 deletions, and 112 untracked files** on top of commit
   `825e032`. The untracked set includes **27 API route files** (the entire
   `/api/tennis/*` surface, all `team-defense-allowed` routes, several
   `/api/picks/*` routes, most `game/[id]/live` routes) and **3 migration files
   that are already applied to production Postgres** (`tracked_lines`,
   `player_game_history`, `pick_history_price`). Anything you read in the repo is
   a mix of committed and uncommitted work; treat "what's in git history" as an
   unreliable guide to "what's running."

3. **The Python worker is currently not doing its job.** As observed at compile
   time, every `python-odds-service` job last ran between **02:43 and 02:51 UTC
   on 2026-08-27** — roughly 16–17 hours stale. `prop_odds`, `prop_odds_history`,
   and `provider_usage` have had no writes since `02:49:38`. The health-check
   cron *is* running (every 15 min, last write `19:16`) and *is* correctly
   reporting ~17 checks as `healthy=false`. This is the second occurrence of a
   silent worker hang (the first ran 2026-08-22 → 08-26). See §3 and §12.

---

## 1. Repository & deployment topology

### 1.1 One repo, four runtimes

| # | Runtime | What it is | Where it runs | Trigger | Deploys from |
|---|---|---|---|---|---|
| 1 | **Next.js web app** (`app/`, `lib/`, `components/`) | The UI + all read APIs + a small in-process scheduler | **Unconfirmed — evidence points to the operator's laptop** via `next start`/`next dev` (README says "personal, local-first … `npm run dev`"; no hosting config anywhere in the repo; `dev` and `start` scripts bind `-H 0.0.0.0` for LAN/phone access). | Always-on process | N/A (local) — **open question** |
| 2 | **Python odds/model worker** (`python-odds-service/src/main.py`) | 30-job sequential queue: odds-provider refresh, pick capture, grading, Elo/model maintenance | **Render** background worker `line-buddy-odds-worker` (`srv-da36bm2bkg8c73fqrdeg`), plan `starter`, region Oregon, 1 instance | Always-on (`python src/main.py` → `run_forever()`) | `autoDeploy: false` — **manual deploy only**. Live deploy `dep-da7pbhugekts738ndtm0`, commit `89f6754…` ("db.py: reduce worker pool max_size 3 → 2"), 2026-08-27 01:41. **Newer commits (through `825e032`) are NOT on the worker.** |
| 3 | **Health-check cron** (`python-odds-service/src/health_check.py`) | Independent staleness/ground-truth monitor for every worker job; writes `job_health_checks`, exits 1 if anything unhealthy | **Render** cron `line-buddy-odds-worker-health-check` (`crn-da7lquqfngtc73ft1n2g`), plan `starter` | `*/15 * * * *` | `autoDeploy: yes` — on latest `main` (`825e032`). Uses **transaction-mode pooler (port 6543)** via `DB_POOLER_MODE=transaction`. |
| 4 | **OddsHarvester scraper** (`python-odds-service/src/harvester_scrape.py`, vendored lib in `oddsharvester/`) | Playwright/Chromium scrape of OddsPortal for per-book game lines → `game_odds_book_lines` (`source='oddsharvester'`) + `job_health_checks` (`oddsharvester_scrape_*`) | **The operator's Windows laptop**, one Windows Scheduled Task **per sport** (`LinesmithOddsHarvester-mlb`, `-nfl`, `-cfb`, `-nba`, `-nhl`, `-soccer_epl`, `-soccer_mls`, `-tennis`), each every **150 min**, staggered 15 min apart. Requires the machine awake + logged in. Setup: `scripts/harvester-laptop-setup.ps1`, docs `scripts/harvester-laptop-README.md`. | Windows Task Scheduler | N/A (local). **Was** a GitHub Actions workflow (`.github/workflows/oddsharvester-scrape.yml`) — now `workflow_dispatch`-only; GitHub runner IPs get HTTP 429 from OddsPortal. |

All four share **one Supabase Postgres database** (project ref `qsqzercvwnzaeboltvca`).

### 1.2 What breaks if each stops

- **Web app down:** the product is unavailable. Also the in-process scheduler
  (`lib/scheduler.ts`) stops, so `mlb:snapshot` / `mlb:full-raw:{date}` and the
  MLB calibration cache stop being pre-warmed (routes still rebuild them lazily on
  demand). MLB player-prop `pick_history` also stops being written by the TS
  `logSurfaced` path (see §12).
- **Python worker down (current state):** no player-prop odds refresh for any
  sport; no game-line odds cycle; no Elo / game-model / prop-model maintenance;
  no pick grading for the 6 "generic" sports or golf; no MLB game-lines credit
  refresh. The site keeps serving whatever's in the DB, increasingly stale, with
  no user-visible "this is stale" signal on most surfaces.
- **Health-check cron down:** no independent detection of a worker hang.
- **OddsHarvester laptop down:** `game_odds_book_lines` stops getting fresh
  per-book comparison rows; Game Detail bookmaker grids go stale.

---

## 2. Data sources (upstream APIs / feeds)

Enumerated from `grep` of `https://…` hosts across `lib/` and `python-odds-service/src/`,
cross-referenced with `.env.local`, `config.py`, `lib/odds/props/config.ts`, and
`jobs.py`.

### 2.1 Paid / keyed odds providers (cost money per call)

| Provider | Host | Key env vars | Configured budget (from `.env.local`) | Used for | Live? (from `provider_usage` / `prop_odds`) |
|---|---|---|---|---|---|
| **Propline** | `api.prop-line.com` | `PROPLINE_KEY`, `PROPLINE_2_KEY` | 1,000 req/day each | MLB props (key 1, Tier 1); Soccer EPL/MLS props (key 2) | **Yes** — 897 req on 2026-08-27 before the worker stalled; `prop_odds` provider `propline` = 141,854 rows |
| **Odds-API.io** | `api.odds-api.io` | `ODDSAPIIO_KEY` | 100 req/hr, 500/day | MLB props, books Fanatics + BetMGM (operator's book) | **Yes** — 251 req on 2026-08-27; 29,888 `prop_odds` rows |
| **SharpAPI** | `api.sharpapi.io` | `SHARPAPI_KEY` | 12 req/min, no monthly cap | MLB props (DK+FD), MLB/tennis game lines | **Yes** — 32,159 `prop_odds` rows; also writes `game_odds_book_lines` (`source='sharpapi'`) |
| **SportsGameOdds** | `api.sportsgameodds.com` | `SPORTSGAMEODDS_KEY`, `SPORTSGAMEODDS_MULTISPORT_KEY` | 2,500 objects/mo (soft cap 2,000), 10 req/min | MLB props (key 1); NFL/CFB/NBA/MLS props (multisport key) | **Partial** — `sportsgameodds` 1,643 objects in 2026-08, last `prop_odds` write 2026-08-21; `sportsgameodds_multisport` 305 objects, last write 2026-08-21. Both **quiet for ~6 days** even before the current hang. |
| **The Odds API** | `api.the-odds-api.com` | `ODDS_API_KEY` (a.k.a. `THEODDSAPI_KEY`) | 500 credits/mo free; TTL 360 min; reserve 25 | **MLB game lines** (moneyline/spread/total) — `odds_cache`, `game_odds_book_lines` (`source='the-odds-api'`) | **Yes** — `odds_cache` row `baseball_mlb:h2h,spreads,totals:us` refreshed 2026-08-27 02:14, 346 credits remaining. Health check reports `ODDS_API_KEY is not set` **inside the worker** (Render env var missing) — see §12. |
| **ParlayAPI** | `parlay-api.com` | `PARLAYAPI_KEY` + per-sport `PARLAYAPI_{MLB,NFL,CFB,SOCCER,NBA}_KEY` + `PARLAYAPI_SPARE_KEY` | 1,000 credits/mo each (soft cap 800) | NFL/CFB/Soccer/(NBA) props | **Barely** — `parlayapi_nfl` 23 req, `parlayapi_cfb` 10 req, `parlayapi_soccer` 37 req in 2026-08; last `prop_odds` writes 2026-08-21. `PARLAYAPI_NBA_KEY` unset (NBA ParlayAPI naturally disabled). Legacy `parlayapi` id: 1,095 req in 2026-08. |
| **OddsPapi** | `api.oddspapi.io` | `ODDSPAPI_KEY` | 250 req/mo (soft cap 200) — "extremely precious" | Sharp reference (Pinnacle) + free historical MLB odds | Lightly — 80 req in 2026-08; feeds `historical_odds` backfill routes. Not in the Python `JOB_REGISTRY`. |
| **TheRundown** | `therundown.io` | `RUNDOWN_KEY` | 1 req/sec; free tier has **no** player props | Game-lines / schedule / live-score enrichment | `lib/odds/rundown.ts` exists; **no evidence of live use** — no rows attributable to it, not in `JOB_REGISTRY`. Unverified. |
| **OddsPortal** (scrape) | `www.oddsportal.com` | none (Playwright scrape) | — | Per-book game lines for MLB/NFL/CFB/soccer/tennis → `game_odds_book_lines` (`source='oddsharvester'`) | **Yes** — freshest rows `19:03–19:24` on 2026-08-27; the only currently-fresh game-line source. |

### 2.2 Free stats / schedule / context feeds (no cost, mostly no key)

| Feed | Host(s) | Used for |
|---|---|---|
| **ESPN public APIs** | `site.api.espn.com`, `site.web.api.espn.com`, `a.espncdn.com` | Schedules, scoreboards, box scores, rosters, player game logs, golf field/leaderboard, live game state — **for every sport except MLB core**. The single most-relied-on feed. |
| **MLB Stats API** | `statsapi.mlb.com` | MLB schedule, lineups, probable pitchers, live game, final scores, player game logs |
| **Baseball Savant** | `baseballsavant.mlb.com` | Statcast (team + player), park factors, xStats |
| **CollegeFootballData** | `api.collegefootballdata.com` | `CFBD_API_KEY` — CFB play-by-play, box scores, rosters, opponent-defense ranks (the CFB "X-signal") |
| **nflverse** | GitHub-hosted parquet/CSV (`github.com/nflverse`) | NFL player/team weekly stats, rosters, schedules (cached as `nflverse-*` in `snapshot_cache`) |
| **NHL** | `api-web.nhle.com`, `api.nhle.com` | NHL schedule, box scores, standings |
| **sportsdataverse / hoopR** | (via ESPN + GitHub) | NBA box scores (`nba:sdv:boxscores:2026` cache) |
| **Understat** | `understat.com` | Soccer xG (EPL) |
| **American Soccer Analysis** | `app.americansocceranalysis.com` | Soccer xG by game (MLS + others), `soccer:asa:xgoals:*` cache |
| **TennisMyLife** | `stats.tennismylife.org` | Tennis rankings, season leaders, schedule |
| **PGA Tour** | `www.pgatour.com` | Golf player season stats (SG categories) |
| **Open-Meteo** | `api.open-meteo.com`, `geocoding-api.open-meteo.com` | Weather + venue geocoding (golf rounds, outdoor games) |
| **DeepSeek** | `api.deepseek.com` | `DEEPSEEK_API_KEY` — AI health-summary text on `/diagnostics` (`/api/diagnostics/ai-summary`). `provider_usage` shows `deepseek` 26,398 "objects" (tokens) in 2026-08. |
| **Anthropic** | (SDK) | `ANTHROPIC_API_KEY` — screenshot→odds vision import (`/api/odds/import`, `lib/odds/screenshotImport.ts`) |

### 2.3 Configured but idle / legacy

- `RUNDOWN_KEY` / TheRundown — wired in code, no observed traffic.
- `PARLAYAPI_SPARE_KEY` — explicitly a spare, not wired.
- `THEODDSAPI_ENABLED=false` under the props-provider naming (the same underlying
  key is live for game lines under `ODDS_API_KEY`).
- `lib/odds/rundown.ts`, `lib/odds/props/providers/theOddsApi.ts`,
  `lib/odds/props/providers/oddsPapi.ts` — provider adapters that may or may not be
  on a live path post-Python-cutover; **flagged for Phase 2.**

---

## 3. Services & processes (detail)

### 3.1 Next.js in-process scheduler — `lib/scheduler.ts`

- Started by a **module-level side effect** in `app/api/mlb/route.ts` and
  `app/api/nfl/route.ts` (`ensureSchedulerStarted()` at import time). Idempotent
  via a module boolean. In `next start` every route module loads at boot, so it
  starts at boot; in `next dev` it starts on the first request to hit one of
  those routes.
- Two `setInterval` jobs, **MLB-only**:
  - `refreshMlb` every **4 min** → `rebuildMlbSnapshot(easternDate())` → writes
    `mlb:snapshot` and `mlb:full-raw:{date}` in `snapshot_cache`; also calls
    `logSurfaced` → `pick_history` (MLB player-prop candidates).
  - `refreshCalibration` every **2 min** → recomputes MLB calibration payload for
    scopes `all`/`player`/`game` → `snapshot_cache`.
- **History (per the file's own header):** this file used to own five
  odds-provider refresh jobs (Tier 1, SportsGameOdds, NFL, CFB, Soccer/EPL);
  those moved to the Python worker on 2026-08-20. Only `refreshMlb` +
  `refreshCalibration` remain.

### 3.2 Python worker — `python-odds-service/src/`

- **Entrypoint:** `main.py` → `SequentialQueue(JOB_REGISTRY).run_forever()`.
- **Queue model** (`job_queue.py`): exactly one job's work in flight at a time
  ("Constraint 2"). Ordering is **overdue-ratio priority**
  (`(now − last_run_end) / interval`), not FIFO. Startup fires every job once in
  registry order. A long job (NFL/CFB) calls `maybe_yield()` at its rate-limit
  wait points so a more-overdue job can run to completion and return.
- **Per-job timeout:** `JOB_TIMEOUT_SECONDS = 600`, measured against the job's
  *own* time (nested yielded time is "excused"). Three separate real bugs in this
  accounting are documented inline as already-fixed.
- **`JOB_REGISTRY` — 30 jobs** (`jobs.py`), name → factory → interval:

  | Job | Interval | What it does |
  |---|---|---|
  | `refreshTier1` | 2.5 min | MLB props: SharpAPI, SharpAPI game-lines, Odds-API.io, Propline |
  | `refreshSportsGameOddsJob` | 90 min | MLB props: SportsGameOdds (primary account) |
  | `refreshNflJob` / `refreshCfbJob` / `refreshNbaJob` | 20 min | ParlayAPI(sport) + SportsGameOdds(multisport), gated by `gameday.py` proximity tier |
  | `refreshSoccerEplJob` / `refreshSoccerMlsJob` | 20 min | Propline key 2 + ParlayAPI-soccer (+ SGO-multisport for MLS) |
  | `refreshTennisAtpJob` / `refreshTennisWtaJob` | 20 min | SharpAPI props + game lines. **Currently failing:** `TypeError: normalize() argument 2 must be str, not None` |
  | `gradeFinishedMlbPicksJob` | 15 min | Grade `game_picks` (MLB) vs final scores |
  | `mlbGameLinesJob` | 30 min | Refresh `odds_cache` MLB game-lines row (The Odds API, 6h TTL) |
  | `mlbOddsLinesCycleJob` | 5 min | MLB moneyline/total pick-lock capture cycle (`odds_lines_cycle.py`) |
  | `maintainMlbEloJob` | 15 min | Write `team_elo_history` + `pitcher_game_score_history` for finished MLB games |
  | `computeMlbGameModelJob` | 15 min | Compute + persist `mlb_game_model_cache` for today's pre-game MLB matchups |
  | `computeMlbPropPredictionsJob` | 5 min | MLB player-prop candidate model probs → `pick_history` (`log_surfaced`) |
  | `golfPredictionsJob` | 5 min | Golf hole/round/tournament model predictions + history ingest + grading |
  | `genericCaptureJob` | 5 min | Game-pick capture for NFL/CFB/NBA/NHL/EPL/MLS (Elo+market blend) |
  | `gradeFinishedGenericPicksJob` | 15 min | Grade those 6 sports' `game_picks` vs ESPN finals |
  | `attachGenericPricesJob` | 15 min | Attach market prices to those `game_picks` rows |
  | `genericPlayerHistoryFreshnessJob` | 30 min | Keep `player_game_history` current (trailing window, all sports) |
  | `genericPropProduction{Nfl,Cfb,Nba,Nhl,SoccerEpl,SoccerMls}Job` | 60 min | Per-sport player-prop candidate generation → `pick_history` |
  | `gradeGenericPropsJob` | 15 min | Grade those generic prop candidates |

- **Provider-job architecture** (`job_runner.run_provider_specs` +
  `providers.ProviderSpec`): one runner does cap-check → fetch → record-spend →
  `write_prop_odds` for every provider; each sport declares a `list[ProviderSpec]`.
  Documented at length in `CLAUDE.md`.
- **`gameday.py`:** proximity tiering — the free ESPN schedule fetch runs every
  cycle; the *paid* provider fetch only fires when a game is within a
  "hot/warm" window. Health-check details show NFL/CFB/NBA/soccer all in
  "cold tier" right now (no imminent games) — so even a healthy worker would be
  making few paid calls today.

### 3.3 Health-check cron — `health_check.py`

- Two check kinds: (a) generic per-job staleness — did each `JOB_REGISTRY` job
  run within `2× interval` and report `ok=True` (reads
  `python-harness:job-run:{name}` breadcrumbs in `snapshot_cache`); (b)
  ground-truth checks that re-derive expected state from live APIs:
  `eloFreshness`, `mlbModelFreshness`, `gameModelFreshness`, `gamePicksFreshness`,
  `oddsHistoryAndPricesFreshness`, `propPredictionsFreshness`,
  `golfPredictionsFreshness`, `gameOddsBookLinesFreshness`, `snapshotCacheSize`.
- Writes all results to `job_health_checks`; prints a summary; **exit 0 if all
  healthy, 1 otherwise**. `render.yaml` notes that `notifyOnFail` must be wired
  in the Render dashboard for a failing run to actually page anyone —
  **not verified whether that's configured.**

### 3.4 OddsHarvester — `harvester_scrape.py` + `oddsharvester/`

- `oddsharvester/` is a **vendored copy of `jordantete/OddsHarvester`** (its own
  `pyproject.toml`, `.github/`, `build/`, tests). `.venv` and HAR fixtures
  gitignored.
- `harvester_scrape.py` drives it per-sport, matches scraped events to the DB's
  game ids, upserts `game_odds_book_lines` (`source='oddsharvester'`), and writes
  a `oddsharvester_scrape_{sport}` row to `job_health_checks`.
- `docker/oddsharvester/Dockerfile` exists (containerised variant); current
  production path is the Windows Scheduled Tasks.

---

## 4. Data flow

```
                     ┌─────────────────────────── FREE STATS FEEDS ───────────────────────────┐
                     │ ESPN · MLB StatsAPI · Baseball Savant · CFBD · nflverse · NHL · Understat│
                     │ · ASA · TennisMyLife · PGA Tour · Open-Meteo                             │
                     └───────────────┬──────────────────────────────────┬─────────────────────┘
                                     │                                  │
             ┌───────────────────────▼──────────┐        ┌──────────────▼───────────────────────┐
             │  NEXT.JS WEB APP  (laptop?)       │        │  PYTHON WORKER  (Render)              │
             │  ── read APIs per sport           │        │  30-job SequentialQueue              │
             │  ── lib/scheduler.ts:             │        │  ── refreshTier1 / SGO / NFL / CFB / │
             │       refreshMlb  (4m)  ──────────┼──┐     │      NBA / soccer / tennis  ─────────┼──┐
             │       refreshCalibration (2m)     │  │     │  ── mlbOddsLinesCycle / gameModel /  │  │
             │  ── cachedRoute() SWR wrapper     │  │     │      maintainElo / prop predictions  │  │
             │  ── logSurfaced (MLB props)  ─────┼──┼──┐  │  ── generic capture / grade / prod   │  │
             └──────────────┬───────────────────┘  │  │  │  ── golfPredictions                  │  │
                            │ reads                 │  │  └──────────────┬──────────────────────┘  │
                            │                       │  │                 │ writes                   │
   PAID ODDS APIs ──────────┼───────────────────────┘  │                 │                          │
   the-odds-api (game lines)│  Propline · Odds-API.io · SharpAPI · SportsGameOdds · ParlayAPI ──────┘
   Anthropic (screenshot)   │                          │                 │
                            │                          ▼                 ▼
   OddsPortal ── OddsHarvester (laptop, 8 scheduled tasks) ──► game_odds_book_lines
                            │                                            │
                            ▼                                            ▼
             ┌───────────────────────────────────────────────────────────────────────────────────┐
             │                    SUPABASE POSTGRES 17.6  (project qsqzercvwnzaeboltvca)          │
             │  snapshot_cache (SWR blob cache) · prop_odds / prop_odds_history · game_odds_*     │
             │  pick_history · game_picks · player_game_history · team_elo_history · model_weights │
             │  provider_usage · job_health_checks · system_events · golf_* · historical_odds     │
             └───────────────────────────────────────────────────────────────────────────────────┘
                            ▲                                            ▲
                            │ direct pg (bypasses RLS)                   │ PostgREST + anon key
                            │                                            │ (RLS on 4 tables only)
                    Next.js API routes                          Browser Supabase client (auth only)
```

### 4.1 Two caching patterns (per `CLAUDE.md`)

1. **`cachedRoute()`** (`lib/cachedRoute.ts`) — stale-while-revalidate over
   `snapshot_cache`. Composes `staleCache.ts` (per-key rebuild dedup),
   `readSnapshotCache`/`writeSnapshotCache`, and `jsonPassthrough.ts`
   (serve pre-serialized JSON, negotiate gzip). Serves `hit` / `stale` / `miss`
   with matching `x-cache` + `cache-control` headers.
2. **Direct Postgres reads, refreshed out-of-band** — e.g. `/api/props/lines`
   reads `prop_odds` directly; the Python worker is the sole writer.

### 4.2 Transform / derive points

- **MLB snapshot rebuild** (`lib/sports/mlb/snapshotRebuild.ts`): the heaviest.
  Fans out to StatsAPI + Savant, builds the full slate, runs the scan/streak/form
  engine, computes model probs, writes `mlb:full-raw:{date}` (raw, 33–72 MB) and
  `mlb:snapshot` (derived, ~11 MB), and calls `logSurfaced`.
- **Per-sport adapters** (`lib/sports/{sport}/adapter.ts` + `adapters/*Adapter.ts`):
  normalise each sport's raw feed shape into shared `PickCandidate` /
  `PlayerDetailData` / `TeamDetailData` / `GameDetailData` types. One adapter file
  per sport per shared component; no `sport === 'x'` branches in the components
  (architecture documented in `CLAUDE.md`).
- **Odds matching** (`lib/odds/matching.ts` `buildSlate`): joins scan candidates
  to `prop_odds` rows by `(subjectId, marketKey, line)`; joins games to game lines
  by event id then team-name fallback.
- **Devig / edge** (`lib/odds/devig.ts`, `lib/odds/props/liveEdge.ts`,
  `lib/odds/props/edgeModel.ts`, `lib/odds/goodBets.ts`): market-implied prob,
  vig removal, edge %, "Good Bet" gating. **Phase 3 territory — not audited here.**
- **Merge policy for `game_odds_book_lines`** (`lib/db/client.ts`
  `mergeGameOddsBookLineRows`): for the same `(bookmaker, market, side)` reported
  by multiple sources, freshest `fetched_at` wins.

---

## 5. Database

**Engine:** Supabase-hosted PostgreSQL **17.6**. **Total size:** ~1.54 GB.
**Extensions:** `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`,
`uuid-ossp`. **35 tables in `public`.** Migrated from SQLite/better-sqlite3 on
2026-08-18 (`20260818201108_initial_schema.sql` ported 27 tables); 17 later
migration files (3 of them uncommitted — see §0).

**Connection model:** the app + worker connect with a **direct Postgres
connection string** through Supabase's Supavisor pooler and therefore **bypass
RLS entirely**; isolation is enforced by `WHERE user_id = ?` in application code.
The browser only uses Supabase for auth (anon key), which goes through PostgREST
where RLS *does* apply.

**Pooler reality** (documented across `lib/db/pgClient.ts`, `config.py`, `db.py`,
and Render commit messages): the session-mode pooler (port 5432) has a **hard
~15-connection cap shared by every consumer**, of which ~6 are permanent Supabase
platform overhead (`pg_net`, `pg_cron`, Supavisor auth/management,
`postgres_exporter`, PostgREST) → real app budget ≈ **9**. Current pool ceilings:
Next.js `pg` pool `max: 6`, worker `asyncpg` `max_size: 2` (was 5→3→2 same day),
health-check cron on transaction-mode pooler (port 6543) to avoid the cap.
`pg_stat_activity` at compile time: 25 Supavisor connections (19 idle, 4 active,
2 idle-in-transaction).

### 5.1 Tables — size, rows, writers, readers

Row counts are live `SELECT count(*)` at compile time.

| Table | Rows | On-disk | Written by | Read by | Notes |
|---|---:|---:|---|---|---|
| **player_game_history** | 1,433,042 | 805 MB | worker `genericPlayerHistoryFreshnessJob` + one-time backfill (`backfill_player_game_history.py`) | `generic_prop_score.py`, windowed-stat reads | `stats` is `JSONB`. Sports present: NHL 641k, CFB 274k, NFL 227k, EPL 168k, MLS 134k. **No MLB, NBA, golf, tennis rows.** History spans 2010→2026. |
| **snapshot_cache** | 3,009 | 366 MB | `cachedRoute()`, `lib/scheduler.ts`, many `readSnapshotCache`/`writeSnapshotCache` callers, worker job-run breadcrumbs | everything with a cache | Key/value blob cache (`payload TEXT`). Dominated by `mlb:full-raw:{date}` (33–72 MB **each**, ~14 daily copies retained) and `nflverse-*` (22–59 MB). Health check flags it: "total size 1340MB exceeds 800MB; largest single payload 72.4MB exceeds 10MB." Implicated in a past **103 GB egress overage**. No retention/trim job. |
| **prop_odds_history** | 425,307 | 111 MB | `lib/db/client.ts writePropOdds` (TS) + `db.py write_prop_odds` (worker), log-on-change | grading (`readPropOddsHistoryForKey`), line-history routes | Append-only. Latest row `2026-08-27 02:49` (frozen with the worker). |
| **prop_odds** | 290,663 | 105 MB | same as above (upsert) | `/api/props/lines`, slate matching, Scan | Latest `02:49`. 9 provider ids present; only `sharpapi`/`propline`/`oddsapiio` were fresh pre-hang. |
| **pick_history** | 362,607 | 102 MB | TS `logSurfaced` (MLB, via `lib/scheduler.ts`) + worker `computeMlbPropPredictionsJob` + `genericPropProduction*Job` + backfill routes; graded by TS `grading.ts` + worker `gradeGenericPropsJob` | `/diagnostics`, calibration, `usePickHistoryModelData` | System-wide model-calibration log (**not** per-user; no `user_id`, deliberately). 362,400 MLB / 207 NFL. 356k graded. `edge_source` column exists but is **100% NULL**. |
| **team_elo_history** | 88,722 | 14 MB | worker `maintainMlbEloJob` + per-sport Elo backfills; table made sport-generic 2026-08-27 | game models, matchup cards | MLB 78.5k (latest game 2026-08-26); NHL 3k, NBA 2.8k, CFB 1.9k, MLS 998, EPL 780, NFL 736. |
| **historical_odds** | 37,922 | 9.8 MB | ingest routes (`/api/props/ingest-historical-odds`, `backfill-oddspapi-historical`) from `data/historical-odds-import/*.xlsx` + OddsPapi | MLB model fitting / walk-forward | Seasons 2010–2026 (17 seasons). MLB only. |
| **game_odds_history** | 19,667 | 4.9 MB | worker `mlbOddsLinesCycleJob` (`writeGameOddsHistory`), log-on-change; `source` column added for multi-writer | model features, line-movement | 6,013 rows in the last 24h per health check (this path *is* still firing). |
| **game_odds_book_lines** | 3,289 | 1.9 MB | OddsHarvester (laptop), `the-odds-api` (worker), `sharpapi`/`propline` (worker), ESPN (TS) — `source` is part of the unique key | Game Detail bookmaker grid, `/api/odds/lines` non-MLB branch | Only currently-fresh game-line data. Sources by sport: mlb (4 sources), nfl/cfb/soccer/tennis (oddsharvester, fresh `~19:00`); **nba + nhl have zero rows**. |
| **golf_hole_scores** | 8,875 | 1.9 MB | worker `golfPredictionsJob` history ingest | golf models | |
| **golf_model_predictions** | 5,655 | 1.5 MB | worker `golfPredictionsJob` | `/diagnostics`, golf calibration | 2,846 graded. Latest `19:18` — **this path appears still alive** (see §12). |
| **odds_unresolved** | 1,538 | 616 kB | provider fetches (`replaceUnresolvedForProvider`) | `/diagnostics` | Players/markets/books a fetch couldn't map. |
| **game_picks** | 160 | 408 kB | worker `mlbOddsLinesCycleJob` (MLB ML/total locks), `genericCaptureJob` (6 sports) | Scan record chip, `/api/picks/game-history`, bankroll | MLB 144 (113 graded), NFL 4, soccer 4, CFB 8 — all ungraded. Wide table (~55 cols: initial/final × ML/total × prob/price/CI/kelly/features). |
| **odds_cache** | 6 | 320 kB | `writeOddsCache` (the-odds-api game lines, tennis SharpAPI outrights, golf SharpAPI outrights) | `/api/odds/lines`, tennis/golf lines | Separate from `snapshot_cache`; has `requests_remaining`/`requests_used` credit tracking. |
| **golf_round_scores** | 474 | 176 kB | worker golf history | golf round-score model | |
| **park_factors** | 540 | 120 kB | `/api/props/park-factors` / model-fit routes | MLB models | 17 seasons × ~31 venues. |
| **job_health_checks** | 32 | 112 kB | `health_check.py` `write_health_check_results` + OddsHarvester | `/api/props/system-health`, `/diagnostics` | `check_name` PK (upsert). At compile time ~17 rows `healthy=false`. |
| **model_weights** | 21 | 112 kB | `run_walkforward.py --activate` / fit routes | game models, prop edge | MLB only: `moneyline` v1–8 (**v8 active**), `total` v1–8 (**v8 active**), `home-run` v1–5 (**v5 active**). All fitted 2026-08-12→14. No other sport has a fitted model. |
| **pitcher_game_score_history** | 214 | 104 kB | worker `maintainMlbEloJob` | MLB game model (pitcher adj) | Latest `2026-08-26`. |
| **golf_tournament_predictions** | 123 | 104 kB | worker `golfPredictionsJob` | golf calibration | 119 graded. |
| **system_events** | 101 | 88 kB | `logSystemEvent` (TS + worker) | `/diagnostics` | Lightweight error log. Recent: `golf/predictions` failures, repeated `api/odds/lines` errors (`statement timeout`, `EMAXCONNSESSION`, `ENOTFOUND`, `timeout exceeded`). |
| **bets** | 2 | 80 kB | `/api/bets` (user action) | `/bets` | RLS enabled. |
| **walkforward_results** | 21 | 80 kB | `run_walkforward.py` | model diagnostics | MLB moneyline only: 7 model families (`stacking`, `mlp`, `lightgbm`, `xgboost`, `catboost`, `bradley_terry`, `formula`), fitted 2026-08-26. **None activated** (`model_artifacts` empty). |
| **golf_tournament_results** | 119 | 72 kB | worker golf grading | golf grading | |
| **mlb_game_model_cache** | 24 | 64 kB | worker `computeMlbGameModelJob` | `adapter.ts` game model (Phase O) | Health check flags it STALE — 5 of 5 pre-game matchups missing today (worker hung). |
| **picks** | 0 | 64 kB | `/api/picks` (user slip) | `/bets`, slip | **Legacy/empty.** RLS enabled. Distinct from `pick_history`. |
| **game_sim_cache** | 172 | 64 kB | MLB sim engine (`gameSimCache.ts`) | MLB game detail | PK is `(sport, game_id)`. |
| **model_calibration** | 0 | 64 kB | (fit routes — never run) | intended: calibrated model probs | **Empty** — no calibration layer fitted yet. |
| **provider_usage** | 38 | 64 kB | `incrementProviderUsage` (TS) + `record_daily/monthly_spend` (worker) | budget gates, `/diagnostics` | PK `(provider_id, period_kind, period_key)`. |
| **golf_tournaments** | 3 | 56 kB | worker golf | golf | |
| **tracked_lines** | 0 | 40 kB | `/api/tracked-lines` (user) | player detail live tracker | RLS enabled. Migration **uncommitted**. |
| **watchlist** | 0 | 40 kB | `/api/watchlist` (user) | Scan watchlist | RLS enabled. |
| **model_artifacts** | 0 | 32 kB | `run_walkforward.py --activate` (ensemble) | intended: ensemble serving | **Empty** — the tree/MLP/stacking ensemble is built + backtested but **not in production**. |
| **watch_links** | 0 | 32 kB | `/api/watch-links` | "Watch" tab embeds | **No RLS, no `user_id`** — global table, PostgREST-exposed. |
| **team_hr_rate_allowed** | 30 | 24 kB | HR model fit | HR live matchup | PK `(team_id, season)`. |

### 5.2 Indexes & constraints

- **88 indexes** across 35 tables. Every table has a primary key. Heavy tables
  have targeted composite + partial indexes (e.g.
  `idx_pick_history_ungraded ... WHERE outcome IS NULL`,
  `idx_prop_odds_history_lookup` on the full 7-col dedup key,
  `idx_player_game_history_lookup (sport, athlete_id, season, game_date)`).
- **Foreign keys:** only 4 in the entire schema —
  `picks/bets/watchlist/tracked_lines.user_id → auth.users(id)`. The
  initial-schema port deliberately carried over SQLite's zero-FK design; the
  sports-data tables have **no referential constraints** (e.g. `prop_odds.game_id`
  is a bare `TEXT`).
- **Uniqueness** is done with `UNIQUE (...)` natural keys on almost every table
  (the basis for every `ON CONFLICT` upsert). `pick_history` unique key:
  `(sport, subject_id, dimension, category, game_id)` — "first surfaced wins."
- **`CHECK` constraints:** essentially none except `tracked_lines.side` /
  `.source` (added in that migration). Status/enum columns
  (`bets.status`, `pick_history.outcome`, `game_picks.ml_outcome`, …) are bare
  `TEXT` with the allowed values only in comments.
- **JSON storage:** `snapshot_cache.payload` / `odds_cache.payload` and all
  `*_json` columns are `TEXT`, not `JSONB` (deliberate deferral in the migration).
  The one exception: `player_game_history.stats` is real `JSONB`.

### 5.3 RLS

| Table | RLS enabled | Policy |
|---|---|---|
| `picks` | yes | `picks_owner_all` — `FOR ALL USING (auth.uid() = user_id) WITH CHECK (…)` |
| `bets` | yes | `bets_owner_all` — same shape |
| `watchlist` | yes | `watchlist_owner_all` — same shape |
| `tracked_lines` | yes | `tracked_lines_owner_all` — same shape |
| **all other 31 tables** | **no** | none — PostgREST exposes them to any holder of `NEXT_PUBLIC_SUPABASE_ANON_KEY` (which ships in the browser bundle). Rows with `user_id IS NULL` on the 4 protected tables are invisible to every policy. |

*(Adversarial testing of this posture is Phase 4's job — noted here as fact only.)*

### 5.4 Data lifecycle observations (facts, not judgments)

- `snapshot_cache` — `mlb:full-raw:{date}` and `mlb:snapshot:{date}` accumulate
  one row per day and are never deleted (rows back to 2026-08-12 present).
- `prop_odds` — upserted in place (current price); `prop_odds_history` is the
  append-only archive. No pruning of either.
- `pick_history` / `game_picks` — append + grade in place; never pruned.
- `player_game_history` — freshness job adds forward; no deletion.
- `system_events` — append-only, no rotation (101 rows, so not yet a concern).
- `odds_unresolved` — `replaceUnresolvedForProvider` deletes + reinserts per
  provider each fetch (self-trimming).

---

## 6. Models

### 6.1 Where model code lives

- **TS:** `lib/core/` (logistic regression, normal dist, Kelly, probability blend,
  confidence), `lib/sports/mlb/` (`gameModel.ts`, `eloModel.ts`, `homeRunModel.ts`,
  `simEngine.ts`/`simGame.ts`/`simRates.ts`, `modelFit.ts`,
  `homeRunModelFit.ts`), `lib/sports/golf/models/` (hole-score, round-score,
  tournament-win, grading), `lib/odds/props/edgeModel.ts` / `propScore.ts` /
  `marketTrust.ts`.
- **Python:** `python-odds-service/src/predict/` — **64 files**. Includes a full
  MLB moneyline ensemble (`mlb_bradley_terry.py`, `mlb_mlp.py`, `mlb_stacking.py`,
  `mlb_tree_models.py` [catboost/xgboost/lightgbm], `model_benchmark.py`,
  `walkforward.py`, `run_walkforward.py`, `clv_backtest.py`), the MLB sim engine,
  Elo, game model, HR model, prop-score infra (`generic_prop_score.py`,
  `prop_candidates.py`, `prop_pick_history.py`), golf models, and per-sport
  generic capture/grading/production.

### 6.2 What's actually active in production (from the DB)

| Model | Sport | Predicts | Active version | Fitted | Serving path |
|---|---|---|---|---|---|
| Moneyline logistic | MLB | home-win prob | `model_weights` moneyline **v8** (holdout Brier 0.2398 vs baseline 0.2594) | 2026-08-14 | game model blend |
| Total logistic | MLB | over/under prob | `model_weights` total **v8** (0.2475 vs 0.2639) | 2026-08-14 | game total blend |
| Home-run logistic | MLB | HR-in-game prob | `model_weights` home-run **v5** (0.0944 vs 0.0948 — **barely beats baseline**) | 2026-08-14 | HR board |
| Elo | MLB (+ other sports has rows) | team strength | rolling, `team_elo_history` | continuous | game model, matchup cards |
| Sim engine | MLB | win prob + expected total | `game_sim_cache` | per-matchup | MLB game detail |
| Golf hole/round/tournament | golf | birdie/par/bogey, round score, win/top5/top10/cut | code-defined, no `model_weights` row | continuous | golf Scan + calibration (`golf_*_predictions`, 2,846 + 119 graded) |
| Beta-Binomial prop baseline | all | player-prop over prob | code-defined (`propScore` / `generic_prop_score`) | n/a | Scan Score column, `pick_history.model_prob` |

**Not active despite being built:**
- The MLB moneyline **ensemble** (`stacking`/`catboost`/`mlp`/…): `walkforward_results`
  has 21 rows fitted 2026-08-26, best holdout Brier ~0.241 (`catboost`/`formula`),
  but `model_artifacts` and `model_calibration` are **empty** — nothing is
  activated, production still uses the v8 logistic ("formula") weights.
- Any fitted model for **NFL, CFB, NBA, NHL, soccer, tennis** — those sports run
  on Elo + market blend + the generic Beta-Binomial prop baseline only.
- A **calibration layer** — `model_calibration` empty for every sport.

### 6.3 Where predictions land

`pick_history.model_prob` (player props, all sports), `game_picks.ml_*_prob` /
`total_*_prob` (game locks), `mlb_game_model_cache` (MLB pre-game),
`golf_model_predictions` / `golf_tournament_predictions`, `game_sim_cache`.
Grading writes `outcome` / `*_outcome` / `actual_value` / `graded_at` back onto
the same rows; `/diagnostics` reads calibration buckets + Brier off `pick_history`.

---

## 7. Frontend

**Framework:** Next.js 15.5 App Router, React 19, one server process
(`next start`), Tailwind, `IBM_Plex_Mono` via `next/font/google`. **60
components + 53 `use*` hooks** in `components/`.

**Root:** `app/layout.tsx` (font + metadata only) → `app/page.tsx`
(`redirect('/golf')`). Per-sport pages mount `<AppShell sport=… />`
(`components/AppShell.tsx`, ~1,050 lines) which owns Scan + Players tabs, filters,
slip, and all the client hooks.

### 7.1 Routes / views

| Route | View | Data source |
|---|---|---|
| `/` | redirect → `/golf` | — |
| `/{sport}` (`golf`, `mlb`, `nfl`, `nba`, `nhl`, `cfb`) | Scan + Players (`AppShell`) | `/api/{sport}` snapshot + `/api/odds/lines` + `/api/props/lines` + calibration + pick-history model-data + team-defense |
| `/soccer/{league}`, `/tennis/{tour}` | same, league/tour-parameterised | `/api/soccer/[league]`, `/api/tennis/[tour]` |
| `/{sport}/game/[gameId]` | Game Detail (`GameDetail` + per-sport adapter) | `/api/{sport}/game/[gameId]` (+ `/live`) |
| `/{sport}/player/[playerId]` | Player Detail (`PlayerDetail` + adapter) | `/api/{sport}/...`, candidates route, prop odds |
| `/{sport}/team/[teamId]`, `/{sport}/teams` | Team Detail / list | `/api/{sport}/team/[teamId]`, `/teams` |
| `/golf/schedule`, `/tennis/[tour]/schedule` | schedule views | `/api/golf/schedule`, `/api/tennis/[tour]/schedule` |
| `/bets`, `/bet/[betId]` | submitted bets + detail | `/api/bets` — **auth-gated** (middleware) |
| `/diagnostics` | operator dashboard (spend, calibration, provider budgets, health, AI summary) | `/api/diagnostics/*` — **admin-gated** (middleware allowlist) |
| `/login` | Supabase email/password sign-in | Supabase Auth |

### 7.2 API surface

**~100 `route.ts` handlers** under `app/api/` (a subset uncommitted — see §0).
Groups: `mlb/*` (14), `props/*` (30 — includes many `backfill`/`fit-weights`/
`ingest`/`elo-*`/`drift-check`/`system-health` operator routes), `nfl|nba|nhl|cfb/*`
(~7 each), `soccer/[league]/*`, `tennis/[tour]/*` (11), `golf/*` (6), `odds/*` (4),
`picks/*` (6), `diagnostics/*` (5), plus `bets`, `watchlist`, `tracked-lines`,
`watch-links`, `selftest`.

---

## 8. Auth

- **Provider:** Supabase Auth (`@supabase/ssr` + `@supabase/supabase-js`),
  email/password. Users live in `auth.users` (same DB). **1 user.**
- **Clients:** `lib/supabase/server.ts` (`createServerClient`, cookie-based, for
  route handlers/server components), `lib/supabase/client.ts` (browser),
  `middleware.ts` (session refresh + gate). All use the **anon key**.
- **`SUPABASE_SERVICE_ROLE_KEY`** — server-only, bypasses RLS; used by
  `scripts/backfill-operator-account.js` (one-time) and available for future
  admin server actions.
- **`middleware.ts` gating:**
  - `PROTECTED_API_PREFIXES = /api/picks, /api/bets, /api/watchlist, /api/tracked-lines`
    minus `PROTECTED_API_EXCLUDE` (`/api/picks/game-history`, `/props`,
    `/rare-markets`, `/bankroll`, `/model-data` — deliberately public "scoreboard"
    reads). Pages: `/bets`, `/bet/`.
  - **Admin** (`ADMIN_USER_IDS = ['038048de-…c89f936']` — hardcoded operator id):
    `/api/diagnostics/*`, `/diagnostics`.
  - Everything else — every sport snapshot, all odds/props reads, all operator
    `/api/props/*` fit/backfill/ingest routes, `/api/selftest`, `/api/odds/import` —
    is **public, no auth**.
  - Uses `supabase.auth.getUser()` (validates the token against Supabase's auth
    server), not `getSession()`.
- Identity flows via Supabase session cookies; API routes that need the user call
  `createClient()` then filter queries by `user.id`. The direct-pg data layer
  never sees the user — the route passes `userId` in.

*(Session lifetime, token storage, recovery flows, and the public-route exposure
are Phase 4's to assess.)*

---

## 9. Infrastructure, config, secrets

### 9.1 Hosting

| Piece | Host | Plan | Notes |
|---|---|---|---|
| Python worker | Render (`srv-da36bm2bkg8c73fqrdeg`) | `starter` | Oregon, 1 instance, `autoDeploy: false` |
| Health-check cron | Render (`crn-da7lquqfngtc73ft1n2g`) | `starter` | `*/15`, `autoDeploy: yes` |
| Postgres | Supabase (`qsqzercvwnzaeboltvca`, `aws-0-us-west-2`) | **unconfirmed plan** — DB is 1.54 GB (over the 500 MB free ceiling) and past egress incidents reference "a 5GB Supabase plan"; likely **Pro**. Open question. |
| Web app | **unconfirmed** — no config in repo; evidence = operator laptop | — | Open question |
| OddsHarvester | operator laptop (Windows Task Scheduler) | — | Residential IP required (OddsPortal blocks datacentre/CI IPs) |

`render.yaml` is in the repo and declares both Render services with `sync: false`
secrets (entered in the Render dashboard, never committed).

### 9.2 Secrets

- **`.env.local`** (gitignored, present locally, ~9 KB): `DATABASE_URL`
  (Supabase **session-mode** pooler, port 5432, password percent-encoded),
  `ANTHROPIC_API_KEY`, `ODDS_API_KEY`, `SHARPAPI_KEY`, `ODDSAPIIO_KEY`,
  `SPORTSGAMEODDS_KEY` (+ `_MULTISPORT`), `ODDSPAPI_KEY`, `PROPLINE_KEY` (+ `_2`),
  `PARLAYAPI_KEY` (+ `_MLB/_NFL/_CFB/_SOCCER/_NBA/_SPARE`), `RUNDOWN_KEY`,
  `RENDER_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `DEEPSEEK_API_KEY`, `CFBD_API_KEY`, plus per-provider
  `_ENABLED` / rate / cap tuning vars.
- **`.env.example`** (committed, 4 KB) — documents the shape, no values.
- `.gitignore` covers `.env`, `.env.local`, `.env*.local`, `data/*.db*`,
  `data/*.json`, `data/historical-odds-import/`, `*.log`, `oddsharvester/.venv/`,
  `python-odds-service/catboost_info/`, and machine-generated harvester `.bat`s.
- **Config precedence:** `config.py` reads real OS env first, falls back to
  parsing `.env.local` (dev only). The TS side reads `process.env` (Next.js loads
  `.env.local` automatically). The **same provider budgets/caps are declared in
  both `.env.local` and `python-odds-service/src/config.py` defaults and,
  separately, in `lib/odds/props/config.ts`** — three places that must agree
  (flagged for Phase 2).

### 9.3 Monitoring / logging

- **`job_health_checks`** table (15-min cron) — the real monitor. `exit 1` on any
  unhealthy check; `render.yaml` says a dashboard notification must be wired for
  that to page anyone (**not verified**).
- **`system_events`** table — ad-hoc TS/worker error log, surfaced on
  `/diagnostics`.
- **`/api/props/system-health`**, **`/api/diagnostics/health`**,
  **`/api/selftest`** — read-side health endpoints.
- Render captures worker/cron stdout (jobs `print(..., flush=True)` liberally).
- **No** external error tracking (Sentry etc.), **no** uptime pinger,
  **no** structured logging, **no** metrics/APM. No test suite for the TS side
  (`npm` scripts are `dev`/`build`/`start`/`typecheck` only); the Python side has
  ~25 `test_*.py` files run manually (no CI — the only GitHub Actions workflow is
  the dormant OddsHarvester one).

### 9.4 Backups / recovery

- Whatever Supabase's plan provides (unconfirmed). No app-level backup, export, or
  documented restore procedure found.
- No staging environment. One database, shared by dev + all runtimes.

---

## 10. Dependencies

### 10.1 Next.js app (`package.json`)

| Package | Version | Note |
|---|---|---|
| `next` | ^15.5.4 | current |
| `react` / `react-dom` | ^19.1.1 | current |
| `pg` | ^8.23.0 | the live DB driver |
| `pg-copy-streams` | ^7.0.0 | bulk load (migration / backfill) |
| `@supabase/ssr` | ^0.12.4 | auth |
| `@supabase/supabase-js` | ^2.112.3 | auth |
| `@anthropic-ai/sdk` | ^0.116.0 | screenshot import |
| `motion` | ^13.1.1 | animation |
| `xlsx` | ^0.18.5 | historical-odds import; `serverExternalPackages` in `next.config.mjs` |
| **`better-sqlite3`** | ^13.0.3 | **migration leftover** — no longer imported by `lib/db/*` (confirmed in `next.config.mjs` comment); still a dependency. `@types/better-sqlite3` also still in devDeps. |
| `tailwindcss` / `postcss` / `autoprefixer` / `typescript` | current | |

No lockfile-flagged vulnerabilities checked here (Phase 4). No test/lint/CI
tooling in `devDependencies`.

### 10.2 Python worker (`python-odds-service/requirements.txt`)

`httpx>=0.27`, `asyncpg>=0.29`, `tzdata>=2024.1`, `psutil>=5.9` (measure script
only), **`scikit-learn>=1.4`, `catboost>=1.2`, `xgboost>=2.0`, `lightgbm>=4.3`**
(the MLB ensemble — a deliberate, documented departure from the otherwise
dependency-free `predict/` code).

### 10.3 Vendored

- **`oddsharvester/`** — full vendored copy of `jordantete/OddsHarvester`
  (Playwright-based OddsPortal scraper), its own `pyproject.toml` and CI. Pinned
  to whatever was copied in; `.venv` + HAR fixtures gitignored.

---

## 11. What reads what — quick reference for later phases

- **`/diagnostics`** → `/api/diagnostics/*` → `pick_history` (calibration/Brier),
  `provider_usage`, `job_health_checks`, `system_events`, `odds_unresolved`,
  `model_weights`, DeepSeek (AI summary).
- **Scan (per sport)** → `/api/{sport}` (snapshot from `snapshot_cache` via
  `cachedRoute`) + `/api/props/lines` (`prop_odds` direct) + `/api/odds/lines`
  (`odds_cache` / `game_odds_book_lines`) + `/api/props/calibration` +
  `/api/picks/model-data` (`pick_history`).
- **Game Detail** → `/api/{sport}/game/[id]` + `/live` + `game_odds_book_lines`.
- **Grading loop** → worker jobs read `game_picks` / `pick_history` where
  `outcome IS NULL` / `graded_at IS NULL`, fetch finals from StatsAPI/ESPN, write
  outcomes back.
- **`pick_history` has two independent writers** for MLB player props: the TS
  `lib/scheduler.ts` → `logSurfaced` path (every 4 min, currently the only live
  one) and the worker `computeMlbPropPredictionsJob` (every 5 min, currently
  hung). Both use the same `ON CONFLICT DO NOTHING` unique key, so they don't
  corrupt each other.

---

## 12. Where reality diverges from appearances

**This is the most important section.** Each item is something the code's names,
comments, structure, or the control plane would lead you to believe, versus what
is actually true.

### 12.1 Runtime / operational

1. **The Python worker looks deployed and healthy; it is hung.** Render shows the
   service `not_suspended` with a `live` deploy. In fact every job's last run is
   02:43–02:51 UTC 2026-08-27 (~17 h stale), and `prop_odds` /
   `prop_odds_history` / `provider_usage` have had no write since `02:49:38`.
   `job_health_checks` correctly shows ~17 checks `healthy=false` ("stale — last
   run ~990min ago"). This is the **second** silent hang (the first: 2026-08-22 →
   08-26, root-caused in commit `cafe14b5` to missing DB timeouts + a
   client-lifetime race in `statsapi.py`). The current hang is *after* those
   fixes shipped, so either the fix is incomplete or this is a new mechanism.

2. **The health check detects the hang but it's unclear anything is paged.**
   `health_check.py` returns exit 1 and `render.yaml`'s own comment says the
   Render dashboard notification "is what actually pages someone — wire that up
   … once this is deployed." Whether that was done is **unverified** (needs
   dashboard access). If not, detection exists but delivery doesn't — which
   matches the fact that the hang has persisted ~17 h.

3. **The worker is running older code than `main`.** `autoDeploy: false` +
   last manual deploy at commit `89f6754…` (2026-08-27 01:41). Commits
   `f7b76a0` (str/datetime fix for `computeMlbPropPredictionsJob`), `f83b486`,
   `5e721c2`, `f632b75`, `825e032` are **not on the worker**. So bug-fix commits
   with messages like "Fix computeMlbPropPredictionsJob… silently no-opped every
   time" may or may not be live.

4. **`refreshTennisAtpJob` / `refreshTennisWtaJob` are registered and "running"
   but crash every run:** `TypeError: normalize() argument 2 must be str, not
   None` (from `entity_resolution` name normalization). Last successful data:
   none — `prop_odds` has no `sharpapi` tennis rows and only 2
   `game_odds_book_lines` tennis/sharpapi rows.

5. **SportsGameOdds and ParlayAPI look like active providers; they've been
   near-silent for ~6 days.** `sportsgameodds` / `sportsgameodds_multisport` /
   `parlayapi_*` last wrote `prop_odds` on **2026-08-21**, and their 2026-08
   `provider_usage` counts are tiny (10–37 requests). `gameday.py` proximity
   gating explains *some* of this (no imminent NFL/CFB/NBA games), but a
   6-day gap for every one of them at once predates the current worker hang.

6. **`ODDS_API_KEY` is set in `.env.local` but missing from the worker's Render
   env.** Health check: `mlbGameLinesJob` → `"ODDS_API_KEY is not set — game
   lines are turned off."`. Meanwhile `odds_cache` shows the MLB game-lines row
   *was* refreshed 2026-08-27 02:14 with 346 credits left — because the **TS**
   `/api/odds/lines` route (which does have the key locally) is still doing that
   fetch. So MLB game lines work, but not via the path the worker job thinks
   owns them. `render.yaml` does **not** list `ODDS_API_KEY` among the worker's
   `sync: false` vars — it was never added.

7. **`golfPredictionsJob` is hung with every other worker job (last run 02:51),
   yet `golf_model_predictions` has rows timestamped `19:18` today.** Something is
   still writing golf predictions. Candidates: a leftover TS golf adapter path
   triggered by a page load, or a second process. **Open question** — worth
   pinning down because it means the "moved from live request to schedule" claim
   in `jobs.py` may not be fully true. Same pattern for MLB player-prop
   `pick_history` (fresh at `19:18`), but there the TS `logSurfaced` path is a
   known, intentional second writer.

8. **OddsHarvester is the only fresh game-line source and it depends on a laptop
   staying awake and logged in.** No comment in the main app surfaces this; it's
   only in `scripts/harvester-laptop-README.md`. If that machine sleeps,
   `game_odds_book_lines` silently stops for MLB/NFL/CFB/soccer/tennis with no
   health-check failure for hours (the check's window is 24 h).

### 12.2 Code / structure

9. **`db.py`'s module docstring is stale and wrong.** It says *"write_prop_odds
   is built and tested … but NOT called from anywhere in the live fetch path
   yet — same deliberate disconnect as entity_resolution.py."* It **is** called,
   via `job_runner.run_provider_specs`, and `prop_odds` shows millions of rows
   written through it. The `max_size` comment in the same file is also
   self-contradictory (says "reverted all the way back to 5" mid-sentence; the
   actual value and the deploy commit say 2).

10. **`lib/db/schema.ts` is dead.** It's the old SQLite `SCHEMA_SQL` (with
    `PRAGMA journal_mode = WAL`). Nothing imports it except one *comment* in
    `lib/sports/golf/historyIngest.ts`. The real schema is
    `supabase/migrations/`.

11. **`better-sqlite3` + `@types/better-sqlite3` are still dependencies** but
    `lib/db/*` no longer imports either (`next.config.mjs` comment confirms they
    were dropped from `serverExternalPackages` during the Postgres cutover).

12. **Five files are staged for deletion but the deletion isn't committed:**
    `lib/odds/merge.ts`, `lib/odds/oddsHarvester.ts`,
    `lib/odds/props/multiSportRefresh.ts`,
    `lib/odds/props/tier1RefreshScheduler.ts`,
    `app/api/props/multi-sport-refresh/route.ts`. `CLAUDE.md` already refers to
    these as "since deleted." So the repo's committed state still contains code
    the docs treat as gone.

13. **`lib/scheduler.ts`'s header describes jobs it no longer runs.** The top
    comment still enumerates "Tier 1, SportsGameOdds, NFL, CFB, Soccer/EPL" as
    context; only `refreshMlb` + `refreshCalibration` remain. (The comment does
    say they were cut over — but a skim of the file name suggests "the
    scheduler" is bigger than it is.)

14. **`lib/odds/props/` still contains `tier1Refresh.ts`, `sportsGameOddsRefresh.ts`,
    `registry.ts`, `config.ts`, and `providers/*.ts`** — the TS provider-refresh
    machinery. `CLAUDE.md` says the Python worker "fully replaced" the TS
    provider jobs, and `lib/scheduler.ts` no longer calls them, but the files
    remain and `config.ts` is still the third copy of provider-budget config.
    **Which of these are still on a live read path vs. fully dead is a Phase 2
    determination.**

15. **`pick_history.edge_source` column exists (added in an uncommitted
    migration `20260827050000_pick_history_edge_source.sql`) and is 100% NULL.**
    Same for `model_calibration` / `model_artifacts` tables (0 rows) — schema is
    ahead of any code that populates them.

16. **The MLB moneyline "ensemble" reads as a shipped feature** (7 model
    families, `walkforward_results` populated, `mlb_stacking.py` /
    `model_benchmark.py` / `run_walkforward.py` all present) **but nothing is
    activated** — `model_artifacts` is empty, production serves the v8 logistic
    weights labelled `formula`.

17. **`player_game_history` (805 MB, the single biggest table) has no rows for
    MLB, NBA, golf, or tennis** — only NHL/CFB/NFL/EPL/MLS. The
    `docs/player-game-history-backfill-RESUME-2026-08-27.md` filename implies the
    historical pull is incomplete/paused. MLB has its own separate gamelog cache
    path (`playerGamelogCache.ts` / `mlb:player-gamelog:*`).

18. **`picks` table (0 rows) vs `pick_history` (362k rows)** — near-identical
    early column lists, wildly different purpose. `picks` = the user's live slip
    legs (RLS, user-scoped, currently empty); `pick_history` = the global model
    calibration log (no `user_id`, never per-user). Easy to conflate by name.

19. **`CLAUDE.md`'s "API route caching" section cites `app/api/props/lines/route.ts`
    as no longer triggering any refresh** — true — but the file it points at for
    the deleted trigger (`tier1RefreshScheduler.ts`) is one of the
    staged-but-uncommitted deletions (#12), so the reference resolves against a
    file git still has.

20. **`app/api/odds/lines` is the single most error-prone route in
    `system_events`** — repeated `canceling statement due to statement timeout`,
    `EMAXCONNSESSION`, `timeout exceeded when trying to connect`, and one
    `ENOTFOUND aws-0-us-west-2.pooler.supabase.com`. It's flagged in `CLAUDE.md`
    as one of the routes deliberately allowed to skip the caching patterns
    ("genuinely-live-data contract"). Under connection pressure it degrades
    loudly.

### 12.3 Config / environment drift

21. **Provider budgets/caps live in three places:** `.env.local` (the source of
    truth for real numbers), `python-odds-service/src/config.py` (defaults that
    must match), and `lib/odds/props/config.ts` (the TS reader — possibly now
    only feeding dead code, see #14). `jobs.py` comments repeatedly note
    "same env var as config.ts:NN" — a maintained-by-hand correspondence.

22. **Session-mode vs transaction-mode pooler is chosen per-runtime by a mix of
    a hardcoded default and one env var:** worker → session (port 5432,
    `DB_POOLER_MODE` unset/`session`); health-check cron → transaction (port
    6543, `DB_POOLER_MODE=transaction` in `render.yaml`); the TS app →
    session (hardcoded `DATABASE_URL`). `db.py` swaps `:5432`→`:6543` by regex
    on the same DSN.

23. **Pool `max` sizes were tuned three times in one day** (`lib/db/pgClient.ts`
    6, worker `db.py` 2, per the deploy). The sum (≈8) is deliberately at/below
    the measured ~9-connection real budget with "zero slack for ad-hoc local
    scripts" — meaning any extra consumer (a second dev server, a migration
    script, an audit query like the ones used to build this doc) can trip
    `EMAXCONNSESSION` for the live app.

24. **`autoDeployTrigger` differs between the two Render services** — the cron is
    `autoDeploy: yes` (tracks `main`), the worker is `no` (manual). A commit that
    changes `JOB_REGISTRY` and a health check in the same push lands the health
    check's new expectations on the cron immediately while the worker keeps
    running the old registry until someone manually deploys.

### 12.4 Data-shape / silent-write risks (leads for Phases 2–3)

25. **No FK constraints and no `CHECK` on enum columns anywhere in the
    sports-data schema.** `prop_odds.game_id`, `pick_history.game_id`, every
    `*_outcome`, every `side`/`market`/`status` is bare `TEXT` validated only by
    application code and comments. A provider that changes an id format or a
    field name writes it verbatim.

26. **`snapshot_cache` and `odds_cache` payloads are `TEXT`, not `JSONB`** — a
    malformed upstream response that still parses as a string is stored as-is;
    the shape mismatch only surfaces when a reader tries to use it.

27. **`game_odds_history` got a `source` column with
    `DEFAULT 'the-odds-api'`** backfilled onto every existing row. Any reader
    written before that migration that groups by `(event_id, market, side,
    bookmaker)` without `source` now silently mixes two writers' rows.

---

## 13. Open questions (specific — one sentence each to answer)

1. **Where does the Next.js web app actually run in "production"?** (Your laptop
   via `next start`/`next dev`? A host not represented in the repo?) Everything in
   §1/§9 assumes laptop; confirm or correct.

2. **Is the `line-buddy-odds-worker` currently hung, or intentionally stopped?**
   If you stopped it deliberately (e.g. to save budget), say so — otherwise this
   is an active incident as of 2026-08-27.

3. **Is a Render failure notification (email/Slack) actually wired for the
   `line-buddy-odds-worker-health-check` cron?** (Dashboard → Settings →
   Notifications.) If not, nothing is paging you when the health check exits 1.

4. **What Supabase plan is the project on, and what are its DB-size, egress, and
   connection limits?** The DB is 1.54 GB and past incidents reference a "5GB
   plan" and a "103GB overage."

5. **Is the OddsHarvester laptop the same machine as the web-app host, and is it
   currently awake/logged in?** `game_odds_book_lines` freshness depends on it.

6. **What's still writing `golf_model_predictions` (rows at 19:18 today) while
   the worker is hung?** A leftover TS golf path, a page-load trigger, or another
   process?

7. **Is the `player_game_history` historical backfill finished, paused, or
   abandoned for MLB/NBA/golf/tennis?** (`docs/player-game-history-backfill-RESUME-…`
   suggests paused.)

8. **Are the ~112 untracked files + 94 modified files a coherent in-progress
   change set you intend to commit, or accumulated drift?** Several (tennis
   routes, 3 applied migrations) are clearly load-bearing in production already.

9. **Is `ODDS_API_KEY` deliberately withheld from the worker** (so the TS route
   keeps owning MLB game lines), or an oversight in `render.yaml`?

10. **Is `TheRundown` (`RUNDOWN_KEY`, `lib/odds/rundown.ts`) used by anything
    live, or fully abandoned?**

11. **Which of `lib/odds/props/{tier1Refresh,sportsGameOddsRefresh,registry,
    config}.ts` + `providers/*.ts` are still on a live read path?** (Determines
    how much of §12.2 #14 is dead code for Phase 2.)

12. **Do you have a database backup / restore procedure, or are you relying
    entirely on Supabase's built-in backups?**

---

*End of Phase 1 inventory. Phases 2–5 should treat every claim here as a starting
point to verify, not settled fact — especially anything marked "unverified" or
"open question," and anything in §12.*
