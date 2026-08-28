# Matchup card rebuild — overnight build report (2026-08-23 → 2026-08-24)

Built against the plan in `docs/matchup-card-rebuild-gameplan-2026-08-23.md`, with the three decisions you gave before bed: replace MLB/NFL's old cards outright, NBA/NHL in scope now, and a real animation library (Motion) approved.

**Verification ceiling tonight**: `tsc --noEmit` is clean across the whole project, and a full `npm run build` succeeds — every route compiles, including all 8 player-detail pages and the 3 new API routes. I could **not** get a live, logged-in, real-data browser render tonight: this sandbox's network blocks `site.api.espn.com` outright (confirmed via direct curl — a pre-existing constraint, not something I introduced), and the app's own auth gate returned 401s when I tried to load a player page without a real login session. So: the code compiles and builds correctly, but nobody has watched it render with real data yet. That's the first thing to do this morning — log in and open a CFB, NBA, and NHL player-detail page.

**Heads-up**: another Claude session (`line-buddy-c7`) was working in this same repo tonight on a different, overlapping feature (a live game-detail matchup card + player-detail line tracker — see `docs/live-matchup-and-line-tracker-gameplan-2026-08-23.md`). We coordinated directly: it confirmed it wouldn't touch `PlayerDetail.tsx`/`playerDetailAdapter.ts` until later, and I'll ping it once you've reviewed this so it can pull my changes before it adds its own new `PlayerDetailData` field. If you see unfamiliar files under `components/LiveDetailPrimitives.tsx`, `lib/sports/nhl/liveGame.ts`, etc. — that's that other session's work, not mine, and not yet merged with anything here.

## What's actually done

**One universal matchup card, all 8 sports, replacing the old ones outright.** `matchups`/`mlbContextMatchup`/`nflMatchup` are gone from `PlayerDetailData`; every sport now populates (or nulls) one `matchupExplorer: MatchupExplorerData` field (declared in `lib/sports/mlb/adapters/playerDetailAdapter.ts`). One render call site in `PlayerDetail.tsx` (`components/MatchupExplorerCard.tsx`), replacing the three old ones.

**View modes**: Overview (auto-computed "biggest edge" callout), Stat grid (two-sided bars where subject/opponent share a stat key, solo rows otherwise), Profile (a hand-rolled SVG radar chart, subject vs. opponent, plotted across every ranked stat in the current group). Tab switching uses the existing `SegmentedToggle` glider pattern.

**Motion (the `motion` npm package) is installed and wired in** — `npm install motion` succeeded, no new vulnerabilities (checked against the pre-existing baseline; the 4 high-severity ones flagged by `npm audit` are `xlsx`, unrelated and pre-existing). Bar widths, the opponent-swap header, and the view/group crossfades all animate via `motion.div`/`AnimatePresence` rather than hand-rolled CSS.

**Custom opponent picker — live for CFB, NBA, and NHL** (the three sports that now have a full league-wide leaderboard). Not yet wired for MLB/NFL/soccer/tennis — see "Deferred" below for why.

**Position-group tabs — real data, all newly built tonight**:
- **CFB**: Passing/Rushing/Receiving yards allowed, every FBS team, from CFBD's own per-game box scores (`lib/sports/cfb/teamDefenseAllowed.ts`) — the opponent's stat line in a game CFBD already returns for both teams, summed across each team's real games. Needs a real `CFBD_API_KEY` in the deployed environment (already a requirement for existing CFB features — nothing new there) to actually populate; this sandbox has none, so I could only confirm the code path degrades gracefully to "no card" rather than crashing.
- **NHL**: Forwards/Defense points allowed, last 15 real games per team, built entirely from `nhle.ts`'s already-proven-live `fetchBoxscore` + schedule fetchers (`lib/sports/nhl/teamDefenseAllowed.ts`). This is the one new pipeline that reuses only already-verified data access — the safest of the three.
- **NBA**: Guards/Forwards/Centers points allowed, last 15 games, via a **brand-new** ESPN box-score fetcher (`lib/sports/nba/boxscore.ts`) and team-schedule fetcher (`lib/sports/nba/teamDefenseAllowed.ts`). **Unverified against a live response** — ESPN is blocked from this sandbox, so I wrote it against ESPN's well-established public site-API schema and made every parse step degrade to empty/null on a shape mismatch (same defensive convention every other fetcher here already follows), but nobody has confirmed the real field names match yet. If NBA's matchup card comes up empty once deployed, this is the first place to check — probably a field-name mismatch in `boxscore.ts`, fixable by inspecting one real `/summary?event=` response.

Each of the three gets its own cached API route (`/api/{cfb,nba,nhl}/team-defense-allowed`, via `cachedRoute()`, 6h TTL, wrapping each pipeline's own internal 24h cache — so the first-ever cold rebuild never blocks a real page load) and a shared client hook (`components/useTeamDefenseAllowed.ts`) that `PlayerDetail.tsx` calls once per sport, gated by `active.sport`.

## Deferred / explicitly not done (honest gaps, not oversights)

- **Trend view** (per-game sparkline of an opponent's allowed-rate over time) — not built. Every sport above only has a season/rolling-window aggregate, not a genuinely browsable per-game series wired into the card yet. Noted in the gameplan as an additive follow-on, not required for the shell.
- **Soccer position-group split** (forwards/midfielders/defenders) — still team-wide only, same as before, just re-skinned in the new shell. Understat's team-aggregate endpoints don't carry the shot-level, position-tagged data a real split needs; building that is real new data-engineering, not a quick add, and I didn't want to fabricate a plausible-looking number under real deadline pressure. Flagged in the gameplan as the honest scope call.
- **MLB/NFL/soccer/tennis custom-opponent picker** — still locked to "next real scheduled game," same as before. A full leaderboard for these would need either reverse-engineering MLB's/NFL's existing snapshot-build-time pipelines (risk I didn't want to take blind, overnight, unsupervised) or new ingestion (soccer/tennis). Only CFB/NBA/NHL got the picker because their leaderboards were built fresh tonight specifically to support it.
- **Tennis matchup card** — still `null`. No ranked-player list exists anywhere in this codebase yet for a "pick any opponent" head-to-head picker; building that data source wasn't in tonight's scope (see gameplan §9 phase 5 — always intended as a separate, later pass).
- **Radar polygon morph animation** — the Profile view's radar crossfades on opponent/group change rather than smoothly reshaping point-by-point; a true shape morph needs custom SVG-path interpolation Motion doesn't do out of the box, and wasn't worth the risk to hand-roll tonight.

## What to check this morning

1. Log in, open a CFB player page with `CFBD_API_KEY` set — confirm the matchup card renders with real Passing/Rushing/Receiving tabs and the team picker works.
2. Open an NHL player page — same check; this is the pipeline most likely to already work correctly first try.
3. Open an NBA player page — **this is the one that might come back empty or wrong**. If so, check `lib/sports/nba/boxscore.ts`'s parsing against one real ESPN `summary?event=` response.
4. Open an MLB and NFL player page — confirm the migrated (not new) matchup card still looks and behaves the same as before, just in the new shell with the new view tabs and animations.
5. Ping `line-buddy-c7` (or just tell me to) once you're satisfied, so it can pull these changes before starting its own `PlayerDetailData` addition.

## Files touched

New: `lib/sports/{cfb,nba,nhl}/teamDefenseAllowed.ts`, `lib/sports/nba/boxscore.ts`, `app/api/{cfb,nba,nhl}/team-defense-allowed/route.ts`, `components/MatchupExplorerCard.tsx`, `components/useTeamDefenseAllowed.ts`.
Changed: `lib/sports/mlb/adapters/playerDetailAdapter.ts` (canonical type + MLB migration), `lib/sports/{golf,nfl,cfb,nba,nhl,soccer,tennis}/adapters/playerDetailAdapter.ts` (migrated or wired), `components/PlayerDetail.tsx` (render site + 3 new hooks), `package.json`/`package-lock.json` (added `motion`).
Also fixed in passing: a pre-existing `kpiScope` type gap on 5 of 7 sports' `PlayerDetailScope` interfaces (unrelated to this feature, but it was failing `tsc --noEmit` and was a one-line fix per file).
