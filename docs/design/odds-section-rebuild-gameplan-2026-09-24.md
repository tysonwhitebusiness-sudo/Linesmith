# Odds section rebuild — gameplan (Track O)

**Written 2026-09-24; revised the same day with the operator's answers.**
Nothing here is built. **No UI is built before 1:1 detailed mockups with real
data are approved by the operator (D16, phase OM)** — this plan is not
approved until those mockups are. Parent plan: `scraper-bridge-and-edge-gameplan-2026-09-23.md`
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
   there, never as the frame of other cards. **But the odds section itself is
   built in depth, with as much detail as the data allows — researching lines
   IS research** (operator, 2026-09-24). It works as its own part of the app,
   not a thin appendix to the stat cards.
3. **The sharp price is very visible wherever one exists** (operator,
   2026-09-24). Pinnacle (props and game lines), Circa (game lines) and the
   exchanges are shown as their own highlighted "Sharp" strip at the top of
   every board, as a column on Scan, on every Slate game card and in every
   market tab: the sharp price, its no-vig fair probability, and its age
   ("Pinnacle -108 / -116 · fair 51.1% · 13 min"). Where there is no sharp
   price the strip says so ("No sharp price at this line") — never hidden, so
   the reader always knows whether one exists.
4. **Every price shows its age and its source.** "12 s", "3 min", "Pinnacle as
   of 13 min ago". Stale is shown, never hidden. Pulled lines are shown as
   pulled, not as silence.
5. **Book groups, always in this order:** Sharp (Pinnacle, Circa) · Exchanges
   (Kalshi, Polymarket, Novig, ProphetX) · US books (DraftKings, FanDuel,
   BetMGM, BetRivers, Caesars, Fanatics, bet365, Hard Rock, …) · Nevada books
   (Westgate, South Point, Wynn, …) · Pick'em (Underdog, Sleeper, PrizePicks).
   The user's own book is pinned and starred.
6. **Edge only where the gates pass** (plan §7). Otherwise the edge slot says
   WHY there is none ("no sharp price at this line"), never a guess.
7. **Freshness is live.** The odds section refreshes itself (30–60 s) while
   open; everything else on the page can stay on its current cadence.
8. **Python computes, TypeScript renders.** Edge, fair prices, openers, pulls,
   splits, latency are Python-written tables; the components read them.

## 3. The components (built once)

### O-S Sharp strip (operator: the sharp price very visible)

A highlighted band that heads every board and appears compact everywhere a
price does:

```
SHARP  Pinnacle -108 / -116  fair 51.1% / 48.9%  13 min (cached)  limit $500
       Kalshi 52–55¢ ($4.1k)  · Circa (game lines) -110 / -110  2 min
```

Compact forms: a "Sharp" column on Scan and the props tables, a sharp line on
every Slate game card, a sharp price in each market tab. Missing sharp price:
"No sharp price at this line" in the same place.

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
- **Latency badges** (approved idea 2, from T0): a small tag on a book's row —
  "follows Pinnacle by ~4 min on NFL props" — measured, not assumed.
- **Pick'em rows** (approved idea 4): Underdog and Sleeper payouts converted to
  implied probability beside the books' — shown as a price, and as an EDGE only
  when the gates pass.
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

**Market hold meter** (approved idea 1): "Hold at one book 4.5% · at the best
prices 1.1%" — the vig at best prices per market, beside the best price and
on the Slate's Market hub (lowest-hold markets).

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
- **Book picker (operator):** choose any books to draw — one, several or all.
  Chips per book with its move count ("DraftKings · 6 moves"), presets
  (Sharp · My book · Most moves · All), each selected book in its own colour
  with a legend; unselected books can stay as grey context or be hidden. The
  sharp line is selected by default and drawn heaviest.
- The consensus price optional.
- Markers: opener, line changes (65.5 → 64.5 annotated, not just price), pulls
  (a gap with a "pulled" tick), steam (3+ books same way within 30 min), and
  the **first mover** (approved idea 3): which book moved first on each move,
  marked on the chart and named in the move table ("Pinnacle moved first; 5
  books followed within 9 min").
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

### O-F Opening and closing, and closing-line research (approved idea 6)

"Opened 46.5, now 42.5 (−4) — Pinnacle first to move, 2 h ahead of DraftKings."
Per book open → now. After the game: **close per book against the result**
(which side covered, how far the line moved toward it), the sharp close vs
each book's close, and where our fair close was (research CLV; the same data
feeds E3). On finished games' pages and on the team page (a team's record
against the closing number).

### O-G Alternate-line ladder (D15)

Every line any book prices for this market, as a matrix (lines × books) with
the best price per line marked, plus the sharp fair probability curve across
lines where the sharp book prices alternates. Answers "where is the best number
for the line I want", and shows how deep each book's menu is.

### O-H Market depth, limits and the exchange order book (approved idea 7)

Pinnacle's stated limit, exchange bid/ask and size, book count — a quiet
"confidence" strip under the board (it is also what the edge gates use).
Expanding it shows an **exchange order book mini** for Kalshi / Polymarket:
the bid and ask ladders with sizes, traded volume, and open interest.

### O-K Coverage map (approved idea 5, D15)

Per player (and per game): every market any source prices, how many books
price each one, which books offer it at all, and which lines exist — a grid
of markets × book groups. Shows where the menu is deep, where one book is
alone, and what the app does not collect yet (feeds §4d G7).

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

## 5. Operator's answers (2026-09-24)

All seven ideas approved and wired into the components above: market hold
meter (O-B, Slate Market), book latency badges (O-A, from T0), first mover
(O-D, O-F, Slate Movers), pick'em vs books (O-A rows; O-C only when gated),
coverage map (O-K), closing-line research (O-F, finished games, team page),
exchange order book mini (O-H). Also: the sharp price very visible (O-S, §2.3);
line movement with a book picker (O-D); the odds section built in depth
(§2.2).

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

**The mockup-first rule (D16).** No UI is built until the operator has
approved 1:1 detailed mockups — the real page layouts, at desktop and phone
widths, filled with REAL data (a frozen snapshot of tonight's games from the
scraper and the app) — and changes are made on the mockups, not in the build.

| phase | what | depends on |
|---|---|---|
| **OM** | **1:1 detailed mockups with real data**: the player page odds section, the game page Lines, the Slate (Games cards, Movers, Market hub, Props/Scan columns), phone widths; interactive where the design is (market tabs, line stepper, book picker, period tabs, All lines). Operator reviews, changes are made on the mockups, then approves — and only then is this plan approved | nothing |
| **O0** | Fix what is broken now (bug fixes that do not change the design): the player page's "No game line yet"; raw market keys on the game page; book display names (`parx parx`, casing); a best price with no book name | nothing — can run any time |
| **O1** | Build the approved components (O-S, O-A … O-K) on the kit, shown on `/kit` in every state; wire to today's data so they render now | O0 |
| **O2** | Player page odds section rebuild | O1 |
| **O3** | Game page Lines rebuild (periods, Vegas board, props table upgrade) | O1 |
| **O4** | Slate: Games cards, Movers, Market section, Props/Scan columns | O1, B4 for the full data |
| **O5** | Live refresh of the odds sections; freshness strip everywhere | B4 |
| **O6** | Edge card and Scan edge column switched on | E1 + gates, D5/D6 test changes |
| **O7** | Where the money is (V3) and splits on the Slate | V1–V2 via bridge |
| **O8** | Your lines alerts, bet slip best book, odds research flags | O2–O4 |

After OM is approved, O0–O3 can start before the bridge: the components render today's thinner
data and fill up as B4 lands. O6 waits for E1. Every phase ends with the
standing checks: render at 1440 and 400 on every sport (a fresh tab), the kit
guards, and `tests/scan-no-edge.test.ts` / `tests/slate-shell.test.ts`
changed only where D5/D6 say.
