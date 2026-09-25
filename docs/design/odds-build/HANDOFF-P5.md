# Handoff — odds build, P5 onward (written 2026-09-25)

The previous session ran P0 → P4 and closed P4 with the operator's
decisions. **P5 is next and not started** (only the reader inventory had
begun). Read this file first, then `docs/CURRENT.md` item 7, then the specs
named below.

## Operator approvals now in force

- **"You have approval to do literally everything"** (2026-09-25): applying
  migrations to the live Supabase database, Render deploys of
  `line-buddy-odds-worker`, scheduled tasks, and restarting the scraper.
  Still follow each spec's tests-before-deploy order. Record every deploy in
  `docs/CURRENT.md` → Deploys.
- **Run the phases in order and keep going as each completes** (P5, P6, …).
  Test between phases exactly as each spec says. Background checks run
  behind and never gate.
- **No shortcuts, no band-aids.** "I don't care if building the right thing
  takes longer." Nothing that works only while the app runs on the laptop:
  the app will be hosted (audit plan phase 8.2, Vercel or Render).
- **Every number in an option or decision must be measured, with its source
  named.** Never an estimate presented as fact, and never an "I was wrong"
  revision. When something is unmeasured, say so and measure it.
- **Never discard useful data (D14).** Storage limits are solved by how
  data is stored, never by dropping sources, books, relay copies, in-game
  changes or history.

## New decisions (in the master plan §1,
`docs/design/scraper-bridge-and-edge-gameplan-2026-09-23.md`)

- **D24 — bridge storage policy.**
  - **Everything reaches Supabase:** every matched, de-flapped price change
    from all 29 sources, every book and every relay copy, pre-game and
    in-game. That is 8.1M/day, measured 2026-09-24.
  - **Compact format:** 117 B/row, measured in Supabase (today's
    `prop_odds_history` is 345 B/row).
  - **10 days hot** in Postgres; older rows move to the Parquet corpus in
    Storage (never deleted); the laptop keeps everything.
  - **Disk held at the provisioned 27 GB** (about 6.1 GB used) by our own
    **disk guard**: database + WAL kept under 85%, so Supabase never
    autoscales to its next step (40.5 GB). Near the limit the guard moves the
    oldest history to the corpus sooner and alerts; the bill never moves.
  - **No corpus reader in the app** until a page needs more than 10 days.
  - Evidence: `docs/design/odds-build/results/P4-storage-audit.md`.
- **D25 — cost ceiling: $50/month all-in** (Supabase Pro $25 + at most $25
  more) across Supabase, Render and (later) Vercel, **enforced by caps in
  our own code**, not the providers' spend caps.
  - **Known extra today:** Render about $10 (one $7 service + about $3 usual
    overage); Supabase disk about $2.38 (27 GB); the operator accepts up to
    about $2.50 for disk.
  - **Before anything that can raise a bill ships** (the P6 bridge is the
    first): an audit that pulls every provider's live price and usage into
    one monthly total, then meters, alerts and automatic brakes ahead of the
    limit.
  - A `SUPABASE_ACCESS_TOKEN` in `.env.local` would let a script read
    Supabase billing and disk through the Management API. The Supabase MCP
    connector gets "permission denied" for project settings and for
    `execute_sql`; use the python-odds-service `db.get_pool()` for SQL.

## P5 as the operator approved it (amends `P5-schema-and-writers.md`)

Write these amendments into the P5 spec first, each with a Changelog line.

1. **Compact history storage, built properly (no compatibility view).**
   - New compact history tables with small dictionary tables (books,
     markets, sources, subjects; games too if any game id is not numeric;
     check first).
   - Rows are integer-coded, the price is a smallint, both times are kept
     (D23), and there is one index for the chart query. That is the layout
     measured at 117 B/row: `(game bigint, subject int, market smallint,
     book smallint, source smallint, side smallint, line real, price
     smallint, observed_at, changed_at)`, index `(game, subject, market,
     observed_at)`.
   - Today's `prop_odds_history` is converted into it, verified row for row,
     then removed. **Every reader moves onto the compact tables through one
     shared reader per language.** Known readers:
     `lib/odds/props/lineHistory.ts`, `lib/slate/marketMoves.ts`,
     `lib/db/client.ts` (`readPreGamePropOddsForGame` and others),
     `lib/odds/devigBacktest.ts`, the five sport game-research files,
     `health_check.py`, `jobs.py`, `corpus_store` / `prune_corpus`.
   - **Full inventory (grep 2026-09-25, every file that names
     `prop_odds_history`):**
     - app: `app/api/props/line-history/route.ts`,
       `app/diagnostics/page.tsx`, `components/LineMovementCard.tsx`,
       `components/PlayerDetail.tsx`, `lib/db/client.ts`,
       `lib/odds/gameLineHistory.ts`, `lib/odds/props/lineHistory.ts`,
       `lib/odds/props/mainLine.ts`, `lib/slate/marketMoves.ts`;
     - Python: `src/db.py`, `src/health_check.py`, `src/corpus_store.py`,
       `src/predict/mlb_prop_grading.py`, `prune_corpus.py`,
       `refresh_corpus.py`, `audit_storage.py`,
       `scraper_volume_measure.py`, `src/test_write_prop_odds.py`;
     - scripts: `scripts/probe-*.ts` (six);
     - migrations `20260818201108`, `20260829060000`.

     24 app references and 28 Python references; many are comments, so
     read each one.
   - **Keep the corpus's Parquet schema unchanged:** export decodes back to
     today's columns, because the Python models read the corpus.
   - The scraper's game-line history (`game_lines_history`, the biggest
     stream at 4.9M rows/day) is compact from the start.
   - **Time the real reads** (price chart, Movers' 7-day query, game page
     pre-game props) against today's before switching; the gate is "no
     meaningful slowdown".
   - `game_odds_history` (0.12 GB, never pruned) is not in D24's scope;
     leave it unless the spec says otherwise.
2. **The disk guard** (D24) is part of P5. It is a job in the Python worker
   (`JOB_REGISTRY`, every 15 min) that:
   - measures `pg_database_size` + WAL (`pg_ls_waldir()`, readable through
     the pool; WAL is 1.07 GB now and `max_wal_size` is 4 GB);
   - holds the total under 85% of the configured 27 GB (a config value,
     since provisioned size is not readable without the Management token);
   - near the limit, shortens the hot window (oldest to the corpus first)
     and alerts through `health_check`;
   - pauses the bridge's Supabase writes (the laptop keeps collecting) below
     a window floor.
3. The rest of P5 as specified: two times per price, pulls, `game_lines`
   with periods and alternates, openers, splits, exchange books,
   `game_reference`, RLS on every new table, the F6 reader rule
   (`lib/odds/sourcePrecedence.ts`), ownership rows, one worker deploy.
4. **The six spec corrections** from `HANDOFF-P0-P4.md` are already applied
   to P6, P7, P8, P11 and the scraper lane.

## State at handoff

- **Done, all pushed:** P0–P4 and the six spec corrections. The latest
  line-buddy commit is `e437530` (P4 closed).
- **Deployed:** P1 (`4d64071`, live 2026-09-24 21:48 UTC).
- **Committed, not deployed:** `e8b5a89` (the `tennisStatsJob` /
  `golfCoursesJob` `yield_fn()` wait_hint fix). It ships with P5's deploy,
  which builds HEAD.
- **The odds-scraper repo has no git remote.** Its commits exist on this
  laptop only: `52ae6b4`, `8afa4d8` (P0 watchdog, stall dump, backup) and
  `8d0fb08` (the freeze's cause: raw pruning moved off the writer thread;
  loaded 2026-09-24 22:24 UTC).
- **Background checks running:**
  - 48 h freeze watch in `odds-scraper\data\watchdog.log`;
  - `OddsScraperBackup` daily at 04:30 local → `data\backup.log`;
  - `OddsBridgeMatchReport` daily at 05:15 local for 7 days →
    `data\match_report.log`. Delete that task after 2026-10-01.
- **Tools built:**
  - `python-odds-service/scraper_match_run.py` (P3 links in
    `odds-scraper/data/bridge.db`);
  - `scraper_volume_measure.py` (P4, about 5.5 min for a day);
  - `src/scraper_markets.py` (P2 vocabulary).
- **Measured facts worth keeping:**
  - DB 5.49 GB (`prop_odds_history` 2.41 GB, `player_game_history` 0.48,
    `prop_odds` 0.40, `prop_odds_archive` 0.34, the rest smaller);
  - Storage corpus 0.43 GB of 100;
  - scraper volume 10.9M offer rows/day, 8.1M matched: first-hand 0.94M,
    one relay copy of relay-only books 2.07M, extra relay copies 0.59M,
    relay duplicates of first-hand books 4.50M;
  - Parquet 7.1 B/row.

## Standing rules (unchanged)

- Never mention licences or terms for the scraper or any source.
- No second Render worker. No captcha or bot-protection bypass, no logins or
  credentials, read-only probes only.
- Headshots and team logos never regress. No dark backgrounds on the sharp
  pieces. No UI beyond the approved mockup without new 1:1 mockups (D16).
- Add named files only (never `git add -A` or `git add docs/`). The Scan
  table stays frozen except where a spec says D22. Python writes,
  TypeScript renders.
- Every new table gets RLS and a table-ownership row.
- The Postgres pooler caps at 15 connections; check for long jobs before
  heavy DB work.
- At about 92% context: stop, rewrite `docs/CURRENT.md`, commit and push.
