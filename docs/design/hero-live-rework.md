# Player hero, live card and card chrome — rework gameplan (2026-09-15)

Three related pieces of the player page, raised by the operator after R6.2:
the hero card wastes space, the live card is ugly and sits in the wrong place,
and the page now mixes two card headers. Gameplan first; mockups next; then
build for the sports already rebuilt (MLB, NFL, CFB); then R6.3 resumes.

Nothing here changes what the page knows — every number below already exists in
a shape the page holds.

---

## A. The hero card

### What is wrong, measured (1440px, `/mlb/player/677951`)

| thing | measured |
|---|---|
| hero card | 1416 x 332 px |
| facts block (`FactList`) | 448 x 133, 5-6 rows |
| season block | 220 x 34 (two short lines) |
| dead space between them | ~700 px across the middle band |
| tile strip | 1366 x 66, 11 tiles in one row at 1440 |
| the same strip at ~1100 (the operator's window) | 10 tiles, then 1 orphan on a second row |

So: two thin columns at the edges, a wide emptiness between them, and the one
genuinely useful band (the season tiles) is a single strip at the bottom that
breaks badly at the width people actually use.

The facts themselves are a label/value list: each row is a label at the far
left and a value at the far right of a 448px box, and "Born" wraps to two lines
because the place name is long.

### What it should be

One row of three zones that each earn their width, then a tile strip that
cannot orphan:

```
+----------------------------------------------------------------------------+
| [88px    ] Elly De La Cruz  #44  SS            | 2026 season               |
| [headshot] (logo) Cincinnati Reds              | 63-68 in games played     |
|            vs LAD - 5:40 PM - LIVE 4-0 Bot 7th | last 5: W W L W L         |
|            [injury pill, when there is one]    | [switch season, later]    |
|                                                 |                          |
|  Age 24     Bats/throws S/R   Height 6'6"      |                          |
|  Weight 200 Born Jan 11 2002  Debut Jun 6 2023 |                          |
+----------------------------------------------------------------------------+
|  G 131 | AVG .284 | OBP .361 | SLG .514 | OPS .874 | HR 27                  |
|  RBI 72 | R 92 | SB 25 | K% 27.7 | BB% 10.6                                 |
+----------------------------------------------------------------------------+
```

- **Facts become a micro-grid**, label above value, three columns at desktop and
  two on a phone. No leader gaps, no wrapping place names pushing a row to two
  lines. Long values (birthplace) get their own full-width cell.
- **The season zone becomes a real panel**: season label, record, and a compact
  last-five strip built from `research` (the page already reads every game).
  It is the hero's right rail rather than two stranded lines.
- **The game line is part of identity**: "vs LAD - 5:40 PM", and when the game
  is live it becomes a live chip with the score that links to the live card
  below. That is the hero's only live content.
- **Tiles get a fixed grid** (6 up at desktop, 4 at tablet, 3 on a phone) so a
  row is always full; 11 tiles read as 6 + 5, never 10 + 1.
- Target height ~230px at 1440 against today's 332, with more shown.

### Per sport

The zones do not change; the contents already differ by sport and stay as they
are (`playerResearchSpec.ts` owns tiles, `playerBio.ts` owns facts):

| sport | facts (bio) | tiles (spec) |
|---|---|---|
| MLB hitter | bats/throws, height/weight, born, debut | G, AVG, OBP, SLG, OPS, HR, RBI, R, SB, K%, BB% |
| MLB pitcher | throws, height/weight, born, debut | G, GS, IP, ERA, WHIP, K, BB, K/9, HR |
| NFL/CFB | height/weight, experience, college, draft | position-specific (QB: Cmp/Att, yards, TD, INT, rating) |
| NBA | height/weight, experience, college, draft | G, PTS, REB, AST, FG%, 3P%, MIN |
| NHL skater/goalie | shoots/catches, height/weight, born, draft | G, A, P, SOG, TOI / GAA, SV%, SO |
| Soccer | height/weight, foot, nationality | apps, goals, assists, xG, minutes |
| Tennis | height, plays, turned pro, rank | matches, win%, aces, first-serve% |
| Golf | height/weight, turned pro, country | events, cuts made, scoring average |

---

## B. The live card ("Live now")

### What is wrong

- **Placement.** It renders inside the "Prop analysis" section, between the
  section heading and the prop block, so the page reads: heading, live card,
  then the thing the heading promised. That is the jump the operator sees.
- **Box in box.** A 15rem column of three bordered boxes (score, count/bases,
  batter/pitcher) beside a list, all inside a card. Four borders deep.
- **The scoreboard is the smallest thing on it**, and the situation (count,
  bases, outs) — the reason to look at a live card at all — sits mid-column.
- **"Lines so far" is flat**: market, value, a chip. No progress toward the
  line, no price, no link to the market it belongs to.
- **Nothing about the game itself**: no scoring plays, no link to the game page.

### What it should be

Its own section directly under the hero, present only while a game is live,
with a nav entry that appears with it. One card, four bands, no nested boxes:

```
+----------------------------------------------------------------------------+
| LIVE - Bot 7th                                        LAD @ CIN  Game page >|
+----------------------------------------------------------------------------+
| (logo) LAD  4      B ooo   [diamond]     At the plate  E. Suarez 0-for-3    |
| (logo) CIN  0      S **    2 out         On the mound  Y. Yamamoto 6.2 IP   |
+----------------------------------------------------------------------------+
| Elly De La Cruz today   1-for-2 - 0 R - 0 RBI - 1 BB - 0 K                  |
| PA2 Double (29) to left - PA3 Groundout to catcher            [show all 3]  |
+----------------------------------------------------------------------------+
| Hits        O 0.5   1  [#########] cleared        -185 fanatics             |
| Total bases O 1.5   2  [#########] cleared        +163 novig                |
| Home runs   O 0.5   0  [--       ] not yet        +500 bet365               |
+----------------------------------------------------------------------------+
| Last plays: 7th Suarez strikeout - 6th Betts HR (2-run)                     |
+----------------------------------------------------------------------------+
```

- **Band 1** is the game: state, matchup, and a link to the game page.
- **Band 2** is the scoreboard plus the sport's own situation, side by side at
  desktop and stacked on a phone.
- **Band 3** is the player's own game so far, with the sport's own detail.
- **Band 4** is "lines so far", each row measured against the same main line the
  prop block uses, with progress and the price the page already resolved.
- **Band 5** (optional, see decision 3) is a short event feed.

### Per sport — what the live data actually holds

Checked against each sport's live module today; nothing below is aspirational:

| sport | situation slot (band 2) | player's own line (band 3) | events (band 5) |
|---|---|---|---|
| MLB (`mlb/liveGame.ts`) | count, outs, bases, batter, pitcher | batting or pitching line + every plate appearance | scoring plays (`plays`) |
| NFL (`multiSport/footballLiveGame.ts` + `nfl/liveGameState.ts`) | quarter, clock, possession, down and distance, red zone | passing / rushing / receiving line, name-matched | scoring plays |
| CFB (same parsers) | quarter, clock; down and distance needs the same `liveGameState` parser pointed at CFB (identical ESPN shape) | same as NFL | scoring plays |
| NBA (`nba/liveGame.ts`) | quarter, clock, quarter-by-quarter line | min, pts, reb, ast, stl, blk, to | none held (leaders only) |
| NHL (`nhl/liveGame.ts`) | period and type, clock, intermission flag, shots on goal | goals, assists, points, shots, hits, blocks | goals (with strength) and penalties |
| Soccer (`soccer/liveGame.ts`) | minute, half scores | **not held** — no per-player live stats (operator decision 5) | key events: goals, cards |
| Tennis (`tennis/liveGame.ts`) | set scores per player, status | **not held** — no point-by-point (R4) | none |
| Golf | no live game concept on this page | — | — |

Two sports therefore get a deliberately shorter card (soccer, tennis): bands 1,
2 and 5 only, with band 3 stating what is not held rather than sitting empty.

### Shape in code

`GameStateSlot` already carries score, period, the subject's line and the lines
so far. The rework adds, to the same slot:

- `situation`: a small named union per sport (`baseball` exists; add `football`,
  `hoops`, `hockey`, `pitch`, `court`) — rule 4 of the sport-adapter convention,
  presence-checked, never a `sport === 'x'` branch in the card.
- `events`: `Array<{ clock: string; text: string; tone?: 'score' | 'penalty' }>`.
- `gameHref`: the game page link (MLB/NFL exist; R8 for the rest).
- each line row gains `price` (already resolved by the page).

---

## C. Card chrome (raised 2026-09-15)

One MLB player page renders **two card headers**: 8 legacy cards with a green
`bg-accent-soft` bar and 12px masters-green title, and 16 R3 `Card`s with a
white header, border underneath and a right-aligned scope. Plus the page's own
section headings, which is the third style the operator counted.

Legacy cards still on the player page: the distribution chart ("N games in
scope"), MATCHUP, PITCH MIX SEEN, OPPOSING STARTER, HEAD TO HEAD, CONDITIONS,
FORM, Live line tracker.

**Proposal:** convert all eight to `Card` — title in sentence case, scope on the
right, `info` where the legacy card had a paragraph of explanation — and delete
`lb-card`'s header styling from these components. Content unchanged. Files:
`PlayerRoleSections.tsx`, `MatchupExplorerCard.tsx`, `LiveLineTrackerCard.tsx`,
and the chart card inside `PlayerDetail.tsx`.

---

## BUILT 2026-09-15 (commit `35d6be5`)

Approved variants: hero **C5** (headshot with the name, facts full width
beneath), live card as its own section, per-sport event feed, in-repo mockups.
Operator's two corrections on the mockups are in: the headshot stays its
current size, and a cleared line tints its whole row with the book shown
beside the market rather than drawing a progress bar.

Built for every sport (the hero and the chrome are shared) with the live card
filled for MLB, NFL and CFB; the other sports fill `gameState` in their own
sub-phases. Rendered at 1440 and 400 against two live MLB games (Witt,
Meidroth), Lamb and Alcaraz: hero 338px against 332 before but carrying the
record, the last five and two more facts; no legacy card headers left on the
page; no overflow at 400. 510 tests, build clean.

Found while rendering and fixed in the same commit: the live card's price was
picking a pick'em payout (prizepicks +100 for Witt's hits) because the new
lookup did not apply R2's pick'em rule; the hero printed a failed team logo's
abbreviation twice ("@ HOU HOU"); and ESPN's day-first birth date ("21/5/1996")
sat beside MLB's "Jan 11, 2002".

## Sequence

1. **Gameplan approved** (this file).
2. **Mockups**: static HTML on the app's real tokens, screenshotted at 1440 and
   400 — hero (MLB hitter, MLB pitcher, NFL QB, NFL WR, NBA, NHL, soccer,
   tennis, golf) and live card (MLB, NFL/CFB, NBA, NHL, soccer, tennis).
3. **Build for the sports already rebuilt**: MLB, NFL, CFB — hero, live card,
   chrome sweep, tests, render at both widths.
4. **Resume R6.3 (soccer)**; each later sport fills its own live variant as its
   sub-phase lands, against the mockup agreed here.

## Decisions needed before mockups

1. **Live card placement** — its own section under the hero (recommended), or
   keep it inside Prop analysis?
2. **Hero facts** — all of them in the micro-grid (recommended), or trim to four
   with the rest behind a control?
3. **Event feed (band 5)** — build it now per sport, or leave the live card to
   bands 1-4 and let R8's game page own the feed?
4. **Mockup format** — in-repo HTML plus screenshots here (recommended), or a
   published artifact to click through?
