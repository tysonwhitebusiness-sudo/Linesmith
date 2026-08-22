# Phase 2 Audit — Moving Odds Ingestion to Python

**Status: audit only, no implementation.** Scope per Phase 0: on-demand user-triggered odds actions (More Books, Check Sharp Price, Line History, on-demand player scan) stay as thin TypeScript passthrough routes. Sports-data fetching (ESPN/MLB Stats API/nflverse — scores, rosters, live game state) stays in TypeScript permanently. This audit covers only what's actually in scope for a Python move: the 9 odds-provider integrations, the scheduling/orchestration layer that drives them, budget/rate-limit tracking, and historical odds backfill/ingestion.

Everything below is drawn from three parallel research passes over the real code, each required to cite file:line for every claim and say "unverified" rather than guess. Nothing here has been implemented; this is a decision document.

---

## 1. Provider integrations

9 registered adapters across `lib/odds/props/providers/*.ts`, plus `lib/odds/oddsApi.ts` (game lines) and `lib/odds/golfLines.ts` (golf outrights), sharing `entityResolution.ts`, `config.ts`, `budget.ts`, `devig.ts`/`display.ts`. ~3,048 LOC total.

| Provider | File | LOC | Complexity | Notable behavior |
|---|---|---|---|---|
| SharpAPI | `providers/sharpapi.ts` | 340 | M | Two boards (props + game lines) in one file, 90s in-memory TTL cache each, live self-reported delay override, requires querying both team orderings |
| Odds-API.io | `providers/oddsApiIo.ts` | 167 | S/M | Two-step events→odds fetch, regex-parsed combined player/stat label, **budget config defined but never enforced in-file** |
| SportsGameOdds | `providers/sportsGameOdds.ts` | 340 | M | Derived (slugified) team IDs, no caching (Tier 2, on-demand by design), duplicate URL-building logic between props/game-line paths, **budget config unused in-file** |
| OddsPapi | `providers/oddsPapi.ts` | 277 | M (props path is a no-op) | `fetchGameProps` is a hardcoded no-op — this provider carries no player-prop data. Its real logic (`fetchSharpPrice`/`fetchLineHistory`) backs the two on-demand actions that are **already decided to stay in TypeScript** — likely out of Phase 2 scope entirely |
| ParlayAPI (×2 identities) | `providers/parlayApi.ts` | 156 | S | Flattest response shape; cost read from an `x-requests-used` response header rather than computed |
| Propline (×2 identities) | `providers/propline.ts` | 185 | M | Mandatory per-event market-discovery round-trip before fetching odds — deliberate, born from a real prior coverage bug; over/under inferred by regex on outcome name |
| The Odds API (props) | `providers/theOddsApi.ts` | 45 | S (trivial) | Disabled by default, hardcoded no-op adapter |
| the-odds-api.com (game lines) | `lib/odds/oddsApi.ts` | 264 | M | Postgres-backed cache since Phase 1; credit-reserve state machine (stops auto-refresh at ≤25 credits remaining, persisted across restarts); asymmetric best-price logic (moneyline = best-of-all-books, spread/total = first-book-found) |
| Golf outrights | `lib/odds/golfLines.ts` | 226 | L (event disambiguation) | Reuses SharpAPI's board but via a separate Postgres-backed cache; **event disambiguation requires ESPN roster matching** — a direct dependency on the sports-data layer |

Shared dependencies:
- **`entityResolution.ts`** (322 LOC) — every provider routes rows through this before they're normalized: Unicode NFD diacritic-stripping name matching, a ~100-entry market-key alias table tried three ways, a ~35-entry bookmaker alias table. No I/O, but a silent bug here corrupts rows across every provider at once.
- **`config.ts`** (153 LOC) — one function per provider reading `<PROVIDER>_ENABLED`/`<PROVIDER>_KEY`/rate knobs from env; a provider silently disables itself if its key env var is absent. ParlayAPI and Propline are each registered under two separate `ProviderId`s with independent budget identities.
- **`budget.ts`** (90 LOC) — Eastern-timezone-anchored daily/monthly counters (Postgres-backed) plus an **unpersisted, in-process per-minute rate limiter**.
- **`devig.ts`/`display.ts`** — pure math/formatting, no I/O, mechanical to port, and `display.ts`'s locale-formatting half is UI-facing and likely doesn't need to move at all.

### Genuine porting risks (from the provider audit)
1. **`golfLines.ts` depends on `lib/sports/golf/golfPlayerMatching.ts`** (ESPN roster matching) to disambiguate which concurrent tour event is today's field — this crosses the stated sports-data/odds-data boundary and needs an explicit scoping decision (keep golf odds in TS as a second named exception, duplicate roster access in Python, or have Python call back into TS — each has a real cost).
2. **Budget/rate-limit enforcement is inconsistent today**: only `oddsPapi.ts` actually calls into `budget.ts`. SharpAPI, Odds-API.io, and SportsGameOdds all define rate/monthly/daily limits in `config.ts` that are never read by the provider files themselves — meaning the real enforcement point (if one exists) is outside the files audited here and must be located before "port budget/rate-limit tracking" can be scoped accurately.
3. Several providers infer semantics from loosely-structured strings via regex (Odds-API.io's combined player/stat label, Propline's over/under-by-name, OddsPapi's exact-English market-name matching) — the highest-risk category for silent mis-mapping in a rewrite.
4. `oddsApi.ts`'s credit-reserve stop-refresh state machine and its asymmetric best-price logic are both easy to "simplify" incorrectly during a port and would change real numbers or spend behavior without raising an error.
5. SharpAPI's live `meta.tier.data_delay_seconds` override and ParlayAPI's header-based cost accounting (`x-requests-used`) are both easy to drop silently.

### Mechanical / low-risk
HTTP GET with query-param/header auth (`httpx` is a direct `fetch` equivalent), decimal↔American odds conversion, static alias dictionaries, the no-op `theOddsApi.ts` adapter, and the in-memory TTL board caches (though see coordination gaps below on whether that caching model still holds with multiple Python workers).

---

## 2. Orchestration, scheduling, budget/rate-limiting

### Current job cadence (`lib/scheduler.ts`)

All jobs start as a module-level side effect of the first HTTP request (`app/api/mlb/route.ts:14`) or process boot, then run on `setInterval`, firing once immediately at startup.

| Job | Interval | In scope for Python? |
|---|---|---|
| `refreshMlb` | 4 min | **Out of scope** — sports-data, stays TS |
| `refreshTier1` (SharpAPI + Odds-API.io) | 2.5 min | **In scope** |
| `refreshSportsGameOddsJob` | 90 min | **In scope** |
| `refreshNflJob` | 3 h | **In scope** |
| `refreshCfbJob` | 3 h | **In scope** |
| `refreshSoccerEplJob` | 45 min | **In scope** |
| `refreshCalibration` | 2 min | Unverified/ambiguous — not in this audit's read set. **Resolved 2026-08-19** (`docs/phase2-python-service-architecture-2026-08-19.md`): pure Postgres aggregation, no provider calls — same category as `refreshMlb`, out of scope, not one of the jobs moving to Python. |

No tennis proactive job exists; tennis rides SharpAPI's existing MLB-shaped path on demand.

### Concurrency/dedup guarantees — all in-process memory today

Four separate in-memory guards currently prevent duplicate work, **none of which can be shared between a Node process and a Python process**:
- `lib/staleCache.ts`'s `inFlight` Map (dedupes concurrent rebuilds)
- `tier1RefreshScheduler.ts`'s `lastRefreshAt`/`refreshInFlight` (a second, independent 3-minute TTL layered on top of the scheduler's 2.5-minute interval, guarding the request-triggered path)
- `budget.ts`'s `minuteWindows` Map (per-minute rate limiting, explicitly documented as not persisted)
- `tier2Cooldown.ts`'s `fixtureActionAt` Map (15-min-class cooldown for on-demand Tier 2 actions — stays TS-side by the passthrough decision, but protects a `provider_usage` budget row that Python's proactive job would also be spending against)

### The MLB-snapshot cross-language dependency

`gameContext.ts`/`gameState.ts` resolve "which games exist today" by reading `snapshot_cache['mlb:snapshot']` from Postgres — a `JSON.stringify`'d, **untyped** (`Record<string, unknown>`) payload written by the TS-side MLB adapter. The audit traced the exact fields a Python port would need to parse (`subjects[].meta.team`/`.gamePk`, `context.other.games[].{gamePk,matchup,awayTeamName,homeTeamName,firstPitch,state}`), including a non-obvious detail: team abbreviations are derived by **splitting the `matchup` string on `'@'`**, not read from a dedicated field — Python would need to replicate that exact parsing, not invent its own. Since this JSON contract has no schema enforcement today, a future TS-side refactor of the snapshot shape would silently break Python with no compile-time signal.

**NFL/CFB/Soccer/Tennis have no equivalent snapshot at all.** `multiSportGameContext.ts` calls ESPN directly, live, on every invocation — there's no pre-built Postgres row to read. Moving these sports' refresh jobs to Python requires picking one of three unappealing options: duplicate the ESPN-fetching logic in Python, have TS start publishing a snapshot for these sports too (new write path, arguably sports-data-layer scope creep), or have Python call back into TS synchronously (contradicts the no-live-HTTP design goal). **This is unresolved and needs an explicit decision before Phase 2 can cover any sport besides MLB.**

### Budget/cooldown state — partially verified as Postgres-backed

- **Confirmed shared correctly**: `provider_usage` daily/monthly counters go through an atomic `ON CONFLICT ... SET count = count + excluded.count` upsert — genuinely safe for a TS process and a Python process to both write to concurrently.
- **NOT shared, flagged as a real gap**: `budget.ts`'s per-minute rate limiter and `tier2Cooldown.ts`'s fixture cooldown are both in-process memory. If Python's proactive job and TS's on-demand routes call the same rate-limited provider inside the same 60-second window, neither knows about the other's recent calls — the monthly/daily Postgres counters don't help since they aren't minute-granular.

### Cross-process coordination gaps that must be solved before Phase 2 can be built

1. **No cross-process job lock.** Nothing currently stops a Python worker and a still-running TS `setInterval` from double-firing the same job, even transiently during cutover. Needs a Postgres-backed lock/lease (advisory lock or a `job_locks` table), and `lib/scheduler.ts`'s five in-scope `setInterval` registrations need to be actually **removed**, not just left dormant.
2. **Per-minute rate limiting isn't shared state.** Needs to become a Postgres row with a short-TTL window (or Redis, if one gets introduced) if both TS on-demand routes and Python's proactive jobs can hit the same provider inside one minute. Unverified whether the on-demand routes even call the existing limiter today — worth checking before finalizing the design.
3. **Tier 2 cooldown/budget split-brain.** The in-memory cooldown that gates TS-triggered SportsGameOdds spend has no visibility into what Python's proactive job just spent on the same fixture. The shared Postgres counter itself won't double-count, but the cooldown's "you're rate-limited" UX could go stale without cross-process awareness — an explicit design call, not a hard blocker.
4. **No versioned contract for the `snapshot_cache` payload.** Needs a schema doc (or JSON Schema) checked into the repo and referenced by both languages, plus a decision on fail-loud vs. silently-skip if TS ever writes a shape Python doesn't recognize.
5. **No Postgres snapshot exists for NFL/CFB/Soccer/Tennis game-context** — see above; blocks porting those sports' refresh jobs until resolved.
6. **Startup/ownership ambiguity during cutover.** There's no "Python owns odds jobs now" switch — needs either a config flag or literal removal of the in-scope scheduler lines (five, not six — see `refreshCalibration` correction above), or a partial/misconfigured deploy could run both.

---

## 3. Historical odds backfill/ingestion

Three ingestion paths, all writing into `historical_odds` via `writeHistoricalOdds` (`lib/db/client.ts:1885-1921`), a Postgres `INSERT … ON CONFLICT (season, game_date, home_team_id, away_team_id) DO UPDATE …` — a true natural-key upsert, so **every path here is idempotent and safe to re-run**.

**`ingestSbrXlsx`** (`lib/sports/mlb/historicalOddsIngest.ts:54-199`) — 2010-2020 SBR xlsx spreadsheets, parsed via the `xlsx` npm package (SheetJS). First-sheet-only, raw cell values with **no date-serial-to-calendar conversion** (the code assumes the Date column is already a plain integer, not an Excel date object) — a real fragility if a Python xlsx reader (openpyxl/pandas) interprets that same cell differently. Header matching is exact/normalized-string against small candidate lists, with no fuzzy fallback; a renamed header silently drops the column rather than erroring. The Close/Open **OU price column has no header at all** — it's inferred positionally as "one column right of the OU line column." Game pairing is by SBR rotation number, paired within-date — non-trivial logic that must be replicated exactly.

**`ingestLongCsv`** (lines 210-425) — 2021-2025 multi-book CSV. Uses a deliberately naive `line.split(',')` parser, explicitly **not** RFC4180-compliant (justified in-code only because no embedded commas were observed in the sampled data) — a Python port using `csv.reader`/`pandas.read_csv` would need to downgrade to the same naive split to stay behaviorally identical.

**`ingestScraperJson`** (lines 511-602) — 2026+ source, plain JSON, resolves team names to IDs via a live schedule-range network call. No file-format fragility.

**File discovery**: hardcoded season list 2010-2020 against filename pattern `mlb-odds-${season}.xlsx`, plus a regex over CSV filenames. Confirmed on disk (`data/historical-odds-import/`): 11 xlsx files + 1 long-format CSV, all matching the code's expected naming exactly.

**`oddsPapiHistoricalIngest.ts`** — not file-based; a live, budget-metered, rate-limited HTTP API consumer with 429 backoff. Structurally closer to the live provider-refresh pipeline (covered in §1/§2) than to a file importer.

**The `xlsx` npm dependency**: `next.config.mjs:22` carries an explicit comment that SheetJS does its own `fs` access inside `readFile()` and breaks under webpack bundling — Node/webpack-specific baggage that disappears entirely in Python (`openpyxl`/`pandas.read_excel` has no equivalent problem). Confirmed `better-sqlite3`/`node:sqlite` were already dropped from `serverExternalPackages` in Phase 1; `xlsx` is the one Node-specific dependency left in this ingestion path.

### The standalone script — confirmed broken, not just stale

`scripts/ingest-historical-odds.js` still `require('better-sqlite3')`s and opens `data/linebuddy.db` directly — **this was never updated for Phase 1.** Concretely:
- `better-sqlite3` is still an installed dependency (kept for the one-off `scripts/migrate-to-postgres.js`), and `data/linebuddy.db` (845 MB, plus WAL/SHM sidecars) still physically exists on disk — so the script doesn't crash, it **runs successfully and writes into a database the live app no longer reads at all.** That's a worse failure mode than an outright crash: a silent-success trap for anyone who re-runs it expecting production Postgres to update.
- It's also schema-stale: its hand-duplicated `INSERT`/`ON CONFLICT` predates the open-odds columns (`ml_home_open_prob`, `total_open_line`, etc.) that `writeHistoricalOdds` now writes.
- Neither this script nor either API route (`ingest-historical-odds`, `backfill-oddspapi-historical`) appears anywhere in `lib/scheduler.ts` or elsewhere in the repo — both are manually triggered only, never automated.
- Unverified: `data/linebuddy.db-wal`'s modification time was close to the audit date at inspection time; it's unconfirmed whether anything still opens that file periodically or the timestamp is incidental leftover from the Phase 1 migration run itself. Worth a direct check before Phase 2 finalizes scope — if something is still writing there, it's leaking data nobody reads.

### Recommendation

**Defer historical backfill from Phase 2's initial scope — treat it as a one-off data-load concern, not ongoing pipeline code.** Both routes' own docstrings call this one-time/bulk ingestion; it's confirmed absent from the scheduler and every other automated path in the repo. The xlsx/CSV logic already works today against the real files on disk, and porting it to Python buys pandas ergonomics at real risk of subtly different parsing (date-serial handling, positional-column inference, non-RFC4180 CSV splitting) for a workflow that's rarely re-run and costs nothing operationally to leave alone. If Python ends up owning live OddsPapi calls as part of §1/§2's provider work, the OddsPapi historical backfill could move there later at near-zero marginal cost — but it shouldn't be prioritized ahead of the continuously-running work.

**The one piece of this scope that needs action now, independent of that deferral**: `scripts/ingest-historical-odds.js` should be explicitly retired or rewritten against Postgres. It's not a hypothetical gap — it's confirmed still-SQLite, confirmed schema-stale, and confirmed orphaned post-Phase-1. Its own header comment says it exists to work around the Next.js dev server sandboxing that prevented direct file reads; once a separate Python process is reading local files anyway (Phase 2's whole premise), that constraint no longer applies, so deletion is the more likely right call rather than a rewrite.

---

## Open questions for the user before implementation starts

- **Golf odds scope**: does `golfLines.ts` become a third named TS-side exception (alongside the two on-demand OddsPapi actions), or is duplicating ESPN roster access in Python acceptable?
- **NFL/CFB/Soccer/Tennis game-context**: which of the three unappealing options (duplicate ESPN calls in Python, new TS snapshot-writing for these sports, or a narrow TS callback) is preferred? This blocks Phase 2 for every sport except MLB until decided.
- **Budget/rate-limit enforcement gap**: should this audit track down where (if anywhere) SharpAPI/Odds-API.io/SportsGameOdds's unused rate-limit config is actually meant to be enforced, before deciding what Python needs to replicate?
- **Cross-process locking mechanism**: Postgres advisory lock vs. a dedicated `job_locks` table — no strong signal yet either way from the codebase.
- **`scripts/ingest-historical-odds.js`**: retire outright, or confirm first whether anything still touches `data/linebuddy.db` before deleting it?
- **Historical backfill priority**: agreed to defer out of Phase 2's initial scope — confirm, or pull it in if there's a reason (e.g. a planned bulk re-ingest) not visible from the code alone?
