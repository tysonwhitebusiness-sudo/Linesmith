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
commit and push. Don't start a task you can't checkpoint before that line. The
operator cycles between accounts on hourly/daily limits, so sessions end
abruptly — a session that runs to exhaustion without rewriting this file has
lost everything that was only in its transcript. Mirrored in `CLAUDE.md`, which
loads automatically, and backstopped by a Stop hook
(`scripts/session-handoff-check.sh`) that warns when this file has gone stale.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — the real plan. 104 audit findings
   sequenced into nine phases, ~2,100 lines. **Read §0 (working rules, standing
   decisions, and the G1–G8 phase gate) and the phase you are working. Don't
   read it end to end** — §10's matrix maps every task to its finding ID.
2. **§11 of that plan** — the phase log. What is actually done, with real
   verification output pasted in. This is the record; when in doubt it wins
   over this file.
3. **`docs/audit-phase-2.md` … `-5.md`** — the audits the plan is built from.
   Go here for a finding's *reasoning*. §10 tells you which one.
4. **`CLAUDE.md`** — repo conventions. Loads automatically. Note it still
   overstates the Python cutover; task 2.8 fixes that.
5. **`git log`** — commit messages here carry the reasoning, not just the
   change. Worth reading for recent work.

**Last updated:** 2026-08-28 (Phase 1 in progress).
**Repo state:** working tree clean, pushed, nothing pending deploy.

---

## 1. Where we are

**Phase 0 COMPLETE, gate PASSED 2026-08-28.** Logged in §11 with raw output.

**Phase 1 IN PROGRESS — 7 of 10 tasks done, each committed and pushed
separately with its verification in the commit message.**

| Task | State |
|---|---|
| 1.1 inverted under-side probability | DONE — fixed in **both** languages |
| 1.2 `fetchedAt: now()` lie | DONE — all three parts (a/b/c) |
| 1.5 gate the operator surface | DONE — verified against a real prod build |
| 1.6 `ODDS_API_KEY` to the worker | DONE — set on Render, TS route made read-only |
| 1.7 calibration timer 2min→30min | DONE |
| 1.8 `event_context` filter | DONE — 354,862 → 38,535 rows |
| 1.10 error-detail leak | DONE |
| **1.3 hide Tier D/E** | **NOT STARTED — needs an operator decision, see below** |
| **1.4 strengthen Tier A+B** | **NOT STARTED — pairs with 1.3** |
| **1.9 "Source not recorded"** | **NOT STARTED — tracing work, no decision needed** |

### The pattern worth carrying into 1.9

Both Phase 0's tennis crash and 1.1 were bugs the audit located in TypeScript
that had *since been ported into Python and were live there*. 1.1 was worse: the
Python edge had been **redesigned** on 2026-08-27, so the sign error outlived the
calculation it was found in and corrupted a quantity the audit never analysed.
**Check the Python side first on 1.9.** The audit's file map is accurate for
2026-08-27 and the tree has moved.

### Deferred deliberately

- **The 1.1 backfill of 1,208 under-side rows.** Operator decision, 2026-08-28.
  Beyond size, there is a real correctness problem: the audit prescribes
  `edge = -edge`, which is only right for rows written under the old
  model-vs-market formula. Python-era rows use `market_prob - implied_raw`, and
  `implied_raw` is not stored, so some may be **uncorrectable**. Phase 4 should
  know this before leaning on that history.
- **The non-admin leg of 1.5's matrix.** Anonymous (401) and public (200) legs
  are verified. A signed-in NON-admin should get 403 on admin routes and 200 on
  scan-player — that needs a second account.
- **Remaining `detail:` leaks** on `/api/diagnostics/*` and `/api/props/*`
  backfill routes. 1.5 just put those behind admin auth, so re-check after
  rather than editing twice.

## 2. The open question blocking 1.3 / 1.4

1.3 removes the Edge % column and Good Bets' edge track, and hides model
probabilities on Scan, Player Detail and Game Detail. 1.4 replaces them with
Tier A/B substance (sample sizes, window definitions, best price with the book
named).

**What has not been decided is what the Scan table's Score column becomes.**
Prop Score is Tier C-ish (a ranking), but it is computed *from* `model_prob` and
`edge`, which Q1 says may never be shown as probability or edge. Options put to
the operator: keep it as an unnumbered rank, keep a number with no units, or
remove it until 6.7 brings ranking back deliberately. Do not guess — the whole
phase is about not asserting things.

## 3. Operational knowledge — this session paid for it, don't re-derive it

- **Long tests can't survive the laptop sleeping.** A run that reaches for the
  database after a lid-close dies with
  `asyncpg.ConnectionDoesNotExistError: connection was closed in the middle of
  operation`, which reads exactly like a pooler bug and isn't one. Cost a full
  wrong hypothesis this session. Keep the machine awake or expect to re-run.
- **Database access:** write a temp `.mjs` in the repo root and `node` it — `pg`
  resolves only inside the repo. `DATABASE_URL` is `:6543` (transaction pooler);
  use `:5432` for `pg_dump` and `VACUUM`, which need session state. **Delete the
  temp file afterwards.**
- **`psql`/`pg_dump` installed** at `C:\Program Files\PostgreSQL\17\bin`
  (17.11) — not on PATH.
- **Render**: worker `srv-da36bm2bkg8c73fqrdeg`, health cron
  `crn-da7lquqfngtc73ft1n2g`, owner `tea-da2ut3ibkg8c73d5gcdg`.
  `RENDER_API_KEY` is in `.env.local`; you are authorised to use it for env
  vars, restarts and deploys. **The cron auto-deploys; the worker does not** —
  any push touching `python-odds-service/` non-cosmetically needs
  `POST /v1/services/srv-da36bm2bkg8c73fqrdeg/deploys`.
- **Python tests are standalone scripts, not pytest** (`python -u src/test_x.py`
  from `python-odds-service/`). There is no pytest here; §11 records that G2's
  text is wrong about it.
- **`next dev` overwrites `.next`,** so a production build must be redone before
  `npm run start`. Bit me once.
- **Don't run recursive `grep` over the repo** — it times out on `node_modules`.
  Use the Grep tool.
- **You can `git push`.** A push blocked by the auto-mode classifier is a
  per-call decision, not a standing rule. Try before assuming.

## 4. Standing decisions made verbally (applied; not yet in §0's table)

- Supabase on **Pro + Micro compute** — Phase 8.1 pulled forward, because
  `player_game_history` is 830 MB of training data Phase 4.7 needs more of.
- Weekly backup via **Windows Task Scheduler** (`scripts/weekly-backup.sh`,
  Sundays 03:00), a laptop stopgap; **task 8.9** added to move it.
- **Phase gates G1–G8** added to §0 and binding: a phase ends when its gate
  passes, and one failed check fails the gate.

## 5. Product direction, as discussed

The pivot is from *asserting* predictions to *supplying* evidence. §0's Tier
A–E table is the rule: descriptive facts and best-price ship; calibrated
probabilities and edge do not. The model is **not abandoned — it is escrowed**:
Q6 keeps it computing, writing and grading in shadow, and 4.2 makes it earn its
way out by beating `market_prob`'s Brier score on held-out live rows.

Worth remembering when prioritising: 6.1's line-movement charts need **no new
data** (425,307 prop points, 19,667 game-line points, currently displayed
nowhere), and the operator has raised the idea of pulling that forward.
