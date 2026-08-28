# Linesmith Audit — Handoff for Phases 2–5

Phase 1 is done. Output: **`docs/system-inventory.md`** — read it in full before
starting any later phase. This file is just the operational scaffolding: how to
connect, what's already been run, what to reuse, and where each phase should
start digging.

Run each phase in its **own fresh Claude Code session** (the run-order README is
right about context bloat). Phases 2, 3, 4 are independent — any order or in
parallel. Phase 5 needs web access, not deep code access.

---

## Access & credentials

Everything the auditor needs is already on this machine.

### Database (Phases 2, 3, 4)

- Connection string is in **`.env.local`** → `DATABASE_URL`. It's the Supabase
  **session-mode** pooler (`aws-0-us-west-2.pooler.supabase.com:5432`), password
  percent-encoded in the URL.
- **The pooler is connection-starved.** `pg_stat_activity` shows the shared cap is
  ~15, of which ~6 is Supabase platform overhead and the rest is claimed by the
  live app + worker pools (see inventory §5). **Before running DB queries, keep it
  to ONE connection, do your work, close it.** Do not open a pool. If you get
  `EMAXCONNSESSION` / "max clients reached", back off — you may be starving the
  live app. Consider using the **transaction-mode** pooler instead (swap
  `:5432` → `:6543` in the DSN) for read-only introspection; it multiplexes and
  has far more headroom. The health-check cron already does exactly this.
- There is **no `psql`** on this machine. Node has `pg` available *inside the
  project directory* (`cd` into the repo first, or copy your script there, so
  `import 'pg'` resolves against `node_modules`). A working pattern:
  ```
  cd C:/Users/occy3/Documents/line-buddy
  cp <your-scratch-script>.mjs ./_tmp.mjs && node ./_tmp.mjs ; rm -f ./_tmp.mjs
  ```
  Use `new pg.Client(...)` (single connection), `ssl: { rejectUnauthorized: false }`.
- **`statement_timeout` bites big aggregates.** `SELECT SUM(LENGTH(payload)) FROM
  snapshot_cache` times out (366 MB of TOAST). Sample or use
  `pg_total_relation_size` instead.
- Supabase project ref: `qsqzercvwnzaeboltvca`. `auth.users` is readable via the
  same connection (`SELECT ... FROM auth.users`).

### Render (Phases 1, 4)

- API key in `.env.local` → `RENDER_API_KEY`. It's broadly scoped; **read-only
  use only** (status, deploys, logs) unless the user explicitly asks for a change.
- Base URL `https://api.render.com/v1`, `Authorization: Bearer $RENDER_API_KEY`.
- Two services:
  - worker `srv-da36bm2bkg8c73fqrdeg` (`line-buddy-odds-worker`)
  - cron `crn-da7lquqfngtc73ft1n2g` (`line-buddy-odds-worker-health-check`)
- Useful endpoints: `/services`, `/services/{id}/deploys?limit=N`,
  `/services/{id}/events`. Logs may require the logs endpoint / dashboard;
  Phase 1 read deploy history + the `job_health_checks` table instead and that
  was enough.
- **The dashboard itself** (`dashboard.render.com`) is the only place to confirm
  whether the cron's `notifyOnFail` notification is actually wired to an email/
  Slack — the API didn't surface that clearly. Ask the user or have them check.

### Supabase dashboard (Phase 4, and open Q4 in the inventory)

- Not accessed in Phase 1. Plan tier, egress usage, DB-size limit, connection
  limit, and backup policy all need either dashboard access or the user to
  answer. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` are all in `.env.local` if a phase needs to hit the
  Management API or PostgREST directly (e.g. Phase 4 adversarial RLS testing —
  hitting `https://qsqzercvwnzaeboltvca.supabase.co/rest/v1/<table>` with the
  anon key is the exact test for "what can a browser client read").

### Web app

- No hosting config in the repo. It appears to run on the user's laptop
  (`npm run dev` / `next start`). To exercise it live, `npm run dev` and hit
  `http://localhost:3000` — **but** that opens a second `pg` pool and may trip
  the connection cap on the already-running instance. Coordinate with the user
  before running a second server.

---

## What Phase 1 already ran (don't redo blindly; re-verify if load-bearing)

- **Full schema introspection** — 35 tables: columns, row counts (exact),
  on-disk sizes, all 88 indexes, all constraints (only 4 FKs, ~all uniqueness via
  natural `UNIQUE` keys, near-zero `CHECK`), RLS status + policies, extensions,
  sequences. Captured in the inventory §5. The raw dump script is in the Phase 1
  session's scratchpad (not committed) — easy to regenerate.
- **Runtime state snapshot** (2026-08-27 ~19:30 UTC):
  - `job_health_checks` — ~17 checks `healthy=false`, all worker jobs stale
    ~990–1050 min.
  - `provider_usage` — full history; last provider spend `2026-08-27 02:49`.
  - `prop_odds` / `prop_odds_history` freshness by provider — frozen at `02:49`.
  - `game_odds_book_lines` freshness by sport/source — OddsHarvester fresh
    `~19:00`, everything else stale; **nba/nhl have zero rows**.
  - `pick_history` — 362,607 rows, 356k graded, `edge_source` 100% NULL, MLB
    still fresh at 19:18 (TS path), NFL 207 rows.
  - `model_weights` (MLB only, moneyline/total/home-run all v8/v8/v5 active),
    `walkforward_results` (21 rows, MLB moneyline, **nothing activated**),
    `model_artifacts` + `model_calibration` **empty**.
  - `player_game_history` by sport (NHL/CFB/NFL/EPL/MLS only; no MLB/NBA/golf/
    tennis), 1.43M rows, 805 MB.
  - `snapshot_cache` largest keys (`mlb:full-raw:{date}` 33–72 MB each,
    `nflverse-*` 22–59 MB), `system_events` last 30.
  - `pg_stat_activity` connection breakdown.
- **Render:** service list, worker deploy history (confirmed last deploy commit +
  timestamp, `autoDeploy: false`), cron deploy history.
- **Code read in full or substantially:** `middleware.ts`, `render.yaml`,
  `next.config.mjs`, `.env.local`, `lib/scheduler.ts`, `lib/db/pgClient.ts`,
  `lib/cachedRoute.ts`, `lib/db/client.ts` (first ~1,300 of 3,000 lines),
  `python-odds-service/src/{main,config,jobs,job_queue,health_check}.py`,
  `python-odds-service/src/db.py` (head), the initial migration + 5 key later
  migrations, `components/AppShell.tsx`, `lib/supabase/server.ts`,
  `app/layout.tsx` / `page.tsx`, `requirements.txt`, `package.json`,
  `scripts/harvester-laptop-README.md`, `.github/workflows/oddsharvester-scrape.yml`.

---

## Per-phase starting points

### Phase 2 — Codebase coherence + database

**Highest-value leads from Phase 1 (inventory §12.2, §12.3):**

- **Uncommitted state is enormous** — 94 modified + 112 untracked files (incl. 27
  API routes, 3 already-applied migrations) on top of `825e032`. First task:
  `git status` / `git diff` and get the user to tell you whether this is one
  coherent change set. Everything else in Part A depends on knowing the real
  baseline.
- **Confirmed dead / leftover:** `lib/db/schema.ts` (SQLite `SCHEMA_SQL`, only a
  comment references it); `better-sqlite3` + `@types/better-sqlite3` deps;
  5 staged-for-deletion files (`lib/odds/merge.ts`, `lib/odds/oddsHarvester.ts`,
  `lib/odds/props/multiSportRefresh.ts`, `lib/odds/props/tier1RefreshScheduler.ts`,
  `app/api/props/multi-sport-refresh/route.ts`).
- **Ambiguous authority — needs a ruling:** `lib/odds/props/{tier1Refresh,
  sportsGameOddsRefresh,registry,config}.ts` + `providers/*.ts`. `CLAUDE.md` says
  the Python worker "fully replaced" TS provider jobs; `lib/scheduler.ts` no
  longer calls them; the files remain. Trace every import of each and rule
  keep/delete.
- **Three-way config drift:** provider budgets in `.env.local` +
  `python-odds-service/src/config.py` + `lib/odds/props/config.ts`.
- **Stale docstrings:** `db.py` ("write_prop_odds … NOT called from anywhere" —
  false), `lib/scheduler.ts` header, `db.py` `max_size` comment.
- **Database Part B:** the migration is verified functional at the schema level
  (35 tables exist, types translated, 88 indexes present, sequences via `IDENTITY`
  work — `pick_history` alone has 362k rows written since). What's *not* verified:
  whether every row actually round-tripped from the SQLite source with correct
  values (Phase 1 had no access to the pre-migration SQLite file — ask the user
  if it still exists). Also audit: `snapshot_cache` retention (no trim job,
  366 MB, past 103 GB egress incident), `mlb:full-raw:{date}` daily blob
  accumulation, `TEXT`-not-`JSONB` payloads, zero FKs / zero `CHECK` on
  sports-data tables, and `game_odds_history.source DEFAULT` backfill readers.
- Query-plan work: `pg_stat_statements` **is installed** — `SELECT query, calls,
  mean_exec_time, rows FROM pg_stat_statements ORDER BY total_exec_time DESC` is
  your friend. The heavy tables are `player_game_history` (805 MB),
  `snapshot_cache` (366 MB), `prop_odds*` / `pick_history` (~100 MB each).

### Phase 3 — Odds math + prediction models

- **Not audited at all in Phase 1** beyond locating the code. Start fresh.
- **Math to verify by hand** lives in: `lib/odds/devig.ts`, `lib/odds/display.ts`
  (american↔decimal, best-line helpers), `lib/odds/props/liveEdge.ts`,
  `lib/odds/props/edgeModel.ts`, `lib/odds/goodBets.ts`,
  `lib/odds/props/propScore.ts`, `lib/odds/props/marketTrust.ts`,
  `lib/odds/recommendedPick.ts`, `lib/odds/gameEdge.ts`. Python mirrors:
  `python-odds-service/src/predict/{odds_math,probability_blend,live_edge,
  good_bets,prop_score,staking,normal_dist}.py`. **Check the TS and Python copies
  agree** — several are described as direct ports.
- **Models — what's actually live** (inventory §6): MLB moneyline/total/home-run
  logistic (`model_weights` v8/v8/v5), MLB Elo + sim engine, golf hole/round/
  tournament, and a generic Beta-Binomial player-prop baseline for everything
  else. The MLB **ensemble** (catboost/xgboost/lightgbm/mlp/stacking/
  bradley_terry) is fitted + backtested (`walkforward_results`, 2026-08-26) but
  **not activated** — `model_artifacts` + `model_calibration` are empty.
- **Calibration is measurable** — `pick_history` has 356k graded rows with
  `model_prob` + `outcome`, and `lib/db/client.ts` already has
  `calibrationBuckets` / `calibrationByMarket` / Brier queries. Phase 1 ran a
  quick cut: MLB `total` dimension avg model_prob 0.505 vs hit rate 0.493;
  `home-runs` 0.117 vs 0.119; `moneyline` 0.500 vs 0.498. Looks *roughly*
  calibrated at the aggregate — Phase 3 should do this properly (per-bucket,
  per-market, with confidence intervals, and vs the market-implied baseline,
  which is stored as `market_prob`).
- **Leakage / backtest validity:** scrutinise `predict/walkforward.py`,
  `run_walkforward.py`, `clv_backtest.py`, and the backfill paths
  (`writeBackfill` in `lib/db/client.ts`, `backfill_player_game_history.py`) —
  the backfill writes *already-graded* rows using the same gamelog entry that
  produced the prediction, which is exactly where date-boundary leakage hides.
- **Baseline comparison:** does any model beat `market_prob` (the vig-removed
  market line) out-of-sample? `pick_history` has both columns for 355k rows —
  this is directly answerable.

### Phase 4 — Auth, scale, security

- **Single-user reality:** `auth.users` = 1 row = the operator, whose id is
  **hardcoded** in `middleware.ts` (`ADMIN_USER_IDS`). User-owned tables empty.
- **RLS posture (inventory §5.3):** only `picks`/`bets`/`watchlist`/
  `tracked_lines` have RLS. **Every other table** (`prop_odds`, `pick_history`,
  `player_game_history`, `model_weights`, `historical_odds`, `game_picks`,
  `watch_links`, …) is exposed via PostgREST to any holder of the anon key, which
  **ships in the browser bundle**. Test adversarially:
  `curl 'https://qsqzercvwnzaeboltvca.supabase.co/rest/v1/prop_odds?limit=1' -H
  "apikey: <anon key from .env.local>"`.
- **Public-route cost surface:** middleware gates only `/api/picks|bets|watchlist|
  tracked-lines` (minus 5 excluded) + `/api/diagnostics`. Everything else is
  unauthenticated — including every `/api/props/*` fit/backfill/ingest operator
  route, `/api/selftest`, `/api/odds/import` (Anthropic vision — costs money), and
  every sport snapshot (each a heavy `cachedRoute` rebuild on cold cache). Map
  which unauthenticated routes can trigger an upstream paid call or an unbounded
  DB scan.
- **Scale model:** the binding constraint is the **~9-connection real Postgres
  budget** (inventory §5, §12.3 #23), not CPU. The app pool is `max: 6`. Model
  what happens at 100 / 1k / 10k concurrent users against that first. Second
  constraint: `snapshot_cache` egress (the 103 GB overage precedent). Third:
  upstream provider monthly caps (mostly free tiers — see inventory §2 table).
- **Secrets:** `.env.local` is gitignored (good). `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  in the browser bundle is by-design but its blast radius depends on RLS (above).
  Check `.env.example` and git history for anything ever committed.
- **Current incident:** the worker hang (inventory §0, §12.1) is a
  monitoring/alerting finding for Phase 4 too — detection works, delivery is
  unverified.

### Phase 5 — Competitive + standards research

- Read the inventory for "what the app does today" — don't re-derive it from
  code. Key framing: it's a **prop-research + odds-comparison + model-pick tool**
  across 8 sports (MLB, NFL, CFB, NBA, NHL, soccer EPL/MLS, tennis ATP/WTA,
  golf), single-operator, no monetisation, no compliance surface yet.
- Engineering-standards gaps already visible (assess stage-appropriateness):
  no error tracking, no uptime pinger, no CI, no TS tests, manual Python tests,
  no staging, one shared DB for dev+prod, manual worker deploys, alerting
  delivery unverified, no documented backup/restore, `better-sqlite3` +
  dead-file cruft from an unfinished migration.
- Data assets that competitors typically charge for and this app is *already
  collecting*: `prop_odds_history` (425k line-movement points),
  `game_odds_history`, `pick_history` (362k graded model predictions with
  market-implied baseline), `player_game_history` (1.4M game logs, 2010→2026 for
  5 sports), `historical_odds` (17 MLB seasons). Note which features these
  unlock cheaply vs. which need new plumbing.

---

## Assembling the final roadmap

After Phases 2–5, one more short session: feed it
`docs/system-inventory.md` + `docs/audit-phase-{2,3,4,5}.md` and ask for a single
merged roadmap — findings strictly Critical → High → Medium → Low across all
phases, then the Phase 2 unification plan, then Phase 5 recommendations. That
merge reads your own outputs, not the codebase, so it's cheap.
