# Game page mockup (2026-09-26) — for the operator's review (D16)

Open: `http://localhost:8125/game-page/` (the `design-mockups` launch entry
serves `docs/design/`). The bar at the top picks the sport, the state
(pregame, live, final) and the width (desktop, phone 390, or **All heroes**:
every sport's hero in every state stacked, for comparing the frame).

Nothing here is built into the app. The only app change so far is the dev-only
MLB replay (`?replay=`), which is how the MLB live page was captured.

## Where the data comes from

Every page is a real `/api/game-research` payload run through the app's own
adapter (`toGameResearchData`), so every section is what the app would show
today. `raw/` holds the payloads; `capture.sh` fetched them; `build-data.ts`
turns them into `data.js`.

| sport | pregame | live | final |
|---|---|---|---|
| MLB | CIN @ TOR, replayed at 20:00 UTC | the same game, replayed at the Top 5th | the same game |
| NFL | LAC @ BUF, Sunday | ATL @ GB **cut** at Q3 5:41 | ATL @ GB |
| CFB | OU @ UGA | TEX @ TENN, captured live | UTSA @ TEX |
| NBA | OKC @ LAL as it stood at the start | OKC @ LAL **cut** at Q3 4:44 | OKC @ LAL |
| NHL | PIT @ BUF (preseason) | BOS @ WSH **cut** in P3, on a power play | BOS @ WSH |
| Soccer | NYC @ ATL (MLS) | LIV @ BOU **cut** at 70' | LIV @ BOU (EPL) |
| Tennis | a finished match as it stood at the start | Selekhmeteva v Grabher, captured live | Pavlovic v Muller |

A **cut** page is a finished game stopped at a real play, because nothing in
that sport was live while this was built. Plays, win probability, drives,
events and the score stop at that play. Box scores and team stats can't be cut,
so they still read as the final. Each cut page says so in a yellow note.

## Built on the app's own design (checked 2026-09-26)

The mockup is meant to be copied into the build 1:1, so its shared parts were
measured against the real game page (`/mlb/game/822760` on :3001, computed
styles) and changed to match:

- **Type:** Barlow Condensed for section and card titles, team and player
  names, and the hero's scores; Roboto Condensed for everything else. Sizes
  are on the app's ramp (11 overline, 12 label, 13 body-sm, 14 body, 16 card
  title, 17 title, 22 heading, 32 display).
- **Colours:** the `app/globals.css` palette values exactly; charts use
  `components/charts/tokens.ts` inks and grid, and pitch types use its
  `CATEGORICAL` six.
- **Header:** the app's TopBar and game strip. Only this game is in the
  mockup's data, so the other slots in the strip are grey placeholders.
- **Section header** (`SectionBand`): charcoal left line that runs to the page
  edge, uppercase title, muted sub-text, and the kit's Hide button with its
  chevron. The **section nav** (`SectionNav`) uses underlined tabs over the
  dark rule.
- **Cards** (`Card`): 44px header, uppercase 16px title, a ringed count badge,
  the scope on the right, and a 12px caption.
- **Tables** (`DataTable`): 34px header band, 36px rows (28 compact), 14/12px
  cell padding, the first column in ink, the rest secondary.
- **Card controls:** view switches are the `SegmentedToggle`; spray-chart team
  filters are `Chip`s, with Hit/Out as a plain key; the props status is
  `StatusMark`; W/L marks are `ResultMark`; hero chips are `Chip` `onColor`;
  the tooltip is the kit's.
- **Hero band:** the player hero's gradient (115°, stops at 0/60/100%) and its
  crest watermark at 14% opacity.

**New, not in the app yet: APPROVED by the operator 2026-09-26**, with one
change: *a team is marked by its logo, not a colour dot.* The mockup now
does this in rows, row notes and the line score. A dot stays only where it
is a chart's key, because the chart's own marks are drawn in that colour
(the spray chart's team filters carry the logo and the dot).

- **Score size:** the hero's scores are 64px (40px on phones), above the ramp's
  largest step (32px). The build would add one step for a scoreboard score.
- **Surfaces:** the spray chart's grass, dirt and warning track, the NBA
  court's wood and the rink's lines are richer than the flat
  `SURFACE_TINT` grounds the app has. These would become new chart tokens.
- **Team colour in cards:** team-coloured bars, dots and row stripes in the
  box score, props tracker, team stats and play-by-play. The rule that colour
  comes from the teams already allows this; this is the first time the app
  would do it inside cards.

## What changed, to review

**Hero (the main change).** One card whose centre changes with the game:
- **Band:** each team's colour on its half, a slanted seam, big crests and
  watermark logos. When two teams wear the same colour (TEX/TENN,
  LIV/BOU), the away half takes its second colour, or charcoal.
- **Centre plate:**
  - pregame: start time and a countdown
  - live: the situation (MLB bases, count and outs; football down and
    distance with the ball on; NBA/NHL clock with the run or power play;
    soccer minute; tennis set grid)
  - final: "Final" with the decisions
- **Moment row:** MLB live has batter vs pitcher with headshots and this
  plate appearance's pitches; MLB pregame has the probables with their last
  six starts and pitch mix; MLB final has W/L/SV and top performers.
  Football live has a field strip with the ball and the first-down line;
  football final has leaders; NBA final has top scorers; NHL live has shots
  on goal and the last event; soccer has scorers under each team.
- **Line score** with the current period marked.
- **Win probability** as a two-colour bar plus a small two-colour chart.
  Finals show how it went, not a pinned 100%. NHL shows shots on goal and
  soccer shows possession, since neither sport has win probability.
- **Lines:** open, close and live, with results at the final ("CIN +1.5
  covered").
- **Facts strip:** venue, weather icon, park (roof, turf, dimensions), start
  time.

"The game now" label/value table is gone; the hero says all of it.

**Cards.**
- **Section headers and nav:** unchanged; the app's own (left bar, uppercase title, underlined tabs).
- **Win-probability, lead and moneyline charts:** show both teams, each side
  of 50% (or of tied) filled in that team's colour, ending in "TOR 18% / CIN
  82%".
- **Spray chart:** drawn with the park's own walls from MLB's field
  dimensions, on turf or grass; hits are filled and outs are rings, in team
  colours.
- **Props tracker:** a so-far-vs-line bar in the team colour, and a ✓ Over
  mark.
- **Team stats:** mirrored bars, one team each side.
- **Box scores:** each team's own colour, with the column leader marked.
- **Play-by-play:** grouped by inning or quarter, with scoring plays shaded
  in the scoring team's colour.
- **Form:** W/L columns sized by margin, with the opponent's crest.
- **Longest balls:** distance and exit-velocity bars.
- **Drive chart and soccer timeline:** in team colours.
- **Pitch colours:** each pitch type keeps one of the app's six categorical hues on every card (sweeper shares slider's, knuckle curve shares curve's, splitter shares changeup's; rarer pitches are grey).
- **Odds section:** unchanged (P8 has its own approved design), shown as a
  placeholder.

## Not drawn, because we don't hold it

- Tennis: who is serving and the point score.
- NBA: fouls and the bonus.
- NHL and soccer: player headshots (NHL ids don't map to ESPN photos).
- Most tennis headshots (ESPN has none; they're hidden, not broken).

## Questions for the operator

1. Hero: is the split band plus centre plate the direction, or should one
   colour lead?
2. MLB live: keep the at-bat face-off in the hero, or move it into "Right
   now"?
3. Pregame: countdown, probables and lines, enough or more?
4. Which card treatments to keep for the build (the list above)?
