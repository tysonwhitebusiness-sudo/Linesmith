# CURRENT — pick up here

> Handoff file for switching accounts mid-work. **Rewritten, not appended.**
> If it disagrees with anything else, trust `docs/audit-remediation-plan.md` §11
> and `git log` — those are the record; this is just the baton.

**Prompt to paste into a new account:**

```
Read docs/CURRENT.md and continue from there.
```

**THE RULE THAT KEEPS THIS FILE USEFUL: at ~92% context usage, stop.** Take on
no new work, finish or checkpoint what is open, and rewrite this file, then
commit and push.

## The documents, in reading order

1. **`docs/audit-remediation-plan.md`** — §0 (working rules, standing decisions
   **Q1–Q36**, the G1–G8 gate) and the phase you are working.
2. **§11** — the phase log. Phases 0, 1, 2, 3, **5** all have PASSED gate
   entries. Phase 4 is logged task-by-task and its gate has not run.
3. **`docs/table-ownership.md`** · 4. **`CLAUDE.md`** · 5. `docs/audit-phase-*.md`

**Last updated:** 2026-08-29 ~13:05Z, mid-Phase-4.
**Repo state:** clean, pushed. Worker live on `377f05d`.

---

## 1. Where we are

**Phases 0, 1, 2, 3, 5 COMPLETE — all gates PASSED.**
**Phase 4 IN PROGRESS.** 11 of 13 tasks done (4.7 complete across all four
sports; 4.12 at 7 of 8), nothing running.

Phase 5 finished this session: all 13 tasks, gate G1–G8 passed on the re-run
after G1 failed once (see §11 — the failure and its diagnosis are the most
useful thing in that entry).

### Phase 4 status

| Task | State |
|---|---|
| **Q28** market reference for `game_picks` | **DONE** — unblocked 4.2/4.3/4.5 |
| **4.1** `market_prob` coverage | **DONE** — real causes measured, staleness split |
| **4.2** market activation gate | **DONE** — built + tested; live sample n=12, see §4 |
| **4.4** shadow flag | **DONE** — migration + renderer + round-trip proof |
| **4.7 NBA** | **DONE** — 279,661 rows |
| **4.7 MLB** | **DONE** — 727,613 rows; survivorship fix quantified |
| **4.7 tennis** | **DONE** — 271,964 rows (atp + wta) |
| **4.7 golf** | **DONE — decided NOT to build.** Reasoning in §11 |
| **4.5** CLV on /diagnostics | **DONE** — job + route + card; found a 5.3 regression |
| **4.9** split `edge` definitions | **DONE** — 3,852 rows attributed |
| **4.12** model hygiene | **7 of 8** — 8th (M2) measured, left for operator |
| 4.3 Platt calibration | not started |
| 4.6 fade signal | not started |
| 4.8 collapse two MLB game models | not started |
| 4.10 both sides for generic sports | not started |
| 4.11 totals distribution | not started |

## 2. NOTHING IS RUNNING

All three backfills finished cleanly this session. `player_game_history` now:

```
mlb 727,613 · nhl 674,003 · nba 279,661 · cfb 273,649 · nfl 226,629
soccer_epl 168,493 · tennis_wta 142,152 · soccer_mls 133,892 · tennis_atp 129,812
golf 0 (deliberate)
```

## 3. Next actions, in order

**Task 4.7 is fully done — that was the operator's headline ask.** Remaining
Phase 4 work:

1. **4.10** both sides for generic sports — only verifiable live on soccer
   right now (NBA/NHL/CFB/tennis are out of season and writing zero
   `pick_history` rows), so expect to fix + unit-test all five and record that
   live confirmation for four of them defers. Q34 already says this.
2. **4.8** collapse the two MLB game models. **Q25 governs**: keep the
   validated one, delete the other, re-grade — but SNAPSHOT the affected rows
   first, because re-grading rewrites the recorded track record.
3. **4.11** negative binomial for totals — P3 measured real over-dispersion
   across 31,846 rows, so the Poisson assumption is empirically false. Note
   4.12's P3 L1 push fix already touched `poisson_over_probability`; the
   negative-binomial replacement should keep the same push handling.
4. **4.3** Platt calibration — gated by the same thin sample as 4.2. **Q32**:
   min n=200 per sport+market, below which write no calibration row at all.
5. **4.6** fade signal — 4.6 itself says not to build on it until 4.1 supplies
   the sample, and 4.1 measured that sample as supply-limited (under-side
   scarcity). Likely a "record, do not build" outcome like golf's 4.7.
6. **4.12's last item (P3 M2)** needs the operator, not code — see §4.
7. Then the **Phase 4 gate** (G1-G8 plus its own section). Note its extra
   requirements: the activation gate must refuse a real bad model (done —
   `test_market_gate.py`), the shadow round-trip must be shown in both
   directions (done — `scripts/gate/phase-4-shadow-roundtrip.mjs`), and every
   4.12 item needs its own line.

## 4. What Phase 4 has learned — read before 4.3 or 4.6

**The plan's Phase 4 text is stale in two places, both measured:**

- **4.1's "resolve_candidate_edge has never run" is wrong.** It runs, from
  `prop_pick_history.py:43`, `generic_prop_score.py:188` and
  `generic_rare_markets.py:137`. It returns None almost always instead.
- **The two causes 4.1 names are not the dominant ones.** Measured: staleness
  is (5,877 same-book two-sided pairs exist; **2** are inside the 30-minute
  bound at any instant, because `refreshTier1` rewrites ~238 rows per cycle
  against a 49,000-row table). Fixed by splitting the display bound from the
  reference bound. Second cause is **under-side scarcity** — 43,620 overs
  against 5,113 unders, `propline_2` supplying **zero** unders — which no code
  fixes and which is exactly why **Q26** exists.

**4.2 will run on a small sample and that must be stated, not hidden.**
Q28 built the market reference and it works (MLB 91 values, real books,
pinnacle 22). But `game_odds_book_lines` is a current-state table, so only
recent games still have lines to reference: **graded MLB picks with both a
model and a market probability = 12, of 125 graded.** `game_odds_history`
covers only 41 of 176 MLB picks. Q24 says a model that loses to the market is
deactivated — at n=12 the gate cannot discriminate, so **run it, report the
number and its uncertainty, and do not deactivate on an underpowered sample.**
Record exactly that.

**A correction carried into this file** (it was wrong here before): bookmaker
canonicalisation being "part of why 4.1's resolution rate is 18%" is true for
game lines and **false for props** — `prop_odds` has 17 bookmakers and 17
lowercased bookmakers, so its casing was never split. 5.3 is load-bearing for
`game_odds_book_lines` and Q28's reference; it is not a 4.1 fix.

## 5. Things that will bite again

**A NEW LESSON THIS PHASE PAID FOR, and the most transferable one:**
**a dead consumer cannot report that its input vanished.** Task 5.3 renamed
every bookmaker in `game_odds_history`; `clv_backtest.py`'s reference book was
hardcoded as `"LowVig.ag"` and silently matched zero rows afterwards. Nothing
failed, no test went red, no health check complained — because the module had
no caller. It surfaced only when 4.5 wired it to the dashboard, at which point
it went from 0 of 337 picks matched to 60. **After any migration that renames
values, grep the tree for hardcoded instances of the OLD value, including in
code nothing currently calls.**

- **Fault injection is easy to fake — four occurrences now.** The newest:
  `scripts/gate/phase-5-constraints.mjs` first reported all 17 violations
  "rejected", and every one was rejected by a `NOT NULL` on
  `fetched_at`/`category`, not by any CHECK constraint. Nothing was being
  tested. Caught only because the script inserts a known-good CONTROL row per
  table and asserts `e.constraint` equals the specific constraint under test.
  **Never accept "the operation failed" as evidence — assert WHY.**
- **Reverting a fix and re-running its test can prove nothing.** Reverting
  `mlb_game_lines.py` produced an ImportError, not a failure. The real
  counterfactual came from extracting the pre-fix function out of git history
  and running the same fixture through it.
- **A deploy does NOT mean every writer runs the new code.** This cost the
  Phase 5 gate a full G1 failure. Render restarts the worker, but OddsHarvester
  runs as Windows scheduled tasks (`LinesmithOddsHarvester*`, ~20-min cycle) and
  Python binds imports at process start, so a run begun before your change keeps
  writing old behaviour for up to 20 minutes. **Any migration that normalises a
  column needs re-applying after those processes cycle**
  (`20260829110000_canonical_bookmaker_residue.sql` exists only for this).
- **The plan's own task text goes stale, repeatedly.** This session: 5.6 was
  already fixed; 5.1's alias table was real but incomplete and missed the actual
  cause; 5.4's `side IN ('over','under')` would have rejected 449 legitimate
  `'other'` rows; 4.1's premise is wrong. **Measure before implementing.**
- **`withJobLock` is a LEASE TABLE, not an advisory lock.**
- **Postgres UNIQUE treats NULLs as distinct.**
- **A long heredoc breaks this shell** (>~120 lines → "unexpected EOF"). Use the
  Write tool for long files.
- **`cd` persists between Bash calls.** Use absolute paths.
- **Git Bash `/tmp` is not Python's `/tmp`.** Bit me again this session.
- **Stale `.next/types` break `tsc` after deleting a route** — `rm -rf .next/types`.

## 6. Operational knowledge

- **DB access:** temp `.mjs` in the repo root, `node` it, delete after. `:6543`
  is the transaction pooler; use `:5432` for DDL.
- **Tests:** `npm test` (**36**) and `python -u src/test_x.py` from
  `python-odds-service/`. **13** hermetic Python tests, all now in
  `.github/workflows/ci.yml`, one step each.
- **Gate scripts:** `node scripts/gate/phase-5-constraints.mjs` (every CHECK
  tripped deliberately) and `node scripts/gate/phase-5-budget-race.mjs` (the
  5.12 race, both directions, with the counterfactual).
- **Render:** worker `srv-da36bm2bkg8c73fqrdeg`, `autoDeploy: no` — after any
  push touching `python-odds-service/`, POST a deploy and confirm the live
  commit. ~90s.
- **Propline budget:** `propline` 1000/day (MLB), `propline_2` 1000/day
  (soccer), now genuinely separate. **18 of ~20 authorised propline_2 probe
  calls spent** capturing `docs/propline-live-capture-20260829.json` — reuse
  that file rather than re-probing.
- **No `gh` CLI and no GitHub token.** CI via the public Actions API.
- **Don't `git add -A` blindly** — `docs/discord-community-prompt.md` is the
  operator's. Use `git add -A -- . ':!docs/discord-community-prompt.md'`.
  Note: adding a gitignored path to that pathspec makes `git add` exit non-zero
  and silently skip the commit behind `&&`.

## 7. Backup tables outstanding

| Table | Rows | From |
|---|---|---|
| `prop_odds_dedup_backup_20260829` | 178,238 | Phase 3 |
| `game_odds_book_lines_bookmaker_backup_20260829` | 6,199 | 5.3 |
| `game_odds_book_lines_quarantine_20260829` | 114 | 5.4 (Q23) |
| `game_odds_history_bookmaker_backup_20260829` | 47,622 | 5.13 |

## 8. Carried forward / known not done

- **5.1's second VERIFY half is still unconfirmed.** `prop_odds` has not yet
  gained Propline **batter** rows because `propline` is correctly gated at
  1000/1000 for 2026-08-29. All 24 live market keys resolve in
  `test_propline_alt_lines.py`. **After 00:00 UTC run:**
  ```sql
  SELECT market_key, count(*) FROM prop_odds
   WHERE provider_id='propline' AND fetched_at > '2026-08-30'
   GROUP BY market_key ORDER BY 2 DESC;
  ```
  Before the fix this returned exactly one MLB market (`pitcher-strikeouts`).
- **`/diagnostics`, `/bets` and the signed-in walk were never verified** — no
  credentials; creating an account or entering a password is out of bounds.
- **`refreshSportsGameOddsJob` has not run since 04:38Z**, having hit vendor
  HTTP 429s. Pre-existing (proven: the 07:00Z sweep recorded the same last-run),
  unowned.
- **`snapshotCacheSize` unhealthy** — 12.6 MB payload against a 10 MB bound.
- **Sharp coverage 9.08%**, under 5.2's own 10% threshold, so a Pinnacle-class
  feed is justified by the plan's rule. Recommendation only — **nothing
  purchased**. Pinnacle currently covers one market of thirteen.
- **5.9 lowered the ParlayAPI gate by 20%** — soft caps of 800 against a hard
  1000 were configured and ignored; now they bind. Unset the env vars rather
  than reverting code if unwanted.
- **2,380 duplicate observation groups in `game_odds_history`**, revealed not
  created by 5.13. Owner: 6.1.
- **3.15's two GET-path writers** remain, carried from Phase 3.
- **No push alerting** (Q19) — Phase 8. **Rate limiting per-process** — Phase 8.
- **`SUPABASE_SERVICE_ROLE_KEY` cannot be rotated** — Phase 7.
