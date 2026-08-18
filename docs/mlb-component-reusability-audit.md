# MLB Component Reusability Map

**Scope**: Read-only audit. No code was changed. MLB's UI/behavior was not modified in this pass — where MLB code looked like a bug or inconsistency, it's reported as a finding only.

**Method**: Every file in `components/` was enumerated from the actual filesystem, then cross-referenced against real imports (`app/**/page.tsx` → `components/*`, and `components/*` → `components/*`) to determine actual, current usage — not descriptions from any prior session. Prop interfaces were read directly from source. All file:line references below point at real code as of this audit.

---

## Step 0 — Component inventory

`components/` contains 70 files (~21,550 lines): 46 `.tsx` components, 24 `.ts` hooks/helpers.

### Grouped trivially (generic, no sport awareness, not given full treatment)
- [`icons.tsx`](../components/icons.tsx) — 25 pure SVG icon functions, no data dependency.
- [`Skeleton.tsx`](../components/Skeleton.tsx) — loading placeholders (`Skeleton`, `ScanCardSkeleton`, `PlayerSkeleton`, etc.), pure layout, no sport logic.
- [`BrandedLoader.tsx`](../components/BrandedLoader.tsx) — full-page loading splash, no sport logic.
- [`SegmentedToggle.tsx`](../components/SegmentedToggle.tsx) — generic `<T extends string>` tab control.
- [`Chip.tsx`](../components/Chip.tsx) — generic tone/shape/size badge primitive.

### Everything else — full treatment below, organized by category

| # | Component | Category | Used by (verified via imports) |
|---|---|---|---|
| 1 | `GameDetail.tsx` (`LeftRail`, `RankingsHeatGrid`, `RankingsScale`, `RankingsTiers`, `computeStreak`, `GameDetailGame`/`StatKeyDef` types) | **1 — proven reusable, exported, but under-adopted** | MLB game page; `GameHeroCard` imports `computeStreak`/`GameDetailGame`; `PlayerDetail`/`TeamDetail` import the types |
| 2 | `PlayerDetail.tsx` (`DistributionChart`, `WindowBox`, `FilterChip`, `ordinal`, `OpposingStarterStat` type, main `PlayerDetail` component) | **1 — proven reusable (already 2-sport)** | MLB + Golf player pages directly; helpers reused by NFL, Golf, MLB team/matchup components |
| 3 | `StatRankRow.tsx` (`StatRankRow`, `TwoSidedStatRankRow`) | **1 — proven reusable** | MLB (`TeamDetail`, `PlayerDetail`, `PitchingMatchupCard`, `BatterPitcherMatchupCard`), NFL (`NflGameDetail`, `NflTeamDetail`, `NflPlayerDetail`, `NflPlayerVsDefenseCard`), Golf (`GolfPlayerStatsCard`) |
| 4 | `StatCells.tsx` (`HitRateCell`, `StreakCell`, `InsufficientMark`, `formatRate`, `AverageCell`, `GradientRateCell`, `GradientStreakCell`, `GradientDeltaCell`) | **1 — proven reusable, but NFL doesn't use it yet** | MLB (`GameDetail`, `PlayerDetail`, `ScanTable`, `ScanCard`, `DenseViews`, `InsightRow`) — zero NFL imports |
| 5 | `StandingsTables.tsx` | **1 — proven reusable** | MLB `TeamDetail` **and** `NflTeamDetail` |
| 6 | `SubjectAvatar.tsx` (`SubjectAvatar`, `TeamLogo`, `GameMatchupLabel`) + per-sport URL helpers (`mlbHeadshotUrl`, `mlbTeamLogoUrl`, `nflTeamLogoUrl`) | **1 — proven reusable** | Every page in every sport |
| 7 | `OddsChip.tsx` (`OddsChip`, `OddsPair`, `EdgeBadge`, etc.) | **1 — mostly reusable; `EdgeBadge` is 3, not 1** | `OddsChip` itself used everywhere incl. NFL; `EdgeBadge` used only in `GameDetail`, `PlayerDetail`, `TeamDetail`, `GameLinesView` — **zero NFL usage** |
| 8 | `MarketLabel.tsx` (`marketText`, `categoryText`, `MarketLabel`, `MarketLine`) | **1 — proven reusable, designed sport-aware from the start** | Takes `sport: Sport` as an explicit first param everywhere; used across MLB/NFL/bets pages |
| 9 | `GamesStrip.tsx` | **1 — proven reusable via a real small-optional-prop fix** | Used by MLB and NFL game/team/player pages. See Finding G below — `logoFor` prop was added specifically to fix an NFL bug |
| 10 | `TopBar.tsx`, `AppShell.tsx` | **1 — proven reusable, core sport dispatcher** | `AppShell({ sport })` is the single entry shell for mlb/nfl/golf; branches internally (`hasPropsPipeline`, `scanView` defaults, etc.) |
| 11 | `SlipModal.tsx` | **1 — proven reusable** | Every sport's game/player/team pages |
| 12 | `useSnapshot.ts`, `useSlip.ts`, `useGameLines.ts`, `useGamePickRecord.ts` | **1 — proven reusable hooks** | All take `sport: Sport` as a real param; used by every sport |
| 13 | `PropOddsPanel.tsx` (`PropOddsBoard`) | **1 — proven reusable** | Both `PlayerDetail.tsx` (MLB/Golf) and `NflPlayerDetail.tsx` |
| 14 | `PlayerDetailPanel.tsx` | **1 — proven reusable, already the working "dispatcher" model** | Rendered by `AppShell` for every sport; internally picks `PlayerDetail` vs `NflPlayerDetail` by `sport` |
| 15 | `ScanCard.tsx`, `ScanTable.tsx`, `FilterBar.tsx`, `FilterSidebar.tsx`, `PlayerFilterDrawer.tsx`, `DateGameStrip.tsx`, `GameLinesView.tsx`, `TodaysPicksModal.tsx` | **1 — proven reusable, entire Scan surface is already cross-sport** | All rendered by `AppShell` for mlb/nfl/golf today, each with internal `sport ===` branches |
| 16 | `ConfidenceChip.tsx`, `PropScoreBadge.tsx`, `PercentileRing.tsx`, `MicroBars.tsx`, `InsightRow.tsx` | **1 for Scan surface / not adopted in NFL detail pages** | Used in `ScanCard`/`ScanTable` (rendered for NFL) and in `PlayerDetail.tsx`; **not imported anywhere in any `Nfl*.tsx` detail file** |
| 17 | `lib/sports/mlb/teamColors.ts` / `lib/sports/nfl/teamColors.ts` | **2 — real adapter-function pair, already built** | Identical exported signatures (`teamPrimaryColor`, `withAlpha`); MLB keys by numeric `teamId`, NFL keys by `abbreviation` — this is the adapter-function model the audit asked to find |
| 18 | Per-sport `toStat`/`toStatRow`/`teamSeasonStatRows` functions (`NflGameDetail.tsx:270`, `NflPlayerDetail.tsx:54`, `NflTeamDetail.tsx:87`, `TeamDetail.tsx:54`) | **2 — real adapter-function pattern, already repeated 4x** | Each converts a sport's raw stat line into the generic `OpposingStarterStat { key, label, value, decimals, rank, poolSize, group? }` shape `StatRankRow` needs |
| 19 | `NflTeamScopePanel.tsx` (new, untracked) | **2 — adapter/rewrite of an existing MLB component's *content*, correctly kept separate** | Explicitly documented (file header) as "the honest equivalent of `GameDetail`'s `TeamScopePanel`" — rebuilt because MLB's version is hardcoded Good-Bets-only copy that doesn't fit NFL. This is a *content* fork, not a structural one — reuses `OddsChip`/`TeamLogo` underneath |
| 20 | `BatterPitcherMatchupCard.tsx`, `PitchingMatchupCard.tsx` | **3 — genuinely sport-specific (mechanism is generic, vocabulary isn't)** | Stat vocabulary is real baseball stats (AVG/OBP/SLG/ERA/WHIP/FIP); mechanism (two-sided rows split by shared-stat-key membership) already rides on the generic `StatRankRow`/`TwoSidedStatRankRow` |
| 21 | `useBullpen.ts` + bullpen/live-diamond visuals in `GameHeroCard.tsx`/`PlayerDetail.tsx` (`BaseDiamond`, `CountDots`) | **3 — genuinely sport-specific, correctly MLB-only** | Closer/setup relief-pitcher concept and base-occupancy diamond have no football equivalent |
| 22 | `NflPlayerVsDefenseCard.tsx` | **3 — genuinely sport-specific, and the code says why** | File header explicitly explains it is *not* `BatterPitcherMatchupCard` because no player-level defensive rank exists in NFL data, only team-level defense-allowed ranks — an honest, self-documented "no" |
| 23 | `NflGameHeroCard.tsx` | **4 — hand-rebuilt, much smaller than MLB's real component** | See Finding A |
| 24 | `NflTeamDetailPanel.tsx` | **4 — hand-rebuilt, near-byte-for-byte duplicate of `TeamDetailPanel.tsx`** | See Finding B |
| 25 | `NflGameDetail.tsx` | **4 — hand-rebuilt; exported-and-generalized MLB primitives sit unused** | See Finding C |
| 26 | `NflPlayerDetail.tsx` | **4 — hand-rebuilt as a wholly separate file, despite Golf proving the alternative works** | See Finding D |
| 27 | `NflTeamDetail.tsx` | **Partial reuse (better than the others)** | Reuses `DistributionChart`/`WindowBox`/`FilterChip`/`StandingsTables`/`StatRankRow` from the shared files; still a separate 793-line file from `TeamDetail.tsx` (729 lines), not a branch inside it |
| 28 | Golf-only: `GolfScheduleView.tsx` (1442 lines), `GolferStrip.tsx`, `GolfPlayerStatsCard.tsx`, `TournamentLinesView.tsx`, `useGolfSchedule.ts`, `useGolfLines.ts`, `useGolfPlayerStats.ts`, `useGolfFieldStats.ts` | **3 — genuinely sport-specific presentation, but built on the same shared primitives** | Tee times/tournament field/strokes-gained have no MLB/NFL equivalent; `GolfPlayerStatsCard` reuses `ordinal`/`OpposingStarterStat` from `PlayerDetail.tsx` |
| 29 | `GameLine.tsx` (`LiveScoreBar`, `BookmakerBreakdown`, `GameLineBlock`, `OddsStatusPanel`, `TodaysLine`) | **Not in use — orphaned** | Zero imports anywhere in the codebase today. Flagging as an inventory finding, not fixing it. |

---

## Findings — reusability evidence, data shapes, and MLB-vs-NFL deltas

### Finding A — `GameHeroCard` (MLB, 1059 lines) vs `NflGameHeroCard` (NFL, 125 lines): NFL's hero card is missing most of MLB's feature set, not just restyled

Reading both top to bottom:

| Feature | MLB `GameHeroCard.tsx` | NFL `NflGameHeroCard.tsx` |
|---|---|---|
| Tabs | Matchup / Live tab pair (`useState` tab switch) | None — single static layout |
| Weather | Full forecast footer: temp, wind (with compass-rotated arrow icon), rain %, computed "weather impact" 4-segment meter | None |
| Pick panel | Winner/Total lean panel with percent bar, lock countdown (`lockTime`), "Provisional" vs "Locked" state, `ChangedBadge` for a pick that moved since the 6am read | None — only shows raw moneyline/spread/total book prices |
| Live state | Dedicated live-inning band (`live-bg`/`live-green` tokens), by-inning line score, live pitching lines | A compact down/distance/red-zone strip — real but much thinner |
| Streak/division rank | `streakLabel`, division-rank badge in `TeamPanel` | Not shown (record only) |
| Team tint | Per-side gradient wash of the team's real primary color (`withAlpha(teamPrimaryColor(...), '26')`), same technique NFL's version also uses | Same technique, but only in the outer card background, not per-team panel |

**Data shape**: `NflGameHeroCardProps` (`home`, `away`, `kickoff`, `liveState`, `gameLine`) is a much smaller shape than `GameHeroCard`'s implicit prop surface (game object + `GamePickView` + `TeamBullpen` + `LiveInningPlay[]`/`LiveTotals` + weather). This isn't a case of a generic component with an MLB-shaped prop — MLB's version pulls in strictly more real data (weather, locked picks, bullpen) that NFL's route may or may not currently have available; this audit did not verify NFL's API routes carry a weather/lock-pick equivalent, so it's reported as an open question, not a confirmed gap in category 2's sense.

**Category**: 4. Whether the missing features (tabs, weather, pick-lock panel) are things NFL's data actually supports yet is outside this audit's read-only scope on the API layer — flagged under "not covered" below.

### Finding B — `TeamDetailPanel.tsx` vs `NflTeamDetailPanel.tsx`: literal duplicate, not an adapter

Side-by-side, the two files are structurally identical: same search-box markup, same `role="listbox"` team-picker `<ul>`, same `useMemo` sort/filter logic, same `lg:grid-cols-[260px_1fr]` layout, same Tailwind classes character-for-character in most rows. The only real differences:

- `useAllTeams()` → `useAllNflTeams()`
- `<TeamDetail .../>` → `<NflTeamDetail .../>`
- `TeamDetailPanelProps` carries `snapshot`/`odds`; `NflTeamDetailPanelProps` doesn't

This is the cleanest possible category-1 candidate that wasn't actually treated as one: the panel shell has zero MLB-specific concepts in it (a searchable team list + a detail pane). It could have been one generic component parameterized by a `useTeams()` hook and a `renderDetail(teamId)` render-prop, the same way `PlayerDetailPanel.tsx` already dispatches between `PlayerDetail`/`NflPlayerDetail` internally (see row 14 in the inventory table). Instead it was copy-pasted wholesale.

**Category**: 4 (should have been 1).

### Finding C — `GameDetail.tsx` already exports generalized ranking primitives NFL doesn't use

`GameDetail.tsx` exports `RankingsHeatGrid`, `RankingsScale`, and `RankingsTiers`, each taking a `poolSize` param defaulting to 30, with this comment already in the code at [`GameDetail.tsx:1308`](../components/GameDetail.tsx):

> "Size of the ranked pool (30 for MLB, 32 for NFL) — the scale's divisor, so a mid-pack rank still lands visually mid-scale regardless of league size."

This confirms the audit prompt's reference to a fixed 30-team divisor bug — it's already fixed and the fix is already NFL-aware. But `NflGameDetail.tsx` never imports `RankingsHeatGrid`/`RankingsScale`/`RankingsTiers`/`LeftRail` at all (verified: no `from './GameDetail'` import in the file). Instead it hand-rolls its own `GradesTable` for the equivalent "rankings" section, using a plain `<table>` with no heat/scale/tier visualization.

There's a real mitigating factor: MLB's own record/last-five-games/injuries sections (`RecordsSection`, `LastFiveGames`, `GameTile`, `Injuries`/`InjuryPanel`) are **not exported** from `GameDetail.tsx` — they're module-private functions. NFL genuinely could not have imported those even if it wanted to; it had to rebuild `GameTile`/`InjuryList`/records-view-toggle from scratch regardless. So part of NFL's duplication here is a direct consequence of MLB's own file not exposing reusable pieces, not just a choice NFL made.

Where NFL *did* have a real, exported, already-NFL-aware option (`RankingsScale`/`RankingsTiers`/`RankingsHeatGrid`) and built its own simpler `GradesTable` instead, that's a genuine miss — though NFL's "Unit grades" concept (offense/defense/special-teams grades) isn't the same data as MLB's per-stat league rank, so a straight swap wasn't literally drop-in; it would need the same kind of adapter function already used elsewhere (row 18).

**Category**: 4 for the parts with a real exported alternative sitting unused; not really NFL's "fault" for the unexported MLB-private pieces.

### Finding D — `PlayerDetail.tsx` already branches for two sports; NFL didn't extend that pattern

`PlayerDetail.tsx` is directly imported by both `app/mlb/player/[playerId]/page.tsx` and `app/golf/player/[playerId]/page.tsx` — it is **already a real two-sport component**, branching internally via `active.sport === 'golf'` / `active.sport === 'mlb'` in at least 11 places (baseball's live diamond/count-dots vs golf's scorecard/hole-matchup/strokes-gained UI all live in the same file).

NFL did not extend this pattern. `NflPlayerDetail.tsx` is a wholly separate 594-line file (`app/nfl/player/[playerId]/page.tsx` imports `NflPlayerDetail`, not `PlayerDetail`). It does reuse `PlayerDetail.tsx`'s exported helpers (`DistributionChart`, `WindowBox`, `FilterChip`, `ordinal`, `OpposingStarterStat`) — so the *primitives* transferred, but the *page-level component* didn't follow the precedent Golf set for "add a sport branch to the one file" vs. "duplicate the file."

One concrete consequence: `ConfidenceChip`, `PropScoreBadge`, `PercentileRing`, `MicroBars`, and `InsightRow` are all used inside `PlayerDetail.tsx`'s MLB/golf rendering paths but are not imported anywhere in `NflPlayerDetail.tsx` — NFL's player page is visually plainer in a way that's a direct side effect of being a separate file rather than a branch in the file that already uses that visual vocabulary.

**Category**: 4, with the caveat that this is an architecture-strategy inconsistency (branch-in-file vs. duplicate-file), not a case where reuse was structurally impossible — Golf is the existence proof.

### Finding E — `NflTeamDetail.tsx` is the best-behaved of the NFL rebuilds

Unlike the panel and player-detail duplicates, `NflTeamDetail.tsx` actually imports and reuses `DistributionChart`, `WindowBox`, `FilterChip` from `PlayerDetail.tsx`, `StandingsTables` from `StandingsTables.tsx`, and `StatRankRow`/`TwoSidedStatRankRow` from `StatRankRow.tsx`. It's still a separate 793-line file rather than a branch inside `TeamDetail.tsx` (729 lines), so genuine duplication of shell/layout code exists, but the duplication is smaller in proportion — the actual data-visualization primitives are shared, only the page-assembly code is forked.

**Category**: mixed 1 (for the parts it reuses) / 4 (for the shell it duplicates) — reported honestly as the strongest of the four NFL rebuilds, not lumped in with the others.

### Finding F — `EdgeBadge` and the Edge-badge-adjacent primitives have no NFL equivalent, confirmed

`EdgeBadge` (in `OddsChip.tsx`) takes `{ edge, modelProb, marketProb, label }` and is used only in `GameDetail.tsx`, `PlayerDetail.tsx`, `TeamDetail.tsx`, `GameLinesView.tsx` — zero occurrences in any `Nfl*.tsx` file. This matches the audit prompt's own note that NFL has no probability model yet. Reported here as confirmed-true from the actual code, not assumed.

### Finding G — `GamesStrip.tsx`: the real "small optional prop" success story

`GamesStrip.tsx` documents its own generalization at [`GamesStrip.tsx:42`](../components/GamesStrip.tsx):

> "Resolves a team's logo by abbreviation for sports without a numeric `awayTeamId`/`homeTeamId` (NFL's `SlateGame` cast never carries one — `TeamMark`'s default `teamId`-keyed MLB CDN lookup silently rendered nothing). Falls back to the existing `teamId` path when omitted, so MLB is unaffected."

This is exactly the category-1 pattern the audit asked to find evidence of: a real bug NFL hit (broken logos), fixed with one new optional prop (`logoFor`), MLB's call sites untouched. Worth citing as the model for what "small optional-prop addition" should look like elsewhere in this codebase.

---

## Styling / animation infrastructure

**A real shared design-token system exists** and is not assumed — confirmed directly:

- [`tailwind.config.ts`](../tailwind.config.ts): a full color-token set (`masters`, `accent`, `good`/`bad`/`warn`, `ink-*` scale, `line-*` scale, `live-*` scale — all in `oklch()` with the `<alpha-value>` placeholder for opacity modifiers), a 10-step named font-size scale (`micro` → `display-lg`), shadow tokens (`card`, `card-hover`, `pop`, `live`, `drawer`, `hero`), radius tokens, and three custom keyframe animations (`lb-pulse`, `lb-shimmer`, `lb-fade-slide`).
- [`app/globals.css`](../app/globals.css): a matching `.lb-*` component-class layer (`lb-card`, `lb-card-hero`, `lb-card-interactive`, `lb-chip`, `lb-tab`, `lb-filter`, `lb-stat`, `lb-btn-primary`, `lb-skel`, `lb-dense`, `lb-scroll-x`), plus a `prefers-reduced-motion` override.

**NFL components do use this system** — `lb-card`, `lb-card-hero`, `lb-chip`, `lb-btn-primary`, `lb-scroll-x`, and the semantic color tokens (`bg-accent-soft`, `text-masters`, `bg-bad/10`, `text-bad`, `border-line`) all appear throughout `NflGameDetail.tsx`, `NflTeamDetail.tsx`, `NflPlayerDetail.tsx`. This is real, not superficial — the color/component-class layer is genuinely shared.

**Where NFL drifts, measured directly by grepping for arbitrary-value usage vs named type-scale tokens** (`text-dense`/`text-meta`/`text-label`/`text-body`/`text-emphasis`/`text-title`/`text-display-*` vs raw `text-[Npx]`):

| File | Named-token uses | Arbitrary `text-[Npx]` uses |
|---|---|---|
| `GameHeroCard.tsx` (MLB) | 68 | **0** |
| `NflGameHeroCard.tsx` (NFL) | **0** | 10 |
| `GameDetail.tsx` (MLB) | many | **0** |
| `NflGameDetail.tsx` (NFL) | some | 32 |
| `TeamDetail.tsx` (MLB) | some | 35 |
| `NflTeamDetail.tsx` (NFL) | some | 36 |
| `PlayerDetail.tsx` (MLB/Golf) | some | 109 |
| `NflPlayerDetail.tsx` (NFL) | some | 34 |

Two honest conclusions from this data, not one simple story:

1. **`GameHeroCard.tsx` and `GameDetail.tsx` are the two most disciplined files in the codebase** — 100% named-token usage, zero arbitrary pixel values. Their NFL counterparts (`NflGameHeroCard.tsx`, `NflGameDetail.tsx`) are the two files where the regression is starkest — `NflGameHeroCard.tsx` uses *zero* named type-scale tokens.
2. **This isn't purely an NFL problem.** `TeamDetail.tsx` and `PlayerDetail.tsx` — MLB's own files — already use arbitrary pixel sizing heavily (35 and 109 occurrences respectively). NFL's `NflTeamDetail.tsx`/`NflPlayerDetail.tsx` continue that existing looseness rather than introducing a new one. The inconsistency that's visible between MLB and NFL pages is therefore partly "NFL regressed from a standard MLB actually met" (hero card, game detail) and partly "NFL inherited a standard MLB never fully met either" (team/player detail).

**A second, deliberate pattern, not drift**: `GameHeroCard.tsx` defines a local `const C = {...}` object of raw hex strings ([`GameHeroCard.tsx:37-59`](../components/GameHeroCard.tsx)), each with a comment mapping it back to the real Tailwind token name (`cardBorder: '#d3d4d7', // line`). The file's own header comment explains why: inline `style={}` gradients/dynamic values can't consume Tailwind utility classes, so the token values are manually mirrored for call-site brevity, "every value below is copied straight from tailwind.config.ts, not invented here." `NflGameHeroCard.tsx`, `NflTeamDetail.tsx`, and `NflPlayerDetail.tsx` all do the same thing (raw hex in `style={}`, e.g. `borderTop: '3px solid #141619'`) but **without** the equivalent comment explaining the mapping or flagging the duplication risk. This is a real but minor inconsistency: the *pattern* is consistent (both sports hand-copy token values into inline styles for the same structural reason), but the *documentation discipline* isn't — a future token-value change in `tailwind.config.ts` would need someone to remember to update all four files' hardcoded hex, and only one of the four says so.

---

## What this audit does NOT cover

- **Whether NFL's underlying data/API layer actually supports the features `GameHeroCard` has that `NflGameHeroCard` lacks** (weather forecast, locked-pick history with a 6am-read comparison, bullpen-equivalent live detail). This audit read component code only, not the NFL API routes in depth — it's possible some of these are legitimate "not built yet" gaps rather than "component too dumb" gaps. Flagged as an open question in Finding A, not resolved.
- **Golf's components were read at prop-interface and cross-import depth, not line-by-line.** `GolfScheduleView.tsx` alone is 1442 lines; a full internal audit of golf-specific logic (tee-time handling, field-stats scoring) was out of scope for the time available here.
- **`AppShell.tsx` (938 lines) and `ScanTable.tsx`/`ScanCard.tsx` (897/407 lines)** were confirmed to be genuinely cross-sport via real `sport ===` branch points and real NFL render paths, but were not read exhaustively line-by-line — a deeper pass could surface smaller per-branch inconsistencies this audit didn't have time to find.
- **Runtime/visual behavior** (actual hover states, animation timing as rendered, responsive breakpoints in a real browser) was not verified in a browser — everything above is from static reading of the source, per the read-only constraint of this audit. A side-by-side screenshot comparison of MLB vs NFL game/player/team pages would sharpen Finding A/B/C/D's "what's different" claims beyond what static code reading can show.
- **`lib/sports/**` (non-component code)** was only sampled (`teamColors.ts`) for the adapter-function evidence in Finding C's category-2 row; the fuller adapter-function landscape (stat-fetching, ranking, grading logic per sport) was not inventoried.
- **`useTeamForm.ts`, `useTeamBatterRanks.ts`, `useTeamStatcast.ts`, `useTeamRoster.ts`, `useAllTeams.ts`/`useAllNflTeams.ts`, `useLiveGame.ts`, `useGameContext.ts`, `useMarketCalibration.ts`, `useFilters.ts`** — these hooks were located and their approximate purpose confirmed by name/size, but not individually read for MLB-specific assumptions the way the headline components were. `useAllTeams.ts`/`useAllNflTeams.ts` in particular are a same-shape hook pair (like `teamColors.ts`) that would be worth a closer adapter-pattern look in a follow-up pass.
