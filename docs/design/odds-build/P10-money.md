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
