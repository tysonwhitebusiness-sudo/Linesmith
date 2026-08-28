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

**Last updated:** 2026-08-28.
**Repo state:** working tree clean, pushed, nothing pending deploy.

---

## 1. Where we are

**PHASE 0 IS COMPLETE. Its gate PASSED on 2026-08-28** — G1–G8 all satisfied,
logged in §11 with raw output. **Phase 1 may start.**

Final G2 result (the last thing outstanding):
```
PASS  test_mlb_mlp.py         exit 0, 2969s (49.5 min)
PASS  test_mlb_tree_models.py exit 0, 1408s (23.5 min)
18 of 19 python tests pass; the one failure is an environment gap
(test_harvester_scrape.py imports `oddsharvester`, which only exists on the
scraper laptop and is not in requirements.txt).
```

Carried forward deliberately, not forgotten — full list in §11's "known NOT
done":
- `SUPABASE_SERVICE_ROLE_KEY` can't be rotated (Supabase removed the ability
  for legacy keys) → Phase 7's publishable/secret key migration.
- DB at 1,280 MB, over the old 500 MB Free ceiling by design → Pro makes it moot.
- `ODDS_API_KEY` missing on the worker → that's task **1.6**.
- `/api/odds/lines` takes ~115s → that's task **3.10**, and it is the worst
  thing a real user meets today.

## 2. Starting Phase 1

Use the kickoff prompt in §0. Phase 1's goal: *every number on screen is a
verifiable fact or a clearly labelled unvalidated signal.* Ten tasks,
`### 1.1` … `### 1.10`, with a file map at the end of the phase — **line numbers
there are from 2026-08-27, so re-locate by symbol, not by line.**

**Four findings re-verified 2026-08-28 — do not re-check:**

| Task | Confirmed still reproducing |
|---|---|
| 1.2 | `app/api/odds/lines/route.ts` stamps `new Date().toISOString()` at 4 sites |
| 1.5 | `middleware.ts:41` — `ADMIN_API_PREFIXES = ['/api/diagnostics']` only, so every `/api/props/*` route including `fit-weights` answers anonymous callers |
| 1.7 | `lib/scheduler.ts:48` — `CALIBRATION_INTERVAL_MS = 2 * 60_000` |
| 1.10 | `lib/cachedRoute.ts:141` returns `detail: error.message` to anonymous callers |

**1.6 is nearly free and has live evidence.** Every worker tick logs
`warn: ODDS_API_KEY is not set — game lines are turned off.` The key is in
`.env.local` and was never added to Render. Set it via the Render API on
`srv-da36bm2bkg8c73fqrdeg`, then remove the TS route's ownership.

**Still needs verification before acting:** 1.1, 1.3, 1.4, 1.8, 1.9.

**Suggested order.** 1.1 first — it gates the whole grade question, and a Tier C
ranking built on an inverted under-side probability ranks half its rows on the
wrong number. Then 1.6 and 1.7 (tiny). Then 1.2, which the plan calls the single
most user-protective change in the document. 1.3/1.4 are the large UI sweep —
leave them until the numbers underneath are correct.

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
