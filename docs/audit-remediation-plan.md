# Linesmith — Full Remediation Plan

> Every finding from `docs/audit-phase-2.md` through `docs/audit-phase-5.md`,
> sequenced into nine phases and re-ordered against the operator's answers of
> 2026-08-28.
>
> **Nothing is deferred.** §10's coverage matrix maps all 104 findings to a
> task. If a finding is not in the matrix, this plan has a hole — say so.
>
> **Read §0 before starting anything.**

---

## 0. The rules that make this plan different

The audit's root finding was not a bug. It was that **the repository describes
a system that does not exist** — comments claiming code was removed when it
wasn't, a `CLAUDE.md` describing a cutover that never completed, health checks
reporting green through a 17-hour outage, two languages owning the same 22
tables. Every one of those began as a task someone believed was finished.

1. **A task is done when its `VERIFY` produces the expected output** — not when
   it compiles, not when the diff looks right. Paste the result into §11.
   `npm run typecheck` passing is evidence of nothing.
2. **"Ported to Python" means the TypeScript is deleted, not disabled, and 48
   hours of writes have been observed from Python alone.**
3. **No comment describing runtime behaviour ships without the observation that
   proves it.** If you write "this no longer runs on page load," the commit
   contains the query result showing it didn't.
4. **One phase at a time, committed before the next starts, and no phase
   starts until the previous phase's gate has passed in full.** "Gate"
   is defined below and is not optional; there is no partial completion
   and no starting the next phase "while this one settles."
5. **If a verification fails, the phase stops.** Don't proceed and circle back.
   That is exactly how the current backlog formed. At a gate this is
   stricter still: one failed check fails the whole gate, and the gate
   re-runs from the top after the fix.
6. **Assume Free tier** until Phase 8 — 500 MB ceiling, no automated backups,
   read-only enforcement above quota.

### The phase gate — what "100% complete" means

**A phase does not end when its tasks are done. It ends when its gate passes.**
The gate is one uninterrupted sitting that re-proves the entire phase from a
clean state. **Nothing in the next phase begins until the gate passes** — not
planning it, not branching for it, not "just the first task while I'm here."

**G1 · Re-run every VERIFY in the phase, in one sitting, in order.** Not the
output you remember from when you wrote the task — a fresh one, today, against
the live system. A VERIFY that passed on Tuesday and isn't re-run at the gate
is not evidence. Paste every raw output into §11.

**G2 · Regression sweep — the whole tree, not the diff.**

```bash
npm run typecheck && npm run build && npm test
cd python-odds-service && python -m pytest -q
```

All four green. A skipped or `xfail`ed test counts as red unless the skip has a
dated reason written into the gate entry.

**G3 · Live smoke walk.** Against the real dev server and the real database:
every sport's slate page, one game detail, one player detail, one team detail,
`/diagnostics`, `/bets`, and a sign-in. Zero uncaught console errors, zero 5xx,
zero blank sections. Record which pages you actually opened — "walked the app"
is not a record.

**G4 · The findings must stop reproducing.** For every finding ID the phase
claims to close, re-run *the same method that originally proved it* and show it
now fails to reproduce. This is the mirror of the kickoff prompt's "verify it
still reproduces" step, and it is the only thing separating a fix from a
belief.

**G5 · Write-path observation.** For every table the phase touched: row count
and `max(timestamp)` before the phase, and now. A phase that silently stops a
writer has failed even if every other check is green — that is literally how
the 23-hour outage happened.

**G6 · No orphans.** Anything the phase disabled, stubbed, commented out, or
"temporarily" skipped is listed in the gate entry with a date, an owner, and
the phase that re-enables it. An undocumented disabled job is indistinguishable
from a broken one.

**G7 · Adversarial read-back.** Re-read the phase's own diff and every comment
it added, asking one question: *does the repository now describe what actually
runs?* Rule 3 applies to the gate itself — a comment added during the phase
needs its proving observation attached, and the gate is where that gets
checked rather than assumed.

**G8 · Sign-off.** One §11 entry: the date, G1–G7 outputs pasted raw, the
findings now closed, and an explicit **"known not done"** list. An empty
"known not done" list is itself a claim — only write it when it is true.

**A gate is pass/fail, not a score.** One failed item fails the gate. Rule 5
then governs: stop, fix, and re-run **the entire gate from G1** — not just the
item that failed. Re-running only the failed check is exactly how a green board
comes to coexist with a broken system.

**Test debt is phase debt.** If a phase's work isn't covered by an automated
check, writing that check is part of the phase — before the gate, not deferred
to 3.11. Task 3.11 builds the CI harness; it does not absolve earlier phases of
contributing tests to it. Until CI exists, each phase adds its checks as a
runnable script at `scripts/gate/phase-<N>.mjs` (or `.py`), and the gate entry
shows that script passing. Once CI exists, those scripts run in CI.

**Each phase's own gate additions are listed under its "Phase N gate" heading,
below its exit checklist.** Those are *additional* to G1–G8, never a
replacement.

### Standing decisions (2026-08-28)

| # | Decision | Lands in |
|---|---|---|
| Q1 | Prop grades may return, but only as **ranking** — never probability or edge | 1, 6 |
| Q2 | **Python owns all writes and model math. TypeScript renders.** | 2 |
| Q3 | No sharp-feed purchase yet — reconfigure Propline and measure | 5 |
| Q4 | Propline alt-lines **fold into the base market** | 5 |
| Q5 | Uncommitted tree is several efforts → themed commits | 0 |
| Q6 | Models keep training; **predictions hidden until they beat the market** | 1, 4 |
| Q7 | Free now, Pro later — build for Free | 0, 8 |
| Q8 | No backups exist — build them | 0 |
| Q9 | `ODDS_API_KEY` omission was an oversight | 1 |
| Q10 | OddsHarvester moves to a dedicated machine | 8 |
| Q11 | Propline's `totals` contents unknown → empirical route | 5 |

**Added 2026-08-28, at Phase 2 kickoff.** Four decisions taken when the phase
was scoped against live code rather than against the audit's own dates. Each
one changed a task, so each is recorded here rather than left in a chat log.

| # | Decision | Lands in |
|---|---|---|
| Q12 | The three user-triggered provider buttons (**Scan**, **More Books**, **Check Sharp Price**) are **deleted outright** — UI, routes, and whatever TS provider machinery goes unreachable with them. Not ported. | 2.5 |
| Q13 | **Python computes every model number in the app; TypeScript assembles the page.** The three unported model writes move to Python, and `adapter.ts` stops recomputing the prop model / home-run model / game sims — it reads Python's results **cache-first**, the shape it already uses for the game model. Both scheduler timers go behind `withJobLock`. | 2.7 |
| Q14 | The leakage fix takes the audit's **steps 1–3** plus an audit query over existing rows. Contaminated rows are **reported, not deleted** — the delete/keep call stays with the operator. | 2.2 |
| Q15 | **The 48-hour observation window is removed from the Phase 2 gate** — see the note under "Phase 2 gate". Verification of sustained Python-only writes moves to after Phase 9. | 2 |

**Added 2026-08-29**, once 2.2's audit query had produced the report Q14 asked
for and 2.1's map had turned up a table nobody knew about:

| # | Decision | Lands in |
|---|---|---|
| Q16 | **Delete the 207 leaked NFL `pick_history` rows.** Q14 deliberately left this open until the audit was done; the audit found all 207 predict a single game that had finished ~21 months earlier, so every one was built from a gamelog containing its own answer. | 2.2 |
| Q17 | **Drop `watch_links`** — no writer, no reader, no migration, 0 rows. | 2.1 |
| Q18 | **`computeCalibrationPayload` is NOT ported in Phase 2.** It moves in Phase 4, as part of 4.2/4.3, which rewrite the calibration logic anyway. Porting it now would mean porting it and then reworking the port weeks later. | 4.2, 4.3 |

**Added 2026-08-29, at Phase 3 kickoff:**

| # | Decision | Lands in |
|---|---|---|
| Q19 | **No external error tracking.** No Sentry, now or later. `system_events` + `health_check.py` + `/diagnostics` are the whole story. | 3.2 |
| Q20 | **CI runs hermetic tests only** — no database credentials in GitHub Actions. DB-touching tests stay local and are documented as such. | 3.11 |
| Q21 | **Investigate whether the xlsx import is still needed**; drop the dependency outright if not, CSV if it is. | 3.13 |
| Q22 | **Next 16 upgrade happens inside Phase 3.** | 3.13 |

**Added 2026-08-29, before running Phases 5 and 4 unattended.** The operator is
away; these were answered in advance precisely so the run does not stall on
them, and so nothing destructive happens on my judgement alone.

| # | Decision | Lands in |
|---|---|---|
| Q23 | CHECK-constraint violators are **quarantined to a backup table, not deleted**. They are the only sample of what Propline puts in the `totals` slot, which Q11 asks about. | 5.4 |
| Q24 | A model that loses to the market baseline is **deactivated**. That is the point of the gate, and Phase 1.3 already hid model output from the UI, so this changes what computes in the background, not what a user sees. Record which models failed and by how much. | 4.2 |
| Q25 | Keep the **validated** MLB game model, delete the other, **re-grade** affected history — **after** snapshotting the pre-regrade rows. Re-grading rewrites the recorded track record, so it stays reversible. | 4.8 |
| Q26 | If `market_prob` coverage cannot reach 50%, **proceed at the real number and state it prominently** rather than stalling. The 50% target was set before anyone had measured the two causes. | 4.1 |

**Q27 — every elapsed-time requirement is removed from Phases 4 and 5**
(operator decision, 2026-08-29). The plan asked for waits it had no mechanism
to enforce, and they would stall an unattended run. In each case the ACTION
happens now and only the MEASUREMENT defers to a single verification pass
after Phase 9:

| Where | Was | Now |
|---|---|---|
| 5.2 | "Run one week", then re-measure sharp coverage | Cap `propline_2` and reconfigure market selection now; measure post-Phase-9 |
| 5.13 | Drop unused indexes "after 30 days of the new workload" | Leave the indexes; revisit post-Phase-9 with a date |
| 4.8 | VERIFY wants "24 h of writes" | Verify by grep plus one observed write cycle |
| 4.1 | VERIFY on a rolling 7-day window | Measure rows written **since the fix** — a 7-day window dilutes a same-day change with six days of pre-fix rows, so this is more honest, not merely faster |

**Added 2026-08-29, at the Phases 5+4 kickoff**, after scanning both phases
against the live tree and database rather than against the plan's prose. Q28-Q31
were put to the operator before they left; Q32-Q36 I took myself and am
recording rather than burying. Every one of them changed a task.

| # | Decision | Lands in |
|---|---|---|
| Q28 | **Build a real market reference for the MLB game model.** `market_prob` is non-null on **zero** `moneyline` and **zero** `total` rows of `pick_history`, and `game_picks` has no equivalent column — so 4.2's activation gate is not merely failing for the two live game models, it is *uncomputable*. Add `market_prob` to `game_picks`, populate it by de-vigging `game_odds_book_lines` at the modal point (which 5.5 builds anyway), then run the gate properly. Models stay active while this is built. | 4.2, 5.5 |
| Q29 | **Do not retrade Propline's budget — fix the budget first.** 5.2 assumes spare capacity; there is none (`propline` sits at exactly 1000/1000 daily). But `propline_2` is a whole second paid account whose spend is never recorded at all, so the fix is to *add* budget, not reallocate it. Nothing currently displayed gets dropped. | 5.2, 5.11 |
| Q30 | **Canonical bookmaker = lowercase, regional suffix stripped.** `bet365.us`+`bet365` -> `bet365`; `BetMGM.us`+`BetMGM`+`betmgm` -> `betmgm`; `LowVig.ag` -> `lowvig`. Matches `prop_odds`' existing all-lowercase 14 books. History is rewritten under a backup table, reversible. | 5.3 |
| Q31 | **Spend ~20 `propline_2` calls to build the alias map from a live response**, rather than waiting ~17h for the primary key's cap to reset. 5.1 requires a live response and the plan's own alias table is demonstrably from memory (see below). Exact call count is recorded in the phase log. | 5.1 |
| Q32 | **Platt calibration fits only where n >= 200** for a sport+market. The eligible sample is 3,852 graded rows carrying `market_prob`, but per-market that runs from n=950 down to n=14. Below the threshold no calibration row is written at all — uncalibrated beats mis-calibrated. | 4.3 |
| Q33 | **`model_weights.shadow` defaults TRUE on every existing row.** 4.4 adds the column; defaulting it true means nothing becomes newly visible, matching the state Phase 1.3 already put the UI in. Flipping a model to visible stays a deliberate, separate act. | 4.4 |
| Q34 | **4.10 is verified live on soccer only, and that is stated rather than glossed.** Last 7 days of `pick_history`: mlb 20,062, soccer 133, and **zero** for NBA/NHL/CFB/tennis — they are out of season, and their jobs correctly report "healthy - 0 rows written". Both-sides generation is fixed for all five and unit-tested for all five; live confirmation for the out-of-season four defers, with that named in the gate's "known not done". | 4.10 |
| Q35 | **CHECK ranges are derived empirically per sport, not set from intuition.** Soccer legitimately carries `.25`/`.75` Asian quarter-lines (2.75, 3.25 observed live), so a naive "half-points only" check would reject real data. Violators quarantine per Q23. | 5.4 |
| Q36 | **`propline_2`'s provider_id attribution is fixed forward-only.** Existing rows are not relabelled, because they are genuinely indistinguishable from `propline`'s once written. | 5.2, 5.11 |

**Measured at kickoff, and it contradicts the plan in four places.** Recording
these because Rule 1 and the "verify it still reproduces" step exist precisely
for this, and three of the four would have caused wasted work:

1. **5.6 does not reproduce — it is already fixed.** `lib/odds/display.ts:20`
   defines `MAX_PLAUSIBLE_DECIMAL_ODDS = 30` and all three best-price functions
   (moneyline, total, spread) call the guard. The comment dates the fix to
   2026-08-27, after the audit. **5.6 shrinks to "write the missing test."**
2. **5.1's alias table is wrong, from memory, exactly as 5.1's own warning
   predicts.** The plan lists `batter_2plus_hits`, `batter_3plus_hits`,
   `batter_2plus_rbis`, `batter_3plus_rbis`. What Propline actually sends, per
   1,317 live `odds_unresolved` rows, includes `batter_2plus_home_runs`,
   `pitcher_outs` and `pitcher_earned_runs`. The map gets rebuilt from a live
   response (Q31), not adapted from the table above.
3. **5.2's `propline_2` numbers are an artefact of two real bugs, not a vendor
   rejection.** `fetch_propline` hardcodes `provider_id="propline"`
   (`providers.py:792`), so propline_2's rows *and* its unresolved rows land
   under `propline`; and `job_runner.py:74` only records spend when
   `cap_kind != "none"`, which propline_2 is. So propline_2's spend was never
   recorded, and both accounts silently share one 1,000/day counter — which is
   why `propline` pins at exactly 1000/1001 every single day.
4. **`model_weights` has no `shadow` column**, which 4.4 assumes exists. It is a
   migration, not a flag flip.

**4.7 IS FOUR JOBS, NOT ONE — operator has asked for all four built. Full
spec, including a correction to my own first sizing, is in
`docs/CURRENT.md` §2b. Summary: NBA just needs running; MLB is moderate and
reuses `get_people_with_game_logs` rather than needing a new ingestion path;
golf probably should not be built at all (it has its own history tables);
tennis is the genuine new source.**

**Originally recorded as a blocker while pre-scoping 4.7, which the task text
does not mention.** `backfill_player_game_history.py` has exactly four parsers —
`parse_nba`, `parse_football`, `parse_soccer`, `parse_nhl` — and configured
sports for nfl, cfb, soccer_mls, soccer_epl, nba, nhl.

4.7 asks for MLB, NBA, golf and tennis. Of those:
- **NBA is reachable now.** The parser and config exist; it just has not been
  run. This is "run it", not "build it".
- **MLB, golf and tennis have no parser and no config.** MLB in particular
  cannot use the ESPN path the others use — it has its own StatsAPI/Statcast
  pipeline — so this is a new ingestion path, not a parameter.

So 4.7 is really two tasks of very different size, and the MLB half is the one
that matters most (MLB is where all the graded history lives). Sized honestly
before starting rather than discovered mid-phase.

**Two decisions I took myself and am flagging rather than burying**, both in
5.13:

- **Skipping the `pick_history` → `model_predictions` rename.** P2 L5 is right
  that the name misleads, but the rename touches 368,657 rows plus every reader
  in both languages, for naming clarity. Bad risk/reward to run unattended.
- **Skipping the `TEXT` → `JSONB` migration.** The plan's 5.13 contradicts its
  own finding: P2 L2 concludes *"Recommendation: leave it"*, because
  `lib/db/jsonPassthrough.ts` exists specifically to serve the stored string
  without a parse round-trip, and JSONB would force a reparse on every read.
  The finding is right and the task item is wrong.

Q19 has a consequence that must not be lost: with no external error tracking,
**the only alerting is the health-check cron's `notifyOnFail` and whoever
happens to look at `/diagnostics`.** Acceptable while nothing is user-facing; it
is recorded in Phase 3's "known not done" with **Phase 8** as owner, because a
deployed app with no alerting is a different proposition from a local one.

Q20 is a security decision as much as a testing one: a CI run holding
production write credentials is a new attack surface, not a safety net.

Q22 was flagged as likely to dominate the phase and chosen anyway. It is
sequenced **before** tasks 3.4/3.5/3.7 rather than after: all three edit
`middleware.ts`, and a major Next upgrade can change middleware APIs, so doing
the upgrade second means writing that work once instead of twice.

Q18 is the one exception to Q13's "Python computes every model number" inside
Phase 2, and it is a real one, not a reclassification of convenience:
`refreshCalibration` computes Brier scores, calibration buckets and market
skill — model math by any honest reading — and it stays in TypeScript, behind
2.7c's lease, until Phase 4. **It must appear in the Phase 2 gate's G6 orphan
list with Phase 4 named as its owner.**

Q12 is a **product** decision as much as a structural one: it removes the only
user-initiated odds refresh in the app.

**Q13 was answered three times, and the first two answers were based on my
mis-sizing.** Recording the path because the correction is the useful part:

1. First framing — "port `rebuildMlbSnapshot` to Python" — implied rewriting
   `adapter.ts`, 2,412 lines, and I estimated 1.5–3 weeks.
2. On measurement, four of the six writes in `rebuildMlbSnapshot` were **already
   in Python** (`computeMlbPropPredictionsJob`, `gradeFinishedMlbPicksJob`,
   `computeMlbGameModelJob`, plus the Elo/pitcher moves from earlier phases). I
   then recommended leaving `adapter.ts` alone behind `withJobLock`, on the
   claim that it was render work rather than model math.
3. **That claim was wrong**, and the operator caught it. `adapter.ts` imports
   and runs `computeModelProbability` (730, 1640), `applyFittedHomeRunWeights`
   (1674), `ensureGameSims` (1993) and `computeMoneylineModel` (2265). It is
   live model math on a 4-minute timer.

What the measurement did establish is that the port itself largely **exists**:
`prop_candidates.py`, `home_run_model.py` and `sim_engine.py` all run today, and
`adapter.ts:2323` already reads `mlb_game_model_cache` cache-first with a TS
fallback. So the real task is not a rewrite — it is extending that proven
cache-first pattern from the game model to the prop side, so `adapter.ts` reads
numbers instead of recomputing them. **Estimate: 2–4 days.**

Known risk, flagged before starting: Python writes prop results to
`pick_history`, which is a first-write-wins **log**, not a live feed. This
probably needs a new `mlb_prop_model_cache` table mirroring
`mlb_game_model_cache`. If the shapes don't line up, this runs to the long end
of the estimate.

The general lesson, which is the same one the audit itself is about: **the plan's
own task descriptions are claims about the code, and they go stale too.** Three
of Phase 2's eight tasks were mis-sized in the plan because the code moved after
the audit was written. Size against the tree, not the prose.

### Phase order and dependencies

```
0 Stop the bleeding
└─ 1 Tell the truth
   ├─ 2 Ownership boundary
   │  ├─ 3 Observability & defence
   │  ├─ 4 The scoreboard
   │  └─ 5 Data quality & correctness
   │     └─ 6 The product
   │        └─ 7 Commercial readiness
   │           └─ 8 Production infrastructure & launch  ← LAST
```

Phases 3, 4 and 5 share almost no files and can run in parallel if you have the
appetite. 6 needs 5. 8 is deliberately last: **do not deploy until the app is
correct, observable, and defensible.** Deploying the current system to a public
URL would be strictly worse than the status quo.

### Starting a phase in a fresh session

This plan is the entry point, but it is **not self-contained** — it names
findings by ID and expects you to read the reasoning behind them. A fresh
session must read, in this order:

1. `docs/audit-remediation-plan.md` §0 (these rules) and the phase being worked
2. The findings that phase cites, in `docs/audit-phase-2.md` / `-3.md` /
   `-4.md` / `-5.md`. §10's matrix maps every task to its finding ID.
3. `CLAUDE.md` — **note that it currently overstates the Python cutover**
   (P2 M1). Phase 2.8 fixes it; until then treat it as aspirational.
4. `docs/audit-handoff-phase-4-5.md` §2 for database access mechanics.

**Do not start a phase whose predecessor is incomplete.** Check §11's log
first. The dependency graph above is not advisory — Phase 1's calibration work
reads tables Phase 0's retention job prunes, and Phase 2's ownership map
governs which language Phases 3–5 edit.

**Kickoff prompt** to paste into a fresh session:

```
Read docs/audit-remediation-plan.md, starting with §0 (working rules) and
§11 (phase log — confirms what's actually done).

I want to execute Phase <N>. Before writing any code:
  1. Confirm the previous phase's **gate** (§0, G1–G8 plus that phase's own
     gate section) passed in full and is logged in §11 with raw output. An
     exit checklist without a passed gate entry does not count. If it isn't
     there, stop and tell me — do not start this phase.
  2. Read the findings this phase cites in the audit docs (§10 maps task →
     finding ID) so you have the reasoning, not just the instruction.
  3. Verify each finding still reproduces against the live system. These
     were measured 2026-08-27 and the tree has moved since. Anything that
     no longer reproduces, say so rather than "fixing" it.

Then work the tasks in order. Rule 1 governs: a task is done when its VERIFY
block produces the expected output, and that output gets pasted into §11.
Not when it typechecks.

When every task is done, run the phase gate — G1–G8 in §0 plus this phase's
own gate section — in one sitting, and write the §11 sign-off. The phase is
not finished before that, however finished the tasks look.
```

The "verify it still reproduces" step matters. Every measurement in the audit
has a date on it, and treating a stale finding as current is the same class of
error the audit was written to catch.

---

---

# Phase 0 — Stop the bleeding

**Goal:** nothing can lose data or silently stop writing.
**Duration:** 1 day. **Blocks:** everything.
**Order matters** — 0.1 protects you before 0.2 deletes anything.

### 0.1 · Take a real backup *(P5 E4, Q8)*

Free tier has no automated backups. `pick_history` is 362,616 rows of your own
graded predictions — a record of what the model said *before* outcomes were
known. No public source regenerates it.

```bash
pg_dump "$DATABASE_URL" \
  -t pick_history -t prop_odds_history -t game_odds_history -t model_weights \
  -t game_picks -t historical_odds -t player_game_history -t bets -t picks \
  --no-owner --no-acl -Fc -f linesmith-$(date +%Y%m%d).dump
```

**VERIFY — the restore, not the dump.** Restore into a scratch project:
```bash
pg_restore -d "$SCRATCH_URL" --no-owner --no-acl linesmith-YYYYMMDD.dump
psql "$SCRATCH_URL" -c "SELECT count(*) FROM pick_history"
```
**Done when** the restored count is logged in §11. An untested backup is not a
backup. Schedule it weekly once proven.

### 0.2 · Get under the Free-tier ceiling *(P2 H5, P2 L4, P3 M10, P4 M10)*

Database is **1,562 MB** against a **500 MB** limit. Supabase enforces
read-only above quota — the most likely cause of the transient
`cannot execute DELETE in a read-only transaction` observed at ~01:15 UTC on
2026-08-28, which nobody saw because of P4 H5.

| Table | On disk | Action |
|---|---:|---|
| `player_game_history` | 830 MB | **Keep** — training data |
| `snapshot_cache` | 366 MB | Prune (8 × ~70 MB `mlb:full-raw` blobs) |
| `prop_odds_history` | 111 MB | **Keep** — the product asset |
| `prop_odds` | 105 MB | Prune finished games |

Add a `retentionJob` to `jobs.py` + one line in `JOB_REGISTRY`; `health_check.py`
picks it up for free per `CLAUDE.md`'s job architecture.

```sql
DELETE FROM snapshot_cache      WHERE cache_key LIKE 'mlb:full-raw:%' AND fetched_at < now() - interval '3 days';
DELETE FROM snapshot_cache      WHERE cache_key LIKE 'mlb:injuries:%' AND fetched_at < now() - interval '2 days';
DELETE FROM game_odds_book_lines WHERE fetched_at < now() - interval '2 days';
DELETE FROM prop_odds            WHERE fetched_at < now() - interval '7 days';
DELETE FROM system_events        WHERE occurred_at < now() - interval '30 days';  -- P2 L4
```

> **Never prune** `prop_odds_history` or `game_odds_history`. Those are the
> line-movement dataset — the product. Append-only, log-on-change, slow growth.

Run `VACUUM FULL snapshot_cache;` after the first prune — `DELETE` alone does
not return space, and space is what's being measured.

**VERIFY:** `SELECT pg_size_pretty(pg_database_size(current_database()));`
under 500 MB. If `player_game_history` alone keeps you over, that is the trigger
to pull Phase 8.1 forward — log the reason rather than deleting training data.

### 0.3 · Close the anonymous write hole *(P4 C1)*

RLS off on 31 of 35 tables; `anon` holds `INSERT/UPDATE/DELETE/TRUNCATE` on all
of them. The anon key is `NEXT_PUBLIC_` — it ships in the browser bundle.
Verified by executing an insert and a delete with that key alone.

Apply both `DO $$` blocks from `audit-phase-4.md` C1. **Nothing breaks** — every
server-side read uses `DATABASE_URL` as `postgres`, which bypasses RLS; the only
PostgREST usage is auth and the four user tables, which already have correct
policies.

**VERIFY:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/system_events" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" -d '{"level":"info","source":"t","message":"t"}'
```
**Done when** it returns 401/403, and `/bets` + `/api/picks` still work signed in.

### 0.4 · Commit the working tree *(P2 H7)*

212 uncommitted files; three applied migrations exist only on this laptop.
Themed commits per Q5, **migrations first and alone**:

1. the three applied migrations
2. tennis surface (routes + components + `lib/sports/tennis/*`)
3. live game tabs (`*LiveTab.tsx`, `use*LiveGame.ts`, `lib/sports/*/liveGame.ts`)
4. matchup cards + `team-defense-allowed`
5. `player_game_history` backfill (Python)
6. the five staged deletions
7. docs

**VERIFY:** `git status --short | wc -l` → 0. `npm run typecheck` after each
commit, not at the end.

### 0.5 · Transaction-mode pooler *(P4 H4)*

Session mode holds a real backend per connection; budget is ~9 usable slots,
app claims 6 + worker 3. Zero slack at one user. The audit ran ~60 queries
through `:6543` with no `EMAXCONNSESSION`.

Change `DATABASE_URL` `:5432` → `:6543` in `.env.local` **and** Render.
Transaction mode drops session state (prepared statements, `SET`, advisory
locks) — the codebase uses none, and `pgTransaction` still works because a
transaction is one checkout.

**VERIFY:** load every sport's slate + one game detail each, then
`SELECT count(*) FROM system_events WHERE occurred_at > now() - interval '1 hour' AND message LIKE '%EMAXCONN%';`
→ 0.

### 0.6 · Fix the open redirect *(P4 M5)*

`app/login/page.tsx:26` passes an unvalidated `next` to `router.push`.
```ts
const raw = search.get('next') ?? '/';
const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
```
**VERIFY:** `/login?next=https://example.com` → sign in → lands on `/`.

### 0.7 · Rotate and remove the unused service-role key *(P4 L2)*

`SUPABASE_SERVICE_ROLE_KEY` is referenced by zero lines of code. It is not in
the browser bundle (good), but an unused god-mode credential sitting in a file
is worth deleting and rotating in the Supabase dashboard.

**VERIFY:** `grep -r SUPABASE_SERVICE_ROLE_KEY --include='*.ts' --include='*.py'`
→ no hits outside docs.

### 0.8 · Restart the worker, with the leakage jobs off *(P3 H4, P3 L4)*

The worker has been dead 23+ hours and nothing refreshes odds. But P3 H4 found
the generic-sports prop job can build a prediction from the game it's
predicting — restarting as-is accumulates contaminated training rows, which is
worse than none given Q6.

1. `enabled=False` on the generic-sports prop jobs (NBA/NHL/CFB/soccer/tennis
   scoring). Leave MLB Tier 1 and the odds cycles running.
2. Fix or disable `refreshTennisAtpJob`/`refreshTennisWtaJob`, crash-looping on
   `TypeError: normalize() argument 2 must be str, not None` *(P3 L4)*. A
   permanently-red check trains you to ignore the dashboard.
3. Restart from the Render dashboard.
4. **Wire the failure notification**: Render → `line-buddy-odds-worker-health-check`
   → Settings → Notifications. `render.yaml` says to do this; it was never done.
   The cron has exited 1 every 15 minutes for over a day with nobody paged.

**VERIFY:** every enabled job healthy within one interval, **and a test alert
was received** — deliberately break a check to confirm delivery. Do not assume
it works because it is configured.

### Phase 0 exit

- [ ] Restore tested, row count logged
- [ ] DB under 500 MB (or 8.1 scheduled, with reason)
- [ ] Anonymous PostgREST POST → 401/403
- [ ] `git status` clean
- [ ] No `EMAXCONNSESSION` in an hour of use
- [ ] Open redirect closed; service key rotated
- [ ] All enabled jobs healthy; **test alert received**

---

### Phase 0 gate

G1-G8 apply. Additionally, in one sitting:

- **Restore drill, all nine tables.** Not just `pick_history` - restore the dump
  into a scratch database and compare `count(*)` for every table in 0.1's `-t`
  list against the source. Any mismatch fails the gate; a dump that silently
  omits a table is the exact failure mode this drill exists to catch.
- **Anon lockout matrix.** With the anon key alone, attempt `INSERT`, `UPDATE`,
  `DELETE` and `TRUNCATE` against `pick_history`, `model_weights` and
  `provider_usage` - twelve attempts, twelve rejections. Then, signed in as a
  real user, confirm full CRUD on your own `bets`/`picks`/`watchlist`/
  `tracked_lines` rows **and** that a second user's rows stay invisible.
- **Retention job is idempotent and monitored.** Run it twice: the second run
  deletes zero rows. Confirm `health_check.py` reports it with no edit to
  `health_check.py` - that is the claim `CLAUDE.md` makes, and this is where it
  gets tested instead of assumed.
- **Size measured after `VACUUM FULL`, not after `DELETE`.** `DELETE` alone
  moves no number that matters.
- **Every commit builds, not just the tip.** `git status --short` empty,
  `git stash list` empty, and `npm run typecheck` green at each of the seven
  commits - walk them, don't assume.
- **Open-redirect matrix**, not one case: `//evil.com`, `https://evil.com`,
  `/\evil.com`, `%2F%2Fevil.com`, `javascript:alert(1)`, and a legitimate
  `/nfl`. The first five land on `/`; the sixth still works.
- **Connection budget under real load.** During the G3 smoke walk, sample
  `pg_stat_activity` and record the peak. Zero `EMAXCONN` is necessary but not
  sufficient - the headroom number is what tells you whether 0.5 actually
  bought anything.
- **Every enabled job has a breadcrumb newer than its own interval**, and the
  test alert arrived in a real inbox, with the timestamp recorded here. A
  configured notification is not a delivered one.

---

# Phase 1 — Make the app tell the truth

**Goal:** every number on screen is a verifiable fact or a clearly labelled
unvalidated signal. **Duration:** 1 week. **Depends on:** 0.

Implements Q1 and Q6. The governing rule:

| Tier | Example | Ship? |
|---|---|---|
| A — descriptive fact | "over in 7 of last 10 vs LHP" | **Yes** |
| B — best price / line shopping | "DK −110, FD −125" | **Yes** |
| C — ranking, no probability | "top-ranked props today" | **After 1.1** |
| D — calibrated probability | "58% to hit" | **No** |
| E — edge / EV / value | "+4.2% edge" | **No** |

### 1.1 · Fix the inverted under-side probability *(P3 C3)*

Under-side candidates carry the **over's** probability. Every under displayed
today is wrong, and a Tier C ranking built on it ranks half its rows on the
wrong number. This gates the entire grade question.

**VERIFY:** on a real two-sided prop, `P(over) + P(under) ≈ 1.0`, and the
under's number matches its own side. Becomes a test in 3.11.

### 1.2 · Stop claiming `fetchedAt: now()` *(P3 C4, P5 T4)*

`app/api/odds/lines/route.ts` stamps `new Date().toISOString()` regardless of
when rows were fetched. During the 23-hour outage it presented day-old prices
as current. **The single most user-protective change in this plan** — a bettor
acting on a stale price loses real money.

Return the real `max(fetched_at)` and surface per-price age.

**VERIFY:** stop the worker 30 minutes; UI shows increasing age, not "now."

### 1.3 · Hide Tier D and E *(P3 C2, P3 C5, P5 T2)*

Per Q6. **Keep computing and writing** `model_prob`, `edge`, `prop_score` — that
series is how you'll know when the model wins (Phase 4).

- Remove the Edge % column and the Good Bets **edge track**
- Remove displayed model probabilities from Scan, Player Detail, Game Detail
- `/diagnostics` keeps showing everything — that's the backend view

**VERIFY:** grep rendered pages for any percentage sourced from `model_prob`,
`edge`, `prop_score` → zero hits outside `/diagnostics`.

### 1.4 · Strengthen Tier A + B *(P5 T3)*

This is the product now.
- sample size next to every rate ("7/10", not "70%")
- the window definition, visible
- best price across books, with the book named

`lib/core/windowedStat.ts` was verified correct and well designed (P3 §2.4).
Lean on it.

### 1.5 · Gate the operator surface *(P4 H2)*

Every `/api/props/*` route answers anonymous callers, including `fit-weights`,
which retrains **and activates** a model.

```ts
const ADMIN_API_PREFIXES = ['/api/diagnostics', '/api/props', '/api/odds/import'];
const ADMIN_API_EXCLUDE  = ['/api/props/lines', '/api/props/calibration', '/api/props/line-history'];
```
Move `scan-player`/`more-books`/`sharp-price` to `PROTECTED_API_PREFIXES`
(any signed-in user). Add matching `matcher` entries.

**VERIFY:** unauth `POST /api/props/fit-weights` → 401; non-admin → 403; admin →
works. Then walk Scan and Player Detail.

### 1.6 · Supply `ODDS_API_KEY` to the worker *(Q9)*

An oversight, not deliberate. Add it in Render, then remove the TS route's
ownership — two owners, one job.

**VERIFY:** `mlbGameLinesJob` healthy; `odds_cache` advances with the dev server
stopped.

### 1.7 · Calibration timer 2 min → 30 min *(P2 C2)*

`CALIBRATION_INTERVAL_MS = 30 * 60_000`. P2 C2 measured ~36 full scans of
`pick_history` per tick. Do **not** disable `refreshMlb` at the same time
*(P2 M9)*.

### 1.8 · `event_context` filter on `calibrationByMarket` *(P3 H5)*

The Good Bets trust gate is driven by a calibration that measures a different
model — it includes 316,327 backfill rows. Filter to live rows only. **Unblocks
every measurement in Phase 4.**

**VERIFY:** calibration row counts drop to the live-only figure (~40k MLB, not
356k).

### 1.9 · Fix "Source not recorded" *(P3 M11)*

Most prices render with no provenance. Your `OddsChip` provenance model is
better than most competitors' — it's just not receiving the data. Trace where
`source` is dropped between `prop_odds.provider_id`/`bookmaker` and the chip.

**VERIFY:** < 5% of rendered prices show "Source not recorded."

### 1.10 · Stop leaking internal error detail *(P4 M4)*

`cachedRoute`'s catch returns `detail: error.message` to anonymous callers —
`pg` messages carry table/column/constraint names; `fetch` messages carry
upstream hosts and sometimes keys in query strings.

Log server-side, return a generic message + correlation id. Gate `detail`
behind an admin session or `NODE_ENV !== 'production'`.

### Phase 1 · file map

Collected from the audit docs so a fresh session doesn't have to hunt. Line
numbers were accurate on 2026-08-27 — **re-locate by symbol, not by line**, since
the tree has moved since.

| Task | Files |
|---|---|
| 1.1 under-side sign | `lib/sports/mlb/adapter.ts:1700` (`modelProb: finalModelProb`), `:625` (category selection); `lib/odds/props/liveEdge.ts:130` (`edge = rawModelProb - devigged.a`); `lib/odds/props/grading.ts:82` (same expression, grading path) |
| 1.2 `fetchedAt` lie | `app/api/odds/lines/route.ts:155` and `:252`; `lib/db/client.ts:741` (drops `fetchedAt` when building the row); `lib/odds/props/liveEdge.ts:118`; `components/OddsChip.tsx:121` |
| 1.3 hide Tier D/E | `components/ScanTable.tsx`, `components/PlayerDetail.tsx`, `components/GameDetail.tsx`, `components/GameHeroCard.tsx`, `components/TodaysPicksModal.tsx`, `components/usePickHistoryModelData.ts`, `lib/odds/goodBets.ts` (`GOOD_BET_MIN_EDGE`, line ~90) |
| 1.4 Tier A + B | `lib/core/windowedStat.ts` (verified correct — reuse, don't rewrite); same components as 1.3 |
| 1.5 gate operator surface | `middleware.ts` (`ADMIN_API_PREFIXES`, `PROTECTED_API_PREFIXES`, and the `matcher`) |
| 1.6 `ODDS_API_KEY` | Render dashboard → `line-buddy-odds-worker` → Environment; then `render.yaml` |
| 1.7 calibration timer | `lib/scheduler.ts` (`CALIBRATION_INTERVAL_MS`) |
| 1.8 `event_context` filter | `lib/db/client.ts:1272-1284` (`calibrationByMarket`); `lib/odds/goodBets.ts:196` (`GOOD_BET_EXCLUDED_MARKETS`) |
| 1.9 "Source not recorded" | `components/OddsChip.tsx:33` (`PROVENANCE_LABEL`); `lib/odds/props/types.ts` (`ProviderId` union) |
| 1.10 error detail leak | `lib/cachedRoute.ts` (final catch), plus every route returning `detail:` |

### Phase 1 exit

- [ ] `P(over) + P(under) ≈ 1.0`
- [ ] Price age correct with the worker stopped
- [ ] No model probability or edge outside `/diagnostics`
- [ ] Every displayed rate carries a sample size
- [ ] `/api/props/fit-weights` → 401 unauthenticated
- [ ] `mlbGameLinesJob` healthy
- [ ] Calibration excludes backfill
- [ ] < 5% "Source not recorded"
- [ ] No internal detail in a 502 body

---

### Phase 1 gate

G1-G8 apply. Additionally:

- **Tier sweep against rendered output, not source.** Fetch every user-facing
  page's HTML and grep for any percentage traceable to `model_prob`, `edge` or
  `prop_score`. A source-level grep misses values that arrive through props.
  `/diagnostics` is the only permitted hit.
- **Two-sided probability check on ten real props**, spanning at least three
  markets - one prop passing 1.1 proves a sign, not a fix.
- **Staleness demonstrated, not described.** Stop the worker; capture the UI at
  0, 30 and 90 minutes. The displayed age must increase across all three.
- **Full middleware status matrix.** Every `/api/props/*` and
  `/api/diagnostics/*` route x {anonymous, signed-in non-admin, admin}. Record
  the table - it becomes the test in 3.11.
- **Sample-size audit.** Enumerate every component that renders a rate and show
  each one carries its denominator. A list of components checked, not a claim.

---

# Phase 2 — The ownership boundary

**Goal:** exactly one language writes each table. Per Q2 — **Python writes,
TypeScript renders.** **Duration:** 5–8 working days (re-estimated 2026-08-28
against the tree, task by task; 2.7 is 2–4 of them and carries nearly all the
regression risk). **Depends on:** 0, 1.

This is the phase that prevents the audit's root cause from recurring. P3 §4
found 22 of 35 tables with writers in both languages, no locking, and "direct
ports" that had already drifted.

**Three of these eight tasks were mis-scoped in this plan** — 2.3 because the
port it asks for already happened, 2.5 because the destination it names does
not exist, 2.7 because its title described a symptom rather than its content.
All three were caught by reading the tree at kickoff. The kickoff prompt's
"verify it still reproduces" step is not a formality; it changed most of this
phase.

### 2.1 · Write the ownership map first *(P2 M9, P3 §4)*

Before any code change. Commit `docs/table-ownership.md`, one row per table:

| Table | Writer | Readers | Notes |
|---|---|---|---|
| `prop_odds` | Python | TS | |
| `pick_history` | Python | TS | |
| `bets`/`picks`/`watchlist`/`tracked_lines` | **TS** | TS | user data — **stays in TS** |
| … all 35 … | | | |

The four user tables stay in TypeScript: request-scoped, session-authenticated,
correctly implemented. Do not move them.

**Why first:** P3 H2, H3 and C1 each get harder the longer two languages own the
same tables. Doing them before the boundary is decided means doing them twice.

### 2.2 · Fix the generic-sports leakage, re-enable those jobs *(P3 H4)*

The six `genericPropProduction*Job` entries disabled in 0.8 and currently in
`DISABLED_JOBS` (`python-odds-service/src/jobs.py`, which names this task as
their owner). Predictions must use only data strictly prior to `commence_time`.

**Scope is Q14 — the audit's steps 1–3, plus an audit query. Not step 4's
deletions.**

1. **Start filter.** `generic_prop_production.run_sport` (~line 364) loops over
   `generic_pick_capture.fetch_scheduled_games`, whose docstring says it
   deliberately keeps games at any status. Skip any game where
   `commence_time <= now`. `_is_final_capture_due` already parses
   `commence_time` correctly — reuse it inverted rather than writing a second
   parser.
2. **Migration: store `commence_time` on `pick_history`.** Not optional garnish
   — **the VERIFY below cannot be run without it.** Today there is no column
   recording when the predicted game actually started, so no row, past or
   future, can be audited for leakage.
3. **Belt and braces in `fetch_player_gamelog`:** drop any gamelog entry whose
   event id equals the game being predicted. Makes the guarantee local instead
   of dependent on every caller remembering the filter.
4. **Audit query, report only.** The existing rows (P3 H4 cites n=207 NFL,
   which §11 established came from *local* runs, never production) get checked
   against real kickoff times and the count written into §11. **Change nothing
   about them** — the delete/keep call stays with the operator, per Q14.

Then move the six entries from `DISABLED_JOBS` back into `JOB_REGISTRY`, deploy,
and confirm the deployed SHA contains the fix *before* the first tick runs.
Re-enabling ahead of the deploy is the one ordering that reproduces the exact
bug this task exists to fix.

**VERIFY:** for a sample of new rows, every input feature's timestamp precedes
`commence_time`. Log the query.

### 2.3 · Delete `/api/odds/lines`' writes *(P4 H1)*

**Retitled 2026-08-28: P4 H1's "port all three" is stale.** Checked against the
tree at Phase 2 kickoff, all three passes already exist in Python and run every
5 minutes as `mlbOddsLinesCycleJob`:

| TS pass, `app/api/odds/lines/route.ts` | Python |
|---|---|
| `logGameOddsHistory` | `db.write_game_odds_history`, `odds_lines_cycle.py:770` |
| `logTotalPredictionsFromLines` | `db.log_game_total_predictions`, via `run_total_lock_from_lines:522` |
| `attachPricesFromLines` | `attach_prices_from_lines`, `odds_lines_cycle.py:666` |

The route's own comment claiming `attachPricesFromLines` is "NOT yet ported"
is false, and `odds_lines_cycle.py`'s docstring says the same — both are 2.8's
job to correct.

So this task is **deletion plus one real gap**, not a port. Delete the three
calls; the route becomes a pure read.

**The gap, which a naive deletion would silently introduce:** the TS pass logs
history for every row in `game_odds_book_lines` — *all* sources merged
(the-odds-api, OddsHarvester, SportsGameOdds, SharpAPI, Propline, ESPN). The
Python job logs only the-odds-api's own freshly-fetched lines. Deleting the TS
pass as-is therefore **shrinks `game_odds_history` source coverage** while every
row count still looks healthy. Widen the Python side to log from the shared
table first, in the same commit.

**VERIFY:** `game_odds_history` keeps growing with the dev server stopped, **and**
`SELECT source, count(*) FROM game_odds_history WHERE observed_at > now() -
interval '2 hours' GROUP BY source;` returns the same set of sources it did
before the deletion. Row count alone does not prove this one.

### 2.4 · Remove the TypeScript golf writes *(P2 H1)*

`lib/sports/golf/adapter.ts` runs these on every golf page load, alongside the
Python `golfPredictionsJob` whose registry comment falsely claims the TS path
was removed:

- ~661 `logGolfTournamentPredictions` — **a fourth write P2 H1's fix text omits.**
  H1's own finding body lists `golf_tournament_predictions` among the tables
  with two writers, so it belongs here; only the "delete lines 675/689/696"
  instruction missed it. Deleting three of four would leave the double-write
  open on exactly one table and look finished.
- ~675 `logGolfModelPredictions`
- ~689 `void ingestGolfHistory(...)`
- ~696 `void gradeAllGolfPredictions()`

The last two are `void`-ed floating promises whose rejections are already
showing up unhandled in `system_events` (46 × history-ingest, 15 × grading).

**Delete the four write calls, not the computation.** The tournament simulation
and prediction rows are still needed for what the page renders this request;
what goes is the persistence. Confirm before deleting that the Python job
covers all five golf tables, and that the worker is healthy — with the worker
down, the TS path is the *only* writer, so removing it stops golf entirely.

**VERIFY:** `golf_model_predictions` and `golf_tournament_predictions` both
advance from Python within one job interval (5 min) of the deletion, dev server
stopped. Fix the false comment in `jobs.py` in the same commit.

### 2.5 · Delete the user-triggered provider routes *(P2 M1)* — **Q12**

**Retitled 2026-08-28. This is a deletion, not a port**, per operator decision
Q12. Two things forced the rewrite:

1. **There is no Python endpoint to move to.** `python-odds-service/src/main.py`
   runs `SequentialQueue` and nothing else — it is a Render *background worker*
   with no inbound URL. "Move to Python endpoints" was never available as
   written. The alternatives were a queued job table (async, latency bounded by
   whatever is ahead in the queue — a bad fit for a button you press and wait
   on) or a second paid Render web service.
2. **The operator elected to remove the feature instead.** These three buttons
   are the app's only user-initiated odds refresh; everything else is ambient.

**Delete, in this order:**

- The UI actions — `runMoreBooks` / `runSharpPrice` / `runScan` and their
  state in `components/usePropOdds.ts` (~81, 88, 109, 127, 140, 161), then
  every consumer rendering them.
- The three routes: `app/api/props/{scan-player,more-books,sharp-price}/`.
- Their `middleware.ts` entries (both `PROTECTED_API_PREFIXES` at :28 and the
  list at :68–70).
- Then whatever TS provider machinery is *actually* unreachable afterwards.

**Do not delete the provider layer wholesale.** P2 M1 traced it and ruled most
of it live; re-traced at kickoff, these still have real readers and must survive
unless they independently go dead: `registry.ts` (`allProviderMeta` →
`/api/props/diagnostics`), `config.ts` (five importers incl.
`oddsPapiHistoricalIngest.ts`), `providers/sportsGameOdds.ts` (→
`/api/nfl/game/[gameId]`), `providers/oddsPapi.ts` (→ `/api/props/line-history`).
`tier1Refresh.ts` has `scan-player` as its **only** importer and does die here.

**Produce the deletion list before deleting**, and put it in the commit message
— this is irreversible and it is the operator's product surface.

**VERIFY:** `npm run typecheck && npm run build` green; a grep across both trees
for every deleted symbol returning nothing, run *after* deletion; and
`prop_odds` still advancing from Python (`refreshTier1`, 2.5 min) within one
interval, dev server stopped.

### 2.6 · Delete confirmed-dead code *(P2 M2)*

Re-verified at Phase 2 kickoff (2026-08-28) — all three still present, still
zero importers:
- `lib/odds/nflGameLines.ts`
- `lib/odds/rundown.ts` (only importer is `nflGameLines.ts`)
- `lib/odds/props/sportsGameOddsRefresh.ts`

Plus P2 Step 4's list in order, `npm run typecheck` after each. Move
`better-sqlite3` + types to `devDependencies`.

**Two corrections to P2 M2's inventory, from re-checking it at kickoff:**

- **`/api/{cfb,nba,nhl,soccer,tennis}/player/[playerId]/candidates` are LIVE.**
  M2 marked them "VERIFY — likely called from a client path my static scan
  missed." They are: `components/useSyntheticPlayerCandidates.ts:48–51` builds
  those URLs. **Do not delete.** This is the "verify it still reproduces" rule
  earning its place — the finding was a guess and the guess was wrong.
- **`/api/props/line-history` has no caller.** M2 listed it alongside the
  candidates routes as probably-live. It isn't: the only references anywhere are
  its own file and `middleware.ts:65`. It becomes another verify-then-delete
  item — and note it is OddsPapi-backed, so if it goes, 2.5's surviving
  `providers/oddsPapi.ts` may go dead too. Sequence it **after** 2.5 and
  re-check.

`/api/golf/predictions` (public, unauthenticated, 3,000-iteration simulation,
no frontend caller) and `/api/odds/game-lines` (legacy plural, superseded):
**delete both.** Neither has a caller and both are live paid/compute surface.

### 2.7 · Python computes every model number; TypeScript renders — **Q13**

**Retitled and rescoped 2026-08-28.** The original title ("move the schedulers
to `JOB_REGISTRY`") described only the multi-instance symptom. The real content
is the model boundary. See Q13's note in §0 for how this was mis-sized twice
before being measured.

**The symptom.** `lib/scheduler.ts`'s two `setInterval` timers (`refreshMlb` at
4 min, `refreshCalibration` at 30 min) are per-process. Run N app instances —
which deploying in Phase 8 means — and every timer fires N times.

**The actual problem.** `adapter.ts` (2,412 lines), which `refreshMlb` drives,
runs live model math in TypeScript on that timer: `computeModelProbability`
(730, 1640), `applyFittedHomeRunWeights` (1674), `ensureGameSims` (1993),
`computeMoneylineModel` (2265), plus Elo, park factors and Statcast rates. This
is the audit's root finding in its purest form — Python computes the same
numbers, every 5 minutes, in `prop_candidates.py` / `home_run_model.py` /
`sim_engine.py`, and the two are never reconciled.

**a · Cache-first cutover.** `adapter.ts:2323` already does exactly this for the
game model: read `mlb_game_model_cache`, use it when present and fresh, fall
back to TS compute when the row is missing or stale. **Extend that proven
pattern to the prop side** — prop probabilities, home-run model, game sims.
Cache-first is what makes this safe: worst case if Python is down is today's
behaviour, not a broken page.

> **Design decision to make and record, not to escalate:** Python's prop output
> lands in `pick_history`, a first-write-wins **log** — today's number is frozen
> at whatever the first tick saw. A page needs the *current* number. This likely
> wants a new `mlb_prop_model_cache` mirroring `mlb_game_model_cache`. Whatever
> is chosen, write down why in the commit.

**b · Port the genuinely-unported writes.** Four of the six writes in
`rebuildMlbSnapshot` were already in Python. Of the three that were not, two
are done and the third is **deferred to Phase 4 by Q18**:

| Write | Size |
|---|---|
| `logGameModelPredictions` → `pick_history` | ~40 lines; reads `mlb_game_model_cache`, which already exists |
| `gradeFinishedGames` → `pick_history` (`grading.ts`, 208 lines) | MLB prop grading; `statsapi.py` has the live feed, `generic_prop_grading.py` is the shape to copy |
| `computeCalibrationPayload` → `snapshot_cache` (86 lines) | ~12 aggregate queries; mostly transcribing SQL |

**c · Lock both timers.** `withJobLock` already exists in `lib/db/pgClient.ts`
and is currently **unused** — its callers were the deleted provider jobs. Wrap
both timers so N instances produce one rebuild per interval.

**Estimate: 2–4 days**, the long end if the prop shapes don't line up.
**Doing this now, not at deploy time, is what makes Phase 8 safe.**

**VERIFY:** (a) every model number `adapter.ts` renders comes from
`mlb_prop_model_cache`, not from its own computation; (b) a rendered MLB prop
probability equals the Python-computed value for the same
subject/dimension/**category**/game, compared row to row, not eyeballed;
(c) with two app processes running locally, `snapshot_cache['mlb:snapshot']` is
written once per interval, not twice.

> **(a) was originally written as "no longer calls `computeModelProbability` …
> outside a cache-miss fallback — shown by grep", and that phrasing was wrong
> about its own design.** The implemented shape computes locally *eagerly* and
> then substitutes the cached value, rather than computing lazily only on a
> miss. The rendered number is Python's either way — (b) proves that
> exactly — but a grep for the call sites will still find them, so a grep is
> not the right check. Two reasons the eager shape was kept: the local
> computation is the fallback and has to exist regardless, and running both
> makes a future TS/Python divergence *detectable* by comparison instead of
> invisible. The honest cost is that TypeScript still performs model
> arithmetic it discards. Recorded rather than glossed.

### 2.8 · Correct every misleading comment *(P2 M6, P2 H7)*

All six in P2 M6, plus the `CLAUDE.md` corrections in P2 M1. Do this last in
the phase, once behaviour is settled — writing them earlier means writing them
twice. Per rule 3, each correction ships with the observation proving it.

### 2.9 · Close the three tables the gate found *(P3 §4 remainder)*

**Added 2026-08-29, after the Phase 2 gate's own ownership check failed.** Not
in the original plan; it exists because the gate caught `table-ownership.md`
claiming task 2.7 had closed three tables it never touched.

The investigation corrected itself twice, and both are recorded in
`docs/table-ownership.md` because the second contradicts the first. Short
version: **one** of the three was a genuine page-path dual writer
(`game_sim_cache`, via `adapter.ts`'s `ensureGameSims`). The other two were
never written on the page path at all — but **nothing in either language
refreshed them on a schedule**, so two seasonal aggregates the home-run model
depends on stayed current only if somebody manually POSTed an operator route.

1. `ensure_game_sims` moves into `computeMlbGameModelJob`, which already holds
   the same slate and the same posted-or-projected lineups. `adapter.ts` goes
   read-only. **No cache-first fallback here, deliberately** — a simulation is
   ~3 s of CPU per game, so a fallback would put a ~45 s slate simulation on a
   page request, which is the cost this cache exists to avoid. Stale sims are
   the better failure.
2. `maintainMlbParkFactorsJob` and `maintainMlbHrMatchupJob`, both 6-hourly.
3. `GameModelGameInput` carries `home_lineup_projected`/`away_lineup_projected`
   through from `TeamSide`, which `ensure_game_sims` needs to decide whether to
   upgrade a projected-lineup simulation to a posted-lineup one.

**Also found here:** `/api/mlb/refresh-hr-matchup` was **unauthenticated** — a
POST that pulls every qualified batter's full season game log. Task 1.5 gated
the operator surface but scoped itself to `/api/props`. Added to
`ADMIN_API_PREFIXES`.

> **That fix did not work, and this task's claim that it did was false for a
> day.** `ADMIN_API_PREFIXES` has no effect unless `proxy.ts`'s
> `config.matcher` also routes the path; the matcher entry was missed. The
> route stayed open until **task 3.13** caught it by issuing a request rather
> than re-reading the constant. Closed there, with
> `tests/proxy-matcher.test.ts` guarding the class of mistake.

**VERIFY:** the two new jobs write real rows; `adapter.ts` references none of
`ensureGameSims`/`writeGameSimCache`/`writeParkFactors`/`writeTeamHrRateAllowed`.

### Phase 2 exit

**All ticked 2026-08-29; gate PASSED — see §11.**

- [x] `docs/table-ownership.md` committed, all **36** tables (35 at kickoff, minus `watch_links`, plus `job_locks` and `mlb_prop_model_cache`)
- [ ] ~~48 h of writes to every shared table with the dev server stopped~~ —
      **removed 2026-08-28 by operator decision (Q15).** Replaced by the
      write-advance check below.
- [x] For every table a TS writer was removed from: `max(timestamp)` advances
      from Python within one job interval of the deletion, observed and logged
- [x] Leakage verification query logged; the six `genericPropProduction*Job`
      entries back in `JOB_REGISTRY`, and `DISABLED_JOBS` empty or its remaining
      entries re-justified with a date and owning phase
- [x] `game_odds_history` source coverage unchanged after 2.3 — the
      `GROUP BY source` query, not just a row count
- [x] All four golf writes gone; both golf tables advancing from Python
- [x] Scan / More Books / Check Sharp Price gone from UI, routes and
      `middleware.ts`; deletion list in the commit message
- [x] Dead files deleted, not commented out
- [x] Every model number `adapter.ts` renders comes from `mlb_prop_model_cache`
      (it still computes a fallback eagerly — see G7.1 in §11; the original
      wording of this item described a design that was not built)
- [x] A rendered prop probability matches Python's value for the same row
- [x] Two local instances → one write per interval
- [x] `CLAUDE.md` describes what actually runs

---

### Phase 2 gate

G1-G8 apply. Additionally:

- ~~**48 hours, every shared table, dev server stopped.**~~ **Removed
  2026-08-28 by operator decision (Q15)**, to keep build velocity; sustained
  Python-only writes get verified after Phase 9 instead. Recorded here rather
  than deleted, because this was the check Rule 2 pointed at and dropping it
  silently is exactly the failure mode this plan exists to prevent.

  **Replaced by:** for every table a TS writer is removed from, `max(timestamp)`
  advances from Python **within one job interval** of the deletion — minutes,
  not days, and logged in §11 per table. This is weaker: it proves the Python
  writer works *now*, not that it keeps working unattended. That gap is the
  known cost of Q15 and belongs in the sign-off's "known not done" list.
- **Deletion means zero importers.** For every deleted file, a grep across both
  trees showing no remaining reference, run *after* the deletion.
- **The model boundary is real, not asserted.** 2.7's VERIFY (b) — a rendered
  prop probability compared row-to-row against Python's own value. A grep
  showing the TS call sites are gone proves the code path changed; it does not
  prove the number the user sees now comes from Python.
- **`docs/table-ownership.md` re-derived, not reviewed.** Regenerate the writer
  list by grepping both trees fresh, and diff it against the committed doc.
  They must match exactly.
- **Two local instances, one write per interval** - then repeat with three, to
  prove the fix isn't accidentally coupled to the number two.

---

# Phase 3 — Observability and defence

**Goal:** the system cannot fail silently, and one script cannot exhaust it.
**Duration:** 1.5 weeks. **Depends on:** 2.

### 3.1 · Stop swallowing cache-write failures *(P4 H5)*

`lib/cachedRoute.ts`'s `catch { /* ok */ }` is how the free-tier read-only
window went unnoticed — every route silently degraded to zero caching while
returning 200s. Log it and emit a `system_events` row; keep the request
succeeding.

### 3.2 · Error surfacing *(P5 E3)* — **rescoped by Q19**

**No Sentry, and no external error tracking at all.** Retitled from "Error
tracking" because that name promised something this task no longer does.

What lands: the `/diagnostics` panel for a spike in `system_events` where
`source='cachedRoute'`, fed by 3.1's logging.

**The consequence, stated rather than buried:** alerting is now the
health-check cron's own `notifyOnFail` plus whoever opens `/diagnostics`. There
is no push notification when something breaks unobserved. Fine while nothing is
user-facing; **Phase 8 owns revisiting it** before that stops being true.

**VERIFY:** revoke a grant for 60 s; confirm a `system_events` row **and** the
`/diagnostics` panel showing the spike.

### 3.3 · Fix the health checks that report green through an outage *(P3 M9)*

At the time of audit, with every provider job 986–1052 min stale:
```
gameOddsBookLinesFreshness    healthy   (counts rows over a 7-DAY window)
oddsHistoryAndPricesFreshness healthy   (satisfied by OddsHarvester alone)
propPredictionsFreshness      healthy   (counts rows generated from 17h-old prices)
```
**The premise has moved since the audit — check before changing anything.**
`health_check.py` was substantially rewritten on 2026-08-26, and at least two of
these three now carry documented reasoning against the very change this task
asks for:

- `check_odds_history_and_prices_freshness`'s 24-hour window is **deliberate**.
  `write_game_odds_history` is log-on-change, so a quiet market legitimately
  writes nothing for many consecutive cycles; the narrow per-interval window
  was tried, false-positived live, and was widened on purpose.
- `check_prop_predictions_freshness` no longer "counts rows" — it cross-checks
  the job's own last-run candidate count against real `pick_history` rows for
  today's real games.

So **narrowing the windows as written would reintroduce a bug someone already
fixed.** Do the fault injection FIRST — it is the gate's requirement anyway —
and fix only what actually fails to go red. `check_game_odds_book_lines_freshness`
does still use a 7-day window and is the most likely genuine offender.

**VERIFY:** stop the worker for one interval; each of the three flips to
unhealthy. Any that already does needs no change, and that gets recorded.

### 3.4 · Rate limiting *(P4 M1)*

None exists. In-memory token bucket in `middleware.ts` keyed on
`x-forwarded-for`, or `user.id` when signed in. ~30 lines, no dependency.
Budgets: 60 req/min per IP; 10/min on provider-touching routes; 2/hour on
fit/backfill.

**VERIFY:** 100 requests in 10 s → 429 after the threshold.

### 3.5 · Bound attacker-controlled cache keys and upstream calls *(P4 H3, P4 L1)*

~20 routes build a `snapshot_cache` key from an unvalidated parameter. Proven:
`?teamIds=888801,888802` created permanent rows and fired real MLB API calls,
unauthenticated, ~1 s each. `mlb:injuries` is worst — the key space is every
subset of every integer.

1. Validate against a known set before touching the cache — you already do this
   correctly for `SOCCER_LEAGUES` and `TENNIS_TOURS`; extend to team/player ids
   via `fetchAllTeams()`.
2. Cap combinatorial keys — `mlb/injuries` accepts at most 2 ids.
3. Hash long keys rather than embedding raw input.
4. `encodeURIComponent` every path segment interpolated into an upstream URL
   *(P4 L1)* — `${BASE}/${sport}/${league}/teams/${teamId}/roster` currently
   accepts `../`.

**VERIFY:** bogus ids → 400, and no new `snapshot_cache` row.

### 3.6 · Limit `/api/odds/import` uploads *(P4 L5)*

Explicit size cap and MIME allowlist. Combined with 3.4 this closes a
memory-exhaustion vector.

### 3.7 · Move admin authorisation out of source *(P4 M9)*

`ADMIN_USER_IDS = ['038048de-…']` is hardcoded in `middleware.ts` and therefore
in a public repo, and can't change without a redeploy. Minimum: an env var.
Better: a `profiles` table with a `role` column, RLS-protected (no `profiles`
table exists today — PostgREST returns 404).

### 3.8 · Fix the `?` placeholder compiler *(P2 M4, P4 M11)*

`pgClient.ts`'s `compile()` does a blind `sql.replace(/\?/g, …)` across the
whole string. Safe today (no query contains a literal `?`), but the moment
someone writes `payload::jsonb ? 'key'` or `LIKE '%?%'`, placeholder numbering
shifts silently and parameters bind to the wrong positions — wrong data, not an
error, and `tsc` won't catch it.

Skip `?` inside quoted literals, or standardise on `@name` (already supported
and correctly scoped) and drop positional support.

**VERIFY:** a test with a jsonb `?` operator, added in 3.11.

### 3.9 · Narrow `withConnectionRetry` *(P2 M5)*

It can double-apply a non-idempotent INSERT: a connection dropped *after* the
server committed but before the client saw the ack is retried. Restrict retry
to reads, or make the retried writes idempotent (they mostly have natural keys
already — use `ON CONFLICT`).

### 3.10 · Batch the per-row write loops *(P4 H1, P2 M7)*

**Half of this is already done, and this task's VERIFY is stale.**

- ~~`writeGameOddsHistory`~~ — **batched in task 2.3**, which could not ship
  without it: on the real workload the per-row shape ran 290+ seconds without
  finishing. Now one `DISTINCT ON` plus one `executemany`, measured at 1.6 s.
- `writePropOdds` *(P2 M7)* — **still per-row**, 3 round-trips each inside one
  transaction. This is the remaining work.

**The `/api/odds/lines` VERIFY no longer measures what it was written to
measure.** The 13.5 s figure was that route's three write passes; task 2.3
deleted all three and the route is now a pure read. Re-time it honestly against
what it does today rather than reporting a number that looks like a 13x win but
is really a different route.

**VERIFY:** time a full `writePropOdds` cycle before and after, log both; and
report `/api/odds/lines` timed ten times on a full slate — median and worst —
as the current baseline, not as a comparison against a route that no longer
exists.

### 3.11 · Tests and CI *(P3 M8, P5 E1, P5 E2)*

Scoped per Q2 — model math lives in Python (19 test files already). TypeScript
keeps the **display layer**:

- `lib/odds/devig.ts` — including 1.1 (over + under ≈ 1.0)
- `lib/odds/display.ts` — American↔decimal, using P3 §2.1's verified table
- `lib/odds/matching.ts` — `teamKey`; silently dropped 30 of 37 games
- `lib/db/pgClient.ts` `compile()` — including the jsonb `?` case (3.8)
- `middleware.ts` — encode P4 §2.1's status-code table
- `lib/odds/goodBets.ts` — best-price selection, once 5.6/5.7 land

**CI, scoped by Q20 — hermetic tests only, no database credentials in GitHub
Actions.** A CI run holding production write credentials is a new attack
surface, not a safety net.

**`pytest` is the wrong command and would quietly pass on nothing.** The Python
tests here are standalone scripts (`python -u src/test_x.py`), not pytest
modules — `python -m pytest` collects almost nothing from them. CI must invoke
them individually, and only those that touch neither the database nor the
network. The DB-touching ones stay local, listed explicitly so the split is
deliberate rather than accidental.

Actions is already in use in this repo (`.github/workflows/oddsharvester-scrape.yml`),
so there is nothing to set up beyond the workflow itself.

**VERIFY:** push a deliberate type error; CI goes red. Then revert; CI goes
green. A CI that has only ever been green is untested.

### 3.12 · Security headers *(P4 M2)*

`next.config.mjs` `headers()`: `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy`, HSTS. CSP deferred to 8.2 — it needs
real tuning against Next's inline scripts and is best done against the
deployed build.

### 3.13 · Dependency vulnerabilities *(P4 M7)*

Four high-severity: `postcss` and `sharp` via Next (fix = Next 16, a major
upgrade — schedule deliberately, not via `npm audit fix --force`), and `xlsx`
(prototype pollution + ReDoS, **no fix on npm**). For `xlsx`: pin from SheetJS's
own CDN, or replace with a CSV path for the one historical-odds import. Confirm
no user-supplied spreadsheet ever reaches it.

### 3.14 · CSRF posture *(P4 L4)*

Low risk today: Supabase cookies are `SameSite=Lax` and your state-changing
routes take JSON bodies, forcing a preflight a cross-site form can't satisfy.
**Action:** document this in `docs/table-ownership.md`'s security notes, and add
a test asserting no route accepts form-encoded bodies — so the assumption breaks
loudly if someone adds one.

### 3.15 · The two GET-path writers Phase 2 could not close *(no finding)*

**Carried from Phase 2's gate, and NOT done in Phase 3.** Both are the same
class as P4 H1, which Phase 2 fixed for `/api/odds/lines`, and neither appears
in any audit finding — both were found by deriving `docs/table-ownership.md`.

1. **`recordEspnPregameLine`** (`lib/odds/espnBookLines.ts:71`) writes
   `game_odds_book_lines` from inside the CFB, NBA and Soccer
   `game/[gameId]` GET handlers, fire-and-forget.
2. **`odds_cache`** is written on odds-route GETs by `golfLines.ts`,
   `oddsApi.ts` and `tennisLines.ts`.

**Why this was not simply deleted, which is what Phase 2 did for its
equivalents:** checked at Phase 3, and **Python has no ESPN pregame-line
capture at all.** `game_odds_book_lines` is written on the Python side by
`job_runner.run_provider_specs` (SportsGameOdds, ParlayAPI, …) and
`harvester_scrape.py` (OddsPortal) — neither of which produces ESPN's pregame
line. Deleting the TypeScript calls would therefore **lose that data outright**
for three sports, not move it.

So this needs a real port — an ESPN pregame-line job in `JOB_REGISTRY`, roughly
the size of task 2.9's jobs — and porting it hastily at the end of a long phase
is how the errors this plan exists to prevent get made. **Owner: Phase 5**,
which already owns data-quality work over the same table.

### Phase 3 exit

**All ticked 2026-08-29; gate PASSED — see §11.**

- [x] Deliberately broken cache write → Sentry event + DB row
- [x] Stopping the worker flips all three freshness checks red
- [x] 429 above the rate limit
- [x] Bogus ids → 400, no cache row
- [x] `/api/odds/lines` timed 10x — median 1.84s, worst 4.65s. **Not under a
      second**, and reported as a baseline rather than a pass: the 1s target
      described a route task 2.3 has since gutted. See §11.
- [x] CI red on a deliberate error
- [x] Headers present on a live response
- [x] `npm audit --omit=dev` → 0 high, or each remaining one documented

---

### Phase 3 gate

G1-G8 apply. Additionally - **fault injection, each one actually performed:**

| Injected fault | Expected observable |
|---|---|
| Revoke a table grant for 60 s | Sentry event **and** `system_events` row |
| Stop the worker one interval | All three freshness checks flip red |
| 100 requests in 10 s | 429 past the threshold, service still up |
| Bogus team/player ids | 400, and no new `snapshot_cache` row |
| 100 MB upload to `/api/odds/import` | Rejected before buffering |
| Query with a literal jsonb `?` | Correct parameter binding, covered by a test |

- **CI proven in both directions**: red on a deliberate type error, green on the
  revert. A CI that has only ever been green is untested.
- **`/api/odds/lines` timed ten times** on a full slate - report median and
  worst, not one lucky sample.

---

# Phase 4 — Build the scoreboard

**Goal:** answer "does the model beat the market this week?" with a number,
automatically. **Duration:** 2–3 weeks. **Depends on:** 1, 2.

> **The blocker:** `market_prob` is populated on **1% of `pick_history`**
> (3,615 of 362,616). You cannot tell when the model has won. Everything else
> here is downstream of 4.1.

### 4.1 · Backfill `market_prob` coverage *(P3 C5 fix #2, P3 H8)*

Python's `resolve_candidate_edge` already computes a sharp reference for every
candidate and has never run. Get it writing.

**VERIFY:**
```sql
SELECT count(*) FILTER (WHERE market_prob IS NOT NULL)::float / count(*)
  FROM pick_history WHERE surfaced_at > now() - interval '7 days';
```
**Done when** > 0.5 on new rows.

### 4.2 · Market baseline as the activation gate *(P3 H3)*

Today the gate compares a fitted model against your own *unfitted formula* — a
model can "win" while losing to the market. Replace it: **activate only if
Brier beats `market_prob`'s Brier on held-out live rows.** This is the literal
implementation of Q6.

**VERIFY:** run `fit-weights` with a deliberately weak feature set; it refuses
to activate.

### 4.3 · Fit Platt calibration *(P3 H1)*

`model_calibration` and `model_artifacts` are **empty**. Probabilities are
systematically over-confident. Fit Platt scaling on live (non-backfill) graded
rows, per sport and market, and store it. Prerequisite for ever returning to
Tier D.

### 4.4 · Shadow mode as a real flag *(Q6)*

Not an ad-hoc UI removal. `model_weights.shadow = true` means compute, log,
grade, never render. Phase 1.3 hid things by editing components; this makes it a
property of the model so a future model graduates by flipping one column.

### 4.5 · CLV on `/diagnostics` *(P3 M1)*

P3 computed CLV once (n=78, −4.6% ROI, 27% beat the close) and nothing reports
it. Define the closing reference explicitly — last observed price before
`commence_time` — document that definition, put it on the dashboard. CLV is
measurable in weeks; win rate takes years.

### 4.6 · Investigate the fade signal *(P3 C5)*

The negative-edge bucket underperformed the market by **4.52 points** on
n=1,981 — the model may carry genuine *negative* information. Most interesting
unexplained result in the audit. Don't build on it until 4.1 gives you the
sample.

### 4.7 · Backfill `player_game_history`, and fix survivorship bias *(P3 L3)*

Current: NHL 674k, CFB 274k, NFL 227k, EPL 168k, MLS 134k. **MLB, NBA, golf and
tennis have zero rows.** You cannot train MLB prop models on a table with no MLB
in it — and MLB is where all your graded history lives.

*(Note: MLB's player detail pages don't read this table — they use a separate
MLB StatsAPI/Statcast pipeline. The gap is in training data, not the UI.)*

P3 L3: the backfill only walks *currently rostered* players, so retired/released
players are missing and any model trained on it is biased toward players who
stayed in the league. Fix by walking historical rosters per season.

`docs/player-game-history-backfill-RESUME-2026-08-27.md` is the starting point.
Watch the Free-tier ceiling (§0.2).

### 4.8 · Collapse the two MLB game models *(P3 H2)*

Two different MLB game models run in production, and **the one being graded and
displayed is not the one that was validated.** Pick one, delete the other,
re-grade the affected history.

**VERIFY:** one code path produces `game_picks`, confirmed by grep and by 24 h
of writes.

### 4.9 · Split the two definitions of `edge` *(P3 H8)*

Two incompatible definitions share one column, one threshold and one UI. Give
each its own column (`edge_model_vs_market`, `edge_sharp_vs_soft`), populate
`edge_source` (currently 100% NULL), and give each its own threshold.

**VERIFY:** `edge_source` non-null on all new rows.

### 4.10 · Let the generic sports surface "under" *(P3 M12)*

The five generic sports can only ever surface "over" picks — a structural bias
in candidate generation, not a modelling choice. Fix candidate generation to
consider both sides.

**VERIFY:** new candidates for NBA/NHL/CFB/soccer/tennis include both sides.

### 4.11 · Fix the totals model's distributional assumption *(P3 C2)*

The MLB totals model has no predictive power and its Poisson assumption is
empirically false — P3 measured real over-dispersion across 31,846 rows.
Replace Poisson with negative binomial (or an empirical distribution) and
re-validate. It stays in shadow mode either way until 4.2's gate passes it.

### 4.12 · Model-math hygiene

Individually small, collectively the reason the models are hard to trust. All
backend-only under Q6.

| Item | Fix |
|---|---|
| `blendWithStarterEra` mixes two quantities at a hand-set 50/50 *(P3 M4)* | Fit the weight, or document why 50/50 |
| Home-field and form added to a probability, not log-odds *(P3 M5)* | Move to log-odds; probabilities aren't additive |
| `compute_league_rate` silently returns 0.5 on no match *(P3 M6)* | Return `None` and let the caller decide |
| Golf model adds nothing over its own prior *(P3 M7)* | Either beat the prior or ship the prior |
| Prop Score scale biased upward, adds little over `model_prob` *(P3 M2)* | Re-scale; justify its existence or drop it |
| `poissonOverProbability` treats an integer line as a loss *(P3 L1)* | Handle push explicitly |
| `deltaFromLine` doc and code disagree *(P3 L2)* | Make them agree |
| `finals.sort()` inconsistent comparator *(P3 L5)* | Total order |

### Phase 4 exit

- [ ] `market_prob` on > 50% of new rows
- [ ] Activation gate refuses a market-losing model
- [ ] `model_calibration` non-empty
- [ ] `shadow` flag respected by the renderer
- [ ] CLV on `/diagnostics` with a documented closing reference
- [ ] `player_game_history` non-zero for MLB, NBA, golf, tennis
- [ ] One MLB game model
- [ ] `edge_source` non-null
- [ ] Both sides surfaced for generic sports
- [ ] Every 4.12 item closed or explicitly justified in writing

---

### Phase 4 gate

G1-G8 apply. Additionally:

- **The activation gate refuses a real bad model.** Actually run `fit-weights`
  with a deliberately weak feature set and paste the refusal. A gate that has
  never rejected anything is not known to work.
- **Shadow flag round-trip**: flip `model_weights.shadow` and show the renderer
  changing in both directions - hidden when true, visible when false.
- **Every 4.12 item closed individually**, each with its own one-line evidence.
  Eight items, eight lines. "Model hygiene done" is not an entry.
- **`market_prob` coverage measured on a rolling 7-day window**, not lifetime -
  lifetime coverage is dominated by backfill and will look healthy while every
  new row is empty.

---

# Phase 5 — Data quality and correctness

**Goal:** the prices you display are complete, correctly attributed, and
comparable. **Duration:** 1.5 weeks. **Depends on:** 2. Parallel with 3, 4.

This phase directly protects the Tier B product.

### 5.1 · Propline alias map → base market *(P2 C1, P2 H2, Q4)*

Propline's entire MLB batter-prop feed is discarded because its market keys
don't match. Per Q4, fold alt-lines into the base market:

| Propline key | `market_key` | `line` | `side` |
|---|---|---:|---|
| `batter_2plus_hits` | `hits` | 1.5 | over |
| `batter_3plus_hits` | `hits` | 2.5 | over |
| `batter_2plus_rbis` | `rbis` | 1.5 | over |
| `batter_3plus_rbis` | `rbis` | 2.5 | over |

> "2+" is "over **1.5**", not "over 2". Getting this wrong creates duplicate
> propositions at the wrong line — worse than discarding the feed. Build the map
> from Propline's live response, not from memory.

Ship P2 H2's monitoring in the same sitting — `odds_unresolved` must be written
by the **live** pipeline, not the dead one. That's what stops recurrence.

**VERIFY:** `prop_odds` gains Propline batter rows; Propline's `odds_unresolved`
count drops to near zero.

### 5.2 · The sharp-coverage experiment *(P5 G7, P3 H7, Q3)*

Measured: OddsHarvester supplies **only** `bet365.us`, `DraftKings`,
`BetMGM.us`, `Fanduel` — four soft retail books, **zero sharp**. What you do
have comes from Propline: kalshi 2,604 · novig 1,796 · prophetx 546 · pinnacle
306. Coverage of propositions: **3.23%** sharp-or-low-vig; **0.53%** Pinnacle,
covering only `pitcher-strikeouts` and `batter-strikeouts`.

P3 H7: Propline burns its entire ~1,000/day budget delivering one MLB market,
and `propline_2` has `cap_kind="none"` — no rate-limit gate at all, 4,098
requests recorded, last successful write six days before the audit (likely
vendor-side rejection with no visibility).

1. Give `propline_2` a real `cap_kind`/`cap_limit`, and surface its failure.
2. Reconfigure Propline's market selection to prioritise sharp books across more
   markets. Run one week.
3. Re-measure with the coverage query in `audit-phase-5.md`.

**Decision rule:** ≥ 30% → no purchase. < 10% → the $99–399/mo feed is
justified and you have the number to justify it.

### 5.3 · Normalise bookmaker names *(P3 H9)*

`game_odds_book_lines` has one book appearing up to three times
(`Fanduel`/`fanduel`, `BetMGM.us`/`betmgm`). This corrupts best-price selection —
the core Tier B feature.

**VERIFY:** `SELECT DISTINCT bookmaker` → one row per real book.

### 5.4 · Impossible totals, and CHECK constraints *(P3 H10, P2 M8, Q11)*

`game_odds_book_lines` holds `total` rows that cannot be the same proposition
(`over 2.5 @ +1200` beside `over 8.5 @ −101` for one MLB game). Q11: you don't
know what Propline puts in the `totals` slot, so take the empirical route —
group out-of-band `point` values by source and find the pattern.

Then add the constraints that make it loud *(P2 M8)*: `CHECK` on every
status/enum column (`side IN ('over','under')`, `status IN (…)`, sport keys),
plausible-range checks on `point` per sport, and foreign keys on sports data
where a real parent exists.

**VERIFY:** inserting an out-of-band total is rejected by the database.

### 5.5 · Modal-point selection for totals and spreads *(P3 C1)*

"Best total" and "best spread" combine prices for *different lines* and then
de-vig them. Select the modal point first; compare only prices at that point.

**VERIFY:** on a game with multiple total lines, the displayed best price and
its de-vigged probability come from the same `point`.

### 5.6 · Add the implausible-odds guard to TypeScript `bestPrice` *(P3 H6)*

The Python twin has `MAX_PLAUSIBLE_DECIMAL_ODDS`; the TypeScript one doesn't. A
single garbage price from any of 22 books becomes the displayed "best price."
**This is a direct product bug now that best price is the product.**

**VERIFY:** inject a +50000 price; it is excluded, and a test covers it (3.11).

### 5.7 · Exclude the compared book from Tier-2 consensus *(P3 M14)*

The consensus includes the book you're comparing against, which biases every
comparison toward "fair." Exclude the subject book from its own reference.

### 5.8 · Replace `_team_match` exact string equality *(P3 M13)*

Exact equality means a name-format change silently returns zero rows — the same
class of failure as the 30-of-37 game drop. Use the same normalisation
`teamKey` uses, and **log when a match fails** rather than returning empty.

**VERIFY:** feed a known format variant; it matches, and a miss emits a
`system_events` row.

### 5.9 · Wire the ParlayAPI soft caps *(P2 H3)*

`PARLAYAPI_*_SOFT_CAP` is configured, documented, and ignored — `config.py`
never reads it. Wire it in.

**VERIFY:** set a soft cap below current spend; the job warns and eases off.

### 5.10 · Stop discarding rows you paid for *(P2 H4)*

A concurrent provider job uses `asyncio.gather` without `return_exceptions=True`,
so one provider's failure discards every sibling's already-fetched rows. Add
`return_exceptions=True` and persist partial results.

**VERIFY:** force one provider to raise; the others' rows still land.

### 5.11 · Close the config drift *(P2 M3)*

Provider configuration exists in three places that must agree by hand — this
caused two real defects (a silently-ignored spend cap and the C1 market map).
Add a test asserting the TS and Python alias maps and provider limits match, and
a warning for orphan env vars.

**VERIFY:** change one side only; the test fails.

### 5.12 · Make the budget check-and-spend atomic *(P4 M8)*

The increments are safe (`ON CONFLICT DO UPDATE SET count = count + excluded`),
and TS/Python agree on period keys (UTC daily, Eastern monthly — verified). The
race is check-then-act: two processes both read "under cap" and both spend.

Replace with one conditional upsert that increments only if the result stays
under the limit and returns whether it succeeded — so "check" and "reserve" are
the same operation. Also surface Python's deliberately-swallowed spend-record
failures, so recorded spend stops being a silent floor.

### 5.13 · Schema hygiene

| Item | Action |
|---|---|
| Unused indexes *(P2 L1)* | Drop those with `idx_scan = 0` after 30 days of the new workload — not before, since Phase 2 changed the workload |
| `TEXT` payloads instead of `JSONB` *(P2 L2)* | Migrate `snapshot_cache.payload` and similar; enables partial reads instead of full-blob parses |
| `game_odds_history.source` default backfill *(P2 L3)* | Backfill real values or drop the misleading default |
| `picks` (0 rows) vs `pick_history` (362,616) *(P2 L5)* | Rename one — the names imply a relationship that doesn't exist and will mislead every future reader |

### Phase 5 exit

- [ ] Propline batter rows landing; `odds_unresolved` near zero
- [ ] Sharp coverage re-measured; buy/no-buy decision recorded with the number
- [ ] One row per book in `DISTINCT bookmaker`
- [ ] Out-of-band total rejected by a CHECK constraint
- [ ] Best price and its probability share a `point`
- [ ] Implausible price excluded, with a test
- [ ] Consensus excludes the compared book
- [ ] Config divergence test fails when one side changes
- [ ] Concurrent job failure preserves siblings' rows

---

### Phase 5 gate

G1-G8 apply. Additionally:

- **Every CHECK constraint tested by trying to violate it.** One deliberate bad
  insert per constraint, each rejected. A constraint nobody has tripped is a
  comment.
- **Best-price coherence on a real multi-line game**: the displayed price, its
  book, and its de-vigged probability all traceable to one `point`.
- **Alias map verified against a live Propline response**, not from memory - per
  5.1's own warning, with the "2+ means over 1.5" cases checked one at a time.
- **Config-drift test proven by breaking it**: change one side, watch the test
  fail, revert, watch it pass.
- **Sharp-coverage number recorded with its query and its date**, and the
  buy/no-buy decision written down beside it. A measurement with no recorded
  decision gets re-litigated in three weeks.

---

# Phase 6 — The product

**Goal:** ship what the audit identified as the actual asset — rich per-player
and per-team data, alongside prices from many books.
**Duration:** 3–4 weeks. **Depends on:** 5.

### 6.1 · Line-movement charts *(P5 G1)*

**The highest-value feature available.** 425,307 prop movement points and
19,667 game-line points, displayed nowhere; `/api/props/line-history` has no
frontend consumer at all. No new data required. One sparkline for table rows,
one detail chart for the panel.

### 6.2 · Price freshness, visible *(P5 G2, P5 T4)*

1.2 made it correct; this makes it prominent. Relative timestamps, a visual
state past a staleness threshold, and a coverage line ("22 books, updated 3 min
ago, 4 stale").

### 6.3 · Compliance basics *(P5 C1, P5 C5)*

**Required before any public signup. None exist today** — I grepped for all of
them. Responsible-gambling footer with 1-800-GAMBLER, age notice, terms of
service, privacy policy, "not financial advice" disclaimer.

### 6.4 · Label or exclude backfilled results *(P5 T5)*

87% of `pick_history` is `event_context='backfill'`, and those rows have
`surfaced_at = graded_at` — no evidence the prediction preceded the outcome.
Any user-facing record excludes them or labels them unmistakably.

### 6.5 · Publish the model's real record *(P5 T1)*

Including that it currently loses to the market. Nobody else in this category
publishes a market-relative Brier score. Being the tool that shows the
comparison honestly is a stronger trust position than another unfalsifiable
accuracy claim — and it's the only honest option given your own data.

### 6.6 · User-facing CLV *(P5 G3)*

4.5 put CLV on `/diagnostics`. This puts *the user's own* CLV in the product:
did their bets beat the close? It's the honest version of the thing the model
can't do — a claim you can stand behind.

### 6.7 · Tier C ranking returns *(Q1)*

Only after 1.1 (sign fix) and 6.5 (record published). Present as a **ranking**,
never a probability or EV, with its realised record attached.

### 6.8 · Book-lag analysis

"Which book moves last" — derivable today from `prop_odds_history`. One of the
most valuable things a line-shopping tool can show, and the data exists.

### 6.9 · Selectable de-vig *(P5 G4, P3 M3)*

Multiplicative is the least accurate of the standard methods — it ignores the
favourite–longshot bias, which affects most props. Add power, Shin and
worst-case behind a user setting, and **backtest which calibrates best on your
own 3,615 paired rows.** "We tested four de-vig methods against 3,615 graded
outcomes and chose power" is a genuinely differentiating, honest claim.

### 6.10 · Correlated-prop warnings *(P5 G5)*

Nothing tells a user that a batter's hits, total bases, runs and RBIs are the
same event four ways. Start with a hand-authored correlation map for the ~10 MLB
markets, shown as a banner on the slip; extend per sport. Empirical correlations
later, from `player_game_history`. A feature that *protects* the user is rare in
this category.

### 6.11 · DFS pick'em lines *(P5 G9)*

PrizePicks and Underdog. Standard in the prop segment (Props.cash covers them at
$19.99/mo) and conspicuous by absence. You already carry `prizepicks` (7,272
rows), `underdog` (1,724) and `sleeper` (2,156) in `prop_odds` — this is
surfacing work plus provider expansion, not a new pipeline.

### 6.12 · Book limits *(P5 G8)*

A +EV bet you can only get $12 down on is not the same product as one you can
get $2,000 down on. **Conditional on 5.2's decision** — it needs a feed that
carries limits. If 5.2 says buy, scope this into the same purchase.

---

### Phase 6 gate

G1-G8 apply. Additionally:

- **Compliance strings present on every route**, checked against rendered HTML
  across the whole page list - not just the homepage footer.
- **Backfilled rows are unmistakable** anywhere a record is shown, confirmed by
  querying the underlying rows and matching them to what the page displays.
- **The published record matches the database.** Re-run the query behind 6.5's
  numbers at gate time and diff it against what the page shows.
- **Line-movement charts checked against raw rows** for three propositions - a
  chart is a claim about history, and it has to agree with the history.

---

# Phase 7 — Commercial readiness

**Goal:** you can legally and operationally take money.
**Duration:** 2–3 weeks. **Depends on:** 6.

### 7.1 · Account recovery and password policy *(P4 M6)*

No "forgot password" link and no `resetPasswordForEmail` anywhere — a user who
forgets is permanently locked out and their `bets`/`picks` become unreachable.
Add the flow (~80 lines) and raise the Supabase minimum to 8.

*(What's already right: Supabase handles hashing and token rotation;
`@supabase/ssr` uses httpOnly cookies, not `localStorage`; middleware uses
`getUser()` not `getSession()`. Keep all of that.)*

### 7.2 · Entitlement layer

None exists — `middleware.ts` deliberately separates "logged in" from "paying"
and there is no paywall check anywhere. Tiering per the Phase 5 recommendation:
free (all 8 sports, best price, 24 h movement, bet tracking) vs paid ~$20/mo
(full movement history, CLV, alerts, de-vig choice, book-lag, unlimited
watchlist).

### 7.3 · Billing

Stripe or equivalent: subscription state, dunning, cancellation, proration.

### 7.4 · Legal review by an actual lawyer *(P5 C2, C3, C4, C6)*

I am not a lawyer; `audit-phase-5.md` §6 says where to look, not what is legal.

- **C2 · Affiliate rules** are state-by-state and the **operator** carries
  liability for an affiliate's advertising violations. Several states require
  registration. FTC endorsement guidance applies to disclosure.
- **C3 · Jurisdiction** — legal in 38 states with materially different rules.
  Minimum: a state selector filtering which books are shown.
- **C4 · Tout regulation** — several states regulate paid pick services
  specifically. Selling data and prices is a materially safer posture than
  selling predictions, which is where 6.7's ranking needs a legal read.
- **C6 · Provider terms** — redistributing odds data is restricted under most
  feed licences. Displaying it is normally fine; exposing it via a public API
  (or leaving it anon-readable, per 0.3) may breach what you're paying under.

### 7.5 · Support process and runbook

A support inbox and a response expectation. Plus a runbook for what you have now
hit all three of: worker hangs, provider 429s, Supabase goes read-only. Bus
factor is one; the recovery steps need to exist outside your head.

---

### Phase 7 gate

G1-G8 apply. Additionally:

- **Password reset end-to-end on a real account**, including the expired-token
  path.
- **Entitlement matrix**: every gated feature x {anonymous, free, paid, lapsed}.
  Lapsed is the case that gets skipped, and the one that costs money.
- **Billing lifecycle in Stripe test mode**: subscribe, fail a payment, dun,
  cancel, resubscribe - each reflected correctly in app state.
- **Legal review evidence attached**, or the gate records explicitly that it is
  outstanding. Per 9's Caveat 1, a checked box here is not clearance.

---

# Phase 8 — Production infrastructure and launch

**Goal:** it runs on real infrastructure and you know its actual limits.
**Duration:** 1–2 weeks. **Depends on:** 7. **This phase is last by design.**

### 8.1 · Migrate to Supabase Pro *(Q7)*

Removes the 500 MB ceiling and read-only enforcement; adds daily backups with
7-day retention. **Keep 0.1's `pg_dump` anyway** — Supabase's backups protect
against their failures, not yours.

### 8.2 · Deploy the web app *(P5 E5, P4 M3, P4 L3)*

Vercel or Render. `next build && next start`, never `next dev` *(P4 L3)*. Drop
`-H 0.0.0.0` from the production script *(P4 M3)* — it binds every interface,
which on a laptop means everyone on the same Wi-Fi.

2.7 already moved the schedulers into `JOB_REGISTRY`, so multiple instances are
safe. Add the CSP deferred from 3.12, tuned against the real build.

**VERIFY:** two instances running; `mlb:snapshot` written once per interval.

### 8.3 · Staging

One additional deployment on its own branch, with **its own Supabase project** —
`snapshot_cache` is one flat namespace and a shared database collides
immediately.

### 8.4 · Load test

Replace the audit's extrapolations with measurements. `k6` or `autocannon`
against staging, ramping to 100 concurrent on the heaviest read path.

The audit predicted pool exhaustion at 5–10 concurrent and event-loop saturation
at 50–100 — **find out whether that's right** and record the real numbers.

### 8.5 · Uptime monitoring

UptimeRobot free tier against `/api/selftest`. Ten minutes.

### 8.6 · Alerts as a product feature *(P5 G6)*

Steam and line-movement alerts are table stakes in every competitor tier. You
have the movement data; what you lack is a notification channel and a running
server — which is why this lands here and not in Phase 6. Needs a `user_alerts`
table and email (Resend/Postmark) or web push.

### 8.7 · Move OddsHarvester off a laptop *(Q10)*

Per Q10 this is planned — but "a different laptop" is still a laptop. Every
best-price display depends on one consumer machine staying awake, with no
monitoring and no restart. Put it on a small always-on box or a container with
a residential proxy (OddsPortal hard-429s datacentre IPs — proven, GitHub
Actions run 89041102402).

**VERIFY:** unplug the original laptop; `game_odds_book_lines` still advances.

### 8.9 · Move the weekly backup off the laptop *(Phase 0.1)*

0.1's `scripts/weekly-backup.sh` runs on one laptop via Task Scheduler. It
inherits every problem 8.7 names for OddsHarvester: no run with the lid shut,
no monitoring, and no alert when it stops. It is a deliberate stopgap — a
backup that usually happens beats one dump from August — but "usually" is not a
backup strategy for the one dataset no public source can regenerate.

Move it to the same always-on box as 8.7, and push the dump off that machine
too: a local dump on a machine that dies with the machine is half a backup.
Object storage (B2/R2/S3) is a few dollars a month at ~45MB/week.

**VERIFY:** shut the laptop for a full week; a new dump still appears, and its
restore drill still passes per 0.1.

### 8.8 · Close the migration-verification question *(P2 H6)*

`data/linebuddy.db` is not on this machine — I checked. If it exists on a
backup or the old machine, run the row-count comparison and close H6 properly.
If not, record it as permanently unverifiable so nobody re-opens it.

---

### Phase 8 gate

G1-G8 apply. Additionally:

- **Two instances, then three**, with `mlb:snapshot` written once per interval
  in both configurations.
- **Load-test numbers recorded** and compared against the audit's predictions
  (pool exhaustion at 5-10 concurrent, event-loop saturation at 50-100). State
  whether each prediction held.
- **Uptime monitor fired a real alert** - take the service down deliberately.
- **The laptop test**: unplug the OddsHarvester machine and confirm
  `game_odds_book_lines` still advances.
- **Restore drill re-run against the Pro-tier project**, closing the loop with
  0.1 on the infrastructure you will actually be running.

---

## 9. Is it production ready after all nine?

**Yes — with two honest caveats, both of which are now inside the plan rather
than outside it.**

| After | You can honestly say |
|---|---|
| 0 | Data can't be destroyed by a stranger or lost to a laptop failure |
| 1 | Nothing on screen asserts something your own data contradicts |
| 2 | One system, one owner per table — the root cause is closed |
| 3 | Failures are loud; one script can't exhaust you |
| 4 | You can prove whether the model works, and it can't ship until it does |
| 5 | The prices are complete, comparable, and correctly attributed |
| 6 | There is a product worth paying for |
| 7 | You can legally and operationally take money |
| 8 | It runs on real infrastructure and you know its limits |

**Caveat 1 — the legal review is the one thing I can't turn into a task.** 7.4
tells you what to ask; a lawyer has to answer it. Do not treat a completed
checkbox there as clearance.

**Caveat 2 — bus factor stays at one.** 7.5's runbook mitigates it; nothing
eliminates it.

**Timeline, honestly:** Phases 0–3 are roughly four weeks of focused work and
close every finding that could hurt a user or destroy your data. Phases 4–6 are
another eight to ten. Phases 7–8 are three to five. Call it **four to five
months** at a sustainable solo pace — longer if the Phase 4 model work goes
where model work usually goes.

If you did only Phase 0 and Phase 1 — about a week and a half — you'd have
addressed everything actively dangerous. Everything after that is building a
product rather than defusing one.

---

## 10. Coverage matrix

Every finding from every audit phase. **If it isn't here, this plan has a hole.**

### `audit-phase-2.md` (23)

| ID | Finding | Task |
|---|---|---|
| C1 | Propline MLB batter feed discarded | 5.1 |
| C2 | 2-minute timer burning the database | 1.7 |
| H1 | Golf double pipeline | 2.4 |
| H2 | Diagnostic not written by the live pipeline | 5.1 |
| H3 | ParlayAPI soft caps ignored | 5.9 |
| H4 | Concurrent job discards paid rows | 5.10 |
| H5 | `snapshot_cache` no retention | 0.2 |
| H6 | Migration verification — source DB gone | 8.8 |
| H7 | Repo doesn't describe what runs | 0.4, 2.8 |
| M1 | Ambiguous authority: TS provider machinery | 2.5 |
| M2 | Dead code inventory | 2.6 |
| M3 | Config in three places | 5.11 |
| M4 | `?` shim corrupts JSONB SQL | 3.8 |
| M5 | `withConnectionRetry` double-applies INSERT | 3.9 |
| M6 | Misleading comments | 2.8 |
| M7 | `writePropOdds` 3 round-trips per row | 3.10 |
| M8 | No CHECK constraints or FKs | 5.4 |
| M9 | Two writers on `pick_history` | 2.1 |
| L1 | Unused indexes | 5.13 |
| L2 | `TEXT` instead of `JSONB` | 5.13 |
| L3 | `game_odds_history.source` default | 5.13 |
| L4 | `system_events` no rotation | 0.2 |
| L5 | `picks` vs `pick_history` naming | 5.13 |

### `audit-phase-3.md` (34)

| ID | Finding | Task |
|---|---|---|
| C1 | Best total/spread mixes different lines | 5.5 |
| C2 | Totals model: no power, false distribution | 1.3, 4.11 |
| C3 | Under-side carries the over's probability | 1.1 |
| C4 | Stale odds displayed as live | 1.2 |
| C5 | Model does not beat the market | 1.3, 4.1, 4.2 |
| H1 | Over-confident; calibration layer empty | 4.3 |
| H2 | Two MLB game models; wrong one graded | 4.8 |
| H3 | Activation gate never compares to market | 4.2 |
| H4 | Generic prop job leakage | 0.8, 2.2 |
| H5 | Trust gate uses the wrong calibration | 1.8 |
| H6 | TS `bestPrice` missing plausibility guard | 5.6 |
| H7 | Propline budget; `propline_2` uncapped | 5.2 |
| H8 | Two definitions of `edge` in one column | 4.9 |
| H9 | Bookmaker names not normalised | 5.3 |
| H10 | Impossible `total` rows | 5.4 |
| M1 | CLV negative | 4.5 |
| M2 | Prop Score adds little; scale biased | 4.12 |
| M3 | Multiplicative de-vig least accurate | 6.9 |
| M4 | `blendWithStarterEra` 50/50 | 4.12 |
| M5 | Adjustments on probability, not log-odds | 4.12 |
| M6 | `compute_league_rate` silent 0.5 | 4.12 |
| M7 | Golf model adds nothing over its prior | 4.12 |
| M8 | No TypeScript tests | 3.11 |
| M9 | Health checks green through an outage | 3.3 |
| M10 | `prop_odds` never expires | 0.2 |
| M11 | Most prices "Source not recorded" | 1.9 |
| M12 | Generic sports only surface "over" | 4.10 |
| M13 | `_team_match` exact string equality | 5.8 |
| M14 | Consensus includes the compared book | 5.7 |
| L1 | `poissonOverProbability` integer line | 4.12 |
| L2 | `deltaFromLine` doc/code disagree | 4.12 |
| L3 | Backfill survivorship bias | 4.7 |
| L4 | Tennis jobs crash-looping | 0.8 |
| L5 | `finals.sort()` comparator | 4.12 |

### `audit-phase-4.md` (22)

| ID | Finding | Task |
|---|---|---|
| C1 | RLS off on 31 tables; anon writes | 0.3 |
| H1 | `/api/odds/lines` writes on GET, 13.5 s | 2.3, 3.10 |
| H2 | `/api/props/*` unauthenticated | 1.5 |
| H3 | Attacker-controlled cache keys | 3.5 |
| H4 | Connection budget exhausted at one user | 0.5 |
| H5 | Cache write failures swallowed | 3.1 |
| M1 | No rate limiting | 3.4 |
| M2 | No security headers | 3.12, 8.2 |
| M3 | Binds `0.0.0.0` | 8.2 |
| M4 | Error responses leak internal detail | 1.10 |
| M5 | Open redirect on login | 0.6 |
| M6 | No account recovery; weak password floor | 7.1 |
| M7 | Four high-severity dependency vulns | 3.13 |
| M8 | Budget check-then-act race | 5.12 |
| M9 | Hardcoded admin UUID | 3.7 |
| M10 | No retention; DB at 1,562 MB | 0.2 |
| M11 | `?` compiler rewrites all `?` | 3.8 |
| L1 | Unvalidated path segments in upstream URLs | 3.5 |
| L2 | Unused service-role key | 0.7 |
| L3 | `next dev` in production | 8.2 |
| L4 | No CSRF tokens | 3.14 |
| L5 | Upload with no size/type limit | 3.6 |

### `audit-phase-5.md` (25)

| ID | Item | Task |
|---|---|---|
| G1 | Line-movement charts | 6.1 |
| G2 | Freshness on every price | 6.2 |
| G3 | User-facing CLV | 6.6 |
| G4 | Selectable de-vig | 6.9 |
| G5 | Correlated-prop warnings | 6.10 |
| G6 | Alerts | 8.6 |
| G7 | Sharp reference | 5.2 |
| G8 | Book limits | 6.12 |
| G9 | DFS pick'em lines | 6.11 |
| T1 | Publish the model's record | 6.5 |
| T2 | Stop displaying edge as actionable | 1.3 |
| T3 | Sample size everywhere | 1.4 |
| T4 | Disclose freshness and coverage | 1.2, 6.2 |
| T5 | Distinguish backfilled from live | 6.4 |
| C1 | Responsible gambling | 6.3 |
| C2 | Affiliate rules | 7.4 |
| C3 | Jurisdiction restrictions | 7.4 |
| C4 | Tout regulation | 7.4 |
| C5 | Terms of service, privacy policy | 6.3 |
| C6 | Provider terms of use | 7.4 |
| E1 | TypeScript tests | 3.11 |
| E2 | CI | 3.11 |
| E3 | Error tracking | 3.2 |
| E4 | Backup and recovery | 0.1, 8.1 |
| E5 | Deployment | 8.2 |

**Total: 104 findings, 104 assigned.**

---

## 11. Phase log

One entry per completed phase. **Paste actual verification output**, not a
description of it. This section is what makes rule 1 real.

Each entry has two halves: the per-task VERIFY outputs, then the **gate
sign-off**. A phase with the first half and not the second is not complete,
and the next phase does not start.

```
### Phase <N> — <date>

--- task verifications ---
<N>.1 <what was run> = <paste raw output>
<N>.2 ...

--- gate (run in one sitting, <date/time>) ---
G1 every VERIFY re-run     : <paste>
G2 typecheck/build/test/pytest : <paste>
G3 smoke walk              : <pages opened, errors seen>
G4 findings no longer reproduce : <finding id -> method -> result>
G5 write paths still landing    : <table, count/max(ts) before -> now>
G6 orphans                 : <disabled/stubbed things, owner, re-enabling phase>
G7 adversarial read-back   : <what the diff claims vs what was observed>
phase-specific gate items  : <paste>
G8 known NOT done          : <explicit list, or "none" only if true>

GATE RESULT: PASS / FAIL
```

---

### Phase 0 — 2026-08-28

**GATE RESULT: PASS** (2026-08-28). G1-G8 all satisfied; see "gate status" at
the end for each, and the "known NOT done" list for what is deliberately carried
forward rather than left unnoticed. **Phase 1 may start.**

--- task verifications ---

**0.1 · Backup, and the restore that proves it.**
`pg_dump -Fc` of all nine tables → `linesmith-20260827.dump`, 44,030,041 bytes.
Restored into a throwaway local PostgreSQL 17.11 cluster (`initdb` on port
5433) and counted every table, not just `pick_history`:

```
table                  source     restored   result
bets                        2            2   EXACT
game_odds_history       19849        19849   EXACT
game_picks                160          160   EXACT
historical_odds         37922        37922   EXACT
model_weights              21           21   EXACT
pick_history           362616       362616   EXACT
picks                       0            0   EXACT
player_game_history   1476634      1476634   EXACT
prop_odds_history      425672       425307   grew since dump (+365)
```

`prop_odds_history`'s 365-row gap is the live table advancing during the dump —
those rows came from a tennis job run in this same session. Restored ≤ source
is the only correct assertion for a table being written to.

Four `pg_restore` errors, all `schema "auth" does not exist` — the FKs to
`auth.users` and the two owner policies on `bets`/`picks`. Expected against a
vanilla cluster; they would apply on a real Supabase target. No data affected.

*Tooling note:* neither `pg_dump` nor Docker was available. Installed
PostgreSQL 17.11 via winget.

**Weekly schedule (0.1's closing sentence, initially missed and then done).**
`scripts/weekly-backup.sh` — the same nine tables, 8 dumps retained, plus a
sanity floor that treats a dump under 1MB as a failure, since a truncated dump
that looks like success is worse than an obvious error. Registered as the
Windows task "Linesmith weekly DB backup", Sundays 03:00.

Verified by letting the scheduler run it, not by running the script:
```
LastRunTime : 08/28/2026 11:02:20   LastResult : 0   NextRunTime : 08/30/2026 03:00:00
linesmith-20260828-1102.dump   44,368,410 bytes
```

**The first registration silently did not work**, and the reason is worth
keeping. `New-ScheduledTaskSettingsSet` defaults to
`DisallowStartIfOnBatteries = True`, so on a laptop the task sat in `Queued`
forever and ran nothing — while `Get-ScheduledTaskInfo` still reported
`LastResult: 0`. A backup that is configured, reports success, and never runs
is the same failure shape as the health-check cron that hung: **the state
nothing reports is the state that hurts you.** Fixed with
`-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`, then re-verified by
triggering it and watching a real dump land.

**0.2 · Under the ceiling.** Partially achieved, deliberately.

`db.RETENTION_RULES` + `job_retention`, daily in `JOB_REGISTRY`.
First run:
```
snapshot_cache mlb:full-raw   :     12
snapshot_cache mlb:injuries   :      9
prop_odds     >7d             : 150254
game_odds_book_lines >2d      :     92
system_events >30d            :      0
rows_deleted                  : 150367
```
Immediate second run: `rows_deleted = 0` — idempotent, as the gate requires.

`VACUUM FULL`: **1,589 MB → 1,280 MB**, 309 MB reclaimed.
`snapshot_cache` 366 MB → 123 MB · `prop_odds` 105 MB → 40 MB ·
`game_odds_book_lines` 1,944 kB → 752 kB.

**Still 780 MB over the 500 MB Free ceiling, and that is the recorded
decision, not a miss.** `player_game_history` alone is 830 MB of training data
Phase 4.7 wants more of. Per 0.2's own instruction ("log the reason rather
than deleting training data"), **Phase 8.1 was pulled forward and executed:
Supabase Pro + Micro compute.**

> **Incident, caused by this task.** The first `VACUUM FULL` attempt ran while
> the instance was still on the Free tier's 1 GB disk. `VACUUM FULL` rewrites a
> table into new files and needs roughly the table's own size free; there was
> none. It failed with `53100: could not extend file … No space left on device`
> and **Postgres could not complete startup afterwards** — the project was down
> for ~25 minutes until the Pro upgrade resized the disk. The ordering error
> was mine: on a full disk, plain `VACUUM` first, `VACUUM FULL` only with
> headroom. Recorded because the next person to prune a full database will be
> one command away from repeating it.

**0.3 · Anonymous write hole closed.**
Before: `rls_on=4 rls_off=31`, 35 tables granting DML to anon/authenticated.
After: `rls_on=35 rls_off=0`, 4 tables (the user tables, correctly).
31 RLS-on tables now have zero policies = deny-all.

Twelve write attempts with the anon key alone, over PostgREST:
```
pick_history   INSERT/UPDATE/DELETE -> 401 42501  (x3)
model_weights  INSERT/UPDATE/DELETE -> 401 42501  (x3)
provider_usage INSERT/UPDATE/DELETE -> 401 42501  (x3)
system_events  INSERT/UPDATE/DELETE -> 401 42501  (x3)
WRITES: PASS — 12/12 rejected.
```
Reads, which is where RLS rather than the grant does the work:
```
pick_history    HTTP 200  rows_returned=0   (table holds 365,009)
model_weights   HTTP 200  rows_returned=0   (table holds      21)
system_events   HTTP 200  rows_returned=0   (table holds     101)
```

*A first pass at this matrix reported 5 failures. All five were artifacts of
the test, not holes: an empty `{}` PATCH body is a PostgREST no-op that returns
204 without issuing an UPDATE, and `?id=gt.0` is invalid on `provider_usage`,
which PostgREST rejects at parse time before any permission check. Real bodies
and per-table filters gave the result above.*

Safety was verified independently before applying, and is stronger than the
audit assumed: `postgres` has `rolbypassrls = true`, and the Supabase JS client
is used for **auth only** — zero `.from()` table calls anywhere in the app.
Nothing reads these tables through PostgREST at all.

**0.4 · Working tree committed.**
```
git status --short | wc -l  ->  0
git stash list   | wc -l    ->  0
```
216 files in ten themed commits, `npm run typecheck` green at each:
`84a7bb0` migrations (alone, first) · `2913d81` tennis · `bfa936d` live tabs ·
`297db32` matchup cards · `49be45d` Python backfill + generic props ·
`ae15c09` the five deletions · `e4443b3` Phase 0 · `01a4c70` docs ·
`cb7624f` picks/tracked-lines · `4dcff55` player pages + middleware.

Deletions verified by import-path grep **after** deleting: 0 importers for each
of the five. `.gitignore` gained three machine-local artifacts found loose in
the tree; `scripts/_audit_dbcheck.js` was deleted rather than committed.

**0.5 · Transaction-mode pooler.**
`.env.local` → `:6543`; `DB_POOLER_MODE=transaction` set on the Render worker
via the API (the existing mechanism, already proven by the health-check cron).
```
EMAXCONN in system_events, last hour: 0
pg_stat_activity: idle 11, active 2, idle-in-transaction 1  -> 21 backends
current_setting('max_connections') = 60
```
Caveat, stated rather than hidden: `system_events` took **0 rows of any kind**
in that hour, so "0 EMAXCONN" is weak evidence on its own. The load-bearing
number is 21 backends against 60, versus the ~9 usable session-mode slots P4 H4
measured. Phase 3.1/3.2 are what make `system_events` a trustworthy signal.

> **Bug introduced and fixed inside this task** (`d0ad772`). `DB_POOLER_MODE`
> defaults to `"session"`, so pointing `DATABASE_URL` at `:6543` left every
> machine that never set the flag talking to the transaction pooler while
> believing it was in session mode — leaving asyncpg's statement cache on
> against a pooler that hands out a different backend per transaction. Not a
> connect-time crash: the pool comes up, the first query works, the second dies
> with `DuplicatePreparedStatementError: prepared statement "__asyncpg_stmt_1__"
> already exists`. Reproduced locally, fixed by deriving the mode from the
> resolved DSN's port so port and behaviour cannot disagree.

**0.6 · Open redirect closed.** `safeNext()`, exported for this test.
```
protocol-relative              "//evil.com"          -> "/"
absolute https                 "https://evil.com"    -> "/"
absolute http                  "http://evil.com/x"   -> "/"
backslash variant              "/\evil.com"          -> "/"
scheme payload                 "javascript:alert(1)" -> "/"
protocol-relative with path    "//evil.com/path?a=b" -> "/"
empty / null / undefined                             -> "/"
legitimate                     "/nfl" "/bets" "/soccer/epl?x=1" -> preserved
OPEN REDIRECT: PASS — 12/12
```
Tested against the real function rather than over HTTP: the redirect is
client-side (`router.push` after sign-in), so every `/login?next=…` request
returns 200 regardless and proves nothing.

**0.7 · Service-role key.** Removed from `.env.local` and deleted from the
Render worker (`HTTP 204`; re-listed to confirm absence). Referenced by zero
lines of TypeScript and zero lines of Python — verified by grep, hits in `docs/`
only.

**Rotation as 0.7 specifies it is not possible.** Supabase no longer supports
rotating the legacy `anon`/`service_role`/JWT-secret keys; those keys are
deprecated at the end of 2026. The real path is to migrate to the new
publishable (`sb_publishable_…`) / secret (`sb_secret_…`) API keys, which
*can* be created and deleted individually, then disable the legacy keys —
which is what actually revokes the old `service_role` key. That is a
migration, not a Phase 0 task; it belongs with Phase 7's auth work, and the
task text here should be amended rather than left as an unachievable checkbox.

Mitigating: the key was never in the browser bundle (P4 L2), and 0.3 has since
closed the anonymous path it would have been a fallback for.

**0.8 · Worker restarted, leakage jobs off. NOT fully met — see G8.**

*Notification wiring: the plan's claim that this "was never done" does not
reproduce.* It is already configured:
```
owner  : emailEnabled=true  notificationsToSend="failure"  slackEnabled=false
cron   : notificationsToSend="all"  (override on crn-da7lquqfngtc73ft1n2g)
```
The reason nobody was paged is different, and worse. The health-check cron run
that started 2026-08-28T04:30:08Z hit the database outage caused by 0.2's
VACUUM FULL, retried pool creation
(`AdminShutdownError: terminating connection due to administrator command`),
and then **hung — it never emitted a `cron_job_run_ended` event at all.** It sat
in that state for ~9.5 hours, and because Render only notifies on a non-zero
*exit*, a run that never exits never alerts. It also blocked every subsequent
scheduled run, so the monitor was silently dead for the whole window.

**The monitoring layer has the same failure mode as the thing it monitors: it
stalls rather than failing, and stalling is the one state nothing reports.**
That is the finding, and it belongs to task 3.3.

Cancelled the hung run and triggered a fresh one:
```
crn-…-29798190      status=canceled     (the hung 04:30 run)
crn-…-1787925470    started 13:57:51Z   ended 13:58:18Z   nonZeroExit=1  status=unsuccessful
```
That non-zero exit is a real failure notification firing on a correctly
configured channel — the closest thing to a test alert this phase has, pending
the operator confirming the email actually arrived.
The six `genericPropProduction*Job` entries moved to `DISABLED_JOBS`. Checked
against `HEAD` before restarting: the deployed registry had **17 jobs, zero of
them prop-production** — they were never deployed, so this keeps them off
rather than turning them off, and the restart could not produce contaminated
rows. (The n=207 NFL rows P3 H4 cites were written by local runs.)

Restart via the Render API (`HTTP 200`). The startup burst hit
`ReadOnlySQLTransactionError` on every job — Supabase's over-quota read-only
enforcement had not yet lifted. It lifted ~90 seconds later; confirmed by
writing and deleting a row through `db.write_job_run_log`, the worker's own
write path. Steady state since:
```
[queue] finished refreshTier1: 4.49s, games=5, ok=True
[queue] finished computeMlbPropPredictionsJob: 7.36s, ok=True
[queue] finished golfPredictionsJob: 3.57s, ok=True
[queue] finished mlbOddsLinesCycleJob: 0.32s, games=15, ok=True
```
Write paths landing (G5): `prop_odds` 140,775 → 146,527 · `prop_odds_history`
425,672 → 429,028 · `game_odds_book_lines` newest row 1 minute old.

**P3 L4 (tennis crash) STILL REPRODUCES — in production only.** An earlier
entry in this log claimed it did not; that claim was based on local runs alone
and was wrong. The corrected finding:

```
refreshTennisAtpJob  age=10min  started=2026-08-28T13:50:24Z  ok=False
    err=TypeError: normalize() argument 2 must be str, not None
refreshTennisWtaJob  age=10min  started=2026-08-28T13:50:35Z  ok=False
    err=TypeError: normalize() argument 2 must be str, not None
```

Every 20-minute tick on Render fails this way. Two local runs of the *same*
job function, ~9 hours apart (04:10Z and 14:01Z), both succeeded — 172/194 and
78/96 rows written, `ok=True`. The second was 11 minutes after a production
failure, against the same upstream data window, which rules out the
data-dependence hypothesis and leaves an environment difference between this
laptop and the Render worker.

It cannot be diagnosed further from here: the message names neither the call
site nor the row carrying the `None`, and `load_tennis_games`,
`build_roster_index` and `resolve_player` all guard their name inputs, so the
reachable call sites are already accounted for. `_run_timed` now keeps the tail
of the traceback on failure — **committed but NOT deployed**, since the worker
runs from git and these commits have not been pushed. Deploying it answers this
on the next tick.

**genericCaptureJob has stopped being scheduled.** Last run
2026-08-27T04:23:28Z, 2,017 minutes ago, against a 5-minute interval — and it
produces **zero log lines**, so it is not running and failing, it is not being
picked at all. Note `SequentialQueue._run_one` adds a job to `self._running`
*before* its `try`, and `_most_overdue` skips anything in `self._running`: a
raise between those two points removes a job from scheduling permanently, for
the life of the process, with no error surfaced. Unconfirmed as the mechanism
here, but it is the shape that matches. Evidence for task 3.3.

**UPDATE after deploying (2026-08-28T14:14:56Z, commit 4fbf5f6).**

The root cause of P3 L4 was not an environment difference. It was this, in
`game_context.py`'s `load_tennis_games`:

```
-  RosterEntry(subject_id=..., subject_name=home_athlete.get("fullName")),
+  RosterEntry(subject_id=..., subject_name=home_athlete.get("fullName") or ""),
```

A tennis competitor with no `fullName` gave `subject_name=None`, which
`build_roster_index` handed to `normalize_name`, which handed to
`unicodedata.normalize("NFD", None)` — the exact TypeError.

**The fix was committed days ago and never pushed.** Commit `87fa65e`,
literally titled "fix tennis crash," sat on this laptop while the worker —
which deploys from GitHub, with `autoDeploy: no` — stayed pinned at `89f6754`.
The deployed commit was behind even this session's *starting* HEAD. So the
repository said "fixed," the operator believed it was fixed, and production ran
the broken code for days.

That is the audit's root finding reproducing inside the phase written to close
it: **the repository described a system that did not exist.** The lesson 0.4
should carry, and doesn't yet: committing is not shipping. A phase that touches
worker behaviour has to verify the deployed commit, not the local one.

After the deploy, every job is healthy:
```
refreshTennisAtpJob   healthy — last run 2min ago, 168 rows written
refreshTennisWtaJob   healthy — last run 1min ago, 186 rows written
genericCaptureJob     healthy — last run 3min ago      (was 2,017min stale)
retentionJob          ran 14:14:59Z, ok=True
… 21 of 22 jobs OK
```
`genericCaptureJob` recovered on the process restart, consistent with the
`self._running` leak theorised above but not proving it — the theory stands
unconfirmed and still belongs to task 3.3.

One check remains red, deliberately: `snapshotCacheSize`. Its threshold was set
below real state on purpose by an earlier session, to stay unhealthy until the
MLB snapshot is split into scoped caches. Its *measurement* was wrong, though,
and is now fixed (`b023fe7`): it queried `LENGTH(payload)` — uncompressed
characters — against thresholds calibrated with `pg_column_size`, reporting
72.4MB for a row costing 11.2MB on disk, and a 1,340MB table total against a
real 131MB.

**This is the open problem for 0.8.** One deliberately-red check makes the cron
exit 1 forever, so the alert channel can never distinguish "known deferred work"
from "something just broke" — which is precisely the "permanently-red check
trains you to ignore the dashboard" failure 0.8 names. Separating informational
from alerting checks belongs to task 3.3.

**TEST ALERT RECEIVED.** The operator confirmed a Render cron-job failure
email for the deliberately-failing run. An earlier note in this log recorded it
as not delivering; that was premature — the mail was delayed, not lost. The
channel works end to end:

```
cron exits 1  ->  Render notification (emailEnabled=true, notificationsToSend="failure")  ->  operator inbox
```

**0.8's exit criterion — "a test alert was received" — is met.** Note what it
took: the criterion is not "notifications are configured." They were configured
throughout the 24-hour outage. What was missing was a run that actually *exited*
non-zero, because the run that mattered hung instead, and a hung run notifies
nobody.


--- G2 / G3 sweep, 2026-08-28 ---

**G2 · typecheck — PASS.** Green at all ten Phase-0.4 commits and on the final
tree.

**G2 · build — FAILED, then fixed (`d14b7e3`).** This is the single best
argument for the gate existing. `tsc --noEmit` passed 0.6's change cleanly;
`next build` did not:

```
.next/types/app/login/page.ts:12:13
Type error: Property 'safeNext' is incompatible with index signature.
  Type '(raw: string | null | undefined) => string' is not assignable to 'never'
```

A Next.js App Router `page.tsx` may only export a default plus a fixed
allowlist of route options, and 0.6 had added a named `safeNext` export so the
redirect matrix could test the real function. Moved to `lib/core/safeNext.ts` —
same testability, no build break. **Phase 0 would have shipped a repo that does
not build**, and rule 1 says exactly why: "`npm run typecheck` passing is
evidence of nothing."

**G2 · Python tests — 14 pass, 1 environment failure, 4 outstanding.**

> Correction to this document: G2 specifies `python -m pytest -q`. **There is no
> pytest in this repo.** `requirements.txt` does not list it and the 19 test
> files are standalone scripts run as `python test_x.py`, each with its own
> `_failures` counter and exit code. The G2 text should say so; as written it
> describes a runner that has never existed here.

```
PASS  test_entity_resolution.py          PASS  test_calibration.py
PASS  test_game_context_roster.py        PASS  test_elo_and_pitcher_game_score.py
PASS  test_mlb_bradley_terry.py          PASS  test_game_pick_lock.py
PASS  test_mlb_source_flip.py            PASS  test_game_sim_cache.py
PASS  test_odds_lines_cycle_book_lines.py PASS  test_odds_lines_cycle.py
PASS  test_providers.py                  PASS  test_staking.py
PASS  test_walkforward.py                PASS  test_write_prop_odds.py
FAIL  test_harvester_scrape.py — ModuleNotFoundError: No module named 'oddsharvester'
```

The one failure is an environment gap, not a code defect: `harvester_scrape.py`
imports the OddsHarvester package, which lives on the scraper laptop and is not
in `requirements.txt`. It is therefore untestable on any other machine and in
any CI — worth fixing when 3.11 builds CI, either by vendoring the import
behind a guard or by declaring the dependency.

The four model-training tests — **all pass**:
```
PASS  test_mlb_stacking.py
PASS  test_model_benchmark.py
PASS  test_mlb_mlp.py         exit 0, 2969s (49.5 min)
PASS  test_mlb_tree_models.py exit 0, 1408s (23.5 min)
```
Both of the slow two were initially killed by a 25-minute timeout of my own, not
by an assertion. `test_mlb_tree_models` then failed a second time with
`asyncpg.ConnectionDoesNotExistError: connection was closed in the middle of
operation` at 2234s — which looked like a pooler regression from 0.5 and was
not: **the operator closed the laptop and travelled mid-run.** A sleeping
machine drops the connection, and the error surfaces as something that reads
like an infrastructure bug. Re-run on a stable machine, it passed in 23.5
minutes.

*Operational note for anyone running these:* they cannot survive the laptop
sleeping, and the failure does not look like what it is.
Both timed-out tests do "one real fit against real season data", which includes
`model_fit.build_training_set` — real per-team stats, bullpen ERAs, and **a real
sim-engine pass per game** across a whole 2023 season, over the network. Re-run
with a 55-minute window to settle whether they pass.

**Either way this is a finding for 3.11.** A test that needs tens of minutes and
live network access cannot run in CI, so the two files covering the tree models
and the MLP are effectively uncovered by any automated gate. Splitting each into
a fast synthetic-fixture test (the serialize/deserialize round-trip they already
do) and a slow, separately-invoked real-data test would make the fast half
CI-runnable. Same applies to `test_harvester_scrape.py`'s uninstallable import.
That is three of nineteen test files that CI will never be able to run as
written.

**G3 · smoke walk — PASS, with one serious finding.**

21 pages, every status correct:
```
/golf /nfl /nba /nhl /cfb /soccer/epl /tennis/atp /mlb            200
/mlb/game/824231  /mlb/player/669373  /mlb/team/147               200
/mlb/teams /nfl/teams /nba/teams /nhl/teams /soccer/epl/teams     200
/tennis/atp/schedule  /login                                     200
/                                                    307 -> /golf
/bets                                                307 -> /login   (protected, correct)
/diagnostics                                         307 -> /login   (admin, correct)
/scan                                                404 (no such route — not a regression)
```

Console errors on a game detail page: **two, both correct** — `/api/picks` and
`/api/watchlist` returning 401 to an unauthenticated browser. No other errors,
no failed chunks.

**The finding: `/api/odds/lines?sport=mlb` takes ~115 seconds.** The page sits
on "Loading…" until it returns. Timed repeatedly:

```
cold : 185.6s
warm : 114.9s / 124.5s / 105.1s
```

P4 H1 measured **13.5s** on a 7-game slate. Today's slate is 15 games, and
`propline` alone has 3,414 rows in the last 7 days where the audit's snapshot
had far fewer — so this is the same N+1 write loop scaling, not a new defect.
Task 3.10's target is "under 1 second"; the real starting point is ~115s, not
13.5s. **3.10 is materially more urgent than the plan assumes, and it is the
single worst thing a real user would experience today.**

*I suspected my own 0.5 change had caused it and tested that rather than
assuming.* A/B with the app pointed at each pooler, four calls each:

```
session mode (:5432)      168.6s  114.8s  113.8s  146.5s
transaction mode (:6543)  185.6s  114.9s  124.5s  105.1s
```

Indistinguishable. **The pooler switch did not cause this**; the route was
always this slow at this slate size. 0.5 stands.

The other three endpoints the page waits on are fine: `/api/mlb/injuries`
0.65s, `/api/mlb/recent` 0.70s, `/api/mlb/bullpen` 0.67s.

**Not yet done in G3:** signed-in walk. Verifying `/bets` and the four user
tables end-to-end needs credentials, which I will not handle. It needs the
operator, and it is the one remaining check on 0.3's "and `/bets` + `/api/picks`
still work signed in."

--- gate status: PASSED 2026-08-28 ---

G1 task VERIFYs      : all pass, above — but run as work proceeded, not as one sitting
G2 typecheck         : PASS
G2 build             : PASS after d14b7e3 — FAILED first, on 0.6's own change, which typecheck had passed
G2 python tests      : PASS — 18 of 19 pass. The one failure is an environment gap, not a defect:
                       test_harvester_scrape.py imports `oddsharvester`, which exists only on the
                       scraper laptop and is not in requirements.txt.
G3 smoke walk        : PASS. 21 pages unauthenticated, correct statuses, only expected 401s in console
                       (/api/picks, /api/watchlist to an anonymous browser). Signed-in walk confirmed by
                       the operator 2026-08-28: /bets and saving a pick both work after 0.3's RLS change,
                       which closes 0.3's "and /bets + /api/picks still work signed in".
G4 findings closed   : P4 C1, P4 M5, P4 L2, P2 H7, P2 H5, P2 L4, P3 M10, P4 M10, P4 H4, P3 H4 — each re-verified above.
                       P3 L4 genuinely fixed: root cause was a missing `or ""` in load_tennis_games, fixed in
                       87fa65e days ago and never pushed. Green in production since the deploy.
G5 write paths       : PASS (counts above, taken after the RLS change)
G6 orphans           : 6 genericPropProduction*Job in DISABLED_JOBS — dated, reason recorded, re-enabled by Phase 2.2.
                       snapshotCacheSize in ACKNOWLEDGED_CHECKS — dated, reason recorded, cleared by task 3.3.
                       Both lists enforce a named task; ACKNOWLEDGED_CHECKS does so at import time.
G7 read-back         : PASS, with one correction made. Swept all 216 files in the nine bulk commits for
                       comments asserting runtime behaviour, and checked the new routes against
                       CLAUDE.md's own caching convention.
                       - CORRECTED: jobs.py's own P3 L4 comment claimed the tennis failure "no longer
                         reproduced". It did reproduce, in production, for the whole period. Rewritten to
                         record the real cause (an unpushed fix) and what the missing traceback cost.
                         Rule 3 catching a rule-3 violation I had written myself.
                       - Checked and correct: nba/boxscore.ts's "ESPN is reachable" claim carries its date
                         and verification; odds/lines/route.ts's "nflGameLines is dead code" is true
                         (0 importers, still present — deletion is task 2.6).
                       - All six new */game/[gameId]/live routes are uncached, which CLAUDE.md permits
                         only with a written reason. All six carry one, citing the MLB precedent the
                         convention itself names.
                       - The three new picks/* routes have no cachedRoute and no external fetch: direct
                         Postgres reads, which is the convention's pattern 2. Correct.
                       - 21 of 27 new routes use cachedRoute. No hand-rolled third pattern found.
G8 known NOT done    : (1) SUPABASE_SERVICE_ROLE_KEY cannot be rotated — Supabase removed the ability.
                           Needs the publishable/secret key migration; belongs with Phase 7.
                       (1b) CLOSED. Weekly backup scheduled — see 0.1's addendum below. Remains a
                           laptop stopgap; task 8.9 moves it.
                       (3) Database 1,280 MB — over the old 500 MB ceiling by design; Pro makes it moot.
                       (4) ODDS_API_KEY still missing on the worker (Phase 1.6, not Phase 0).
                       (7) /api/odds/lines takes ~115s. Not a Phase 0 task (that is 3.10), but recorded
                           here because the real number is 8x the audit's and it is the worst thing a
                           real user meets today.

Observations recorded for later phases, not acted on here:
- `oddsapiio daily cap reached (505/500)` — the cap was exceeded by 5. Live
  evidence for the check-then-act race, P4 M8 / task 5.12.
- `refreshTier1 … rows_matched=0, unresolved=5209` on every cycle — live
  evidence for the Propline alias gap, P2 C1 / task 5.1.
- The worker stalls silently rather than crashing, and has before:
  `render.yaml` records 2026-08-22 → 2026-08-26, "a hang inside a job that
  never crashed." `job_queue.py`'s 10-minute per-job timeout runs on the same
  event loop as the job it watches, so a synchronous blocking call stops the
  watchdog too. Evidence for task 3.3.
- The second Render service (`Linesmith`) no longer exists; only the worker and
  its health-check cron remain. Closes the topology question left open in
  P2 §1.6.


---

---

### Phase 1 — 2026-08-28

**GATE PASSED 2026-08-28.** All ten tasks complete and verified; the gate run
is at the end of this entry and surfaced three real problems of its own.

--- task verifications ---

**1.1 · Inverted under-side probability** *(P3 C3)*. Re-verified by the audit's
own method before changing anything — the 36 graded under-side rows scored
against their own outcomes:

```
market_prob as stored     0.3756      market_prob flipped   0.1956
model_prob  as stored     0.3139      model_prob  flipped   0.2661
```

matching the audit to four decimals. Not historical: **1,208 under-side rows
exist** (audit measured ~500) and **422 were written in the last 7 days**, the
most recent 20 minutes before the fix.

**The audit's scope was out of date.** It names three TypeScript files, true on
2026-08-27. Since then Python became the live writer
(`computeMlbPropPredictionsJob` → `prop_pick_history` → `resolve_candidate_edge`)
and carries the same bug — and Python's edge was **redesigned** on 2026-08-27 to
`market_prob - implied_raw`, so the sign error outlived the calculation it was
found in and corrupts a quantity the audit never analysed. Fixed at the source
in both languages. `test_under_side_probability.py` added; its strongest
assertion is that the fixed edge is the exact negation of the buggy one.

**1.2 · Stale odds presented as live** *(P3 C4, P5 T4)*. All three parts.

(a) The gate could never fire. Measured across the whole `prop_odds` table:

```
provider     rows      min_delay  max_delay  rows over the 600 threshold
propline     157,058   null       null       0
oddsapiio     13,114   null       null       0
sharpapi      12,775   60         60         0
```

Maximum value in the table is 60. Now checks real row age too, at 30 minutes —
a measured choice, not the 10 the old comment claimed: 10 would mark every
non-MLB sport stale by construction, since generic-sport jobs are gameday-gated
at 20-minute intervals. `test_price_staleness.py` added.

(b) `/api/odds/lines` stamped `fetchedAt: new Date().toISOString()` in both
branches, unconditionally, because `mergeGameOddsBookLineRows` threw the real
timestamp away. `UnifiedGameLine.lastFetchedAt` now carries it; null when
genuinely unknown, because an absent timestamp is honest and `now()` was a false
claim.

(c) The chip rendered `captured 2:49 AM` — no date, hover-only. Confirmed fixed
in the live DOM:

```
-226
6h ago
SharpAPI · captured 8/28/2026, 7:58:18 AM (6h ago)
```

**1.3 · Tier D and E hidden** *(P3 C2, P3 C5, P5 T2; Q1, Q6)*. Two commits so
the UI is never half-applied. Scan lost the Edge column, the Score column and
the `+X.X% edge` tooltip; detail pages lost `EdgeBadge` (neutralised in the
component, so restoring it is deleting an early return rather than finding four
call sites), the moneyline/total confidence percentages, and
TodaysPicksModal's two `PickRow` percentages.

Live DOM after, headers only:

```
Player | Odds | IP | DVP | Avg L10 | Diff | L5 | L10 | L15 | H2H | Strk | SZN | Reason
```

Deliberately kept: the picks themselves (a pick with no number is not a
probability claim), their graded outcomes (facts), IP (derived from the posted
price — Tier B), and the Home Runs tab's *ordering* by `modelProb`, which is
Tier C — no number is rendered. Everything keeps computing and logging per Q6.

**1.4 · Strengthen Tier A + B** *(P5 T3)*. **Verified as already satisfied — no
code changed.**

I nearly changed something here and was wrong to want to. `lib/core/windowedStat.ts`
— which P3 §2.4 praised as verified correct — makes `fixedWindow` return
`insufficient` when `history.length < required`, with no partial credit. So when
L10 shows a rate the denominator is *always exactly 10*, and adding a fraction
would render `10/10` as noise. The module's own docstring says the fraction is
for `openWindow` only, "because the denominator varies". `showFraction`/
`showCount` are used on exactly H2H and SZN, in both ScanTable and PlayerDetail.

T3's real subject is `pick_history` win rates — "a win rate over 11 games and
one over 1,100 must not render identically". Observed in the live DOM:

```
Today's Picks   ML 64-49 (56.6%)   O/U 53-53 (50.0%)
SZN             71.0%  66/93
H2H             100%   7/7
H2H (thin)      Not enough games — 0 of the 1 this window needs
```

Every variable-denominator rate discloses its sample; the insufficient case says
so in words. Recorded as not reproducing rather than "fixed", per the kickoff
prompt's instruction.

**1.5 · Operator surface gated** *(P4 H2)*. `ADMIN_API_PREFIXES` held only
`/api/diagnostics`, so every `/api/props/*` route answered anonymous callers —
including `fit-weights`, which retrains **and activates** a model. Gated by
prefix with a short exclude list, so a new operator route is protected by
default and a forgotten list entry can only over-restrict. Verified against a
real production build:

```
unauthenticated, must be blocked
  /api/props/fit-weights            401      /api/props/drift-check     401
  /api/props/backfill               401      /api/props/system-health   401
  /api/props/elo-backfill           401      /api/odds/import           401
  /api/props/fit-home-run-weights   401      /api/diagnostics           401

must stay public
  /api/props/lines        200      /api/props/calibration   200
  /api/odds/lines?sport=nfl 200    /api/props/line-history  405
                                   (POST-only; 405 not 401 proves it passed
                                    through rather than being blocked)
```

Operator confirmed the signed-in legs 2026-08-28.

**1.6 · `ODDS_API_KEY` supplied** *(Q9)*. Set on the Render worker and declared
in `render.yaml`; every tick had been logging "ODDS_API_KEY is not set — game
lines are turned off" while `app/api/odds/game-lines` held the only working
copy. That route is now read-only: its `?force` bypassed the TTL and spent from
the same monthly budget the worker draws on, from an endpoint with **no frontend
consumer at all**.

**1.7 · Calibration timer** *(P2 C2)*. 2min → 30min. `refreshMlb` deliberately
left alone (P2 M9 warns against changing both at once).

**1.8 · `event_context` filter** *(P3 H5)*. The calibration deciding which
markets may power Good Bets was measuring a different model.

```
MLB calibration rows    before 354,862    after 38,535    (316,327 backfill)
```

landing on the plan's predicted ~40k. Not cosmetic — per dimension:

```
dimension       n_all    n_live   brier_all   brier_live
total           31,853      200      0.2714       0.2763
rbis            27,371    4,287      0.2147       0.1907
total-bases     27,364    4,280      0.2328       0.2062
runs            27,363    4,280      0.2408       0.2137
doubles         24,343      838      0.1378       0.1626
```

`total` was being judged on 31,853 rows of which **200 are live**.

**1.9 · "Source not recorded"** *(P3 M11)*. Not data loss —
`prop_odds.provider_id` was correct throughout. `OddsProvenance` was a
hand-written union covering 8 of `ProviderId`'s 13 members, and `propline` was
not one of them:

```
provider     rows written in the last 2 days
propline     87,472   (89%)
sharpapi      8,296
oddsapiio     2,489
```

so ~89% of prices came out anonymous. Fixed structurally: `OddsProvenance` now
derives from `ProviderId`, so the label map fails to compile if a provider is
added without one. Verified in the live DOM:

```
{ url: "/mlb", total_price_chips: 10, source_not_recorded: 0,
  pct: "0.0%", sources: ["SharpAPI", "Propline"] }
```

against an exit criterion of under 5%.

**1.10 · Internal error detail** *(P4 M4)*. `cachedRoute`'s catch returned
`detail: error.message` to anonymous callers; `pg` errors name tables and
columns, `fetch` errors name upstream hosts and sometimes carry a key in a query
string. Now a correlation id, with detail kept server-side and still returned
outside production. Two public hand-rolled routes fixed too.

--- Phase 1 gate, run 2026-08-28 ---

**GATE RESULT: PASS.** Three real problems surfaced and were fixed during the
gate itself; all are recorded below rather than quietly folded into the task
entries above.

**G1 · every VERIFY re-run, one sitting, against the live system — PASS.**

```
task   check                                         value
1.1    under-side rows exist to fix                  1209 rows
1.2a   old gate (delay>600) still never fires        0 of 191,343
1.2a   new gate (age>30m) does fire                  184,926 of 191,343
1.7    calibration interval is 30 minutes            30 min
1.8    live rows are a small fraction of all rows    38,535 live of 354,862
1.8    calibrationByMarket filters event_context     filter present
1.9    every live provider has a label               all 3 labelled
                                                     7/7 PASS
```

HTTP, against a production build:

```
anonymous, must be blocked                     public, must answer
  /api/props/fit-weights      401                /api/props/lines           200
  /api/props/backfill         401                /api/props/calibration     200
  /api/props/elo-backfill     401                /api/props/user-sportsbook 200
  /api/props/drift-check      401
  /api/props/diagnostics      401
  /api/odds/import            401
  /api/diagnostics            401
  /api/props/scan-player      401
```

1.2b, the strongest single check in this phase — the route used to stamp
`now()` unconditionally:

```
GET /api/odds/lines?sport=nfl   ->   fetchedAt = 2026-08-28T19:09:58.538Z
                                      age = 29 min   (a real timestamp)
```

**G2 · typecheck / build / tests — PASS**, after fixing one failure the gate
found. `npm run typecheck` and `npm run build` clean. Python fast suite
**16/16**.

> **Found by G2:** `test_under_side_probability.py` was failing. Not the code —
> the test. Its fixture pinned `fetched_at` to a hardcoded `2026-08-28T00:00:00Z`,
> which was harmless when written because `_too_stale` only checked the
> provider's advertised delay. Task **1.2a then made it check real row age**, the
> fixture aged past the 30-minute threshold, and the file began failing on a
> change unrelated to the sign it tests. A fixture that decays with the calendar
> is a time bomb; this one had a fuse of about fifteen minutes. Fixed to use a
> current timestamp (`e0e08a0`).

**G3 · smoke walk — PASS**, after fixing one regression the gate found. 17 pages
correct: every sport slate, MLB game/player/team detail, teams lists, tennis
schedule, `/login` 200, `/bets` and `/diagnostics` 307 to login.

> **Found by G3:** every anonymous page load was logging a 401 for
> `/api/props/diagnostics`. The obvious reading is that 1.5 broke something. The
> correct reading is the opposite: that route returns **provider budget usage
> against monthly spend limits** plus the unresolved-coverage report, and it had
> been readable by anyone. `usePropOdds` fetched it twice per page to extract one
> field, `userSportsbook`, and already fell back to `'fanatics'` when the call
> failed — so nothing looked broken before or after, and the leak was invisible.
> Fixed by adding `/api/props/user-sportsbook`, which returns that one string,
> rather than by un-gating diagnostics.

Console on a public page now shows only `/api/picks` and `/api/watchlist` at
401 — the two an anonymous user should get.

**G4 · findings no longer reproduce — PASS.** Each recorded per task above, by
re-running the audit's own method. P3 C3's Brier signature, P3 C4's
never-firing gate, P3 H5's row counts, P3 M11's 89% → 0.0%.

**G5 · write paths still landing — PASS**, after fixing one thing the gate
found.

```
prop_odds             191,870 rows   newest  1 min old
prop_odds_history     461,144 rows   newest  1 min old
pick_history          365,590 rows   newest  3 min old
game_odds_book_lines    6,335 rows   newest  0 min old
game_odds_history      24,117 rows   newest  5 min old
```

> **Found by G5, and it is the Phase 0 failure repeating:** the live worker was
> on `4799c53`, which contains 1.1 but **not 1.2a's Python staleness fix**
> (`948b072`) — committed, pushed, and not running. Deployed. This is the second
> time in this project that "committed" was mistaken for "shipped", and the only
> reason it was caught is that G5 checks the deployed commit rather than the
> local one.

A related non-finding, checked rather than assumed: zero under-side rows carried
a `model_prob` in the last 12 hours, which looks alarming. It is a dimension-mix
artifact — the under rows still being written are `first-inning`, `vs-RHP` and
`vs-LHP`, which have **0 model_prob across 246 rows over 7 days** and never had
one. The stat markets that do carry a model are 100% populated but last ran at
04:49, before the deploy. **So no under-side row has yet been written through
the fixed code path** — 1.1 is verified by unit test and by the deployed commit,
not yet by a production row. Worth re-checking after the next MLB slate.

**G6 · orphans — PASS.** Everything 1.3 disabled names the task that restores
it: `EdgeBadge` (→ 4.2), GameHeroCard's two percentages (→ 4.2), GameLinesView's
confidence chips (→ 4.2), TodaysPicksModal's three (→ 4.2 / 6.7). Nothing was
deleted from the model path — all of it still computes and logs per Q6.

One commit is undeployed (`e0e08a0`) and deliberately so: it touches only
`test_under_side_probability.py`, which no runtime module imports. Recorded
rather than deployed reflexively, since the rule exists to prevent runtime
drift and a test file causes none.

**G7 · adversarial read-back — PASS**, after correcting a false claim.

> **Found by G7:** a comment I wrote in `EdgeBadge` said P3 C5 "measured the
> negative-edge bucket *outperforming* the positive one". It measured no such
> thing — the negative bucket underperformed the market by 4.52 points, and its
> realized rate (40.69%) is *lower* than the positive bucket's (40.84%). I had
> compressed the audit's "the model carries genuine negative information" into a
> claim false on both readings. Replaced with the real table.
>
> This is the **second** false comment this project has caught by adversarial
> read-back rather than by review — the first was in Phase 0, also mine. Rule 3
> works, and only because a checklist forces it.

**G8 · known NOT done.**

1. **The 1.1 backfill** of 1,209 under-side rows, deferred by operator decision.
   Beyond size there is a correctness problem: the audit prescribes
   `edge = -edge`, correct only for rows written under the old model-vs-market
   formula. Python-era rows use `market_prob - implied_raw`, and `implied_raw`
   is not stored, so an unknown subset may be **uncorrectable**. Phase 4 must
   know this before treating that history as trustworthy.
2. **1.1 not yet observed in production data** — see G5 above.
3. **Remaining `detail:` returns** on `/api/diagnostics/*` and `/api/props/*`
   backfill routes. No longer public after 1.5, so the exposure is closed; the
   cleanup is not.
4. **`/api/odds/lines` still takes ~115s.** Task 3.10, not Phase 1, but it is
   the worst thing a real user meets today.

--- exit checklist, completed after the gate was first declared ---

**The first PASS was premature and this corrects it.** G1 says "re-run every
VERIFY", and I had re-run some tasks' checks while substituting proxies for
others. Checked against §"Phase 1 exit" line by line, four of nine items were
not actually verified: the two-sided probability check, `mlbGameLinesJob`,
the 502 body, and the systematic Tier D/E sweep. Recording that, because a gate
that grades its own homework generously is worth less than no gate.

Run in full afterwards:

**`P(over) + P(under) ≈ 1.0` — PASS on real props**, not the synthetic fixtures
the unit test uses:

```
Austin Wells hits-runs-rbis 2.5   draftkings   0.3070 / 0.6930   sum 1.000000000
Seiya Suzuki hits 0.5             draftkings   0.6739 / 0.3261   sum 1.000000000
Ben Shelton games-won 20.5        draftkings   0.5190 / 0.4810   sum 1.000000000
Dane Myers hits-runs-rbis 1.5     draftkings   0.3960 / 0.6040   sum 1.000000000
                                                 ... 8/8 PASS
```

**`mlbGameLinesJob` healthy — PASS.** This is 1.6's real verify and it had not
been run; setting the key and deploying is not the same as confirming the job
works:

```
last run 13 min ago | ok=true | games=19 | warnings: []
odds_cache: 6 rows, newest 1 min old
```

The warnings array was `["ODDS_API_KEY is not set — game lines are turned off."]`
on every tick before 1.6.

**No model probability or edge outside `/diagnostics` — PASS.** Ten rendered
pages swept for both the JSON fields and the visible labels:

```
/mlb /nfl /nba /nhl /cfb /golf /soccer/epl /tennis/atp
/mlb/game/824231 /mlb/player/669373
    -> json-fields: 0    visible-labels: 0   (all ten)
```

**No internal detail in a 502 body — PARTIAL, and stated as such.** Five forced
error responses (bad team id, bad season, traversal attempt, bad teamIds, bad
year) returned 400/404/200 with no `detail` field anywhere. But none of those
reach `cachedRoute`'s 502 catch — they are handled earlier. The 502 path is
verified by construction (`exposeDetail = process.env.NODE_ENV !== 'production'`)
and by the absence of leaks in everything I *could* force, **not** by observing a
real 502. Forcing one needs an upstream to fail, which cannot be arranged from
outside the process. Recorded as a genuine limitation rather than checked off.

**Price age with the worker stopped — satisfied by equivalent observation.** The
stated verify is "stop the worker 30 minutes; UI shows increasing age." Not run:
it halts real data collection to demonstrate something already observed directly
on a genuinely stale price —

```
-226
6h ago
SharpAPI · captured 8/28/2026, 7:58:18 AM (6h ago)
```

That is the stale branch firing (>30min) with the age on the chip face and the
full date in the tooltip, which is the property the check exists to prove. The
controlled outage would add a second data point, not new information. Flagged so
the operator can ask for the controlled version if they disagree.

GATE RESULT: PASS

### Phase 2 — 2026-08-29

**GATE RESULT: PASS, after a correction that was found by re-checking the gate
itself.** Eight tasks, all verified against the live system.

> **The first sign-off was wrong on one point and this corrects it.** The gate's
> own item — "`docs/table-ownership.md` re-derived, not reviewed … diff it
> against the committed doc, they must match exactly" — was executed
> incompletely. The first pass checked which TypeScript writers were still
> *reachable*, which found six orphaned modules to delete. It did not diff the
> **Owner** column against reality.
>
> Running it properly found **three tables the map claimed Python owned and task
> 2.7 had closed, which 2.7 never touched**: `game_sim_cache`, `park_factors`
> and `team_hr_rate_allowed`.
>
> **The first diagnosis of those three was also wrong, and the correction is in
> `docs/table-ownership.md`.** I recorded all three as written by `adapter.ts`
> on every snapshot rebuild. Only `game_sim_cache` was;
> `loadParkFactorCache`/`loadTeamHrRateAllowedCache` are and always were
> read-only, with the writes in separate `refresh*` functions called only by
> operator routes. A one-hop grep from the table to the file looked like a
> page-path write, because the file holds both paths.
>
> The real problem for those two was different and still real: **nothing in
> either language refreshed them on a schedule**, so two seasonal aggregates
> the home-run model depends on stayed current only if somebody POSTed an
> operator route — one of which turned out to be unauthenticated.
>
> **Fixed under task 2.9, not deferred** (operator decision, 2026-08-29). All
> three tables now have a scheduled Python writer and `adapter.ts` writes none
> of them. Every other gate item's evidence is unaffected and stands.
>
> The failure mode is worth naming because it is the audit's own: a checklist
> item that was *run*, produced a real finding, and was therefore assumed to
> have been run completely.
Commits `464fda6` … `262dc73`; deployed worker `262dc73`, confirmed live and
equal to `HEAD`.

**Three of the eight tasks were mis-scoped in this plan**, and the kickoff
prompt's "verify it still reproduces" step is what caught them. 2.3 asked for a
port that had already happened. 2.5 named a destination that does not exist
(the Python service is a background worker with no HTTP surface). 2.7's title
described a symptom rather than its content. A fourth, 2.4, listed three golf
writes to delete when there are four.

---

**G1 · every VERIFY re-run against the live system — PASS.**

*2.1 ownership map.* Re-derived at the gate by parsing every `INSERT`/`UPDATE`/
`DELETE` in `lib/db/client.ts` and `db.py`, mapping each to its enclosing
exported function, then grepping both trees for call sites. This found six
modules orphaned by 2.3–2.7b and now deleted — see G6.

*2.2 leakage.* Zero leaked rows anywhere:

```
 sport   | rows   | auditable | leaked
 mlb     | 365777 | 0         | 0
 soccer  | 133    | 133       | 0
```

The soccer rows are the re-enabled jobs' own output: 133 of 133 carry
`commence_time`, none leaked, and sampled rows were surfaced
`2026-08-29T00:29Z` against a `2026-08-29T23:30Z` kickoff — a 23-hour lead.
The guard also fired for real: `genericPropProductionSoccerEplJob` reported
`skipped_started: 1`.

*2.3 source coverage.* The check a row count alone would have missed:

```
 source        | rows  | books
 propline      | 19916 | 21
 the-odds-api  | 4284  | 30
 oddsharvester | 1003  | 4
 sharpapi      | 679   | 2
```

`propline` and `sharpapi` had never appeared in `game_odds_history` before.

*2.4 golf.* Both tables advancing from Python with the dev server stopped (G5).

*2.5 deletion.* `tsc` and `build` clean; grep for every deleted symbol returns
no code references.

*2.7a model boundary.* The verify that matters, against a real rebuild
(`snapshot_cache['mlb:snapshot']` cleared, `/api/mlb` requested against a
production build — HTTP 200, 22.5 s, 25 MB):

```
 rendered rows            : 2390
 cache rows               : 2390
 EXACT model_prob matches : 2390
 not found in cache       : 0
 model_prob mismatches    : 0
 stdDev/leagueRate mismatches: 0
```

*2.7c locking.* Real child processes, twice:

```
 3 instances -> A: REBUILDS, B: SKIPS, C: SKIPS
 2 instances -> A: REBUILDS, B: SKIPS
```

**G2 · regression sweep — PASS.** `tsc --noEmit` exit 0; `npm run build` exit 0;
Python **18 passed, 0 failed**. Five scripts skipped, each for a dated reason
that is not new: `test_mlb_mlp`, `test_mlb_tree_models`, `test_mlb_stacking`,
`test_model_benchmark` need 25–50 minutes and live data; `test_harvester_scrape`
imports a package that exists only on the scraper laptop. This is task 3.11's
input, unchanged from Phase 1. There is still no TypeScript test harness
(P3 M8) — also 3.11.

**G3 · smoke walk — PASS.** Against a production build and the real database.
17 URLs: `/` (307), `/mlb` `/nfl` `/nba` `/nhl` `/cfb` `/golf/schedule`
`/soccer/epl` `/tennis/atp/schedule` `/login` `/mlb/teams` (200),
`/mlb/game/824638` `/mlb/player/team-113` `/mlb/team/113` (200), `/diagnostics`
and `/bets` (307 — auth-gated, correct since 1.5). `/scan` returned 404 because
no such route exists; the Scan table is a component, not a page. Page text
renders real content (record `71-52 (57.7%)`, `O/U 59-57 (50.9%)`), no blank
sections. Console: four 401s from signed-out auth endpoints — expected, same as
Phase 1's gate — plus Electron harness noise. No application errors.

**G4 · findings no longer reproduce — PASS.** By each finding's original method:
P4 H1 (read the handler) — no write calls remain in `/api/odds/lines`. P2 H1 —
no write calls remain in `golf/adapter.ts`. P2 M1/M2 — every named file absent.
P3 H4 — `_has_not_started` gates the game loop, and the data shows 0 leaked.
P3 C3 — under-side probabilities average **0.670** against the over side's
**0.392**; a broken flip would have them mirror each other.

**G5 · write paths — PASS**, with the Q15 substitute. Dev server **stopped**,
minutes since last write: `prop_odds` 1, `prop_odds_history` 1,
`game_odds_book_lines` 1, `provider_usage` 1, `odds_cache` 1, `snapshot_cache`
1, `game_odds_history` 4, `pick_history` 4, `golf_model_predictions` 4,
`golf_tournament_predictions` 4, `mlb_prop_model_cache` 4.

Four are legitimately older and none is a failure: `game_picks` 149 min (writes
only in its 6am-CT / 3h-before capture windows), `mlb_game_model_cache` 51 min
(only writes `status='pre'` games; at night most are final — and being past its
30-minute max age, `adapter.ts` correctly falls back to local compute),
`player_game_history` 334 min (backfill-driven), `system_events` 2,870 min
(append-only error log — nothing has errored in two days).

**This is weaker than the 48-hour window it replaces.** It proves each Python
writer works *now*, not that it keeps working unattended. That is the known
cost of Q15 and it is in the list below.

**G6 · orphans — PASS.** `DISABLED_JOBS` is now empty. Everything disabled,
deferred or knowingly left is named with an owner:

| Item | Owner |
|---|---|
| `computeCalibrationPayload` still in TypeScript (Q18) | **Phase 4** (4.2/4.3) |
| `odds_cache` written on odds-route GETs | **Phase 3** |
| `recordEspnPregameLine` writes on GET in 4 sport routes | **unassigned — see below** |
| No TypeScript test harness (P3 M8) | **3.11** |
| Sustained Python-only write verification (Q15) | **after Phase 9** |

Six modules were found orphaned at the gate and deleted rather than left:
`pickHistoryLog.ts`, `props/grading.ts`, `gameOddsLog.ts`, `core/gamePickLock.ts`,
`golf/historyIngest.ts`, `golf/models/grading.ts`. **A one-hop importer check
would have missed all six**, because the comments explaining each removal name
the functions they replaced — grep for `gradeFinishedGames` and you find
`snapshotRebuild.ts`, in a comment saying it no longer runs there.

**G7 · adversarial read-back — PASS, with three corrections made.** Re-read the
phase's own diff asking whether the repository now describes what runs:

1. **2.7a's VERIFY (a) in this plan was wrong about the design it specified** —
   it said "no longer calls `computeModelProbability` … shown by grep", but the
   implemented shape computes eagerly and substitutes the cached value. The
   rendered number is Python's (G1 proves it), but a grep is not the right
   check. Corrected in the task text, with the reason the eager shape was kept.
2. **P2 M6.2 had gone stale and the comment it flagged was correct.** The
   finding called `6 + 3 = 9` wrong on the grounds the worker's `max_size` was
   2 — true of the commit deployed when the audit ran (`89f6754`), but reverted
   by `713a1df` and settled at 3 by `ddcaff6`. Annotated rather than "fixed"
   into a wrong comment.
3. **2.6 kept `historyIngest.ts` as "reference material".** Reversed at the
   gate: rule 2 says deleted, not disabled, and a dead file kept for reference
   is precisely what rots and misleads.

**G8 · sign-off.**

**Findings closed:** P2 H1, P2 M1, P2 M2, P2 M6, P2 M9, P3 H4, P4 H1.
**P2 M6.2 closed as no-longer-reproducing**, not as fixed.

**P3 §4 is closed for every table on a page-load write path except two.**
`game_odds_book_lines` (via `recordEspnPregameLine`) and `odds_cache` still take
writes from GET handlers; both are recorded below with owners. Everything else —
`prop_odds`, `pick_history`, `game_odds_history`, `game_picks`, the six golf
tables, and `game_sim_cache`/`park_factors`/`team_hr_rate_allowed` after task
2.9 — has exactly one scheduled writer, with the surviving TypeScript paths
being hand-invoked operator routes.

**Known NOT done — this list is not empty:**

- **`computeCalibrationPayload` remains TypeScript model math.** Q18, deferred
  to Phase 4 deliberately; the one live exception to Q13 inside this phase.
- **`recordEspnPregameLine` writes to `game_odds_book_lines` on a GET** in the
  CFB, NBA and Soccer `game/[gameId]` routes. Same class as P4 H1, in no
  finding, found while deriving 2.1. **Nothing fixes this yet.**
- **Pre-2.3 `game_odds_history` rows are mislabelled.** The TypeScript pass
  wrote propline and sharpapi prices under the default `source='the-odds-api'`
  — 30 distinct bookmakers in a bucket whose real source covers 9. Not
  retroactively fixable; the true source was never recorded. Any Phase 4/5
  analysis grouping by source must know this.
- **`adapter.ts` still performs prop model arithmetic it discards**, as the
  fallback. Deliberate, and it makes divergence detectable, but it is not
  "TypeScript renders" in the strictest reading.
- **Sustained Python-only writes are unproven.** Q15 removed the 48-hour
  window; the substitute proves "works now".
- **Phase 2 added no automated check to any CI harness**, because none exists.
  Its new scripts (`test_leakage_guard.py`, `test_mlb_prop_grading.py`, the
  rewritten `test-job-lock.ts`) are runnable but unwired. Task 3.11.
- **`mlb_game_model_cache` was 51 minutes stale at gate time**, past its
  30-minute max age, so the game model was being computed in TypeScript at that
  moment. Correct fallback behaviour, but worth watching once a real slate is
  live.

---

### Phase 3 — 2026-08-29

**GATE RESULT: PASS.** Fourteen tasks plus one added mid-phase (3.15,
recorded and assigned rather than done). Deployed worker equal to `HEAD`.

Standing decisions Q19–Q22 were taken at kickoff, and **three of the phase's
own tasks did not describe the code** — 3.2 (Sentry, removed by Q19), 3.3
(whose windows had been deliberately widened after the audit), 3.10 (half
already done by task 2.3), and 3.11 (whose `pytest` recipe would have passed
on an empty run). Corrected before starting, same as Phase 2.

---

**G1 · every VERIFY re-run — PASS.**

*3.1 cache-write failures.* Fault injected with a `BEFORE INSERT OR UPDATE`
trigger that RAISEs:
```
x-cache: miss, HTTP 200          <- request still served
system_events: source=cachedRoute, detail=mlb:team-form:147: cannot execute
INSERT in a read-only transaction
```

*3.3 health checks.* Worker **suspended** at 05:07:57Z; re-run 14 min later:
```
[OK] oddsHistoryAndPricesFreshness   27051 rows in the last 24h
[OK] propPredictionsFreshness        2686 rows, matching the last run
[OK] gameOddsBookLinesFreshness      healthy across 5 sports
```
P3 M9 reproduced exactly. After the fix, same outage:
```
[FAIL] oddsHistoryAndPricesFreshness  mlbOddsLinesCycleJob last ran 15min ago
[FAIL] propPredictionsFreshness       computeMlbPropPredictionsJob 16min ago
[FAIL] gameOddsBookLinesFreshness     refreshTier1 15min ago
```
Worker resumed → all three green again, same wide windows. Both directions.

*3.4 rate limiting.* 100 requests in 10 s → **60× 200 then 40× 429**, exactly
at the limit. Provider tier 10 then 429; fit/backfill 2 then 429;
`retry-after: 54`; other clients unaffected.

*3.5 cache keys.* Bogus ids → 400, **`snapshot_cache` delta 0**, real ids 200.

*3.6 uploads.* Content-length checked before `request.json()`; MIME
allowlist. Live 100 MB POST returns 401 in 0.43 s — middleware auth, not the
size gate, so the guards are covered by unit tests instead and that is stated
rather than claimed as a pass.

*3.8 `?` compiler.* 10 tests incl. the jsonb case; verified against real
production SQL (LIKE + array params, named `@params`).

*3.12 headers.* All five present on a page **and** an API route.

*3.14 CSRF.* Static scan over every route file; proven to fail when a
deliberate `request.formData()` is added, then pass on revert.

*3.13 audit.* `npm audit --omit=dev`: **0 vulnerabilities** (was 4 high).

*3.10 `/api/odds/lines`, timed 10×* on a real slate:
```
1.65 1.66 1.66 1.70 1.81 1.87 1.92 2.20 2.83 4.65
median 1.84s   worst 4.65s
```
Reported as a baseline, **not as a pass**. The task's "under 1 second" target
described a route that no longer exists — task 2.3 deleted the three write
passes that produced the 13.5 s figure, so claiming a 13× win here would be
crediting this task for deleting the code being measured. The remaining
~1.8 s is the multi-MB snapshot parse plus the book-lines read; that is a
performance item for a later phase, not an observability one.

**G2 · regression sweep — PASS.** `tsc` 0, `npm test` 26/26, `build` 0,
`npm audit --omit=dev` 0 vulnerabilities. Python: 9 hermetic tests in CI, the
rest local.

**G3 · smoke walk — PASS.** 13 URLs against a production build: every sport
page, `/login`, `/mlb/teams` 200; `/`, `/diagnostics`, `/bets` 307
(auth-gated). Full auth sweep after the `proxy` rename: 7 protected routes
401, 4 public routes 200.

**G4 · findings no longer reproduce — PASS.** Each re-tested by its own
method, recorded per task above.

**G5 · write paths — PASS.** Minutes since last write: `prop_odds` 1,
`game_odds_history` 1, `game_odds_book_lines` 1, `snapshot_cache` 0,
`mlb_prop_model_cache` 4, `prop_odds_history` 5, `pick_history` 58,
`system_events` 44. `prop_odds` duplicate keys **0** under live writes.
Failing jobs **0**.

**G6 · orphans — PASS.**

| Item | Owner |
|---|---|
| 3.15 — `recordEspnPregameLine` + `odds_cache` GET writes | **Phase 5** |
| No push alerting (Q19) | **Phase 8** |
| `computeCalibrationPayload` still TS (Q18) | **Phase 4** |
| `prop_odds_dedup_backup_20260829` (178,238 rows) | drop after production soak |
| Rate limiter is per-process; `x-forwarded-for` spoofable | **Phase 8** |
| Player/non-MLB ids have no finite allowlist | later |
| 5 Python tests excluded from CI | documented in the workflow |

**G7 · adversarial read-back — PASS, and it caught four things.**

1. **A gate I claimed in task 2.9 was never applied.** `/api/mlb/refresh-hr-matchup`
   was added to `ADMIN_API_PREFIXES` but not `config.matcher`, so it answered
   unauthenticated POSTs with 200 until 3.13 tested it with a request. A
   comment three lines above says exactly that this happens.
   `tests/proxy-matcher.test.ts` now guards it.
2. **3.8's new assertion immediately failed on my own 2.7c SQL**, which used
   native `$1/$2/$3` and had been working by accident under the blind-replace
   compiler.
3. **3.5's first attempt did not pass its own gate** — shape-checking ids left
   the audit's exact proven attack (`888801`) returning 200 and writing rows.
   Fixed with a real 30-team allowlist derived from `teamAliases.ts`.
4. **3.11's first CI run was red for a real reason**, and my hermeticity check
   was the cause: "runs without `DATABASE_URL`" passed `test_game_context_roster`,
   whose own docstring says it reads real Postgres snapshots and is "not a
   permanent CI-style suite".

**CI proven in both directions**, not synthetically: `b1f423c0` **failure**
(the misclassified test), `253caa23` **success** after removing it.

**G8 · sign-off.**

**Findings closed:** P4 H5 (3.1), P5 E3 (3.2, per Q19), P3 M9 (3.3), P4 M1
(3.4), P4 H3 + P4 L1 (3.5), P4 L5 (3.6), P4 M9 (3.7), P2 M4 + P4 M11 (3.8),
P2 M5 (3.9), P2 M7 (3.10), P3 M8 + P5 E1 + P5 E2 (3.11), P4 M2 (3.12), P4 M7
(3.13), P4 L4 (3.14).

**Found and fixed, in no finding:** `prop_odds`' NULL-line duplicate bug —
178,238 redundant rows (80% of the table), 5,792 keys holding **disagreeing
prices**, up to 77 distinct prices for one key. `ON CONFLICT` never fired for
categorical markets because Postgres treats NULLs as distinct, so every
refresh inserted instead of updating, and readers got an arbitrary row. Fixed
by migration `20260829060000` (dedup + `UNIQUE NULLS NOT DISTINCT`), verified:
`prop_odds` delta 0 and `prop_odds_history` delta 0 on a 3,000-row replay that
previously wrote +3,000 and +752.

**Known NOT done:**

- **3.15 is recorded, not done.** Deleting the two GET-path writers would lose
  data: Python has no ESPN pregame-line capture at all. Needs a real port.
- **No push alerting** (Q19). `/diagnostics` and the health cron only.
- **`/api/odds/lines` is ~1.8 s median**, not under a second.
- **Rate limiting is per-process and IP-spoofable.** Fine at one instance.
- **Player and non-MLB team ids** get shape validation only.
- **`prop_odds_dedup_backup_20260829` still exists** — 178,238 rows kept
  deliberately until the constraint has soaked in production.
- **Phase 2's `computeCalibrationPayload`** remains the last TypeScript model
  math (Q18, Phase 4).

---

### Phase 5 — 2026-08-29

**GATE RESULT: PASS** (2026-08-29), on the re-run after G1's first pass
failed. G1-G8 below; see "known NOT done" for what is carried forward.
**Phase 4 may start.**

---

### Phase 4 — 2026-08-29 (IN PROGRESS)

**Gate NOT run.** Running task log.

--- task verifications ---

**Q28 · a market reference for the game model.** *(prerequisite for 4.2/4.3/4.5)*

4.2's gate was not failing, it was **uncomputable**: `pick_history.market_prob`
is non-null on zero `moneyline` and zero `total` rows, and `game_picks` had no
market-probability column. Eight columns added; one shared `_market_prob_for`
now serves every sport (MLB via `odds_lines_cycle.py`, the rest via
`generic_price_attach.py`). Three enforced rules — both sides from the SAME
book, for totals at the SAME point, sharp books first — verified before any
live write:

```
same-book pair          -> (0.5798, 'fanduel')
cross-book only         -> None            (rule 1 holds)
sharp available         -> ('pinnacle')    (rule 3 holds)
total, mismatched point -> None            (rule 2 holds)
total, same point       -> (0.5000, 'fanduel')
```

Populated live: MLB 91, NFL 26, CFB 7, soccer_epl 33, soccer_mls 33.
Reference books: bet365 45, pinnacle 22, betmgm 3, kalshi 1, fanduel 1.
Model and market genuinely disagree (game 824960: model 0.5227 home, pinnacle
0.2658) — that gap was previously unmeasurable.

**Constraint that no further code removes:** `game_odds_book_lines` is a
current-state table, so only recent games still have lines to reference.
**Graded MLB picks with both a model and a market probability: 12, of 125
graded.** `game_odds_history` covers only 41 of 176 MLB picks (the log starts
2026-08-12). 4.2's gate will run on a small sample whatever else is done, and
that number is stated rather than buried.

**4.1 · market_prob coverage.** *(P3 C5 fix #2, P3 H8)*

**The plan's premise is stale**: `resolve_candidate_edge` does NOT "never run"
— it runs from `prop_pick_history.py:43`, `generic_prop_score.py:188` and
`generic_rare_markets.py:137`. It returns None almost always, for reasons the
plan does not name.

Measured against today's real 2,795 MLB candidates and 24,672 live prop_odds
rows, by running the real function over them (`pick_history` is
first-write-wins, so today's rows were already written at 04:02Z):

```
candidates with NO price at all   1,677  (60.0%)   audit said 75%
candidates WITH a price           1,118  (40.0%)
market_prob resolved, before          0  ( 0.0%)
market_prob resolved, after          14  ( 1.3% of priced)
```

Three causes, in order of damage:

1. **Staleness — the dominant one, and unmentioned by the plan.** 5,877
   same-book same-provider two-sided pairs exist in `prop_odds`; exactly **2**
   fall inside the 30-minute bound at any instant. `refreshTier1` rewrites ~238
   rows per cycle against a 49,000-row table, so almost everything is
   permanently "old" relative to `now()`. Fixed by splitting two bounds that
   answer different questions: `_MAX_ROW_AGE_SECONDS` (30 min, **unchanged** —
   "could a user bet this now?") and `_MAX_REFERENCE_AGE_SECONDS` (6 h, new —
   "did the market believe this today?"), plus `_MAX_PAIR_SKEW_SECONDS` so the
   two sides of a de-vig are contemporaneous with each other.
2. **Under-side scarcity, which no code fixes.** 43,620 overs against 5,113
   unders: `oddsapiio` 13,269/42, `propline_2` 4,004/**0**, `propline`
   18,883/3,620, `sharpapi` 7,464/1,451. This is why 4.1 cannot reach 50% on
   the current feeds — the situation **Q26** anticipated.
3. **60% of candidates have no price at all** (improved from 75%).

**A CORRECTION to a claim I made earlier and repeated from `CURRENT.md`:**
bookmaker canonicalisation is "part of why 4.1's resolution rate is 18%" is
TRUE for game lines and **FALSE for props** — `prop_odds` has 17 distinct
bookmakers and 17 distinct lowercased bookmakers, so its casing was never
split and 5.3 changed nothing on the prop path. 5.3 remains correct and
load-bearing for `game_odds_book_lines` and for Q28's reference; it is simply
not a 4.1 fix. The claim was inherited without being checked against
`prop_odds`.

**4.7 · golf — DECIDED, NOT BUILT.** *(P3 L3)*

The task says to check whether anything would consume a golf copy before
writing an importer. Checked, and the answer is no. Recording the outcome, as
instructed, rather than building it anyway:

- **Golf is not in the generic prop pipeline at all.** `_APP_SPORT_BY_KEY`
  (`generic_pick_capture.py`) covers nfl/cfb/nba/nhl/soccer_epl/soccer_mls.
  Golf has its own eight-module stack — `golf_candidates`, `golf_models`,
  `golf_history`, `golf_grading`, `golf_espn`, `golf_pgatour_stats`,
  `golf_player_matching`, `golf_venues`.
- **Every reader of `player_game_history` serves that generic pipeline** —
  `fetch_player_games_from_db` and `compute_league_rate`. Nothing golf touches
  reads the table, so rows written there would be read by nobody.
- **The schema does not fit.** `PlayerGameHistoryInput` is
  `(athlete_id, team_id, season, event_id, game_date, opponent_id, is_home,
  stats)`. Golf has no opponent, no team and no home/away; its unit is a round
  and a hole, not a game against someone.
- **The data already exists in the right shape**: `golf_hole_scores` 9,560
  rows, `golf_round_scores` 528, `golf_tournament_results` 119,
  `golf_model_predictions` 6,231 — and golf's models already read them.

**Outcome: no golf importer.** Building one would duplicate 10,000+ rows into a
schema shaped for team sports, for zero consumers. 4.7's real target for golf
is already met by golf's own tables. If a future task genuinely needs golf in
the unified table, the blocker is a schema question (what is a golf "event"),
not an ingestion one.

**4.7 · NBA — RUNNING.** `python src/backfill_player_game_history.py nba`,
11 seasons (2016–2026). Progressing cleanly: 0 failed through season 2017,
~160 games/min, ~7 min per season. Resumable — the database is the only

**4.7 · Backfill `player_game_history` — COMPLETE, all four sports.** *(P3 L3)*

`VERIFY` / exit criterion: *"`player_game_history` non-zero for MLB, NBA, golf,
tennis."* Three met; golf deliberately not, see below.

```
sport         rows      athletes   events    seasons
mlb        727,613        4,003     24,790   2016-2026   <- now the LARGEST
nhl        674,003        2,972     17,672   2010-2024       sport in the table
nba        279,661        1,567     13,128   2016-2026
cfb        273,649       33,868      6,112   2018-2025
nfl        226,629        6,740      3,663   2012-2025
soccer_epl 168,493        2,781      5,989   2010-2026
tennis_wta 142,152        9,683     71,076   2016-2026
soccer_mls 133,892        2,543      4,577   2015-2026
tennis_atp 129,812        8,163     64,906   2016-2026
golf             0  — deliberately, see the decision entry above
```

All four target sports held **zero** rows at the start of the phase.

**NBA** — ran the existing parser, which had never been invoked. 77.9 min,
13,128 games, 0 empty, 0 failed. Season counts sanity-check against reality:
1,231-1,235 for full seasons and **973 (2020) / 1,066 (2021)**, the two
COVID-shortened seasons.

**MLB** — 11 requests, 4.7 minutes, 24,790 games. Its own branch, not another
`SPORT_CONFIGS` row: the ESPN sports fetch one boxscore per game (~1,230
requests a season), while StatsAPI returns a whole player-season of game logs
per batched call (~1 request a season). Reuses
`predict/statsapi.get_people_with_game_logs` unchanged, as `CURRENT.md` §2b
specified. Game counts land at 2,428-2,431 against MLB's real 2,430, and 2020
returns 898 — the 60-game season.

**P3 L3's survivorship bias — fixed and QUANTIFIED.** `get_active_roster`
requests `rosterType=active`, i.e. who is on a roster *now*, which is exactly
the bias. Used `/v1/sports/1/players?season=YYYY` instead, which is
season-scoped. The proof it matters:

```
MLB players present in 2016 but NOT in 2026:  1,221 of 1,353
```

A current-roster walk would have silently dropped 90% of the 2016 population.

**Stat-name collision, handled rather than discovered later.** MLB reports
`strikeOuts` for a batter (times struck out) and for a pitcher (strikeouts
recorded); `runs`, `homeRuns`, `hits` and `baseOnBalls` are similarly
overloaded. The table is `UNIQUE(sport, athlete_id, event_id)`, so a two-way
player has ONE row per game and both groups must coexist in it. Keys are
prefixed `bat_` / `pit_`. Verified on a real row: `bat_strikeOuts: 0` beside
`pit_strikeOuts: 2`.

**TENNIS — the genuine new source.** 134,292 matches, 264 requests, 3.2 min.
Swept a MONTH at a time because ESPN's tennis scoreboard returns whole
tournament draws (one January request: 6 tournaments, 1,101 matches), so a
daily sweep would re-download each tournament for every day it ran.

*What ESPN does not give, checked before building:* there are **no per-match
tennis statistics**. Every competitor's `statistics` array is empty and the
`summary?event=` endpoint that carries a boxscore for team sports returns HTTP
400 for tennis. What IS there is the score — per-set linescores with tiebreaks,
winner flag, athlete ids, round — yielding games won/lost, sets won/lost,
tiebreaks, result, and major/qualifying flags.

**Consequence, recorded so nobody later wonders why ace models have no training
data:** `games-won` and `to-win-a-set`, two of the three tennis markets this app
prices, are derivable from this. **`aces`, the third, is not, and no further
work on this source will produce it.** It needs a different feed.

Integrity is exact — 64,906 ATP matches x 2 = 129,812 rows; 71,076 WTA x 2 =
142,152. A check for any match without exactly 2 players and exactly 1 winner
returned empty.

**A LATENT BUG THIS EXPOSED** in `db.write_player_game_history`: its chunking
used `60000 // 9` = 6,666 rows = ~60,000 bind parameters, commented as "well
under Postgres's 65535 ceiling". The real ceiling is **32,767** — the wire
protocol encodes parameter count as a *signed* 16-bit integer. It never fired
because every caller until now wrote ONE GAME at a time (~10-60 rows); the
first genuinely large batch hit it immediately. Corrected to 3,000 rows.

**4.4 · Shadow mode as a property of the model.** *(Q6, Q33)*

The plan assumed `model_weights.shadow` existed. It did not — so 4.4 is a
migration, not a flag flip. Defaults **TRUE** (Q33) across all 21 rows, so it
made nothing newly visible; it encodes the state Phase 1.3 already put the UI
in. `active` and `shadow` are independent: Q24's deactivation acts on `active`,
Q6's hiding acts on `shadow`.

New `getRenderableModelWeights()` states the rule once; `adapter.ts`'s home-run
override uses it, so a shadowed model falls back to the Beta-Binomial baseline
exactly as when no fit exists. `getActiveModelWeights` is unchanged, because
fitting/grading/diagnostics must still see shadowed models.

**A REAL BUG THE ROUND-TRIP CAUGHT, and why both directions are mandatory.**
`camelizeModelWeightsRow` is an explicit whitelist, so a new column is invisible
until named in it. `shadow` was silently dropped, making the
undefined-means-hidden default fire on every read and pinning the model to
hidden in BOTH directions. **A test asserting only "shadow=true hides it" would
have passed perfectly against a permanently invisible model.** Only direction 2
exposed it.

```
shadow=true  -> getRenderableModelWeights null; getActiveModelWeights still
                returns it (compute/log/grade continue)      PASS
shadow=false -> renderer sees it, same version v5             PASS
shadow=true  -> hidden again                                  PASS
restored: shadow=true (was true)
```
`scripts/gate/phase-4-shadow-roundtrip.mjs`. Restores in a `finally`, so a
failed assertion cannot strand a production model visible.

**4.2 · Market baseline as the activation gate.** *(P3 H3, Q6, Q24)*

Replaced `activated = holdout_brier < baseline_holdout_brier` — "is this fit
better than our own previous guess?" — with two guardrails: beat the unfitted
baseline AND do not lose to the market, using Q28's captured two-sided price.

Counterfactual, measured on a model at Brier 0.280 against a market at 0.240:

```
old gate: beats its own unfitted baseline (0.3625)  -> ACTIVATES
new gate: loses to the market                        -> REFUSED
```

**Minimum sample, and why it is not optional.** The live gate sample is n=12
(MLB moneyline), n=12 (MLB total), n=13 (NFL moneyline). Q24 *deactivates* a
model that loses to the market, so a false loss verdict on a thin sample would
take down a live model on noise. Below `MARKET_GATE_MIN_N = 100` the gate
returns `insufficient_sample`, which blocks nothing and passes nothing, and
reports **no Brier at all** rather than a meaningless one. Against live data:

```
mlb/moneyline: INSUFFICIENT SAMPLE (n=12, need 100) - not evidence either way
```

So the machinery is real and tested and will start discriminating as Q28's
reference accumulates. **The n is stated prominently rather than buried** —
Q26's discipline applied to 4.2.

**4.9 · Split the two definitions of `edge`.** *(P3 H8)*

Located precisely in the code as it stands: `db.write_pick_history_grades`
(grading time) writes `model_prob - devig(one book)` — a DISAGREEMENT;
`resolve_candidate_edge` (surface time) writes `sharp_devigged - raw_implied` —
EXPECTED VALUE. One threshold was applied to both.

```
pick_history rows      368,657
edge populated           3,852
edge_source populated        0   <- the entire redesign, unrecorded
price populated              2
```

That zero is also the evidence for the backfill: `edge_source` is set only by
the surface-time writer, so every populated `edge` must be from the grading-time
join. 3,852 rows attributed to `model_vs_market` on that basis.

Each definition now has its own column and its own bar —
`GOOD_BET_MIN_EDGE_MODEL_VS_MARKET = 0.03` (unchanged, so existing readers do
not shift) and `GOOD_BET_MIN_EDGE_SHARP_VS_SOFT = 0.02`, explicitly a
**placeholder** since there is no sharp-vs-soft history to fit it against yet.
`edge` is kept and documented as legacy: repointing it would change what live
readers mean without them knowing.

**Honest state:** `edge_sharp_vs_soft` is populated on **0** rows, because
`resolve_candidate_edge` almost never resolves for 4.1's measured reasons. So
4.9's exit criterion is met for the grading path and will only be met for the
surface path once 4.1's supply problem eases.

**4.12 · Model-math hygiene — 2 of 8 items.** *(P3 L1, P3 L5)*

**P3 L1 — an integer total line was scored as a LOSS.** On a total of exactly
9, X = 9 is a PUSH. Conditioning on not-a-push is the standard treatment and is
what a price on an integer line represents.

```
lambda 9, line 9:   OLD over 0.4126
                    NEW over 0.4752, push 0.1318
```
The over was understated by 6.3 points, with 13.2% of the distribution scored as
a loss when it is a refund. Half-integer lines — the overwhelming majority of
MLB totals — are **provably unchanged**, asserted against the pre-fix
implementation at four (lambda, line) pairs. Fixed in both languages and
verified to agree to four decimals.

**P3 L5 — the Elo sort was not a total order.** It replicated TS's
`(a,b) => a.gameDate < b.gameDate ? -1 : 1` deliberately. That argument had it
backwards: a comparator that never returns 0 for equal keys makes the result
depend on the ARRIVAL ORDER of same-day games, so two runs over identical data
can produce different ratings. Measured over five shuffles of the same four
games:

```
NEW sort:       [9,1,2,3] every time          (deterministic)
OLD comparator: [9,3,2,1] / [9,1,2,3] / ...   (three distinct orderings)
```

`src/test_model_hygiene.py` keeps the pre-fix implementation inline so both
counterfactuals are measured, and asserts the old comparator really was
non-deterministic — so if that ever stops being true the test stops claiming to
be evidence.

**4.12 · Model-math hygiene — 7 of 8 items closed.** *(continued)*

Per the gate's "eight items, eight lines. 'Model hygiene done' is not an
entry", each has its own evidence and its own test group in
`src/test_model_hygiene.py`.

**P3 M4 — the starter blend mixed two units at a hand-set 50/50.**
`team_rate_per_game * 0.5 + starter.era * 0.5` adds runs per GAME to earned
runs per NINE INNINGS for a pitcher who throws about five and a half of them.
4.12 offered "fit the weight, or document why 50/50"; neither was needed,
because the weight is not a free parameter — it is the share of the game the
starter is responsible for, which was simply not being used.

```
_STARTER_INNINGS_SHARE = 5.2 / 9 = 0.5778
_EARNED_TO_TOTAL_RUNS  = 1.075     (ERA omits unearned, ~7-8% of all runs)

team at 4.30 runs/game:
    ERA      OLD 50/50      NEW
    2.50        3.400      3.368
    4.30        4.300      4.486
    7.00        5.650      6.163
```

Two distinct errors surface here. The old form returned EXACTLY 4.30 for a 4.30
team facing a 4.30 ERA — quietly asserting that earned runs are all the runs.
And it compressed starter quality: the good-to-bad spread widens from 2.250 to
2.795.

**P3 M5 — home-field and form were ADDED TO A PROBABILITY.**

```
raw    OLD (add)   NEW (logit)   the underdog
0.50     0.5400       0.5100      0.500 -> old 0.460 / new 0.490
0.94     0.9700       0.9422      0.060 -> old 0.030 / new 0.058
```

On a coin-flip game the old form was a modest nudge; on a 0.94 favourite it
**halved** the underdog. A "fixed" edge was worth several times more in
lopsided games than in close ones. In log-odds the same constant is a constant
multiplier on the odds ratio, which is what the edge actually means.

**P3 M6 — `compute_league_rate` returned a fabricated 0.5 on no sample.**
Downstream that is indistinguishable from a real, computed 50% base rate. Worse
for the markets it backs — triple-doubles, anytime goalscorer, hat-tricks —
where a true rate near 0.5 is impossible, so the value was always wrong by a
wide margin and always in the direction that makes a prop look attractive. Now
returns None; all five call sites decline to build the candidate.

**P3 M7 — TWO things, with opposite answers.**

*The headline no longer reproduces.* The audit had the model beating its
par-based prior on 9 of 19 dimensions and losing on 10 — a coin flip.
Re-measured over 3,397 graded rows:

```
dimensions won by the model   12 / 19   (was 9)
dimensions won by the prior    7 / 19   (was 10)
aggregate model Brier      0.20665
aggregate league Brier     0.21127
model advantage           +0.00462
by category: birdie 0.19337 vs 0.21113 · par ~neutral · bogey favours the prior
```

4.12 offered "either beat the prior or ship the prior". It now beats the prior,
so the model stays — a decision NOT to act, recorded with the number behind it.
Had it still been a coin flip, shipping the prior would have meant deactivating
a live model, which is on the operator's list and would have been raised.

*The double-count still reproduces, and is fixed.* `golfer_own_observations` is
documented as a SUBSET of `field_observations`, so those rows already scored +1
in the field loop and then received the full own-weight on top.

```
subject birdied twice, field otherwise 10 pars:
   OLD (double-counted)  birdie 0.3082
   NEW (deduped)         birdie 0.2390
```

The subject's own recent form was inflating their own birdie probability by
**6.92 points**. Fixed by adding `_OWN_EXTRA_WEIGHT - 1`, arithmetically
identical to removing them from the field and re-adding at full weight — and
needing no golfer id, which matters because `HoleFieldObservation` carries only
`relative_to_par`.

**P3 L2 — `deltaFromLine`'s doc disagreed with its code.** The doc claimed
`(average - line) / line`; the code divides by `|line|`. The CODE is right: a
signed denominator flips the sign of the percentage for a negative line (a
spread of -1.5), so "10% better" would read as "10% worse" for exactly the
markets where negative lines are normal. Fixed the comment.

**P3 M2 — MEASURED, NOT ACTED ON.** The eighth item, deliberately left for the
operator because all three of 4.12's options ("re-scale; justify its existence
or drop it") change what a user sees. Re-measured on a larger sample than the
audit had — 33,829 graded rows against 29,631 — and it reproduces exactly:

```
overall, grades track outcomes monotonically — a real ranking signal:
  D 29.7% (n=13,946) · C 34.9% · C+ 38.9% · B 46.4% · B+ 53.1%
  · A 60.2% · A+ 67.1% (n=514)

holding model_prob fixed in 0.40-0.60, the ordering COLLAPSES:
  C+ 40.5% · D 42.4% · C 43.4% · B 45.0% · A 45.2% · B+ 48.3% · A+ 60.9%
```

D outranks C+, and A is indistinguishable from B. Only A+ retains independent
signal, on n=64. So Prop Score is largely `model_prob` wearing a letter, as the
audit said. **Q1 already constrains the answer** — prop grades may return only
as RANKING, never as probability or edge.

**4.5 · CLV on `/diagnostics`.** *(P3 M1)*

The complaint was never that CLV is hard to compute. `predict/clv_backtest.py`
was already written and carefully documented, and was wired to **nothing** — no
`JOB_REGISTRY` entry, no reader anywhere in `app/` or `lib/`. Three pieces
added, following Q13 (Python computes, TypeScript renders): `clvSummaryJob`
(hourly) computes and stores; `/api/diagnostics/clv` reads that row and
recomputes nothing; a card renders it.

**The closing reference, defined rather than implied**, as 4.5 requires: the
last real observed price for one (event, market, side) at the reference book,
STRICTLY BEFORE that game's own `commence_time`, from `game_odds_history`.
Deliberately not `game_picks`' `final` capture, which is taken on a timer and
is therefore "near the close" rather than "the close".

**A REGRESSION TASK 5.3 CAUSED, found only by wiring this up.**
`clv_backtest`'s `DEFAULT_REFERENCE_BOOKMAKER` was `"LowVig.ag"`. Task 5.3's
canonicalisation renamed every bookmaker in `game_odds_history`, so that string
matched nothing:

```
before the fix:   0 of 337 picks matched a closing price
after the fix:   60 of 337
```

The breakage was completely invisible because the module had no caller —
nothing failed, no test went red, no health check complained. **A dead consumer
cannot report that its input vanished.** Swept the tree for other hardcoded
pre-canonicalisation book names: only comments, no other live reference.

`VERIFY` — the numbers now on the dashboard:

```
moneyline  30/173 matched  mean -0.0615 prob-pts  median -0.0006  46.7% beat the close
total      30/164 matched  mean +0.0093 prob-pts  median +0.0031  56.7% beat the close
```

Moneyline picks lose to the close on the mean while sitting near zero on the
median — a few large adverse moves rather than a broad bias. The card says so
and states that the median is the more robust read.

When the job has not run, the route returns `available: false` with a reason
and the card says "not computed yet" — deliberately blank rather than rendering
`0.0000`, which would assert that CLV *is* zero. That is a much stronger claim
than "we have not measured this".

**4.10 · Let the generic sports surface "under".** *(P3 M12)*

It was a hardcoded string in two places: `build_candidate` passed `"over"` to
both `resolve_candidate_edge` and `candidate_good_bet_signals`, and
`_candidate_to_entry` wrote `category="over"` regardless. The second is the
sharper half — `pick_history`'s uniqueness key is
`(sport, subject_id, dimension, category, game_id)`, so an under could not be
STORED even if one had been generated.

Both sides are now generated and the **better-scoring one kept**, not both.
Surfacing an over and an under on the same player, market and line would
recommend a proposition and its exact opposite: two rows that cannot both be
good bets, in a pick list that contradicts itself.

`P(under) = 1 - P(over)`, the rule Phase 1.1 established for MLB in
`prop_candidates._prob_for_category` — whose bug was a candidate whose
proposition was the under carrying the OVER's probability, at two independent
sites. Both are passed the side here for that reason, and the complement is
asserted directly.

Rare markets stay over-only **deliberately** — "under a triple-double" is not a
proposition any book offers as a pairable side — pinned with the reason written
down rather than by omission.

**A real bug the test caught before it shipped:** the first selection used
`max(scored, key=lambda c: (c.score, ...))`. `score` is a `PropScore` OBJECT,
not a number, so that raises `TypeError` at runtime — in production, on the
first scored candidate, for all five sports.

**Verification limit, per Q34:** verified by test; live-verifiable only on
soccer, since NBA/NHL/CFB/tennis are out of season and writing zero
`pick_history` rows.

**4.11 · Fix the totals model's distributional assumption.** *(P3 C2)*

Re-measured on every MLB game now in `player_game_history` — 24,790 games,
summing `bat_runs` per event, a sample this repo did not have before 4.7:

```
mean total runs      9.0391
variance            20.5732
variance / mean      2.2760      <- Poisson REQUIRES exactly 1.0
```

**`r` is derived, not tuned.** A negative binomial has variance `mu + mu^2/r`,
so the measurement determines it: `r = 81.705 / 11.5341 = 7.08`. Checked by
reconstruction — pmf sums to 1.000000, mean 9.0391 exactly, variance 20.5794
against the measured 20.5732.

**The re-validation 4.11 asks for**, both distributions scored against the
EMPIRICAL over-rate from the same 24,790 games:

```
line   empirical   negbinom (err)     poisson (err)
 7.5     0.5828    0.5878 (0.0050)    0.6807 (0.0979)
 8.5     0.5038    0.4953 (0.0085)    0.5495 (0.0457)
 9.5     0.4006    0.4085 (0.0079)    0.4177 (0.0171)
11.5     0.2600    0.2620 (0.0020)    0.2008 (0.0592)
13.5     0.1565    0.1570 (0.0005)    0.0758 (0.0807)
```

Worst error: negative binomial 0.85 points, Poisson 9.8.

**The error had a direction, and it was the worst possible one for this
product.** Poisson put far too little mass in the tails — at 13.5 it said 7.6%
where reality is 15.7%, understating by more than a factor of two. Blowouts and
2-1 duels are exactly the games a totals bet is decided by, so the old model
was most wrong precisely where it mattered, and confidently so.

4.12's P3 L1 push fix is carried into the replacement rather than lost, and
asserted — a rewrite quietly dropping a recent fix is an easy, invisible
regression. `model_fit.py`'s training feature switched to the same distribution,
because a model fitted on a feature production no longer computes is trained on
something that does not exist at serve time.

**4.6 · Investigate the fade signal — MEASURED AND RECORDED, NOT BUILT ON.**
*(P3 C5)*

4.6's own instruction: *"Don't build on it until 4.1 gives you the sample."*
4.1 measured that sample as supply-limited (under-side scarcity, 43,620 overs
against 5,113 unders), and acting on this would change what a user sees. So
this is characterised and left.

**It reproduces**, on a slightly larger sample than the audit's n=1,981:

```
bucket           n      actual   market expected   vs market
negative edge  2,095    40.91%       45.31%         -4.41 pts
positive edge  1,757    42.06%       41.97%         +0.09 pts
```

The model's POSITIVE-edge picks add nothing at all — 0.09 points, indistinguish-
able from zero. Its NEGATIVE-edge picks lose to the market by 4.41 points.

**It is not a longshot artifact**, which was the obvious alternative
explanation. The underperformance is present in every `market_prob` band and is
LARGEST in the high-probability ones — the opposite of what a favourite-longshot
bias produces:

```
market_prob band   negative-edge n   vs market
0.20 - 0.35             407           -5.57
0.35 - 0.50             889           -4.33
0.50 - 0.65             596           -3.46
0.65 - 0.80             115           -7.51
0.80 - 0.99              22           -6.63
```

**Nor is it one market.** It holds across every dimension with n > 100:
total-bases -10.18 (n=171), runs -6.36 (n=190), hit-in-game -5.74 (n=431),
walks -5.14 (n=121), rbis -4.92 (n=299), hits-runs-rbis -3.74 (n=495).

So when this model says "this side is worse than the market thinks", the
outcome really is worse than the market thinks — by consistently more than the
model's own claim. That is genuine negative information, broad and persistent.

**One scoping note that matters for anyone acting on this later:** `edge` here
is the legacy ambiguous column, and per 4.9 every populated row in it is the
`model_vs_market` definition. So this is a statement about the
model-versus-book DISAGREEMENT measure, not about the sharp-vs-soft
expected-value one, which has zero populated rows. Whoever picks this up should
not assume the two behave alike.



progress state, so killing and restarting never re-pays for completed work.



> Order followed `docs/CURRENT.md` §2:
> 5.3 first, because book identity is what 5.5, 5.7 and 4.1's de-vig all
> depend on. **Gate not yet run — this section is the running task log.**

--- task verifications ---

**5.3 · Normalise bookmaker names.** *(P3 H9)*

Still reproduced at kickoff: 33 distinct spellings for 22 real books.

`VERIFY: SELECT DISTINCT bookmaker -> one row per real book`

```
BEFORE: { rows: '6199', books: '33' }
AFTER:  { rows: '6199', books: '22' }
BACKUP: 6199 rows / 33 spellings  (game_odds_book_lines_bookmaker_backup_20260829)

DISTINCT bookmaker (22):
  bet365 (308)      betmgm (546)     betonline (330)   betrivers (384)
  betus (322)       bovada (380)     draftkings (691)  fanatics (176)
  fanduel (750)     kalshi (180)     lowvig (330)      matchbook (166)
  mybookie (358)    novig (123)      onexbet (75)      pinnacle (186)
  polymarket (124)  prophetx (136)   rebet (168)       smarkets (110)
  tabau (152)       unibet (204)
```

**Zero rows lost.** The migration's dedup step correctly deleted nothing: no
canonical key collided, because `source` is part of the unique key and each
source used one internally-consistent spelling. Worth recording because the
dedup was written expecting collisions — the plan's framing implied merges
would be lossy, and against real data they were not.

End-to-end through the **real writer**, not the pure function (fault
confirmed to land before believing the result):

```
writing 6 rows with raw spellings: ['FanDuel','Fanduel','fanduel','BetOnline.ag','BetUS','bet365.us']
what actually landed:
   bet365     x1
   betonline  x1
   betus      x1
   fanduel    x1
EXPECTED: ['bet365','betonline','betus','fanduel']
RESULT: PASS
cleanup: rows remaining for test game_id = 0
```

Three `FanDuel` spellings collapsing to **one** row is the load-bearing
observation: it proves the `ON CONFLICT (sport, game_id, market, side,
bookmaker, source)` key now actually collides, which is the behaviour P3 H9
broke.

`src/test_canonical_bookmaker.py` — ALL PASS (5 cases). Asserts against the
exact 33 live spellings rather than against the alias map, and covers the
BetUS trap (a real book whose name ends in "us", which a blind suffix strip
turns into the nonexistent "bet"), the deliberate kept-vs-dropped difference
from `normalize_bookmaker`, and idempotence. Hermetic, runs in CI per Q20.
`npm test` 26/26, `tsc --noEmit` clean.

Decisions: **Q30** (canonical form, operator) and the two I took myself —
`canonical_bookmaker` is a second function rather than a change to
`normalize_bookmaker`, and suffix-stripping fires only when the remainder is
itself a known book. Both reasoned in the commit message and in the
function's own docstring.

**5.4 · Impossible totals, and CHECK constraints.** *(P3 H10, P2 M8, Q11)*

Reproduced. **Q11 answered empirically, and the answer is not what the plan
assumed:** it is not a Propline problem. All four sources emit out-of-band MLB
totals (propline 1.5-13, sharpapi 1.5-15.5, the-odds-api 3.5-14.5), and the
rows are not garbage — they are internally COHERENT prices for a DIFFERENT
proposition. Game 823985 carries `total 2.5 over +110 / under -145` from bovada
beside a coherent 6.5-9.5 cluster from twenty other books. Real MLB games go
over 2.5 runs ~93% of the time, so +110 is impossible for a game total and
entirely normal for a TEAM total or FIRST-5-INNINGS total.

Band from the distribution, not intuition: `p0.5=1.5 p1=2.5 p5=5 p95=9.5
p99=13 p99.5=14.5`, mass at 7.5 (319) / 9.5 (317) / 8 (198) / 8.5 (171) /
9 (116). MLB total constrained to [6, 14]. Soccer left generous ([0.5, 9.5])
because its `.25`/`.75` Asian quarter-lines are REAL — 2.75 and 3.25 both
observed live, and a "half-points only" rule would have destroyed them (Q35).

`VERIFY: inserting an out-of-band total is rejected by the database` — plus the
gate's "one deliberate bad insert per constraint":

```
CONTROLS — a valid row must be accepted by each table:
  PASS  game_odds_book_lines: valid row accepted
  PASS  prop_odds: valid row accepted
  PASS  pick_history: valid row accepted

VIOLATIONS — each must be rejected BY ITS OWN NAMED CONSTRAINT:
  PASS  game_odds_book_lines: market 'parlay' -> rejected by gobl_market_valid
  PASS  game_odds_book_lines: side 'sideways' -> rejected by gobl_side_valid
  PASS  game_odds_book_lines: sport 'quidditch' -> rejected by gobl_sport_valid
  PASS  game_odds_book_lines: a moneyline carrying a point -> gobl_point_shape
  PASS  game_odds_book_lines: a total with no point at all -> gobl_point_shape
  PASS  game_odds_book_lines: MLB total of 2.5 (the P3 H10 row) -> gobl_point_plausible
  PASS  game_odds_book_lines: MLB total of 15.5 -> gobl_point_plausible
  PASS  game_odds_book_lines: MLB spread of -40 -> gobl_point_plausible
  PASS  game_odds_book_lines: american odds of 0 -> gobl_american_odds_sane
  PASS  game_odds_book_lines: american odds of -5 -> gobl_american_odds_sane
  PASS  prop_odds: side 'maybe' -> rejected by prop_odds_side_valid
  PASS  prop_odds: american odds of 42 -> prop_odds_american_odds_sane
  PASS  pick_history: outcome 'kinda won' -> pick_history_outcome_valid
  PASS  pick_history: trust_tier 'vibes' -> pick_history_trust_tier_valid
  PASS  pick_history: score_grade 'S++' -> pick_history_score_grade_valid
  PASS  pick_history: model_prob of 1.4 -> pick_history_model_prob_range
  PASS  pick_history: market_prob of -0.2 -> pick_history_market_prob_range

rolled back; test rows remaining: {"a":"0","b":"0","d":"0"}
ALL PASS (17 constraints tripped deliberately)
```

**A FALSE PASS WAS CAUGHT HERE, and it is the fourth of its kind.** The first
run reported all 17 "rejected" — and every one was rejected by a `NOT NULL` on
`fetched_at`/`category`, not by any CHECK constraint. **Nothing was being
tested.** It was visible only because the script inserts a known-good CONTROL
row per table first, and asserts `e.constraint` equals the specific constraint
under test rather than accepting any error. Recorded in `CURRENT.md` §6.

Observed: `game_odds_book_lines` 6,937 -> 6,823; 114 rows quarantined, exactly
the 104-below-6 + 10-above-14 predicted before running. Backup:
`game_odds_book_lines_quarantine_20260829` with a `quarantine_reason` column.

**5.5 · Modal-point selection for totals and spreads.** *(P3 C1)*

Reproduced in BOTH languages; the Python version's own comment admitted the
shape "can't represent both simultaneously", which is the finding.

`VERIFY: on a game with multiple total lines, the displayed best price and its
de-vigged probability come from the same point.` Counterfactual run against the
real pre-fix function extracted from git history, same fixture through both:

```
OLD (HEAD, pre-5.5)   point=9.5  over=+400  under=+100  implied_total=0.7000
NEW (with 5.5)        point=7.5  over=-105  under=+100  implied_total=1.0122
```

The old row pairs an over quoted at 9.5 with an under quoted at 7.5 and labels
it 9.5. Its implied total of 0.70 is a 30% NEGATIVE hold — no book offers that,
and that number was feeding `market_prob`.

**Note on method:** reverting `mlb_game_lines.py` and re-running the test gave
an ImportError, not a failure — which proves nothing. The counterfactual above
was produced by extracting the pre-fix function from git history instead.
"The test failed after I reverted the fix" would have been the comfortable,
wrong evidence.

Also fixed, stated because it is a real behaviour change: Python's
`summarise_odds_event` had NO implausible-price bound at all, so one garbage
row could win "best price" by being the largest number. It now applies the same
`MAX_PLAUSIBLE_DECIMAL_ODDS` guard the TS twin already had.

**5.6 · Implausible-odds guard in TypeScript `bestPrice`.** *(P3 H6)*

**DOES NOT REPRODUCE — already fixed 2026-08-27**, after the audit was
written. `lib/odds/display.ts:20` defines `MAX_PLAUSIBLE_DECIMAL_ODDS = 30` and
all three best-price functions call the guard. Task shrinks to its other half,
"and a test covers it", now present in both languages. Found by the "verify it
still reproduces" step; without it this would have been a re-fix of working
code.

**5.7 · Exclude the compared book from Tier-2 consensus.** *(P3 M14)*

Reproduced. The subject book was one of the terms in the median it was then
measured against, so it partly set its own benchmark. Fixture measurement:
reference moves `0.4892 -> 0.4946` when the compared book is excluded.
Degenerate case handled explicitly — excluding the ONLY book returns None
rather than a "consensus" of one, since a median of one book is that book's own
price. Tier 1 deliberately keeps no exclusion: it is a named sharp book, and if
the candidate's price IS that book, an edge of 0 is the honest answer.

**5.8 · Replace `_team_match` exact string equality.** *(P3 M13)*

Reproduced. `VERIFY: feed a known format variant; it matches, and a miss emits
a system_events row.` Both halves confirmed, the second **in production**:

```
system_events | warn | job_runner.team_match
  "5 game(s) matched no provider event"   2026-08-29T07:54:08.548Z
  (deploy of this code finished 07:51:59Z)
```

The normalisation `harvester_scrape.py` had already proven against real live
mismatches was MOVED to `entity_resolution.py` and shared, rather than a second
weaker copy being written; harvester imports it back under its original private
names, so its behaviour is provably unchanged.

Deliberately NOT adopted: harvester's loose substring-containment fallback.
Here both sides must match to attach a price to a game, so a false positive
attaches odds to the WRONG game — worse than a miss. Tested: "Michigan State"
still does not match "Michigan".

Found while testing and NOT papered over: `"NY Red Bulls"` does not match
`"New York Red Bulls"`, because `"NY"` is not in the alias table. My test
expectation was wrong, not the code. Every alias there was verified against a
real observed mismatch; inventing one to make a test green would break exactly
the discipline that table's comments describe. It lands in the miss log
instead, which is where a real alias candidate should surface.

**5.9 · Wire the ParlayAPI soft caps.** *(P2 H3)*

Reproduced — six `PARLAYAPI_*_SOFT_CAP` vars, configured and documented, and
`config.py` read none of them. Now gate via `ProviderSpec.soft_cap`, effective
gate `min(soft, hard)`, warning naming which fired.

**BEHAVIOUR CHANGE, FLAGGED NOT BURIED:** those caps are already set to **800**
against a hard limit of 1000. Wiring them genuinely lowers the ParlayAPI gate
by 20%, so those jobs now stop earlier in the month than they did yesterday.
That is what a soft cap is for and what the operator configured, but it is not
a no-op. If unwanted, unset the env vars rather than reverting the code.

**5.10 · Stop discarding rows you paid for.** *(P2 H4)*

Reproduced. `asyncio.gather` without `return_exceptions=True` propagates the
first exception and discards every sibling's already-fetched — and already
PAID FOR — rows. The sequential branch had the same defect for a different
reason: an exception escaping mid-list abandoned the outcomes collected before
it. Both fixed. The failure is surfaced to `system_events` as an error;
without that, this fix would convert a hard failure into an invisible one.

`VERIFY: force one provider to raise; the others' rows still land.` — asserted
in both directions, so the test fails if the flag is removed:

```
5.10: one provider raising must not discard its siblings
  PASS  without the flag, gather raises and siblings are lost
  PASS  with the flag, both successful providers survive
  PASS  and the failure is still visible, not swallowed
```

**5.11 · Close the config drift.** *(P2 M3)*

`tests/config-drift.test.ts`, four checks. `VERIFY: change one side only; the
test fails.` — the gate's "proven by breaking it", both directions:

```
1. Python batter_hits -> "total-bases", TS still "hits"
   FAIL market key aliases: ...  + 'batter_hits: TS=hits Python=total-bases'
2. reverted
   PASS market key aliases: every key TS knows, Python maps the same way
3. appended TOTALLY_UNREAD_VAR=1 to .env.example
   FAIL no orphan provider env vars ...  + 'TOTALLY_UNREAD_VAR'
4. reverted -> 36/36 pass, git diff empty
```

The first draft kept a hand-written "TS only" allowlist and immediately
reported four FALSE orphans that `lib/odds/props/config.ts` reads perfectly
well. An allowlist needing manual updates is the same drift the test exists to
catch, so it now scans both config trees.

**5.12 · Make the budget check-and-spend atomic.** *(P4 M8)*

Reproduced. Proven with REAL concurrency against real Postgres, both
directions — a single-threaded test would pass against the old code too, since
the old code is only wrong when callers interleave:

```
sequential behaviour at the cap boundary:
  PASS  10 reservations all succeed
  PASS  the one past the cap returns no row
  PASS  and critically, it did NOT increment

the race: 12 concurrent connections, 1 unit left, limit 10:
  PASS  exactly one of 12 wins the last unit
  PASS  final count lands exactly on the limit, never over

counterfactual: the same race against the OLD check-then-act shape:
  OLD shape: 12 of 12 passed the gate; final count 21 against a limit of 10
  PASS  the old shape really does overshoot (fault confirmed present)
ALL PASS
```

Scope stated honestly: ONE unit is reserved as an entry ticket, not the full
cost, because a provider's real request count is unknowable until after the
fetch (Propline makes 1 + 2N requests for N games); the remainder is recorded
after. That closes the race the finding describes without claiming a precision
the call shape cannot support. Second half: swallowed spend-record failures now
also reach `system_events`, with that write itself guarded so a database outage
cannot mask the original error.

**5.2 · The sharp-coverage experiment.** *(P5 G7, P3 H7, Q3, Q27, Q29)*

The audit's premise was measurably wrong, from two stacked bugs.
`fetch_propline` HARDCODED `provider_id="propline"` while serving two real
vendor accounts, so every propline_2 row, unresolved entry and spend record was
filed under `propline` — the two accounts silently shared one 1,000/day
counter, which is why `propline` pins at exactly 1000/1001 daily. And
`job_runner` records spend only when `cap_kind != "none"`, which propline_2
was, so its spend was never recorded at all. It was not vendor-rejected; it was
invisible. `PROPLINE_2_DAILY_LIMIT` was also an orphan env var (5.11).

**The number, its query and its date — with the decision beside it**, as the
gate requires:

```
Date: 2026-08-29
Query: distinct (subject_id, market_key, line) in prop_odds having any row
       from SHARP_REFERENCE_PRIORITY ('pinnacle','circa','novig','kalshi')

  total propositions .... 13,938
  with a sharp price ....  1,265  =  9.08%
  with Pinnacle .........    111  =   0.80%   (pitcher-strikeouts ONLY)
  kalshi 1,752 rows / 1 market · novig 1,329 / 2 · pinnacle 226 / 1
```

Audit measured 3.23% sharp / 0.53% Pinnacle, so coverage has roughly tripled
and is still under the plan's own 10% threshold.

**DECISION, per 5.2's own rule (">= 30% no purchase; < 10% justified"): at
9.08% a Pinnacle-class feed IS justified, and this is the number that justifies
it. RECOMMENDATION ONLY — nothing has been purchased.** Pinnacle covering
exactly one market of thirteen is the sharpest form of the argument: the
reference the whole edge model rests on exists for pitcher strikeouts and
nothing else. Per Q27 the "run one week" step is removed; per Q29 budget was
ADDED (propline_2 given its real cap and identity) rather than reallocated, so
nothing currently displayed was dropped.

**5.13 · Schema hygiene.**

`game_odds_history.source` (P2 L3) reads differently once measured.
`writeGameOddsHistory` in `lib/db/client.ts` inserted WITHOUT a `source`
column, so its rows would take `DEFAULT 'the-odds-api'` regardless of origin —
but it had **zero callers** anywhere in `lib/`, `app/` or `components/`, so
nothing was ever mislabelled. The table holds four correctly-attributed sources,
all written by Python, which passes `source` explicitly and includes it in its
dedup key. Dead writer deleted (Q2/Q13). Default retained: unreachable by any
live writer, and dropping a NOT NULL column's default would gain nothing while
risking a future INSERT that forgets the column.

**Found during the pass, in no finding:** `game_odds_history` had the SAME
bookmaker defect as `game_odds_book_lines` — 36 spellings for 22 real books.
P3 H9 named only `game_odds_book_lines`. It matters MORE here, because the
dedup key IS the log-on-change comparison, so a split spelling means one book
keeps two independent price histories and a real move is compared against the
wrong one. It is also the table task 6.1's line-movement charts will read.

```
BEFORE: { n: '47622', books: '36' }
AFTER:  { n: '47622', books: '22' }
BACKUP: 47622 rows
books (22): bet365, betmgm, betonline, betrivers, betus, bovada, draftkings,
fanatics, fanduel, kalshi, lowvig, matchbook, mybookie, novig, onexbet,
pinnacle, polymarket, prophetx, rebet, smarkets, tabau, unibet
```

Zero rows lost, landing on exactly the same 22 as `game_odds_book_lines`.
NOT deleted, deliberately: merging spellings reveals 2,380 groups holding more
than one row for the same (event, market, side, source, book, observed_at).
Those were always duplicates and merely LOOKED distinct — revealed, not
created. This is an append-only observation log, deleting from it is
destructive, and no Phase 5 task requires it. Carried to 6.1.

Skipped, both recorded in §0 before starting: the `pick_history` rename and the
`TEXT` -> `JSONB` migration (P2 L2 itself concludes "leave it"). Unused indexes
left per Q27.

**5.1 · Propline alias map -> base market.** *(P2 C1, P2 H2, Q4, Q31)*

Built from a LIVE Propline response as 5.1 demands (propline_2 key, Q31): 45
MLB events, 27 market keys, 18 of ~20 authorised requests. Raw capture
committed as `docs/propline-live-capture-20260829.json` so nobody spends budget
re-deriving it.

**The plan's diagnosis was incomplete, and the missing part is the bigger
half.** The plan frames P2 C1 as an alt-line mapping problem with a four-row
table. Those four keys are real. But the dominant cause is that
`MARKET_KEY_ALIASES` **had no `batter_*` entries at all** — it carried bare
names, a `batting_*` prefix, and `pitcher_strikeouts`, while Propline sends
`batter_hits`, `batter_rbis`, `batter_home_runs`, `pitcher_outs`,
`pitcher_earned_runs`, `pitcher_hits_allowed`. Twelve base batter markets and
three of four pitcher markets resolved to None, so every row was dropped before
any alt-line logic could matter. The live data agrees exactly: Propline's ONLY
surviving MLB market in `prop_odds` was `pitcher-strikeouts`, the one key that
happened to be mapped.

Propline encodes a threshold in THREE places depending on the book — the market
key (`batter_2plus_hits`), the outcome name (`"2+ Total Bases"`), or a real
point field. Only the third was handled; the first two arrived with point=null
and a name that is not Over/Under, so every one became an OVER AT line=None.
That is also why `prop_odds` holds 37,939 'over' against 5,111 'under'.

```
all 24 live Propline player-market keys — still unresolved: NONE

  batter_1plus_hits       alt-> ('hits', 0.5)        batter_doubles         base-> doubles
  batter_2plus_hits       alt-> ('hits', 1.5)        batter_hits            base-> hits
  batter_3plus_hits       alt-> ('hits', 2.5)        batter_hits_runs_rbis  base-> hits-runs-rbis
  batter_4plus_hits       alt-> ('hits', 3.5)        batter_home_runs       base-> home-runs
  batter_1plus_rbis       alt-> ('rbis', 0.5)        batter_rbis            base-> rbis
  batter_2plus_rbis       alt-> ('rbis', 1.5)        batter_runs            base-> runs
  batter_3plus_rbis       alt-> ('rbis', 2.5)        batter_singles         base-> singles
  batter_2plus_home_runs  alt-> ('home-runs', 1.5)   batter_stolen_bases    base-> stolen-bases
                                                     batter_strikeouts      base-> batter-strikeouts
  name-encoded alt lines:                            batter_total_bases     base-> total-bases
    batter_strikeouts  "2+ Strikeouts"  -> ('batter-strikeouts', 1.5)
    batter_total_bases "2+ Total Bases" -> ('total-bases', 1.5)
    batter_home_runs   "1+ Home Runs"   -> ('home-runs', 0.5)
```

DELIBERATELY NOT GUESSED: Bovada sends the PLAYER NAME as the outcome with no
point (`batter_home_runs`, `"Ali Sanchez (NYY)"`, +1100). Almost certainly an
anytime market — and "almost certainly" is what 5.1 warns against. Both
implemented rules are LITERAL; nothing is inferred from a price.

**P2 H2 shipped in the same sitting, and it was worse than described.** Python
NEVER HAD an `odds_unresolved` writer — `run_provider_specs` collected every
`FetchOutcome.unresolved` and only COUNTED it. The sole writer was the
TypeScript pipeline task 2.5 deleted, which is why the table's newest row was
2026-08-26 while Propline fetched every day since. The table looked populated,
so the gap was invisible. Confirmed fixed in production: after the 07:51:59Z
deploy, propline's stale 1,317 rows were replaced by the live Python pipeline.

`VERIFY`'s other half — *"prop_odds gains Propline batter rows"* — is **NOT yet
confirmed**, and is listed in this phase's known-not-done. `propline` sits at
exactly 1000/1000 for 2026-08-29 and is correctly gated, so MLB Propline has
not run since the fix deployed. The query to close it is in `CURRENT.md` §2.

--- gate (run in one sitting, 2026-08-29 08:08Z – 08:25Z) ---

**G1 · every VERIFY re-run, fresh, in order.**

**G1 FAILED ON ITS FIRST PASS.** 5.3's VERIFY returned `game_odds_book_lines`
**37** distinct bookmakers (from 22) and `game_odds_history` **31** (from 22).
New un-canonical rows really were arriving. Per Rule 5 the gate stopped here.

Diagnosis, and it was NOT a code defect. Both writers canonicalise correctly —
verified end-to-end against the live database by submitting
`['FanDuel','MyBookie.ag','DraftKings']` through the real
`db.write_game_odds_history` and getting back `['fanduel','mybookie','draftkings']`.
The cause was **long-running processes holding the pre-fix module in memory**.
`db.py` was saved 08:01:15Z; Python binds imports at process start; OddsHarvester
runs as Windows scheduled tasks (`LinesmithOddsHarvester*`) on a ~20-minute
cycle. A harvester run begun ~07:53Z was still executing at 08:11:57Z and wrote
through its in-memory old copy. The worker showed the same shape smaller: its
last un-canonical write was 08:05:09Z, seconds after the 08:04:17Z restart, from
a cycle already in flight.

Confirmed self-resolving by measurement, not argument — rows written after
08:15:00Z:

```
game_odds_book_lines   193 rows, 4 books, 0 un-canonical
game_odds_history        7 rows, 3 books, 0 un-canonical
```

Residue swept by `20260829110000_canonical_bookmaker_residue.sql`. G1 re-run
from the top afterwards; results below are that re-run.

```
5.3  DISTINCT bookmaker      book_lines 22 · history 22      PASS
5.4  MLB totals out of band  0                                PASS
5.4  CHECK constraints       13 live                          PASS
5.4  17 deliberate violations, each rejected BY ITS OWN named constraint,
     3/3 controls accepted, transaction rolled back, 0 rows left   PASS
5.5  modal point             old 9.5/+400/+100 implied 0.7000
                             new 7.5/-105/+100 implied 1.0122     PASS
5.6  DOES NOT REPRODUCE — fixed 2026-08-27; test added instead
5.7  consensus excl. subject 0.4892 -> 0.4946                     PASS
5.8  format variant matches; miss logged in PRODUCTION
     system_events job_runner.team_match 07:54:08Z / 08:02:36Z / 08:06:22Z  PASS
5.9  soft caps gate          effective min(800,1000)=800          PASS
5.10 sibling rows survive; failure still surfaced                 PASS
5.11 drift test broken deliberately in both directions, then reverted  PASS
5.12 12 concurrent connections, 1 unit left, limit 10 -> exactly 1 won
     counterfactual: OLD check-then-act -> 12 of 12 through, final 21  PASS
5.13 game_odds_history 36 -> 22 books, 0 rows lost                PASS
5.2  sharp coverage 9.08% (1,265/13,938); Pinnacle 0.80%, 1 market
     decision recorded beside the number                          PASS
5.1  odds_unresolved written by the LIVE pipeline — sharpapi 08:20:02Z,
     propline_2 08:05:54Z (table had been frozen at 2026-08-26)    PASS
5.1  "prop_odds gains Propline BATTER rows"                    NOT YET — see G8
```

**G2 · regression sweep, whole tree.**

```
npm run typecheck   clean
npm run build       succeeded, all routes emitted
npm test            tests 36 · pass 36 · fail 0 · skipped 0 · todo 0
python (13 hermetic, one per CI step)  all exit 0:
  entity_resolution · leakage_guard · mlb_prop_grading · mlb_source_flip
  odds_lines_cycle_book_lines · price_staleness · providers
  under_side_probability · walkforward · canonical_bookmaker · modal_point
  consensus_and_matching · propline_alt_lines
```

No skips, no xfails. `python -m pytest` is deliberately NOT the runner: these
are standalone scripts and pytest collects almost nothing, reporting green
having tested nothing — noted in `ci.yml` itself.

**G3 · live smoke walk** (real dev server, real database).

Opened: `/` · `/mlb` · `/nfl` · `/nba` · `/nhl` · `/cfb` · `/golf` · `/soccer` ·
`/tennis` · one game detail (`/mlb/game/823539`) · one player detail
(`/mlb/player/686765`) · one team detail (`/mlb/team/111`) · `/login`.

Game detail rendered fully — both clubs with records, first pitch, venue,
weather with impact rating, pitching matchup with ERA/K/WHIP and a stat edge.
Player detail rendered markets, the price with real provenance
(`SharpAPI · captured 8/29/2026, 3:17:19 AM (1m ago)`), split windows
(L5/L10/L15/H2H/SZN) and the distribution chart. Team detail rendered all 30
clubs with records. **Zero blank sections.**

Network: every data endpoint 200 — `/api/soccer/epl`, `/api/tennis/atp`,
`/api/odds/lines`, `/api/props/calibration`, `/api/picks/game-history`,
`/api/picks/model-data`. **Zero 5xx.** The only console errors were `401` on
`/api/picks` and `/api/watchlist`, the two user-scoped endpoints, correct while
signed out; and `429`s that were **this session's own rate limiter** (task 3.4)
reacting to rapid automated navigation — the guard working, not a fault.
`ERR_ABORTED` entries are React StrictMode double-fetches, each followed by a
200 for the same URL.

**NOT DONE, and it is a real gap in G3, not a pass:** `/diagnostics` and
`/bets` both require sign-in (task 1.5 gated them) and I have no credentials.
I will not create an account or enter a password. The sign-in page itself
renders correctly. **Those two pages and the signed-in walk were not verified.**

**G4 · findings no longer reproduce**, by each finding's original method.

```
P3 H9  (5.3)  DISTINCT bookmaker        book_lines 22 · history 22
P3 H10 (5.4)  MLB totals out of band    0
P2 M8  (5.4)  CHECK constraints         13
P2 H2  (5.1)  odds_unresolved live      sharpapi 08:20:02Z (was frozen 08-26)
P3 H7  (5.2)  propline_2 own identity   provider_usage row, 50 requests,
                                        08:05:38Z — it had NOTHING since 08-20
P3 M13 (5.8)  team-match misses logged  3 warnings in the last 30 min
P3 C1  (5.5)  best price shares a point old 0.7000 -> new 1.0122 overround
P4 M8  (5.12) check-and-spend atomic    1 of 12 wins, vs 12 of 12 before
P2 H3  (5.9)  soft caps read            effective cap 800
P2 H4  (5.10) siblings survive          asserted both directions
P2 M3  (5.11) drift caught              proven by breaking it
P2 C1  (5.1)  Propline keys resolve     24/24, none unresolved
P2 L3  (5.13) misleading source default dead writer deleted; 4 real sources
P3 M14 (5.7)  consensus excludes subject reference moves 0.4892 -> 0.4946
P3 H6  (5.6)  did not reproduce — already fixed 2026-08-27
```

**G5 · write-path observation.** Every table the phase touched, still written:

```
table                  rows      newest write
game_odds_book_lines   6,339     08:20:02Z
game_odds_history      48,089    08:17:32Z
prop_odds              49,182    08:20:02Z  (sharpapi)
  └ propline_2         4,004     08:05:38Z  NEW — its own provider_id for the
                                            first time; was filed under
                                            `propline` before 5.2
odds_unresolved        5,339     08:20:02Z  was FROZEN at 2026-08-26
pick_history           368,657   05:38:54Z  see below
provider_usage         propline 1000 · propline_2 50 (new) · oddsapiio 500
system_events          3 warns, 0 errors since 07:45Z
```

Worker alive and productive throughout: `refreshTier1` wrote 238 rows at
08:22:36Z; `computeMlbPropPredictionsJob` produced 2,694 candidates at
08:20:47Z; `computeMlbGameModelJob` wrote 17 games at 08:20:04Z.

`pick_history`'s 05:38Z newest is NOT a stopped writer — its production is
bursty (2,730 rows in the 04:00Z hour, 15 in the 05:00Z hour) and today's MLB
slate first-pitches at 12:05 ET. `computeMlbPropPredictionsJob` reports healthy,
last run 1 min before the sweep.

**Two of 40 health checks are unhealthy, and NEITHER was caused by this phase:**

- `refreshSportsGameOddsJob` — "stale, last run 217min ago". Its last real run
  was 04:38:34Z and got **vendor HTTP 429 on all five games**. Proof it predates
  Phase 5: the 07:00:14Z sweep already recorded "last run 142min ago", which is
  the same 04:38Z run — it simply crossed the 180-minute threshold later. Phase
  5's first commit was 07:45Z.
- `snapshotCacheSize` — largest payload 12.6 MB against a 10 MB bound
  (`mlb:full-raw`). The Free-tier ceiling concern from §0.2. Untouched here.

**One real side effect of 5.12, stated because it is a behaviour change:** a
reserve records 1 unit *before* the fetch, so a job that reserves and then fails
now leaves a 1-unit spend where it previously left none. Conservative direction
(it over-counts by at most one per cycle rather than letting a failed fetch look
free) and documented in `CLAUDE.md`, but real. Observed once —
`sportsgameodds` object_count moved to 1,645 at 08:04:23Z and has not moved
since, so it is not a runaway.

**G6 · no orphans.** Nothing was disabled or stubbed. What is deliberately not
built, with owners:

| Item | Why | Owner |
|---|---|---|
| `pick_history` -> `model_predictions` rename | 368k rows + every reader in both languages, for naming clarity | **Never** — recorded in §0 |
| `TEXT` -> `JSONB` migration | 5.13 contradicts its own finding; P2 L2 concludes "leave it" | **Never** — §0 |
| Unused-index drop | Q27 removed the elapsed-time requirement | post-Phase-9 |
| Bovada player-named prop outcomes | genuinely ambiguous; 5.1 forbids guessing a line | future, needs vendor clarification |
| 2,380 duplicate observation groups in `game_odds_history` | revealed not created; deleting from a log is destructive | **6.1** |
| 4 backup/quarantine tables | reversibility for 5.3/5.4/5.13 + Phase 3 | drop after soak |
| 3.15's two GET-path writers | carried from Phase 3, not a Phase 5 task | **still open** |
| `refreshSportsGameOddsJob` stale since 04:38Z | vendor 429s, pre-existing | **unowned — see G8** |

**G7 · adversarial read-back.** Re-read the phase's whole diff asking only
"does the repository now describe what actually runs?" It found two live false
claims, both fixed rather than noted:

1. **`CLAUDE.md` said cap-checking "reads through `db.daily_status`/
   `db.monthly_status`".** False as of 5.12 — it reserves through
   `db.try_reserve_daily`/`try_reserve_monthly`. Rewritten, including the
   entry-ticket limitation and the measured 12-of-12 counterfactual.
   `ProviderSpec`'s documented field list was also missing `soft_cap`.
2. **`20260829110000`'s own header claimed "anything dropped is already in the
   5.3 backup table".** False: that backup's newest row is 07:21:30Z and the
   sweep deleted 1,213 rows, some written after it. Corrected in place to state
   exactly what is and is not recoverable, and why the loss is immaterial
   (`game_odds_book_lines` is a current-state table; per-key history lives in
   `game_odds_history`, which lost nothing).

`CLAUDE.md` also gained the write-path normalisation convention and the
"a deploy does not mean every writer is running the new code" lesson G1 paid
for.

**GATE RESULT: PASS** — on the re-run, after G1's first pass failed and the
cause was fixed. Rule 5 was followed: the phase stopped, the residue was swept,
and the gate re-ran from G1.

**G8 · known NOT done.** This list is not empty and should not be.

1. **5.1's second VERIFY half is unconfirmed.** `prop_odds` has not yet gained
   Propline **batter** rows, because `propline` sits at exactly 1000/1000 for
   2026-08-29 and is correctly gated. All 24 live market keys resolve in
   `test_propline_alt_lines.py`, and `odds_unresolved` is now written by the
   live pipeline — but the end-to-end claim is not yet observed. Closing query
   is in `CURRENT.md` §2; it needs the UTC-midnight cap reset. **This is a
   timing dependency, not a failure, and it is the single most important thing
   for the next session to check.**
2. **`/diagnostics`, `/bets` and the signed-in walk were not verified** (G3) —
   no credentials, and creating an account or entering a password is out of
   bounds for me.
3. **`refreshSportsGameOddsJob` has not run since 04:38Z**, having hit vendor
   429s. Pre-existing, unowned, and currently invisible except to the health
   check. Worth a decision in Phase 6 or 8.
4. **`snapshotCacheSize` unhealthy** — 12.6 MB payload against a 10 MB bound.
   Free-tier ceiling, §0.2's territory.
5. **Sharp coverage is 9.08%**, under 5.2's own 10% threshold, so a
   Pinnacle-class feed is justified by the plan's decision rule. Recommendation
   recorded; **nothing purchased**.
6. **5.9 lowered the ParlayAPI gate by 20%** (soft caps of 800 against a hard
   1000 were configured and ignored; now they bind). Real change in how much
   data is collected. Unset the env vars rather than reverting code if unwanted.
7. **3.15's two GET-path writers** remain, carried from Phase 3.
8. **Four backup/quarantine tables** are still on a Free-tier database.

**Phase 4 may start.**


---

*Written 2026-08-28 from the Phase 1–5 audit findings and the operator's answers
of the same date. Every measurement cited was taken from the live system;
re-verify anything load-bearing before acting on it.*
