# Soccer (EPL + MLS) — Gameplan

Planning pass before writing any code. Scope: bring Soccer into the shared PlayerDetail/TeamDetail/GameDetail
adapter architecture (see `CLAUDE.md` §"Sport-adapter architecture"), same visual language as MLB/golf/NFL,
soccer-specific data underneath. Scoped down from an earlier "big 5 European leagues" draft to **only EPL and
MLS** — the two leagues where real betting-odds coverage exists or has a credible provider lead. La
Liga/Serie A/Bundesliga/Ligue 1 are dropped from this plan entirely, not deferred; revisit only if a real odds
source for them shows up. Tennis is out of scope too — no backend plumbing exists for it at all yet (confirmed
absent from `python-odds-service`'s job/provider/game-context machinery and from the page-level `Sport` type).

EPL and MLS turn out to need genuinely different data stacks per layer — this isn't "the same integration
twice," so §2 treats them separately rather than assuming a shared recipe.

---

## 1. What already exists

| Layer | EPL | MLS |
|---|---|---|
| Player props | **Live** — `propline_2` + `parlayapi_soccer`, sequential | **Unbuilt, unconfirmed** — SportsGameOdds is the lead (§2), never actually called for soccer |
| Match-level lines (1X2/handicap/total) | **Missing** — Propline/ParlayAPI are prop-only | **Unbuilt, unconfirmed** — SportsGameOdds has a separate TS game-line fetcher (`sportsGameOdds.ts:238`) that could cover this *if* MLS coverage pans out |
| Games/rosters | **Live** — ESPN `soccer`/`eng.1` | **Not wired, low risk** — `teamSportEspn.ts` is already generic on league, just needs a `usa.1` config entry |
| Season stats + rank | **Decided** — Understat (§3) | **No confirmed source** — Understat has zero MLS coverage (verified below); American Soccer Analysis is a lead, unverified |
| `PropOddsPanel.tsx`, `OddsChip.tsx`, `GameLinesView.tsx`, `ScanTable.tsx` | **Live, sport-agnostic** | same — no work needed either way |
| Page-level `Sport` type, `app/soccer/`, `lib/sports/soccer/adapters/*` | **Missing** | **Missing** |

The odds-ingestion layer's `SportKey` type has `soccer_epl` (`lib/odds/props/types.ts:34`) and has for a
while. It has never had an MLS entry, in any form — checked `types.ts`, `registry.ts`, and both providers'
league-id maps directly; none of them mention MLS even as dead code.

---

## 2. Provider reality check, per league

**Architecture principle, stated explicitly so it doesn't drift**: `python-odds-service/` is the only place
new gambling-odds acquisition code gets written for soccer, full stop. That's the whole point of the recent
Python-worker buildout (entity resolution, real writes, provider safety, per-sport provider stacks,
gameday-proximity scheduling — see recent commit history) — it exists specifically to be the sole owner of
new provider integration, replacing the old TS scheduler's odds-provider jobs. Golf is the one already-decided
exception (`docs/phase2-hardening-gameplan-2026-08-20.md`: "Golf odds / game lines... confirmed staying
TypeScript permanently") — a closed decision for golf specifically, not a precedent for a new sport. Any TS
odds-fetch file referenced below (`sportsGameOdds.ts`, `oddsApi.ts`) is cited **only as a reference for what
shape/markets/league-ids a vendor returns**, because it was built against real API responses for another
sport at some point — never as a place to add live soccer/MLS fetch code. A new MLS (or EPL game-line)
provider becomes a `ProviderSpec` in `python-odds-service/src/{providers.py,jobs.py}`, run through
`job_runner.run_provider_specs`, exactly like every other provider CLAUDE.md's job-runner section describes —
not a new TS live-fetch path, and not a hand-rolled one-off either.

### EPL — mostly plumbing work
Propline (`propline_2`) and ParlayAPI (`parlayapi_soccer`) are proven live for EPL player props. No game-line
provider exists for EPL at all (open item, §6). Season stats come from Understat (§3).

### MLS — genuinely new integration, not a config add
- **Odds**: `fetch_sportsgameodds` in `providers.py:429` (Python worker) is sport-agnostic in its mechanics
  (works off `_SGO_LEAGUE_IDS` + `_sgo_team_id`), but `_SGO_LEAGUE_IDS` (`providers.py:409`) is
  `{"mlb": "MLB", "nfl": "NFL", "cfb": "NCAAF"}` — **no soccer entry at all**. TS's `sportsGameOdds.ts` has the
  same gap in its own `LEAGUE_IDS` (`sportsGameOdds.ts:39-43`); it's cited here only as a reference for the
  request/response shape SportsGameOdds uses for game lines elsewhere, since new soccer fetch code belongs in
  the Python worker regardless (§2 principle above), not because that TS file is a candidate implementation
  site. Every mention of "SportsGameOdds covers MLS/UCL" in this codebase (`jobs.py:230-232`,
  `multiSportRefresh.ts:82,143`, `sportsGameOdds.ts:33-37`) is the *same one-line audit comment*, copy-pasted
  four times — never a verified API response, never a coded league id. **Before building anything else for
  MLS, make one live call to SportsGameOdds for a real MLS game/league id** (a spike script against the vendor
  API directly is fine for this verification step; the permanent integration still lands in
  `python-odds-service` once confirmed) **and see what actually comes back** — player props, game lines, both,
  or neither. This determines whether MLS gets one provider covering both odds surfaces via a single new
  `ProviderSpec` (a real advantage over EPL) or needs its own separate hunt.
- **Season stats**: Understat's league list (confirmed via the `soccerdata` reference's `_config.py`
  `LEAGUE_DICT`) is `ENG-Premier League`, `ESP-La Liga`, `ITA-Serie A`, `GER-Bundesliga`, `FRA-Ligue 1`, plus
  three international tournaments (World Cup, Euros, Women's World Cup) — **no MLS entry, confirmed absent,
  not just unsearched**. MLS needs a different source. American Soccer Analysis
  (`app.americansocceranalysis.com`) is the standing lead in soccer analytics specifically for MLS xG/advanced
  stats — has historically been a plain JSON API, no browser needed, similar trust tier to Understat. **Not
  verified live in this session** — treat as an unconfirmed lead, not a decision, until it's actually spiked.
- **Games/rosters**: `teamSportEspn.ts` is generic on `espnLeague`; MLS's ESPN code is `usa.1`. Same low-risk
  config-only add as any other league would be.
- **League structure is genuinely different from EPL**, not just a smaller dataset: MLS has no relegation,
  splits into Eastern/Western Conferences, and ends in playoffs (plus the Supporters' Shield for best overall
  regular-season record). The league-table-strip card idea from earlier drafts (position/points/GD/form) needs
  a conference-aware variant for MLS — same field, `conference: 'east'|'west'|null` alongside it, not a
  separate card.

---

## 3. Scaffolding (do first, not blocked on either provider check)

1. Widen `Sport`/`SPORTS` in `lib/core/types.ts` to add a single `'soccer'` entry, `SPORT_LABEL['soccer']`.
2. `TopBar.tsx` — add soccer to the switcher; Teams tab on (soccer has teams, like MLB/NFL); Schedule tab off
   (golf-only); add a league picker (EPL / MLS), visible only when `sport === 'soccer'`.
3. `app/soccer/[league]/{page.tsx, loading.tsx, player/, team/, teams/}` — same tree shape as `app/nfl/`, one
   level deeper for the league segment. `league` is `'epl' | 'mls'` for now — not an open-ended string, so a
   third league later is a real, deliberate addition to the union, not silently possible by typo.
4. `lib/sports/soccer/adapters/{playerDetailAdapter,teamDetailAdapter,gameDetailAdapter,statRowAdapter}.ts` —
   one adapter set shared by both leagues (league is a runtime parameter, not two adapter files). Soccer gets
   all three Detail adapters (unlike golf, which only has `playerDetailAdapter.ts` — no team/game concept
   there); structurally soccer is much closer to NFL than to golf.
5. A `soccer` (page-level) ↔ `soccer_epl` / `soccer_mls` (odds-layer `SportKey`, the latter net-new) mapping
   at whatever seam calls into `multiSportGameContext.ts`/`prop_odds` reads.

---

## 4. Season stats + rank — EPL decided (Understat), MLS open

NFL gets ranked season stats from `nflverse-data` (free GitHub-hosted CSVs, `lib/sports/nfl/nflverse.ts`,
rank computed in-app). Golf scrapes pgatour.com's embedded JSON (`lib/sports/golf/pgatourStats.ts`), rank
pre-computed by PGA Tour's own page. Neither has an MLS equivalent; EPL's does.

**EPL — decided**: user supplied the [`soccerdata`](https://github.com/probberechts/soccerdata) Python package
(Apache-2.0) as a reference. Its `understat.py` (`BaseRequestsReader` — plain HTTP, no browser) hits one
cookie-priming `GET understat.com`, then `GET understat.com/getLeagueData/EPL/{season}` with header
`X-Requested-With: XMLHttpRequest`, returning real JSON: per-player season totals (`goals`, `xg`, `np_xg`,
`assists`, `xa`, `shots`, `key_passes`, `yellow_cards`, `red_cards`, `minutes`, `matches`, `xg_chain`,
`xg_buildup`) and per-match team data (`points`, `expected_points`, `goals`, `xg`, `np_xg`, `ppda`,
`deep_completions`) aggregatable to season team totals. No `seleniumbase`/`lxml`/`pandas` needed — those heavy
deps in `soccerdata`'s `pyproject.toml` are only pulled in by `fbref.py`/`whoscored.py` (real headless-browser
scraping, `BaseSeleniumReader` — not attempted here, real infra cost, deliberately out of scope).

Port this into `lib/sports/soccer/understat.ts` — same shape/trust tier as `nflverse.ts`/`pgatourStats.ts`,
living with the other sports' adapters (TypeScript, not the Python worker, which is scoped to provider-job
odds ingestion per CLAUDE.md, a different concern). Rank computed in-app the same way NFL does it
(`nflverse.ts:534-541` pattern), `poolSize: 20` (EPL's real club count).

**Coverage gap even for EPL**: Understat is shot/xG-centric — strong on Attacking (goals, xG, shots, assists,
key passes) and Discipline (cards), an approximation of Defending (xGA as opponent's per-match xG, clean
sheets as goals-against == 0), but no tackles/interceptions/saves/possession%. Real gap, deliberately deferred
past v1 (FBref would close it, at the selenium cost above).

**MLS — open, not decided**. No source in hand. American Soccer Analysis is the lead to spike (§2, §6) — if
it pans out, same integration shape as Understat (plain JSON fetcher in `lib/sports/soccer/`); if it doesn't,
MLS season-stats cards ship later than MLS odds/games do, and that's an acceptable v1 gap rather than a
blocker on shipping MLS game lines/props once the odds provider question is answered.

---

## 5. Card catalog — soccer-flavored versions of the shared cards

Per CLAUDE.md's adapter rules: genuinely different UI gets a named optional field on the shared
`{Component}Data`, populated for soccer and left `null` elsewhere — never a `sport === 'soccer'` branch inside
the shared component. League only changes which data populates a field and that field's `poolSize`/structure
(e.g. MLS's conference split), never the card's existence.

### GameDetail

| Field | Soccer plan | Data dependency |
|---|---|---|
| `hero.pregameLines` | Match result (1X2) / Asian handicap / total goals | EPL: **blocked**, no provider. MLS: pending §2's SportsGameOdds check — could be the first league where this just works |
| `hero` — league table strip | Position, points, GD, last-5 form string; MLS variant carries `conference` | Needs a standings endpoint per league (ESPN or whatever wins §4/§2) |
| `matchup` tabs `[team, player]` | `team`: attack vs opponent defense (xG for vs xGA, shots vs shots allowed); `player`: top scorer/creator vs opponent's defensive record | §4 (EPL live path, MLS open) |
| `statComparison.ranked` | Grouped Attacking / Defending / Discipline, `poolSize` = that league's real club count (20 for EPL; confirm MLS's current club count at build time — it changes as the league expands) | §4 |
| `unitGrades` | Attack / Defense / Set-Pieces grades (NFL's OFF/DEF/ST analog) | §4 |
| `hero.mlbLiveGame`-equivalent | Skip for v1 — no live in-match state card planned | — |

The league-table strip is genuinely new, not an existing field repurposed — no other sport has a standings
concept like it (golf has no bracket, NFL/MLB seeding isn't shown per-game). Worth its own named field rather
than forcing it into `rankings`, per CLAUDE.md rule 4.

### TeamDetail

| Field | Soccer plan | Data dependency |
|---|---|---|
| `matchup` tabs `[team, player]` | Same shape as NFL: team attack-vs-opponent-defense, player picker vs opponent defense group | §4 |
| `statGroups` | Attacking / Defending / Discipline / Set Pieces, ranked out of the real club count | §4 |
| `recentResults` | Already generic — W/D/L instead of W/L, no adapter change needed | none |
| `roster` | Same as NFL: sorted by has-stats, paginated | ESPN roster (live for EPL, config-only add for MLS) |

### PlayerDetail

| Field | Soccer plan | Data dependency |
|---|---|---|
| `matchups` (BatterPitcherMatchupCard analog) | **"Striker vs Opponent Defense"** — two-sided quality bucket: shots-on-target%, xG/90, conversion rate, big chances created vs opponent xGA/90 and clean-sheet%; solo season-stats bucket: goals, assists, shots, key passes | §4 |
| GK-specific matchup variant | save%, goals prevented (PSxG−GA), clean sheets, vs opponent xG/90 — same slot pattern MLB uses to split hitter vs pitcher cards | §4 |
| `windows` (l5/l10/l15/h2h/szn) | Last-5/10/15 match form + head-to-head vs this exact opponent | Buildable now from ESPN schedule/results + prop history |
| `formWindows`/`supportingSplits` | Home/away splits, vs top-of-table vs bottom-of-table opponents (MLS: vs top-of-conference/bottom-of-conference) | Buildable now |
| `lineControl: {kind:'stepper'}` | Reused as-is for goals/shots/assists/saves prop lines | none once props are flowing for that league |
| `chart: {kind:'distribution'}` | Goals or shots-on-target distribution per match | Buildable now from prop/result history |
| `propOddsBoard` | Already sport-agnostic | works today for EPL's real market keys (`anytime_goal_scorer`, `assists`, `shots`, `shots-on-target`, `goals+assists`, `saves`); MLS pending §2 |

---

## 6. Open items

- [ ] **Live-test SportsGameOdds for an MLS game/league id** — player props, game lines, both, or neither.
      This is the single highest-leverage unknown in the whole plan: it decides whether MLS launches with real
      odds coverage at all, and whether that coverage includes game lines EPL still lacks (§2)
- [ ] **Spike American Soccer Analysis's public API for MLS season stats/xG** — unverified lead, same shape as
      Understat if it works (§4)
- [ ] Build `lib/sports/soccer/understat.ts` for EPL — port `getLeagueData/EPL/{season}` (+ cookie-priming
      request), shape into per-team/per-player season aggregates, in-app ranking, `poolSize: 20` (§4)
- [ ] Decide whether/when to add FBref (tackles/interceptions/possession/clean sheets) for EPL — real infra
      cost (headless browser on Render), deliberately deferred past v1 (§4)
- [ ] Pick/wire a match-level line provider for EPL's `hero.pregameLines` — no existing lead the way MLS has
      one; whatever vendor gets picked, the fetch code is a new `ProviderSpec` in `python-odds-service`
      (§2 principle), not an extension of `lib/odds/oddsApi.ts` (TS, MLB-only, useful only as a reference for
      that vendor's request shape if it turns out to be the same vendor)
- [ ] Add `usa.1` (MLS) config to `teamSportEspn.ts`'s league setup — low-risk, config-only
- [ ] Find a standings endpoint (ESPN or other) for the league-table strip, EPL and MLS separately, MLS needing
      the conference-aware variant
- [ ] Confirm soccer entity resolution (ESPN player/team ids ↔ Propline/ParlayAPI names for EPL; whatever MLS's
      provider turns out to be ↔ Understat-or-ASA names) is as solid as MLB/NFL's, or needs the same kind of
      build-out golf/NFL required when they were added — do this once per league, the two leagues don't share
      a name-mapping table
