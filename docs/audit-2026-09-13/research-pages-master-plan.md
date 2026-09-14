# Research pages — master plan (Phase H)

**Status: APPROVED by the operator 2026-09-14, as written (including picks G1–G7
as taken in §3). R0 done. R1 BUILT 2026-09-14 and awaiting sign-off — every
item done or measured except three that could not be reproduced today (see
below). Next after sign-off: R2 and R3 (any order).**

**R2 IN PROGRESS, 7 of 9 rules done (2026-09-14).** Prop main line landed in
`b8f80d8` and closes F-B12's cause. Left: the pre-start odds filter, then the
three small rules, then the R2 sign-off pass. Detail in
`docs/audit-2026-09-13/RESUME-PROMPT.md`.

**R1 outcome, 2026-09-14** — commits f89d704, 69cf490, 770f6c9, 3f61ee6,
16e8227. Done: R1a, R1b, R1c, R1d (TS + Python; **deployed 2026-09-14**,
Render `dep-dak36up42hec73bri7hg` on `46a2def` — verified in prod:
`refreshNflJob games=33`, `refreshCfbJob games=146`, matching the frontend's
own slate counts exactly), R1e, R1f 2a, R1g except F-B4, R1h. Owed:
- **F-B4** (MLB pitcher game log) — not reproducible: today's MLB slate carries
  no pitcher markets at all, so no pitcher page renders a game log. Needs a
  slate with pitcher props.
- **F-B12** (tennis aces) — MEASURED AND RE-ROUTED TO R2. It is not a
  match-total market: `prop_odds` holds 503 aces rows over 45 subjects with a
  0.5–29.5 spread, and one subject-game (Ben Shelton, 182766) carries 9
  distinct lines from 8.5 to 29.5 across 2 books. That is an alternate ladder
  filed under the main key — exactly what R2's prop-main-line rule fixes. Do
  not fix it here; that would be a second main-line implementation.
- **R1f 2b** — calendar-blocked to Saturday 2026-09-19.
- **F-B2, F-B3** — already assigned to R2 and R7.

**Three plan corrections found by re-checking the cited lines (plan §R1):**
1. R1c said "three user-facing strings". There are ten, in five adapters —
   NHL and soccer were missed because those pages could not be rendered when
   the audit ran.
2. R1h said to check whether a high `pctOf` means "allows more". It does not,
   in any sport: rank 1 is the STRONGEST unit, so the headline was naming the
   opponent's best category as the subject's biggest edge. The missing floor
   was the smaller of the two faults.
3. F-B9 said the soccer moneylines were "likely on the wrong teams". They were
   not. `opponentIsHome` tested whether THIS team is home while being named for
   the opponent, and `isHome` negated it, so the two price rows were labelled
   with each other's team. The same inverted flag was in soccer, CFB, NBA and
   NHL.

**One live bug found in R1f 2a that R1 did not fix, and a decision is owed:**
`cachedRoute` serves stale **with no maximum age** — `if (cached) { trigger
rebuild; return stale }`. A route whose `build()` keeps failing serves its last
good payload forever and the page cannot tell. CFB's build is the one
documented as timing out, which is how a Sep 13 rebuild listed Sep 3/4 games.
The symptom does not reproduce today (146 games, all dated Sep 17–27), and the
TS and Python UTC fixes are a one-day shift that cannot explain a nine-day gap,
so they are ruled out as the cause. A maximum stale age changes every route's
contract and needs its own measurement; it is not an R1 call.

This is Phase H of `design-audit-plan.md`: every audit finding, every card verdict,
the visual and interaction system, the G2 mockups and the data work behind them,
merged into one build order.

- **Supersedes `build-plan.md`** as the build order. `build-plan.md` keeps its
  measured findings, and every item in it is carried in below (mapping in
  Appendix C).
- **Does not replace `docs/master-plan-2026-09-06.md`.** That plan owns the
  product and model order. This one covers only the player, team and game pages,
  which already exist. It adds no new surface: slate research views stay
  deferred.
- **The spec is the G2 mockups** in `docs/design/phase-g2/`: `player.html`,
  `game.html` and `team.html`, with sport switching, game states and the
  compare control. The datasets in `docs/design/phase-g2/data/` are real data
  pulled for named players, teams and games. They are the reference fixtures
  for verification.

Sources merged:
- Card audit: `phase-a-data-depth.md`, `phase-b-read-paths.md`,
  `phase-c-card-verdicts.md`, `phase-d-remediation.md`, `build-plan.md` and
  `before/README.md`.
- Design audit: `design-findings.md` (D1–D5), `design-audit/E-inventory.md`,
  `F-card-verdicts.md` (with F-B1..F-B13), `F2-visual-system.md`,
  `F2-ux-interaction.md` and `G-ideas.md`.
- Mockups: `docs/design/phase-g2/PLAN.md` and `BUILDABILITY.md`.

---

## 1. How close the build gets to the mockups

**Card for card, the pages can be built as shown.** Every section, card, chart
form, sport-native surface, scope control, tooltip, drill-down, game state and
compare view in G2 is drawn from data the app already stores or fetches
(`BUILDABILITY.md`). The type ramp, colors, spacing and phone layout are the F2
system, which the build adopts as tokens. For the same player, team or game, the
app should show the same numbers as the mockup dataset. R6–R9 verify exactly
that.

**Where the app will differ, and why:**

| # | mockup | app | why |
|---|---|---|---|
| 1 | Vanilla JS kit (`kit.js`, `kit2.js`, `viz-sport.js`) | React components under the sport-adapter architecture (`CLAUDE.md`). Existing `components/charts/` (`ChartFrame`, `useChartCrosshair`) and `SegmentedToggle` are extended to match, not duplicated | The kit is the visual spec, not code to port |
| 2 | One JSON file, loads instantly | Each section loads on its own, with a skeleton, an empty state, a human error and a staleness badge | Real routes, `cachedRoute()`, rate limits |
| 3 | **Live** replays a finished game cut at chosen moments | Live polls the existing live routes. There is no moment picker | A replay of a final game isn't a product feature |
| 4 | Football live props tracker parses play text | Reads the live box score the live parsers already refresh | The box score is the real source |
| 5 | Compare peers are a fixed list of 12 | A player picker filtered to the same position | Needs every player, not a sample |
| 6 | Typeface and elevation switchers, sport tabs | One typeface and one elevation ship. Sport comes from the route | The switchers were for choosing |
| 7 | "Before the game" injuries on a final page show the report fetched at build time | Labeled as the current report, with its fetch time | ESPN keeps no pre-kickoff snapshot. Capturing one is deferred |
| 8 | Cards whose data isn't held show a status | Same statuses, until the data lands | NBA/NHL shots 2024-25 only (until R5), no NHL or soccer win probability, no tennis point-by-point, no CFB advanced passing, no soccer/CFB injuries |
| 9 | Seven games and 13 subjects, all well covered | Every game: no odds, postponed, doubleheaders, neutral sites, OT and shootouts, extra innings, retirements and walkovers | Each gets an empty or status state, checked in R6–R8 |

**Calendar limits on verification:**
- NBA and NHL live and current-season pages can't be render-checked until October.
- Golf can't be checked until a live tournament.
- **The MLB regular season ends in late September.** Verify the MLB live game
  state before then, or on postseason games.

---

## 2. Rules for every phase

- **Build, type-check, render, compare, commit, stop.**
  - `tsc --noEmit`.
  - Render every affected sport at 1440px and 400px.
  - Put each page beside its G2 mockup for the same subject and check that the
    numbers match that dataset. Where data has moved on since the snapshot, the
    dataset's `fetched`/source note explains the difference.
  - Commit only the phase's own files, by explicit path. Never `git add -A` or
    `git add docs/`.
  - Update this doc's status line, then **stop for sign-off**.
- **Subtract in the same phase.** A card, field or component the rebuild
  replaces is deleted in the phase that replaces it, not kept beside it (rule 1
  of `master-plan-2026-09-06.md`).
- **Architecture (`CLAUDE.md`):**
  - One shared `PlayerDetail`/`TeamDetail`/`GameDetail`, and one adapter per
    sport per component.
  - `{Component}Data` is declared in the MLB adapter.
  - A named, presence-checked field only for a real data difference.
  - Adapters never return JSX, and hooks stay in the component.
  - GET routes go through `cachedRoute()` or a direct read of a table
    refreshed out of band. **Grep `cacheKey` before choosing a key.**
  - Python writes, TypeScript renders. One writer per table, and each new table
    gets its `docs/table-ownership.md` row in the same commit.
- **Real data only.** Where data is missing, show a status. Never fill a gap
  with a guess.
- **Ask before any Render deploy.** Don't push unless asked.
- **Before any DB work:** the pooler caps at 15 connections. Check for running
  fits, harvester cycles and other sessions' jobs.
- Don't touch `docs/CURRENT.md`. This thread's baton is `RESUME-PROMPT.md`.

---

## 3. Decisions

### Already taken (don't reopen)

| # | decision | from |
|---|---|---|
| 1 | Pages are in-depth research pages. Odds are one section, **except the prop analysis block**, which stays near the top of the player page: market tabs, line stepper with price and age, window chips (vs opp · L5 · L10 · L15 · Season), hit-rate tiles and bars vs line. Presentation fixes only: label the season in scope, hide a tile with no sample, open on recent games, F2 type and contrast | operator 2026-09-14 |
| 2 | Every card is judged by "does this make sense for this sport, does this help". No earlier design is the standard | design audit |
| 3 | "No clear edge" floor: 70th percentile | build plan D1 |
| 4 | Soccer default market by position: GK saves · DEF tackles (else shots) · MID shots on target · FWD anytime goalscorer, falling back to today's order | build plan D2 |
| 5 | Soccer and tennis live card on the player page: score and state only | build plan D3 |
| 6 | Two-tier interaction. Tier 1 on every card: hover detail, real links, scope, keyboard focus. Tier 2 where it adds insight: drill-downs and compare | design D6 |
| 7 | Tokens are built so dark mode is possible. Shipping dark mode is separate (deferred) | design D5 |
| 8 | Game page has three states: before start (research as of kickoff), live, final (recap, with the kickoff research kept) | operator 2026-09-14 |
| 9 | Player and team pages get a "Compare against" control | operator 2026-09-14 |
| 10 | Golf is held until a live tournament. NBA/NHL live waits for October. Scan and slate pages are out of scope except the games strip | standing |

### Picks G1–G7, taken as built in G2

Approving this plan approves these. Each is a token or layout choice that can be
swapped before R3 without changing any other phase.

| pick | taken | note |
|---|---|---|
| G1 typeface | **System sans** (`ui-sans-serif, system-ui, "Segoe UI", Roboto`). **Drop the IBM Plex Mono load** (1 element uses it) | Inter / Plex Sans / Source Sans 3 remain a one-token swap |
| G2 elevation | **Raised cards:** paper `oklch(94.5% …)`, card `oklch(98.5% …)`. This fixes today's card-darker-than-page inversion | Flat-with-borders is a one-token swap |
| G3 player layout | **A, sectioned** with a sticky section nav | as G2 |
| G4 live game layout | **Sectioned**, opening on "Right now" (live header, the sport's graphic, win probability) | as G2's live state |
| G5 team layout | **A, sectioned** | as G2 |
| G6 slate research views | **Not now.** Deferred with its data needs (§R-deferred). The ingest work in R4/R5 serves it later | consistent with "slate pages out of scope" |
| G7 ideas in the build | **Everything the G2 mockups show.** Ideas marked Not held stay deferred | |

---

## 4. Phases at a glance

| phase | what | size | depends on | calendar |
|---|---|---|---|---|
| R0 | Safekeeping and baseline | done 2026-09-13 | — | — |
| R1 | Correctness on today's pages | small–medium | — | CFB check Sat 2026-09-19 |
| R2 | Shared data rules | medium | — | — |
| R3 | Design system foundations | medium | picks above | — |
| R4 | Parsers for feeds already fetched, and two new endpoints | medium | R2 | — |
| R5 | Python rollups and ingest | large | R2 | Render deploy asks |
| R6 | Player page rebuild | large, per sport | R2–R5 | NBA/NHL verify Oct |
| R7 | Team page rebuild | medium–large | R2, R3, R5 | NBA/NHL verify Oct |
| R8 | Game page rebuild with three states | large | R2–R5 | MLB live before season end; NBA/NHL Oct |
| R9 | Compare control | medium | R5–R8 | — |
| R10 | Port-artifact cleanup | small–medium | R6–R9 | — |
| R11 | Deep history on team and game pages | large, design first | R2, R10 | — |

Order follows the design audit's sequencing rules:
- identity and interaction (R3) before any card;
- data rules (R2) before any page reads them;
- card changes before the field-rename cleanup (R10);
- scope before deep history (R11).

R1, R2 and R3 don't depend on each other and can run in any order.

---

## R0 — Safekeeping and baseline ◆ DONE

Audit committed, before-screenshots in `before/README.md` (build plan Phase 0).

---

## R1 — Correctness on today's pages ◆ small–medium

Located bugs with known causes that are live today. Fixing them doesn't wait for
the rebuild.

**1a. WTA shows men (B2).**
- `lib/sports/multiSport/espnTennis.ts`: declare `grouping.slug`, then keep only
  `womens-singles` (WTA) and `mens-singles` (ATP), mirroring
  `schedule.ts:278-279`.
- Verify: `/api/tennis/wta` lists no men and `/api/tennis/atp` no women. Game
  `182770`'s history arrays fill.

**1b. Team header (B6, and the Phase 0 baseline additions).**
- The adapter owns the phrase; `TeamDetail.tsx:314` stops appending
  ` in division`.
- Six team adapters return a correct phrase, or `''` when the rank is 0 or
  missing.
- Record format:
  - `record.draws` gives soccer W-D-L;
  - NHL gets W-L-OTL (F-B11);
  - MLB passes a real ordinal and division name.
- The season is labeled whenever it isn't the current one.
- `seasonStatus.label` replaces `0-0` before a season starts, and reaches the
  header through `TeamDetailData`.
- The R7 hero reuses this data.

**1c. Spelling (C10).** `defence` → `defense` in the three user-facing strings:
- `nfl/…/playerDetailAdapter.ts:427`
- `cfb/…:201-202`
- `nba/…:242`

**1d. Game links (B5), the rest of it.**
- **Past-game pages.** `app/nfl/game/[gameId]/page.tsx` finds its game in
  today's strip. Fall back to the game route when it isn't there. MLB's game
  page uses the same pattern, so fix it the same way. Check CFB.
- **Python UTC range.**
  - `python-odds-service/src/game_context.py:148` `_date_range_param` builds
    its range in UTC, so NFL and CFB jobs lose primetime games after 00:00Z.
  - Build the range from the US Eastern date, the way `teamSportEspn.ts` now
    does.
  - Keep the backward-range ordering `archiveResultsJob` relies on.
  - **Needs a Render deploy: ask first.**

**1e. Rate limiting (D5).**
- Today every unlisted `/api/*` route shares one 60/min bucket
  (`proxy.ts:132`, `:156`).
- Give page-load routes their own budgets sized to one page's real fan-out plus
  live polling, and correct the message wording.
- Pages never print API error text. Until R3's `ErrorState` exists, show a
  plain "Couldn't load … Retry", and never the false "No teams match".

**1f. CFB pages blank on a live slate (B1).**
- **2a:** find why a Sep 13 rebuild listed Sep 3/4 games
  (`app/api/cfb/route.ts` → `buildCfbSnapshot` → `loadGameContextsForSport`).
  Time box: one session, and write down what was ruled out.
- **2b, Saturday 2026-09-19:** during the live window, read `refreshCfbJob`'s
  run log, tier and `prop_odds` rows. Change `gameday.py` only if the tier is
  still cold with kickoffs inside 6h (asks before deploy).
- **2c:** once pages render, append CFB verdicts to
  `phase-c-card-verdicts.md`.

**1g. Phase F data bugs whose cause is in shared read code.**

| bug | fix here |
|---|---|
| F-B1 | Game page "allowed" ranks copy the other team's "for". Read real allowed values (`/api/season-ranks?side=allowed`) in NFL, NBA, soccer and tennis |
| F-B4 | MLB pitcher game log: zeros and blank rows |
| F-B5 | MLB team stats rounded to integers: carry proper precision |
| F-B6 | Soccer raw floats: format at the adapter |
| F-B7 | Soccer rank pools "of 23" in a 20-team league: one pool, the league's teams in that season |
| F-B8 | Soccer records count draws as losses: W-D-L |
| F-B9 | Soccer next-game moneylines: verify which team each belongs to; add the draw |
| F-B10 | Final CFB and NHL games stuck on "Loading live details…": a final game never shows a live loading state; NHL logos |
| F-B11 | NHL record drops OT losses (with 1b) |
| F-B12 | Tennis aces line: verify whether it is a match-total line compared with the player's own aces; label or pair correctly |
| F-B13 | Tennis multi-season W-L labeled as one season |

- F-B2 (duplicate `game_result` rows) is fixed by R2's read module.
- F-B3 (NFL team bar chart out of order) is replaced in R7. If R7 is more than
  two weeks out, sort it by date here.

**1h. Matchup "biggest edge" floor (C9).** `MatchupExplorerCard.tsx:298`.
- Below the 70th percentile, say "No clear edge against this opponent".
- Check first that a high `pctOf` means "allows more".
- The card is shared, so render one page per sport. It is deleted in R9.

**Done when:** each item has a before/after render and is committed. The Python
fix waits on deploy approval. **Stop.**

---

## R2 — Shared data rules ◆ medium

One implementation of each rule, in the language that consumes it. Where both
Python and TypeScript need a rule, a drift test asserts they agree, as
`tests/config-drift.test.ts` does for bookmaker aliases. Every later page reads
through these. None of them changes a card by itself.

| rule | what it does | where | fixes |
|---|---|---|---|
| **Prop main line** | Take the last **pre-game** quote per book, side and line. The main line is the one quoted on both sides by the most books; ties go to the price nearest even. Pick'em books (PrizePicks, Underdog, Sleeper, Dabble, ParlayPlay, Betr, Chalkboard) never count as a price. Yes/no markets keep a 0.5 line with 2+ books on the over. A market with only one-sided quotes is flagged "alternate lines only" and not shown as a line | Shared TS module read by `app/api/props/lines/route.ts` and every adapter that picks a line (`lib/odds/props/`) | Alternate ladders stored under the main key (14.5–144.5 passing yards); post-game captures; +100 pick'em payouts shown as prices |
| **Pre-start odds filter** | Split `game_odds_history` at the game's start time: before is pre-game history, after is in-game | `lib/odds/gameLineHistory.ts` | 1,790 of 2,782 KC @ BOS rows were after the start |
| **`game_result` read module** | Measure first: team-id fill rate, cross-source duplicates, date disagreements. Then read results for (sport, team, season range), de-duplicated on score plus home/away within ±1 day, with team identity through `team_name_index` / entity resolution | New TS read module, `cachedRoute()` with a one-day TTL (key e.g. `history:results:route:${sport}:${teamId}:${seasons}`) | F-B2; D1's streak spanning seasons |
| **Season convention** | One helper mapping (sport, season) to its label and date range: NBA uses the end year; NHL, NFL, CFB and EPL the start year (`backfill_player_game_history.py`). Also drop stray All-Star-type team ids | Shared TS helper plus Python equivalent | Mislabeled seasons |
| **Ranks** | Computed across the league's real teams for that season (teams with ≥30% of the max games played), each stat with a declared better/worse direction. Football per game from total / games played. ESPN's published ranks are never used. Neutral stats (fouls, possession share) get no good/bad color | `/api/season-ranks` plus a per-stat direction table | ESPN ranks above the team count (MLB total bases 122nd); CFB red-zone 0% and possession about half a game; fouls shown green |
| **Early-season fallback** | Open on last season when the current one has fewer than MIN_GAMES (NFL/CFB 4, NBA/NHL 15, MLB 20, soccer 6), with the reason stated | Adapter helper | Offseason `0-0 · 0th seed` headers; empty cards in week 1 |
| **Innings pitched** | Carry outs. Display as whole.thirds (6.2) only at render | MLB adapters, Python rollups | Summing 6.2 + 5.1 gives wrong season innings |
| **NBA shot coordinates** | Rim origin at y ≈ 1 ft, not 5.25. A miss's point value comes from the arc, because every miss is stored as 2 | Read time in `/api/nba/shot-profile`, and at ingest in `nba_shots.py` (R5) | Wrong zones; missed threes counted as twos |
| **Source quirks** | Understat match lists come newest-first, so sort before any "last N". A TennisMyLife `tourney_date` is the tournament start, so order by round within an event. ESPN's soccer team schedule needs the fixtures parameter for unplayed games | Each source's module | "Last 5" taken from the wrong end |

**Verify:**
- Run each rule against its G2 fixture: the Dart / Witt / Isbel prop lines,
  KC @ BOS pre-start lines, Raiders 52 games not 69, NBA zone make rates
  against stored point values.
- Add unit tests built from those real rows.

**Done when:** committed with tests. **Stop.**

---

## R3 — Design system foundations ◆ medium

Cards get rebuilt once, in the new system. Specs: `F2-visual-system.md`,
`F2-ux-interaction.md` and the G2 kit (`docs/design/phase-g2/src/system.css`,
`kit.js`, `kit2.js`).

**3a. Tokens** (Tailwind theme and CSS variables):

- **Type ramp:**

  | token | size / line height | weight |
  |---|---|---|
  | `display` | 32/1.1 | 700 |
  | `heading` | 22/1.2 | 600 |
  | `title` | 17/1.3 | 600 |
  | `card-title` | 14/1.3 | 600 |
  | `body` | 14/1.5 | 400 |
  | `body-sm` | 13/1.45 | 400 |
  | `label` | 12/1.35 | 500 |
  | `overline` | 11/1.3 | 600, uppercase |

  - Nothing below 11px outside charts. Chart ticks are 10px.
  - Tabular figures in columns, proportional for big standalone numbers.
- **Color within charcoal:**
  - Text roles: `ink`, `ink-secondary`, `ink-muted`. `ink-muted` is the
    lightest gray allowed for text and passes AA on a card. `ink-faint` is for
    decoration only.
  - `good`/`bad` only for stats with a declared direction.
  - A single-hue ramp for volume and share.
  - Diverging red → neutral gray → green, with no amber.
  - `live-*` only on live elements.
  - Compare colors `#2f6fb3` / `#c56a1c` (validated: worst colorblind ΔE 22.2).
  - No color literals in components; team colors come from team data.
  - Targets: ≤ 8 text colors per page, 0 AA failures.
- **Spacing:** 4 · 8 · 12 · 16 · 24 · 32 · 48.
  - Card padding 16 (12 in dense cards), header row 44.
  - Gutter 16 at phone width, 24 at desktop.
  - Table rows 36 (32 dense).
  - Radius: 12 card, 16 hero, 8 controls.
- **Elevation:** raised (G2 pick), with paper darker than card.
- **Motion:**

  | token | timing |
  |---|---|
  | `instant` | 100ms |
  | `quick` | 180ms |
  | `smooth` | 280ms |
  | `data` | 450ms |
  | `live` | 400ms tween + 1.2s flash |

  Easing: standard `cubic-bezier(0.2,0,0,1)`, emphasized `(0.3,0,0,1)`.
  Reduced motion falls back to fades only.
- **Font:** drop the Plex Mono load.

**3b. Primitives,** one of each, replacing the listed duplicates:

| primitive | replaces |
|---|---|
| `Card` (title, scope, info tooltip, expand, caption, built-in loading/empty/error) | 9 header styles |
| `Section` + `SectionNav` (sticky, IntersectionObserver, a horizontal scroller on phones) | none today |
| `SegmentedToggle` | 12 hand-rolled toggle groups |
| `Tabs` (real `role="tab"`) | button rows styled as tabs |
| `SelectBox` | ad hoc selects |
| `Chip` (tone × size) | `FilterChip`, `GradeChip`, `OddsChip`, `ConfidenceChip` |
| `Tooltip` (reachable by focus and tap) | 97 native `title`s |
| `StatValue` / `StatGrid` (value, unit, rank, percentile, delta, direction) | ad hoc value/rank/bar combinations |
| `RankRow` with a dot strip | today's ranked bars |
| `FactList` | ad hoc label/value lists |
| `DataTable` (sortable, sticky header and first column, numeric alignment, string columns as-is) | hand-built tables |
| `Avatar` (photo, logo or flag; silhouette-on-team-color fallback, never initials; links to its page) | initials circles, crest-as-headshot, blank logos |
| `DrillDownPanel` | navigating away to see detail |
| `StatusPill` | none today |
| `VizLegend` | none today |
| `Skeleton`, `EmptyState` (says why, offers nearest real data), `ErrorState` (human text, retry, keeps cached data) | per-card loading and empty text |

**3c. Charts** (`components/charts/`):
- Every chart renders at its real pixel width (ResizeObserver), never a scaled
  `viewBox`.
- Hover tooltip on every mark.
- Shared crosshair across charts of the same games (`useChartCrosshair`).
- Line and column charts. Column bar width is clamped to
  `max(1, min(24, band − gap))`.
- A dashed reference line for a prop line.
- A zero line where values go negative.
- Sport-native surfaces from `viz-sport.js`, chosen by an adapter field (D4's
  `surface`), never `sport === 'x'`:

  | surface | used for |
  |---|---|
  | `zone` | MLB zone map, spray |
  | `field` | NFL/CFB target field, drive field |
  | `halfCourt` | NBA |
  | `rink` | NHL |
  | `pitch` | soccer |
  | `green` / hole views | golf |

- `HeatGrid`'s hardcoded `aspect="zone"` goes.

**3d. Page-level UX:**
- One visible focus ring (2px, offset).
- Every name, photo and logo is a real `<Link>`.
- State lives in the URL: section, scope, market, game state, compare target.
- Breadcrumb back that names its destination.
- Breakpoints 400 / 768 / 1024 / 1440.
- Nothing wider than the viewport. Tables scroll inside their card, and the
  games strip scrolls inside its own container.

**Verify:**
- Build the primitives on one real card each on an existing page.
- Check contrast, focus and 400px on it.
- Screenshot beside the G2 kit.

**Done when:** committed. **Stop.**

---

## R4 — Parsers for feeds already fetched, and two new endpoints ◆ medium

The app downloads these and discards most of it. TypeScript parses request-time
game payloads. Finished games are cached through `cachedRoute()` with a long TTL
once final. Live routes keep their documented no-cache contract.

| source (already called) | fields to parse | feeds cards | where |
|---|---|---|---|
| ESPN game summary | `winprobability` (per play) | Win probability with biggest swings (NFL, CFB, NBA) | `footballLiveGame.ts`, `nba/liveGame.ts` |
| ESPN game summary | `drives.previous/current` (yard lines, down, distance, result) | Drive chart and selected-drive field (NFL/CFB) | `footballLiveGame.ts` |
| ESPN game summary | `plays` with coordinates | NBA lead tracker, scoring runs, two-team shot chart (check coordinates against R2's origin), play log | `nba/liveGame.ts` |
| ESPN game summary | `pickcenter` | Lines open → close; result vs line (NFL, CFB, NBA, NHL, soccer, including the soccer draw where present) | shared summary parser |
| ESPN game summary | `rosters` (formations), `commentary` (pitch positions), `lastFiveGames` | Soccer lineups, shot map, commentary, form | `soccer/liveGame.ts` |
| ESPN game summary | `seasonseries` | Season series (NBA, NHL) | shared summary parser |
| ESPN game summary | `injuries` | Injuries (NFL already calls the injuries endpoint; others from the summary), labeled with the report's fetch time | shared summary parser |
| MLB statsapi live feed | `plays[].playEvents[].pitchData` (location, velocity, type), `hitData` (distance, exit velocity, launch angle, coordinates) | Spray chart with distance, at-bat explorer, pitch mix per pitcher, last pitch/batted ball on live | `lib/sports/mlb/statsapi.ts` |
| MLB statsapi, **new endpoint** | `/game/{pk}/winProbability` | MLB win probability by plate appearance | `statsapi.ts` |
| NHL api-web | play-by-play shot coordinates for a live or unstored game | NHL shot-attempt flow, full-rink map | `nhl/liveGame.ts` (stored games come from `nhl_shot_events`) |
| NHL api-web, **new endpoint** | `/v1/player/{id}/landing` | Official NHL season totals (skater and goalie) | `lib/sports/nhl/nhle.ts` |
| TennisMyLife CSV | serve and return columns, break points, minutes, ranks | Tennis tiles, serve/return by match, ranking, match stats, serve vs return pre-match, form, fatigue | `lib/sports/tennis/tennismylife.ts` (parses only aces and surface today) |
| ESPN team schedule | `curatedRank` | CFB ranked opponents | `teamSportEspn.ts` |

**Not parsed, by decision:** ESPN core team-statistics API (not called today).
`/api/season-ranks`, nflverse team stats, MLB team hitting/pitching and
`*/teamDefenseAllowed.ts` cover team ranks.

**Verify:** the parsed output for each G2 game (Appendix B ids) matches the
mockup dataset field by field.

**Done when:** committed. **Stop.**

---

## R5 — Python rollups and ingest ◆ large

Python writes, TypeScript renders.
- Each new table gets a migration and its `docs/table-ownership.md` row.
- A `JOB_REGISTRY` entry where it runs on a schedule, and `withJobLock`.
- A direct-read route (pattern 2) or `cachedRoute()`.
- **Every deploy asks first.** Check pooler load before backfills.

**5a. Statcast corpus rollups.**
- `mlb_pitch_events` is a 5-day hot window. Full seasons are in the Parquet
  corpus, reachable only from Python (`corpus_reads.union_view`).
- Rollups, per season, with an as-of date so pre-game cards are cut at the game:

  | rollup | cards |
  |---|---|
  | Hitter: power profile (max and p90 EV, hard-hit, barrel-style rates as league percentiles among qualified hitters), EV distribution, EV by game, results by pitch type, zone map, vs LHP/RHP, HR list | "Contact quality & approach" |
  | Pitcher: arsenal (usage, velocity, results by pitch), pitch locations, "where he pitches", fastball velocity by start, vs LHH/RHH | "Arsenal & command" |
  | Team, pitch-weighted: contact and pitch quality percentiles | Team "Contact & pitch quality". Replaces `teamStatcast.ts`'s per-player average |
  | Team staff vs RHH/LHH, lineup vs RHP/LHP (handedness from `stand` / `p_throws`) | Compare cards, MLB starters card |
  | Starters before a game: season line, last starts, pitch mix; lineup vs the starter's hand, with head-to-head | Game "before start" |

- **The corpus has no team column.** Joining through `player_game_history`
  matched 79% of 2026 pitches. Measure and fix the join (roster by date) before
  the team rollups.
- **Keep hit distance at ingest.** `hit_distance_sc` / `totalDistance` is in
  neither the corpus nor any table. Add it to corpus writes and
  `mlb_pitch_events` so the season HR list has distances. The live feed covers
  today's game (R4).

**5b. Strength rollups** (from `player_game_history`, where `/api/season-ranks`
already computes for and allowed):
- Add a date cutoff (as of kickoff) for "before start".
- Add position grouping for "allowed to the position":
  - NFL positions from nflverse `players.csv`;
  - NBA, NHL and soccer positions from ESPN rosters.
- Measure whether `player_game_history` already carries position before adding
  a column.
- Production score for key players and roster production. **Not games played**:
  that surfaced punters.
- One rollup per (sport, season, team, side, position), so a page reads a
  handful of rows rather than a league's game logs.

**5c. Shot ingest.**
- Extend `nba_shots.py` and `nhl_shots.py` to 2025-26. Both tables hold 2024-25
  only while game logs reach 2025-26.
- Apply R2's NBA origin and miss-value correction at ingest, and backfill
  2024-25.
- Team views use the regular season only, with ≥ 40 games.

**5d. NFL defensive target view.**
- A defense-side read of `nfl_target_events`: where each defense is thrown at,
  by receiver position.
- The defense is derived from the game id plus the offense.

**Verify:**
- Rollup values match the G2 datasets (Witt 390 balls in play and 18 HR in the
  G-board; Skenes arsenal; Royals team Statcast).
- Row counts are recorded.
- Job run logs are clean.

**Done when:** committed and, with approval, deployed. **Stop.**

---

## R6 — Player page rebuild ◆ large, one sub-phase per sport

Spec: `docs/design/phase-g2/src/player.html`, `src/sports/common.js` (skeleton),
`mlb.js`, `football.js`, `hoops-hockey.js`, `soccer-tennis-golf.js`.

**Skeleton, every sport,** in `PlayerDetail` via adapters:
1. Hero: photo, position, team, jersey, age, injury status, links to team and
   next/last game. The page **always renders the player**, even with no market
   (7 of 22 captured pages were blank).
2. **Prop analysis:** the kept block, reading R2's main line. The season in
   scope is labeled, tiles without a sample are hidden, and it opens on recent
   games. Its "vs" chip opens on the compared team when one is set (R9).
3. *(R9: compare sections insert here.)*
4. **Season by season:** multi-season `player_game_history` (Gap 1: the table
   holds 2–4 seasons, pages read one), with the R2 season helper.
5. **Trends:** any stat over time, rolling average, scope toggles, crosshair.
6. **Splits:** home/away, W/L (from R2's `game_result` read), opponent, month.
7. The sport's own sections (table below).
8. **Game log:** every stat, grouped by season, rows linking to the game.
9. **Odds & prices:** best price, books and movement, from `prop_odds`.
10. **Sources:** the data behind the page and its as-of time.

**Sport sections:**

| sport | sections and cards (G2) | sources and tables | built in |
|---|---|---|---|
| MLB hitter | Contact quality & approach: Power profile · EV distribution · EV by game · Results by pitch type · Strike zone · vs LHP/RHP · Home runs (with distance) | corpus rollups (5a); distance (5a ingest) | R5 |
| MLB pitcher | Arsenal & command: Arsenal · Pitch locations · Where he pitches · Fastball velocity by start · vs LHH/RHH. Game log per start (F-B4) | corpus rollups; `player_game_history` (IP as outs) | R5, R2 |
| NFL WR/TE/RB | Usage & depth: Target chart on a half-field · depth by season | `nfl_target_events` via `/api/nfl/target-map` | Read |
| NFL QB | Where he throws: Pass chart | `nfl_target_events` | Read |
| CFB QB | Efficiency: Advanced passing, shown as **Not held** | — | status |
| NBA | Shot profile: Shot chart by zone | `nba_shot_events` via `/api/nba/shot-profile` (R2 correction; 2025-26 after 5c) | R2, R5 |
| NHL skater | Shot map & official totals | `nhl_shot_events`; NHL player landing | R4, R5 |
| NHL goalie | Shots faced map & official totals | same | R4, R5 |
| Soccer FW/MID | Chances & finishing: Shot map · Goals vs xG · Per 90 by season | Understat per player (cached in `snapshot_cache`); `player_game_history` | Read |
| Soccer GK | Shot-stopping: Beyond saves | `player_game_history` | Read |
| Tennis | Surface & serve: By surface (today's surface marked, C7) · Ranking · Serve and return by match | TennisMyLife (R4); current event's surface from `tennis/schedule.ts`, never the last match's | R4 |
| Golf | Scoring: Rounds · Scoring by par. Shot profile: Driving distance · Approach proximity · Putting · Make % by first-putt distance | `golf_round_scores`, `golf_hole_scores`, `golf_shot_events`, `golf_tournaments` (names); `/api/golf/shot-profile` | Read; verification held until a tournament |

**Also in R6:**
- **C8** soccer default market by position (decision 4). Order both priced and
  synthetic candidates by `subjectMeta.position`.
- **C4** live card on every in-season player page, as a sport-neutral slot:
  - game state for every sport;
  - "your lines so far" from the live box score for NBA, NHL, NFL and CFB;
  - MLB count, bases, batter and pitcher as a named presence-checked field;
  - soccer and tennis get score and state only (decision 5).
  - Live hooks run unconditionally, `enabled` per sport.
  - Fix the stale comment at `PlayerDetail.tsx:1601`.
- **D2 and D3:** replace "Game context" and "Where this sits"; their content
  moves into Seasons, Trends and Splits. Delete `toGameContext`,
  `toWhereThisSits` and any `DensityCurve` use left without a caller.
- **D4:** the spatial role draws on the adapter's surface (R3c), single-hue for
  share.
- Delete every card this replaces, in the same sub-phase.

**Sub-phase order:**
1. MLB, while the season is live.
2. NFL and CFB (CFB after R1f).
3. Soccer.
4. Tennis.
5. NBA and NHL, built now and render-verified in October.
6. Golf, built and verified at the next tournament.

**Verify, per sport:**
- Render the G2 subjects: Judge 592450, Skenes 694973, Chase 4362628, Allen
  3918298, Manning 4870906, SGA 4278073, Wembanyama 5104157, MacKinnon 8477492,
  Vasilevskiy 8476883, Cunha 259902, Lammens 301425, Alcaraz 3782.
- Plus one player with no market, one injured player and one early-season
  player.
- 1440/400px; numbers match the dataset.

**Stop after each sport.**

---

## R7 — Team page rebuild ◆ medium–large

Spec: `docs/design/phase-g2/src/team.html`, `src/sports/team-common.js`,
`team-sports.js`.

**Skeleton:**
1. Hero with R1b's record and standing: W-L / W-D-L / W-L-OTL, standing only
   for the current season, next game.
2. One season switch scoping the page. It opens on last season when the current
   one is under MIN_GAMES and says so.
3. **Results & schedule:** results with scores by season (R2 read), margins,
   home/away splits, schedule.
4. **Standings:**
   - ESPN for NFL, CFB, NBA and soccer;
   - MLB Stats API for MLB;
   - NHL `standings/now` (current season only).
5. **Team stats:** ranked across the league with a dot strip, direction-aware,
   per game for football, invariant stats dropped. CFB possession is excluded.
   Sources: `/api/season-ranks` for and allowed, nflverse team stats, MLB team
   hitting/pitching. This also covers B4 (NBA/NHL team payloads had no team
   stats).
6. **Roster production:** `player_game_history`, ranked by production score,
   with photos and links.
7. **Sources.**

**Sport sections:**

| sport | card | source | built in |
|---|---|---|---|
| MLB | Contact & pitch quality percentiles | corpus team rollup (5a) | R5 |
| NFL | Passing game: target share and throw map vs league | `nfl_target_events` | Read |
| CFB | Ranked opponents | ESPN schedule `curatedRank` | R4 |
| NBA | Shot profile vs league | `nba_shot_events` by `team_id` (R2 correction, regular season, ≥40 games) | R2, R5 |
| NHL | Shot map for / against | `nhl_shot_events` by `team_id` | Read |
| Soccer | W-D-L throughout; team totals ranked | `player_game_history`, `/api/season-ranks` | R2 |
| Tennis, golf | No team page; the route explains why | — | — |

**Delete:**
- line picker and 25-game win bars (F-B3);
- duplicate "Next game" cards;
- "Unit grades" where Phase F said remove.

**Verify:**
- Royals, Raiders, Ohio State, Lakers, Maple Leafs, Man City against the
  datasets.
- One offseason team (NBA or NHL) for the fallback.
- 1440/400px.

**Stop.**

---

## R8 — Game page rebuild with three states ◆ large

Spec: `docs/design/phase-g2/src/game.html`, `common-game.js`,
`game-football.js`, `game-hoops-hockey.js`, `game-mlb.js`,
`game-soccer-tennis.js`, `game-states.js`. State comes from the game's real
status. `?state=` is only for review.

**Page rules:**
- One header. The live panel no longer repeats the hero (D1).
- Past games resolve (R1d).
- A final game never shows a live loading state (F-B10).
- During a live game the page opens on "Right now"; after the final whistle, on
  the recap.

### Before start (research as of kickoff)

| card | sports | source | built in |
|---|---|---|---|
| Header: start time, venue, weather, records entering, closing-line chips | all | ESPN summary / MLB feed; `game_result` | Read, R2 |
| **Strength vs strength:** one side's production against what the other allows, with league ranks | team sports | strength rollups with date cutoff (5b) | R5 |
| Form coming in; head-to-head | all | `game_result` read (R2); tennis head-to-head from TennisMyLife | R2 |
| Player props research: line, each player's last 10 (sparkline), history vs this opponent, injury flag, drill-down | NFL, CFB, MLB, NBA, soccer | `prop_odds` (main line), `player_game_history`, summary injuries | R2, R4 |
| Players to watch: season and vs-opponent averages, with an early-season fallback | NBA, NHL, soccer | `player_game_history` | Read |
| Injuries, starters first, with status and detail, labeled "report as of" | NFL (endpoint), others where the summary has them | ESPN | R4 |
| Passing matchup: where each offense throws vs where the other defense is thrown at | NFL | `nfl_target_events` plus the 5d defense view | R5 |
| Shot zones: one team's shots vs zones the other allows | NBA | `nba_shot_events` | R2, R5 |
| Starters: season line, last starts, pitch mix; lineup vs the starter's hand, with head-to-head | MLB | corpus rollup (5a) | R5 |
| Goalie form | NHL | `player_game_history` | Read |
| Lineups | soccer | summary `rosters` | R4 |
| Serve vs return, form before this round | tennis | TennisMyLife | R4 |
| Lines: pre-game lines and movement | all with odds | `game_odds_history` before the start (R2); `pickcenter` | R2, R4 |

### Live

| card | source | built in |
|---|---|---|
| **Right now:** live header with score, clock or period, possession, win probability and its trend; the sport's graphic (NFL/CFB field and drive; MLB diamond, count, last pitch and batted ball; NBA lead and current run; NHL shot map by period; soccer timeline; tennis set and game score) | existing live routes plus R4 parsers | R4 |
| **Props tracker:** each tracked player's stat so far against the line | live box score (`footballLiveGame.ts`, `nba/liveGame.ts`, `nhl/liveGame.ts`); MLB plate appearances | Read |
| **In-game odds** up to now | `game_odds_history` after the start (R2 split) | R2 |
| The final page's sections, up to now | same parsers | R4 |

Live values tween and flash on change (`live` token); a scoring play gets a
one-time highlight.

### Final (recap, kickoff research kept)

| section | NFL/CFB | NBA | NHL | MLB | soccer | tennis |
|---|---|---|---|---|---|---|
| Flow | WP + biggest swings, drive chart + selected-drive field | WP, lead tracker, scoring runs | Shot-attempt flow (no WP is published) | WP by PA (new endpoint) | Match timeline (`keyEvents`) | — |
| Sport detail | Scoring & leaders | Two-team shot chart; season series | Full-rink shot map; goaltending; penalties; season series | Batted balls (spray with distance); at-bat explorer (every pitch located); pitching (mix per pitcher) | Shot map; lineups and formations | Match stats; form vs season averages; head-to-head |
| Team stats, box score | Read | Read | Read (NHL boxscore) | Read | Read | — |
| Lines & props | open → close (`pickcenter`), result vs line, **props vs results** (main line vs box) | same | lines | last pre-game quote, run line and total (`game_odds_history` pre-start), props vs results | three-way with the draw, props vs results | lines; point-by-point shown as **Not held** |
| Play-by-play | plays by drive | play log | play log | play-by-play | commentary | — |
| **Before the game** | the before-start sections, kept | same | same | same | same | the kickoff section |

**Also in R8:** B8 (CFB game detail had no pregame line) is covered by the
summary `pickcenter` parse.

**Verify:**
- The seven G2 games (Appendix B) in all three states.
- The live state on a real in-progress game per in-season sport: NFL and CFB on
  a weekend; MLB **before the regular season ends**; soccer on a matchday;
  tennis during an event. NBA and NHL are marked unverified until October.
- Edge cases: no odds, postponed, doubleheader, OT/shootout, extra innings,
  retirement.

**Stop after each sport group:**
1. football;
2. MLB;
3. soccer and tennis;
4. NBA and NHL.

---

## R9 — Compare control ◆ medium

Spec: `docs/design/phase-g2/src/sports/compare.js` and the compare bars in
`player.html` / `team.html`. State in the URL (`vs`, `peer`). Compare sections
sit right after the prop analysis block on the player page and first on the team
page.

| compare | cards | source | built in |
|---|---|---|---|
| Player vs a team (defaults to the next opponent if in the league's team list, else the last opponent) | Games against them; averages vs season (with season fallback); **what this team allows to the position** (per game, league rank); the prop block's vs chip opens on that team | `player_game_history`; positions (5b) | R5 |
| — NFL | Defense thrown-at map vs the player's targets | `nfl_target_events` (5d), nflverse positions | R5 |
| — NBA | Player's zones vs zones allowed to the position | `nba_shot_events` + roster positions | R5 |
| — MLB | Opponent staff vs the hitter's hand; lineup vs the pitcher's hand | corpus (5a) | R5 |
| Player vs a same-position player | Season side by side; trend overlay in compare colors | `player_game_history` | Read |
| Tennis vs any player | Serve/return profiles; head-to-head | TennisMyLife | R4 |
| Golf vs the field | Round by round | golf tables | Read |
| Team vs team | Strength vs strength, head-to-head, form, key players; MLB hand cards | 5b rollups, `game_result` (R2), corpus | R5 |

- **Player picker:** replaces the fixed peer list, filtered to position, with
  search.
- **Delete:** `MatchupExplorerCard` and the `matchupExplorer` field (R1h's floor
  goes with it).

**Verify:** the G2 compare URLs (default opponent, a chosen team, a peer) for
each sport, against `data/matchup-<sport>.json`. **Stop.**

---

## R10 — Port-artifact cleanup ◆ small–medium

After R6–R9, so nothing is renamed twice. Fields the rebuilds already deleted
drop out of this list.

- **C1:** `hitterStats` + `nflSeasonStats` → `seasonStats`, if either survives.
- **C2:** optional fields instead of explicit `null` lines on `PlayerDetailData`.
- **C6:** MLB hero `pregameLines`. Check whether leaving it undefined is
  deliberate; close as *fits* if so.
- **B3:** games strip `firstPitch` → `startTime`, every sport.
- **Docs:**
  - `CLAUDE.md` §4 examples: use the surface field and C1 as worked examples.
  - `seasonAggregates.ts`'s "2.75M rows" → ~0.77M.

**Verify:** `tsc`, then render one player, team and game page per sport. A
rename that type-checks can still drop a card. **Stop.**

---

## R11 — Deep history on team and game pages ◆ large, design first

Builds on R2's `game_result` read, which covers the recent seasons the
rebuilt pages use.

1. **Measure:**
   - team-id fill rate per sport and decade (old raw names like "St. Louis
     Rams");
   - duplicates across sources;
   - rows per team;
   - what `team_elo_history` already gives.
2. **Design doc for approval:**
   - all-time and last-N records;
   - head-to-head across decades;
   - venue splits;
   - identity through entity resolution;
   - `(sport, home_team_id)` / `(sport, away_team_id)` indexes: a migration on
     a Python-owned table, with its `table-ownership.md` reasoning;
   - `cachedRoute()` with a day TTL.
3. **Build** in the design's sub-phases. **Stop** between them.

---

## R-deferred — not in this build

| item | unblocks when |
|---|---|
| Golf card audit and tournament view | a live tournament |
| NBA/NHL render verification (R6–R8 live and current season) | October |
| C3: fitted models for six sports | its own program (`master-plan-2026-09-06.md`) |
| `docs/table-ownership.md` full re-derivation (51 tables vs 36 documented) | its own task. R5 adds rows for its own tables |
| B8: NFL player id-mapping warnings | follow-up list |
| Dark mode shipped | tokens support it after R3; a product call later |
| Injury report captured at kickoff (so a final page shows the report as of kickoff) | a Python capture job; until then the "report as of" label |
| **Slate research views (G6)** | a product decision. Data needs: longest HR (distance kept in R5; park orientation and wind vs field **not held**); anytime TD (red-zone targets and carries need play-by-play, **dropped**); NBA pace-up (derivable); goalie and shots (confirmed starters **not held**); anytime goalscorer (xG per player across a matchday, stored only per player page); aces (TennisMyLife serve stats, R4) |
| **Not held, no current source** | NFL snap share and routes, EPA per play (play-by-play not kept); MLB confirmed lineups, bat speed and swing length, spin and movement; NHL confirmed starting goalies, PP/SH TOI; NBA on/off and lineups; CFB advanced (CFBD not ingested); soccer tackles and passes, probable lineups; NHL and soccer win probability; tennis point-by-point |
| Egress and payload review for rollup routes | measured in R5/R6 verification; its own task if a page exceeds budget |

---

## Measurement traps (apply to every verification)

- A payload's `fetchedAt` isn't the cache write time; `snapshot_cache.fetched_at`
  is.
- A cache can rebuild mid-check. Re-fetch before writing a number down.
- A type-check doesn't prove a card renders. Render it.
- Check the calendar, **including the weekday**, before judging an empty card
  (B1b's Sunday).
- API limiter: pace page captures, and watch for "Limit is 60 per 60s" until R1e.
- No `#` fragment in phone-width capture URLs (rendered zero cards).
- Loading shells look settled. Wait for real cards.
- **Data traps found building G2:**
  - `prop_odds` keeps capturing for up to two days after a game, and files
    alternate ladders under the main key;
  - `game_odds_history` keeps storing after the start;
  - `game_result` has cross-source duplicates dated a day apart;
  - seasons follow each upstream's convention;
  - IP is whole.thirds;
  - ESPN ranks exceed team counts;
  - Understat lists come newest-first;
  - TennisMyLife dates are tournament starts;
  - golf lie codes aren't decoded;
  - the Statcast corpus has no team column;
  - All-Star-type team ids appear in game logs.
- ESPN returns 403 to custom User-Agents from scripts; use a browser UA for
  one-off checks.

---

## Appendix A — Correctness bug ledger

| bug | where | fixed in |
|---|---|---|
| B2 men on WTA | tennis slate | R1a |
| B6 team header | team pages | R1b → R7 hero |
| C10 spelling | 3 adapters | R1c |
| B5 dead game links; past-game pages; Python UTC | NFL/MLB game pages, worker | R1d (TS part fixed 2026-09-14) |
| D5 shared 60/min bucket, raw API text | `proxy.ts` | R1e, R3 `ErrorState` |
| B1 CFB blank player pages | CFB | R1f |
| C9 biggest edge without a floor | `MatchupExplorerCard` | R1h, deleted R9 |
| C8 soccer default market | soccer adapter | R6 |
| C7 tennis surface | tennis adapter | R6 |
| C4 live card MLB-only | `PlayerDetail` | R6 |
| D1 duplicate score, broken logos, initials, streak across seasons | NFL game | R3 `Avatar`, R2 read, R8 |
| D2 "Game context" | `analyticsRoles.ts:359` | R6 (removed) |
| D3 "Where this sits" | `analyticsRoles.ts:313` | R6 (removed) |
| D4 strike zone for every sport | `HeatGrid` `aspect="zone"` | R3c surfaces, R6 |
| F-B1 mirrored allowed ranks | NFL/NBA/soccer/tennis game | R1g |
| F-B2 duplicate games in records | `game_result` | R2 |
| F-B3 seasons out of order | NFL team chart | R7 (R1 if R7 is far) |
| F-B4 pitcher game log empty | MLB | R1g |
| F-B5 integer-rounded rates | MLB game/team | R1g |
| F-B6 raw floats | soccer player | R1g |
| F-B7 rank pools | soccer | R1g, R2 ranks |
| F-B8 draws as losses | soccer game | R1g |
| F-B9 next-game moneylines | soccer team | R1g |
| F-B10 stuck live loading on final | CFB/NHL game | R1g, R8 |
| F-B11 OT losses dropped | NHL team | R1b/R1g |
| F-B12 aces line pairing | tennis player | R1g |
| F-B13 multi-season record label | tennis game | R1g |
| G2 prop main line | `prop_odds` reads | R2 |
| G2 post-start odds in history | `game_odds_history` reads | R2 |
| G2 NBA rim origin and miss value | `nba_shot_events` | R2, R5c |
| G2 IP summed as decimals | MLB | R2 |
| G2 ESPN ranks unusable | team ranks | R2 |

## Appendix B — Reference fixtures (G2 datasets)

Rebuild with `node docs/design/phase-g2/build.mjs`. Refresh with the venv Python
from the repo root: `tools/build_player_data.py`, `build_game_data.py`,
`build_team_data.py` and `build_matchup_data.py` (shared helpers `g2lib.py`,
`pregame.py`).

| surface | fixtures |
|---|---|
| Games | MLB KC @ BOS (pk 824711) · NFL DAL @ NYG (401872930) · CFB Ohio State @ Texas (401856682) · NBA OKC @ LAL (401811010) · NHL FLA @ TOR (ESPN 401803621 / NHL 2025021270) · soccer MCI @ MUN (401879278) · tennis Paul v Zverev |
| Players | Judge 592450 · Skenes 694973 · Chase 4362628 · Allen 3918298 · Manning 4870906 · Gilgeous-Alexander 4278073 · Wembanyama 5104157 · MacKinnon 8477492 · Vasilevskiy 8476883 · Cunha 259902 · Lammens 301425 · Alcaraz 3782, plus 12 peers |
| Teams | Royals · Raiders · Ohio State · Lakers · Maple Leafs · Man City |
| Matchups | `data/matchup-<sport>.json`: all teams, results since 2023, rollups per season, next games |

## Appendix C — Where `build-plan.md` went

| build plan | here |
|---|---|
| Phase 0 | R0 (done) |
| 1a, 1b, 1c, 1d | R1a–R1d |
| 2a, 2b, 2c | R1f |
| 3 (tennis surface) | R6 tennis |
| 4 (live card) | R6 |
| 5a (edge floor), 5b (soccer market) | R1h, R6 |
| 6 (field collapse, B3) | R10 |
| 7 (deep history, Gap 1) | R11; Gap 1 → R6 seasons |
| Decisions 1–5 | §3 |
| Deferred list | R-deferred |
| Follow-ups B4, B8 | B4 → R7 team stats; B8 → R8 (CFB lines) and R-deferred (NFL id mapping) |
