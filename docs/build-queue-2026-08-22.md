# Build queue — sport expansions (2026-08-22)

One place tracking where every sport-expansion initiative actually stands, since they've been running in
parallel across the same day. Update this file's status column as things move, rather than letting status
live only in scattered doc prose.

| Sport | Gameplan doc | Status | Blocking on |
|---|---|---|---|
| Soccer (EPL + MLS) | `docs/soccer-gameplan-2026-08-22.md` §11.2 | **Building — approved 2026-08-22, in progress.** Real standings/game-line/live-state, real per-match history (Understat EPL, ASA MLS, both live-verified), real Player Detail windows/chart/gamelog, real recent-results scores all landed and committed this session. Remaining: team-level windows/distribution/statGroups (deferred — needs a new team-level candidate-construction pipeline, judged lower value than the fully-unbuilt sports below), Game Detail page (not yet built). | Nothing — in progress |
| CFB | `docs/multi-sport-expansion-audit-2026-08-22.md` §1 | **Approved 2026-08-22, not yet started.** Best-positioned of the four — real backend odds already in production, real ESPN infra reused, real historical archive (2002-2022) plus CollegeFootballData.com for current season. | Nothing — CFBD_API_KEY provided and verified live |
| NBA | `docs/multi-sport-expansion-audit-2026-08-22.md` §2 | **Approved 2026-08-22, not yet started.** Real, current, rich data confirmed (`sportsdataverse-data`: play-by-play, box scores, schedules, standings, rosters, season stats). Props-backend coverage confirmed via both providers' public docs. | One trivial single-call sport-key-string check at build time (Propline/ParlayAPI keys were at their live daily caps when checked) |
| NHL | `docs/multi-sport-expansion-audit-2026-08-22.md` §3 | **Approved 2026-08-22, not yet started.** Strongest of the four — NHL's own official API (`api-web.nhle.com`) confirmed live and rich, MLB-Stats-API-equivalent tier, no third party needed for core data. Props-backend confirmed same as NBA. | Same trivial sport-key check as NBA |
| Tennis | `docs/multi-sport-expansion-audit-2026-08-22.md` §4 | **Approved 2026-08-22, not yet started.** Schedule/rankings/some backend already exist. Live per-match history resolved via `stats.tennismylife.org`'s real, no-auth, live-updating API (found by reading its own network requests, same technique that found Understat's for soccer). | None |

## Not in this queue
- MLB, golf, NFL: already built, live, not part of this expansion effort.
- NWSL/USL: American Soccer Analysis (found during the soccer audit) covers these too, real bonus coverage,
  but out of scope unless you ask for them separately.

## How to use this file
When a sport moves from "audit complete" to "approved to build," update its Status cell here and say so —
this file is the one source of truth for "what's actually cleared to build right now," so a build session
doesn't have to reconstruct status from memory files or scattered doc headers.
