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
commit and push. Do not start a task you cannot checkpoint before that line.
The operator cycles between accounts on hourly/daily limits, so sessions end
abruptly — a session that runs to exhaustion without rewriting this file has
lost everything that was only in its transcript. Also mirrored in `CLAUDE.md`,
which loads automatically.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — the real plan. 104 audit findings
   sequenced into nine phases, ~2,000 lines. **Read §0 (working rules, standing
   decisions, and the G1–G8 phase gate) and the phase you are working. Don't
   read it end to end** — §10's matrix maps every task to its finding ID, so
   look things up as needed.
2. **§11 of that plan** — the phase log. What is actually done, with real
   verification output pasted in. This is the record; when in doubt it wins
   over this file.
3. **`docs/audit-phase-2.md` … `-5.md`** — the audits the plan is built from.
   Go here for a finding's *reasoning*, not just the instruction. §10 tells you
   which one.
4. **`CLAUDE.md`** — repo conventions (API route caching, the sport-adapter
   architecture, the Python provider-job architecture). Loads automatically.
   Note it still overstates the Python cutover; task 2.8 fixes that.
5. **`git log`** — this project's commit messages carry the reasoning, not just
   the change. Genuinely worth reading for recent work.

**Last updated:** 2026-08-28, end of the Phase 0 session.
**Repo state:** `origin/main` == local `HEAD`, working tree clean, nothing pending deploy.

---

## 1. Where we are

**Phase 0 is complete and verified except one check.** Everything else in the
phase is done, with real output pasted into §11 of the plan.

The one open item is **G2's last model test**:

```
test_mlb_mlp.py         PASS — exit 0, 2969s (49.5 min). Needed time, not fixing.
test_mlb_tree_models.py RUNNING when this session ended — result unknown.
```

Run it from `python-odds-service/` (**not** from `src/`), and give it an hour:

```
cd python-odds-service
python -u src/test_mlb_tree_models.py
```

It is slow for a real reason: `SIM_TRAINING_N = 300` in
`predict/model_fit.py:59` × ~2,200 games × 2 seasons ≈ 1.3M pure-Python game
simulations. Its docstring says it builds that training set **once** and reuses
it across all three tree libraries, so expect roughly `test_mlb_mlp`'s runtime,
not triple. If it passes, **close the Phase 0 gate in §11 with
`GATE RESULT: PASS`.** If it fails on an assertion, that is a real finding —
stop and report it. If it simply cannot finish in a bounded window, record that
as the result and close the gate on that basis; do not keep re-running it.

Then, and only then, start Phase 1 — the plan's rule 4 is binding.

## 2. Starting Phase 1

Use the kickoff prompt in §0 of the plan. Phase 1's goal: *every number on
screen is a verifiable fact or a clearly labelled unvalidated signal.* Ten
tasks, `### 1.1` … `### 1.10`, with a file map at the end of the phase — line
numbers there are from 2026-08-27, so **re-locate by symbol, not by line.**

**Four findings I already re-verified on 2026-08-28 — do not re-check these:**

| Task | Confirmed still reproducing |
|---|---|
| 1.2 | `app/api/odds/lines/route.ts` stamps `new Date().toISOString()` at 4 sites |
| 1.5 | `middleware.ts:41` — `ADMIN_API_PREFIXES = ['/api/diagnostics']` only, so every `/api/props/*` route including `fit-weights` answers anonymous callers |
| 1.7 | `lib/scheduler.ts:48` — `CALIBRATION_INTERVAL_MS = 2 * 60_000` |
| 1.10 | `lib/cachedRoute.ts:141` returns `detail: error.message` to anonymous callers |

**1.6 is nearly free and has live evidence.** Every worker tick logs
`warn: ODDS_API_KEY is not set — game lines are turned off.` The key exists in
`.env.local`; it was never added to Render. Set it via the Render API on
`srv-da36bm2bkg8c73fqrdeg`, then remove the TS route's ownership of the same
job.

**Still needs verification before acting:** 1.1, 1.3, 1.4, 1.8, 1.9.

**Suggested order.** 1.1 first — it gates the whole grade question, and a Tier C
ranking built on an inverted under-side probability ranks half its rows on the
wrong number. Then 1.6 and 1.7 (both tiny). Then 1.2, which the plan calls the
single most user-protective change in the document. 1.3/1.4 are the large UI
sweep; leave them until the numbers underneath are correct.

## 3. Operational knowledge — this session paid for it, don't re-derive it

- **Database access:** write a temp `.mjs` in the repo root and `node` it — `pg`
  resolves only inside the repo. `.env.local`'s `DATABASE_URL` is now `:6543`
  (transaction pooler). Use `:5432` for `pg_dump` and `VACUUM`, which need
  session state. **Delete the temp file afterwards.**
- **`psql`/`pg_dump` are installed** at `C:\Program Files\PostgreSQL\17\bin`
  (PostgreSQL 17.11, installed this session — not on PATH).
- **Render**: worker `srv-da36bm2bkg8c73fqrdeg`, health-check cron
  `crn-da7lquqfngtc73ft1n2g`, owner `tea-da2ut3ibkg8c73d5gcdg`.
  `RENDER_API_KEY` is in `.env.local` and you are authorised to use it for env
  vars, restarts and deploys. **The cron auto-deploys; the worker does not** —
  any push touching `python-odds-service/` non-cosmetically needs
  `POST /v1/services/srv-da36bm2bkg8c73fqrdeg/deploys`.
- **Python tests are standalone scripts, not pytest** (`python test_x.py`),
  run from `python-odds-service/`. There is no pytest in this repo; G2's text
  is wrong about that and §11 records the correction.
- **Don't run recursive `grep` over the repo** — it times out on `node_modules`.
  Use the Grep tool.
- **`/api/odds/lines?sport=mlb` takes ~115 seconds** on a 15-game slate, so any
  page that waits on it sits on "Loading…" for two minutes. That is task 3.10,
  not a Phase 1 bug, but it will slow every manual test you do.
- **I can `git push`.** An earlier push this session was blocked by the auto-mode
  classifier and I wrongly generalised that into "the operator must push." A
  later attempt worked. Try before assuming.

## 4. Standing decisions made verbally (already applied, not yet in §0's table)

- Supabase is on **Pro + Micro compute** — Phase 8.1 pulled forward, because
  `player_game_history` is 830 MB of training data Phase 4.7 needs more of.
- Weekly backup runs via **Windows Task Scheduler** (`scripts/weekly-backup.sh`,
  Sundays 03:00) as a laptop stopgap; **task 8.9** was added to move it.
- **Phase gates G1–G8** were added to §0 at the operator's request and are
  binding: a phase ends when its gate passes, and one failed check fails the
  gate.
- `SUPABASE_SERVICE_ROLE_KEY` **cannot be rotated** — Supabase removed the
  ability for legacy keys. Deleted from `.env.local` and Render; real revocation
  needs the publishable/secret key migration, deferred to Phase 7.

## 5. Optional, small — better at the start of a session than the end

Add a Stop hook to `.claude/settings.json` that keeps this file from going stale
when a session ends abruptly. Nothing updates `CURRENT.md` automatically today;
it depends on whoever is driving remembering to rewrite it.
