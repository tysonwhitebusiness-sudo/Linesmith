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

**Decisions for you:**
- **D-M1** Exchanges in the consensus or out? Default: out (they're
  off-median 11–40% of the time here).
- **D-M2** Default window: since first seen (spec) or 3h? Default: since
  first seen.
- **D-M3** Show a per-book mover row when the consensus hasn't moved (one
  book re-pricing alone)? Default: no, only in the row expand.

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

### Order: season value first

1. **Now (in season, data held):** NFL targets + rushers, CFB rushers,
   soccer shot takers, MLB platoon + K spots + HR parks, tennis form, golf
   round movers. MLB's regular season ends in about a week, so its three are
   worth it only if the postseason matters to you (decision D-S1).
2. **Before 2026-10-03:** NBA pace-up, usage bumps, shot zones; NHL shot
   volume. Built in late September on last season's data, so they're live on
   opening night.
3. **Data jobs first:** tennis surface/serve (a TML ingest), golf course
   history (a tournament-metadata backfill). Each is a Python job with a
   `docs/table-ownership.md` row, then the spotlight is one `RankingDef`.

**Phase shape (per sport, repeatable):**
- SP-a: add the `RankingDef`(s) and factors in Python, run once, measure rows
  and freshness.
- SP-b: the drift test picks up the labels automatically.
- SP-c: render on the Slate, check at 1440/400, write the ledger row.

About one short phase per sport. The first (NFL) also carries the `kind`
field and generalising the test.

### New ideas beyond the spec (need your go-ahead)

- **"Role changes"** (every sport): players whose minutes, snaps, targets or
  TOI over the last 3 games are well above their season rate. Held for NBA,
  NHL and soccer in `player_game_history`. NFL snaps aren't held.
- **"Back in the lineup"**: a player off the injury report since the last
  slate. `injury_report` has 20 daily captures, so this is a diff between
  two days.
- **"Hot bat vs cold arm"** (MLB): a batter's last-10 form × the starter's
  last-3 Game Score (`pitcher_game_score_history` is held).
- **"Weather games"** (MLB, NFL): wind over 15 mph or rain over 50%, from the
  weather already on the game cards. It's context, not a ranking, so it's
  flagged rather than ordered.
- **Not proposed:** anything that ranks players by model probability minus
  price. That's the edge the Slate doesn't make.

**Decisions for you:**
- **D-S1** Build MLB's three now for the postseason, or skip to NFL? Default:
  NFL first, MLB second.
- **D-S2** Spotlights frozen at first game like Specials (so they get
  receipts), or live until tip-off? Default: frozen. Same code path,
  honest.
- **D-S3** Approve the two data jobs (tennis TML ingest, golf course
  backfill)? They're Python writers and need Render deploys.
- **D-S4** Any of the new ideas above.
