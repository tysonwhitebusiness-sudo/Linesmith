# Sports betting models — what they are, what beats a market, and what this repo can actually build

**Written 2026-09-01**, at the operator's request, before any per-sport model
planning. Everything here is grounded in the data this repo now holds and in
what its own measurement harness has already proved about its own models.

---

## 0. What in here comes from the old model layer — and how far to trust it

The operator's challenge, and it applies to more than the one section that
first prompted it: **every measurement the previous model layer produced was
computed against the pre-Track-F data.** That data was missing NHL's entire
moneyline history, contained 48,489 in-play prices, priced MLB from de-vigged
consensus probabilities with a 300-game doubleheader hole, and had no raw MLB
prices before 2025 at all.

So the numbers below split into two kinds, and only one kind is safe to plan on.

**Code facts — verifiable today, independent of any dataset:**

- `marketProbCentered` is in `MONEYLINE_FEATURE_NAMES`
  (`predict/model_fit.py:49`). The model was built from the price it was meant
  to beat. This is a property of the source, not of a fit.
- `EdgeBadge` returns `null`; confidence is hardcoded `null`. Model output is
  already switched off in the UI.
- `model_weights` is 100% MLB; `model_artifacts` has zero rows. Seven sports of
  eight never had a coefficient fitted.

**Measurements — computed on contaminated data, NOT re-verified:**

- Brier 0.2315 against the market's 0.2090 on 153 graded picks.
- Positive-CLV rate 50.0%.
- The claimed-edge bucket analysis (+7% bucket finishing 2.3pp low).
- The seven-family walk-forward ranking (§5 — retracted outright).

Every figure in that second list is quoted in `docs/model-rebuild-plan.md` as
settled. **None of it should be treated as settled now.** Some may well
reproduce — a spot-check of the CLV path found `get_closing_price` reads
`game_odds_history`, and 76.2% of those observations fall inside US game hours,
so that measurement is at least plausibly sound — but plausible is not
verified.

### Does the rebuild decision survive?

Yes, and it should rest on the **first** list rather than the second. A model
whose dominant feature is the closing price cannot systematically beat that
price; that is an argument from construction and needs no data to make. The
measured Brier gap was corroboration, not the case.

### The thing this actually implies

`docs/model-rebuild-plan.md` calls the measurement harness "the most important
thing to keep". **That harness has only ever been run against contaminated
data.** Before it is used to judge anything new, it should be re-run on
`model_game_odds` — not to rescue the old model, but to establish that the
instrument works. An unvalidated ruler is a poor thing to measure a rebuild
with.

---

## 1. The one thing that makes this different from forecasting

A weather model competes against ignorance. A betting model competes against
**a price that already contains every other forecaster's opinion**, including
the injury report, the weather, the lineup, and the money of everyone who
disagreed.

So there are two completely different questions, and only one of them pays:

| Question | Difficulty | Pays? |
|---|---|---|
| Who will win? | Easy — the favourite, usually | No |
| Is this price wrong? | Very hard | Yes |

Everything below is about the second one.

### The benchmark is the CLOSING line, not the opening one

A market gets sharper as money arrives. The **close** — the last price before
the event starts — is the most informed number that will ever exist about that
game, and it is the only honest benchmark. A model that beats an opener has
usually just discovered that the opener was stale.

This repo has already measured how efficient a close is. Across `odds_archive`,
the market's own implied probability tracks reality to within **±0.022** in every
sport and every source (gate 9.2). MLB SBR: implied .5351 against a realised
.5364 on 28,039 games. That is your opponent.

---

## 2. The arithmetic that decides everything

**Vig (overround)** is the bookmaker's margin. Add the two sides' implied
probabilities: a fair market sums to 1.00, a real one sums to more. This repo's
measured numbers:

| Market | Booksum | Fair 50/50 priced at | Edge you need |
|---|---|---|---|
| Game moneylines | **1.029 – 1.056** | ~51.5% – 52.8% | **1.5 – 2.8 pp** |
| Player props | **1.066 – 1.079** | ~53.3% – 54.0% | **3.3 – 4.0 pp** |

**Props cost roughly double to play.** That single fact shapes strategy: props
are less efficiently priced *and* more expensive, so the edge has to be bigger
before it is real. Anyone who tells you props are "easier" is quoting the first
half.

### How long it takes to know if you are right

At a standard −110 price, one bet has a standard deviation of about one unit.
To distinguish a **2% ROI from zero** with any confidence you need on the order
of **10,000 bets**. At 5 bets a day that is five years.

This is the single most important practical fact in advantage betting, and it is
why **CLV — closing line value — is the metric that matters day to day**. If you
bet a team at +150 and it closes at +130, you got a better price than the
sharpest number available. CLV can be measured on *every* bet immediately and
converges in hundreds of bets rather than tens of thousands. Profit follows CLV;
CLV does not follow profit.

`docs/model-rebuild-plan.md` records that this app's MLB model had a positive-CLV
rate of **50.0%** across its graded history — a coin flip, and the finding that
triggered the rebuild. **Measured on pre-Track-F data and not re-verified; see
§0.** The structural reason it could not have been much better is §3, and that
part does not depend on the measurement.

---

## 3. Why the last model failed — the mistake worth not repeating

From the audit in `docs/model-rebuild-plan.md`:

```
marketProbCentered   3.5170   <- the market's own price, as a feature
simWinProb           2.2941
eloProb             -0.8269
rawLog5             -0.5952
```

The largest coefficient was **the price the model was trying to beat**. A model
built from the closing line will always land near the closing line and will
always report a small "edge" that is really its own noise. Bucketing 5,850
graded picks by claimed edge, the **+7% bucket finished 2.3pp below** the
market's implied probability.

**Rule that follows: market probability is not a feature.** You may use the
market to *evaluate*, never to *predict*. The thing that decides whether a model
ships must not be the thing that fitted it.

---

## 4. The families of model

### A. No model at all — line shopping and arbitrage

Not a prediction. You hold prices from many books; when they disagree, take the
best one. With enough books, occasionally the best over and the best under sum
to less than 1.00 and the bet is risk-free.

**This repo already has the data.** `odds_archive` holds up to 19 books per game,
and tennis's `market_max` series sums below 1.00 on **36% of matches** (41,494
rows, mean booksum 1.0029). That is a measured cross-book arbitrage rate.

- *Skill needed:* low. *Edge:* small but real. *Limit:* books restrict winners.
- **Feasible today.** This is the only category that needs no model at all.

### B. Ratings models — Elo, Glicko, Bradley–Terry

Every team/player carries one number for strength; it moves after each result by
how surprising the result was. Convert two ratings to a win probability.

- *Inputs:* results only. Nothing else.
- *Strength:* extremely robust, few parameters, hard to overfit, works with
  thin data.
- *Weakness:* ignores everything a rating cannot express — injuries, rest,
  travel, matchup.
- **Best fit here: tennis.** A two-player zero-sum sport is where a rating is
  nearly a complete model, and you hold **56,340 matches**.

### C. Regression on features — logistic regression, gradient boosting

Hand-built features (recent form, rest days, home/away, pace, injuries) fed to a
classifier.

- *Strength:* can express what a rating cannot.
- *Weakness:* every feature is a chance to leak the future. This is where most
  amateur models die — and where **this repo already died once**.
- *Needs:* strict walk-forward discipline. Never fit on data later than the
  game being predicted.

### D. Simulation — Monte Carlo from component distributions

Model the parts, play the game 10,000 times. MLB is the canonical case: lineup
versus pitcher, plate appearance by plate appearance.

- *Strength:* naturally produces totals, spreads and props from one engine.
- *Weakness:* expensive, and wrong component assumptions compound.
- **Best fit here: MLB**, which has 31,781 priced games *and* 2.1M Statcast
  pitches.

### E. Market-microstructure — modelling the line, not the game

Predict where the price is going rather than who wins. Opener→closer drift,
steam, book disagreement.

- *Strength:* the target (the closing line) is far more predictable than the
  outcome.
- **This repo holds open+close on a real subset** — 11,924 MLB, 37,572 NBA,
  39,138 NHL rows carry both.

### F. Prop graders — ranking situations, not predicting them

Rank *who has the best setup* rather than claiming a probability. Because it
makes no probability claim, it never has to beat a price or be calibrated. It is
falsifiable by **rank correlation**: do higher-graded situations produce better
outcomes on data the grader never saw?

This is what `docs/model-rebuild-plan.md` chose to build first, and the reason
is timing: **a grader can ship on data already in hand; a game model cannot
ship until it can be tested against historical prices.**

---

## 5. Simple versus complex — and why this repo's own experiment does NOT settle it

An earlier draft of this document cited the walk-forward bake-off in
`walkforward_results` as evidence that simple beats complex here:

```
formula (hand-built)  0.6744        CatBoost   0.6754
stacking              0.6772        XGBoost    0.6827
LightGBM              0.6852        Bradley-Terry 0.6887
MLP                   0.6938        coin flip  0.6931
```

**That was wrong, and the operator was right to reject it. The experiment
cannot answer this question.** Two reasons, both disqualifying on their own.

### Every one of the seven families was handed the market price

All seven were fitted on one shared feature set —
`MONEYLINE_FEATURE_NAMES` in `python-odds-service/src/predict/model_fit.py:49`:

```
rawLog5, venueDiff, formDiff, parkFactorCentered,
eloProb, marketProbCentered, simWinProb
```

`marketProbCentered` is the closing price, and §3 shows it ended up carrying a
weight of **3.517** — larger than every other feature combined. When one feature
is very nearly the answer, **every family converges on "reproduce the market",
and the ranking between them stops measuring which one finds signal and starts
measuring which one adds least noise on top of a number it was given.**

The observed ordering is exactly what that condition predicts: the hand-built
formula, which leans on the market most directly, wins; the most flexible
learner, the MLP, does worst because it has the most freedom to fit residual
noise — and lands *behind a coin flip*. That is not a finding about model
families. It is a description of what happens when you give seven models the
answer key and grade them on their handwriting.

### And the data underneath it was the pre-Track-F data

It ran on 2026-08-26: MLB seasons 2020–2023 train, 2024–2025 test, 7,264 and
4,407 games. At that point MLB's prices came from `historical_odds` — de-vigged
consensus probabilities with a 300-game doubleheader hole — and the archive
still contained the 48,489 in-play rows. The raw-price MLB history that now
exists (31,781 games, 2010–2026) had not been loaded.

### So what does argue for starting simple?

Reasons that stand on their own, none of which depend on that experiment:

- **Sample size.** Between 4,000 and 32,000 games per sport. A gradient-boosted
  model with hundreds of splits has far more capacity than that supports, and
  the residual signal after the market is small.
- **The signal is small and smooth by construction.** You are modelling the
  *error* of a price that is already accurate to ±0.022. There is not much
  structure left to find, and what is left is unlikely to be sharply non-linear.
- **You have to be able to see why it disagrees.** Bar 3 means shipping only
  when a model beats the close. When it does, you need to know whether that is a
  real effect or a quirk of one season — which is far easier with seven
  interpretable coefficients than with an ensemble.
- **Complex models fail quietly.** The leakage incidents in §8 were caught
  because someone could reason about what the numbers should look like.

**The honest position: whether complexity helps here is currently UNKNOWN.** The
bake-off should be re-run on `model_game_odds`, with `marketProbCentered`
removed, before anyone claims either way. That is a real experiment worth doing
early — it is cheap, the harness already exists, and its answer changes the
shape of everything after it.

## 6. Feasibility per sport, with this repo's real numbers

Trainable = one row per game with a closing price and a result, via
`model_game_odds`.

| Sport | Games | Best-fit approach | Honest read |
|---|---|---|---|
| **Tennis** | 56,340 | Elo / Bradley-Terry | Best ratio of data to model complexity you own. Two players, zero-sum, no lineup. **Strongest first candidate after MLB.** |
| **MLB** | 31,781 + 2.1M pitches | Simulation, then ratings | Deepest data. Also the most-studied market. High variance per game means the market is *less* sharp than NFL. |
| **NBA** | 24,705 | Ratings + rest/travel features | Very efficient market. Totals and props softer than sides. |
| **NHL** | 24,336 | Ratings | Low-scoring, high variance — the market is genuinely less certain, which cuts both ways. |
| **MLS** | 6,397 | Poisson / Dixon-Coles | Three-way market. Less analyst attention than EPL. |
| **NFL** | 5,355 | Ratings + situational | **The most efficient market in sport** and the least data. Hardest place to find an edge. |
| **EPL** | 4,200 | Poisson / Dixon-Coles | Heavily modelled by professionals. |
| **CFB** | 4,017 ML / 14,514 spread | Ratings on spread | **The spread is the market here** — moneylines only exist from 2021. Wide talent gaps make ratings work well. |

**The counter-intuitive part:** the sports with the *most* data (NFL, NBA sides)
are the *hardest* to beat, because attention and liquidity track the same thing.
The opportunity is usually in smaller markets and player props.

---

## 7. Where the edge actually is

Ranked by how soft the market tends to be:

1. **Player props on secondary markets** — a book prices hundreds per game
   algorithmically and cannot watch them all. Costs ~2× the vig, so the edge
   must be bigger. **You hold 1.8M prop rows and 10,020–73,711 graded
   player-games per sport.**
2. **Smaller leagues and lower-tier events** — less money, less attention.
3. **Live/in-play** — fast-moving, but you now know from the audit how
   different an in-play price is: the live books in this archive score a Brier
   of **0.032** against 0.208–0.232 pre-game. That is not an edge, it is a
   different game.
4. **Totals** — usually less efficient than sides.
5. **Game sides in major leagues** — the sharpest prices that exist. Beating
   them is a real achievement and a poor place to start.

This is why `model-rebuild-plan.md` sequences the **prop grader first**.

---

## 8. How to know it is working — and the four ways to fool yourself

The four bars from `docs/model-rebuild-plan.md`, in order. Failing an early one
makes the later ones meaningless:

1. **It predicts something that gets settled.**
2. **It beats the naive baseline** (the base rate).
3. **It beats the market price, out-of-time.** *The only bar that matters
   commercially.*
4. **It is calibrated** — when it says 60%, 60% happens, checked in buckets.

### The four classic self-deceptions

- **Leakage.** Any feature computed with knowledge of the outcome. This repo has
  been bitten twice: `Winner`/`Loser` column names in the tennis files, and
  48,489 in-play prices sitting in the archive as ordinary bookmakers, found
  only when Brier was computed **per bookmaker**.
- **Backtest overfitting.** Trying enough variants that one looks good. The
  defence is walk-forward evaluation and holding out data you never touch.
- **Using the market as a feature.** See §3.
- **Judging on ROI too early.** See §2 — you need ~10,000 bets.

---

## 9. What to read next, and a suggested order

1. **`docs/model-rebuild-plan.md`** — the audit that found the existing model
   loses to the market, and the two-system decision that followed.
2. **`docs/sourcing-completion-gameplan-2026-09-01.md`** — Track F, what data
   now exists.
3. **`docs/CURRENT.md` §2** — the three query hazards. Use the
   `model_game_odds` view.

**Suggested build order**, consistent with the rebuild plan:

1. **Line shopping / arb detection.** No model, data already in hand, immediate.
2. **The prop grader**, held to a rank-correlation test from the first commit.
   MLB has 73,711 graded player-games; NHL now has 10,020.
3. **MLB moneyline alone**, no market feature, judged on bar 3. One sport, one
   market. If it cannot beat the close, that is a real answer worth having
   before seven more sports of work.
4. **Tennis Elo** — the best data-to-complexity ratio you own.
5. **Everything else**, only after one of the above has cleared bar 3.

---

## 10. The honest summary

- You are competing against the most informed price that exists, and it is
  right to within ±2.2pp in every sport you hold.
- Most people lose. The vig alone requires a 1.5–4.0pp edge just to break even.
- **Whether complexity helps here is UNKNOWN.** The one experiment that looked
  like an answer gave all seven models the market price as a feature, so it
  measured handwriting, not signal. Re-run it on clean data early (§5).
- CLV, not profit, is how you will know within a reasonable time.
- The edge is more likely in props and small markets than in NFL sides.
- The single most valuable thing this repo owns is not the model code — it is
  the **measurement harness**, which is what caught the last model being wrong.
  Keep it pointed at everything you build.
