# Golf Component Reusability Map — Phase 0

Companion to [`mlb-component-reusability-audit.md`](mlb-component-reusability-audit.md), which explicitly left Golf uncovered beyond confirming it reuses `PlayerDetail.tsx`'s exported helpers at prop-interface depth. This phase gives Golf the same evidence-based read NFL already got. Read-only — no MLB, NFL, or Golf UI was changed to produce this.

---

## 1. Golf's equivalent of `GameHeroCard`, `TeamDetailPanel`/`TeamDetail`, and Scan-adjacent detail views

Golf's real routes, confirmed from `app/golf/`:

- `/golf` → `AppShell sport="golf"` (Scan + Players tabs, same shell as MLB/NFL)
- `/golf/player/[playerId]` → uses `PlayerDetail` directly (MLB's actual component, not a golf fork)
- `/golf/schedule` → `GolfScheduleView` + `GolferStrip`

**There is no `/golf/game/[gameId]` and no `/golf/team`/`/golf/teams`.** This isn't a gap this audit is surfacing as new — it's already documented as a deliberate decision in the codebase's own design brief, [`docs/prompt-3-teams.md:77`](prompt-3-teams.md):

> "Don't propose a golf equivalent of these pages — golf has no team concept; there is no `app/golf/team` or `app/golf/teams` route and none is planned."

And the schedule page's own header comment ([`app/golf/schedule/page.tsx:16`](../app/golf/schedule/page.tsx)) confirms the same thing from the other direction:

> "`/golf/schedule` — golf's Teams-tab equivalent. Golf has no team concept... this is what the fourth tab becomes instead."

So: no `TeamDetail`/`TeamDetailPanel` analog exists for Golf, and none should — this maps onto the sport correctly, not a coverage gap.

**Golf does have a real hero-card equivalent**, and it's a legitimate structural analog to `GameHeroCard`, not a `NflGameHeroCard`-style thin rebuild: `TournamentHeroCard` + `HeroSpotlightCarousel`, both in `GolfScheduleView.tsx` ([:248](../components/GolfScheduleView.tsx), [:201](../components/GolfScheduleView.tsx)). `TournamentHeroCard` renders the event name/status/dates/course/weather-summary in a `lb-card-hero` shell; `HeroSpotlightCarousel` cycles Leader / 2nd / 3rd / Best-today / Worst-today on a 3.5s timer using `animate-lb-fade-slide`.

That animation is worth flagging precisely: `tailwind.config.ts`'s own comment for the `lb-fade-slide` keyframe describes it as "the hero spotlight carousel's between-card transition... so cycling through Leader/Top 3/Movers reads as one card handing off to the next" — and grepping confirms **`lb-fade-slide` is used nowhere except `GolfScheduleView.tsx`**. Neither `GameHeroCard.tsx` nor `NflGameHeroCard.tsx` use it. This custom animation token was built for Golf's hero carousel specifically — Golf isn't just consuming the shared token system here, it's the sole real consumer of one-third of the app's custom keyframe library.

**Golf's Scan-adjacent detail view is `GolfScheduleView.tsx` itself** (1442 lines, 10 internal card components beyond the hero: `LiveLeaderboardCard`, `AllMatchupsCard`, `BigMoversCard`, `CourseInsightsCard`, `CourseOverviewCard`, `WeatherCard`, `TopStandingsCard`, `OurLinesCard`). In terms of raw information density this is comparable to or exceeds `GameHeroCard.tsx` + `GameDetail.tsx` combined — it's just organized around one tournament/course rather than one game, which is the correct structural adaptation for a field-based sport rather than a head-to-head one.

**`TournamentLinesView.tsx` is Golf's `GameLinesView.tsx` equivalent**, and says so directly in its own header comment ([`TournamentLinesView.tsx:29`](../components/TournamentLinesView.tsx)):

> "Match Winner board for the current PGA Tour event — the golf equivalent of MLB's GameLinesView: a read-only, book-compared market list... There's no repeating pattern to scan for a field-wide outright... so this sits outside the Scan table entirely, same reasoning as MLB's moneyline/total."

---

## 2. Category assessment of golf-specific components

| Component | Category | Evidence |
|---|---|---|
| `GolfScheduleView.tsx` internal cards (`TournamentHeroCard`, `LiveLeaderboardCard`, `AllMatchupsCard`, `BigMoversCard`, `CourseInsightsCard`, `CourseOverviewCard`, `WeatherCard`, `TopStandingsCard`, `OurLinesCard`) | **3 — genuinely sport-specific, correctly so** | Tournament field, live leaderboard, course hole-by-hole difficulty, weather-impact-on-golf-strategy text, standings-by-strokes — none of this has an MLB/NFL equivalent. But every card is built inside `lb-card`/`lb-card-hero`/`lb-card-interactive` shells and several reuse `OddsChip`, `SubjectAvatar`, `StatRankRow`-adjacent primitives — it's sport-specific *content* on the shared *chassis*, the same honest pattern `NflTeamScopePanel` and `NflPlayerVsDefenseCard` showed in the original audit. |
| `GolferStrip.tsx` | **4 — duplicated interaction mechanics, correctly-separated content** | Own header comment ([`GolferStrip.tsx:8`](../components/GolferStrip.tsx)) says it is "copied over rather than shared" from `DateGameStrip.tsx`, with a real reason given (`DateGameStrip` carries MLB's Today/Tomorrow/date-picker controls that don't apply to a single tournament). The *content* difference (team-matchup chips vs. one-golfer-per-chip) genuinely justifies a different component. But the ~80 lines of auto-scroll/drag-to-pan mechanics (RAF loop, pointer-capture-on-first-real-movement, hover-to-pause refs) are copy-pasted verbatim rather than factored into a shared hook (e.g. a `useAutoScrollStrip`) that both `DateGameStrip` and `GolferStrip` could call with different chip renderers. This is a smaller-scope version of the original audit's Finding B (`TeamDetailPanel`/`NflTeamDetailPanel`) — the duplication is in mechanism, not content, so it's a real extraction opportunity even though the top-level "don't share the whole component" call was correct. |
| `GolfPlayerStatsCard.tsx` | **3, but notably reuses more than it invents** | Strokes-gained/PGA-Tour-advanced-stats vocabulary is genuinely golf-only. But it imports and reuses `StatRankRow`, `ordinal`, `OpposingStarterStat` (from `PlayerDetail.tsx`/`StatRankRow.tsx`) directly — the same primitives NFL's matchup cards use. It also introduces `GolfStatRangeRow`, a genuinely new visualization (a worst-to-best field-range track with a tour-average tick and the golfer's headshot positioned at their actual value) that has no MLB or NFL counterpart at all — this is a case of Golf's own component being *more* detailed than the shared baseline in one specific dimension, not less. Worth noting for the opposite reason components are usually flagged: if this range-plot pattern is good, `StatRankRow`'s simple bar is the thing that's arguably under-featured relative to it, not the other way around. |
| `TournamentLinesView.tsx` | **2 — real, documented parallel-adapter build** | Reuses `OddsChip`, `BookLogo`, `SubjectAvatar` directly from the shared set. Deliberately does *not* import `EdgeBadge`, `ConfidenceChip`, or `useMarketCalibration` — the same machinery `GameLinesView.tsx` (MLB) uses for its edge/confidence display. This isn't an oversight: the file's own comment explains Top 5/Top 10 golf markets aren't priced by any configured provider, so there's no model output to grade an edge against. Structurally identical to the original audit's Finding F (`EdgeBadge` absent from NFL for the same reason — no probability model to compare against). |
| `PlayerDetail.tsx`'s golf branches (`GolfCategoryPicker`, `MatchupHoleCell`, `LiveMatchupCard`, `PastRoundMatchupsCard`, `ConsistentHolesForm`, `RoundScoreBox`, `ScorecardChart`) | **1 — this *is* the proven multi-sport pattern, already fully realized** | Confirmed in the original audit: `PlayerDetail.tsx` is directly imported by both `/mlb/player/[playerId]` and `/golf/player/[playerId]`, branching internally on `active.sport === 'golf'` in 11+ places. Golf's player-detail experience is not a fork of MLB's — it's a real branch inside the same file MLB uses, the exact pattern the original audit's Finding D pointed out NFL did *not* follow. |

---

## 3. Design-token discipline, measured the same way as NFL

Same method as the original audit: grep for named type-scale classes (`text-dense`/`text-meta`/`text-label`/`text-body`/`text-emphasis`/`text-title`/`text-display-*`) vs. raw arbitrary `text-[Npx]` values.

| File | Named-token uses | Arbitrary `text-[Npx]` uses | Hardcoded hex |
|---|---|---|---|
| `GolfScheduleView.tsx` | **0** | 64 | 2 (in one gradient `style={}`) |
| `GolferStrip.tsx` | **0** | 4 | 0 |
| `GolfPlayerStatsCard.tsx` | **0** | 11 | 0 |
| `TournamentLinesView.tsx` | **0** | 5 | 0 |

**Real numbers, not an assumption either way**: Golf uses the named type-scale tokens **zero times** across all four files audited — every single text-size declaration in golf-specific code is a raw arbitrary pixel value. This is a *more* consistent pattern than NFL's (which had some token usage mixed with arbitrary values in most files) — but consistent in the wrong direction. It's also worse, in absolute terms, than `GameHeroCard.tsx`/`GameDetail.tsx` (MLB's two most disciplined files, 0 arbitrary values each) and roughly in the same range as MLB's own `TeamDetail.tsx`/`PlayerDetail.tsx` (35/109 arbitrary uses) — so, as with NFL, this isn't purely "Golf drifted from a standard MLB met everywhere"; it's continuing a standard MLB itself only partially met.

The two hardcoded hex values in `GolfScheduleView.tsx` (`TournamentHeroCard`'s gradient background, `borderTop: '3px solid #141619'`) are the same pattern found in `GameHeroCard.tsx`, `NflGameHeroCard.tsx`, `NflTeamDetail.tsx`, and `NflPlayerDetail.tsx` — a raw-hex `style={}` gradient because Tailwind utility classes can't express a dynamic multi-stop gradient. As with the NFL findings, Golf's version carries no comment mapping the hex back to its token name the way `GameHeroCard.tsx`'s own `const C = {...}` block does — so this is now a four-file-wide instance of the same minor documentation gap, not an NFL-specific one.

---

## Findings

### Finding G1 — No Team Detail gap exists; this was correctly never built

Unlike the original audit's Findings A/B/D (real duplication or missing depth), Golf's lack of a Team Detail analog is not a reusability gap at all — it's a documented, deliberate product decision (`docs/prompt-3-teams.md:77`, `app/golf/schedule/page.tsx:16`). No action item here.

### Finding G2 — Golf's hero card is a real analog to `GameHeroCard`, not a thin rebuild like NFL's

`TournamentHeroCard`/`HeroSpotlightCarousel` reach comparable information density to `GameHeroCard.tsx`, correctly adapted to a tournament/field structure instead of a head-to-head one, and are the sole real consumer of the `lb-fade-slide` shared animation token. This is the opposite failure mode from `NflGameHeroCard` (original audit Finding A) — where NFL's hero card was a stripped-down 125-line version of MLB's 1059-line one, Golf's hero treatment is not stripped down.

### Finding G3 — `GolferStrip.tsx` duplicates `DateGameStrip.tsx`'s scroll mechanics, not just its content

The content fork is justified and documented. The ~80 lines of pointer-capture/RAF auto-scroll logic duplicated alongside it are not sport-specific and are a real, scoped extraction candidate (a shared `useAutoScrollStrip` hook) — smaller in blast radius than the original audit's Finding B (`TeamDetailPanel`/`NflTeamDetailPanel`), but the same shape of problem: mechanism duplicated where only content needed to differ.

### Finding G4 — `TournamentLinesView.tsx` is the same honest "no" as NFL's missing `EdgeBadge`

Both sports lack the priced-market data (Golf: Top 5/Top 10 outrights; NFL: any moneyline/total edge model) needed to feed `EdgeBadge`/`ConfidenceChip`/`useMarketCalibration`, and both say so directly in code comments rather than silently omitting the feature. Confirmed real in both cases, not assumed.

### Finding G5 — Design-token discipline is Golf's weakest area, matching (not exceeding) NFL's

Zero named-type-scale usage across all four golf-specific files is a real, measured gap — but sits within the range MLB's own less-disciplined files (`TeamDetail.tsx`, `PlayerDetail.tsx`) already occupy, so it reads as "never adopted the newer convention" rather than "regressed from it," the same nuance the original audit gave NFL.

### Finding G6 — `GolfPlayerStatsCard`'s range-plot row is a place Golf innovated past the shared baseline

`GolfStatRangeRow` is more informative than `StatRankRow`'s simple percentile bar (shows the golfer's actual value positioned in the field's real worst-to-best range, plus a tour-average tick) and has no MLB/NFL equivalent. Not a gap — flagged because a reusability map should surface this direction too: if this pattern is judged good, it's `StatRankRow` that's behind, not `GolfStatRangeRow` that needs replacing.

---

## What this phase does not cover

- `useGolfSchedule.ts`, `useGolfLines.ts`, `useGolfPlayerStats.ts`, `useGolfFieldStats.ts` were located and their call sites confirmed, but not read line-by-line for internal-assumption checks the way `teamColors.ts`'s adapter pair was in the original audit.
- `lib/sports/golf/**` (data-layer code — `pgatourStats.ts`, `playerSeason.ts`, course/weather sourcing) was not read; this audit is components-only, matching the original's scope.
- No live-browser comparison was done between Golf's schedule page and MLB's game page — same caveat as the original audit's "not covered" section.
