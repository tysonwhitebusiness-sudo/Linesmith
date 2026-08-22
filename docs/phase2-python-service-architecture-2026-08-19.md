# Phase 2 — Python Service Architecture: Memory & Concurrency Design

**Status: design/scoping only — no Python code exists yet.** This covers two mandatory constraints for the future Python service (512 MB budget) that must be designed in from the start, per direct instruction: never materialize a full uncapped provider board before filtering, and never run jobs concurrently against each other. Citations below were re-verified against the current TypeScript codebase before writing this, not assumed from memory.

---

## Correction found while scoping this: `refreshCalibration` isn't an odds job and shouldn't be in the Python job list

Before designing the queue, this needs fixing — it changes the job count the rest of this doc is designed around.

`lib/scheduler.ts:113-126`'s `refreshCalibration` calls `computeCalibrationPayload()` (`lib/odds/props/calibrationSnapshot.ts:43-67`), which does nothing but read and aggregate already-stored `pick_history`/grading data from Postgres (Brier scores, calibration buckets, the Market Trust record) — **zero calls to any of the 9 odds providers, no external HTTP fetch of any kind.** It's a stats/analytics job, not odds ingestion. This is architecturally identical to `refreshMlb` — already correctly excluded from Phase 2 as "sports-data, stays TypeScript" — not to the five genuine provider-refresh jobs.

This resolves the "refreshCalibration: unverified scope" item that's been sitting open in the gameplan since the orchestration audit. **It doesn't belong in Step 5's Python job list at all.** The real job count moving to Python is **five**, not six:

- `refreshTier1` (SharpAPI + Odds-API.io) — 2.5 min
- `refreshSportsGameOddsJob` — 90 min
- `refreshNflJob` — 3h
- `refreshCfbJob` — 3h
- `refreshSoccerEplJob` — 45 min

I've updated [docs/phase2-gameplan-2026-08-19.md](phase2-gameplan-2026-08-19.md) to reflect this and removed it from the open-items list. Everything below is designed around five jobs.

---

## Constraint 1 — never materialize a full uncapped provider board before filtering

Checked all 9 provider integrations for this pattern. Only two actually fetch a whole-sport board in one call; the rest are already scoped narrow enough that this isn't a real risk for them.

### The real targets

**ParlayAPI** (`parlayApi.ts:56-74`, `:99-103`) — confirmed the exact pattern: `fetchBoard()` calls `GET /sports/{sportKey}/props` with no per-game scoping, `res.json()` fully materializes the response (live-verified: MLB 5,000+ rows/18 books, NFL 2,870/8, CFB 1,505/4, Soccer 787), then `fetchGameProps()` filters that materialized array down to one game's rows by team-name match (`:99-103`). The board is cached 90s per `(configKey, sportKey)` specifically so a slate-wide loop doesn't re-fetch it once per game (`:50-53`'s comment is explicit about this) — meaning today's TS code deliberately holds the whole board in memory for the cache window, reused across every game in the slate.

**SharpAPI** (`sharpapi.ts:280-295`) — same shape: whole-sport-live board fetched in one call, filtered to one game by team-name match at `:291-295`, with its own separate 90s board cache.

Both have the same structural cause: a `.json()` call on the whole HTTP response forces full materialization before any filtering can happen, and then the filtered-out rows are simply discarded — the peak memory moment is "whole board fully parsed into a JS object," even though only one game's slice survives.

### Already low-risk, no design change needed

- **Odds-API.io**: two-step — a small, sport-wide events list (just IDs), then a per-event odds call (`?eventId=...`) already scoped to one game. Never holds more than one event's odds data.
- **SportsGameOdds**: `GET /v2/events?...&teamID=<home>,<away>&...&limit=5` — scoped by team IDs in the query itself, not a whole-sport pull.
- **Propline**: three-step, but both the markets-discovery and odds calls are per-event (`/events/{id}/markets`, `/events/{id}/odds`) — never whole-sport.
- **OddsPapi**: `fetchGameProps` is a hardcoded no-op (carries no player-prop data at all — confirmed in the earlier provider audit); its real logic (sharp-price/line-history) is the two on-demand actions staying in TypeScript per Phase 0, out of this port's scope entirely.
- **The Odds API (props)**: no-op adapter, zero data.

### Design: stream-parse + immediately compact, don't try to eliminate the shared cache

The literal instruction — "filter... as rows are parsed/received, not after the full board is materialized" — has a real nuance worth being explicit about rather than silently picking an interpretation. Two different things could be meant, and they have different costs:

1. **"Never hold more than one game's rows at any time."** Not actually achievable without giving up the board cache entirely — and giving up the cache would mean re-fetching and re-parsing the whole board once per game in a slate-wide loop (the exact waste `parlayApi.ts:50-53`'s comment says the cache exists to avoid), trading a memory win for a real increase in API cost and request volume. Not recommending this.
2. **"Never hold the board in its heaviest, verbose, raw-JSON form any longer or larger than necessary."** This is achievable and is what I'm recommending: stream-parse the HTTP response incrementally (Python: `httpx`'s streaming body + `ijson.items(...)`, rather than `response.json()`, which forces one big `json.loads` over the full buffered body) and convert each row to the compact, already-normalized shape (the `NormalizedPropRow`-equivalent — provider id, subject id, market key, line, side, bookmaker, price; a handful of small fields) *as it streams past*, discarding the verbose raw JSON representation of that row immediately. The compact per-sport board — not the raw board — is what gets held for the 90s cache window, shared across every game in that cycle's slate. This keeps the cache's real benefit (no repeat fetches) while cutting peak memory to roughly the size of the compact structure rather than 2x-ing on raw-JSON-plus-parsed-object during a naive `.json()` call, and rather than holding both a raw and normalized copy simultaneously.

Concretely, for both ParlayAPI and SharpAPI's Python ports: fetch → stream-parse → normalize-and-append to a compact per-sport list, dropping the raw row immediately after → cache that compact list for 90s, same TTL as today → per-game lookup filters the compact list (cheap, since it's already small per row) rather than the raw one. **Flagging as genuinely difficult, not silently working around it**: `ijson` (or an equivalent incremental JSON parser) isn't guaranteed to work cleanly against every response shape — if either provider's actual JSON structure isn't a simple top-level array (e.g., ParlayAPI's raw shape is a flat array per `ParlayPropRow[]`, which is the easy case; worth re-confirming this holds for real before assuming it), incremental parsing gets harder to wire up correctly and the fallback is documented here up front: full `response.json()` materialization, immediately followed by row-by-row conversion to the compact shape and dropping the raw list in the same pass (so the *raw* structure's lifetime is minimized even if it can't be avoided entirely at the parse step itself). This fallback still satisfies the spirit of the constraint (don't hold raw+compact both, don't hold raw any longer than one pass) even if it can't claim true streaming.

---

## Constraint 2 — single sequential job queue, no job-to-job concurrency

Confirmed the current pattern precisely: `lib/scheduler.ts:136-149` fires all `void refreshX()` calls immediately at startup with no `await` between them, then registers each on its own independent `setInterval`. Nothing prevents two jobs' fires from overlapping — with cadences of 2.5 min, 90 min, 3h, 3h, 45 min (five real jobs now, per the correction above), overlap is routine, not an edge case, exactly as described.

### Design

A single asyncio-based sequential runner: one loop, one job in flight at a time, jobs run to completion before the next starts. Internal bounded concurrency within a job is preserved — `multiSportRefresh.ts:110-111`'s `Promise.all([refreshWithParlayApi('nfl'), refreshWithSportsGameOdds('nfl')])` for NFL (and the identical pattern for CFB, `:115-116`) becomes an `asyncio.gather` of the same two calls inside that one job's run, not two separate queue entries — this is small, bounded, already-proven-safe concurrency, not the job-to-job pattern the constraint targets.

**Queue ordering**: not naive FIFO/round-robin across the five jobs. Each job tracks its own interval and last-run-completion time; the queue always picks whichever due job has the highest *overdue ratio* — `(now - last_run_end) / interval` — next. This doesn't change the hard sequential guarantee (still exactly one job running at a time), but it means once a long job finishes, the queue reaches for whichever fast job has been waiting proportionally longest, rather than blindly cycling through all five in a fixed order regardless of urgency.

**Per-job timeout guard**: a hard max-runtime cap per job (exact value TBD once real per-run durations are measured against the live providers — not guessable from today's TS code, which only defines *intervals*, never measured *durations*). This exists specifically so one stuck or slow job can't block the single lane indefinitely; a job that exceeds its cap gets cancelled and logged, not allowed to silently starve everything behind it.

---

## ⚠ OPEN RISK — Tier 1 freshness vs. strict sequential queuing (unresolved, do not lose track of this)

**Status: open. Explicitly not being solved on paper. Resolution is empirical, not a design decision — see "How this gets resolved" below.**

Tier 1 (SharpAPI + Odds-API.io, 2.5 min cadence) is explicitly the *fast* tier — its whole purpose, per its own TS comment (`scheduler.ts:38-42`'s contrast with SportsGameOdds's deliberately slower cadence), is to be the frequently-updated one. Under strict single-lane sequencing (Constraint 2, mandatory), Tier 1's real freshness becomes "2.5 minutes, plus however long whichever job happened to start just before it takes to finish" — worst case bounded by the single slowest job's actual runtime, which isn't known yet. Only cadence/interval is known from the current TS code (`scheduler.ts:35-56`); none of the five jobs' *durations* have ever been measured. SportsGameOdds's 90-minute job in particular sweeps every unfinished game on the slate with a real network call each (`sportsGameOddsRefresh.ts`'s loop, no caching by design) — this is the most likely single job to run long enough to meaningfully delay Tier 1 behind it.

This is a genuine, not-fully-resolved design tension: the overdue-ratio priority queue and the per-job timeout cap (Constraint 2's design above) both reduce the damage, but neither eliminates it — a hard sequential-only constraint and a 2.5-minute freshness promise are in real tension whenever a slow job happens to start right before Tier 1 comes due.

**How this gets resolved — explicit, per direct instruction, not left to my own judgment:** do not attempt to solve this on paper. Build a minimal version of the sequential queue and all five jobs first, measure real per-job durations under actual load against the live providers, and only then decide — with real data — whether:
- (a) the overdue-ratio queue + timeout cap is sufficient in practice as designed, or
- (b) Tier 1 specifically needs a scoped exception (e.g., a tightly memory-bounded allowance for Tier 1 to preempt/interleave with a long-running job) — a deliberate, explicit exception to "no job-to-job concurrency," not a silent violation of it.

This section stays open until that measurement happens. Do not let this get quietly resolved by a default/assumption during implementation — if the minimal build's real durations show this isn't actually a problem, that's a legitimate resolution, but it has to be an observed conclusion, not an assumed one.

**Real data, 2026-08-19 (`python-odds-service/`, minimal harness, live providers):** first measured sample, and it points the other way from the earlier optimistic read. `refreshTier1` itself is consistently fast (~5–7s per cycle, six clean cycles observed). But `refreshNflJob` measured **184.17s** in one run — over three minutes, more than a full Tier 1 interval (150s) on its own. Root cause is real and structural, not a fluke: NFL's 32 games against SportsGameOdds's real 10/min cap requires ~3 separate 60-second pacing waits within that one job (32 ÷ 10 ≈ 4 windows). Under strict sequential queuing, a single NFL run landing right before Tier 1 comes due would delay it by more than its entire interval — this is the exact tension the design flagged, now with a concrete number behind it instead of a guess.

Caveats on this sample, so it isn't over-read either: (1) one data point, one session, right after heavy manual testing that likely left residual rate-limit pressure on SportsGameOdds specifically (several 429s still showed up even with pacing) — the true clean number could differ; (2) `refreshSportsGameOddsJob` itself (the 90-min MLB job, 15 games, ~65s observed) hasn't had a fully 429-free run yet for the same reason; (3) `refreshTier1`'s own Odds-API.io leg 429'd on every cycle in this run — the harness is missing the 5-minute events-endpoint cache the TS code has (`oddsApiIo.ts`'s `EVENTS_TTL_MS`), so it's hitting that endpoint harder than production code would; this doesn't affect the NFL finding but flags that Tier 1's own numbers aren't fully clean either yet.

**Updated status**: no longer "looks fine, early signal encouraging." The NFL job's real duration is large enough relative to Tier 1's interval that (b) — a scoped exception for Tier 1 — now looks more likely to be needed than not, pending a larger, cleaner sample to confirm 184s wasn't itself inflated by residual rate pressure. Still not deciding this on paper — next step is a longer clean-window sample once rate pressure fully clears, not a conclusion from one run.

**Confirmed with a second clean run 48 minutes apart** (182.67s vs 184.17s) — same magnitude, same structural cause (SportsGameOdds's real 10/min cap against NFL's 32 games forcing ~3 separate 60s pacing waits). Two independent measurements agreeing this closely rules out a one-off artifact. The risk is real.

---

## RESOLVED — Tier 1 risk: yield-based cooperative restructuring, not preemption

**Decision.** NFL/CFB/the MLB SportsGameOdds job do not get an interrupt-and-resume exception to Constraint 2. Instead, each was restructured to cooperatively yield control at the exact points where it was already forced to wait for SportsGameOdds's rate limit — turning existing dead time into an opportunity for a more urgent job to run, rather than adding a new preemption mechanism on top of the sequential queue.

**Why this over preemption:** NFL's ~183s isn't continuous work — it's ~3 separate ~60s waits for rate-limit capacity, already present in the job's structure, doing nothing. Interrupting NFL mid-flight to let Tier 1 run would need new pause/resume state, a paused job's memory held alongside whatever Tier 1 needs, and real ambiguity about what "safely paused" means for NFL's in-progress work. Yielding needs none of that — the job's own coroutine is genuinely suspended (not doing anything, not holding a request half-sent) at exactly the moment it would have called `sleep()` anyway. This keeps Constraint 2's actual guarantee — exactly one job's real work executing at a time, no two jobs' logic genuinely concurrent — fully intact; it just adds checkpoints inside "one job" where control can pass elsewhere and come back.

**Validated before building for real**, per instruction: a throwaway POC (two simplified fake jobs, one NFL-shaped with repeated batch+wait, one Tier1-shaped with a short interval) confirmed the core mechanism first — exactly one run each, correct batch ordering across yields, no deadlock, the fast job genuinely ran during the slow job's simulated wait. Only after that passed was the real job code touched.

**Prerequisite fix, done first as instructed:** rate-limiting was previously scoped per function call, not per provider across the process — `refreshSportsGameOddsJob`, `refreshNflJob`, and `refreshCfbJob` each tracked their own local 10/min window, so back to back they each believed they had a fresh allowance against the same real vendor-side counter. Confirmed live: the identical 5 SportsGameOdds event IDs 429'd across two runs 48 minutes apart — not random pressure, this specific gap. Replaced with one shared, process-wide counter (`rate_limit.py`), mirroring `budget.ts`'s `minuteWindows` Map exactly — every caller of a given provider now draws from the same real budget. This is what makes yielding *safe*: two jobs' provider calls can now genuinely interleave in time without each thinking it has independent headroom.

**Two real bugs found by actually running the real implementation** (the POC didn't model these — its own scope was validating the core mechanism, not full integration):
1. The startup burst (fire every job once immediately) had no memory of jobs already pulled forward by a yield during an earlier job's turn — it re-ran them a second time. Fixed with an `_ever_run` set the burst loop checks before each job's registry slot.
2. A transient DNS failure while writing the non-critical diagnostic job-run log crashed the entire process. A breadcrumb write has no business being that consequential — wrapped in a non-fatal catch, same contract every other non-load-bearing cache write in this codebase already follows. Confirmed working: a second transient connection failure occurred in a later run and was caught, logged, and the queue continued rather than crashing.

**Test results, real data:**
- **Collision test** (NFL running, Tier 1 coming due mid-run) — confirmed twice, reproducibly: NFL yields to Tier 1 at ratio ≈1.01 (essentially exactly on schedule), Tier 1 runs to completion (~7s), NFL resumes its next batch immediately after. Tier 1 does **not** wait for NFL's ~183s.
- **NFL's own completion time** — the outer measured duration rose to ~238s, but that number conflates NFL's own work with whatever it ran on another job's behalf during its yields (in the observed runs: CFB's ~50–58s plus Tier 1's ~7s). Subtracting that nested time gives NFL's own work+wait at ~182s — matching the original baseline almost exactly. No real regression; the raw "job duration" metric as currently logged is just measuring the wrong thing (own-time vs. wall-clock-including-guests) and should be split into two numbers in a real implementation.
- **Shared counter fix, verified** — CFB alone (8 games) never needed pacing in isolation (1.5–3.8s measured standalone). In the same burst as SportsGameOddsJob and NFL, sharing the real counter, CFB took ~49–58s — direct evidence its calls are now correctly waiting on capacity already partially spent by other jobs, not getting an independent fresh allowance.
- **Confound found, not a code defect:** the exact same handful of event IDs kept 429ing even after the shared-counter fix. Root cause: the TypeScript dev server (left running from earlier UI verification work) has its own `refreshSportsGameOddsJob` on a 90-minute scheduler hitting the *same* real vendor API key, invisible to the Python harness's counter. Stopped that server once identified. This confound won't exist in production, since Step 5's cutover removes the TS scheduler entirely rather than running both.

---

## Summary

- **Job count corrected**: five proactive jobs move to Python, not six — `refreshCalibration` has no odds-provider dependency and stays with the sports-data jobs that were already out of scope.
- **Constraint 1**: only ParlayAPI and SharpAPI are real targets (both whole-sport-board fetches); the other three data-bearing providers are already narrowly scoped. Design is stream-parse + immediate compaction into the already-normalized row shape, keeping the existing 90s shared-board cache (in compact form) rather than eliminating it — documented fallback (materialize-then-immediately-compact-and-drop-raw) for if incremental parsing doesn't cleanly fit a given provider's response shape.
- **Constraint 2**: single sequential asyncio queue, overdue-ratio priority ordering, per-job timeout guard, bounded intra-job concurrency preserved.
- **Tier 1 risk: RESOLVED.** Confirmed real and reproducible (184.17s and 182.67s across two runs 48 minutes apart). Resolved via yield-based cooperative restructuring — NFL/CFB/the MLB SportsGameOdds job yield control at their existing rate-limit pacing waits instead of blocking the queue, validated first via a throwaway POC, then built for real and tested. Depends on (and motivated fixing) a shared, process-wide per-provider rate-limit counter, replacing one that was incorrectly scoped per function call. See the dedicated RESOLVED section above for full reasoning, the two real bugs integration testing caught, and the test results.
