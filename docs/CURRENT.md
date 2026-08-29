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
   **Q1–Q27**, the G1–G8 gate) and the phase you are working. Don't read it end
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
**Phase 5 is next. Phase 4 comes AFTER 5 — the plan's order is deliberately
reversed, see below. Neither has started.**

Phase 3 closed 14 findings and found one in none of them: `prop_odds` had
178,238 redundant rows (80% of the table) because `ON CONFLICT` never fired for
categorical markets — Postgres treats NULLs as distinct. 5,792 keys held
**disagreeing prices**, up to 77 for one key.

## 2. Start here: Phase 5, NOT Phase 4

**The plan lists 4 and 5 as parallel. They are not, and the dependency runs
one way.** Measured 2026-08-29:

- Phase 4's headline blocker is 4.1 — `market_prob` is on **2.85% of the last
  7 days** (1.04% lifetime). Two independent causes: **75% of candidates have
  no matching price at all**, and of those that do, only **18% resolve**,
  because the de-vig needs the same book's over AND under, non-stale.
- Fixing both *is* Phase 5's work — 5.1 (Propline alias map), 5.3 (bookmaker
  normalisation), 5.10 (stop discarding rows).
- **More importantly, 5.5, 5.6 and 5.7 change how `market_prob` is COMPUTED**,
  not just how much exists. Running Phase 4 first would fit Platt calibration
  (4.3) and set an activation gate (4.2) against a market reference Phase 5
  then changes — **both would need redoing.**
- Checked the reverse: no Phase 5 task references `market_prob`, calibration,
  CLV or any Phase 4 task. The dependency is genuinely one-way.

**5.3 first**, because book identity is what 5.5, 5.7 and 4.1's de-vig all
depend on. `game_odds_book_lines` has 33 spellings for 26 real books —
`fanduel | Fanduel | FanDuel` is three rows for one book, and
`_two_sided_devigged_for_row` matches on `bookmaker` equality, so `Fanduel`
over never pairs with `fanduel` under. **That is part of why 4.1's resolution
rate is 18%.**

Then: 5.4 (constraints) → 5.5/5.6/5.7 (the three that change the market
reference) → 5.1/5.10/5.9/5.12 (coverage) → 5.8/5.11 (guardrails) → 5.13.

**Track 4.1's coverage as a running metric while doing 5** — it is one query,
and it tells you whether Phase 4's target is reachable before Phase 4 commits
to it.

## 2a. Answered in advance — do not re-ask

Q23–Q27 are in §0's standing-decisions table with full reasoning. Summary:

| # | Decision |
|---|---|
| Q23 | CHECK-constraint violators are **quarantined, not deleted** |
| Q24 | A model losing to the market baseline is **deactivated** |
| Q25 | Keep the **validated** MLB game model, re-grade **after** a backup |
| Q26 | If coverage can't reach 50%, **proceed at the real number and state it** |
| Q27 | **Every elapsed-time requirement removed** from Phases 4 and 5 |

Also decided and flagged: **skip 5.13's `pick_history` rename** (368k rows plus
every reader, for naming clarity) and **skip 5.13's JSONB migration** (the plan
contradicts its own finding — P2 L2 says leave it).

## 2b. Task 4.7 — BUILD THESE. Operator instruction, 2026-08-29.

`player_game_history` holds nhl 674k, cfb 274k, nfl 227k, soccer_epl 168k,
soccer_mls 134k — and **zero** for MLB, NBA, golf and tennis. 4.7 says to fix
that. `backfill_player_game_history.py` has four parsers (`parse_nba`,
`parse_football`, `parse_soccer`, `parse_nhl`) configured for six sports.

**The operator has asked for all four to be built and run.** Sized against the
code, they are four very different jobs — do not treat them as one task:

**NBA — just run it.** Parser and config already exist; nothing has ever
invoked them. `python src/backfill_player_game_history.py nba`. Watch the
connection ceiling (§4) and the resume doc.

**MLB — moderate, and SMALLER than an earlier note in this file claimed.**
That note said MLB "needs a new ingestion path entirely." It does not, and the
correction matters because it changes the estimate:
`predict/statsapi.py:383`'s `get_people_with_game_logs(ids, group, season)`
already returns per-game logs, and its `GameLogSplit` (date, is_home, game_pk,
opponent_id, team_id, stat) maps almost 1:1 onto `PlayerGameHistoryInput`
(event_id ← game_pk, game_date ← date, stats ← stat). So the work is:
  1. enumerate MLB athletes per season — and per **P3 L3**, walk HISTORICAL
     rosters, not just current ones, or the table inherits the same
     survivorship bias 4.7 exists to fix;
  2. call `get_people_with_game_logs` for `hitting` and `pitching`;
  3. map `GameLogSplit` → `PlayerGameHistoryInput`;
  4. write via `db.write_player_game_history`.
It does not fit the shared ESPN discovery path the other parsers use, so it
wants its own `discover`/`parser` branch rather than another `SPORT_CONFIGS`
row.

**Golf — decide before building.** Golf already accumulates per-round and
per-hole history in `golf_hole_scores` / `golf_round_scores` / `golf_model_predictions`,
and its models read those, not `player_game_history`. Duplicating that into a
schema shaped for team sports may buy nothing. **Check whether anything would
actually consume it before writing an importer**, and if the answer is no,
record that as the outcome rather than building it anyway.

**Tennis — the genuine gap.** No per-match player-history module exists in
Python at all. This is a real new source, and it is the largest of the four.

**Suggested order: NBA (run) → MLB (build, highest value — it is where all the
graded history lives) → golf (decide) → tennis (build).** If time runs short,
stopping after MLB is the right place to stop, and say so.

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
