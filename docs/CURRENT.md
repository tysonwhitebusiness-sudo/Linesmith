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
Mirrored in `CLAUDE.md` (auto-loaded) and backstopped by a Stop hook
(`scripts/session-handoff-check.sh`) that warns when this file goes stale.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — the plan. 104 findings, nine phases,
   ~2,500 lines. **Read §0 (working rules, standing decisions, the G1–G8 gate)
   and the phase you are working. Don't read it end to end** — §10's matrix maps
   every task to its finding ID.
2. **§11 of that plan** — the phase log. Real verification output. This is the
   record; when in doubt it beats this file.
3. **`docs/audit-phase-2.md` … `-5.md`** — the audits, for a finding's
   *reasoning*. §10 says which one.
4. **`CLAUDE.md`** — repo conventions, auto-loaded. Still overstates the Python
   cutover; **task 2.8 fixes that, so it is your phase's job.**
5. **`git log`** — commit messages carry reasoning, not just changes.

**Last updated:** 2026-08-28.
**Repo state:** clean, pushed (`origin/main` == `HEAD`), nothing pending deploy.

---

## 1. Where we are

**Phase 0 COMPLETE — gate PASSED.**
**Phase 1 COMPLETE — gate PASSED, with two caveats recorded in §11.**
**Phase 2 is next and has NOT started.**

Phase 1's ten tasks are all done and logged. Two exit items are deliberately
*not* ticked outright, and §11 says why:

- **502 body (1.10):** verified by construction (`exposeDetail` is gated on
  `NODE_ENV !== 'production'`) and by five forced errors leaking nothing — but
  **not** by observing a real 502, which needs an upstream failure that cannot
  be arranged from outside the process.
- **Price age with the worker stopped (1.2):** not run as written. The same
  property was observed directly on a genuinely 6-hour-old price (`6h ago` on
  the chip face, full date in tooltip). The operator was offered the controlled
  30-minute outage and did not ask for it.

## 2. Start here: Phase 2 — the ownership boundary

Use §0's kickoff prompt. **This is the phase that closes the audit's root
cause**: P3 §4 found **22 of 35 tables with writers in both languages**, no
locking, and "direct ports" that had already drifted.

**2.1 first, before any code change** — commit `docs/table-ownership.md`, one
row per table, all 35. The plan is explicit about why: P3 H2, H3 and C1 each get
harder the longer two languages own the same tables, so doing them before the
boundary is decided means doing them twice. The four user tables
(`bets`/`picks`/`watchlist`/`tracked_lines`) stay in TypeScript — request-scoped,
session-authenticated, correctly implemented. Do not move them.

Then 2.2 → 2.8 in order. Note **2.2 re-enables the six
`genericPropProduction*Job` entries** currently sitting in `DISABLED_JOBS` in
`python-odds-service/src/jobs.py` — that list names 2.2 as its owner.

**Rule 2 governs this phase**: "ported to Python" means the TypeScript is
*deleted*, not disabled, and 48 hours of writes observed from Python alone.

## 3. The one lesson that has now bitten three times

**Committed is not shipped. Check the DEPLOYED commit.**

- Phase 0: `87fa65e` "fix tennis crash" sat unpushed for days while production
  ran the broken code.
- Phase 1 gate (G5): the live worker was missing 1.2a's Python fix — committed,
  pushed, not deployed.
- The worker has **`autoDeploy: no`**. The health-check cron auto-deploys; the
  worker does not.

```
# after any push touching python-odds-service/ non-cosmetically
POST https://api.render.com/v1/services/srv-da36bm2bkg8c73fqrdeg/deploys
# then CONFIRM the live deploy's commit contains your work:
#   git merge-base --is-ancestor <your-sha> <deployed-sha>
```

## 4. Operational knowledge — do not re-derive it

- **Long tests can't survive the laptop sleeping.** The failure looks exactly
  like a pooler bug (`asyncpg.ConnectionDoesNotExistError`) and isn't one. Cost
  a full wrong hypothesis.
- **Database access:** write a temp `.mjs` in the repo root and `node` it — `pg`
  resolves only inside the repo. `DATABASE_URL` is `:6543` (transaction pooler);
  use `:5432` for `pg_dump`/`VACUUM`, which need session state. **Delete the temp
  file afterwards.**
- **`psql`/`pg_dump`** at `C:\Program Files\PostgreSQL\17\bin` (17.11), not on PATH.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, health cron
  `crn-da7lquqfngtc73ft1n2g`, owner `tea-da2ut3ibkg8c73d5gcdg`. `RENDER_API_KEY`
  is in `.env.local`; you are authorised to use it for env vars, restarts and
  deploys.
- **Python tests are standalone scripts, not pytest** — `python -u src/test_x.py`
  from `python-odds-service/`. 16 fast tests, all passing. Three cannot run in
  CI (two need ~25–50 min and live data; one imports a package that only exists
  on the scraper laptop) — input for task 3.11.
- **`next dev` overwrites `.next`**, so rebuild before `npm run start`.
- **Don't run recursive `grep`** over the repo — it times out on `node_modules`.
  Use the Grep tool.
- **You can `git push`.** A classifier block is per-call, not a standing rule.
- **`/api/odds/lines` takes ~115s** on a full MLB slate. Task 3.10. It will slow
  every manual test you do.

## 5. Carried forward (not forgotten)

- **The 1.1 backfill** of 1,209 under-side rows — deferred by operator decision.
  There is also a correctness problem: `edge = -edge` is right only for rows
  written under the old model-vs-market formula; Python-era rows use
  `market_prob - implied_raw` and `implied_raw` is not stored, so an unknown
  subset may be **uncorrectable**. **Phase 4 must know this** before treating
  that history as trustworthy.
- **1.1 is not yet observed in production data.** Verified by unit test and by
  the deployed commit, but the dimensions still writing under-side rows
  (`first-inning`, `vs-RHP`, `vs-LHP`) carry no `model_prob` at all, and the
  stat markets that do had not run since the deploy. Re-check after an MLB slate.
- **Remaining `detail:` returns** on `/api/diagnostics/*` and `/api/props/*`
  backfill routes — no longer public after 1.5, so exposure is closed, cleanup
  is not.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Supabase removed the
  ability for legacy keys. Needs the publishable/secret migration; Phase 7.
- **`docs/discord-community-prompt.md`** is untracked and belongs to the
  operator, not to any task. Left alone deliberately; the Stop hook will keep
  flagging it.

## 6. Standing decisions made verbally (applied; not in §0's table)

- Supabase on **Pro + Micro compute** — 8.1 pulled forward, because
  `player_game_history` is 830 MB of training data 4.7 needs more of.
- Weekly backup via **Windows Task Scheduler** (`scripts/weekly-backup.sh`,
  Sundays 03:00); **task 8.9** added to move it off the laptop.
- **Phase gates G1–G8** are binding: a phase ends when its gate passes, and one
  failed check fails the gate.
- Scan's **Score column removed** until 6.7; **Home Runs tab keeps ordering** by
  modelProb (Tier C — a ranking with no number shown).

## 7. Product direction, as discussed

The pivot is from *asserting* predictions to *supplying* evidence. §0's Tier A–E
table is the rule. The model is **not abandoned — it is escrowed**: Q6 keeps it
computing, writing and grading in shadow; 4.2 makes it earn its way out by
beating `market_prob`'s Brier score on held-out live rows.

Worth remembering when prioritising: **6.1's line-movement charts need no new
data** — 425,307 prop points and 19,667 game-line points, displayed nowhere. The
operator has raised pulling that forward.
