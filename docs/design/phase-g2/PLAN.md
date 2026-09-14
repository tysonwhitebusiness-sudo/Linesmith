# Phase G2 — sport-switchable mockups (build plan)

**Operator request, 2026-09-14:** rebuild the mockups so each page (player, team,
game) can switch between sports, because the goal is that every card makes sense
for its sport. As detailed as possible; something to build from. Supersedes the
single-sport boards in `docs/design/phase-g/` (kept as history).

## Standing rules (don't reopen)

- Research pages first; odds are one section, **except the prop analysis block is
  kept near the top of the player page**: market tabs, line stepper with price,
  window chips (vs opp / L5 / L10 / L15 / Season), hit-rate tiles, bars vs line.
- F2 system (type ramp, charcoal, contrast floor, card anatomy), two-tier
  interaction (baseline hover/links/scope/focus everywhere; drill-downs and
  compare where they add insight).
- **Real data only.** Where data isn't available the card shows its data status
  (held / derivable / dropped at ingest / not held), never an invented value.
- Charts render at real pixel width; tooltips on every mark; keyboard reachable.

## Architecture

```
docs/design/phase-g2/
  build.mjs                 inlines system + kit + sport modules + data into each page
  src/system.css            F2 tokens (from phase-g, extended)
  src/kit.js                shared components + charts (from phase-g ui.js, extended)
  src/viz-sport.js          sport-native surfaces: MLB zone, NFL half-field, NBA half-court,
                            NHL rink, soccer pitch, tennis surface grid, golf hole/lie views
  src/sports/<sport>.js     one module per sport: player(data), team(data), game(data)
                            returning that sport's sections and cards
  src/player.html · team.html · game.html   page shells: sport switcher, subject switcher,
                            layout option, typeface/elevation
  data/<surface>-<sport>-<slug>.json        real data snapshots (source recorded inside)
  tools/build_data.py       pulls every dataset (DB, corpus, app API, ESPN, MLB, NHL APIs)
```

## Coverage

| sport | player subjects | team | game |
|---|---|---|---|
| MLB | hitter (Witt Jr.), starting pitcher | Royals | KC @ BOS (final) |
| NFL | WR, QB | Raiders | DAL @ NYG (final, drives + win probability) |
| CFB | QB | Ohio State | Ohio State @ Texas (final) |
| NBA | guard, big | Lakers | last-season game |
| NHL | skater, goalie | Maple Leafs | last-season game (shot map) |
| Soccer | forward, goalkeeper | Man City | MCI @ MUN (final) |
| Tennis | ATP player | n/a (no team concept, shown as such) | Shelton v Zverev |
| Golf | player (recent events) | n/a | n/a (tournament view out of scope) |

## Order (commit after each)

1. Data builder + datasets for the **player** page, all sports.
2. Kit + sport-native visuals + player page shell + sport modules; render-check every
   sport at 1440 and 400px.
3. **Game** page: datasets + modules + checks.
4. **Team** page: datasets + modules + checks.
5. Update `G-ideas.md` picks, send boards, stop.

## Status

**COMPLETE 2026-09-14.** - [x] 1 player data · [x] 2 player page · [x] 3 game page · [x] 4 team page · [x] 5 wrap-up

Open `player.html`, `game.html` or `team.html` directly (`?sport=` deep-links). Rebuild pages with
`node docs/design/phase-g2/build.mjs`. Refresh data from the repo root with the venv Python:
`tools/build_player_data.py`, `tools/build_game_data.py`, `tools/build_team_data.py` (each takes slugs;
the player and team builders read the Statcast corpus and take a few minutes; the team builder fetches every
team's ESPN statistics to compute ranks). The consolidated data findings are in
`docs/audit-2026-09-13/design-audit/G-ideas.md` → "Data findings made while building G2".

Steps 3–4 as built: `src/sports/common-game.js` + `game-football.js`, `game-hoops-hockey.js`, `game-mlb.js`,
`game-soccer-tennis.js`; `src/sports/team-common.js` + `team-sports.js`. Verified: 56 renders (all pages ×
all sports × 1440/400px) with no page errors, console errors, overflow or placeholder text.

Step 2 as built: `player.html` (open directly; `?sport=&subject=` deep-links). Modules actually landed as
`src/kit2.js` (page blocks incl. the kept prop block), `src/sports/common.js` (page composer),
`mlb.js`, `football.js` (NFL+CFB), `hoops-hockey.js` (NBA+NHL), `soccer-tennis-golf.js`.
Checked: 13 subjects × 1440/400px — no page errors, no NaN/undefined text, no horizontal overflow.

Data findings while building (for the Phase H data plan):
- `nba_shot_events.y_coord` has the rim at ≈1 ft, not 5.25 (fitted: 99.8% of makes classify to their
  stored point value with that origin). Every **miss** is stored with `point_value` 2, so missed threes
  are indistinguishable without geometry. The mockup derives miss value from the arc.
- Understat match list comes back newest-first; anything taking "last N" must sort by date.
- TennisMyLife `tourney_date` is the tournament start, so every match in an event shares a date.
- Golf `golf_*` events carry no names in the tables; lie codes in shot events are not decoded.
