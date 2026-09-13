# CURRENT — pick up here

**Phases 1–4 COMPLETE. Phase 5 OPEN (monitoring only). Phase 6 CLOSED (measured
NO). Phase 7 ACTIVE — steps 1–4 DONE. Step 4 measured NO: the prop model has no
edge (pre-registered, H1 FAIL). Step 6 is therefore cancelled; step 5 (a written
decision, not a model) is what remains.**

`docs/master-plan-2026-09-06.md` is the authority on build order. Phase 7's brief
in it has **four premises now measured false** (below) — read those before
trusting any number in it.

---

## THE ONE HABIT THAT KEEPS PAYING: audit a phase's premises before building

Phase 6 had four false premises. Phase 7's brief has **four**, all caught in one
morning of checking, one of which (the priced window) changes what the phase can
conclude. Every phase brief was written before Phase 5 moved data into the
Parquet corpus, so **any claim about where data lives is stale by default.**

---

# START HERE — the exact next action

**Step 5 — write the NBA decision record.** Not a model. It records two things.
First, NBA game lines carry no timing data, so CLV can't be measured. Second,
props were tested and have no edge at six weeks (step 4). Then it names what
would reopen each: timestamped game-line capture going forward; a full season
of priced props plus an active-roster feed; and the H2 assists pocket on
2026-27 prices. **Ask the operator where the decision record should live**
(master plan vs a new doc) before writing it. Then close Phase 7 and read the
master plan for Phase 8.

**Do NOT run more step-4 variants** (other thresholds, markets, a de-shrunk
edge). The test was pre-registered, it failed, and the diagnostic below already
explains why. Searching further is the Phase 6 high-edge-band mistake.

All local artefacts exist on the operator's machine as of 2026-09-13
(`nba_prop_probs.csv` is NOT gitignored — do not commit it). To reproduce on a
fresh clone, rebuild in order:

```bash
cd python-odds-service
.venv/Scripts/python.exe build_nba_player_panel.py --out nba_panel.parquet         # ~2 min
.venv/Scripts/python.exe build_nba_prop_training_set.py --out nba_props_train.csv  # ~2 min
# ~25 min wall, 128 GBM refits, ~850 MB RAM. -u and redirect to a file; never `| tail`.
.venv/Scripts/python.exe -u fit_nba_minutes.py --out nba_minutes_pred.parquet
.venv/Scripts/python.exe -u fit_nba_prop_rates.py --out nba_prop_probs.csv        # ~1 min
.venv/Scripts/python.exe -u test_nba_prop_edge.py                                   # ~10 s
```

**Steps 1–4 are finished. Do not redo them.**

---

# Phase 7 — NBA — ACTIVE

## Audit: four premises in the phase brief measured false, 2026-09-13

| brief says | measured |
|---|---|
| "24,705 **priced** games, dense 2008–2019 and 2021–2025" | **5,301 games with odds, ZERO before 2022** |
| "props thinnest… 4,480 graded player-games" | **36,335 two-sided rows** — but see below |
| props span one season, 2025-10-21 → 2026-06-14 | **rows do; PRICES stop 2025-12-01** |
| NBA CLV is unmeasurable | true of `odds_archive`, **false of `prop_odds_archive`** |

**THE PRICED WINDOW IS SIX WEEKS, NOT A SEASON.** This is the one that changes
the phase. Two-sided prices come only from ESPN BET (`espn_core`) and stop on
2025-12-01; when the provider flips to DraftKings in December the archive keeps
recording lines and records **zero prices** — 11,978 rows, both price columns
null throughout. Results are plentiful, prices are scarce, the same shape as CFB.

**"36,335 two-sided" counts team and quarter markets.** Restricted to the nine
player stat markets a model can project it is **30,437**. The largest excluded
block is 24,668 rows of `Basketball Player Prop` under one `type_id` (158) that
never says which stat is priced — unusable at any volume.

**`player_game_history` for nba ends 2026-04-13**, the last day of the regular
season, so the 10,062 April–June prop rows join to nothing.

**THE NBA GAME-LINE CLV GATE STILL CANNOT BE BUILT.** `odds_archive` for nba has
zero `captured_at` and zero `open_line` across all 81,023 espn_core rows; the
second source (`sbr`, 39,114 rows) has null `event_ref` and cannot be joined to
results at all. **But props are different**: `open_line` differs from `line` on
35.7% of the priced prop rows and `open_over_price` is on all 36,011 two-sided
ones. Open-to-close movement on PROPS is measurable and is carried in the
training set for step 4.

## Step 1 — DONE, gate PASSED (commit 4624647)

`build_nba_prop_training_set.py`. **25,420** two-sided player props joined to a
player result (99.9%), 329 athletes, 9 markets, 41 game days.

The gate — de-vigged implied probability vs realised over-rate:

| method | mean implied | realised | residual |
|---|---|---|---|
| multiplicative | 49.40% | 48.72% | **−0.69pt** |
| power | 49.32% | 48.72% | **−0.60pt** |
| shin | 49.35% | 48.72% | **−0.63pt** |

The join, the sign convention and the de-vig are right. What confirms it is not
the aggregate but that **the skew reproduces Phase 5.1's MLB finding in a new
sport**: symmetric combo markets land within ±0.2pt (Points +0.05, PRA −0.08,
PR −0.20) while longshot-shaped ones miss low (Steals −3.44, Blocks −2.67), and
residual is monotone in line size, −1.92pt at line ≤2 through +0.82pt above 20.
A stat-mapping bug does not produce a gradient.

`worst_case` reads +3.05pt and is **excluded from the verdict on purpose** — its
sides sum to 2−S by construction, "a floor, not a model" in `odds_math`'s own
words, so scoring it would fail a correct join every time.

**A REAL HAZARD, FOUND AND CLOSED.** Joining on `(athlete_id, game_date)`
returned 25,442 rows from 25,333 props — **100.4%, impossible for a 1:1 join,
and the only reason it was visible.** `player_game_history` holds **1,863
(athlete, game_date) pairs carrying two rows under two different `event_id`s**,
different opponents and minutes, 1,608 disagreeing on points. NBA teams do not
play twice in a day: these are two real games stamped with one calendar date.
288 priced props were being graded against the wrong game. `event_ref` and
`event_id` are the same id space (**299 of 299** resolve), so the join is now
exact. **Anything else joining NBA props to results must use `event_ref`.**

## Step 2 — DONE, model beats the bar by 6% (commit 527342c)

`build_nba_player_panel.py` + `fit_nba_minutes.py`. 246,482 scored player-games
over 2017–2026, walked forward in 14-day blocks, 128 refits, every feature
strictly backward-looking.

| | all seasons | prop window (n=6,574) |
|---|---|---|
| mean of previous 5 *(the bar)* | MAE 5.181 | MAE 5.198, corr 0.766 |
| ridge | MAE 4.941 | MAE 4.905, corr 0.799 |
| **gradient boosting** | **MAE 4.873** | **MAE 4.713, corr 0.817** |
| …240-normalised *(UPPER BOUND)* | MAE 4.599 | MAE 4.449, corr 0.839 |

6.0% on the bar over all seasons, 9.3% in the prop window. **Real, not
transformative** — residual sd is still ~6 minutes against a mean of 22.7. What
it clearly buys in an Oct–Dec window is removing a real early-season bias:
rolling-5 runs **+0.378 min hot** while roles ramp up, the booster **−0.064**.

The bar was set before any model was written, and set at a rolling average, not
the league mean — the league mean scores MAE 8.822 and beating it means nothing.

**The 240-normalised row is an upper bound, not a result.** Team-minutes
conservation is exact (6,947 of ~7,400 recent team-games sum to 48.0 per
five-man slot, 306 to ~53 for one OT, 40 to ~58 for two) but applying it needs
the active roster and the final game length. **There is no `injury_snapshot`
table in this database** (the job of that name runs and writes nothing) and
overtime is not knowable pre-tip. It is measured because it **prices an
active-roster feed at a further 5.6% off MAE** — the largest single improvement
available here, and it needs DATA, not features. Worth knowing before anyone
spends a week on feature engineering.

**Two panel facts that constrain everything downstream:**
- **A DNP is an ABSENT ROW, not a zero.** A team-game carries 6–16 rows, median
  10, against a 15-man roster. So this predicts minutes **given the player
  played** and cannot learn whether someone is active. For props that is the
  right conditioning — a prop on a scratch is voided, not lost.
- **The DNP convention changed in 2019.** 2016–2018 carry ~3,400 rows a year
  with no `minutes` key, single digits from 2019. That is the feed changing; a
  count spanning the boundary reads it as a trend.

**RESIDUAL SPREAD IS NOT CONSTANT and step 3 must not treat it as such.** By
predicted minutes: sd 6.56 below 10, **7.07 at 10–18**, 6.65 at 18–24, 6.11 at
24–30, 5.54 at 30–34, 5.06 above 34. The worst band is the fringe rotation
player with an unsettled role — exactly who props get offered on.

## Step 3 — DONE, calibrated but nearly uninformative (commit 3b4e796, run 2026-09-13)

`fit_nba_prop_rates.py`. Rate per minute × projected minutes → expected count →
shape → P(over the line). SELECT 15,943 props to 2025-11-15, EVAL 9,477 after;
shape and shrinkage chosen per market on SELECT only.

| pooled EVAL, n=9,477 | log loss | Brier | ECE | worst bucket gap |
|---|---|---|---|---|
| model | 0.6908 | 0.2488 | **0.0120** | **0.0347** (n=227) |
| market (de-vigged) | **0.6861** | **0.2466** | 0.0133 | 0.0639 |
| constant at the realised rate 48.20% *(hindsight)* | 0.6925 | — | — | — |

**It passes the test it was set, and that test turned out to be weak.** ECE is
below the market's, as required. But **9,045 of 9,477 predictions (95%) sit in
the 0.4–0.6 buckets**, and a model that barely moves off the base rate is
calibrated almost by construction. Log loss is 0.0017 better than a constant
guess and 0.0047 worse than the market. **The market beats it on log loss in 8 of
9 markets** and ties on PRA. Read it as calibrated and close to uninformative,
not as a working model.

One real miss inside the calibration: **the 0.5 bucket predicts 51.6% and
realises 49.0% over n=3,033**, the model leaning over where the market's own
under-lean (step 1) also showed up. Realised over-rate on EVAL is 48.2% against
a model mean of 49.1%.

**THE MINUTES MODEL BOUGHT NOTHING AT THE PROP LEVEL.** The same pipeline driven
by rolling-5 minutes scores **0.6910 against 0.6908**. Step 2's 6–9% MAE gain
does not reach the probability. The likely reason is that the line already
prices minutes. Only the active-roster information (the 240-normalised upper
bound) is a candidate to change that, and it needs a data feed.

Chosen per market (shape, k): Points nb(2)/40, Rebounds nb(4)/5, Assists
nb(2)/5, 3PM nb(8)/10, Steals binomial/40, Blocks nb(2)/2, PR nb(2)/10, PA
nb(2)/20, PRA nb(2)/40. The k grid runs to 80, so none of the picks sit at its
edge.

**What this means for step 4:** a model this much weaker than the market is
unlikely to show an edge, and the honest expected outcome is NO. Run it anyway,
pre-registered, because "no edge at six weeks" is the finding that justifies
waiting for a season and a roster feed.

It **binds to `predict/count_prop_engine.py`** rather than adding a tenth
distribution — CLAUDE.md is explicit that there is one prop engine. NBA supplies
`volume = minutes`, `events = the counting stat`; `shrunk_rate` and the `SHAPES`
grid are the engine's.

**The one departure**: `project()` computes volume itself as a rolling mean,
which is the exact quantity step 2 improved, so this calls `shrunk_rate`
directly and multiplies by the step-2 projection. The run reports the identical
pipeline driven by rolling-5 minutes beside it, so **"the better minutes model
helps the props" comes out as a number** rather than an assumption. Read that
comparison first. It came out equal (above).

Verified before it ran: **the prop set joins the panel 25,420/25,420 on
`(athlete_id, event_id)` with zero stat disagreements and zero minutes
disagreements.** 0 props fell back to rolling-5 for lack of a minutes prediction.

## Step 4 — DONE, measured NO (pre-registered; `test_nba_prop_edge.py`)

**H1 FAILS on both legs, as predicted in advance. H2 was not tested (below).**

| | result | CI (wider of date/athlete cluster bootstrap) | verdict |
|---|---|---|---|
| H1a slope of (y − market) on edge | **−0.055**, corr −0.005 | [−0.268, +0.165] | FAIL |
| H1b ROI, model side, \|edge\| ≥ 0.05, n=1,989 | **−8.78%** | [−13.34, −3.75] | FAIL |
| control: always the under, same rows | −1.53% | | |
| model − control | **−7.25pt** | [−12.53, −2.10] | |

This is not a near miss. The slope is zero, and betting the model's side does
**significantly worse** than the dumb control. Win rate falls as the edge grows:
49.2% → 47.4% → 43.8% → 40.5% across the four bands, and ROI goes
−6.5 → −12.7%.

**WHY, measured after the verdict. This is a diagnostic, NOT a new hypothesis.**
The model's "edge" is mostly its own shrinkage toward 50%.
`corr(edge, market_p − 0.5) = −0.67`, and **88% of the |edge| ≥ 0.05 bets land
on the side the market prices below 50%.** Step 3 already showed 95% of the
model's probabilities sit in 0.4–0.6 while the market goes out to 0.88. So a big
"disagreement" usually means the market is confident and the model isn't, and
betting it means betting longshots into the favourite–longshot bias. **With that
shrinkage component regressed out, the remaining edge has corr −0.004 with the
outcome.** The model holds no information the price doesn't already have.

**H2, the contaminated split.** Step 1's 546 rows reproduced exactly. The pocket
shows up about equally in both halves: SELECT n=357, 57.31% implied, 50.70%
realised; EVAL n=189, 57.58% implied, 50.26% realised. That rules out one kind
of fragility (sitting in one sub-period) **and confirms nothing**. It stays
pre-registered for 2026-27 prices, untouched.

**What Phase 7 concludes for NBA props:** on six weeks of prices, a rate ×
minutes model built on public box-score history is calibrated and has no edge.
The measured lever is DATA, not modelling. The 240-normalised bound from step 2
prices an active-roster feed at 5.6% off minutes MAE. Step 3 shows minutes
improvements don't reach the probability unless they carry information the line
lacks, and who is playing is exactly that. **Reopen condition: a full season of
priced props AND an active-roster/injury feed.** Without both, don't rebuild
this.

### STEP 4 PRE-REGISTRATION — committed 2026-09-13, before any step-4 code existed

Written before `test_nba_prop_edge.py` was written or run. What had been seen
of the EVAL outcomes at this point: only step 3's aggregate log loss, Brier,
ECE, calibration buckets and the pooled over-rate (48.20%). Nothing broken out by
edge, side or price. The edge DISTRIBUTION was looked at (no outcomes) to size
the threshold: |edge| ≥ 0.05 selects 1,989 of 9,477 rows.

**Data.** `nba_prop_probs.csv`, all 9,477 EVAL rows (2025-11-16 → 2025-12-01, 15
game days). The model's shape and shrinkage were chosen on SELECT only, so EVAL
is out of sample for the model. No price filter, no market filter. Every line
is a half-point, so there are no pushes.
`edge = model_p_over − market_p_over` (market = `devig_two_way`, as step 3).

**H1 — does the model's disagreement with the market carry information?**
- **H1a, threshold-free (primary):** OLS slope of `y − market_p_over` on `edge`.
  PASS needs slope > 0 with the 95% CI excluding 0.
- **H1b, betting:** at |edge| ≥ **0.05**, bet one unit on the model's side at
  that side's ACTUAL American price. PASS needs flat-stake ROI with a 95% CI
  lower bound > 0, **and** ROI above the CONTROL: betting the UNDER on the same
  rows. The control is there because the market's over side is known to be
  overpriced (step 1, −0.69pt) and the model leans under relative to the market
  (mean 49.1% vs 49.5%). An "edge" that is only that under-lean is not an edge.
- **H1 passes only if H1a AND H1b both pass.**
- **Inference is clustered.** Props are correlated within a night and within a
  player (Points, PR, PA and PRA on one player-game are near-duplicates). CIs
  come from a cluster bootstrap by game_date AND by athlete_id, 2,000 draws
  each, and **the wider of the two is the one reported**. Fifteen date clusters
  is few, so even the date bootstrap understates uncertainty. Plain Wilson
  intervals are printed for reference only.
- Win rate by edge band (0–0.02, 0.02–0.05, 0.05–0.10, 0.10+) and per market is
  printed with the 52.38% line and each band's own mean break-even from the
  actual prices. **Descriptive only, not the test.** No band or market found in
  that table may be reported as a finding.

**H2 — Total Assists priced at 55–60% over realise below price: FADE THE OVER.**
**NOT CLEANLY TESTABLE ON THIS DATA, and recorded as such before looking.** The
pocket (n=546, 57.40% implied, 50.55% realised) was found by the step-1 gate,
which ran over all 25,420 props, including every EVAL day. There are no priced
NBA props outside that window. H2 is therefore **pre-registered for the
2026-27 season's prices**: Total Assists, `market_p_over` in [0.55, 0.60), bet
the under at the actual price, PASS needs a date-clustered ROI CI above 0.
Step 4 prints the SELECT-period and EVAL-period split of the pocket, labelled
CONTAMINATED. The only thing it is allowed to show is whether the pocket sits in
one sub-period (a sign of fragility). It cannot confirm anything.

**Expected result, written in advance:** H1 FAILS. A model 0.0047 log loss behind
the market (step 3) rarely has disagreement worth betting. A fail is the finding
that sends NBA props to "wait for a season and an active-roster feed."

## Steps 5–6

**Step 5 — write the game-line decision (NEXT).** Not a model: a recorded decision that
NBA game lines have no timing data so CLV is unmeasurable, and either we start
capturing timestamps going forward or the game model waits. **Note the new
nuance:** props DO carry opening lines, so the decision is narrower than the
master plan assumes.

**Step 6 — wire into a job — CANCELLED.** It was conditional on step 4 passing.

---

# Phase 5 — OPEN, monitoring only

Left open at the operator's direction to retest egress over several days rather
than close on one reading.

| ceiling | state |
|---|---|
| database | **WATCH — growing again**, see below |
| worker RAM | **CLEARED** — 248 MB resting of 512, peak 380 across 40 jobs |
| egress | **halved, not yet at target — OPERATOR MUST LOOK** |

```
  before the fixes   ~19.1 GB/day
  2026-09-13          7.051 GB at ~17h  ->  ~10 GB/day projected
  target              <= 8.3 GB/day
```

**WHAT TO CHECK:** the Supabase egress graph, over several days. One day is not
a trend and 13 Sep was partly a deploy day. **There is no API token for it — the
operator must look.** This was NOT checked during the 2026-09-13 session.

**DATABASE GROWTH MOVED THE WRONG WAY and this is new.** `health_check` on
2026-09-13 read **3,571 MB (43.6%), +164.1 MB/day over 2.6d, 28 days of
headroom**. The previous handoff recorded the prune loop as closed and the
ceiling as "CLEARED and SUSTAINABLE" at 42.4%. It is growing at 164 MB/day —
much better than the +469.6 it was, but **not flat, and 28 days is not a lot.**
Nobody has looked at what is growing.

**THE LARGEST REMAINING EGRESS LEVER, independent of any byte estimate:**
`SELECT fetched_at FROM snapshot_cache` runs **424,958 times/day** — 5 a second,
by far the highest call count of anything. It is the blob cache's validation
query. Memoising it in-process for a few seconds would collapse burst reads of
one key into one query, with no staleness risk beyond seconds (the payload is
already versioned by `fetched_at`). **NOT BUILT. Size unknown.**

## What shipped in Phase 5 (all deployed, all gated)

- **blob validation-cache** — `read_snapshot`/`read_snapshot_with_age` ask
  Postgres only for `fetched_at` and serve the payload from local disk when the
  stamp matches. **99.5% hit rate in production.** Disk, not memory, to protect
  the RAM ceiling.
- **prop archive server-side** — `INSERT … SELECT`; 36,361 rows, 7 sports, 0
  mismatches.
- **closing-lines archive server-side** — 2,104 rows, 0 mismatches, 6.62s.
- **hot-window aggregation** — `load_hot_window_agg`; 1,958,099 rows → 17,118
  (99.1% fewer). Gated at 17,118 athlete-markets, 0 diffs, plus
  `summary == prefix + hot` on 15,642.
- **team-elo per-game read** — was loading the whole sport then discarding all
  but one game, *while being called once per game* (12,432 calls/day).
- **reference points server-side** — and it fixed a NON-DETERMINISM: 68
  candidate rows share 4 `fetched_at` values, books disagree (8.0/8.5/9.5), so
  "freshest wins" returned whatever an unordered SELECT gave first. Now each
  book's freshest quote then the MEDIAN across books; `percentile_disc` so the
  answer is a really-quoted line. Differed from the old pick on 39% of keys.
- **corpus prune loop closed** — `refresh_corpus --prune` runs `prune_corpus`
  daily after export+upload. Before this the database grew +469.6 MB/day with 10
  days of headroom, because the 7,282 → 3,200 MB reduction came from running
  those tools BY HAND and nothing repeated them.
- **corpusFreshness heartbeat** — the old alarm sat BELOW the floor of normal
  operation (250k threshold vs ~407k rows per cycle) and went red every cycle
  regardless of health.

---

## MEASUREMENT LESSONS — read before measuring anything

**1. A SHORT WINDOW CANNOT PROVE A QUERY IS DEAD.** A query running 73×/day
appears **0.35 times** in 420 seconds. On that basis a query was declared dead;
it was the largest line on the bill.

**2. A MINIMUM-CALL THRESHOLD DOES NOT CATCH A BURSTY JOB.** A 600s window
reported 99M rows/day for a query whose lifetime rate is 7.4M. **Cross-check
window rate against lifetime rate (`rows / stats_since`); disagreement >3× means
discard the window figure, not average it.**

**3. THE WIDTH MODEL FAILS IN BOTH DIRECTIONS.** Flat 109 B/row said 4.08
GB/day; per-table width said 24.63; the graph said ~10. **A correct estimator
needs SELECTED-COLUMN widths. Nobody has built one.**

**4. psutil WIRE MEASUREMENT FAILS BELOW A FEW MB.** `SELECT 1` measured at
19,417 B/call, which is impossible.

**5. BLOCKS TOUCHED ARE NOT BYTES SENT.** `shared_blks` counts index and heap
pages; it was off by 100×.

**THE RULE: the Supabase graph is the authority on bytes. The RANKING from
pg_stat_statements is actionable; its absolute numbers are not.**

**6. A 100%-OF-EXPECTED JOIN IS A BUG, NOT A SUCCESS.** Step 1 returned 100.4%
and that is the only reason a wrong-game grading bug was ever seen. **Print the
ratio, not just the count.**

---

# Phase 6 — CLOSED, measured NO

Ridge margin rating, 13,650 games, refit per season-week with no leakage, 90-cell
sweep. Three benchmarks all negative: vs closing spread (t +0.23), vs opening
spread (t +0.20), and predicting the market's own move (t −0.77).

The high-edge band is recorded rather than buried: monotone 51.59 → 55.00%
across thresholds, balanced by side, sensible by week — but every Wilson interval
spans break-even, **2024 sits at 49.08%**, ROI is +0.74%, and validating it would
need **~80 seasons**. Unfalsifiable at CFB volumes.

**Pre-registered reopening hypothesis: week 5+, |edge| ≥ 16, large spreads. Test
that and nothing else.** Closes the APPROACH, not the sport.

Tooling kept: `build_cfb_training_set.py`, `fit_cfb_ratings.py`,
`sweep_cfb_ratings.py`, `test_cfb_edge.py`, `test_cfb_edge_open.py`,
`test_cfb_high_edge.py`.

---

## health_check, as of 2026-09-13

5 failing, **none of them new breakage**:
- `refreshNbaJob`, `refreshNhlJob` — cold-tier skips, **off-season, expected**.
- `refreshCfbJob` + `harvesterScrapes: cfb` — the parked cfb discovery issue below.
- `databaseGrowth` — see Phase 5. **This is the one worth attention.**

`corpusFreshness` healthy (export ran 0.8h before the check). `workerMemory`
healthy. The laptop was awake, so the usual "corpus and harvester go stale when
the machine is closed" did not apply this time.

---

## PARKED — cfb harvester and provider coverage

Deferred at the operator's request; all measured, none urgent.

- **cfb discovery cost FIXED** — was walking all 85 league fixtures at >21s each
  into the 1800s cap. Now filtered via schema.org JSON-LD. **STILL OPEN:** the
  fallback filter only takes 85 → 72 (we track 166 cfb games), so it completes on
  a good day and times out on a slow one. **The real fix is bounded rotation** —
  scrape the N most imminent games per cycle.
- **Blocked/dashed moneylines are silently discarded.** A real cfb page returns
  `{"1": "-", "2": "41.00", "blocked_outcomes": ["1","2"]}`.
  `_parse_decimal_odds("-")` returns None, indistinguishable from a parse
  failure. Count them explicitly.
- **SharpAPI 429s mid-pagination** (page 12, free tier 12 req/min) — the leading
  explanation for cfb's thin game-line coverage. Correlated, **not proven causal**.
- **Propline's absence from cfb is DELIBERATE** and documented in
  `provider_matrix.py`: 1+N requests per cycle means a 178-game slate is ~179
  requests vs SharpAPI's 1. Do not "fix" without redoing that arithmetic.

---

## OPEN ITEMS

- **`refreshTier1` overruns its interval** — 171.75s against 150s, but only on
  the cycle where all five provider throttle windows open at once. Optional fix:
  make the staleness rule `2 × interval + last_run_duration`.
- **`price` holds a copy of `line` on espn_core spread rows** (`line = -30.5,
  price = -30`); zero of 988 are plausible odds. The guard is that a price
  outside ±100…100000 is not a price.
- **`athlete_name` is NULL on every NBA prop row** — all 25,420. `athlete_id`
  joins fine, but any diagnostic built on the prop set prints blank names until
  something backfills them.
- **The corpus refresh and harvester only run while the operator's machine is
  awake.** That is Phase 10 scope ("move OddsHarvester off the laptop") arriving
  early.

---

## STANDING CONSTRAINTS

- **Ask before deploying to Render.** Note `render.yaml` has **`autoDeploy:
  false`**, so `git push` does NOT deploy — pushing is safe and does not need
  permission.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's. Add named files only (`git add docs/CURRENT.md` is fine).
- **Back up before deleting.** `prune_corpus` verifies every row is in the corpus
  by id and content fingerprint before deleting, and refuses while the corpus is
  local-only.
- The Postgres pooler caps at **15 connections** — check for running fits before
  starting DB work.
- Python tests and fits are standalone scripts: `.venv/Scripts/python.exe <file>.py`.
- Corpus reads cost ~300 MB of RAM and are **barred from the Render worker** —
  they run on the operator's machine. `fit_nba_minutes.py` peaks around **850 MB**
  and takes ~25 minutes; it needs no database connection at all (parquet only).
- **Do not pipe a long Python run through `tail`** — it buffers everything and
  you get no output until the process exits. Use `-u` and redirect to a file.
- **At ~92% context, stop and hand off** by rewriting this file.
