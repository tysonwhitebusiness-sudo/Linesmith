# Odds section rebuild — gameplan (Track O)

**STATUS 2026-09-24: phase OM APPROVED by the operator** after four review
rounds (`ac3d691`, `3834601`, `3ae2f50`, `3b2401e`).
`docs/design/odds-rebuild-mockup-2026-09-24.html` (serve with `design-mockups`,
:8125) is now the visual target for O1–O8. The mockup wins on looks; this plan
wins on where the data comes from. The §8 questions are answered: parent plan
D17–D23, and below in §5. O0–O8 are in the parent plan's §3 build list
(Lane O). **Each phase still needs the operator's go**, and the next step is
a re-audit of both plans before the detailed build phases are written.

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

**Mockup answers (operator, 2026-09-24; parent plan D18–D23):**

| question (§8) | answer |
|---|---|
| Offshore + International book groups, collapsed behind "+ N books" | Yes (D18) |
| Extra Scan columns beyond Edge (Sharp, Books, Checked, Open → now, pulled) | Yes, "we have the space" (D22); Scan cells flash too |
| Outlier "check" rule | Yes (D19) |
| Negative hold shown as a fact, never an opportunity | Yes (D20) |
| Openers = first seen; Nevada from VSiN's OPEN row; sanity check | Yes (D21) |
| Checked vs since; gates use since | Built into the approved design (D23) |

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

**Mockup data rule (operator, 2026-09-24).** Mockups may use EXAMPLE values,
but every field shown must be data we actually collect today — no invented
data types. What that means for OM (checked against the scraper DB the same
day):

| component | we have it | mockup shows |
|---|---|---|
| Prices from ~20 books, alternates, sharp strip (Pinnacle props + game lines; Circa game lines), hold meter, best price, coverage map | yes | as designed |
| Line movement, first mover, pulls, openers | yes (scraper history since 09-22/24) | as designed |
| Where the money is — GAME lines: DraftKings and Circa % money / % bets, ScoresAndOdds, Covers picks, Action Network bet counts, Kalshi/Polymarket volume | yes | as designed |
| Where the money is — PROPS | only Sleeper pick counts and Kalshi's volume on its own prop markets | only those two; no money/bets % on props |
| Exchange order book | top 10 levels each side since 2026-09-24 12:45 PM ET (odds-scraper `5533251`; Kalshi batch order books, Polymarket bids/asks), stored on each contract's next change | the ladder, with its contract and "price since" |
| Latency badges | raw data yes; T0 not run | example values computed the T0 way |
| Edge | the inputs yes; E1 not built | example values from real-shaped prices, gates applied by hand |
| Circa on props | no (VSiN has no props; ~6 relayed prices) | not shown on props |
| PrizePicks | lines only, relayed by comparenbet (no price) | a pick'em row marked "line only" |

| phase | what | depends on |
|---|---|---|
| **OM** | ✅ **APPROVED 2026-09-24.** 1:1 detailed mockups with real data: the player page odds section, the game page Lines (live and final), the team page, the Slate (Games cards, Movers, Market hub, Props/Scan columns), alerts / slip / flags, desktop and phone, interactive, with the live layer replaying real recorded history | — |
| **O0** | Fix what is broken now (bug fixes that do not change the design): the player page's "No game line yet"; raw market keys on the game page; book display names (`parx parx`, casing); a best price with no book name | nothing — can run any time (B0's registry makes the names fix permanent) |
| **O1** | Build the approved components (O-S, O-A … O-K) on the kit, **plus the live pieces from Revision 4** (`LiveDot`, `FlashValue`, `DataTable` row states for pulled / returned / new, a chart "live edge"), shown on `/kit` in every state; wire to today's data so they render now. No receipt pills (Revision 4) | O0 |
| **O2** | Player page odds section rebuild | O1 |
| **O3** | Game page Lines rebuild (periods, Vegas board, props table upgrade) | O1 |
| **O4** | Slate: Games cards, Movers, Market section, Props/Scan columns (Sharp, Books, Checked, Open → now, pulled; D22 — update the Scan hash and `ui-scope.ts` here, deliberately) | O1, B4 for the full data |
| **O5** | Live refresh of the odds sections (30–60 s); freshness strip + heartbeat everywhere; the live layer switched on (flashes, trails, pulls, "since you opened", tab counts), with the noise rules of Revision 4 | B4 |
| **O6** | Edge card and Scan edge column switched on | E1 + gates, D5/D6 test changes |
| **O7** | Where the money is (V3) and splits on the Slate | V1–V2 via bridge |
| **O8** | Your lines alerts, bet slip best book, odds research flags | O2–O4 |

After OM is approved, O0–O3 can start before the bridge: the components render today's thinner
data and fill up as B4 lands. O6 waits for E1. Every phase ends with the
standing checks: render at 1440 and 400 on every sport (a fresh tab), the kit
guards, and `tests/scan-no-edge.test.ts` / `tests/slate-shell.test.ts`
changed only where D5/D6 say.

## 8. What the OM mockups surfaced (all answered 2026-09-24 — see §5 and parent D17–D23)

Built 2026-09-24 on a frozen snapshot (1:18 PM ET): ATL @ GB and Drake London
props for the player, game and team pages; the 12-game MLB slate for the
Slate; TOR @ BAL (Sep 23, BAL 4–2) for the finished-game page. Files:
`odds-rebuild-mockup-2026-09-24.html`, `odds-rebuild/om-data.js` (data),
`odds-rebuild/om-mock.js` (renderer), `odds-rebuild/tools/` (extract + build;
re-run against the scraper DB to refresh the snapshot).

Decisions the mockups need from the operator:

1. **Two book groups the plan did not have**: *Offshore* (Bovada, BetOnline,
   MyBookie, Bookmaker, LowVig …) and *International* (~30 books relayed by
   comparenbet: Unibet, Ladbrokes, Betsson …). Shown after Nevada, collapsed
   behind a "+ N books" button by default.
2. **Scan columns.** D5 unfreezes Scan for Edge only; the mockup also adds
   Sharp, Books, Checked, Open → now and the pulled marker (highlighted in the
   mockup). Those need a yes to join the frozen table.
3. **An outlier rule** (the mockup's "check" chip): a price whose implied
   probability is < 0.6× or > 1.6× the median at that line is kept and shown
   but never used as "best". Found on real data: FanDuel/bet365 anytime-TD
   prices of +2500/+475 against Pinnacle +615/+193 — a different market
   relayed under the same key. It is edge gate 8's job for the board too.
4. **Negative hold at best prices** (ATL @ GB spread: −0.8%, BetMGM −105 +
   Polymarket +108) is shown as a fact, never labelled an opportunity. Confirm.
5. **Two times per price**: "checked" (we confirmed it) and "since" (when it
   last changed). The data has both; the board shows both.
6. **Openers are "first seen"** (scraper history starts Sep 22) except the
   Nevada books, which use VSiN's OPEN row. One VSiN opener is wrong (BetMGM
   NV ATL −2, 52.5): the bridge needs an opener sanity check; the mockup shows
   it with a "check" chip rather than hiding it.
7. **Real edges found while building** (gates applied by hand): GB −4.5 at
   BetMGM −105 vs Pinnacle −113/+102 (EV +1.0%, three sources agree), and
   London receptions 5.5 over at Underdog (implied +110) vs Pinnacle
   −103/−117 with Novig agreeing (EV +1.8%). Both are small, as the plan
   predicts. The same scan found 85–250% "edges" on anytime TD — all market
   mismatches, which is what gate 8 exists for.
8. **Relay staleness.** comparenbet re-confirms every few seconds, but some
   of its books' prices have not changed in 11+ hours (Circa, Kalshi ML via
   comparenbet). "Checked 9 s ago · since 2:25 AM" makes that visible; the edge
   gates must use "since", not "checked", for relayed books.

### Revision 2 (operator review, 2026-09-24)

- **No dark backgrounds** for the sharp strip or the Slate cards' sharp row.
  The strip is now light: one tile per sharp source (Pinnacle, Circa,
  exchanges) with the two-sided price, the fair price and a no-vig split bar;
  the Slate card row is a light green band with the split in both teams'
  colours.
- **Edge card made visual**: status badge + EV as the headline, a probability
  ruler (book-implied vs fair, gap filled green or red), three stat tiles,
  evidence chips (sources with logos and ages), gates as green/red pills. The
  no-sharp state offers a one-tap "compare at Pinnacle's line".
- **Where the money is** bars use the two teams' colours (with logos) on
  spread and moneyline; totals keep the neutral pair.
- **Game page player props rebuilt** as a filterable card: team, position,
  market chips, sort (most books / biggest move / A–Z), three views (Players,
  By market, Table). 46 players, one label map over ~110 source spellings of 16
  markets (`tools/om_extract_props.py`, `STAT_MAP` — the seed for B0).
- **Headshots and team logos are required** in the final build wherever they
  appear today; the mockup now shows ESPN's real images on every page header,
  the props card and the Slate's pitcher rows.
- **Scrolling**: every horizontal scroller (`overflow-x:auto`) was also a
  vertical scroll container, which can latch a wheel/trackpad gesture over a
  table. All are now `overflow-y:hidden`; checked: zero vertical scroll traps
  on every surface at both widths. The build must follow the same rule.

### Revision 4 (operator review, 2026-09-24): live feel, no receipt pills

- **No pills as receipts on any card.** Receipts are labelled rows (label
  left, value right, small logo), mini stats, a gate checklist, or a sentence.
  Status inside a row is a word in its ink colour ("Pulled", "check", "Steam").
  Filter controls and ResultMark stay as they are.
- **"Sharp prices" is an ordinary card header** with a live dot and
  "updated X ago", on the strip and on the Slate cards. No green structural
  bar.
- **Anything that updates looks live.** The operator chose all 12 ideas;
  flash and row-tint merged into one change trail:
  1. **Live dot** in each card header, driven by the source's real poll
     interval: green and pulsing while the newest reading is within 2× the
     interval, amber when later, grey ("no update in N") when well past it.
     It pings when the card's data changes. It follows the time we last
     *checked*, and the prices in the card show *since*.
  2. **Ages tick** every second.
  3. **Change trail**: the value rolls to its new number with a flash in the
     chosen Electric Turf fills, **green = the number went up, red = it went
     down** (for a price, up means it pays more). A ▲/▼ with its age then
     fades over 2 minutes.
  4. **Pulls** flash red and strike through ("pulled N s ago"), and fade back
     in if the book returns.
  5. **Chart**: a "now" guide, the newest point of each series pulses, and a
     new point pops in. A finished game's chart has none of this.
  6. **Bars** (split bars, depth ladders, money %) slide to their new widths.
  7. **Edge**: "passing for N min" timer, and the card folds open or shut as
     the gates change.
  8. **New rows** (moves, first movers, steam) slide in marked "just now".
  9. **Heartbeat** in the section header: price changes per minute over the
     last 30 min, across every book.
  10. **Market tabs** count changes you have not looked at ("3 new").
  11. **"N prices changed since you opened this"**, which outlines them when
      clicked.
- **The Scan table flashes too** (operator: yes). This extends D5 beyond the
  Edge column to cell animation on the frozen table, so O4/O6 update
  `tests/slate-shell.test.ts`'s content hash deliberately for it.
- **Noise rules for the build:**
  - Only de-flapped changes flash.
  - Cap the flashes per refresh; rows are still tinted.
  - `prefers-reduced-motion` gets static ▲/▼ and ages, with no pulsing or
    rolling.
  - Animations pause in a hidden tab.
  - Re-render without replacing unchanged nodes (keyed rows), so images,
    scroll positions and transitions survive.
- **Kit pieces this implies (O1):** `LiveDot` (state from cadence + last
  check), `FlashValue` (roll + flash + trail), a `DataTable` row-state
  animation (pulled / returned / new), and a chart "live edge". Each shown on
  `/kit` in every state, per the kit rule.
- **The mockup proves it on real data.** A replay of the last recorded hour
  (minute-level history, ~1,340 changes across the MLB slate) plays at
  1–60×, then runs at 1× past the snapshot so staleness shows.
