# Phase C — Per-sport card-sense audit

**Status: COMPLETE 2026-09-13.** Log-only; nothing was changed.
**Golf held** at operator instruction until a live tournament.

The question this phase answers: *does each sport's card set make sense in that
sport's context* — not "is it populated", which was Phase B.

Verdicts used: **fits** · **port artifact** · **wrong metric** · **starved** ·
**shouldn't exist here**.

---

## The headline is not what the plan expected

The plan went in on the hypothesis that an MLB-shaped grid was being squeezed
into every sport. That is **true at the snapshot/API layer** (Phase B3, B4) and
**largely false at the adapter layer**. TeamDetail and GameDetail are genuinely
well-unified; PlayerDetail has two real defects and a lot of dead ceremony.

The bigger finding is the opposite shape: **cards that already exist, already
have data, and are simply not wired to the sports that could use them.**

---

## C1 — One card, two fields, both named after a sport ◆ PORT ARTIFACT ◆ HIGH

`PlayerDetailData` carries two fields that render the same "season stats" card:

| field | set by | writes `null` |
|---|---|---|
| `hitterStats` | **MLB only** | nfl, nba, nhl, cfb, soccer, tennis, golf |
| `nflSeasonStats` | **nfl, cfb, nba, nhl, soccer** | mlb, tennis, golf |

`nflSeasonStats` is not an NFL card. It is **the generic season-stats card for
five sports**, still carrying the name of whichever one was ported first. MLB
does the same job under a baseball name and writes `null` to the other.

This is precisely the pattern `CLAUDE.md` §4 warns about, and the file already
records the *placement* half of this exact case being fixed — NFL's season-stats
card was moved from the main column into the context rail to match MLB's, once
someone looked at the two pages side by side. **The two fields were left
behind.** The verdict §4 asks for: the sports do not differ in the data.

## C2 — Twenty-eight lines of "I am not golf" ◆ SHOULDN'T EXIST HERE ◆ LOW

Four golf-only fields are explicitly written `null` by **all seven** non-golf
player adapters:

    liveMatchup: null,
    roundScores: null,
    seasonStatsCard: null,
    golfFormHoles: null,

Golf is the only sport with rounds and holes, so these are genuine §4 named
fields — the difference is real. The defect is that a required-shaped interface
forces every other sport to declare its absence four times. 28 dead lines that a
reader must scan past in every adapter.

Low severity, and the fix is optionality on the interface, not deletion of the
cards.

## C3 — `model` is MLB-only on both player and game pages ◆ STARVED ◆ HIGH

`model` is set by MLB and written `null` by nfl, nba, nhl, cfb, soccer and
tennis, on **both** `PlayerDetailData` and `GameDetailData`.

This is **not** a card-sense defect — it is honest. Only MLB and golf have real
fitted models (recorded in
`project_odds_rebuild_complete_model_building_next`). Six sports render no model
card because there is no model.

It is listed here because it is the single largest card-coverage gap in the app
and it belongs in the remediation ledger, not because anything is miswired.

## C4 — Five live-game components exist; only MLB's reaches a player page ◆ STARVED ◆ HIGH

`PlayerDetailData.liveGame` is set by MLB and `null` for all six other sports.

Meanwhile **all five of these exist and are fully built**:

    components/NbaLiveTab.tsx
    components/NhlLiveTab.tsx
    components/FootballLiveTab.tsx
    components/SoccerLiveTab.tsx
    components/TennisLiveTab.tsx

Every one is wired into `GameDetail.tsx` — and **none** into `PlayerDetail.tsx`.
Each sport also has a live API route (`/api/{sport}/game/{id}/live`).

So the components, the routes and the slot all exist; the connection does not.
This is the cheapest high-value item the audit found.

`PlayerDetail.tsx:1601` still says *"`data.liveGame` is always null for
golf/NFL"*. It is null for six sports. The comment is stale and understates the
gap.

## C5 — TeamDetail is well-unified ◆ FITS ◆ (counter-finding)

Measured across all six team adapters, only two fields diverge:

| field | divergence | verdict |
|---|---|---|
| `advancedStats` | MLB only; five sports `null` | **fits** — MLB's Statcast-grade advanced splits have no equivalent elsewhere |
| `matchup` | `null` for NBA/NHL only | **fits** — both were offseason; needs an in-season recheck before it is called anything else |

`statGroups`, `unitGrades`, `ratingHistory`, `windows`, `distribution`,
`nextGame`, `recentResults`, `form`, `teamRoles`, `standingsTeams` and `roster`
are set by **all six sports**.

This directly contradicts the operator's hypothesis *at this surface*, and it
should be said plainly: the team page is not an MLB grid squeezed onto others.

**Caveat that matters:** "set" is static. Phase B4 showed NBA's and NHL's team
APIs carry no team stats at all, and `seasonAggregates.ts` records that their
adapters emit `[]` for `statGroups`. A field can be assigned and still be empty
at runtime. This row is intent, not outcome.

## C6 — GameDetail is well-unified, with two real per-sport notes ◆ mostly FITS

`hero`, `statComparison`, `injuries` and `h2h` are set by every sport.
`pregameLines` is set by every sport **except MLB**, which uses `gameLine` —
minor, and the only survivor of the duplicate-field pattern outside C1.

`venue` is `null` for NBA, NHL and tennis:

- **NBA / NHL — fits.** Interchangeable indoor arenas; a venue card would say
  nothing a team page doesn't.
- **Tennis — wrong metric.** See C7.

---

# Per-sport verdicts

## Tennis — the thinnest page in the app, and its worst gap is one field away

Tennis writes `null` to `matchupExplorer`, `nflSeasonStats`, `liveLineTracker`,
`model`, `hitterStats` and `liveGame`. What survives is seven cards: windows,
formWindows, gamelog, chart, chips, propOddsBoard, lineControl.

**C7 — Surface is missing, and surface is the sport ◆ WRONG METRIC ◆ HIGH**

Court surface is the most decisive contextual fact in tennis — more than venue,
weather or rest. `game_result` holds it for **56,386 matches**:

| tour | Hard | Clay | Grass |
|---|---|---|---|
| tennis_atp | 16,627 | 9,073 | 3,419 |
| tennis_wta | 16,620 | 7,364 | 3,283 |

The player page **does** use past surfaces — the hard/clay split chips run off
`raw.surface`. **Today's** surface is absent, and the adapter says exactly why
(`playerDetailAdapter.ts:165`):

> Today's surface … is not reachable here: `buildSyntheticPlayerCandidates(…)`
> never sees the event, so `subjectMeta` is `{ tour, league }` and nothing
> carries the tournament. A `meta.surface` read would compile, render nothing
> forever, and look finished.

That comment is the correct way to leave a gap, and it should be said: the
author refused to stub a field that would have looked done. The fix is plumbing
the event onto `subjectMeta`, and the data is already there.

Also carried from Phase B2: **the WTA page is showing men's matches**, which
makes every tennis verdict above provisional until that is fixed.

## Soccer — the deepest data, the wrong default market

**C8 — Default market ignores position ◆ WRONG METRIC ◆ MEDIUM**

`/soccer/epl/player/espn:soccer:122268` (Adam Smith — a right-back) opens on
**ANYTIME GOALSCORER**, with the page's own numbers reading:

> `0% L5 · 0% L10 · 0% L15 · 0% H2H (0/11) · 1.9% SZN (5/259)`

The card is internally honest and completely useless: the default market for a
defender is a prop he has hit five times in seven seasons. Market selection is
not position-aware.

Everything else about soccer is the app's best case — 259 games of real
career-spanning history rendering correctly through the shared components
(Phase B7).

## NFL — rich, with one card that contradicts itself

**C9 — "Biggest edge" asserts an edge at the 48th percentile ◆ WRONG METRIC ◆ MEDIUM**

The matchup card on `/nfl/player/espn:football:16800` reads:

> *Biggest edge: Pass Yds Allowed/Gm — NYG defense ranks in the 48th percentile
> allowing it.*

The 48th percentile is league average. The card announces an edge and then
prints the number that denies it. "Biggest" is being computed as an argmax with
no floor, so it always names something, however flat the distribution. Needs a
threshold below which the card says "no clear edge" — the honest answer, and one
the card currently cannot give.

**C10 — spelling ◆ LOW.** `OPPOSING DEFENCE` / `NYG defence` — British spelling,
inconsistent with the rest of the app.

## MLB — the benchmark, and the source of the leaked vocabulary

MLB's player page is the richest in the app and every card on it fits: pitch
mix, platoon split, strike zone, rolling form, situational splits, live game,
matchup, distribution.

Its problems are the ones it exports to other sports — `firstPitch` as the
universal start-time field (B3), the 25-vs-5-field games strip (B3), and the
`hitterStats` half of C1. Nothing on the MLB page itself earns a bad verdict.

One note: MLB's own team API is the **thinnest** of the six (B4), because its
team page sources from `team-form` and `team-statcast` routes no other sport
has. That is a real architectural asymmetry, but it costs MLB nothing — it costs
the other five sports the cards.

## CFB — cannot be scored

Every CFB player page renders one sentence (Phase B1). There are no cards to
judge. **Phase C cannot issue verdicts for CFB until B1 is fixed.**

CFB does set `nflSeasonStats` and a `passing`/`rushing`/`receiving` split, so
the intent is there; none of it reaches a page today.

## NBA / NHL — provisional, offseason

Both write `null` to `model`, `hitterStats`, `matchup` (team) and `liveGame`,
and both set `nflSeasonStats` and `formWindows`. The NBA team page renders well
out of season (82 games, grades, windows, distribution).

The one clear verdict available today is Phase B6: **the offseason header is a
card-sense failure.** `0-0 · 0th seed, Eastern Conference in division` while the
snapshot already carries *"The 2026-27 NBA season hasn't tipped off"*.

**Both sports need a full re-score in October.** Any verdict beyond B6 issued
today would be about the calendar, not the cards.

---

## Ledger

| # | finding | verdict | severity |
|---|---|---|---|
| C1 | `hitterStats` / `nflSeasonStats` — one card, two sport-named fields | port artifact | HIGH |
| C3 | `model` MLB-only across 6 sports | starved | HIGH |
| C4 | 5 LiveTabs exist, none wired to PlayerDetail | starved | HIGH |
| C7 | tennis surface absent; 56,386 labelled matches available | wrong metric | HIGH |
| C8 | soccer default market ignores position | wrong metric | MEDIUM |
| C9 | NFL "biggest edge" with no floor | wrong metric | MEDIUM |
| C6 | MLB alone lacks `pregameLines` | port artifact | LOW |
| C2 | 28 lines of golf-null ceremony | shouldn't exist here | LOW |
| C10 | NFL British spelling | — | LOW |
| C5 | TeamDetail genuinely unified | **fits** | — |

## What Phase C could not do

- **Golf** — held for a live tournament.
- **CFB** — blocked behind B1.
- **NBA / NHL** — offseason; provisional only, re-score in October.
- **Runtime emptiness** — the field matrices above are static intent. A field
  can be assigned and empty. Only MLB, NFL, soccer and tennis were observably
  rendered, so only their verdicts rest on what a user actually sees.
