# Resume prompt — research pages build (2026-09-14)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages build in this repo. Read these first, **before doing anything**:
1. `CLAUDE.md`
2. `docs/CURRENT.md` (the project baton; the research pages track is in "START HERE")
3. `docs/audit-2026-09-13/research-pages-master-plan.md` (**approved as written 2026-09-14**, the build order)

## First reply: show me you understand the goal. Don't start building.

**Don't start R1 or any other phase, and don't edit code, until I say go.** After reading, reply in plain
language with:

1. **The goal:** what these pages become and why, the rules that shape them, and what "done" looks like
   against the G2 mockups.
2. **How close the build will be to the mockups,** and where it will differ.
3. **The phase order (R1–R11)** and why that order holds.
4. **Exactly what you'd do first in R1:** which items, in which files, and how you'd verify each one.
5. **Everything you'd need from me:** approvals, dates, and open questions (if any).

Keep it short enough to read in a couple of minutes. Then wait for my go-ahead.

## Where the work is

- **Done:**
  - Card audit (A–D).
  - Design audit (E, F, F2, G, G2), including game states and the compare control.
  - Phase H, which produced the master plan. `build-plan.md` is superseded; the plan's Appendix C maps every item.
- **Approved and not started:** phases R0–R11.
  - R0 is done.
  - **Next: R1** (correctness on today's pages). R2 (shared data rules) and R3 (design system) don't depend on it and can go in any order.
  - Start R1 by re-checking each item's cited file and line. The plan was written from audit notes, and line numbers drift.
- **Spec:** the G2 mockups in `docs/design/phase-g2/`:
  - pages: `player.html`, `game.html`, `team.html`;
  - how to rebuild them: `PLAN.md`;
  - per-card sources and tables: `BUILDABILITY.md`;
  - reference fixtures: the datasets in `data/` (plan Appendix B).
  - Rebuild with `node docs/design/phase-g2/build.mjs`.
  - Refresh data with the venv Python from the repo root: `tools/build_player_data.py`, `build_game_data.py`, `build_team_data.py`, `build_matchup_data.py`.
- **Approvals and dates inside R1:**
  - the Python UTC fix (R1d) needs a Render deploy, so ask first;
  - the CFB odds-job check (R1f 2b) is **Saturday 2026-09-19** during the live window;
  - the MLB live game state (R8) must be verified before the regular season ends in late September, or on postseason games.

## How every phase runs (plan §2)

1. Build.
2. `tsc --noEmit`.
3. Render each affected sport at 1440px and 400px.
4. Put each page beside its G2 mockup and check the numbers match the dataset.
5. Delete what the phase replaces, in the same phase.
6. Commit by explicit path.
7. Update the plan's status line and rewrite this file.
8. **Stop for my sign-off.**

## Decisions already made — don't reopen

- **Pages are research pages.** Odds are one section, **except the prop analysis block**, which stays near the top of the player page:
  - market tabs, line stepper with price, vs-opp/L5/L10/L15/Season chips, hit-rate tiles, bars vs line;
  - presentation fixes only.
- **How cards are judged:** "does this make sense for this sport / does this help". No earlier design is the standard. Don't fix only screenshots. Don't add design calls to the plan.
- **Data:** real data only; show a status where data is missing.
- **Picks as built in G2:**
  - system sans (drop Plex Mono);
  - raised cards;
  - sectioned layouts with a sticky section nav;
  - slate research views deferred;
  - everything the mockups show goes into the build.
- **Deferred:** golf is held until a live tournament; NBA/NHL live waits for October; Scan and slate pages are out of scope.

## Standing constraints

- Postgres pooler caps at 15 connections. Check for running fits, harvester cycles and other sessions' jobs before DB work.
- **Git:**
  - never `git add -A` or `git add docs/` (`docs/discord-community-prompt.md` is mine); add explicit paths;
  - don't push unless I ask.
- Ask before deploying to Render.
- At ~92% context, stop and hand off: rewrite this file, and update the research pages track in `docs/CURRENT.md` without disturbing the model track's sections.
- **Playwright MCP checks of the mockups:** route `http://phase-g2.local/**` to the local files and run scripts from `.playwright-mcp/` (file access is limited to the repo and that folder).
