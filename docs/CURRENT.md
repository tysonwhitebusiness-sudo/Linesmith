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
3. **`docs/table-ownership.md`** — one row per table, all **36**, with three
   still marked contested. Read before touching any write path.
4. **`CLAUDE.md`** — now has a "Who writes what" section at the top. Corrected
   in task 2.8; it no longer overstates the Python cutover.
5. **`docs/audit-phase-2.md` … `-5.md`** — findings, for reasoning.

**Last updated:** 2026-08-29.
**Repo state:** clean, pushed. Worker deployed and live at `262dc73`.

---

## 1. Where we are

**Phases 0, 1, 2 COMPLETE — all gates PASSED. Phase 3 IN PROGRESS.**

| Task | State |
|---|---|
| 3.1 cache-write failures | **DONE**, fault-injected |
| 3.6 upload limits | **DONE** |
| 3.12 security headers | **DONE**, verified live |
| 3.13 xlsx removed + **Next 16** | **DONE** — `npm audit` 0 vulns |
| 3.14 CSRF test | **DONE**, proven in both directions |
| `middleware.ts` → `proxy.ts` | **DONE** (Next 16 rename) |
| 3.2 /diagnostics panel | not started |
| 3.3 health-check fault injection | not started ← **do the injection before editing anything** |
| 3.4 rate limiting | not started |
| 3.5 cache-key validation | not started |
| 3.7 admin auth out of source | not started |
| 3.8 `?` placeholder compiler | not started |
| 3.9 `withConnectionRetry` scope | not started |
| 3.10 `writePropOdds` batching | not started |
| 3.11 CI | not started |

Phase 2's inherited items (`recordEspnPregameLine` on GET, `odds_cache` GET
writes) are still unassigned Phase 3 work.

## 2. Read this before continuing Phase 3

**A gate I claimed in task 2.9 was never applied, and 3.13 caught it.**
`/api/mlb/refresh-hr-matchup` was added to `ADMIN_API_PREFIXES` but not to
`proxy.ts`'s `config.matcher`, so it stayed open to unauthenticated POSTs.
A comment three lines above says exactly that this happens. Now fixed and
guarded by `tests/proxy-matcher.test.ts`.

**Fault injection is easy to fake, and I faked it twice before noticing.**
Verifying 3.1 I "revoked" write on `snapshot_cache` and got a clean 200 with
no error — twice — because (a) the routes were serving `x-cache: hit` and
never rebuilt, and (b) `postgres` **owns** the table, and an owner bypasses
its own grants. A REVOKE against the owner does nothing. What works is a
`BEFORE INSERT OR UPDATE` trigger that RAISEs. **Always confirm the fault
actually landed** — check the row was not written — before believing a green
result. This matters most for 3.3, whose entire point is checks that report
green through an outage.

**`npm test` exists now** — `node:test` via tsx, 7 tests in `tests/`. No new
runtime dependency; `tsx` moved to devDependencies (it was already required by
`scripts/test-job-lock.ts` through npx).

## 3. Things Phase 2 learned## 3. Things Phase 2 learned that will bite again

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
