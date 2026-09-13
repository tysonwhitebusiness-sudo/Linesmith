# CURRENT — pick up here

**Phases 1–4 COMPLETE. Phase 5 OPEN (monitoring only). Phase 6 CLOSED (measured
NO). Phase 7 ACTIVE — steps 1 and 2 DONE and measured, step 3 written but NEVER
RUN.**

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

Step 3's script exists and has **never been executed**. It is blocked on one
artefact that a long-running job was still producing when the session ended.

```bash
cd python-odds-service
# 1. regenerate the two local artefacts (both gitignored, neither survives a clone)
.venv/Scripts/python.exe build_nba_player_panel.py --out nba_panel.parquet      # ~2 min
.venv/Scripts/python.exe build_nba_prop_training_set.py --out nba_props_train.csv  # ~2 min
# 2. THE SLOW ONE — ~25 min wall, 128 GBM refits, ~850 MB RAM. Do not pipe it
#    through `tail`: that buffers everything and you get no output until the end.
.venv/Scripts/python.exe -u fit_nba_minutes.py --out nba_minutes_pred.parquet
# 3. the thing that has never run
.venv/Scripts/python.exe -u fit_nba_prop_rates.py --out nba_prop_probs.csv
```

`nba_panel.parquet` and `nba_props_train.csv` **did exist** on the operator's
machine at handoff and may still; check before regenerating.
`nba_minutes_pred.parquet` **also exists** — the export finished at 13:55 on
2026-09-13 (246,482 rows) after this file was drafted, so step 2 of the recipe
above can be skipped on the operator's machine.

**Steps 1 and 2 are finished and committed. Do not redo them.** Their numbers
are below and in the scripts' own docstrings. Step 3 has produced no numbers at
all; treat its docstring's claims about what it MEASURES as a plan, and its
claims about the DATA as measured.

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

## Step 3 — WRITTEN, NEVER RUN (commit 3b4e796)

`fit_nba_prop_rates.py`. Rate per minute × projected minutes → expected count →
shape → P(over the line). **It parses and its `count_prop_engine` calls were
spot-checked by hand. It has produced no numbers.**

It **binds to `predict/count_prop_engine.py`** rather than adding a tenth
distribution — CLAUDE.md is explicit that there is one prop engine. NBA supplies
`volume = minutes`, `events = the counting stat`; `shrunk_rate` and the `SHAPES`
grid are the engine's.

**The one departure**: `project()` computes volume itself as a rolling mean,
which is the exact quantity step 2 improved, so this calls `shrunk_rate`
directly and multiplies by the step-2 projection. The run reports the identical
pipeline driven by rolling-5 minutes beside it, so **"the better minutes model
helps the props" comes out as a number** rather than an assumption. Read that
comparison first — if the two log losses are equal, step 2 bought nothing at the
prop level and that is worth knowing plainly.

Verified before it ever ran: **the prop set joins the panel 25,420/25,420 on
`(athlete_id, event_id)` with zero stat disagreements and zero minutes
disagreements.**

**What to check when it does run:** the ECE and the bucket table against the
market's own ECE printed beside it. Beating the market's Brier is **not** the
test and is not expected — the market has injury and rest information this model
does not. Step 3 succeeds if the probability is CALIBRATED.

## Steps 4–6, unchanged and approved

**Step 4 — the edge test**, identical in shape to CFB step 3: does
model-minus-line predict outcome-minus-line? Walk-forward WITHIN the window,
Wilson intervals, −110 break-even (52.38%) drawn on every bucket, pushes
excluded. **Pre-register the hypothesis before looking**, the Phase 6 rule.

**Step 5 — write the game-line decision.** Not a model: a recorded decision that
NBA game lines have no timing data so CLV is unmeasurable, and either we start
capturing timestamps going forward or the game model waits. **Note the new
nuance:** props DO carry opening lines, so the decision is narrower than the
master plan assumes.

**Step 6 — wire into a job**, only if step 4 passes.

**RISK, NOW LARGER THAN THE GAMEPLAN ASSUMED.** The brief said one season is
thin. It is **six weeks** — 25,420 props, 329 athletes, 41 game days, heavily
correlated within players and within nights, and the SELECT/EVAL split leaves
roughly 10,000 rows to judge on. **"Promising, needs another season" is the
likely honest outcome and is a fine answer.** Do not manufacture a positive by
searching the bucket grid until something clears 52.38% — that is exactly what
Phase 6's high-edge band turned out to be.

One thing already spotted that is step-4 material, recorded so it is not
rediscovered as a finding: in the step-1 gate, **`Total Assists` in the 0.55–0.60
implied band realised 50.55% against 57.40% implied over n=546.** Suggestive,
small, one pocket. Test it as a pre-registered hypothesis or not at all.

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
