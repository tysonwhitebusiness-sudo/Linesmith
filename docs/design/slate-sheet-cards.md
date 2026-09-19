# Slate Sheet — every card, per sport, from measured data

**Status (2026-09-19):** specification; nothing built. It follows the handoff
`docs/design/HANDOFF-ui-and-slate-2026-09-19.md` (§2) and, where the two disagree,
**this file wins**: every number here was measured on 2026-09-19 against the live
database, ESPN and the code, and six of the handoff's premises turned out wrong (§1).

**Operator decisions (2026-09-19):**
- All sports, built in phases.
- Keep Scan's full player table as the Props board.
- The §2c-5 Specials rankings are the pilot set.
- Build after U2 (the Hybrid `DataTable`), on the Untitled UI kit in
  `docs/design/ui-system-master-prompt.md`.
- Mockups: `docs/design/slate/slate.html` (every sport, real data; build with
  `tools/build_data.py` then `tools/build.py`).

**The honesty rules every card obeys:**
- Movement, price gaps and rankings are **not** edges.
- `Model %` and `IP` may sit side by side, but nothing computes, names, sorts by
  or colors their difference (decision 2026-09-06, `tests/scan-no-edge.test.ts`).
- A slot with no data is hidden or states why; it is never faked.

---

## 1. What the measurement changed

| handoff said | measured | consequence |
|---|---|---|
| Model card: MLB **and golf** | Golf's model layer was **deleted 2026-09-13** (Phase 8, decision 2); its prediction tables stop at 08-30/09-01 | Model card is **MLB only**. Golf shows no model anywhere |
| MLB props show "model probability **and edge**" | Standing decision: no edge column, anywhere | Props board shows `Model %` beside `IP`, never their difference. The Model card shows no "edge" column |
| "Since open" line moves | `odds_archive.open_line/open_price` are **null on every live row** (0 of 21,476 since 09-08) | Movers says **"since first seen"**: the first observation per book in `game_odds_history` (from 08-12 / 08-28) and `prop_odds_history` (from 09-04) |
| Weather **not held** | `venueWeather.ts` / MLB `getWeather`: an **area forecast** (wind mph, compass direction, rain %, temp) for outdoor MLB, NFL, CFB venues. Soccer has none (roof state unknown). Park orientation is not held | Games cards show a weather chip where outdoor. Never "wind blowing out": direction is a compass point, not relative to the field |
| Tennis "most aces": ace rate held | `player_game_history` tennis holds sets/games/won only. Serve stats live in the **TennisMyLife CSVs**, fetched by TS on demand, not stored; the ATP file lagged (ended 2026-08-30) | "Most aces" needs a Python job that fetches TML (the ranking job would own it) |
| NFL "first TD scorer" uses team first-score rate | Scoring order is **not held** (`player_game_history` is box scores; `nfl_target_events` is targets) | The First TD ranking drops that factor and says so |

Also measured, not in the handoff:
- **The props outage was ESPN, not cadence,** and it is fixed and deployed
  (`10a1647`, `8dab195`). It had also frozen game history, results and pick
  grading for NFL, CFB, EPL and MLS; all caught up from 2026-09-11.
- **NFL projections carry no probability** (`hasProbability=false`, decision 4.6).
  NHL's carry one on 4 of 5 markets (goals has none).
- **NFL, CFB and NHL still capture generic-Elo game picks** (`game_picks`, last 14
  days: NFL 17, CFB 141, NHL 7). Soccer's were stopped on 2026-09-13 because
  generic Elo was never gated, and the same is true of these. **Open question
  Q1 (§6).**

## 2. The page, every sport

**The Slate replaces Scan in place** (operator, 2026-09-19). It is not a new page:
`/{sport}` keeps the app's chrome exactly as it is today, and only the body
under the date strip changes.

```
┌ TopBar (TopBar.tsx, unchanged except the nav label) ──────────────────────────┐
│ [LS] Linesmith [MLB ▾]           Slate · Players · Teams      ⚙ 🎟 🔍 ⟳ Slip Sign in │
├ date strip (DateGameStrip / GolferStrip / TennisMatchStrip, unchanged) ───────┤
│ [Today] [Tomorrow] [📅] [‹]  [All] [DET@CWS 2:10] [MIL@BAL 4:05] …  ⏸          │
├───────────────────────────────────────────────────────────────────────────────┤
│ SectionNav (sticky): Games 15 · Movers · Props 3,127 · Spotlights · Specials ·  │
│                      Model · Your lines                                         │
│ sections in that order; a hidden section drops out of the nav too              │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **No second sport picker, no separate date control, no page title.** Sport and
  league/tour come from the TopBar's own selects; the date and the game scroller
  are the existing strip, which stays part of the top bar.
- The TopBar tab **"Scan" is renamed "Slate"**; Players and Teams (Schedule for
  golf and tennis) are unchanged.
- What Scan's body carried moves into sections: Today's Picks → Model; the Home
  Runs tab → Specials (HR rankings); Watchlist → Your lines; the Players/Games
  toggle is gone (Games is always a section); Scan's table → the Props board.

**Kit (U track), exactly:**
- SectionNav: our `Tabs` with `count`, as anchor links; sticky under the TopBar.
- Every section is a `Card` with `count` and, for tables, `flush`.
- Every table is the Hybrid `DataTable` (§3 of the UI spec): 36px rows, header
  band 34px `card-sunk`, sticky label column, `info` help icons, `streak`,
  `bar`, `tone`, `highlight`, `expand`, `groupBy`, `paging: minimal`.
- Filters: `ComboBox` (player/team search), `Select` (market, game), `Checkbox`.
- Identity: `AvatarLabel` (face 24 + name + "NYY vs BOS · 7:05"), team logos 18px.
- Status: `Chip` with `dot` (Live / Final / Upcoming), `Chip` tones for W/L.
- Empty / not-held states: `EmptyState` with `FeaturedIcon` `soft`, a reason and
  the nearest real data. Help text: our `Tooltip` (tap-open).
- Buttons: `Button` secondary `sm` in card headers; one primary per view at most
  ("Track line" in a row expand).

**Phones (400):** sections stack; SectionNav scrolls horizontally; Games is a
1-up list; tables scroll inside their card with the label column pinned; the
row expand opens in place.

**API:** `GET /api/slate?sport=&date=` via `cachedRoute()` (key
`slate:route:{sport}:{date}`; grep first). TTLs: games 60 s, lines and props
120 s, rankings once per slate (read from `slate_rankings`, §5).

## 3. The shared cards

Each sport's section in §4 names which of these it uses and what it fills them with.

### 3.1 Games — a grid of `GameCard`s

- Grid 3-up ≥1440, 2-up ≥1024, 1-up below. Sorted by start. Filter `SegmentedToggle`
  `sm`: All · Upcoming · Live · Final, each with its count.
- **GameCard anatomy** (a `Card`, not a table):
  1. Status row: `Chip dot` (Upcoming 7:05 PM · Live Top 6th · Final) + network if held.
  2. Two team rows: logo 24, name, record (`label` `ink-muted`), score when live/final,
     poll rank (CFB).
  3. Sport line (optional, per sport): MLB probable starters with ERA · K%.
  4. **Lines block** (3 columns: Spread · Total · Moneyline): consensus (median across
     books), best price with the book's name, a move arrow + "since first seen"
     amount, and "N books". Soccer: Home · Draw · Away · Total.
  5. **Model row (MLB only):** "Model: NYY 58% · 4.9–4.1 runs", `label`, a `Tooltip`
     saying what it is. No edge.
  6. Context chips: park factor (MLB), weather (area forecast, outdoor only),
     injuries count (links to the game page's injury table).
  7. Footer: `Button` link "Game page →" and "N props →" (filters the Props board).
- Empty: "No games on {date}" + the next date with games, as a `Button` secondary.

### 3.2 Movers — Hybrid table in a tabbed card

- Card header: title, count, `Tabs`: Game lines · Props; window `SegmentedToggle`:
  Since first seen · 3h · 1h.
- Columns: Subject (`AvatarLabel` or logo + team) · Market · Line (first → now) ·
  Price (first → now) · **Move** (implied-probability points; the sort key; `bar`) ·
  Books moved / quoting · First move (time) · Trend (price sparkline from `_history`).
- Flags (as `Chip`s in the Subject cell): **Steam** (3+ books moved the same way within
  30 min) and **Split** (line one way, price the other).
- Caption under the table: "Movement is market information, not a prediction."
- `paging: more` (Show 20 more). Hidden where no history exists (golf, §4.8).

### 3.3 Props board — Scan's table, kept, on the Hybrid kit

- **Two summary cards above it** (side by side ≥1024, stacked below):
  - **Price outliers:** one book ≥ 4 implied-prob points off the median of the others,
    same prop and line, **minimum 5 books quoting** (MLB has ~23,400 such lines today).
    **Gaps above 15 points are dropped as stale quotes** (measured: Kalshi at +9900
    against a −156 median on 2026-09-19).
    Columns: player · market · line · book · its price · median · gap. Caption:
    "A price gap between books, not a model edge."
  - **Line disagreements:** books split on the line itself (0.5 at one, 1.5 at the rest).
- **Main table** (Hybrid, `paging: minimal`, 25 rows). Market `Tabs` with counts from
  the sport's live markets. Filters: game `Select`, team `Select`, player `ComboBox`,
  min books, min L10.
- **Columns — Scan's, unchanged in meaning:** rank chip · Player (`AvatarLabel`) ·
  Market · Line · Odds (best over, book) · IP · **Model %** (where held) · DVP · **Proj**
  (where held) · Diff (proj − line) · Conf (Thin / Some / Deep) · L5 · L10 · L15 · H2H ·
  Strk (`streak`, last 5) · SZN.
  - A sport with no model shows no Model %, Proj, Diff or Conf column at all (not a
    column of dashes).
  - A market the model doesn't cover shows "—" with a `Tooltip`: "No model for this market."
- **Row expand:** last 10 games as bars against today's line (the player page's prop
  block, reused) + the full book ladder (every book's over and under at every line) +
  `Button` primary "Track line".

### 3.4 Spotlights — ranked tables, 5–10 rows

- One `Card` per spotlight, in a 2-up grid ≥1024. Each is a Hybrid table: rank ·
  player/team · **every factor as its own column** · a one-line "why" (`wrap`) ·
  link to the player page.
- Every sport: **Hit-rate leaders** (best L10 over-rate at today's line; minimum sample
  shown in a column) and **Active streaks** (5+ straight overs or unders vs today's line).
- Sport-specific spotlights are listed per sport in §4.

### 3.5 Specials — odds-free rankings for the books' common promos

- One `Card` per ranking, `Tabs` across them. Columns: rank · player (face, team,
  opponent) · **every factor as a column** (with `info` help saying the source) ·
  composite score (`bar`) · "why" (`wrap`).
- Caption: "A ranking of the factors, not a probability."
- **Receipts** under each ranking: yesterday's top 5 and what happened (`tone`
  good/bad chips), plus a running 7-day "top-5 hit" count.
- Weights documented, computed in Python into `slate_rankings` (§5). Pre-register
  the backtest before tuning (CURRENT.md's habit).

### 3.6 Model card — MLB only

- Today's model picks (`game_picks`, `pick_history`): pick · model % · price · IP ·
  calibration note (`model_calibration`: method and fit date). **No edge column.**
- Yesterday's graded picks (`tone` chips) and a 7- and 30-day record.
- Replaces `TodaysPicksModal`, deleted when it ships.

### 3.7 Your lines — signed in only

- Tracked lines, watchlist, slip legs, bets on today's slate. Live status
  (`useLiveGame`), best price now vs price when tracked, link to the bet page.
- Signed out: the section is hidden (not an empty card).

## 4. Per sport

Counts are 2026-09-19 unless dated. "Books" = distinct bookmakers quoting the
market. Football and soccer prop counts are the week before the outage
(09-08 → 09-15 21:00 UTC).

### 4.1 MLB — every section

**Games (15 today):** records and probable starters (StatsAPI, as the game page),
lines from **25 books** (`game_odds_book_lines`; `odds_archive` 29), model row from
`mlb_game_model_cache` (36 games computed in 2 days), park factor chip
(`park_factors` 2026, 34 venues, "Coors +18% runs"), weather (outdoor; domes
excluded by `DOME_VENUE_NAMES`), injuries (`injury_report`: 284 rows today).

**Movers:** both tabs. Game lines from `game_odds_history`; props from
`prop_odds_history` (7.9M rows since 09-04).

**Props board — 16 markets:**

| market | books | players | Model % / Proj |
|---|---|---|---|
| Total bases | 21 | 401 | yes |
| Hits | 19 | 401 | yes |
| Home runs | 19 | 401 | yes |
| RBIs | 17 | 401 | yes |
| Runs | 17 | 401 | yes |
| Pitcher strikeouts | 17 | 160 | yes |
| Pitcher outs | 16 | 159 | yes |
| Stolen bases | 16 | 398 | yes |
| Hits + runs + RBIs | 15 | 401 | yes |
| Pitcher hits allowed | 14 | 159 | yes |
| Earned runs | 14 | 160 | no |
| Doubles | 13 | 401 | no |
| Batter strikeouts | 13 | 498 | no ¹ |
| Singles | 11 | 401 | yes |
| Walks | 9 | 470 | no ¹ |
| Triples | 8 | 401 | no |

¹ R6-F8: ParlayAPI files some **pitchers'** strikeouts under `batter-strikeouts` and
walks allowed under `walks`. Until the writer is fixed, those two tabs can show
pitchers; the board labels the row by the subject's role.

Model: `prop_model_cache` 12 dimensions, 206 games, refreshed hourly; 14 active
Platt calibrations. `pitcher-walks-allowed` has a model and no market of its own.

**Spotlights:** Hit-rate leaders · Active streaks · **Platoon spots** (batter's split
vs today's starter's hand: `mlb_statcast_player_season.payload.splitsByHand`, 657
batters) · **Pitcher K spots** (K%, whiff % by pitch type from `pitchTypes`, vs the
opponent's K% against that hand; the team split is **derivable** from the pitch
corpus, so the ranking job computes it) · **HR-friendly parks today**
(`park_factors` × `team_hr_rate_allowed` 2026 × weather temp/wind speed).

**Specials:**

| ranking | factors (source) |
|---|---|
| **Longest HR of the day** | season avg and max HR distance (`hrList[].distance`, confirmed; 526 of 657 batters have ≥1 HR) · max EV and launch angle (`hrList`, `maxEV`) · barrel-ish percentile (`percentiles.barrelish`) · park factor · starter's HR allowed (pitcher `hrList` length, HR/9 from `player_game_history`) · batter hand vs starter hand · temp and wind speed (area forecast) |
| **HR of the day / first HR** | HR per PA (`player_game_history`) · starter HR/9 · `team_hr_rate_allowed` · park · platoon split. Lineup spot **not held** |
| **Most strikeouts** (pitchers) | K% · avg outs · opponent K% vs hand · `prop_model_cache` K projection |
| **Most hits / total bases** | L10 and season rate · platoon · park |

Receipts: `player_game_history` has every batter's box score by the next morning.

**Model card:** yes. `game_picks` 200 in the last 14 days; `pick_history` 282 surfaced
in the last 7 days.

### 4.2 NFL — no Model card

**Games (16 in week 3; 32 in the 14-day window):** records, kickoff, lines from
**21 books** (`odds_archive`), weather on outdoor venues (11 of 16), injuries (806
rows today). No model row.

**Movers:** both tabs (props history resumed 2026-09-19 after the outage).

**Props board — 18 markets (pre-outage week):**

| market | books | players | Proj (no Model %) |
|---|---|---|---|
| Receptions | 17 | 229 | yes |
| Receiving yards | 13 | 120 | yes |
| Rushing yards | 12 | 96 | yes |
| Passing yards | 12 | 34 | — |
| Longest reception | 12 | 103 | — |
| Longest rush | 10 | 39 | — |
| Kicking points | 9 | 17 | — |
| Pass attempts | 8 | 31 | — |
| Longest completion | 8 | 13 | — |
| Anytime TD | 5 | 118 | yes |
| Sacks | 5 | 169 | — |
| Passing TDs | 4 | 20 | — |
| Tackles + assists ² | 3 / 1 | 163 / 98 | — |
| First TD scorer | 2 | 86 | — |
| Rush + rec TDs | 1 | 37 | — |
| FG made · INTs thrown | 1 | 6 · 4 | — |

² `assists` in NFL is tackle assists. Markets quoted by 1–2 books still show; the
Books column says so and the outlier card ignores them (min 5).

Proj/Diff/Conf columns show; **Model % does not exist for NFL** (decision 4.6), so
the column is absent.

**Spotlights:** Hit-rate leaders (L10 reaches into 2025: the column header says
"last 10 games" and the sample note says how many are 2026) · Active streaks ·
**Target share vs weak pass defenses** (`team_target_profile` 2026, defense by
WR/TE/RB) · **Rushers vs the worst run defenses** (`team_game_production` RB allowed).

**Specials:**

| ranking | factors |
|---|---|
| **Pick-3 anytime TD** | TDs per game and share of team TDs (`player_game_history`) · team implied points (spread + total, `odds_archive`) · opponent TDs allowed to the position group (`team_game_production`) · `prop_model_cache` anytime-TD projection. Red-zone role **not held** |
| **Longest reception / TD** | deep-target share and air yards (`nfl_target_events`, 2026 through week 2) · longest-reception history (`receiving.longReception`) |
| **First TD scorer** | share of team TDs × team implied points. Team first-score rate **not held** (no scoring order) |

**Model card:** hidden (projections only; see Q1 for the Elo picks).

### 4.3 CFB — no Model card; thin lines

**Games (60+ on a Saturday; 201 in the window):** poll rank chip, records, weather
(outdoor), lines **thin**: `odds_archive` 9 books on 133 games, and today
`game_odds_book_lines` 5 games from 2 books (the parked SharpAPI 429 issue). A game
with no lines shows "No lines yet" in the lines block, not zeros. Injuries: **3 rows**
today, so the chip is hidden for CFB and the card says injuries are not tracked.

**Movers:** Game lines only where ≥2 observations exist; Props tab.

**Props board — 13 markets:** receptions 15 books · receiving yards 9 · passing yards 8 ·
rushing yards 7 · longest reception 7 · anytime TD 5 · longest completion 2 · first TD 2 ·
kicking points, rush+rec TDs, longest rush, sacks, passing TDs 1 each. No model columns.

**Spotlights:** Hit-rate leaders · Active streaks · **Rushers vs the worst run
defenses**. CFB's `team_game_production` holds only the `all` position group, so
defense is by team, not by position; the card says so. No target data for CFB.

**Specials:** Pick-3 anytime TD (team-level defense only) · Longest reception
(`receiving.longReception` history only; no air yards).

### 4.4 NBA — preseason from 2026-10-03; everything reads last season until then

**Now:** the page opens on an `EmptyState`: "The NBA season starts Oct 3 (preseason)"
with the preseason schedule (`fetchSeasonStatus` now reads the league calendar).

**Games (from Oct):** records, lines, injuries (75 rows today), "pace-up" chip (pace
**derivable** from `team_game_production`: FGA, FTA, OREB, TOV).

**Props board — markets expected, unmeasured live until October** (from last
season's priced set): points · rebounds · points+rebounds · points+rebounds+assists ·
3-pointers · assists · points+assists · steals · blocks. No model (Phase 7 measured NO).
Known gap: `athlete_name` is NULL on NBA prop rows (the id joins; names come from rosters).

**Spotlights:** Hit-rate leaders · Active streaks · **Pace-up games** · **Usage bumps**
(`injury_report` + `player_season_production.team_share`) · **Shot-zone matchups**
(`team_shot_profile` allowed by G/F/C, 2026).

**Specials:** Most points · Most 3s · Triple-double watch (usage, minutes, pace,
opponent defense, injury-driven usage).

### 4.5 NHL — preseason started today; props none yet

**Games (7 preseason today):** lines 5–6 books (`game_odds_book_lines`), injuries (51).
Starting goalie **not held** (the card says "Goalies not confirmed").

**Props board:** no NHL props have arrived yet (preseason). Model: `prop_model_cache`
5 markets (goals, assists, points, shots on goal, hits), last computed 09-06, with
**Model % on 4** (goals projection only). Temperature calibrations active.

**Spotlights:** Hit-rate leaders · Active streaks · **Shot volume vs the most
shots allowed** (`team_shot_profile` for/allowed, 2025-26; `nhl_shot_events` 154k).

**Specials:** Anytime goal scorer · Most shots (shots per game, shooting %, opponent
shots allowed).

**Model card:** hidden until Q1 is answered (projections show in the Props board).

### 4.6 Soccer (EPL, MLS) — no Model card, no weather, no injuries

**Games (EPL 5 today; MLS 29 in the window):** 3-way moneyline + total from
**21–22 books**; records; **no weather** (roof state unknown); **no injury chip**
(`injury_report` holds no soccer rows).

**Props board:**

| market | EPL books | MLS books |
|---|---|---|
| Anytime goalscorer | 13 | 11 |
| Two+ goals | 8 | 8 |
| First goalscorer | 6 | 4 |
| Assists | 5 | 4 |
| Shots | 2 | 2 |
| Goals | 2 | 1 |
| Saves | 2 | 1 |

**Side markets tab** (built only once mapped): correct score, goal-or-assist, both
teams to score, double chance, player shots, total corners, draw no bet — all arrive
from `propline_2` and are dropped at `odds_unresolved` today (§2b of the handoff).
Mapping belongs in `entity_resolution.py` + both alias maps.

**Spotlights:** Hit-rate leaders · Active streaks · **Shots leaders vs weak defenses**
(`team_game_production` DEF/MID/FWD allowed). xG: EPL only, via Understat, fetched
by TS on the player page and **not stored**, so it is absent here unless the ranking
job fetches it.

**Specials:** Anytime / first goalscorer (shots and shots on target per 90, goals,
opponent goals allowed). Penalty taker and lineups **not held**.

### 4.7 Tennis (ATP, WTA) — matches, no model

**Games = matches** (ATP 62 in the window): players (flag, ranking), round, surface,
moneyline from **4 books**. No weather, no injuries.

**Props board — 3 markets, SharpAPI only:** to win a set (2 books, 209 matches) ·
games won (1 book, 107) · aces (2 books, 54). The outlier card is hidden (never 5
books). L10 for **aces cannot be computed** from `player_game_history` (no serve
stats): that cell reads "not held" until the TML job exists.

**Spotlights:** Form (last 10 match wins) · Surface record (TML) · Serve vs return
(TML; lags, the card shows the archive's last date).

**Specials:** Most aces of the day (ace rate, opponent return, surface) — **blocked
on the TML fetch job** (§5).

### 4.8 Golf — a tournament, not games

**Games becomes Leaderboard (Biltmore Championship Asheville, R3 today, 132
players):** position, player, today, thru, total, R1–R4 (`golf_round_scores`,
`golf_hole_scores`), plus the round's weather (`wind_mph`, `temp_f`, `precip_prob`,
stored per round). `DataTable` `density="compact"` + `highlight` on tracked players.
**Winner lines:** SharpAPI via `lib/odds/golfLines.ts` (`/api/golf/lines`), best price
and book.

**Hidden:** Movers (winner prices are cached, not stored as history), Props board (no
golf props arrive), Model card (deleted).

**Spotlights:** Round movers (biggest climb today) · Scoring by par type (field) ·
Course history — **only 3 events** in `golf_tournament_results` (the playoff events),
so course history is not held yet and the card says so.

**Specials:** Round leader / low round (round scoring average, today's position).
Strokes gained is **not held** (it needs a field-average per round; derivable, not
built).

## 5. Data work the Slate needs (Python writes)

| item | owner | blocks |
|---|---|---|
| `slate_rankings` table + ranking job (Spotlights, Specials, receipts) | new Python job, `JOB_REGISTRY`, `docs/table-ownership.md` row | S3, S4 |
| Team K% vs hand (MLB) from the pitch corpus | ranking job | Pitcher K spots, Most strikeouts |
| TennisMyLife serve stats fetched and stored | ranking job or a small ingest | tennis aces L10, Most aces |
| Understat xG for EPL (optional) | ranking job | soccer xG column |
| Soccer side-market mapping | `entity_resolution.py` + both alias maps | soccer side-markets tab |
| CFB line coverage (SharpAPI 429 rotation) | parked item in CURRENT.md | CFB lines block |
| R6-F8 pitcher markets misfiled | market mapping in the Python writer | MLB batter-strikeouts / walks tabs |
| `injury_report` for soccer and tennis | `injurySnapshotJob` | injury chips there |

## 6. Open questions for the operator

1. **Generic-Elo game picks for NFL, CFB and NHL** are still captured though never
   gated — the reason soccer's were stopped. Stop them too (recommended), or show them?
   Until answered, the Slate shows none of them.
2. The **Specials receipts** grade "top 5 by the ranking" against what happened. Is
   top-5 the right unit, or top-3 to match "pick 3" promos?
