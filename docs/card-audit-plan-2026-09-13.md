# Card & data-depth audit — plan

**Status: AWAITING OPERATOR APPROVAL. No audit work has started.**
**Created 2026-09-13.** Runs alongside the open Phase 5 egress retest; does not
depend on it.

## Why this exists

Two operator observations, both checked before this plan was written:

1. **"Data is thin when we have 10+ years in almost every sport."** Confirmed,
   and the cause is structural rather than per-card — see Finding 1.
2. **"A gridbox built for MLB is being squeezed into each sport where it
   doesn't make sense."** Not yet verified; this is what Phase C measures.

The stated goal of the page-by-page pass, in the operator's words: **make sure
each sport's cards make sense in that sport's context.** Same page skeleton
everywhere, individual cards allowed to differ where the sport genuinely
differs. That is Phase C, and it is the heart of this audit.

## Finding 1 — established before the audit, by grep

`player_game_history` (2.75M rows, multi-season, sport-generic JSONB) is read
by **exactly one file in the frontend**: `lib/sports/shared/seasonAggregates.ts`
— and that file pins itself to one season:

```sql
SELECT max(season) AS season FROM player_game_history WHERE sport = ?
```

Corollaries, each verified:

- **No `playerDetailAdapter.ts` for any sport reads `player_game_history`.**
- **`lib/db/client.ts` never queries it** — one comment names it, zero SQL.
- Non-MLB player pages source history from `PickCandidate.history`, built in
  each sport's `adapter.ts` from **vendor season files** (sportsdataverse),
  current-season-only by construction. NBA's adapter states this outright:
  "No prior-season fallback needed here."
- Only **MLB and golf** have a real per-player API route. The other six sports
  expose only `.../player/[playerId]/candidates`.

**So the multi-year corpus currently feeds team-level season ranks for the
current season, and nothing else.** This is not a handful of miswired cards; the
read path from that table to a player page was never built.

## Finding 2 — the method constraint

Static grep **cannot** answer "which cards are populated." An attempt to build a
field-coverage matrix across the eight player adapters returned an impossible
result (that only MLB sets the *required* `chart` field). Optional fields are
assigned through variables, spreads and conditionals. **Pages must be rendered
and observed.** See `feedback_render_before_believing`.

## Scope — 21 surfaces, not 24

Decided with the operator 2026-09-13: all three shared surfaces.

| surface | sports with an adapter | count |
|---|---|---|
| PlayerDetail | mlb, nfl, nba, nhl, cfb, soccer, tennis, golf | 8 |
| TeamDetail | mlb, nfl, nba, nhl, cfb, soccer | 6 |
| GameDetail | mlb, nfl, nba, nhl, cfb, soccer, tennis | 7 |

Golf has no team or game adapter; tennis has no team adapter. Both are believed
correct (no team concept) — **Phase C confirms that rather than assuming it.**

Soccer carries two leagues (EPL/MLS) and tennis two tours (ATP/WTA) off shared
adapters. Primary pass uses EPL and ATP; the sibling gets a spot-check for
divergence, not a full pass.

## Standing rule for this audit

**Log everything, fix nothing** (operator decision). Phases A–C produce a
ledger only. All repair is batched into Phase D and approved separately. A
session that dies mid-audit must never leave half-fixed pages behind.

---

## Phase A — Data-depth ledger

*What we hold, against what the page asks for.* DB reads cleared by the
operator 2026-09-13 (pooler at 15 connections; no fits contending).

Per sport, from `player_game_history`:

- seasons present, row count per season, distinct athletes per season
- **which `stats` JSONB keys are populated per season** — the vocabulary is
  expected to thin out in older years, and nobody has measured it. A 10-year
  corpus whose useful keys only start in year 7 is a materially different
  remediation than one that is uniformly deep.
- the same for any sibling corpus a sport uses instead

Beside it: the depth each surface actually requests today.

Row shape of the output:
`NHL — 11 seasons, 412k rows, 9 usable stat keys 2019+ / 4 before — player page reads 1 season from a vendor file.`

Egress: `COUNT`/`GROUP BY` only, small result sets. Per `docs/CURRENT.md`'s
measurement trap, any rate cross-checked against lifetime, never extrapolated
from one window.

**Deliverable:** `docs/audit-2026-09-13/phase-a-data-depth.md`

## Phase B — Read-path trace

Per surface, rendered in the dev server with network capture:

- which fetches fire, and what each returns
- which `PlayerDetailData` / `TeamDetailData` / `GameDetailData` fields land
  `null` / `[]`
- **why**, classified: missing data / missing query / adapter never sets it

This is what converts "not wired properly" into a named cause per card.

**Deliverable:** `docs/audit-2026-09-13/phase-b-read-paths.md`

## Phase C — Per-sport card-sense audit  ← the point of the exercise

Every card on every surface gets exactly one verdict:

| verdict | meaning |
|---|---|
| **fits** | says something true and useful in this sport |
| **port artifact** | inherited from whichever sport was built first; shape or placement is an accident |
| **wrong metric** | right to exist, but showing another sport's stat vocabulary |
| **starved** | right card, right sport, data source too shallow (fed by Phase A) |
| **shouldn't exist here** | no meaning in this sport; should be `null` and not render |

Named suspects going in, all flagged by `CLAUDE.md` §4's own rule: the
sport-named fields on the shared interfaces — `hitterStats`, `nflSeasonStats`,
`golfFormHoles`, `seasonStatsCard`, `roundScores`, `matchup.pitching`. That
section's own history is the reason to be suspicious: **two of its original
three worked examples turned out to be port artifacts, not real differences.**

The test for each, from that same section: *do the sports genuinely differ in
the data, or was one simply ported first?*

Output is organised per sport, so a golf verdict list and an NHL verdict list
sit side by side and "same page, one card differs" becomes checkable rather
than assumed.

**Deliverable:** `docs/audit-2026-09-13/phase-c-card-verdicts.md`, one section
per sport.

## Phase D — Prioritized remediation plan

Grouped **by fix-shape, not by sport.** Finding 1 already suggests a single
shared `player_game_history` read path would clear many "starved" verdicts at
once; that should be sized as one job, not eight. Approved separately before
any code changes.

**Deliverable:** `docs/audit-2026-09-13/phase-d-remediation.md`

---

## Ordering note

Phase A and the static half of Phase C are independent and can interleave.
Phase B must precede the rendered half of Phase C. Phase D is last and
unconditionally requires operator approval before a line of code changes.
