# Phase B — Read-path trace

**Status: COMPLETE 2026-09-13.** Log-only; nothing was changed.

## Read this first: the calendar decides what an empty card means

Audited on **2026-09-13**, which is a season boundary for most of the app. An
empty card is only a defect if the sport is actually playing. Established
before anything was judged:

| sport | playing today? | candidates | games on slate | verdict |
|---|---|---|---|---|
| mlb | **live** | 2,741 | 15 | fully renderable |
| nfl | in season (wk 2) | 1,958 | 32 | fully renderable |
| soccer_mls | in season | 1,679 | 18 | fully renderable |
| soccer_epl | in season | 373 | 10 | fully renderable |
| tennis_wta | in season | 36 | 57 | renderable, **contaminated — B2** |
| tennis_atp | in season | 6 | 1 | very thin |
| **cfb** | **in season** | **0** | **176** | **DEFECT — B1** |
| golf | between events | 0 | — | not assessable today |
| nba | offseason (Oct) | 0 | 0 | empty is correct |
| nhl | offseason (Oct) | 0 | 0 | empty is correct |

NBA and NHL player pages rendering empty today is **not** a finding. CFB's is.

---

## B1 — CFB player pages are empty during a full slate ◆ HIGH

Every CFB player page renders exactly one sentence:

> *No tracked markets for this player on today's slate.*

Verified on `/cfb/player/espn:football:5148651`. This is not a calendar effect:

- the CFB snapshot carries **176 games** for today and **21,591 subjects**
- `game_result` holds CFB games dated **2026-09-13**
- `player_game_history` holds **134,052 CFB rows** across 2024–2026
- `seasonStatus.started` is **true**

The snapshot builds **0 candidates** from all of that. Every CFB player page in
the app is blank while the sport is playing. Root cause not traced — Phase D.

## B2 — The WTA tour shows men's matches ◆ HIGH

`/api/tennis/wta` returns men's ATP players mixed into the women's field:

> Karen Khachanov, Alexander Blockx, Alexander Zverev, Botic Van De Zandschulp,
> Frances Tiafoe, Ben Shelton — beside Gauff, Sabalenka, Pegula, Rybakina,
> Andreeva

Matchups listed on the WTA page include `Alexander Blockx vs Karen Khachanov`
and `Ben Shelton vs Frances Tiafoe`.

**Cause, located.** `fetchTennisMatches` in
`lib/sports/multiSport/espnTennis.ts:53` walks **every** ESPN `grouping` with no
filter:

    for (const grouping of ev.groupings ?? []) {

The correct filter already exists in the sibling path,
`lib/sports/tennis/schedule.ts:279`, reading the same ESPN endpoint:

    const singlesSlug = tour === 'atp' ? 'mens-singles' : 'womens-singles';

`espnTennis.ts` never got it — its own response type doesn't even declare
`grouping.slug`. Combined ATP/WTA tournaments publish both draws under one
event, so the women's endpoint picks up the men's draw.

**Downstream damage, confirmed:** `/api/tennis/wta/game/182770` returns
`player1Recent`, `player2Recent`, `player1H2h`, `player2H2h` **all empty**,
where the equivalent ATP game returns 141 / 110 / 4 / 4. A misfiled player
resolves against the wrong tour's season context and finds nothing. The player
page for one of them renders "No tracked markets".

## B3 — The games strip is MLB's shape everywhere, including MLB's vocabulary ◆ MEDIUM

`context.other.games[]` object fields, per sport:

| sport | fields | |
|---|---|---|
| **mlb** | **25** | away, home, awayStarter, awayStarterStats, awayStarterOverallRank, homeStarter…, elo, gameModel, weather, weatherNarrative, liveScore, venue, state, status, awayTeamId, homeTeamId, … |
| nfl | 5 | gamePk, matchup, awayTeamName, homeTeamName, **firstPitch** |
| cfb | 5 | *identical 5* |
| soccer_epl / soccer_mls | 5 | *identical 5* |
| tennis_atp / tennis_wta | 5 | *identical 5* |

Two separate problems in one structure:

1. **Six sports share one 5-field stub** while MLB carries 25 — no elo, no
   model, no weather, no live score, no venue, no team ids anywhere else.
2. **The start-time field is named `firstPitch` in tennis, soccer, NFL and
   CFB.** MLB's vocabulary is in the wire format of every sport. This is the
   operator's "gridbox built for MLB" complaint in literal form.

## B4 — Five incompatible team payloads for one shared interface ◆ MEDIUM

`/api/{sport}/team/{id}`, same audit run:

| sport | fields | notable |
|---|---|---|
| **mlb** | **7** | `teamId, teamName, abbreviation, logoUrl, record, roster, fetchedAt` — **no games, no stats, no next game, no injuries.** The thinnest payload in the app belongs to the richest sport; MLB's team page sources the rest from separate routes (`team-form`, `team-statcast`) that no other sport has. |
| nfl | 10 | richest — `teamStats[15]`, `grades{9}`, `opponentGrades{9}`, `opponentDefenseAllowed[5]`, `candidates{3}` |
| nba | 7 | `recentGames[82]`, `injuries[3]` — **no team stats at all** |
| nhl | 7 | identical to NBA — `recentGames[82]`, `injuries[]` empty — **no team stats** |
| cfb | 12 | has `teamOffense{16}`, but `opponentDefenseAllowed`, `opponentAbbr`, `opponentName`, `opponentLogoUrl` all **NULL** |
| soccer_epl | 11 | `teamSeasonStats{9}` + `opponentSeasonStats{9}` — the only sport with both sides |

NBA/NHL having no team stats matches the note already in
`lib/sports/shared/seasonAggregates.ts` ("the NBA and NHL adapters emit `[]`,
which is why their team pages are the thinnest in the app"). It is still true.

## B5 — The NFL games strip lists games its own game route cannot resolve ◆ MEDIUM

`/api/nfl/game/401872657` returns `{"error":"No NFL game with id 401872657"}`.

That id is `games[0]` in the NFL snapshot's own strip — `SF@LAR`, kicked off
2026-09-11, two days before the audit. Today's ids from the same list
(401872925, 401872923, 401872659) all resolve normally. The strip retains a
completed game the detail route has already dropped, so it is a navigable dead
link on the NFL index page.

## B6 — `seasonStatus` exists, and the team pages ignore it ◆ MEDIUM

The NBA team page header renders, in the middle of the offseason:

> `0-0 · 0th seed, Eastern Conference in division`

Two faults: `0th seed` is a formatting bug in any season, and the card shows a
meaningless 0-0 when the same snapshot **already carries** the right words —
`seasonStatus.label` = *"The 2026-27 NBA season hasn't tipped off"*, with
`started: false`. NHL carries the equivalent. The field is populated and unread.

Worth noting the page is otherwise fine out of season: it renders 82 games of
prior-season history, OFF/DEF/REB grades, windows and a distribution chart.

## B7 — Soccer already reads career-spanning history ◆ CORRECTS PHASE A

`/soccer/epl/player/espn:soccer:122268` (Adam Smith, BOU) renders **"259 games
in scope"**, spanning roughly seven seasons.

Phase A's table said soccer reads "1 season + prior as a small-sample fallback".
**That was wrong** — it was inferred from `attachRealHistory`'s season variable
without opening the fetcher. `fetchUnderstatPlayerMatches`
(`lib/sports/soccer/understat.ts:401`) returns a career-spanning `matches[]`
regardless of which season's index located the player, and its doc comment says
so at line 133.

This matters beyond the correction: **soccer proves the shared components
render deep multi-season history correctly when an adapter supplies it.** The
distribution chart, windows and gamelog all handled 259 games without
modification. The bottleneck for the other sports is per-sport data sourcing,
not the UI. Phase A has been amended.

## B8 — smaller items

- **CFB game detail**: `/api/cfb/game/401858423` returns `pregameLine: NULL` and
  a 13-field `game` object with no player stats and no key events. Compare
  soccer's game payload: `keyEvents[39]`, `playerStatsByAthleteId{40}`.
- **MLB has no game-detail API route** (`/api/mlb/game/{id}` 404s; only
  `.../live` exists). Believed deliberate — Phase C confirms rather than assumes.
- **NFL id-mapping warnings**: the snapshot carries 9 live warnings of the form
  `No nflverse id mapping for <player> (espn id …)`, including a veteran starter
  (Chris Manhertz). The known ESPN-athlete-id gotcha, still firing.
- **NFL spelling**: the opposing-defence card reads `OPPOSING DEFENCE` /
  `NYG defence` — British spelling, inconsistent with the rest of the app.
- **Carried to Phase C** (card sense, not wiring): the NFL matchup card
  announced *"Biggest edge: Pass Yds Allowed/Gm — NYG defense ranks in the 48th
  percentile allowing it."* The 48th percentile is league average; the card
  asserts an edge that its own number denies.

---

## Method notes, including one trap I walked into

**A cache rebuilt mid-audit and nearly produced a false finding.**
`/api/nba/teams` returned `ATL 46-36, rank 6` early in the run and `ATL 0-0,
rank 0` an hour later — same endpoint, same session. The first response was a
stale `snapshot_cache` entry from the 2025-26 season; the second was a genuine
rebuild after rollover. Reported as a wiring bug this would have been wrong.
**Any figure in this document that could have come from cache was re-fetched
before being written down.**

**Coverage — what was actually done, not what was planned.** The plan said
render all 21 surfaces. Executed:

- **API-level probe of every surface** — all 10 sport snapshots, 6 team
  payloads, 6 game payloads. This is where B2–B5 and B8 come from.
- **Browser render of 7 pages**: MLB player, NFL player, soccer EPL player, CFB
  player, NBA player, NBA team, tennis WTA player. This is where B1, B6 and B7
  come from — and B7 in particular **could not** have been found by API probing
  or by reading the adapter, which is the whole reason the plan required
  rendering.
- **Not rendered**: NHL and NBA player pages beyond one sample (offseason —
  nothing to see), golf (between events), MLB/NFL/CFB/soccer team and game
  pages beyond their API payloads.

Golf remains unassessed for a second phase running. It needs a live tournament
or a deliberate historical fixture; Phase C must not score it blind.
