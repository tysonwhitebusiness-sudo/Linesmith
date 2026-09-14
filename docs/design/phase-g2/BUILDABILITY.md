# Phase G2 — can the app build every card? (verified 2026-09-14)

Every card in `player.html`, `game.html` and `team.html` was traced from the builder that made
its data (`tools/build_*_data.py`) to the app code that calls, stores or parses the same thing.
The check was the code, not memory: each source was grepped in `app/`, `lib/`, `components/`
and `python-odds-service/`, and the questionable ones were queried in Postgres.

## The short answer

**Nearly every number comes from data the app already stores or already fetches.** One source
the app doesn't call (ESPN's core team-statistics API, used for team ranks) has a better
replacement already in the app. What separates the mockups from the app is mostly **reading
more of what is already in hand**:

1. **Parsing more of feeds the app already fetches.** The ESPN game summary (win probability,
   drives, play coordinates, pick center, soccer lineups and commentary positions), the MLB live
   feed (every pitch location, hit distance, exit velocity), and TennisMyLife rows (serve,
   return, break points, minutes, ranks). The app downloads these and throws most of it away.
2. **Python rollups over the Statcast corpus.** `mlb_pitch_events` holds only a hot window (5
   days on 2026-09-14: Sep 9–13). Full seasons live in the Parquet corpus, which Python can query
   (`corpus_reads.union_view`) but no TypeScript route can. Every season-long pitch-level MLB card
   needs a Python job writing a rollup the page reads (the repo's "Python writes, TS renders" rule).
3. **Two data corrections the mockups already apply:** prop main-line selection and
   the NBA shot coordinate origin (details in `G-ideas.md`).

## Legend

| mark | meaning |
|---|---|
| **Read** | the app reads it today (table, route or adapter exists) |
| **In hand** | the app stores or fetches it but doesn't read the field; needs a parser, a filter or a rollup |
| **New endpoint** | a host the app already calls, a new path on it |
| **New source** | not called by the app today |

## Player page

| card | sports | data | status | where |
|---|---|---|---|---|
| Hero, bio, headshot | all | ESPN athlete / rosters | Read | sport rosters; `golf/espn.ts` |
| Prop analysis block (markets, line, price, hit rates, bars) | all but golf | `prop_odds` + `player_game_history` | Read, **plus the main-line rule** | the app's current "latest row" pick shows alternate or post-game lines |
| Seasons, trends, splits, game log | all team sports | `player_game_history` (+ `game_result` for W/L) | Read | `/api/season-ranks`, adapters; `game_result` needs de-duplication |
| MLB power profile, EV distribution, EV by game, pitch types, zone map, vs LHP/RHP, HR list | MLB hitter | pitch-level Statcast, full season | **In hand (corpus)**: Python rollup needed | `mlb_pitch_events` is a 5-day window; `corpus_reads.py` |
| MLB home-run distance | MLB hitter | `totalDistance` / `hit_distance_sc` | **In hand**: MLB live feed is fetched and passed through raw (`statsapi.ts`), nothing reads `hitData`; not in the corpus | `lib/sports/mlb/statsapi.ts` |
| MLB arsenal, pitch locations, velocity by start | MLB pitcher | corpus | **In hand (corpus)** | as above |
| NFL target chart, depth by season | NFL WR/QB | `nfl_target_events` | Read | `/api/nfl/target-map` |
| CFB advanced passing | CFB | — | Not held (shown as such) | — |
| NBA shot chart by zone | NBA | `nba_shot_events` | Read (2024-25 only), **needs rim-origin and miss-value correction** | `/api/nba/shot-profile`, `nba_shots.py` |
| NHL rink map | NHL | `nhl_shot_events` | Read (2024-25 only) | `/api/nhl/shot-profile` |
| NHL official season totals | NHL | NHL player landing | **New endpoint** (`api-web.nhle.com/v1/player/{id}/landing`) | `nhle.ts` calls other paths on this host |
| Soccer shot map, goals vs xG, per 90 | soccer FW | Understat per-player payload | Read (cached in `snapshot_cache`) | `soccer/understat.ts` |
| Soccer keeper cards | soccer GK | `player_game_history` | Read | — |
| Tennis tiles, surface splits, serve/return trend, ranking | tennis | TennisMyLife rows | **In hand**: fetched, but `tennismylife.ts` parses only aces and surface | `lib/sports/tennis/tennismylife.ts` |
| Golf rounds, scoring by par, driving, approach, putting | golf | `golf_round_scores`, `golf_hole_scores`, `golf_shot_events`, `golf_tournaments` | Read; driving/approach/putting are computed from shots | `/api/golf/shot-profile`, `golf_history.py` |

## Game page

| card | sports | data | status | where |
|---|---|---|---|---|
| Scoreboard, linescore, team stats, box score, leaders | NFL, CFB, NBA, soccer | ESPN summary | Read | `footballLiveGame.ts`, `nba/liveGame.ts`, `soccer/liveGame.ts` |
| Same | MLB / NHL | MLB live feed / NHL landing + boxscore | Read | `statsapi.ts`, `nhl/liveGame.ts` |
| Win probability + biggest swings | NFL, CFB, NBA | ESPN summary `winprobability` | **In hand**: fetched, not parsed | the summary the live parsers already download |
| Win probability | MLB | MLB `/game/{pk}/winProbability` | **New endpoint** | `statsapi.mlb.com` already called |
| Drive chart, selected-drive field model | NFL, CFB | ESPN summary `drives` | **In hand** | not parsed (confirmed; also noted in G) |
| Lead tracker, scoring runs, shot chart, play log | NBA | ESPN summary `plays` (with coordinates) | **In hand** | live parser reads box score only |
| Shot-attempt flow, full-rink map | NHL | NHL play-by-play | Read by `nhl_shots.py` for stored games; **In hand** for a live game | `python-odds-service/src/nhl_shots.py` |
| Spray chart with distance, at-bat explorer, pitch mix | MLB | MLB live feed `plays` | **In hand**: passed through raw, not read | `statsapi.ts` |
| Timeline | soccer | ESPN `keyEvents` | Read | `soccer/liveGame.ts` |
| Shot map, formations, player stats, last five | soccer | ESPN `commentary` positions, `rosters`, `lastFiveGames` | **In hand** | not parsed |
| Match stats, form | tennis | TennisMyLife rows | **In hand** (only aces parsed) | `tennismylife.ts` |
| Head-to-head | tennis | TennisMyLife | Read | `tennis/adapters/gameDetailAdapter.ts` |
| Lines open → close, result vs line | NFL, CFB, NBA, NHL, soccer | ESPN summary `pickcenter` | **In hand** (`espn_odds_backfill.py` reads it for history; no table stores it) | — |
| Last pre-game quote, run line, total | MLB | `game_odds_history` | Read, **plus a pre-start filter** (quotes keep arriving after the start) | `lib/odds/gameLineHistory.ts` |
| Line movement before the start | all with odds | `game_odds_history` | Read, **plus the pre-start filter** | as above |
| Player props vs results | NFL, CFB, MLB, soccer | `prop_odds` + box score | Read, **plus the main-line rule** | — |
| Season series | NBA, NHL | ESPN summary `seasonseries` | **In hand** | — |

## Team page

| card | sports | data | status | where |
|---|---|---|---|---|
| Record, standing summary, next game | all | ESPN team / schedule | Read | `multiSport/teamSportEspn.ts` |
| Results, margins, splits, schedule | all | ESPN schedule (+ `game_result`) | Read | as above |
| Standings | NFL, CFB, NBA, soccer / MLB / NHL | ESPN / MLB Stats API / NHL `standings/now` | Read | `*/espn.ts`, `mlb/adapter.ts`, `nhle.ts` (NHL is current season only) |
| League ranks with dot strip | all | mockup: ESPN core statistics for every team | **New source**; **use what the app already has instead**: `/api/season-ranks` (for and allowed, every sport, from game logs), nflverse team stats, MLB team hitting/pitching, the defense-allowed modules | `app/api/season-ranks`, `nfl/nflverse.ts`, `*/teamDefenseAllowed.ts` |
| Roster production | all | `player_game_history` | Read | — |
| Team Statcast percentiles | MLB | corpus joined through game logs | Read in another form: `teamStatcast.ts` averages per-player Savant rates by team; the mockup's pitch-weighted version needs the corpus rollup | `lib/sports/mlb/teamStatcast.ts` |
| Target share, throw map vs league | NFL | `nfl_target_events` | Read | — |
| Ranked opponents | CFB | ESPN schedule `curatedRank` | **In hand** | schedule already fetched |
| Shot profile vs league | NBA | `nba_shot_events` by `team_id` | Read (2024-25 only), with the coordinate correction | — |
| Shot map for / against | NHL | `nhl_shot_events` by `team_id` | Read (2024-25 only) | — |
| Team totals ranked | soccer | `player_game_history` | Read | `/api/season-ranks` |

## Corrections this check made to the mockups and notes

- **Golf event names are held** (`golf_tournaments`). The mockup now shows them; `G-ideas.md`
  said they weren't.
- **Understat is cached** per player in `snapshot_cache`; the mockup said "never stored".
- **Season labels in `player_game_history` are a documented convention** (NBA end year, NHL, NFL, CFB
  and EPL start year; `backfill_player_game_history.py`), not an inconsistency. Any page mapping
  a season must follow it.
- The mockup's "the app parses aces only" for tennis is **correct**.
- ESPN `pickcenter` is read by a backfill script, but nothing stores it.

## What building it takes, in order of reach

1. Parsers for fields already downloaded: ESPN summary (win probability, drives, plays, pick
   center, rosters, commentary, season series), MLB live feed plays, TennisMyLife columns.
2. Two logic fixes in shared code: prop main-line selection; pre-start filtering of stored odds.
3. Python rollup jobs over the corpus for season-long pitch-level MLB cards (player and team).
4. Correct NBA shot coordinates at read time (or at ingest), and extend NBA/NHL shot ingest to
   2025-26.
5. One new endpoint on an existing host each: MLB win probability, NHL player landing.

---

## Added 2026-09-14: game states and the compare control

Same legend. These cards were built on the same stored data; the table says what the app would need.

### Game page — before start (as of kickoff)

| card | data | status |
|---|---|---|
| Header: start time, venue, weather, records entering, closing line chips | ESPN summary / MLB feed, `game_result` | Read |
| Strength vs strength (one side's production against what the other allows, league ranks) | `player_game_history` rolled up for and by opponent, cut at kickoff | Read for the rollup (`/api/season-ranks` has `side=allowed`); **In hand**: a date cutoff so it's "as of kickoff" |
| Form coming in, head-to-head | `game_result` (de-duplicated) | Read |
| Player props with each player's last 10 and history vs this opponent | `prop_odds` (main-line rule) + `player_game_history` | Read, plus the main-line rule |
| Players to watch (NBA, NHL, soccer): season and vs-opponent averages | `player_game_history` | Read |
| Injuries | ESPN summary `injuries` (NFL also calls the ESPN injuries endpoint) | Read for NFL; **In hand** elsewhere. The summary carries the current report, not a snapshot from before kickoff |
| NFL passing matchup: where each offense throws vs where the other defense is thrown at | `nfl_target_events` (defense derived from the game id) | Read for offense; **In hand** for the defense view |
| NBA shot zones: one team's shots vs zones the other allows | `nba_shot_events` by game (2024-25 only) | Read, with the coordinate correction |
| MLB starters: season line, last starts, pitch mix; lineup vs the starter's hand and head-to-head | `player_game_history` + Statcast corpus before the game | **In hand (corpus)**: Python rollup |
| NHL goalie form | `player_game_history` | Read |
| Soccer lineups | ESPN summary `rosters` | **In hand** |
| Tennis serve vs return, form before this round | TennisMyLife | **In hand** (only aces parsed) |

### Game page — live (the real game cut at a moment)

| card | data | status |
|---|---|---|
| Score, linescore, win probability, drive chart, shot maps, spray chart up to the moment | the same feeds as the final page | as the final page (mostly **In hand** parsers) |
| Props tracker: stat so far against the line | MLB plate appearances, soccer commentary; NFL/CFB play text in the mockup | The live app would read the live box score it already refreshes (`footballLiveGame.ts`, `nba/liveGame.ts`, `nhl/liveGame.ts` read `boxscore`): **Read** |
| In-game odds up to the moment | `game_odds_history` rows after the start | Read (the rows exist; today they're mixed into pre-game history) |

### Player and team pages — compare control

| card | data | status |
|---|---|---|
| Player vs a team: games against them, averages vs season | `player_game_history` | Read |
| What the team gives up to the player's position (per game, league rank) | `player_game_history` by opponent + positions (nflverse for NFL, ESPN rosters for NBA/soccer) | Read for team-level allowed; **In hand**: position grouping |
| NFL: defense thrown-at map to receivers vs the player's targets | `nfl_target_events` + nflverse positions | **In hand** |
| NBA: player's zones vs zones allowed to the position | `nba_shot_events` + roster positions | **In hand** (2024-25 only) |
| MLB: opponent staff vs right/left-handed hitters, lineup vs right/left-handed pitchers | Statcast corpus by team | **In hand (corpus)** |
| Player vs a same-position player: season side by side, trend overlay | `player_game_history` | Read |
| Tennis vs another player: season serve/return profiles, head-to-head | TennisMyLife | **In hand** (fields) / Read (head-to-head) |
| Golf vs the field, round by round | `golf_round_scores`, `golf_tournaments`, ESPN athlete names | Read |
| Team vs team: strength vs strength, head-to-head, form, key players | `player_game_history` rollups, `game_result` | Read |

Nothing in either addition needs a source the app doesn't already call.
