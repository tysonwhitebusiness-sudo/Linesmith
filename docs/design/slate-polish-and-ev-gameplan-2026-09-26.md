# Slate polish, Specials/Spotlights columns, and a "best prices vs fair" card — gameplan (2026-09-26)

From the operator's test of the production build (2026-09-26 ~06:00 UTC).
Nothing here is built yet: per D16, the visual items get 1:1 mockups with real
data first, and are built on the operator's go.

## A. Imagery and icons missing (the approved look has them)

| # | card (file) | what is wrong | proposed |
|---|---|---|---|
| A1 | **Flags today** — game/team page (`components/ResearchFlags.tsx`) | rows are text: no headshot, no team logo | the Slate spotlight row's anatomy (`flagSpotlightCards` already carries `headshotUrl` / `teamLogoUrl`): headshot for a player, the two logos for a game subject |
| A2 | **How the market has moved** (`components/slate/SlateMovers.tsx`) | "TEAM vs TEAM" text | the two team logos + abbreviations, in team colour where the row names a side |
| A3 | **Biggest moves / Dropping odds** (`components/odds/SlateOddsMovers.tsx`) | book names as text; no player image or team logo | `BookLogo` for each book (first mover leads); team logos for game rows; headshot for a prop row |
| A4 | **Line disagreements** (`components/slate/SlateMarket.tsx`) | the market sits under the player name where the other cards put it beside/after | one row anatomy for every Slate prop card: headshot · name · (team logo) · market as a chip on the same line |
| A5 | **Weather games** (`lib/slate/spotlights.ts` `weatherSpotlight`) | not empty (one game: "rain 60%" at Target Field) but a bare line of text | icons (rain / wind with a direction arrow / temperature), the two logos, the value in weight; same data (Open-Meteo) |
| A6 | **Market hub — Best prices** (`components/odds/SlateOddsHub.tsx`) | game column is "NYM @ WSH" text | the two team logos in the game column; also: in-game rows show live prices (−100000, +4900) beside pre-game ones — mark a started game "Live" and dim it, or drop it from the hub |

The logos, headshots and book logos all exist already (`teamColor`, `BookLogo`,
`headshotFor`, ESPN logos) — this is wiring and one shared row anatomy, not new
assets. Weather icons would be inline SVG (the repo loads no icon font).

## B. Specials and Spotlights columns

**What is there now.** Two different treatments:
- **Specials** (`SlateSpecials.tsx`): factor columns use `PercentileCell` (value,
  "Nth pct" in heat colour, a heat bar) — but the **Score** column uses
  `DataTable`'s neutral `bar`: grey, no direction, the same for every row type.
- **Spotlights** (`SlateSpotlights.tsx`): EVERY column uses the neutral `bar`
  (`values[key].bar`), so each is a grey stripe that says "bigger" without saying
  better, worse, or compared with what.
- Row layout: the "TEAM vs TEAM" line (logos) sits left of / under the name
  (the Ohtani screenshot), so the eye lands on logos before the player.

**Proposed rules (one table vocabulary for both tabs):**
1. **A factor with a direction** (higher is better, or lower is better) → the
   `PercentileCell` treatment: value, percentile word in heat ink, heat bar.
   Spotlights gain percentiles from `slate_rankings.factors.percentiles`
   (already stored; the Spotlight cards simply don't read them).
2. **A count or share with no direction** (sample size "12 of 20", books) →
   plain value, no bar.
3. **A rate against a baseline** (hit rate vs season) → value plus a small ▲/▼
   against the baseline, in good/bad ink (the Hit-rate leaders card).
4. **The Score** → a filled ring or a heat-coloured pill (0–100, heat ramp), not
   a grey bar; the rank chip stays.
5. **Row anatomy** (both tabs): headshot · **name** · team logo + opponent logo
   on the SAME line, after the name; market chip; the read line below.
6. **Streaks** → a small W/L dot strip (`ResultMark kind="dot"`) instead of "+4".

Deliverable before any build: a mockup of each tab (every card type, real
data from today's `slate_rankings`) at 1440 and 400.

## C. Why so little edge data shows

Measured at 06:00 UTC on the live job's own evaluation (`market_edge_candidates`):

| | lines |
|---|---|
| market lines evaluated | 6,306 |
| **no Pinnacle two-sided price at that line** (mostly props — Pinnacle quotes few; exchange-only lines) | 4,904 (78%) |
| priced against Pinnacle | 1,402 |
| … best offer negative EV | 1,106 |
| … best offer positive EV | 296 |
| … positive EV AND passing every gate | **0** |

The 296 positive offers all fail one gate:
- **Gate 2, "soft checked N s ago > 3 min"** (the largest): the scraper polls a
  game every 10–30 min until it is inside 24 h (then 3 min, then 1 min inside
  6 h) — so overnight, with every game 12+ h out, no soft price is fresh enough
  to compare with Pinnacle. **Edges appear as games approach.**
- Gate 2, relays whose delay P7 never measured for that book (comparenbet's
  Matchbook, LowVig, bet365…): no measured delay → not trusted.
- Gate 1, props: Pinnacle priced but no second sharp source agrees.

And yes — nearly every price is negative EV (that is the book's margin). Since
2026-09-26 (`2f4a02f`) the Edge card shows it: the best soft price, its EV
(usually negative), the fair price, and which gate fails. That needs one more
worker deploy to be written live (the laptop is writing it until then).

Levers, if more edges should show (operator's call, D3 says only on P13
evidence): S-G3 (poll far-out games more often — the scraper lane item),
measuring relay delays for more books, and the self-check rule (it trips on
2 hot edges out of 27).

## D. A Spotlight card: best prices vs the sharp price, today

**Proposed:** "Best prices vs the sharp fair price" — the day's market lines for
the sport ranked by EV, from `market_edge_candidates` (Python's numbers; the
page ranks, never computes). Each row: game/player, market and line, the book
(logo) and price, fair price, EV, and a status: **EDGE** (passes every gate) or
**not verified: <the failing gate>**.

Choices for the operator:
1. **Which rows:** (a) only rows passing every gate (often none, like tonight),
   (b) the top 10 by EV with the status column (recommended — shows positive EV
   honestly labelled as unverified), or (c) (b) but only gates 1–2 relaxed.
2. **Where:** in the Spotlights section (it refreshes every few minutes, unlike
   the frozen research flags, so it is a card beside them, not a `RankingDef`),
   or as the Market hub's Edges tab widened.
3. The no-edge guard (`tests/scan-no-edge.test.ts`) gains the card's file in its
   allowlist; it reads payload fields only.

## Order proposed

1. Mockups: B (both tabs) and D, plus A1–A6 in the same pass.
2. On the operator's go: A (wiring), B, D.
3. Worker deploy for the candidates writer (already pushed) — independent.
