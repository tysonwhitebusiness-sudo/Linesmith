# CURRENT — pick up here

**Rewritten 2026-09-21, before the unattended run. Track C (card redesign)
and the sport-specific Spotlights are approved, audited, and every question
is answered. Start at phase 1 (C7) of the run order and don't stop to ask.**

> **VS Code session?** Read `docs/VSCODE-HANDOFF.md` first — it is the
> running record of the VS Code (Copilot) session's changes and current
> state, and it points back here for the full plan.

---

## Read, in this order

1. **`docs/design/unattended-run-2026-09-21.md`**: the run order (§2), the
   operator's standing answers (§1, including **Render deploys authorised**
   for this run), the six corrections to the plans (§3), and what to do when
   blocked (§4).
2. `docs/design/card-redesign-gameplan-2026-09-21.md`: WHAT each Track C
   phase builds. The visual target is
   `docs/design/card-redesign-2026-09-21.html`; serve it with the
   `design-mockups` preview on :8125. The mockup wins on looks; the plan wins
   on where the data comes from.
3. `docs/design/movers-and-spotlights-gameplan.md`: WHAT the Spotlight phases
   build (the eight new ideas N1–N8, where each one renders, sources per
   sport). Movers MV0–MV4 is done (`1bad903`).

## Where the work is

| # | phase | status |
|---|---|---|
| 1 | C7 delete the live line tracker (the role keys stay six: the tracker was never one) | **done** |
| 2 | C0 Electric Turf + `-ink` tokens, ESPN team colours, kit pieces | **done** |
| 3 | C1 charcoal section bands (Movers included) — revised by C1b | **done** |
| 3b | C1b transparent section headers, charcoal side line (replaces the charcoal band) | **done** |
| 4 | PY-A shared Python: C5 grading + 3 new Specials + park table + spotlight `kind` (**deploy**) | **done** |
| 5 | C2 player hero | **done** |
| 5b | C2b team hero, same rework as the player hero | **done** |
| 6 | PY-B spotlight rankings: NFL, CFB, NHL, soccer, MLB (**deploy**) — NBA deferred (no Python games loader) | **done** |
| 7 | C3 player search rail | — |
| 8 | C4 Slate imagery (Movers included) | — |
| 9 | C6 props controls (tabs → filters, Home Runs deleted) | — |
| 10 | F0-UI research-page flags + Slate spotlight cards | — |
| 11 | C5-UI receipts table + new Specials (needs a real graded slate) | — |
| 12 | DJ-GOLF tournament → course backfill (**deploy**) | — |
| 13 | DJ-TEN TML-Database ingest, licence check first (**deploy**) | — |
| 14 | SP-GOLF, SP-TEN | — |
| 15 | C8 close Track C | — |
| 16 | SPC close Spotlights | — |

Update this table and the run doc's §2 after every phase commit, then push.

## Deploys

| when | commit | service | what it enables |
|---|---|---|---|
| 2026-09-21 21:31 UTC | `5e6568d` (PY-A) | line-buddy-odds-worker (`dep-daoq3i6k1f9s738ael6g`, live) | hit rules + leader rows + stat lines + `_read`; longest HR, longest reception, NHL two goals; wind out + temperature from the park table; `kind` and team ids on every row. Was on `c5baee4`. |
| 2026-09-22 02:26 UTC | `5f9a7df` (PY-B) | line-buddy-odds-worker (`dep-daoudr5g1s2s738njlcg`, live) | 32 spotlight rankings (`kind='spotlight'`, never graded) across NFL/CFB/NHL/soccer/MLB: the sport-specific cards and the eight N ideas (N1/N2/N3/N6/N7/N8, N4 MLB). Was on `5e6568d`. |

## Decisions that bind this run

- **Electric Turf**: good `#00d26a` / bad `#ff4d4f` / warn `#ffb020`. Text
  always uses the `-ink` shade. It recolours the frozen Scan table
  (approved); Scan's layout and the length pins stay.
- **Green never marks structure.** Headers are transparent with a 3px
  charcoal (`#1d1f23`) line on the left and a hairline divider beneath —
  C1b (2026-09-21) replaces C1's charcoal band with its 2px `#6e727a` top line.
- **Stats never render as chips or buttons**: a labelled value + percentile.
- **Specials are forecasts** graded next morning, never leaderboards.
- **Weather** only from `python-odds-service/src/predict/weather.py`
  (Open-Meteo). **Park orientation ships on cited sources with wind
  direction on**, plus a queue row listing five parks for the operator to
  check after the fact.
- **Tennis** data from TML-Database, after a licence check.
- **Blocked? Skip ahead, come back** (run doc §4).

## Still open from before

- `docs/design/SIGNOFF-QUEUE.md` Q0–Q20: operator sign-off. Q15 and
  `/diagnostics` need a signed-in session.
- M4 (promotion tests) and M5 (prop baselines, needs approval).
- **PY-B deferrals (A6):** NBA's spotlights (pace-up, usage bumps, shot-zone
  matchups + its N1/N2/N6/N7/N8) wait on a Python `'nba'` games loader —
  `load_sport_games` has no NBA entry and the season has no games yet. N5
  (weather) is render-time forecast data, not a table, so it ships with F0-UI.

## Findings worth knowing

- **C0: `@utility text-good` does NOT override Tailwind's theme-generated
  `.text-good`**; Tailwind kept its own rule. The frozen Scan files get the
  ink shade from a plain UNLAYERED `.text-good{}` rule in `globals.css`
  (unlayered beats `@layer utilities`). Verified in the browser:
  Scan's `text-warn` went `rgb(183,121,31)` → `rgb(154,98,0)`.
- **C0: team colours.** `bandColors()` falls back to charcoal only for true
  blacks and too-light golds (LV, NO, PIT, Pirates, White Sox). A relative
  saturation test keeps dark hues (GB green, SD brown). The oklch
  `gradientCardStyle` ramp in `heat.ts` already sits on Electric Turf's three
  hues and was left alone.

- **`DataTable.tone` is a RESULT chip ("W 6–3"), not a colour.** Use `ink`
  for good/bad-by-definition values, and `heat` for a rank.
- **Scan's cell components stay frozen** (`StatCells`, `OddsChip`). C6
  unfreezes only the filter-bar files.
- **C2: hero tile ranks come from `player_season_production`**, the
  position-grouped rollup the peer picker reads (`/api/player-pool`), NOT
  the plan's "34th of 142 RB" (`subject.rankDetail`), which is an NFL-only
  composite that exists only when a market does. `playerPool.ts` ranks each
  tile with its OWN `of()` on the pool's season totals and refuses a rank
  (no rank, no bar) when the tile reads a key the rollup lacks (MLB RBI, HBP,
  innings; NBA minutes), is not a sum (counts, maxima), reads no stat
  (games), or is a lower-is-better TOTAL (fewest walks = pitched least). The
  floor is 30% of the pool's 95th-percentile games: MLB's pitcher pool holds
  position players who pitched once with 142 games each. C2b's team tiles
  should rank against the team pool `teamResearchSpec` already uses.
- **C2: `DisclosureBar` is a kit piece** (the hero's summary bar), because U7
  closed the raw-`<button>` list. C2b reuses it.
- **PY-A: per-HR distance was already stored.** `mlb_statcast_player_season`
  payload `hrList[]` carries `distance` (5,019 of 5,027 in 2026), so the
  planned `hit_distance_sc` column and backfill were skipped. The rollup
  rebuilds daily; longest-HR grading waits until it has run past noon UTC the
  day after the slate.
- **PY-A: the ESPN->GSIS map is not in `athlete_crosswalk`** (zero NFL rows
  bridge to nflverse). `nfl_pbp.espn_to_gsis` reads nflverse `players.csv`,
  the same file TypeScript's `getEspnToGsisMap` does, cached 24h.
- **PY-A: migration `20260921120000` was applied by hand before the deploy.**
  It is additive (defaulted `kind`, nullable ids), so the old worker kept
  writing through it.
- **C1: a HIDDEN Browser pane never fires `requestAnimationFrame`**, and
  React 19's streaming reveal (`$RC` -> `$RB` -> rAF -> `$RV`) waits on it, so
  every Suspense page (player, team) sits in `<div hidden id="S:0">` with
  zero-width bands. It is not a page bug. Verify in the Playwright browser, or
  call `$RV($RB)` from the console to inspect.
- **C1: band bleed is per column.** Each `<main>` declares `--lb-gutter`; a
  two-column layout (team list + detail) resets it to 0 on the detail column
  at `lg`, so the band stays inside its column instead of touching the list.
- **A worn browser tab stalls effects** and React Aria's exit animations.
  Render in a fresh tab.
- **The Playwright browser can be locked by another session.** Fall back to
  the built-in browser pane with `tabs_create` for a fresh tab.
- **The mockup's stat lines are illustrative.** Don't sign off C5 on
  placeholder data.
- **Bash heredocs eat backslashes, quotes and `\n`** in this environment.
  Write scripts and regex-bearing tests with the Write/Edit tools.
- The browser can't load `file://`. Use the `design-mockups` preview.

## Standing constraints

- Render deploys: **authorised for this run's Python phases** (run doc §1
  A1). Record each one above. `git push` itself does not deploy.
- Never `git add -A` or `git add docs/`: `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- Prod on :3000 serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`. `/kit` is dev-only: `linesmith-dev-verify` on :3001.
- The Postgres pooler caps at 15 connections. Check for long-running
  fits/scripts first.
- At ~92% context, stop and hand off by rewriting this file.
