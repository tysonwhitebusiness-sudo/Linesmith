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

**C3 is shipped** — committed and pushed (structured headline/matchup on the
rail, sort + has-props filters, URL state). Next phase: **C4** Slate imagery
(no deploy).

- Commits: `5f9a7df` PY-B (32 spotlights, deployed), then the C3 commit.

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

- **C4** Slate imagery (Track C, phase 8, no deploy): Game-card stripes, 36px
  logos, book marks (add `kalshi`/`prophetx`/`hardrockbet`/`betrivers` to
  `BOOK_DOMAIN`), footer row, live-state treatment.
- **C3 follow-ups (non-blocking):** `matchup` is only typed, not populated —
  it needs per-sport game-context plumbing in each adapter (MLB has the game
  object at the subject site; NFL/others need it wired). `statusLine` is kept
  (PlayerFilterDrawer, TournamentLinesView and golf leaderboards still read
  it); delete it once every consumer has moved. The rail's team/game/injury
  filters from the plan are not yet wired (data isn't in the subject meta).
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
