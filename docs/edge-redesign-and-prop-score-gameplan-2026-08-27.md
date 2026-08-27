# Edge % redesign + player prop score for all sports — gameplan (2026-08-27)

## What this replaces and why

Audited `predict/live_edge.py` (the E component of Prop Score v1, weight 0.35 — the single highest-weighted piece of the whole 0-100 score) by reading it line by line, not inferring. Current formula, exact:

```
edge = our_own_model_probability − that_one_book's_own_devigged_price
```

It picks either the user's preferred sportsbook's price or whichever book pays the most, finds that *same* book's opposite-side price, devigs *that one book's own* two-sided quote, and subtracts it from our internal Beta-Binomial model's estimate. This is "does our model disagree with one retail book," not "does a sharp book disagree with a soft book" — and it predates the rich multi-book coverage this app now has (its own docstring is a straight port of an earlier version). The user's own research is right that the standard, more defensible approach is comparing a genuinely sharp reference against the book you'd actually bet at, to find real market inefficiency — not leaning on an internal model's own (disclosed-guess-calibrated) belief.

Because `live_edge.py` is already the one shared file MLB's `prop_candidates.py` calls today — not MLB-specific code duplicated elsewhere — **redesigning it here is what "migrate MLB to the market-centric edge score" actually means.** One file changes; MLB's live production system inherits it automatically, and every other sport's build (below) starts from the corrected design instead of copying the old one six times and having to redo it later.

## Real coverage, checked live for MLB specifically — the number that shapes the design

22 distinct bookmakers exist across `prop_odds` today. For MLB specifically (134 real games with any prop data):

| Book | Games covered | Rows |
|---|---|---|
| Pinnacle | 50 / 134 (37%) | 326 |
| Novig | 56 / 134 (42%) | 2,066 |
| Kalshi | 56 / 134 (42%) | 2,312 |
| **Any of the three** | **56 / 134 (42%)** | — |

Novig (a peer-to-peer no-vig exchange) and Kalshi (a CFTC-regulated prediction market) both cover more games than Pinnacle, and both are structurally low/no-vig *by design*, not just by reputation — arguably as legitimate a sharp reference as Pinnacle, sometimes more directly so since there's less residual vig to devig away in the first place.

**The number that actually matters, and the honest tradeoff it creates:** at the *game* level, 42% coverage looks workable. At the real candidate level — the exact (game, player, market, line) combination a prop score is computed for — only **1,221 of 36,955 real combos (3.3%)** have a genuine sharp-tier price. A named-sharp-book-only design would mean E returns "no edge" (and redistributes its weight to M/P/X, same as today's "no live price" behavior) for **96.7% of real MLB props.** That's not a flaw to hide — it's the real state of sharp-book prop coverage, and the design needs to account for it honestly rather than pretend broader coverage exists.

## Proposed design: three tiers, not one

**Tier 1 — named sharp book**, priority order Pinnacle → Novig → Kalshi (first one with a genuine two-sided price for this exact candidate wins). Pinnacle first because it's the most established, most-cited-in-research sharp book; Novig/Kalshi as strong, real fallbacks with denser coverage. This priority order is a reasoned starting default, not fit against real outcomes yet — flagged honestly, same as every other hand-set constant in this codebase.

**Tier 2 — computed consensus**, when no Tier-1 book has a price for this candidate: the median (not mean, to resist one outlier book skewing it — the same class of problem `is_plausible_decimal_odds` was built to guard against elsewhere tonight) devigged probability across every book that *does* have a genuine two-sided price for this candidate. Real, still meaningfully better than "one arbitrary retail book," and covers a much larger share of the 36,955 real combos than Tier 1 alone — real number to be measured once built, not promised in advance.

**Tier 3 — no reference available at all**: `edge = None`, E's weight redistributes over M/P/X exactly like the current "no genuine live price" behavior already does. Honest absence, not a fabricated number — same discipline `prop_score.py` already uses everywhere else.

**The actual formula, once a reference (Tier 1 or 2) is found:**

```
sharp_prob = devig(reference_book_over_price, reference_book_under_price)
soft_implied_raw = 1 / decimal(price_at_the_book_you'd_actually_bet)   # RAW, not devigged
edge = sharp_prob − soft_implied_raw
```

The soft side is deliberately **not** devigged — the vig at the book you'd bet is part of what makes it a worse price, and devigging it away would erase the very disadvantage this is supposed to measure. This mirrors `clv_backtest.py`'s own real design choice from earlier tonight (raw implied probability at entry vs. a reference close, not a double-devig) — internal precedent already established and tested, not a new pattern invented here.

## Phased build plan

**Phase 1 — implement the tiered redesign in `live_edge.py`.** Add `sharp_reference_price()` (Tier 1/2 lookup + fallback logic) and change `resolve_candidate_edge`'s edge computation to the formula above. Shared file — MLB inherits this the moment it ships, no separate MLB-specific step.

**Phase 2 — real validation before calling MLB's production system done.** E is 35% of the score; a sign error or bad devig here corrupts real, currently-displayed grades. Before/after comparison on real, live MLB candidates: pull a real slate, compute old-E and new-E side by side, sanity-check sign and magnitude (does a real, known-mispriced prop actually show a sensible edge direction), and confirm the real Tier-1/Tier-2/Tier-3 hit-rate matches the 3.3%-ish ballpark measured above rather than some very different, suspicious number that would suggest a bug.

**Phase 3 — per-sport prop-score build, now starting from the corrected edge.** Follows `docs/all-sports-prop-score-gameplan-2026-08-27.md`'s suggested order (NBA/NHL first, tennis last) — that doc's own M/P/X plan is unchanged by this redesign; only E's mechanism changes, and every sport gets the corrected version from the start rather than the old one needing a second migration later.

**Phase 4 — repeat this exact coverage audit per sport, not assumed.** MLB's 3.3%/42% numbers are MLB's own real numbers — NFL/NBA/NHL/Soccer/Tennis's sharp-book prop coverage has not been checked and should not be assumed similar before Phase 3 starts on each one. A sport where Pinnacle/Novig/Kalshi have near-zero prop coverage needs that surfaced honestly before its E component ships, not discovered after.

**Phase 5 — real CLV-style validation once graded data accumulates**, same ethic as `docs/mlb-market-centric-model-gameplan-2026-08-27.md`'s own Phase 0: does the redesigned E actually predict real outcomes/line movement better than the old model-vs-one-book version did, measured for real rather than assumed from the design being more theoretically sound. Not gated on this to ship Phases 1-2 — but the real, honest next check once enough graded picks exist.

## What this does not change

`prop_score.py`'s own M/P/X components, weights (0.30/0.35/0.25/0.10), scale constants, and grade tiers are untouched by this doc — this is scoped to E's *source*, not the whole scoring formula. Whether the weights themselves deserve revisiting once E's redesigned signal is proven is a real, separate question for Phase 5, not decided here.
