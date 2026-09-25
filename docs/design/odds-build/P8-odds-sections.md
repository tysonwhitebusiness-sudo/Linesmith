# P8 · The odds sections (UI lane: O1–O4)

**Lane:** TypeScript (the app). **Deploys:** none; this is app code. The
Render deploy rule applies only to Python. **Needs:** P1 (the registries).
O3's periods and ladder need P5. Everything fills in as P6 lands. Operator's
green light per sub-phase (O1, O2, O3, O4).
**Goal:** the approved mockup, built for real on every sport:
`docs/design/odds-rebuild-mockup-2026-09-24.html` and
`docs/design/odds-rebuild/om-mock.js`, D17. **The mockup wins on looks; this
spec wins on where the data comes from.**

---

## The reference implementation

`om-mock.js` (1,160 lines) already computes every number the design shows,
on real data. P8 **ports its functions to TypeScript with tests**, and does
not re-derive them:

| mockup function (om-mock.js) | port to | what it does |
|---|---|---|
| `boardRows` (incl. the D19 outlier rule, 0.6×/1.6× of the median at ≥ 5 books) | `lib/odds/section/board.ts` `boardRows()` | one row per book at the selected line, else its own line; groups D18; your book pinned |
| `bestOf` | `board.ts` `bestPrice()` | best per side, excluding pick'em and outliers |
| `mainLines` / `allLines` | `board.ts` `consensusLine()` / `pricedLines()` | modal main line; every priced line within a span |
| `pinAt` / `pinMain` / `devig` | `lib/odds/section/sharp.ts` | Pinnacle two-sided at a line; no-vig split (`devig_two_way` = multiplicative) |
| hold math in `bestCard` | `lib/odds/section/hold.ts` | hold at one book (median) vs at the best prices; negative hold is a fact (D20) |
| `moveCard` / `drawChart` | `lib/odds/section/movement.ts` | per-book series in a window (2h/6h/12h/48h/open), moves list, first mover, steam |
| `openCard` | `lib/odds/section/openers.ts` | open → now per book; reads `market_openers` (skips `check_flag`) |
| `ladderCard` | `lib/odds/section/ladder.ts` | lines × books matrix, best per line, sharp fair curve |
| `depthCard` | `lib/odds/section/depth.ts` | Pinnacle limit, book count, exchange spread, ladder |
| `coverageCard` | `lib/odds/section/coverage.ts` | markets × book groups; "priced, not shown" list |
| `moneyGame` / `moneyProp` | `lib/odds/section/money.ts` | built here, mounted in P10 |
| `edgeCard` / `edgeEmpty` | `lib/odds/section/edgeView.ts` | built here, **mounted only in P11** (the no-edge rule D6 stands until then) |
| `finalRows` / closing-line table | `lib/odds/section/closing.ts` | the finished-game results + closing-line research |
| `fresh` | `lib/odds/section/freshness.ts` | books · newest check · oldest unchanged · pulled |

All of these are **pure** (no fetch, no React). **Tests read the mockup's
frozen snapshot** (`docs/design/odds-rebuild/om-data.js`, loaded as a
fixture) and assert the numbers the approved mockup shows. The expected
values below are the ones on screen in round 4:

| fixture | expected |
|---|---|
| ATL@GB `fg_sp` at GB −4.5 | best GB side BetMGM −105; Pinnacle −113/+102 two-sided; hold at best is negative (−0.8% with Polymarket +108 on the other side) → reported as a fact |
| London `receptions` 5.5 | Pinnacle −103/−117; fair over 48.5% (tolerance 0.1 pt) |
| London `anytime_td` | FanDuel +2500 and bet365 +475 flagged as outliers (never best) |
| London `rec_yds` | 18 lines priced; consensus 65.5; Pinnacle 66.5 |
| VSiN BetMGM NV opener ATL −2 / 52.5 | shown with `check_flag` (read from `market_openers`) |

The builder confirms each value by opening the mockup at the named tab and
reading it before writing the assertion, and adds the tab reference as a
comment.

---

## Data: three read routes (CLAUDE.md pattern 2 for the live ones)

| route | reads | pattern |
|---|---|---|
| `GET /api/odds/player?sport=&gameId=&subjectId=` | `prop_odds` (every provider) for the player; `prop_odds_history` 10 d for the subject; `prop_odds_pulls`; `market_openers` (kind prop); `market_splits` (pick counts, P10); `exchange_books` for the subject; `source_latency`; `scraper_checks` for the game | **direct reads** (pattern 2): the tables are kept fresh by the P6 bridge and the worker; no per-request trigger, no write |
| `GET /api/odds/game?sport=&gameId=` | `game_lines` (falling back to `game_odds_book_lines` for sources not yet on `game_lines`), `game_lines_history`, `game_line_pulls`, `market_openers` (kind game), `market_splits`, `exchange_books`, `game_reference` (power ratings, P5 amendment), `prop_odds` for the game (the props card), `source_latency`, `scraper_checks` | direct reads |
| `GET /api/odds/slate?sport=&date=` | per game: best ML/sp/tot across books, Pinnacle main, open→now, DK splits, Kalshi 24 h volume, movers, pulls, hold | `cachedRoute()`, key `odds:slate:route:${sport}:${date}` (grep first: no collision), **TTL 60 s**; the build aggregates a whole slate, so every visitor must not pay for it |

- **Payload types:** `lib/odds/section/types.ts`: `OddsQuote`,
  `OddsMarket`, `PlayerOddsPayload`, `GameOddsPayload`, `SlateOddsPayload`.
  They are sport-agnostic. Team colour comes from `teamColor()`
  (`lib/sports/shared/teamColors.ts`). Headshots come from the page's
  existing data.
- **Readers:** `lib/db/oddsRead.ts`. It holds the queries, **server-only**:
  it must not be imported by a client component (the `flagsRead.ts` split
  rule; `tests/client-bundle-boundary.test.ts` covers it).
- **Checked time for a `scraper:*` row** =
  `max(fetched_at, scraper_checks.last_ok_at)` (P6 §6). **Since** =
  `changed_at ?? fetched_at`.
- **Hooks** (in components, never in adapters): `usePlayerOdds`,
  `useGameOdds` and `useSlateOdds` in `components/odds/`. They fetch once
  on mount and on `refreshKey`. P9 adds the 30–60 s refresh.

---

## O1 · Kit primitives and odds components

**Kit additions** (`components/ui/`, exported from `components/ui`). Each
gets a comment naming the page that needed it (the kit rule) and every
state on `/kit`:
- `LiveDot`: `{ checkedAt: string; cadenceS: number; now?: number }` →
  green pulsing / amber / grey by the Revision 4 rule (≤ 2× cadence, ≤ 6×,
  beyond), plus "updated X ago". The pulse animation is disabled under
  `prefers-reduced-motion`. Live ticking and the ping arrive in P9; in O1
  it renders the static state.
- `FlashValue`: `{ value: number | null; format: (v) => string; direction?: 'up'|'down'|null; changedAt?: string }`.
  Renders the number. P9 adds the roll, flash and trail.
- `DataTable` gains `rowState?: (row) => 'pulled' | 'returned' | 'new' | null`
  (strike-through + "Pulled" word for pulled; the animations arrive in P9).
- The chart primitive used by `LineMovementCard` (`components/charts/`)
  gains `liveEdge?: { now: number }` (a "now" guide). The pulse arrives in
  P9.

**Odds components** (`components/odds/`, sport-agnostic, built only from kit
primitives; **no receipt pills**, Revision 4):

| component | mockup section | notes |
|---|---|---|
| `SharpPrices` | O-S | a normal `Card` titled "Sharp prices" + `LiveDot`; tiles: Pinnacle (two prices, fair, no-vig split bar in team colours for sides / neutral pair for totals, rows Checked · Price since / Unchanged for · Limit), Circa (Source row), Exchanges (price, bid–ask, volume); "No Pinnacle price at X" tile with "go to Y" |
| `PriceBoard` | O-A | `DataTable`, groups D18 (Offshore + International collapsed behind "+ N books"), your book pinned; columns Book · side A · side B · Open → now · Checked (· since on desktop); best = the `good` fill; outlier = "⚠ check" word; latency line "⏱ follows Pinnacle by ~N min" from `source_latency` (omitted when n < 30); pick'em rows with payout-implied prices and pick counts; PrizePicks "line only" |
| `BestPrice` | O-B | two tiles + your-book line + "N books within 5¢" + hold meter (D20 text for negative hold) |
| `MarketTabs` | player/game | tab: name · line · O/U best · books · Pin price or "no sharp"; "+ N more" → Coverage |
| `LineStepper` | player/game | shared with the prop block (one state, lifted in `PlayerDetail`) |
| `LineMovement` | O-D | window seg (2h default · 6h · 12h · 48h · Since open), Line/Price seg, presets (Sharp · My book · Most moves · All · Clear), book picker (buttons, the kit's toggle), chart with first-mover markers, "Every move" disclosure table. **Also (2026-09-24 revision):** an optional **consensus line** (the modal main line across books, `mainLines` in `om-mock.js`), toggled like a book; **unselected books drawn as grey context** behind the selected ones (thin, no markers, not in the tooltip); **pulled lines drawn on the chart** (plan L2): a gap from the pull to the return, and a "pulled" tick at the pull, from `prop_odds_pulls` / `game_line_pulls` |
| `OpenNow` | O-F | open → now table + summary sentence; flagged openers shown with "⚠ check", never as the opener |
| `Ladder` | O-G | "All lines" view of the board |
| `Depth` | O-H | three mini stats + exchange order-book ladder |
| `Coverage` | O-K | markets × groups heat cells + "priced by a source, not in the app yet" column list |
| `Freshness` | O-I | the section header subtitle: books · newest check · oldest unchanged · pulled count |
| `GameLineCompact` | player/team | spread/total/ML best per side with book + Pinnacle + link to the game page |
| `GamePropsCard` | game page | filters team / position / market, sort (most books / biggest move / A–Z), views Players · By market · Table, headshots + team colour |
| `ClosingLineResearch`, `PropsResults` | final game | the v3 card: tiles (overs hit, longest price that hit, Pinnacle's favourite side, by-market), filters, Players/Table, result track (hidden < 640 px), ResultMark |
| `EdgeCard` | O-C | built and on `/kit` only; mounted in P11 |
| `MoneyCard` | O-E | built and on `/kit` only; mounted in P10 |

- **Guards** (`tests/odds-ui.test.ts`, new):
  - no file in `components/odds/` imports `Chip` except `GamePropsCard.tsx`
    and `LineMovement.tsx`, whose filter buttons are controls;
  - no raw hex in `components/odds/` (tokens only);
  - no `sport ===` in `components/odds/`;
  - every `components/odds/*.tsx` is rendered on `/kit`.
- **Scroll rule (Revision 2):** every horizontal scroller is
  `overflow-y: hidden`. The guard greps for `overflow-x-auto` without
  `overflow-y-hidden`.

**O1 tests (gate O2):**
- the `lib/odds/section/*.test.ts` fixture tests above;
- `tests/odds-ui.test.ts`;
- `/kit` at 1440 and 400: every new component in every state (loading,
  empty, one book, many books, no sharp, pulled row, outlier row, negative
  hold);
- `npm test`, `tsc` and build green.

---

**`LineMovement` additions (2026-09-24), tested in O1:** the consensus line
equals the modal main line of a fixture; unselected books render as grey
context, not in the tooltip; a fixture pull draws a gap and a "pulled" tick
at `pulled_at` and resumes at `returned_at`.

**D16:** the consensus line, grey context, pulled-line gap and Dropping odds
list come from the master plan (L2, L5) and the operator's 2026-09-24 review.
Any of them the approved mockup does not already draw gets a 1:1 mockup with
real data, approved before it is built.

## O2 · Player page — "Odds & prices"

- `components/PlayerDetail.tsx`:
  - replace `PlayerOddsSection` and the `oddsCards` trio
    (`movement`/`books`/`gameLine`, lines ~1470–1730) with
    `<PlayerOddsSection2 sport gameId={gamePkStr} subjectId teams userBook line onLineChange />`
    in `components/odds/PlayerOddsSection.tsx`, fed by `usePlayerOdds`;
  - the prop analysis block is **unchanged** (standing exception) and
    shares the line (the `lineOffset` state is lifted to where both read
    it);
  - delete the old `PlayerOddsSection.tsx`, `PropOddsPanel.tsx`'s
    `PropOddsBoard` and `LineMovementCard.tsx` once nothing imports them.
    The P1 `gameLine` card becomes `GameLineCompact`.
- **Layout:** exactly the mockup's player surface order:
  1. market tabs;
  2. line stepper;
  3. Sharp prices;
  4. Best price + (Edge slot empty until P11);
  5. Every book (This line / All lines);
  6. Line movement + (Where the money is from P10);
  7. Opening → now + Depth;
  8. Coverage;
  9. Game line.
- **Empty states:** a market with no prices, and no sharp price, each read
  the mockup's honest one-liners.

**O2 tests (gate O3):**
- `tests/player-odds-section.test.tsx` (server-render with fixture
  payloads): the tabs, the board groups, the pinned book, a pulled row and
  an outlier row render;
- render at 1440 and 400 on MLB, NFL, CFB, NBA, NHL, soccer and tennis
  (fresh tab): headshot and logos present, zero scroll traps, matches the
  mockup's player surface.

---

## O3 · Game page — "Lines" (live and final) + team page

- **A new research card kind** (`lib/sports/shared/playerResearchShapes.ts`
  `ResearchCard` union):
  `{ kind: 'odds'; key: string; scope: 'game' | 'game-final' | 'team'; sport: Sport; gameId: string; teams: { home: TeamRef; away: TeamRef } }`.
  - `ResearchCardView` renders it as `<GameOddsSection …/>` /
    `<GameFinalOddsSection …/>` / `<TeamOddsSection …/>` from
    `components/odds/`. Each calls `useGameOdds` itself, since hooks stay
    in components.
  - This is a data-declared difference (CLAUDE.md rule 4), not a sport
    check.
- **Each sport's `*GameResearch.ts`** (mlb, nba, football, nhl, soccer,
  tennis):
  - the `lines` section's `rows` become `[[{ kind: 'odds', scope: final ? 'game-final' : 'game', … }]]`;
  - its old `game-lines` card and props card are removed (the odds
    section's `GamePropsCard` replaces the props card);
  - the section keeps `id: 'lines'` and its nav label.
- **`GameOddsSection` layout** (the mockup's game surface):
  1. period tabs (only the periods the payload has);
  2. market tabs (Spread · Total · Moneyline · team totals);
  3. line stepper;
  4. Sharp prices;
  5. Best price;
  6. Every book / All lines;
  7. Line movement + Where the money is (P10);
  8. Vegas board (Circa + Nevada via VSiN, each with its VSiN opener, "⚠
     check" on flagged openers, power ratings footer from `game_reference`)
     + Depth;
  9. `GamePropsCard`.
- **`GameFinalOddsSection`:** the three result tiles, "Every book at the
  close" (open, close, vs sharp close, opener CLV, run line, total),
  `PropsResults`, moneyline movement, total open → close.
- **Team page** (`teamDetailAdapter.ts` per sport → `toTeamResearchData`):
  - add a section `{ id: 'odds', navLabel: 'Odds', rows: [[{ kind: 'odds', scope: 'team', … }]] }`
    for the team's next game;
  - `TeamOddsSection` = `GameLineCompact` + team total + Line movement +
    "Against the closing number". That last card reads stored closes from
    `game_lines_history` / `game_odds_history` (the last pre-start price per
    book) and results from `game_result`.

**O3 tests (gate O4):**
- `tests/game-research-*.test.ts` (existing) updated: each sport's `lines`
  section holds exactly one `odds` card;
- `tests/game-odds-section.test.tsx` (fixture payload: ATL@GB from
  om-data): period tabs, the GB −4.5 board, flagged opener, power ratings
  footer;
- `tests/final-odds-section.test.tsx` (TOR@BAL fixture): tiles 47/198
  overs, longest price that hit +720, Pinnacle's favourite 11/17;
- render every sport's game page (live and final) and team page at 1440
  and 400.

---

## O4 · Slate — Games cards, Movers, Market hub, Props/Scan

- **Games cards** (`components/slate/GameCard.tsx`) gain the odds block
  from `useSlateOdds`, keyed by game id:
  - best ML per side with book;
  - "Sharp prices" row + `LiveDot` + Pinnacle + two-team no-vig bar;
  - Total (opened X);
  - Moved;
  - labelled rows "DK customers, HOME [split]" and "Kalshi, traded in 24 h";
  - an edge dot only from P11.
  - Live games read "● Live · <state>".
- **Movers** (`SlateMovers.tsx`): "Biggest moves" (steam with first mover;
  moneylines that moved most) and "Pulled lines".
  - **"Dropping odds"** (plan L5, restored 2026-09-24): per market, open →
    current and the % change in implied probability, measured **across
    books** (the median book's move, and how many books moved the same way),
    from `market_openers` and the current prices. Sorted by the size of the
    move; it names no edge and colours nothing by value (the no-edge rule).
  - Pulled-line **alerts** are P12's (O8), not built here.
- **Market hub** (`SlateMarket.tsx`): tabs Edges (P11) · Best prices (games
  × books) · Openers vs now · Pulled · Where the money is (P10) · Lowest hold
  · Line disagreements.
- **Scan** (`components/ScanTable.tsx`, `ScanCard.tsx`): add columns
  **Sharp, Books, Checked, Open → now** and the pulled marker (D22); Edge in
  P11.
  - Update `tests/slate-shell.test.ts`'s content hashes and
    `tests/ui-scope.ts` **in the same commit**, with the reason in the
    commit message (D5/D22).
  - The frozen cell components (`StatCells`, `OddsChip`) stay unchanged.
- **F12 decision (steam / first mover):** keep TypeScript's read-time
  computation (`lib/slate/marketMoves.ts`) unless the `/api/odds/slate`
  build exceeds **2 s** p95 on a full NFL Sunday slate. Measure it and
  record the number here. If it exceeds 2 s, move steam and first mover to a
  Python job writing `market_moves` (a P6 follow-up), and the route reads
  it.

**O4 tests (P8's exit):**
- `tests/slate-odds.test.ts` (fixture: the Sep 24 MLB slate from om-data):
  card numbers, movers order, hub tabs; the **Dropping odds** list's open →
  current and % change from a fixture of openers + current prices, and its
  order;
- `tests/slate-shell.test.ts` green with the new hashes;
- `tests/scan-no-edge.test.ts` still green (no edge yet);
- render the Slate on every sport at 1440 and 400;
- `/api/odds/slate` p95 recorded.

## Background checks

None.

## Files touched (summary)

- New: `lib/odds/section/*` (+ tests), `lib/db/oddsRead.ts`, three API
  routes, `components/odds/*`, `components/ui/LiveDot.tsx`,
  `components/ui/FlashValue.tsx`, the tests named above.
- Edited: `components/ui/DataTable.tsx`, the chart primitive,
  `components/PlayerDetail.tsx`, `components/PlayerResearchSections.tsx`
  (card kind), `lib/sports/shared/playerResearchShapes.ts`, six
  `*GameResearch.ts`, the team adapters, `components/slate/GameCard.tsx`,
  `SlateMovers.tsx`, `SlateMarket.tsx`, `components/ScanTable.tsx`,
  `components/ScanCard.tsx`, `tests/slate-shell.test.ts`,
  `tests/ui-scope.ts`, `app/kit/*`.
- Deleted (after the swap): `components/PlayerOddsSection.tsx`,
  `components/PropOddsPanel.tsx` (board), `components/LineMovementCard.tsx`,
  and each adapter's `game-lines` card builder.

## Changelog

- **2026-09-24 — line-movement additions and L5 restored**
  (`HANDOFF-P0-P4.md` corrections 3 and 4):
  - `LineMovement` gains the optional consensus line, unselected books as
    grey context, and pulled lines drawn on the chart (L2, from `*_pulls`);
  - the L5 "Dropping odds" list returns as an O4 Movers sub-item (open →
    current, % change across books, from `market_openers` + current
    prices). Pulled-line alerts stay in P12.

  Both were in the plan and missing from this spec. The D16 note above
  applies to any piece the approved mockup does not draw.

## Result (2026-09-25, unattended run)

**Built.** O1 (kit primitives, every `lib/odds/section/*` module with fixture
tests on the mockup snapshot, `components/odds/*`, `/kit` odds group), O2
(the player page's Odds & prices, live on MLB), O3 (the game page's `kind:
'odds'` card → `GameOddsSection`; a finished game with its score →
`GameFinalOddsSection`, the closing-line research; the team page →
`TeamOddsSection`), O4 (the Slate's game-card odds block, Movers — Biggest
moves with steam and first mover, moneylines that moved most, Dropping odds,
Pulled lines — the Market hub, and Scan's D22 columns).

Routes: `/api/odds/player`, `/api/odds/game`, `/api/odds/closes`,
`/api/odds/scan` (pattern 2) and `/api/odds/slate` (`cachedRoute`, 60 s, key
`odds:slate:route:{sport}:{date}:{ids hash}` — the Slate sends the ids it
shows, so the hash is in the key).

**F12 — steam and first mover stay at read time.** `/api/odds/slate`'s build
measured on every NFL game with a line (32, a full week — more than one
Sunday), 12 runs from the laptop: p50 1.22 s, p95 3.0 s (the cold-connection
first run; warm max 2.2 s). 75–85% of each build is the six database round
trips (`queryMs` in the payload); the steam detection itself is ~0.3 s. The
2 s bar is crossed by the queries, not by the computation F12 asks about, so
moving steam to a Python `market_moves` job would not move the number; the
route's 60 s cache means a visitor does not pay the build. Recorded as the
F12 answer; revisit if a hosted app measures differently.

**Deviations (recorded, not silent):**
1. The odds section keeps its own line stepper (the prop block's `lineOffset`
   is relative to the candidate line; sharing it is O2 polish).
2. `GamePropsCard` / `PropsResults` are not built: each sport's existing
   props card stays in the `lines` section — it already reads the same
   `prop_odds` and, on a final, grades them against the box score.
3. The old final "Game lines" card stays beside `GameFinalOddsSection`: game
   line history is hot for ten days, and for an older game that card (from
   the paid feeds' longer history) is the only close held (D14).
4. The team card "Against the closing number" reads the consensus close from
   `game_lines_history` (hot 10 days) + `game_lines`; older games read "—".
5. Scan's `ScanCard` (the card view) did not gain the D22 cells; the table
   did. Cells flashing is P9's.
6. The Market hub has Best prices, Openers vs now, Lowest hold and Line
   disagreements; Pulled lives in Movers (one list, not two); Edges is P11's
   and Where the money is P10's.
7. `SlateTeam.abbr` is now set from the matchup ("CHC @ BOS") where it is
   one, for the odds block's tight rows.

**Not yet done in P8:** renders on every sport at 1440 and 400 (MLB Slate at
1440 checked, `results/p8-slate-games-1440.png`; the dev server was slow and
flaky during the run); deleting the old `PlayerOddsSection.tsx` /
`PropOddsBoard` / `LineMovementCard`. `bookLabel("marathon")` is missing from
the registry.
