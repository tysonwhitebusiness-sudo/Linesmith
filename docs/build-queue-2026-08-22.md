# Build queue — sport expansions (2026-08-22)

One place tracking where every sport-expansion initiative actually stands, since they've been running in
parallel across the same day. Update this file's status column as things move, rather than letting status
live only in scattered doc prose.

| Sport | Gameplan doc | Status | Blocking on |
|---|---|---|---|
| Soccer (EPL + MLS) | `docs/soccer-gameplan-2026-08-22.md` | **Approved, paused.** Scan/Teams/Players partially built and verified this session (see the doc's §10/§11 for exact state) — real bugs found and fixed live, real remaining gaps (standings, game-line, live-state, per-match history) researched and confirmed solvable (§11). **Not resuming until explicitly told to.** | Your go-ahead to resume |
| CFB | `docs/multi-sport-expansion-audit-2026-08-22.md` §1 | Audit complete. Best-positioned of the four new sports — real backend odds already in production, real ESPN infra reused, real historical archive (2002-2022). | A free CollegeFootballData.com API key from you (for current-season per-match history) |
| NBA | `docs/multi-sport-expansion-audit-2026-08-22.md` §2 | Audit complete. Real, current, rich data confirmed (`sportsdataverse-data`: play-by-play, box scores, schedules, standings, rosters, season stats). | Player-props backend coverage not yet checked (needs a careful, budget-aware provider-catalog check, not done this session — see §5) |
| NHL | `docs/multi-sport-expansion-audit-2026-08-22.md` §3 | Audit complete. Strongest of the four — NHL's own official API (`api-web.nhle.com`) confirmed live and rich, MLB-Stats-API-equivalent tier, no third party needed for core data. | Same props-backend check as NBA |
| Tennis | `docs/multi-sport-expansion-audit-2026-08-22.md` §4 | Audit complete, one real open question. Schedule/rankings/some backend already exist. Live per-match history is a genuine unresolved gap (ESPN's summary endpoint confirmed NOT to provide it, unlike every other sport). | Your decision: investigate further, find a live alternative, or ship with historical-backfill-only tennis history |

## Not in this queue
- MLB, golf, NFL: already built, live, not part of this expansion effort.
- NWSL/USL: American Soccer Analysis (found during the soccer audit) covers these too, real bonus coverage,
  but out of scope unless you ask for them separately.

## How to use this file
When a sport moves from "audit complete" to "approved to build," update its Status cell here and say so —
this file is the one source of truth for "what's actually cleared to build right now," so a build session
doesn't have to reconstruct status from memory files or scattered doc headers.
