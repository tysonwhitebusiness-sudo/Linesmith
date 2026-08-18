# UX Research Notes — PickFinder & Linemate

**Audited**: 2026-08-10 / 2026-08-11 via Playwright, live DOM + computed styles.
**Supersedes** the earlier shallow pass. Every value below was read off the live
page (`innerText`, `getComputedStyle`, `getBoundingClientRect`), not inferred.

**Scope reminder**: this documents *information architecture, data density and
interaction behaviour*. Linesmith reproduces none of the visual design, palette,
logos, icon artwork or copy of either product. Colours recorded here are recorded
in order to understand the *encoding rules* (what green means, where the
thresholds sit), which Linesmith then re-expresses in its own Masters
green/white language.

---

## 0a. PickFinder props table — `pickfinder.app/props`

### Column list, left to right

Read directly off `thead th`:

```
Line │ Apps │ IP │ DVP │ Avg L10 │ Diff │ L5 │ L10 │ L15 │ H2H │ Strk │ SZN
```

Twelve columns, single header row, no grouped sub-headers.

| # | Column | Value type | Empty / unavailable state |
|---|--------|-----------|---------------------------|
| 1 | Line | Composite identity cell (see below) | n/a — always populated |
| 2 | Apps | Book chips, each O and U price stacked | omitted entirely when no book prices |
| 3 | IP | Implied probability, `O61.5%` over `U38.5%` | **blank cell** (not a dash) |
| 4 | DVP | Ordinal defensive rank vs position, e.g. `15th` | literal `N/A` |
| 5 | Avg L10 | Raw decimal average, e.g. `16.3`, `0.6` | — |
| 6 | Diff | Signed absolute delta + signed percentage | — |
| 7 | L5 | Hit-rate % | `-` |
| 8 | L10 | Hit-rate % | `-` |
| 9 | L15 | Hit-rate % | `-` |
| 10 | H2H | Hit-rate % **plus fraction beneath** | `-` |
| 11 | Strk | Signed integer | `-` |
| 12 | SZN | Season hit-rate % | `-` |

### The Line cell's internal composition

Observed raw cell text (`|` marks a line break):

```
Gunnar Henderson | (SS) | BAL @ MIN | 0.5 | Runs
Alyssa Thomas    | (F)  | PHX @ LA  | 24.5 | Pts+Asts
mhL              |      | WC vs FURIA | 12.5 | Map 1 Kills
niu              | (Offlane) | Team Resilience vs VSN | 7 | Maps 1-2 Kills
```

Stacking, top to bottom:

1. **Row 1** — avatar (with a favourite/star affordance), player name, position in
   parentheses as a smaller muted token, then the matchup (`BAL @ MIN`, `WC vs
   FURIA`) at the same reduced size.
2. **Row 2** — a small market icon, the **line number** at the row's largest
   weight, then the **market name** in normal weight.

The position parenthetical is optional (esports rows without a position simply
omit it). Relative type sizes: player name is the dominant element; line number
matches it in weight; matchup and market name sit a step down and muted.

### Apps cell

Multiple book chips render side by side, each chip showing that book's O and U
prices **stacked vertically**:

```
[prizepicks] O-119   [underdog] O-146   [dabble] U+119   +2
             U-119              U-102              (one-sided)
                                                   ⌐ "Show 2 more apps"
```

- A book offering only one side shows only that side (`dabble U+119`,
  `fanduel O-160`) — it does not pad with a placeholder.
- Overflow is a **`+N` chip** whose accessible name is `Show N more apps`.
  Observed values: `+1`, `+2`, `+3`, `+6`.
- Chips **are interactive** — each is a `button`, and on the detail page the
  equivalent chips are `<a>` deep links into the book's event page.

### IP cell — when it populates

`O61.5% / U38.5%` stacked, both sides always summing to 100% (vig removed).

It is **blank, not dashed**, on every esports row observed. It populates on every
row that has a two-sided price from at least one book. Rule: IP is derived from
the displayed odds, so no two-sided price ⇒ no implied probability ⇒ empty cell.

### DVP cell — when it has a value

`N/A` on 7 of 8 observed rows. The one populated instance was a WNBA row
(`Alyssa Thomas`, `15th`). It is an **ordinal league rank** of the opponent's
defence against that position. Populated only where a positional-defence model
exists for that sport/market; MLB rows showed `N/A`.

### Avg L10 and Diff

- **Avg L10** is a bare decimal average of the stat over the last 10 games
  (`16.3`, `13.8`, `0.6`, `1.1`, `24.9`).
- **Diff** stacks two values: absolute delta then percentage delta.
  Observed: `3.8 / +30.4%`, `6.8 / +97.1%`, `7.2 / +120%`, `0.1 / +20%`,
  `-0.4 / -26.7%`, `0.7 / +6.1%`, `0.4 / +1.6%`.
  The percentage is `delta ÷ line × 100`.

### ✅ Does Diff use a different colour scale than the rate columns? — **Yes, definitively.**

Computed `color` values prove it:

| Diff value | Colour | |
|---|---|---|
| `+120%` | `rgb(110 231 183)` | green |
| `+30.4%` | `rgb(110 231 183)` | green |
| `+6.1%` | `rgb(110 231 183)` | green |
| **`+1.6%`** | **`rgb(110 231 183)`** | **green — same as +120%** |
| `-26.7%` | `rgb(252 165 165)` | red |

A `+1.6%` delta renders in exactly the same green as a `+120%` delta. **Diff is
coloured binary, by sign only** — there is no magnitude ramp. This is a different
rule from the hit-rate columns, which do ramp by magnitude (below).

### Hit-rate columns — exact heat map

Computed `color` per observed value, deduplicated:

| Observed values | Colour | Bucket |
|---|---|---|
| 100%, 93.3%, 80%, 73.3%, 70% | `rgb(110 231 183)` emerald | **≥ ~65% — green** |
| 60% | `rgb(253 224 71)` yellow | **~55–65% — yellow** |
| 50% | `rgb(209 213 219)` grey-300 | **~50% — neutral grey** |
| 46.7%, 43.8%, 41.7%, 40%, 38.2% | `rgb(253 186 116)` orange | **~35–50% — orange** |
| 33.3%, 30%, 26.7%, 20%, 0% | `rgb(252 165 165)` red | **< ~35% — red** |
| `-` (insufficient) | `rgb(156 163 175)` grey-400 | **insufficient — dimmer grey** |

Five discrete buckets, not a continuous gradient. Note the midpoint is **neutral
grey**, not amber — a 50% rate is treated as "no signal" rather than "middling
strength".

### ✅ The insufficient-sample cell — **definitively a plain dash, never a partial fraction.**

This is the single most important finding for Phase 1. Real rows:

| Row | L5 | L10 | L15 | H2H | SZN |
|---|---|---|---|---|---|
| mhL (esports) | 100% | 100% | 93.3% | **`-`** | **`-`** |
| BerLIN (esports) | 100% | 80% | **`-`** | **`-`** | **`-`** |
| Emerson Jones (tennis) | 60% | 70% | 73.3% | 0% · 0/1 | **`-`** |

`BerLIN` is the decisive case: L5 and L10 both resolve to real percentages, and
**L15 falls back to `-`** because fewer than 15 qualifying games exist. It does
**not** render `8/10`, does **not** render a scaled percentage, and does **not**
render a greyed-out number. It renders a dash in `rgb(156 163 175)` — visually
distinct from both the low-rate red and the neutral-50% grey.

Windows are evaluated **independently**: the same row simultaneously carries a
valid L10 and an insufficient L15.

### When does the supporting fraction appear?

Only in **H2H**. Observed: `43.8% / 7/16`, `33.3% / 1/3`, `0% / 0/1`, `40% / 4/10`.
Never in L5/L10/L15/SZN.

The rule: **columns with a fixed window (L5/L10/L15) have a known denominator, so
showing it is redundant. H2H has a variable denominator, so it must be
disclosed** — otherwise `0%` from a single meeting reads identically to `0%` from
twenty. Note `0/1` and `1/3` are shown rather than suppressed: PickFinder
discloses the thin sample instead of hiding the column.

The player-detail page applies the same rule — its H2H box reads `HR 47% / 17G
0.47`, disclosing the 17-game denominator, while its L5/L10/L15 boxes do not.

### Strk column

Signed integers, and it **is** heat-coloured (contradicting the earlier notes):

| Value | Colour |
|---|---|
| 10, 5 | `rgb(110 231 183)` green |
| 2 | `rgb(190 242 100)` lime |
| 1 | `rgb(253 224 71)` yellow |
| -1, -3 | `rgb(252 165 165)` red |

Coloured by sign **and** magnitude — a longer positive streak is greener.

### Sticky behaviour

Measured on the live DOM:

- `thead` — `position: sticky; top: 0; z-index: 10`, with an **opaque**
  background (`rgb(2 5 24)`, the page's own dark surface). Header pins on
  vertical scroll. ✅
- First column `td` — `position: relative; left: 0`. **Not sticky.** PickFinder
  does *not* pin the Line column during horizontal scroll.
- Scroll container is the table's parent `div.overflow-auto` (both axes on that
  one element).

> Linesmith deliberately diverges here: update-07 makes the first column sticky
> on horizontal scroll, which PickFinder does not do. This is an improvement
> over the reference, not a copy of it, and matters far more on a phone.

### Sort behaviour

Every column header is a `button`. The active sort header carries a numbered
badge whose accessible name is **`Sort priority 1, clear sort`** — so sorting is
**multi-column with explicit priority ordering**, and clicking a header a third
time clears it rather than cycling endlessly. Default sort on load was `L10`
descending at priority 1.

### Filter bar

Eight controls, horizontally scrollable, above the table:

`Modifier · Stats · Games · Date · Teams · Min/Max Odds · Hit Rate · Alt Lines`

All render as dropdown-opening buttons. `Date` / `Min/Max Odds` / `Hit Rate`
carry more descriptive accessible names than their visible labels (`Game date
filter`, `Odds filter`, `Hit rate filter`). On the anonymous tier several are
`[disabled]` — the shown-but-disabled pattern, not hidden.

Alongside: a `Search players...` textbox (filters the table live, client-side),
an **`Apps` selector** button, and a `Filter presets` button.

### The Apps selector

Top of the filter area, label reads `Apps prizepicks underdog fliff + 20`. It is
both selector and active-state indicator: the selected book names are printed
into the button label itself, with a `+ N` overflow. It controls **globally**
which books' prices appear in every row's Apps column.

### Pagination

Footer: `Previous page` / `Page 1 / 1` / `Next page`, plus a `Rows` per-page
combobox. Not an infinite scroll.

---

## 0b. PickFinder player/prop detail

Route pattern:
`/players/mlb/{playerSlug}?from=all&prop={eventId}:{marketKey}:{gameId}:{line}`

The market and line are **in the URL** — a row click deep-links to that player
*and that specific market at that specific threshold*.

Transcribed from `Gunnar Henderson` / `player_runs` / `0.5`.

### Header

`Back` link → avatar + team logo → `Gunnar Henderson` with `SS` position token and
a `RHP / LHB` handedness token → subheading `BAL @ MIN • Tue @ 6:40PM`.

### Sportsbook offer row

A horizontal row of book cards. First card is PickFinder's own implied-probability
card (`O61.5% / U38.5%`); the rest are books, each carrying a **bonus badge above
the card** and that book's prices:

```
  [pf]        $50            $75           $25          $150
 O61.5%   [prizepicks]   [underdog]    [dabble]     [fanduel]
 U38.5%     O-119          O-146         U+119        O-160
            U-119          U-102
```

### Market tab row

Horizontally scrollable, one tab per available market, active tab carries a
**count badge**. Full observed set for a batter:

```
PA · HITS · RUNS(1) · RBIS · H+R+RBI · 1B · 2B · 3B · HR · BASES · STEALS ·
CAUGHT · BB · HIT SO · HBP · P SEEN · STRIKES · 1ST P SEEN · 1ST STRIKES ·
FP (PP) · FP (UD)
```

The `1` badge on the active `RUNS` tab is the count of priced lines in that market.

### Selected-market panel

- **Heading** — the market name (`Runs`).
- **Line stepper** — an ARIA `group` named `Line Controls` containing
  `[−] [spinbutton "0.5"] [+]`. It is a real spinbutton, so the threshold is
  directly editable, not only steppable.
- **Odds chip beside it** — the best book's O/U with a `+3 / Show 3 more apps`
  overflow, wrapped in an `Unlock alt lines` gate.
- **Favourite star** to the right.
- **Contextual filter dropdowns** — `Opponent` · `Season` · `Home/Away` · `Team`,
  each defaulting to `All`, plus an advanced-filter icon button.

### Window summary boxes

Five buttons, each two-line:

| Box | Line 1 | Line 2 |
|---|---|---|
| L5 | `HR 40%` | `Avg 0.60` |
| L10 | `HR 30%` | `Avg 0.50` |
| L15 | `HR 33%` | `Avg 0.53` |
| 2026 | `HR 42%` | `Avg 0.54` |
| **H2H** | `HR 47%` | **`17G 0.47`** |

Every box shows hit rate **and** the average value for that window. H2H
additionally prints its **game count** (`17G`) because its denominator is
variable — the same disclosure rule as the table's H2H fraction. The season box
is labelled by year (`2026`), not `SZN`.

### Distribution chart

One bar per game in scope. X-axis labels are **opponent + date**, with the
home/away prefix baked into the opponent token:

```
PHI 7/31 · PHI 8/1 · PHI 8/2 · LAA 8/4 · LAA 8/5 · LAA 8/6 ·
@TEX 8/7 · @TEX 8/8 · @TEX 8/9 · @MIN 8/10
```

Bars carry their value as a label; a dashed horizontal threshold line sits at the
current line value; bars are coloured by whether they cleared it.

### Supporting Stats block

A second charted block below the main chart, with its own tab row where each tab
prints the stat's average in the tab itself:

`Plate Appearances 3.9 avg.` · `Hits 0.3 avg.` · `Batter Walks 0.9 avg.` · `RBIs 0.2 avg.`

Its chart shares the same x-axis (opponent + date) and prints a per-bar value row
(`4 4 2 4 4 4 4 4 5 4`).

### Gamelog table — `Gamelog - Last 15 Games`

`Date` · `Opponent` · then **21 market columns**, every one a sortable button:

```
PA · Hits · Runs · RBIs · H+R+RBI · 1B · 2B · 3B · HR · Bases · Steals ·
CAUGHT · BB · Hit SO · HBP · P Seen · Strikes · 1st P Seen · 1st Strikes ·
FP (PP) · FP (UD)
```

Every cell is the raw stat value for that game. The `Opponent` cell carries a team
logo plus the `@TEX` / `LAA` token (the `@` encoding away). Dense, wide,
horizontally scrollable. Column set is exactly the market-tab set — the gamelog is
the tab row transposed into columns.

### Right sidebar

1. **`Line Movement` / `Prop History` tabs.** The Line Movement table is
   `Line │ App │ Time` — observed row: `0.5` │ *(book combobox: prizepicks O-119
   U-119)* │ `8/10 10:19PM`. Movement history is a real time series with a
   book selector per row.
2. **Secondary card grid** — `Matchup` (active) plus three `[disabled]`
   lock-gated tabs (`Pitch Arsenal` among them). Inside Matchup, a nested tab row:
   `Odds` (active) · `Lineups` · `Weather` · `Rankings`, the latter three gated.
3. **Win Predictor** — both teams with logo, abbreviation, record and win
   probability: `BAL 57-61 48%` / `MIN 58-61 52%`.
4. **Matchup Odds** — per team, three deep-linked rows:
   `ML -102` · `Spread -1.5 +157` · `Total 9.5 O+100 / U-120`, each with a book
   icon and an outbound URL to that book's event page.
5. **`Regular Season Averages` accordion** — collapsible sections
   `2026 Averages (118 GAMES)` · `2025 Averages (154 GAMES)` ·
   `2026 Home Averages (62 GAMES)` · `2026 Away Averages (56 GAMES)` ·
   `vs MIN (4 GAMES)`. Each expands to a grid of stat cards showing the stat name,
   its average (`PA 4.53`, `Hits 0.86`, `Runs 0.58`) and either the book icons
   that have a line on it or the text **`No lines`**. Every section discloses its
   game count.

---

## 0c. Linemate game summary — `linemate.io/mlb/summary/20260810-BAL-MIN`

Route: `/{sport}/summary/{YYYYMMDD}-{AWAY}-{HOME}`.

### Top bar

Single row: sport selector (`MLB`) at far left, centred primary nav
`Home · Trends · Tools ▾` as plain text items, right-side utilities
(`Log in`, `Start free trial`; for authed users, search / saved picks / theme).
`Tools` is a dropdown holding secondary views rather than more top-level tabs.

### Left rail

`Game Summary` heading with a filter icon, then a `Player | Team | SGP`
segmented control (underlined text, not filled pills), then the scrolling
candidate list.

Per candidate row:

```
[avatar] C. Martin                                    -120  [book icon]
         vs BAL
         Under 1.5 H+R+RBI

  ⚡ Hit in 11 of last 12 games                                    92%
  🛡 Hit in 2 of last 2 games vs BAL                              100%
  📍 Hit in 9 of last 10 home games                                90%
```

Market phrasing is always `{Over|Under} {threshold} {Stat Name}`. Matchup is
`vs XXX` / `@ XXX`. Sorted by strength of pattern, not alphabetically.

### ✅ The semantic icon vocabulary — read off the `alt` attributes

The signal type is literally encoded in each icon's accessible name:

| `alt` (semantic type) | asset | Concept |
|---|---|---|
| `RECENT_FORM` | `bolt.svg` | lightning bolt |
| `HEAD_TO_HEAD` | `shield.svg` | shield |
| `HOME_SPLIT` | `location-filled.svg` | map pin |
| `AWAY_SPLIT` | `location-filled.svg` | **same map pin** |
| `WEATHER` | *(weather glyph)* | cloud / wind |

Observed elsewhere on the site: opponent-defensive-rank lines
(`PHI rank poorly in Singles against — 27th`) and weather narrative lines
(`Partly cloudy day with winds blowing out — 7MPH`).

**Consistency**: the same glyph set is applied identically across game-page rows,
homepage trending cards, and Opponent-Rank cards. Home and away deliberately
**share one glyph** — the pin means "venue split", and the text says which.

**Size and weight**: icons render at **16×16** in every context. The label text
is `12px / 500 / rgb(96 100 108)` (muted); the percentage is `12px / 500 /
rgb(28 32 36)` (near-black). The percentage is *darker*, not bolder or larger —
the icon carries the type, colour carries the emphasis, and the number stays the
element the eye lands on.

### Main column — section order

1. **Matchup information** — both teams with logos, `Record: 57-61`,
   `Division Rank: 4th`, `Monday August 10・6:40 PM`,
   `Target Field, Minneapolis`, then a **written conditions narrative**:

   > "Monday night's game at Target Field will feature partly cloudy skies and
   > warm temperatures. Winds will remain relatively calm throughout the game.
   > Overall, weather will have a minimal impact."

   Three sentences: conditions → wind → net effect on the game.

2. **Records** — `Season | Last 5 | Head to Head` segmented control over a
   three-column table (`away value │ stat label │ home value`):

   | BAL | Type | MIN |
   |---|---|---|
   | 57-61 | Overall | 58-61 |
   | 32-30 | Home | 30-27 |
   | 25-31 | Away | 28-34 |

3. **Team stat comparison** — rendered as **opposing horizontal bars**, confirmed
   in the DOM as `div.horizontal-comparison-bar-wrapper` containing a
   `horizontal-comparison-bar-text-wrapper` and an `odd-graph` bar element.
   Carries a `Filter by game` control. Full stat list, in order:

   ```
   R · H · 1B · 2B · 3B · TB · ER · HR · RBI · BB · SO · E · AVG · OBP · SLG · OPS
   ```

4. **Last 5 Games** — per team, W/L chips with score and date:
   `08/09/26 W 10-5` · `08/08/26 L 1-5` · `08/07/26 L 1-2` · …

5. **Rankings** — ordinal league rank, `FOR` (away) and `AGAINST` (home) columns,
   **the same 16-stat list** as the comparison:
   `R 15th/25th` · `H 26th/22nd` · `1B 28th/19th` · … · `OPS 19th/25th`.

6. **Injuries** — one table per team: `Player │ Position │ Injury │ Status`.
   Observed statuses: `60-Day IL`, `10-Day IL`, `15-Day IL`, `7-Day IL`,
   `Day-To-Day`, `Developmental List`. Injury values are body parts
   (`Shoulder`, `Elbow`, `Oblique`, `Hand`, `Knee`, `Back`, `Lat`, `Hip`, `Foot`)
   or `Undisclosed` / `Not Injury Related`.

### Right sidebar

```
My Picks   0
Add to My Picks
  MONEYLINE   BAL -102      MIN +100
  SPREAD      BAL -1.5 +163 MIN +1.5 -167
  TOTAL       O8.5 +106     U8.5 -108
```

Below it: 16 sportsbook promo units (Caesars, BetMGM, FanDuel, …, Linemate+).
**Explicitly not replicated** — recorded only so they are not mistaken for part
of the picks-panel pattern.

### Row selection

The main pane swaps **in place**, client-side. The page-level URL is the game
(`/mlb/summary/20260810-BAL-MIN`); prop selection does not navigate away from it.

---

## 0d. Linemate homepage — `linemate.io/mlb`

### Today's Matchups

Grid of game cards, each `AWAY / "Today" / time / HOME` with both logos.
Nine games observed with a `Show more` affordance and an `Aug 10` date chip.

### Trending today / Most bet on

Toggle between two feeds. Each card: headshot + team logo, player name,
`vs PHI` / `@ LAD`, `Over 3.5 Strikeouts`, American odds, book icon, then 2–3
insight bullets — including a **weather narrative** in the bullet list itself:

```
H. Dobbins · vs PHI · Over 3.5 Strikeouts · +100
  ⚡ Hit in 8 of last 8 games                          100%
  📍 Hit in 4 of last 4 home games                     100%
  🌤 Partly cloudy day with winds blowing out          7MPH
```

Note the weather bullet's right-aligned slot holds a **magnitude with a unit**
(`7MPH`), not a percentage — the layout is "icon + text + right-aligned figure",
where the figure is whatever that signal measures.

### Cheatsheets — "Props that hit in 100% of games"

Six parallel cards, each listing `Player: Market` with a right-aligned `X/Y`
fraction, with carousel arrows:

| Card | Example entries |
|---|---|
| 100% Recent Form | `A. Painter: Over 2.5 Strikeouts — 9/9` |
| 100% Versus Opponent | `C. Carroll: Over 0.5 Hits — 7/7` |
| 100% Alternate Lines | `J. Merrill: 1+ H+R+RBI — 16/16` |
| 100% Home/Away Games | `B. Elder: Over 17.5 Pitcher Outs — 10/10` |
| 100% Team Form | `TB: Moneyline — 6/6` |
| 100% Unders Only | `C. Narvaez: Under 0.5 Runs — 20/20` |

The fraction is always `n/n` — the denominator is the streak length, which varies
per entry, so it is always disclosed. Same rule as H2H.

### Advanced Tools — Opponent Rank

Adds two bullet types on top of the standard set:

```
J. Walker · vs PHI · Over 0.5 Singles · -118
  ⚡ Hit in 8 of last 10 games                          80%
  📍 Hit in 4 of last 5 home games                      80%
  📊 PHI rank poorly in Singles against                27th
  🌤 Partly cloudy day with winds blowing out          7MPH
```

The defensive-rank bullet's right-aligned slot holds an **ordinal** (`27th`,
`30th`) — again, "whatever that signal measures".

### Parlay cards

Game header, then 2–3 legs each with market and price, and a footer stat of the
form "each leg hit in at least X of last Y games — Z%".

---

## Decisions carried into Linesmith

| Question | Answer | Applies to |
|---|---|---|
| Insufficient-sample rendering | **Plain dash, dimmer grey. Never a partial fraction, never a scaled %, never heat-coloured.** | Phase 1, `HitRateCell` |
| Windows evaluated together or separately? | **Separately** — valid L10 alongside insufficient L15 on one row | Phase 1 |
| When to show the supporting fraction | **Only when the denominator is variable** (H2H, streaks, season-to-date). Fixed windows suppress it. | `HitRateCell` |
| Diff colour scale | **Binary by sign** — `+1.6%` is as green as `+120%`. Distinct from the rate ramp. | `DeltaCell` |
| Rate colour scale | Five buckets: ≥65 green · 55–65 yellow · ~50 neutral grey · 35–50 orange · <35 red | `HitRateCell` |
| Streak colour scale | By sign **and** magnitude | Scan table `Strk` |
| Insight icon size | 16px, muted; label muted, figure darker not bolder | `InsightRow` |
| Home vs away glyph | **One shared pin glyph**; the text disambiguates | `InsightRow` |
| Right-aligned figure in an insight row | Not always a percentage — may be a unit magnitude (`7MPH`) or an ordinal (`27th`) | `InsightRow` |
| First column sticky on horizontal scroll | PickFinder does **not** do this; Linesmith **will** (spec'd, mobile-critical) | Phase 4 |
| Sort model | Multi-column with numbered priority; third click clears | Phase 4 |
| Prop deep-link | Market **and** threshold live in the URL | Phase 5 |
