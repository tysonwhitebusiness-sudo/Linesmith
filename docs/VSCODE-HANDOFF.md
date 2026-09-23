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

## Session state — 2026-09-23

**THE RUN IS COMPLETE.** All sixteen phases of
`docs/design/unattended-run-2026-09-21.md` §2 are built, tested and deployed.
The last four landed in one pass:

| phase | commit | what |
|---|---|---|
| 13 DJ-TEN | `7e9e119` (deployed) | `tennis_match_stats` — TML serve/return, ATP only |
| 14 SP-TEN + SP-GOLF | `f6c4cd6` (deployed) | four spotlights; two not built (Q27) |
| 15 C8 | `4f49150` (deployed) | Track C closed: guards, CLAUDE.md, mockup historical |
| 16 SPC | `4f49150` | Spotlights closed: guards + docs; receipts NOT built (Q26) |

**What is left is review, not build.**

1. **C5-UI sign-off** — NFL Sunday **2026-09-27** plus one MLB day graded by
   PY-A's code. Check NFL's receipts actually fill: `nfl-longest-reception`
   for 09-21 produced a leader row and zero graded players.
2. **Q26 needs a real answer.** SPC's spec asks for graded spotlights; the
   build deliberately does the opposite, and the invariant is now pinned in
   both languages. Reversing it means a grade rule for 36 spotlights.
3. **Q27–Q30** record the other calls taken without the operator: golf's two
   unbuilt live cards, WTA having no serve source at all, a 25-day-stale
   surface feed, and `RankingDef.freezes`.

### Environment note

- The Supabase DNS outage (`aac1bcb`) has cleared and stayed clear.
- The built-in Browser pane cannot render the Suspense pages — a hidden pane
  never fires `requestAnimationFrame` and `$RV`/`$RB` are not exposed, so the
  documented console workaround does not work either. **Use Playwright MCP**,
  which renders them correctly.
- Prod on `:3000` serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`.
- **Bash heredocs eat quotes and backslashes here.** Every multi-line patch in
  this pass was written to a file with the Write tool and run with `python
  <file>`; the one heredoc attempt failed immediately.

### Next

- Nothing in the run order. The backlog is `SIGNOFF-QUEUE.md`, M4, M5, and
  NBA's spotlights (still waiting on a Python `'nba'` games loader).
- **C4 follow-ups**, both data additions to `lib/slate/marketMoves.ts`: Movers
  game-line rows still show text matchups, and "books moved" is still a count.
- **C3 follow-ups:** `matchup` typed but not populated; rail filters not wired.

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


### Entry 13 — C5-UI: receipts as a graded breakdown (commit `815b94e`)

Built against the rows that exist, which the run doc explicitly allows; only
sign-off waits for a graded slate. Four files.

- **Receipts** (`SlateSpecials.tsx`): the chip row is replaced by C5.4's card —
  a "{title} · {date}" overline, "2 of 4 who played", a result bar with one
  segment per ranked player (hatched = did not play), the last-N-slates bars
  with a tooltip per slate, a table of rank · player (face + both team marks) ·
  what happened (`outcome.detail`) · result (`ResultMark`), and the footer:
  separate calls, not a parlay.
- **The Specials table**: `PercentileCell` per factor (value, percentile, bar)
  and Python's deterministic `read` under each player's name. The percentile is
  the reason a row is where it is and was previously only visible by expanding.
- **The rank moved inside the player cell** in both tables. `DataTable` pins the
  FIRST column, so a separate "#" column meant the number stayed pinned while
  the player it ranked scrolled away. Verified at 400 by scrolling the receipts
  table sideways: the player stays, "What happened" slides under it.
- `readSpecials` returns `receipts.slates` (per-slate hits/played) and each
  receipt row's subject/team/opponent ids.

**Two measurements that changed the code.**

1. **A ranking can have a leader and no graded players.** `nfl-longest-reception`
   for 2026-09-21 has a `__leader__` row (48.0, Laquon Treadwell, `ourRank:
   null`) and all 11 ranked players ungraded — `grade()` skips a row whose
   team's game has not landed in `player_game_history`. `latest` now counts the
   leader row, and the card says so rather than throwing away a real
   measurement. **Check this on 09-27**: if it repeats, NFL receipts never fill
   and the fix is in Python, not here.
2. **A `cachedRoute` serves the SHAPE it cached.** Adding `receipts.slates`
   crashed the whole Slate — "Cannot read properties of undefined (reading
   'length')" — because `snapshot_cache` survives deploys and still held the
   pre-change payload. `tsc` was clean and the page was down. The card now
   reads its arrays with `?? []` and `tests/slate-specials.test.ts` pins it.
   **Any array added to a cached payload needs the same treatment.**

**Verified:** typecheck clean; full suite **655/0** (3 new); build clean; prod
rebuilt and restarted. Rendered in Playwright at 1440 and 400 on the real
2026-09-21 MLB receipts — "2 of 4 who played", Alonso's `2 HR · 2-4 · 3 RBI`,
and two did-not-plays shown as neither a hit nor a miss.

**Not done, and deliberately:** the sign-off itself. Per the run doc, don't
sign C5 off on a slate graded by the old code.


### Entry 14 — DJ-GOLF: 4 of 235 events had a course, now 235 (commit `f3b6817`, deployed)

Golf's Course history spotlight was blocked because there was nothing to group
a golfer's past finishes BY. `golf_tournament_results` holds 235 events back to
2022-01-09; `golf_tournaments` named a course for four.

**The plan's three premises were all wrong, and checking them shrank the
phase from M to S.** It called for a new data job with a new table and an
ownership row. `golf_tournaments` already had `course_name` and `holes_json`;
`db.write_golf_tournament` already existed; `ingest_golf_history` already
called it for the live event, which is where those four rows came from. The
only gap was history, and the only missing piece was a way to ask ESPN about an
event that is not the current one.

- `fetch_event_meta` (`predict/golf_espn.py`): the same leaderboard endpoint
  answers with `&event=` for an event years finished. It also carries the
  event's own `date`, which the live path deliberately refuses to guess — so a
  backfilled row is better described than a live-written one.
- `golf_courses.py`: the backfill and a CLI (`backfill` / `status`). 60 per
  run, 0.25s apart; ESPN's golf endpoints are free, public and not ours.
- `golfCoursesJob`, six-hourly, in `JOB_REGISTRY` — a job rather than a
  one-shot script so `health_check` watches it, and so a live event whose
  leaderboard omitted a course still gets one later. **Verified to be a no-op
  now**: one read, no writes.

**Two measurements, one of which broke the first run.**

1. **The Ryder Cup is not stroke play and its feed says so.** Event 401734110's
   `competitions` is a list of LISTS (the pairings) where every other event's
   is a list of one dict. `.get` on it threw `AttributeError` and killed the
   run 46 events in. A team event has no field size to report — that is the
   honest answer, not a count of matches.
2. **ESPN answers an unknown `&event=` with a 200 and TODAY's tournament**, not
   an error. The id returned is now checked against the id asked for; without
   that, a dead id writes today's course onto a 2022 event.

**Result: 235/235 (100%)** against the phase's 90% bar. 82 distinct courses,
the majors recurring five seasons deep (Augusta National, Pebble Beach,
Muirfield Village, Harbour Town) — exactly what Course history needs. Start
dates: 231 on the first pass, the last four on a second once the query also
treated a null `start_date` as missing, closing the gap
`golf/playerResearchShapes.ts:13` records.

**Also grepped, not assumed:** `writeGolfTournament`,
`writeGolfTournamentResults`, `writeGolfHoleScores` and `writeGolfRoundScores`
exist in **zero** TypeScript files and `historyIngest.ts` is gone (one comment
in `golf/adapter.ts:398` still names it). Rows 17-20 of
`docs/table-ownership.md` carry a stale ⚠ on all four. Recorded in that file's
staleness banner rather than patched into the rows, per its own
re-derive-don't-edit rule.

**Verified:** 662/0 (7 new in `tests/golf-courses.test.ts`); typecheck and
build clean; the backfill run against the real database; the job re-run to
confirm the no-op; deployed and polled to `live` on the exact commit.


### Entry 15 — DJ-TEN, SP-TEN + SP-GOLF, C8 and SPC: the run closes (`7e9e119`, `f6c4cd6`, `4f49150`)

Four phases in one pass, each deployed.

**DJ-TEN (`7e9e119`).** New `tennis_match_stats`: one row per player per match,
their serve line plus the same match from the other end (their return context).
Three of the phase's premises were wrong. **Jeff Sackmann's `tennis_atp` and
`tennis_wta` repos are gone** — the canonical open tennis datasets for a decade
— so TML-Database is not the fallback, it is the only source, and it is ATP.
**Surface was already held for both tours** (`game_result`, since 2026-09-02),
so correction 6 is out of date and Surface record needs no ingest. And the
obvious identity bridge was the wrong one: folding TML's full names into
tennis-data's abbreviations and looking them up in `athlete_crosswalk` resolved
47% of players, because that table holds 401 of 715 and is missing
Auger-Aliassime, Davidovich Fokina and Mpetshi Perricard. Matching ESPN's own
full names took it to **80 of the busiest 80**.

**SP-TEN + SP-GOLF (`f6c4cd6`).** Four of six built: tennis Form (both tours),
Serve vs return and Surface record (ATP), golf Course history — the ranking
DJ-GOLF existed to unblock, now reading "Patrick Cantlay — has finished as high
as 2 here, and averages 21 at this course". Two measurements changed the
design: **nothing held knows what surface is played this week** (ESPN carries
none; `game_result`'s comes from an operator-run load that was 25 days stale),
so the card reads the most recent completed tour week and its words say "the
current swing"; and **a golf slate is a WEEK**, so the generic freeze would
blank the card for six days of seven — `RankingDef.freezes` is the opt-out.
Round movers and Scoring by par type are NOT built (Q27): both are live
in-round cards, the machinery freezes, and the Slate's golf candidates carry no
round-start position and no per-hole scores.

**C8 + SPC (`4f49150`).** Track C closed with two new guards (a fill colour is
never text outside the frozen files; a Slate header is always `SectionBand`),
`CLAUDE.md` updated for the kit's new pieces and D3's revision, and the mockup
marked HISTORICAL. Spotlights closed with the flags documented in `CLAUDE.md`
and five queue rows. **SPC's own spec contradicts the build** — it asks for
graded spotlights — and that is Q26, kept ungraded with the reasoning written
down rather than quietly resolved either way.

**Three bugs found by rendering, none visible to `tsc`:**

1. **Tennis flags could never be found.** `flagScope` folded `tennis_atp` to
   `'tennis'`; the writer stores the tour. Every tennis page showed no flags,
   and the guard asserted the wrong behaviour.
2. **A read line called a woman "he"** — "Katie Volynets ... has won 70% of HIS
   last ten". The templates now take no pronoun at all.
3. **Golf rankings rendered "Unknown player" ten times.** `_name_all` bridges
   team-sport ids through rosters and a crosswalk and golf has neither. The
   live field was the obvious fix and the wrong one — this ranking's field is
   the last COMPLETED event's — so names come from ESPN's per-athlete
   endpoint, cached a month.

**Verified:** 674/0 across the suite (18 new since the run's start); typecheck
and build clean; MLB's Slate renders five spotlight cards plus Specials at 1440
and 400; tennis and golf flags confirmed through `/api/slate/flags`; three
worker deploys, each polled to `live` on its own commit.


### Entry 16 — the closeout: C8 closed properly, WTA serve data, one production fix

`4f49150` closed C8 having done three of its five items. The closeout
(`docs/design/closeout-2026-09-23.md`) finished it, and the sweep it required
found six bugs that no test or type check could see.

**Operator answers:** A1 keep spotlights ungraded. A2: Q27 fine; ingest the
Match Charting Project with visible attribution.

**Found and fixed, by rendering:**
1. **Production:** `golfHistoryJob` failed every 5 minutes on the Presidents
   Cup — a team event, the same list-of-lists `competitions` shape DJ-GOLF's
   backfill hit on the Ryder Cup, but the fix had gone into the per-event path
   only (`196f11f`, deployed, recovered 19:34 UTC).
2. The date field took 100% of the header (C6 passed `shrink-0` to a `w-full`
   kit wrapper): pages scrolled to 1660px at 1440. Then, at 400px, a fixed
   176px still overflowed; letting it shrink made it 57px; a 144px floor
   clipped the year. It is now 176px and the row wraps.
3. NFL faces 404'd (13 a load): a namespaced id reached `headshotFor`.
4. Golf asked Movers for a sport it answered with a 400; now an empty 200.
5. A graded hit was announced to screen readers as "Win".
6. My own closeout doc blamed the 400px overflow on Scan's frozen table
   without identifying the element. It was the date field.

**WTA serve data** (`7797b72`, deployed): the Charting Project is the second
source for `tennis_match_stats` — WTA 1,759 rows, ATP 309 rows after TML's
stalled 2026-01-17, nothing counted twice. Serve vs return covers both tours on
factors both sources carry. Every tennis card carries a visible CC BY-NC-SA
credit (`SOURCE_CREDIT`).

**B3:** `scripts/check-controls-390.js` — PASS, 3 rows at 390px, exactly at
the limit. Runs through the Playwright MCP; the repo has no Playwright package.

**Logged, not fixed** (pre-existing, not breaking): Seattle's and Salt Lake's
MLS crests 404 (abbreviation-keyed URLs, since S1); ~1/3 of WTA headshots 404
on ESPN's CDN (documented in `identity.ts`).

**Verified:** 680/0; typecheck and build clean; 22 screenshots.
