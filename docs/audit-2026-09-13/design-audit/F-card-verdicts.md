# Phase F — Verdict on every card

**Status: COMPLETE 2026-09-14** for every page the calendar allowed (not judged:
golf, NBA/NHL live, CFB markets on a live Saturday, soccer and tennis live).
Judged from the Phase E captures: every card image, its captured text, and the
full page. Two questions per card: **does it make sense for this sport, and does
it help?**

## ⚠ Correction, 2026-09-14 — read before using these verdicts

**The operator corrected the frame this phase was written in.** Verdicts below
judged cards by "does it help decide today's bet", with the prop line as the
organising question. **That's wrong for this product.** Player, team and game
pages are **in-depth research pages**: every stat relevant to an informed
decision belongs on them, and odds/lines are one section.

Under the corrected frame:

- **Duplicates, empty cards, wrong-sport forms, bad encoding, missing scope,
  identity and every data bug still stand.** None of those depended on the frame.
- **"Remove" verdicts that removed depth are withdrawn.** Only genuine
  duplicates and empty cards get removed.
- **The line becomes an optional overlay, never the default frame.** Where a
  verdict says "mark hit/miss against today's line" or "cleared N of M", read it
  as one available view on a full stat card, not the card's purpose.
- **"What instead" means more depth, not less.**

Verdicts that change:

| card | was | now |
|---|---|---|
| **Player bar chart** ("N games in scope · cleared the line") | rework around "cleared 46.5 in 6 of 17" | **rework as a stat-over-time chart** for any stat, with scope toggles; the line is an optional overlay |
| **Rolling form** (NFL, MLB, all) | remove | **rework:** the trend is real insight; draw it on the stat chart or keep a trend card for several stats at once, not a copy of one |
| **Game log** (every sport) | rework around hit/miss vs the line | **rework as a full stat log**: every stat for the sport, result and score, opponent, season grouping; line markers optional |
| **Game context** | remove | **replace** with a real summary card: season, last-10 and career averages for the key stats, sample sizes, labeled |
| **Situational splits / Home & Away** (player and team) | replace with ATS records / remove | **rework as performance splits** (home/away, rest, vs winning teams, by month, by surface/park): stats, not "share over 0.5"; ATS and over/under records are one split among them |
| **Soccer shot types** | merge (doesn't affect a goal bet) | **keep**, alongside the shot map |
| **MLB pitch mix / platoon / strike zone** | rework (samples) | unchanged: rework for sample size; all are depth to keep |
| **Where this sits** | replace or remove | **rework:** percentile among position peers for **several key stats**, not one market |
| **Opposing defence / Opponent / Opposing starter** | merge into Matchup | unchanged, but the merged card shows the opponent's full relevant profile, not only the prop's stat |
| **Team stats, Advanced stats, Hitter stats, Season stats** | keep/polish | unchanged, and **expanded**: these are the core of the page (NBA ratings and pace, NHL special teams and goalie stats, NFL EPA and success rate, soccer xG per 90, tennis serve/return) |
| **Team page line picker / team bar chart** | remove / replace | unchanged: a moneyline picker isn't research. The results strip replaces the chart. |

Phase G's ideas start from this frame: **what does a complete, in-depth page for
this player, team or game look like in this sport**, with odds as one section.

## Summary — what the verdicts add up to

1. **Pages answer one question many times and others not at all.** Every player
   page says "did he clear the line" in 4–5 cards (bar chart, Rolling form, Game
   context, Where this sits, Situational splits). Every game page compares the
   two teams in 4 cards (Matchup, Team stat comparison, Rankings, Unit grades).
   The questions a bettor actually asks per sport (NFL targets and snap share,
   NBA pace and ratings, NHL starting goalies, soccer minutes and position,
   tennis serve stats and surface) have no card.
2. **Dead cards.** Form ("vs MIA –"), empty Line movement, Live line tracker
   when nothing's tracked, Today's line after the game, Recorded price repeating
   the line picker: **remove** or show only when they hold something.
3. **Seasons are unlabeled or mixed on nearly every card.** Bar charts open at the
   oldest game with no years; NFL records span seasons under a 0-0 record;
   soccer ranks "of 23" in a 20-team league; tennis records of 103-38 labeled one
   season; last season shown as current form in Week 1.
4. **The sport-native form is missing.** Strike-zone grids for football targets
   and soccer shots; NFL standings with GB and L10; soccer records without draws;
   NHL records without OT losses; tennis pages with home/away, injuries, unit
   grades and a "team" stat comparison; "Contact quality matchup" on soccer and
   CFB team pages.
5. **Encoding says the wrong thing.** Good/bad colors on neutral stats (fouls,
   saves, target share); `#18`-style ranks that read as jersey numbers; "biggest
   edge" at the 32nd–48th percentile; green highlighting an edge that works
   against the bet; per-game stats rounded to integers; raw floats and ISO
   timestamps.
6. **Identity.** Initials instead of photos across many cards; club crests
   instead of player photos in soccer; blank NHL logos.
7. **Two MLB cards are the model for every sport.** *Live today* (score, state,
   every line with a check as it clears) and *Pitching matchup* (two sides, the
   stats that matter, percentile chips, bullpen). Other sports need the
   equivalent, not a copy of the baseball content.
8. **Blank player pages** (7 of 22 player captures) → a player page must always
   render the player; market cards appear only when a market exists.
9. **13 correctness bugs** found while judging (F-B1…F-B13, bottom of this
   file), including a Rankings card that invents "against" numbers in four
   sports.

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

---

## NFL — game page

Captured: DAL @ NYG live (Q1, after the date fix), GB @ MIN late, TB @ CIN
final, DAL @ NYG pre-game.

### The page as a whole

**The same team comparison is shown four times.** Matchup (offense vs defense
tables), Team stat comparison (bars), Rankings (heat grid) and Unit grades
(letters) all describe the same 2025 team stats in different forms. None of them
says **which side of the bet the numbers favor**.

**Live, it becomes a box-score page with the betting page still around it.**
The live panel repeats the hero's teams, logos and score (D1), then adds a full
box score, quarter scores, scoring plays and a 30-row team stat table. That's
good live content, but the pregame cards below it (Situational splits, Records,
Rankings) don't change or step aside.

**Records mix seasons.** "0-0 · 2nd in division" sits above "Home 6-7, Away
5-7" for Dallas and "Home 4-8, Away 1-12" for the Giants. An NFL season has 8–9
home games, so 13 games each way covers more than one season, unlabeled. The
hero's `L1`/`W2` streaks in Week 1 (0-0) come from last season too.

### Cards

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Candidates rail** (props list, left) | "props for players in this game" | **keep** | Ren | Long, dense list in a narrow rail. Fine as navigation. |
| **Hero** (teams, records, grade chips, kickoff/score) | "DAL @ NYG, 0–0 Q1" | **rework** | Sco, Dup | Streaks from last season; grade chips from 2025 unlabeled. **Instead:** season-true record and streak; spread/total/moneyline in the hero pre-game; live score and clock here, and nowhere else. |
| **Weather** (MetLife, 75°F, wind, "Weather impact Low") | "weather won't matter" | **keep** | — | The impact meter is the right idea. Hide for domes. |
| **Live panel** (black score block + passing leaders) | "0–0, Q1 9:38, Dak 1/2 8 yds" | **rework** | Dup, Ide | Repeats the hero (D1); logos overlap their abbreviations; initials for Prescott and Dart. **Instead:** the hero becomes live; this panel keeps only leaders and drives, with headshots. |
| **Box score** (every player, by unit) | "who's done what so far" | **keep** | Ide | Right for live and final. Headshots instead of initials; highlight players with props on this page. |
| **By quarter / Scoring plays / Team stats table** | "how the game is going" | **keep** | Ren | The 30-row team stat table is long. Collapse to 8 key rows with "show all". |
| **Matchup** (Team / Player; DAL offense vs NYG defense tables) | "Dallas's offense is elite, and New York's pass defense is middling" | **rework** | Enc, Ren, Sco, Dup | The most useful team card, badly drawn: rank text collides with the neighbouring column ("1st of 32PASS YDS ALLOWE…"), labels truncate, "Season stats" means 2025. **Instead:** one row per pairing, e.g. "DAL pass offense 1st ⟷ NYG pass defense 17th: edge DAL", colored by who it favors; season labeled. This absorbs Team stat comparison, Rankings and Unit grades. |
| **Records** (Season / Last 5 / Head to head) | "0-0; home 6-7, away 5-7" | **rework** | Sco | Home/away totals span more than a season (13 games each). **Instead:** this season's record, plus last season's record labeled as such until week 4 or so; head to head as a list of meetings with scores. |
| **Situational splits** ("share of games over -3") | none readable | **replace** | Sen, Enc, Sco | "Over -3" doesn't say whose spread; percentages on tan/red cells read as bad everywhere. **Instead:** ATS record by situation in plain words ("NYG covered 3 of 12 as an underdog, 2025"), W-L-P with sample size. |
| **Team stat comparison** (paired bars) | same as Matchup | **remove** | Dup, Enc | Bar colors (green/olive/orange) don't match the DAL/NYG legend and don't say better/worse; turnovers use the same "more is green" logic as points. |
| **Last 5 games** (W/L chips with scores) | "DAL lost 4 of its last 5, NYG won its last 2" | **rework** | Sco, Ide | Clear and good, but these are December–January 2025 games shown at the start of 2026 as current form. Initials used on this card in every sport (E fact 13). **Instead:** label "end of 2025 season" until 2026 games exist; team logos, not initials. |
| **Rankings** (heat grid, DAL FOR/AGN, NYG FOR/AGN) | "rank of each team's offense and defense" | **remove, and fix the bug** | Dup, **data wrong** | **The "AGN" columns show the other team's offense ranks, not this team's defense.** DAL AGN = NYG FOR exactly (21, 24, 5, 6…), and NYG AGN = DAL FOR (1, 5, 9, 11…). The Matchup card on the same page shows DAL's pass defense is 32nd, not 21st. See "Correctness bugs" below. |
| **Unit grades** (9 letter grades per team) | "DAL: A- offense, F defense" | **merge into Matchup** | Dup, Sco, Sen | Letters with no season and no explanation of how they're graded. Useful as the headline of each Matchup pairing. |
| **Injuries** | "who's out" | **rework** | Sen, Ide, Enc | Lists the **entire roster**, "Active" players included, every row labeled "P · NOT REPORTED". The players who matter (Out, Doubtful, Questionable, starters) are buried. **Instead:** only players with a status, starters first, real position, headshot, and "props affected" beside a player with markets. |
| **Game context** ("Games in scope 25 · Season average -5.48 · Line -3") | none readable | **remove** | Sen, Sco, Dup | D2 on a game page: the -5.48 is a margin for an unnamed team over 25 games spanning seasons. |
| **Line movement** (tiny chart, "bet365 in front, 2 other books behind…") | "NYG's moneyline moved" | **rework** | Enc, Ren, Sen | Axis unreadable at this size; the caption is jargon. **Instead:** a full-width chart of open → now for spread, total and moneyline, one line per major book, hover crosshair. |
| **NYG moneyline** (tick strip +119 … +154, "19 books") | "prices range from +119 to +154" | **rework** | Sen, Enc | Unlabeled dots and ticks. **Instead:** "Best NYG price +154 at X · worst +119 · 19 books", both sides. |
| **Line shopping** (collapsed "21 bookmakers") | same as above | **merge** | Dup | Fold into one "Best prices" card for spread, total and moneyline. |
| **My picks / Add to picks** | "your slip for this game" | **keep** | — | User tools. |

---

## NFL — team page

Captured: Las Vegas Raiders, Week 1 day (their game already final).

### The page as a whole

**It shows the moneyline betting layout, and a team page isn't a bet.** The top
of the page is a line picker set to "Win · Moneyline" with no price, and a bar
chart of 25 wins and losses as bars reaching a 0.5 line. A team page's
questions are **how good is this team now, what's changed, who's hurt, what's
next, and how have they done against the spread and totals**.

**Seasons are mixed everywhere, and the dates hide it.** The 25-game chart runs
11/16 … 01/04, then 09/06 … 12/20: two seasons, out of order, no years. "Last
15 games", "Recent results", "Form", "Situational splits" and "Home/Away" each
draw on that same unlabeled pool.

**Four cards list the same recent games:** the bar chart, Last 15 games, Recent
results and Form.

### Cards

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** (LV 0-0 · 3rd in division, OFF F · DEF C · ST D, "vs MIA →") | "the Raiders, 0-0, next vs MIA" | **rework** | Sco | Next game points at a game already played today; grades unlabeled. **Instead:** season record, this week's result if played, next opponent with date, "2025 grades" labeled. |
| **Team line picker** ("Win · Moneyline · Add to slip to record a price") | none | **remove** | Sen | No price, no line. Team bets belong on the game page. |
| **Bar chart** ("25 games in scope · green cleared a win") | "won 4 of 25" | **replace** | Nat, Enc, Sco | Wins drawn as tall bars over a 0.5 line, losses as flat red slivers; two seasons, dates out of order. **Instead:** a season-by-season results strip (W/L chips with score and opponent logo), plus ATS and total records per season. |
| **Rating history** (Elo 1249–1539, "1419 now · +15 across 2026") | "the Raiders' strength rating is falling" | **rework** | Sen, Enc | "Rating" and its units mean nothing to a reader. **Instead:** "Power rank 22nd of 32 (was 28th at the end of 2025)", with the rating on hover. |
| **Last 15 games** (dates, W/L, ✓/✗) | "lost 13 of 15" | **merge** | Dup, Sco | No scores, no years. Merge into the results strip. |
| **Team matchup — offense vs defense** | "LV's offense is bottom-5 vs MIA's defense" | **rework** | Enc, Ren, Dup | Rows ranked 32nd have **no bar at all**, which reads as missing data. Labels truncate. Duplicates Team stats. Same fix as the game page's Matchup. |
| **Situational splits** ("share of games over 0.5") | none readable | **replace** | Sen, Enc | "Over 0.5" is the win line in disguise. **Instead:** ATS and over/under records by home/away/favorite/underdog, per season. |
| **Home / Away** ("Cleared the line 23% / 17% · Moneyline 0.2 / 0.2") | none readable | **remove** | Sen, Enc | "Moneyline 0.2" means nothing. Covered by the split above. |
| **Team stats** (Scoring, Passing D, Rushing F…) | "2025: 32nd in points and rushing" | **keep, polish** | Sco, Enc | Useful. Label the season; draw a bar for last place instead of none. Absorb the matchup table above. |
| **Roster (79)** | "who plays for them" | **rework** | Sen, Ide, Sco | Alphabetical, so starters are buried. `#170` beside a name reads as a jersey number but is a rank. Some photos missing. "2 games played" has no season. **Instead:** depth chart order by unit, real jersey numbers, injury status inline, season stats labeled. |
| **Standings** | "AFC West: everyone 0-0" | **rework** | Nat | NFL standings with **GB and L10 columns**, baseball/basketball concepts, empty ("—") here. **Instead:** W-L-T, PCT, division record, streak, points for/against; highlight this team's division, collapse the rest. |
| **Line movement** (no data) | none | **remove when empty** | Sen | |
| **Game context** | none readable | **remove** | Sen, Sco, Dup | D2. |
| **Form** (Last 5 20% · Last 10 10% · vs MIA 0%) | "won 20% of the last 5" | **remove** | Dup, Sen | Unlabeled win percentages; repeats the results. |
| **Next game** ("MIA @ LV · 2026-09-13 · No live line yet") | "next: MIA" | **rework** | Sco, Sen | The game already happened; raw ISO date. **Instead:** the real next game, formatted date and kickoff, spread/total when posted. |
| **Recent results** ("KC vs KC W 14-12") | "beat KC 14-12" | **merge** | Ren, Dup | Opponent appears twice ("KC vs KC"); repeats Last 15 games. |

---

## MLB — player page

Captured live: hitter Bobby Witt Jr. (KC @ BOS, bottom 8th), starting pitcher
Noah Cameron (same game, already pulled).

### The page as a whole

**MLB's live player page is the model for every other sport.** "Live today"
shows the score, count and bases, who's batting and pitching, his at-bats, and
**every one of today's lines with a check once it's cleared**. That's the
sentence a live bettor wants ("he has 1 hit, needs nothing more"), said in one
glance. No other sport has it (E fact 19).

**The deep stats run on tiny samples, and the cards don't warn.** "Pitch mix
seen" is **33 pitches**, with xwOBA per pitch type on 1–2 balls. "Platoon split"
is 41 pitches. "Strike zone" is **7 balls in play**. These are the most
MLB-native cards on the page, and at these samples they're noise presented as
insight.

**The pitcher page is thin and partly broken.** Its game log shows zero totals
and nine empty rows (F-B4), and it lacks the hitter page's matchup, zone and
pitch-mix cards, where a pitcher prop needs them most: the opposing lineup's
strikeout rate and handedness.

### Cards

Cards already judged on the NFL page (line picker, Live line tracker, All
books, Where this sits, Game context, Today's line, Form, Line movement,
Recorded price) get **the same verdict here**; only MLB-specific points are
listed.

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** | "Witt, SS, KC @ BOS, In Progress, hits O 0.5" | **rework** | Sen | `#18` is a rank shown like a jersey number (same as NFL). "In Progress" without the score. |
| **Live today** | "KC 1–4 BOS, bottom 8th; Witt 1-for-3; hits ✓, walks ✓, total bases 1 of 2" | **keep** | Ide | The best card in the app. Copy it to every sport (card audit C4). Minor: headshots for every player named. |
| **Bar chart** ("131 games in scope") | "he got a hit in most games" | **rework** | Sco, Int | Opens scrolled to **March**, the oldest games; recent form is off-screen to the right. No year on dates. **Instead:** open at the most recent game, label the season, default to the last 20 with a season toggle. |
| **Matchup** ("Biggest edge: strikeouts — Tolle 94th percentile allowing it") | "Tolle strikes a lot of hitters out" | **rework** | Sen, Enc, Sco | The edge is **against** the hits-over bet, but it's colored green like a positive. "Allowing strikeouts" is backwards wording for a pitcher's strength. First pitch shown as raw `2026-09-13T19:05:00Z`. Mid-game, the named starter has already been pulled. **Instead:** state which side it favors ("Tolle's 94th-percentile K rate works against hits over"); show today's actual pitcher when live. |
| **Pitch mix seen** (n=33) | "he's seen mostly sinkers" | **rework** | Sco, Enc | 33 pitches; xwOBA on 1–2 balls per type. **Instead:** the opposing pitcher's **actual arsenal** beside Witt's **season** results against each pitch type (hundreds of pitches), with sample size per row and anything under ~25 PA greyed out. |
| **Platoon split** (vs LHP 23 pitches, vs RHP 18) | "he hits righties far better" | **rework** | Sco, Enc | "Pitches seen" isn't a stat anyone bets on, and the xwOBA is from 41 pitches. **Instead:** season (and career) AVG/OPS vs LHP and RHP with plate appearances, and a marker for today's pitcher's hand. |
| **Strike zone** (3×3, n=7) | "where he does damage" | **rework** | Sco | The zone is the right shape for baseball, unlike every other sport (D4), but 7 balls in play can't say anything, and empty cells read as broken. **Instead:** season sample, the zone plus chase edges, and the opposing pitcher's most-used locations drawn on top. |
| **Rolling form** | "trend in hits" | **remove** | Dup | Same as NFL. |
| **Situational splits** ("share of games over 0.5") | "got a hit in 73% of games" | **rework** | Sen, Enc | Useful facts in unreadable form. **Instead:** plain sentences with samples: "Hit in 73% of games this season · 74% at home · 60% over his last 5". |
| **Game log** ("Last 15 games") | "what he did each game" | **rework** | Sen | Same as NFL: mark hit/miss against today's line, opponent pitcher, result. |
| **Opposing starter** (12 stats, "60 of 364") | "Tolle is a good pitcher" | **rework** | Enc, Sen, Ide | Colors show how good the **pitcher** is, so green means bad news for the hitter being viewed. Twelve stats, lowercase labels ("era", "whip"). **Instead:** 4–5 stats that matter for this prop (K%, hard-hit% allowed, AVG against by batter hand, pitch count trend), colored from the hitter's side, with the pitcher's headshot and throwing hand. Merge into Matchup. |
| **Head to head** ("vs BOS · 83% · 5 of 6") | "he hit in 5 of 6 games vs Boston" | **rework** | Nat, Sco | In baseball the meaningful head to head is **batter vs this pitcher**, not vs the team. **Instead:** Witt vs Tolle (PA, H, K, HR) when they've met, and team splits only as secondary. |
| **Conditions** (first pitch raw ISO, 67°F, wind 5 mph N, rain 91%) | "the weather" | **rework** | Sen, Nat | Raw ISO timestamp, truncated. No statement of impact. **Missing the thing baseball bettors use most: park factor** (Fenway for doubles, Coors for runs). **Instead:** park factor for this stat, wind direction relative to the field (out to left/in from right), rain-delay risk, all as one-line impacts. |
| **Hitter stats** (season averages + quality of contact, "69th of 657") | "a good, not elite, hitter" | **keep, polish** | Sco, Enc | Strong content. Label the season; rank among qualified hitters, not 657 players with any PA (the "1st of 58 at SS" line is the better frame). |

## MLB — pitcher page (Noah Cameron)

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Live today** (6.0 IP, 4 H, 1 R, 4 K; today's lines with checks) | "he's done: 6 IP, 4 K, under 0.5 1st-inning runs ✓" | **keep** | — | Same model as the hitter's. |
| **Bar chart** ("9 games in scope · green cleared under 0.5") | "1 of 9 starts allowed a 1st-inning run" | **rework** | Enc | Zero-run games draw as flat green slivers, indistinguishable from missing data. **Instead:** a hit/miss strip for yes/no markets; bars only for counting stats (strikeouts, outs). |
| **Game log** ("Last 9 games") | none | **fix (bug F-B4)** | **data missing** | Totals read 0 strikeouts, 0 walks, 0 hits allowed, 0 earned runs; all nine rows are blank with empty opponent circles. |
| **Missing for a pitcher** | — | **add** | — | Opposing lineup's K% and handedness mix, his pitch count / leash trend, his splits by batter hand. The hitter page has matchup cards; the pitcher page has none. |

## MLB — game page

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Pitching matchup** (Scouting / Head-to-head / Rails; "Stat edge 0–12"; bullpen) | "Tolle outclasses Cameron; Boston's bullpen is deeper" | **keep, polish** | Enc, Sen | The best game-page card in the app: two starters, 12 stats in three groups with percentile chips, and the bullpens. Polish: bullpen circles (95, 50, 64) are ranks that read like jersey numbers; "Stat edge 0–12" counts stats won, which overstates a close matchup; live, mark who's actually pitching now. |
| **Records** (66-83 · Home 39-36 · Away 27-47) | "KC is 66-83" | **keep** | — | Season-true and adds up, unlike NFL's (F-B2). |
| **Rankings** (heat grid, 16 stats × FOR/AGN) | "rank of each team's hitting and pitching" | **remove** | Dup, Enc | Not mirrored like NFL's (F-B1 is NFL-only), but it's a 64-cell wall of rank numbers repeating Team stat comparison. |
| **Team stat comparison** | "Boston hits slightly better" | **rework** | Enc | **Per-game stats rounded to whole numbers**, so R 4 vs 4, H 8 vs 8, BB 3 vs 3 read as identical while the bars differ. **Instead:** two decimals (4.25 vs 4.61 R/G), colored by who's better, merged with the matchup's hitting-vs-pitching pairs. |
| **Unit grades** (Hitting C / B-, Pitching C / A-) | "Boston is better on both sides" | **merge** | Dup | Two rows. Headline for the pitching matchup and team comparison. |
| **Situational splits, Last 5, Injuries, Game context, Line movement, Moneyline strip, Line shopping** | — | same as NFL | — | See the NFL game page. |

## MLB — team page (Kansas City)

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Bar chart** ("149 games in scope · green cleared a win") | "66-83" | **replace** | Nat, Enc, Int | Same as NFL's, and opens scrolled to March. **Instead:** results strip by month, run differential, and ATS/over-under records. |
| **Pitching matchup** | same card as the game page | **keep** | — | Good on the team page too, for today's game. |
| **Team stats** (Per game · Season) | "KC: 22nd in runs, 2nd in doubles" | **rework** | Enc, Dup | The per-game column is rounded to whole numbers (R 4, HR 1, 3B 0) and repeats the season column's ranks. **Instead:** one column, rates to two decimals, season labeled. |
| **Advanced stats** (barrel%, exit velo, hard-hit%, whiff%, hitting and pitching) | "KC makes weak contact but rarely whiffs" | **keep** | Enc | Real MLB signal. Better direction is handled correctly (low whiff% ranks 5th, green). |
| **Standings** (W, L, PCT, GB, L10) | "KC is 10.5 back in the Central" | **keep** | — | GB and L10 are right for baseball (and wrong for the NFL, where the same component shows them). |
| **Roster, Next game, Game context, Line movement, Rating history, Situational splits, Home/Away** | — | same as NFL | — | See the NFL team page. |

---

## Soccer (EPL; MLS spot-check) — player page

Captured: forward Erling Haaland, defender Adam Smith, goalkeeper Gianluigi
Donnarumma (blank page), MLS forward Denis Bouanga.

### The page as a whole

**It's built around goals, and most players don't score.** Every captured soccer
player page opens on Anytime Goalscorer, including the right-back (1.9% of 259
games, card audit C8). The goalkeeper's page is completely empty: EPL has no
goalkeeper markets in the data, so there's nothing to open on (E facts 1, 17).
Soccer props the page could open on instead are shots, shots on target, tackles,
fouls, cards and saves, and the right one depends on position, which soccer
candidates don't carry (E fact 16).

**Seasons blur into careers.** Haaland's bar chart spans **203 games back to a
January of some year**, dated without years; shot data is labeled "2019-2026";
"Season stats" shows **4 games** (this season). The page mixes a career, a season
and an unlabeled window without saying which card uses which.

**Soccer's native visual is a pitch, and the page has none.** Shot location is a
3×3 strike-zone box (D4).

**MLS pages are thinner:** Bouanga's page has no matchup, shot type, shot
location or season stats cards (13 cards vs Haaland's 19), consistent with the
shot data source covering European leagues.

### Cards (soccer-specific; shared cards as NFL)

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** | "Haaland, MNC @ MAN, 10:30 AM, anytime goalscorer" | **rework** | Ide, Sco, Sen | **Club crest instead of a headshot** (the headshot exists on the team roster). No position. Kickoff time shown hours after full time. Abbreviations "MNC"/"MAN" aren't how anyone writes Man City/Man United (MCI/MUN). |
| **Default market** | — | **replace** | Sen | Position-aware default (build 5b): FWD → goalscorer/shots, MID → shots on target/assists, DEF → tackles/fouls, GK → saves. Needs position on the candidate. |
| **Bar chart** ("203 games in scope") | "scores in about half his games" | **rework** | Sco, Int | Opens at the oldest game, 203 games with no years. **Instead:** open on the latest game, this season by default, season toggle, and mark minutes played (a 20-minute sub appearance isn't a miss). |
| **Matchup** ("Biggest edge: Goals allowed/gm — MAN 32nd percentile") | "United concede an average amount" | **rework** | Enc, Ide | Initials "EH" instead of a photo; "MAN MAN" repeated; an "edge" at the 32nd percentile (C9). Same fix as NFL's matchup. |
| **Shot types** (left foot 63%, header 22%, n=700) | "Haaland mostly scores with his left foot" | **merge** | Sen | Real soccer data, but it doesn't change an anytime-goal bet. **Instead:** fold into the shot map as a filter (foot/head). |
| **Shot location** (3×3: in the box / edge / long range × left/central/right) | "64% of his shots are central, in the box" | **rework** | Nat, Enc | D4: drawn as a strike zone with good/bad colors on volume. **Instead:** a half-pitch shot map (penalty area, six-yard box), shots as dots sized by xG, goals highlighted, filterable by season. |
| **Home / Away** ("Cleared 59% / 53% · Anytime Goalscorer 1.0 / 0.8") | "scores slightly more at home" | **rework** | Sen, Enc | "1.0 / 0.8" is goals per game, unlabeled; the dumbbell adds nothing. **Instead:** one line: "Scored in 59% of home games, 53% away (this season: 2 of 2 home)". |
| **Opposing defence** ("Manchester United defence, goals allowed 1.75, 16 of 23") | "United concede a lot" | **merge into Matchup** | Sco | **"Of 23" in a 20-team league**: last season's relegated teams are in the ranking pool (F-B7). |
| **Head to head** ("vs Man United · 63% · 5 of 8") | "scored in 5 of 8 meetings" | **keep, polish** | — | A real sample. Show the meetings with scores and his goals. |
| **Season stats** ("ranked among Fs") | "4 goals in 4 games" | **fix + rework** | **Ren (bug)**, Sen | **Raw floats** ("xG 3.4237903356552124", F-B6). Only goals is ranked. "Fs" for forwards. **Instead:** goals, xG, shots, shots on target per 90 and minutes, formatted, ranked among forwards, season labeled. |
| **Goalkeeper page** (entire page) | none | **replace** | Sen | An empty page for a starting goalkeeper. **Instead:** a non-market profile (saves, goals conceded, clean sheets, xG faced, season and last 5), shown even when no book prices a keeper. |

## Soccer — team page (Manchester City)

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **"Contact quality matchup"** | "City's attack vs Sunderland's defense" | **rework** | **Nat (title)**, Sco, Ren | A **baseball Statcast term** on a soccer page; the game page calls the same card "Team matchup — attack vs. defense". Ranks "of 23". Truncated labels. |
| **Bar chart** ("4 games in scope · green cleared a win") | "won all 4" | **replace** | Nat, Enc | Soccer has three outcomes, and a win/0.5 bar can't show a draw. **Instead:** a W/D/L strip with scores. |
| **Team stats** (attack, defence, discipline, xG) | "City lead the league in goals and assists" | **rework** | Enc, Sco | Color follows rank without direction: **most fouls and most offsides are green** like most goals. "Reds/game 0.000". Pools mix "of 20" and "of 23". **Instead:** direction-aware color (fewer fouls = better), neutral color for style stats (fouls, offsides), one pool, season labeled. |
| **Standings** (W D L GD PTS) | "City 2nd, 12 pts" | **keep** | — | Native soccer table, current season. |
| **Next game** (card 1: "MNC ML 800 · SUN ML -340 · Total 2.5 O -175") | "City are huge underdogs at Sunderland" | **fix (suspected bug F-B9)** | **data likely wrong** | City (4-0-0, 2nd) at +800 vs Sunderland (1-1-2, 16th) at -340 looks like the two moneylines are swapped. Needs verification against a book. Also no draw price, which every soccer moneyline has. |
| **Next game** (card 2: "MNC @ SUN · 2026-09-20T13:00Z · No live line yet") | "next: at Sunderland" | **merge** | Dup, Ren | The **same "Next game" card twice** (E fact 8), and this one says there's no line while the other shows one. Raw ISO date. |
| **Rating history, Last 4 games, Roster, Form, Recent results, Game context, Line movement** | — | same as NFL | — | See the NFL team page. |

## Soccer — game page (Newcastle vs Leeds, pre-game)

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Matchup** ("Team matchup — attack vs. defense", both directions) | "Newcastle's attack vs Leeds's defense" | **rework** | Ren, Sco | Rank text collides with the next label ("4th of 2GOALS ALLOWED"), the same fault as NFL's. Two stats per side only. |
| **Records** ("NEW 1-2 · .333", "LEE 1-1 · .500") | "Newcastle have a losing record" | **fix (bug F-B8)** | **data wrong** | Newcastle are **unbeaten** (1W 2D 0L in the standings), but the card shows 1-2 and .333, so draws display as losses. Leeds shows 1-1 for the same 1W 2D. Home/away are dashes. **Instead:** W-D-L and points, home and away. |
| **Team stat comparison** ("2025 season") | "Newcastle scored more last season" | **rework** | Sco, Enc | Last season's stats, four games into the new one, labeled at least. Same color problem as the team page (more fouls green). **Instead:** this season with last season beside it until ~10 games in. |
| **Rankings** ("of 20 · 2025 season"), **Unit grades**, **Last 5**, **Injuries**, **Line movement**, **moneyline strip**, **Line shopping** | — | same as NFL | — | Plus: soccer's moneyline strip must show the **draw**. |

---

## CFB

**Player pages: blank** (QB Julian Sayin, WR Jeremiah Smith). "No tracked
markets for this player on today's slate" on a Sunday. Verdict for the page:
**replace the empty state.** A player page should always render the player:
headshot, position, season and career stats, game log, next game. Market cards
appear only when there's a market. This holds for every sport (see "Blank player
pages" below). CFB market-card verdicts wait for a live Saturday (build Phase 2).

**Team page (Ohio State):** the same cards as NFL's, including **"Contact
quality matchup"** (a baseball term, rework as for soccer), "NEXT GAME" twice,
Roster (100) alphabetical with initials. Same verdicts as NFL/soccer. College
football-specific **gaps:** AP/CFP ranking, conference record, strength of
schedule. The standings card should be the conference table, not a league-wide
one.

**Game page (Ohio State at Texas, final 23–24):** 10 cards, the thinnest
game page. The final box score is **stuck on "Loading live details…"** (F-B10),
the records show dashes, and there's no matchup, team stats, rankings or unit
grades, for a top-10 matchup. **Verdict: rework.** At minimum the box score,
team stats and the offense/defense matchup NFL has, plus both teams' rankings.

## NBA (offseason: pages judged as they render today)

**Player pages: blank** (Luka Doncic, Walker Kessler). Same verdict as CFB. In
the offseason the page should show last season, labeled.

**Team page (Lakers):**

| card | verdict | fails | what instead |
|---|---|---|---|
| **Team stats** (Offence/Defence/Rebounding, 12 counting stats) | **rework** | Nat, Enc | Box-score counting stats only. What basketball bettors use is **pace, offensive and defensive rating, net rating, eFG%, rebound%, turnover%**. Fouls "3rd of 30" green with no direction. "Offence/Defence" spelling. |
| **Standings** (all 0-0 · .000, GB, L10) | **rework** | Sco | In the offseason, show **last season's final standings**, labeled, with seeds and play-in lines. GB and L10 are right for the NBA. |
| **Untitled card: "No upcoming game scheduled."** | **replace** | Sen | The snapshot already has "The 2026-27 NBA season hasn't tipped off" and the first game date (build 1b). Say that, with the opener. |
| **Hero** ("0-0 · 0th seed, Eastern Conference in division") | **rework** | Sen | Build 1b. |
| **Bar chart (82 games), Rating history, Last 15, Situational splits, Home/Away, Roster, Form, Recent results, Game context, Line movement** | same as NFL | | |

**Game page (last season, MIN vs LAL):** **Matchup** has the same text collision
("7th of 3POINTS/GAME") and counting stats only; **Rankings** is mirrored
(F-B1); **Team stat comparison** is labeled "2026 season" for the 2025-26
season, which will read as the coming season within weeks. Basketball-native
gaps: **pace matchup, projected total from pace × ratings, rest days /
back-to-back, starters' minutes and injuries.** Live states: October.

## NHL (offseason)

**Player pages: blank** (Matthew Knies, Sergei Bobrovsky). Same verdict as CFB.
A goalie page especially needs save %, GSAx and starts.

**Team page (Toronto):**

| card | verdict | fails | what instead |
|---|---|---|---|
| **Hero** ("32-36 · Eastern in division") | **rework + bug** | Nat, Sen | **An NHL record needs overtime losses** (W-L-OTL); "32-36" drops them (F-B11). Conference passed as a division (build 1b). |
| **Team stats** (offence, discipline, defence) | **rework** | Nat, Enc | **"Saves/game 28.9, 1st of 32" in green**: the most saves means facing the most shots, a defensive weakness. "Hits 5th" green. Missing what hockey bettors use: **PP%, PK%, 5v5 xGF%, save %, shots for/against**. |
| **Standings, untitled "No upcoming game scheduled", Bar chart, Roster, etc.** | as NBA | | |

**Game page (last season, TOR @ DET, final 3–6):** 9 cards. **Team logos render
as blank white squares**, the box score is **stuck on "Loading live details…"**
(F-B10), and there's no matchup, team stats, rankings or goalie matchup. In
hockey the **starting goalies** are the single most important game-page fact,
and there is no card for them. **Verdict: rework**, goalie matchup first.

## Tennis (ATP; WTA spot-check)

**The whole tennis game page is a team-sport page with player names in the slots.**

**Player page (Zverev):**

| card | sentence | verdict | fails | what instead |
|---|---|---|---|---|
| **Hero** ("AZ", "@ Ben Shelton", 1:15 PM, aces O 24.5) | "Zverev vs Shelton, aces over 24.5" | **rework** | Ide, Nat, Sen | Initials, no headshot or flag. **"@" implies a home/away tennis doesn't have.** No ranking, tournament, round or surface. **Instead:** flag, ranking, tournament, round, surface, start time or live score by set. |
| **Bar chart** ("141 matches · green cleared over 24.5") | "never cleared" | **fix (suspected bug F-B12) + rework** | **data likely wrong**, Sco | Zverev's aces per match run ~5–21, the line is 24.5, and 0 of 141 cleared. The line looks like **total match aces (both players)** compared with his own. Also opens at the oldest match, no years. |
| **Surface** (Hard vs Clay: cleared 0% / 0%, aces 9.1 / 5.4) | "he serves more aces on hard courts" | **rework** | Nat | The right idea for tennis (C7), but **grass is missing**, and today's surface isn't marked. **Instead:** hard / clay / grass with match counts, today's surface highlighted. |
| **Opponent** (Shelton averages n=110: aces 9.8, games won 14.5, "To win a set 0.8") | "Shelton serves big too" | **rework** | Sen | "To win a set 0.8" is unexplained. **Instead:** serve and return stats that drive aces and games (1st-serve %, aces/match, return games won %), both players side by side. |
| **Head to head** ("0% · cleared 0 of 4", four **green** squares) | "never cleared vs Shelton" | **rework** | Enc | Squares are green while the headline says 0 of 4, so the colors must mean match wins. **Instead:** list the meetings with score, surface, and his aces. |
| **Game log** ("Last 15 games") | "his recent matches" | **rework** | Nat, Ide | Tennis plays **matches**. Rows show aces and games but **no result, score, tournament or surface**; empty avatar circles. |

**Game page (Shelton vs Zverev, final 1–3):**

| card | verdict | fails | what instead |
|---|---|---|---|
| **Hero + live panel** (flags, "AWAY"/"HOME", records 73-37 and 103-38) | **rework + bug** | Nat, Dup, Sco, Ren | **"Away/Home" labels** in tennis; the name text overlaps the flag (D1's fault); the panel repeats the hero. **Records "103-38" labeled "2026 season"**, far more matches than a player plays in a year (F-B13). |
| **By set** (3·6, 6(2)·7(7), 7·5, 2·6) | **keep** | — | Native and correct. |
| **Team stat comparison** ("Team", "Qualifying share 0.000") | **replace** | Nat, Sen | **Instead:** serve/return comparison (aces, double faults, 1st-serve % and points won, break points saved/converted), this season, plus on this surface. |
| **Unit grades** ("Results A / A+", "Game control B- / B+") | **remove** | Nat, Sen | Invented units for an individual sport. |
| **Injuries** ("0 players out", each name printed twice) | **replace** | Nat, Ren | **Instead:** fitness signals that exist for tennis: retirements/withdrawals this season, matches in the last 7 days, time on court last round. |
| **Rankings** ("of 349", FOR/AGN) | **remove + bug** | Nat, **data wrong** | Mirrored (F-B1). "Against" means nothing for one player. **Instead:** ATP/WTA ranking and Elo, overall and on this surface. |
| **Records** (Home / Away dashes) | **rework** | Nat | Season W-L, W-L on this surface, H2H by surface. |

---

## Every page

### Blank player pages (CFB, NBA, NHL, EPL goalkeeper)

**Seven of 22 player captures render one sentence.** The page exists only when a
book prices a market for today. **Verdict: replace.** A player page is about the
player first. Always render identity, season and last-season stats, game log,
next game, injury status. Market cards appear when there's a market. This alone
covers every blank page in Phase E, and it's the precondition for the
deep-history work in build Phase 7.

### The games strip (top of every sport page)

Fixed-width game buttons push every page wider than a 400px phone screen (E
fact 2), and the strip's sticky header covered card content in several crops.
**Verdict: rework.** Horizontally scrollable inside its own container, and the
sticky header must not overlap cards.

### Dark mode

The app has none (E fact 3). **Verdict:** not a card verdict; recorded for
Phase G as a product decision, not assumed.

### Interaction

76% of cards have no hover state (E fact 15). Charts don't show a value on
hover. **Verdict (all charts):** hover detail on every mark (game, date,
opponent, value, line, hit/miss), and a shared crosshair where two charts show
the same games. The chart library already has `useChartCrosshair` for this.

### Identity

Initials instead of photos on Last 5 games (every game page), rosters (MLB,
NFL, CFB), the soccer matchup, the NFL live panel and the tennis hero; soccer
player heroes show the club crest; NHL game logos render blank. **Verdict:** one
shared player-photo / team-logo resolver per sport, with a consistent fallback
(silhouette and team color, not initials).

---

## Correctness bugs found during Phase F

Data errors, not design judgments. They go to the build plan in Phase H.

| # | where | what | evidence |
|---|---|---|---|
| **F-B1** | Game page **Rankings** in **NFL, NBA, soccer and tennis** (not MLB) | The "AGN" (allowed) columns show the **opponent's "FOR" ranks**, not this side's defense. Every AGN column equals the other team's FOR column. Heat colors are therefore wrong too. MLB's is correct. | NFL: DAL AGN pass yds 21 but Matchup says DAL pass yds allowed **32nd of 32**. NBA: MIN AGN = LAL FOR. Soccer: NEW AGN = LEE FOR. Tennis: Shelton AGN = Zverev FOR. |
| **F-B2** | NFL game page, **Records** | Home and away records total 13 games each, more than an NFL season, under a 0-0 season record. | DAL Home 6-7 · Away 5-7; NYG Home 4-8 · Away 1-12 |
| **F-B3** | NFL team page, **bar chart** | Two seasons of games out of chronological order, no years. | 11/16 … 01/04, then 09/06 … 12/20 |
| **F-B4** | MLB pitcher page, **game log** | Totals all zero and every start row blank (no stat line, empty opponent logo). The bar chart above it has the same starts with real values. | Noah Cameron: "Strikeouts 0 · Walks 0 · Hits allowed 0 · Earned runs 0"; 9 empty rows |
| **F-B5** | MLB game and team pages, **Team stats / Team stat comparison** | Per-game stats rounded to integers, so different values display as equal. | KC vs BOS: R 4 / 4, H 8 / 8, BB 3 / 3, with bars of different lengths |
| **F-B6** | Soccer player page, **Season stats** | Unformatted floating-point numbers rendered. | Haaland: "xG 3.4237903356552124", "xA 0.6280249953269958" |
| **F-B7** | Soccer player, team and game pages, **rank pools** | Ranks "of 23" in a 20-team league: relegated teams from last season remain in the pool. Pools also differ between cards on one page ("of 20" and "of 23"). | Man United defence "16 of 23"; City team stats "1st of 20" beside "2nd of 23" |
| **F-B8** | Soccer game page, **Records** | Draws shown as losses (or dropped), producing a losing record for an unbeaten team. Related to build-plan 1b's soccer header. | Newcastle 1W 2D 0L in standings → "1-2 · .333"; Leeds 1W 2D 0L → "1-1 · .500" |
| **F-B9** *(suspected)* | Soccer team page, **Next game** | Moneylines likely assigned to the wrong teams; no draw price. Verify against a book before fixing. | Man City (1st-2nd, unbeaten) "ML 800" at Sunderland (16th) "ML -340" |
| **F-B10** | CFB and NHL game pages, **final box score** | Stuck on "Loading live details…" for completed games. NHL's team logos also render blank. | Ohio State @ Texas 23–24 final; TOR @ DET 3–6 final |
| **F-B11** | NHL team page, **hero record** | Overtime losses dropped from the record (W-L instead of W-L-OTL). Same family as soccer's draws (F-B8, build 1b). | Toronto "32-36" |
| **F-B12** *(suspected)* | Tennis player page, **aces line vs history** | The line appears to be total match aces while the history is the player's own aces, so nothing ever clears. Verify the market definition before fixing. | Zverev aces O 24.5; 0 of 141 matches, 0 of 4 H2H; his per-match aces ~5–21 |
| **F-B13** | Tennis game page, **Records** | Multi-season win-loss labeled "2026 season", and inconsistent with the card's own win % (73-37 = .664, shown beside a 0.717 match win %). | Zverev 103-38, Shelton 73-37 |
