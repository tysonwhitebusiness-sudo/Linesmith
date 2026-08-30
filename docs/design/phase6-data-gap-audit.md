# Phase 6 data-gap audit — what the three mockups need that we don't have

**Measured 2026-08-29** against the live database and the source tree. Every
row below was checked, not recalled. The three boards
(`player-detail-per-sport.html`, `team-detail-per-sport.html`,
`game-detail-per-sport.html`) are the specification; this is what it would take
to fill them with real numbers.

**Short answer: the layout is not the risk. Five of the ~58 distinct blocks have
no source at all, and the single biggest constraint is not a missing vendor — it
is that six of eight sports have no graded model history, so every "edge",
"model %" and "why the model likes it" block is MLB-only today.**

---

## What we already have, and it is more than expected

| Signal | Table / source | Depth | Sports |
|---|---|---|---|
| Player game logs | `player_game_history` | **2,599,165 rows** | all 8 |
| Prop line movement | `prop_odds_history` | **596,410 rows**, 2,289 subjects, 38 markets | broad |
| Game line movement | `game_odds_history` | 47,622 rows, 478 events, 21-22 books | sport-agnostic (`event_id`) |
| Team ratings | `team_elo_history` | 86,944 rows, MLB back to 2010 | 6 team sports |
| Golf hole-by-hole | `golf_hole_scores` | 9,778 rows (hole, par, strokes, rel-to-par) | golf |
| Park factors | `park_factors` | 542 rows, computed in-house from schedule | **MLB only** |
| Weather | `lib/weather/openMeteo.ts` (keyless) | live forecast | **wired to MLB only** |
| Injuries | ESPN, per-sport adapters | present in all 7 adapters | 7 |
| Rosters | `/api/{sport}/team` | real | mlb, nfl, nba, nhl, cfb |
| Opponent-unit splits | `/api/{sport}/team-defense-allowed` | real | cfb, nba, nhl |

The line-movement tape, the splits grids, the game logs, the rolling-form charts
and the Elo history on all three boards are **fully sourced today**. That is
most of the chart surface.

---

> **OPERATOR DECISIONS, 2026-08-29.** Officials: **CUT**. Tennis point-level:
> **CUT** (both blocks replaced with ones derivable from the eight tennis keys we
> already store). NBA/NHL shot coordinates: **APPROVED, build it**. Everything
> else proceeds without further guidance. The plan of record is now
> `docs/audit-remediation-plan.md` Phase 6, rewritten to match.

## Tier 1 — no source at all. Real new work.

### 1. Officials / umpires / referees — **nothing exists** &mdash; **CUT**

Greps across `lib/`, `app/api/` and `python-odds-service/src/` return **zero**
hits for umpire, crew, or officiating. There is no table, no fetch, no field.

This is the one block on the game board that is **entirely invented**. It is
also genuinely predictive — a plate umpire's zone size moves strikeout and total
markets, an NFL crew's flag rate moves totals, a referee's card rate moves
soccer bookings. Every sport needs its own source (MLB: UmpScorecards-style
zone data; NFL/NBA/NHL: crew assignment feeds; soccer: referee stats).

**Cost: one new integration per sport. Nothing reusable across them.**

**Cut 2026-08-29** and removed from the game board, on exactly that cost.

### 2. Tennis spatial + serve mix — **no source** &mdash; **CUT**

Tennis is already the thinnest sport on the player board (8 stat keys). The
serve-placement grid and serve mix need point-level data that no integrated
provider supplies. This would be a paid vendor.

**Cut 2026-08-29.** Both blocks were replaced with ones derived from the eight
tennis keys already in `player_game_history`: **"Games won by set"** (set x tier)
and **"Match shape"** (straight sets / four / five / tiebreak-decided). Tennis
keeps a full-depth page with no purchase. Its *match-level* serve aggregates
(hold %, break %, aces) survive but still need confirming — Phase 6.12.

---

## Tier 2 — the vendor is already integrated, at the wrong granularity

**This is the good news, and it is where the leverage is.** Three of the four
missing spatial grids are behind endpoints we already call.

### 3. MLB strike zone + pitch mix — a **parameter change**

`lib/sports/mlb/savant.ts` already calls
`https://baseballsavant.mlb.com/statcast_search/csv` with `type: 'details'` —
the pitch-level endpoint — but passes `group_by: 'name'`, which collapses it to
one season-aggregate row per player. Ungrouped, the same keyless call returns
per-pitch rows carrying `zone`, `pitch_type`, `plate_x/plate_z` and
`estimated_woba_using_speedangle`.

That single change unlocks **the strike-zone grid, the pitch mix, and the
opposing-starter zone matchup** on all three boards.

**Also worth knowing: only 4 of the 11 Statcast metrics in the mockup exist
today** — `barrelPct`, `exitVelo`, `hardHitPct`, `whiffPct`. Missing: max exit
velo, sweet-spot%, xwOBA, xSLG, xBA, chase%, sprint speed. Most come from the
same ungrouped call.

**Cost: params + a storage table + a backfill. No new vendor, no key.**

### 4. Soccer shot map — Understat is integrated, wrong endpoint

`python-odds-service/src/predict/understat.py` uses only the **league-data**
endpoint, for one number (team goals-against). Understat's match/shot endpoints
carry per-shot `x`, `y` and `xG` — exactly the shot map on the boards.

**Two caveats, both in that file's own header:** Understat is big-five-leagues
only, so **MLS gets nothing**, and the current code is deliberately EPL-only.

### 5. NFL / CFB target map + route mix — nflverse is integrated, wrong release

`lib/sports/nfl/nflverse.ts` pulls **weekly player box scores**. nflverse also
publishes **play-by-play** with air yards, pass location and depth — which is
what the target map (depth × direction) and the down/distance grid need.

The adapter's own comments already flag the shallowness: *"nflverse's Receiving
group is thin (only `receptions-allowed` is real)"* and *"DEFENSE_STAT_DEFS only
covers 5 real defense-allowed"*.

**Cost: a second nflverse release + storage. Same vendor, no key.**

---

## Tier 3 — public data exists, nothing wired

### 6. NBA shot chart / NHL shot location &mdash; **APPROVED, build it**

`lib/sports/nba/sportsdataverse.ts` and `lib/sports/nhl/nhle.ts` are integrated
for box scores. Neither pulls shot coordinates, though both upstream APIs
expose them. New fetch + table per sport. **Approved 2026-08-29 — Phase 6.7.**

---

## Tier 4 — exists, but MLB-only. Generalising is the work.

| Signal | State | What is missing |
|---|---|---|
| **Model track record** | `pick_history`: **MLB 369,185 / soccer 381 / everything else 0**. `game_picks`: mlb 176, soccer 24, nfl 16, cfb 8. | **This is the biggest single gap.** "Model %", "Edge", "Why the model likes it", grades and confidence are on every one of the three boards, on every tab. Six of eight sports have effectively no graded history to produce them from. |
| **Simulations** | `game_sim_cache`: 192 rows, **`sport` column exists but only `mlb` populated** | The "simulated margin" rail block on the game board is MLB-only. Table shape is already generic. |
| **Park / venue factors** | `park_factors`: MLB only, computed in-house from schedule — no external dataset needed | Same technique would work for any sport with a fixed venue set. NFL/CFB conditions blocks currently have venue but no factor. |
| **Weather** | open-meteo, keyless, already wired — but only into `mlb/adapters/*` | Extending to NFL, CFB and soccer is a wiring change, not an integration. Indoor sports do not need it. |

---

## Tier 5 — thin, already flagged in the boards themselves

- **Book grid**: `game_odds_book_lines` — soccer 23 books / MLB 22 across three
  markets; CFB 4, NFL 3, tennis 3, all moneyline-only; **NBA and NHL zero rows**.
- **Standings**: no `/api/**/standings` route exists; it arrives inline on
  snapshots. Fine today, but the team board makes it a first-class block.
- **Rosters**: routes exist for mlb/nfl/nba/nhl/cfb. **No soccer, tennis or
  golf roster route.**

---

## Recommended order

1. **Backfill `pick_history` for the six sports that have none.** Nothing else
   unblocks as many blocks across as many tabs, and it needs no new vendor —
   the game logs and closing lines to grade against are already stored.
2. **Ungroup the Statcast call.** Cheapest high-value item on the list: one
   parameter, one table, and MLB's three deepest blocks become real.
3. **Wire weather to the other outdoor sports** and generalise `park_factors`.
   Both are in-house, both are small.
4. **nflverse play-by-play**, then **Understat shots**. Same vendors, new
   releases, unlocks NFL/CFB/soccer spatial blocks.
5. **Book-line sourcing for NBA and NHL.** Their game boards ship with an empty
   centrepiece until this lands.
6. **Officials**, per sport — genuinely new, genuinely predictive, and the only
   item with no reusable path.
7. **Tennis point-level data** — a paid vendor decision, and the one item worth
   deciding *not* to do if the tab can state its own limits honestly.

**Nothing on this list blocks starting `components/charts/`.** The primitives
render from whatever data exists; a block with no source renders its empty state,
which the grammar already defines. The sourcing work and the chart work are
independent and can run in parallel.
