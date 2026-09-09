# CURRENT — pick up here

**Phases 1 and 2 of `docs/master-plan-2026-09-06.md` are COMPLETE.
Phase 3.0 (the pitcher re-fit) is COMPLETE and persisted.
Phase 3.1 (the Statcast prior) is a MEASURED NO — built, measured, rejected.
Phase 3.2 (home runs) is COMPLETE, persisted and live — it was never
unmodellable.
Phase 3.3 (the PA simulation) is BUILT AND VALIDATED, and deliberately wired to
nothing.
Phase 3.4 is MEASURED: a TIE — the direct model keeps the props board.
Phase 3.5 is MEASURED: NO DEMONSTRATED EDGE on moneyline or total, after fixing
a contaminated measurement that had reported severe negative CLV.
**PHASE 3 IS COMPLETE. Phase 4 is next, and it is now NFL, not NBA.**

**NFL AND NBA WERE SWAPPED 2026-09-08** (NFL was Phase 6, NBA was Phase 4). The
NFL season starts 2026-09-09; the NBA's does not start until late October. The
sports are now ordered by whether they are actually being played — NFL, then
CFB (already underway), then NBA. Phase 3.5 ended blocked on precisely this:
the game ship gate could only be measured on 129 picks over 11 days, and no
amount of work creates evidence that was never captured. Only the ORDER changed;
neither sport's model content moved.

**4.0 IS DONE — all three gates pass.** Reproducible: `python
audit_nfl_phase4.py`, which re-derives every number and exits non-zero if a
classification stops matching the data. **4.1 (margin-adjusted Elo) is next.**

**The headline finding changes the architecture, not a constant: NFL CANNOT
SERVE PROPS AT A FIXED BOARD LINE.** MLB shows every batter at 0.5 hits, which
works only because 84-93% of really posted hits lines ARE 0.5. NFL's line
concentration: Total Rushing+Receiving Yards 7.1%, Total Rushing Yards 8.5%,
Total Receiving Yards 10.3%, Longest Reception 12.8%. Phase 3.0 measured that
concentration predicts calibration slope at r=+0.849, and `pitcher-outs`
inverted at **16%**. **Fifteen NFL markets sit below that.** A WR1's line is
70.5 and a WR3's is 15.5 — no single number describes both.

**So the rule Phase 3.0 established is more general than it looked. It is not
"calibrate at the fixed board line" — that was the fix for a board that serves
fixed. It is CALIBRATE WHERE YOU SERVE.** MLB serves fixed and calibrates fixed;
NFL serves per-player and calibrates at each row's own line. The pre-3.0 MLB
approach was not wrong in itself, only wrong for a board that had changed under
it. Getting this backwards either way is the same invisible bug.

Only `Total Sacks` (96.4%) and `Total Defensive Interceptions` (100%) may be
served fixed; both are declared in `audit_nfl_phase4.FIXED_LINE_MARKETS` and the
audit fails if that stops matching measurement.

**Other 4.0 results:** the join is sound — 97.5% of prop rows reach a real
player-game with **zero off-by-one dates** (the 10% that miss are players who
did not play). The 20 milestone schemes are **excluded, not mapped**: 415 rows
total, largest 59, none two-sided — the opposite call from MLB's 37,252-row
scheme, from the same check on different data. And `Anytime Touchdown Scorer` is
not one market but an alt-line family (0.5 / 1.5 / 2.5 / 3.5).

All work through 3.3 is pushed to `origin/main`. **The Render worker is
`autoDeploy: false` and has NOT been deployed** — it still runs pre-3.0 code, so
its scheduled `mlbProjectionsJob` keeps writing projections from the OLD
calibrations until the operator triggers a manual deploy. The new calibrations
are already in `model_calibration`; only the code that gates on them is behind.

Phases 1 and 2 were independently re-verified 2026-09-06 before 3.0 began —
deletions, additions, gates and both suites. The plan document was accurate on
every claim checked, including the one gate item it declined to claim.

`tsc` clean, **359 TS tests / 0 fail**.

## 1. What Phase 3.0 did — and why it was not just a re-fit

**Scan's #1 is no longer a backup catcher.** `pitcher-outs` served a Platt slope
of **-0.0649**, which mirrors the calibration curve: the lower the raw
probability, the higher the number published. At the board's fixed 16.5-out line
that put position players who threw a mop-up inning at the top of the entire
cross-market board.

**Three gates existed and none asked the right question.** `ordering_monotone`
is measured on the PROJECTION; ECE and worst-bucket were measured at each
archive row's OWN market line. Measured that way, `pitcher-outs` had **the best
calibration numbers of any MLB market — ECE 0.0050, worst bucket 0.005** — while
being catastrophically inverted where it was actually served.

**Root cause, as one number.** The calibration was fitted at market lines and
applied at one fixed board line. Across 11 markets, the share of posted lines
sitting at the board line predicts the fitted slope at **r = +0.849**.
`stolen-bases` (100% at 0.5) fitted 0.7676; `pitcher-outs` (16% at 16.5) fitted
-0.0649 and inverted.

Three independent fixes, all shipped:

1. **`count_prop_engine.probability_is_servable`** — called by BOTH serving
   pipes, so a row already persisted cannot reach a board inverted. Reads the
   slope through `effective_calibration_slope`, because MLB stores
   `calibration_a` and NHL stores `temperature` (the a=1/T case) — reading only
   `calibration_a` would have **silently blanked all four NHL markets**.
2. **`fit_mlb_props.py`** — refuses `probability_ok` on a non-positive slope,
   and now fits the calibration AND measures ECE **at the board's line**.
3. **`predict/mlb_board_lines.py`** — ONE definition of that line. There were
   two and they disagreed: `pitcher-outs` served at 16.5 but graded at 15.5,
   `pitcher-hits-allowed` served at 4.5 but graded at 5.5. The served values are
   the correct ones (they are the median posted line, n=9,193 / n=9,627).

## 2. Measured outcome

| market | slope before -> after | ECE before -> after | probability |
|---|---|---|---|
| pitcher-outs | -0.0649 -> **+1.1063** | 0.0050 -> 0.0430 | loses it |
| pitcher-strikeouts | +0.1044 -> **+0.9740** | 0.0145 -> 0.0360 | loses it |
| pitcher-walks-allowed | +0.3966 -> +0.4888 | 0.0188 -> 0.0271 | loses it |
| pitcher-hits-allowed | +0.1492 -> +0.2515 | 0.0292 -> **0.0214** | **gains it** |

**Every stored slope is now positive** — no inversion anywhere in MLB or NHL —
and the serving guard now changes **0 markets**, because the fitter itself
produces correct verdicts. The guard is a backstop that no longer fires, which
is the intended end state, not a sign it is unnecessary.

**The neutrality check is what made this safe.** All six batter markets that
published a probability keep it; `hits` improved (0.0121 -> 0.0115),
`stolen-bases` (100% concentration) is bit-identical, `hits-runs-rbis` gained
slope 0.5453 -> 0.8234 exactly as its 72% concentration predicted. Held-out
log-loss is unchanged for every market: the grid selection was deliberately left
on market lines (it chooses the projection model, where every posted line is a
real observation); only the calibration moved.

**Net for 3.0 alone: the board went from 9 markets with a probability to 7**
(3.2 then took it back to 8 — see below). Verified on the live 2026-09-07 board:
`pitcher-outs` / `pitcher-strikeouts` / `pitcher-walks-allowed` / `total-bases`
serve 0 probabilities, `pitcher-hits-allowed` serves 33, top is face-valid.

## 3. Phase 3.1 — a measured NO, and why it is not reopenable by re-running

`estimated_woba` does NOT improve the model. Reproducible end-to-end from the
database: `python experiment_statcast_prior.py`, whose docstring carries the
full argument.

**The join is real** and was re-verified before anything was built on it: 6,885
games, **100.00% matched, 100.00% date agreement**, **98.3% coverage** of the
batter player-games the model fits. The NO is not a plumbing artifact.

**The trap, worth remembering.** Against a control of prior hit-rate alone,
xwOBA looks like a clear win: log-loss 0.620443 -> 0.620221 at **t = -4.06**.
Almost all of it is xwOBA proxying for the batter's POWER, which the model
already gets free from his own `bat_totalBases` history (corr +0.658, R^2 0.433
from features already in hand). Add prior TB/PA to the control and the effect
collapses 8.5x to **delta -0.000026** — 0.004% of the log-loss, against the
0.064 that prior hit-rate itself buys.

**1 of 8 fair tests improved.** Power markets — where the hypothesis should be
strongest — tie with the sign backwards. Gradient boosting finds nothing linear
regression missed. Prior-game bands tie at every level including the noisiest,
which is the plan's actual stated use case for a prior.

**Reopening needs a NEW feature, not a re-run.** xwOBA is spent. The untested
candidates are batted-ball spray and pitcher-side contact quality allowed;
neither is in `player_game_history` today.

## 4. Phase 3.2 — home runs was never unmodellable; 37,252 rows were unread

**The plan's premise was wrong, and so was the market map's own note.** Both
said coverage ends 2025-11-02. It does — for the two schemes the fitter was
looking at. A third, `Home Runs Milestones` (37,252 rows, 2026-04-11..
2026-09-02), covers the whole held-out season and was excluded because nothing
read its INTEGER lines.

**A milestone line `L` means "L or more"**, where every other line here is a
half-integer meaning "strictly more than". Verified, not assumed (n=31,238):

    P(hr >= line) = 0.1119   <- correct; matches the half-integer scheme's 0.1170
    P(hr >  line) = 0.0069   <- an ordinary reading: a 16x rarer market

Nothing about the wrong reading looks wrong on inspection — it would train and
calibrate confidently on the wrong question. **Same trap the plan records for
NFL in Phase 6.** `MarketSpec.milestone_names` now holds such schemes apart from
`names`; the loader converts `L -> L-0.5` and SKIPS a non-integer under a
milestone name rather than shifting it. Pinned by `src/test_milestone_lines.py`.

**Home runs passes every gate** — held out n=30,975, log-loss 0.34510, slope
+0.9995, ordering Q1 0.070 -> Q5 0.176 monotone, ECE 0.0090, worst 0.020. It
beats a constant predictor by **+0.00677 (1.92%)**, which is **260x** the xwOBA
effect rejected in 3.1. Live: 196 projections, all with a probability. **The
board is now 8 markets with a probability, up from 7.**

**An audit confirmed no market was ingesting an integer scheme through `names`**,
so no historical fit was corrupted.

## 5. Phase 3.3 — the simulation is BUILT and VALIDATED, and wired to nothing

`predict/mlb_pa_sim.py` + `calibrate_pa_sim.py` + `src/test_pa_sim.py`. Eight PA
outcomes combined batter-against-pitcher by log5, drawn into an explicit
base-out state, nine innings, ten thousand times. **It is deliberately connected
to no surface** — 3.4 decides whether it earns one.

Validated on league-average lineups, 5,000 games: runs/team-game 4.16,
PA/team-game 38.7, hits 8.56, shutout 7.0%, 10+ 5.1%, P(HR) 0.121 against a
measured 0.112, P(single) 0.470 against 0.447.

**The run deficit is explained, not mysterious, and not tuned away.** This model
scores only through plate appearances; real baseball also scores on
reached-on-error (~0.12), net steals (~0.10) and wild pitches (~0.08) — ~0.30,
giving 4.16 + 0.30 = **4.46, inside the real 4.4-4.6**. The PA excess mirrors
it: real games fit fewer PA into 27 outs because caught stealings consume outs
without one.

**The sweep's best parameters were REJECTED**: `calibrate_pa_sim.py` scores best
at `P_GIDP=0.19`, half again baseball's real 0.12-0.13, winning only by dragging
PA/game toward target while standing in for a mechanism the model lacks. Every
constant is held at its real value.

**This matters for what 3.4 may compare on.** Hits, singles, doubles, triples,
home runs, total bases and strikeouts are pure PA outcomes and are NOT biased.
Runs, RBIs and game totals ARE — **3.5's game gate needs non-PA events first.**

## 6. Phase 3.4 — a dead heat; the direct model keeps the props board

`compare_sim_vs_direct.py`, 2,647 simulated games at 4,000 iterations, both
models scored on identical held-out rows:

| market | n | direct | sim | t | verdict |
|---|---|---|---|---|---|
| hits | 28,239 | 0.66798 | 0.66790 | -0.18 | TIE |
| singles | 28,175 | 0.68305 | 0.68269 | -0.90 | TIE |
| **home-runs** | 28,251 | 0.35356 | **0.35266** | **-2.69** | **SIM BETTER** |
| total-bases | 15,942 | 0.67102 | 0.67120 | +0.26 | TIE |
| **pooled** | **100,607** | 0.58439 | 0.58404 | **-1.57** | **TIE** |

**THE FIRST RUN SAID THE OPPOSITE (pooled t=+6.12, direct wins) AND IT WAS THE
COMPARISON THAT WAS WRONG** — the direct model got a fitted Platt and the
simulation got raw Monte Carlo frequencies. The tell was the simulation running
high on all four markets at once. Giving it its own Platt, fitted on SELECT only
(held-out would be leakage), flipped t=+6.12 against to t=-1.57 for. The
simulation is now better calibrated than the direct model on 3 of 4 markets.

**Caveat, and it cuts one way.** Monte Carlo noise at 4,000 iterations adds
~1.5e-4 to the simulation's log-loss and falls only on it. The home-runs win is
therefore CONSERVATIVE, and the pooled TIE may understate the simulation —
removing that penalty puts pooled t near -2.2. **Not claimed as more than a
tie.** A 10,000-iteration re-run would settle it (~2h).

**Verdict: the direct model keeps the props board.** A tie means no change; a
-0.0005 log-loss gain does not buy a Monte Carlo per slate against closed form.
This is NOT a rejection like 3.1 — the simulation drew with a tuned, validated
control and beat it once. Its real case is game markets, which the direct model
cannot answer at all.

## 7. Phase 3.5 — no demonstrated edge, and a broken measurement first

**3.5 measures the EXISTING game model, not the simulation.** The simulation
cannot be graded on game markets yet — see §7b.

**The first answer was contaminated.** `clv_backtest` reported moneyline CLV
mean -0.0791 at **t=-5.83** and totals at t=-2.78: the model losing badly to the
close. The entry prices were IN-PLAY prices. `game_odds_book_lines` is
overwhelmingly post-commence (100% of implausible MLB moneylines and 85.4% of
ordinary ones fetched after first pitch), a moneyline reaches -10000 once a team
has all but won, and both attach paths wrote whatever was quoted when their job
ran. 22 of 291 MLB picks were priced that way, nine at exactly -10000 beside a
pinnacle market probability of 0.50.

**FIXED at both write paths** — `_reference_row` takes a `commence_time` and
returns nothing rather than an in-play price; `odds_lines_cycle` skips a started
game. Pinned by `src/test_pregame_price_only.py`. `_market_prob_for` was never
affected because it needs both sides from one book, which a lone in-play row
cannot satisfy — one column right, the column beside it wrong.

**REBUILT from `game_odds_history`** (a real point-in-time log: 223,995 rows,
51.9% pregame coverage, 0.76% implausible) via `clv_pregame_rebuild.py`. Only 6
of 295 picks had a pregame row in `game_odds_book_lines`, so the stored prices
could not be repaired in place.

| market | n | mean | median | beat close | mean t | sign test |
|---|---|---|---|---|---|---|
| moneyline | 129 | -0.00709 | -0.00659 | **34.9%** | -1.57 | **z=-3.43, p=0.0006** |
| total | 133 | -0.00038 | -0.00177 | 48.9% | -0.12 | p=0.79 |

**Both tests reported, not the flattering one.** The moneyline distribution is
skewed: more picks lose a little to the close than beat it (sign test
significant), but wins are larger when they come (mean test not significant).

**VERDICT: no demonstrated edge; and no evidence of the severe negative CLV
originally reported.** The gate asks for positive CLV and there is none. The
game model does not ship on this evidence. Window is short (everything before
2026-08-27 is permanently unjoinable — foreign-UUID keying, see
`clv_backtest`'s docstring) and n is thin, so this is "no edge demonstrated
yet", not "no edge exists". The corrected pipeline accrues clean evidence from
here.

## 7b. The simulation still cannot be graded on game markets

Phase 3.3 scores runs ONLY through plate appearances. Measured:

    total runs mean   8.28   real 8.8-9.2
    P(total > 8.5)    0.435  the sim would say UNDER on nearly every total
    home win pct      44.8%  real 52-54%; no home-field advantage modelled
    ties              10.0%  real 0%; no extra innings, so a moneyline cannot
                             even be quoted without arbitrarily reallocating

Three prerequisites before the simulation can face this gate: non-PA scoring
(reached-on-error ~0.12, steals ~0.10, wild pitches ~0.08 runs/team-game),
extra innings, and home-field advantage.

**All five milestone schemes are now wired.** They were not five wins; they were
two, and the reason matters more than the wiring.

**Every milestone scheme sits entirely inside the held-out window (2026)**, and
a fit needs rows on BOTH sides of the cutoff — SELECT to choose the grid point
and fit the calibration, held-out to test it:

| market | SELECT | held-out before -> after | outcome |
|---|---|---|---|
| stolen-bases | 8,899 | 12,548 -> **46,087** | fittable; test 3.6x |
| pitcher-strikeouts | 5,568 | 3,401 -> **6,797** | fittable; test 2x |
| batter-strikeouts | **0** | 35,627 | NOT fittable |
| walks | **0** | 69,624 | NOT fittable |

`walks` and `batter-strikeouts` have the opposite of the usual problem — plenty
to TEST against, nothing to TRAIN on. Their names are declared anyway, so each
becomes fittable the moment a pre-2026 source appears, with no code change.

**`NOT_YET`'s stated reason was WRONG and is corrected.** It said "live scheme
only, four days deep"; for `walks` that is false (`Total Walks (Batter)` alone
has 34,534 usable rows). The real reason is zero SELECT-era data — same
conclusion, wrong evidence, and the wrong evidence would send the next person
after the wrong fix.

**For the two fittable markets the MODEL DID NOT CHANGE — only the test.**
Milestone rows are all held-out, so SELECT was untouched, and SELECT is what
fits everything. Both calibrations came back bit-identical (+0.7676, +0.9740).
A confidence gain, not a performance gain. `stolen-bases`' log-loss 0.330 ->
0.256 is NOT real improvement — the 2026 population has a lower base rate
(0.0665 vs 0.1134), so it is not comparable across test sets. What IS real:
`pitcher-strikeouts`' ECE failure (0.0360) is now confirmed on double the
evidence instead of possibly being small-sample noise, and `stolen-bases` shows
Q1 0.019 -> Q5 0.181 (9.5x) across 40,322 rows.

## 8. Open, deliberately not closed

- **`served_probability_spread` is computed and persisted but NOT gated.** A
  positive slope only says the ordering is not reversed. `pitcher-strikeouts`
  shipped monotone at +0.971 and useless: projections spanning 0.56..7.35
  strikeouts mapped into a 35.3%..51.7% band, 16.4pt where `hits` got 46.9pt.
  The honest threshold is not known; inventing one would be a guess dressed as
  a criterion.
- **The ranking metric favours low-baseline rare-event markets.** On the
  2026-09-07 board, 8 of the top 12 are `stolen-bases` (P ~23% against a 7.0%
  baseline). That is `P - baseline` behaving exactly as specified, but it is a
  ranking-quality question worth the operator's eye. It became visible only
  because the uncalibrated `pitcher-walks-allowed` rows that used to occupy
  those slots are gone.
- **`hits` has a board line but no `StatMarketDef`**, so `mlb_prop_grading`
  cannot grade it. Latent, not live: grading only handles
  `category in ("over","under")` and the board writes `category="projection"`,
  so that path has no input today. It becomes real whenever prop grading is
  restored.
- **`logSurfaced` (`lib/db/client.ts:1021`) has zero callers** — an
  unreferenced writer still inserting `prop_score`/`score_grade`/`trust_tier`
  into `pick_history`. Residue from Phase 1.

## 9. Known gaps, carried forward

- **`prop_model_cache` is the only table holding prop model output.**
  `pick_history` receives only MLB game-moneyline rows. Its historical prop rows
  came from the deleted model — treat that track record accordingly.
- **`odds_unresolved` is 22,838 rows.** Phase 8.
- **THE DATABASE IS THE NEAREST HARD LIMIT: 81.3% (6,659 MB of 8,192)**,
  measured 2026-09-06, up 200 MB in the week since the last handoff said 6,459.
  At the recorded ~1.2 GB/week ambient growth that is roughly **nine days** of
  headroom, and the clock runs on the harvester rather than on any work done
  here. Phase 3 fits; Phases 4-7 as a block do not. The operator has a database
  optimisation (egress and size) planned after these phases — it is now on the
  critical path, not after it. Largest tables: `player_game_history` 1,754 MB,
  `odds_archive` 1,144 MB, `prop_odds_history` 979 MB, `prop_odds_archive`
  767 MB.
- **Home runs may be unmodellable.** Archive ends 2025-11-02, so the season
  split leaves no held-out rows. Phase 3.2 decides.
- **Park factors still are not wired and cannot be** — no path from a
  player-game to a venue. The engine's multiplier hook is tested inert at 1.0.
- **A calibration backup exists** at
  `python-odds-service/mlb_calibration_backup_20260906.json` (untracked): the 13
  active MLB rows as they stood before 3.0. `write_calibration` is versioned and
  deactivates prior rows, so a revert is a version flip or a re-fit.

## 10. Standing constraints

- **Do not deploy to Render without asking.** The worker still runs pre-3.0
  code until it is deployed, so its scheduled `mlbProjectionsJob` will keep
  writing rows from the OLD calibrations until then. The new calibrations are
  already in `model_calibration`; only the code that gates on them is not
  deployed.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **A numeric id matching the expected shape is not evidence it is the right
  id.** 399 MLB ids once matched by shape and **0.00%** landed on the right
  game date.
- **The operator must read `app/privacy/page.tsx` before it is public.** Blocks
  any public exposure, per the plan's §2.4.
- **A dev server started before your changes can serve a deleted route from a
  stale compiled build.** Verify page removal on a freshly started server.
- **Scan empties once a slate finishes** — it drops candidates whose game is
  `done`. Verify the board earlier in the day, or rebuild it in memory against
  `mlb_prop_serving.build()`, which needs no dev server and writes nothing.
- **A long-lived dev server degrades**: `/api/props/lines` returns ~94k rows and
  `slateProps.loading` eventually stops settling. Restart fixes it.
- **The shared Postgres pooler caps at 15 connections.** Check for running fits
  before starting anything DB-touching. A full `fit_mlb_props.py` run is ~40
  minutes for 14 markets.
- **The Python tests are standalone scripts, not pytest** — `pytest` is not
  installed. Run each with `.venv/Scripts/python.exe <file>`; two of them
  (`test_mlb_mlp.py`, `test_mlb_tree_models.py`) do live model fits and take
  ~10 minutes each. The TS suite is `npm test` (`node --test`), not vitest.
