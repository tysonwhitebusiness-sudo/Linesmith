# Phase F2 — UX and interaction

**Status: COMPLETE 2026-09-14. Proposal only; nothing changed.** Companion to
`F2-visual-system.md`; same evidence (`F2-raw/`).

**The interaction target is two tiers** (decision 6, reconfirmed by the operator
2026-09-14):
- **Tier 1, every card:** hover detail, linked names and logos, scope toggles,
  keyboard focus.
- **Tier 2, where it adds real insight:** drill-down panels and compare mode.

---

## Summary

1. **Most of the page is inert.** **65% of cards contain nothing clickable.**
   Hovering a card changes nothing on 92% of cards; hovering a chart shows
   anything on 27%. Only 39% of charts have any hover handler, and the codebase
   has 7 hover handlers in total.
2. **Names don't go anywhere.** The three shared page components contain one
   `<Link>` between them; 68% of photos and logos aren't inside a link or button.
3. **Loading is a blank wait.** The MLB game page shows **nothing for 8.2s** and
   then empty card shells for ~4s; the soccer player page is blank for 6.7s; the
   NFL player page at phone width for 4.1s. None of those shows a skeleton.
4. **Long single-column pages with no way to navigate them:** 16–23 cards, no
   section navigation, and the same content repeated (Phase F).
5. **Keyboard users get browser defaults only:** 267 of 300 focus stops use the
   default `auto` outline; zero designed focus styles. 43% of text fails
   contrast (visual system §2).
6. **Phones:** every probed page overflows sideways (431px, and 570px on the
   soccer team page, in a 400px screen); text down to 8px.
7. **The live game experience is a wall.** A repeated score block, a full box
   score, a 30-row team stat table, all expanded. **The ESPN feed the app already
   calls carries win probability for every play and the current drive with yard
   lines, and the parser discards both.**

---

## 1. Page structure

### Measured

| page | cards | shape today |
|---|---|---|
| MLB hitter | 23 | main column + narrow rail, one long scroll |
| NFL player | 17–18 | same |
| Soccer player | 19 | same |
| NFL / MLB game | 16 | hero, live panel, then 14 cards and a props rail |
| Team pages | 16–17 | hero, line picker, chart, then 13–14 cards |

### Proposed

- **Sticky section navigation** under the hero on every long page:
  - **Player:** Overview · Stats · Trends · Splits · Advanced · Matchup · Game log · Odds
  - **Team:** Overview · Stats · Results · Splits · Roster · Schedule · Odds
  - **Game:** Summary · Matchup · Lineups & injuries · Box score · Play-by-play · Odds.
    During a live game it opens on **Live**; after the final whistle on **Box score**.
- **Above the fold** (1440×1000): identity and state, the 4–6 headline stats with
  scope, and the next or live game. On phones the same, stacked.
- **One home per fact.** Phase F's duplicates collapse into single cards, which
  shortens every page by roughly a third before anything is added.
- **Rail:** contextual and sticky: next game, injuries, odds summary. Not a second
  place for stats.

## 2. Navigation and flow

### Measured

- `<Link>` elements in the shared page components: 0 in `PlayerDetail`, 1 in
  `TeamDetail`, 0 in `GameDetail`. Some navigation uses `onClick` handlers,
  which can't be opened in a new tab or copied as links.
- 1,258 images in cards; 398 (32%) sit inside a link or button.
- The back control reads "← Back" on player pages and "← Scan" on game pages.
- Phase 1d: past-game pages say "Game not found" because the page looks games up
  in today's strip.

### Proposed

- **Every player name, team name, logo and photo is a real link**
  (open-in-new-tab works), everywhere: rosters, game logs, box scores, injuries,
  standings, matchups.
- **Cross-links always present:** player → team, next game, last game; team →
  roster players, games; game → both teams, every player in the box score.
- **URL holds state:** scope, tab, selected market and compare target live in the
  query string, so a link reproduces exactly what was on screen (partly done
  already via `?player=&market=`).
- **Breadcrumb-style back** that names where it goes ("← Cowboys", "← NFL
  games").

## 3. States

### Measured

| state | what happens today |
|---|---|
| **Loading** | MLB game page: blank 8.2s, then empty shells ~4s. Soccer player: blank 6.7s. NFL player (phone): blank 4.1s. Skeletons only on NFL/soccer/tennis game pages. |
| **Empty** | 7 of 22 player captures render one sentence (Phase E). NBA/NHL headers show `0-0 · 0th seed` in the offseason. |
| **Error** | Raw API text: "Limit is 60 per 60s for this route. HTTP 429" and a false "No teams match" (D5). |
| **Stuck** | "Loading live details…" forever on final CFB and NHL games (F-B10). |
| **Stale** | Prices marked "4d ago"; pregame prices shown hours after full time. |
| **Past game** | "Game not found" (build 1d). |

### Proposed

- **Skeleton on first paint, always,** shaped like the content, within 100ms.
  Load each section independently, so one slow source doesn't blank the page.
- **Empty states explain themselves** and offer the nearest real data: "2026-27
  starts Oct 21 · showing 2025-26", "No props today · full profile below".
- **Error states** are human ("Couldn't load team stats · Retry"), never API text;
  cached data stays on screen with a "last updated" note.
- **Staleness** is a quiet badge with a timestamp, not colored text per price.
- **A final game never shows a live loading state.**

## 4. Responsive

### Measured

- Phone width (400px): NFL player 431px wide, NFL game 431px, **soccer team
  570px**; the games strip and wide tables push the page sideways. Smallest text
  8px.

### Proposed

- **Breakpoints:** 400 (phone) · 768 (tablet) · 1024 · 1440.
- **Phones:** the games strip scrolls inside its own container; tables scroll
  horizontally inside the card with a sticky first column; the rail stacks below
  the main content; section nav becomes a horizontal scroller.
- **Nothing wider than the viewport,** checked per page at 400px as part of
  every future phase's verification.

## 5. Accessibility

### Measured

- 43% of text fails AA contrast.
- Focus: browser default outline on 267 of 300 stops, no designed focus style.
- `role="tab"` once; `aria-pressed` 27; `aria-selected` 5.
- Native `title` tooltips (97 in source), unreachable by keyboard or touch.
- Reduced motion referenced 10 times.

### Proposed

- 0 AA failures (visual system §2 rules).
- One visible focus style (2px ring, offset, `ink`) on every interactive element.
- Real tabs, toggle buttons and dialogs with the right roles.
- Styled `Tooltip` reachable on focus and tap.
- Reduced motion honored by every motion token.

---

## 6. Interaction inventory and target

### Measured (hover probe, 12 pages)

| target | probes | anything changed | new content appeared |
|---|---|---|---|
| Whole card | 200 | 15 (8%) | 15 |
| Controls (buttons, tabs, links) | 179 | 97 (54%) | 0 |
| Charts | 51 | 14 (27%) | 14 |

- **Cards where nothing responded to hover at all: 138 of 200.**
- **Cards with zero clickable elements: 129 of 200 (65%).**
- Charts with any hover handler: 15 of 38.

### Target per card type

| card type (examples) | today | Tier 1 (every card) | Tier 2 (where it adds insight) |
|---|---|---|---|
| **Hero** (player / team / game) | static; one toggle on some | links to team, next game; hover on record shows splits; live score updates with a tween | follow / compare this player with another |
| **Stat-over-time chart** (bar chart, rolling form) | static bars; some hover | hover any bar: date, opponent, full stat line, result; scope toggle; stat picker | click a game to open its box score in a panel; overlay a second player; line overlay on/off |
| **Season / advanced stats** (hitter stats, season stats, team stats) | static rows | hover a stat: definition, league average, rank context; scope toggle | click a stat to open its **trend + splits drill-down**; compare mode against another player/team |
| **Percentile profile** (where this sits) | static curve | hover a bar: value, rank, pool definition | switch peer pool (position, league, qualified) |
| **Splits** (home/away, platoon, surface) | static grid | hover a cell: sample size and raw numbers; scope toggle | pick the split dimension and stat |
| **Spatial maps** (zone, target map, shot map) | static grid | hover a zone: count, rate, result mix | filter by season, pitch type / shot type / game; compare with opponent's map |
| **Matchup** (two-sided) | tabs; static rows | hover a pairing: both numbers and ranks explained; links to both sides | swap the comparison unit (pass D vs WR, bullpen vs lineup) |
| **Game log / results** | static rows | rows link to the game; sortable columns; season grouping | expand a row inline to the full box line; filter by opponent / venue / result |
| **Roster / injuries / standings / box score** | mostly static | every name links; sortable; status tooltips | filter by position/unit; depth-chart view |
| **Odds section** (prices, movement) | mixed | hover a price: book, time, movement since open; styled tooltip on line movement | expand full book table; movement chart with book toggles; track a line |
| **Live panel** | mostly static, values swap without motion | values tween and flash on change; last play readable | see section 7 |

**Shared interactions across the page:**
- **Crosshair sync:** hovering a game in one chart highlights the same game in
  every chart and in the game log (`useChartCrosshair` exists; used by 5 files).
- **One scope control per page section,** so changing "2025 → 2026" updates every
  card in it together.
- **Compare mode:** pick a second player/team; every card that can show two
  subjects does.

## 7. The live game experience

Operator reference, 2026-09-14: ESPN's NFL game page
(`espn.com/nfl/game?gameId=401872930`), specifically the **current-drive field
graphic** showing ball position and movement, and the **win probability** with
movement. Used as inspiration for patterns, not as a standard.

### Measured

- Live NFL game page (Phase F): the black live panel repeats the hero's score,
  logos and clock; below it a full box score, quarter scores, scoring plays and
  a 30-row team stat table, all expanded, above the pregame cards, which stay.
- **What the feed already sends.** The ESPN summary endpoint that
  `footballLiveGame.ts` calls returned, for DAL @ NYG at halftime:
  - `winprobability`: **92 points**, one per play (home win % per play).
  - `drives.current` and `drives.previous` (9 drives): each play with `start` and
    `end` yard line, down, distance, clock, result, yards.
  - Also `leaders`, `odds`, `againstTheSpread`.

  The parser reads none of `winprobability` or `drives`.

### Proposed live layout (all sports)

1. **One live header:** score, clock/period, possession, and win probability as a
   number with a small trend. Replaces the hero and the repeated black panel.
2. **The sport's own "where is the play" graphic:**
   - **NFL/CFB:** field with ball position, drive path, down and distance, and the
     last play text. Data: `drives.current.plays[].start/end.yardLine`.
   - **MLB:** the existing diamond, count and batter/pitcher (already good), plus the
     last pitch's velocity and location, and the last batted ball's exit velocity.
   - **NBA:** game flow (lead over time) and current run.
   - **NHL:** live shot map by period, shots on goal and goalie saves.
   - **Soccer:** attack momentum / xG timeline with events.
   - **Tennis:** set and game score with break points.
3. **Win probability chart** across the game with scoring plays marked; hover any
   point for the play that moved it. NFL data is in the feed today.
4. **Tabs instead of a wall:** Live (graphic + last plays) · Box score · Team stats
   · Play-by-play · Odds. Pregame cards (splits, records, rankings) move out of
   the live view.
5. **Player props follow the game:** each player's live line against today's
   numbers, the MLB "Live today" pattern (card audit C4).

### Data to keep for this (to Phase H)

| sport | in the feed the app calls | kept today |
|---|---|---|
| NFL / CFB | per-play win probability, drives with yard lines | no |
| Others | to verify per sport's live endpoint in Phase G | — |

---

## 8. Motion and feedback

### Measured

Default Tailwind transitions only; no motion on data changes; the `motion`
library in 1 file; live values swap instantly.

### Proposed

(Tokens in `F2-visual-system.md` §7.)
- **Hover and press** on every interactive element (`instant`).
- **Tabs, toggles and scope changes** animate content and chart transitions
  (`quick` / `data`).
- **Drill-down panels** slide in (`smooth`); the page behind stays in place.
- **Live values** tween and flash briefly on change (`live`); a scoring play
  gets a one-time highlight.
- **Confirmations** ("Added to slip", "Tracking O 46.5") as small toasts.
- **Reduced motion:** fades only.

---

## Carried to Phase G and H

- **Phase G mockups** are drawn in the proposed system (type ramp, card anatomy,
  color rules) with Tier 1 interactions shown and at least one Tier 2 drill-down
  per surface, plus the live game layout, the typeface comparison (decision 4)
  and an elevation choice (visual system §2).
- **Phase H** puts the system work first: tokens and `Card` / `Tooltip` /
  `Avatar` / `SegmentedToggle` / `DataTable` / `StatValue` / `Skeleton`
  primitives, then page structure and states, then card-level changes, so
  cards are rebuilt once, in the new system.
