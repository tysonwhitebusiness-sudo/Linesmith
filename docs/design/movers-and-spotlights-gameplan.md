# Movers and sport-specific Spotlights — gameplan

**Written 2026-09-21**, after S1–S6. These are the two pieces the Slate build
measured and left out (queue Q9, ledger SL-18 and SL-23). Every number below
was measured today with the read-only probes in `scripts/probe-quote-*.ts` and
`scripts/probe-spotlight-sources*.ts`. Re-run them before building. Numbers go
stale.

The same rules apply as for the rest of the Slate: Python writes and TypeScript
renders; no edge anywhere; sections are declared by data, not by a sport check;
and the model's tier words stay internal.

---

## Part 1 — Movers

### What S2 concluded, and why it was mostly wrong

S2 measured six thresholds and found the biggest "moves" were two or three
books jumping 25 implied points on an unchanged line. It concluded the quotes
were bad and that Movers needed a per-book quality pass first.

**Measured today, most of that noise is LIVE in-game pricing.** The history
tables keep logging after first pitch, and the S2 readers never cut there:

| MLB, last 36h | changes | avg move | share > 10 pts |
|---|---|---|---|
| props, **pre-game** | 139,129 | 1.07 pts | **0.3%** |
| props, live | 155,135 | 5.58 pts | 18.1% |
| game lines, **pre-game** | 5,736 | 1.6 pts | **2.2%** |
| game lines, live | 8,239 | 9.08 pts | 29.9% |

More than half of all logged changes happen after the game has started. They
are real prices, but for a different question (who wins from here) than the
Slate asks.

**Once live quotes are cut, what's left is flicker, not jumps.** With
pre-game quotes only, no book moves more than 10 points on more than 3.4% of
its changes. But several books REVERT a large share of their changes on the
very next quote (A→B→A):

| book (provider) | pre-game changes | revert rate |
|---|---|---|
| fliff (propline) | 468 | 61% |
| fanatics (oddsapiio) | 12,032 | 51% |
| fanatics (propline) | 39,753 | 43% |
| smarkets (propline) | 6,367 | 37% |
| fanduel (propline) | 11,441 | 37% |
| draftkings (propline) | 17,367 | 34% |
| pinnacle (propline) | 182 | 3% |

Flicker cancels out of a **net** move (first-seen → latest). It only looks
like movement if you sum every tick or rank by the largest single change.

**Two books are not prices at all for this purpose:**
- **PrizePicks** sits ≥4 pts off the cross-book median on **88%** of quotes
  (avg 20 pts). It's a pick'em projection, not a price.
- **ProphetX** is off-median on 40% (avg 7 pts). Exchanges (ProphetX, Novig,
  Kalshi, Polymarket, Smarkets, Matchbook) quote thin books.

### The plan

**MV1 — Fix the readers (TypeScript, `lib/slate/marketMoves.ts`; no new table).**
1. **Cut at the start.** Only observations before the game's start count. The
   start time comes from the snapshot's games (`firstPitch` / `startsAt`),
   which `/api/slate` already reads for every sport. This also fixes
   `game_odds_history` having no sport column: the reader takes
   `(id, startsAt)` pairs.
2. **Net move, per book:** the first pre-game observation vs the latest,
   same line (the S2 fix of grouping by point stands). Flicker disappears by
   construction.
3. **Consensus move is the headline:** the median implied probability across
   books at first-seen vs now, needing ≥3 books at both ends. One book moving
   alone is a row detail, never the sort key.
4. **Consensus excludes** DFS pick'em (PrizePicks, Underdog pick'em lines)
   and, by default, exchanges (list above). They can still appear as a book in
   the row expand. This is one constant, `CONSENSUS_EXCLUDED`, so it's a
   one-line change if you disagree (decision D-M1 below).
5. **Keep the S2 sanity rules:** price bounds, pick'em excluded, 15-pt stale
   cap per book.

**MV2 — Flags (same file).**
- **Steam:** ≥3 consensus books move the same direction by ≥2 pts within 30
  minutes, pre-game. Measured real steam is 1–8 pts, so 2 is the floor.
- **Split:** the line moves one way and the price the other.
- **Not built, on purpose:** "reverse line movement" or "sharp money" labels.
  Both are an argument about who is right, which is the edge claim the Slate
  doesn't make.

**MV3 — The card (spec §3.2, unchanged).** Tabs: Game lines · Props. Window:
Since first seen · 3h · 1h. Columns: subject · market · line (first → now) ·
consensus price (first → now) · **Move** (implied pts, the sort, a `bar`) ·
books moved / quoting · first move · trend sparkline. Caption: "Movement is
market information, not a prediction." Nav entry "Movers". Golf is hidden
(no history). Soccer and tennis show only if Q6's alternative-market problem
doesn't recur. Measure it first (MV0 below).

**MV0 — Before building, re-measure three things:**
- The same pre-game table for **NFL and soccer** (so far only MLB is measured).
- **Soccer/tennis game lines:** does grouping by point and cutting at kickoff
  rescue them, or does Q6's mixed-market problem remain?
- **Sample check:** take today's top 10 consensus movers and look for a
  public reason (lineup, injury, weather). If most have none, the threshold
  is too low. Write the result into the ledger either way.

**MV4 — Guard.** Extend `tests/slate-shell.test.ts`:
- a post-start observation never counts;
- a flicker series nets to zero;
- a single book can't make a row;
- PrizePicks never enters the consensus.

`scan-no-edge` already covers `marketMoves.ts`.

**Effort:** MV0 half a day; MV1–MV4 one phase. No Python, no migration.

**Decisions:** D-M1 taken (exchanges out). D-M2 and D-M3 defaults stand; see Part 4.

---

## Part 2 — Sport-specific Spotlights

### Where they should be computed

The two universal spotlights are built in TypeScript from the candidates
(SL-21), because they only need each player's own history. The sport-specific
ones join other tables (Statcast splits, defence-vs-position, park factors,
injuries). **Compute them in Python**, in `slate_rankings.py`, the way
Specials are:
- one `RankingDef` per spotlight, factors declared beside their source;
- a new `kind` field (`special` | `spotlight`) so the Slate knows where each
  one goes;
- the drift test (`tests/slate-specials.test.ts`) generalised to both kinds.

That gives every spotlight frozen-at-first-game rows, percentiles and the
"why" for free, and receipts later if we want them. The existing
`SlateSpotlights` card renders them. It doesn't need to know the sport.

### What each spotlight needs, and what exists (measured 2026-09-21)

| sport | spotlight | factors | source | status |
|---|---|---|---|---|
| MLB | **Platoon spots** | batter's OPS/xwOBA vs today's starter's hand; the starter's split vs that side | `mlb_statcast_player_season.payload.splitsByHand` (3,054 rows, today) | **buildable now** |
| MLB | **Pitcher K spots** | K%, whiff% by pitch type; opponent K% vs hand | `mlb_statcast_player_season` + `mlb_statcast_team_season` | **buildable**. Use season Statcast, not `mlb_pitch_events` (only 12 days / 89 games held) |
| MLB | **HR-friendly parks today** | park factor, both starters' HR/9, weather chip | `park_factors`, `team_hr_rate_allowed` (both today) | **buildable now** |
| NFL | **Targets vs weak pass defences** | target share, opponent yards/targets allowed to WR/TE/RB | `team_target_profile` (322, today), `nfl_target_events` | **buildable now** |
| NFL | **Rushers vs the worst run defences** | carries/game, opponent RB rushing allowed | `team_game_production` (by pos group) | **buildable now** |
| CFB | **Rushers vs the worst run defences** | same, team-level defence only (only the `all` group is held) | `team_game_production` cfb | **buildable**; the card says "team-level" |
| NBA | **Pace-up games** | both teams' possessions/game (FGA − OREB + TOV + 0.44·FTA) | `team_game_production` nba (all box fields held) | **buildable**; season starts 10-03 |
| NBA | **Usage bumps** | a teammate out tonight × the player's `team_share` | `injury_report` (20 days, today) + `player_season_production` | **buildable**; injury timing is the risk |
| NBA | **Shot-zone matchups** | player's zone mix vs opponent's allowed by G/F/C | `team_shot_profile` nba (335), `nba_shot_events` | **buildable** |
| NHL | **Shot volume vs the most shots allowed** | SOG/game, TOI, opponent shots against | `player_game_history` (sog, toi), `team_game_production` (shotsAgainst), `team_shot_profile` | **buildable**; season starts in October |
| Soccer | **Shot takers vs weak defences** | shots and SOT per 90, opponent shots allowed to FWD/MID | `team_game_production` (FWD/MID/DEF groups held) | **buildable now** |
| Tennis | **Form** (last-10 wins) | match wins, sets and games won | `player_game_history` tennis | **buildable now** |
| Tennis | **Surface record** · **Serve vs return** | surface, aces, hold/break % | not held: history has only sets/games; no surface | **blocked**: needs a Sackmann/TML ingest job (Python) |
| Golf | **Round movers** | positions gained today | the live candidates (already in TS) | **buildable now**, TS-side |
| Golf | **Scoring by par type** | field average on par 3/4/5 this week | `golf_hole_scores` (18k rows) | **buildable** |
| Golf | **Course history** | this golfer's past finishes at this course | `golf_tournament_results` has 235 events, but `golf_tournaments` names a course for only 4 | **blocked**: needs the tournament→course metadata backfilled |


### The eight new spotlights (all approved, 2026-09-21)

Each is a fact about tonight, not a prediction, and none compares a model to a
price.

| # | spotlight | what it lists | sports | source (held today) |
|---|---|---|---|---|
| N1 | **Role changes** | players whose last-3 usage is well above their season rate: minutes (NBA), TOI (NHL), targets + carries (NFL/CFB), starts + shots (soccer), plate appearances (MLB) | NFL, CFB, NBA, NHL, soccer, MLB | `player_game_history` |
| N2 | **Back in the lineup** | on yesterday's injury report, not on today's | NFL, CFB, NBA, NHL, MLB | `injury_report` (20 daily captures) |
| N3 | **Teammate out, usage up** | a starter ruled out → the teammates who absorb most of their share | NBA, NFL, NHL | `injury_report` × `player_season_production.team_share` |
| N4 | **Hot bat vs cold arm** | a batter's last-10 form against the opposing starter's last-3 Game Score | MLB | `player_game_history`, `pitcher_game_score_history` |
| N5 | **Weather games** | wind over 15 mph or rain over 50% | MLB, NFL, CFB (where held) | the game cards' forecast |
| N6 | **Rest and travel** | back-to-backs, third road game in four nights (NBA/NHL), short weeks (NFL) | NBA, NHL, NFL | schedule dates in `team_game_production` |
| N7 | **Revenge games** | a player facing a team they played for recently | all team sports | team changes in `player_game_history` |
| N8 | **Milestone watch** | players within one game's worth of a round number (1,000 yards, 30 HR, 100 points) | all team sports | season totals in `player_season_production` |

N5 is a flag, not a ranking: it shows as a chip and a short list, never
ordered.

---

## Part 3 — Where everything shows up

**Computed once, shown in several places.** Every spotlight lives as rows in
the Python ranking job (`slate_rankings`, `kind = 'spotlight'`), each row
carrying its player, team and game. Every page reads those rows, so a player
cannot be "back in the lineup" on the Slate and not on their own page.

| spotlight | Slate (main home) | player page | team page | game page | Slate game card |
|---|---|---|---|---|---|
| Sport spotlights (Part 2 table) | ranked card | chip where the player appears | — | matchup note | — |
| N1 Role changes | ranked card | "Role trend" chip | "Rising roles" list | both teams' risers | — |
| N2 Back in the lineup | ranked card | "Returning" chip | injury section shows who's back | both lineups | — |
| N3 Teammate out, usage up | ranked card | "Usage up: X out" chip | "Who absorbs the gap" | both teams | — |
| N4 Hot bat vs cold arm | ranked card | matchup note | — | matchup card | — |
| N5 Weather games | flag list | — | — | conditions card (exists) | chip (exists) |
| N6 Rest and travel | ranked card | — | schedule note | both teams' rest | "B2B" / "3-in-4" chip |
| N7 Revenge games | ranked card | "vs former team" chip | — | note | — |
| N8 Milestone watch | ranked card | "12 yds from 1,000" chip | team milestones | both teams | — |

**How the research pages get them:**
- One shared `ResearchFlags` card and chip row reads the rows for its player,
  team or game through `/api/slate/flags?subject=|team=|game=` (a
  `cachedRoute`). It's one component, not one per sport (sport-adapter rule).
- On the player, team and game pages they're stat context ("12 yards from
  1,000", "back from injury"), never betting framing. Those pages are
  research pages.
- Slate game cards get only short chips (weather, rest), so the grid stays
  compact.

---

## Part 4 — The phases

Rules for every phase:
- Measure first, then build, typecheck, test, build, and render at 1440 and
  400 in a fresh tab.
- Commit by explicit path, and push after each phase.
- **Every Python change needs a Render deploy, and each deploy is asked for,
  never assumed.**
- Check the pooler (15 connections) before DB work.
- A new table gets a `docs/table-ownership.md` row.

| # | phase | what | depends on | Python / deploy | done when |
|---|---|---|---|---|---|
| **F0** | Foundation | `kind` (`special`/`spotlight`) on `RankingDef`; the ranking job writes spotlights with player/team/game ids; `/api/slate/flags` (cachedRoute); the shared `ResearchFlags` card + chips; the Slate's Spotlights section merges the two TS universal cards with the Python ones; the drift test covers both kinds | — | yes / yes | an empty spotlight registry renders nothing anywhere, and a fixture spotlight renders on the Slate and on a player page |
| **MV0** ✅ | Movers re-measure | the pre-game table for NFL and soccer; soccer/tennis game lines after cutting at kickoff (Q6); a sample check of today's top 10 movers for a public reason | — | no | numbers in the ledger; the thresholds confirmed or changed |
| **MV1–4** ✅ | Movers | pre-game only, net first→latest, consensus of ≥3 books with exchanges and pick'em excluded (D-M1); Steam and Split flags; the card per spec §3.2; guards | MV0 | no | Movers shows on MLB/NFL with believable top rows; tests pin post-start, flicker, single-book and PrizePicks |
| **SP-NFL** | NFL | Targets vs weak pass defences · Rushers vs worst run defences · N1 · N2 · N3 · N5 · N6 (short weeks) · N7 · N8; chips on NFL player/team/game pages | F0 | yes / yes | every NFL card renders on Sunday's slate with its factors and a why; chips on the pages |
| **SP-CFB** | CFB | Rushers vs worst run defences (team-level) · N1 · N2 · N5 · N7 · N8 | SP-NFL | yes / yes | same, on a Saturday slate |
| **SP-SOC** | Soccer (EPL, MLS) | Shot takers vs weak defences · N1 · N7 · N8 | F0 | yes / yes | same, EPL and MLS |
| **SP-MLB** | MLB | Platoon spots · Pitcher K spots · HR-friendly parks · N1 · N2 · N4 · N5 · N7 · N8 | F0 | yes / yes | same; postseason slates included |
| **SP-NBA** | NBA (**before 2026-10-03**) | Pace-up games · Usage bumps (= N3) · Shot-zone matchups · N1 · N2 · N6 · N7 · N8 | F0 | yes / yes | live on opening night, built on last season's data until this season's exists |
| **SP-NHL** | NHL (before opening night) | Shot volume vs most shots allowed · N1 · N2 · N3 · N6 · N7 · N8 | F0 | yes / yes | same |
| **DJ-TEN** | Tennis data job | ingest Sackmann/TML match data: surface, aces, service/return points, hold/break; new table + ownership row | — | yes / yes | a full season per tour held, refreshed on a schedule |
| **SP-TEN** | Tennis | Form (last 10) · Surface record · Serve vs return | DJ-TEN (Form can ship before it) | yes / yes | ATP and WTA slates show all three |
| **DJ-GOLF** | Golf data job | backfill the tournament→course mapping for the 235 events in `golf_tournament_results` | — | yes / yes | ≥90% of events have a course |
| **SP-GOLF** | Golf | Round movers (TS, from the live candidates) · Scoring by par type · Course history | DJ-GOLF (the first two can ship before it) | yes / yes | a live tournament week shows all three |
| **SPC** | Close | receipts for frozen spotlights (graded the next morning, like Specials); `scan-no-edge` covers the new files; `CLAUDE.md` note on flags and where they render; queue rows | all of the above | no | every guard green; handoff rewritten |

**Order:**
1. F0.
2. MV0 → Movers, alongside SP-NFL.
3. SP-CFB and SP-SOC.
4. SP-MLB, while the postseason runs.
5. SP-NBA and SP-NHL, finished before their openers.
6. DJ-TEN → SP-TEN and DJ-GOLF → SP-GOLF, which can run in parallel with
   steps 3–5 because they only touch Python.
7. SPC.

**Decisions still open** (defaults taken unless you say otherwise):
- D-M2: default Movers window is since first seen.
- D-M3: a single book re-pricing alone shows only in the row expand.
- D-F1: research-page chips appear only when the player/team is on
  **today's** slate. Default: yes; a flag is about tonight.

---

## Decisions taken (operator, 2026-09-21)

- **D-M1 — yes:** exchanges and DFS pick'em stay out of the Movers consensus.
- **D-S1 — all sports in this build, starting with NFL.**
- **D-S2 — default:** spotlights freeze at the first game, like Specials, and get receipts.
- **D-S3 — yes:** build the tennis TML ingest and the golf tournament→course backfill.
- **D-S4 — all eight new ideas approved**, placed on the Slate with chips/cards on the research pages (Part 3).

---

## MV0–MV4 — built 2026-09-21

**MV0 measured** (`scripts/probe-movers-mv0.ts`): pre-game is clean in every
sport (≤1.3% of prop changes over 10 pts). Live WTA quotes were 43–57% big
jumps, which confirms the cut at the start. The top consensus movers read as
real market moves (Davante Adams receptions +15–24 pts on 5–7 of 7 books at
every line). CFB and ATP hold almost no pre-game prop history, so Movers hides
there.

**Built:**
- `lib/slate/marketMoves.ts` `readConsensusMovers`: pre-game only, upcoming
  games only, net first → latest per book, the median of ≥3 books, ≥2 books
  moved, exchanges and pick'em out (D-M1). Windows are since first seen, 3h
  and 1h. Steam and Split flags. One row per player-market at its main line,
  with an "also moved at N other lines" count.
- `/api/slate/movers` (cachedRoute, 120 s).
- `components/slate/SlateMovers.tsx`, the card per spec §3.2. It sits under
  Games in the nav.
- `Sparkline` gained `neutral`, so a line move never gets a good/bad colour.
- MV4 guards in `tests/slate-shell.test.ts`: pre-game only, flicker nets to
  zero, one book can't make a row, pick'em and exchanges out, collapse, Steam,
  Split, the caption, and the nav count.

**Found while building** (ledger SL-30):
- **The "main line" must be the one priced nearest even money**, not the most
  common line or each book's first quote. Books post alternate lines first,
  so Davante Adams read as moving 1.5 → 5.5.
- **The trend window must end at now**, not at the start. Games two days out
  had no sparkline.
- **Split and "line first → now" only describe the main line.** One row sat at
  a line that never changed but carried a Split flag earned elsewhere.
- **The Movers nav count is the rows the card lists** in the default window,
  not every row returned.

**Measured on 2026-09-21:** MLB 47 props + 4 game lines across 3 upcoming
games. NFL (MNF) 8 props + 1 line. Cold build 2–7 s, then served from cache.
