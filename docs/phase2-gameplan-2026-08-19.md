# Line Buddy — Phase 2 Gameplan: Moving Odds Ingestion to Python

**Status:** planning complete, implementation not started.
**Scope:** the 9 odds-provider integrations, the scheduling/orchestration layer, budget/rate-limit tracking. Sports-data fetching (ESPN/MLB Stats API/nflverse) stays in TypeScript permanently. On-demand user-triggered odds actions (More Books, Check Sharp Price, Line History, on-demand player scan) stay as thin TS passthrough routes. Historical odds backfill is deferred out of this phase entirely.

---

## Guiding principle

This is **one cutover, not a per-sport rollout**. Moving MLB to Python while NFL/CFB/Soccer/Tennis stay on the old TS `setInterval` path leaves the app permanently half-migrated with no clean finish line. Every sport moves together, once, when the prerequisites below are ready.

---

## Step 0 — TS bugfixes (do this first, this week, independent of everything else)

Found during the rate-limit enforcement audit. These are real production gaps, not just porting decisions — fix them in TypeScript now rather than "fixing them during the port," which would conflate a bugfix with a migration.

1. **SharpAPI** (`tier1Refresh.ts:84-92`): `withinPerMinuteRate('sharpapi', ...)` is called *after* the fetch already went out — it can only log, never block. Move the check to before the fetch. Currently masked only by the adapter's 90s board cache; not a real control.
2. **SportsGameOdds** (`sportsGameOddsRefresh.ts`, the 90-min MLB job): never calls `withinPerMinuteRate` at all, unlike `multiSportRefresh.ts` (NFL/CFB/soccer), which does it correctly. A busy MLB slate could exceed the 10/min limit today. Add the missing check to match the multi-sport path.

Both are small, isolated patches. Ship them regardless of Python timeline.

---

## Step 1 — Cross-process locking (build and prove before anything else)

**Decision: Postgres advisory lock, not a `job_locks` table.** Postgres is already in the loop for budget counters and snapshot cache; an advisory lock needs no new table, no manual expiry/cleanup, and releases automatically if a process dies. A `job_locks` table would need hand-rolled stale-lock handling.

This becomes the safety net every later step depends on — it must exist and be tested before any job risks running in two processes at once, even during isolated testing.

**Deliverable:** a working, tested `pg_advisory_lock`/`pg_try_advisory_lock` wrapper usable by both the TS scheduler and the future Python jobs, keyed per job name.

---

## Step 2 — Cleanup (parallel with Step 1, already done)

- ~~Rate-limit enforcement investigation~~ — **complete.** Findings: Odds-API.io enforces correctly (pre-fetch daily check). SharpAPI and SportsGameOdds's MLB job had the bugs fixed in Step 0. SportsGameOdds's multi-sport path and OddsPapi's monthly budget check are correct as-is. OddsPapi's 15-min cooldown is in-memory (resets on restart) — pre-existing, minor, not blocking.
- ~~Orphaned SQLite script~~ — **complete.** `scripts/ingest-historical-odds.js`, `data/linebuddy.db` (845MB), and WAL/SHM sidecars deleted. Confirmed no live process held the file and nothing automated ever triggered the script.

---

## Step 3 — Build Postgres snapshots for NFL/CFB/Soccer/Tennis

MLB already has a working pattern: `gameContext.ts`/`gameState.ts` read `snapshot_cache['mlb:snapshot']` from Postgres, a `JSON.stringify`'d payload the TS-side MLB adapter writes. NFL/CFB/Soccer/Tennis have no equivalent — `multiSportGameContext.ts` calls ESPN live, on every invocation, with nothing pre-built for Python to read.

**Decision: extend the existing snapshot-write pattern to these four sports**, rather than duplicating ESPN-fetching logic in Python (two implementations to keep in sync forever) or having Python call back into TS live (defeats the purpose of the move).

This is the long pole of the whole migration. Work involved:
- New TS write path per sport publishing to `snapshot_cache` on the same cadence as the sport's current refresh job.
- A versioned schema/contract for the payload shape (JSON Schema or equivalent, checked into the repo), referenced by both languages — the MLB snapshot has zero schema enforcement today and Python would need to reverse-engineer non-obvious details (e.g., team abbreviations are derived by splitting `matchup` on `'@'`, not read from a dedicated field). Don't repeat that for the new sports; document the contract explicitly this time.
- Decide fail-loud vs. silently-skip behavior if a future TS refactor changes the shape and Python doesn't recognize it.

---

## Step 4 — Golf odds: confirmed as a permanent TS-side exception

`golfLines.ts` depends on `golfPlayerMatching.ts` (ESPN roster matching) to disambiguate concurrent tour events — crossing the sports-data/odds-data boundary. Duplicating that matching logic in Python creates the same two-implementations problem as Step 3 avoided. Keep golf in TypeScript alongside the two on-demand OddsPapi actions that are already staying there. No further work needed — just documented as final.

---

## Step 5 — Full cutover, all sports at once

Prerequisites: Step 1 (locking) proven, Step 3 (snapshots) complete for all four remaining sports.

Move all five in-scope scheduler jobs to Python **in the same deploy**:
- `refreshTier1` (SharpAPI + Odds-API.io)
- `refreshSportsGameOddsJob`
- `refreshNflJob`
- `refreshCfbJob`
- `refreshSoccerEplJob`

`refreshCalibration` is **not** in this list — resolved 2026-08-19 (see `docs/phase2-python-service-architecture-2026-08-19.md`): it only reads/aggregates already-stored Postgres data (Brier scores, calibration buckets), zero calls to any odds provider. Same category as `refreshMlb` — sports/stats-data, stays TypeScript.

**Remove** the corresponding `setInterval` registrations from `lib/scheduler.ts` in the same deploy — not left dormant. A partial/misconfigured deploy running both TS and Python versions of a job is exactly what Step 1's locking exists to prevent, but the goal is to never rely on the lock as the only safeguard — remove the dead code too.

---

## Step 3.5 — Line-shopping right rail (new, independent track)

Found during the odds-precedence audit: player props already store and return every provider's price per book, unfiltered — a working "all books" UI already exists (`PropOddsPanel.tsx`, live on Player Detail) and just needs to be reused on more surfaces. Game lines are the opposite case — `oddsApi.ts`'s `summariseOddsEvent()` collapses spread/total to the first book found *before* anything is persisted, so there's no per-book data to surface for those two markets without a backend fix.

**Card qualification rule (product decision, not audit-confirmed):** a prop/line qualifies for the line-shopping card if 2+ distinct bookmakers have a price for it — any prices, no discrepancy/variance check required for v1. This is a new decision made in this document, not something the audit found in the existing code — unlike the bookmaker-vs-provider_id grouping caveat and the scan table's single-price rule below, which are audit-verified facts about current behavior.

**Placement:** right rail on Player Detail and Game Detail (both already have room). Not the Scan table/cards — confirmed space-constrained, stays single-best-price via the existing `bestPrice()` logic, which the audit already confirmed has correct "highest payout" semantics.

**Two independent pieces of work:**
- **Props (cheap, do first):** pure frontend. Reuse `PropOddsPanel.tsx`'s grouping logic. Group by `bookmaker`, not `provider_id` — ParlayAPI and Propline are each double-registered under two provider IDs, so grouping by `provider_id` would show phantom duplicate rows for the same underlying book.
- **Game lines (real backend work, do before Step 5):** fix `oddsApi.ts`'s `summariseOddsEvent()` to retain per-book spread/total data instead of collapsing to the first book before persist, and extend `writeOddsCache`'s stored shape accordingly. Moneyline is a smaller lift — the cross-book comparison already runs, it just discards the losing prices instead of keeping them. Bonus: this also fixes a latent bug where today's de-vig and pick-lock logic for spread/total run against a price that was never actually verified to be the best one.
- **Already-built bonus:** `GameLine.tsx`'s `BookmakerBreakdown` component is a fully-built, polished per-book UI for game lines that's completely unwired today — confirmed zero imports anywhere. Once the backend fix lands, wire this in rather than building a new component.

**Why this matters for the Python timeline — resolved by Step 4.5:** game lines stay TS permanently (see Step 4.5 below), so the game-lines fix here has no dependency on Step 5 at all — it's a straightforward bugfix that can land whenever, on its own merits, not something to sequence around a port that isn't happening.

---

## Step 4.5 — Resolved: game lines (`oddsApi.ts`) stays TypeScript permanently

**Decision (2026-08-19): stays TS**, alongside golf (Step 4) and the on-demand actions. Consistent with its actual fetch shape — on-demand with its own TTL/credit-reserve throttle, not a proactive `setInterval` job. Step 5's job list is now final as originally listed (five jobs — see the `refreshCalibration` correction below — no game-lines addition); Step 3.5's game-lines fix has no dependency on Step 5 and can land whenever, on its own merits as a bugfix.

---

## Remaining open items to resolve before Step 5 (not blockers for earlier steps)

- **OddsPapi's in-memory 15-min cooldown**: minor, pre-existing, resets on restart. Fine to leave as-is or fix opportunistically during the port — not a gating issue.
- **Historical backfill** (`ingestSbrXlsx`, `ingestLongCsv`, `ingestScraperJson`, `oddsPapiHistoricalIngest.ts`): confirmed deferred out of this phase. Revisit only if a bulk re-ingest is planned, or as a low-cost add-on once Python owns live OddsPapi calls.
- **Tier 1's freshness under strict sequential job queuing**: flagged in `docs/phase2-python-service-architecture-2026-08-19.md` — the 2.5-min Tier 1 cadence isn't fully compatible with the mandatory single-lane job queue under a slow-job worst case. Needs real per-job duration data (not available yet) before deciding whether a scoped exception is warranted.

---

## Sequencing summary

| Step | What | Depends on |
|---|---|---|
| 0 | Fix SharpAPI + SportsGameOdds rate-limit bugs in TS | Nothing — **done** |
| 1 | Build & prove Postgres advisory lock | Nothing — **done** |
| 2 | Cleanup (rate-limit audit, SQLite retirement) | Nothing — **done** |
| 3 | Build snapshots for NFL/CFB/Soccer/Tennis | Nothing new — parallel to Step 1 |
| 3.5 | Line-shopping right rail (props: frontend; game lines: backend fix) | Independent — no confirmed dependency on Step 5 (see Step 4.5) |
| 4 | Confirm golf stays TS-side | Nothing — decision only, **done** |
| 4.5 | Game lines stay TS permanently | Nothing — **done**, decision only |
| 5 | Full Python cutover, all in-scope proactive jobs, remove old scheduler code | Steps 1 and 3 complete. Job list final: `refreshTier1`, `refreshSportsGameOddsJob`, `refreshNflJob`, `refreshCfbJob`, `refreshSoccerEplJob`, `refreshCalibration` |
