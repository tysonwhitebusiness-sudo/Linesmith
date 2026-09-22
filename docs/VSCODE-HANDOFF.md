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

## Session state — 2026-09-21

**C4 is shipped in full** — three commits:
- First C4 commit (`5d3ca40`): book domains, game-card stripe + 36px logos +
  live treatment, Books-section marks + gap pill + AvatarGroup.
- C4 imagery follow-up (`f7bc9fe`): Spotlights headshots/logos
  (`subjectMeta.headshotUrl`/`teamLogoUrl` → `SpotlightRow`), Model team logos
  (`mlbTeamLogo` → `ModelPickRow.awayLogoUrl`/`.homeLogoUrl`), Movers player
  headshots (`moverHeadshot` + `sport` prop through `SlateMovers`), and the
  GameCard footer book-marks `AvatarGroup` (`SlateMarket.booksList`, populated
  in `buildSlate.ts` `marketFor`). `tests/slate-model-lines.test.ts` key pin
  updated for the two new logo keys.
- C4 image audit (`5b7c997`) — the operator's pass over the rendered cards:
  team logos on the market-shape cards (from the snapshot's subjects, no player
  faces there) and as a badge on Spotlight rows; Model logos moved next to each
  team name (not stacked at the start); Specials made text-only; the GameCard
  footer book marks and `SlateMarket.booksList` removed; and the MLB headshot
  unified to `w_213` (identity.ts was still serving `w_80` to the search rail,
  Movers and game research).
- C4 image fixes (`6fc0eac`) — the operator read the rendered cards again and
  reversed three of the audit's calls: the market-shape cards now show a player
  FACE with the team mark as a badge (not the team mark alone); Specials get a
  team mark beside the name (not text-only); and the GameCard footer book marks
  are back. The real sizing bug was found and fixed at the source: MLB's CDN
  returns a **213×320 portrait** for `w_213`, which `object-cover` centre-crops
  in the circle and slices the head. Every MLB headshot URL now requests
  `c_thumb,g_face,w_213,h_213` (a 213×213 face crop) — `identity.ts`,
  `SubjectAvatar.tsx`, `mlb/adapter.ts`, `mlb/teamResearch.ts`,
  `playerBio.ts` — and a shared `headshotFor(sport, id)` dispatcher now serves
  the Slate market cards (NFL was already fine: ESPN serves square headshots).
Next phase: **C6** props controls (tabs → filters).

### Corrections to the previous session's chat

- The chat said *"Writing the new TeamHero … Created 2 files"* — **not
  accurate on disk.** `TeamHero` is defined **inline** in
  `components/TeamResearchPage.tsx` (line ~185), not a new file. The only new
  shared piece is `HeroTileGrid`, extracted into
  `components/PlayerResearchSections.tsx` and reused by both heroes.
- `patch_c2b_data.py` and `patch_tilegrid.py` were disposable scratch scripts;
  they are gone from the tree (correct — nothing to recover).
- "The colours route accepts `soccer_epl` directly" was a *verification*, not a
  change: no API route file is modified. Team colour comes from
  `useTeamColors(sport)` + `teamColor()` + `bandColors()`, already built in C0.

### Verification done here (2026-09-21)

- `npm run typecheck` clean; full suite **641 pass / 0 fail** (before and after the design edits); `npm run build` clean.
- Functional DOM checks on MLB (Yankees), NFL (Vikings), NHL (Wild), NBA (Celtics), soccer (Arsenal): band, chips, next game, Home line, ranked tiles with correct per-sport ranks (MLB 9th/1st of 30, NFL 26th of 32, NHL 11th of 32, NBA 19th/1st of 30, soccer 2nd of 20), and last-ten form rows.
- The body toggle the previous session left hanging works: "Show" → "Hide", `aria-expanded` flips, Last 10 appears.
- **Caveat:** the embedded browser renders at ~201×125 CSS px, so pixel screenshots are unreliable here. Visual sign-off at 1440/400 is the operator's, in a real browser (prod server left running on `:3000`).

### Next

- **C6** Props controls (Track C, phase 9, no deploy): tabs → filters, Home
  Runs board deleted. Read the run doc §3 correction 3 first — `AppShell.tsx`
  line numbers have moved.
- **C4 follow-ups (done):** headshots/logos and the footer book-marks are in,
  and the operator's image audit is applied. Still left for later, both *data*
  additions to `lib/slate/marketMoves.ts`: Movers game-line rows still show text
  matchups (no team logos — `ConsensusMover` carries no team ids), and the
  Movers "books moved" cell still shows a count (no per-book marks — no book
  list on the mover row).
- **C3 follow-ups:** `matchup` typed but not populated; team/game/injury rail
  filters not wired; `statusLine` kept for other consumers.
- **NBA spotlights deferred** (run doc A6): needs a Python `'nba'` games loader.
- **N5 (weather)** ships with F0-UI.

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
