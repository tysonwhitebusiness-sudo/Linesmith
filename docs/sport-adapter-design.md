# Sport-Adapter Architecture — Phase 0 Design

**Status: design only. No component code has been changed to produce this document.**

Companion to [`mlb-component-reusability-audit.md`](mlb-component-reusability-audit.md) and [`golf-component-reusability-audit.md`](golf-component-reusability-audit.md), which this design is built directly from — every interface below is derived from real current prop types and real current branch points in the working tree, not invented. Where a field's universality is asserted, the evidence is cited by file:line.

**Goal**: define, per shared component, a generic data interface with no `sport === 'x'` branching inside the component itself. Sport-specific transformation lives in one small adapter file per sport per component family, under `lib/sports/{sport}/adapters/`. Genuinely non-generalizable UI (MLB's live diamond, Golf's scorecard, NFL's position-keyed matchup groups) stays as separate sport-specific sub-components the generic parent optionally renders — never forced into the shared shape.

**A load-bearing fact discovered during research**: a real chunk of this architecture already exists and is already proven working across two or three sports. This design formalizes and extends that precedent — it does not invent a new pattern from scratch. See "Already Category 1 — do not rebuild" at the end of each section.

---

## 0. Foundational shared types (already exist — reuse verbatim, do not redefine)

```ts
// components/GameDetail.tsx:79-83
interface StatKeyDef {
  key: string;
  label: string;
  decimals: number;
}

// components/GameDetail.tsx:86-89 — added in current uncommitted work specifically to let NFL
// feed the Rankings views without fabricating unused MLB-only TeamGameContext fields.
// This narrowing is the working precedent this entire design generalizes.
interface RankableTeamStats {
  forRanks: Record<string, string | null>;
  againstRanks: Record<string, string | null>;
}

// components/PlayerDetail.tsx:114-121
interface OpposingStarterStat {
  key: string;
  label: string;
  value: number;
  decimals: number;
  rank: number;
  poolSize: number;
}
```

`OpposingStarterStat` is already the proven universal "one ranked stat" shape — consumed by `StatRankRow`/`TwoSidedStatRankRow` (`components/StatRankRow.tsx:13,36-44`) and by `BatterPitcherMatchupCard` (already called directly with real NFL team-level data at `components/NflGameDetail.tsx:518,521` and `components/NflTeamDetail.tsx:590`, not just MLB). Five separate functions currently produce it (`TeamDetail.tsx:54-64`, `PlayerDetail.tsx:154-164` — a byte-identical undocumented duplicate — `NflGameDetail.tsx:318`, `NflPlayerDetail.tsx:53-55`, `NflTeamDetail.tsx:86-88`), each hardcoding `poolSize` (30 or 32) inline. Phase 1 consolidates these into one canonical function per sport in `lib/sports/{sport}/adapters/statRowAdapter.ts`, parameterized by pool size rather than hardcoding it five times.

`WindowedStat` (from `lib/core/windowedStat`) is likewise already fully shared — MLB (`PlayerDetail.tsx:1081-1098`) and NFL (`NflPlayerDetail.tsx:215-232`) build the identical 5-key `{l5,l10,l15,h2h,szn}` shape via the same `fixedWindow`/`openWindow`/`subsetWindow` helpers; only the H2H opponent-match predicate differs by field name (numeric `opponentId` vs string `opponentAbbr`), which is exactly adapter-layer work, not a component concern.

`PickCandidate`, `PropOddsRow`, `TeamStandingRow` are likewise already sport-agnostic and used unchanged everywhere — not redesigned here.

---

## 1. `GameDetail.tsx` family — already the furthest along

**Verdict up front**: `LeftRail`, `RankingsHeatGrid`, `RankingsScale`, `RankingsTiers`, and `gameMarketCandidate` are **already exported, already generic, and already consumed directly by NFL** (`components/NflGameDetail.tsx:19,467-484,651,654,657,457`) — not through a fork, through literal imports. This is Category 1, proven, today. Nothing to redesign here; Phase 1/2 just needs to make sure MLB's own call sites keep using the un-widened defaults they already use (`goodBetsGated` defaults `true`, `poolSize` defaults `30`), which they do.

What's **not yet shared**, and is the real Phase 1/2 target for this family: `RecordsSection`, `LastFiveGames`/`GameTile`, `Injuries`/`InjuryPanel`, and `PicksPanel` are module-private (`components/GameDetail.tsx`, not exported), so NFL's current uncommitted diff hand-rolled its own version of every one of them inline (`NflGameDetail.tsx:552-600` records, `:116-131,133-145` game tiles, `:668-680` injuries, `:716-796` picks aside) — even though its own code comments say the underlying data is "the same shape GameDetail.tsx's RecordsSection gives MLB." This is duplicated code with comparable data, the exact case the brief asks to fix.

### 1a. `RecordsSection` — proposed generic props

```ts
interface GameRecord { wins: number; losses: number; }

interface TeamRecordsData {
  abbr: string;
  logoUrl: string;
  record: GameRecord | null;
  homeRecord?: GameRecord | null;   // universal concept; NFL's splitRecord() (NflGameDetail.tsx diff ~310-316) now computes this too
  awayRecord?: GameRecord | null;
  lastTen?: GameRecord | null;
  divisionRank?: string | null;     // real on both sides now — MLB: TeamGameContext.divisionRank (GameDetail.tsx:58); NFL: TeamDetailApiResponse.team.divisionRank, added in the current diff (NflGameDetail.tsx:66)
}

interface RecordsSectionProps {
  away: TeamRecordsData;
  home: TeamRecordsData;
  loading: boolean;
}
```
Both fields on `TeamRecordsData` are populable by both MLB and NFL today (confirmed above) — nothing here needs to be sport-gated.

### 1b. `LastFiveGames` — proposed generic props

```ts
interface RecentResultRow {   // unifies MLB's RecentGameResult (win/runsFor/runsAgainst) and NFL's RecentResult (homeScore/awayScore)
  gameId: string;
  date: string;
  win: boolean | null;        // null = tie/unresolved
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;           // runs (MLB) or points (NFL) — same concept, generic label
  scoreAgainst: number;
}

interface LastFiveGamesProps {
  awayRecent?: RecentResultRow[];
  homeRecent?: RecentResultRow[];
  awayAbbr: string;
  homeAbbr: string;
  loading: boolean;
}
```
`computeStreak(games: RecentResultRow[])` — the algorithm at `GameDetail.tsx:1092-1101` is already sport-agnostic (a run of identical `.win` from the front); only its declared parameter type (`RecentGameResult[]`, MLB-typed) needs widening to `RecentResultRow[]`. NFL's diff currently has no streak at all — once genericized, NFL gets streak badges for free by adapting `RecentResultRow[]` from its `RecentResult` data, which already carries everything needed (`homeScore`/`awayScore` → `win`).

### 1c. `Injuries` — proposed generic props

```ts
interface InjuryRow { playerName: string; status: string; position?: string; note?: string; }

interface InjuriesProps {
  awayAbbr: string;
  homeAbbr: string;
  awayInjuries: InjuryRow[];
  homeInjuries: InjuryRow[];
}
```
MLB's current `InjuryPanel` is explicitly typed to `lib/sports/mlb/statsapi.InjuryEntry` (`GameDetail.tsx:1442`) and keys by numeric MLB team id (`GameDetail.tsx:1472-1473`) — this needs an MLB adapter function `toInjuryRow()`. NFL injury data was not confirmed present in this pass (not covered by the research agents — flagged as an open question for Phase 1, not assumed to exist).

### 1d. `PicksPanel` — proposed generic props (the highest-value dedup in this family)

Currently module-private, single MLB call site (`GameDetail.tsx:1499-1517,1781-1790`); NFL's diff independently rebuilt an equivalent inline (`NflGameDetail.tsx:716-796`).

**Correction (found during Phase 2 implementation, not assumed here originally)**: the narrowed shape below is wider than this doc first sketched. The real `PicksPanel` body needs more than `id`/`awayAbbr`/`homeAbbr` — its `addLeg` helper stamps `homeTeamId`/`awayTeamId` onto every candidate's `subjectMeta` (used later for bet grading) and computes `moneylineEdge`/`totalEdge` off `game.gameModel` for the `EdgeBadge`s, and the market-candidate builder needs `sport` instead of the hardcoded `'mlb'` literal MLB's version currently has inline:

```ts
interface PicksPanelGame {
  id: string;
  sport: Sport;
  awayAbbr: string;
  homeAbbr: string;
  /** number for MLB (real numeric team id), null for NFL (only has string abbreviations/ids today) — gameMarketCandidate already normalizes an absent value to null internally, so this is a faithful, zero-behavior-change generalization for both sports, not a new gap. */
  homeTeamId: number | null;
  awayTeamId: number | null;
  /** MLB-only in practice; null for NFL (no probability model yet) — moneylineEdge/totalEdge and EdgeBadge naturally don't render when this is null, matching NFL's current behavior exactly. */
  gameModel: MoneylineResult | null;
}

interface PicksPanelProps {
  game: PicksPanelGame;
  gameCandidateSubjectIds: Set<string>;
  picks: PickRow[];
  onRemovePick: (id: number) => void;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string }) => void;
  eventContext: string | null;
  gameLine: UnifiedGameLine | null;
  disabled: boolean;
}
```
Once exported with this narrowed `game` shape, NFL's entire hand-rolled ~80-line picks aside (`NflGameDetail.tsx:716-796`) deletes outright — real duplicate code removal, not just a design nicety.

### 1e. `TeamScopePanel` default — no redesign needed

`LeftRail`'s `teamScopePanel` override prop (`GameDetail.tsx:658-663`) already exists and is already the adapter-injection pattern this whole project is asking for — `NflTeamScopePanel.tsx` is a real, working, already-shipped example of "sport supplies its own content behind a shared slot" (its own header comment says exactly this: "the honest equivalent of GameDetail's TeamScopePanel... doesn't fit NFL"). Keep MLB's private `TeamScopePanel` as the *default* (it's genuinely MLB-specific content — gated on real graded pick history only MLB has), and keep the override slot as the extension point. Nothing to change here except documenting it as the canonical example in Phase 4.

---

## 2. `GameHeroCard` vs `NflGameHeroCard`

MLB's version (1059 lines) is a strict superset of NFL's (125 lines) in every dimension measured — not a restyle, a real feature gap in some areas and a real *data* gap (not NFL's fault) in others. Distinguishing which is which matters for how each field gets typed.

**Implemented in Phase 2 (2026-08-18) — corrections against the sketch below, found while building it, same posture as §1d's `PicksPanelGame` correction:**
- The sketch's flat `game: GameSummary` was wrong for a per-team-panel component — split into `away`/`home`: `GameHeroTeamPanelData { abbr; teamId?; name?; href?; logoUrl?; record; divisionRank?; streak?; tintColor: string; renderBadges?: () => ReactNode }`. `tintColor` is pre-resolved by each sport's own adapter (`teamPrimaryColor()+withAlpha()`) — same reasoning as `RankableTeamStats`/`PicksPanelGame`'s narrowing, since MLB keys by numeric id and NFL by abbreviation.
- `renderLiveDetail` needed two real states, not one: a small inline `renderLiveExtra?: () => ReactNode` (NFL's down/distance sub-line, shown *inside* the always-visible live score display) versus the big `renderLiveDetail?: (active: boolean) => ReactNode` slot that gates whether the Matchup/Live *tab switcher* renders at all (MLB's expanded `LiveTab` — bases/box score/bullpen). Conflating these would have either forced NFL into tabs it never had, or given MLB nowhere to put its down/distance-shaped MLB doesn't have anyway. `renderLiveDetail` receives the tab's own active/inactive boolean so a live-polling child (`LiveTab`) can gate its fetch interval, since that state used to live inside `GameHeroCard` itself before genericization.
- `renderCenterPregameExtra?: () => ReactNode` — NFL's raw moneyline/spread/total price strip shown inline in the pregame center column; MLB has no equivalent (its pregame odds live in the pick-lock panel below, not inline center) — not anticipated by the original sketch at all.
- `startTimeCaption?: string` — MLB's "FIRST PITCH" label; NFL's original design showed no caption under the kickoff time at all, so this had to be optional rather than a shared hardcoded string.
- `pickLockAt?: Date | null` and `pickLoading?: boolean` were missing from the sketch entirely — the real `PickPanel` needs a lock timestamp and a loading-skeleton flag, both real MLB behavior (`calibration.loading`) the sketch didn't account for.
- **A real, deliberate NFL visual change, not silently dropped**: NFL is routed through the literal same `TeamPanel`/`CenterStatus` MLB uses rather than keeping its own bespoke smaller styling (flat "Live" chip, single-line score) — per this whole project's stated Phase-3 goal ("real structural/visual parity wherever the data supports it"), not a byte-preservation requirement (only MLB carries that). Concretely: NFL's `record`/`divisionRank`/`streak` now render in the exact same per-team-panel gradient-tint layout MLB uses (previously a flatter whole-card gradient), and **division rank and streak are new for NFL's hero card** — both were already being fetched (`TeamDetailApiResponse.team.divisionRank`, `recentResults`) for the Records section but never threaded into the hero card before. `isFinal` is also new and real (`liveState.state === 'post'`) — the old hero card only ever checked truthy `liveState` for "live" vs. else "pregame," so a finished game fell through to the pregame view forever; that gap is now closed.
- One small thing NOT preserved for NFL: the original `NflGameHeroCard`'s `TeamLogo` passed an `abbreviation` fallback (a text chip shown if the logo image fails to load). The shared `TeamPanel` doesn't pass this for either sport, to keep MLB's own `TeamLogo` call byte-identical to its pre-refactor behavior. Real, minor, only visible if a logo image request fails.

| Feature | Universal or optional? | Evidence |
|---|---|---|
| Team panel (name, logo, record, color tint) | Universal | Both sports have this; only the tint's key type differs (numeric id vs abbr), already handled by each sport's own `teamColors.ts` adapter pair |
| Division rank in hero | Optional, populable both sides | MLB: `TeamGameContext.divisionRank`. NFL: `TeamDetailApiResponse.team.divisionRank`, real as of the current diff — just not yet threaded into `NflGameHeroTeam` (`NflGameHeroCard.tsx:10-16` has no `divisionRank` field today; that's a prop-shape gap to close in Phase 2, not a missing-data gap) |
| Streak badge | Optional, MLB populates, NFL currently doesn't | Same `computeStreak`/`RecentResultRow` widening as §1b closes this for NFL too |
| Weather footer | Optional, MLB-only today | `GameMetaResponse` (NFL) carries no weather field at all (`NflGameDetail.tsx:76-86`) — genuinely absent data, not a rendering gap. Field stays optional/nullable; NFL adapter returns `null` until a weather source is wired up |
| Pick-lock panel (`PickPanel`, `ChangedBadge`) | Optional, MLB-only, **structurally**, not just today | Requires `game.gameModel` → a probability model. NFL's own diff comment confirms this directly: "no EdgeBadge (no NFL probability model yet)" (`NflGameDetail.tsx` diff ~932). Model as `model?: {...} | null`; component renders nothing when `null` |
| Live detail (box score / bullpen / play-by-play vs down/distance strip) | Sport-specific **slot**, not a shared shape | MLB's live model (bases, innings, linescore, bullpen) has no football equivalent in structure, and NFL's live model (down/distance/redzone) has no baseball equivalent — these aren't the same shape with different labels, they're genuinely different data. Model as `renderLiveDetail?: () => ReactNode`, sport supplies its own live component (MLB keeps `LiveTab`, NFL keeps its `CenterStatus` live branch) |
| Matchup/Live tabs | Derived, not stored | Only shown when `renderLiveDetail` is supplied *and* the sport wants a tabbed split; NFL's current design is untabbed (live state shown inline), which the generic component should allow rather than force a second tab sport-by-sport |
| Unit grades (offense/defense/special-teams `GradeChip`s) | Optional, NFL-only, no MLB equivalent | No MLB counterpart exists in `GameHeroCard.tsx` at all — genuinely NFL-specific, not a gap on MLB's side |

Final shape actually built (`components/GameHeroCard.tsx`), superseding the sketch above per the corrections noted:

```ts
interface GameHeroTeamPanelData {
  abbr: string;
  teamId?: number;
  name?: string;
  href?: string;
  logoUrl?: string;
  record: { wins: number; losses: number } | null;
  divisionRank?: string | null;
  streak?: number | null;
  tintColor: string;                                // pre-resolved: teamPrimaryColor()+withAlpha()
  renderBadges?: () => ReactNode;                     // NFL's OFF/DEF/ST GradeChips; undefined for MLB
}

interface GameHeroModel {
  recommendedPick: RecommendedMoneylinePick | null;
  totalLean: TotalLean | null;
  gamePick: GamePickView | null;
}

interface VenueForecastData {
  venue?: string;
  weather?: { tempF?: number; windMph?: number; windDir?: string; rainPct?: number };
  weatherNarrative?: string | null;
}

interface GameHeroCardProps {
  away: GameHeroTeamPanelData;
  home: GameHeroTeamPanelData;
  isLive: boolean;
  isFinal: boolean;
  liveScore?: { home: string; away: string };
  livePeriodLabel?: string;                           // MLB: "Top 7th"; NFL: "Q3 8:42"
  renderLiveExtra?: () => ReactNode;                   // NFL's down/distance sub-line under the live score
  startTimeLabel: string;                              // each sport formats this itself
  startTimeCaption?: string;                           // MLB: "FIRST PITCH"; NFL: none
  model?: GameHeroModel | null;                         // null → no pick-lock panel (NFL today)
  pickLockAt?: Date | null;
  pickLoading?: boolean;
  venue?: VenueForecastData | null;                     // null → no weather footer (NFL today)
  renderCenterPregameExtra?: () => ReactNode;           // NFL's raw ML/spread/O-U price strip
  renderLiveDetail?: (active: boolean) => ReactNode;    // presence gates the Matchup/Live tab switcher; MLB's expanded LiveTab, undefined for NFL (untabbed)
}
```

**Golf is explicitly out of scope for `GameHeroCard`.** Golf's `TournamentHeroCard`/`HeroSpotlightCarousel` (`components/GolfScheduleView.tsx:248,201`) is a real, comparably-detailed structural analog for a *field-wide tournament*, not a *head-to-head game* — forcing it into `GameHeroCardProps` would mean fabricating `away`/`home` teams for a 55-golfer field, which is wrong, not just awkward. Per the brief's own instruction (Phase 0 step 3), this stays a separate, deliberately non-generic sport-specific component, exactly as it is today. Confirmed already correctly scoped in the Golf audit (Finding G2) — no change needed.

---

## 3. `PlayerDetail.tsx` — the biggest file, and the one with the most branch points (13 `active.sport ===` checks)

MLB and Golf already share this one file (branch-in-file model). NFL is a wholly separate 594-line file that imports only 5 of `PlayerDetail.tsx`'s exports (`DistributionChart`, `WindowBox`, `FilterChip`, `ordinal`, `OpposingStarterStat`) and hand-rolls everything else, including sections whose underlying data is genuinely comparable (window boxes, distribution chart, prop odds board, stat rank rows — all confirmed structurally identical in shape between MLB and NFL by the research pass).

Section-by-section disposition, top to bottom as currently rendered:

| Section | MLB/Golf location | NFL location today | Disposition |
|---|---|---|---|
| Hero header | `PlayerDetail.tsx:1206-1284` | `NflPlayerDetail.tsx:264-316` | **Universal**, unify — both are name/headshot/team/market-line, golf's only branch is the line-label format (category vs O/U) |
| Market tabs | `:1287-1312` | `:320-338` | **Universal**, near-identical markup already, unify |
| Line stepper / odds | `:1319-1408` | `:340-370` | **Slot for control only**: MLB/NFL share a numeric stepper (unify); Golf's `GolfCategoryPicker` (`:1320`) is genuinely a different control (category picker, not O/U stepper) — `renderLineControl?: () => ReactNode` override, defaulting to the shared numeric stepper |
| Scope filter chips | `:1416-1447` | `:372-380` | **Universal** — `FilterChip` is a pure `{active, onClick, children}` primitive already; even golf's round-chips (`:1416`) are just different *labels* on the same primitive, not a different shape. Unify as `chips: ChipDef[]` supplied by the adapter for all three sports |
| Window / round-score boxes | `:1449-1482` | `:382-388` | **Optional-swap**: `windows?: WindowedStat5 \| null` (MLB/NFL, already-shared shape) vs `roundScores?: RoundScoreEntry[] \| null` (Golf-only) — mutually exclusive by sport, both real, neither faked |
| Live game state (base diamond, count dots, live tracker) | `:1487-1674` | *(none)* | **Sport-specific slot**, MLB-only. `useLiveGame` hits `/api/mlb/game/...` — no NFL/Golf equivalent route exists. `renderLiveGame?: () => ReactNode`, null elsewhere |
| Chart | `:1676-1708` | `:390-404` | **Slot with two named variants**: `DistributionChart` (MLB/NFL, already literally shared with a `logoFor` override already built for exactly this — `NflPlayerDetail.tsx:396-402`) vs `ScorecardChart` (Golf-only). Both already-exported components; the generic interface just needs `chart: { kind: 'distribution'; data; logoFor? } \| { kind: 'scorecard'; data }` |
| Live matchup card (golf) | `:1710-1720` | *(none)* | Golf-only, `renderLiveMatchup?: () => ReactNode` |
| Matchup card (batter-vs-starter / pitcher-vs-lineup) | `:1722-1779` | `NflPlayerVsDefenseCard`, `:406-419` | **Slot, not shared shape**: `BatterPitcherMatchupCard` (already generic — see §4) for MLB, `NflPlayerVsDefenseCard` for NFL (genuinely different — no player-level defensive rank exists in NFL, confirmed by that file's own header comment). `renderMatchup?: () => ReactNode` |
| Prop odds board | `:1781-1817` | `:494-509` | **Fully universal already** — identical props both call sites (`subjectId`/`marketKey`/`line`/`userSportsbook`), no sport field involved at all. Unify directly, zero adapter work needed |
| Gamelog | `:1819-1976` | `:421-472` | **Genericize via adapter-supplied columns**, not a slot. MLB has a card/table toggle + KPI summary strip + fixed columns; NFL has a single table, no toggle, no summary strip, position-keyed columns sourced from a different data path (`weeklyBoxScores`, a week-keyed dict, vs MLB's `entry.raw` directly). None of that difference is structural — it's "which columns, from which source" — so: `gamelog?: { columns: GamelogColumnDef[]; rows: GamelogRow[]; summaryStrip?: SummaryStat[] } \| null`, with the *rendering* (toggle, summary strip, table) made universal for the first time. **This is a concrete win, not just parity**: NFL gains the card/table toggle and summary strip MLB already has, for free, once this is genericized — flag this explicitly when reporting Phase 2 results, since it's user-visible NFL improvement, not just refactoring |
| Golf season stats card | `:1978-1987` | *(none)* | Golf-only, `renderSeasonStatsCard?: () => ReactNode` |
| Context rail: today's line | `:1992-2045` | `:513-518` (currently a stub) | **Universal shape**, NFL's version is just unbuilt, not structurally blocked — moneyline/total + edge badges is the same concept regardless of sport, model is the only currently-missing piece (same `model?: null` pattern as §2) |
| Context rail: matchup | `:2047-2112` | `:520-540` | **Slot**: MLB team-matchup card vs Golf `PastRoundMatchupsCard` vs NFL's opponent-defense-stats block — genuinely three different presentations, `renderContextMatchup?: () => ReactNode` |
| Context rail: hitter stats | `:2114-2152` | *(none)* | MLB-only (Statcast quality-of-contact) — `hitterStats?: OpposingStarterStat[] \| null`, real optional field, not a fake one |
| Context rail: form | `:2154-2190` | `:542-573` | **Optional-swap**: `form?: WindowedStat5` (MLB/NFL, same shared shape as the main window boxes) vs Golf's `ConsistentHolesForm` (genuinely different) — `formWindows?: WindowedStat5 \| null` for the universal case, `renderForm?: () => ReactNode` override for Golf |
| Context rail: line movement | `:2192-2218` | `:575-587` | **Universal**, near-identical text both places already |

```ts
interface PlayerDetailData {
  subject: { subjectId: string; name: string; headshotUrl?: string; teamAbbr?: string; teamLogoUrl?: string; position?: string };
  candidates: PickCandidate[];
  market?: string;
  chips: ChipDef[];                                  // universal scope filters, adapter supplies labels per sport
  windows?: WindowedStat5 | null;                     // MLB/NFL
  roundScores?: RoundScoreEntry[] | null;             // Golf, mutually exclusive with windows
  chart: { kind: 'distribution'; data: PickCandidate['history']; logoFor?: (e) => string }
       | { kind: 'scorecard'; data: ScorecardData };
  gamelog?: { columns: GamelogColumnDef[]; rows: GamelogRow[]; summaryStrip?: SummaryStat[] } | null;
  propOddsBoard: PropOddsBoardProps;                  // already fully shared, no change
  model?: { todaysLine?: {...} } | null;
  hitterStats?: OpposingStarterStat[] | null;         // MLB-only
  formWindows?: WindowedStat5 | null;                 // MLB/NFL
  // Sport-specific slots — all optional, all render nothing when absent:
  renderLineControl?: () => ReactNode;                // default: shared numeric stepper
  renderLiveGame?: () => ReactNode;                   // MLB only
  renderLiveMatchup?: () => ReactNode;                // Golf only
  renderMatchup?: () => ReactNode;                    // MLB BatterPitcherMatchupCard(s) / NFL NflPlayerVsDefenseCard
  renderSeasonStatsCard?: () => ReactNode;             // Golf GolfPlayerStatsCard
  renderContextMatchup?: () => ReactNode;
  renderForm?: () => ReactNode;                        // Golf ConsistentHolesForm; omitted when formWindows is used instead
}
```

**Consistency check**: every non-optional field above (`subject`, `candidates`, `chips`, `chart`, `propOddsBoard`) is populable today by all three sports per the research findings — `PropOddsBoard`'s props are already identical at both real call sites, `chips`/`chart` are already-shared primitives with per-sport data, `subject` is assembled from data every sport's page already has (name/headshot/team are universal identity fields). Nothing forces a sport to fabricate data for a required field.

---

## 4. `TeamDetail.tsx` / `TeamDetailPanel.tsx`

### 4a. `TeamDetailPanel` — should collapse to the dispatcher model `PlayerDetailPanel.tsx` already proves works

The original audit's own Finding B already named the fix: `PlayerDetailPanel.tsx` is confirmed "the working dispatcher model" (picks `PlayerDetail` vs `NflPlayerDetail` internally by sport, Category 1). `TeamDetailPanel`/`NflTeamDetailPanel` are still a byte-for-byte-except-imports duplicate (confirmed again in this pass — no drift since the original audit). Collapse to one panel:

```ts
interface TeamListItem { id: string; abbr: string; name: string; logoUrl: string; }

interface TeamDetailPanelProps {
  initialTeamId?: string;
  useTeamList: () => { teams: TeamListItem[]; loading: boolean };   // wraps useAllTeams / useAllNflTeams
  renderDetail: (teamId: string) => ReactNode;                       // caller's <TeamDetail .../> with its own snapshot/odds/onAdd closed over
}
```
This only needs `id`/`abbr`/`name`/`logoUrl` for the search-and-select shell — confirmed by direct read that the shell has zero sport-specific concepts in it (§ per the original audit, restated here as the concrete interface).

### 4b. `TeamDetail` — section disposition

| Section | MLB | NFL | Disposition |
|---|---|---|---|
| Hero header | Universal | Universal + `GradeChip`s | `grades?: {...} \| null`, NFL-only optional |
| Market tabs, line stepper, filter chips, window boxes | Universal, near-identical markup | Same | Unify directly |
| `EdgeBadge` on line stepper | MLB-only | NFL omits (no model) | `model?: {...} \| null`, same pattern as §2/§3 |
| Distribution chart | Universal (already shared component) | Same, uses `logoFor` | Unify directly |
| Games table | Universal shape (opponent/date/result), different key type (numeric id vs abbr string) | Same | `games: GameRow[]`, adapter formats per sport |
| Matchup section (toggle between two card types) | `PitchingMatchupCard` / `BatterPitcherMatchupCard` | `BatterPitcherMatchupCard` / `NflPlayerVsDefenseCard` | **Both slots are genuinely sport-specific for the "second" option**, but the "toggle between primary and secondary matchup view" mechanism itself is already shared (`SegmentedToggle`). `matchupPrimary`/`matchupSecondary` as render slots |
| Team stats | MLB: flat 2-col per-game/season numbers | NFL: 5 grouped `StatRankRow` lists + `GradeChip`s | **Genericize, not slot**: `statGroups: { label: string; stats: OpposingStarterStat[] }[]` — MLB supplies 1-2 groups (Per-game, Season), NFL supplies 5 (Scoring/Passing/Rushing/Receiving/Defense). `StatRankRow` already renders any `OpposingStarterStat[]` regardless of grouping — no display-primitive change needed, only the adapter decides grouping. Note: this changes MLB's stat display from raw two-column numbers to ranked bars — **flag to user before Phase 2**, this is a real MLB visual change, not just internal refactor, and needs explicit sign-off since it violates "MLB must not change" unless the grouped-bars view is confirmed equivalent or preferred |
| Roster | Universal shape, no pagination | Universal shape + pagination + has-stats-first sort | `roster: RosterPlayer[]`, `pagination?: {...}` optional enhancement (safe to backport to MLB too, additive) |
| Standings | Already fully shared (`StandingsTables`) | Same | No change |
| Context rail: next game | MLB: live-odds projection | NFL: no live odds yet | `nextGame?: { opponent; startTime; moneyline?; total? } \| null` |
| Context rail: advanced stats | MLB-only (Statcast) | *(none)* | `advancedStats?: OpposingStarterStat[] \| null` |
| Context rail: form | *(none)* | NFL-only currently | `form?: WindowedStat5 \| null` — **NFL-only today only because MLB's `TeamDetail.tsx` never got this section built, not because MLB's data can't support it**; `WindowedStat` is already fully shared. Flag as a place MLB could gain a feature for free once genericized, same posture as the Gamelog finding in §3 |
| Context rail: recent results | *(none)* | NFL-only currently | `recentResults?: RecentResultRow[] \| null` — same "NFL built it, MLB could adopt the same generic type" note |

**Real open flag, not resolved here**: the Team Stats section (row above) is the one place in this whole design where unifying the interface plausibly changes MLB's actual rendered output (flat numbers → ranked bars), which conflicts with the non-negotiable "MLB must not change" constraint unless the user confirms the bars view is acceptable for MLB too, or MLB's adapter is allowed to keep supplying a `renderTeamStats?: () => ReactNode` override that reproduces the current flat-number layout exactly. Surfacing this now, before Phase 1 starts, per the brief's own instruction to stop and describe conflicts rather than plow through them.

---

## 5. Matchup cards

`BatterPitcherMatchupCard` is **already fully generic and already proven working with real NFL data** (`components/NflGameDetail.tsx:518,521`, `components/NflTeamDetail.tsx:590`) — its `BatterPitcherMatchupProps` interface (`components/BatterPitcherMatchupCard.tsx:56-79`) takes only `OpposingStarterStat[]` on both sides plus generic labels, no sport-specific fields at all. This is Category 1, don't touch the interface.

**One real, small fix identified, not a redesign**: `QUALITY_STATS`/`QUALITY_KEYS` (`BatterPitcherMatchupCard.tsx:44-50`) is a hardcoded MLB Statcast vocabulary (`barrelPct`, `exitVelo`, `hardHitPct`, `whiffPct`). Because none of NFL's real stat keys (`pass-yards`, `pass-epa`, etc.) match this hardcoded set, `hasQuality` is always `false` for NFL — the "quality of contact" two-sided block silently never renders for NFL, and every NFL stat falls into the plain solo block instead. The Set-membership *mechanism* is already sport-agnostic (pure string-key matching, no player/team assumption); only the specific key list is hardcoded. Fix in Phase 2: make it an optional prop —

```ts
interface BatterPitcherMatchupProps {
  // ...existing fields unchanged...
  qualityStatKeys?: string[];   // defaults to the current MLB Statcast set if omitted, so MLB's call sites need zero changes
}
```
This is additive-only and MLB-safe by construction (default preserves current behavior exactly) — a good example of the "small optional prop, MLB untouched" pattern `GamesStrip.tsx`'s `logoFor` already proved (original audit Finding G).

`PitchingMatchupCard` (MLB) and `NflPlayerVsDefenseCard` (NFL) remain genuinely separate, sport-specific components — confirmed no shared mechanism exists beyond both ultimately feeding `StatRankRow`/`OpposingStarterStat`, which is already the shared layer. These are exactly the "real slots" referenced throughout §3/§4 (`renderMatchup?`/`matchupSecondary?`), not candidates for further unification.

---

## 6. Adapter file convention (Phase 4's eventual template, decided now)

New per-component adapter files go under `lib/sports/{sport}/adapters/`, one file per shared-component-family, matching exported function names/signatures across sports the way `teamColors.ts` already does (`teamPrimaryColor()`, `withAlpha()` — same names, different key types, confirmed still true in this pass):

```
lib/sports/mlb/adapters/
  gameDetailAdapter.ts      → GameSummary, RecentResultRow[], InjuryRow[], PicksPanelGame
  gameHeroCardAdapter.ts    → GameHeroCardProps fields (model, renderLiveDetail, etc.)
  playerDetailAdapter.ts    → PlayerDetailData
  teamDetailAdapter.ts      → TeamDetailData
  statRowAdapter.ts         → OpposingStarterStat[] (replaces the TeamDetail.tsx + PlayerDetail.tsx duplicate teamSeasonStatRows)
lib/sports/nfl/adapters/
  (same five files, same exported function names)
```
Pre-existing sport-specific *data* modules (`teamColors.ts`, `statKeys.ts`, `nflverse.ts`, `statsapi.ts`, `espn.ts`) stay exactly where they are — they're raw data-fetching/lookup utilities the adapters call into, not the per-component adapters themselves. Not moving working code just for folder tidiness.

`lib/sports/nfl/statKeys.ts`'s local `StatKeyDef` (`:12-16`) duplicates `GameDetail.tsx`'s exported one (`:79-83`) — fold into an import from `GameDetail.tsx` in Phase 1 as a small cleanup alongside the adapter work, not a separate effort.

---

## 7. What's already Category 1 across this whole document — do not rebuild in Phase 1/2

`LeftRail`, `RankingsHeatGrid`/`RankingsScale`/`RankingsTiers`, `gameMarketCandidate`, `BatterPitcherMatchupCard`, `StatRankRow`/`TwoSidedStatRankRow`, `DistributionChart`/`WindowBox`/`FilterChip`, `PropOddsBoard`, `StandingsTables`, `PlayerDetailPanel`'s dispatcher pattern, `GamesStrip`'s `logoFor` pattern, and both sports' `teamColors.ts` pair are all already generic, already exported, and in most cases already proven with real cross-sport data flowing through them today. Phase 1/2's actual net-new work is smaller than the component list suggests: consolidate 5 duplicate `OpposingStarterStat` adapter functions into 2 (one per sport), export and genericize `RecordsSection`/`LastFiveGames`/`Injuries`/`PicksPanel` (currently module-private), collapse `TeamDetailPanel`/`NflTeamDetailPanel` into the dispatcher model `PlayerDetailPanel` already proves, extend `PlayerDetail.tsx`'s existing branch-in-file model to cover NFL the way it already covers Golf, and thread the small number of genuinely-new optional fields (`qualityStatKeys`, `divisionRank` on the hero card, `formWindows`/`recentResults` for MLB) through.

---

## 8. Real risk flagged for explicit sign-off before Phase 1 starts

Section 4's "Team stats" unification is the one place this design plausibly changes MLB's actual rendered UI (flat two-column numbers → ranked `StatRankRow` bars) rather than just its internal data flow. Per the project's non-negotiable constraint, this needs an explicit decision — keep MLB visually frozen via a `renderTeamStats?` override that reproduces the current layout exactly, or confirm the bars view is an acceptable/desired change for MLB too — before any Phase 2 work touches `TeamDetail.tsx`.
