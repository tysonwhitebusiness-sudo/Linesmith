# P13 · Closing-line test (E3), a background measurement

**Lane:** Python, reporting only. **Blocks nothing:** the build is complete
at P12. **Its harness ships in P11**; this file says what it measures and
when it reports.

---

## What it answers

1. **Do soft books move toward our fair price by the start?** For every
   `market_edge_log` row with `displayed = true`, take the soft book's
   **close** (its last pre-start price: the last `prop_odds_history` /
   `game_lines_history` row before the start) and the sharp **fair close**
   (the same de-vig on the reference's last pre-start pair). Then report:
   - `moved_toward` = the close is nearer the fair price than the shown
     price was (yes/no);
   - `clv` = fair_close × shown_decimal − 1 (the shown price measured at the
     fair close).
2. **Edge half-life** (P7 §4): median `ended_at − shown_at`. Edges that end
   within one poll interval count as timing artefacts.
3. **Split everything** by sport, market group (game lines / props), soft
   book and reference source.

## Harness

`python-odds-service/edge_clv_report.py [--since YYYY-MM-DD]` (built in
P11):
- reads the log and the history tables;
- writes `docs/design/odds-build/results/e3-<date>.md`: counts, share
  moved toward, mean and median CLV with a 95% interval
  (bootstrap, 2,000 resamples), half-life, and artefact share, per split;
- **says "not enough data" below n = 30 per split** rather than printing a
  number.

## When

- A first read at ~day 3–5 (the D3 review).
- The real report at ~2 weeks after edge goes live.
- Then monthly.

The results replace the plan's confidence estimates (plan §7: "~8/10 game
lines, ~6/10 props after T0").

## What the operator decides from it ⚑

Gate thresholds are tightened or loosened **only from this evidence** (D3):
the cap (8%), the self-check (5%/5%), the agreement band (3.0 pts), the
exchange spread (4¢) and the freshness windows (20 min / 3 min). Each change
is a numbered decision in the master plan.

## Tests

`src/test_edge_clv_report.py` (hermetic → CI): on a synthetic log it checks
that a soft close moving toward fair counts, one moving away does not, CLV
matches a hand computation, the bootstrap interval is ordered, and n < 30
prints "not enough data".

---

## Result (2026-09-25, `352d022`) — built and started; read later

- `python-odds-service/edge_clv_report.py [--since YYYY-MM-DD]` as specified;
  `src/test_edge_clv_report.py` (CI) passes.
- The close needs each game's start: P11's writer now stores it in
  `reference.start`; older rows fall back to `game_result.event_start`, then
  the scoreboards.
- First run 2026-09-25 22:13 UTC: 2 closed edges (MLB), both measured — "not
  enough data", as it should (`results/e3-2026-09-25.md`). Rows logged today
  came from the laptop runs during the P11 build; they are real edges on real
  prices, and they stay in the log.
- **It starts collecting for real at the worker deploy** (marketEdgeJob).
  **Read it:** first at deploy + 3–5 days (≈ 2026-09-29 to 10-01 if deployed
  2026-09-26), the real report at deploy + 2 weeks (≈ 2026-10-10), then
  monthly: `cd python-odds-service && .venv/Scripts/python.exe edge_clv_report.py`.
- No scheduled task was created (the report is a laptop script that writes a
  file into the repo; the dates are in `docs/CURRENT.md`).
