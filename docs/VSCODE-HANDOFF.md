# VS Code session handoff → Claude Code

> Running record of work done in the **VS Code (GitHub Copilot)** session, for
> handoff back to **Claude Code**. Claude: read this file first, then
> `docs/CURRENT.md`, then `git log` / `git status` — **disk and git state win
> over this file if they disagree.**

## How to use

- **Session state** below is the live summary: what's done, what's in flight,
  what's next. Rewrite it (don't append) whenever the state changes.
- The **change log** is append-only: one numbered entry per completed change —
  what, why, files touched, and how it was verified.
- After a phase is committed + pushed, also update `docs/CURRENT.md` and
  `docs/design/unattended-run-2026-09-21.md` §2 per the standing convention,
  and note it in an entry here.
- Commit hygiene: never `git add -A` or `git add docs/`; add named files only.

---

## Session state — 2026-09-22

**F0-UI is shipped** (`400802d`) — one commit, 17 files. The research flags:
`/api/slate/flags`, the shared `ResearchFlags` card and chip row on the
player, team and game pages, the Python spotlights rendered on the Slate
beside the two TS cards, and N5's weather list. The Specials registry split
into `SPECIAL_ONLY_RANKINGS` + `SPOTLIGHT_RANKINGS` with `rankingKind()`, and
the drift guard now covers both kinds.

Phases 1-10 of the run order are done. **Phase 11 (C5-UI) is blocked** until a
real graded slate exists (next NFL Sunday, 2026-09-27), so under A6 the next
actionable phase is **12, DJ-GOLF** (tournament -> course backfill, a deploy).

### Environment note

- The built-in Browser pane cannot render the Suspense pages (player, team,
  game): a HIDDEN pane never fires `requestAnimationFrame` and React 19's
  streaming reveal waits on it, so the page sits in `<div hidden id="S:0">`
  forever. `$RV`/`$RB` are not exposed as globals, so the console workaround in
  `CURRENT.md` does not work either. **Playwright MCP is available in this
  session and renders them correctly** — use it for every research-page check.
- Prod on `:3000` serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`. A stale prod server from an earlier session was serving the
  old bundle at the start of this one.

### Next

- **C5-UI** (phase 11) — build against the rows that exist; sign off only once
  the new code has graded one NFL Sunday and one MLB day.
- **DJ-GOLF** (phase 12, deploy) — the next actionable phase.
- **C4 follow-ups**, both *data* additions to `lib/slate/marketMoves.ts`:
  Movers game-line rows still show text matchups (no team logos —
  `ConsensusMover` carries no team ids), and the "books moved" cell still shows
  a count (no per-book marks — no book list on the mover row).
- **C3 follow-ups:** `matchup` typed but not populated; team/game/injury rail
  filters not wired; `statusLine` kept for other consumers.
- **NBA spotlights deferred** (run doc A6): needs a Python `'nba'` games loader.
- **Watch for the other sports' spotlights**: only MLB has ever written rows.
  PY-B deployed after Sunday's slate, so NFL's appear Thursday 2026-09-24 and
  CFB's Saturday 2026-09-26. Nothing to build — F0-UI renders what exists.

---


## Change log

### Entry 0 — session start (no VS Code change yet) — the inherited C2b state

This entry documents, not changes made here, but the **state inherited from the
previous (Claude) session** so work can resume without re-deriving it.

**Uncommitted files and what each holds:**

| file | change |
|---|---|
| `components/PlayerResearchSections.tsx` | Extracted shared `HeroTileGrid` from `PlayerHero`'s tile grid; also exported `heroWhen` and `rankLine`. `PlayerHero` now renders `<HeroTileGrid tiles={tiles} />`. |
| `components/TeamResearchPage.tsx` | `TeamHero` rebuilt inline (line ~185): team-colour band via `bandColors()`/`bandGradient()`, crest watermark, logo overhanging below band with white tile + white ring, chip row (standing + record), next game with opponent logo / `vs`/`@` / live, a Home-venue line under the band, `DisclosureBar` summary, `Collapse` body with its own `lb.teamHeroPeekSeen` peek, `HeroTileGrid`, and last-ten form rows using `ResultMark` + opponent logos + scores. `useTeamColors(sport)` hook added at the top of the component. |
| `lib/sports/shared/teamResearchShapes.ts` | `TeamResearchSpec.heroRanks?: { scored?: string; allowed?: string }`; extended `hero.lastTen[]` (`opponent?`, `opponentLogo?`, `line?`) and `hero.next` (`homeAway?: '@' \| 'vs'`, `live?: boolean`). |
| `lib/sports/shared/teamResearch.ts` | `buildTeamResearch` attaches a rank + ranked-stat value to the scored/allowed tiles using `leagueRank` from the Team stats section (percentile = `100*(1-(rank-1)/(of-1))`); adds `opponent`/`opponentLogo`/`line` to `lastTen`; adds `homeAway`/`live` to `next`. |
| `lib/sports/mlb/adapters/teamResearchSpec.ts` | `heroRanks: { scored: 'rpg', allowed: 'rapg' }` |
| `lib/sports/nba/adapters/teamResearchSpec.ts` | `heroRanks: { scored: 'ppg', allowed: 'oppg' }` |
| `lib/sports/nfl/adapters/teamResearchSpec.ts` | `heroRanks: { scored: 'ppg', allowed: 'papg' }` (shared with CFB via `footballTeamSpec`) |
| `lib/sports/nhl/adapters/teamResearchSpec.ts` | `heroRanks: { scored: 'gfpg', allowed: 'gapg' }` |
| `lib/sports/soccer/adapters/teamResearchSpec.ts` | `heroRanks: { scored: 'gfpm', allowed: 'gapm' }` |
| `tests/team-research.test.ts` | New `C2b` test: hero scored/allowed tiles carry `{rank, of, pool:'teams', percentile}` from the Team stats pool, print the ranked stat, `Record` tile stays unranked, and `lastTen` rows carry `line` + `opponentLogo`. |

**Verification already done by the previous session (per its chat):**
- `tsc` clean; the C2b test passes.
- MLB Yankees correct (4.60 RPG = 9th of 30; 3.72 allowed = 1st).
- NFL Vikings band, gold accent chip, white crest tile, and Home line rendered correctly.
- **Left hanging:** the body appeared closed despite the scripted click; the
  400px toggle click and the remaining sport renders were not completed before
  the limit hit.

### Entry 1 — C2b verification (no code change)

Verified the inherited C2b work end to end: typecheck clean, full suite 641/0,
production build clean, and functional DOM checks on MLB/NFL/NHL/NBA/soccer
(band, chips, next game, Home line, ranked tiles with correct per-sport ranks,
last-ten form rows). Confirmed the collapsible body toggle works (Show→Hide,
`aria-expanded` flips, Last 10 appears) — the item the previous session left
unresolved. No files changed.

### Entry 2 — crest disc + C1b section headers (operator design follow-ups)

1. **Crest** (`components/TeamResearchPage.tsx`): the team logo now sits on the
   headshot's translucent disc (`bg-white/12` via the `ring` prop) instead of a
   solid white disc, so the team colour reads through behind the mark exactly
   as it does behind the player's photo. Resulting class:
   `rounded-full border-transparent` + `ring` (→ `bg-white/12 ring-[3px] ring-white/85`).
2. **C1b headers** (`components/ui/Section.tsx`): `SectionBand` — used by every
   research section AND every Slate section — went from the charcoal fill
   (`bg-char` + 2px `char-rule` top line, white text) to a transparent bar with
   a 3px `bg-char` line on the left, a hairline `border-b border-line-soft`
   divider, dark `text-ink` title, `bg-card-sunk` count chip, and the collapse
   button changed `onDark` → `tertiary`. `tests/ui-primitives.test.ts` updated
   (C1 → C1b guard: asserts the side line + divider, no charcoal fill).
   The `onDark` Button variant is now unused (left in place; cleanup is separate).

### Entry 3 — PY-B spotlight rankings (deployed)

Built the Python spotlight rankings (`kind='spotlight'`, never graded) in
`python-odds-service/src/slate_rankings.py` — 32 new `RankingDef`s across
NFL, CFB, NHL, soccer (EPL+MLS) and MLB:

- **Sport-specific:** NFL targets vs weak pass D, NFL/CFB rushers vs weak run D,
  NHL shot volume, soccer shot takers vs weak D, MLB platoon spots, pitcher K
  spots, HR-friendly parks, hot bat vs cold arm.
- **N ideas:** N1 role changes (all sports), N2 back in lineup (all), N3
  teammate out (NFL/NHL), N6 rest & travel (NFL/NHL), N7 revenge (all), N8
  milestones (all), N4 hot bat (MLB).
- **Infra:** `grade_stat` defaults to `""`; `ungraded_frozen_rankings` filters
  `kind='special'` so spotlights are never graded; the registry test updated
  ("specials graded, spotlights never graded"). The TS mirror
  (`lib/slate/specials.ts`) gained all 32 defs, `readSpecials` filters
  `kind='special'`, and the drift test parses all 40 defs (removed the `#`
  comment lines between `RankingDef`s — the parser's lookahead skips any def
  that follows a comment).

**Verified:** Python harness green (scoring, registry, freeze, builders on real
rows incl. new milestone/role/revenge checks); `npm run typecheck` clean; full
TS suite 641/0; a DB dry-run confirmed real candidates + factor values for the
NFL builders and fixed two real bugs (target-share keyed to nflverse codes;
`player_season_production.stats` comes back as a JSON string).

**Deferred (A6):** NBA (no Python games loader) and N5 weather (render-time,
ships with F0-UI). See "Next" above.

### Entry 4 — C3 player search rail

- `lib/core/types.ts`: `SubjectSummary` gains `headline: { value; unit } | null`
  and `matchup: string | null` (kept `statusLine` — other consumers still read it).
- All 8 adapters fill `headline` alongside the existing `statusLine`: NFL
  (by position: pass/rush/rec yds), CFB (largest of pass/rush/rec/kicking),
  NBA (PPG), NHL (skater pts / goalie SV), soccer (goals), tennis (W-L), MLB
  (batter "Last H-AB", pitcher null), golf (today's score).
- `components/ui/Fields.tsx` `PickList`: new `trailing` (right-edge block) and
  `accent` (team primary; the selected row gets a 3px bar at its left edge).
- `components/PlayerDetailPanel.tsx`: the rail now renders the 40px headshot
  with an 18px team-logo badge, `sub` = matchup, `trailing` = headline value +
  unit + a good-tint "N mkts" chip, `accent` from `useTeamColors` +
  `teamColor`. Sort (headline/name/markets) and a "Has props" toggle, both
  backed by `useUrlState` (`?sort=` / `?props=`).

**Verified:** `npm run typecheck` clean; full TS suite 641/0; `npm run build`
clean; in the browser the Sort/Has-props controls render, the URL round-trips
(`?sort=name`, `?props=1`), and the has-props filter drops 625 → 60 rows. The
headline value/unit shows once the cached snapshot refreshes (it is produced by
the adapters; the stale snapshot cache pre-dates the change).

### Entry 5 — C4 Slate imagery

- `components/BookLogo.tsx`: added `kalshi` → `kalshi.com`, `prophetx` →
  `prophetx.co`, `hardrockbet` → `hardrock.bet`, `betrivers` → `betrivers.com`
  to `BOOK_DOMAIN` and `BOOK_LABEL`.
- `components/slate/GameCard.tsx`: a 5px stripe split into the two teams'
  primaries (`useTeamColors` + `teamColor`, `var(--line)` fallback), logos
  24 → 36px, and live games now show a red dot + "LIVE · {statusText}" in
  `bad-ink` instead of the neutral chip. `GameCard` takes a `sport` prop
  (`SlateGames` passes `data.sport`).
- `components/slate/SlateMarket.tsx`: the Book cell is a `BookLogo` mark +
  proper label (the local title-case `bookLabel` was replaced by `BookLogo`'s),
  the Gap column is a neutral `warn` `Chip` (no bar, no green/red), and "At the
  other line" is a max-5 row of `BookLogo` marks with `Tooltip` names + "+N".

**Verified:** `npm run typecheck` clean; full TS suite 641/0 (incl. the
`scan-no-edge` guard); `npm run build` clean.

**Not done (follow-up, data not on the row shapes):** headshots/logos for the
Spotlights, Model and Movers cards, and the GameCard footer book-marks
`AvatarGroup` — `SpotlightRow`/`ModelPickRow`/`ConsensusMover` and
`SlateGameCard.lines` don't carry headshot/logo URLs yet, so these need a data
pass, not just UI. See "Next".

### Entry 6 — C4 imagery (headshots/logos + footer book-marks) — commit `f7bc9fe`

Closes the four items Entry 5 left open. The user was right that the URLs
already exist elsewhere — headshots/logos are on almost every page — so this is
UI wiring against existing sources, not a new data pipeline.

- `lib/slate/spotlights.ts`: `SpotlightRow` gains `headshotUrl?`/`logoUrl?`;
  a `subjectImages(c)` helper reads `c.subjectMeta.headshotUrl` /
  `.teamLogoUrl` / `.flagUrl` and the hit-rate + streak row builds spread it in.
- `components/slate/SlateSpotlights.tsx`: `AvatarLabel` now takes
  `src={r.headshotUrl ?? undefined}` and `fallbackSrc={r.logoUrl ?? undefined}`.
- `lib/slate/modelPicks.ts`: `ModelPickRow` gains `awayLogoUrl`/`homeLogoUrl`;
  `mlbTeamLogo(teamId)` = `https://www.mlbstatic.com/team-logos/${teamId}.svg`,
  populated from `r.awayTeamId`/`r.homeTeamId` in `toModelPicks`.
- `components/slate/SlateModel.tsx`: game cell now stacks away+home logos
  (`-space-x-1`) before the matchup.
- `components/slate/SlateMovers.tsx`: gains a `sport` prop; a `moverHeadshot()`
  helper maps the subject id through `mlbHeadshot`/`espnHeadshot`, and the
  props subject cell renders a 24px `Avatar` headshot (graceful fallback if
  the id space is off). `AppShell.tsx` passes `sport={sport}` at the mount.
- `lib/sports/shared/slateShapes.ts` + `lib/sports/shared/buildSlate.ts`:
  `SlateMarket` gains `booksList?: string[]`, populated in `marketFor` from the
  sane quotes' book ids.
- `components/slate/GameCard.tsx`: the footer now renders the game's books as a
  stacked `BookLogo` mark group (max 6, `Tooltip` names) + "N books", and the
  link reads "Research →".
- `tests/slate-model-lines.test.ts`: key pin updated to include the two new
  logo keys.

**Verified:** `npm run typecheck` clean; full TS suite 641/0; `npm run build`
clean. Pushed (`faf3e2b..f7bc9fe`).

### Entry 7 — C4 image audit (commit `5b7c997`)

The operator's pass over the rendered cards. One commit, ten files, no data
pass — everything was already on the page or on the snapshot.

- `components/slate/SlateMarket.tsx`: the "Player" column on both market-shape
  cards now leads with the player's team mark (16px) and still no headshot.
  The logo comes from a `teamLogoBySubject` map AppShell builds from the
  snapshot's own subjects, matched on the bare athlete id (`athleteIdOf`) so it
  works for namespaced ids too.
- `components/AppShell.tsx`: builds that map in a `useMemo` and passes it to
  `SlateMarket`.
- `components/slate/SlateSpotlights.tsx` + `lib/slate/spotlights.ts`: a
  `teamLogoUrl` field (team only — golf's flag stays out of the badge) renders
  as a small badge on the row's headshot, the same pattern as the player search
  rail.
- `components/slate/SlateModel.tsx`: the game cell splits the matchup and puts
  each team's logo beside its own name instead of stacking both at the start.
- `components/slate/SlateSpecials.tsx`: the subject cell is now text-only (name
  + team/vs line) — no avatar, no silhouette.
- `components/slate/GameCard.tsx`: the footer book-marks `AvatarGroup` is gone
  (no sportsbook logos on game cards); the footer is just props + Research →.
  `SlateMarket.booksList` (added in `f7bc9fe` for exactly this) is removed from
  `slateShapes.ts` and `buildSlate.ts` with it.
- `lib/sports/shared/identity.ts`: `mlbHeadshot` was still building an `w_80`
  image (no default fallback) for the search rail, Movers and game research —
  unified to the `w_213,d_people:…` URL the adapters already use.

**Verified:** `npm run typecheck` clean; full TS suite 641/0; `npm run build`
clean; prod server rebuilt and restarted on `:3000`. Pushed
(`64fbe4e..5b7c997`).

### Entry 8 — C4 image fixes (commit `6fc0eac`)

The operator read the rendered cards a second time and reversed three of Entry
7's calls, plus found the real MLB sizing bug.

- **Market-shape cards** (`SlateMarket.tsx`): the player column now leads with
  the player's face (`Avatar` 24px) and the team mark sits as a small badge on
  it — not the team mark alone. `SlateMarket` gained a required `sport` prop
  and resolves faces through the new shared `headshotFor`.
- **Specials** (`SlateSpecials.tsx`): a 16px team mark leads the player's name
  (from the same `teamLogoBySubject` map), instead of a bare text row.
- **GameCard** (`GameCard.tsx` + `slateShapes.ts` + `buildSlate.ts`): the
  footer book-marks `AvatarGroup` and `SlateMarket.booksList` are restored.
- **The MLB sizing bug** — measured, not guessed: `w_213` on MLB's CDN returns
  a **213×320 portrait**, which `Avatar`'s `object-cover` centre-crops inside
  the circle and cuts the head in half. NFL was fine because ESPN serves
  square headshots. Every MLB headshot URL now requests
  `c_thumb,g_face,w_213,h_213` (a verified 213×213 face crop) in
  `identity.ts`, `SubjectAvatar.tsx`, `mlb/adapter.ts`, `mlb/teamResearch.ts`
  and `playerBio.ts`; `identity.ts` gains `headshotFor(sport, id)` as the one
  dispatcher the Slate cards use.

**Verified:** `npm run typecheck` clean; full TS suite 641/0; `npm run build`
clean; prod server rebuilt and restarted on `:3000`. Pushed
(`da2858c..6fc0eac`).

### Entry 9 — Specials row layout (commit `76d03b6`)

The operator clarified the Specials row: the player FACE belongs beside the
name, and the team marks belong in the "team vs opponent" line underneath.

- `components/slate/SlateSpecials.tsx`: the subject cell is now the standard
  `Avatar` headshot (`headshotFor`) beside the name, and the sub-line renders
  `TeamMark` for both sides — the player's team and the opponent, each a
  `TeamLogo` + abbreviation with a plain-text fallback when a sport has no
  logo. `SlateSpecials` takes a `sport` prop; the snapshot `teamLogoBySubject`
  map is no longer used here.
- `lib/sports/shared/identity.ts`: `teamLogoFor(sport, teamId, abbr)` — MLB
  keys on the numeric team id, NFL on the abbreviation; other sports return
  null so `TeamMark` falls back to text.
- `components/AppShell.tsx`: passes `sport` to `SlateSpecials`.

**Verified:** `npm run typecheck` clean; full TS suite 641/0; `npm run build`
clean; prod server rebuilt and restarted on `:3000`. Pushed
(`f91eede..76d03b6`).

### Entry 10 — C6 props controls, core (commit `5c41440`)

The heart of C6: the four view tabs are gone, and the Home Runs board with
them.

- `components/useFilters.ts`: `FilterState` gains `positions` (a real filter),
  `status` (`'all' | 'upcoming' | 'live'`) and `watchlistOnly` (view controls,
  deliberately NOT filter chips). Setters, `filtersActive`/`activeFilterCount`,
  and `applyFilters` all updated; `positions` is applied in `applyFilters`.
- `components/AppShell.tsx`: `SCAN_VIEWS`/`scanView` and the Home Runs reset
  effect are deleted. `views` now returns `{ all, comingUp, watchlist, live }`
  (live = `liveState.status === 'live'`); `displayList` = status → base, then
  watchlist ANDed on top. The `Tabs` strip is replaced by a kit
  `SegmentedToggle` (All/Upcoming/Live) + a kit `Toggle` (Watchlist) in the
  controls row. A Position `FilterDropdown` joins the pill row. The four tab
  counts became one "Showing N of M" line with removable kit `Chip`s and a kit
  `Button` "Clear all". The four `renderList` branches collapse to one.
- `components/icons.tsx`: `PositionIcon` (a location pin).
- `tests/ui-scope.ts`: `useFilters.ts` unfreezed (pure logic, no JSX, so no
  guard churn).

**Not done — the rest of C6, be clear it is unfinished:**
1. **Kit rebuild of the filter surfaces** (`FilterBar.tsx`'s `FilterDropdown`/
   `CheckboxList`/`FilterSelect`/`FilterSearchBox`/`FilterOddsRangeInputs`/
   `BooleanCheckboxRow`/`DensityToggle`/`OverflowMenu`/`IconToggleButton`,
   plus `FilterSidebar`, `PlayerFilterDrawer`, `DateGameStrip`, and the glider
   `SegmentedToggle`). Until those are on the kit, they stay in
   `OUT_OF_SCOPE` — the U-track guards are ratchets, so unfreezing them before
   the rebuild turns the suite red.
2. **The <640 "Filters (n)" bottom sheet** (C6.3). The pill row still scrolls
   sideways on a phone; the slideout variant is not built.
3. **The 390px ≤3-row guard** — the plan asks for a Playwright check, but the
   repo has no Playwright; it cannot be automated in `node --test`.

**Verified:** `npm run typecheck` clean; full TS suite 641/0 (incl. the
unfreezed `useFilters.ts` swept clean); `npm run build` clean; prod server
rebuilt and restarted on `:3000`. Pushed (`a08c11c..5c41440`).

### Entry 11 — C6 finished: filter surfaces on the kit (commits `b3f7d5c`, `fc8e69f`)

The three Entry-10 "remaining" items are done. C6 is closed.

- `components/FilterBar.tsx` rebuilt on the kit: `FilterDropdown` → kit
  `Popover` (trigger is a kit `Button`/`IconButton`, no more hand-rolled
  portal); `FilterSelect` → kit `Select`; `FilterSearchBox` → kit `Input`
  (leading `SearchIcon`); `FilterOddsRangeInputs` → kit `Input`s;
  `CheckboxList`/`BooleanCheckboxRow` → kit `Checkbox`; `ScanScopeToggle`/
  `GolfScanModeToggle`/`DensityToggle` → kit `SegmentedToggle`;
  `OverflowMenu` → kit `Popover`; `IconToggleButton` → kit `IconButton`; new
  `HitRatePicker` on kit `RadioGroup` (shared by the row and the sidebar).
  Hand-typed `text-[Npx]`, native `title=` and the native `<select>` are gone.
- `components/FilterSidebar.tsx`: `AccordionSection` → kit `Button`, hit-rate
  list → `HitRatePicker`, `FilterSelect` call updated.
- `components/PlayerFilterDrawer.tsx`: the hand-built scrim is now the kit
  `SlideoutMenu` (buttons/input/checkboxes/chips all kit).
- `components/DateGameStrip.tsx`: Today/Tomorrow/All/game chips → kit
  `Button`s, the date picker → kit `Input type="date"`, collapse/pause →
  kit `IconButton`s, and `text-good` → `text-good-ink`.
- `components/SegmentedToggle.tsx` (the glider) **deleted** — its last
  importer (`FilterBar`) now uses the kit toggle.
- `components/AppShell.tsx`: the eight filter pills are extracted into a
  `filterPills(fullWidth)` renderer; <640 shows a "Filters (n)" button that
  opens a kit `SlideoutMenu` with the pills stacked, a Reset and a "Show N
  props" apply button. Desktop/tablet keep the inline row.
- `tests/ui-scope.ts`: `FilterBar`, `FilterSidebar`, `PlayerFilterDrawer`,
  `DateGameStrip` and `SegmentedToggle` removed from `OUT_OF_SCOPE` (only
  `ScanTable`/`ScanCard`/`AppShell` stay frozen).
- `tests/ui-pieces.test.ts`: the glider `TOGGLE_ALLOWED` ratchet emptied.

**The one thing still not automatable:** the plan's 390px ≤3-row check asks
for Playwright, which the repo does not have. The responsive split is verified
in the embedded browser (at its narrow width the inline row hides and the
"Filters (n)" button shows). The operator should still eyeball 390px in a real
browser.

**Verified:** `npm run typecheck` clean; full TS suite 641/0 (all six
unfreezed files swept clean by the UI guards); `npm run build` clean; prod
server rebuilt and restarted on `:3000`. Pushed (`16ee731..b3f7d5c..fc8e69f`).


### Entry 12 — F0-UI: research flags + the Python spotlights on the Slate (commit `400802d`)

PY-B wrote 32 spotlight rankings into `slate_rankings` in the early hours of
2026-09-22 and **nothing rendered them**: `readSpecials` hard-filters
`kind='special'`, and the Slate's Spotlights section derives its two universal
cards from `PickCandidate`s, not from the table. This is the render half.

**Measured first, and two of the phase's premises were wrong.**

1. **A spotlight's subject is not always a player.** `mlb-hr-parks` ranks
   GAMES — `subject_id` IS the `game_id`, `subject_name` is "AZ @ COL". A
   route that assumed an athlete id would have dropped 13 of today's 33 rows
   on the floor. `ResearchFlag.subjectKind` carries it; the card's first column
   is headed "Game", the row gets no face and no team badge, and its link goes
   to the game page.
2. **Only MLB has ever written spotlight rows** — 3 rankings, 33 rows, all
   dated 2026-09-22. PY-B deployed at 02:26 UTC, *after* Sunday's NFL slate was
   built, so NFL/CFB/NHL/soccer rankings simply have not had a slate yet. They
   appear on their next one (NFL Thursday 09-24). Nothing is broken and nothing
   is owed; the UI renders whatever exists.

**What shipped**

- `app/api/slate/flags/route.ts` — `cachedRoute`, key
  `slate:flags:route:{scope}:{date}` (grepped, unused). The build is the WHOLE
  sport-day's flags and the per-page slice happens in `transform`, so the Slate
  and every player/team/game page share ONE cache entry instead of minting one
  per athlete id. `?subject=`, `?team=` or `?game=`, at most one.
- `lib/slate/flags.ts` — shapes plus `flagScope`/`selectFlags`/`groupFlags`.
  **It holds no query on purpose**: these shapes reach the browser through
  `spotlights.ts` and `ResearchFlags.tsx`, and `pgClient` pulls `pg` in with
  them. The read is `lib/slate/flagsRead.ts` — the same split
  `specialsFormat.ts` already keeps for the Specials' display half.
- `components/ResearchFlags.tsx` — one card, one chip row, no sport check.
  `variant="chips"` on the player page (a box around one line is a box around
  one line), the card with `showSubject` on the team and game pages, where the
  subjects are other people. A team's own id matches `team_id` OR
  `opponent_id`, so the park flag for today's game shows on both teams.
- The Slate's Spotlights section renders the Python cards beside the two TS
  ones: `flagSpotlightCards` converts a ranking into the same `SpotlightCard`,
  so there is one renderer and one empty state, not two. `SpotlightCard`
  gained `subjectLabel` for the same reason the game rows exist.
- **N5 weather** — `weatherFlag` on `SlateGameCard`, computed once in the
  shared `buildSlateGames` from `game.weather` (wind over 15 mph, rain over
  50%), listed by `weatherSpotlight`. No sport check: `resolveVenueWeather`
  fills nothing for a roofed park or a sport with no forecast. Unordered, per
  the spec. Today it flags exactly one game (TOR @ BAL, rain 79%).
- `SPECIAL_RANKINGS` splits into `SPECIAL_ONLY_RANKINGS` (8) +
  `SPOTLIGHT_RANKINGS` (32) with `rankingKind()`, so which kind an id is comes
  from the registry rather than from a comment. The drift guard now asserts the
  kind matches Python's per ranking, and that a spotlight never declares a
  `grade_stat` while a Special always does.
- Guards: `tests/slate-flags.test.ts` (9 tests, incl. the browser/pg split and
  the N5 thresholds), two new in `slate-specials.test.ts`, and the four new
  files added to `scan-no-edge`'s Slate list.

**Verified:** `npm run typecheck` clean; full TS suite **652/0** (641 + 11
new); `npm run build` clean; prod rebuilt and restarted on `:3000`. Rendered in
**Playwright** at 1440 and 400 on real rows — the Slate's six spotlight cards
in order (3 Python, 2 TS, weather), the player chip row ("FLAGS TODAY ·
Pitcher K spots"), the team card (3 flags for TB) and the game card (4 flags
for AZ @ COL). Two console errors on every page are the pre-existing signed-out
401s on `/api/picks` and `/api/watchlist`. The 400px page overflow on `/mlb` is
Scan's frozen table and is unchanged by this phase (measured: hiding the
Spotlights section leaves `scrollWidth` at 620 either way).

**Two things the render changed after looking at it:** the chip row got the
same "FLAGS TODAY" overline the game page's state row uses (a bare chip under
a hero reads as a stray control), and a game-subject row dropped its "AZ vs
COL" sub-line under a name already reading "AZ @ COL".
