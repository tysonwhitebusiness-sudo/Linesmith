# Resume prompt — research pages thread (2026-09-14)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the research-pages thread in this repo. Read `CLAUDE.md` first, then
the files below **before doing anything**. Don't restate them back to me.

## Where the work is

1. **Card audit (A–D) and design audit (E, F, F2, G, G2): DONE.**
2. **Phase H: DONE as a draft.** `docs/audit-2026-09-13/research-pages-master-plan.md` is the one
   build order now. It merges:
   - the card audit and `build-plan.md` (now marked superseded; Appendix C maps every item);
   - the F verdicts and F-B1..F-B13 (Appendix A ledger);
   - the F2 visual and UX system;
   - the G2 mockups, including game states and the compare control;
   - `BUILDABILITY.md` (sources and tables per card).
   Phases R0–R11. §1 says how close the build gets to the mockups and where it differs.
   §3 records picks G1–G7 as built in G2.
3. **Waiting on operator approval of the master plan.** No code before approval. Once approved:
   - R1 (correctness on today's pages), R2 (shared data rules) and R3 (design system) can start in any order.
   - The CFB check (R1f 2b) is Saturday 2026-09-19.
   - The Python UTC fix (R1d) needs deploy approval.
4. **The spec is the G2 mockups:** `docs/design/phase-g2/` (`player.html`, `game.html`, `team.html`; `PLAN.md` explains rebuilding).
   - The datasets in `data/` are the reference fixtures every rebuild phase is checked against (plan Appendix B).
   - Rebuild with `node docs/design/phase-g2/build.mjs`.
   - Refresh data with the venv Python from the repo root: `tools/build_player_data.py`, `build_game_data.py`, `build_team_data.py`, `build_matchup_data.py`.

## Decisions already made — don't reopen

- Pages are in-depth research pages; odds are one section. **Keep the prop analysis block** near the top of the
  player page:
  - market tabs, line stepper with price, vs-opp/L5/L10/L15/Season chips, hit-rate tiles, bars vs line;
  - presentation fixes only.
- Every card is judged by "does this make sense for this sport / does this help". No earlier design is the standard.
- Real data only; show a status where data is missing. Don't fix only screenshots. Don't add design calls to the plan.
- Game page has three states: before start, live, final. Player and team pages have a compare control.
- Golf is held until a live tournament. NBA/NHL live waits for October. Scan and slate pages are out of scope
  (slate research views deferred).

## Standing constraints

- Postgres pooler caps at 15 connections. Check for running fits, harvester cycles and other sessions' jobs before DB work.
- Don't touch `docs/CURRENT.md` (another session's baton). This file is this thread's baton; rewrite it at every stop.
- Never `git add -A` or `git add docs/` (`docs/discord-community-prompt.md` is the operator's). Add explicit paths.
- Ask before deploying to Render. Don't push unless asked. At ~92% context, stop and hand off.
- Playwright MCP checks of the mockups: route `http://phase-g2.local/**` to the local files and run scripts from
  `.playwright-mcp/` (file access is limited to the repo and that folder).
