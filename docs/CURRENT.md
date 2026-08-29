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
   **Q1–Q36**, the G1–G8 gate) and the phase you are working. Don't read it end
   to end.
2. **§11** — the phase log. Phases 0, 1, 2, 3 have PASSED gate entries; Phase 5
   is logged task-by-task and its gate has **not** run yet.
3. **`docs/table-ownership.md`** — one row per table.
4. **`CLAUDE.md`** — "Who writes what" at the top.
5. **`docs/audit-phase-2.md` … `-5.md`** — findings, for reasoning.

**Last updated:** 2026-08-29, mid-Phase-5.
**Repo state:** clean, pushed. Worker live on `f958444`.

---

## 1. Where we are

**Phases 0, 1, 2, 3 COMPLETE — gates PASSED.**

**Phase 5: ALL 13 TASKS DONE AND COMMITTED. The GATE HAS NOT RUN.**
That is the immediate next action. Phase 4 comes after it.

Task-by-task status (all committed, all with VERIFY output in §11):

| Task | State |
|---|---|
| 5.1 Propline alias map + P2 H2 monitoring | done — one live half still pending, see §2 |
| 5.2 sharp-coverage experiment | done — number measured, decision recorded |
| 5.3 bookmaker normalisation | done — 33→22 books |
| 5.4 CHECK constraints | done — 12 constraints, 114 rows quarantined |
| 5.5 modal-point selection | done — both languages |
| 5.6 implausible-odds guard | **did not reproduce** — already fixed 2026-08-27; test added |
| 5.7 consensus excludes compared book | done |
| 5.8 `_team_match` normalisation | done — confirmed firing in production |
| 5.9 ParlayAPI soft caps | done — **behaviour change, see §3** |
| 5.10 partial results on provider failure | done |
| 5.11 config-drift test | done — proven by breaking it |
| 5.12 atomic check-and-spend | done — proven with real concurrency |
| 5.13 schema hygiene | done — plus a bug found in the pass |

## 2. THE ONE THING STILL OUTSTANDING FROM PHASE 5

**5.1's live VERIFY half cannot be confirmed until the Propline daily cap
resets (UTC midnight).**

`prop_odds` should gain Propline **batter** rows once MLB Propline runs with
the new alias map. It has not run since the fix deployed, because `propline`
sits at exactly 1000/1000 for 2026-08-29 and is correctly gated.

What IS already confirmed live:
- `odds_unresolved` is now written by the **Python** pipeline — its stale 1,317
  propline rows from 2026-08-26 were replaced after the 07:51:59 deploy. Before
  this, Python only *counted* unresolved rows and the sole writer was the
  TypeScript pipeline task 2.5 deleted.
- 5.8's aggregate log fires: `system_events` has
  `job_runner.team_match | 5 game(s) matched no provider event` at 07:54:08,
  after the deploy.

**To close it:** after 00:00 UTC, run

```sql
SELECT market_key, count(*) FROM prop_odds
 WHERE provider_id = 'propline' AND fetched_at > '2026-08-30'
 GROUP BY market_key ORDER BY 2 DESC;
```

Before the fix this returned exactly one MLB market (`pitcher-strikeouts`).
It should now return the batter markets too. If it does not, the alias map is
right (24/24 keys resolve in `test_propline_alt_lines.py`) but something
downstream of `_normalize_row` is dropping the rows — check player resolution
first, since that is the next filter in the chain.

## 3. Decisions taken this session — all recorded in §0 as Q28–Q36

Four were answered by the operator before they left; five I took myself.
Full reasoning is in §0's table. The ones with teeth:

- **Q28** — the MLB game model has NO market reference anywhere (`market_prob`
  is null on 100% of `moneyline`/`total` rows, and `game_picks` has no such
  column). Phase 4 must BUILD one before 4.2's gate can run at all.
- **Q29** — Propline budget is *added*, not reallocated. Nothing displayed is
  dropped.
- **Q33** — `model_weights.shadow` defaults **TRUE**, so 4.4 makes nothing
  newly visible.
- **5.9 IS A REAL BEHAVIOUR CHANGE.** The `PARLAYAPI_*_SOFT_CAP` vars were
  already set to **800** against a hard limit of 1000, and were being ignored.
  Wiring them lowers the ParlayAPI gate by 20%, so those jobs now stop earlier
  in the month than they did yesterday. That is what a soft cap is for and what
  the operator configured — but it is not a no-op, and if it turns out to be
  unwanted, unset the vars rather than reverting the code.

## 4. Next actions, in order

1. **Run the Phase 5 gate** — G1–G8 in §0 plus Phase 5's own gate section, in
   one sitting. Two of its phase-specific items already have runnable scripts:
   `node scripts/gate/phase-5-constraints.mjs` (every CHECK tripped
   deliberately) and `node scripts/gate/phase-5-budget-race.mjs` (the 5.12
   race, both directions). G3's live smoke walk needs `npm run dev`.
2. **Write the §11 sign-off**, including 5.1's outstanding live half in the
   "known NOT done" list — it is not a gate failure, it is a timing dependency,
   and it must be named rather than glossed.
3. **Phase 4.** Start with Q28's market reference for `game_picks`, because
   4.2, 4.3 and 4.5 are all downstream of it.
4. **4.7 is four jobs** — spec unchanged, see §5.

## 5. Task 4.7 — still four jobs, spec unchanged

`player_game_history` holds nhl 674k, cfb 274k, nfl 227k, soccer_epl 168k,
soccer_mls 134k — and **zero** for MLB, NBA, golf, tennis. Re-measured
2026-08-29, still true.

- **NBA — just run it.** Parser and config exist, nothing has ever invoked
  them: `python src/backfill_player_game_history.py nba`. 11 seasons
  (2016–2027). Watch the connection ceiling (§7).
- **MLB — moderate.** `predict/statsapi.py:383`'s
  `get_people_with_game_logs(ids, group, season)` already returns per-game
  logs and its `GameLogSplit` maps almost 1:1 onto `PlayerGameHistoryInput`.
  Walk **historical** rosters per season (P3 L3) or it inherits the
  survivorship bias 4.7 exists to fix. Wants its own `discover`/`parser`
  branch, not another `SPORT_CONFIGS` row.
- **Golf — decide before building.** Golf already keeps per-round and per-hole
  history in `golf_hole_scores`/`golf_round_scores`/`golf_model_predictions`,
  and its models read those. **Check whether anything would consume a
  `player_game_history` copy before writing an importer**, and if nothing
  would, record that as the outcome.
- **Tennis — the genuine gap.** No per-match player-history module exists in
  Python at all. Largest of the four.

Order: NBA (run) → MLB (build) → golf (decide) → tennis (build).

## 6. Things that will bite again

- **Fault injection is easy to fake — it happened AGAIN this session and the
  guard caught it.** `scripts/gate/phase-5-constraints.mjs` first reported all
  17 violations "rejected"; every one was rejected by a `NOT NULL` on
  `fetched_at`/`category`, not by any CHECK constraint. Nothing was being
  tested. Visible only because the script inserts a known-good CONTROL row per
  table first and asserts `e.constraint` equals the specific constraint under
  test. **Never accept "the operation failed" as evidence — assert WHY it
  failed.** That is now four occurrences.
- **Reverting a fix and re-running its test can prove nothing.** Reverting
  `mlb_game_lines.py` produced an ImportError, not a failure. The real
  counterfactual came from extracting the pre-fix function out of git history
  and running the same fixture through it. Do that instead.
- **The plan's own task text goes stale, and it did so three more times.**
  5.6 was already fixed. 5.1's alias table was real but incomplete, and missed
  the actual cause entirely (no `batter_*` keys in the alias map at all).
  5.4's `side IN ('over','under')` would have rejected 449 legitimate `'other'`
  rows. Measure before implementing.
- **`ADMIN_API_PREFIXES` does nothing without a `config.matcher` entry.**
  `tests/proxy-matcher.test.ts` guards it.
- **`withJobLock` is a LEASE TABLE, not an advisory lock.** Anything relying on
  session state through `:6543` is suspect.
- **Postgres UNIQUE treats NULLs as distinct.** That produced the 178k
  `prop_odds` duplicates. Worth checking other tables for the same shape.
- **A long heredoc breaks this shell.** Anything over ~120 lines fails with
  "unexpected EOF". Use the Write tool for long files.
- **`cd` persists between Bash calls.** Use absolute paths or expect confusion.
- **Git Bash `/tmp` is not Python's `/tmp`.**
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 7. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it, delete after. `:6543`
  is the transaction pooler; use `:5432` for DDL, `pg_dump`, `VACUUM`.
- **Tests:** `npm test` (**36** now) and `python -u src/test_x.py` from
  `python-odds-service/`. **13** hermetic Python tests; the 4 added this phase
  are `test_canonical_bookmaker`, `test_modal_point`,
  `test_consensus_and_matching`, `test_propline_alt_lines`. **They are not yet
  in `.github/workflows/ci.yml`** — adding them is a Phase 5 gate item.
- **No `gh` CLI and no GitHub token here.** CI via
  `https://api.github.com/repos/tysonwhitebusiness-sudo/Linesmith/actions/runs`.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no` — after any
  push touching `python-odds-service/`, POST a deploy and confirm the live
  commit. Deploys take ~90s.
- **Propline budget:** `propline` 1000/day (MLB), `propline_2` 1000/day
  (soccer) — now genuinely separate, see 5.2. **18 of ~20 authorised
  propline_2 probe calls were spent** capturing
  `docs/propline-live-capture-20260829.json`; reuse that file rather than
  re-probing.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's. Use `git add -A -- . ':!docs/discord-community-prompt.md'`.

## 8. Backup tables now outstanding

All reversible, all deliberate. Drop only once soaked:

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |

## 9. Carried forward

- **3.15 — two GET-path writers, recorded not done.** `recordEspnPregameLine`
  (CFB/NBA/Soccer game routes) and `odds_cache` (golf/odds/tennis). Python has
  no ESPN pregame-line capture, so deleting loses data for three sports.
  **Owner: still open.** Not closed by Phase 5.
- **2,380 duplicate observation groups in `game_odds_history`**, revealed (not
  created) by 5.13's canonicalisation. Deliberately not deleted. **Owner: 6.1.**
- **Sharp coverage is 9.08%**, under the plan's own 10% threshold, so a
  Pinnacle-class feed is justified by 5.2's rule. Recommendation only — nothing
  purchased. Pinnacle currently covers exactly one market of thirteen.
- **No push alerting** (Q19) — Phase 8.
- **Rate limiting is per-process and `x-forwarded-for` is spoofable** — Phase 8.
- **`/api/odds/lines` is ~1.8s median.**
- **The 1.1 backfill** of 1,209 under-side rows is still deferred.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.
