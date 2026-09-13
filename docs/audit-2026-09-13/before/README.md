# Before — baseline for the build plan

Captured **Sunday 2026-09-13, ~19:10–19:16Z**, on the local dev server, not
signed in. The console's 401s on `/api/picks` and `/api/watchlist` come from not
being signed in; they don't affect any card here.

Each file is named for the build-plan item it baselines.

## 1a — WTA tour shows men (reproduces)

`1a-tennis-player-lists.txt`: `/api/tennis/wta` lists **Alexander Zverev** and
**Ben Shelton** among its 50 players. `/api/tennis/atp` lists only those same
two. The slate screenshot is alphabetical, so the men sit below the fold; the
text file is the evidence.

## 1b — team header line (reproduces, and worse than the audit recorded)

The rendered header text for each sport:

| sport | page | header text | faults |
|---|---|---|---|
| MLB | `/mlb/team/133` | `60-89 · 4 in division` | no ordinal: "4", not "4th in AL West" |
| NFL | `/nfl/team/2` | `0-0 · 1st in division` | none visible (Bills yet to play at capture time) |
| NBA | `/nba/team/1` | `0-0 · 0th seed, Eastern Conference in division` | `0th`; suffix contradicts the phrase; offseason shows 0-0 with no season label |
| NHL | `/nhl/team/21` | `55-16 · Western in division` | **last season's** record with no label saying so; conference passed as a division |
| CFB | `/cfb/team/2005` | `1-0 · 0th in Mountain West Conference in division` | `0th`; doubled "in … in division" |
| Soccer EPL | `/soccer/epl/team/349` | `0-1 · 15th, 3 pts in division` | **new:** the record drops draws, so `0-1` sits beside `3 pts`, which is impossible. Soccer needs W-D-L |

Only NFL's header reads correctly. NBA shows the current season (0-0) and NHL
shows last season (55-16) during the same offseason; the header should say
which season it is showing.

## 1c — spelling (reproduces)

In `5a-1c-nfl-player-matchup.jpg`, the same page reads `NYG defense` in the
matchup card and `OPPOSING DEFENCE` / `NYG defence` in the opponent card.

## 1d — NFL dead game link (does NOT reproduce at capture time; cause confirmed)

`/api/nfl/game/401872657` still returns `No NFL game with id 401872657`, but
the strip no longer lists that id. The strip currently holds 45 games,
2026-09-13 → 09-28.

Cause, confirmed in code: the game route calls `fetchScoreboard('football','nfl')`
with the default `daysBack = 0` (`teamSportEspn.ts:85`), so **any game dated
before today UTC 404s**. That breaks the strip's links around UTC midnight and
any link to a past game. The fix in the plan stands. Verify it with a past id
like `401872657`, not by waiting for the strip.

## 2 — CFB player page blank (reproduces)

`2-cfb-player-blank.png`: `/cfb/player/espn:football:5148651` renders only
"No tracked markets for this player on today's slate."

## 3 — tennis surface (reproduces)

`3-tennis-wta-player-no-surface.jpg`: `/tennis/wta/player/espn:tennis:5309`
(Alycia Parks) has a SURFACE split (Hard/Clay) from past matches, and nothing
about **today's** surface.

## 5a — matchup "biggest edge" (reproduces)

Same page as 1c: *"Biggest edge: Pass Yds Allowed/Gm — NYG defense ranks in the
48th percentile allowing it."*

## 5b — soccer default market (reproduces, one new detail)

`5b-soccer-rightback-default-market.png`: Adam Smith (right-back) opens on
**ANYTIME GOALSCORER**, `1.9% SZN 5/259`, `259 games in scope`.

**New detail:** this default is a **real priced line** (Propline, +1175), not
a synthetic candidate. The position-aware ordering must therefore apply
wherever soccer candidates are built, both the snapshot's priced candidates
and the synthetic fallback, or it will only fix players with no lines.
