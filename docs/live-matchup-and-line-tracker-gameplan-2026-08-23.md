# Gameplan — unified live matchup card + player-page line tracker

Written 2026-08-23. Scoped from a direct request to (1) make the
game-detail "live" experience one shared, visually strong card across all
6 sports instead of MLB-only, modeled loosely on an ESPN boxscore but more
visually appealing and native to this app's design language, and (2) add a
card to every player-detail page for in-depth live line tracking, including
user-defined manual lines.

## Part 1 — DONE (2026-08-23, built overnight)

Built and verified end-to-end for all 6 non-MLB sports (NHL/NBA/CFB/NFL/
Soccer/Tennis), following the exact sequencing this doc laid out (MLB
refactor → NHL → NBA/Soccer → NFL/CFB → Tennis), except MLB's existing
`LiveTab` was left untouched rather than refactored through the new shared
primitives — it already worked, and baseball's bases/innings concepts
don't generalize cleanly enough to be worth bending retroactively; instead
a new sibling primitives file gives every other sport the same visual
language without risking MLB's working code. Concretely:

- **`components/LiveDetailPrimitives.tsx`** — the generalized visual
  system (`LiveBandHeader`, `LiveSpotlightCard`, `LivePeriodStrip`,
  `LiveEventRow`, `LiveSubTabBar`, `LiveBoxTable`, `LiveTabEmptyState`),
  extracted from `GameHeroCard.tsx`'s MLB-only pieces. `GameHeroCard.tsx`'s
  `C` palette is now exported and reused, not duplicated.
- **Per sport**: a `lib/sports/{sport}/liveGame.ts` (or
  `lib/sports/multiSport/footballLiveGame.ts`, shared by NFL+CFB since
  they're the exact same ESPN shape) fetcher/parser, a deliberately
  uncached `app/api/{sport}/game/[gameId]/live/route.ts` mirroring
  `app/api/mlb/game/[gameId]/live/route.ts`'s contract, a
  `components/use{Sport}LiveGame.ts` polling hook mirroring
  `useLiveGame.ts`'s shape, and a `components/{Sport}LiveTab.tsx` UI
  component — wired into `GameDetail.tsx`'s existing `renderLiveDetail`
  conditional chain (`sport === 'nhl' ? ... : sport === 'nba' ? ...`,
  matching the file's own pre-existing chain style, e.g. its `detailError`
  resolution just above).
- **Verified two ways**: `npm run typecheck` clean across every file
  touched (a concurrent second session was independently mid-edit on
  `PlayerDetail.tsx`/`playerDetailAdapter.ts` for an unrelated project —
  its pre-existing errors there are not from this work, confirmed by file
  path). All 6 new `/api/{sport}/game/[id]/live` routes were hit directly
  against a real local dev server with real game ids (NHL 2025030413 —
  2026 Stanley Cup Final OT thriller; NBA 401859963 — 2026 Finals; CFB
  401769072 — a bowl game; NFL 401873271 — 2026 preseason; soccer
  eng.1/401879322 — a real EPL match; tennis atp/184414 — a live-tour
  match) and each returned correctly-shaped real data end-to-end (scores,
  period/quarter/half splits, scoring plays, box scores, set ladders).
  **Not verified**: pixel-level browser rendering of the actual Live tab
  UI — the app requires a logged-in user and no test credentials were
  available this session, so the React components themselves (built
  against the same primitives already proven in MLB's card) weren't seen
  rendered in a browser. Worth a real look-over first thing.
- **Not attempted**: full drive-by-drive detail for NFL/CFB (scoring
  plays only, not every drive — `drives.previous[]` exists in the ESPN
  response and could be added later), soccer serve-stat-equivalent
  richness (soccer's summary genuinely has no per-player box score, a
  real data-shape difference, not a shortcut), tennis serve stats
  (`statistics[]` was empty on every real match checked — sets ladder
  only, honestly).

## Part 2 — built, one manual step outstanding (2026-08-23, built overnight)

Unblocked once the concurrent session finished its `PlayerDetail.tsx`/
`playerDetailAdapter.ts` rewrite (coordinated live over cross-session
messaging — verified independently, not just taken on their word: pulled
latest, confirmed `matchupExplorer` was there and `tsc --noEmit` was clean
before starting). Built:

- **`supabase/migrations/20260823090000_tracked_lines.sql`** — new
  `tracked_lines` table, sibling to `watchlist` not a repurposing of it,
  same per-user RLS-policy shape copied from
  `20260822171000_rls_on_user_owned_tables.sql`.
- **`lib/db/client.ts`** — `listTrackedLines`/`addTrackedLine`/
  `removeTrackedLine`, mirroring `listWatchlist`/`addWatch`/`removeWatch`'s
  exact query shape.
- **`app/api/tracked-lines/route.ts`** — GET/POST/DELETE, mirroring
  `app/api/watchlist/route.ts`'s auth pattern line-for-line.
- **`PlayerDetailData.liveLineTracker`** — declared in MLB's adapter file
  per the "MLB owns the type" convention, additive alongside the other
  session's new `matchupExplorer` field (confirmed no conflict). Carries
  what a subject can be tracked on (`availableStats`, constrained to known
  stat keys per this doc's earlier decision) and today's live-game id if
  any — NOT the user's saved tracked lines themselves, which stay a
  separate client-fetched concern (`useTrackedLines.ts`) for the same
  reason `watchlist` already isn't baked into cached server-computed data.
  Populated for MLB/NBA/NHL/NFL/CFB; `null` for golf (no live-game concept
  at all), soccer and tennis (both genuinely have no per-player live data
  source — verified empty during Part 1, not assumed).
- **`components/useLiveLineValues.ts`** — the live current-value lookup,
  reusing Part 1's own `/api/{sport}/game/[id]/live` routes rather than
  building a second live pipeline. MLB uses its pre-existing
  `subjectId`-keyed `liveMarketValues()` lookup directly (real dimension
  keys like `hit-in-game`/`home-runs`, not invented ones — `MLB_TRACKABLE
  _STATS` was fixed to match `STAT_MARKET_BY_DIMENSION`'s real strings
  after checking `lib/sports/mlb/adapter.ts`, not guessed). Every other
  sport matches by player display name against Part 1's own box-score
  response, the same imperfect-but-workable approach already used
  elsewhere in this codebase for name-based subject matching.
  `footballLiveGame.ts` was extended with a full `playersByTeam` box
  (passing/rushing/receiving merged per athlete) — Part 1 had only
  extracted each team's single top passer, which wasn't enough to look up
  an arbitrary tracked player.
- **`components/LiveLineTrackerCard.tsx`** — list of tracked lines with a
  live progress bar once a value exists (`—` pregame or when the sport has
  no live source yet — never fabricated), a stat/side/number "+ Track a
  line" form constrained to `availableStats`. Wired into `PlayerDetail.tsx`
  right after the matchup-explorer card, same presence-check pattern
  (`data.liveLineTracker ? <LiveLineTrackerCard .../> : null`).
- **Verified**: `npm run typecheck` clean across the full build (DB layer,
  route, all 8 sport adapters, hooks, card, `PlayerDetail.tsx`).

**One real gap, needs a human**: the `tracked_lines` migration is written
but **not applied** — the Supabase connection pool was unreachable for the
whole second half of this session (3 consecutive read-query timeouts, then
"connector's server isn't responding"; the management API itself worked
fine throughout, so this looks like connection-pool pressure, not a
project outage). Writing DDL into a pool that can't sustain a plain read
felt like the wrong risk to take unsupervised overnight, so it was left
for a deliberate follow-up instead: once the pool is healthy, apply
`supabase/migrations/20260823090000_tracked_lines.sql` (via this MCP's
`apply_migration`, `supabase db push`, or the dashboard). Until then,
`/api/tracked-lines` will 500 on `tracked_lines` not existing — an honest
failure mode, not a bug, and everything else (Part 1 in full, Part 2's
UI/adapter/hook code) is unaffected by it.

**Not verified** (same reason as Part 1): pixel-level browser rendering —
no login credentials available this session.

## What's actually true today (verified by reading the code, not assumed)

- `GameDetail.tsx` / `GameHeroCard.tsx` are **already** unified per the
  sport-adapter architecture in `CLAUDE.md` — there is no `sport === 'x'`
  branch in the render tree. Every sport's adapter produces the same
  `GameHeroCardProps`.
- But only MLB's adapter (`lib/sports/mlb/adapters/gameDetailAdapter.ts`)
  ever populates `renderLiveDetail`, which is what unlocks the
  Matchup/Live tab pair and MLB's `LiveTab` component (bases diamond,
  inning-by-inning, current pitcher/batter spotlight, full box score,
  bullpen). Every other sport's `renderLiveDetail` is `undefined`
  (`GameDetail.tsx:2196-2200`), so no tab switcher renders at all — those
  pages only ever show the pregame/final hero, never an in-game view.
- `useNbaGameDetail.ts` / `useNhlGameDetail.ts` (and, by inspection,
  soccer/CFB/tennis's equivalents) have **no live polling at all** — no
  `setInterval`, no live score refresh. MLB's `useLiveGame.ts` is the only
  hook in the codebase that polls a live game. This is the real reason MLB
  "feels separate" — it's not a styling gap, it's a data-plumbing gap.
  Confirming this before scoping matters: the UI work is the smaller half
  of this project; wiring live data per sport is the bigger half.
- Player-detail side: there is an existing `watchlist` table/route
  (`app/api/watchlist/route.ts`, `lib/db/schema.ts`) but it's
  **player-level only** — follow/unfollow a subject, no line or threshold
  attached. There is nothing today resembling "track this specific
  Over 24.5" or a live-updating tracked-line card. This is genuinely new,
  not an extension of an existing feature.

## Part 1 — Unified live/pre/post matchup card

### Design intent
One `GameHeroCard`-family component, already shared, gets a real Live tab
for every sport — not a straight port of MLB's baseball-specific UI
(bases/innings/bullpen make no sense for basketball), but the same
*visual system* (dark live band, pulse-dot status, tabbed sub-views,
spotlight cards for the player currently "in the moment") applied to each
sport's own real in-game shape. Think: one design language, six different
bodies, the same way `StatComparisonData.bars` vs `.ranked` (§4 of
CLAUDE.md's adapter doc) are visually distinct but structurally parallel.

### Proposed shape — extend the existing presence-check pattern
Follow the exact convention `StatComparisonData` already established: one
new field on the shared hero data, a small union of mutually-exclusive
per-sport payloads, each sport's adapter populates only its own slot.

```ts
// lib/sports/mlb/adapters/gameDetailAdapter.ts — canonical, like GameDetailData itself
export interface GameLiveDetailData {
  mlb?: { game: GameDetailGame; gamePk: string | number | undefined } | null;
  nfl?: NflLiveDetailData | null;      // drive, redzone, quarter score, down/distance history
  nba?: NbaLiveDetailData | null;      // quarter-by-quarter, top performers, shooting splits
  nhl?: NhlLiveDetailData | null;      // period score, power play/penalty state, shots on goal
  soccer?: SoccerLiveDetailData | null; // half score, cards/subs timeline, shot map
  cfb?: CfbLiveDetailData | null;       // same shape family as NFL, own scoring/clock rules
  tennis?: TennisLiveDetailData | null; // set/game score, break points, serve stats
}
```

`GameHeroCard`'s existing `renderLiveDetail?: (active: boolean) => ReactNode`
prop already provides the right seam — each sport's `GameDetail.tsx` call
site builds its own tab body from its own slot, exactly like MLB's
`LiveTab` is built today (`GameDetail.tsx:2196-2200`). No change needed to
`GameHeroCardProps` itself. The new work is (a) a `LiveTab`-equivalent
component per sport reusing the shared visual primitives already in
`GameHeroCard.tsx` (`LiveCenterStatus`, spotlight-card pattern, pulse dot,
sub-tab bar) generalized to accept sport-agnostic props instead of MLB
literals, and (b) the missing live-polling hook per sport.

### Data audit — verified live against the real APIs, not guessed

Every non-MLB sport turned out **more feasible than the first pass of this
doc assumed**. Checked by actually curling each provider's real endpoint
(not reading docs, not trusting memory) and inspecting the JSON shape:

| Sport | Endpoint hit | Verified against | What's actually in the response |
|---|---|---|---|
| **NBA** | `site.api.espn.com/.../nba/summary?event=` (already called by `nba/espn.ts`'s `fetchGameSummary`, today only parsed for score+odds) | a completed June 2026 Finals game | `boxscore.players[]` (full per-player stat lines), `plays[]` (508 events, each with `period`+`awayScore`/`homeScore` → quarter score strip is a straight derivation), `leaders[]`, `winprobability` |
| **NHL** | NHL's own `api-web.nhle.com/v1/gamecenter/{id}/boxscore` — **already wired** in `nhle.ts`'s `fetchBoxscore()`, currently cached 6h (too long for live polling, fine for post-game) | live in this codebase already, shape confirmed by reading the parser | skaters + goalies per team (goals/assists/shots/hits/blocked shots/saves), home/away score, `gameState` |
| **CFB** (and by the same ESPN family, NFL) | `site.api.espn.com/.../college-football/summary?event=` | a completed Jan 2026 bowl game | `drives.previous[]` (18 drives, each with plays — a live game additionally carries `drives.current`), `scoringPlays[]`, full `boxscore.teams`/`.players`. NFL already has a *partial* live strip today (`lib/sports/nfl/liveGameState.ts`'s `situation.down/distance/yardLine/possession/isRedZone` — this is what feeds `renderLiveExtra`'s single line under the score) but nothing box-score-deep yet. |
| **Soccer** | `site.api.espn.com/.../eng.1/summary?event=` | a completed EPL match | `keyEvents[]` (goals/cards/subs/kickoff — exactly the card/sub timeline this doc proposed), `commentary[]`, `boxscore.teams` |
| **Tennis** | `site.api.espn.com/.../tennis/atp/scoreboard` | live ATP matches on the board right now | `competitors[].linescores[]` — real per-set score including tiebreak, right on the scoreboard response `espnTennis.ts` already fetches (just not parsed into `EspnTennisMatch` yet) |

**Revised conclusion**: there is no sport here that's a real data-availability
blocker. Every sport's live/in-progress detail is available from a source
already partially wired into this codebase (either already fetched for a
different purpose — NBA's odds, NFL's down/distance strip — or, for NHL,
already fully parsed and just needs a shorter live-polling TTL instead of
a new integration). The work is genuinely "add a parser + a live-polling
hook + a UI body" per sport, not "find/build a new data pipeline" — much
cheaper than the original per-sport guesswork below assumed.

### The real work, per sport (now that data is a checkbox, not a question mark)
1. **Live polling hook per sport** (`useNbaLiveGame`, `useNhlLiveGame`,
   `useCfbLiveGame`, `useSoccerLiveGame`, `useTennisLiveGame`, mirroring
   `useLiveGame.ts`'s interval/active-gating pattern — poll only while the
   Live tab is active and the game is actually `'in'`). NHL's is closest
   to free (swap `fetchBoxscore`'s 6h TTL for a live variant); the rest
   are a new thin fetcher hitting the summary endpoint already confirmed
   above.
2. **A parser per sport** turning that endpoint's real shape into a small
   sport-specific live-detail type (`NbaLiveDetailData`, etc.) — pulling
   the specific fields out of the much larger raw response (ESPN's summary
   payload has 15-19 top-level keys; each sport's parser only needs 2-4 of
   them).
3. **Shared visual primitives extracted from `GameHeroCard.tsx`** into
   sport-agnostic pieces: the dark live band + pulse status, a generic
   "spotlight" card (currently `CurrentPitcherSpotlight`/
   `CurrentBatterSpotlight`, hardcoded to MLB fields) generalized to
   `LiveSpotlightCard({ role, name, teamAbbr, headshotUrl, statLine })`,
   a generic period/inning/quarter strip generalized from `InningStrip`.
4. **Per-sport live body**: NFL/CFB (down/distance/redzone from the
   existing strip, extended with drive summary + scoring-play timeline
   instead of innings), NBA (quarter score strip derived from `plays[]`,
   top-performer spotlights instead of pitcher/batter, box score from
   `boxscore.players`), NHL (period strip, skater/goalie box from the
   already-parsed `fetchBoxscore`), Soccer (half score, `keyEvents` timeline
   for cards/subs/goals, team box score), Tennis (set/game score ladder
   straight from `linescores`, serve stats from `statistics` once confirmed).

### Recommended sequencing
Do NOT build all six at once. Recommend: (1) build the generalized shared
primitives + the `GameLiveDetailData` seam against MLB's *existing* data
(pure refactor, verifies the abstraction holds, zero new data risk), then
(2) **NHL second** — it has the least new plumbing (box-score parsing
already exists, just needs the live-polling TTL swap), so it's the
cheapest real proof that the pattern generalizes beyond MLB. Then (3) NBA
and Soccer (both one new parser away, endpoints already confirmed), then
(4) NFL/CFB together (share the same ESPN family + NFL already has a head
start via `liveGameState.ts`), then (5) Tennis last (structurally the most
different — no innings/quarters, a set/game ladder instead).

## Part 2 — Player-detail live line tracker card

### What "track a line" needs to mean (this needs a decision, see below)
Two distinct capabilities are bundled in the request and should be
designed as one card but two data sources:
- **Auto-tracked lines**: the real prop lines this app already has for
  that player (from `prop_odds` / the props pipeline) — surfacing their
  live current-value-vs-line delta as the game progresses, e.g. "Judge O1.5
  hits — currently 1, needs 1 more."
- **User-defined manual lines**: a line that doesn't necessarily exist in
  the real odds data at all — the user types "Over 27.5 points" for a
  player and the app just tracks the live stat against that number,
  independent of any sportsbook line.

### Proposed shape
1. **New table**, sibling to `watchlist`, not a repurposing of it —
   watchlist is "follow this subject," this is "track this
   subject+stat+threshold." Something like:
   ```sql
   CREATE TABLE tracked_lines (
     id, user_id, sport, subject_id, subject_name,
     stat_key,        -- e.g. 'hits', 'points', 'shots_on_goal' — sport's own stat vocabulary
     side,            -- 'over' | 'under'
     line NUMERIC,    -- user-entered or copied from a real prop_odds line at add-time
     source,          -- 'manual' | 'prop_odds' — which of the two above this is
     created_at
   );
   ```
   Auth/RLS pattern: copy `watchlist`'s existing Supabase RLS migration
   directly (`supabase/migrations/20260822171000_rls_on_user_owned_tables.sql`)
   — same per-user-row-ownership shape, so this is not new design work,
   just a new table under an already-proven policy.
2. **API routes**: `app/api/tracked-lines/route.ts` (GET/POST/DELETE),
   same shape as `app/api/watchlist/route.ts` almost verbatim.
3. **`PlayerDetailData` gets one new field** (per CLAUDE.md §1/§4 — declared
   once in MLB's adapter file, every sport's adapter imports the type,
   populates it identically since "a player's live current stat value"
   is genuinely the same shape everywhere, unlike the hero card's
   sport-specific live detail):
   ```ts
   liveLineTracker: {
     trackedLines: Array<{
       id: string; statKey: string; statLabel: string; side: 'over' | 'under';
       line: number; liveValue: number | null; // null when game hasn't started / no live feed
       source: 'manual' | 'prop_odds';
     }>;
     availableStats: Array<{ key: string; label: string }>; // what this sport/player can be tracked on, for the "add a line" picker
   } | null;
   ```
4. **The live-value half of this depends entirely on Part 1's per-sport
   live-polling hooks** — a tracked "points" line for an NBA player can't
   show a live current value until `useNbaLiveGame` (Part 1, item 1)
   exists. This is the real dependency between the two halves of this
   request: the line-tracker card is mostly inert (shows the line, no
   live delta) for any sport before its live hook is built. Recommend
   building the tracker's CRUD/UI shell first (useful immediately for
   pregame — "line set, game hasn't started"), then it lights up live as
   each sport's Part 1 hook lands.
5. **Card UI**: a new shared card, e.g. `LiveLineTrackerCard.tsx`,
   mounted in `PlayerDetail.tsx` alongside the other shared cards
   (`WindowBox`/`DistributionChart` neighbors) — list of tracked lines
   with a live progress bar toward the threshold when a live value
   exists, an inline "+ Track a line" affordance (stat picker + number
   input + over/under toggle) that POSTs to the new route.

## Decisions made (2026-08-23)

1. **Build order**: Part 1 (live matchup card) first — Part 2's live
   values depend on Part 1's per-sport hooks anyway. Sequence: MLB
   refactor → NHL → NBA/Soccer → NFL/CFB → Tennis (see "Recommended
   sequencing" above).
2. **Data audit**: done, see the verified table above — every sport is
   feasible off data already reachable from providers the codebase
   already talks to.
3. **Manual lines** (Part 2): constrained to known stat keys the app can
   already compute a live value for, not free-text — every tracked line
   is guaranteed to eventually show a live delta once that sport's Part 1
   hook lands, rather than silently staying dead for a stat the app has
   no way to compute.

## Still open

- Exact `stat_key` vocabulary per sport for the manual-line picker
  (Part 2, decision 3) — needs to be enumerated per sport once each
  sport's live parser (Part 1) defines what stats it actually surfaces,
  since the tracker can only offer stats it can compute.
