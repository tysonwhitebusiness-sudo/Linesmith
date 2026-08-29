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

1. **`docs/audit-remediation-plan.md`** — §0 (working rules, standing decisions
   **Q1–Q22**, the G1–G8 gate) and the phase you are working. Don't read it end
   to end.
2. **§11** — the phase log. Phases 0, 1, 2 and 3 all have PASSED gate entries.
3. **`docs/table-ownership.md`** — one row per table, all 36.
4. **`CLAUDE.md`** — has a "Who writes what" section at the top.
5. **`docs/audit-phase-2.md` … `-5.md`** — findings, for reasoning.

**Last updated:** 2026-08-29.
**Repo state:** clean, pushed. Worker live. `npm audit` 0 vulnerabilities. CI
green on GitHub Actions.

---

## 1. Where we are

**Phases 0, 1, 2, 3 COMPLETE — all four gates PASSED.**
**Phase 4 (the scoreboard) is next and has NOT started.**

Phase 3 closed 14 findings and found one that was in none of them: `prop_odds`
had 178,238 redundant rows (80% of the table) because `ON CONFLICT` never fired
for categorical markets — Postgres treats NULLs as distinct. 5,792 keys held
**disagreeing prices**, up to 77 for one key, so displayed prices for those
markets were arbitrary. Fixed and verified.

## 2. Start here: Phase 4 — build the scoreboard

Use §0's kickoff prompt. **Run the "verify it still reproduces" step properly.**
It has now materially rescoped three phases running — in Phase 3 alone, four of
fourteen tasks did not describe the code.

**Phase 4 inherits three things it must know:**

- **`computeCalibrationPayload` is Phase 4's to port** (Q18) as part of
  4.2/4.3, which rewrite that logic anyway. It is the last TypeScript model math.
- **Pre-2.3 `game_odds_history` rows are mislabelled.** The deleted TS pass
  wrote propline and sharpapi prices under `source='the-odds-api'`. Not
  retroactively fixable. **Any analysis grouping by source must know this.**
- **`prop_odds_history` contains phantom "movements"** written before the
  duplicate fix, from the same NULL-key ambiguity. Same caveat applies.

## 3. Things that will bite again

- **`ADMIN_API_PREFIXES` does nothing without a `config.matcher` entry.** This
  shipped as a false claim in task 2.9 and left an operator route open until
  3.13 caught it *by issuing a request rather than re-reading the constant*.
  `tests/proxy-matcher.test.ts` guards it now.
- **Fault injection is easy to fake.** Three separate times a "fault" produced
  a green result because it was never injected: routes serving `x-cache: hit`
  and never rebuilding; `REVOKE` against a table's **owner**, which bypasses
  its own grants; and a "hermetic" test that only degrades to warnings without
  a database. **Confirm the fault actually landed before believing the result.**
- **`withJobLock` is a LEASE TABLE, not an advisory lock.** Advisory locks are
  session-scoped and `DATABASE_URL` is the transaction pooler, where they
  neither exclude nor release. Anything relying on session state through
  `:6543` is suspect.
- **Postgres UNIQUE treats NULLs as distinct.** Any `ON CONFLICT` whose target
  includes a nullable column silently never fires for NULL rows. That is what
  produced the 178k duplicates. Worth checking other tables for the same shape.
- **Don't pipe long background commands through `tail`** — output buffers and
  it looks hung.
- **Git Bash `/tmp` is not Python's `/tmp`.** Use real paths between `curl` and
  `python`.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 4. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it, delete after. `:6543`
  is the transaction pooler; use `:5432` for DDL, `pg_dump`, `VACUUM`, advisory
  locks.
- **Tests:** `npm test` (26, node:test via tsx) and `python -u src/test_x.py`
  from `python-odds-service/`. CI runs 9 hermetic Python tests + the TS suite;
  the excluded ones and why are printed by `.github/workflows/ci.yml` itself.
- **No `gh` CLI and no GitHub token here.** Check CI via
  `https://api.github.com/repos/tysonwhitebusiness-sudo/Linesmith/actions/runs`
  — job and step names are public, logs are not, which is why CI uses one step
  per test.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no` — after any
  push touching `python-odds-service/`, POST a deploy and confirm the live
  commit contains your work. Suspend/resume via `/suspend` and `/resume`.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's. Use `git add -A -- . ':!docs/discord-community-prompt.md'`.

## 5. Carried forward

- **3.15 — two GET-path writers, recorded not done.** `recordEspnPregameLine`
  (CFB/NBA/Soccer game routes) and `odds_cache` (golf/odds/tennis). **Do not
  simply delete them**: Python has no ESPN pregame-line capture, so deleting
  loses data for three sports. Needs a real port. **Owner: Phase 5.**
- **`prop_odds_dedup_backup_20260829`** holds the 178,238 deleted rows. Drop it
  once the new constraint has soaked in production.
- **No push alerting** (Q19) — Phase 8.
- **Rate limiting is per-process and `x-forwarded-for` is spoofable** — Phase 8
  needs shared state and a trusted proxy.
- **`/api/odds/lines` is ~1.8s median.** Mostly the multi-MB snapshot parse.
- **Player and non-MLB team ids** get shape validation only, no allowlist.
- **The 1.1 backfill** of 1,209 under-side rows is still deferred and partly
  uncorrectable.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 6. Standing decisions

Q1–Q11 as originally recorded. Since:

| # | Decision |
|---|---|
| Q12 | Scan / More Books / Check Sharp Price deleted outright |
| Q13 | Python computes every model number; TypeScript renders |
| Q14 | Leakage: audit steps 1–3, report rather than delete |
| Q15 | 48-hour gate window removed; verified after Phase 9 |
| Q16 | Delete the 207 leaked NFL rows |
| Q17 | Drop `watch_links` |
| Q18 | `computeCalibrationPayload` ports in Phase 4 |
| Q19 | **No external error tracking, ever** — `system_events` + health check |
| Q20 | **CI runs hermetic tests only** — no DB credentials in Actions |
| Q21 | xlsx investigated and removed outright |
| Q22 | Next 16 upgraded inside Phase 3 |
