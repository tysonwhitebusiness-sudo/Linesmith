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
commit and push. Don't start a task you can't checkpoint before that line.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — the plan. **Read §0 (working rules,
   standing decisions **including the new Q12–Q15**, the G1–G8 gate) and the
   phase you are working.** Don't read it end to end.
2. **§11 of that plan** — the phase log. **Phase 2's entry is not written yet.**
   See "What §11 still needs" below — that is a real outstanding task.
3. **`docs/table-ownership.md`** — NEW, from 2.1. One row per table, all 35.
4. **`docs/audit-phase-2.md` … `-5.md`** — the audits, for a finding's reasoning.
5. **`CLAUDE.md`** — repo conventions. **Still overstates the Python cutover;
   task 2.8 fixes it and 2.8 is not done.**

**Last updated:** 2026-08-28.
**Repo state:** clean, pushed. Worker deploy `dep-da91ces9v7es73ctvafg` on
`805c023` was triggered — **confirm it went live before trusting the worker.**

---

## 1. Where we are

**Phases 0 and 1 COMPLETE, gates passed.**
**Phase 2 IN PROGRESS — 2.1–2.6 done, 2.7 partly done, 2.8 not started.**

| Task | State |
|---|---|
| 2.1 ownership map | **DONE** — `docs/table-ownership.md` |
| 2.2 leakage fix + 6 jobs re-enabled | **DONE**, deployed and live |
| 2.3 `/api/odds/lines` pure read | **DONE** |
| 2.4 golf double pipeline | **DONE** |
| 2.5 delete the three buttons | **DONE** |
| 2.6 dead code | **DONE** |
| 2.7a adapter cache-first | **NOT STARTED** ← the big one |
| 2.7b ports (1 of 3) | `logGameModelPredictions` **DONE**; two remain |
| 2.7c job locking | **DONE** — and it found a real bug, see §3 |
| 2.8 comments + `CLAUDE.md` | **NOT STARTED** |

Commits: `464fda6` (rescope) → `d51f655` `a65d64c` `1411aff` `0cc0e74` `c5efdbe`
`7cff201` `6545379` `805c023`.

## 2. Do this first

**Confirm the worker deploy landed.** Everything in 2.2–2.7 that runs in Python
is only real if it deployed. `autoDeploy: no`.

```
GET https://api.render.com/v1/services/srv-da36bm2bkg8c73fqrdeg/deploys?limit=1
# then: git merge-base --is-ancestor 805c023 <deployed-sha>
```

**Then check the six re-enabled jobs actually ran and wrote nothing leaked:**

```sql
SELECT sport, count(*), count(commence_time) AS auditable,
       count(*) FILTER (WHERE commence_time IS NOT NULL AND surfaced_at >= commence_time) AS leaked
FROM pick_history WHERE sport NOT IN ('mlb','golf') GROUP BY sport;
```
`leaked` must be 0. Anything else means 2.2's guard is not working and the phase
stops (rule 5).

## 3. What 2.7 turned into — read before continuing it

2.7 was rescoped twice before any code (see Q13's note in §0), and then the
implementation found a third thing:

**`withJobLock` was broken.** It used `pg_try_advisory_lock`; advisory locks are
session-scoped and `DATABASE_URL` is the **transaction-mode** pooler (`:6543`)
since Phase 0.5. Measured: three concurrent processes **all acquired**, and the
unlock landed on a different backend, **leaking** the lock onto an idle pooled
connection where it then refused everyone. Replaced with a `job_locks` lease
table (migration `20260828140000`). `withJobLock` now takes a required
`leaseMs`.

**The lesson worth carrying:** `scripts/test-job-lock.ts` had passed the whole
time, because it tested two concurrent calls **in one process**. The
cross-process case — the only one a cross-process lock exists for — was never
tested. It is now (test `(d)` spawns real child processes).

**Anywhere else the pooler-vs-session assumption might hide** is worth a look:
anything relying on session state through `:6543` is suspect.

## 4. Next actions, in order

**2.7b — two ports left.**
- `gradeFinishedGames` (`lib/odds/props/grading.ts`, 208 lines) → Python. MLB
  prop grading. `statsapi.py` already has the live feed;
  `generic_prop_grading.py` is the shape to copy. Called from
  `snapshotRebuild.ts`, still live.
- `computeCalibrationPayload` (`lib/odds/props/calibrationSnapshot.ts`, 86
  lines + its queries) → a Python job writing `snapshot_cache`. Called from
  `lib/scheduler.ts`'s `refreshCalibration`, now behind a lease.

**2.7a — the cache-first cutover. This is the substance of 2.7 and it is
untouched.** `adapter.ts` still runs live model math on a 4-minute timer:
`computeModelProbability` (730, 1640), `applyFittedHomeRunWeights` (1674),
`ensureGameSims` (1993). Make it read Python's already-computed results
instead, **copying the pattern already at `adapter.ts:2323`**, which does
exactly this for the game model against `mlb_game_model_cache` with a TS
fallback on a missing or stale row. Cache-first is what makes it safe: worst
case if Python is down is today's behaviour.

> **The open design question, and it is yours to decide, not to escalate:**
> Python writes prop results to `pick_history`, a first-write-wins **log** —
> today's number is frozen at whatever the first tick saw. A page needs the
> *current* number. This most likely wants a new `mlb_prop_model_cache`
> mirroring `mlb_game_model_cache`. Write down why in the commit.

Estimate for 2.7a: **2–4 days**, long end if the shapes don't line up.

**2.8 — last.** All six comments in P2 M6, plus `CLAUDE.md`'s cutover paragraph.
Several were already fixed opportunistically where a change invalidated them
(`jobs.py`'s golf docstring, `mlb_game_lines.py`, `golf/historyIngest.ts`,
`/api/props/lines`, `/api/odds/lines`, `middleware.ts`). **Still open:**
`db.py:331` `write_prop_odds`'s false "disconnected from any live fetch path",
`pgClient.ts`'s wrong connection arithmetic, `calibrationSnapshot.ts`'s SQLite
reasoning, `lib/scheduler.ts`'s header, and `CLAUDE.md` itself.

## 5. What §11 still needs — do not skip this

**No Phase 2 §11 entry exists yet.** Every task above was verified live and the
raw output is in the **commit messages**, which is not where rule 1 says it
goes. Before the gate, transcribe into §11: the leakage audit, 2.3's
before/after source table, 2.4's golf breadcrumb, 2.5's deletion list, 2.6's
grep, 2.7c's three-process result.

**Then the gate** — G1–G8 plus Phase 2's own section. Note Q15 removed the
48-hour window; the substitute is `max(timestamp)` advancing from Python within
one job interval per table, and the gate entry must say plainly that this
proves the writer works *now*, not that it keeps working unattended.

## 6. Operational knowledge — do not re-derive it

- **Don't pipe a long background command through `tail`.** The pipe buffers
  everything and the output file stays empty; it looks hung when it is fine.
  Cost two confused cycles this session.
- **Stale `.next/types` break `tsc` after deleting a route.** `rm -rf .next/types`.
- **`DATABASE_URL` is `:6543` (transaction pooler).** Use `:5432` for anything
  needing session state — `pg_dump`, `VACUUM`, **and advisory locks** (§3).
- **DB access:** temp `.mjs` in the repo root, `node` it, delete after — `pg`
  resolves only inside the repo.
- **Long tests can't survive the laptop sleeping.** Looks exactly like a pooler
  bug (`asyncpg.ConnectionDoesNotExistError`) and isn't one.
- **Shared pooler caps around 15 connections.** Check for running scripts before
  starting DB-touching Python.
- **Python tests are standalone scripts, not pytest** — `python -u src/test_x.py`
  from `python-odds-service/`. Now 18 fast tests (added `test_leakage_guard.py`).
- **`psql`/`pg_dump`** at `C:\Program Files\PostgreSQL\17\bin`, not on PATH.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, health cron
  `crn-da7lquqfngtc73ft1n2g`. `RENDER_API_KEY` in `.env.local`; you are
  authorised to use it for env vars, restarts and deploys.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's untracked file. Use `git add -A -- . ':!docs/discord-community-prompt.md'`.
- **Don't run recursive `grep`** over the repo; use the Grep tool.

## 7. Carried forward (not forgotten)

- **The 207 NFL `pick_history` rows are confirmed leaked, not merely suspect.**
  All predict game `401671813` — Eagles/Commanders, real kickoff
  **2024-11-15**, surfaced **2026-08-27**, ~21 months after it ended. Left in
  place per Q14; the delete/keep call is the operator's. **Phase 4 must not
  treat them as training data.**
- **`watch_links` has no writer in either tree** and is absent from P3 §4's map.
  Don't drop it on that alone — find out what it is.
- **`game_odds_book_lines` has request-path writers in no finding.**
  `recordEspnPregameLine` runs inside the CFB/NBA/Soccer `game/[gameId]` GET
  handlers. Same class as P4 H1. Recorded in `table-ownership.md`; **not fixed.**
- **`odds_cache` GET-path writes** (`golfLines`/`oddsApi`/`tennisLines`) — not
  closed by any Phase 2 task, carried to Phase 3.
- **Pre-2.3 `game_odds_history` rows are mislabelled.** The TS pass wrote
  propline and sharpapi prices under the default `source='the-odds-api'`. Not
  retroactively fixable — the true source was never recorded. Matters to any
  Phase 4/5 analysis that groups by source.
- **The 1.1 backfill** of 1,209 under-side rows — deferred by operator decision,
  and an unknown subset may be **uncorrectable**. Phase 4 must know this.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.
- **`better-sqlite3`** is now a devDependency; `scripts/migrate-to-postgres.js`
  is its only consumer.

## 8. Standing decisions (all in §0's table now)

Q12 delete the three buttons · Q13 Python computes every model number,
TypeScript renders · Q14 leakage steps 1–3, report don't delete · Q15 the
48-hour gate window is removed, verified after Phase 9 instead.

Earlier verbal ones still standing: Supabase Pro + Micro; weekly backup via
Task Scheduler (task 8.9 moves it off the laptop); gates G1–G8 binding; Scan's
Score column removed until 6.7.
