# CURRENT — pick up here

> Handoff file for switching between accounts mid-work. Rewritten (not appended)
> whenever a session is about to end. If this file disagrees with anything else,
> trust `docs/audit-remediation-plan.md` §11 and `git log` — those are the
> record; this is just the baton.

**Last updated:** 2026-08-28, end of the Phase 0 session.

---

## Where we are

**Phase 0 — complete except one check.** Everything in `docs/audit-remediation-plan.md`
Phase 0 is done and verified. The gate (§0, G1–G8) passes on G1, G3, G4, G5, G6,
G7, and on G2's typecheck and build.

**Phase 1 has NOT started, and must not until the gate closes.** That is the
plan's own rule 4.

## What's in flight

Two Python model tests, started ~10:38 local on 2026-08-28, running in a
background shell that **will not survive this session**:

```
cd python-odds-service
python -u src/test_mlb_mlp.py          # was ~47 min in, 55-min cap
python -u src/test_mlb_tree_models.py  # runs after it
```

They are the last open G2 item. Both previously died at a 25-minute timeout —
that was my timeout, not an assertion failure. They are slow because each does
~730,000 pure-Python game simulations per season (`SIM_TRAINING_N = 300` in
`predict/model_fit.py:59` × ~2,430 games), over two seasons.

**To resume:** just re-run them, from `python-odds-service/`, not from `src/`.
If either again fails to finish in a bounded window, record it in §11 as
"cannot complete in a bounded window on this hardware" and close the gate on
that basis — that is a legitimate result and a more useful input to task 3.11
than a pass would be. Don't keep re-running them.

## Waiting on you (operator)

- **`git push origin main`** — 10 commits unpushed right now. The classifier
  blocks me from pushing; it has to be you. This matters more than it sounds:
  this session's worst bug was `87fa65e`, a fix committed days earlier and never
  pushed, so production ran broken code the whole time.
- Nothing else is blocking.

## Decisions made verbally this session (already applied)

- Supabase upgraded to **Pro + Micro compute** (Phase 8.1 pulled forward,
  because `player_game_history` is 830 MB of training data Phase 4.7 needs).
- I may use the **Render API** for env vars, restarts, deploys.
- Weekly backup runs on **Windows Task Scheduler** as a stopgap; **task 8.9**
  was added to move it off the laptop.
- Phase gates (G1–G8) were added to the plan at your request and are binding.

## Next actions, in order

1. Push the 10 commits.
2. Re-run the two model tests; record the result in §11.
3. Close the Phase 0 gate in §11 (`GATE RESULT: PASS`).
4. Start Phase 1 using the kickoff prompt in §0.

Four Phase 1 findings were already confirmed to still reproduce, so they need no
re-verification:

| Task | Confirmed |
|---|---|
| 1.2 | `app/api/odds/lines/route.ts` still stamps `new Date().toISOString()` in 4 places |
| 1.5 | `ADMIN_API_PREFIXES = ['/api/diagnostics']` only — every `/api/props/*` route is open |
| 1.7 | `CALIBRATION_INTERVAL_MS = 2 * 60_000`, unchanged |
| 1.10 | `lib/cachedRoute.ts:141` still returns `detail: error.message` to anonymous callers |

---

## The prompt to paste into a new account

```
Read docs/CURRENT.md and continue from there.
```
