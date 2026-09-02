# Odds sources by sport — what actually runs

**Measured 2026-09-02** from `python-odds-service/src/jobs.py`,
`providers.py`, `config.py`, `render.yaml`, live `provider_usage` /
`prop_odds` / `game_odds_book_lines` rows, and live probes against the
SharpAPI endpoint.

**Not derived from `docs/api-capability-audit-2026-08-20.md`.** That document's
capability matrix is wrong in at least four places, listed in §5. Treat this
file as the source of truth for what runs; treat that one as history.

---

## 1. How the pipeline works

Four layers, and only the first two are per-sport.

**1. A job per sport**, in `JOB_REGISTRY` (`jobs.py`), on its own interval. Each
job loads that sport's non-final games from ESPN (free, always runs), then — for
every sport except MLB's Tier 1 — asks `gameday.should_fetch_paid_providers()`
whether the slate is close enough to justify spending. Hot tier always fetches,
cold tier fetches once daily as a backstop, warm tier is throttled.

**2. A list of `ProviderSpec`s per job.** The spec is the declarative unit:
provider id, an `enabled` flag, a `fetch` callable, and its cap
(`none` / `daily` / `monthly`). `run_provider_specs()` in `job_runner.py` is the
single place that checks the cap, reserves a unit, fetches, records spend, and
writes. No job reimplements that sequence.

**3. Two write paths, from the same fetch.** A provider returns a
`FetchOutcome` carrying `rows` (player props → `prop_odds`) and
`game_line_rows` (team markets → `game_odds_book_lines`). **Not every provider
produces both** — that distinction is the whole of §3 and is why a sport can
have "a working provider" and still have no game lines.

**4. Bookmaker names are canonicalised at the shared writer**, never at the
producer — `db.write_prop_odds` / `db.write_game_odds_book_lines` call
`entity_resolution.canonical_bookmaker`. A new provider gets this for free.

A provider is live only if **`env_bool(FLAG, default=True) and bool(KEY)`**.
`env_bool` defaults to **True**, so a missing `*_ENABLED` flag does not disable
anything — **a missing KEY does**, silently, with no error and no unhealthy
signal. That single line is the cause of §4.

---

## 2. The table

| Sport | Job (interval) | Providers wired | Props | Game lines | Live status |
|---|---|---|---|---|---|
| **MLB** | `refreshTier1` (2.5m) | `sharpapi` | ✅ | — | **working**, 0.0h ago |
| | | `sharpapi_lines` | — | ✅ | **working** |
| | | `oddsapiio` | ✅ | — | **working**, 14.2h ago |
| | | `propline` | ✅ | ✅ | **working**, 1,006 req today |
| | `refreshSportsGameOddsJob` (90m) | `sportsgameodds` | ✅ | ✅ | **stale 849 min** |
| | `mlbGameLinesJob` (30m) | the-odds-api | — | ✅ | **working**, 0.1h ago |
| **NFL** | `refreshNflJob` (20m) | `parlayapi_nfl` | ✅ | — | ❌ **key not on Render** |
| | | `sportsgameodds_multisport` | ✅ | ✅ | ❌ **key not on Render** |
| **CFB** | `refreshCfbJob` (20m) | `parlayapi_cfb` | ✅ | — | ❌ **key not on Render** |
| | | `sportsgameodds_multisport` | ✅ | ✅ | ❌ **key not on Render** |
| **NBA** | `refreshNbaJob` (20m) | `parlayapi_nba` | ✅ | — | ❌ key absent everywhere |
| | | `sportsgameodds_multisport` | ✅ | ✅ | ❌ **key not on Render** |
| **NHL** | **none** | — | — | — | ❌ **no odds job exists** |
| **EPL** | `refreshSoccerEplJob` (20m) | `parlayapi_soccer` | ✅ | — | ❌ **key not on Render** |
| | | `propline_2` | ✅ | ✅ | **working**, 22.9h ago |
| **MLS** | `refreshSoccerMlsJob` (20m) | `parlayapi_soccer` | ✅ | — | ❌ **key not on Render** |
| | | `propline_2` | ✅ | ✅ | **working** |
| **Tennis ATP** | `refreshTennisAtpJob` (20m) | `sharpapi` + `sharpapi_lines` | ✅ | ✅ | ❌ **fails every run** |
| **Tennis WTA** | `refreshTennisWtaJob` (20m) | `sharpapi` + `sharpapi_lines` | ✅ | ✅ | **working**, 0.0h ago |

### What that leaves, measured in the live tables

`game_odds_book_lines`, by sport, over its retained window:

| Sport | Sources present | Freshest |
|---|---|---|
| mlb | propline, the-odds-api, sharpapi, oddsharvester | 0.0h |
| soccer | propline, oddsharvester | 22.9h |
| tennis | sharpapi, oddsharvester | 0.2h |
| **cfb** | **oddsharvester only** | **35.5h (dead)** |
| **nfl** | **none** | — |
| **nba, nhl** | **none** | — |

Only four providers have written a `prop_odds` row: `sharpapi`, `oddsapiio`,
`propline`, `propline_2`. **No ParlayAPI or SportsGameOdds rows at all.**

---

## 3. What each provider actually produces

This is the distinction the capability matrix does not make, and it decides
whether a sport can have a de-vigged game line.

| Provider | Player props | Game lines | Cap | Notes |
|---|---|---|---|---|
| **SharpAPI** | ✅ `fetch_sharpapi` | ✅ `fetch_sharpapi_game_lines` | **none** — 12 req/min only | Free tier: **2 books** (DK, FD), **60s delay**, 200 rows/page |
| **Propline** | ✅ | ✅ `_propline_game_line_rows` | daily | |
| **SportsGameOdds** | ✅ | ✅ `_sgo_game_line_rows` | monthly | |
| **ParlayAPI** | ✅ | ❌ **props only** | monthly | 8–18 books where it runs |
| **Odds-API.io** | ✅ | ❌ | daily | Fanatics-only props |
| **the-odds-api** | ❌ | ✅ | TTL-gated | MLB only, own job |
| **OddsHarvester** | — | ✅ | n/a | Scrapes OddsPortal; **not in `JOB_REGISTRY`** — Windows scheduled tasks on the operator's machine |

**The consequence for NFL/CFB/NBA:** their only game-line producer is
`sportsgameodds_multisport`. ParlayAPI cannot produce one. So when that key is
missing, those sports lose game lines entirely — there is no second path.

---

## 4. Root cause of the NFL/CFB/NBA outage

`config.py` reads **50** environment variables. `render.yaml` declares **12**.
`env_bool` defaults to True, so most of the gap is harmless — the missing
`*_ENABLED` flags and numeric limits fall back to working defaults.

**Five KEYS are the exception**, because `and bool(KEY)` is what actually gates:

| Key | In `render.yaml` | In `.env.local` | Effect on Render |
|---|---|---|---|
| `SPORTSGAMEODDS_MULTISPORT_KEY` | ❌ | ✅ (32 chars) | NFL/CFB/NBA lose **all** game lines |
| `PARLAYAPI_NFL_KEY` | ❌ | ✅ (32 chars) | NFL loses props |
| `PARLAYAPI_CFB_KEY` | ❌ | ✅ (32 chars) | CFB loses props |
| `PARLAYAPI_SOCCER_KEY` | ❌ | ✅ (32 chars) | EPL/MLS lose ParlayAPI's book depth |
| `PARLAYAPI_NBA_KEY` | ❌ | ❌ absent | NBA props never provisioned |

Four of the five exist locally and nowhere in the Render config. `config.py`
falls back to a local dotenv, so **these providers work on the operator's
machine and are silently disabled on the worker.**

The live spend record matches exactly: `sportsgameodds_multisport`,
`parlayapi_nfl`, `parlayapi_cfb` and `parlayapi_soccer` all last recorded spend
on **2026-08-21** and nothing since — consistent with a local run, not a
deployed one.

**Why nothing alarmed.** Three mechanisms compound:

1. A spec with `enabled=False` is skipped by `run_provider_specs` without error.
2. `_job_multisport` returns `gameday.skip_summary(...)` when the tier gate says
   don't fetch — a *successful* run shape.
3. `health_check.py:105` is `healthy = ok and not stale`, with **no check on
   rows produced**.

So `refreshNflJob` and `refreshCfbJob` have reported **healthy** for 12 days
while producing nothing. CFB has 96 games in the current window.

---

## 5. SharpAPI is the strongest source and is wired to two sports of eight

Probed live 2026-09-02 against `api.sharpapi.io/api/v1/odds`, with MLB and NFL
as positive controls:

| Target | Result |
|---|---|
| `baseball/mlb` | 200 rows, 9 prop markets, game lines ✅ |
| `football/nfl` | 200 rows, 6 prop markets, game lines ✅ |
| **`football/ncaaf`** | **200 rows, 4 prop markets** (passing/receiving/rushing yards, touchdowns), **game lines ✅** |
| **`tennis/atp`** | **200 rows, 26 events**, markets: aces, games_won, tennis_to_win_set |
| **`tennis/wta`** | **200 rows, 30 events**, same markets |

`/api/v1/leagues` returns 1,213 leagues and confirms tokens for **every sport in
this project**: `mlb`, `nfl`, `ncaaf`, `nba`, `nhl`, `atp`, `wta`,
`england_-_premier_league`, `usa_-_major_league_soccer`.

**It is wired to MLB and tennis only.** `fetch_sharpapi` and
`fetch_sharpapi_game_lines` already take `sport` / `league` parameters — the
MLB values are defaults, not constraints, and tennis proves the
parameterisation works. Adding a sport is a `ProviderSpec`, not new plumbing.

It is also the only provider with **no budget ceiling** — `cap_kind="none"`,
rate-limited at 12 req/min and nothing else.

### Where the old capability matrix is wrong

| It says | Measured |
|---|---|
| CFB — ❓ untested | ✅ works, `football/ncaaf` |
| Tennis — ❓ untested, *"stale claim, not real coverage"* | ✅ works, 26–30 live events |
| Soccer/EPL — ❓ untested | ✅ `england_-_premier_league` exists |
| SportsGameOdds EPL — *"a real gap"* | Still true for SGO, but **SharpAPI covers EPL** |

It also specified NFL's chain as *ParlayAPI-nfl → SharpAPI → SportsGameOdds*,
calling SharpAPI *"already proven live for NFL."* **The middle link was never
built.**

### Three real caveats before treating it as a drop-in

1. **Free tier is 2 books** (DraftKings, FanDuel) with a **60-second delay**.
   Against ParlayAPI's 8–18 books that is thin for consensus and de-vigging
   breadth. Good as a game-line source; not a replacement for book depth.
2. **200 rows per page.** A `pagination` object exists in the response, so it
   pages — but a 96-game CFB slate needs paging plus budgeting against 12
   req/min. Not literally one line.
3. **Team names vary inside a single response** — `UMass @ Rutgers` (119 rows)
   and `Massachusetts @ Rutgers` (42 rows) are the same game. Entity resolution
   must handle it or the same game is counted twice.

---

## 6. Gaps this table makes visible

1. **NHL has no odds job at all.** Not broken — never built. `refreshNhlJob`
   does not exist in `JOB_REGISTRY`, and SharpAPI serves `hockey/nhl`.
2. **Five provider keys are undeclared in `render.yaml`**, four of which exist
   locally. This is the NFL/CFB/NBA outage.
3. **SharpAPI is wired to 2 of 8 sports** despite covering all 8 and being the
   only uncapped provider.
4. **`refreshTennisAtpJob` fails every run** — `CheckViolationError` on
   `prop_odds_side_valid`, writing `side='home'` for the `aces` market, which
   the probe confirms is a real over/under market. WTA is unaffected only
   because its slate happened not to include one.
5. **A cap-blocked or key-disabled job reports healthy.** `produced_rows` is not
   part of the health contract.
6. **OddsHarvester is the only game-line source CFB ever had**, is not in
   `JOB_REGISTRY`, runs on the operator's machine, and returns zero rows for all
   six sports. The "anti-bot" attribution is the health check's own hedge
   (*"possible anti-bot block"*); the diagnostic evidence — dropdown timeout,
   page height 0 — fits an OddsPortal markup change equally well, which would be
   a code fix.

---

## 7. Verifying this file

It should be re-derived, not trusted. Every claim above comes from one of:

```bash
# jobs → sports → specs
grep -n "JOB_REGISTRY\|_specs()\|provider_id=\|enabled=" python-odds-service/src/jobs.py

# which providers produce game lines vs props only
grep -n "game_line_rows" python-odds-service/src/providers.py

# required env vars vs what render.yaml declares
grep -oE 'env(_bool|_int|_float)?\("[A-Z0-9_]+"' python-odds-service/src/config.py \
  | grep -oE '"[A-Z0-9_]+"' | tr -d '"' | sort -u > /tmp/required.txt
grep -oE 'key: [A-Z0-9_]+' render.yaml | awk '{print $2}' | sort -u > /tmp/declared.txt
comm -23 /tmp/required.txt /tmp/declared.txt

# live provider reality
#   provider_usage        — who is actually spending
#   prop_odds             — who is actually writing props
#   game_odds_book_lines  — who is actually writing game lines
#   job_health_checks     — what the monitor believes

# SharpAPI coverage (read-only, rate-limit aware)
python python-odds-service/probe_sharpapi.py
```

---

## 8. Provider capability audit — every key, every sport, props or games

Probed live 2026-09-02 via each vendor's **catalogue endpoint** (`/leagues`,
`/sports`), which is free and unmetered, rather than by burning odds quota.
`python-odds-service/probe_all_providers.py` is the tool.

**Y = the vendor's own catalogue lists that sport.** This is capability, not
current activity — NHL and NBA are between seasons, so a supported sport can
legitimately return zero rows today.

| Provider | MLB | NFL | CFB | NBA | NHL | EPL | MLS | Tennis | Props | Game lines |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **SharpAPI** | Y | Y | Y | Y | Y | Y | Y | Y | ✅ | ✅ |
| **The Odds API** | Y | Y | Y | Y | Y | Y | Y | Y\* | ✅ | ✅ |
| **Propline** | Y | Y | Y | Y | Y | Y | Y | Y | ✅ | ✅ |
| **ParlayAPI** | Y | Y | Y | Y | Y | Y | Y | Y | ✅ | ❌ **props only** |
| **SportsGameOdds** | Y | Y | Y | Y | Y | ❌ | Y | ❌ | ✅ | ✅ |
| **Odds-API.io** | Y | Y | Y | Y | Y | Y | Y | Y | ✅ | ? not wired |

\* The Odds API's tennis is **tournament-scoped** — `tennis_atp_us_open`,
`tennis_wta_us_open` — not a season-long feed.

SharpAPI's catalogue is 1,199 leagues; The Odds API 87 sports; ParlayAPI 405;
Propline 54; Odds-API.io 34 sport-level slugs (leagues resolve per-sport via
`/v3/events?sport=`). **SportsGameOdds is the only genuinely narrow one — its
catalogue is exactly eight leagues**: `NBA, UEFA_CHAMPIONS_LEAGUE, MLB, MLS,
NCAAB, NCAAF, NFL, NHL`. No EPL, no tennis.

**NHL is supported by five of six providers**, and SharpAPI returned 50 live
rows for `hockey/nhl` on 2026-09-02.

### A measurement caveat worth keeping

The first pass of this probe reported Propline as *not* covering NFL or CFB. That
was wrong: it matched vendor strings by exact equality, and Propline names them
`football_nfl` and `football_ncaaf`, not `americanfootball_nfl`. Substring
matching fixed it. **A naming convention mismatch reads exactly like missing
coverage** — which is most likely how the original capability matrix acquired its
four wrong cells.

---

## 9. What we use versus what we already pay for

| Provider | Sports available | Sports wired | Using |
|---|---|---|---|
| SharpAPI | 8 | 2 (MLB, tennis) | **25%** |
| The Odds API | 8 | 1 (MLB game lines) | **13%** |
| Propline | 8 | 3 (`_PROPLINE_SPORT_KEYS`: mlb, epl, mls) | **38%** |
| SportsGameOdds | 6 of ours | 5 (`_SGO_LEAGUE_IDS` — **NHL omitted**) | 83% |
| ParlayAPI | 8 | 5 wired, 4 disabled on Render | — |
| Odds-API.io | 8 | 1 (MLB) | **13%** |

Two wiring bugs visible here, independent of the Render keys:

- **`_SGO_LEAGUE_IDS` has no NHL entry** — `{mlb, nfl, cfb, soccer_mls, nba}` —
  although SGO's catalogue lists NHL. Even with the key set, NHL would not be
  fetched.
- **`_PROPLINE_SPORT_KEYS` maps three sports** out of a 54-sport catalogue that
  includes every one of ours.

---

## 10. Should we buy more per-sport keys?

**Not yet — almost all the missing depth is already paid for and simply
unwired.** In value order:

| # | Action | Cost | Effect |
|---|---|---|---|
| 1 | Wire **SharpAPI** to all 8 sports | **$0** | Only uncapped provider; props + games everywhere |
| 2 | Set the 5 missing **Render keys** | **$0** | Restores NFL, CFB, NBA, soccer |
| 3 | Wire **The Odds API** beyond MLB | **$0** (paid) | Game lines on 7 more sports |
| 4 | Expand `_PROPLINE_SPORT_KEYS` 3 → 8 | **$0** (paid) | Props + games on 5 more sports |
| 5 | Add NHL to `_SGO_LEAGUE_IDS` | **$0** (paid) | Fixes a one-line omission |
| 6 | Build `refreshNhlJob` | **$0** | NHL has no odds job at all |
| 7 | *Then* consider buying quota | — | See below |

### When buying does make sense

**ParlayAPI — buy per-sport keys for quota, not for coverage.** All five existing
keys return the **identical 405-sport catalogue**, so a key is not
sport-restricted; the per-sport split exists purely to isolate monthly budgets.
More keys therefore buy more monthly requests, and ParlayAPI is the **book-depth
leader** (8–18 books against SharpAPI's free-tier 2). It is props-only, so this
buys depth, never breadth.

**Propline — upgrade the plan instead of adding keys.** `PROPLINE_KEY` hit its
ceiling during this audit:

```
HTTP 429  daily_limit_exceeded — "Daily limit of 1,000 requests exceeded.
          One-click upgrade to Hobby ($9/mo, 5,000/day)"
```

It has spent ~1,000/day for eleven consecutive days, so it is capped every single
day. **$9/mo for 5× the quota on one key beats managing five free keys** — five
keys means five `provider_id`s, five cap buckets in `provider_usage`, five
entries in `render.yaml`, and five things to notice when one silently stops.
Propline also covers all eight sports and produces **both** props and game lines,
which makes its quota the most broadly useful of any provider here.

**The honest summary:** the per-sport job structure is sound — it is the right
shape and the gaps are configuration and wiring, not architecture. Six providers
each cover essentially every sport, and the system currently uses between 13% and
38% of four of them. Spending money before steps 1–6 would buy quota for
providers that are not being called.
