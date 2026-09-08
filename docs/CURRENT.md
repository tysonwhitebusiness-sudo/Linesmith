# CURRENT — pick up here

**Phases 1 and 2 of `docs/master-plan-2026-09-06.md` are COMPLETE. Phase 3.0
(the pitcher re-fit) is COMPLETE and persisted. Phase 3.1 (the Statcast prior)
is a MEASURED NO — built, measured, rejected. Phase 3.2 (home runs) is next.**

All work through 3.1 is pushed to `origin/main`. **The Render worker is
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

**Net: the board goes from 9 markets with a probability to 7.** Verified on the
live 2026-09-07 board — `pitcher-outs` / `pitcher-strikeouts` /
`pitcher-walks-allowed` / `total-bases` serve 0 probabilities,
`pitcher-hits-allowed` serves 33, and the top is face-valid.

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

## 4. Phase 3.2 starts here

The plan's 3.2-3.5 are unchanged. Note **3.4 in the master plan is the
simulation-vs-direct-model comparison**, not the pitcher re-fit — an earlier
handoff filed the re-fit under "3.4", a number already taken. It is now 3.0.

**3.2 is home runs, and the plan already suspects it is untestable**: the
archive ends 2025-11-02, so the season split leaves no held-out rows. The task
is to either find a split that tests it or record it as unmodellable — a
decision, not a model.

## 5. Open, deliberately not closed

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

## 6. Known gaps, carried forward

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

## 7. Standing constraints

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
