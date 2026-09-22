# Unattended run — Track C + Spotlights (from 2026-09-21)

**The run order and the operator's standing answers for building Track C and
the sport-specific Spotlights without the operator present.** Every
session, including the rotating accounts after a usage limit, reads this
first (after `docs/CURRENT.md`) and continues from the first phase in §2 whose
status isn't `done`.

The two build plans stay the source of truth for WHAT each phase builds:
- `docs/design/card-redesign-gameplan-2026-09-21.md` (Track C, C0–C8; the
  visual target is `docs/design/card-redesign-2026-09-21.html`, served with the
  `design-mockups` preview on :8125);
- `docs/design/movers-and-spotlights-gameplan.md` (F0, SP-*, DJ-*, SPC; Movers
  MV0–MV4 is done, `1bad903`).

This file decides the ORDER, what to do when blocked, and what's already
authorised.

---

## 1. Standing answers (operator, 2026-09-21) — don't ask again

| # | Question | Answer |
|---|---|---|
| A1 | Render deploys of the Python worker | **Authorised for this run.** Deploy a Python phase once its tests pass AND a local run against the database succeeds. Record every deploy (commit, time, what it enables) in `docs/CURRENT.md`. Web-app deploys: none exist (no hosted web app). **How:** `POST https://api.render.com/v1/services/{id}/deploys` with `RENDER_API_KEY` from `.env.local` (pattern and service id in `scripts/render_sync_provider_keys.mjs:117`). The first deploying phase adds a small `scripts/render_deploy.mjs` that triggers a deploy, polls it to `live` and prints the result. `render.yaml` has two services (`line-buddy-odds-worker` and its health-check cron). |
| A2 | NBA/NHL spotlights vs the NBA 10-03 / NHL ~10-07 openers | **Python now, UI after F0.** Their rankings are built in Python alongside C2 and render once F0-UI lands. |
| A3 | Other sessions | **This run does everything**, sequentially. No parallel sessions on this repo. |
| A4 | Tennis data source | **TML-Database** (TennisMyLife, GitHub). Check its licence first. If it doesn't permit this use, stop that phase, write it into the queue, and ship tennis Form only. |
| A5 | 30-park orientation table | **Ship on cited sources.** One source per row, wind direction ON immediately. Still write a queue row listing five parks for the operator to spot-check after the fact. |
| A6 | When blocked (a graded slate, a signed-in check, a data licence) | **Skip ahead, come back.** Finish everything that doesn't depend on it, write the blocker into `docs/CURRENT.md` and `docs/design/SIGNOFF-QUEUE.md`, move to the next phase, and return once it clears. |
| A7 | Deletions: the Props "Home Runs" board, the live line tracker; the Electric Turf recolour of the frozen Scan table | **Approved as planned.** Delete outright (no dormant fallback). Scan's layout stays frozen; the length pins stay. |
| A9 | Team hero | **Gets the same rework as the player hero** (phase 5b, C2b). |
| A8 | Earlier defaults (Movers D-M2/D-M3, spotlights D-S2 freeze-at-first-game, D-F1 chips only for today's slate) | Stand. |

**Rules that don't change** (`CLAUDE.md`):
- Python writes, TypeScript renders.
- No `sport ===` branches in shared components.
- A page never styles a primitive.
- No edge on the Slate.
- Add named files only (never `git add -A` or `git add docs/`).
- Check the pooler (15 connections) before any DB-touching Python.
- Render every phase in a **fresh tab** at 1440 and 400 before committing.
- At ~92% context, stop and rewrite `docs/CURRENT.md`.

---

## 2. Run order

| # | Phase | Track | Needs | Deploy | Status |
|---|---|---|---|---|---|
| 1 | **C7** Delete the live line tracker. The plan said six role keys → five; measured, `liveLineTracker` was never a role key, so the keys stay six | C | — | no | **done** |
| 2 | **C0** Electric Turf + `-ink` tokens, one ESPN team-colour source, kit pieces | C | 1 | no | **done** |
| 3 | **C1** Charcoal section bands: research pages and EVERY Slate section, **Movers included** | C | 2 | no | **done** |
| 3b | **C1b** Transparent section headers with a 3px charcoal line on the left (operator, 2026-09-21): `SectionBand` drops the charcoal fill for a transparent bar + `bg-char` side line + hairline divider; collapse button `onDark` → `tertiary`. Replaces C1's band. | C | 3 | no | **done** |
| 4 | **PY-A** Shared Python phase: C5's grading (`hit_rule`, `__leader__` rows, `outcome.detail`, `_read`), the three new Specials (MLB longest HR, NFL longest reception, NHL 2+ goals), the park-orientation table, and F0's Python half (`kind` = special/spotlight; every row carries player/team/game ids) | C+S | — | **yes** | **done** |
| 5 | **C2** Player hero | C | 3 | no | **done** |
| 5b | **C2b** Team hero: the **same rework as the player hero** (operator, 2026-09-21). `TeamHero` in `components/TeamResearchPage.tsx:171`: team-colour band from `bandColors()`, logo (no headshot) with the same ring and overhang, logo watermark, chip row (conference/division, standing), NEXT game on the right with the opponent logo, ranked tiles with percentile bars (from the team pool `teamResearchSpec` already ranks against), opponent-logo form rows (the existing `hero.lastTen`), and the same collapsible body with the one-time peek (its own `lb.teamHeroPeekSeen` key). One data change: add `rank` to the team hero's tiles, the same shape as C2.1. No `sport ===`. | C | 5 | no | **done** |
| 6 | **PY-B** Spotlight rankings in Python: NFL, CFB, NHL, soccer, MLB — 32 spotlights incl. the eight N ideas (N1/N2/N3/N6/N7/N8; N4 MLB). NBA deferred: `load_sport_games` has no 'nba' loader and no current games (A6). N5 weather ships with F0-UI. | S | 4 | **yes** | **done** |
| 7 | **C3** Player search rail | C | 5 | no | **done** |
| 8 | **C4** Slate imagery: Games, Books, **Movers**, Spotlights, Model | C | 2 | no | **done** |
| 9 | **C6** Props controls (tabs → filters, Home Runs deleted) | C | 8 | no | **done** |
| 10 | **F0-UI** `/api/slate/flags`, the shared `ResearchFlags` card and chips on player/team/game pages; the Slate renders the Python spotlights beside the two TS ones. N5 weather ships here. | S | 6, 8 | no | **done** |
| 11 | **C5-UI** Receipts table + the new Specials cards | C | 4 **and a real graded slate** (A6) | no | **built, awaiting graded slate** |
| 12 | **DJ-GOLF** Tournament → course backfill | S | — | **yes** | — |
| 13 | **DJ-TEN** TML-Database ingest (licence check first, A4) | S | — | **yes** | — |
| 14 | **SP-GOLF**, **SP-TEN** (rankings + render) | S | 10, 12, 13 | **yes** | — |
| 15 | **C8** Close Track C: guards, `/kit`, sweep, `CLAUDE.md`, mockup marked historical | C | 9, 11 | no | — |
| 16 | **SPC** Close Spotlights: receipts for frozen spotlights, guards, docs | S | 14 | no | — |

**Commits:** one per phase, named `C{n}: …`, `PY-A: …`, `PY-B: …`,
`F0: …`, `DJ-GOLF: …`, `SP-TEN: …` and so on. After each one, update the
Status column here AND the phase table in `docs/CURRENT.md`, then push.

---

## 3. Corrections the plans need (found in the 2026-09-21 audit)

Apply these while building. Don't follow the stale text.

1. **C4:** `MoverRow` no longer exists. Movers rows are `ConsensusMover` in
   `lib/slate/marketMoves.ts`, rendered by `components/slate/SlateMovers.tsx`.
   C4's imagery covers that card too: headshots, team logos, book marks on
   the "books moved" cell.
2. **C1:** the Slate sections moving onto the band include
   `SlateMovers` (`id="slate-movers"`).
3. **C6:** `AppShell.tsx` line numbers have moved (S5 and MV3 both edited it).
   `SCAN_VIEWS` is now at line ~101 and the Home Runs branch at ~972. Re-grep
   before editing.
4. **C5 / PY-A:** `statcast_rollups.py` already parses `hit_distance_sc` from
   Savant's home-run CSV (`home_run_distance_rows`, line ~110). **Measure
   what's stored before adding a column.** If per-HR distance already lands
   somewhere queryable, reuse it and skip the migration.
5. **PY-A before PY-B, one at a time:** both rewrite
   `python-odds-service/src/slate_rankings.py`, `lib/slate/specials.ts` and
   `tests/slate-specials.test.ts`. Never edit them in two phases at once.
6. **Tennis:** nothing held today carries surface or serve stats
   (`player_game_history` tennis has only sets/games).
   `predict/tennis_serving.py` means *serving predictions*, not serve
   statistics. DJ-TEN is the only way to get them.

---

## 4. Blockers expected, and what to do

| Blocker | Phase | What the run does |
|---|---|---|
| Real graded slates for the new Specials | C5-UI | PY-A deploys first, so the worker freezes and grades daily. Build C5-UI against the rows that exist; sign it off only once one NFL Sunday (next: **2026-09-27**) and one MLB day have been graded by the new code. Until then its status is `built, awaiting graded slate`. |
| Signed-in checks (Your lines Q15, `/diagnostics`) | — | Unchanged: covered by tests, and the render is owed to the operator. |
| TML licence doesn't permit use | DJ-TEN | Stop DJ-TEN, write a queue row, ship SP-TEN with Form only. |
| NBA/NHL have no current-season games | PY-B, F0 | Build and test on 2025-26 data. The rankings go live on the first real slate. |
| A Render deploy fails | any PY | Don't retry blindly. Read the deploy log, fix it, and record it. If it can't be fixed, revert that phase's commit on the worker branch and move on (A6). |
