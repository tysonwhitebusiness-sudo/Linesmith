# Phase F — Verdict on every card

**Status: IN PROGRESS 2026-09-14.** Judged from the Phase E captures: every card
image, its captured text, and the full page. Two questions per card: **does it
make sense for this sport, and does it help?**

**Verdicts:** **keep** (at most polish) · **rework** (the idea helps, the showing
doesn't) · **replace** (this slot should say something else for this sport) ·
**remove** (doesn't help). Every non-keep says **what instead**.

Each row names the card's **sentence** (what one sentence it's trying to say,
or *none*) and the checks it fails: **Sen**tence, **Nat**ive form,
**Sco**pe, **Enc**oding, **Dup**lication, **Ide**ntity, **Int**eraction,
**Ren**dering.

---

## NFL — player page

Captured: WR Tre Tucker (after his game), RB Ashton Jeanty (after), QB J.J.
McCarthy (after), QB Jaxson Dart and WR Malik Nabers (pre-game and live).

### The page as a whole

**The page answers one question five times and several others not at all.** "Did
he clear 46.5?" is said by the bar chart header, the bar chart itself, Rolling
form, Game context ("6 of 17 · 35%") and Where this sits. Meanwhile the
questions a bettor on a receiving prop actually asks go unanswered: **how many
targets is he getting now, who's throwing to him, what's his snap/route share,
and is anyone injured around him?**

**Every number is last season's and says so nowhere.** All 17 bars are
`25-Wk1`…`25-Wk18`. The game being bet on is 2026 Week 1. "Season stats",
"17 games in scope" and "Season average" all mean 2025 without saying it.

**Live looks identical to pre-game.** Captured seven minutes into the Giants'
game, the Dart and Nabers pages were the same cards as before kickoff: no score,
no in-game stat line, no "he has 38 yards, needs 9 more".

**Empty cards take real space.** On Tre Tucker's page, five of 17 cards say nothing:
Live line tracker ("No lines tracked yet"), Today's line ("No game line for this
matchup yet"), Form ("vs MIA –"), Line movement ("No price history recorded")
and, on a one-book prop, All books.

### Cards

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** | "Tre Tucker, WR, LV vs MIA, receiving yards over 46.5" | **rework** | Sen, Sco | `#64` reads as a jersey number but is a rank. "244th of 564 offense" ranks a QB against every offensive player, which means nothing. After the game it still shows the kickoff time. **Instead:** jersey-style `#` gone; rank only within position ("31st of 74 QBs, 2025"); game state in the hero (pre: kickoff + spread/total · live: score + clock + his line so far · final: result + his final line). |
| **Line picker** (− O 46.5 + · price · Add to slip) | "the line and price" | **keep** | Sco | Price age ("4d ago") is right to show; put the book name beside it. |
| **Bar chart** ("17 games in scope") | "he cleared 46.5 in 6 of 17 games" | **rework** | Sco, Enc | The strongest card on the page. But "17 games in scope" hides that all 17 are 2025, and the bars show nothing about opportunity. **Instead:** title "2025 season · cleared 46.5 in 6 of 17"; a scope toggle (this season / last season / last 10 / vs opponent); targets as a small mark on each bar, since yards without targets can't separate a bad game from no looks. |
| **Matchup** (Overview / Stat grid / Profile tabs) | "MIA's pass defense is average" | **rework** | Sen, Dup | "Biggest edge… 45th percentile" names an edge that isn't one (card audit C9), behind three tabs of chrome for one sentence. **Instead:** merge with Opposing defence into one card: what MIA allows **to wide receivers** (yards, catches, TDs per game), ranked 1–32, colored by whether it favors the over, with "no clear edge" when nothing is. |
| **Target map** | "where his targets go" | **rework for WR/TE, remove for RB** | Nat, Enc, Sco | Football data on a strike-zone grid, good/bad colors on a volume measure, no season (D4). For a WR, depth is real signal: 14% deep says "big-play receiver". **Instead, WR/TE:** a half-field drawing, line of scrimmage at the bottom, short and deep zones with target share as single-color intensity and catch rate on hover, season labeled. **RB:** 83% short behind the line tells a bettor nothing; replace with **rushing direction/gap share** or remove. |
| **Rolling form** | "his 5-game average is falling" | **remove** | Dup, Enc | Plots the same 17 games as the bar chart. The line (46.5) is named in the caption but not drawn; the y-axis ticks (54.1, 108.3, 162.4) are arbitrary. **Instead:** fold the trend into the bar chart as a rolling-average line over the bars. |
| **Live line tracker** | none (empty) | **remove as a card** | Sen, Dup | "No lines tracked yet" when signed out. **Instead:** a "Track this line" action on the line picker; show the tracker only when something is tracked and the game is live. |
| **All books** | "prices at every book" | **rework** | Dup | Useful when several books post the prop. Here: one book (Underdog), stale. Its price repeats the line picker and Recorded price. **Instead:** one "Best price" block next to the line picker (best over, best under, how many books, how stale), expandable to all books. Hide the list with one book. |
| **Game log** ("Last 15 games") | "what he did each game" | **rework** | Sen, Enc, Ren | Rows show TGT/REC/YDS/TD but **not whether he cleared the line**, the one thing this page is about, and not the result or score. Opponent is a logo only. Wide empty space to the right. The sticky site header covered the card's summary numbers in the capture. **Instead:** each row = week, opponent name + logo, W/L and score, stat line, and a hit/miss mark against today's line; group by season. |
| **Opposing defence** | "MIA allows 230.6 pass yds/game, 18th of 32" | **merge into Matchup** | Dup, Enc, Sco | Swatch colors are near-identical tans that encode nothing readable. "Pass TD allowed" is team-level, not what MIA gives up to receivers. Season unnamed. |
| **Head to head** (QB page: "vs DAL, 50%, cleared 1 of 2") | "he cleared the line in 1 of 2 meetings" | **rework** | Sen, Enc | A 50% headline from two games oversells a coin flip. **Instead:** show the meetings themselves ("2025 Wk2: 32 yds · Wk18: 198 yds") and only show a rate at 5+ meetings. |
| **Conditions** (QB page: 75°F, wind 5 mph) | "the weather at kickoff" | **rework** | Sen | Outdoor weather matters for passing and kicking, but the card doesn't say whether it matters today, and "Area, not on-site" is jargon. **Instead:** only for outdoor stadiums, with an impact line ("wind under 15 mph, no expected effect on passing"); fold into the hero. |
| **Where this sits** | "75th of 404" | **replace** | Sen, Enc, Sco | D3. The pool is every player with a receiving yard, including linemen and backups. **Instead:** "Rank among WRs with 5+ targets/game, 2025: 42nd of 96" as one percentile bar, or remove. |
| **Game context** | "cleared 6 of 17, avg 40.94 vs line 46.5" | **remove** | Dup, Sco | D2. Every row repeats the bar chart; "Season average" is over 2025 without saying so. **Instead:** move "average vs line (-5.6)" and "median" into the bar chart header. |
| **Today's line** | "the game's spread and total" | **rework** | Sen | Empty after the game. Spread and total are real context for a receiving prop (game script). **Instead:** a line in the hero ("MIA +3 · O/U 44.5"); hide when missing. |
| **Season stats** ("ranked among WRs") | "2025: 57 rec, 696 yds, 5 TD, ~35th of 217" | **rework** | Sco, Enc | Useful, but "Games 17" and the ranks hide the season, and 217 "WRs" includes practice-squad call-ups. The green bars don't say what their length means. **Instead:** "2025 season · among WRs with 8+ games"; add **targets per game and target share**, the receiver stats that drive yardage; a percentile bar with better marked. |
| **Form** ("vs MIA –") | none (empty) | **remove** | Sen | Says nothing on every NFL capture. |
| **Line movement** | none (empty) | **remove when empty** | Sen | "No price history recorded" is most NFL props. When history exists: a line-and-price chart, open to now, with book markers. |
| **Recorded price** | "-110, recorded Sep 9" | **remove** | Dup | Repeats the line picker's price and age. |

### What this page is missing (seeds for Phase G)

- **Opportunity:** targets/game, target share, snap share, routes run. The
  things that predict yards better than past yards do.
- **Who's throwing and who's out:** starting QB, injured teammates at his
  position (more targets) and the defense's injured corners.
- **Live:** his line so far against today's number, with the game state.
- **This season vs last:** two games into a new season, the page should say
  how 2026 compares to 2025, not pretend 2025 is now.
