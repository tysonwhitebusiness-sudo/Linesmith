# Build queue — sport expansions (2026-08-22)

One place tracking where every sport-expansion initiative actually stands, since they've been running in
parallel across the same day. Update this file's status column as things move, rather than letting status
live only in scattered doc prose.

| Sport | Gameplan doc | Status | Blocking on |
|---|---|---|---|
| Soccer (EPL + MLS) | `docs/soccer-gameplan-2026-08-22.md` §11.2 | **Done, all four pages built.** Real standings/game-line/live-state, real per-match history (Understat EPL, ASA MLS), real Player/Team/Game Detail windows/chart/gamelog/records, all live-verified. Remaining gap: team-level windows/distribution/statGroups (deferred — needs a new team-level candidate-construction pipeline, judged lower value than covering the fully-unbuilt sports below). | Nothing — done |
| CFB | `docs/multi-sport-expansion-audit-2026-08-22.md` §1 | **Done, all four pages built.** Real Scan (prop_odds-driven, real market keys), real per-game history via CollegeFootballData.com (7 of 8 markets), real Teams/Player/Game Detail, all live-verified. Same team-level-windows gap as soccer, deferred for the same reason. | Nothing — done |
| NBA | `docs/multi-sport-expansion-audit-2026-08-22.md` §2 | **Done, all four pages built.** Python backend wired (job_nba, SportsGameOdds only — ParlayAPI NBA needs a new key, declared-but-disabled). Real Teams/ESPN infra + real sportsdataverse-data per-game history both live-verified. Real market-key strings are a reasoned guess pending the backend's first deploy/run — /api/nba correctly shows empty candidates until then (real: no backend data yet). Real, current, rich data confirmed (`sportsdataverse-data`: play-by-play, box scores, schedules, standings, rosters, season stats). Props-backend coverage confirmed via both providers' public docs. | One trivial single-call sport-key-string check at build time (Propline/ParlayAPI keys were at their live daily caps when checked) |
| NHL | `docs/multi-sport-expansion-audit-2026-08-22.md` §3 | **Done, all four pages built.** Fully on NHL's own official api-web.nhle.com API, no ESPN at all — real team/roster/schedule/boxscore, real per-game history via direct player-id lookup (no fuzzy name matching needed, unlike every other sport this session). No real pregame-line source (NHL's API carries no odds) and no Python backend job yet (would need its own NHL-specific game-context loader in Python, scoped out this session). Real market keys are a reasoned guess pending that backend. Strongest of the four — NHL's own official API (`api-web.nhle.com`) confirmed live and rich, MLB-Stats-API-equivalent tier, no third party needed for core data. Props-backend confirmed same as NBA. | Same trivial sport-key check as NBA |
| Tennis | `docs/multi-sport-expansion-audit-2026-08-22.md` §4 | **Building next — approved 2026-08-22. Last sport in the queue.** Schedule/rankings/some backend already exist. Live per-match history resolved via `stats.tennismylife.org`'s real, no-auth, live-updating API (found by reading its own network requests, same technique that found Understat's for soccer). | None |

## Not in this queue
- MLB, golf, NFL: already built, live, not part of this expansion effort.
- NWSL/USL: American Soccer Analysis (found during the soccer audit) covers these too, real bonus coverage,
  but out of scope unless you ask for them separately.

## How to use this file
When a sport moves from "audit complete" to "approved to build," update its Status cell here and say so —
this file is the one source of truth for "what's actually cleared to build right now," so a build session
doesn't have to reconstruct status from memory files or scattered doc headers.
