# Model-build backlog — deferred out of tonight's parallel build (2026-08-27)

Real, disclosed follow-on work split out of the X (matchup-favorability) prop-score signal
build so it doesn't get lost once the immediate NHL/NBA pass and the 5-hour historical
data pull both land. Nothing here is blocking — each item is genuinely separate scope,
not a step that got skipped by accident.

## 1. NFL matchup-favorability (X) signal

No reference implementation exists anywhere in this codebase — checked live, not assumed.
`lib/sports/cfb/teamDefenseAllowed.ts`'s own comment claiming "NFL's real
opponentDefenseAllowed/positionRank (nflverse team-week based)" was verified false on
inspection: what NFL actually has (`nflPlayerRankings.ts`) is a player's own offensive-
quality rank, a different concept, not an opponent-allowed metric.

Needs a real methodology decision before building: either (a) the same ESPN
boxscore-aggregation approach just proven for NBA/NHL (`predict/generic_matchup_defense.py`),
extended with NFL's own position-group bucketing, or (b) a new nflverse team-week CSV
integration in Python (`python-odds-service/` currently has zero nflverse plumbing —
confirmed via grep). (a) is lower-risk since it reuses an already-proven data path;
(b) may be more accurate for NFL specifically since nflverse is the sport's canonical
stats source in this codebase already (TS side). Decide, don't default silently, when
this is picked up.

## 2. CFB matchup-favorability (X) signal

Real TS reference implementation already exists (`lib/sports/cfb/teamDefenseAllowed.ts`,
uncommitted, proven via `loadCfbdTeamContext`'s existing live use elsewhere). Porting it
requires a brand-new CFBD API integration in Python — key management, rate limits, a new
`cfbd.py` fetcher — none of which exists in `python-odds-service/` today. Bigger scope
than NHL/NBA's port because the data source itself isn't wired into Python yet, not
because the aggregation logic is hard (it's the same shape as NBA/NHL's).

## 3. Soccer matchup-favorability (X) signal — EPL and MLS

EPL: real reference implementation exists (`buildUnderstatTeamDefenseIndex` in
`lib/sports/soccer/understat.ts`), but Understat has no equivalent Python plumbing yet —
needs a new scraper/fetcher ported, and Understat's own data path is scrape-based
(fragile, unlike NHL's/ESPN's official JSON APIs), so this needs its own reliability
check before being trusted the way NHL/NBA's is now.

MLS: no data source at all — Understat doesn't cover MLS. Real gap, not just an unported
one. Either accept "no X signal for MLS" permanently, or find/evaluate an alternate MLS
defensive-stats source before committing to build anything.

**Update 2026-08-27 (dimension configs build)**: confirmed CFB/Soccer's broken player-gamelog
endpoint also blocks live, current-season prop-score dimension configs today —
`predict/generic_dimension_configs.py` only covers NBA/NHL/NFL for exactly this reason (they can
use `generic_player_gamelog.fetch_player_gamelog` directly; CFB/Soccer can't).

**Correction**: this is NOT a separate fix from the historical pull — it's the same fix, already in
progress. The pull uses game-based (boxscore) ingestion specifically because it routes around this
exact broken endpoint (§2 of `docs/historical-player-gamelog-pull-2026-08-27.md`). Once the pull
lands real CFB/EPL/MLS rows in `player_game_history`, building these sports' DimensionConfig/X-signal
work becomes the same "swap to DB-read" step (`fetch_player_games_from_db`) as NBA/NHL/NFL — not a
separate investigation. What genuinely IS separate: the pull is a one-time backfill through today;
keeping `player_game_history` fresh with new games *after* the pull finishes needs an ongoing
boxscore-based refresh for these three sports specifically (NBA/NHL/NFL can fall back to the live
gamelog endpoint for ongoing freshness; CFB/EPL/MLS can't). Whatever production job eventually runs
this (see item 1's equivalent in the model-building status) needs a boxscore-refresh path for these
three sports, not the live-gamelog path the other three can use.

## 4. Finish the matchup-card feature (frontend)

`docs/matchup-card-rebuild-gameplan-2026-08-23.md` — built overnight 2026-08-23/24,
`tsc`/build clean at the time, but the NBA data pipeline was flagged unverified and
never got a live-login+ESPN check afterward (see `lib/sports/nba/boxscore.ts`'s own
"UNVERIFIED against a live response" header, now resolved live via curl during the X-signal
build tonight — the NBA ESPN boxscore/schedule endpoints are confirmed real and working).
The four `teamDefenseAllowed.ts`/`useTeamDefenseAllowed.ts` files (NBA/NHL/CFB +
the shared hook) are still uncommitted in git status. Before picking this back up:
confirm what's actually wired into the running app today vs. what's just sitting as
uncommitted groundwork, then close the loop — commit what's proven, fix or finish
what isn't, verify the matchup card renders real data in the browser for at least one
game per sport it claims to support.

---

Picked up in whatever order makes sense once the 5-hour historical pull and the
NHL/NBA X-signal wiring are both done and verified live.
