# Build Log — Update 07: Full Structural Rebuild

Phase-gate record. Each item is verified against the **running app** (or, for
Phase 0, against the live reference sites), not against a reading of the code.

---

## Phase 0 — Playwright research

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | `docs/ux-research-notes.md` exists covering 0a–0d | **PASS** | Rewritten from scratch; sections 0a/0b/0c/0d all present |
| 2 | Insufficient-sample cell treatment documented definitively, with real examples | **PASS** | Plain dash `-` in `rgb(156 163 175)`. Decisive example: PickFinder row `BerLIN` renders L5 `100%`, L10 `80%`, **L15 `-`** — a partial 10-game sample falls back to a dash rather than `8/10` or a scaled %. Never heat-coloured. |
| 3 | PickFinder player-detail page transcribed in full, incl. gamelog column structure | **PASS** | Header, 5-card book offer row, 21 market tabs, line spinbutton stepper, 5 window boxes, chart axis labels, `Gamelog - Last 15 Games` with all 21 stat columns enumerated, right sidebar (Line Movement table, Win Predictor, Matchup Odds, Regular Season Averages accordion) |
| 4 | Linemate game page main-column section order recorded with complete stat list | **PASS** | Order: Matchup info → Records → stat comparison → Last 5 Games → Rankings → Injuries. Stat list (16, identical in comparison and rankings): `R H 1B 2B 3B TB ER HR RBI BB SO E AVG OBP SLG OPS` |
| 5 | Whether Diff uses a different colour scale than the rate columns — answered definitively | **PASS — YES, different.** | Computed colours: Diff `+1.6%` → `rgb(110 231 183)`, identical to Diff `+120%` → `rgb(110 231 183)`; `-26.7%` → `rgb(252 165 165)`. Binary by sign, no magnitude ramp. Rate columns *do* ramp across five buckets. |

**Extras captured beyond the checklist**

- Semantic icon vocabulary read straight off Linemate's `alt` attributes:
  `RECENT_FORM`→bolt, `HEAD_TO_HEAD`→shield, `HOME_SPLIT`/`AWAY_SPLIT`→**shared**
  map pin. 16×16; label `rgb(96 100 108)`, figure `rgb(28 32 36)`, both 12px/500.
- Fraction-disclosure rule generalised: shown **only where the denominator is
  variable** (H2H `7/16`, season streaks `9/9`, H2H detail box `17G`); suppressed
  for fixed windows.
- Rate ramp is **five discrete buckets** with a *neutral grey* midpoint, not amber.
- `Strk` **is** heat-coloured (by sign and magnitude) — the earlier notes said it
  was not.
- PickFinder's first column is **not** sticky on horizontal scroll. Linesmith
  diverges deliberately here per spec.
- Sorting is multi-column with a numbered priority badge; third click clears.

**Phase 0: COMPLETE — 5/5 pass. Proceeding to Phase 1.**

---

## Phase 1 — Stat engine rebuild

Implementation: `lib/core/windowedStat.ts`. `WindowedStat` is a discriminated
union with no `rate` on the insufficient variant, so a consumer that forgets to
branch fails to compile rather than rendering a plausible-looking number.

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | A real current player with <15 qualifying games shows an insufficient L15 and a valid L5, **verified in the running app** | **PASS** | Live MLB slate, Players tab, **Charles McAdoo** (9 qualifying games): `L3 33.3%` · `L5 40%` · **`L10 –`** · **`L15 –`** · `ALL 55.6% (5/9)`. Insufficient cells carry `title`/`sr-only` "Not enough games — 9 of the 10 this window needs". A second candidate on the same player (vs-RHP, 1 game) shows all four fixed windows insufficient. |
| 2 | No view renders a partial-sample percentage or an "X of Y" where Y exceeds games available | **PASS** | McAdoo's L10 with 9 games renders a dash, not a 9-game rate and not `x/9` under an L10 header. Scan table sweep found `anyFractionInFixedWindow: false`. The `All` box is the only one printing a fraction, and its denominator is genuinely variable. |
| 3 | `grep` confirms a single implementation; no per-component duplicates remain | **PASS** | `status: '(ok\|insufficient)'` appears in exactly two files: `lib/core/windowedStat.ts` (the implementation, 8 sites) and `lib/sports/golf/adapter.ts` (2 sites — constructs the type from peer-hole scores, which are not `HistoryEntry`s; it does not reimplement windowing). No `hits/of` arithmetic remains in `components/`. Orphaned second rate renderer `MicroBars.RateBadge` deleted. |
| 4 | Insufficient cells are visually distinct from low-rate cells (not just red) | **PASS** | Measured computed colours in the running app: insufficient `rgb(147 162 154)` (muted grey), low-rate 33.3% `rgb(147 53 42)` (red), mid 40% `rgb(117 83 73)`, high 55.6% `rgb(56 101 81)` (green). The dash is grey and uncoloured by the heat ramp. |

**Also done**

- `PickCandidate.line` added — the threshold a pattern sits on (0.5 for every
  live MLB dimension; undefined for golf's categorical holes). Diff, the
  distribution chart's baseline and the line stepper all need it.
- `categoriseByLine` re-buckets a history at any threshold, which is what makes
  the Phase 5 stepper real rather than decorative.
- `FormReading` rebuilt: signed `streak`, `recent`/`baseline` as `WindowedStat`,
  and a `delta` that is **null** when either side is insufficient.
- `SplitEvidence` now carries a semantic `kind` plus a `WindowedStat`.
- `entryValue` deduplicated — `lib/ui/series.ts` now reads magnitudes from the
  same parser the averages use, so a chart and its average cannot disagree.
- Self-test suite extended to **56 checks, all passing** (`/api/selftest`),
  including the direct regression: `fixedWindow(12 games, 15)` →
  `{status:'insufficient', available:12, required:15}`.

**Phase 1: COMPLETE — 4/4 pass.**

---

## Phase 2 — Shared components

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | All five components exist as single shared implementations | **PASS** | `MarketLabel` (`components/MarketLabel.tsx`), `OddsChip` (`components/OddsChip.tsx`), `HitRateCell` + `DeltaCell` (`components/StatCells.tsx`), `InsightRow` (`components/InsightRow.tsx`). |
| 2 | `MarketLabel` used everywhere a market is named; no buried-in-sentence phrasing | **PASS** | Seeded for all 4 live MLB dimensions plus 15 more the gamelog already carries columns for; golf routes through the same component. `MarketLine` renders the "Over 0.5 Hits" phrasing both references use. Full text always in `aria-label` even in compact mode. |
| 3 | `HitRateCell` correctly renders both states from real data | **PASS** | Verified above on live MLB — ok and insufficient both observed on one player. |
| 4 | `InsightRow` vocabulary defined in one place; every bullet routes through it | **PASS** | `INSIGHT_LABEL` + `IconPath` in `InsightRow.tsx` are the only icon-selection sites. `ScanCard`'s bespoke split list replaced with `InsightList`. Glyphs drawn from primitives (no icon-library dependency in this project, and no artwork copied). |
| 5 | Each insight icon carries an accessible label naming its type | **PASS** | `InsightIcon` renders `role="img"` with `aria-label={INSIGHT_LABEL[kind]}` — "Recent form", "Versus this opponent", "Home / away split", etc. |

**Design decisions carried from the audit**

- `HitRateCell` uses five discrete buckets with a **neutral grey midpoint**,
  matching the measured reference ramp — a coin-flip rate carries no signal, and
  amber implies it carries a weak one.
- `DeltaCell` colours **by sign only**, deliberately not by magnitude, per the
  Phase 0 finding that `+1.6%` and `+120%` render identically.
- `showFraction` is opt-in and used **only where the denominator varies**.
- `InsightRow`'s figure slot takes a string, because the audit found weather rows
  carrying `7MPH` and rank rows carrying `27th`, not only percentages.

**Phase 2: COMPLETE — 5/5 pass.**

---

## Phase 3 — Top bar and games slider

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | Top bar is one row; sport selector is a dropdown; nav uses underline active state | **PASS** | Measured in the running app: top bar `height 48px`, 3 children (identity+sport / nav / utilities). Sport control is a real `<select id="lb-sport">` with options `[Golf, MLB]`. Active tab `Scan` has `aria-current="page"` and an underline (`after:bg-masters`), and is **not** a filled pill. Header total dropped from three stacked bands to `48 + 53 = 101px`. |
| 2 | Games slider is a visually distinct bar directly beneath the top bar | **PASS** | `header.children[1]`, `border-top 1px rgb(228 233 229)` plus a `rgba(22 33 28 / 0.02)` background shift. `overflow-x: auto`, scrollbar hidden via the existing `lb-scroll-x`. Fixed card width — every card measured **104px**. |
| 3 | Clicking any game card lands on that game's detail page | **PASS** | Clicked `TEX @ LAA` → URL became `/mlb/game/823998`, and that card renders `aria-pressed="true"` on the detail page. |
| 4 | The "All" chip clears the filter and returns to unfiltered Scan | **PASS** | From `/mlb/game/823998`, All → `/mlb`, All chip `aria-pressed="true"`, Games filter shows no badge. |
| 5 | Slider appears on Scan, Players and Game Detail with consistent behaviour | **PASS** | 11 cards (All + 10 games) present on all three. |

**Single source of truth — verified in both directions**

The slider no longer keeps its own `selectedGamePk`; selection is derived from
`filters.gamePks`, so the two cannot disagree. Ticking `BOS @ TOR` in the Games
*dropdown* immediately rendered that **slider card** selected and the filter
badge as `Games 1`. A multi-select shows no slider selection rather than
arbitrarily highlighting one of them.

**Ordering**: chronological by first pitch, verified against the live slate —
the four Finals sort ahead of the six in-progress games. Live games do **not**
jump to the front.

**Bug found and fixed during verification**

Moving the sport-reset effect onto `setGamePks` exposed that `useFilters`
returned freshly-built setters on every render, so any effect depending on one
looped forever — 42 `Maximum update depth exceeded` errors in the console. Fixed
at the source by memoising every setter in `useFilters` with `useCallback`;
console is now clean. The old code only avoided this by never depending on them.

**Also**: the fixed bottom slip bar is gone from both pages — the count now lives
in the top bar, and keeping both was redundant.

**Phase 3: COMPLETE — 5/5 pass.**

---

## Phase 4 — Scan as a full props table

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | Table loads by default on Scan | **PASS** | `dense` defaults to `true`. Also added an **All** scan view as the default — "Coming up" is empty by definition until first pitch, so the table was opening onto an empty screen for most of the day. |
| 2 | All 12 columns render with live data, incl. an insufficient cell and a populated H2H | **PASS** | Header reads `Player · Odds · IP · DVP · Avg L10 · Diff · L5 · L10 · L15 · H2H · Strk · SZN`. On a live 15-game slate: **546 rows**, **169** with an insufficient L15 dash, **289** with a populated H2H, **270** with a real DVP value. |
| 3 | First column pinned during horizontal scroll on a narrow mobile viewport, verified by doing it | **PASS** | Viewport resized to **390×780**. Scrolled the container to `scrollLeft: 400` (of `scrollWidth 761` / `clientWidth 341`): first cell stayed at `left: 17px`, unchanged, `position: sticky`. |
| 4 | Header pinned during vertical scroll | **PASS** | Same run, `scrollTop: 300`: header stayed at `top: 284px`, unchanged. Both axes pinned **simultaneously** in one scroll. |
| 5 | Sorting works on every numeric column with a visible indicator | **PASS** | Verified `Avg L10` (1.80→1.70… / 0.10→0.20…), `Strk` (+10→+9… / −8→−7…), `SZN` (100%→… / 18.2%→20%…), `Diff` (+1.3→+1.2… / −0.4→−0.3…). `aria-sort` flips `descending`↔`ascending`; arrow marks the active column. Insufficient values sink in **both** directions rather than sorting as zero. |
| 6 | Every filter affects the table, not only cards | **PASS** | Market filter "Hit in game": **393 → 190 rows**, badge `Market 1`. Table and cards read the same `filtered` list. |
| 7 | Row click opens detail scoped to the correct player *and* market | **PASS (navigation)** | Clicking Garrett Stubbs' row → `/mlb/player/596117?market=hit-in-game` — correct id, correct market. The destination page is Phase 5; content verified there. |

**Correctness bug caught during verification**

The first row read `H 0.5 · L10 100% · Avg L10 0.00`. That candidate's category is `no-hit` — a player who has **not** hit in ten straight games — but the cell showed only the stat and the line, so it read as the exact opposite. Added `directionMark`, so dense cells now render `U0.5 H` / `O0.5 H`. A hit rate alone cannot disambiguate direction, and this would have misinformed every under on the board.

**Honest gaps, by data availability**

- **Odds / IP** — the odds layer carries **game lines only** (moneyline/spread/total); there is no player-prop price feed. The Odds cell therefore shows a recorded price when one exists and a `Get odds` affordance otherwise, and **IP is genuinely blank** rather than fabricated. This matches the reference's own behaviour, where IP is empty on any row without a two-sided price.
- **DVP** — MLB's feeds do not expose defence-vs-position. The column is wired to the opponent staff's **league rank in hits allowed** (a real, computed figure from `teams/stats`), with the tooltip naming exactly that, and `N/A` where unavailable.

**Phase 4: COMPLETE — 7/7 pass.**

### Interlude — three data faults found and fixed

Verification stalled on an empty table. Root causes, all now fixed:

1. **`snapshot_cache` table missing.** The snapshot-caching work added the table
   to `schema.ts`, but the running server had already memoised its SQLite
   connection, so the table was never created and `/api/mlb` returned **500**.
2. **Every batter silently dropped.** `getPeopleWithGameLogs` requested
   unfiltered season game logs — ~1.2 MB per 40 players, ~33 MB per slate.
   Through the framework's instrumented `fetch` those requests hit `AbortError`;
   `getJson` swallowed it and returned `null`, so the API answered **200 with 0
   candidates**. Fixed by (a) an MLB `fields=` allow-list — 1.22 MB → **0.19 MB**,
   6× faster, identical split count — and (b) `mapLimit(batches, 3)`, since the
   same seven requests take 1.3 s from plain Node but over a minute fired in
   parallel through the framework. Result: **0 → 546 candidates, 270/270 batters**.
3. **The failure was invisible**, which is what made it costly. The adapter now
   warns when stats come back short of the roster, `getJson` records why each
   call failed, and `/api/diagnostics` exposes `statsApiErrors`.

---

## Phase 5 — Player/Prop Detail page

Implementation: `components/PlayerDetail.tsx` (shared, embeddable — Game Detail
mounts it directly in Phase 6) + `app/mlb/player/[playerId]/page.tsx` (thin
route wrapper; `market` lives in the query string so a Scan row deep-links to
the exact prop it showed).

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | Market tabs switch scope without a reload and reflect the correct market | **PASS** | Clicked "Hits vs RHP" on Garrett Stubbs (596117): URL became `?market=vs-RHP` via `router.replace` (no full navigation — `Page Title` unchanged, no reload event), active tab's underline moved, and every window box recomputed for the new dimension. |
| 2 | Line stepper recomputes window boxes, chart and threshold line together | **PASS** | O 0.5 → O 1.5 → O 2.5: `L5` `20%→0%→0%`, `SZN` `26.7% 4/15 → 6.7% 1/15 → 0% 0/15`, threshold line label `0.5→1.5→2.5`, and the first 6 bar colours flipped in lock-step with each step (measured via computed `background-color`). |
| 3 | Chart renders threshold line, per-bar values and date+opponent labels | **PASS** | 15 bars, dashed threshold line present, x-axis labels read `04-23 @ Chicago Cubs`, `04-24 @ Atlanta Braves`, etc. |
| 4 | Gamelog table renders with all markets as columns and scrolls horizontally with sticky leading columns | **PASS** | 25 `sticky` header/cell elements measured (leading `Game` column + header row, both pinned); columns render only stats with a non-zero value for the player (a batter's row shows PA/AB/H/R/RBI/TB/BB/SO/HBP — no ER/IP). |
| 5 | Insufficient windows render honestly in the summary boxes | **PASS** | On the `vs-RHP` market (4 games so far): `L5`, `L10`, `L15` all show the grey dash with the accessible reason `"Not enough games — 4 of the 5/10/15 this window needs"`, while `H2H 100% 1/1` and `SZN 100% 4/4` — whose denominators are genuinely 1 and 4 — render as real rates. No fixed window fabricated a rate from 4 games. |
| 6 | Side panel shows real odds context; absent line-movement history is stated, not invented | **PASS** | "Line movement" panel reads *"Movement history isn't tracked. Prices are recorded when you enter or import them, so only the current value is known."* — no fabricated series. |

**Bug found and fixed during verification (this session)**

The dev server was wedged — `curl` timing out after 60–120s on every route,
13,700s of accumulated CPU on a server started the previous evening. Root
cause: `/api/mlb` and `/api/golf` both served their cache-hit path by
`JSON.parse`-ing the cached payload and handing the parsed object to
`NextResponse.json`, which immediately re-serialises it. On this project's
payload sizes (MLB ~3.1 MB, golf ~2.9 MB, 546+ candidates each carrying a full
game log) that parse-then-reserialise round trip cost real CPU on *every*
request, cache hit or not, and had backed up into a wedged event loop.
Fixed with a shared `lib/db/jsonPassthrough.ts` that returns the cached JSON
string directly as the response body — no parse, no re-serialise. Verified:
cache-hit latency dropped from **59s → ~700–800ms**; cache-miss (full
rebuild) dropped from **115s → ~3–4s**. Applied to both the MLB and golf
routes' hit and stale-cache-fallback paths.

**Phase 5: COMPLETE — 6/6 pass.**

---

## Phase 6 — Game Detail page

Implementation: `components/GameDetail.tsx` (left rail + main pane + picks
panel) + rewritten `app/mlb/game/[gameId]/page.tsx`. Candidate selection lives
in the query string (`?player=&market=`), same discipline as Phase 5's market
tabs, so the swap to `PlayerDetail` is a real URL rather than local-only state.

Two data gaps had to be closed before this phase could be built honestly —
the adapter already computed team records/stat ranks/injuries for a *future*
Game Detail (found mid-audit, undocumented in this log), but nothing existed
for **last-5 results** or **head-to-head**, both spec'd main-column sections.
Added `extractTeamResults` + `RecentGameResult` to `lib/sports/mlb/statsapi.ts`
and `/api/mlb/recent` (mirrors the existing `/api/mlb/injuries` split-out
rationale: costs a league-wide schedule fetch, so it's per-game, not
slate-wide) rather than fabricate either section.

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | Context tab is gone and Game Detail ships in the same change | **PASS** | `TopBar.TABS` is `['Scan','Players','Watch']` — no Context tab exists anywhere in nav (removed in an earlier phase; a stale comment in `lib/odds/matching.ts` referencing "the Context tab" is the only remaining trace, left as historical context rather than edited). `app/mlb` has exactly `game/` and `player/` route directories — no orphaned `context/`. |
| 2 | Candidate rows show odds and 2–3 hit-rate bullets in the collapsed state | **PASS** | Verified on CLE @ DET (824240): each row renders `OddsChip` (— when no player-prop price exists, honestly, per Phase 4's established "no player-prop feed" gap) plus up to 3 `InsightList` bullets, e.g. *"No run, last 3 — 3 of 3 — 100%"*, *"Hit vs RHP, last 5 — 3 of 5 — 60%"*, insufficient ones rendering the dash with reason. |
| 3 | Clicking a candidate swaps the main pane in place using the Phase 5 component | **PASS** | Clicked Drew Anderson's row: URL became `?player=623454&market=first-inning` via `router.replace` (no reload), main pane rendered the full `PlayerDetail` — line stepper, window boxes, chart, gamelog, side panel with real game odds — with a `← Game summary` control that clears the params and returns to the 7-section overview. |
| 4 | All seven main-column sections render with real data | **PASS** | Matchup info (`CLE 58-61 · 4th in division`, `DET 58-60 · 3rd in division`, venue, generated weather narrative), Probable pitchers, Records, Team stat comparison (15 rows), Last 5 games, Rankings (real ordinal ranks e.g. `R 28th/9th/12th/4th`), Injuries (10 real entries across both teams). |
| 5 | Records and stat comparison respect the Season / Last 5 / H2H control | **PASS** | Season tab: `58-61 OVERALL 58-60`. Switched to Last 5: `1-4 OVERALL 3-2`, cross-checked by hand against the Last 5 Games chips (CLE: L,L,W,L,L = 1-4 ✓; DET: W,W,L,W,L = 3-2 ✓), Home/Away splits derived from the same games' `isHome` flag and matched exactly. H2H tab showed `—` across the board — these two teams hadn't met within the fetch window, rendered honestly rather than as a fabricated `0-0`. |
| 6 | Injuries table populates from real roster status | **PASS** | 10 real players (e.g. Shawn Armstrong, Kerry Carpenter) with real `status` ("Injured 60-Day", "Injured 15-Day") — `injury` reason shows "Not reported" for all, matching the adapter's own documented finding that the league API never returns a body-part description. |
| 7 | Picks panel reflects live slip state and supports game-line markets | **PASS** | Clicked `CLE +113` under Add to picks → appeared immediately in My Picks as `CLE ML +113 · the-odds-api · captured 4:09 PM` (price captured at add time, not left blank) → clicked ✕ → count returned to 0. Verified end-to-end, then removed the test pick so it doesn't linger in the real slip. |
| 8 | All four page states verified against real games | **PARTIAL** | Pre-game and zero/non-zero-candidates verified live (every game on today's slate is pre-game; all carry candidates, so the empty-state message — reused verbatim from Phase 4's Scan table — was confirmed present in code but not observed on a truly empty game). **Live and Final were not observable** — the entire current slate reads `Scheduled`. Both states are driven by the same `isLive`/`isFinal` regex against `game.state` already proven correct in the old page (unchanged logic, just relocated), and `disabled={isFinal}` is wired through to both the picks panel's add buttons and `PlayerDetail`'s `onAdd`. Flagged rather than claimed as fully verified, per this log's own rule against passing on code-reading alone. |

**Bug found and fixed during verification**

`getScheduleRange`'s `fields=` allow-list — the same sparse-projection
mechanism that fixed the batter-drop fault in Phase 4 — didn't list `score`,
so every team's final score came back `undefined` and `extractTeamResults`
silently skipped every completed game. Both new sections (Last 5 Games,
and the Records panel's Last 5/H2H tabs) rendered "no recent results" for
*every* team, which read as a plausible empty state rather than a bug. Fixed
by adding `score` to the allow-list; re-verified with real results (CLE:
L 3-5 @ CWS, L 3-6 @ CWS, W 8-2 @ CWS, L 6-13 vs NYM, L 5-6 vs NYM).

**Known gap, stated rather than hidden**

Head-to-head reads off the same 45-day schedule window as Last 5 Games, not
a full-season fetch — pulling a full season's league-wide schedule to answer
one panel was judged not worth the payload cost (the same tradeoff the
adapter's own comments make for the 45-day range elsewhere). The Head to
Head tab's `title` attribute discloses the window; teams that last met
earlier in the season will show `—` rather than a stale or wrong record.

**Phase 6: COMPLETE — 7/8 pass, 1 partial (data not observable today).**

---

## Phase 7 — Cross-cutting polish

| # | Acceptance item | Result | Evidence |
|---|---|---|---|
| 1 | No new surface shows bare "Loading…" text | **PASS** | `grep` for visible `Loading...`/`Loading…` across `app/` and `components/` matches only `components/Skeleton.tsx`'s `sr-only` labels attached to real pulse skeletons — never rendered as visible text. Two gaps found and fixed during this pass (below). |
| 2 | Golf's Scan, Player, and Watch views all still function with the shared components | **PASS** | Golf's live event this week (FedEx St. Jude Championship) has an empty field — `candidates: 0` straight from `/api/golf`, unrelated to any change in this session (nothing golf-specific was touched). Verified all three tabs render without error against that real empty state: Scan shows the filter bar + "No candidates match these filters" (both Cards and Rows modes), Players shows "No tracked patterns for this player yet.", Watch renders cleanly. No console errors, no "Application error" boundary, in any of the three. |

**Gaps found and fixed in this pass**

Game Detail's `RecordsSection` (Last 5 / H2H tabs) and `LastFiveGames` read
from `useGameContext`, which resolves after the initial page paint — before
this fix, both would render their **empty state** ("—" / "No recent results
in this window") for roughly half a second while the fetch was in flight,
which is indistinguishable from "this data doesn't exist" and is exactly the
kind of false-empty-state Phase 1 exists to prevent for windowed stats. Added
a pulse-skeleton branch to both, gated on `gameContext.loading`, matching the
treatment already used on the Injuries table.

**Not re-verified this pass**: Scan table pinning/sorting, PlayerDetail's
stepper/chart, and the Games slider were all verified live in Phases 4/5/6
and are untouched by Phase 7's changes — re-checking them here would be
re-doing work already on record above.

**Phase 7: COMPLETE — 2/2 pass.**

---

## Summary

Phases 0–7 are all complete and verified against the running app. Update 07's
three framing goals are met: Scan is a full 12-column heat-mapped props table
(Phase 4), Player/Prop Detail matches PickFinder's depth with a live line
stepper and full gamelog (Phase 5), and Game Detail matches or exceeds
Linemate's summary page — matchup context, three-way records, team stat
comparison, rankings, injuries, plus Linesmith's own per-game candidate list
with in-place `PlayerDetail` swapping (Phase 6). The one item not fully
closed is Phase 6's item 8 (Live/Final game states) — the logic is in place
and reasoned about but wasn't observable against a real live or final game
during this session's testing window, since the entire slate was pre-game.
That should be re-checked the next time this runs against a slate with a game
in progress.
