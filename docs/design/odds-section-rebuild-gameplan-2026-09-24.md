# Odds section rebuild — gameplan (Track O)

**Written 2026-09-24.** Nothing here is built. Do not start a phase without the
operator's go. Parent plan: `scraper-bridge-and-edge-gameplan-2026-09-23.md`
(its decisions D1–D15 apply here, especially D4 edge only where accurate, D6
edge lives in the odds sections and not as the frame of every card, D14 never
discard / freshest / every movement, D15 as many props and game markets as
possible).

**Why:** the app's odds sections were built for 3–9 relayed books refreshed
every 20 min–3 h. After the bridge (B4) they receive ~20 books, a sharp
reference (Pinnacle, Circa, exchanges), minute-level movement with pulls,
openers, splits and edge. The sections have to be rebuilt for that data, and
several are broken today.

---

## 1. Where the odds sections stand today (prod build of `5bb64ad`, 2026-09-24, NFL: ATL @ GB)

| surface | what it shows | problem |
|---|---|---|
| Slate · Games card | spread / total / moneyline | spread and total from **1 book** (DraftKings via ESPN), moneyline 3 books |
| Slate · Movers | "How the market has moved" | 3 props moved; 20-min polling cannot see most moves |
| Slate · Books ("Where the books differ") | price outliers, line disagreements | sound idea, thin data (≤ 9 books, hours old) |
| Slate · Props / Scan | best available, "No Odds — Check Book" | prices **3 h old, some 20 h** (paid feeds' NFL cadence) |
| Game page · Lines | game lines open → close; player props best over/under | game lines are **DraftKings via ESPN only**; other stored books hold football moneylines only (shown as a median); raw market keys shown (`longest-rush`, `kicking-points`) |
| Player page · Prices by market | best over / under per market | every row 3 h old; one best-over has no book name |
| Player page · Line movement | chart | "Only one price on record" — no movement at all |
| Player page · All books | the bookmakers grid | 5 books, all flagged stale; duplicate label (`parx parx`), mixed casing (`bet365`, `fanatics`) |
| Player page · Game line | moneyline + total | **"No game line yet — No book has priced this matchup"** while the game page shows DraftKings' lines for the same game: a bug |

## 2. Principles for the rebuild

1. **One set of odds components, every surface.** A price board, best price,
   edge, line movement, splits and ladder are each built ONCE (kit-level,
   sport-agnostic, data-driven) and rendered on the player, game, team and Slate
   pages — the same rule as the research cards (CLAUDE.md sport-adapter
   architecture). No `sport === 'x'` branches; a sport without a market leaves
   the field unset.
2. **Research first, odds as one section** (standing rule: pages are research,
   not betting). The odds section is its own section on each page; edge lives
   there, never as the frame of other cards.
3. **Every price shows its age and its source.** "12 s", "3 min", "Pinnacle as
   of 13 min ago". Stale is shown, never hidden. Pulled lines are shown as
   pulled, not as silence.
4. **Book groups, always in this order:** Sharp (Pinnacle, Circa) · Exchanges
   (Kalshi, Polymarket, Novig, ProphetX) · US books (DraftKings, FanDuel,
   BetMGM, BetRivers, Caesars, Fanatics, bet365, Hard Rock, …) · Nevada books
   (Westgate, South Point, Wynn, …) · Pick'em (Underdog, Sleeper, PrizePicks).
   The user's own book is pinned and starred.
5. **Edge only where the gates pass** (plan §7). Otherwise the edge slot says
   WHY there is none ("no sharp price at this line"), never a guess.
6. **Freshness is live.** The odds section refreshes itself (30–60 s) while
   open; everything else on the page can stay on its current cadence.
7. **Python computes, TypeScript renders.** Edge, fair prices, openers, pulls,
   splits, latency are Python-written tables; the components read them.

## 3. The components (built once)

### O-A Price board — the bookmakers grid, rebuilt

```
Receiving yards · Drake London                         line  ◀ 65.5 ▶   [All lines]
                     Over            Under          moved      age
SHARP     Pinnacle   -108  ▲         -116          +4 since open  13m (cached)
          Circa      -110            -110                          2m
EXCHANGE  Kalshi     -112 (bid/ask 52/55¢, $4.1k)                  15s
US        ★FanDuel   -106  BEST      -118          ─               40s
          DraftKings -115            -105  BEST    line 64.5 ↓1    1s
          BetMGM     -120            -110          PULLED 4m ago   —
          ...
PICK'EM   Underdog   higher -136 · lower +113                     6m
          Sleeper    over 1.49x (287 of 302 picked over)          1m
Market hold at best prices: 2.1%   ·   17 books   ·   all within 90 s
```

- Rows are books, columns are the two sides at the SELECTED line; a book at a
  different line shows that line in its row (never silently omitted).
- Best price per side marked (fill chip); pulled lines struck through with
  "pulled N min ago"; moved-since-open per row; age per row.
- `[All lines]` switches to the ladder (O-G).
- The line stepper is the SAME control as the prop-analysis stepper (moving
  one moves the other).
- Game markets use the same board with Home/Away or Over/Under columns and
  period tabs (Full game · 1H · 1Q · F5 · periods).

### O-B Best price

```
Best over  -106  FanDuel · 40 s      Best under  -105  DraftKings · 1 s
Your book (FanDuel): best on the over; under -118 is 13 cents worse
3 books within 5 cents · shopping saves 1.4% of hold
```

Short, always correct, one tap to the book (B5 "open at book" links).

### O-C Edge (new)

Renders only when every gate passes (plan §7):

```
EDGE  Over 65.5 at FanDuel -106        +2.3 pts   EV +4.7%
Fair 51.1% (Pinnacle -108/-116, de-vigged — smallest of 4 methods)
Confirmed by Kalshi (52–55¢, $4.1k traded) · Pinnacle as of 13 min ago,
FanDuel unchanged since · pre-game
```

Otherwise a one-line honest empty: "No edge shown — no sharp price at 65.5" /
"sharp and soft prices too far apart in time" / "only one sharp source". A
link opens the edge log entry. The kill switch hides the whole card.

### O-D Line movement, rebuilt (Track L1/L2/L4)

- Windows: 2 h · 6 h · 12 h · 48 h · since open; minute/5-min buckets.
- Lines: the sharp reference (Pinnacle) and the user's book emphasised, every
  other book as context; the consensus price optional.
- Markers: opener, line changes (65.5 → 64.5 annotated, not just price), pulls
  (a gap with a "pulled" tick), steam (3+ books same way within 30 min), the
  first book to move.
- Table in the drill-down: every move with its time, book, from → to.

### O-E Where the money is (Track V3)

```
                 Money %   Bets %    source
DraftKings        80 / 20  85 / 15   DK Network, 3 min ago
Circa             72 / 28  28 / 72   VSiN, 5 min ago     ← money and bets split
ScoresAndOdds     56 / 44  46 / 54   (source unstated)
Exchanges         Kalshi $1.52M traded · Polymarket $652k
Covers picks      19% / 81% of 177 contest picks (picks, not money)
Action Network    58,625 tracked bets
```

Each row labelled by its source; never called "the public" or "sharp money",
never presented as total handle. Props: Sleeper pick counts, Kalshi prop
volume where it exists.

### O-F Opening and closing

"Opened 46.5, now 42.5 (−4) — Pinnacle first to move, 2 h ahead of DraftKings."
Per book open → now. After the game: close per book, and where our fair close
was (research CLV).

### O-G Alternate-line ladder (D15)

Every line any book prices for this market, as a matrix (lines × books) with
the best price per line marked, plus the sharp fair probability curve across
lines where the sharp book prices alternates. Answers "where is the best number
for the line I want", and shows how deep each book's menu is.

### O-H Market depth and limits

Pinnacle's stated limit, exchange bid/ask and size, book count — a quiet
"confidence" strip under the board (it is also what the edge gates use).

### O-I Freshness strip

One line per section: "17 books · newest 1 s · oldest 13 min (Pinnacle,
cached) · 2 pulled". Replaces the scattered "3h ago" tooltips.

## 4. Where it all goes

### Player page — "Odds & prices" section

```
[Market tabs: Receiving yards · Receptions · Longest rec · Anytime TD · +12]
┌ Best price (O-B) ─────────┐ ┌ Edge (O-C) ───────────────┐
└───────────────────────────┘ └───────────────────────────┘
┌ Price board (O-A) — every book, the selected line ──────────────┐
└──────────────────────────────────────────────────────────────────┘
┌ Line movement (O-D) ────────────┐ ┌ Where the money is (O-E) ────┐
└─────────────────────────────────┘ └──────────────────────────────┘
┌ Alternate lines (O-G) — collapsed by default ────────────────────┐
┌ Game line — this player's game: moneyline / spread / total, best + sharp ┐
```

"Prices by market" becomes the market tab row (each tab: best over/under,
book count, age, an edge dot where gated). The prop analysis block above is
unchanged (standing exception) and shares the line stepper.

### Game page — "Lines" section

- Period tabs (Full game · 1H · 2H · 1Q … · F5 · regulation) × markets
  (moneyline, spread, total, team totals, 3-way where the sport has it).
- Per market: Best price + Edge + Price board + Line movement.
- Vegas board: Circa and the Nevada books (VSiN), with each book's opener.
- Where the money is: DraftKings, Circa, ScoresAndOdds splits, exchange
  volume, Covers picks, Action Network bet counts.
- Player props table upgraded: best over/under WITH book, book count, age,
  moved since open, pulled marker, edge dot; market labels from the label map
  (no raw keys).

### Team page

The team's next game's lines (compact board + movement), team totals, and —
from stored closing lines — a record against the closing number (research, not
a pick).

### The Slate — most of the new build lands here

| section | today | rebuilt |
|---|---|---|
| **Games** cards | spread/total from 1 book | consensus line + best price across all books, the sharp line (Pinnacle), moved since open, a money/bets chip (DraftKings), an edge dot where one passes; tap → the game page's Lines |
| **Movers** | 3 moves at 20-min resolution | minute-level: biggest line/price moves, steam flags, first mover, pulled lines as their own list |
| **Books → Market** | price outliers, line disagreements | adds **Edges** (gated, with ages), **Best prices board** (games × books matrix for main lines), **Openers vs now**, **Pulled lines**, **Where the money is** leaders (biggest money-vs-bets splits, exchange volume leaders) |
| **Props** / Scan | best available (hours old) | best available with age and book count; **edge column** (D5 unfreezes Scan for edge only); moved-since-open; pulled marker |
| **Your lines** | tracked lines | alerts: your line moved, a better price appeared elsewhere, your line was pulled |

The master plan's rule "one surface — nothing gets its own page because it is
easier to build there" holds: no separate odds page; the Slate's Market
section is the hub.

### Elsewhere

- **Bet slip**: each leg shows the best book right now and "open at book".
- **Research flags / Spotlights**: odds-derived flags (steam on a player,
  pulled line, big money/bets split) become flags like the others.
- **Alerts** (with Your lines): price and pull alerts.

## 5. Other ideas (for the operator to pick from)

1. **Market hold meter** — the vig at best prices per market ("shopping takes
   hold from 4.5% to 1.1%").
2. **Book latency badges** from T0 ("FanDuel follows Pinnacle by ~4 min on NFL
   props"), shown on the board.
3. **First mover** — which book moved first on each move (steam origin).
4. **Pick'em vs books** — Underdog/Sleeper implied probability beside the
   books'; only as an edge when the gates pass.
5. **Coverage map (D15)** — per player: every market, how many books price it,
   who offers it at all.
6. **Closing-line research** — for finished games, how each line closed vs the
   result, per book (feeds E3 too).
7. **Exchange order book mini** — Kalshi/Polymarket bid/ask depth for a market.

## 6. Data the rebuild needs (and where it comes from)

| need | source | status |
|---|---|---|
| ~20 books, minute-level prices with `observed_at` | bridge B4 → `prop_odds`, `prop_odds_history`, `game_odds_book_lines`, `game_odds_history` | after B0–B2, B4 |
| pulls | B3 in the scraper (done) + line-buddy writer (G8) | B3/B4 |
| openers | Action Network Open, VSiN openers, theoddsgap, first-seen | in the scraper; needs a Supabase table or view (L3) |
| edge | E1: new Python table + log | after B4 + T0 |
| splits / volume | scraper `splits` → a new Supabase table via the bridge (V1–V2) | collected; bridge needed |
| latency | T0.2 table | after B1 |
| book display names, logos, order, deep links | B5 + one book registry (fix `parx parx`, casing) | B5 |
| market labels for every key | B0 label map | B0 |

## 7. Phases

| phase | what | depends on |
|---|---|---|
| **O0** | Fix what is broken now: the player page's "No game line yet"; raw market keys on the game page; book display names (`parx parx`, casing); a best price with no book name | nothing — can run any time |
| **O1** | Build the components (O-A … O-I) on the kit, shown on `/kit` in every state; wire to today's data so they render now | O0 |
| **O2** | Player page odds section rebuild | O1 |
| **O3** | Game page Lines rebuild (periods, Vegas board, props table upgrade) | O1 |
| **O4** | Slate: Games cards, Movers, Market section, Props/Scan columns | O1, B4 for the full data |
| **O5** | Live refresh of the odds sections; freshness strip everywhere | B4 |
| **O6** | Edge card and Scan edge column switched on | E1 + gates, D5/D6 test changes |
| **O7** | Where the money is (V3) and splits on the Slate | V1–V2 via bridge |
| **O8** | Your lines alerts, bet slip best book, odds research flags | O2–O4 |

O0–O3 can start before the bridge: the components render today's thinner
data and fill up as B4 lands. O6 waits for E1. Every phase ends with the
standing checks: render at 1440 and 400 on every sport (a fresh tab), the kit
guards, and `tests/scan-no-edge.test.ts` / `tests/slate-shell.test.ts`
changed only where D5/D6 say.
