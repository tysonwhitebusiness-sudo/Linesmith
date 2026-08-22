# Soccer — Full Gameplan (all leagues)

Planning pass before writing any code. **Supersedes `docs/soccer-gameplan-2026-08-21.md`'s scope decision.**
That doc deliberately scoped soccer down to EPL + MLS only ("La Liga/Serie A/Bundesliga/Ligue 1 are dropped
from this plan entirely, not deferred"). The user reversed that today: soccer now covers **all leagues**, with
a league switcher on the page — Linesmith's first sport with more than one competition. This doc carries
forward everything from the 08-21 doc that's still true (architecture principle, scaffolding shape, card-field
designs), generalizes it from "EPL and MLS separately" to "any league, parameterized," and adds what this
session live-verified that the 08-21 doc had marked as open/unconfirmed.

Scope for this pass: **Scan, Player Detail, Team Detail (+ Teams list), Game Detail** — the same four
surfaces every other sport has. Golf is the one sport that doesn't have all four (no team concept); soccer
does, structurally closer to NFL than to golf.

**Explicitly deferred, by the user's own confirmed sequencing decision, not a soccer-specific gap:**
predictive/edge models (NFL, CFB, Soccer, and Tennis models are one batched project, built together *after*
every sport's pages are done — only MLB and goll have real models today) and cross-sport bet grading
(`betGrading.ts` is MLB-only for every sport, not just soccer). Neither blocks anything below. Every field
that depends on a model (`hero.model`, `EdgeBadge`, pick-lock panel) stays `null` for soccer, the same way it
already does for NFL and CFB today — not a new gap, matching precedent.

---

## 1. Non-negotiable architecture principle (carried forward from 08-21, still true)

**`python-odds-service/` is the only place new gambling-odds acquisition code gets written, full stop.**
That's the whole point of the Python-worker buildout — it's the sole owner of new provider integration,
replacing the old TS scheduler's odds-provider jobs. Golf is the one already-decided, closed exception
(TypeScript, permanently — `docs/phase2-hardening-gameplan-2026-08-20.md`), not a precedent for soccer. Any TS
odds file referenced anywhere in this doc (`lib/odds/oddsApi.ts`, `lib/odds/nflGameLines.ts`,
`lib/odds/merge.ts`) is cited **only as a reference for shape/markets/league-ids a vendor returns** — never as
a place to add live soccer fetch code. New soccer provider work is always a `ProviderSpec` in
`python-odds-service/src/{providers.py,jobs.py}`, run through `job_runner.run_provider_specs`.

---

## 2. What's live-verified this session (resolves several of 08-21's open items)

| 08-21 doc said | This session confirmed live |
|---|---|
| "Live-test SportsGameOdds for an MLS game/league id — highest-leverage unknown" | **Done.** `GET /v2/leagues` (real key) returns exactly 2 soccer leagues: `MLS` and `UEFA_CHAMPIONS_LEAGUE`, nothing else. Pulled a real MLS event: 1,740 total odds entries — 1,580 player-prop, **160 real game-level markets** (3-way moneyline, spread, total, odd/even goals) sitting right there, unused. `fetch_sportsgameodds` in `providers.py` currently discards every one of the 160 with `if not player_id: continue` — for every sport it touches, not just soccer. This is a real, live, confirmed data source, not a lead to spike anymore. |
| "EPL has no game-line provider at all" | Still true for the *existing player-props pipeline* (Propline/ParlayAPI are prop-only for EPL) — **but** ESPN's free public summary endpoint (`site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event={id}`) already embeds a single-book (DraftKings) moneyline/spread/total line on every match, confirmed live on a real EPL game today. Not multi-book, not player props, but real, free, zero-new-key. |
| "No confirmed live in-game feed" | Resolved. Same ESPN summary endpoint returns `keyEvents` (real minute-stamped goal/card/kickoff entries), a live `commentary` text feed, and a rich `boxscore` (possession%, shots, passes, tackles, corners, cards) once a match is `state: 'in'`. This is the exact same endpoint family `lib/sports/nfl/liveGameState.ts` already uses for NFL's live hero-card state and `lib/sports/golf/espn.ts` uses for golf's leaderboard — proven pattern, not a new integration. |
| "Only EPL and MLS have real odds coverage; La Liga/Serie A/etc. dropped, not deferred" | **Reversed by the user today.** Live-pulled real current data (not just catalog listings) for 8 leagues via ParlayAPI/Propline: MLS (1,852 ParlayAPI rows, 33 Propline events), Serie A (1,537 rows), EPL (1,070 rows), La Liga (1,051 rows), Championship (246), Ligue 1 (235), Bundesliga (171), Champions League (0 rows this exact date — off-cycle, 7 real Propline events). All real, current, not speculative. `soccer_epl` was simply the only league anyone had configured — the provider catalogs (28 leagues in Propline's, 55 in ParlayAPI's) go far wider. |
| "MLS season stats — no confirmed source, American Soccer Analysis is an unverified lead" | **Still open, not resolved this session.** Understat (via `soccerdata`) is confirmed big-5-only — MLS/UCL/every other non-big-5 league needs its own source. ASA remains an unverified lead; nothing new to report. |
| — (not discussed in 08-21) | `soccerdata` (the GitHub package) is confirmed a stats-only scraper, zero odds capability, 3 of 8 sources need a real headless Chrome instance (FBref/WhoScored/SoFIFA) — recommend leaning on it for Understat only, and on ESPN for schedule/live/roster/logos across every league, rather than the Selenium-based sources. |

---

## 3. Backend: from "one EPL job" to "N-league soccer job(s)"

Current state (`python-odds-service/src/jobs.py`): `job_soccer_epl` calls `_soccer_epl_specs()`, a hardcoded
2-item list (`propline_2` + `parlayapi_soccer`, both hardcoded to the sport key `"soccer_epl"`). The
per-provider sport-key dicts this reads from (`_PROPLINE_SPORT_KEYS`, `_PARLAYAPI_SPORT_KEYS` in
`providers.py`) already support a generic `sport: str` parameter — extending them is genuinely config, not new
mechanism, matching CLAUDE.md's own "adding a new sport is a `ProviderSpec`, not a new job function" rule.

**Plan:**
1. Widen `_PROPLINE_SPORT_KEYS`/`_PARLAYAPI_SPORT_KEYS` with one entry per league in scope (`soccer_la_liga`,
   `soccer_serie_a`, `soccer_bundesliga`, `soccer_ligue_1`, `soccer_mls`, `soccer_uefa_champions_league`, etc.)
   — mind the naming mismatch between vendors confirmed this session (Propline: `soccer_bundesliga` vs
   ParlayAPI: `soccer_germany_bundesliga`; Propline: `soccer_mls` vs ParlayAPI: `soccer_usa_mls`) — this needs
   a per-vendor lookup table, not one shared key string across both.
2. Add a `SportsGameOdds` `ProviderSpec` for MLS and Champions League specifically — the only two leagues it
   covers, confirmed live (§2). This is the one league-pair that gets real game-level markets (moneyline/
   spread/total/odd-even) **if** the pipeline is extended to stop discarding them (§5).
3. Replace `job_soccer_epl` with a league-parameterized job (or one job iterating a `SOCCER_LEAGUES` list) —
   not N nearly-identical copy-pasted job functions.
4. **Real budget flag, not a formality**: going from 1 league to 8+ multiplies request volume against
   ParlayAPI's and Propline's soccer-dedicated keys' shared monthly/daily caps. The existing precedent
   (`docs/api-capability-audit-2026-08-20.md`) is "a key per sport" — decide whether soccer gets one key
   shared across all leagues (caps hit faster, real risk) or a key per league (matches the established
   pattern, needs new free-tier accounts sourced the same way `PARLAYAPI_NFL_KEY`/`PARLAYAPI_CFB_KEY` were).
   Not a blocker to scaffolding, but a real decision before the job goes live in production.
5. `JOB_REGISTRY` gets the new job name(s); `health_check.py` needs zero changes (it reads the registry
   generically, per its own design).

---

## 4. Market-key + data-model work needed for game-level odds (real, not a one-line fix)

Confirmed this session, still true, and the single biggest piece of real engineering in this whole plan if
game-level odds (moneyline/spread/total) are wanted for launch rather than deferred:

1. **`entity_resolution.py`'s `MARKET_KEY_ALIASES` has zero game-level soccer keys.** All 14 existing soccer
   entries are player props (`anytime_goal_scorer`, `first_goal_scorer`, `assists`, `shots`, `tackles`, etc.).
   `h2h`, `spreads`, `totals`, `draw_no_bet`, `double_chance`, `correct_score`, `both_teams_to_score`,
   `team_corners`/`total_corners`, `team_cards`/`total_cards` (all confirmed live from Propline's own market
   catalog for EPL and La Liga) need new entries before any of them resolve to anything but "unresolved
   market."
2. **`PropOddsInput`/`prop_odds` is player-shaped by schema** (`subject_id`/`subject_name` assumes a player).
   A team-level moneyline/spread/total row doesn't fit this table's model. This needs a real decision: extend
   the schema to allow a team as `subject_id` (breaks the "subject = player" assumption everywhere downstream
   reads this table), or give game-level soccer odds their own table/path entirely (mirroring how MLB's
   moneyline/total already lives in a *separate* table, `game_odds_history`, not `prop_odds`).
3. **The existing `game_odds_history` table doesn't fit soccer even if reused** — its `side` column is
   schema-constrained to `'home'|'away'` (moneyline) / `'over'|'under'` (total), with no way to represent a
   draw at all, and no spread column (never needed it before soccer). Extending this table is itself real,
   scoped work — not a place to bolt soccer on casually.
4. **Recommended v1 path, given 1–3 above**: skip building a full multi-book game-level odds pipeline for
   launch. Use ESPN's free embedded single-book line (§2) for `hero.pregameLines` display — real, live,
   zero new schema, zero new market-key work. Revisit the full multi-book pipeline (points 1–3) as a real,
   separate follow-on project once the page itself is live, the same way NFL/CFB haven't built one either.

---

## 5. Data sourcing, by need

| Need | Source | Status |
|---|---|---|
| Schedule, rosters, boxscore, lineups, live state, single-book odds line, team/player logos | **ESPN public API** (`site.api.espn.com/apis/site/v2/sports/soccer/{league}/...`) | Live, proven pattern (same family already used by NFL's `liveGameState.ts` and golf's `espn.ts`). Confirmed live slugs this session: `eng.1` (EPL), `usa.1` (MLS), `uefa.champions` (UCL); every other league follows the same `{country}.{level}` or named-competition slug convention — confirm each one at build time, not assumed |
| Player props (all leagues) | Propline + ParlayAPI, extended per §3 | Real data confirmed live for 8 leagues this session |
| Game-level odds (MLS + UCL only) | SportsGameOdds | Real data confirmed live this session (§2) — blocked on §4's pipeline work to actually surface it as multi-book data; ESPN's single-book line is the pragmatic v1 stand-in |
| Season stats / advanced metrics (big-5 leagues: EPL, La Liga, Serie A, Bundesliga, Ligue 1) | Understat, via `soccerdata`'s plain-HTTP wrapper | Confirmed real, shot/xG-centric (goals, xG, assists, xA, shots, key passes, cards) — no tackles/interceptions/possession%, that gap needs FBref (Selenium, deliberately deferred, per 08-21's doc) |
| Season stats (MLS, UCL, every non-big-5 league) | **Open — no confirmed source.** American Soccer Analysis is an unverified lead for MLS specifically (carried over from 08-21, still unspiked) | Real gap. These leagues can ship with props/schedule/live data but no season-stats card until a source is found, same posture 08-21's doc already accepted for MLS |
| Standings | **Open — needs a source check.** ESPN likely has a standings endpoint per league (untested this session); soccerdata's Sofascore module also has `read_league_table` | Not yet verified which is more reliable/complete; check both before picking one |

---

## 6. Page-by-page plan

### 6a. Scaffolding (do first, blocks nothing else)

1. Widen `Sport`/`SPORTS` in `lib/core/types.ts` — add `'soccer'`, `SPORT_LABEL['soccer']`.
2. `TopBar.tsx` — add soccer to the sport switcher; Teams tab on (soccer has teams); Schedule tab off
   (golf-only); **add a league switcher**, visible only when `sport === 'soccer'` — this is the net-new UI
   concept relative to every other sport, since soccer is the first one with more than one competition.
3. Route tree: `app/soccer/[league]/{page.tsx, loading.tsx, player/[playerId]/, team/[teamId]/, teams/}` —
   same shape as `app/nfl/`, one level deeper for the league segment. `league` should be a real closed union
   (one member per league actually wired up), not an open string — a new league is a deliberate addition to
   the type, not silently possible by typo.
4. `lib/sports/soccer/adapters/{playerDetailAdapter,teamDetailAdapter,gameDetailAdapter,statRowAdapter}.ts` —
   one adapter set, `league` is a runtime parameter threaded through, not one adapter file per league. Soccer
   gets all three Detail adapters (unlike golf, which only has `playerDetailAdapter.ts`) — structurally closer
   to NFL.
5. `app/api/soccer/**` routes — follow `cachedRoute()` per CLAUDE.md's caching convention, `league` as a query
   param or route segment feeding the cache key (grep for `soccer` in existing cache keys first, per
   CLAUDE.md's own warning about key collisions, before picking one).

### 6b. Scan

Reuses `ScanTable.tsx`/`ScanCard.tsx` directly — already sport-agnostic, no soccer-specific work needed in the
component itself. The only new piece is the league switcher/filter feeding which league's candidates render —
same mechanism as the sport switcher already does, one level down.

### 6c. Teams (list) + Team Detail

- **Teams list**: per CLAUDE.md rule 3's accepted exception (two sibling wrapper components at one call
  site, matching `MlbTeamDetailPanel`/`NflTeamDetailPanelBody` in `TeamDetailPanel.tsx`), soccer likely needs
  its own `useAllSoccerTeams`-style hook (league-scoped team list) rather than reusing `useAllTeams`/
  `useAllNflTeams` directly, since the list is now league-dependent, not sport-wide.
- **`TeamDetailData` mapping** (carrying forward 08-21's card-field plan, generalized from EPL/MLS to any
  league):
  - `matchup` tabs `[team, player]` — team: attack vs opponent defense (xG for vs xGA); player: top scorer/
    creator vs opponent's defensive record. Same shape NFL already uses.
  - `statGroups`: Attacking / Defending / Discipline / Set Pieces, ranked out of that league's real club
    count (`poolSize` varies per league — confirm each league's real count at build time, it isn't always 20).
  - `recentResults`: already generic (W/D/L needs a draw case added to whatever currently assumes W/L only —
    check `RecentResultRow`'s `win: boolean | null` — `null` already means "tie/unresolved" per
    `docs/sport-adapter-design.md`, so this may already just work for a draw with zero adapter change).
  - `roster`: same as NFL — sorted has-stats-first, paginated. ESPN roster data, per-league.
  - **Standings — real gap, not a drop-in.** `StandingsTables.tsx` is confirmed hardcoded to a pure
    wins/losses/win-pct shape (`winPct(wins, losses)`, no ties/draws field, no points column, no goal
    difference). Soccer's points-based table (3/1/0, draws are common not an edge case, GD matters) needs
    real extension to this component — a `draws`/`points`/`goalDifference` column set, not force-fit into
    the existing win-loss shape. Do this as a genuine additive change (new optional columns), not a fork.

### 6d. Player Detail

Carrying forward 08-21's field-level plan, generalized to any league:

- Hero header, market tabs, line stepper, filter chips: universal, unify directly (already proven pattern).
- `windows` (l5/l10/l15/h2h/szn): buildable now from ESPN schedule/results + prop history, per league.
- `matchups` (the `BatterPitcherMatchupCard` analog): **"Attacker vs Opponent Defense"** two-sided card —
  shots-on-target%, xG/90, conversion rate, big chances created vs opponent xGA/90 and clean-sheet%, where
  Understat data exists (big-5 leagues); a lighter solo-stats version elsewhere. A separate goalkeeper-specific
  variant (save%, PSxG−GA, clean sheets) follows the same slot-split pattern MLB uses for hitter vs pitcher.
- `chart`: goals or shots-on-target distribution per match, buildable now from prop/result history.
- `propOddsBoard`: already fully sport-agnostic, works today for every market key that's actually resolved
  (§4) — real markets today are limited to the 14 player-prop keys already mapped.
- Season-stats card: populated only where Understat covers the league (big-5); `null` elsewhere until a
  source is found (§5), same "real optional field, not fabricated" pattern CLAUDE.md's rule 2 requires.

### 6e. Game Detail

- `hero` team panels, market tabs, line stepper: universal, direct reuse.
- `hero.pregameLines`: ESPN's free embedded single-book line for v1 (§4's recommendation) — real data,
  no new pipeline. `null` where ESPN doesn't have odds for a given match (uncommon but possible).
- `hero.model` / pick-lock panel / `EdgeBadge`: `null` for soccer, matching NFL/CFB precedent exactly — this
  is expected, deferred by the user's own confirmed sequencing (§0), not a bug to fix now.
- League-table strip: position, points, GD, last-5 form string — genuinely new field, no other sport has this
  shape (golf has no bracket, NFL/MLB seeding isn't shown per-game) — its own named field, not forced into an
  existing one, per CLAUDE.md rule 4. Needs the same standings source as §6c.
- `renderLiveDetail`: build from ESPN's `keyEvents`/`commentary`/`boxscore` (§2) — real, live, proven pattern.
- `statComparison.ranked`: grouped Attacking/Defending/Discipline, per-league `poolSize`.
- `unitGrades`: Attack/Defense/Set-Pieces grades, the NFL OFF/DEF/ST analog.

---

## 7. Decisions locked in (2026-08-22) — approved, ready to build in a new session

The user reviewed this doc's open items (cross-referenced against `docs/soccer-gameplan-2026-08-21.md`'s
original checklist, which covered EPL + MLS specifically) and gave explicit answers. **The rest of this
document stands as approved.** Nothing has been built yet — this session stayed gameplan-only throughout;
building starts in a new session, against this doc.

1. **SportsGameOdds live-test for MLS — resolved, not just decided.** §2's table already has the actual
   result: real key, `GET /v2/leagues` confirms exactly `MLS` + `UEFA_CHAMPIONS_LEAGUE` as SGO's soccer
   coverage, and a real MLS event pull returned 1,740 total odds entries (1,580 player-prop, 160 game-level:
   3-way moneyline, spread, total, odd/even). A future build session should treat this as ground truth, not
   re-spike it — the remaining work is wiring it in (§9 below), not re-verifying it exists.
2. **American Soccer Analysis spike for MLS/non-big-5 season stats** — user says use best judgment. Still
   genuinely unverified; a build session should actually spike the public API before committing to it as MLS's
   stats source, same as this doc's §5 already flags.
3. **Build `lib/sports/soccer/understat.ts` for EPL — approved to build.** Port `getLeagueData/EPL/{season}`
   (+ cookie-priming request per §5), shape into per-team/per-player season aggregates, in-app ranking,
   `poolSize: 20`.
4. **FBref / any headless-browser scraping — explicitly rejected.** No Selenium/headless-Chrome work of any
   kind for this project, for any league. This forecloses the "add FBref for tackles/interceptions/possession/
   clean sheets" idea permanently for this pass, not just deferred — Understat's shot/xG-centric coverage is
   what EPL gets, full stop, until a non-Selenium source for the rest shows up.
5. **EPL match-level line vendor — "pick the vendor with the best odds."** Given what's actually
   available: no existing paid provider (Propline, ParlayAPI, SharpAPI, Odds-API.io) carries EPL game-level
   markets — confirmed repeatedly this session — and SportsGameOdds explicitly excludes EPL from its
   soccer coverage (item 1 above). The only real, live, working source for an EPL moneyline/spread/total line
   is **ESPN's free embedded single-book (DraftKings) line** (§2/§4) — not a compromise pick among several
   real options, the only one that exists today. Recommend a build session use this for EPL's
   `hero.pregameLines` unless the user sources a dedicated game-line provider for EPL specifically before
   then.
6. **`usa.1` (MLS) config in `teamSportEspn.ts` — approved to build.** Low-risk, config-only per §5/§6a.
7. **Standings — decided: ESPN.** Use ESPN's standings endpoint (needs confirming the exact path per league
   at build time — not yet verified which endpoint shape ESPN exposes for soccer standings), not
   Sofascore/`soccerdata`.
8. **Entity resolution parity with MLB/NFL — use best judgment.** `entity_resolution.py`'s `resolve_player`/
   `build_roster_index` are already fully generic (take any roster list, no sport-specific logic) — the
   working assumption for a build session is that no new resolution mechanism is needed, only confirming
   real soccer rosters flow into `Game.roster` correctly for both EPL (already live) and MLS (once §9's
   `game_context.py` config lands) — treat this as a verification step during build, not a new subsystem to
   design.

---

## 8. Scope note for the next session: EPL + MLS, not yet the full "all leagues" list

The decisions above (and the checklist they answer) only ever reference EPL and MLS by name — matching
`docs/soccer-gameplan-2026-08-21.md`'s original two-league scope, not this doc's broader "all leagues" framing
from earlier in the day. Build EPL + MLS first, against this doc's page-by-page plan (§6) and architecture
(§1/§3/§4), using the closed `league: 'epl' | 'mls'` union `docs/soccer-gameplan-2026-08-21.md` originally
specified. Treat the wider league list (§2's table — La Liga, Serie A, Bundesliga, Ligue 1, Championship,
Champions League) as real, live-verified, and ready to add later the same way, not as part of this build pass
unless the user says otherwise when picking this doc back up.

---

## 9. Concrete build checklist for the next session (backend first, then frontend)

Derived from §3/§5/§6a plus the decisions in §7 — this is the actual sequence, not a re-statement of the
architecture discussion above it.

**Backend (`python-odds-service/`):**
- `providers.py`: add `soccer_mls` entries to `_PROPLINE_SPORT_KEYS` (Propline's own key: `soccer_mls`,
  confirmed live) and `_PARLAYAPI_SPORT_KEYS` (ParlayAPI's key: `soccer_usa_mls`, confirmed live — different
  string than Propline's, mind the mismatch per §3.1). Reuse the existing `PROPLINE_2_KEY`/
  `PARLAYAPI_SOCCER_KEY` identities for MLS rather than provisioning new ones (no new keys exist yet) — flag
  to the user that this shares EPL's existing budget/cap rather than getting its own, per §3.4's open flag.
- `providers.py`: add `"soccer_mls": "MLS"` to `_SGO_LEAGUE_IDS` (confirmed real league ID string). Verify
  `_sgo_team_id`'s slug-construction convention actually matches real MLS team IDs in a live SGO response
  before trusting it silently — do not assume the NFL/CFB naming convention carries over unchecked.
- `game_context.py`: add `"soccer_mls": ("soccer", "usa.1")` to `_ESPN_SPORT_CONFIG`.
- `jobs.py`: generalize `job_soccer_epl` into a league-parameterized job (or add a sibling `job_soccer_mls`),
  add the `SportsGameOdds` `ProviderSpec` for MLS specifically (the one league-pair where it has real
  coverage), register in `JOB_REGISTRY`.
- Confirm entity resolution per §7.8 — verification step, not new code, unless the MLS roster check turns up
  a real gap.

**Frontend:**
- `lib/core/types.ts`: add `'soccer'` to `Sport`, `SPORT_LABEL['soccer']`.
- `lib/sports/multiSport/teamSportEspn.ts`: add `usa.1` (MLS) league config.
- `lib/sports/soccer/understat.ts`: EPL season stats per §7.3.
- `TopBar.tsx`: soccer switcher entry, league picker (`epl`/`mls`), Teams on, Schedule off.
- Route tree: `app/soccer/[league]/{page.tsx, loading.tsx, player/[playerId]/, team/[teamId]/, teams/}`.
- `lib/sports/soccer/adapters/{playerDetailAdapter,teamDetailAdapter,gameDetailAdapter,statRowAdapter}.ts`
  per §6's page-by-page field plan.
- `app/api/soccer/**` routes, `cachedRoute()` pattern, grep existing cache keys first per CLAUDE.md's
  collision warning.
- Standings: extend `StandingsTables.tsx` with draws/points/goal-difference columns (additive/optional,
  confirm no other sport's rendering changes) per §6c/§7.7.
- Wire `ScanTable`/`ScanCard` for soccer — no component change expected, just the league-filter plumbing.

---

## 10. Build status (2026-08-22, same-day build session)

Contrary to this doc's original closing line, building started the same day, against this doc, once the
four-feature build (loading screens/auth/admin center/DeepSeek monitor — see
`docs/four-feature-gameplan-2026-08-22.md`) finished and was verified. Scope followed §8's final decision:
EPL + MLS only, not the wider league list.

**Done and verified:**
- Backend (`python-odds-service/`): `soccer_mls` wired into Propline/ParlayAPI's per-vendor sport-key maps
  (different strings per vendor, confirmed live per §3/§9 — Propline `soccer_mls`, ParlayAPI
  `soccer_usa_mls`), `"soccer_mls": "MLS"` in `_SGO_LEAGUE_IDS`, ESPN's `usa.1` league config in
  `game_context.py`. `job_soccer_mls` is a new sibling to `job_soccer_epl` (not a refactor of it), with a
  real SportsGameOdds spec EPL doesn't get (SGO's soccer coverage is MLS/UCL specifically, per §2).
  MLS's Propline/ParlayAPI specs reuse EPL's existing keys/provider_ids (no dedicated MLS account exists) —
  a real, flagged budget-sharing consequence, not silently absorbed. Registered in `JOB_REGISTRY`.
  Verified live: `load_sport_games('soccer_mls')` returns 29 real upcoming games with full, correctly-shaped
  rosters (real players, positions, headshots) against real ESPN data. Paid-provider specs weren't
  live-tested (would spend real API credits on a manual check) — they copy EPL's already-proven shape with
  only the sport-key strings changed.
- Frontend scaffolding: `Sport`/`SoccerLeague` types (`lib/core/types.ts`), `SportKey` widened
  (`lib/odds/props/types.ts`), `multiSportGameContext.ts`'s `SPORT_CONFIG`/odds-context snapshot widened for
  `soccer_mls`, `TopBar.tsx`'s league switcher (visible only for soccer — the first sport with more than one
  competition), `/soccer` (redirects to `/soccer/epl`) and `/soccer/[league]` route tree.
- **Scan — fully working for EPL, scaffolded for MLS.** `lib/sports/soccer/adapter.ts`'s
  `buildSoccerSnapshot(league)` builds `PickCandidate`s directly from real `prop_odds` rows rather than a
  per-match history engine like MLB/NFL use — there's no real per-match stat history source for soccer today
  (Understat is season-aggregate/big-5-only, MLS has no confirmed source at all, both real gaps §5 already
  accepts). Every candidate starts `history: []`, the engine's existing honest "insufficient" state, not a
  placeholder for missing code. Binary propositions (anytime-goalscorer, 2+ goals — Propline sends
  `line: null` for these) get `category: 'yes'`, `line: 0.5` rather than a forced over/under shape.
  `AppShell.tsx`'s Home Runs/Good Bets tab-visibility logic was an exclusion list keyed to specific sports
  (golf, nfl) — a real bug caught in raw SSR HTML before shipping: soccer fell through to showing MLB's
  home-run model tab and an uncalibrated Good Bets score. Fixed the same way NFL already had to (default to
  All, hide both tabs). **Verified live**: `GET /api/soccer/epl` → 1,111 real candidates, 390 real players,
  14 real games (Bruno Fernandes, real Man Utd/Hull City matchup, real prices), zero warnings. `GET
  /api/soccer/mls` → 29 real games, 0 candidates (correct — no props job has run for MLS yet, graceful empty
  state, not an error). `npm run build` succeeds cleanly.

**Not built — genuinely large remaining scope, comparable to what full MLB/NFL page support took:**
- Teams list + Team Detail, Player Detail, Game Detail — all still 404 for soccer. Clicking into a player
  or game from Scan will not work yet. This is the single biggest thing to pick up next; §6's page-by-page
  field plan and §9's frontend checklist are both still the right reference, unchanged by anything above.
- `lib/sports/soccer/adapters/{playerDetailAdapter,teamDetailAdapter,gameDetailAdapter,statRowAdapter}.ts` —
  none written yet. `PlayerDetailData`/`TeamDetailData`/`GameDetailData`'s canonical shapes (declared in
  MLB's adapter files, per CLAUDE.md's sport-adapter convention) are large and most of NFL's own richness
  (windowed stats, matchup cards, grades) depends on infrastructure soccer doesn't have (no history source,
  no grading model) — building these properly means deciding, field by field, which slots stay `null` for
  soccer (most of them, honestly) rather than copying NFL's shape wholesale.
- `lib/sports/multiSport/teamSportEspn.ts`'s `fetchScoreboard`/`fetchTeamRoster` already work for MLS
  (proven by the live `load_sport_games` test above, same ESPN shape) — the missing piece is a
  `lib/sports/soccer/espn.ts` wrapper for standings/live-state/single-book-line the way `lib/sports/nfl/espn.ts`
  wraps the same shared module for NFL's own needs (§6e/§7.7's ESPN-standings decision).
- `lib/sports/soccer/understat.ts` (EPL season stats, §7.3) — not started.
- Standings extension to `StandingsTables.tsx` (draws/points/goal-difference columns, §6c/§7.7) — not
  started, genuinely separate scoped work per §4's original framing.
- American Soccer Analysis spike for MLS season stats (§7.2) — not started, still an unverified lead.

Nothing in section 10 changes any decision above it — this is a status update, not a re-plan. A future
session picking this back up should start from "Not built" above, using §6/§9 as the reference, the same
way this session started from §9 for what it did build.

---

## 11. Full remaining scope, consolidated (2026-08-22, same day — supersedes §10 for prioritization)

**Read this section first if you're picking this doc up.** §10 above under-scoped what was actually
achievable: it declared per-match player history "genuinely not available" and treated that as license to
also skip standings, game-lines, and live state, which the doc's own §5 table had *already* confirmed were
real and available. This section corrects that and adds one major new finding: **real per-match history
sources exist for both leagues, free, no auth.** This changes the ceiling on what soccer can look like —
it's no longer capped at MLB/NFL-minus-history; full parity is realistic.

### 11.0 The one big new finding

Understat's `/getLeagueData/{league}/{season}` (already referenced in §9's checklist) returns **season
aggregates only** — that part of §5/§10 was right. But Understat *also* has a per-player endpoint nobody
had checked: `understat.com/getPlayerData/{playerId}` returns a real `matches[]` array — one entry per
match, with `goals`, `shots`, `xG`, `assists`, `xA`, `key_passes`, opponent, date, home/away — going back
across multiple seasons. Confirmed live this session (Martin Odegaard, id 2517: real per-match rows for
2026 and 2025). Requires the same cookie-priming §9 already flagged (hit `understat.com/` once first, then
call with `X-Requested-With: XMLHttpRequest`) — same mechanism, more valuable payload than previously
credited.

Understat only covers big-5 leagues (EPL yes, MLS no) — so MLS still needed its own answer. It has one:
**American Soccer Analysis** (`app.americansocceranalysis.com/api/v1`) is a real, free, no-auth REST API
(OpenAPI spec at `/api/v1/openapi.json`) covering MLS, NWSL, and USL. `/mls/games/shots?game_id=X` returns
**every shot in a match** — player name, xG, goal outcome, minute — confirmed live against a real August
2026 MLS game. Aggregated per player across a team's recent games, this is MLS's per-match history source,
richer than what ESPN's own boxscore offers (has xG, ESPN doesn't). `/mls/players/xgoals?season_name=2026`
also gives real season-aggregate xG/xA/shots/key_passes per player — a second, independent way to satisfy
§7.2's "spike ASA for MLS season stats" item, now resolved rather than open. `/mls/teams`/`/mls/players`
give `team_name`/`player_name` for name-based matching (same `normalizeName`/`scoreNameMatch` machinery
`lib/odds/props/screenshotImport.ts` already has, reusable as-is).

Net effect: **every "real, open gap" in §5's original table is now closed** except cross-provider entity
resolution itself (a real, standard integration task, not a data-availability question).

### 11.1 Final data-source table (authoritative — supersedes §5 and §10's table)

| Need | EPL source | MLS source | Status |
|---|---|---|---|
| Schedule, rosters, logos | ESPN (`teamSportEspn.ts`) | ESPN (same) | ✅ Built |
| Player props (current prices) | Propline/ParlayAPI via Python worker | Same | ✅ Built |
| Standings (W/D/L/pts/GD/rank) | ESPN `apis/v2/sports/soccer/eng.1/standings` — confirmed live, real fields (`wins`,`losses`,`ties`,`points`,`pointDifferential`,`rank`) | ESPN `apis/v2/sports/soccer/usa.1/standings` — confirmed live, 2 conference `children` (East/West, 15 teams each) not 1 | ❌ Not built |
| Game-level single-book line ("Today's Line") | ESPN match `summary?event=X`'s `pickcenter`/`odds[0]` — confirmed live on both a completed and an upcoming EPL match, real DraftKings moneyline/spread/total | Same endpoint family, `usa.1` — not separately re-verified but same shape expected (ESPN's soccer summary API is uniform across leagues per §1's own confirmed pattern) | ❌ Not built |
| Live in-game state | ESPN summary's `keyEvents`/`commentary`/`boxscore` (§2, already confirmed live) | Same | ❌ Not built |
| **Per-match player history** (powers L5/L10/L15/H2H windows, gamelog, distribution chart) | **Understat `getPlayerData/{id}` → `matches[]`** — confirmed live, real per-match goals/shots/xG/assists/xA/key_passes across seasons | **ASA `/mls/games/shots?game_id=X`** aggregated per player across a team's recent `game_id`s (from `/mls/games?season_name=Y`) — confirmed live, real per-shot rows with player name + xG + goal outcome | ❌ Not built, not previously identified as solvable |
| Season/advanced stats card | Understat `getLeagueData` → `players[id]` (season totals: goals/xG/assists/xA/xGChain/xGBuildup) — confirmed live | ASA `/mls/players/xgoals?season_name=Y` (season totals: shots/goals/xgoals/xassists/key_passes/points_added) — confirmed live | ❌ Not built |
| Entity resolution (ESPN subjectId ↔ 3rd-party player) | Understat has no id crosswalk to ESPN — match by `normalizeName(player_name)`, reuse `screenshotImport.ts`'s existing fuzzy matcher | ASA same — `player_name` field, same matcher | ❌ Not built — real integration work, not a data gap |

### 11.2 Consolidated build checklist (do in this order — later items depend on earlier ones)

1. **`lib/sports/soccer/espn.ts` additions**: `fetchStandings(league)` (handle EPL's 1-children vs MLS's
   2-children shape — don't assume `children[0]` universally), `fetchGameSummary(league, eventId)` returning
   the single-book line + live state + per-player match `stats[]` from `rosters[].roster[].stats`. This last
   piece is also EPL's *fallback* per-match source if Understat's cookie-priming ever breaks — cheaper to
   build once and let both leagues use it as a floor.
2. **Standings**: wire `fetchStandings` into the teams route (`app/api/soccer/[league]/teams/route.ts`,
   replacing the `wins: 0, losses: 0` placeholder) and into `TeamDetail.tsx`'s `data.record` (currently
   hardcoded `null` in `lib/sports/soccer/adapters/teamDetailAdapter.ts`). Extend `TeamStandingRow`-adjacent
   display with draws/points/GD per §6c/§7.7's original ask — additive columns, don't break MLB/NFL's
   existing win-loss-only rendering.
3. **Game-level line**: wire `fetchGameSummary`'s odds into `TeamNextGame.moneyline`/`.total`
   (`teamDetailAdapter.ts`) and into a real `GameDetailData.hero.pregameLines` once Game Detail exists (§11.5).
4. **`lib/sports/soccer/understat.ts`** (EPL only): cookie-priming request, `getPlayerData/{id}` for
   per-match history, `getLeagueData/EPL/{season}` for season aggregates. Own module per §9's original
   plan — this is the file that was "approved to build" and never was.
5. **`lib/sports/soccer/americanSocceranalysis.ts`** (MLS only, new — not in any earlier version of this
   doc): `fetchTeamGames(seasonName)`, `fetchGameShots(gameId)`, `fetchPlayerSeasonXg(seasonName)`,
   `fetchTeams()`. Aggregate `games/shots` per player across a team's last N `game_id`s for the per-match
   history array.
6. **Entity resolution**: one shared name-matcher module (or reuse `screenshotImport.ts`'s
   `normalizeName`/`scoreNameMatch` directly — it's already generic, not screenshot-specific) mapping ESPN
   roster `subjectName` → Understat/ASA `player_name`, cached per league (a 20-30 team roster's worth of
   names, refreshed daily is plenty — these don't change mid-season except transfers).
7. **Real per-match `HistoryEntry[]`** in `lib/sports/soccer/adapter.ts`'s candidate-building loop: once
   steps 4-6 land, each candidate can carry real `history` (currently hardcoded `[]`) — this is what unlocks
   real `windows`/`chart`/`gamelog` in `playerDetailAdapter.ts`, all currently `null` by design because this
   didn't exist yet.
8. **Rebuild `playerDetailAdapter.ts`'s thin sections** now that real history exists: `windows` (L5/L10/L15/
   H2H/SZN via the same `fixedWindow`/`openWindow`/`subsetWindow` engine every other sport uses — no new
   engine needed, just real input), `chart` (real distribution instead of the "0 games in scope" placeholder),
   `gamelog` (real per-match rows), `seasonStatsCard`-equivalent (xG/xA/shots season totals — needs a new
   named field, `soccerSeasonStats` or similar, per CLAUDE.md rule 4, since MLB/NFL/golf have no xG concept).
9. **Rebuild `teamDetailAdapter.ts`'s thin sections**: `windows`/`distribution`/`statGroups` become real once
   team-level Understat `history[]` (already confirmed present in `getLeagueData`'s `teams` key, per-match
   xG/xGA/result) or ASA `/mls/teams/xgoals` season rollups are wired in.
10. **Game Detail** (`app/soccer/[league]/game/[gameId]/`, entirely unbuilt — not mentioned in §10's status
    at all): now unblocked by items 1-3 above (single-book line, live state) plus items 4-9 (real player/team
    form for the matchup panel). Build last — it's the page most dependent on everything above already
    working.

### 11.3 What's still genuinely open after all of the above

- **NWSL/USL are not in scope** (ASA covers them too, real bonus coverage, but out of this build's EPL+MLS
  boundary per §8 — noted only so a future "add another league" pass knows the data side is already solved).
- **Understat's cookie-priming is a real fragility point** — if it breaks (site changes, rate-limiting), EPL's
  per-match history has no independent fallback *for the xG-specific fields*, though ESPN's own summary
  `stats[]` (item 1 above) covers goals/assists/shots/cards as a floor even then.
- **Rate/volume budgeting for match-history backfill**: building history for a full 20-25 man roster over a
  10-game window is ~10 ASA/Understat calls per team (one per game, shared across that game's ~36 players),
  not per-player — cheap, but should still run as a scheduled/cached job (matching the `cachedRoute`/
  `snapshot_cache` pattern everything else in this codebase uses), not a live per-request fetch.

