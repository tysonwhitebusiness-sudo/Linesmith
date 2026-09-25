# P10 · Where the money is (O7, Track V3)

**Lane:** TypeScript. **Deploys:** none. **Needs:** P5's `market_splits` and
`exchange_books`, filled by P6; P8's `MoneyCard`. Operator's green light.
**Goal:** the approved "Where the money is" cards on the game page, the
player page and the Slate, every row labelled by whose customers or which
exchange it describes. Never "the public", never "sharp money", never total
handle.

---

## Build

### 1. Game lines (game page, `lib/odds/section/money.ts` `gameMoneyRows`)

Rows, in this order, each present only when its source has data for the
selected market (`ml`/`sp`/`tot`, full game):

| row | source (`market_splits`) | shows |
|---|---|---|
| DraftKings customers | `source='dknetwork'`, `book='draftkings'`; else `source='vsin'`, `book='draftkings'` | money % and bets % bars in the two teams' colours (neutral pair for totals), age |
| Circa customers | `source='vsin'`, `book='circa'` | same |
| ScoresAndOdds consensus | `source='sao_consensus'` | same, labelled "source does not say whose bets" |
| Covers contest picks | `source='covers'`, `kind='picks'` | one bar, "picks, not money · N picks" |
| Action Network | `source='actionnetwork'`, `kind='bet_count'` | "N tracked bets on this game (all markets), not split by side" |
| Exchanges | `exchange_books` for the game's ML contracts | Kalshi 24 h volume + open interest; Polymarket 24 h volume + liquidity; "traded, not bets" |

- **"Money and bets split":** when |money % − bets %| ≥ **15** points for a
  row, a line in `warn` ink reads "Money and bets split: X draws N pts more
  of the money than of the bets".
- **The DK money trend:** a sparkline of DraftKings' money % on side A
  across the game's `market_splits` history, "N% (time) → M% now".
- The period and team-total tabs read: "No splits source publishes
  period/team-total splits. Full-game spread, total and moneyline have
  them."

### 2. Props (player page, `propMoneyRows`)

- **Sleeper pick counts** at the selected line: `market_splits` with
  `source='sleeper'`, `kind='pick_counts'`, `subject_id`, `market`, `line`.
  One bar: "Over N (x%) · M (y%) Under", "entries in Sleeper's pick'em —
  counts, not money".
- **Kalshi contracts:** `exchange_books` for the subject and market, as a
  table: contract (N+), yes bid–ask, 24 h volume, open interest.
- **Always:** "Money % / bets % — **No data available.** No source
  publishes money or bet share for player props."

### 3. Slate

- **Game cards** (built in O4) read the same rows: "DK customers, HOME
  [split]" and "Kalshi, traded in 24 h".
- **Market hub → "Where the money is":** games sorted by |DK money % − bets
  %| on home ML, the ≥ 15-point ones in `warn` ink. Footer: "DraftKings
  customers only (DK Network / VSiN). A gap is a fact about DK's customers,
  not a signal."

### 4. Mount

- The game page mounts `MoneyCard` beside Line movement.
- The player page mounts it beside Line movement.
- The hub tab is enabled.

---

## Tests (these gate P11)

| test | kind | what it proves |
|---|---|---|
| `tests/odds-money.test.ts` (new) | TS | ATL@GB fixture from om-data: DK ML 83/68 bets/money on GB (the fixture's values); Circa row present; the 15-point split line appears where the fixture's gap is ≥ 15 and not at 14; props fixture → pick counts bar + Kalshi table + the "No data available" line |
| `tests/odds-ui.test.ts` (extended) | TS guard | no rendered string in `components/odds/MoneyCard.tsx` or `lib/odds/section/money.ts` contains "public", "sharp money" or "handle" (case-insensitive) |
| render | fresh tab | game and player pages on NFL and MLB at 1440 and 400 |

**Exit criteria:** the tests pass and the renders match the mockup.

## Background checks

None.

---

## Result (2026-09-25)

**Built.**
- **Reads** (`lib/db/oddsRead.ts` `readMoney`): three small queries per game
  or player, added to the `/api/odds/game` and `/api/odds/player` payloads
  as `money` (so the card refreshes with P9's 30 s poll, and no new route):
  the newest `market_splits` row per source/book/kind/market/side/line;
  DraftKings Network's side-A history per full-game market (10 days); and
  `exchange_books` for the game's (or player's) contracts. The bridge is the
  only writer of both tables; nothing here writes.
- **Rows** (`lib/odds/section/money.ts`, pure): `gameMoneyRows` in the
  approved order — DraftKings customers (DK Network, else VSiN's DraftKings
  row), Circa customers, ScoresAndOdds consensus ("source does not say whose
  bets"), Covers contest picks ("picks, not money · N picks"), Action Network
  ("N tracked bets on this game (all markets), not split by side"), Exchanges
  (Kalshi 24 h volume + open interest, Polymarket 24 h volume + liquidity,
  "traded, not bets"); `moneySplit` (|money − bets| ≥ 15 → "Money and bets
  split: X draws N pts more of the money than of the bets", warn ink);
  `dkMoneyTrend` (the sparkline, "N% (time) → M% now"); `propMoneyRows`
  (Sleeper pick counts at the line in view, Kalshi's N+ contracts); and
  `slateMoneyGaps` for the hub.
- **Card** (`components/odds/MoneyCard.tsx`): the game view in the two teams'
  colours (`useTeamColors`; the neutral pair for totals), the prop view with
  the Sleeper bar, the Kalshi table and, always, "Money % / bets % — No data
  available. No source publishes money or bet share for player props." Period
  and team-total tabs read the spec's sentence. Its LiveDot is measured
  against DK Network's 480 s (game) or Sleeper's 900 s (prop).
- **Mounted** beside Line movement on the game page and the player page, and
  as the Market hub's "Where the money is" tab (games sorted by |DK money % −
  bets %| on the home moneyline, 15+ in warn ink, the spec's footer). The
  Slate's game cards already read the DK and Kalshi rows (O4).

**Tests:** `tests/odds-money.test.tsx` (7; `.tsx`, not the spec's `.ts`,
because it renders the card) on the mockup's ATL @ GB data: DraftKings
customers 83% of the moneyline bets and 68% of the money on GB (DK Network;
VSiN's DraftKings row is only the fallback), the Circa row, Covers picks on
the spread, the split line at 15 points and not at 14 (rendered), the game
card's named rows / exchanges / DK trend / period sentence, the props card
(Sleeper bar, Kalshi table, "No data available"), a Kalshi contract labelled
`under` read as its yes price, and the hub's sort. `tests/odds-ui.test.ts`
(+1): no "public", "sharp money" or "handle" in `MoneyCard.tsx` or
`money.ts` outside comments. `npm test` and `tsc` green.

**Renders (2026-09-25, headless Chromium on this session's dev server, text
checks at 1440 and 400, one screenshot per surface):**
- NFL game 401872953 (LAC @ BUF), spread: DraftKings customers (DK Network,
  BUF 78% money / 82% bets), Circa customers with **"Money and bets split:
  BUF draws 15 pts more of the money than of the bets"**, ScoresAndOdds
  consensus, Covers (896 picks), Action Network (26,182 tracked bets), the DK
  trend 93% → 78%. `results/p10-money-game-1440.png`.
- MLB game 822760 (CIN @ TOR), spread: DK split 41 pts, SAO split 34 pts,
  Action Network, **Exchanges: Kalshi moneyline $25k 24h · $25k open
  interest**, DK trend 50% → 57%.
- NFL player 3043078 (Henry), rushing yards: Kalshi ladder 50+ … 120+, "Sleeper
  pick counts: no data available for this market at this line", the standing
  "No data available" line.
- MLB player 656941: Sleeper pick counts at 0.5 (Over 31, 89% · 4, 11% Under),
  Kalshi 1+/2+/3+, the standing line. `results/p10-money-player-1440.png`.
- The Slate (MLB): Market hub → Where the money is, 15 games sorted by the
  gap, seven flagged "split", the footer; the same at 400.
- Every page: no horizontal overflow at 1440 or 400; no page errors.

**Found and fixed in the render:** Kalshi prop contracts the bridge labels
`under` carry the YES price (Henry's 60+ read 77–78¢ between 50+ at 84–86¢
and 70+ at 68–69¢); the first build inverted them. Now read as stored.

**Deviations:**
1. The splits ride on the existing `/api/odds/game` and `/api/odds/player`
   payloads (`money`), not a new route, so they refresh with P9's poll (the
   game page's light refresh includes them).
2. No mockup footer line naming the banned words: the guard forbids the words
   themselves, so the card's caption says what each source sees instead.
3. MLB player 665489's page makes no `/api/odds/player` request (its odds
   section never gets a game id) — P8 behaviour for that page, recorded as a
   follow-up, not changed here.

**Follow-ups (not P10 blockers):**
- The bridge writes some Kalshi prop contracts with `side = 'under'` while
  the prices are the yes side (`exchange_books`); P8's `SharpPrices` nearest
  Kalshi line and the board's Kalshi quotes may read those as unders. A P6
  bridge fix (label every N+ contract `over`) is the cause-level fix.
- A player page renders "No prices posted" for a moment before its game id
  resolves (the hook has no URL yet, so it is not "loading"); P8 behaviour.

**P10: CLOSED** (2026-09-25). Nothing needs a deploy (TypeScript only).

