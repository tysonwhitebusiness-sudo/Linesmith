# CURRENT — pick up here

> Handoff file for switching accounts mid-work. **Rewritten, not appended.**
> If it disagrees with anything else, trust `docs/audit-remediation-plan.md` §11
> and `git log` — those are the record; this is just the baton.

**Prompt to paste into a new account:**

```
Read docs/CURRENT.md and continue from there.
```

**THE RULE THAT KEEPS THIS FILE USEFUL: at ~92% context usage, stop.** Take on
no new work, finish or checkpoint what is open, and rewrite this file, then
commit and push.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — the plan. **Read §0 (working rules,
   standing decisions **Q1–Q18**, the G1–G8 gate) and the phase you are
   working.** Don't read it end to end.
2. **§11** — the phase log. Phases 0, 1 and 2 all have PASSED gate entries.
3. **`docs/table-ownership.md`** — one row per table, all 35. Read before
   touching any write path.
4. **`CLAUDE.md`** — now has a "Who writes what" section at the top. Corrected
   in task 2.8; it no longer overstates the Python cutover.
5. **`docs/audit-phase-2.md` … `-5.md`** — findings, for reasoning.

**Last updated:** 2026-08-29.
**Repo state:** clean, pushed. Worker deployed and live at `262dc73`.

---

## 1. Where we are

**Phases 0, 1 and 2 are COMPLETE. All three gates PASSED.**
**Phase 3 is next and has NOT started.**

Phase 2 substantially closed the audit's root cause, **but not completely, and
the gap is known**: Python computes every model number the app renders except
one documented exception (Q18), and one writer owns every table **except three**
— see §2. 16 commits, `464fda6` → HEAD.

## 2. Start here: Phase 3 — observability and defence

Use §0's kickoff prompt. **Run the "verify it still reproduces" step properly** —
in Phase 2 it caught that three of eight tasks were mis-scoped in the plan and
one finding (P2 M6.2) had gone stale and needed no fix at all. The audit was
measured 2026-08-27 and the tree has moved a long way since.

**Phase 3 inherits real work from Phase 2's own gate. Do this first:**

- **THREE TABLES STILL HAVE TWO WRITERS** — `game_sim_cache`, `park_factors`,
  `team_hr_rate_allowed`. `adapter.ts` writes all three on every snapshot
  rebuild (`ensureGameSims`, `loadParkFactorCache`,
  `loadTeamHrRateAllowedCache`), and Python writes them read-through from its
  own paths with **no `JOB_REGISTRY` job owning any of them**. The map claimed
  task 2.7 closed these; it never touched them, and the gate caught the claim.
  **The fix is ordered: add a scheduled Python writer FIRST, then make the
  TypeScript path read-only.** Reversing that empties a read-through cache with
  nothing to refill it and breaks the MLB page. Lower risk than the dual
  writers Phase 2 did close — both sides compute the same seasonal aggregate
  and upsert idempotently — but it is the phase's own goal, unmet.

**Two more, also from Phase 2's findings:**

- **3.x (unassigned): `recordEspnPregameLine` writes on a GET.**
  `lib/odds/espnBookLines.ts:71`, called from the CFB, NBA and Soccer
  `game/[gameId]` route handlers. Same class as P4 H1, which Phase 2 fixed for
  `/api/odds/lines` — but this one is in **no finding at all**, so no task owns
  it. Found while deriving `table-ownership.md`. Give it a task number.
- **3.10 has less to do than it thinks.** Phase 2 already batched
  `write_game_odds_history` (290 s → 1.6 s) because 2.3 could not ship without
  it. The other per-row write loops are still 3.10's.
- **3.1/3.4/3.5** are untouched and unaffected by Phase 2.

## 3. Things Phase 2 learned that will bite again

- **`withJobLock` is a LEASE TABLE, not an advisory lock** — and that matters
  beyond locking. Advisory locks are session-scoped; `DATABASE_URL` is the
  **transaction-mode** pooler (`:6543`), where they neither exclude nor release
  reliably. Measured: three processes all acquired, and the unlock leaked onto
  an idle pooled backend that then refused everyone. **Anything relying on
  session state through `:6543` is suspect** — that is a live class of bug, not
  a one-off.
- **The old lock test passed the whole time it was broken**, because it tested
  two calls *in one process*. Any test of cross-process behaviour must spawn
  real processes.
- **A one-hop importer check is not a deletion check.** Six modules looked used
  at the gate purely because the comments explaining their removal named the
  functions they replaced.
- **Don't pipe a long background command through `tail`** — the pipe buffers
  everything, the output file stays empty, and it looks hung when it is fine.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.
- **Git Bash `/tmp` is not Python's `/tmp`.** Use `os.tmpdir()` / real paths
  when handing files between `curl` and `python`.

## 4. Operational knowledge — do not re-derive it

- **DB access:** temp `.mjs` in the repo root, `node` it, delete after — `pg`
  resolves only inside the repo. `:6543` is the transaction pooler; use `:5432`
  for `pg_dump`, `VACUUM`, and anything needing session state.
- **Shared pooler caps around 15 connections.** Check for running scripts before
  starting DB-touching Python.
- **Python tests are standalone scripts, not pytest** — `python -u src/test_x.py`
  from `python-odds-service/`. **18 fast tests, all passing.** Five are skipped
  by design (four need 25–50 min and live data; `test_harvester_scrape` imports
  a package only on the scraper laptop) — task 3.11's input.
- **There is still no TypeScript test harness.** Task 3.11.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, health cron
  `crn-da7lquqfngtc73ft1n2g`. `autoDeploy: no` — **after any push touching
  `python-odds-service/`, POST a deploy and confirm the live commit contains
  your work.** `RENDER_API_KEY` is in `.env.local`.
- **`next dev` overwrites `.next`** — rebuild before `npm run start`.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's untracked file. Use
  `git add -A -- . ':!docs/discord-community-prompt.md'`.
- **Don't run recursive `grep`** over the repo; use the Grep tool.

## 5. Carried forward — Phase 4 must read this

- **Pre-2.3 `game_odds_history` rows are mislabelled.** The deleted TypeScript
  pass wrote propline and sharpapi prices under the default
  `source='the-odds-api'`. Not retroactively fixable — the true source was
  never recorded. **Any analysis grouping by source must know this.**
- **The 207 leaked NFL rows are deleted** (Q16). They predicted a game that had
  finished 21 months earlier. `pick_history` is now mlb + soccer only.
- **The 1.1 backfill** of 1,209 under-side rows is still deferred, and an
  unknown subset may be **uncorrectable** — `implied_raw` was never stored.
- **`computeCalibrationPayload` is Phase 4's to port** (Q18), as part of
  4.2/4.3 which rewrite that logic anyway. It is the last TypeScript model math.
- **MLB `pick_history` rows have no `commence_time`** (only new generic-sport
  and MLB moneyline rows do), so most history remains unauditable for leakage.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 6. Standing decisions

Q1–Q11 as before. Added during Phase 2:

| # | Decision |
|---|---|
| Q12 | Scan / More Books / Check Sharp Price **deleted outright** |
| Q13 | **Python computes every model number; TypeScript renders** |
| Q14 | Leakage: audit steps 1–3, report rather than delete |
| Q15 | 48-hour gate window **removed**; verified after Phase 9 |
| Q16 | Delete the 207 leaked NFL rows |
| Q17 | Drop `watch_links` |
| Q18 | `computeCalibrationPayload` ports in **Phase 4**, not Phase 2 |
