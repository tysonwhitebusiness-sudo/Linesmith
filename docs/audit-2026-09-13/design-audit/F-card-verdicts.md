# Phase F — Verdict on every card (redone)

**Status: COMPLETE 2026-09-14, second version.** Replaces the first version
(commit `9357b19`), which judged every card by whether it helped decide today's
bet. The operator corrected that: **player, team and game pages are in-depth
research pages. Any stat relevant to an informed decision belongs on them; odds
and lines are one section, not the point.**

Not judged (calendar): golf, NBA/NHL live states, CFB market cards on a live
Saturday, soccer and tennis live.

## How this version judges

**Two questions per card:** does it make sense for this sport, and does it give
real insight into this player, team or game?

**Verdicts:** **keep** · **rework** (the insight is right, the showing isn't) ·
**replace** (this slot should hold something else) · **remove** (true duplicate
or empty). **Depth is never removed.** A real stat that doesn't bear on a bet
stays.

**Checks behind each verdict:** **Ins**ight · **Nat**ive form · **Sco**pe ·
**Enc**oding · **Dup**lication · **Ide**ntity · **Int**eraction · **Ren**dering.

**New in this version: a depth ledger per sport.** The operator's test case
("longest home run of the day") showed the page can fall short for three
different reasons, and each has a different fix:

| column | meaning | fix |
|---|---|---|
| **Shown** | on the page today | — |
| **Held, not shown** | in our database or corpus, never rendered | a read path and a card |
| **Dropped at ingest** | the source we already call provides it; our parser throws it away | keep the column, backfill |
| **Not held** | no source we use provides it | a new source, or derive it |

Every ledger row was checked against the database schema, the local Parquet
corpus or the fetcher's own parser on 2026-09-14.

---

## Operator decision after Phase G review, 2026-09-14

**Keep the player-page prop analysis block** (market tabs, line stepper with
price, window chips, hit-rate tiles, bar chart against the line). Where rows
below say the bar chart becomes a generic stat-over-time chart with the line as
an optional overlay, or that the line picker moves into a collapsed odds
section, **this decision overrides them**: the block stays as it is, near the
top of the player page, with presentation fixes only (season label, empty tiles
hidden, F2 type and contrast). See `G-ideas.md`.

## Summary

1. **The pages show a thin slice of what we hold.** Every sport has stats sitting in
   the database or corpus that no page renders, and several parsers throw away
   columns the source already sends:
   - MLB hit distance and spray angle.
   - Tennis serve and break-point stats.
   - Soccer xG, fetched per page but never stored.
2. **Pages are organised around one market, not the subject.** A player page
   opens on one prop and most cards re-describe that one stat against that one
   line. A research page should open on the player: role, season, trends,
   splits, advanced profile, matchup, health, then odds.
3. **Real duplication still exists:** 4–5 cards restating one hit rate on player
   pages; 4 cards comparing the same team stats on game pages; the live panel
   repeating the hero; "Next game" twice.
4. **Seasons are unlabeled or mixed nearly everywhere.** Charts open at the oldest
   game without years; records span seasons under a 0-0 record; ranks "of 23" in
   a 20-team league.
5. **Forms from the wrong sport:** strike-zone grids for football targets and
   soccer shots; baseball standings columns in the NFL; soccer records without
   draws; NHL without overtime losses; tennis with home/away, injuries and "unit
   grades"; "Contact quality" on soccer and CFB.
6. **Encoding misleads:** good/bad colors on neutral stats; ranks shown like jersey
   numbers; per-game stats rounded to integers; raw floats and timestamps.
7. **Identity:** initials instead of photos across many cards; club crests for
   soccer players; blank NHL logos.
8. **Blank player pages** (7 of 22 player captures). A player page must exist
   without a market.
9. **MLB's "Live today" and "Pitching matchup"** are the models: dense, true to
   the sport, two-sided.
10. **Cross-slate research questions have no home.** "Who hits the longest home
    run today" needs every hitter's power profile beside every park's carry and
    weather, a view no single page provides (see "Slate research views").
11. **13 correctness bugs** (F-B1 to F-B13), unchanged from the first version.

---

## What every research page needs (applies to all sports)

Each surface should cover these sections in the sport's own terms. The per-sport
sections below judge the existing cards against them.

| Player page | Team page | Game page |
|---|---|---|
| **Identity & role:** photo, position, team, jersey, age, depth-chart/lineup spot, injury status | **Identity & state:** logo, record (sport-correct format), standings position, streak, next/last game | **Header:** teams, records, venue, start time or live state, weather where it matters |
| **Season & career stats:** full box-score vocabulary, per-game and per-minute/90 rates, this season vs last vs career | **Team stats:** traditional and advanced, ranked, offense and defense, this season vs last | **Two-sided matchup:** each unit against its opposite, with the stats this sport actually uses |
| **Trends:** any stat over time, rolling averages, scope toggles | **Results & trends:** results with scores by season, ATS / over-under as one view | **Lineups / starters / goalies / pitchers**, injuries by importance |
| **Splits:** home/away, rest, opponent quality, surface/park, by month, by role | **Splits:** home/away, rest, vs winning teams, by month | **History:** head to head over years (`game_result` holds 16–27) |
| **Advanced / tracking profile:** the sport's deep stats | **Roster & depth chart**, injuries | **Box score & play-by-play** (live and final) |
| **Matchup:** opponent's relevant defensive/pitching/goalie profile | **Schedule difficulty & rest** | **Odds & lines section:** best prices, movement history, props for this game |
| **Game log:** every stat, result, opponent, grouped by season | **Odds & lines section** | |
| **Odds & lines section:** props, best price, line movement, hit rates as one optional view | | |

---

## MLB

### Player page (hitter Bobby Witt Jr. live; pitcher Noah Cameron live)

**As research:** the richest page in the app, and the closest to the target. It
still opens on one prop ("Hits O 0.5"), and its deepest cards run on tiny samples:
pitch mix on **33 pitches**, platoon on **41**, strike zone on **7 balls in
play**. Meanwhile **1.45M pitches** sit in the corpus.

| card | insight | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** | who, team, game state, one prop | **rework** | Ins, Ide | Drop `#18` (a rank shown like a jersey number). Add lineup spot, bats/throws, age, injury status, live score. The prop moves to the odds section. |
| **Live today** | score, count, bases, batter/pitcher, his at-bats, every line with a check | **keep** | Ide | The model for every sport. Headshots for everyone named. |
| **Bar chart** ("131 games in scope") | a stat per game | **rework** | Sco, Int | A stat-over-time chart for **any** stat (hits, EV, total bases…), opening on the latest games, season labeled, rolling average drawn on it, line as an optional overlay. |
| **Rolling form** | trend in one stat | **merge** | Dup | Into the stat chart as the rolling-average line. The trend itself is kept. |
| **Matchup** ("Biggest edge: strikeouts… 94th percentile") | pitcher vs hitter profile | **rework** | Enc, Sco | Two-sided, like the game page's Pitching matchup: today's pitcher's arsenal and results against this hitter's handedness beside the hitter's results against those pitch types. Live: the pitcher actually on the mound. |
| **Pitch mix seen** (n=33) | what pitches he faces | **rework** | Sco | Season sample from `mlb_pitch_events` (hundreds of pitches per hitter), with results per pitch type: AVG, xwOBA, whiff%, EV. Sample size per row. |
| **Platoon split** (41 pitches) | vs LHP / RHP | **rework** | Sco, Enc | Season and last-season AVG/OBP/SLG/xwOBA and PA vs each hand, today's pitcher's hand marked. |
| **Strike zone** (n=7) | where he does damage | **rework** | Sco | Correct form for baseball. Season sample, zone plus chase edges, xwOBA / whiff% / swing% layers, opposing pitcher's locations on top. |
| **Situational splits** ("share of games over 0.5") | hit rate by window and venue | **rework** | Ins, Enc | Real performance splits as stats: home/away, day/night, vs LHP/RHP, by month, by lineup spot, with PA. |
| **Game log** | per-game line | **rework** | Ins | Full batting line, opponent and starter, result, EV max per game; grouped by season; line hit/miss optional. |
| **Opposing starter** (12 stats) | how good the pitcher is | **rework** | Enc | Keep the depth. Color from the viewed hitter's perspective, add handedness, pitch mix and velocity, headshot. |
| **Head to head** ("vs BOS 5 of 6") | results vs a team | **rework** | Nat | Batter vs **this pitcher** first (PA, H, HR, K, xwOBA), team splits second. |
| **Conditions** (raw ISO, 67°F, wind N, rain 91%) | weather | **rework** | Nat, Ren | Temperature, wind **relative to the field**, roof, rain risk, and the **park factor** (held, not shown). Formatted time. |
| **Hitter stats** | season line + quality of contact | **keep, expand** | Sco | Add max EV, 90th-pct EV, sweet-spot %, pull%, bat speed (see ledger), with season / last season / career columns. |
| **Where this sits** | percentile in one stat | **rework** | Enc | Percentile bars for 8–10 key stats among qualified hitters (the Savant-style profile). |
| **Game context** | line-based summary rows | **replace** | Ins | Season / last-30 / career summary of the key stats with samples. |
| **Odds section** (line picker, All books, Line movement, Recorded price, Live line tracker, Today's line) | prices and movement | **rework as one section** | Dup | One grouped section: props for this player, best prices, movement from `prop_odds_history` (5.2M rows), tracking. Recorded price merges into it; empty parts hide. |
| **Form** ("vs BOS –") | none | **remove** | — | Empty everywhere. |
| **Pitcher page** | | **rework** | Ins | Pitchers get **no** matchup, pitch-mix or zone cards though `mlb_pitch_events` holds every pitch they threw. Needs: arsenal (usage, velo, spin from ledger), results by pitch type, zone, splits by batter hand, pitch count/leash trend, opposing lineup profile. Game log is empty (F-B4). |

### Team page (Kansas City)

| card | verdict | what instead |
|---|---|---|
| **Hero** | rework | Record, division place, streak, run differential, next game with probable starters. |
| **Team line picker, "149 games" win bars** | replace | Results strip by month with scores; run differential over time; ATS/over-under as one view. |
| **Rating history** | rework | "Power rank 22nd" with the rating on hover. |
| **Pitching matchup** | keep | Today's game. |
| **Team stats** (per game rounded to integers, F-B5) | rework | One set of rates to proper precision, season vs last season, offense and pitching. |
| **Advanced stats** | keep, expand | Add team xwOBA, chase rate, bullpen vs rotation splits (from `mlb_pitch_events`). |
| **Standings** | keep | Native. |
| **Situational splits / Home & Away** | rework | Real team splits: home/away, vs LHP/RHP starters, one-run games, by month. |
| **Roster** | rework | Depth chart / lineup order, IL status, photos, real numbers. |
| **Game context, Form, Next game** | replace / remove / rework | As player page; next game with probable pitchers. |

### Game page (KC @ BOS)

| card | verdict | what instead |
|---|---|---|
| **Pitching matchup** | keep, polish | Label bullpen rank circles; live marker for the current pitcher. |
| **Records** | keep | Season-true. |
| **Team stat comparison, Rankings, Unit grades** | merge | One two-sided matchup: each lineup vs the opposing staff, proper decimals (F-B5). |
| **Situational splits, Game context** | replace | Real splits for both teams; remove the line rows. |
| **Last 5 games** | keep, polish | Logos, not initials. |
| **Injuries** | rework | IL and day-to-day only, impact order, photos. |
| **Missing** | add | **Lineups** (batting order, handedness) when posted; **park factor and weather impact**; **head to head over seasons** (`game_result` from 2010); umpire is out of scope (officials cut 2026-08-29). |
| **Odds section** | rework | Best prices, movement (`game_odds_history`), props for this game. |

### MLB depth ledger

| | |
|---|---|
| **Shown** | batting and pitching box lines; season AVG/OBP/SLG/OPS/HR/RBI; season barrel%, avg EV, hard-hit%, whiff% (Savant aggregate); small-sample pitch mix, platoon and zone; weather; opposing starter's Statcast aggregate |
| **Held, not shown** | **1.45M pitches, 2025–2026** (`corpus/mlb_pitch_events`): per-pitch velocity, type, location, EV and launch angle for **246,709 batted balls and 11,421 HRs**, enough for max EV, EV distribution, launch-angle profile, results by pitch type and zone, pitcher arsenals. `park_factors` (542 venue-seasons) not on player pages. `player_game_history` 2024–2026 while pages read one season. `game_result` from 2010 for head to head. `prop_odds_history` / `game_odds_history` for movement. |
| **Dropped at ingest** | Savant's export includes **hit distance (`hit_distance_sc`), spray coordinates (`hc_x/hc_y`), batted-ball type, bat speed and swing length, spin rate, pitch movement, release extension**; `statcast_pitches.py` keeps ~20 columns and discards them. |
| **Not held** | park orientation and dimensions (for wind direction relative to the field and a carry-specific park factor); confirmed lineups history. |

---

## NFL

### Player page (WR Tre Tucker, RB Ashton Jeanty, QB J.J. McCarthy; QB Jaxson Dart and WR Malik Nabers pre and live)

**As research:** thin for the sport with the richest vocabulary stored (57 keys).
It shows receptions, yards and TDs; it doesn't show **targets per game, target
share, yards after catch, air yards, catch rate over time, snap share or
efficiency**, and all 17 bars are 2025 labeled as nothing.

| card | insight | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** | who, game, one prop | **rework** | Ins, Sco | Position, depth-chart role, jersey (not rank), injury status, game state (score live). Odds to the odds section. |
| **Bar chart** | one stat per game | **rework** | Sco | Any stat over time (targets, receptions, yards, YAC, air yards), season labeled, rolling average, line optional. |
| **Rolling form** | trend | **merge** | Dup | Into the stat chart. |
| **Matchup** (biggest edge at the 45th percentile) | opponent profile | **rework** | Enc, Dup | Two-sided unit matchup: this player's usage/efficiency vs what the defense allows **to his position**, ranked, season labeled; "no clear edge" when flat. |
| **Opposing defence** | defense allows | **merge into Matchup** | Dup, Enc | Same. |
| **Target map** | where targets go | **rework for WR/TE; replace for RB** | Nat, Enc | Half-field drawing with depth zones, share as single-hue intensity, catch rate and YAC on hover (`nfl_target_events`: air yards, YAC, location, 2024–2026). RB: rushing profile (carries by run gap is not held; use rushing yards/attempt trend and receiving role). |
| **Game log** | per game | **rework** | Ins | Full line: targets, rec, yds, YAC, air yds, TD, long, fumbles; result and score; season grouping. |
| **Season stats** | season line, ranked | **keep, expand** | Sco, Enc | Targets, target share, catch rate, yards/target, YAC/rec, air yards/target, long, TDs; season / last season / career; pool of qualified players. |
| **Head to head** (QB: 2 meetings, 50%) | vs opponent | **rework** | Enc | List the meetings with the full stat line; rates only at 5+. |
| **Conditions** | weather | **rework** | Ins | Outdoor only, with impact on passing and kicking. |
| **Where this sits** | percentile in one stat | **rework** | Enc | Percentile bars for the position's key stats. |
| **Game context** | line-based rows | **replace** | Ins | Season / last-4 / career summary. |
| **Odds section** (picker, All books, Line movement, Recorded price, Live tracker, Today's line) | prices | **rework as one section** | Dup | As MLB. Game spread/total moves to the hero. |
| **Form** | none | **remove** | — | Empty. |
| **Live** | — | **add** | Ins | A live player card like MLB's (card audit C4): his stat line so far, snaps, targets, game state. |

### Team page (Las Vegas)

| card | verdict | what instead |
|---|---|---|
| **Hero** | rework | Record, division place, streak, point differential, next game (the listed one had already been played). |
| **Line picker, 25-game win bars** (two seasons out of order, F-B3) | replace | Results strip by season with scores; ATS/over-under as one view. |
| **Rating history** | rework | Power rank with context. |
| **Team matchup** (no bar for 32nd) | rework | Unit vs unit two-sided, bars for every rank. |
| **Team stats** | keep, expand | Label season; add EPA/play, success rate, red zone %, 3rd-down %, explosive play rate (team EPA/CPOE already computed from nflverse). |
| **Situational splits, Home/Away** | rework | Real team splits (home/away, division, vs winning teams, by quarter). |
| **Roster** | rework | Depth chart by unit, jersey numbers, injury status, photos. |
| **Standings** | rework | W-L-T, PCT, division record, streak, PF/PA; drop GB and L10. |
| **Last 15, Recent results, Form** | merge | Into the results strip. |
| **Game context, Next game** | replace / rework | Summary; real next game. |

### Game page (DAL @ NYG live, GB @ MIN, TB @ CIN final)

| card | verdict | what instead |
|---|---|---|
| **Hero + live panel** | rework | One header that becomes live; remove the repeated score block; photos for leaders. |
| **Weather** | keep | Hide for domes. |
| **Box score, By quarter, Scoring plays, Team stats table** | keep | Collapse the 30-row table to key rows with "show all". |
| **Matchup** (text collisions) | rework | Unit-vs-unit two-sided with the sport's stats (EPA/play, success rate, pass/rush rates, pressure), season labeled. Absorbs Team stat comparison, Rankings (F-B1) and Unit grades. |
| **Records** (13 home games, F-B2) | rework | This season, last season labeled, head to head by season from `game_result` (NFL from 1999). |
| **Situational splits, Game context** | replace | Team splits; summary. |
| **Last 5 games** | keep, polish | Label season; logos. |
| **Injuries** (entire roster listed) | rework | Only players with a status, starters first, position, photo. |
| **Odds section** (Line movement, Moneyline strip, Line shopping, My picks) | rework as one section | Best prices for spread/total/moneyline, movement chart, props list. |

### NFL depth ledger

| | |
|---|---|
| **Shown** | receptions/yards/TD, passing and rushing totals, team offense/defense per-game and ranks, team EPA/CPOE on matchup cards, target map, weather, injuries |
| **Held, not shown** | `player_game_history` 57 keys incl. **targets, long reception, adjusted QBR, QB rating, sacks, kicking, punting, returns, defense (tackles, QB hits, TFL, passes defended)**; `nfl_target_events` 2024–2026 with **air yards, YAC, completion, TD, INT per target**; `game_result` from 1999; `team_elo_history`; `injury_report` (since 2026-09-01) |
| **Dropped at ingest** | the nflverse play-by-play the target job already reads carries **EPA, success, down and distance, CPOE per play**; `nfl_target_events` keeps 12 columns and none of those |
| **Not held** | snap counts, routes run, route participation, separation (NFL Next Gen Stats), depth charts |

---

## CFB

**Player pages are blank** (Julian Sayin, Jeremiah Smith): "No tracked markets".
**Verdict: replace the empty state** with a real player page. The corpus holds
**52 stat keys, 2024–2026, 21,232 athletes**, enough for full season and game
logs for every player. Market verdicts wait for a live Saturday.

**Team page (Ohio State):** as NFL, plus "Contact quality matchup" is a baseball
title (**rework** as unit-vs-unit), and "Next game" appears twice. Missing: AP/CFP
rank, conference record and standings, strength of schedule.

**Game page (Ohio State @ Texas, final):** 10 cards, box score stuck loading
(F-B10), no matchup, team stats or rankings for a top-10 game. **Rework** to
NFL's game page depth.

**CFB ledger:** *Held, not shown:* 52 per-player keys for 21k athletes, team
offense stats, `game_result` from 2013. *Dropped at ingest / not held:* CFBD
publishes PPA (EPA-style) and team ratings; not ingested.

---

## Soccer (EPL; MLS spot-check)

### Player page (Haaland FWD, Adam Smith DEF, Donnarumma GK blank; MLS Bouanga)

**As research:** built around goals. It shows goals, shots, shot types and
location; it doesn't show **minutes, starts vs sub appearances, xG and xA per 90
over time, key passes, cards and fouls trends, defensive actions**, and the
goalkeeper's page is empty.

| card | insight | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** | who, game, one prop | **rework** | Ide, Sco | **Player photo, not the club crest**; position; standard abbreviations; match state (not kickoff time after full time). |
| **Bar chart** (203 games) | goals per game | **rework** | Sco | Any stat over time (goals, xG, shots, SOT, minutes), season labeled, opens on the latest; minutes played marked so a 15-minute sub isn't read as a blank. |
| **Matchup** | opponent defense | **rework** | Ide, Enc | Photo; two-sided: his attacking profile vs the opponent's defensive profile (goals and xG conceded, shots allowed, by zone). |
| **Shot types** | how he shoots | **keep** | — | Depth to keep; pair with the shot map. |
| **Shot location** (3×3 grid) | where he shoots | **rework** | Nat, Enc | Half-pitch shot map, dots sized by xG, goals highlighted, season filter. |
| **Home / Away** ("1.0 / 0.8" unlabeled) | venue split | **rework** | Enc | Goals, xG, shots per 90 home vs away, with minutes. |
| **Opposing defence** ("of 23", F-B7) | defense allows | **merge into Matchup** | Sco | |
| **Head to head** (8 meetings) | vs opponent | **keep, polish** | — | List meetings with his stat line. |
| **Season stats** (raw floats, F-B6) | season line | **fix + expand** | Ren | Minutes, starts, goals, xG, npxG, xA, shots, SOT, key passes, per 90, ranked among position peers, season / last season / career. |
| **Game log** | per match | **rework** | Ins | Minutes, start/sub, goals, xG, shots, SOT, key passes, cards; result and score. |
| **Default market** (right-back opens on anytime goalscorer) | — | **replace** | Ins | The page opens on the player, not a market. |
| **Goalkeeper page** (blank) | — | **replace** | Ins | Saves, goals conceded, save %, clean sheets, shots faced, from stored keys (`saves`, `shotsFaced`, `goalsConceded`). |
| **Game context, Where this sits, Rolling form, Form, odds cards** | | as MLB/NFL | | |

### Team page (Man City)

| card | verdict | what instead |
|---|---|---|
| **"Contact quality matchup"** | rework | Retitle and rebuild as attack vs defense, both ways. |
| **"4 games" win bars** | replace | W/D/L strip with scores. |
| **Team stats** (fouls and offsides green) | rework | Direction-aware color, neutral for style stats; add xG for/against, possession, shots for/against, set-piece goals; one rank pool (F-B7). |
| **Standings** | keep | Native. |
| **Next game** ×2 (swapped-looking moneylines, F-B9) | merge + verify | One card with date, time, and a draw price. |
| **Roster** | rework | By position, minutes, photos. |
| **Others** | as NFL | |

### Game page (Newcastle vs Leeds)

| card | verdict | what instead |
|---|---|---|
| **Matchup** (collisions) | rework | Attack vs defense with xG, shots, set pieces. |
| **Records** (draws as losses, F-B8) | fix + rework | W-D-L, points, home/away, head to head over seasons from `game_result` (EPL from 2015). |
| **Team stat comparison ("2025 season")** | rework | This season with last season beside it. |
| **Rankings** (F-B1), **Unit grades** | merge | Into the matchup. |
| **Missing** | add | **Probable lineups / formations**, **injuries and suspensions (card accumulation)**, goals by 15-minute window. |
| **Odds section** | rework | Three-way moneyline with the draw. |

### Soccer depth ledger

| | |
|---|---|
| **Shown** | goals, shots, SOT, assists; shot type and location (career); goals/xG allowed by opponent; team per-game stats; standings |
| **Held, not shown** | `player_game_history` 16 keys incl. **starts vs sub-ins, fouls committed/suffered, offsides, cards, saves, shots faced, goals conceded**; `game_result` from 2015 (EPL) / 2012 (MLS) |
| **Dropped at ingest** | Understat data the page **fetches live** (xG, xA, key passes, minutes, position, per-match history) is **never stored**, so no rank, trend or cross-player view can use it; soccer candidates also carry no position (E fact 16) |
| **Not held** | passing, tackles, interceptions, progressive actions, lineups/formations; MLS shot data (Bouanga's page has no shot cards) |

---

## NBA (offseason: pages as they render today)

**Player pages are blank** (Doncic, Kessler). **Replace the empty state.** Held
per player: 17 box-score keys 2024–2026 and **214k shot events** (x/y, type, made)
for 2024-25, enough for a full player page and a real shot chart year-round.

**Team page (Lakers):** team stats are counting totals only (**rework**: pace,
offensive/defensive/net rating, eFG%, TOV%, OREB%, FT rate, all derivable from
the held box scores); standings show 0-0 in the offseason (**rework**: last
season's final table, labeled); "No upcoming game scheduled" (**replace** with the
season opener, build 1b).

**Game page (last season):** matchup counting stats with text collisions, Rankings
mirrored (F-B1). **Rework:** pace and ratings matchup, rest days and back-to-backs
(derivable from `game_result` dates), starters and minutes, injuries.

**NBA ledger:** *Held, not shown:* box scores 2024–2026 (minutes, plus-minus,
FGA/FTA/TOV/OREB, so possessions, pace and ratings are derivable); shot events
2024-25; `game_result` from 2007. *Not held:* usage%, lineup/on-off data,
player tracking; shot events for other seasons.

## NHL (offseason)

**Player pages are blank** (Knies, Bobrovsky). **Replace.** Held: 21 keys
2023–2025 including **TOI, shifts, SOG, hits, blocks, PPG, faceoff %, and goalie
saves / shots against / goals against**, plus **178k shot events** (x/y, shot type,
goalie) for 2024-25. A goalie page can show save % and goals against today from
stored data.

**Team page (Toronto):** record drops OT losses (F-B11); "Saves/game 1st" colored
green (**rework** direction); missing PP%, PK%, shots for/against, save %.

**Game page (last season):** 9 cards, blank logos, box score stuck (F-B10), and
**no starting goalie matchup**, the single most important hockey game fact.
**Rework**, goalies first.

**NHL ledger:** *Held, not shown:* player TOI/shifts/SOG/hits/blocks/PPG/faceoffs,
goalie saves and shots against, shot events with coordinates and goalie,
`game_result` from 2007. *Not parsed:* power-play and shorthanded points and time-on-ice splits
aren't read by `nhle.ts`; whether the NHL endpoints the app calls carry them is
unverified.
*Not held:* expected goals (derivable from shot location and type), confirmed
starting goalies.

---

## Tennis (ATP; WTA spot-check)

**The match page is a team page with player names in the slots**, and the player
page lacks the stats tennis is decided on.

### Player page (Zverev)

| card | verdict | what instead |
|---|---|---|
| **Hero** (initials, "@ Ben Shelton") | rework | Photo, flag, ranking, tournament, round, surface, no "@". |
| **Bar chart** (aces line never cleared, F-B12) | rework + verify | Any stat over time (aces, double faults, 1st-serve %, games won), matches grouped by tournament and surface. |
| **Surface** (hard vs clay) | rework | Hard / clay / grass W-L and serve stats; today's surface marked. |
| **Opponent** | rework | Side-by-side serve and return profile. |
| **Head to head** (green squares for 0 of 4) | rework | Meetings with score, surface, round. |
| **Game log** ("Last 15 games") | rework | Matches: result, score, tournament, round, surface, serve stats. |
| **Rolling form, Game context, Where this sits, odds cards, Form** | as other sports | |

### Match page (Shelton vs Zverev)

| card | verdict | what instead |
|---|---|---|
| **Hero + live panel** ("Away/Home", overlapping names) | rework | Players, flags, rankings, set score, no home/away, no repeated block. |
| **By set** | keep | Native. |
| **Team stat comparison, Unit grades, Injuries** | replace | Serve/return comparison; fatigue (matches and minutes in the last 7 days, retirements); no invented units. |
| **Rankings** (mirrored, F-B1) | replace | ATP/WTA rank, surface Elo. |
| **Records** (multi-season labeled one, F-B13) | rework | Season W-L, W-L on this surface, H2H by surface. |

### Tennis depth ledger

| | |
|---|---|
| **Shown** | games and sets won/lost; aces (fetched live); match results |
| **Held, not shown** | `game_result` **56,386 matches with surface** since 2015; `player_game_history` 8 keys incl. majors, qualifying and tiebreaks |
| **Dropped at ingest** | the TennisMyLife CSV the app parses (`tennismylife.ts`) carries **double faults, serve points, 1st serve in/won, 2nd serve won, service games, break points saved/faced, match minutes and rankings**; the parser reads only aces |
| **Not held** | point-by-point (cut 2026-08-29), live serve stats |

---

## Every page

- **Blank player pages → a player page always renders the player.** Market cards
  appear when a market exists.
- **One odds section per page.** Line picker, best prices, All books, Line
  movement (from 5.2M prop and 299k game price rows), Recorded price, Live
  tracker and Today's line become one grouped, collapsible section. Hit rates
  against a line are one view inside it.
- **Every stat card gets scope toggles** (this season / last season / career / last
  N) and says which is showing.
- **Games strip:** scroll inside its own container; stop the page overflowing on
  phones; the sticky header must not cover cards.
- **Interaction:** hover detail on every chart mark; shared crosshair across charts
  of the same games (`useChartCrosshair` exists).
- **Identity:** one photo/logo resolver per sport with a silhouette-and-team-color
  fallback, not initials.
- **Dark mode:** none exists; a product decision for Phase G, not a card verdict.

## Slate research views (no page holds these today)

The operator's test case can't be answered on any single page. Questions that
span a whole slate, each built from data we hold or can keep:

| question | what it needs | status |
|---|---|---|
| **Longest home run of the day** | each hitter's max and 90th-pct EV, HR launch angle, **HR distance**; park carry; temperature; wind relative to field; opposing pitcher's velocity and EV allowed | EV/LA **held**; distance **dropped at ingest**; park orientation **not held** |
| **First / anytime TD scorer** | red-zone targets and carries, TD share, opponent TDs allowed by position | targets held; red-zone splits need play-by-play (**dropped**) |
| **Pace-up NBA games / player minutes** | pace and ratings by team, rest, injuries | **derivable** from held box scores and `game_result` |
| **Goalie matchups / shots props** | starting goalies, shots for/against, save % | shots and saves **held**; confirmed starters **not held** |
| **Anytime goalscorer across a matchday** | xG per 90 and minutes for every attacker, opponent xG conceded | xG **fetched but not stored** |
| **Aces / serve props on a tournament day** | serve stats by surface, opponent return profile | serve stats **dropped at ingest** |

---

## Correctness bugs found during Phase F

Data errors, not design judgments. They go to the build plan in Phase H.

| # | where | what | evidence |
|---|---|---|---|
| **F-B1** | Game page **Rankings** in **NFL, NBA, soccer and tennis** (not MLB) | Every "AGN" column equals the other team's "FOR" column, so the "allowed" ranks are invented and the heat colors wrong. | NFL: DAL AGN pass yds 21 but Matchup says DAL pass yds allowed **32nd of 32**. NBA: MIN AGN = LAL FOR. Soccer: NEW AGN = LEE FOR. Tennis: Shelton AGN = Zverev FOR. |
| **F-B2** | NFL game page, **Records** | Home and away records total 13 games each under a 0-0 season record. **Cause found in Phase G:** `game_result` stores the same game from two sources (69 rows for 52 Raiders games since 2023), and 3 duplicates are dated a day apart (evening kickoffs, UTC vs local date), so date-only de-duplication misses them. | DAL Home 6-7 · Away 5-7; NYG Home 4-8 · Away 1-12 |
| **F-B3** | NFL team page, **bar chart** | Two seasons out of chronological order, no years. | 11/16 … 01/04, then 09/06 … 12/20 |
| **F-B4** | MLB pitcher page, **game log** | Totals all zero, every start row blank. | Noah Cameron: 0 K, 0 BB, 0 H, 0 ER; 9 empty rows |
| **F-B5** | MLB game and team pages, **team stats** | Per-game stats rounded to integers, so different values display as equal. | KC vs BOS: R 4 / 4, H 8 / 8, BB 3 / 3 |
| **F-B6** | Soccer player page, **Season stats** | Raw floats rendered. | "xG 3.4237903356552124", "xA 0.6280249953269958" |
| **F-B7** | Soccer pages, **rank pools** | "Of 23" in a 20-team league; pools differ between cards. | Man United defence "16 of 23"; City "1st of 20" beside "2nd of 23" |
| **F-B8** | Soccer game page, **Records** | Draws shown as losses. | Newcastle 1W 2D 0L → "1-2 · .333" |
| **F-B9** *(suspected)* | Soccer team page, **Next game** | Moneylines likely on the wrong teams; no draw. | Man City "ML 800" at Sunderland "ML -340" |
| **F-B10** | CFB and NHL game pages, **final box score** | Stuck on "Loading live details…"; NHL logos blank. | Ohio State @ Texas final; TOR @ DET final |
| **F-B11** | NHL team page, **record** | OT losses dropped. | Toronto "32-36" |
| **F-B12** *(suspected)* | Tennis player page, **aces line vs history** | Line looks like total match aces vs the player's own. | Zverev O 24.5; 0 of 141 cleared |
| **F-B13** | Tennis game page, **Records** | Multi-season W-L labeled one season, inconsistent with its own win %. | Zverev 103-38; Shelton 73-37 beside 0.717 |
