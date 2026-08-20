# Phase 2 — Hardening Gameplan (post-incident)

Picks up after the Render incident: an accidental second deployment (`Linesmith`, the full
Next.js app, misconfigured on a 512MB plan) was OOM-crash-looping every ~5 minutes for at
least 21+ hours, re-firing all six TS scheduler jobs on every restart. That's the real
explanation for both the ParlayAPI credit exhaustion and SportsGameOdds's persistent 429s —
neither was fully understood until the Render API access made it possible to actually see
what was running. This doc is the punch list from that point forward, not a replacement for
`docs/phase2-gameplan-2026-08-19.md` (Steps 0–4.5 there are all still done and stand as-is).

---

## Status

| # | Item | Status |
|---|---|---|
| 1 | Let SportsGameOdds's real state clear | **On hold** — needs real elapsed time (hours), not another short probe |
| 2 | Figure out what `Linesmith` is, fix or remove | **Done** — confirmed accidental, deleted via Render API, verified no side effects |
| 3 | Fix the ParlayAPI `tier1Refresh.ts` bug | **Done** |
| 4 | Audit all TS provider/job wiring for the same bug class | **Done** — found and fixed a second instance |
| 5 | Wire `write_prop_odds` into `jobs.py` | **Done**, verified with real data |

---

## 1. Let SportsGameOdds's real state clear (on hold, not active work)

Every prior wait was confounded by `Linesmith` re-hammering the account every ~5 minutes — there was never a real quiet window to observe. Now that both services are stopped, a probe after a couple hours of genuine silence would be the first fair test since this started. Not scheduling this now; revisit when you want a read on it.

## 2. `Linesmith` accidental deployment — done

Confirmed accidental (full Next.js app, `npm run start`, on a 512MB plan, not blueprint-managed, no sign of intentional public use). Deleted via the Render API. Verified after deletion: only one service remains (`line-buddy-odds-worker`), the deleted service returns 404, the odds-worker's config is byte-identical before/after, no environment groups existed to break, GitHub `main` untouched. Nothing else on the account was affected.

## 3. ParlayAPI `tier1Refresh.ts` bug — done

Both `parlayApiAdapter` and `parlayApiMlbAdapter` were tagged `tier: 'tier1'` in `lib/odds/props/providers/parlayApi.ts`, silently including them in `tier1Providers()` — the MLB-only loop everywhere else describes as "SharpAPI + Odds-API.io." `tier1Refresh.ts`'s gating/cost-recording only had branches for `sharpapi`/`oddsapiio`; ParlayAPI ran there with **zero rate-limit checking and zero budget recording**. Evidence: `provider_usage` showed the general key at 1,095/1,000 (over, predating this session) and the MLB-dedicated key at **zero recorded rows** despite the vendor confirming it's credit-exhausted too.

**Fixed**: retagged both ParlayAPI identities `tier: 'tier2'` (confirmed inert — `tier2Providers()` has zero callers anywhere), removing them from Tier 1 entirely. ParlayAPI's real, intentional home stays the multi-sport (NFL/CFB) path in `multiSportRefresh.ts`, which already records cost correctly.

## 4. Full provider/job wiring audit — done, found a second instance

Checked every one of the 9 provider identities' `tier` tag against every consumer loop, not just the reported one. Found: **Propline's Soccer/EPL identity (`propline_2`) had the exact same bug** — tagged `tier: 'tier1'` via the shared `buildAdapter` function, silently running in the MLB-only Tier 1 loop and spending its Soccer-dedicated budget on redundant MLB calls, untracked. Unlike ParlayAPI, Propline's *general* (MLB) identity genuinely belongs in Tier 1 per its own header comment — the bug there wasn't wrong tagging, it was `tier1Refresh.ts` never having rate-limit/budget-recording logic for it despite it legitimately running there the whole time.

**Fixed**: `propline_2` retagged `tier: 'tier2'` (same inert-tag fix as ParlayAPI). `tier1Refresh.ts` given a real daily-cap check and spend-recording branch for `propline`, matching the existing Odds-API.io pattern exactly — the first time this provider has ever been rate-limited or tracked despite running in this loop the whole time. All 9 provider identities' tier tags re-verified after the fix; no further instances found.

## 5. Wire `write_prop_odds` into `jobs.py` — done, verified with real data

Every job now calls `db.write_prop_odds(...)` on whatever it resolves. Verified end-to-end with a real, isolated local run of `job_tier1()` (SharpAPI + Odds-API.io only — SportsGameOdds/ParlayAPI untouched, still excluded/suspended): 75 real rows fetched, normalized, and written — `prop_odds`'s real row count moved from 39,576 to 39,651, exactly matching. Sample rows confirmed correct: real players, real markets, real bookmakers, real prices.

**Update 2026-08-20 — Propline (MLB) now wired into Tier 1, done.** The gap flagged below is closed: `_job_tier1_inner()` in `jobs.py` now calls `fetch_propline` for MLB, gated by a new `db.daily_status(provider_id, limit)` read function (the Python port had write/increment functions for provider spend but no read — added specifically for this, mirrors TS's `dailyStatus()` in `lib/odds/props/budget.ts`). Same pattern as the just-completed `tier1Refresh.ts` fix: check today's spend against `PROPLINE_DAILY_LIMIT` (default 1000, `config.py`) before fetching; skip with a warning if at/over cap; record spend after a real request regardless of outcome.

Verified against real Postgres, not just import-checked: ran `job_tier1()` end-to-end locally. `prop_odds` row count moved 138,767 → 138,791 (delta 24, matching `rows_written`). Propline's branch fired, made 1 real request, hit a real 429 from the vendor (SharpAPI's rows are what filled the 24 — Odds-API.io and Propline both 429'd this run), and correctly recorded 1 spent request against `provider_usage` despite the 429 — same "a request was made" semantics Odds-API.io already uses, not success-gated. Separately confirmed the cap-reached comparison (`spent >= limit`) evaluates correctly against the real post-run spend value. The 429 itself is vendor/account state, not a code defect — same orthogonal distinction already established for SportsGameOdds's status.

**`line-buddy-odds-worker` stays suspended** — per your own sequencing, no reason to resume until SportsGameOdds's real status is known (item 1).

---

## Other open items from earlier planning, for completeness (not forgotten, just lower priority)

- **`refreshCalibration`**: confirmed out of scope for Python entirely (pure Postgres aggregation, no provider calls) — no action needed, already resolved.
- **OddsPapi's in-memory 15-min cooldown**: minor, pre-existing, resets on restart. Never blocking, fine to leave or fix opportunistically.
- **Historical backfill**: confirmed deferred out of Phase 2 entirely.
- **Golf odds / game lines**: both confirmed staying TypeScript permanently — decisions made, no further action.
- **True streaming (ijson) for ParlayAPI/SharpAPI's whole-board fetches**: Constraint 1's fallback (materialize-then-immediately-compact) is what's actually implemented; true incremental streaming was explicitly deferred, not silently skipped. Revisit only if memory pressure on the real 512MB budget turns out to require it.
- **The job-duration metric conflates "own time" with "time spent on nested yields."** The timeout-*crash* from this was fixed and verified, but the number itself (e.g., NFL logging ~238s when its own work was really ~182s) still isn't split into two separate figures in the logs. Cosmetic/diagnostic-only, not a correctness bug — worth a follow-up pass, not urgent.
- **The eventual Step 5 cutover itself** (removing the TS scheduler's `setInterval` jobs, making the Python worker the sole owner of these five jobs in production) — the actual end goal this whole hardening pass is in service of. Explicitly not next — everything on this page exists specifically to make that a safe, deliberate decision later rather than something attempted on a service that's still finding new bugs.
