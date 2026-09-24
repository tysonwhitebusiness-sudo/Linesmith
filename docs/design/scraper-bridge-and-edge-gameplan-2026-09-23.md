# Scraper bridge + market edge — gameplan

**Written 2026-09-23** from an audit session. Operator decisions are in §1 and
are settled; do not re-ask them. **Nothing in §3–§5 is built yet. Do not start
a phase without the operator's go** (standing instruction, 2026-09-23).

The scraper is a separate project: `C:\Users\occy3\Documents\odds-scraper`
(FastAPI on :8000, SQLite `data/scraper.db` for recent days, Parquet in
`data/archive/` for older, raw pages in `data/raw/` kept 48 h). Its own resume
notes are `HANDOFF.md` and `SOURCE_HANDOFF.md` there.

---

## 1. Decisions (operator, 2026-09-23)

| # | decision |
|---|---|
| D1 | The scraper becomes a **third writer** into the live tables, beside the Python worker (paid APIs, Render) and OddsHarvester (laptop). It does not replace them. Full history stays on the laptop; only current prices + price moves reach Supabase. |
| D2 | **Bridge first, then edge.** |
| D3 | **Edge goes on pages without waiting** for the accuracy test. The closing-line test runs ~2 weeks after edge ships. |
| D4 | **Edge shows only where it can be accurate** — strict gates (§4). A market that fails the gates shows no edge, never a guess. The old approach failed by trying to price everyone. |
| D5 | **The Scan table is unfrozen for edge** (lifts D3/C6's freeze for this one change; update `tests/slate-shell.test.ts`'s content hash and `tests/ui-scope.ts` deliberately). |
| D6 | The Slate's "no edge, anywhere" rule was a thin-data call, not a principle. Lift it deliberately in CLAUDE.md and `tests/scan-no-edge.test.ts`. Edge is MARKET edge (sharp vs soft book); the model's numbers stay out of it. Edge lives in odds sections, not as the frame of every card. |
| D7 | User CLV removed (`709d807`). `prop_odds_history` hot window 14 → 10 days (`2331a56`), sized for the game page's pre-game prop prices. |

## 2. Measured starting point (2026-09-23)

**Name matching**, scraper's 144,193 current prop prices vs Linesmith's maps
(`entity_resolution.py`): books map **94%** (11 missing: `theScore Bet`,
`prophetexchange`, `sugarhouse`, `Hard Rock Bet (FL)`, `BUCKEYE`, `Courtside`,
`bookmakereu`, `4CX`, `AMAPOLA`, `4C`, null); prop markets map **46%** (68
labels missing, e.g. `player_touchdowns`, `player_reception_yds`, `H+R+RBI`,
`Singles`, `player_rush_yds`, `player_1st_td`); both **42%**. Games and players
not yet measured.

**Flapping** (A→B→A within an hour, as a share of recorded moves): comparenbet
**70%**, oddstrader **96%**, 4codds 11%; Linesmith's paid feeds 3–24%
(Propline 18%). comparenbet's upstream is SportsGameOdds.

**Movement today**: Propline's median gap between recorded moves is 60 min
(p10 14, p90 261); most sports refresh every 20 min (`jobs.py:1495–1507`); the
chart's default 48 h view buckets at 30 min (`lineHistory.ts:106`).

**Sharp coverage** (two-sided sharp price at the same line):

| system | props | game lines |
|---|---|---|
| Linesmith paid feeds | 21% of 15,765 fresh prop lines (Pinnacle alone: 317 player-markets) | 66 of 99 games have a sharp book |
| OddsHarvester | — | no sharp books |
| scraper steezanomics | 53% of 3,527; 90% have 5+ books | — |
| scraper 4codds | 59% of 769 | 66% of 580 |
| scraper theoddsgap | — | 76% of 5,293 |
| scraper comparenbet | 11% of 22,181 (likely undercount — sides may sit under separate ids) | 40% of 6,406 |

**Storage**: DB 5.42 GB of 8 GB included. With the 10-day window and a fully
matched scraper feed, estimate ~6.7 GB steady state. A DELETE reuses space in
place; it does not shrink the disk figure.

**Existing edge track record is unusable**: `pick_history` has ~500
sharp-referenced graded rows; 19 Pinnacle-referenced MLB HR overs at ~+1000
show 17 wins. A grading or price-capture bug (likely in-play prices stored as
pre-game). Not app-breaking; routed to §5.

## 3. Bridge phases

| phase | what | done when |
|---|---|---|
| B0 | Add the 68 market labels + 11 books to BOTH alias maps (`entity_resolution.py` and `lib/odds/props/entityResolution.ts`; `tests/config-drift.test.ts` asserts they match) | re-run the §2 measurement: both-mapped ≥ ~90% |
| B1 | Match scraper games → Linesmith game ids | measured match rate per sport, hand-checked sample |
| B2 | Match scraper players → ESPN athlete ids via the existing roster index (`resolve_player`) | measured match rate per sport, hand-checked sample |
| B3 | **Flap filter** (a new price counts once it holds two readings) and **line-pull recording** — in the scraper (it records nothing when a price disappears, and its dedup hides a pull-and-return) and in Linesmith's writer (`db.write_prop_odds` step 4 deletes from `prop_odds` and writes nothing to history) | a pulled line is visible in history; flap share < paid feeds' |
| B4 | The bridge: a laptop job writing current prices every ~60 s through `db.write_prop_odds` / `db.write_game_odds_book_lines` as `scraper:<source>`; heartbeat for `health_check`; starts at boot, restarts on crash; unmatched rows KEPT, not dropped (audit gap: `odds_unresolved` keeps only the name, never the price) | two days unattended, heartbeat green, history growth inside the estimate |
| B5 | Pages: display names / order for the new books; a shorter chart window so minute-level movement is visible | rendered on each sport's player + game page |
| B6 | Expiring history: run `backfill_comparenbet_history.py` (`line_history` has 0 rows); pull theoddsgap's 45-day props export daily; stop discarding betmonitor's 24 h charts and oddstrader's openers | rows landing daily |

## 4. Edge phases (after the bridge)

**Calculation** (existing `edge_sharp_vs_soft`, probability points; show EV too):
de-vig the sharp two-sided price to a fair probability, compare with the soft
book's implied probability. E.g. Pinnacle −115/−105 → fair 51.1%; DraftKings
+105 (48.8%) → +2.3 pts, EV +4.7%.

**Scope: every odds system, not one source.** Edge reads the shared live
tables (`prop_odds`, `game_odds_book_lines`) that all three writers feed. The
sharp reference and the soft price may each come from any provider — Propline,
ParlayAPI, SharpAPI, the-odds-api, OddsHarvester (soft game lines only; it has
no sharp books) or `scraper:*` — provided the row passes the gates. Combining
them depends on B0–B2 putting scraper rows on the same (game, subject, market,
line) keys the paid feeds already use.

**Why the old edge failed** (measured): 18,808 of ~19,300 stored edges (97%)
were `model_vs_market` — the model's probability minus the book's — so an
"18% edge" was the model disagreeing with the book, not a mispriced book. Only
~500 ever used a sharp reference, and those carry the §2 grading bug. This
system uses no model at all.

**Gates — edge renders only if ALL pass:**

1. Reference: game lines — Pinnacle or Circa two-sided at the exact line.
   Props — Pinnacle two-sided, OR two sharp/exchange sources (Novig, ProphetX,
   Kalshi, Polymarket) whose fair probabilities agree closely. An exchange
   counts only if its hold is tight (thin/wide markets excluded).
2. Fresh and simultaneous: sharp and soft both recent and within a few minutes
   of each other (today's `_MAX_PAIR_SKEW_SECONDS` is 30 min — too loose).
3. Settled: passed the flap filter; the soft line is not pulled.
4. Pre-game only.
5. Conservative: de-vig with every method in `odds_math.py` and show the
   SMALLEST edge.
6. Logged: every edge shown is written (time, both prices, reference, method)
   to a NEW table — not `pick_history` — for the closing-line test.
7. One book, several providers: use the freshest row; if two providers report
   the same book at nearly the same time and disagree beyond a small tolerance,
   the market shows no edge (one of them is wrong). `mainLine.ts`'s
   newest-wins rule is right for DISPLAY, too loose for edge.
8. Cap: a single edge above ~8–10% is hidden as a probable data error until
   reviewed.
9. Self-check: if more than a small share of gated markets show edge above ~5%
   at once, edge display turns itself off and `health_check` alerts — the
   "half the props at 18%" failure cannot reach users again.

Expect game lines to show edge RARELY and SMALL (~1–3%): soft books copy sharp
main lines within minutes. Many large game-line edges means the system is
broken. Props show edge more often and with more uncertainty.
Confidence at planning time: game lines 8/10, props 6/10, overall 7/10;
the E3 closing-line test is what replaces these with a measured number.

| phase | what |
|---|---|
| E1 | Edge computed in Python with the gates; its own table + log (Python writes, TS renders) |
| E2 | Render: player prop block, game page odds, Slate Books section, **Scan table** (D5). Lift the rule in CLAUDE.md + `tests/scan-no-edge.test.ts`; update Scan's pinning tests |
| E3 | **~2 weeks after E2**: closing-line test — do soft books move toward our fair price by start? Split by sport and market type; tighten or loosen gates per result |

## 5. Routed findings (not in the bridge/edge path)

From the 2026-09-23 retention audit — nothing is being lost that the corpus
doesn't hold, except these:

1. Soccer injuries: `injury_snapshot.py` lists EPL + MLS; `injury_report` has
   zero soccer rows. Unrecoverable per missed day.
2. `pick_history` grading/capture bug (§2).
3. `pick_history` keeps only the FIRST prediction (`ON CONFLICT DO NOTHING`);
   later pre-game revisions are not recorded.
4. `game_odds_history` is never pruned but has no corpus copy (Postgres + the
   weekly backup only).
5. Scraper raw pages are deleted at 48 h; fields its parsers skip are lost.
   Unmeasured. Keeping one page per endpoint per hour ≈ 30 GB/yr (rough).
6. `db.prune_prop_model_cache` exists and is wired to nothing — leave it so.
