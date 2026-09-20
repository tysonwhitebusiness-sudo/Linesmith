# M2 — pre-registration: fitting the simple models

**Committed before the fitting code exists** (the project's standing rule, and
the habit Phase 7 added after a "promising pocket" turned out to be shrinkage).
Written 2026-09-20. Nothing below may be edited after a fit has run; a changed
criterion gets a new section with its own date and reason.

The subject is the generic Elo baseline (`predict/generic_team_elo.py`), which
serves NFL, CFB, NBA and NHL game picks. **Neither fit promotes anything.** A
fitted baseline is still `baseline` in the register until it passes the gate in
`model_status.py` (positive mean CLV and a positive-CLV rate above 50%).

---

## Fit 1 — calibration of the blended probability

**What it changes:** the number, never the pick. Platt scaling maps the model's
probability onto observed frequency; it is monotone, so the side with the higher
probability is the same side afterwards.

**Why it is needed:** CFB's average captured pick reads 68.5% and has never been
checked against how often those picks won.

**Data:** `game_picks` where `source = 'generic_elo'` and `ml_outcome IN
('win','loss')`, per sport. The probability is the captured one
(`ml_initial_prob`), the label is whether that pick won.

**Method:** walk-forward by `commence_time`. For each pick in date order, fit on
every earlier graded pick and predict this one. No pick contributes to its own
fit. Minimum 50 earlier picks before a prediction is scored; earlier picks are
skipped, not scored raw.

**Minimum sample:** 200 graded picks for the sport. As of 2026-09-20: CFB 211,
soccer 54 (capture stopped), NFL 32, NHL 5. **Only CFB qualifies.**

**PASS if, out of sample, both hold:**
1. mean log loss (calibrated) < mean log loss (raw) by at least **0.002**;
2. expected calibration error (10 equal-width bins) is **not worse** than raw.

**On PASS:** write an active row in `model_calibration` for that sport and
`market = 'moneyline'`, and set `fitted_at` in the register.
**On FAIL:** nothing is persisted, the raw probability keeps serving, and the
attempt is recorded in the register's evidence. A failed fit is a result.

**What would make this test lie:** fitting on all picks at once and reporting
in-sample improvement. Hence walk-forward, and hence the minimum-50 rule.

---

## Fit 2 — the blend weights

**What it changes:** which team gets picked. `MARKET_BLEND_WEIGHT` (0.5) and
`ELO_BLEND_WEIGHT` (0.2) are hand-set placeholders the code itself flags as
awaiting a fitting pass.

**BLOCKED, and this is the honest state as of 2026-09-20.** The fit needs each
pick's two components — the Elo probability and the market's implied probability
— and `game_picks.initial_ml_features_json` is **NULL on every generic-Elo row**.
`predict_moneyline` computes both and the capture discards them.

**Unblocking step (M2a, no fitting):** store both components plus the weights in
use at capture time. The fit runs once a sport has 200 graded picks **that carry
components**, which is new data from that day forward; reconstructing them for
past picks would need historical Elo and both sides' archived prices, and the
closing lines for 2026-09-15 → 09-19 are already lost.

**Method, when it runs:** walk-forward as above. Grid over the market weight
`w ∈ {0.0, 0.1, … , 1.0}` with the Elo nudge held at its current value, scoring
out-of-sample log loss. Then repeat for the Elo nudge with the chosen `w`.

**PASS if** the best `w` beats the current 0.5 by at least **0.002** mean log
loss out of sample, on at least 200 scored picks.
**On PASS:** the weights move to the register and the code reads them from
there, never hard-coded.
**On FAIL:** 0.5 and 0.2 stay, and the attempt is recorded.

**Expected outcome, stated in advance so it cannot be rationalised later:** the
market is hard to beat, so a fit that pushes `w` **up** (toward the market) is
the likely result. That would make the Slate's green ring rarer and more
agreeing with the favourite, which is a legitimate finding and not a reason to
re-run the fit differently.

---

## What neither fit does

- Neither makes the baseline beat a closing price. That is the gate, measured
  separately by `modelGateJob`, and MLB's own game model currently fails it
  (mean CLV −0.0571 prob-points, 37.9% positive on 290 matched picks).
- Neither touches the researched models (MLB props, NHL props, NFL props). They
  are separate code with their own gates.
