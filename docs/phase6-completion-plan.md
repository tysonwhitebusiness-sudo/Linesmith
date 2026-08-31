# Phase 6 — what is actually left

**Written 2026-08-30**, after measuring all three design boards against what the
components render. Supersedes the "6.13 DONE" claim in earlier handoffs.

Operator decision, same date: **the four remaining sourcing gaps are ACCEPTED.**
They render an honest empty state and nothing waits on them.

---

## The four accepted gaps

| Cell | Why it stays empty |
|---|---|
| NFL `usageMix` — route mix | Needs player tracking. NGS public release is weekly aggregates only. |
| NFL `binarySplit` — man/zone | Same. |
| CFB `usageMix` — route mix | Same, and no public CFB tracking exists at all. |
| CFB `spatialGrid` — target map | cfbd play-by-play carries no pass location or air yards. Verified. |

**Everything else in Phase 6 is buildable with data already in hand.**

---

## PROGRESS — 2026-08-30, autonomous build session

**Player Detail roles: 14/48 -> 39/48.** Four sports now fill all six.

**The golfR import is DONE** — 1,033,752 shots, 486 players, 40 files, zero
failed. Keyed on player NAME, not id: `golf_shot_events.player_id` is PGA
Tour's and the app's `subjectId` is ESPN's, and **both are five-digit numbers**,
so the id-keyed version compiled, ran and returned zero rows for all 30 slate
golfers. 21 of 30 match by name; the nine that do not reached the Tour after
2023 and are genuinely absent from a 2020-2023 seed.

| Sport | Roles | Remaining, and why |
|---|---|---|
| MLB | **6/6** | — |
| NBA | **6/6** | — |
| NHL | **6/6** | — |
| Soccer | 5/6 | `conditions` — waived by operator |
| NFL | 4/6 | `usageMix`, `binarySplit` — accepted gaps (tracking feed) |
| CFB | 4/6 | `usageMix`, `spatialGrid` — accepted gaps |
| Tennis | **3/6** | `opponentUnit` **DONE** (reads the opponent's own candidates off `snapshot.candidates`); `conditions` needs the event on `subjectMeta`; two waived |
| Golf | **5/6** | `usageMix`/`spatialGrid` **DONE** — golfR import loaded, 1,033,752 shots. `opponentUnit`/`conditions` need field + course + weather plumbed to a hook; `careerH2H` NOT BUILDABLE — `golf_tournaments` holds three events, so there is no multi-year course history |

**Backfills: DONE.** `nba_shot_events` 195 -> 219,873 rows / 1,234 games.
`nhl_shot_events` 102 -> 73,291 / 633. Both carry `shot_type`, which closed
each sport's `usageMix` as well as its `spatialGrid`.

**Game Detail: `rankings` and `unitGrades` now fill for NBA and NHL** from the
same `seasonRanks` rollup already feeding `statComparison` in those files.

**Two things measurement stopped me building:**
- `propsForGame` is NOT a gap. It is a flat every-candidate list that MLB skips
  because `LeftRail` covers it — and `LeftRail` renders for every sport.
  Filling it on five sports would have added five redundant copies of a list
  already on screen.
- CFB and soccer `unitGrades` are correctly null: they are null on those
  sports' TEAM pages too, because neither has a league-wide ranked aggregate.
  Needs a 6.1b-style rollup, not wiring.

**Still open on Game Detail:** `matchup` for NBA/NHL/tennis (`GameMatchupData`
is MLB/NFL-shaped — `pitching`, `BatterPitcherMatchupProps`, NFL player cards —
so this is a design question, not wiring); `model`/`pickLockAt`/`venue` across
six sports; `bookGrid` and `matchupKey`, which exist nowhere.

**Still open on Team Detail:** the per-sport block walk. Not started.

---

## GATE WALK — 2026-08-30, partial

Walked the real pages for the five sports with live data. **CFB, NBA and NHL
have zero candidates today (out of season), so their pages cannot be walked
until October** — that is the single biggest limit on closing this gate now.

**Four defects found by opening pages, none of which any test or `tsc` caught:**

1. **Soccer's opponent matching was dead.** Understat's history says "Leeds";
   ESPN's `subjectMeta.opponentName` says "Leeds United". Three sites compared
   them with `===`, so 0 of 273 entries matched and the h2h window, the
   `careerH2H` card and the "vs opponent" filter chip were ALL empty — since
   soccer shipped. **Third sport with this bug class**; CFB's own fix comment
   said it had been found twice before. Now one shared `teamNameMatch.ts`.
2. **NFL's `careerH2H` was returned from the wrong object** — assigned into the
   per-row gamelog literal, so `data.careerH2H` was undefined.
3. **The line-movement card had an unreachable empty state** — an early
   `return null` sat in front of the message written for exactly that case.
4. **Two cards on one page both headed "Season stats"** — the gamelog summary
   strip and the rail card. The strip is now "Totals", which is also what its
   own Season/L15 toggle makes true.

**Verified rendering with real data**, per sport:

| Page | MLB | NFL | Soccer | Tennis | Golf |
|---|---|---|---|---|---|
| Player | 6/6 roles | 4/6 (2 accepted) | 5/6 | 2/6 | 1/6 |
| Team | walked | walked | — | n/a | n/a |
| Game | — | — | — | — | n/a |

Spot values confirmed on the page, not just in the payload: MLB's platoon split
reads vs LHP .340 (n=92) / vs RHP .417 (n=233), with the xwOBA n correctly the
xwOBA count rather than the 609/1512 pitch counts. Golf's par split reads
−0.63 (n=8) vs −0.08 (n=48) — **a 14% share, which `toVenueBinarySplit`'s floor
would have rejected**, which is why `predicateSplit` exists. Soccer's shot mix
sums to 100 across four types with per-slice xG samples.

**Still to walk:** every team page except MLB/NFL, every game page, and all
three pages for CFB/NBA/NHL once their seasons start.

---

## A · Player Detail (6.13) — REOPENED

Measured: **48 cells (8 sports × 6 roles).** 14 render today.

### A1. Import golfR's shot-by-shot data — closes 2 cells
40 tournaments, 333 MB, 2020-2023, with `lie`, `distance`, `left` (proximity)
and `from_x/y/z`. New table + ingester, same shape as `nfl_target_events`.
Fills golf `usageMix` (approach distance) and `spatialGrid` (proximity by lie).
**Static historical seed, not a live feed** — current tournaments still need
PGA's modern endpoint, which is a separate task nobody has scoped.

### A2. Run two backfills — closes 4 cells
`nba_shot_events` holds **195 rows**, `nhl_shot_events` **102** — single-game
verification samples, not coverage. Both tables carry `shot_type`, so each
script closes that sport's `spatialGrid` AND `usageMix`.

```
./.venv/Scripts/python.exe -u src/nba_shots.py backfill 2024-10-22 2025-04-13
./.venv/Scripts/python.exe -u src/nhl_shots.py backfill 20242025
```

### A3. Build 21 cells that need no new data
In rough value order:

1. **MLB `binarySplit` — vs LHP/RHP.** Its null says *"this app stores no
   platoon split"*; 6.6 made that stale. `mlb_pitch_events` has `p_throws` and
   `stand` across **2,140,525 rows**. Closes MLB's last empty role.
2. **`careerH2H` × 6 sports.** Renders on MLB and NFL only. Every sport has
   `opponent_id` in `player_game_history`, and `shared/careerH2H.ts` already
   exists. Six adapters simply never call it.
3. **`opponentUnit` × 7 sports.** MLB-only today. NFL's `opponentDefenseAllowed`
   is already on `subjectMeta`; `/api/{cfb,nba,nhl}/team-defense-allowed` exist;
   NHL's opposing goalie and soccer's keeper come from `player_game_history`
   (`isGoalie`, `saves`, `goalsAgainst`, `shotsAgainst`, `goalsConceded`).
4. **NBA/NHL `conditions`** — rest and travel from the schedule already in
   `team_elo_history`.
5. **Golf `binarySplit`** — par 5 / par 4, from `golf_hole_scores.par`.
6. **Soccer `usageMix`** — shot type (header / left foot / right foot), already
   in the Understat payload being fetched.
7. **Tennis `binarySplit` + `conditions`** — surface, from `raw.surface` via
   `surfaces.ts`. ATP complete; **WTA half of that table is unfinished** and
   degrades to null until someone writes it.

### Where that lands

| Sport | Roles after A1-A3 | Empty, and why |
|---|---|---|
| MLB | **6/6** | — |
| NBA | **6/6** | — |
| NHL | **6/6** | — |
| Golf | **6/6** | — |
| Soccer | 5/6 | `conditions` — waived (no roof list) |
| NFL | 4/6 | `usageMix`, `binarySplit` — accepted gaps |
| CFB | 4/6 | `usageMix`, `spatialGrid` — accepted gaps |
| Tennis | 4/6 | `usageMix`, `spatialGrid` — waived |

**41 of 48, with 7 honest empty states.**

**One free upgrade available:** NGS carries
`percent_attempts_gte_eight_defenders` — stacked box vs not. A real, measured
NFL split, just not the man/zone the board drew. Taking it puts NFL at 5/6.
Operator's call; not assumed here.

---

## B · Team Detail (6.14)

Six sports, not eight — tennis has a null `team_id` on all 271,964 rows and golf
has no team concept. That is correct and stays.

**The board's own verdicts are mostly already done**, which is why this task is
smaller than its "twenty blocks" headline:

- `grades: TeamGrades | null` → generic `unitGrades` — **done in 6.1/6.2.**
- `roster`/`standings` data-driven via `rosterSortByStats`/`rosterPageSize` —
  **already the case.**
- Rating history with a labelled span — **built 2026-08-30.** It was not a
  "shorten the axis" job: no rating block existed at all, and
  `team_elo_history`'s 88,774 rows reached no page.

### Still to do

1. **Walk all six team pages block by block.** `TeamDetailData` has 18 fields
   against the board's 20 blocks; nobody has checked which render per sport.
   This is a measurement task first, not a build task.
2. **Market coverage** — the board calls this "the real gap to close before any
   of this ships." Measured 2026-08-30: MLB and soccer have moneyline + total +
   spread; **NFL has moneyline only (72 rows), CFB moneyline only (391), NBA and
   NHL have nothing at all.** The splits grid and price block both assume a
   spread. NBA/NHL are out of season — see 6.11, untestable until October.

---

## C · Game Detail (6.15) — LARGELY DONE, 2026-08-31

**Reopened and rewritten after measuring.** The section below used to say this
was "UNTOUCHED, and the largest item", with three headline blockers. **Two of
the three were wrong**, and the third was smaller than it looked.

### The two wrong premises

- **`bookGrid` was never missing.** The board says it "does not exist anywhere
  in the codebase." It is `BookmakerBreakdown`, inside `LineShoppingSection`
  (`GameDetail.tsx`), fed from `data.gameLine` for every sport, and it already
  carries the honest empty state — "No game line for this matchup yet." The
  board named it `bookGrid`; the app calls it Line shopping. Same block.
- **`matchupKey` is `matchup`, and it was not a design question.** CFB and
  soccer already filled it through a sport-agnostic `teamAway`/`teamHome` pair.
  What NBA and NHL lacked was an ALLOWED side — and
  `player_game_history.opponent_id` is non-null on 100% of rows in every sport,
  so grouping the same rows by who was played against is exactly that.
  `toAllowedSpec` + `producedAllowedMatchup.ts`.

### Where the fields stand now

| Sport | matchup | rankings | unitGrades | venue | model | propsForGame |
|---|---|---|---|---|---|---|
| MLB | yes | yes | **yes** | yes | yes | n/a |
| NFL | yes | yes | yes | **yes** | n/a | yes |
| CFB | yes | **yes** | **yes** | **yes** | n/a | n/a |
| Soccer | yes | **yes** | **yes** | **yes** | n/a | n/a |
| NBA | **yes** | yes | yes | indoor | n/a | n/a |
| NHL | **yes** | yes | yes | indoor | n/a | n/a |
| Tennis | see below | **yes** | **yes** | n/a | n/a | n/a |

`rankings` and `unitGrades` now fill on **all seven sports**. Bold = built
2026-08-31.

### The three that are correctly empty, with the measurement

- **`model` on six sports.** `game_sim_cache`, `model_weights` and
  `model_calibration` are `mlb`-only — 217/21/7 rows, nothing else. There is no
  non-MLB game model to wire. This is model work, not Phase 6.
- **`pickLockAt` is DEAD UI without a model.** `GameHeroCard` gates the whole
  pick panel on `model != null`, so filling the field on six sports renders
  nothing at all. The prop's own doc comment already said "meaningless (and
  unused) when `model` is null"; the task list did not.
- **`propsForGame`** is a flat every-candidate list MLB skips because `LeftRail`
  covers it — and `LeftRail` renders for every sport.

### Tennis `matchup`: measured, then declined

The allowed rollup builds fine for tennis (`opponent_id` is populated on every
row). It is TAUTOLOGICAL. A team's "allowed" aggregates over eighty different
opponents and says something its own production does not; a tennis match is
zero-sum between exactly the two entities on the card, so "what he allows" is
the complement of his own results. The card would restate `statComparison` with
the arithmetic reversed.

### Still open on this page

- **Book depth is real and unchanged.** MLB 39 books / 3 markets, soccer 33/3,
  CFB 4 books ML-only, tennis 3, NFL 3 (9 games), **NBA and NHL zero rows**. The
  block renders its empty state; this is a sourcing task, and 6.11 is the one
  that owns it.
- **NBA/NHL/tennis `venue`.** Indoor sports; the strip would be an arena name
  with no forecast. Buildable the same way soccer's was, not yet done.
- **NBA, NHL, CFB and tennis game pages have never been WALKED.** Out of season
  or no slate. Everything above is verified by construction and by the routes'
  own responses; MLB, NFL and soccer were walked on the real page.

---

## D · The rest of Phase 6, unrelated to the three pages — BUILT 2026-08-31

| Task | State |
|---|---|
| **6.22 line movement** | **DONE.** Game Detail and Team Detail both render a movement chart off `game_odds_history` (moneyline/total/spread), through one new reader, one route and one hook. NBA/NHL show the empty state because that table has zero rows for them — correctly. |
| **6.21 user CLV** | **BUILT, UNVERIFIABLE ON A PAGE.** `lib/odds/userClv.ts` + `/api/bets/clv`, using the same DISTINCT-ON close definition as `get_closing_price`. Only two bets exist, both golf, both with a null bookmaker and a null `game_id`, so neither is measurable — and there are no credentials to sign in with. Verified against real closing prices with synthetic bets instead; record it as unwalked. |
| **6.24 de-vig** | **DONE, WITH NO WINNER.** Power, Shin and worst-case added beside the multiplicative method (`devigMethods.ts`); nothing is made the default. The backtest scores on Brier + bucketed calibration, never on edge, and **declines a verdict at n=82** against a `MIN_SAMPLE_FOR_VERDICT` of 1000. **`historical_odds` cannot be used at all** — its 37,922 rows are pre-de-vigged, summing to exactly 1.0000. Correlated-prop warnings and DFS pick'em moved out of Phase 6 by operator decision. |
| **6.10 venue factors** | **DONE.** New `venue_factors` table, `venue_factors.py`, daily `venueFactorsJob`. A real run wrote **282 rows** across six sport-stat pairs (NBA 30, NHL 32, NFL 32, CFB 138, EPL 20, MLS 30), every sport's mean factor between 1.000 and 1.030. **The data layer only — nothing renders it yet.** |
| **6.10 `game_sim_cache`** | **MOVED OUT** by operator decision — it needs a non-MLB game model, which is the model project, not Phase 6. |
| **6.11** | NBA/NHL game book lines — still **untestable until October**. |

**Why `park_factors` did not get a `sport` column.** A tree-wide scan found
exactly two venue columns in the whole database and both are on `park_factors`
itself: **no sport but MLB stores a venue per historical game.** In every other
league a team plays its home games in one building, so the home *team* is the
venue — a different key, and one that deserves its own table rather than a
`venue_id` column that silently means "team id" on six sports out of seven.

**The factor is deliberately modest about itself.** It is the home/road scoring
ratio counting *both* teams' scoring, so the home side's own quality largely
cancels; but it cannot separate a genuine building effect from ordinary home
advantage, and it sits on a few dozen games per side. `home_games`/`away_games`
travel with it so a caller can decline to show a thin one, and the card that
renders it must say "how much more scoring happens when this team is at home"
rather than imply a stadium-physics claim.

---
## E · The Phase 6 gate — never run, and it is what catches this

§11 has **no gate sign-off** for Phase 6. The task list marked itself done. Its
requirements, verbatim where they matter:

- **No `sport === 'x'` in any of the three shared components' render paths.**
  Grep and assert.
- **Every sport's page renders every block or an honest empty state — walked per
  sport per page, not spot-checked. A blank card with no empty state is a
  failure.** *(This is the one that would have caught 6.13, the line-movement
  card, and NFL's misplaced `careerH2H`.)*
- **`unitGrades` proven by NHL**, which the old `TeamGrades` could not express.
- **Both primitive fixes carried across**, proven by rendering a non-MLB unit
  through each — `zoneGrid` with a >1.0 value and `rollingChart` with a
  non-zero-based series.
- **Every "no data" claim on a page is true.**
- Plus G1-G8.

**Two gate items depend on 6.20, which moved to Phase 7** (the published record
needs a graded history that does not exist until seasons start). Those two
cannot pass in Phase 6 and should be recorded as carried forward rather than
failed.

---

## Suggested order

1. **A2** — two backfill scripts. Free, unattended, closes 4 cells while other
   work proceeds.
2. **A3** — the 21 BUILD cells. Largest single win, no new data, and it takes
   four sports to 6/6.
3. **A1** — golfR import. Self-contained; new table + ingester.
4. **B1** — measure the six team pages, then build what the measurement finds.
5. **C** — Game Detail. Biggest item. Measure first: this plan's premises have
   been wrong eight times, twice on 6.14's own board.
6. **D** — 6.10's remainder, then 6.21, then 6.24.
7. **E** — the gate, walked properly, per sport per page.

**Known not closeable in Phase 6:** the four accepted gaps, 6.11 (season), 6.18
(operator-skipped, remains a launch blocker), 6.20/6.22 (Phase 7), 6.23 (not
derivable — `observed_at` is a poll time).

---

## F · Where this stands, end of 2026-08-31

**Sections A through D are built.** The three detail pages had a full pass each
(6.16 Player, 6.19 Team, 6.15/6.20/6.21 Game, plus 6.17's layout pass), and all
four of D's remaining workstreams shipped. TS tests **262 -> 339**; `tsc` and
`npm run build` clean.

**The gate in section E has NOT been run, and two of its items are already
known to fail:**

1. **`sport === 'x'` survives in two render paths** — `TeamDetail`'s `teamHref`
   (six branches) and `GameDetail`'s `renderLiveDetail` (six branches). MLB
   already does the latter correctly through `hero.mlbLiveGame` presence, which
   is CLAUDE.md §5's own rule; the fix is applying it to the other five.
2. **The per-sport page walk cannot complete** while CFB, NBA, NHL and tennis
   have no slate. Everything built for those four across this whole session is
   verified by construction and by route responses, never on a page.

**Also outstanding:** the venue factor renders on no card yet, and `794240d`
plus the new `venueFactorsJob` are undeployed on Render.
