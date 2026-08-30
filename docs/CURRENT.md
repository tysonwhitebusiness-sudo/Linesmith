# CURRENT — pick up here

**Phase 5: COMPLETE, gate PASSED** (`f8e60b5`).
**Phase 4: COMPLETE, gate PASSED** (2026-08-29, after failing G7 and re-running
in full from G1 per Rule 5).

**Phase 6 has started — the per-sport question is measured and ANSWERED for all
three shared pages (Player, Team, Game). Four mockups built, four operator
decisions outstanding. No production code yet.** See §6.

## The documents, in reading order

1. `CLAUDE.md` — conventions. Read the caching and table-ownership sections.
2. `docs/audit-remediation-plan.md` — the plan. §0 holds standing decisions
   Q1–Q40; §11 is the phase log and the only place a task counts as done. The
   **Phase 4 GATE** entry at the end of §11 is the one to read before touching
   any model code.
3. This file — where the work actually is.

Trust §11 and `git log` over this file if they disagree.

## 1. What just happened

Phase 4's thirteen tasks were all implemented and marked done. The gate then
found **five real defects in that "done" work**, four of them in code that had
already passed its own VERIFY. Three needed operator decisions (Q38, Q39, Q40),
and Q40 **reversed** a decision the operator had already given, because the
number I gave them to decide on was wrong.

Final gate results: G1 8/8 · G2 tsc+build+48 TS tests+20 Python tests · G3 pass
(found the home-page defect) · G4 5/5 · G5 8/8 · G6 pass (one orphan deleted) ·
G7 pass after five fixes · G8 signed off with a ten-item "known not done".

### Read this before writing another VERIFY

**All five defects passed a VERIFY that measured the WRITE and never the READ.**

- 4.3 verified "model_calibration is no longer empty" — nothing applied the rows.
- 4.8 filtered three readers — six more still blended the deleted model in.
- 4.11 verified the module imports — a second call site raised NameError.
- 4.2 shipped an activation gate — it approved a model with every feature zeroed.

A VERIFY that ends at "the row exists" cannot see whether anything consumes it.
The tests added by this gate assert the **wiring**, not the function:
`test_prop_calibration_applied.py` reads the job's own source and asserts the
call lands ahead of both writers; `tests/model-source-filter.test.ts` fails if an
eleventh scoring reader is added without the filter; `test_name_resolution.py`
reads LOAD_GLOBAL opcodes from functions too expensive for CI to execute. All
three are fault-injected — each fails by name when its target is removed.

## 2. What is running

Nothing. No fit, no backfill, no gate script. Two `harvester_scrape.py` Windows
scheduled tasks on their usual ~20-minute cycle.

Worker live on the latest commit; the Q39 calibration is confirmed running in
production from the worker's own logs.

## 3. Next actions

1. **Phase 6 — operator sign-off on the six role names**, then build
   `components/charts/`. §6 has the measurement, the answer, and two mockups:
   `docs/design/chart-grammar.html` (the primitives + deep MLB page) and
   `docs/design/player-detail-per-sport.html` (all eight sports, one template)
   `docs/design/team-detail-per-sport.html` (six teams + golf's tournament) and
   `docs/design/game-detail-per-sport.html` (all eight). Rebuild any of them
   with `node docs/design/build-{per-sport,team-detail,game-detail}.mjs`.
2. **5.1's second VERIFY half**, after 00:00 UTC — the one carried item from
   Phase 5. `propline` was correctly gated at 1000/1000 for 2026-08-29:
   ```sql
   SELECT market_key, count(*) FROM prop_odds
    WHERE provider_id='propline' AND fetched_at > '2026-08-30'
    GROUP BY market_key ORDER BY 2 DESC;
   ```
   Before the fix this returned exactly one MLB market (`pitcher-strikeouts`).
3. **The duplicate-React-key bug** — §6 item 1. Pre-existing, one-line fix,
   unowned, and it can silently drop rows from the board.

## 4. Things that will bite again

**THE LESSON THIS GATE PAID FOR:** *a guardrail that has never rejected anything
is not known to work — and "beats its own baseline" is not a guardrail when the
baseline is worse than a constant.* The activation gate had shipped, been
reviewed, and been described in three comments as a working protection. Running
it against a deliberately worthless model showed it approved one:

```
[fit moneyline] beats own baseline: True   holdout Brier 0.248824
                baseline holdout 0.260666  ACTIVATED True
```

0.248824 is exactly what a constant at the base rate scores. The app's own
unfitted formula scores *worse than knowing nothing*, so anything cleared it.

**THE ONE BEFORE IT:** *a dead consumer cannot report that its input vanished.*
Four instances now — 5.3 renamed bookmakers under a `clv_backtest` nobody
called; 4.11 changed a distribution under weights nobody re-fitted; 4.8 filtered
three readers and missed six; 4.3 fitted calibrations for markets nobody
calibrates. **After any change that renames or re-derives a value, grep the tree
for consumers, including code nothing currently calls.**

**AND: quote the number the decision actually rests on.** I told the operator
the MLB total mismatch was "up to 11 points" — that was the shift on an *input*
to a regression, and they authorised a multi-hour re-fit on it. Propagated
through the real fitted weights the output shift is **1.03 points**. The re-fit
would also have made things worse. Found only because they asked "why do we even
need to re-fit at all". **Propagate the number to the thing a user sees before
putting it in front of someone.**

- **Measure before sizing work.** Training-set builds cost ~26 min/season and I
  had extrapolated that from one uncertain wall-clock reading.
  `scripts/gate/probe-training-set-cost.py` found the answer in 90 seconds: 55%
  of per-game time was ONE Postgres round trip per game. Now one query per
  season, ~2.2x. The HTTP calls plateau at 140 and were never the problem.
- **Fault injection is easy to fake — four occurrences.** Never accept "the
  operation failed" as evidence; assert WHY.
- **`ps aux | grep` in Git Bash does not show command lines.** Cost a wrong "the
  process died" call; a run was alive the whole time and raced its replacement.
  Use `Get-CimInstance Win32_Process` and read `CommandLine`.
- **Backgrounding `cd X && cmd &` backgrounds the `cd` too.**
- **Different tables, different vocabulary.** `pick_history.sport` is `'soccer'`;
  `player_game_history` uses `soccer_epl`/`soccer_mls`. `game_picks` has
  `ml_initial_market_prob`, not `market_prob`. The G1 script asserted the wrong
  one and failed loudly — which is why it is a script.
- **A deploy does NOT mean every writer runs the new code.** OddsHarvester runs
  as Windows scheduled tasks (~20-min cycle) and Python binds imports at process
  start. Any migration normalising a column needs re-applying after they cycle.
- **The plan's own task text goes stale, repeatedly.** Measure first.
- **`withJobLock` is a LEASE TABLE, not an advisory lock.**
- **Postgres UNIQUE treats NULLs as distinct.**
- **A long heredoc breaks this shell** (>~120 lines → "unexpected EOF").
- **`cd` persists between Bash calls.** Use absolute paths.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 5. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it. `q*.mjs`, `g*.mjs`,
  `gate*.mjs`, `runmig.mjs` are gitignored for this. `.env.local` has no
  `DIRECT_URL`, so DDL also goes through `:6543` — it has worked for every
  migration so far, `COMMENT ON` included.
- **Tests:** `npm test` (**48**) and `./.venv/Scripts/python.exe -u src/test_x.py`
  from `python-odds-service/`. **20** hermetic Python tests, one CI step each.
  There is **no pytest** in the venv — they are standalone scripts.
- **Gate scripts** (`scripts/gate/`): `phase-4-g1-verifies.mjs`,
  `phase-4-g4-g5.mjs`, `phase-4-weak-model-refused.py` (~35 min, real fit),
  `phase-4-shadow-roundtrip.mjs`, `probe-training-set-cost.py`,
  `phase-5-constraints.mjs`, `phase-5-budget-race.mjs`.
  `phase-4-refit-total.py` exists but **Q40 says do not run it** without also
  changing `odds_lines_cycle.py:491` — read Q40 first.
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no`. After any push
  touching `python-odds-service/`: `POST /v1/services/$SRV/deploys` with
  `RENDER_API_KEY` from `.env.local`, then confirm `"status":"live"` on your
  commit sha. ~90s. Worker logs via `GET /v1/logs?resource=$SRV&text=...` — the
  best end-to-end evidence available, and better than a deploy status.
- **Propline budget:** `propline` 1000/day (MLB), `propline_2` 1000/day
  (soccer), genuinely separate. **18 of ~20 authorised `propline_2` probe calls
  spent** capturing `docs/propline-live-capture-20260829.json` — reuse it.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's.

## 6. Phase 6 design direction (2026-08-29)

**Agreed with the operator this session. No code written yet.** The operator's
framing: Phase 6's goal is *"extensive amounts of player and team data so users
can make educated guesses and see all the data in one place"*, with **premium
graphs and visualisation rather than raw numbers**, and a UI that "looks and
feels smooth and premium".

### The decision: a chart grammar, not more charts

Build `components/charts/` — a shared primitives library — **before** any Phase 6
feature chart. Two pieces first: a `ChartFrame` (axes, grid, empty state,
loading, tooltip) and `useChartCrosshair` (hover synced across every chart in a
panel). Then eleven primitives:

| # | Primitive | Job |
|---|---|---|
| 01 | `Sparkline` | trend at table-row scale, no axes |
| 02 | `SeriesChart` | the one real line chart (line movement); emphasis + grey context |
| 03 | `DistributionBars` | per-game results vs a line — **already exists** as `DistributionChart`, `PlayerDetail.tsx:129` |
| 04 | `DensityCurve` | where one value sits in a population |
| 05 | `PercentileRail` | ranked stats — the radar-chart replacement |
| 06 | `HeatGrid` | splits matrix; strike-zone grid is the same primitive at a different aspect |
| 07 | `RangeBar` | book dispersion |
| 08 | `ContributionBars` | signed model contributions — "why the model likes this" |
| 09 | `StatTable` | dense stat block, heat bar *behind* the number (bar-in-cell) |
| 10 | `StreakStrip` | run of binary outcomes, opacity ramping to the present |
| 11 | `SplitDumbbell` | A vs B on one shared scale (platoon, home/away) |

**Why, in this repo's own terms:** `package.json` has **no chart library** — only
`motion`, imported by exactly one file (`MatchupExplorerCard.tsx`). Hand-rolled
SVG is the right call for a premium look; a library would make it look like every
other tool in the category. But ten bespoke charts will drift exactly the way the
four hand-written provider-job bodies drifted before `run_provider_specs`, and
the way three duplicated page components drifted before the sport adapters. Both
precedents are already in `CLAUDE.md`. This is the same argument a third time.

**Second constraint:** `PlayerDetail.tsx` is 106KB and `GameDetail.tsx` is 105KB.
A dozen inline charts makes both unworkable. The library is the only way the
scope fits.

### The mockup

**Open `docs/design/chart-grammar.html`** — committed, self-contained, no build
step and no dependencies except a Google Fonts link that degrades to system
fonts offline. Double-click it, or serve it (`.claude/launch.json`'s
`design-preview` config serves `C:/Users/occy3/Downloads`, so copy it there).
**This file is the reference, not the artifact link below.**

There is also a published artifact at
https://claude.ai/code/artifact/845e36d0-037c-4859-af5b-185a6aba795c — but
**artifacts are private to the account that published them.** This project runs
across three rotating accounts; only the account that published it (the one used
on 2026-08-29) can open or update that URL. From any other account the link is
dead, and re-publishing the file creates a *separate* artifact owned by that
account, which is fine — just don't expect the old URL to update. The committed
HTML is the single source of truth; the artifact is a convenience.

All eleven primitives rendered in the app's real tokens, plus a **full-depth
Player Detail** — ~190 numbers on one page: nine ranked season stats, eleven
Statcast metrics with percentiles, a 10×5 splits grid, five platoon comparisons,
nine zone cells, five pitch types, a twelve-game log, seven opposing-pitcher
rates, career matchup, park and weather, six book prices, seven model
contributions. Data is representative, not live — the frame carries a visible
banner saying so.

The first composed screen was rejected by the operator as *"doesn't have any
stats / not nearly as in depth from a stats and visual standpoint"*. That
rejection is the useful part: **depth is the product**, and a page that only
demonstrates the primitives misses the point.

### THE PER-SPORT QUESTION — measured and answered (2026-08-29, later session)

The operator's words were *"concerned with how we will get an every other sport
equivalent."* **Measured first, then built. Both are done; the direction needs
sign-off, not more analysis.**

#### The measurement overturned the premise

`player_game_history` is JSONB and sport-generic, so one query per sport gives
the real ceiling. 2,756,058 rows:

| Sport | Rows | Athletes | Distinct stat keys |
|---|---|---|---|
| NFL | 226,629 | 6,740 | **57** |
| CFB | 273,649 | 33,868 | **53** |
| MLB | 727,613 | 4,003 | 27 |
| NHL | 674,003 | 2,972 | 21 |
| NBA | 279,661 | 1,567 | 17 |
| Soccer (EPL+MLS) | 302,539 | 5,361 | 16 |
| Tennis (ATP+WTA) | 271,964 | 17,846 | **8** |
| Golf | — | — | not in this table at all |

**MLB is not the deepest sport in this database — it is mid-table.** NFL and CFB
carry roughly twice its vocabulary. MLB's *page* is deeper only because Statcast
is a separate source, which is a statement about sourcing, not about the sport.
Two consequences: **tennis (8 keys) is the real constraint**, not "the tail";
and **golf is absent entirely** — own schema, own blocks, already partly built.

Reproduce with `SELECT stats FROM player_game_history WHERE sport=$1 LIMIT 60000`
plus `jsonb_each_text`. **Do not add `ORDER BY id DESC`** — the index is
`(sport, athlete_id, season, game_date)`, so ordering by `id` under a `sport`
filter is a full scan on 2.75M rows and times out. That cost three attempts and
looked exactly like pooler congestion.

#### The answer: six universal ROLES, not six MLB fields

The blocks that looked MLB-only — pitch mix, strike zone, platoon, park factors,
opposing starter, batter-vs-pitcher — are not MLB *concepts*. They are MLB's
instance of six roles every sport fills with its own content:

| Role | MLB | NFL / CFB | NBA | NHL | Soccer | Tennis | Golf |
|---|---|---|---|---|---|---|---|
| `opponentUnit` | Opposing starter | Defence vs position | Defence vs guards | Opposing goalie | Keeper & back line | Opponent profile | The field |
| `usageMix` | Pitch mix | Route mix | Shot-zone mix | Shot-type mix | Shot-type mix | Serve mix | Approach distance |
| `spatialGrid` | Strike zone | Target map | Shot chart | Shot location | Shot location | Serve placement | Proximity by lie |
| `binarySplit` | vs LHP/RHP | man / zone | top / bottom D | PP / EV | home / away | hard / clay | par 5 / par 4 |
| `conditions` | Park, wind | Roof, wind, surface | Rest, travel | Rest, opp starts | Pitch, weather | Surface, speed | Wind, greens |
| `careerH2H` | vs this pitcher | vs this defence | vs this team | vs this goalie | vs this club | vs this opponent | at this course |

Rename those six fields on `PlayerDetailData` and the "seven empty pages"
problem disappears without touching `CLAUDE.md`'s conventions. The `null`-renders
-nothing rule of §4 stays exactly as written — it just stops being load-bearing
for the common case, because a *role* is fillable by every sport. This is
candidate shape 2 from the handoff prompt, sharpened: not "spine + extensions"
but **one spine, filled eight ways**.

#### It is built, not argued

**`docs/design/player-detail-per-sport.html`** — committed, self-contained, no
build step. Eight tabs, one template, one `renderSport(data)` with **no
`sport ===` check anywhere in it**. Verified in-browser: all eight tabs render
with zero console errors, 20 cards and 9 SVGs each, and no page-level horizontal
overflow. ~370 individual numbers per sport.

Regenerate with `node docs/design/build-per-sport.mjs`. It splices
`chart-grammar.html`'s `<style>` and both primitive `<script>` blocks in
**verbatim** and applies four asserted patches — deliberately, so that if the two
pages ever diverge visually it is a real bug in a primitive rather than a copy
that drifted. Each patch throws by name if its anchor moves. Sources are the
`_ps-*` files beside it.

#### Finding: a primitive already had MLB baked into it

`zoneGrid` hardcoded three MLB things — the domain (0.20–0.65), the caption
("catcher view / xwOBA"), and the number format (baseball's strip-the-leading
-zero). NFL's 14.8 yards-per-target rendered as **"4.800"** — a wrong number
displayed, found only by looking at the built page rather than the DOM. Fixed by
taking `lo`/`hi`/`fmt`/`unit`/`caption` from options with MLB's values as
defaults. **`chart-grammar.html` still has the unfixed version** (harmless there,
it is MLB-only) — carry the fix into the real `components/charts/` primitive.

The general lesson, and it is the same one §4 keeps paying for: the leak was in
the shared primitive, not in a page. When porting these to React, **the first
sport to use a primitive gets to define its defaults, so audit every literal in
one before a second sport touches it.**

#### What still needs the operator

1. **Sign off the six role names**, or rename them. Everything else follows.
2. **Tennis is a data-sourcing task, not a layout one.** Its page holds up in the
   mockup because the roles pull from match structure (serve placement, surface,
   opponent profile) rather than the 8-key game-log JSONB. Nothing sources that
   today. Decide whether tennis ships at this depth or at a stated lower one.
3. **Golf's escape hatch is legitimate**, not laziness — separate schema, and
   `liveMatchup`/`golfFormHoles` already exist for it.

### TEAM DETAIL — measured and built (2026-08-29, same session)

Operator approved the player-side answer, then asked for the same treatment on
Team Detail. Same method: measure, then build it.

#### The measurement inverts the player-side result

| Sport | Team adapter | Elo rows | Span | Teams | Game markets priced |
|---|---|---|---|---|---|
| MLB | yes | **78,550** | **2010-2026** | 30 | ML, total, spread |
| NHL | yes | 2,996 | 2025-26 | 32 | none yet |
| NBA | yes | 2,794 | 2025-26 | 37 | none yet |
| CFB | yes | 1,916 | 2025-26 | 236 | ML only (344) |
| Soccer | yes | 1,778 | 2025-26 | 55 | ML, total, spread |
| NFL | yes | 736 | 2025-26 | 34 | **ML only (72)** |
| Tennis | **NO** | 0 | — | **0** | player-level only |
| Golf | **NO** | 0 | — | 0 | player-level only |

On the player side MLB was mid-table. **On the team side MLB is the deep one by
an order of magnitude** — sixteen years of Elo against one season for everyone
else.

**Tennis and golf have no team page, and that is correct.** All 271,964 tennis
rows carry a null `team_id` — zero distinct teams, by construction.
`TeamDetailPanel` already dispatches on exactly six sports and neither has a
`teamDetailAdapter.ts`. `team_elo_history` independently covers exactly those
same six. Three separate signals agree. **Do not build a seventh and eighth tab
that render an apology** — for tennis the player page *is* the entity page.

#### The leak here is worse than the player side's

`TeamDetailData.grades` is `TeamGrades | null`, commented *"NFL-only — MLB has
no grading model, always null."* `TeamGrades` hardcodes **nine NFL unit names**
(`specialTeams`, `secondary`, `linebackers`, `dLine`, `passingOffense`…). No
other sport can fill that shape, so no other sport gets grades. Meanwhile **the
NBA and NHL adapters emit no `statGroups` at all** — their team pages are the
thinnest in the app today.

One generic `unitGrades: Array<{ key, label, grade, rank }>` fixes both. NFL
keeps nine; MLB declares hitting/pitching/fielding/bullpen; NHL declares
offence/defence/power play/penalty kill — the case the hardcoded shape cannot
express at all.

#### Built

**`docs/design/team-detail-per-sport.html`** — seven tabs (six teams + golf's
*tournament*, its structural sibling), one `renderTeam()` with no `sport ===`
check. Verified in-browser: zero console errors, 22 cards and 9 SVGs per tab,
~460 numbers each, no horizontal overflow. Two blocks are genuinely team-only —
**roster and standings** — and both already exist in `TeamDetailData` with their
sport differences correctly data-driven (`rosterSortByStats`, `rosterPageSize`);
extend that pattern rather than replace it.

#### Second primitive with a first-sport assumption baked in

`rollingChart` forced `lo = 0` — right for a count stat (hits, receiving yards),
which is what it was first written against; **wrong for a rating**. The Elo
series spanning 1460–1590 collapsed into a flat strip with ticks at 0.0 / 590.2
/ 1180.5. Fixed with an opt-in `zeroBased: false` (plus `cfg.fmt`), so every
existing caller is untouched — confirmed by re-running the player board and
getting byte-identical counts with its axes still starting at 0.0.

**That is the second primitive in two boards with its first sport baked in, and
both were found by LOOKING at the built page, not by querying the DOM.** The
standing rule for `components/charts/`: *the first sport to use a primitive
gets to define its defaults, so audit every literal in one before a second sport
touches it.* Both fixes live in `docs/design/build-lib.mjs` and still need
carrying into the real React primitives; `chart-grammar.html` holds the unfixed
originals (harmless there — it is MLB-only).

#### Build layout

`build-lib.mjs` now owns extraction and all eight patches; `build-per-sport.mjs`
and `build-team-detail.mjs` are ~15 lines each. The team script began as a
`sed` copy of the player one, and the very first patch after that copy
(`divFill` in the IIFE preamble) existed in only one of them — so it was
factored immediately. Same argument as `run_provider_specs`, third occurrence.

#### What still needs the operator

1. **Sign off `unitGrades` replacing `TeamGrades`.** Everything else follows.
2. **Market coverage is the blocking data gap.** `game_odds_book_lines` has NFL
   on **moneyline only, 72 rows**, and CFB moneyline only. The splits grid and
   the price block both assume a spread. This is the team-side equivalent of
   tennis on the player side, and it is bigger.
3. **The Elo depth gap is real and should stay visible** — one season for five
   of six sports. Honest fix is a shorter axis with the real span labelled, not
   a fabricated backfill.

### GAME DETAIL — measured and built (2026-08-29, same session). Trilogy complete.

Third and last shared page. Same method.

#### The three pages have different sport counts, and that is the answer

| Sport | Player | Team | Game |
|---|---|---|---|
| MLB, NFL, CFB, NBA, NHL, Soccer | yes | yes | yes |
| Tennis | yes | **no team** | **yes** — a match IS a game |
| Golf | yes | **no team** | no adapter, but `liveMatchup` already models a tee-time pairing |

Not "eight everywhere". A tennis player has no team but plays a match; a golfer
has neither, yet `PlayerDetailData.liveMatchup` already carries a hole-by-hole
scorecard against a groupmate — the same entity a game page renders. Both the
team and game boards ship the honest count rather than a tab that apologises.

#### This is the leakiest of the three interfaces

`GameDetailData` carries **eight sport-named fields**: `unitGrades`
("NFL-only"), `hero.awayGrades`/`homeGrades` (the same nine-field NFL
`TeamGrades`), `propsForGame` ("NFL-only"), `leftRail.nflTeamScope`,
`hero.mlbLiveGame`, `hero.mlbGamePk`, `hero.liveExtraText` (NFL down &
distance), and `pregameLines.moneyline.draw` — soccer's real third outcome and
the **one genuinely-earned exception** on the list.

#### `CLAUDE.md` §4's own example is wrong, and this is measurable

§4 cites `statComparison.bars` (MLB) vs `.ranked` (NFL) as the model case for
"genuinely different UI gets named mutually-exclusive fields". Measured:

- **MLB is the only sport that fills `bars`.**
- NFL, CFB and soccer all fill `ranked`.
- **NBA, NHL and tennis fill neither — the block is blank on three of seven pages.**
- Every one of the seven populates `rankings`, so ranks exist everywhere.

That is not a genuine difference; it is the "leftover placement accident from
the port" §4 itself warns about two paragraphs later. MLB was ported first and
got bars; NFL came second and added a second shape rather than adopting the
first. **Collapse to `ranked`, have MLB's adapter emit ranked rows from the
`rankings` data it already produces, and three blank blocks fill in.** Then
replace §4's example with `pregameLines.draw`, which is genuinely earned.

#### The book grid is the thinnest thing in the app

`game_odds_book_lines`, the centrepiece of a game page:

| Sport | Books | Markets | Games |
|---|---|---|---|
| Soccer | 19-23 | 3 | 41-47 |
| MLB | 21-22 | 3 | 32-33 |
| CFB | 4 | 1 (ML) | 54 |
| Tennis | 3 | 1 (ML) | 88 |
| NFL | 3 | 1 (ML) | 12 |
| **NBA** | **0** | **0** | **0** |
| **NHL** | **0** | **0** | **0** |

**NBA and NHL have no rows at all.** A bookmaker grid with three columns is not
a grid, and on two tabs it is empty. Fix sourcing before building the block.
`game_odds_history` (50,396 rows, 478 events, 21-22 books) is keyed on
`event_id` with no sport column, so line-movement history is sport-agnostic and
in better shape than the current-price grid.

#### Built

**`docs/design/game-detail-per-sport.html`** — eight tabs, one `renderGame()`,
no `sport ===` check. Verified: zero console errors, 22 cards and 9 SVGs per
tab, ~390 numbers each, no horizontal overflow. Four blocks exist on neither of
the other two pages: `bookGrid`, `injuries`, `matchupKey`, `officials`.
**`officials` is missing from the app entirely today** and is real for every
sport — a plate umpire's strike zone, a crew's penalty rate, a referee's
cards-per-game all move totals.

#### Cross-cutting, now that all three are done

- **One shared `build-lib.mjs`** owns extraction plus all eight asserted patches;
  the three build scripts are ~15 lines each. All three boards splice
  `chart-grammar.html`'s primitives **verbatim**, so a visual difference between
  boards is a real primitive bug, not a drifted copy.
- **Two primitives had their first sport baked in, both found by LOOKING at a
  built page rather than querying the DOM** — `zoneGrid` (MLB's number format,
  domain and caption; NFL's 14.8 rendered as "4.800") and `rollingChart` (a
  zero-based axis that flattened a 1460-1590 Elo series). The `rollingChart` fix
  then paid for itself immediately: the game board's win-probability charts
  needed exactly the same `zeroBased: false` + `fmt` options.
  **Standing rule for `components/charts/`: the first sport to use a primitive
  defines its defaults, so audit every literal in one before a second sport
  touches it.** Both fixes still need carrying into the real React primitives.
- **The recurring shape across all three boards is `unitGrades`.** It fixes
  `TeamDetailData.grades`, `GameDetailData.unitGrades`, and
  `GameDetailData.hero.awayGrades`/`homeGrades` — three fields on two pages,
  one type change. Do it first.
- **Every board ended at the same kind of blocker: sourcing, not layout.**
  Tennis player-level stats (8 keys), NFL/CFB spreads on the team board, and
  NBA/NHL book lines on the game board. The layout question is answered three
  times over; the data question is now the whole remaining risk.

#### What still needs the operator

1. **Sign off collapsing `statComparison` to `ranked`** and correcting
   `CLAUDE.md` §4's example.
2. **Sign off `unitGrades`** (carried from the team board — same decision).
3. **Decide the sourcing order** for the three gaps above. Nothing else on
   Phase 6's UI work is blocked by design any more.

### DATA-GAP AUDIT — what the three boards need that we lack (2026-08-29)

**`docs/design/phase6-data-gap-audit.md`** — measured, not recalled. Read it
before scheduling any Phase 6 sourcing work.

Headline: **the layout is not the risk.** The tape, splits grids, game logs,
rolling form and Elo history on all three boards are fully sourced today. Five
blocks have no source, and the biggest constraint is not a vendor:

- **`pick_history` is MLB 369,185 / soccer 381 / everything else ZERO**
  (`game_picks`: mlb 176, soccer 24, nfl 16, cfb 8). Every "Model %", "Edge",
  grade and "why the model likes it" block on all three boards, on every tab, is
  MLB-only today. **Biggest single gap, and it needs no new vendor** - the game
  logs and closing lines to grade against are already stored.
- **Officials/umpires: zero hits across the whole tree.** The one entirely
  invented block on the game board. New integration per sport, nothing reusable.
- **Statcast is 4 metrics, season-aggregate.** `savant.ts` already calls the
  pitch-level endpoint (`type=details`) but passes `group_by=name`. Ungrouping
  that one parameter yields zone, pitch_type and xwOBA per pitch - the strike
  zone, the pitch mix, and 7 more Statcast metrics. **Cheapest high-value item
  on the list.**
- **Same pattern twice more:** Understat is wired but only its league-level
  goals-against endpoint (shot x/y/xG unused; EPL only, MLS has none); nflverse
  is wired but only weekly box scores (play-by-play with air yards unused).
- **MLB-only and needs generalising:** `game_sim_cache` (sport column exists,
  only mlb populated), `park_factors`, and the open-meteo weather wiring.
- **Tennis point-level data has no source at all** - a paid-vendor decision.

**Nothing on that list blocks starting `components/charts/`.** A block with no
source renders its empty state, which the grammar already defines. Sourcing and
chart work are independent and can run in parallel.

### Two design-system findings, measured this session

1. **`lib/ui/heat.ts` — `FILL_STOPS` is a diverging ramp with a *hue* at its
   midpoint.** Ran the poles through a CVD validator: they **PASS** at deutan
   ΔE 8.4 against a floor of 8.0 — a genuinely well-chosen red/green pair, but
   clearing by only 0.4, so secondary encoding (sign, position, a visible
   number) is required wherever the ramp does real work. The actual defect is
   that **amber asserts "caution" where the data only says "average"**, and amber
   is the one stop failing contrast at 2.87:1. `COMPARE_STOPS` already gets this
   right (red → neutral grey → green) and its own comment reasons it out
   correctly — the reasoning was never carried back to the fill ramp. Lightness
   runs 54.9 → 68.0 → 51.3: correct arch for *diverging* use, wrong for the
   *sequential* `heatTile` splits-grid case, where a monotonic single-hue ramp is
   needed. **Caveat, so nobody re-litigates it:** running the neutral-midpoint
   version through the validator returns `[FAIL] Chroma floor` on the grey. That
   check is scoped to *categorical* palettes; a diverging midpoint is supposed to
   be achromatic. The FAIL is the tool applying the wrong rule.

2. **`card` (oklch 93%) is DARKER than `paper` (oklch 96%)** in
   `tailwind.config.ts`. Pre-reskin it was page `#f7f5f0` / card `#FFFFFF` —
   cards sat *above* the page, which is what a card is. The graphite reskin held
   paper and dropped card, inverting the elevation model that `shadow-card` and
   `.lb-card-hero` assume; `surface-subtle` (96%) is then *lighter* than the card
   it insets into. It reads fine as recessed panels — but confirm it was chosen
   rather than inherited from a find-and-replace.

## 7. Known not done — carried into Phase 6

1. **Duplicate React keys can silently omit prop rows.** Console shows many
   `Encountered two children with the same key` errors (`mlb:672515:total-bases:over`,
   `soccer:espn:soccer:222396:anytime-goalscorer:yes`). React's own message says
   children "may be duplicated and/or omitted" — correctness, not noise. The key
   at `GolfScheduleView.tsx:1244` and `TennisScheduleView.tsx:529` omits the game
   id, and a player legitimately has candidates for two games (834 soccer players
   measured; MLB doubleheaders too). **Pre-existing, not a Phase 4/5 regression**
   — the key last changed 2026-08-27 (`2913d81`). One-line fix; unowned.
2. **MLB total residual, ~1 point** — Q40, accepted deliberately.
3. **`fit_moneyline_weights` and `market_gate` are on no automatic path.**
   `/api/props/fit-weights` (TypeScript) is still the only way to fit moneyline.
4. **5.1's second VERIFY half** — §3 item 2.
5. **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
   credentials; creating an account or entering a password is out of bounds.
6. **`refreshSportsGameOddsJob` has not run since 04:38Z**, on vendor 429s.
   Pre-existing, unowned.
7. **`snapshotCacheSize` unhealthy** — 12.6 MB against a 10 MB bound.
8. **Sharp coverage 9.08%**, under 5.2's own 10% threshold. Recommendation only
   — **nothing purchased**.
9. **2,380 duplicate observation groups in `game_odds_history`** — revealed, not
   created, by 5.13. Owner: 6.1.
10. **3.15's two GET-path writers** — carried from Phase 3.
11. **No push alerting** (Q19) — Phase 8. **Rate limiting per-process** — Phase 8.
12. **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.

## 8. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |
| `pick_history_game_model_backup_20260829` | 3,580 | 4.8 (Q25) |

All five are still on a Free-tier database.
