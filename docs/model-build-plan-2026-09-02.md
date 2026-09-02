# Model build plan — game models and prop models, phased by sport

**Written 2026-09-02**, after a pre-flight audit of every table these models
would read. Supersedes the sequencing in `docs/model-rebuild-plan.md` §7; that
document's §1 (the four bars) and §5 (the two-system split) still govern.

The locked model choices come from two artifacts the operator approved on
2026-09-01 and are reproduced here rather than re-argued:

- Game models — `https://claude.ai/code/artifact/edaa8640-b66f-4ec5-9e2c-99f11f0ad4c8`
- Prop models — `https://claude.ai/code/artifact/56c16cd2-99d5-429c-a93b-99e39cc88833`

---

## 0. Pre-flight audit — read this before anything else

Six findings. Five are blockers. The sixth is a counting trap that caught this
audit — the numbers already in `CURRENT.md` were right, and are confirmed here.

### 0.1 A COUNTING TRAP — verified, and the recorded counts were already right

**`CURRENT.md`'s numbers are correct and this audit confirms them.** Recording
the trap because it caught this audit and will catch the next one.

`event_ref` is **NULL** for the SBR (NBA/NHL) and football-data (EPL/MLS)
sources — 0.0% populated, against 100% for every other source. Counting games
as `DISTINCT (event_ref, game_date)` therefore collapses each season to its
distinct *dates*: NBA 2013 comes back as 209 games when it is 1,323. The error
is silent, it passes every type and structural check, and it looks like a
plausible answer.

**Use `DISTINCT (game_date, home_team_id, away_team_id)`** for any per-game
count that spans sources. Confirmed at that key:

| Sport | Moneyline | Spread | Total | Dense seasons |
|---|---|---|---|---|
| MLB | **31,780** | 22,013 | 31,778 | 2010–2021, 2025–26 |
| NBA | **24,705** | 24,700 | 24,701 | 2008–2019, 2021–2025 |
| NHL | **24,336** | 15,947 | 24,336 | 2008–2019, 2021–2025 |
| CFB | 4,017 | **13,569** | 13,065 | 2021–2025 |
| NFL | 5,355 | **7,336** | 7,336 | 2006–2025 |
| MLS | **6,397** | 871 | 871 | 2012–2026 |
| EPL | **4,200** | 400 | 400 | 2016–2025 |

Two structural checks pass cleanly at this key: **rows per game is exactly 2.00**
for every two-way moneyline and total (3.00 for soccer moneyline, correctly —
the draw), so no market carries a duplicated or missing side. And **96.7%–100%
of priced games reach a result** (MLB 99.8%, NBA 100.0%, NHL 99.9%, EPL/MLS
100%, NFL 98.0%, CFB 96.7%).

Density per season confirms the same thing independently: NBA and NHL are at
or above 100% of a full season for 2008–2019 and 2021–2025, EPL for 2016–2025,
NFL for 2006–2025. The deep history is real.

### 0.2 BLOCKER — no postseason game has ever entered `player_game_history`

Two filters, one per discovery path, both meaning *regular season only*:

```python
# backfill_player_game_history.py:592  (NHL)
if g.get("gameType") != 2:        # 2 = regular season, 3 = playoffs
    continue
# backfill_player_game_history.py:559  (every ESPN sport)
if cfg.espn_regular_only and s.get("type") != 2:
    continue
# ...and espn_regular_only defaults to True (line 79)
```

`predict/generic_freshness_job.py` mirrors both, by design — its docstring says
it uses "the same completed/regular-season filters". So this is not a stale
backfill; it is the **ongoing** ingest path, and it will drop every postseason
again next season.

Measured cost:

| Sport | Player history ends | Odds end | Gap | Priced games with no history |
|---|---|---|---|---|
| NHL | 2026-04-16 | 2026-06-15 | 60d | 172 |
| NBA | 2026-04-13 | 2026-06-14 | 62d | 91 |
| NFL | 2026-01-05 | 2026-02-08 | 34d | 129 |

**43,678 props can never be graded** — NHL 17,092, NBA 25,662, NFL 924 — because
the games they sit on have no player rows and never will. This is also most of
why NHL props join to an outcome at only 49.6% where MLB reaches 85.9%.

Beyond the lost rows, it biases every model trained on what remains: playoff
hockey and playoff basketball have different rotations, pace and intensity, and
they are systematically absent.

**Fix before any prop work.** Both filters, plus a re-run of the backfill for
the affected seasons.

### 0.3 BLOCKER — the training archive is frozen; new games do not enter it

The live jobs and the training tables are two disconnected systems.

```
odds_archive        1,587,670 rows   100% written in the last 24h   (the import)
prop_odds_archive   1,805,340 rows   100% written in the last 24h   (the import)
game_result           172,647 rows   100% written in the last 24h   (the import)

prop_odds             253,716 rows   written 0.0h ago               (live jobs)
game_odds_book_lines    8,995 rows   written 0.0h ago               (live jobs)
```

Every row in the three training tables arrived in one import. Nothing writes
them on a schedule — the only code that references `odds_archive` outside the
loaders is `lib/sports/mlb/gameModelBackfill.ts`, itself a backfill. Meanwhile
the `JOB_REGISTRY` provider jobs are running fine and writing to
`prop_odds` / `game_odds_book_lines`, which no model reads.

**So the archive is a snapshot dated 2026-09-01.** Without a bridge, every model
trained on it begins decaying the day it ships, no backtest can ever include a
game played after the import, and the CLV evidence base never grows. This is the
single highest-value piece of infrastructure in this plan and it is §2.6.

### 0.4 BLOCKER — MLB 2022, 2023 and 2024 are missing from the archive

`odds_archive` MLB moneyline runs 2010–2021 (SBR xlsx) and 2025–2026 (ESPN).
The three seasons between are **absent** — the xlsx files only go to 2021 and no
2022–2024 source was ever imported.

`historical_odds` does hold them — 2022: 2,641, 2023: 2,764, 2024: 2,748, or
**8,153 games** — but only as consensus probabilities, and those sum to exactly
`1.0000` in every season. They are **already de-vigged**. There is no vig, so
they cannot support an EV or CLV calculation; they can only serve as a
market-opinion benchmark and a training signal.

Consequence: MLB's usable history is 2010–2021 plus 2025–26, with a three-season
hole in the most recent and most relevant pre-ESPN period.

### 0.5 BLOCKER — ESPN spread rows carry only the home side

| Sport | Source | Sides stored | Prices |
|---|---|---|---|
| MLB | sbr_mlb | home + away | 18,194 / 18,195 |
| NHL | sbr | home + away | 9,485 / 9,486 |
| NFL | nflverse | home + away | 5,407 / 7,388 |
| **NBA** | espn_core + sbr | **home only** | 18,214 of 56,668 |
| **EPL / MLS** | espn_core | **home only** | 400 / 870 |
| **CFB** | cfbd | home + away | **zero prices — lines only** |

Totals are unaffected — ESPN stores both `over` and `under`. It is specific to
spread. Where only one side exists **the spread cannot be de-vigged**, so for
NBA, EPL, MLS and CFB a spread model must be judged against the posted line and
a single price, not against a fair two-way probability.

### 0.6 BLOCKER — tennis has no surface, and surface is the approved model

The approved tennis model is **surface-weighted Elo**. Surface is not in
`player_game_history.stats` (8 keys: `games_won`, `games_lost`, `sets_won`,
`sets_lost`, `match_won`, `tiebreaks_played`, `is_major`, `is_qualifying`) and
not a column on `odds_archive`. The artifact assumed it "sits in your .xlsx
files but isn't loaded yet". That must be confirmed and loaded, or tennis drops
to plain Elo — which the same artifact explicitly rejected as too blunt.

### 0.7 Market names need canonicalising

| Sport | Distinct `type_name` | Markets carrying 90% of volume |
|---|---|---|
| MLB | 36 | 22 |
| NBA | 41 | 11 |
| NFL | 70 | 23 |
| NHL | 20 | 11 |

A canonical market key is a prerequisite for training any prop model across
sources. The long tail is genuinely long, but the head is short: **11 markets
cover 90% of NBA and NHL**.

### 0.8 Data that is confirmed present and good

- **`player_game_history`: 2.80M rows**, 9 sports, MLB 727,613 / NHL 724,002 /
  NBA 279,661 / CFB 274,207 / NFL 226,629 / EPL 168,773 / tennis 264,448 /
  MLS 134,349.
- **Stat keys are sufficient** for every model below: MLB has full
  plate-appearance batting and pitching; NHL has `toiMinutes` on 100% of rows
  plus `sog`, `goals`, `saves`, `isGoalie`; NBA has `minutes` and every counting
  stat; NFL has 57 keys including all `passing.*`, `receiving.receivingTargets`
  and `rushing.rushingAttempts`.
- **Props that reach a graded outcome**: MLB 1,083,266 (85.9%), NBA 183,408
  (86.4%), NFL 147,241 (93.9%), CFB 39,751 (88.3%), EPL 36,082 (56.5%),
  NHL 34,171 (49.6%, and §0.2 explains the shortfall).
- **The harness exists.** `predict/walkforward.py`, `predict/clv_backtest.py`,
  `predict/platt_calibration.py`, `predict/model_benchmark.py`,
  `run_walkforward.py` and the `shadow` flag are all present and are what
  produced every measurement in `model-rebuild-plan.md`.

### 0.9 Confirmed absent — do not plan around these

- **NFL/CFB snap counts** — 57 NFL keys, none measure snaps. (Targets and
  carries are the better exposure measure for the markets that actually trade;
  see Phase 7.)
- **Soccer minutes** — `isStarter`, `subIns` and `appearances` only.
- **Tennis serve data** — no aces, double faults or first-serve percentage.
- **MLS prop crosswalk** — 4.5% joinable, 60 athletes. MLS props are out of
  scope anyway.

---

## 1. The standard

Unchanged from `model-rebuild-plan.md` §1, restated because every phase gate
below references it.

1. **Graded** — it predicts something that gets settled against a real outcome.
2. **Beats the base rate** — the naive prior for that market.
3. **Beats the market price, out-of-time.** The only bar that matters
   commercially.
4. **Calibrated** — when it says 60%, 60% happens, checked in buckets.

Three non-negotiables carried forward:

- **Market probability is never a feature.** This is the whole lesson of the
  audit: the old MLB moneyline model's largest coefficient was
  `marketProbCentered` at 3.5170, which is why it tied the market and reported
  edge that was its own noise.
- **The thing that decides whether a model ships is not the thing that fitted
  it.** Walk-forward, out-of-time, no exceptions.
- **A new model ships behind the `shadow` flag** and only comes out when it has
  cleared bar 3 on held-out data. That flag already caught the home-run model
  adding 0.4% and kept it off the page with no human involved.

**One calibration on bar 3 for props specifically.** Measured 2026-09-02 on
235,210 graded MLB props, the archive's closing price is *not* sharper than its
opening price — Brier 0.2020 close against 0.2013 open, across every market
tested. Beating this close is therefore a **softer bar** than beating an NFL
sides close, and a positive result must not be reported as if it were the same
thing. It also means **line movement is a weak prop feature**: 69% of MLB prop
prices moved and the movement predicted nothing. Test it before building on it.

---

## 2. Shared infrastructure — built once, used by every sport

Seven sports, but **three engines and one harness**. The per-sport phases in §3
are mostly configuration of what this section builds.

### 2.1 The training-set builder

One function per sport that returns a table of *(game, features, outcome,
closing price)* with a hard as-of guarantee: **every feature is computed only
from games that finished before the modelled game started**. `event_start` is
now on `odds_archive`, `prop_odds_archive` and `game_result`, which is what
makes this checkable rather than assumed.

The leakage guard is not optional and it already has a test to extend —
`test_leakage_guard.py`. The generic-sports job once built "predictions" from
game logs that already contained the outcome; that is the failure this exists
to prevent.

### 2.2 The walk-forward harness

`predict/walkforward.py` and `run_walkforward.py` exist and work. Expanding
window: fit on seasons 1..n, predict season n+1, roll forward, never letting a
later season inform an earlier prediction.

Known real cost, measured and documented in `run_walkforward.py`'s own
docstring: **one MLB season's training set took ~8.5 minutes** to build, and a
full 16-season walk-forward is a multi-hour operation. It is deliberately not in
`JOB_REGISTRY` — the queue's per-job timeout is 10 minutes — and stays a
human-triggered CLI. Do not try to schedule fitting.

### 2.3 The CLV backtest

`predict/clv_backtest.py` exists. For every model pick, compare the price
available when the pick was made against the closing price, and record whether
the pick beat it.

This is the bar-3 instrument and it is the reason the sourcing round happened.
It needs roughly **hundreds of bets** to detect a real edge, against roughly
**10,000** for a raw ROI measurement — which is the entire argument for judging
on CLV rather than on profit.

### 2.4 Calibration

`predict/platt_calibration.py` exists. Fit on a held-out slice, never on the
training fold. Report in buckets, never as an average — an average can be
perfect while every band is wrong in alternating directions, which is exactly
what the old prop model did when it said 0.93 and delivered 0.686.

### 2.5 The ship gate

A model leaves `shadow` only when, on data it never saw:

- it clears bars 1, 2 and 4, **and**
- it clears bar 3 — positive CLV over a sample large enough to mean something,
  reported with its own sample size, **and**
- for props, the rank-correlation check in §4 holds.

Failing to ship is a real outcome and gets written down. "That is a real answer
worth having before seven more sports of work."

### 2.6 Forward ingestion — the archival bridge (§0.3)

**This is the piece that does not exist and must be built before any model
ships**, because without it every model decays from its first day.

A scheduled job that promotes settled games from the live tables into the
training archive:

1. At each game's `event_start`, capture the last pre-game price per
   (game, market, side) from `game_odds_book_lines`, and per
   (game, athlete, market, line) from `prop_odds`. That is the closing line, and
   capturing it at the right moment is the only way it is ever correct — the
   archive's own prop "close" is not sharper than its open precisely because it
   was not captured this way.
2. After settlement, write the outcome to `game_result`, and the player stat
   line via the existing freshness job.
3. Write both into `odds_archive` / `prop_odds_archive` with a distinct
   `source`, so archived-live rows are separable from imported history.

It follows the existing job architecture exactly — a `JOB_REGISTRY` entry, a
`_run_timed` breadcrumb, and `health_check.py` picks it up with no edit of its
own. It goes through `db.write_*` so `canonical_bookmaker` normalisation applies
at the shared writer, per CLAUDE.md.

**Two things it must get right**, both learned the hard way in this codebase:
`is_live` must be set so in-play prices never enter the training set (48,489 of
them did, scoring Brier 0.032 against 0.22 and invisible in the aggregate), and
the natural key must include `COALESCE(event_ref,'')` so doubleheaders are not
silently collapsed (524 games were).

### 2.7 What gets deleted

Per `model-rebuild-plan.md` §6, and unchanged: every row of `model_weights` and
`model_calibration` (they encode the market anchor), the `edge_model` /
`prop_score` / `good_bets` / `live_edge` scoring layer, the generic six-sport
prop pipeline, and golf's model layer.

Nothing a user can currently see breaks. The edge badge already returns null,
confidence is hardcoded null, and the score grade renders an empty div.

---

## 3. The sports, in build order

Order merges the two approved orders, which differ — the game artifact
recommended tennis → soccer → NBA, the prop artifact MLB → NHL → NFL → NBA.
The merge below is grouped **by engine** so each engine is built once and
pointed at its second sport immediately, and so that MLB's game model (which
emits the props for free) precedes MLB props. **Flagged as a deviation for
approval**, since neither approved order is followed exactly.

Every phase has the same five parts: the model, how it works, the data, how it
is trained and tested, and what it must clear to ship.

---

### Phase 1 — Tennis (game) · surface-weighted Elo

**Why first.** Simplest engine, most matches, fewest moving parts. It proves the
whole chain — fit, walk-forward, calibrate, compare to the close — on the
easiest possible case before that chain is trusted anywhere harder.

**Simply.** Elo is the chess rating. Everyone starts at 1500. Beat someone
stronger and you gain a lot; lose to someone weaker and you drop a lot. The gap
between two ratings converts to a win probability. It suits tennis better than
any other sport here because a tennis match is *only two players* — no lineup,
no teammates, no coach — so a single number really can describe a competitor.

**In detail.** After each match, `R_new = R_old + K · (S − E)`, where `E` is the
expected score from the rating gap and `S` is 1 or 0. Run the same fit
separately per surface, then blend the surface rating with the overall rating —
clay and grass are close to different sports, and averaging them is wrong in
both directions. `K` and the blend weight are the only fitted parameters.

**Data.** 56,340 matches; 231,383 ATP and 217,531 WTA odds rows; the tennis
crosswalk resolves 1,186 players (87.0% ATP / 84.6% WTA of player slots).
**Blocked on §0.6** — surface must be loaded first.

**Train and test.** Chronological walk-forward by year, 2016 onward. Elo is
naturally online, so the walk-forward is close to free: replay matches in
order, and score each match using only the rating that existed before it.

**Ship gate.** Positive CLV against the closing moneyline on held-out years.
Bucketed calibration. If surface cannot be sourced, plain Elo does **not** ship
in its place — write down that tennis is blocked and move on.

---

### Phase 2 — Soccer, EPL + MLS (game) · Dixon-Coles

**Why second.** It builds the scoring-rate engine, which Phase 3 and Phase 4
then reuse. Three sports from one build.

**Simply.** Give every team two numbers: an **attack** rating and a **defence**
rating. Expected goals for the home side = home attack × away defence × a
home-advantage bump; same the other way. Then assume goals arrive at random at
those rates and work out the probability of every scoreline — 0-0, 1-0, 2-1.
Add up the ones where home wins for a moneyline; add up the ones over 2.5 for a
total. One fit, every market.

**In detail.** Dixon-Coles is Poisson with two corrections, and it has been the
soccer standard since 1997 because both are small formula changes for real
gains. First, a low-score correction: 0-0, 1-0, 0-1 and 1-1 happen more often
than independent Poisson predicts, because teams play cautiously when it is
tight. Second, exponential time-decay weighting, so recent matches count more.
Fit by maximum likelihood over attack/defence/home-advantage.

**Data.** EPL 4,200 priced games (dense 2016–2025), MLS 6,397 (dense
2012–2026), 100% result coverage on both. Final scores are genuinely the only
input. Note soccer moneyline correctly carries **3.00 rows per game** — the draw
is a real third outcome, not a two-way market with a gap.

**Train and test.** Walk-forward by season. Fit on all prior seasons with decay,
predict the next.

**Ship gate.** Positive CLV on the three-way moneyline against the close.
Calibration checked separately for home, draw and away — the draw is where
Poisson models usually fail, and an aggregate figure hides it. Totals are a
secondary output and are gated separately; EPL/MLS have only 400/871 priced
totals, which is thin.

**Not in scope.** Expected-goals models. They predict better and need
shot-location data that is not held and not cheaply bought.

---

### Phase 3 — NHL (game + props) · Dixon-Coles on regulation goals, then TOI × rate

**Why third.** Same engine as Phase 2, pointed at a new sport — and NHL props
are the cleanest standalone prop test in the project.

#### 3a. Game model

**Simply.** Hockey is low-scoring like soccer, so the same machine applies —
but two things have to be handled or the model quietly learns the wrong lesson.

**Empty-net goals.** A team losing by one pulls its goalie in the last two
minutes. The goals that follow happen *because of the score*, not because one
team is better. Fed in raw, team ratings absorb game-state noise as strength.

**Overtime and shootouts.** Tied after 60 minutes, the winner comes from 3-on-3
or a shootout — close to a coin flip and unrelated to the strength being
modelled. So: **model the 60 minutes**, then add the tie case separately.

**Data.** 24,336 priced games, dense 2008–2019 and 2021–2025, 99.9% reaching a
result. Needs a way to identify OT and empty-net goals — 177,961 shot events
from `ingestNhlShotsJob` are the likely source and this must be verified before
the phase starts.

**Ship gate.** Positive CLV against the closing moneyline. Note some books price
NHL three-way on regulation, which is the market this model natively produces.

#### 3b. Prop model — shots on goal first

**Simply.** Three ingredients, in order of importance: **volume** (how many
chances), **rate** (how good per chance), **shape** (how much it bounces
around, which is what turns an expectation into P(over the line)).

**Why NHL is the best standalone prop case.** `toiMinutes` is present on **all
724,002 rows** — perfect coverage of the single field that matters most — and
**71% of NHL props are two-sided** (48,758 of 68,880), the highest ratio in the
project, so the vig can be stripped properly rather than guessed at.

**In detail.** Project time on ice from recent games and role. Project shots per
minute from the player's rate, shrunk toward his position's mean by a
sample-size weight. Multiply for expected shots; a Poisson (goals) or negative
binomial (shots, which are overdispersed) gives P(over). Shots on goal is the
right first market: high-volume, driven by ice time and shooting rate, and far
less random than goals.

**One thing that must not be forgotten.** NHL props join to `player_game_history`
at **−1 day** — ESPN stamps UTC, the NHL API reports local time. Joining at zero
silently loses 35% of the data. This offset was derived against real dates, not
assumed, and is asserted by gate 7.7.

**Blocked on §0.2** — 17,092 NHL props sit on postseason games with no player
rows.

---

### Phase 4 — MLB (game + props) · plate-appearance Monte Carlo

**Why fourth.** The largest prop evidence base in the project by a factor of
seven, and the props are a by-product of the game model rather than a second
build.

**Simply.** Take both lineups and the starting pitchers. For each plate
appearance, draw an outcome — single, walk, strikeout, home run — from a
distribution built out of that batter's skill, that pitcher's skill, and the
park. Play nine innings. Repeat ten thousand times. The share of runs where the
home team wins is the moneyline; the share where the total cleared is the total.

**And every run produces a full line for every batter** — hits, total bases,
home runs, RBIs — so the entire player-prop surface falls out of the same
engine. That is why this model was chosen over a run-rate model, which gives
game markets and nothing else.

**In detail.** The per-PA outcome distribution comes from a log5-style
combination of batter rate, pitcher rate and league baseline, adjusted by park.
Base-out state advances through a standard transition model. Batting order can
be inferred from PA counts.

**Statcast is a prior, not the input.** It covers 4,069 of 31,781 priced games,
so it cannot drive the simulation. What it can do: `estimated_woba` separates
skill from luck, so use the overlap to learn how much of a player's line is
signal, then shrink the eleven-season estimates toward it.

**One thing that is not optional.** The 2019 ball and the 2023 pitch clock
changed how many runs a season produces. Player estimates must be **per-season
against a league baseline**, or a 2016 hitter looks better than he was.

**Data.** 1.87M plate appearances (2016–2026) across 727,613 player-game rows;
31,780 priced games; 1,083,266 props joining to an outcome; 36 markets, 22
carrying 90%. All present.

**Constrained by §0.4** — 2022–2024 has no raw prices. Train on 2010–2021 and
2025–26; the 8,153 de-vigged games from `historical_odds` may be used as a
training signal and market benchmark but **never** in a CLV or EV computation.

**Ship gate.** Game model: positive CLV against the closing moneyline and total.
Props: the rank check in §4, plus bar 3 measured per market with the §1 caveat
about the softness of the prop close. MLB is the only sport with a sample large
enough to tell whether the whole prop approach works — if it fails here, it does
not get tried elsewhere.

---

### Phase 5 — NBA (game + props) · pace × efficiency, then minutes × rate

#### 5a. Game model

**Simply.** Basketball has a clean underlying structure: **points = possessions
× points per possession**. So describe each team with a pace (possessions per
game) and an efficiency (points per 100 possessions, offence and defence).
Multiply out for a projected score both ways: the difference gives a spread and,
through a curve, a win probability; the sum gives the total. Two numbers per
team, both markets.

**Why not a regression on a pile of statistics.** It would use the same
information less cleanly. This version is organised the way the sport actually
works, so it needs fewer parameters and you can read what it is saying.

**Data.** 24,705 priced games, dense 2008–2019 and 2021–2025, 100% result
coverage. Possessions are not stored but the standard estimate needs field-goal
attempts, free-throw attempts, turnovers and offensive rebounds — **all four are
already in `player_game_history`**.

**Constrained by §0.5** — NBA spread is home-side only, so the spread output is
evaluated against the posted line and a single price, not a de-vigged
probability. Moneyline and total are unaffected and are the primary gates.

#### 5b. Prop model — last of the four

**Simply.** Minutes × per-minute rate, same three ingredients as NHL. Minutes
are on 96% of rows and every counting stat is present.

**Two honest constraints.** The evidence is thin — 4,480 graded player-games,
a sixteenth of MLB's. And **minutes are the least predictable part**: a blowout,
a rest day or foul trouble moves a points prop more than anything about the
player's skill. Any NBA prop model is mostly a minutes model wearing a costume,
and it should be built knowing that.

**Blocked on §0.2** — 25,662 NBA props sit on postseason games with no player
rows, the largest single block of ungradeable props in the project.

---

### Phase 6 — College football (game) · ratings on margin

**Simply.** Predict the point difference directly, because **the spread is the
market here** — moneylines exist only from 2021 (4,017 games) while spreads go
back to 2013 (13,569). Model what there is three times more of, and what people
actually bet.

**In detail.** A least-squares or ridge rating on margin: each team gets a
strength in points, the model predicts `home_strength − away_strength +
home_field`, and the residual against the closing spread is the signal. Cap or
shrink blowout margins so a 60-point win does not dominate the fit.

**Why this is easier than it looks.** The talent gaps are enormous — a top
program against a small school is a 40-point favourite — and that wide range
makes team strength easy to measure. The signal is loud in a way it never is in
the NFL.

**Data.** 13,569 spread games back to 2013, 96.7% reaching a result.
**Constrained by §0.5** — CFBD spread rows carry lines but **zero prices**, so
CFB produces a projected margin against the posted line, and CLV can only be
measured on the 2025–26 ESPN rows that do carry prices. That is a genuine limit
on the ship gate and must not be papered over.

**CFB props are out of scope** — zero of 45,000 rows are two-sided, so there is
nothing honest to compare a prediction against.

---

### Phase 7 — NFL (game + props) · margin-adjusted Elo

**Why last.** The NFL is where the temptation to over-build is strongest and the
payoff smallest. It gets the most attention from the sharpest money, and it has
the least data of any sport here. The pick is deliberately modest.

**Simply.** Elo, but ratings move by *how much* you won by, with diminishing
returns so blowouts do not dominate. This is what FiveThirtyEight used publicly
for years. It squeezes more from each game than a win-loss rating without adding
parameters 7,336 games cannot support.

**Why not play-by-play simulation.** It would overfit on this sample size, and
NFL is the most efficiently priced market in sport — the worst place to spend
the hardest effort.

**Data.** 7,336 spread and total games back to 1999, 5,355 moneyline, dense
2006–2025, 98.0% reaching a result. Both spread sides are priced (nflverse), so
NFL spread **can** be de-vigged, unlike NBA/EPL/CFB.

**Props.** `model-rebuild-plan.md` §8 says NFL is blocked on snap counts. **That
is wrong and this plan corrects it.** There are 58,152 rows carrying
`receiving.receivingTargets` and 29,878 carrying `rushing.rushingAttempts`, and
for the markets that actually trade, **targets are a better exposure measure
than snaps** — receiving yards, receptions and longest reception are the top
three by volume, and a snap spent blocking contributes nothing to any of them.
A target is the opportunity.

**One market needs different machinery.** **Longest reception** is the *maximum*
of several draws, not a sum, so it needs an extreme-value treatment rather than
a count distribution. It is the second-biggest NFL market by volume (16k rows),
so it is worth doing properly rather than forcing into the same mould. The
operator approved building this.

**Also needs care.** Milestone alt-lines are off by one — a line of 2.0 means
"≥2", which is over 1.5, not over 2.5.

---

## 4. The prop system — what is built vs what is shown

**Build the probability model. Display a rank.**

`model-rebuild-plan.md` §5B chose a pure grader, and its reasoning was explicit:
a grader can ship on data in hand, while a probability claim has to wait until
it can be tested against historical prices. **That constraint no longer exists**
— the sourcing round delivered 1.8M historical prop prices, 443,990 two-sided in
MLB alone, and the 2026-09-02 open/close test confirmed both ends are genuine
pre-game prices.

So the shape changes, keeping both benefits:

- **Internally**, a probability, held to bar 3 against the closing price. It is
  measurable now, so it gets measured.
- **On screen**, an ordering — a rank, not a percentage. It makes no claim that
  can be wrong in front of a user. The previous model layer got into trouble
  showing confident percentages it could not support; this avoids repeating that
  without giving up the ability to measure.

**Two boards, one engine.** The betting board ranks by modelled edge. The stats
board ranks by projected production. Same numbers underneath, two audiences —
people here for advice, and people here to analyse. Every sport's rankings are
filterable by market, which generalises the old five-player home-run list rather
than special-casing it.

**The guardrail.** "Not a probability on screen" is not "not falsifiable". The
honest test for a ranking is **rank correlation**: do higher-ranked situations
produce better outcomes than lower-ranked ones, on games the model never saw?
Cheap on the existing harness, and it is what stops a rank quietly becoming a
vibe. Hold it from the first commit.

**Prop viability, decided.** MLB, NHL, NFL and NBA are viable. **CFB and soccer
are not** — CFB has zero two-sided prices, soccer has zero two-sided prices
*and* no minutes played, so a 20-minute substitute and a 90-minute starter are
identical rows, which is exactly the distinction a prop model exists to make.

**Props are the expensive end.** Measured on this archive, prop prices sum to
1.066–1.079 against 1.029–1.056 on game lines. That is a **3.3–4.0 point** edge
needed to break even, roughly double the game-line bar. Props are less carefully
priced *and* cost more to play; both halves are true.

---

## 5. Sequencing

**Phase 0 — blockers, before any model.** In this order:

1. **§0.2 postseason filters** — two one-line changes plus a re-run of the
   backfill for affected seasons. Unblocks 43,678 props and stops the defect
   recurring.
2. **§2.6 the archival bridge** — without it every model decays from day one.
3. **§0.7 market canonicalisation** — a prerequisite for prop training.
4. **§0.6 tennis surface** — decides whether Phase 1 can run at all.
5. **§0.4 MLB 2022–24** — decide whether to re-source raw prices or accept the
   hole. Not blocking; Phase 4 can proceed either way.

**Phase 0.5 — the harness.** §2.1 through §2.5. Mostly wiring what exists, plus
the leakage guard and the as-of contract.

**Then the sports**, Phases 1–7 as above.

**The stopping rule, restated from `model-rebuild-plan.md` §7.6 and worth
keeping:** the remaining phases proceed only once one model has *actually beaten
a closing line*. If none has, that is the answer worth having before four more
builds. Tennis and soccer are cheap enough to be that test; MLB and NFL are not.

---

## 6. What this plan does not commit to

- **Buying data.** NFL snaps and soccer minutes are worth revisiting only after
  the grader has proved itself. Three of the four rejected "advanced" options —
  xG, optical tracking, point-by-point tennis — are blocked by *availability*,
  not difficulty, and in two of those cases the data is not sold to individuals
  at any price.
- **Golf.** Its model layer is being deleted (§2.7) and not replaced in this
  plan. 1.03M shot events across three tournaments is deep, not wide.
- **Re-enabling anything currently disabled** beyond what each phase names.
- **A Render deploy.** Explicitly requires operator approval.
