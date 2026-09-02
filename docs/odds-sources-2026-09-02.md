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

## 10. More keys: free, and the current design wastes them

**Additional ParlayAPI and Propline keys are free to register.** An earlier
version of this section weighed a $9/mo Propline upgrade against "managing five
free keys" — that trade-off does not exist, and the paid comparison was wrong.
More quota costs nothing but registration.

The real constraint is not money, it is that **the current per-sport key design
strands the quota it already has.**

### What the probe proved

All five existing ParlayAPI keys return the **identical 405-sport catalogue**.
A key is not scoped to a sport. `PARLAYAPI_NFL_KEY` is not an NFL key — it is a
monthly quota bucket that someone labelled NFL. The same holds for Propline:
`PROPLINE_2_KEY` is wired to soccer and returns the full 54-sport catalogue.

### Why that matters

Quota is per key, and demand is not evenly spread across sports. Under the
current one-key-per-sport wiring:

- NFL's key exhausts on a heavy Sunday while CFB's key sits at 10% — **and NFL
  goes dark anyway**, because nothing can borrow the unused budget.
- A sport with no key (`PARLAYAPI_NBA_KEY`) gets nothing, even though four other
  keys covering NBA are idle.
- Adding a sport means provisioning a key *for that sport*, rather than adding
  capacity to a shared pool.

Every one of those is a wiring artifact, not a vendor constraint.

### The design that actually captures free keys

**A key pool per provider, not a key per sport.** Register N free keys; hold them
as an ordered list; `run_provider_specs` picks the first key with remaining
quota. `provider_usage` already keys spend by arbitrary `provider_id` strings, so
per-key accounting needs no schema change — `parlayapi_1`, `parlayapi_2` and so
on, with the *sport* recorded on the row rather than baked into the key's
identity.

What that buys, in order of value:

1. **Quota is fungible.** Total capacity = sum of all keys, usable by whichever
   sport needs it that day. This is the whole point and it is unavailable under
   per-sport keys at any number of keys.
2. **Adding capacity is registration, not rewiring.** A new key is one list
   entry — no new `provider_id` constant, no new `render.yaml` block per sport,
   no new spec.
3. **Exhaustion degrades instead of failing.** Today a spent key means that sport
   is silently off (§4). A pool falls through to the next key and only goes dark
   when every key is spent — which is a real signal worth alarming on.

Concretely for Propline: it has spent ~1,000/day for eleven consecutive days and
returns `429 daily_limit_exceeded`. Five free keys is 5,000/day **pooled across
all eight sports**, and Propline is the most broadly useful quota to hold — it is
the only provider besides SharpAPI that covers all eight sports with **both**
props and game lines.

### Ordering

The pool is a change to how keys are held, so it composes with — and does not
block — the six $0 wiring actions below. Those still come first, because they
raise utilisation of quota already being paid for and not spent:

| # | Action | Effect |
|---|---|---|
| 1 | Wire **SharpAPI** to all 8 sports | Only uncapped provider; props + games everywhere |
| 2 | Set the 5 missing **Render keys** | Restores NFL, CFB, NBA, soccer |
| 3 | Wire **The Odds API** beyond MLB | Game lines on 7 more sports |
| 4 | Expand `_PROPLINE_SPORT_KEYS` 3 → 8 | Props + games on 5 more sports |
| 5 | Add NHL to `_SGO_LEAGUE_IDS` | One-line omission |
| 6 | Build `refreshNhlJob` | NHL has no odds job at all |
| 7 | **Key pool + register free keys** | Makes the added quota fungible |

Step 7 after 1–6 for one reason only: until the sports are wired, extra quota has
nothing to spend itself on. Register the keys whenever — they cost nothing to
hold — but the pooling work earns its value once steps 1–6 are actually calling
these providers across eight sports instead of two or three.

**The operator's read stands: the per-sport job structure is sound.** It is the
right shape for *jobs*. It was simply also applied to *keys*, where it does not
belong, because a key turns out to be quota rather than coverage.

---

## 11. Building all-providers-on-all-sports: the design

### 11.1 First, what six providers actually buys — measured, not assumed

Distinct bookmakers per provider, from the live tables:

| Provider | Prop books | Game-line books |
|---|:-:|:-:|
| **propline** | **19** | **22** |
| propline_2 | 10 — every one inside propline's 19 | — |
| the-odds-api | — | 9 — every one inside propline's 22 |
| oddsharvester | — | 4 — **sole source of `bet365`** |
| sharpapi | 2 (`draftkings`, `fanduel`) | 2 |
| oddsapiio | 1 (`fanatics`) | — |

```
prop_odds             union = 19 books   sum across providers = 32   overlap = 13
game_odds_book_lines  union = 23 books   sum across sources   = 37   overlap = 14
```

**Propline alone supplies all 19 prop books and 22 of the 23 game-line books.**
Every book SharpAPI, Odds-API.io, propline_2 and The Odds API return is already
inside Propline's set. The one genuinely unique book in the entire stack is
`bet365`, and it comes from OddsHarvester — the scraper that is currently dead.

So adding providers is **not** multiplying book depth. What it actually buys, in
descending order of real value:

1. **Redundancy against a capped or broken provider.** Propline hits its
   1,000/day ceiling *every day* and returns `429`. When it is capped, everything
   else keeps the sport alive. This is the strongest argument and it is why the
   answer is still "wire them all."
2. **Quota.** More providers and more pooled keys mean more total requests
   against the same slate.
3. **Cross-source verification.** Two independent sources on one game is how the
   MLB 2022-24 recovery was validated (`espn_core` corr 0.9288). Worth real
   money for correctness even when it adds no new book.
4. **Market breadth, currently UNMEASURED.** SportsGameOdds advertises 19 stat
   categories; SharpAPI returned 9 prop markets for MLB and 4 for CFB. Whether
   providers differ in *which markets* they carry — as opposed to which books —
   has not been measured and should be, per sport, as this rolls out.

**A caveat on the table above:** Propline's 19 books were measured on **MLB**,
the only sport it is wired to. Its book depth on NFL, NHL or tennis is unknown.
Measure per sport rather than assuming the MLB figure generalises.

### 11.2 The consequence nobody can skip: deduplicate before consensus

Six providers returning DraftKings means **six DraftKings rows for one game**.
Averaged naively, DraftKings is weighted six times and the de-vigged consensus is
wrong — quietly, with no error, in exactly the way this codebase has been bitten
before (the 48,489 in-play rows were invisible in an aggregate too).

`canonical_bookmaker` already normalises spellings at the shared writer, which
makes the duplicates *visible*; it does not resolve them. The rule has to be
explicit:

> **One row per `(sport, event, market, side, bookmaker)` for consensus.**
> Keep every provider's row for provenance and cross-checking, but collapse to
> the highest-`source_priority` row per book before computing any average,
> overround, or de-vigged probability.

This is the same shape as `model_game_odds`, which already collapses by
`source_priority` — extend that pattern rather than inventing a second one.

### 11.3 The build

Three components. The goal is that adding a provider or a sport is **data, not
code** — the lesson `run_provider_specs` already encodes for cap-checking.

**A. One capability matrix, replacing the per-sport spec builders.**

Today `_tier1_specs()`, `_soccer_epl_specs()`, `_soccer_mls_specs()`,
`_tennis_specs()` and `_job_multisport` each hand-build a spec list. Six
providers across eight sports would make that 48 hand-written constructions —
precisely the duplication that let two of four jobs ship with no rate-limit check
at all.

Replace with one declared table of `(provider, our_sport) -> vendor tokens`,
absorbing the maps that already exist in `providers.py` (`_SGO_LEAGUE_IDS`,
`_PROPLINE_SPORT_KEYS`, `_PARLAYAPI_SPORT_KEYS`) plus new ones for SharpAPI
(`sport`/`league`) and The Odds API. Then `specs_for(sport)` **generates** the
list. Adding a sport is a column; adding a provider is a row.

**B. Key pools, per provider.**

An ordered list of free keys per provider; `run_provider_specs` selects the first
with remaining quota. Each key keeps its own `provider_id` (`propline_1`,
`propline_2`, …) so `db.try_reserve_daily` / `try_reserve_monthly` work unchanged
— no schema change, and the atomic reservation from task 5.12 stays intact.

Proven safe by existing data: on **2026-08-30 `propline` spent 1,000 requests and
`propline_2` spent 1,000 on the same day from the same worker**, so per-key quota
accumulates independently and is not IP-capped.

Drain sequentially rather than round-robin: both use the same total, but
sequential means you always know how many keys remain and failure is gradual
instead of every key expiring at once. (If a provider ever caps on
requests-per-minute rather than budget, invert this — spread across keys for
concurrency.)

The known cost: `provider_id` stops encoding the sport, so **per-sport spend
attribution is lost** unless `provider_usage` gains a `sport` column — which
changes the reservation key, so it is a deliberate decision, not free.

**C. The probe becomes a gate.**

This is what stops the matrix rotting into the thing it replaces.
`docs/api-capability-audit-2026-08-20.md` was hand-maintained and wrong in four
places; this document was wrong once too, in its first pass, because a matcher
compared vendor strings by equality and Propline spells NFL `football_nfl`.

`probe_all_providers.py` already resolves every declared pair against each
vendor's own catalogue. Run it as a scheduled check: **fail if a declared
`(provider, sport)` pair no longer resolves.** A vendor renaming a league then
becomes a failing check rather than a sport quietly going dark — which is exactly
how NFL and CFB were lost for twelve days.

### 11.4 Order of work

| # | Step | Why here |
|---|---|---|
| 1 | Set the 5 missing Render keys | Restores 4 sports; nothing below matters while the worker cannot authenticate |
| 2 | Wire SharpAPI to all 8 sports | Uncapped, free, props + games — the redundancy floor under every sport |
| 3 | Build the capability matrix (A) | Before adding providers, so the additions are data |
| 4 | Expand Propline 3 → 8 sports | It carries the books; this is the real depth win |
| 5 | Dedupe rule (11.2) | **Must land before any consensus is computed on the wider data** |
| 6 | Key pools (B) | Propline is capped daily; pooling is what makes step 4 sustainable |
| 7 | The Odds API + SGO + Odds-API.io on their sports | Redundancy and cross-checking |
| 8 | Probe-as-gate (C) | Keeps 3 honest as vendors change |
| 9 | `refreshNhlJob` | NHL has no job; slot it once the matrix exists |

Step 5 is placed before step 6 deliberately. Widening the data without the dedupe
rule produces a consensus that is *more* wrong than today's, because every extra
provider adds another duplicate of the same handful of books.
