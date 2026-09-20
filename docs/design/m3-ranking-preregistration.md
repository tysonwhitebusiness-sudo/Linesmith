# M3 — pre-registration: the Specials rankings

**Committed with the job that produces the rankings, before any weight is
tuned.** Written 2026-09-20. Nothing here may be edited after a backtest has
run; a changed criterion gets a new section with its own date and reason.

## What the rankings are

`slate_rankings` holds, per sport and slate date, an ordered list of players for
the promos books run — HR of the day, most strikeouts, pick-3 anytime TD,
anytime goalscorer. **No odds enter the ranking.** Each row carries its factor
values and each factor's percentile over that day's pool.

**The score is the mean of those percentiles, equal weights.** That is a
deliberate placeholder, stated on the page, and it stays until this backtest
says otherwise.

## What is frozen, and why it has to be

Rows refresh until the sport's first game starts, then `frozen_at` is stamped
and the write path refuses to touch them. A ranking that kept updating through
the evening would be graded against games it had already seen, and its receipts
would be worthless. `test_slate_rankings.py` holds the freeze against the real
table.

## The backtest, when there is enough graded history

**Not yet runnable.** The first frozen rankings are from 2026-09-20; a receipt
exists only the morning after each slate.

**Minimum:** 30 graded slates per ranking, or 300 graded rows, whichever comes
first. Below that, weights fitted on this data are noise.

**Question 1 — does the ranking rank?** For each ranking, compare the hit rate
of the frozen top 5 against two benchmarks:
  - **Random:** the same day's candidate pool, sampled.
  - **The single best factor:** the pool ranked by whichever one factor performs
    best, chosen out of sample.

**PASS** = the composite beats random by a margin whose 95% Wilson interval
excludes zero, **and** is not worse than the best single factor. A composite
that cannot beat its own best ingredient is a worse ranking dressed up.

**Question 2 — should the weights move?** Only if Question 1 passes. Fit weights
by walk-forward over slates (fit on every earlier slate, score the next), and
compare against equal weights.

**PASS** = fitted weights beat equal weights on out-of-sample hit rate by at
least 3 percentage points over at least 30 slates.
**On FAIL:** equal weights stay, and the attempt is recorded. Not every ranking
has to pass; each is judged on its own.

## Stated in advance

- A ranking that fails Question 1 is **removed from the page**, not quietly
  reweighted. The honest outcome of "this ordering carries no information" is to
  stop showing it.
- Hit rate here is **not** profit. These rankings carry no prices, and nothing in
  them claims a bet is good. A ranking can be informative and still unprofitable
  at the odds a book offers, which is the ordinary case.
- The expected result for the thinner rankings (CFB, MLS) is "not enough graded
  slates for a long time". That is a finding, not a delay to work around.
