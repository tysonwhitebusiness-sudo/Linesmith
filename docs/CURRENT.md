# CURRENT — pick up here

**Rewritten 2026-09-20.** The previous version had grown to 493 append-only
lines, which is the thing this file is explicitly not supposed to become. Its
content was not lost: every track's detail lives in that track's own plan, which
this file now points at rather than duplicating. If you want the old text, it is
in git (`git show c5baee4:docs/CURRENT.md`).

---

# START HERE

**The build is running unattended.** The operator left 2026-09-20 for several
hours and asked for the gameplan to be worked through while they are away.

**Your prompt is `docs/design/HANDOFF-autonomous-build-2026-09-20.md`.** Read it
before anything else. It says what to build, in what order, what to do instead
of stopping for sign-off, and the short list of things that genuinely stop you.

**The plan is `docs/design/master-gameplan-ui-and-slate.md`.** Phases 1–4 are
done and deployed. **Start at phase 5 (U0).**

**Decisions you would have asked about go in `docs/design/SIGNOFF-QUEUE.md`**,
not into a stop.

---

## What is true this morning (measured, 2026-09-20 07:48 UTC)

**Every sport can predict a game.** That was the last thing the operator asked
for and it is done, deployed (`c5baee4`, `dep-danoti942hec73f7n6i0`, live 07:45)
and verified against production:

| sport | game model | verified live |
|---|---|---|
| MLB | its own ensemble | 5 picks |
| NFL · CFB · NBA · NHL | generic Elo | NFL 14, NHL 7 captured 07:48 |
| soccer (EPL, MLS) | generic Elo, **three-way** | capture resumed — EPL 4, MLS 1 at 07:48 |
| tennis (ATP, WTA) | the surface-weighted engine, finally wired | 55 WTA picks at 07:45; ATP has no matches until 09-23 |
| golf | event-as-field Elo over a 235-event backfill | 1,863 golfers rated; ranks only, publishes no win probability |

Register: **16 rows — 1 gated, 10 baseline, 1 failed, 4 none.** All 46 jobs ran
after the deploy, including the three new ones (`tennisPicksJob`,
`slateRankingsJob`, `modelStatusJob`) and `modelGateJob`.

**The model vocabulary is internal.** `baseline` / `gated` / `simple` /
`advanced` / "not validated" decide what a page may show; **none of them may
appear on a customer surface.** Operator, 2026-09-20, unambiguous. M1's spec
originally said the opposite and is corrected in the gameplan. `/diagnostics` is
the one allowed exception.

**Player props are out of scope.** The Elo work was about games only. Render
what exists; build no prop model.

---

## The three tracks

| track | plan | state |
|---|---|---|
| **Models (M)** | `docs/design/master-gameplan-ui-and-slate.md` §4 Stage 0, and `docs/master-plan-2026-09-06.md` for the Phase 6/7 close-outs | M0–M3 **done and deployed**. M4 (promotion tests) runs on its own. M5 unapproved |
| **UI system (U)** | `docs/design/ui-system-master-prompt.md` | Not started. **U0 is the next thing to build** |
| **Slate (S)** | `docs/design/slate-sheet-cards.md`, mockup `docs/design/slate/slate.html` | Not started. Needs U2 and U5 first |
| Research pages (R) | `docs/audit-2026-09-13/RESUME-PROMPT.md` | R1–R12 all **built and pushed**. R10/R11/R12 await sign-off, and gate nothing |

---

## Owed by the operator

- **Rebuild and restart the port-3000 production server.** It predates the
  2026-09-19 ESPN range fix and will blank NFL/CFB/soccer again on its next
  rebuild. Carried since M0; no agent can do it.
- **Sign-off** on R10/R11/R12, M1's seeded statuses, M2's CFB calibration, and
  M3's first frozen rankings (real receipts land 2026-09-21). All four are rows
  in `docs/design/SIGNOFF-QUEUE.md`.

---

## Open findings worth knowing before you build

- **SL-7:** CFB's game gate cannot run at all — 136 picks considered, **0**
  matched a reference close. Re-confirmed live 07:46. Same for soccer (75
  considered, 0 matched), NBA, NHL, tennis and golf (0 considered each).
- **SL-9:** the blend-weight fit (M2 fit 2) had no inputs because
  `initial_ml_features_json` was NULL on every generic-Elo row. Fixed forward —
  the capture stores them from 2026-09-20, so the fit becomes possible once a
  few weeks accumulate. `MARKET_BLEND_WEIGHT` 0.5 and `ELO_BLEND_WEIGHT` 0.2 are
  still hand-set placeholders.
- **SL-1:** stale and exchange quotes are in the game-line data (a +10000
  moneyline and a `0` price, both live 2026-09-19). S1 drops `|odds| < 100` and
  anything >15 implied points from the median.
- **SL-4:** `game_odds_history` holds NHL API ids, not ESPN's. The S1 adapter
  must bridge them.
- **MLB's game model is below the close** — mean −0.0563 prob-points, 38.0%
  positive on 305/448 matched picks (re-measured 07:46). It is `baseline`, so
  S5 shows its picks but no probability beside a price. See queue row Q0.
- `refreshTier1` overruns its 150s interval (171.75s) on the one cycle where all
  five provider throttle windows open at once.
- `price` holds a copy of `line` on espn_core spread rows; 0 of 988 are
  plausible odds. Guard: a price outside ±100…100000 is not a price.
- `athlete_name` is NULL on all 25,420 NBA prop rows. `athlete_id` joins fine.
- The corpus refresh and OddsHarvester only run while the operator's machine is
  awake (Phase 10 scope arriving early).

---

## Habits that keep paying

- **Audit a phase's premises before building it.** Phase 6's brief had four
  false premises and Phase 7's had four more, one of which decided the phase.
  Three of M0–M3's task premises were wrong too. Any claim about where data
  lives, or how much of it there is, is stale by default.
- **Pre-register the test before the code that runs it.** It turned a "promising
  pocket" into a recorded untestable instead of a false positive.
- **Render before believing.** A test built on the same wrong model as the code
  agrees with the bug. Open the page — in a **fresh tab**, because worn
  browser-pane tabs stop running effects and have already produced one false
  "nothing loads" finding.
- **If a whole sweep 500s at once, restart the dev server before debugging.**
  Its render workers die ("Jest worker encountered 2 child process exceptions")
  and every route 500s, including pages that rendered a minute earlier.

---

## Standing constraints

- **Ask before deploying to Render.** `render.yaml` has `autoDeploy: false`, so
  `git push` does **not** deploy — pushing is safe and needs no permission.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's. Add named files only (`git add docs/CURRENT.md` is fine).
- **Back up before deleting.** `prune_corpus` verifies every row is in the
  corpus by id and content fingerprint first, and refuses while the corpus is
  local-only.
- The Postgres pooler caps at **15 connections** — check for running fits before
  starting DB work.
- Python tests and fits are standalone: `.venv/Scripts/python.exe <file>.py`.
- Corpus reads cost ~300 MB and are **barred from the Render worker**; they run
  on the operator's machine. `fit_nba_minutes.py` peaks ~850 MB, takes ~25 min,
  and needs no database connection (parquet only).
- **Do not pipe a long Python run through `tail`** — it buffers and you get
  nothing until the process exits. Use `-u` and redirect to a file.
- **At ~92% context, stop and hand off** by rewriting this file.
