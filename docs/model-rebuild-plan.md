# Model audit and rebuild plan

**Written 2026-09-01**, from a full measurement of every model, rating and grade
in the app against what it actually predicted and what actually happened.

This document exists because the findings below lived only in a conversation and
a published artifact. They are load-bearing: they are why the sourcing work of
2026-08-31/09-01 happened at all, and they decide what the model layer becomes.

Companion artifact (same content, nicer to read):
`https://claude.ai/code/artifact/072e044a-1572-4919-90ca-be537118ab6e`

---

## 1. What makes a model good — the standard everything below is judged on

Four bars, strictly ordered. Failing an early one makes the later ones
meaningless, which is why so much existing measurement reports numbers that
cannot mean what they appear to.

1. **It predicts something that actually gets settled.** A probability nobody
   grades against a real outcome is a number, not a model.
2. **It beats the naive baseline** — the base rate for that market.
3. **It beats the market price, out-of-time.** *This is the only bar that
   matters commercially and the one nobody grades against.* You are not betting
   against the base rate; you are betting against a book that has already priced
   the injury report, the weather and the lineup. A model that beats the base
   rate but loses to the close loses money on every bet it recommends.
4. **It is calibrated.** When it says 60%, 60% happens — checked in buckets, not
   on the average, since an average can be perfect while every band is wrong in
   alternating directions.

Underneath all four: **the thing that decides whether a model ships must not be
the thing that fitted it.** Otherwise every fit finds an edge, because that is
what fitting does.

---

## 2. How each pipeline scores

| Pipeline | 1 graded | 2 beats base | 3 beats market | 4 calibrated | Measured |
|---|---|---|---|---|---|
| MLB game model | PASS | PASS | **FAIL** | PART | Holdout Brier 0.2398 vs 0.2594 baseline. On 153 real games: **0.2315 against the market's 0.2090**. Positive-CLV rate **50.0%** |
| MLB prop model | PASS | PASS | **FAIL** | **FAIL** | Ties the market (0.2299 v 0.2308 on 5,850). Says 0.93, delivers **0.686** |
| MLB home-run | PASS | **FAIL** | — | — | Holdout 0.0944 vs baseline 0.0948 — 0.4%. Correctly `shadow`ed and never rendered |
| Golf | **FAIL** | **FAIL** | — | — | Stored Brier is **0 on 147 of 149 rows**. Hole models sit at the league base rate |
| Soccer props | PASS | **FAIL** | — | **FAIL** | Predicts **0.583 for assists where 0.064 happens** |
| NFL, CFB, NBA, NHL | **FAIL** | — | — | — | Zero prop predictions ever produced |
| Tennis | **FAIL** | — | — | — | Zero rows in every model table |
| Unit grades / ranks | n/a | n/a | n/a | n/a | Not a model — a percentile of real league ranks. Makes no claim about the future, so it cannot be wrong about one. **This part works** |

### The inventory behind that

`model_weights` holds **21 rows, all MLB**. `model_calibration` **7, all MLB**.
`walkforward_results` **21, all MLB**. `model_artifacts` holds **zero rows** —
the table exists and has never been written to. Seven sports of eight have never
had a coefficient fitted for them.

---

## 3. Why bar 3 cannot be cleared by the current architecture

**The largest coefficient in the MLB moneyline model is the market's own price.**

```
marketProbCentered   3.5170     <- the market, fed in as a feature
simWinProb           2.2941
eloProb             -0.8269     <- negative
rawLog5             -0.5952     <- negative
```

The total model is the same shape (`marketProbCentered` 3.7372). Two of the real
baseball features carry *negative* weights, meaning the fit uses them to nudge a
market anchor rather than to form an opinion.

**A model that takes the closing price as an input will always land near the
closing price and will always report a small edge that is really its own noise.**
That single decision explains the tie on Brier, the 50.0% CLV, and the finding
below. It is upstream of everything else, which is why this is not patchable:
removing the feature invalidates every other coefficient, the Platt layer on top
and the edge computation below.

### The edge column, tested directly

Bucketing 5,850 graded MLB picks by the edge the app claimed, then asking
whether the outcome beat the market's implied probability:

```
edge  +2.3%  (n=1,257)  ->  +1.4pp
edge  +7.0%  (n=645)    ->  -2.3pp
edge +12.2%  (n=235)    ->  -0.4pp
edge +17.1%  (n=109)    ->  +0.9pp
```

**No relationship.** The bucket claiming a seven-point edge finished two points
*below* the market's own number.

The one real signal is on the other side: picks with a large *negative* claimed
edge realised 0.286 where the market implied 0.524, across 234 picks. **The model
knows where the market is too high and not where it is too low** — and the
product surfaces the useless half.

### The ML added nothing

Seven families walk-forward tested on MLB moneyline. The winner was `formula`,
the hand-built one, at **0.6744** log loss — ahead of CatBoost (0.6754),
stacking (0.6772), XGBoost (0.6827), LightGBM (0.6852), Bradley-Terry (0.6887)
and the MLP (0.6938). A coin flip is 0.6931.

---

## 4. What the models currently DO — mostly nothing, already

A previous phase reached this same conclusion and responded by switching the
output off in the UI rather than fixing the model. The code says so itself.

| Surface | State | Reality |
|---|---|---|
| Edge badge | Renders nothing | `EdgeBadge` in `OddsChip.tsx` accepts edge, model prob and market prob and `return null`. Four call sites all render empty |
| Confidence % | Hardcoded null | `GameHeroCard` sets `mlPercent`/`totalPercent` to `null` permanently. Its comment: *"the model loses to the market on its own graded history"* |
| Score grade | Suppressed | `TodaysPicksModal` computes it, logs it, renders an empty div |
| Pick side | Still renders | "Yankees" / "Over 8.5" — the recommendation without the number |
| Home-run list order | Still ranks | Sorted by the Beta-Binomial, not the shadowed fitted model |
| Prop score | Sorts Scan | `computePropScore` orders candidates; the score is not shown |

**So the model layer produces 374,173 graded prop predictions, an ordering on two
lists, and a pick side with no number.** Every probability, edge and confidence
figure is computed, written to Postgres, and discarded at the render boundary.

That matters for sequencing: **rebuilding the model layer breaks almost nothing a
user can currently see.**

---

## 5. THE PLAN — two systems, decided by the operator 2026-08-31

### A. A game model (moneyline + total) for every sport

Must clear all four bars, especially **bar 3**. Non-negotiable constraint:
**market probability is NOT a feature.** That is the whole lesson of §3.

### B. A prop GRADING and ranking system

Ranks *situations* — "who has the best setup" — rather than predicting whether a
prop hits.

**Why this split is right, in the audit's own terms:** a system that ranks
instead of predicting **never has to clear bar 3 or bar 4**. It makes no
probability claim, so there is no market number to beat and no calibration to be
wrong about. It lands in the same category as the unit grades, the one part of
this app never caught being wrong.

It also splits the timelines, which is the practical win: **the grader can ship
on data already in hand; the game model cannot ship until it can be tested
against historical prices.** Bundling them is what made everything wait on the
hardest input.

**The guardrail the grader still needs.** "Not a probability" is not "not
falsifiable". The honest test for a ranking is **rank correlation**: do
higher-graded situations produce better outcomes than lower-graded ones, on games
the grader never saw? Cheap to run on the existing harness, and it is what stops
a grade quietly becoming a vibe. Hold it to this from the first commit.

---

## 6. What to delete, and what to keep

### Delete and rewrite
- **Every fitted coefficient** — all of `model_weights` and `model_calibration`.
  They encode the market anchor.
- **The edge and scoring layer** — `edge_model`, `prop_score`, `good_bets`,
  `live_edge`. They turn an unvalidated probability into a recommendation that
  has been measured as worthless.
- **The generic six-sport prop pipeline.** It has produced predictions for
  exactly one sport and they are wrong by a factor of nine.
- **Golf's model layer.** Its own grading is broken, so nothing in it has ever
  been measured.

### Keep — and this is one working chain, not a pile to reassemble
A model writes a probability to one table. Everything upstream and downstream of
that table already functions and has been measured functioning.

- **The data layer.** 2.76M player-game rows, nine sport keys, venue and opponent
  on 100% of rows, 11–17 seasons deep. Plus, as of 2026-09-01, **635,191 game-line
  rows and 1,805,340 prop rows** of real historical odds.
- **The grading/measurement harness** — `clv_backtest`, `walkforward`, the
  graders, `pick_history`. Every number in this document came from it. **This is
  the most important thing to keep**, because it is what did not exist when the
  MLB model was built, and its absence is precisely why a bad model shipped and
  stayed.
- **The `shadow` flag.** It already caught the home-run model adding 0.4% and
  kept it off the page with no human in the loop. That is the ship gate a rebuild
  needs, and it works today.
- **The job runner and adapter architecture.** Neither touches probabilities.

---

## 7. Order of work

1. **Turn off what is actively wrong.** Soccer props predict 0.583 where 0.064
   happens, and the claimed-edge number has no predictive value. Both are live.
2. **Finish the entity crosswalks** — see `CURRENT.md` §3. 1.3M MLB and NHL prop
   rows cannot reach a player yet.
3. **Build the prop grader first, not the game model.** NBA, NHL and MLB need no
   new data. Hold it to the rank-correlation test from day one.
4. **Then rebuild MLB moneyline alone, with no market feature, judged on bar 3.**
   One sport, one market, against `historical_odds`' 16 years plus the new
   archive. It beats the close out-of-time or it does not ship — and if it does
   not, that is a real answer worth having before seven more sports of work.
5. **Then tennis** — a rating is nearly a complete model in a two-player zero-sum
   sport, and 271,964 match rows sit unused.
6. **Buy NFL snaps and soccer minutes only once the grader has proved itself.**

---

## 8. Data gaps that remain, per sport

| Sport | Blocker |
|---|---|
| MLB, NBA | **None.** Full history, odds, and (MLB) 2.1M Statcast pitches |
| NHL | Player history is 16 months stale — last game `2025-04-17` |
| NFL, CFB | **No snap counts anywhere.** 57 stat keys and not one measures exposure, so a WR1 and a rotational player are indistinguishable. nflverse publishes them free, 2012+ |
| Soccer | **No minutes played.** A 20-minute substitute and a 90-minute starter are identical rows. No xG either |
| Tennis | **Only 8 stat keys, no serve data.** No aces, double faults or first-serve pct, so the ace market cannot be modelled. Games won and match winner can be |
| Golf | 1.03M shot events across **three tournaments** — deep, not wide |

**And one gap shared by all eight, now being fixed:** there was no injury or
availability history at all. `injurySnapshotJob` began retaining it 2026-09-01.
Unlike odds it cannot be bought retroactively.
