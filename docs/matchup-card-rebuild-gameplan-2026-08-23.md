# Matchup card rebuild — gameplan (2026-08-23)

Planning only — nothing in this doc has been built. Written to decide scope and sequencing before any code changes.

## 1. Why

The user's complaint, verified against the actual code:

- **MLB** (`BatterPitcherMatchupCard`) and **NFL** (`NflPlayerVsDefenseCard`) are real and reasonably built out — ranked stats, real percentiles, a genuine position-group concept for NFL (`MATCHUP_GROUP_BY_POSITION`).
- **CFB, NBA, NHL, Tennis have no matchup card at all.** `matchups`/`mlbContextMatchup`/`nflMatchup` are all hard-coded `null` in every one of those adapters. There's nothing to make more interactive because nothing renders today.
- **Soccer has a matchup card**, but it's NFL's shape reused as-is with a single team-wide "goals/xG against" number — no position-group split (no "vs strikers" vs "vs midfielders").
- The "bar with random color" is actually `heatFill(percentile)` — a real heat ramp, not random — but it only exists per-stat, with no drill-down, no alternate view, no way to pick a different opponent than whatever the live schedule says is next.
- Opponent is **never user-selectable** anywhere in the codebase today — every adapter derives it straight from the sport's live scoreboard/schedule feed for the subject's next game.

So this isn't really "polish 5 sports' cards" — it's "build the position-group data 4 sports don't have, then build one new interactive shell all 8 sports share."

## 2. Goals

1. One shared, interactive matchup experience across all sports (per the existing `PlayerDetail.tsx` sport-adapter convention — one component, per-sport adapters, no `sport === 'x'` branches in the shared render tree).
2. Multiple views of the same matchup: stat table, visual/graph view(s), trend-over-time — switchable with the smooth-glider pattern `SegmentedToggle` already provides (see §5).
3. Custom matchup: pick any team (or, for individual sports, any ranked player) instead of being locked to the next scheduled game.
4. Position-group breakdown + real rankings, for every team sport, not just NFL.
5. Motion/transitions that feel intentional — bars animating on data change, crossfades between views — without necessarily adding a new dependency (the codebase currently hand-rolls every visual: `PercentileRing`, `heat.ts`, `StatRankRow`'s bars, `SegmentedToggle`'s glider — no framer-motion, no chart lib in `package.json` today).

## 3. Non-goals (for this doc)

- Not deciding final visual design (colors/spacing) — that's an implementation detail once scope is agreed.
- Not building golf's live/round matchup further — that's a genuinely different, already-decent feature (hole-by-hole groupmate comparison), out of scope.
- Not solving betting-line integration for the matchup card — this is a stats/analysis feature, not a props feature.

## 4. Target experience

### 4.1 View modes (per matchup card instance)

Reuse `SegmentedToggle` (already has the animated-glider pattern `PitchingMatchupCard` uses for Scouting/Head-to-head/Rails) as the tab control between:

- **Overview** — identity header + the single highest-signal stat-edge callout (what the card shows today, kept as the default/collapsed state).
- **Stat grid** — today's `StatRankRow`/`TwoSidedStatRankRow` list, scoped to whichever position group is selected (see 4.3).
- **Profile** (radar/spider, hand-rolled SVG in the `PercentileRing` style — no chart library) — every relevant stat's percentile plotted at once, subject vs. opponent overlaid. Best for "does this matchup favor them overall" at a glance.
- **Trend** — small-multiple sparklines of the opponent's allowed-rate per stat over their last N games, not just a season aggregate — shows whether a defense/rank is trending or was built on old games. Requires per-game (not just season-aggregate) opponent data — flagged per-sport below where this is/isn't cheap.

Not every sport needs all four from day one — Profile and Trend are additive once a sport has position-group + per-game data; Overview/Stat grid should be achievable everywhere.

### 4.2 Custom opponent selection

A compact control in the card header, e.g. `vs [team logo] TEAM ▾`, defaulting to the real next-scheduled-game opponent (today's behavior) with a "Reset to next game" affordance once changed.

**Key architectural point:** this should be cheap, not a new fetch per selection. The position-group ranking work in §6 already requires computing a full **league-wide leaderboard** per stat (every team's allowed-rate + rank, not just the one opponent's) so the rank number is meaningful. If that leaderboard is fetched/cached once (per sport, per day, via `cachedRoute`) rather than one-team-at-a-time, then "pick a different team" is just indexing into an already-loaded table client-side — no new network round trip. Build the leaderboard cache first; the team picker falls out of it almost for free.

For individual sports (tennis, and by extension golf's existing round-matchup), there's no team leaderboard — the equivalent is a searchable list of ranked players on that tour, and "custom matchup" means player-vs-player head-to-head rather than position-group.

### 4.3 Position-group drill-down

Where a sport has more than one meaningful position group (NFL: Passing/Rushing/Receiving; CFB: same; NBA: Guards/Forwards/Centers; NHL: Forwards/Defense; Soccer: Forwards/Midfielders/Defenders), add a second-level tab strip (same `SegmentedToggle`) scoping the Stat Grid / Profile views to that group's allowed-stats. This is a direct generalization of NFL's existing `MATCHUP_GROUP_BY_POSITION`, not a new concept — the gap is that no other sport has the underlying data (§6).

### 4.4 Motion

**Decided (§10): bring in Motion (`motion`, née framer-motion), MIT-licensed/free.** The codebase currently hand-rolls all of this (`SegmentedToggle`'s manual glider math, plain CSS `transition` on bar widths), and that approach would have worked as a fallback — but with a real library approved, use it directly instead of the hand-rolled equivalents:

- `AnimatePresence` for the opponent-swap and view-mode crossfades (old bars/numbers exit, new ones enter) rather than a manual opacity-transition dance.
- `motion.div`/`animate()` for bar-width transitions and animated number count-up on rank changes when the opponent or position group changes.
- Shared-layout (`layoutId`) for the view-mode/position-group tab indicator, as a straight upgrade path from `SegmentedToggle`'s current `ResizeObserver` glider if that component gets touched during this build — not required, since the existing glider already works and can stay as-is if simpler.

## 5. Data architecture

Following `CLAUDE.md`'s sport-adapter convention: one canonical interface, declared once, every sport's adapter fills or nulls it; the shared component never branches on `sport`.

**Proposed:** a new canonical type, e.g. `MatchupExplorerData` (name TBD), declared in `lib/sports/mlb/adapters/playerDetailAdapter.ts` per the "MLB owns the type" rule, replacing today's three parallel ad-hoc slots (`matchups`, `mlbContextMatchup`, `nflMatchup`) rather than adding a fourth alongside them — the user asked for a rebuild, not an addition. Rough shape:

```ts
interface MatchupExplorerData {
  subject: { name, teamAbbr, teamLogoUrl, headshotUrl, positionGroup: string | null };
  defaultOpponent: { id, abbr, logoUrl, label };   // today's real next-game opponent
  opponentOptions: Array<{ id, abbr, logoUrl, label }> | null; // full league list for the picker; null = no custom-opponent support yet (individual sports, or a sport not yet wired)
  positionGroups: Array<{ key, label }> | null;    // null = sport has no position-group split (yet)
  statsFor(opponentId, positionGroupKey): { subjectRows, opponentRows, poolSize } // conceptually — actual shape TBD at implementation time, likely precomputed per (opponent × group) rather than a function, since this is server-rendered data
  trend: ... | null;  // per-game history, null where unavailable
}
```

The important part isn't the exact field names — it's that **every field that a sport can't yet support is `null`**, and the component renders a reduced but real experience (no picker if `opponentOptions` is null, no group tabs if `positionGroups` is null, Overview/Stat-grid only if `trend`/`profile` data is null) — same "don't fabricate a field" rule as every other adapter in this codebase.

## 6. Position-group ranking: per-sport data plan

This is the actual hard/novel part of the project — everything in §4 is UI polish once this exists.

| Sport | Position groups (proposed) | Data source | Feasibility | Notes |
|---|---|---|---|---|
| **MLB** | n/a (batter/pitcher duality, already solved) | existing Statcast pipeline | done | No change needed — already the most built out. |
| **NFL** | Passing / Rushing / Receiving (existing) | nflverse team-week | done | Template to generalize from. |
| **CFB** | Passing / Rushing (+ Receiving where distinct) | **CFBD** `/stats/season` or `/game/box/advanced` team-level allowed yards/TDs, aggregated per team across the season, ranked across ~130 FBS teams | **High** — CFBD already exposes this shape; it's the same aggregation NFL already does, over CFBD's per-game team box scores instead of nflverse's. `lib/sports/cfb/cfbd.ts` doesn't currently fetch/aggregate it, but the raw per-game team stats exist. | New module: `lib/sports/cfb/teamDefenseAllowed.ts`, mirroring the NFL pipeline's shape. |
| **NBA** | Guards / Forwards / Centers (3 groups — finer PG/SG/SF/PF/C splits will be too noisy at typical per-team-per-season sample sizes) | Per-game **box scores** (player line + position) aggregated: for team X "allowing", sum opposing players' production by position group across every game, per-game rate, ranked across 30 teams | **Medium** — `lib/sports/nba/espn.ts` today only pulls scoreboard/roster/standings, not box scores. Needs a new `fetchBoxScore(gameId)` fetcher plus a season-long aggregation/cache job (this is a real per-game ingestion loop, not a one-shot call). | Most data-engineering-heavy of the four gaps. |
| **NHL** | Forwards / Defensemen (2 groups; `nhle.ts` already carries `positionCode` per skater, so a finer C/W/D split is possible later if 2 groups prove too coarse) | Per-game skater box scores (goals/assists/shots) aggregated by opponent, same shape as NBA | **Medium** — same shape as NBA; `lib/sports/nhl/nhle.ts` already has per-player position data, just not yet aggregated into a team-allowed-by-position table. | New module: `lib/sports/nhl/teamDefenseAllowed.ts`. |
| **Soccer** | Forwards / Midfielders / Defenders | Understat match-level shot/xG data joined to each shooter's position (position tagging currently lives in `americanSocceranalysis.ts`'s `general_position`, not in `understat.ts` directly — needs joining or a second position source), aggregated as "xG conceded to forwards" etc. per opponent, extending the existing `buildUnderstatTeamDefenseIndex()` | **Medium-High** — closest to done of the four gaps; the team-wide version already exists, this is "add a position dimension to an aggregation that already runs." | Extend `lib/sports/soccer/understat.ts`, don't replace it. |
| **Tennis** | n/a — individual sport | ATP/WTA rankings + surface-specific serve/return stats (SharpAPI backend per `docs/`) | **Different track entirely** | "Position group" doesn't apply. Custom matchup here = pick any ranked player for head-to-head, not a team position-group breakdown. Should reuse the *view-mode/animation* half of this plan, not the position-group half. |
| **Golf** | n/a — individual sport | already has its own live/past-round matchup | **Out of scope** | Already a real, working, genuinely different feature (§3). |

**Sequencing implication:** CFB is the cheapest real win (data already available, "just" needs an aggregation module) and should go first among the gaps. Soccer is second (extending existing code beats building new ingestion). NBA/NHL are the two that need genuinely new box-score ingestion + a season-aggregation cache and should be planned as their own sub-effort, not bundled into the first pass.

## 7. Caching

The league-wide leaderboards in §6 are exactly the kind of "live external fetch or non-trivial computation" `CLAUDE.md`'s caching rule covers — each should go through `cachedRoute()` (a TTL grounded in how often the underlying box scores/season stats actually change, likely daily) if exposed as its own route, or be computed inside an existing cached build the same way `buildUnderstatTeamDefenseIndex()` already is. **Before picking a cache key for any of these, grep for it** — same collision risk CLAUDE.md already documents for `golf:schedule`.

## 8. Build plan / file shape (per sport-adapter convention)

For each sport that gets new position-group data:
1. A data module (`lib/sports/{sport}/teamDefenseAllowed.ts` or extending an existing one for soccer) — pure data, cached per §7.
2. The sport's `playerDetailAdapter.ts` populates the new canonical `MatchupExplorerData` fields, nulling whatever it can't yet support.
3. One new shared component (replacing `BatterPitcherMatchupCard`/`NflPlayerVsDefenseCard`/the ad-hoc context-rail card) rendered from one call site in `PlayerDetail.tsx`, gated on `data.matchupExplorer` presence — collapsing today's three parallel render branches (lines ~1636-1973) into one.
4. `TeamDetail.tsx`'s existing uses of `BatterPitcherMatchupCard`/`PitchingMatchupCard` are a separate call site — decide separately whether Team Detail adopts the new shared card or keeps its current one (not required for this project's stated scope, which is player-detail pages).

## 9. Suggested phase order

1. **Shell first, MLB + NFL only**: build the new interactive component (view modes, animation, custom-opponent picker) against the two sports that already have real data, proving the UX before spending effort on new data pipelines.
2. **CFB**: cheapest real data win — wire up `teamDefenseAllowed.ts`, get CFB its first-ever matchup card.
3. **Soccer**: extend the existing Understat aggregation with a position dimension.
4. **NBA + NHL**: box-score ingestion + season-aggregation cache — the real engineering effort, planned as its own chunk.
5. **Tennis**: separate design pass — player-vs-player head-to-head, reusing the shell's view-mode/animation machinery but not position groups.

## 10. Decisions (2026-08-23)

- **Replace MLB/NFL's existing cards outright.** The goal is one universal matchup card that feels identical no matter the sport — not two legacy cards plus a new shell bolted on alongside. §5/§8 stand as written: `MatchupExplorerData` replaces `matchups`/`mlbContextMatchup`/`nflMatchup` everywhere, including on the two sports that already work.
- **NBA/NHL box-score ingestion is in scope now**, not deferred. Phase order in §9 stays as written (CFB → Soccer → NBA/NHL), but "in scope now" means this whole plan is one project, not split across sessions by sport.
- **Bring in a real animation library — free/open-source only.** Recommendation: **Motion** (npm package `motion`, formerly `framer-motion`) — MIT-licensed, the de facto standard for React, works with React 19/Next 15. (Framer's own paid hosting product is a separate thing from the `motion` npm package; the library itself has always been free.) This replaces §4.4's "hand-rolled CSS only" default:
  - `AnimatePresence` for view-mode crossfades (Overview/Stat grid/Profile/Trend) and for the opponent swap (old bars/numbers exit, new ones enter).
  - `animate()`/`motion.div` for bar-width and number transitions when the opponent or position group changes (covers the "animated count-up on a rank change" case §4.4 flagged as the one thing hand-rolled CSS struggles with).
  - `layout` / `layoutId` for the position-group and view-mode tab indicator — can replace `SegmentedToggle`'s manual `ResizeObserver`/`offsetLeft` glider math with Motion's shared-layout animation, though reusing `SegmentedToggle` as-is is also fine if the manual version proves simpler to keep. Not a blocking decision — just noting Motion could subsume it if 	touching that component later saves complexity.
  - This is a genuine new dependency (`npm install motion`) — the one concrete build-time action this planning doc recommends taking before implementation starts.
