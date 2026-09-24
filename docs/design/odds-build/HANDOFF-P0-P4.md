# Handoff — unattended run P0 → P4 (written 2026-09-24)

## Operator approvals recorded here

- **Design choices and thresholds in the specs are approved** where they were
  made for a stated reason (operator, 2026-09-24: "if your design and other
  choices were made for a good reason then I approve"). Each spec gives its
  reason inline; keep it there when you build.
- **Unattended run P0 → P4**, testing between phases per each spec's "Tests
  (these gate …)". Background checks start and run behind; they never gate.
- **P1's Render deploy of `line-buddy-odds-worker` is AUTHORISED** (operator,
  2026-09-24). The session triggers it itself through the Render API. Then
  it confirms the deploy went live and the worker's next job runs are green,
  and records it in `docs/CURRENT.md` → Deploys. **Only P1's deploy is
  covered**; nothing in P2–P4 deploys.
- **P4 ends at the operator's decision D24.** Measure, write the options and a
  recommendation into `P4-storage-decision.md` → Result, then stop. Do not
  pick D24.

## Known spec corrections (fix while waiting for D24, after P4's measurement)

Found by the operator's "does this follow the plan" review. They touch
P6–P11 and the scraper lane, not P0–P4, so the run proceeds without them.

1. **P11 gate 2 must implement D13 exactly.**
   - The sharp **price time** is Pinnacle's `fetched_at − cache_age_s` (or
     `Last-Modified`), the moment our copy represents. It is not its
     `changed_at`.
   - Take the soft price **as it stood at that price time** (the soft book's
     history), and require that the soft price has **not changed since** and
     that no fast sharp source (Kalshi/Polymarket, same line) moved more than
     1.5 pts since.
   - Keep the checked-age limits.
   - Update the gate text and the `test_market_edge.py` cases: one case where
     the soft book moved after the sharp price time → no edge.
2. **P6: unmatched rows are kept with their prices** (plan B4), not only
   counted. Add a Supabase table `scraper_unmatched_prices` (current state,
   one row per scraper key: source, event, market, book, line, side, price,
   checked, since, reason). It is subject to D24's budget; if D24 excludes
   it, the reason is written in D24.
3. **P8 `LineMovement`:** add the optional consensus line, unselected books as
   grey context, and **pulled lines drawn on the chart** (a gap plus a
   "pulled" tick, L2, from `*_pulls`).
4. **L5 dropping-odds lists** go back into the build as a P8 O4 sub-item: the
   Slate Movers "Dropping odds" list (open → current, % change across books,
   from `market_openers` + current prices). Plus "pulled-line alerts" (already
   in P12).
5. **P7 gains T0.4:** check each paid feed's API payload for per-book
   timestamps, and recheck SportsGameOdds' `lastUpdatedAt` after its monthly
   key reset. Record what exists in P7 → Result.
6. **Scraper lane S-G3:** keep polling per-game prop pages **beyond 7 days**
   at 60 min (D15), not "not polled". The tiers become
   `((6, 60), (72, 300), (168, 900), (∞, 3600))`.

Commit each fix to its spec file with a line in that file saying what changed
and why.

## Order of work for the unattended session

1. Read, in order: `CLAUDE.md`; `docs/CURRENT.md` (item 7);
   `docs/design/odds-build/README.md`; this file;
   `docs/design/odds-build-phases-2026-09-24.md` (findings F1–F14 and the
   time rule); then each phase's spec **right before** building it.
2. P0 → P1 → P2 → P3 → P4, each one:
   build → the spec's gate tests → commit + push → a `docs/CURRENT.md` update
   (what is done, what background check is running, and where) → next.
3. After P4's measurement: fix the six spec corrections above, then stop and
   leave the operator a summary (P4's options + recommendation, and anything
   blocked).

## Scraper state at handoff

- The scraper froze at 17:38 UTC on 2026-09-24. The process stayed up, but
  polling stopped: 28 writes were pending and 39 fetches in flight.
- It was **restarted by the operator's instruction at 20:53 UTC**, and
  polling resumed at 20:54.
- About 3 h 15 min of data (17:38–20:54 UTC) were never collected.
- The cause of the hang is **still unknown**. So P0 is still needed in full:
  - the freshness watchdog, so it restarts itself next time;
  - the stall dump, which captures the thread stacks at the next freeze and
    names the cause;
  - the backup.

## Things that will need the operator (write them down, don't block on them)

- Creating new Windows scheduled tasks (`OddsScraperBackup` in P0) if the
  permission system refuses `Register-ScheduledTask`. Run the job once by
  hand instead.
- Any process stop the permission system refuses. P0's new watchdog, run by
  the existing `OddsScraper` task, restarts the scraper instead.
- The `py-spy` install in P0 step 4 (a download). Skip it; the new stall dump
  captures the next hang.
- D24.
