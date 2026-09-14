# Phase G — New ideas and mockups

**Status: COMPLETE 2026-09-14, including Phase G2 (sport-switchable mockups). Waiting for
operator picks.** Nothing in the app has changed.

## Phase G2 boards — use these to judge every card per sport

Three pages in `docs/design/phase-g2/`, each with a sport switcher, all on real data. Open
the HTML files directly. Rebuild with `node docs/design/phase-g2/build.mjs`; refresh data
with the three builders in `docs/design/phase-g2/tools/` (see `PLAN.md`). Every page renders
without errors, console errors, overflow or placeholder text at 1440px and 400px (56 renders,
verified 2026-09-14).

| page | sports × subjects | what each sport gets beyond the shared skeleton |
|---|---|---|
| `player.html` | MLB hitter + pitcher · NFL WR + QB · CFB QB · NBA guard + big · NHL skater + goalie · soccer FW + GK · tennis · golf | **Kept prop block** on every sport, then seasons, trends, splits, game log. MLB: Statcast contact profile, EV distribution and by game, pitch types, zone map, vs LHP/RHP, every HR; pitcher arsenal and locations. NFL: target/pass chart and depth by season. NBA: shot chart by zone. NHL: rink map, official totals. Soccer: Understat shot map, goals vs xG, per 90. Tennis: surface splits, serve/return trend, ranking. Golf: rounds, scoring by par, driving, approach proximity, putting by distance |
| `game.html` | KC @ BOS · DAL @ NYG · OSU @ TEX · OKC @ LAL · FLA @ TOR · MCI @ MUN · Paul v Zverev | NFL/CFB: win probability with biggest swings, **drive chart** + selected-drive field model, scoring, situational team stats. NBA: win probability, lead tracker, scoring runs, two-team shot chart. NHL: shot-attempt flow (no WP is published), full-rink shot map, goaltending, penalties. MLB: WP by plate appearance, **spray chart with distance**, at-bat explorer with every pitch located, pitch mix per pitcher. Soccer: timeline, shot map, formations, commentary. Tennis: serve/return comparison, head-to-head, form vs season averages. All: lines open → close, stored pre-game movement, **player props vs results** |
| `team.html` | Royals · Raiders · Ohio State · Lakers · Maple Leafs · Man City (tennis and golf explain why there's no team page) | One season switch scopes the page and opens on last season when the current one is too young. Results and splits, standings, **league ranks computed across every team** with a dot strip, roster production. MLB: team Statcast percentiles. NFL: target share and throw map vs league. CFB: ranked opponents. NBA: shot profile vs league. NHL: shot map for/against |

The G2 pages use the sectioned layout (A) with a sticky section nav. Picks G3 and G5 below
still stand if you want the dashboard variant.

Whether every card is buildable from what the app has is checked card by card in
`docs/design/phase-g2/BUILDABILITY.md` (2026-09-14).

## Data findings made while building G2 (to Phase H)

These came from reading the stored data closely enough to draw it. Each one would put a
wrong number on a page if the app read the data the way the mockups first did.

- **`mlb_pitch_events` is a hot window (5 days on 2026-09-14).** Season-long pitch cards need a
  Python rollup over the Parquet corpus; no TypeScript route can read the corpus.
- **Player prop lines.** `prop_odds` files alternate ladders under the main market key (one
  provider stored 14.5–144.5 under a QB's passing yards), keeps capturing for up to two days
  after a game has finished, and stores pick'em payouts (+100) as if they were prices. "The latest row" is
  not the line. The mockups use: last pre-game quote per book and line, the **main line is
  the one quoted on both sides by the most books**, pick'em never counts as a price, and a
  market with only one-sided quotes is labelled "alternate lines only" instead of shown.
- **Game line history.** `game_odds_history` keeps storing quotes after the start, 1,790 of
  2,782 rows for KC @ BOS. Soccer moneylines store home and away but not the draw, so the
  vig can't be removed.
- **NBA shot coordinates.** In `nba_shot_events` (and the ESPN feed) the rim sits at y ≈ 1 ft,
  not 5.25 (99.8% of makes classify to their stored point value with that origin). Every
  **miss is stored with point value 2**, so a missed three is indistinguishable without the
  arc.
- **Seasons in `player_game_history` follow each upstream's convention** (NBA end year, NHL/NFL/CFB/EPL
  start year — documented in `backfill_player_game_history.py`). Not a bug, but every page mapping a
  season has to follow it. Stray team ids appear for All-Star-type events.
- **NBA and NHL shot tables hold 2024-25 only,** while game logs reach 2025-26.
- **MLB innings pitched is stored as whole.thirds per game** (6.2); summing it gives wrong
  season innings. Carry outs.
- **ESPN's published team ranks are unusable:** ranks exceed the number of teams (MLB
  total bases 122nd) and carry no better/worse direction. CFB red-zone % is 0 for every team
  and CFB possession time is about half a game per game. The mockups compute ranks across
  every team with a declared direction, per game for football.
- **The Statcast corpus has no team column.** Joining pitches to teams through
  `player_game_history` matched 79% of 2026 pitches.
- **Sources carry more than the app reads:** the MLB live feed has distance, exit velocity and
  launch angle for every batted ball and every pitch location. ESPN NBA summaries have per-play
  win probability and shot coordinates. NHL has neither in ESPN, but the NHL API has shot
  coordinates. ESPN soccer commentary has pitch positions for the match's shots.
- Smaller: the Understat match list comes newest-first; TennisMyLife dates are the
  tournament start; golf lie codes aren't decoded; ESPN's soccer
  team schedule returns only played fixtures unless asked for fixtures.

Everything here follows three settled rules:
- **Pages are in-depth research pages;** odds are one section (operator, 2026-09-14).
- **Drawn in the F2 system** (`F2-visual-system.md`).
- **Two-tier interaction:** a baseline on every card, drill-downs and compare mode
  where they add insight.

---

## Operator decision after review, 2026-09-14: keep the prop analysis block

The boards folded the current player page's **prop analysis block** into a
collapsed odds section. The operator wants it kept, as the one part of the
current design to preserve:

- market tabs (Rushing yards · Rushing TDs · Receiving yards…)
- line stepper with the current price and its age
- window chips: vs opponent · Last 5 · Last 10 · Last 15 · Season
- hit-rate tiles per window (with average and sample)
- the bar chart of each game against the line, green when cleared

It stays on the player page as its own section near the top, alongside the new
research depth, not inside the collapsed odds section. What still applies to it
from Phase F and F2 is only presentation: label the season behind "12 games in
scope" (the bars are all 2025 week labels), hide a tile with no sample (L15 "–"),
open on recent games, and the F2 type and contrast rules. Its behavior and
content stay as they are. Phase H treats it as **keep**.

## The boards

Five self-contained HTML boards in `docs/design/phase-g/`. Open any of them
directly in a browser. They're built from `src/` by `node docs/design/phase-g/build.mjs`.
Every board has the **typeface and elevation switches** in its top bar, and the
choice carries across boards. **All data is real**; where data isn't available
the board says so rather than inventing it.

| board | what it shows | real data | options |
|---|---|---|---|
| `g0-system.html` | Type ramp; today's card beside the proposed one; text contrast measured live; color rules; elevation; every component; loading/empty/error states; live-value motion; a drill-down panel | Witt pitch types; Tucker 2025 ranks and game log | typeface ×4, elevation ×2 |
| `g1-player-mlb.html` | **Player research page**: identity and season line; section nav; one scope control per section; power profile (league percentiles); exit-velocity distribution; exit velocity by game (hover, click to drill down); results by pitch type (sortable, row drill-down); full-season strike zone; every home run; **compare mode** against another power hitter; odds collapsed at the bottom | Bobby Witt Jr., 2026 Statcast corpus (390 balls in play, 18 HR, percentiles among 331 qualified hitters) | A sectioned · B dashboard |
| `g2-game-nfl-live.html` | **Live game page, inspired by ESPN's** (operator reference): one live header with win probability; **field graphic of the drive** (hover each play's arc); **win probability for every play** (hover reads the play; click jumps the field to that drive); drive list; plays on the drive; leaders; tabs instead of a wall | DAL @ NYG at halftime: 91 plays, 9 drives, 92 win-probability points from the ESPN feed the app already calls | A stacked · B split |
| `g3-team-nfl.html` | **Team research page**: record and next game; results by season with scores (click a game); point margin by game; team stats as ranked percentile bars; unit grades; roster grouped by unit with photos and links | Las Vegas Raiders: team API (2025 stats, grades, 79-man roster) and `game_result` (52 games, 2023–2026) | A sectioned · B dashboard |
| `g4-slate-longest-hr.html` | **Slate research view, built from the operator's own question**: "who hits the longest home run today". Peak-power leaderboard, peak power vs home-run launch angle, and exactly which inputs are held, dropped or missing | Top 20 hitters by 90th-percentile exit velocity, 2026 | — |

Every board renders without errors at 1440px and at 400px phone width (verified
2026-09-14).

## Picks needed from the operator

| # | pick | options |
|---|---|---|
| G1 | **Typeface** | System · Inter · IBM Plex Sans · Source Sans 3 (bar switch) |
| G2 | **Elevation** | Cards raised · Flat with borders |
| G3 | **Player page layout** | A sectioned (long page, sticky section nav) · B dashboard (two columns) |
| G4 | **Live game layout** | A stacked (field full width) · B split (field and drives left, win probability right) |
| G5 | **Team page layout** | A sectioned · B dashboard |
| G6 | **Slate research views as a product surface** | Yes: a "Research" area with views like longest home run, anytime TD, NBA pace · No: keep research on player, team and game pages |
| G7 | **Which ideas below go into the build** | per sport, per row, or "all held and derivable first" |

---

## Refinements to F2 found while building

- **Big standalone numbers use proportional figures;** aligned (tabular) digits only
  in columns (dataviz reference). F2 said tabular everywhere.
- **Scope controls sit in one row above the section they scope,** not inside each
  card; each card states its scope in its header. F2 put a picker in every card
  header.
- **Charts render at their real pixel width,** not a scaled `viewBox`. Scaling
  shrank 10px ticks to ~7px in a half-width column. Fixed in the mockup kit;
  the app's `components/charts/` should follow the same rule.
- **Compare-mode colors** `#2f6fb3` / `#c56a1c` pass the palette validator (worst
  colorblind separation ΔE 22.2, contrast ≥ 3:1).
- **Silhouette-on-team-color fallback** for missing photos confirmed working.

## Data findings made while building (to Phase H)

- **Correction to F-B2's cause.** The NFL home/away records totaling 13 games aren't
  preseason games. `game_result` holds **the same game from two sources**: 69 rows
  for 52 Raiders games since 2023. **3 of the 17 duplicates are dated a day
  apart**, all evening kickoffs: one source stores the UTC date, the other the
  local date, the same class of bug as the NFL game-page fix (`cf022f5`). Any read
  of `game_result` must de-duplicate on score and home/away within a day, or the
  sources must agree on dates at ingest.
- **The ESPN summary feed carries per-play win probability and full drive data**
  (`winprobability`, `drives.previous/current` with yard lines, down and distance);
  `footballLiveGame.ts` reads neither. Verified in G2: the NBA summary carries both
  win probability and shot coordinates; NHL carries neither, but the NHL API has shot
  coordinates.

---

## Ideas by sport

**Data status:** **Held** = in our database or corpus · **Derivable** = computable from
held data · **Dropped** = the source we already call sends it, our parser
discards it · **Not held** = no current source · **Verify** = likely in a source
we call, unconfirmed.

### MLB

| surface | idea | what it tells you | status | replaces |
|---|---|---|---|---|
| Player | Power profile: max and 90th-pct exit velocity, hard-hit %, barrel-style rates as league percentiles | real peak power, not averages | Held | "Where this sits" |
| Player | Exit velocity by game with a rolling average | form in contact quality, ahead of results | Held | Rolling form |
| Player | Results by pitch type, full season | how he handles what today's starter throws | Held | Pitch mix seen (33 pitches) |
| Player | Full-season zone map with the opposing starter's locations overlaid | where the matchup is won | Held | Strike zone (7 balls in play) |
| Player | Batter vs this pitcher (PA, H, HR, K, xwOBA) | the real head to head | Derivable (pitch events) | Head to head vs team |
| Player | Home run list with distance and spray direction | how far and where he hits them | **Dropped** (distance, spray) | — |
| Player | Bat speed and swing length trend | swing changes before results show | **Dropped** | — |
| Pitcher | Arsenal: usage, velocity, results by pitch, splits by batter hand | what he'll throw and how it plays | Held (spin/movement **Dropped**) | empty pitcher page |
| Team | Lineup vs opposing staff; bullpen usage and fatigue | how the game will be pitched | Held / Derivable | Team stat comparison, Rankings |
| Game | Park factor and weather impact on carry | runs and home runs environment | Held (park factor); wind vs field **Not held** | Conditions |
| Game | Confirmed lineups with handedness | who actually plays | **Not held** | — |
| Live | Pitch-by-pitch strip: velocity, location, last batted ball's exit velo | the at-bat as it happens | Verify (live feed) | — |

### NFL

| surface | idea | what it tells you | status | replaces |
|---|---|---|---|---|
| Player | Targets, target share, catch rate, yards per target over time | opportunity, which predicts yardage | Held (targets); share Derivable | bar chart of yards only |
| Player | Air yards, YAC and depth profile on a half-field | how he's used | Held (`nfl_target_events`) | Target map (strike-zone grid) |
| Player | EPA per target / per dropback; success rate | efficiency | **Dropped** (play-by-play) | — |
| Player | Snap share, routes run | role and workload | **Not held** | — |
| Player | Red-zone targets and carries | touchdown opportunity | **Dropped** (play-by-play) | — |
| Team | Unit vs unit matchup with EPA, success rate, pressure rate | where the game will be decided | Held (team EPA/CPOE) / partly Dropped | Matchup, Team stat comparison, Rankings, Unit grades |
| Team | Results by season with scores; ATS and over/under as one view | true form | Held (after de-duplication) | win bars, Form, Last 15, Recent results |
| Game | **Field graphic of the drive; win probability per play** | the live game at a glance | Fetched, **Dropped** | live panel wall |
| Game | Injuries: only players with a status, starters first, props affected | who's missing | Held | whole-roster injury list |
| Game | Weather impact (outdoor only) | wind and cold effect | Held | — |

### CFB

| surface | idea | status |
|---|---|---|
| Player | A real player page every day: season and career lines, game log, splits | Held (52 keys, 21k players) — today blank |
| Team | Conference standings and record; AP/CFP rank | Verify (ESPN scoreboard rank fields) |
| Team / Game | Team efficiency (PPA/EPA-style), strength of schedule | **Not held** (CFBD publishes; not ingested) |
| Game | NFL's unit matchup, box score and drive/win-probability live view | Verify (same ESPN summary shape) |

### NBA (offseason; design now, render-verify in October)

| surface | idea | status |
|---|---|---|
| Player | Minutes, usage-style share, points/rebounds/assists per 36 and trend | Held (box); shares Derivable |
| Player | Shot chart with zone efficiency | Held for 2024-25 only (`nba_shot_events`) |
| Team | Pace, offensive/defensive/net rating, eFG%, TOV%, rebound% | Derivable from held box scores |
| Team / Game | Rest days and back-to-backs | Derivable (`game_result` dates) |
| Game | Pace matchup and projected possessions; injuries weighted by minutes | Derivable / Held |
| Player | On/off, lineup data | **Not held** |
| Live | Game flow (lead over time), runs, win probability | Verify (ESPN summary) |

### NHL (offseason)

| surface | idea | status |
|---|---|---|
| Player | Time on ice trend (all / PP / SH), shots and shooting % | TOI Held; PP/SH splits not parsed |
| Player | Shot map with danger zones | Held for 2024-25 (`nhl_shot_events`) |
| Goalie | Save %, goals against, shots faced, workload | Held |
| Goalie | Goals saved above expected | Derivable (needs an xG model from shot location and type) |
| Game | **Starting goalie matchup** (the key hockey fact) | Confirmed starters **Not held** |
| Team | Power play %, penalty kill %, shots for/against | Verify (not parsed today) |
| Live | Live shot map by period | Verify (live feed coordinates) |

### Soccer (EPL, MLS)

| surface | idea | status |
|---|---|---|
| Player | Minutes, starts vs sub appearances, goals / xG / xA per 90 over time | Minutes/starts Held; xG/xA fetched live, **not stored** |
| Player | Half-pitch shot map, xG-sized dots, foot/head filter | Fetched live (Understat), **not stored** |
| Player | Position-aware page (defenders: tackles, fouls, cards; keepers: saves, goals conceded, save %) | Keeper and discipline keys Held; tackles/passes **Not held** |
| Team | xG for/against trend, W/D/L strip, set-piece share | xG fetched, not stored; results Held |
| Game | Probable lineups and formations; suspensions from card accumulation | **Not held** / Derivable (cards) |
| Game | Three-way moneyline with the draw | Held |
| Live | Attack momentum / xG race timeline | Verify |

### Tennis

| surface | idea | status |
|---|---|---|
| Player | Serve and return profile: aces, double faults, 1st-serve in/won, 2nd-serve won, break points saved/converted | **Dropped** (parser keeps aces only) |
| Player | Surface record: hard / clay / grass W-L, today's surface marked | Derivable (`game_result`: 56,386 matches with surface) |
| Player | Fatigue: matches and minutes in the last 7 days, retirements | Matches Derivable; minutes **Dropped** |
| Player | Ranking and ranking history | **Dropped** (CSV carries ranks) |
| Game | Serve/return comparison; H2H by surface; no home/away, no injuries, no unit grades | Dropped / Derivable |
| Live | Set and game score with break points | Held (live route) |

### Golf (held until a live tournament)

| surface | idea | status |
|---|---|---|
| Player | Strokes-gained-style category profile (off the tee, approach, around the green, putting) | Verify against `golf_shot_events` (1.03M rows) |
| Player | Proximity by approach distance; course-fit comparison | Held (shot events) |
| Live | Hole-by-hole scorecard with position movement | Held (`golf_hole_scores`, recent weeks only) |

---

## Slate research views (G6)

Questions that span a slate, and the view each needs:

| view | built from | status |
|---|---|---|
| **Longest home run today** (mocked: `g4`) | peak exit velocity, HR launch angle, HR distance, park carry, temperature, wind vs field, opposing velocity | EV/LA Held · distance **Dropped** · park orientation **Not held** |
| Anytime TD scorer | red-zone targets and carries, TD share, opponent TDs allowed by position | targets Held · red zone **Dropped** |
| NBA pace-up spots | pace and ratings by team, rest, injuries | Derivable |
| Goalie and shots | starting goalies, shots for/against, save % | shots/saves Held · starters **Not held** |
| Anytime goalscorer across a matchday | xG per 90 and minutes for every attacker, opponent xG conceded | xG **not stored** |
| Aces and serve props | serve stats by surface, opponent return profile | **Dropped** |

---

## What Phase H merges

1. **Foundations first:** F2 tokens and the component set proven in the boards
   (`Card`, `SegmentedToggle`, `Tabs`, `Chip`, `Tooltip`, `Avatar`, `StatValue`/
   percentile bar, `DataTable`, `DrillDownPanel`, `Skeleton`/`EmptyState`/
   `ErrorState`), charts at real width.
2. **Data kept at ingest** (cheapest depth per unit of work): MLB distance, spray,
   bat speed, spin; tennis serve stats, ranks, minutes; soccer xG/xA stored;
   NFL play-by-play EPA and red-zone fields; ESPN win probability and drives.
3. **Read paths for held data:** Statcast corpus on player pages; `game_result`
   with de-duplication; NBA derived ratings; tennis surface records.
4. **Page rebuilds in the picked layouts,** sport by sport, cards per Phase F.
5. **Correctness bugs** F-B1…F-B13, with F-B2's corrected cause.
6. **Slate research views** if G6 is yes.
