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
TypeScript renders.** **Duration:** 2 weeks. **Depends on:** 0, 1.

This is the phase that prevents the audit's root cause from recurring. P3 §4
found 22 of 35 tables with writers in both languages, no locking, and "direct
ports" that had already drifted.

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

The jobs disabled in 0.8. Predictions must use only data strictly prior to
`commence_time`.

**VERIFY:** for a sample of new rows, every input feature's timestamp precedes
`commence_time`. Log the query.

### 2.3 · Move `/api/odds/lines`' writes to Python *(P4 H1)*

Three write passes on an unauthenticated GET: `logGameOddsHistory`,
`logTotalPredictionsFromLines`, `attachPricesFromLines`. `odds_lines_cycle.py`
already owns the lock passes; its docstring notes `attachPricesFromLines` is
unported. Port all three; the route becomes a pure read.

**VERIFY:** with the dev server **stopped**,
`SELECT count(*) FROM game_odds_history WHERE observed_at > now() - interval '24 hours';`
still grows.

### 2.4 · Remove the TypeScript golf writes *(P2 H1)*

`lib/sports/golf/adapter.ts` ~675 (`logGolfModelPredictions`), ~689
(`ingestGolfHistory`), ~696 (`gradeAllGolfPredictions`) run on every golf page
load, alongside the Python `golfPredictionsJob` whose registry comment falsely
claims the TS path was removed.

**VERIFY:** `golf_model_predictions` keeps advancing for 24 h with the dev
server stopped. Fix the false comment in `jobs.py` in the same commit.

### 2.5 · Port the user-triggered provider routes *(P2 M1)*

`scan-player`, `more-books`, `sharp-price` call TS provider code
(`tier1Refresh.ts`, `registry.ts`, `providers/*.ts`). Move to Python endpoints
or queued jobs, then **delete** the TS provider machinery.

**VERIFY (rule 2):** TS files deleted from the repo, and 48 h of `prop_odds`
writes observed with only Python running.

### 2.6 · Delete confirmed-dead code *(P2 M2)*

Verified zero importers this session:
- `lib/odds/nflGameLines.ts`
- `lib/odds/rundown.ts` (only importer is `nflGameLines.ts`)
- `lib/odds/props/sportsGameOddsRefresh.ts`

Plus P2 Step 4's list in order, `npm run typecheck` after each. Move
`better-sqlite3` + types to `devDependencies`.

### 2.7 · Move the in-process schedulers to `JOB_REGISTRY`

`lib/scheduler.ts`'s two `setInterval` timers (`refreshMlb`,
`refreshCalibration`) are per-process. On any platform running more than one
instance, every timer runs N times and every write happens N times. Consistent
with Q2 anyway.

**Doing this now, not at deploy time, is what makes Phase 8 safe.**

**VERIFY:** with two app processes running locally, `snapshot_cache` for
`mlb:snapshot` is written once per interval, not twice.

### 2.8 · Correct every misleading comment *(P2 M6, P2 H7)*

All six in P2 M6, plus the `CLAUDE.md` corrections in P2 M1. Do this last in
the phase, once behaviour is settled — writing them earlier means writing them
twice. Per rule 3, each correction ships with the observation proving it.

### Phase 2 exit

- [ ] `docs/table-ownership.md` committed, all 35 tables
- [ ] 48 h of writes to every shared table with the dev server stopped
- [ ] Leakage verification query logged
- [ ] Dead files deleted, not commented out
- [ ] Two local instances → one write per interval
- [ ] `CLAUDE.md` describes what actually runs

---

### Phase 2 gate

G1-G8 apply. Additionally:

- **48 hours, every shared table, dev server stopped.** Not a sample - all 22
  tables from `audit-handoff-phase-4-5.md` 1.2, each with `max(timestamp)` at
  T+0 and T+48h. Rule 2 is this phase's entire point; this is where it is
  proved.
- **Deletion means zero importers.** For every deleted file, a grep across both
  trees showing no remaining reference, run *after* the deletion.
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

### 3.2 · Error tracking *(P5 E3)*

Sentry free tier, `@sentry/nextjs`. Add a `/diagnostics` panel for a spike in
`system_events` where `source='cachedRoute'`.

**VERIFY:** revoke a grant for 60 s; confirm a Sentry event **and** a
`system_events` row.

### 3.3 · Fix the health checks that report green through an outage *(P3 M9)*

At the time of audit, with every provider job 986–1052 min stale:
```
gameOddsBookLinesFreshness    healthy   (counts rows over a 7-DAY window)
oddsHistoryAndPricesFreshness healthy   (satisfied by OddsHarvester alone)
propPredictionsFreshness      healthy   (counts rows generated from 17h-old prices)
```
Narrow each window to the job's own interval, and make freshness checks assert
on the *source* they claim to measure, not on any row arriving.

**VERIFY:** stop the worker for one interval; each of the three flips to
unhealthy.

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

Two instances of the same anti-pattern:
- `writeGameOddsHistory` — one sequential `SELECT` per row inside one
  transaction. Measured **13.5 s** per `/api/odds/lines` request on a 7-game
  match; ~2,268 tuples on a full slate.
- `writePropOdds` *(P2 M7)* — 3 round-trips per row inside one transaction.

Both fix the same way: one `DISTINCT ON (…) ORDER BY observed_at DESC` to fetch
priors, diff in memory, one multi-row `INSERT`.

**VERIFY:** `curl -w "%{time_total}"` on `/api/odds/lines` → **under 1 second**.
Time a full `writePropOdds` cycle before and after; log both.

### 3.11 · Tests and CI *(P3 M8, P5 E1, P5 E2)*

Scoped per Q2 — model math lives in Python (19 test files already). TypeScript
keeps the **display layer**:

- `lib/odds/devig.ts` — including 1.1 (over + under ≈ 1.0)
- `lib/odds/display.ts` — American↔decimal, using P3 §2.1's verified table
- `lib/odds/matching.ts` — `teamKey`; silently dropped 30 of 37 games
- `lib/db/pgClient.ts` `compile()` — including the jsonb `?` case (3.8)
- `middleware.ts` — encode P4 §2.1's status-code table
- `lib/odds/goodBets.ts` — best-price selection, once 5.6/5.7 land

CI: GitHub Actions running `typecheck`, `test`, `build`, plus `pytest` for
`python-odds-service`.

**VERIFY:** push a deliberate type error; CI goes red.

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

### Phase 3 exit

- [ ] Deliberately broken cache write → Sentry event + DB row
- [ ] Stopping the worker flips all three freshness checks red
- [ ] 429 above the rate limit
- [ ] Bogus ids → 400, no cache row
- [ ] `/api/odds/lines` under 1 second
- [ ] CI red on a deliberate error
- [ ] Headers present on a live response
- [ ] `npm audit --omit=dev` → 0 high, or each remaining one documented

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

*Written 2026-08-28 from the Phase 1–5 audit findings and the operator's answers
of the same date. Every measurement cited was taken from the live system;
re-verify anything load-bearing before acting on it.*
