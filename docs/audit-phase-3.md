# Linesmith Audit — Phase 3: Odds Math + Prediction Models

**Date:** 2026-08-27 · **Scope:** every calculation the app performs on prices,
every model that produces a probability, and the pipeline behaviour around both.

Read `docs/audit-handoff-phase-2.md` first — its §1 corrections are assumed here.
Where Phase 2 flagged something as unanswerable, this phase answers it with real
numbers wherever the data allowed.

---

## 0. The short version

I ran your real code against known-correct values and your real database against
the outcomes you have already recorded. Three things came out of that:

**The arithmetic is fine. The plumbing around it is not, and the models are
worse than you think.**

1. **Your odds conversions and your de-vig function are correct.** I verified
   them numerically against hand-computed values including every edge case
   (even money, negative lines, round-tripping). No sign errors, no unit
   confusion. This is the part you can trust. §2.

2. **The inputs those correct functions are fed are frequently garbage.** The
   "best total" and "best spread" shown for a game are assembled by taking the
   best over-price from one book and the best under-price from another
   *without checking they are for the same number*. Right now, 11 of 39 MLB
   games in your database produce a total whose two sides are for different
   lines. The de-vig then runs on that impossible pair and the app reports an
   edge computed from it. On one real game today the arithmetic produces a
   claimed edge of roughly **+85 percentage points**. See C1.

3. **Your models do not beat the market, and one of them has no predictive
   power at all.** Measured on your own graded history:
   - Across the 3,615 rows where both a model probability and a market
     probability exist, the market wins: Brier 0.2294 vs the model's 0.2329,
     paired t = 2.63. The model loses in 10 of the 11 markets with ≥50 rows.
   - Picks the app flags as `edge ≥ 3%` win **40.8%** of the time. The market
     price on those same picks implied **41.0%**. The realized excess is
     −0.2 points. Your headline number has, so far, no measurable value.
   - The MLB **totals** model's reliability curve is flat: when it says 7% the
     over hits 46%; when it says 92% the over hits 45%. Across 31,846 graded
     games the realized rate never leaves the 45–51% band regardless of what
     the model predicted. It is noise with a confidence interval on it. See C2.

There is also a fourth finding that is not about any single calculation: **the
odds system and the app are not two systems, they are one system implemented
twice**, in two languages, writing to 22 of the same database tables with no
ownership boundary. That is the root cause behind H2, H6 and H8, and it is
covered on its own in §4.

**If you only read two sections: §3 is this whole audit in plain language, and
§7 is what to do first.**

None of this means the project is wasted. Your data assets are real, your
walk-forward backfills are methodologically clean, and your Prop Score does rank
picks in the right order. But the specific claim the product makes — "we find
you value the market has missed" — is not currently supported by your own
numbers, and several of the numbers on screen are wrong for mechanical reasons.

---

## 1. How to read this

Findings are ranked Critical → High → Medium → Low. Each one gives you: what it
is in plain language, where it lives, why it matters (including what standard
practice is, since you asked me to assume you don't know), a concrete fix, rough
effort, and dependencies.

**§2 is the "what you can trust" list.** I have put it first deliberately. You
asked to know what's correct, not only what's broken, and there is more correct
here than the finding count suggests.

Everything numeric below was measured, not estimated. Queries are reproducible
against your live database; the ones that took real work are quoted inline.

---

## 2. Verified correct — the things you can trust

I compiled your real `lib/odds/display.ts` and `lib/odds/devig.ts` to JavaScript
and executed them against hand-computed reference values. These are the actual
functions, not a re-implementation.

### 2.1 American ↔ decimal conversion — CORRECT

| Input | Function | Got | Expected | |
|---|---|---|---|---|
| −110 | `americanToDecimal` | 1.9090909090909092 | 1.909090… | PASS |
| +100 | `americanToDecimal` | 2 | 2 | PASS |
| −100 | `americanToDecimal` | 2 | 2 | PASS |
| +250 | `americanToDecimal` | 3.5 | 3.5 | PASS |
| −2000 | `americanToDecimal` | 1.05 | 1.05 | PASS |
| 0 | `americanToDecimal` | undefined | undefined | PASS |
| 1.909090… | `decimalToAmerican` | −110 | −110 | PASS |
| 2.0 | `decimalToAmerican` | +100 | +100 | PASS |
| 1.9999 | `decimalToAmerican` | −100 | −100 | PASS |
| 1.0 | `decimalToAmerican` | undefined | undefined | PASS |

I also round-tripped every American price from −1000 to +1000 (skipping the
invalid −99…+99 band). **One** value did not round-trip: −100 → 2.0 → +100.
That is not a bug — −100 and +100 are two spellings of the same even-money
price, and the standard convention is to normalise to +100. The threshold in
`decimalToAmerican` (`decimal >= 2`) is placed correctly.

### 2.2 Implied probability — CORRECT

`impliedFromDecimal(americanToDecimal(-110))` = 0.5238095238, which is 11/21.
Correct to machine precision.

### 2.3 De-vig — CORRECT (for the method it implements)

`devigTwoWay` implements standard **multiplicative (proportional) de-vig**:
each side's raw implied probability divided by the sum of both.

- `devigTwoWay(-110, -110)` → `{a: 0.5, b: 0.5}`. Exactly right.
- `devigTwoWay(-150, +130)` → `{a: 0.579832, b: 0.420168}`. Raw probabilities
  are 0.600000 and 0.434783, summing to 1.034783 (a 3.48% overround); dividing
  each by that total gives exactly the returned values. Correct.

The guards are also right: it refuses a decimal ≤ 1, refuses a one-sided price
rather than inventing the other half, and both `impliedPair` (OddsChip) and
`homeShare` (display.ts) route through this single implementation rather than
each having their own copy. The consolidation was a good call — a second copy is
exactly where a sign error would hide.

There is a legitimate criticism of *which* de-vig method you chose, but it is a
Medium (M3), not an error.

### 2.4 `lib/core/windowedStat.ts` — CORRECT and unusually well-designed

This is the best file in the codebase I read. The `insufficient` variant with no
`rate` field on it — so a consumer that forgets to check `status` fails to
compile instead of rendering a plausible lie — is a genuinely good piece of type
design, and most professional codebases don't do it. The window arithmetic, the
signed streak, and the "don't count an unparseable token as a zero" rule are all
correct. Leave it alone.

### 2.5 Both walk-forward backfills — NO LEAKAGE

You asked me to check date boundaries carefully. I did, and these two are clean:

- **`lib/odds/props/modelBackfill.ts:71`** — `priorGames = eligible.slice(windowStart, i)`
  where the graded game is `eligible[i]`. The window ends strictly before the
  target. Correct.
- **`lib/sports/mlb/gameModelBackfill.ts:58-107`** — the prediction is emitted
  from the accumulator, and the accumulator is only updated with the current
  game's runs *after* the `entries.push()` block. Correct, and the
  `WARMUP_GAMES = 15` floor is a sensible guard against early-season noise.

Phase 2 flagged `writeBackfill` as where leakage would hide because `surfaced_at`
and `graded_at` are written with the same value. That structural concern is
valid, but I traced both callers and neither actually leaks. The schema can't
prove it; the code does. (This is **not** true of the generic-sports path — see H4.)

### 2.6 Python `live_edge.py`'s edge design — MATHEMATICALLY SOUND

`edge = sharp_book_devigged_probability(side) − raw_implied_probability_at_the_bettable_book`.

This is correct and it is the right idea. Because `raw_implied` includes the vig
you'd actually pay, `edge > 0` is algebraically equivalent to positive expected
value: EV per unit staked = `p_sharp × decimal − 1 = p_sharp / p_raw − 1`, which
has the same sign as `p_sharp − p_raw`. Refusing to mix books or providers when
finding the counterpart side (`_two_sided_devigged_for_row`) is also correct —
that is exactly the mistake that would misrepresent the vig.

It has never written a row (see H8), and its Tier-2 fallback has a mild bias
(M14), but the core design is right and better than what TypeScript is doing.

### 2.7 Model fitting uses proper temporal splits

`model_fit.py` / `modelFit.ts` split by *season*, not randomly
(`train_seasons=[2010…2023]`, `holdout_seasons=[2024,2025]` for the active v8
weights). `walkforward.py` runs expanding-window folds with a final held-out
test. That is the correct methodology for time-series prediction and a lot of
people get it wrong. The problem with these models is what they're compared
*against* (H3), not how they're split.

### 2.8 `MAX_PLAUSIBLE_DECIMAL_ODDS` guard

Capping "best price" selection at decimal 30 to reject a garbage +10000 quote is
a real, correct fix for a real bug, and sharing one constant across TS and
Python was the right instinct. It's just not applied everywhere it should be (H6).

---

## 3. The same findings, in plain language

This section is the whole audit without the jargon. Everything here is covered
in detail below with line numbers and queries; nothing here is new.

### The one-paragraph version

Your app does three jobs: convert and compare prices, predict what will happen,
and tell you where there's value. **The price conversions are correct. The price
comparison is broken for totals and spreads. The predictions are much weaker
than they look. And the "value" number — the edge % — has, so far, no measurable
value at all.**

### A bit of vocabulary

- **Brier score** — a way of grading probability guesses. Lower is better. If
  you flipped a coin and said "50%" every time you would score **0.25**. That is
  the number to beat. Worse than 0.25 means you would have done better guessing.
- **Calibration** — when you say 70%, does it happen 70% of the time? A model can
  rank things correctly and still be badly calibrated.
- **The market** — the bookmakers' own prices with their profit margin stripped
  out. This is the benchmark. Thousands of informed people set it collectively.
  Beating it is the whole game.

### What's actually fine

Your basic odds math is correct. I compiled your real code and ran it against
hand-checked answers — converting −110 to decimal, working out implied
probability, stripping out the bookmaker's margin. All correct, including the
fiddly edge cases. No sign errors.

Your historical backtests are also clean. When you tested "what would the model
have said before this game," it genuinely only used data from before that game.
That is the mistake people make most often, and you avoided it.

### What's broken

**1. "Best total" compares different bets and calls them the same bet.**

Say you want the best price on "over 8.5 runs." Your code finds the best *over*
price at one bookmaker and the best *under* price at another — but never checks
the two are for the same number. So it might pair "over 2.5" from one book with
"under 7.5" from another, then label the whole thing "2.5."

It is like pricing a large pizza at one shop, a small pizza at another, and
advertising the combination as the best deal on a large.

Right now **11 of 39 MLB games in your database do this.** On one real game the
app would show an **85-point edge** on a bet that does not exist. (C1)

**2. The totals model is pure noise.**

Over 31,846 real graded games:

- When the model said **7%** likely → it happened **46%** of the time
- When the model said **92%** likely → it happened **45%** of the time

The answer is ~48% no matter what the model predicts. Its output and reality are
unrelated. It scores 0.271 — *worse than the coin flip*.

The cause: it assumes runs scored follow a particular statistical pattern
(Poisson). Checked against your own data, real baseball scoring is more than
twice as spread out as that assumption allows. The assumption is simply wrong
for this sport. (C2)

**3. Under bets show the score for the opposite bet.**

If a card says "Under 4.5 strikeouts — model says 58%," that 58% is actually the
model's confidence in the **over**. The under is 42%. The edge shown is exactly
backwards — a plus sign where there should be a minus.

Confirmed two ways: reading the code, and checking the graded results — those
rows score terribly as stored and score *well* when you flip them. That is the
signature of a stored number describing the wrong outcome.

Only ~500 of your 362,000 records are affected, because under-side picks are
rare. Clean, cheap fix. (C3)

**4. The prices on screen are 17 hours old and nothing says so.**

Three separate safeguards should prevent this. All three are broken:

- The "is this price stale?" check reads a fixed setting from a config file, not
  the actual age of the price. **It has never once triggered, and cannot.**
- The API stamps every response "fetched just now," always, regardless of real age.
- The price chip shows capture time only on hover, and only as a clock time with
  no date — so 2:49 AM today and 2:49 AM last week look identical.

For a betting app this is the one that would actually cost someone money. (C4)

**5. Your model loses to the bookmakers.**

Across every record where you have both a model prediction and a market price:
your model scores **0.2329**, the market scores **0.2294**. The market is better,
the gap is statistically real rather than luck, and your model loses in 10 of the
11 markets. (C5)

**6. The edge % has no demonstrated value.**

This is the big one, because it is the product's core promise.

Picks the app flags as **"3%+ edge"** — meaning "we think this is undervalued" —
won **40.8%** of the time. The bookmaker's price on those exact same picks
implied **41.0%**.

The market was right and you were not. The claimed edge produced **zero** actual
advantage. (C5)

**7. The model is over-confident.**

When it says 73%, it happens 63%. That gap holds all the way up the range,
getting worse the more confident it gets.

This matters because it *explains* #6. A model that is 10 points too confident
will manufacture a 10-point "edge" out of thin air. The fix is well understood
and cheap — it is called calibration, you already built the database table for
it, and the table is empty. (H1)

### What this means practically

The prediction half of the product does not work yet. That is the honest read.

But the **line-shopping** half — "here are 22 bookmakers' prices for this prop,
here is the best one" — creates real value with no model required. That part just
needs the freshness and comparison bugs fixed. It is a defensible product on its
own.

---

## 4. Root cause: this is one system implemented twice, not two systems

Worth stating separately because it is the root cause behind H2, H6 and H8, and
because the operator's own working model of the architecture was different.

### The assumption being corrected

The natural way to describe this project is "a Render Python worker plus a local
OddsHarvester job, both feeding Supabase, with a Next.js app reading it." That is
wrong in one consequential way: **the Next.js app is not a reader. It is a third
compute-and-write location, and it is where most of this audit's Critical
findings live.**

There are three places that compute and write:

| | what it does | state at time of audit |
|---|---|---|
| **Render Python worker** | Odds *fetching* jobs + some MLB/generic prediction jobs | dead ~17h (all jobs 984–1052 min stale) |
| **OddsHarvester (local)** | Scrapes OddsPortal → `game_odds_book_lines` | working — the only healthy feed |
| **The Next.js app (TypeScript)** | Rebuilds snapshots, runs the MLB game model, generates and logs prop candidates, grades them, writes odds history | running, and writing to Supabase throughout |

Evidence, all verified this session:

- `lib/scheduler.ts:95-96` — two `setInterval` timers run **inside the Next.js
  process**: `refreshMlb` (snapshot rebuild) and `refreshCalibration` (recomputes
  and writes `snapshot_cache`).
- 30+ TypeScript files issue writes to Postgres, including `pickHistoryLog.ts`,
  `grading.ts`, `gameOddsLog.ts`, `registry.ts`, `snapshotRebuild.ts`,
  `golf/adapter.ts` and both backfills.
- Decisive: **MLB `pick_history` rows were written at 19:31** on the audit date
  while every Python job's last run was ~02:49. The worker was 17 hours dead.
  TypeScript wrote them.
- Same for `game_odds_history` — 6,013 rows in the last 24h, written by
  `logGameOddsHistory` inside the `/api/odds/lines` GET handler, on every request.

### The shared-table map

Of 35 tables, **22 have writers in both languages**:

```
game_odds_book_lines   game_odds_history            game_picks
game_sim_cache         golf_hole_scores             golf_model_predictions
golf_round_scores      golf_tournament_predictions  golf_tournament_results
golf_tournaments       model_weights                odds_cache
park_factors           pick_history                 pitcher_game_score_history
prop_odds              prop_odds_history            provider_usage
snapshot_cache         system_events                team_elo_history
team_hr_rate_allowed
```

Python-only (6): `player_game_history`, `job_health_checks`, `model_calibration`,
`model_artifacts`, `mlb_game_model_cache`, `walkforward_results`.
TypeScript-only (6): `bets`, `picks`, `watchlist`, `tracked_lines`,
`historical_odds`, `odds_unresolved`.

*Method: grep for raw `INSERT`/`UPDATE`/`DELETE` statements across both trees.
Some writes route through helpers, so 22 is a floor rather than an exact count —
the direction is unambiguous.*

The Python files say it themselves. `odds_math.py`: "Direct port of
`lib/odds/devig.ts`." `prop_score.py`: "Direct port of
`lib/odds/props/propScore.ts` — not a reimplementation." `live_edge.py`,
`entity_resolution.py` and `db.py`'s `log_surfaced` carry the same header. This
is one codebase's logic, transcribed.

### Why duplication is worse here than disconnection

Disconnected systems fail loudly — a missing integration is visible. Two writers
on one table with no owner fails silently, and that accounts for a large share of
this audit:

- **H8** — both write `pick_history.edge`, with two incompatible definitions, and
  one threshold applied to whichever arrives.
- **H2** — TypeScript writes the unfitted moneyline model to `pick_history`;
  Python writes the fitted one to `game_picks`. Nobody reconciles them, and
  `/diagnostics` scores the wrong one.
- **Phase 2 §1.4** — golf has two live prediction pipelines writing all five golf
  tables, from separately-maintained ported model code. They can disagree.
- **H6** — the implausible-price guard was fixed in Python and missed in the
  TypeScript copy. Textbook duplicated-logic drift.
- **Phase 2 §1.8** — `odds_unresolved` has a TypeScript-only writer, so
  `/diagnostics` renders pre-cutover data as current.
- **Phase 2 C2** — both halves compete for the same ~15 Postgres connections.

### Why the operator's model drifted

The Python cutover was real but narrower than it reads. It replaced the
**scheduled odds-provider fetch jobs**. It did not replace the model, prediction
or grading path — that stayed in TypeScript. Phase 2 §1.5 already caught that
`CLAUDE.md` overstates this ("the Python worker fully replaced the TS provider
jobs" — it replaced the *scheduled* ones; the on-demand TypeScript paths remain
live). This audit corroborates that and extends it: the overlap is far larger
than the provider jobs.

### What this changes about the remedy

If the two halves were disconnected, the fix would be "wire them together." The
actual fix is the reverse: **draw a boundary and delete a side.**

One owner per concern:

- Odds *fetching* → the Python worker (already mostly true).
- Odds *math and models* → pick one. Today it is both, and the TypeScript copy is
  the one users actually see.
- Every table → exactly one writer, enforced.

Turning the Render worker back on fixes none of C1, C2, C3, C5 or H6 — those
ship with the web app.

The operator's own recorded position is to delete the old TypeScript outright once
Python is proven. The map above is what that would concretely mean. The catch is
that "proven" is not currently true: the worker has been dead 17 hours and the
TypeScript path is the only reason the app has data at all today. This is a
decision for the Phase 1–5 session, not a change to make mid-audit.

---

## 5. Findings

Ranked Critical → High → Medium → Low, as set out in §1.

## CRITICAL

### C1. "Best total" and "best spread" combine prices for different lines, then de-vig them

**What it is.** When the app shows you the best available total for a game, it
finds the highest over-price across every book and, *separately*, the highest
under-price across every book — and then reports them together as if they were
two sides of one market. It does not check that the two books were quoting the
same number. It then labels the pair with whichever line the over-side book
happened to be using, de-vigs the mismatched pair, and computes an edge from the
result.

**Where.**
- `lib/odds/display.ts:206` `bestTotalFromBooks` — `point: overBest?.point ?? underBest?.point`
- `lib/odds/display.ts:230` `bestSpreadFromBooks` — same shape
- `lib/db/client.ts:798-800` — `mergeGameOddsBookLineRows` calls all three and
  stamps the result onto every `UnifiedGameLine`
- `lib/odds/gameEdge.ts:46` `computeTotalEdge` — de-vigs that pair and subtracts
  it from the model
- Reachable from `components/GameDetail.tsx:1604`, `components/GameLinesView.tsx:134`,
  `lib/sports/mlb/adapters/playerDetailAdapter.ts:618`, and every non-MLB sport
  via `app/api/odds/lines/route.ts:150`.

**The failure, with your real data.** I ran the same selection logic your code
runs, over your live `game_odds_book_lines` table, using your own plausibility
filter (`1 < decimal ≤ 30`) and your own per-book freshest-row merge policy:

```
34 MLB games with a two-sided total   →  11 have mismatched points  (28%)
 8 MLB games with a two-sided spread  →   4 are incoherent          (50%)
```

Real examples pulled from your database this session:

| game_id | best over | best under |
|---|---|---|
| 825039 | **2.5** @ 15.00 (FanDuel) | **7.5** @ 2.20 (tab_au) |
| 823180 | **19.5** @ 9.80 (FanDuel) | **8.5** @ 5.70 (matchbook) |
| 823506 | **12.5** @ 3.20 (FanDuel) | **9.5** @ 4.40 (Fanatics) |
| 822772 | **9.5** @ 12.00 (Fanatics) | **7.5** @ 2.25 (tab_au) |

Take 825039. `bestTotalFromBooks` returns `{point: 2.5, overPrice: +1400,
underPrice: +120}`. `computeTotalEdge` then:

1. computes the model's `P(total > 2.5)` — for a normal MLB game this is ~0.97;
2. de-vigs (+1400, +120) → raw 0.0667 and 0.4545, sum 0.5212, so market
   `P(over) = 0.128`;
3. reports `edge = 0.97 − 0.128 = +0.84`.

**The app will display an 84-point edge on "Over 2.5" for a game where the real
line is 8.5.** That is not a rounding problem. That is a number a user could act
on with money.

I confirmed the de-vig arithmetic by running your compiled code on a smaller
synthetic case: over 8.5 @ 2.10 (book A) and under 7.5 @ 2.35 (book B) →
`{point: 8.5, overPrice: +110, underPrice: +135}` → de-vigged
`{a: 0.5281, b: 0.4719}`. Note the raw sum is 0.9017 — *below* 1.0. A genuine
two-sided book price always sums above 1.0 (that's the vig). A sum below 1.0 is
a mathematical tell that the pair is not a real market, and nothing in the code
checks for it.

**Why this matters / standard practice.** A total and a spread are only
meaningful as a (line, price) pair. "Over" at 8.5 and "over" at 7.5 are
different bets. Line-shopping tools handle this by comparing *within* a line:
group every book's quotes by point, find the best price at each point, and
present the whole ladder — or pick the consensus/modal point and shop only
within it. Never construct a pair that no book offers. De-vig is only defined
for a genuine two-sided price from one book; the file comment on `devigTwoWay`
says exactly this, and the call site violates it.

Moneyline is a different case and is *defensible*: home and away are the same
proposition at every book, so taking the best of each and normalising is a
recognised (if imperfect) way to build a low-vig consensus. I checked it
numerically — best-of-both across two books gave 0.5122 vs a per-book average of
0.5130, close enough not to be a finding. The bug is specific to the two markets
that carry a `point`.

**Fix.**

1. In `bestTotalFromBooks` / `bestSpreadFromBooks`, resolve the market's point
   *first* — use the modal point across books, exactly as
   `live_edge.real_line_for()` already does for props (that function is right;
   reuse its logic). Then select the best over-price and best under-price
   **restricted to rows at that point**. Return `null` for a side with no quote
   at the chosen point rather than reaching to another line.
2. Add a guard in `devigTwoWay` (or a wrapper used by the game-line path) that
   returns `null` when `rawA + rawB < 1`. A sub-1.0 overround on a two-sided
   book price is either a data error or a mismatched pair; either way it must
   not produce an edge.
3. Make `UnifiedGameLine['total']`/`['spread']` carry the point as a required
   field alongside both prices, so a future refactor can't reintroduce the
   `?? underBest?.point` fallback.

**Effort.** ~half a day for (1) and (2). The type change in (3) is another few
hours and worth doing at the same time.

**Dependencies.** H10 (the underlying data also contains rows that can't be the
same proposition) should be fixed alongside, or the modal-point selection will
be picking a mode out of a contaminated pool.

---

### C2. The MLB totals model has no predictive power, and its distributional assumption is empirically false

**What it is.** `computeTotalModel` assumes combined runs in an MLB game are
Poisson-distributed and computes `P(total > line)` from that. Poisson requires
that the variance of the quantity equals its mean. For MLB runs it does not —
not marginally, by a factor of more than two. The resulting probabilities are
not merely miscalibrated; they carry no information about the outcome at all.

**Where.** `lib/sports/mlb/gameModel.ts:325-350`
(`poissonOverProbability` / `computeTotalModel`), ported to
`python-odds-service/src/predict/game_model.py`. Logged to `pick_history` by
`lib/odds/props/pickHistoryLog.ts:207` on every `/api/odds/lines` request.

**The evidence.** Measured over your own `pick_history`, using `actual_value`
(the real combined score) for `dimension='total'`:

```
31,846 games:  mean runs = 8.86,  variance = 20.70,  dispersion index = 2.34
                                              (Poisson requires exactly 1.00)
```

The distribution is also not Poisson-*shaped*. Odd totals are systematically
more frequent than the even totals either side of them — 3 runs (2,110 games)
beats 4 runs (1,697); 5 (3,273) beats 6 (2,396); 7 (3,296) beats 8 (2,255);
9 (2,911) beats 10 (2,093); 11 (2,414) beats 12 (1,597). A Poisson distribution
is smooth and cannot represent that at all. (It is a real baseball artefact —
walk-off wins end the game mid-inning — but the point is your model has no way
to know.)

And here is the reliability diagram, over all 31,846 graded rows:

| model says | n | realized over-rate |
|---|---:|---:|
| 6.8% | 96 | **45.8%** |
| 16.0% | 577 | **50.1%** |
| 26.0% | 1,941 | **50.5%** |
| 35.6% | 4,883 | **50.3%** |
| 45.2% | 7,632 | 49.0% |
| 54.9% | 8,289 | 49.0% |
| 64.5% | 5,754 | 47.8% |
| 73.9% | 2,230 | **51.7%** |
| 83.3% | 411 | **49.9%** |
| 91.7% | 33 | **45.5%** |

Read that column again. The realized rate is ~49% *everywhere*. The model's
output and the outcome are, to the resolution of 31,846 games, independent. Its
Brier score is 0.2714 — **worse than always predicting 50%** (0.2500) and worse
than predicting the base rate (0.2499).

You already partially know this: `total` is in `GOOD_BET_EXCLUDED_MARKETS`
(`lib/odds/goodBets.ts:196`) on the strength of that same Brier score. But the
number is still computed, still logged, still graded, and — critically — still
shown to the user as a percentage on Game Detail and Player Detail via
`computeTotalEdge` and `EdgeBadge`. Excluding a market from Good Bets does not
stop the app from displaying its probability.

**Why this matters / standard practice.** Overdispersed count data is a solved
problem. The standard replacements, in increasing order of effort:

1. **Empirical distribution.** You have 31,846 real games. For a given expected
   total λ, look up the realized distribution of games whose model-expected
   total was near λ and read `P(> line)` straight off it. No distributional
   assumption at all. This is the cheapest option and would probably beat the
   other two.
2. **Negative binomial.** The textbook fix for a Poisson whose variance exceeds
   its mean. One extra dispersion parameter, fit once on your history. Turns
   `poissonOverProbability` into `negBinomOverProbability` with the same
   signature.
3. **A run-scoring simulation** — you already have `sim_engine.py` / `sim_game.py`
   producing `simOverProb`. That's the right architecture; it just isn't what
   the logged model uses.

But the distributional fix alone will not save this model. A flat reliability
curve means the *inputs* carry no signal either — `homeExpectedRuns +
awayExpectedRuns`, built from season runs-per-game blended 50/50 with a
starter's ERA (M4), simply does not discriminate between high- and low-scoring
games well enough. For calibration, note that the market itself only achieves a
Brier of **0.2500** on MLB totals (measured below, H3) — totals are a genuinely
hard, near-efficient market, and "no edge" is a respectable answer. The bug is
claiming 92% confidence while delivering 45%.

**Fix.**

1. **Immediately:** stop surfacing the total model's probability and edge in the
   UI. Gate `computeTotalEdge`'s output behind the same
   `GOOD_BET_EXCLUDED_MARKETS` check the Good Bets tab already applies, or
   simply return `null` until a replacement is validated. This is a one-line
   change and it stops users acting on a number you have 31,846 rows of
   evidence against.
2. Replace `poissonOverProbability` with the empirical-distribution lookup (#1
   above). Keep the function signature so nothing else changes.
3. Re-measure the reliability curve before re-enabling. The bar to clear is not
   "better than Poisson" — it is "the realized rate in the top bucket is
   meaningfully above the realized rate in the bottom bucket." Nothing about the
   current model clears that bar.

**Effort.** Step 1: minutes. Step 2: 1–2 days including the backfill re-grade.
Step 3: an afternoon.

**Dependencies.** None for step 1. Step 3 depends on H5 (calibration currently
mixes two different models' rows).

---

### C3. Under-side candidates carry the *over's* probability — the displayed edge is exactly backwards

**What it is.** Every prop candidate carries a `modelProb`. For a candidate
whose proposition is the **under**, that number is the probability of the
**over**. The edge calculation then subtracts the market's over-probability from
it. The result is the edge on a bet the user is not being shown, and it is the
exact negation of the edge on the bet they *are* being shown.

**Where.**

- `lib/sports/mlb/adapter.ts:1700` — `modelProb: finalModelProb`, where
  `finalModelProb` derives from `overCount = full.filter(e => e.category === 'over').length`.
  It is attached unconditionally, regardless of which side the candidate ends up on.
- `lib/sports/mlb/adapter.ts:625` — `const category = consistent ? history[0].category : preferredCategory;`
  This is where a candidate becomes an `under`/`no-hit`/`no-run`, without
  `modelProb` ever being flipped.
- `lib/odds/props/liveEdge.ts:130` — `edge = rawModelProb - devigged.a`, where
  `.a` is always the over side (lines 123-126 order the pair over-first).
  `marketProb` is likewise always the over's.
- `lib/odds/props/grading.ts:82` — the same expression, in the grading path that
  writes `pick_history.edge`.

**The evidence — this is confirmed in the data, not just the code.** Your
`pick_history` contains 36 graded under-side rows that have a `market_prob`.
Scoring the stored `market_prob` against the stored `outcome`:

```
                                   Brier
market_prob as stored              0.3756      <- wildly anti-predictive
market_prob flipped (1 - p)        0.1957      <- strongly predictive
model_prob  as stored              0.3139
model_prob  flipped (1 - p)        0.2661
```

A stored probability that scores 0.376 as-is and 0.196 when you flip it is not
a miscalibrated probability. It is the probability of the *other outcome*.
That is independent empirical confirmation of the code read.

A concrete row (`pick_history.id = 1068613`): dimension `hit-in-game`, category
`no-hit`, `model_prob` 0.6167, `market_prob` 0.4878, `edge` **+0.1288**. The
proposition is "this batter records no hit." The correct edge is
`(1 − 0.6167) − (1 − 0.4878) = −0.1288`. The app displays +12.9% on a bet its
own model rates as 12.9% *bad*.

**Blast radius — I want to be accurate about this.** Under-side candidates are
rare in MLB, because `buildCandidate` only assigns the under category when a
player's *entire* game log is under the line. Across 362,616 `pick_history` rows,
roughly 500 are under-side (~0.14%). So this is not corrupting the bulk of your
numbers. It is, however, a genuine sign error that produces a confidently wrong
number on the specific picks it touches, and by your own stated rule
("any incorrect math is Critical") it belongs here. It also means the *displayed
model probability* on an under card is wrong — a card reading "Under 4.5 K —
model 58%" is really claiming the over is 58%, i.e. the under is 42%.

The five generic sports (NFL/CFB/NBA/NHL/Soccer) are unaffected because
`generic_prop_score.build_candidate` hard-codes `"over"` — which is its own
limitation (M12), not a fix.

**Fix.** Make the side explicit rather than implied. In `edgeModel.ts`, have
`computeModelProbability` return `overProb`, and at the point where
`buildCandidate` settles on a category, store
`modelProb = category is under ? 1 - overProb : overProb`. Then in
`liveEdge.ts:130` and `grading.ts:82`, select the matching market side:
`const marketSide = side === 'over' ? devigged.a : devigged.b;` and
`edge = modelProb - marketSide`. Add an assertion (or a unit test — see M8) that
`modelProb` and `marketProb` always describe the same proposition as `category`.

Backfilling the ~500 existing rows is a single `UPDATE ... WHERE category IN
('under','no-hit','no-run') AND model_prob IS NOT NULL` setting
`model_prob = 1 - model_prob, market_prob = 1 - market_prob, edge = -edge`.

**Effort.** 2–3 hours including the backfill.

**Dependencies.** None. Do this one first — it's cheap and unambiguous.

---

### C4. Stale odds are displayed as live, and the staleness check does not measure staleness

**What it is.** There are three independent mechanisms that are supposed to stop
the app showing an out-of-date price as current. All three are broken, in
different ways, at the same time. As I write this your prop odds are **17.5
hours old** and nothing on screen says so.

**Where and how each one fails.**

**(a) The "too stale" gate checks a constant, not an age.**
`lib/odds/props/liveEdge.ts:118`:

```ts
const tooStale = (r: PropOddsRow) => r.delaySeconds != null && r.delaySeconds > 600;
```

The comment above `resolveCandidateEdge` says a ">10-minute-old quote yields no
edge." It does not. `delay_seconds` is the **provider's advertised feed delay**,
written at fetch time from static config — `sharpApiConfig().delaySeconds`
(default 60), a hardcoded 300 for SportsGameOdds, and `null` for everyone else.
It has nothing to do with how long the row has been sitting in your database.
Measured distribution across all 290,663 `prop_odds` rows:

```
oddsapiio       delay_seconds = null    (29,888 rows)
parlayapi*      delay_seconds = null    (15,304 rows)
propline        delay_seconds = null   (141,854 rows)
propline_2      delay_seconds = null    (51,884 rows)
sharpapi        delay_seconds = 60      (32,159 rows)
sportsgameodds  delay_seconds = 51-~300 (19,574 rows)
```

**No row in the table has ever had `delay_seconds > 600`.** The gate has never
fired and cannot fire. `python-odds-service/src/predict/live_edge.py:141`
(`_too_stale`) is a faithful port of the same non-check.

The correct quantity — `fetched_at` — is on the row and is ignored.

**(b) The API stamps every response as fresh.**
`app/api/odds/lines/route.ts:155` and `:252`:

```ts
fetchedAt: new Date().toISOString(),
fromCache: false,
```

Both branches. Unconditionally. `readGameOddsBookLinesForSport` reads rows whose
real `fetched_at` may be days old, and `mergeGameOddsBookLineRows`
(`lib/db/client.ts:741`) drops `fetchedAt` entirely when building the
`UnifiedGameLine` — so there is no per-row timestamp for the frontend to use even
if it wanted to. The route then asserts the data was fetched right now.

**(c) The price chip hides the capture time in a tooltip, without a date.**
`components/OddsChip.tsx:121`:

```ts
capturedAt ? `captured ${new Date(capturedAt).toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'})}` : null
```

Time only, no date, inside the `title` attribute. A price captured at 02:49 this
morning and a price captured at 02:49 six days ago both render as
"captured 2:49 AM", and only on hover. The visible `⏱` warning marker fires on
`isDelayed`, which is driven by the same static provider constant as (a) — so
SharpAPI rows always show the marker and Propline rows (141,854 of them, your
largest feed) never do, regardless of actual age.

**Current live state, for context:**

```
propline        last fetched  2026-08-27 02:49   (17.5 h ago)
sharpapi        last fetched  2026-08-27 02:49   (17.5 h ago)
oddsapiio       last fetched  2026-08-27 02:49   (17.5 h ago)
sportsgameodds  last fetched  2026-08-21 04:28   (6.7 days ago)
propline_2      last fetched  2026-08-21 04:06   (6.7 days ago)
parlayapi_mlb   last fetched  2026-08-17 13:40   (10.3 days ago)
```

Meanwhile `pick_history` received new MLB rows at 19:31 today — the prop-scoring
pipeline is running normally against 17-hour-old prices and producing
confident-looking edges from them.

**Why this matters.** For a line-shopping product this is the single most
important correctness property after the arithmetic. A price that moved four
hours ago is not a price; sending a user to a book expecting +140 when the board
reads −105 is the failure mode that destroys trust in a betting tool. It is also
exactly the "fails partially while the app still looks healthy" class you asked
me to prioritise: nothing errors, nothing is empty, everything renders.

**Fix.**

1. Replace the `tooStale` predicate in both languages with a real age check:
   `Date.now() - Date.parse(r.fetchedAt) > MAX_PRICE_AGE_MS`. Keep the
   `delaySeconds` check *in addition* (it's a real, different signal — provider
   feed delay) but do not let it stand in for age. Suggested threshold: 15
   minutes pre-game, tighter in-play.
2. Carry `fetchedAt` through `mergeGameOddsBookLineRows` onto `BookmakerOdds` and
   onto the `UnifiedGameLine`'s `moneyline`/`spread`/`total` (per side, since
   sides can come from different books). Have `/api/odds/lines` report
   `fetchedAt: <oldest row's real timestamp>`, not `now()`.
3. In `OddsChip`, render age *visibly* once it exceeds a threshold — a small
   "17h" next to the price, amber past 15 min, red past an hour. Include the
   date in the tooltip. The component's own file comment says "a hand-entered
   price from an hour ago should not look identical to a fetched one"; extend
   that principle to a fetched price from 17 hours ago.
4. Separately: a health check that fires on `max(fetched_at)` age, not on 7-day
   row counts — see M9.

**Effort.** 1 day across all four.

**Dependencies.** None, and it is independent of the worker-hang root cause
(Phase 1 open question #2) — the display should be honest whether or not the
worker is healthy.

---

### C5. The model does not beat the market — measured, and statistically significant

**What it is.** You asked directly: is any model actually beating the
market-implied probability? Phase 2 said the comparison wasn't viable because
`market_prob` is only populated on 3,615 rows. It is a small sample, but 3,615
paired observations is enough to answer the question, and the answer is no.

**The measurement.** Across all `pick_history` rows with both `model_prob` and
`market_prob` and a graded `outcome` (n = 3,615, MLB player props, surfaced
2026-08-12 → 2026-08-27):

| predictor | Brier | log loss |
|---|---:|---:|
| **model_prob** | 0.23288 | 0.65775 |
| **market_prob** (vig-removed) | **0.22942** | **0.65102** |
| always 0.5 | 0.25000 | — |
| always the base rate (0.4113) | 0.24214 | — |

Paired per-row difference (model − market): mean **+0.003453**, sd 0.079003,
**t = 2.63** on 3,614 df (p ≈ 0.009). The market is better, and the gap is not
noise.

Broken out by market, every dimension with ≥50 rows:

| dimension | n | Brier model | Brier market | winner |
|---|---:|---:|---:|---|
| hits-runs-rbis | 880 | 0.2471 | 0.2425 | market |
| hit-in-game | 805 | 0.2502 | 0.2475 | market |
| rbis | 488 | 0.1972 | 0.1932 | market |
| runs | 280 | 0.2251 | 0.2236 | market |
| total-bases | 234 | 0.2185 | 0.2175 | market |
| walks | 216 | 0.2099 | 0.2100 | tie |
| pitcher-strikeouts | 203 | 0.2529 | 0.2433 | market |
| singles | 157 | 0.2533 | 0.2479 | market |
| doubles | 140 | 0.1817 | 0.1866 | **model** |
| batter-strikeouts | 55 | 0.2676 | 0.2500 | market |
| earned-runs | 54 | 0.2513 | 0.2430 | market |

Model wins 1 of 11. That is what losing to the market looks like.

**And the `edge` number itself has no realized value.** This is the more
important half of the finding. Grouping the same graded rows by the edge the app
computed at the time:

| bucket | n | realized win rate | market-implied rate | realized − market |
|---|---:|---:|---:|---:|
| edge ≥ 3% (the Good Bets bar) | 1,070 | 40.84% | 41.02% | **−0.18 pts** |
| edge 0–3% | 564 | 43.26% | 43.82% | −0.56 pts |
| edge < 0 | 1,981 | 40.69% | 45.21% | −4.52 pts |

`GOOD_BET_MIN_EDGE = 0.03` (`lib/odds/goodBets.ts:90`) is the threshold that
qualifies a pick for the Good Bets tab on the edge track. Picks clearing it
realize **exactly the market's own probability**. The claimed 3+ point edge
converts to zero measured excess.

(The negative-edge bucket underperforming the market by 4.5 points is
interesting — it suggests the model carries some genuine *negative* information,
i.e. it correctly identifies bets to avoid. That is worth investigating as a
fade signal, but with n=1,981 over two weeks I would not build on it yet.)

**Why this matters / standard practice.** In sports modelling the market line —
specifically the *closing* line, vig removed — is the benchmark. It is the
aggregate of every informed participant's opinion and it is very hard to beat;
a model that merely matches it has produced no value, and a model that loses to
it will lose money after vig by construction. The industry-standard health
metric is **closing line value (CLV)**: did you get a better price than the
market settled at? Consistent positive CLV is the only reliable predictor of
long-run profit, and it is measurable in weeks rather than the years a win-rate
significance test would need.

You do not currently measure CLV anywhere in the product (you have
`predict/clv_backtest.py`, but no surface reports it). I computed a first pass
in M1 below; it is also negative.

**Fix.** This is not a bug with a patch; it's a finding about where the project
actually stands. What I would do:

1. **Make the market baseline a permanent, visible metric.** Add
   `market_prob`-vs-`model_prob` Brier to `/diagnostics` alongside the existing
   calibration panel, and treat "model Brier < market Brier on live rows" as the
   activation gate for any model — replacing the current gate, which compares
   against your own unfitted formula (H3).
2. **Fix `market_prob` coverage first.** 1% populated is the reason this took
   until now to discover. The Python `resolve_candidate_edge` already computes a
   sharp reference for every candidate; it has just never run (H8). Getting that
   writing rows takes this sample from 3,615 to tens of thousands within weeks.
3. **Stop presenting `edge` as an actionable number until it has demonstrated
   value.** Not delete it — keep computing and logging it, that's how you'll
   learn. But the Good Bets `edge` track and the Edge % column currently assert a
   claim your own data contradicts. Demote it to a diagnostic, or label it
   honestly ("model disagreement with market — unvalidated") the way
   `EdgeBadge`'s tooltip already half does.
4. **Reconsider what the product is.** The line-shopping half of Linesmith
   (find the best available price across 22 books for a prop you already want)
   creates real, mechanical, no-model-required value. The "we found value the
   market missed" half does not, yet. The first is a defensible product on its
   own.

**Effort.** (1) and (2) are a few days. (3) is an afternoon. (4) is yours.

**Dependencies.** (2) depends on H8. (1) depends on H5.

---

## HIGH

### H1. Model probabilities are systematically over-confident, and the calibration layer that would fix it is empty

**What it is.** When the model says 73%, the thing happens 63% of the time. This
holds across the entire upper range and it is not sampling noise.

Live (non-backfill) MLB player-prop rows, n = 36,630:

| model says | n | realized |
|---|---:|---:|
| 8.0% | 74 | 21.6% |
| 16.5% | 2,462 | 20.7% |
| 25.5% | 6,333 | 23.5% |
| 35.0% | 10,083 | 30.7% |
| 44.8% | 8,145 | 40.1% |
| 54.6% | 5,285 | 48.6% |
| 64.5% | 3,320 | 58.3% |
| **73.4%** | 886 | **63.2%** |
| 81.8% | 42 | 78.6% |

Every bucket from 25% up over-predicts, by 3 to 10 points, monotonically
worsening with confidence. The bottom two buckets under-predict. This is the
classic signature of a probability that is too spread out — it needs shrinking
toward the base rate.

The backfilled trailing-rate model (316k rows) is far worse at the extremes:
predicted 92.9% → realized 68.8%; predicted 100% → realized 76.8%. That is what
you get from a raw 15-game hit rate with no shrinkage: a player who went 15-for-15
is not a 100% player.

**Why this matters.** Over-confidence directly inflates edge. If the model says
73% and the truth is 63%, and the market prices it at 65%, the app reports a
+8-point edge on a bet that is actually −2. The measured over-confidence is
roughly the same magnitude as the edges the app claims to find. **This alone is
sufficient to explain C5.**

**Standard practice.** Post-hoc probability calibration is routine and cheap.
The two standard methods:

- **Platt scaling** — fit a one-dimensional logistic regression mapping the
  model's raw output to the realized rate. Two parameters, needs a few hundred
  graded rows, handles exactly this "too spread out" pattern.
- **Isotonic regression** — non-parametric, more flexible, needs more data
  (~1000+), can't extrapolate past the observed range.

With 36,630 live graded rows you have plenty for either. Fit per market
(dimension), or pooled with a per-market offset if a market is thin.

**You have already built the infrastructure for this and never used it.** There
is a `model_calibration` table. There is `python-odds-service/src/predict/calibration.py`.
`odds_lines_cycle.py:554` calls `db.get_active_calibration("mlb", "moneyline")`.
The table has **zero rows**. So does `model_artifacts`. The plumbing is in place
and no calibrator has ever been fitted.

**Fix.** Fit Platt scaling per dimension over live (non-backfill) graded rows,
write to `model_calibration`, and apply it in `computeModelProbability`'s return
path (and the Python twin) before the probability reaches `edge`, `propScore`, or
the UI. Re-fit weekly on a rolling window. Re-measure the reliability table above
as the acceptance test — the target is realized ≈ predicted within ~2 points in
every bucket with n > 200.

**Effort.** 2–3 days. This is the highest value-per-hour item in this document.

**Dependencies.** H5 — fit on live rows only, not the backfill.

---

### H2. There are two different MLB game models in production, and the one being graded and displayed is not the one that was validated

**What it is.** `applyFittedMoneylineWeights` (the fitted, validated model) and
`computeMoneylineModel` (the hand-tuned formula) both exist and both run. Which
one you get depends on which code path you're in, and nothing surfaces the
difference.

**The split.**

| path | model used | writes to |
|---|---|---|
| `odds_lines_cycle.py:589` (Python worker, lock cycle) | **fitted v8** | `game_picks` |
| `pickHistoryLog.ts:158,172` (TS, snapshot) | **unfitted formula** | `pick_history` |
| `computeMoneylineEdge` → GameDetail / PlayerDetail / GameLinesView | **unfitted formula** | the screen |

I confirmed `applyFittedMoneylineWeights` in `lib/sports/mlb/gameModel.ts:284`
has **no callers anywhere in the TypeScript codebase** — the only live caller of
the fitted path is Python. Meanwhile `snapshot.context.other.games[].gameModel`,
which feeds both `pick_history` and every edge badge, comes from
`computeMoneylineModel` via `adapter.ts:2329` / the `mlb_game_model_cache` row.

**The consequence, measured.** Your `/diagnostics` calibration for
`dimension='moneyline'` is scoring the unfitted formula:

```
live moneyline rows   n =   418    Brier = 0.2619    win rate = 0.5000
backfill              n = 3,118    Brier = 0.2515    win rate = 0.5000
```

Because `logGameModelPredictions` logs *both* sides of every game, the win rate
is exactly 0.5 by construction, so the naive baseline is exactly 0.2500. **The
model that is graded and displayed scores worse than a coin flip**, on both live
and backfilled rows.

The fitted v8 model's recorded holdout Brier is 0.2398. Nobody is measuring it
live, because it writes to a different table.

**Why this matters.** You have no way to know whether your model is working,
because the number on `/diagnostics` describes a model that isn't the one your
fitting pipeline produces, and the model your fitting pipeline produces is
evaluated only against a frozen historical holdout. This is also why the
`mlbModelFreshness` health check can report "healthy — active model_weights
(version 8) fitted 13d ago" while the moneyline model users actually see is
performing worse than random.

**Fix.** Pick one. I would make the fitted model the only model:

1. Wire `applyFittedMoneylineWeights` / `applyFittedTotalWeights` into
   `adapter.ts`'s `gameModelFor`, using the same neutral-imputation convention
   the Python path uses (`elo=0.5`, `market=0.5`, `sim=0.5` when unavailable) —
   the functions already exist and are already ported correctly.
2. Delete the unfitted path, or demote `computeMoneylineModel` to what it
   already is internally: the producer of the `diagnostics` feature vector that
   the fitted model consumes.
3. Re-grade or discard the existing 418 live moneyline rows — they describe a
   model you no longer run.

**Effort.** 1 day. Low risk; the fitted path is already proven in Python.

**Dependencies.** H3 — do not do this without also fixing the serve-time market
feature, or you will ship a model whose dominant input is missing.

---

### H3. The fitted models are mostly a repackaged market price, and the activation gate never compares against the market

**What it is.** Both active MLB models take the vig-removed market probability as
an input feature, and it dominates every other feature by an order of magnitude.
Their own baseball features enter with *negative* coefficients. The gate that
decides whether a fitted model goes live compares it against your unfitted
formula, never against the market itself.

**The weights.** From `model_weights` where `active = true`:

**moneyline v8** (intercept −0.372):

```
rawLog5              -0.595   <- your Pythagorean/log5 estimate, NEGATIVE
venueDiff            -0.062
formDiff             +0.104
parkFactorCentered   -0.206
eloProb              -0.827   <- your Elo rating, NEGATIVE
marketProbCentered   +3.517   <- the market
simWinProb           +2.294   <- the simulation
```

**total v8** (intercept −0.497):

```
rawPoissonOverProb   -0.373   <- your own totals model, NEGATIVE
formDiff             +0.020
parkFactorCentered   +0.988
eloProb              +0.110
marketProbCentered   +3.737   <- the market
lineMovement         +0.004
bullpenEraCentered   +0.0004
simOverProb          +1.040
```

A negative coefficient on `rawLog5` and `eloProb` means the regression found
that, once it knows the market price, your own win-probability estimates are
worse than useless — it does better by subtracting them. That is a real,
interpretable result and it tells you plainly where the information is.

**What the gate actually checks.** `model_fit.py:521` / `modelFit.ts:438`:

```python
activated = holdout_brier < baseline_holdout_brier
```

where `baseline_holdout_brier` is the Brier of `r.baseline_prob` — the *unfitted
formula's* output. So a model activates for beating the hand-tuned formula. It
is never asked whether it beats the price it was fed.

**So I asked.** I computed the market-only baseline directly from your
`historical_odds` table (37,922 games, 2010–2026; `ml_home_consensus_prob` is
already normalised — raw and re-normalised Briers were identical to 5 decimals,
confirming home + away sum to 1):

| market | fitted holdout Brier | **market-only Brier, same seasons** | recorded "baseline" |
|---|---:|---:|---:|
| moneyline v8 (2024–25) | 0.23981 (n=4,407) | **0.24062** (n=4,826) | 0.25942 |
| total v8 (2024–25) | 0.24754 (n=3,758) | **0.25005** (n=4,801) | 0.26388 |

The fitted moneyline model beats the market by **0.0008** Brier. The totals model
by **0.0025**. Both margins are within noise on these sample sizes, and both are
achieved with the market as the model's dominant input. The recorded
`baseline_holdout_brier` of 0.259 / 0.264 makes it look like a 0.02 improvement.
It is not; it is 0.001.

For reference, the `walkforward_results` table's best final-test scores tell the
same story — `formula` 0.2409, `stacking` 0.2422, `catboost` 0.2412, all against
a market at 0.2406. Six model families, none of them separating from the price.

**Why this matters / standard practice.** Including the market line as a feature
is a legitimate and common technique — it's called *market-anchored* or
*market-blended* modelling and it produces well-calibrated probabilities. But it
changes what the model is for. Such a model cannot beat the closing line, by
construction: it is a shrunk version of it. If your goal is to find bets the
market has mispriced, the market line is the *thing you must beat*, not an input.

There is also a **train/serve skew** risk: at prediction time
`odds_lines_cycle.py:576` imputes `market_for_fit = 0.5` when no live line
exists, zeroing out the feature carrying 3.5 of the model's weight. The comment
says this matches training's imputation, and it does — but the *distribution* is
different. In training, missing-market rows were a minority of a 30k-row set; in
production, whenever the odds feed is stale (which is now, C4), it's every game.
`modelFit.ts:511` even filters holdout rows to `features[4] !== 0` for a
market-coverage diagnostic, so you already noticed the two populations differ.

**Fix.**

1. **Change the activation gate** to require beating the market on holdout, when
   a market probability exists. Store the market-only holdout Brier in
   `model_weights` next to `baseline_holdout_brier` so the comparison is visible
   and permanent. This is a ~20-line change in both `model_fit.py` and
   `modelFit.ts` and it is the single most important process fix in this
   document.
2. **Fit and report a market-excluded variant** alongside the market-anchored
   one. The market-anchored model is the right thing to *display* (it's better
   calibrated). The market-excluded model is the only one that can tell you
   whether you have independent signal. Right now you cannot answer that
   question at all.
3. **Handle the missing-market case explicitly** rather than imputing 0.5 — add
   a `market_available` indicator feature, or fit two models and select at serve
   time. Log which branch was taken so the two populations can be scored
   separately.

**Effort.** (1) half a day. (2) a day, mostly re-running the existing fit
harness. (3) a day.

**Dependencies.** H2 depends on this.

---

### H4. Data leakage: the generic-sports prop job can build a prediction from the game it is predicting

**What it is.** The per-sport prop production job runs hourly, over "today's
games." It pulls each player's season game log from ESPN and builds a
Beta-Binomial posterior from it. There is **no check that the game hasn't
started**. Once a game finishes, ESPN's gamelog includes it — so an hourly tick
that lands after the final whistle builds a "prediction" whose history contains
the outcome, and `log_surfaced` writes it as a fresh pick.

**Where.**

- `python-odds-service/src/predict/generic_pick_capture.py:51` —
  `fetch_scheduled_games`, whose own docstring says it *deliberately* keeps every
  game "regardless of status (scheduled, in-progress, final)."
- `python-odds-service/src/predict/generic_prop_production.py:364` — `run_sport`
  loops over exactly those games with no status filter anywhere.
- `jobs.py:963-968` — `genericPropProduction*Job` × 6 sports, interval 60 min.
- The insert (`db.log_surfaced`, `ON CONFLICT DO NOTHING`) means whichever tick
  lands *first* wins. If the first successful tick for a game is post-kickoff,
  the leaked probability is what gets stored permanently.

**Why this is not hypothetical.** A 60-minute cadence against games that run all
day means many games will have their first tick land after start. Any job
failure, restart, or the 17-hour worker outage currently in progress guarantees
it: when the worker comes back, its first tick will process every game from that
day, finished ones included.

**Why this matters.** Leaked rows are the most dangerous kind of bad data
because they make the model look *better*. A backtest or calibration curve
computed over a mix of honest and leaked predictions will show skill that
doesn't exist, and you will never know which rows are which — `pick_history` has
no column recording when the game actually started. This is exactly the
"plausible-but-wrong number" failure you asked me to hunt.

MLB is not affected the same way: `game_pick_lock.py` has real 6am-CT and
3-hours-before-first-pitch windows. The generic path's own docstring calls its
simplified window "a real, disclosed simplification" — but the simplification
removed the property that made the original safe.

**Fix.**

1. In `run_sport`, filter to games that have not started: skip any game where
   `commence_time <= now`. `_is_final_capture_due` already parses
   `commence_time` correctly — reuse it inverted.
2. Add a `predicted_before_start` boolean (or store `commence_time`) on
   `pick_history` so existing and future rows can be audited. Without this you
   cannot tell how much of your generic-sport history is contaminated.
3. Belt and braces: in `fetch_player_gamelog`, drop any gamelog entry whose event
   id equals the game being predicted. Cheap, and it makes the guarantee local
   rather than depending on a caller.
4. Audit the existing NFL rows (n=207, all surfaced 2026-08-27) against real
   kickoff times before using them for anything.

**Effort.** Half a day for (1) and (3); (2) is a migration plus a small write
change.

**Dependencies.** None. Do this before the worker is restarted, or it will
generate a fresh batch of leaked rows on its first tick.

---

### H5. The Good Bets trust gate is driven by a calibration that measures a different model

**What it is.** `calibrationByMarket` — the query whose output decides which
markets are allowed to power Good Bets, and which are excluded — reads
`pick_history` with **no `event_context` filter**. 87% of that table is the
historical backfill, and the backfill was produced by a deliberately simpler
model than the one running today.

**Where.** `lib/db/client.ts:1272-1284`. Compare with its neighbours
`liveMarketSkill` (:1322) and `scoreRecord` (:1352), which both correctly filter
`AND (event_context IS NULL OR event_context != 'backfill')`. `calibrationByMarket`
was missed.

**Why the two populations differ.** `modelBackfill.ts:75` computes
`modelProb = priorOvers / priorGames.length` — a raw 15-game trailing rate, no
Bayesian prior, no matchup shift, no recency weighting, no home-run model
override. The live model (`edgeModel.ts`) is a Beta-Binomial posterior with a
per-market prior strength, a matchup-shifted prior mean, and L10 up-weighting.
Different models, same column.

**The gap is material.** Measured per dimension:

| dimension | backfill n | backfill Brier | live n | live Brier |
|---|---:|---:|---:|---:|
| triples | 23,620 | 0.0157 | 10 | 0.2702 |
| stolen-bases | 23,590 | 0.0606 | 207 | 0.1608 |
| home-runs | 23,508 | 0.1077 | 538 | 0.1672 |
| doubles | 23,505 | 0.1369 | 807 | 0.1624 |
| total-bases | 23,084 | 0.2378 | 4,137 | 0.2066 |
| hits-runs-rbis | 23,083 | 0.2579 | 4,141 | 0.2357 |

`triples` reads 0.0157 on backfill and 0.2702 live. `isMarketTrusted` uses
`brierScore < 0.24` — so `triples` sails through the trust gate on a number that
has nothing to do with how the live model performs on it. Conversely, several
markets where the live model is meaningfully *better* than the backfill
(total-bases, hits-runs-rbis, runs, singles) are being judged on the worse number.

`GOOD_BET_EXCLUDED_MARKETS` (`goodBets.ts:196`) is hand-maintained from the same
contaminated snapshot — its comment cites "total (Brier 0.271, n=31,667)", which
is 99.4% backfill rows.

**Fix.** Add the `event_context` filter to `calibrationByMarket`, matching its
two neighbours. Then re-derive `GOOD_BET_EXCLUDED_MARKETS` from live rows — or
better, compute it at query time from `liveMarketSkill` so it can't go stale
again. Expect the trusted-market set to change materially; re-check the Good Bets
tab before and after.

While you're in there: the low-n live markets (`triples` n=10) will now correctly
fail `TRUST_MIN_GRADED_SAMPLE = 30`, which is the right outcome.

**Effort.** 1–2 hours for the filter, half a day to re-derive the exclusion list
and sanity-check the resulting Good Bets surface.

**Dependencies.** Blocks H1 (calibrate on live rows only) and C5's diagnostics.

---

### H6. The TypeScript `bestPrice` is missing the implausible-odds guard its Python twin has

**What it is.** You found and fixed a real bug three times in one session: a
garbage quote (Kalshi at +9900, ~1% implied) winning a "best price" comparison
purely because it's a bigger number. You fixed it in `display.ts`
(`bestMoneylineFromBooks`), in `mlb_game_lines.py`, and in Python's
`live_edge.best_price`. You did not fix it in the TypeScript `liveEdge.ts`.

**Where.** `lib/odds/props/liveEdge.ts:26-30`:

```ts
export function bestPrice(rows: PropOddsRow[], side: string): PropOddsRow | null {
  const sided = rows.filter((r) => r.side === side);
  if (sided.length === 0) return null;
  return sided.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best));
}
```

No plausibility filter. Compare `python-odds-service/src/predict/live_edge.py:119`:

```python
sided = [r for r in rows if r.side == side and is_plausible_decimal_odds(american_to_decimal(r.american_odds))]
```

whose comment explicitly says "now fixed a third time here... all three
languages/call sites now consistent." They are not — this fourth site was
missed. The same gap exists in `userBookPrice` (`liveEdge.ts:32`), whose Python
twin also has the guard.

**Why this matters.** `liveEdge.ts` is the *client-side* path — it's what
`usePropOdds`/`ScanTable` run in the browser to pick the price shown in the Odds
column and to compute the displayed edge. So the version users actually see on
Scan is the unguarded one. Your `prop_odds` table contains real Kalshi and
Polymarket rows at extreme prices (`game_odds_book_lines` has a Polymarket
moneyline at ±18082), so the input that triggers this is present.

**Fix.** Import `isPlausibleDecimalOdds` (currently module-private in
`display.ts` — export it, or move it next to `MAX_PLAUSIBLE_DECIMAL_ODDS` in a
shared module) and apply it in both `bestPrice` and `userBookPrice`, mirroring
the Python exactly.

Then, so this doesn't happen a fifth time: **make one of the two languages the
source of truth for this logic.** Four hand-maintained copies of the same
selection rule is the root cause, not the missed edit.

**Effort.** 1 hour for the fix. The de-duplication is a bigger conversation.

---

### H7. Propline consumes its entire daily budget to deliver one MLB market; propline_2 has no budget check at all and has been silently dead for six days

**What it is.** Two separate credit problems, both in your highest-volume
provider.

**(a) Propline is capped out delivering almost nothing usable for MLB.**

`provider_usage`, real daily request counts:

```
2026-08-27   897   (as of 02:49, when the worker died - cap is 1000)
2026-08-26   966
2026-08-25   158
2026-08-22  1007   <- over the 1000/day cap
2026-08-21   830
```

`fetch_propline` (`providers.py:790`) makes **1 + 2 requests per game** per
cycle — one events call, then a markets call and an odds call for each matched
game. At Tier 1's 2.5-minute cadence with a 15-game MLB slate that is
arithmetically far more than 1000/day; the observed numbers are what the cap
check clips it to.

And what does that buy you? Propline's 141,854 rows resolve to exactly **five**
market keys, of which **one** is MLB:

```
pitcher-strikeouts   45,043   <- the only MLB market
anytime-goalscorer   43,081   (soccer)
two-plus-goals       31,406   (soccer)
first-goalscorer     22,230   (soccer)
saves                    94   (soccer)
```

Its entire MLB batter-prop feed across ~13 books is dropped by the
`MARKET_KEY_ALIASES` gap Phase 2 identified as finding C1. So your largest,
most-expensive feed is spending a full daily budget to deliver one pitcher market.

**(b) `propline_2` has no cap check and stopped working six days ago.**

`jobs.py:269-272` and `:310-313`:

```python
ProviderSpec(
    provider_id="propline_2",
    enabled=config.PROPLINE_2_ENABLED,
    fetch=lambda client, games, yield_fn: fetch_propline(client, config.PROPLINE_2_KEY, games, "soccer_epl"),
    cap_kind="none",
)
```

`cap_kind="none"`. The comment above it is honest — it says the TS original had
no budget gate either and this is "flagging, not fixing." But `config.py:162`
defines `PROPLINE_2` with the same 1000/day vendor limit as `propline`, and
`provider_usage` shows `propline_2` at **4,098 requests recorded monthly** with
no daily tracking at all.

`propline_2`'s last successful write to `prop_odds` was **2026-08-21 04:06** —
six days ago. Nothing in the app reports this as a failure; the
`gameOddsBookLinesFreshness` health check reports `healthy`. The most likely
explanation is that the key is being rejected vendor-side for exceeding its real
daily limit, and because you have no cap check you have no visibility into it.

**Why this matters.** You asked about "credits spent on data never used." This is
the answer, quantified: ~1000 requests/day producing one usable MLB market, plus a
second key burning uncapped requests into a feed that has been dead for six days.

**Fix.**

1. **Close the `MARKET_KEY_ALIASES` gap for Propline's MLB batter markets.** This
   is the highest-leverage single change in the whole odds pipeline — it converts
   a budget you are already spending into the market coverage you thought you
   had. Query `odds_unresolved` (kind = 'market') for the exact raw strings being
   dropped; the writer is `registry.ts:140`. Note Phase 2's open question 6 —
   whether Propline's alt-line markets (`batter_2plus_hits` etc.) get their own
   keys or fold into the base market — still needs your decision.
2. **Give `propline_2` a `cap_kind="daily"` / `cap_limit=config.PROPLINE_2_DAILY_LIMIT`
   spec.** Per `CLAUDE.md`'s own job-runner convention this is a two-line change
   and the runner does the rest. The convention exists precisely so a provider
   can't be forgotten; this one was.
3. **Reduce Propline's per-cycle cost.** Three HTTP calls per game per 2.5
   minutes is not proportionate to the data returned. Cache the events and
   markets responses (they change far more slowly than prices) and only re-poll
   the odds endpoint.
4. Add the real vendor daily reset (`x-daily-reset` header, already documented in
   `budget.ts`'s header comment) as the authority rather than inferring it.

**Effort.** (2) is 30 minutes. (1) is a day including verification against a real
payload. (3) is a day.

---

### H8. Two incompatible definitions of `edge` share one column, one threshold, and one UI

**What it is.** `pick_history.edge` holds two different quantities depending on
which code wrote the row, and `GOOD_BET_MIN_EDGE = 0.03` is applied to whichever
one arrives.

| writer | formula | meaning |
|---|---|---|
| TS `grading.ts:82`, `liveEdge.ts:130` | `model_prob − devig(one book's two-sided price)` | our model vs one retail book |
| Python `live_edge.py:261` | `sharp_devigged(side) − raw_implied(bettable book)` | expected value, in probability units |

These are not comparable. The first is "how much our model disagrees with a
book"; the second is "how much better a sharp book's fair price is than what
you'd actually pay." A value of 0.03 means something quite different in each.

**And the Python one has never written a row.** Confirmed against the live DB:

```
pick_history:  362,616 rows
  edge_source populated:      0
  price populated:            0
```

`edge_source` and `price` are only ever set by `db.log_surfaced` from the Python
`CandidateEdgeInfo`. Zero rows means the 2026-08-27 edge redesign — the whole
sharp-vs-soft design, which is the mathematically better one (§2.6) — has never
produced a single persisted result. All 3,615 rows with an edge came from
`grading.ts`'s `joinMarketSide` (which sets `market_prob`/`edge`/`price_source`/
`bookmaker` but never `price` or `edge_source`, exactly matching the observed
null pattern).

**A second, subtler consequence:** `prop_score.py:41` still documents
`SCALE_E = 0.1` as normalising "model prob − devigged market prob" — the *old*
definition. Under the new definition, a perfectly fairly-priced bet at a soft
book has `edge ≈ −(half the vig) ≈ −0.02`, not 0. So the E component's neutral
point has moved but `SCALE_E` and the implicit zero-centring have not. If the
Python path ever does start writing, every prop score will be dragged down by
~3–5 points for a reason nobody will connect to this.

**Fix.**

1. Decide which definition wins. I would take the Python one — it is
   EV-equivalent and it doesn't depend on your model being right, which given C5
   is a considerable advantage.
2. Whichever you pick, **make the column self-describing**: `edge_source` is
   already there and already 100% null; require it to be non-null whenever `edge`
   is non-null, and add a CHECK constraint. Phase 2 noted you have no CHECK
   constraints on any status column; this is a good place to start.
3. Re-centre `SCALE_E` and the `GOOD_BET_MIN_EDGE` threshold for the chosen
   definition, and say in the code comment what zero means.
4. Find out why the Python path never writes. Most likely `edge` is always `None`
   because `_sharp_reference_prob` and `_consensus_reference_prob` both return
   nothing — the module docstring itself says only 3.3% of MLB candidates have a
   Tier-1 sharp price. Worth confirming with a one-off run rather than assuming.

**Effort.** (2) and (3) are half a day. (4) is an investigation, maybe an hour.

---

### H9. Bookmaker names are not normalised in `game_odds_book_lines`, so one book appears up to three times

**What it is.** `prop_odds` routes every bookmaker name through
`normalizeBookmaker` (`entityResolution.ts:319`). `game_odds_book_lines` does
not — `providers.py` writes `bookmaker=sportsbook` / `bookmaker=book_raw` /
`bookmaker=bookmaker_raw` straight from each vendor's own spelling.

Real distinct values in your table right now:

```
BetMGM (the-odds-api)  ·  betmgm (propline)  ·  BetMGM.us (oddsharvester)
DraftKings (espn, oddsharvester, the-odds-api)  ·  draftkings (propline, sharpapi)
FanDuel (the-odds-api)  ·  Fanduel (oddsharvester)  ·  fanduel (propline, sharpapi)
BetRivers / betrivers   ·   Bovada / bovada   ·   BetUS / betus
LowVig.ag / lowvig      ·   MyBookie.ag / mybookieag  ·  BetOnline.ag / betonlineag
```

**Three consequences.**

1. `mergeGameOddsBookLineRows` (`lib/db/client.ts:752`) keys its book map on the
   raw name, so the bookmaker comparison grid shows the same book two or three
   times with different prices, and `bookCount` — the "N books surveyed" number
   the UI displays — is inflated by roughly 40%.
2. The `best_price` comparison treats the duplicates as independent books, so the
   "best line" can be a stale copy of the same book from a different source.
3. `SHARP_REFERENCE_PRIORITY = ["pinnacle", "circa", "novig", "kalshi"]`
   (`live_edge.py:71`) matches on exact lowercase names. It will silently fail to
   find Pinnacle in any source that capitalises it. This is the lookup that
   decides your Tier-1 sharp reference — the foundation of the whole edge
   redesign — and it is one capital letter away from never matching.

**Fix.** Run every `GameOddsBookLineInput.bookmaker` through the same
`normalize_bookmaker` the prop path uses, in `providers.py` and
`odds_lines_cycle.py`. Add the missing aliases first (`bet365.us`, `smarkets`,
`rebet`, `onexbet`, `tab_au`, `matchbook`, `lowvig`, `mybookieag`, `betonlineag`,
`betus` — several are already in `BOOKMAKER_ALIASES`, several aren't). Backfill
the existing 3,289 rows with an `UPDATE`. Note `normalizeBookmaker` returns
`null` for unknown names — decide whether an unrecognised book is dropped or
kept raw, and log it to `odds_unresolved` either way.

**Effort.** Half a day plus the backfill.

**Dependencies.** C1's modal-point fix will pick better points once duplicates
are collapsed.

---

### H10. `game_odds_book_lines` contains "total" rows that cannot all be the same proposition

**What it is.** For a single MLB game, the `market='total'` rows disagree in a
way that no real market variation explains. Game 825039, Propline source, all
rows written in the same fetch:

```
betonlineag   over 8.5 @ -101   under 8.5 @ -119     <- plausible main line
betus         over 8.5 @ -105   under 8.5 @ -115     <- plausible
lowvig        over 8.5 @ +102   under 8.5 @ -117     <- plausible
pinnacle      over 9.5 @ +156   under 9.5 @ -198     <- plausible
bovada        over 9.5 @ +165   under 9.5 @ -220     <- plausible
betmgm        over 2.5 @ +1200  under 2.5 @ -5000    <- implies P(over 2.5) = 7.7%
draftkings    over 2.5 @ +1100  under 2.5 @ -5100    <- same
fanduel       over 2.5 @ +1400  under 2.5 @ -8000    <- same
betrivers     over 2.5 @ +280   under 2.5 @ -835     <- same point, wildly different price
mybookieag    over 1.5 @ +100   under 1.5 @ -143
kalshi        over 9.5 @ +9900  under 7.5 @ -2400
polymarket    over 9.5 @ +18082 under 9.5 @ -18082
```

An MLB game total of 2.5 with the over at +1200 is not a game total — over 2.5
runs happens in ~98% of MLB games. Something upstream is putting a
non-full-game market (a first-inning total, a period total, a team total, or
similar) into the `market='total'` slot, and `betrivers` at +280 for the same
nominal 2.5 shows the rows aren't even internally consistent with each other.

**I could not root-cause this in the time available, and I'm flagging that rather
than guessing.** What I ruled out: `_team_match` (`providers.py:116`) is exact
string equality on both team names, so a wrong-event match is very unlikely.
`_propline_game_line_rows` filters strictly to market keys
`{h2h, spreads, totals}`. So either Propline's `totals` key carries more than the
full-game total, or `markets_res` is returning keys whose outcomes get grouped
under a shared label. Reproducing one raw `/odds` response for a real event would
settle it in five minutes.

**Why this matters.** This is C1's fuel. Even after you fix the point-mismatch
selection logic, a modal-point calculation over a pool containing 2.5, 1.5, 7.5,
8.5 and 9.5 will still sometimes pick a nonsense number.

**Fix.**

1. **Defensively, now:** validate at the write boundary. A `market='total'` row
   for MLB whose `point` is outside a sane band (say 5.5–15.5) is a data error;
   reject it and log to `odds_unresolved`. Do the same per sport. Also reject a
   book whose two sides for the same market disagree on `point` — a real book
   never quotes that.
2. **Add a CHECK constraint** on `game_odds_book_lines` so a wildly out-of-range
   `point` can't be inserted at all. Phase 2 correctly noted that the absence of
   CHECK constraints is what makes this class of bug silent instead of loud.
3. **Root-cause it:** capture one raw Propline `/events/{id}/odds` response for a
   real MLB event and diff the `totals` market against what lands in the table.

**Effort.** (1) and (2): half a day. (3): an hour.

---

## MEDIUM

### M1. Closing line value is negative on the only sample that can measure it

You have `predict/clv_backtest.py` but nothing computes or reports CLV. I ran a
first pass over `game_picks` (MLB, rows with both an initial and a final price
and a graded outcome, n = 78):

```
initial price implied   59.25%
final price implied     56.08%     <- the market moved 3.2 points AGAINST the pick
picks that beat closing 21 / 78 = 27%
realized win rate       56.41%
ROI at the initial price  -4.6% per unit
```

A model with genuine edge beats the closing line more than half the time. 27% is
what you'd expect from a model whose picks the market disagrees with, moving away
from you. n=78 is small and `ml_final_price` is captured 3 hours before start
rather than at true close, so treat this as directional, not conclusive.

**Standard practice.** CLV is the industry's primary model-health metric because
it converges in weeks rather than the years a win-rate test needs. Every serious
betting operation tracks it per pick and per model version.

**Fix.** Capture a genuine closing price (a final tick as close to start as your
scheduler allows), then surface CLV on `/diagnostics` next to the Brier panel:
mean CLV in probability points, % of picks beating close, and the distribution.
Make it the headline model-health number. **Effort:** 1–2 days.

---

### M2. Prop Score ranks correctly but adds almost nothing beyond `model_prob`, and its scale is biased upward

The good news first — grade tiers do track realized outcomes, monotonically, over
29,631 live graded rows:

```
D   n=12,210  30.1%      B+  n=1,647  52.8%
C   n= 7,043  35.4%      A   n=  837  59.6%
C+  n= 4,792  38.8%      A+  n=  451  67.4%
B   n= 2,651  46.9%
```

That is a real, working ranking signal and it's worth keeping.

But it is essentially `model_prob` wearing a letter. Holding `model_prob` fixed in
the 0.40–0.60 band, the grades stop separating:

```
C  n=2,876  44.1%    B   n=1,432  45.3%    A   n=169  46.2%
C+ n=2,050  40.5%    B+  n=  910  47.5%    A+  n= 59  62.7%
```

Non-monotonic, and only A+ (n=59) stands out. The `P` (performance), `E` (edge)
and `X` (matchup) components are contributing little beyond what `M` already
carries.

Two structural issues in `propScore.ts` / `prop_score.py`:

- **The scale is asymmetric.** `M` and `E` range over [−1, 1], but `P` ∈ [0, 1]
  and `X` ∈ {0, 0.3} can never be negative. So `raw` has a positive floor
  contribution and `score = 50 + 50·raw` is biased upward. A candidate with a
  strongly negative model signal and one qualifying trailing window still scores
  above 50.
- **Weights are hand-set** (`WEIGHT_M=0.3, WEIGHT_E=0.35, WEIGHT_P=0.25,
  WEIGHT_X=0.1`) and `SCALE_M`/`SCALE_E` likewise. The file says so honestly. You
  now have 29,631 graded rows with stored components — enough to fit them.

**Fix.** Centre `P` and `X` (subtract their expected value so a typical candidate
contributes 0), then fit all four weights by logistic regression against the
graded outcome. Validate the result against `model_prob` alone as the baseline —
if the fitted score doesn't beat it out-of-sample, the honest move is to show
`model_prob` and drop the score. **Effort:** 1–2 days.

---

### M3. Multiplicative de-vig is the least accurate of the standard methods

Your `devigTwoWay` is correctly implemented (§2.3), but proportional de-vig
assumes the bookmaker's margin is spread evenly in *proportion* to each side's
probability. Empirically it isn't: books load more margin onto longshots (the
favourite-longshot bias). Proportional de-vig therefore systematically
**overstates** the true probability of longshots and understates favourites.

This matters most for exactly the props you care about — home runs, stolen bases,
first-goalscorer — where one side is priced at +400 or worse.

**Standard alternatives**, in order of sophistication:

- **Additive** — subtract `overround/2` from each side. Better for longshots,
  worse for extreme favourites.
- **Power / logarithmic** — solve for `k` such that `Σ pᵢ^k = 1`. One parameter,
  no extra data, and generally the best simple method.
- **Shin's method** — models the margin as protection against insider trading.
  The standard in the academic literature; one parameter, closed-form for
  two-way markets.

**Fix.** Implement power de-vig alongside the current one and compare on your
graded history: which method's `market_prob` gets the lower Brier against
`outcome`? You have the data to answer this empirically rather than by argument —
that's the right way to pick. Keep the two-sided-same-book rule regardless.
**Effort:** 1 day including the comparison.

---

### M4. `blendWithStarterEra` mixes two different quantities at a hand-set 50/50

`lib/sports/mlb/gameModel.ts:112`:

```ts
return teamRatePerGame * 0.5 + starter.era * 0.5;
```

`teamRatePerGame` is runs per *game* (all pitchers, earned and unearned).
`starter.era` is earned runs per *nine innings* for one pitcher who typically
throws five or six of them. These are different quantities on different
denominators; the code adds them as if they were the same unit. The file comment
discloses it as an approximation, which is honest, but the two numbers happen to
sit near 4.3 so the error is invisible rather than absent.

There is a second issue: for a team's runs-*scored* estimate the function blends
toward the *opposing starter's ERA* — substituting a runs-allowed quantity into a
runs-scored slot. Directionally sensible, dimensionally not.

The 0.5 weight is hand-set and reflects roughly "the starter throws about half
the game," which is defensible, but it doesn't vary with how deep that specific
starter actually goes.

**Fix.** Convert both to a common basis: estimate the starter's expected innings
(from their season IP/GS), compute expected runs allowed over those innings from
ERA (scaled by ~1.08 for unearned runs), and add the bullpen's expected runs over
the remainder — you already fetch bullpen ERA for the totals model
(`get_team_bullpen_era`). Weight by real innings rather than a flat 0.5.
**Effort:** 1 day. **Note:** given C2, the totals model needs replacing anyway;
do this as part of that work, not separately.

---

### M5. Home-field and form adjustments are added to a probability rather than to log-odds

`lib/sports/mlb/gameModel.ts:213`:

```ts
const adjustment = HOME_FIELD_EDGE + (homeVenueEdge - awayVenueEdge) + (homeRecentEdge - awayRecentEdge);
const homeWinProb = Math.min(0.97, Math.max(0.03, rawHomeWinProb + adjustment));
```

Adding a constant to a probability is not scale-invariant. Adding +0.04 to a 0.50
favourite is a 4-point move; adding it to a 0.92 favourite is also 4 points
nominally, but in odds terms it is an enormous shift, and near the boundary it
just hits the clamp. The correct operation is additive in **log-odds**:
`logit(p) + β`, then `sigmoid`. That is what the fitted models do (they're
logistic regressions) and it's why they're better behaved at the extremes.

The clamps at 0.03/0.97 are papering over this — they exist because the additive
form can produce probabilities outside [0,1].

**Fix.** `homeWinProb = sigmoid(logit(rawHomeWinProb) + adjustment)`, with
`adjustment` re-scaled (a 0.04 probability edge at p=0.5 is ~0.16 in log-odds).
Note the constants would need re-tuning, so this is only worth doing if you keep
the unfitted model — see H2, where I recommend deleting it. **Effort:** 2 hours
if you keep it; zero if you don't.

---

### M6. `compute_league_rate` silently returns 0.5 when it matches nothing

`python-odds-service/src/predict/generic_prop_score.py:115`:

```python
return hits / total if total else 0.5
```

If `stat_name` doesn't match any key in the fetched gamelogs — a wrong ESPN field
name, a sport whose boxscore uses a different label, a roster with no qualifying
minutes — the function returns a fabricated 50% base rate. That becomes the Beta
prior's centre for every player in that dimension, with `n0 = 15`
pseudo-observations of weight behind it. The model then produces
confident-looking probabilities anchored on a number that means "we found
nothing."

The docstring itself records this happening twice already: NHL's real minutes key
is `toiMinutes`, not `minutes`, and the wrong default "would have silently zeroed
out every NHL game's eligibility." The bug was found; the failure mode that hid
it wasn't.

**Fix.** Return `None` and have `build_candidate` skip the dimension entirely,
matching the "absent, not fabricated" rule the rest of the codebase follows
(`edgeModel.ts`'s own header states it explicitly). Log a warning with the
`(sport, dimension, stat_name)` so a mismatched key is loud. **Effort:** 2 hours.

---

### M7. The golf model is calibrated but adds nothing over its own prior

`golf_model_predictions`, graded rows (n ≈ 150 per hole, 2,847 total):

Reliability is reasonable — 0.154→0.159, 0.445→0.478, 0.658→0.628, 0.741→0.691,
0.815→0.746. Mild overconfidence at the top, same direction as H1, much milder.

But comparing the model's Brier against simply predicting the par-based league
rate for every golfer:

```
model beats league-rate baseline on   9 / 19 dimensions
league rate beats the model on       10 / 19
```

A coin flip. The model is not adding information over "par 4s produce a birdie
13% of the time."

There is also a small methodological issue: `HoleModelInput.field_observations`
is documented as including the subject golfer's own scores, and
`golfer_own_observations` then weights those same scores again on top. The
golfer's own data is double-counted.

Both files disclose the hand-set-prior status honestly. This is a "not yet
validated" finding, not a "wrong" one.

**Fix.** Deduplicate the subject from `field_observations`. Then either fit the
model against the ~2,800 graded rows you now have, or present the par prior
directly and stop implying a per-golfer edge that isn't measurable. **Effort:**
half a day for the dedup; the fit is a separate project.

---

### M8. The TypeScript half of the codebase has no automated tests at all

`python-odds-service/` has 19 `test_*.py` files, including
`test_odds_lines_cycle.py`, `test_providers.py`, `test_staking.py` — real tests of
real logic. The TypeScript side has **zero**: no test framework in
`package.json`, no `*.test.ts` anywhere in the repo. The only check is
`tsc --noEmit`.

Every Critical in this document is in TypeScript. C1 (mismatched points), C3
(inverted side) and H6 (missing guard) are all things a ten-line unit test would
have caught permanently, and C1's failure mode — a de-vig on a pair whose raw
probabilities sum to 0.90 — is a one-line assertion.

**Fix.** Add Vitest (works with your Next 15 setup, near-zero config) and write
tests for exactly the pure functions this audit exercised: `americanToDecimal`,
`decimalToAmerican`, `devigTwoWay`, `bestTotalFromBooks`, `bestSpreadFromBooks`,
`resolveCandidateEdge`, `computeModelProbability`, `computePropScore`,
`windowSet`. The reference values are in §2 of this document — you can lift them
directly. Then add the regression tests for C1/C3 as part of fixing them.
**Effort:** 1 day for the setup and the first dozen tests. Highest
defect-prevention value per hour in the document.

---

### M9. Health checks report "healthy" through a 17-hour outage

Right now, with every provider job 986–1052 minutes stale:

```
gameOddsBookLinesFreshness    healthy   "mlb (last 7d by source: ... propline=1611 ...)"
oddsHistoryAndPricesFreshness healthy   "6013 game_odds_history rows in the last 24h"
propPredictionsFreshness      healthy   "1248 pick_history rows for today's real games"
```

All three are true statements and all three are misleading. The first counts rows
over a **7-day** window, so it cannot detect a 17-hour outage. The second is
satisfied by OddsHarvester, which is running fine, while every API provider is
dead. The third confirms prop predictions are being *generated* — from
17-hour-old prices.

The job-level checks *do* catch it correctly ("stale — last run 986min ago"), so
the failure is visible if you look at the right panel. But a dashboard where
three data-freshness checks say healthy during a total feed outage will train you
to trust the wrong panel.

Also worth fixing while you're there: `refreshTennisAtpJob` and
`refreshTennisWtaJob` have been failing for 16 hours with
`TypeError: normalize() argument 2 must be str, not None` — a real crash, not a
staleness artefact.

**Fix.** Change the data-freshness checks from "rows in the last N days" to
"`max(fetched_at)` is within this feed's own expected interval," per provider. A
provider that hasn't written within 3× its job interval is unhealthy regardless
of how many rows it wrote last week. **Effort:** half a day.

---

### M10. `prop_odds` rows never expire

`write_prop_odds` is upsert-only and nothing ever deletes. That is the right
choice for partial-failure safety — a truncated provider response can't wipe good
data — but it means a price for a market a book stopped offering, or a line a book
moved off, stays in the current-state table indefinitely with its original
`fetched_at`.

`rows_for` / `bestPrice` filter on `(subject, market, line)` only. There is no age
filter anywhere in the read path (see C4a). In practice the exposure is bounded
because reads are scoped by `game_id` and old games' rows don't match today's
games — but for a game whose feed goes quiet mid-day, the stale rows keep
competing to be "best price" for the rest of the day.

**Fix.** Once C4's real age check is in place this becomes mostly cosmetic, but
add a retention job anyway: delete `prop_odds` rows for games whose start time is
more than 24 hours past. Phase 2 noted there is no retention policy on any table;
this and `snapshot_cache` (already 1,340 MB against an 800 MB check threshold)
are the two that matter. **Effort:** 2 hours.

---

### M11. Most prices render as "Source not recorded"

`components/OddsChip.tsx:33` — `PROVENANCE_LABEL` has entries for `sharpapi`,
`oddsapiio`, `sportsgameodds`, `oddspapi`, `theoddsapi`. It has **no entry for
`propline`** (141,854 rows, your largest feed), `propline_2` (51,884),
`parlayapi`, `parlayapi_mlb`, `parlayapi_nfl`, or `parlayapi_cfb`.

`normalise()` falls through to `'unknown'`, so those prices render with a `?`
marker and the tooltip "Source not recorded." Roughly two-thirds of your prop
prices display as provenance-unknown when the provenance is recorded perfectly
well in `prop_odds.provider_id`.

**Fix.** Add the six missing entries. Better: derive `OddsProvenance` from the
`ProviderId` union in `lib/odds/props/types.ts` so a new provider can't be added
without the UI knowing about it. **Effort:** 30 minutes.

---

### M12. The five generic sports can only ever surface "over" picks

`generic_prop_score.build_candidate` hard-codes `category = "over"` throughout —
`history_entries` buckets against the line, `resolve_candidate_edge` is called
with `"over"`, and `_candidate_to_entry` writes `category='over'`. NFL, CFB, NBA,
NHL and Soccer therefore have no under-side coverage at all.

This is why C3's sign bug doesn't affect them, but it's a real product gap:
roughly half of all prop value is on the under, and for a player whose model
probability is 0.25 the interesting bet is the under at 0.75, which the app never
offers.

**Fix.** Emit both sides as separate candidates with correctly-sided
probabilities (which requires C3's fix first, so the sided-probability plumbing
exists). Let the score decide which one surfaces. **Effort:** 1 day, after C3.

---

### M13. `_team_match` is exact string equality, so a name-format change silently returns zero rows

`python-odds-service/src/providers.py:116`:

```python
return (row_home == game.home_team_name and row_away == game.away_team_name) or (...)
```

No normalisation, no fallback. If a vendor renders "St. Louis Cardinals" where
ESPN says "St Louis Cardinals", every row for that game is silently dropped —
`fetch_propline` just `continue`s, no warning is appended to
`FetchOutcome.warnings`, and the job reports success with fewer rows.

You already have `teamKey` (`lib/odds/matching.ts:73`,
`name.toLowerCase().replace(/[^a-z]/g, '')`) doing exactly the right thing on the
TS side, and `_team_key` in `odds_lines_cycle.py`. This one function didn't get it.

**Fix.** Normalise both sides through the same key function, and append a warning
when an event in the provider's response matches no game in the slate — a
provider returning events you can't match is a real signal, not a no-op.
**Effort:** 2 hours.

---

### M14. Tier-2 consensus includes the book you're comparing against

`live_edge._consensus_reference_prob` takes the median de-vigged probability
across every book with a two-sided price — including the book whose raw price is
the other half of the comparison. When few books have two-sided coverage, the
"independent" reference is substantially the bettable book itself, and `edge`
collapses toward `−(that book's own vig share)`.

This biases *conservative* (edge reads more negative than it should), so it won't
create false positives. But it will mask real edges at thin-coverage candidates,
which is most of them — the module's own docstring says only 3.3% of MLB
candidates have Tier-1 coverage.

**Fix.** Exclude the chosen book from the consensus median. Require a minimum of
3 independent books before Tier 2 returns anything, and return `None` below that
rather than a two-book median. **Effort:** 1 hour. Do it as part of H8.

---

## LOW

### L1. `poissonOverProbability` treats an integer line as a loss

`gameModel.ts:326` — `k = Math.floor(threshold)`, so for a line of exactly 9 it
returns `P(X ≥ 10)`, scoring a push as a loss. Correct for .5 lines (nearly all
MLB totals), wrong for integer lines, which do occur. Fix by returning
`P(X > k)` and a separate push probability, or by refusing integer lines
explicitly. **Effort:** 1 hour.

### L2. `deltaFromLine`'s doc and code disagree

`windowedStat.ts:275` documents `percent` as `(average − line) / line`; the code
divides by `Math.abs(line)`. The code is more defensible (a negative line
shouldn't flip the sign of a percentage). Fix the comment. **Effort:** 2 minutes.

### L3. The player backfill has survivorship bias

`modelBackfill.ts:107` seeds from `listKnownSubjects('mlb')` — players who have
already appeared in `pick_history`, i.e. currently active players. Backfilling
2010–2026 for only players still active in 2026 systematically excludes everyone
whose career ended. The calibration curve is therefore fitted on survivors. Given
H5 (backfill shouldn't drive the live gate anyway) this is low priority, but note
it before using the backfill for anything else. **Effort:** N/A — document it.

### L4. Tennis provider jobs have been crash-looping for 16 hours

`refreshTennisAtpJob` / `refreshTennisWtaJob`:
`TypeError: normalize() argument 2 must be str, not None`. A real, unhandled
exception, distinct from the general worker staleness. Almost certainly a `None`
reaching a name-normalisation call. **Effort:** an hour once you can see a stack
trace.

### L5. `finals.sort()` uses an inconsistent comparator

`gameModelBackfill.ts:44` — `(a, b) => (a.gameDate < b.gameDate ? -1 : 1)` never
returns 0, so equal timestamps (doubleheaders) get an arbitrary order. Harmless
in practice; use `a.gameDate.localeCompare(b.gameDate)`. **Effort:** 1 minute.

---

## 6. What standard practice you're missing

You asked specifically what the field considers table stakes. Ranked by how much
it would change your situation:

1. **Closing line value tracking.** The single most important metric in sports
   modelling, and you have none. It answers "is this model any good?" in weeks
   instead of years. You have the data (`game_picks` initial/final prices,
   `prop_odds_history`) and even a `clv_backtest.py`. See M1.

2. **The market as your baseline, not your feature.** Every model comparison in
   `model_weights` uses your own unfitted formula as the bar. The bar is the
   closing line. See H3.

3. **Probability calibration as a mandatory post-processing step.** No serious
   model ships raw classifier output. Platt or isotonic, refit on a rolling
   window, is standard — and you have the table for it sitting empty. See H1.

4. **A proper-scoring-rule dashboard split by live vs backfill vs model version.**
   Right now one Brier number mixes three different models across two data
   regimes. See H2, H5.

5. **Stake sizing.** You have `staking.py` and `test_staking.py`, but nothing
   surfaces a recommended stake. Edge without stake sizing isn't actionable
   advice; and fractional Kelly on an over-confident model (H1) is how bankrolls
   die. Worth wiring only *after* calibration.

6. **Correlated-outcome awareness.** Your prop candidates for one game are highly
   correlated (a batter's hits, total bases, runs and RBIs are the same event
   viewed four ways). Nothing in the app tells a user that stacking three of them
   is one bet, not three. This is the most common way retail bettors ruin an
   otherwise-fine edge.

7. **Feature engineering that isn't available to the market.** Your features
   (Pythagorean, Elo, form splits, park factor) are all things the market priced
   in before it opened. The negative coefficients in H3 are the regression
   telling you this directly. Signal that beats a closing line generally comes
   from being faster (line-shopping, steam detection — you have 425,307
   `prop_odds_history` movement points and read them for almost nothing) or from
   data the market underweights (specific matchup micro-data, weather at first
   pitch, late lineup news).

---

## 7. Suggested order of work

Purely my ranking of value per hour. Items 1–4 are all under a day each.

| # | Item | Why first |
|---|---|---|
| 1 | **C4 step 1** — stop claiming `fetchedAt: now()` | One line; stops the app lying about a 17-hour-old price |
| 2 | **C2 step 1** — suppress the totals model's probability/edge in the UI | One line; stops a number with 31,846 rows of evidence against it |
| 3 | **C3** — fix the under-side sign | Cheap, unambiguous, empirically confirmed |
| 4 | **H5** — add the `event_context` filter to `calibrationByMarket` | Unblocks every measurement below it |
| 5 | **M8** — add Vitest + the §2 reference values as tests | Prevents recurrence of 1–3 |
| 6 | **C1** — modal-point selection for totals/spreads | The largest wrong number in the product |
| 7 | **H1** — fit Platt calibration | Highest single improvement to model quality |
| 8 | **H4** — game-start guard in the generic prop job | Do before restarting the worker |
| 9 | **H3** — market baseline in the activation gate | Changes how every future model is judged |
| 10 | **H7** — Propline market aliases + `propline_2` cap | Converts spend you're already making into coverage |
| 11 | **H2** — one game model, not two | |
| 12 | **M1** — CLV on `/diagnostics` | The metric that tells you if any of this worked |

**Running alongside all of the above:** the §4 ownership-boundary decision. It is
not a numbered fix because it is a decision, not a patch — but items 6, 9 and 11
each get harder the longer two languages own the same tables, and H6 is a
guarantee that the drift continues. Decide the boundary before doing 9 and 11,
or you will do them twice.

---

## 8. Questions only you can answer

Holding these for the combined Phase 1–5 answer session, as you asked.

1. **Propline alt-line markets** (`batter_2plus_hits`, `batter_3plus_rbis`, …):
   own market keys, or fold into the base market? Blocks the H7 fix. (Carried
   forward from Phase 2 open question 6.)
2. **Given C5 and M1 — do you want to keep pursuing an independent predictive
   model, or pivot the product toward line-shopping and price transparency,
   which works mechanically without one?** This changes what half of the fixes
   above are for.
3. **What is `betrivers over 2.5 @ +280` for MLB game 825039?** If you know what
   market Propline is putting in the `totals` slot, H10 takes an hour instead of
   a day.
4. **Is there any appetite for a paid sharp-book feed (Pinnacle proper, or a
   Pinnacle-carrying aggregator)?** The Tier-1 sharp reference — the foundation of
   the edge redesign — currently has 3.3% coverage. Without it the redesign can't
   do what it was designed to do.
5. **Do you want `total` and `moneyline` predictions to keep being written to
   `pick_history` while their models are suspended?** Keeping them costs nothing
   and preserves the calibration series; removing them cleans the table.
6. **§4's boundary: which language owns the odds math and the models?** Today
   both do, across 22 shared tables. Your recorded position is "delete the TS
   outright once Python is proven," but Python has been dead 17 hours and TS is
   the only reason there is data today. This is the largest single decision in
   the audit and several fixes are cheaper once it is made.

---

## 9. Reproducing the measurements

Every number above came from the live database via the transaction-mode pooler
(`:6543`), one `pg.Client`, `statement_timeout: 60000`, using the script pattern
in `docs/audit-handoff-phase-2.md` §2. The odds-math verification compiled
`lib/odds/{devig,display,types}.ts` with the repo's own `tsc` and executed the
resulting JavaScript directly — the functions tested are the shipped ones, not
transcriptions.

Load-bearing queries are quoted inline in C1, C2, C5, H1, H3, H5 and M1. The
system is actively changing (a hung worker, 200+ uncommitted files); re-verify
anything you intend to act on.

---

*End of Phase 3. Phases 4 and 5 remain independent and can run in any order.*
