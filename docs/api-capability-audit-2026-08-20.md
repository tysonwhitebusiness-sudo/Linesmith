# API Capability Audit & Tier-System Redesign — 2026-08-20

Triggered by a direct question: are we ready to move past the Python odds migration onto
other work? Testing every provider key live (see `docs/phase2-hardening-gameplan-2026-08-20.md`'s
tail end) surfaced that the current tier1/tier2 split doesn't reflect what each provider is
actually good for, and that most of our 5 providers issue **free tier quota per account/email**,
not per vendor relationship — meaning more free accounts is a real, legitimate lever, not a
workaround. This doc is the capability ground-truth to design the replacement system against.

Every claim below is sourced from either `docs/odds-provider-verification.md` (live-tested
2026-08-11 against a real MLB fixture) or a provider adapter's own header comment (each one
documents its own live-verified sport coverage). Nothing here is guessed. Where coverage for a
sport was never tested, it's marked **untested**, not assumed absent.

---

## 1. Provider × Sport capability matrix

| Provider | MLB | NFL | CFB | Soccer/EPL | Tennis |
|---|:---:|:---:|:---:|:---:|:---:|
| **SharpAPI** | ✅ verified, real props | ✅ verified, real props | ❓ untested | ❓ untested | ❓ untested (scheduler.ts's old comment claims this but the adapter's own `SPORT_LEAGUE` map has no tennis entry — **stale claim, not real coverage**) |
| **Odds-API.io** | ✅ verified (Fanatics-only props) | ❓ untested (adapter hardcoded to `sport=baseball`) | ❓ untested | ❓ untested | ❓ untested |
| **SportsGameOdds** | ✅ verified, 19 stat categories, breadth leader | ✅ verified | ✅ verified | ❌ real gap — this account's soccer coverage is MLS/UCL, not EPL | ❌ not supported |
| **ParlayAPI** | ✅ verified, 5,000+ rows, 18 books | ✅ verified, 2,870 rows, 8 books incl. Pinnacle | ✅ verified, 1,505 rows, 4 books | ✅ verified, 787 rows (thinner, team-total-heavy) | ❌ verified — only alt game lines, no real player props |
| **Propline** | ✅ verified, real market keys | ❌ verified empty — vendor's own docs say "launching 2026 season" | ❌ verified empty, same reason | ✅ verified, real markets (different key names than assumed — `anytime_goal_scorer` not `player_goal_scorer_anytime`) | ❌ verified empty, same reason |

**Reading this**: a ❓ is real unclaimed opportunity — free capability we've never tried, not
confirmed absent. A ❌ is a tested, real dead end — more keys or more code won't fix it.

---

## 2. Real free-tier economics (live-confirmed tonight, not from docs)

| Provider | Cap shape | Real numbers | Resets |
|---|---|---|---|
| **SharpAPI** | Rate-limited only, no daily/monthly wall | 12 req/min, DK+FD books, 60s delay | N/A — never exhausts |
| **Odds-API.io** | Hourly rate + real daily budget | 100/hour, **500/day** (hard) | **Midnight UTC**, confirmed via live header (not midnight Eastern — see below) |
| **SportsGameOdds** | Monthly object budget + per-minute rate | 10/min, 2,500/month (soft cap 2,000) | Monthly (calendar) |
| **ParlayAPI** | Monthly credit budget | 1,000/month (soft cap 800) **per key** | Monthly (billing cycle) |
| **Propline** | Daily request budget | 1,000/day **per key** | **Midnight UTC**, confirmed via live header (`x-daily-reset`) |

**Bug found and not yet fixed**: our own daily-cap tracking (`eastern_date_key()`, used for
Odds-API.io and Propline) assumes midnight Eastern. Both providers actually reset at midnight
UTC (4-5 hours earlier). This means our pre-fetch cap checks can under- or over-estimate real
remaining budget near the boundary — a real, separate bug from the tier-system redesign, worth
fixing regardless (`db.py`'s daily functions + `budget.ts`'s `easternDateKey()` both need a
UTC-based key for these two providers specifically — SportsGameOdds/ParlayAPI's monthly keys
aren't affected, a calendar month is the same in every timezone).

**Confirmed live tonight**: ParlayAPI's two identities (general + MLB-dedicated) and Propline's
two identities (general + soccer-dedicated) already prove the core idea — **each account gets
its own independent free quota**, and the two accounts already in use for each provider use
different emails (`tysonwhitebusiness@gmail.com` vs `tysonwhiteplays@gmail.com` for Propline).
This is exactly the mechanism the new key-per-sport idea would scale up.

---

## 3. Where a fresh key per sport actually helps

Not every provider benefits equally — capability has to gate this, not just "more keys = more
good":

| Provider | Worth a key per sport? | Why |
|---|---|---|
| **ParlayAPI** | **Yes — biggest win available.** Broadest real multi-sport coverage (MLB/NFL/CFB/Soccer all proven with substantial real row counts), and the whole-sport-board-per-call billing model already naturally scopes to one sport per call. A dedicated key per sport (MLB, NFL, CFB, Soccer/EPL — 4 keys) turns one shared 1,000/month pool into four independent 1,000/month pools for the exact same real usage pattern already in place. |
| **Propline** | **Only for MLB and Soccer/EPL.** NFL/CFB/Tennis are a confirmed, vendor-documented dead end regardless of key count ("launching 2026 season") — a third/fourth Propline key for those sports would sit at 0 rows forever. Two keys (current setup) already matches the two sports it actually covers. |
| **SportsGameOdds** | **Plausible, worth considering.** Covers 3 of our sports (MLB/NFL/CFB) for real, and the object-based monthly budget (2,500) would scale linearly with more accounts the same way. Lower priority than ParlayAPI since the current single account isn't yet proven to be the bottleneck (it's usually SportsGameOdds's real rate-limit/account-health state doing the damage right now, not the monthly object cap). |
| **Odds-API.io** | **Not yet — needs adapter work first.** Currently hardcoded to MLB only in both languages. Before a second key is useful, the adapter itself would need to support other sports (untested whether the vendor even has NFL/CFB/soccer data — that's a real unknown, not a confirmed capability). |
| **SharpAPI** | **No real benefit from more keys.** Its only real constraint is a 12/min rate limit that resets constantly — it's never actually hitting a wall the way the credit/daily-budget providers do. If more SharpAPI throughput is ever wanted, that's a plan-tier question (their `meta.tier` block self-reports the account's real limits already), not a multi-account question. |

---

## 4. Proposed replacement for tier1/tier2

The current model (`ProviderTier = 'tier1' | 'tier2'`, `tier1Providers()`/`tier2Providers()`)
answers "is this provider scheduled automatically or click-only" — a scheduling question, not
an efficiency one. It's also exactly the shape that caused two real incidents this session
(ParlayAPI and Propline's Soccer identity both silently inheriting `tier: 'tier1'` with zero
budget tracking, see `docs/phase2-hardening-gameplan-2026-08-20.md` items 3-4) — a single flat
tag trying to carry both "should this run automatically" and "which budget does it draw from"
overloaded one field.

**New model**: per-sport provider stacks, ordered by real cost efficiency, not a flat tier tag.

```
SPORT_PROVIDER_STACKS: Record<SportKey, ProviderStackEntry[]>

ProviderStackEntry = {
  providerId: string        // matches provider_usage.provider_id, one row per real account/key
  costModel: 'free-unmetered' | 'daily-budget' | 'monthly-budget'
  scheduled: boolean         // proactive refresh, vs click-only
}
```

Concretely, informed by §1-§3:

- **mlb**: SharpAPI (free-unmetered, scheduled) → Odds-API.io (daily-budget, scheduled) →
  Propline-mlb (daily-budget, scheduled) → SportsGameOdds-mlb (monthly-budget, slower cadence)
  → ParlayAPI-mlb *(new dedicated key)* (monthly-budget, click-only or slow cadence)
- **nfl**: ParlayAPI-nfl *(new dedicated key)* (monthly-budget, scheduled) → SharpAPI
  (free-unmetered, scheduled — already proven live for NFL) → SportsGameOdds-nfl
  (monthly-budget, slower cadence)
- **cfb**: ParlayAPI-cfb *(new dedicated key)* (monthly-budget, scheduled) →
  SportsGameOdds-cfb (monthly-budget, slower cadence)
- **soccer_epl**: ParlayAPI-soccer *(new dedicated key)* (monthly-budget, scheduled) →
  Propline-soccer (daily-budget, scheduled, existing)
- **tennis_atp/wta**: no real coverage confirmed anywhere yet — real gap, not solved by a new
  key for any current provider given §1's tennis row is all ❌/❓.

SharpAPI's free-unmetered status is exactly why it should lead every sport it actually covers
(MLB, NFL confirmed; CFB/Tennis untested and worth a real live check before assuming) — not
because it's "tier 1," but because it's the only provider with no real ceiling to manage.

**What this needs to be buildable**:
1. `provider_usage` already keys spend by arbitrary `provider_id` strings (`sharpapi`,
   `parlayapi`, `parlayapi_mlb`, ...) — a new `parlayapi_nfl`/`parlayapi_cfb`/`parlayapi_soccer`
   identity is zero schema change, just new rows.
2. Python's `ProviderSpec` + `job_runner.run_provider_specs()` (built earlier tonight,
   documented in `CLAUDE.md`'s "Backend provider-job architecture" section) already supports
   an arbitrary list of provider specs per sport — this redesign is a natural fit for that
   infrastructure, not a fight against it. Adding `parlayapi_nfl` as its own `ProviderSpec`
   with its own key/cap is the same shape as every existing spec.
3. TS's `buildAdapter`-style provider registration (`parlayApi.ts`, `propline.ts`) already
   proves the "same implementation, multiple identities" pattern — extending from 2 identities
   to 4 for ParlayAPI is the same mechanism, not new mechanism.
4. The `tier1`/`tier2` field itself would be replaced by the sport-stack's `scheduled` flag —
   `tier1Providers()`/`tier2Providers()` and their Python-side equivalent go away entirely,
   replaced by "which stack is this sport's job pulling from."

---

## 5. Recommended next actions (not yet built — awaiting direction)

1. **Fix the UTC day-boundary bug** (§2) — small, concrete, affects real cap accuracy today,
   independent of the larger redesign.
2. **Fix Odds-API.io's spend-accounting gap** (found earlier tonight — the events call never
   records spend on failure in either language) — same "small, concrete, already scoped" bucket.
3. **Get the new free-tier keys**: 3 more ParlayAPI accounts (NFL/CFB/Soccer-dedicated,
   mirroring the existing MLB-dedicated one) is the highest-value ask per §3. Propline doesn't
   need more keys — it already has one per sport it actually supports. Hold off on
   SportsGameOdds/Odds-API.io new keys until proven necessary.
4. **Build the sport-provider-stack model** replacing tier1/tier2, once the new keys exist to
   wire in — designing it before the keys exist risks guessing at identities that don't match
   what actually gets provisioned.
5. **Real live test of SharpAPI for CFB/Tennis** before assuming it belongs in those sports'
   stacks — §1's ❓ marks are unclaimed opportunity, not confirmed capability.

---

## 6. Gameday-proximity-aware scheduling — done, same session

Direct response to a real question: was NFL/CFB/Soccer's cadence sized to fit their real
credit-usage cycle? No — `fetchScoreboard`'s 14-day (7 for soccer) lookahead window means
`games` is essentially never empty during a season, so the old flat 3h/45min cadences spent
the same 1 ParlayAPI credit every cycle regardless of whether the nearest game was 6 minutes
or 6 days away (ParlayAPI bills per whole-board fetch, not per matched game).

**Two bugs found in the process, fixed the same pass:**

1. **Python's NFL/CFB/Soccer game lists were silently going stale.** `load_sport_games`
   used to read a Postgres snapshot (`odds-context:{sport}`) that only got refreshed as a
   side effect of TS's `loadGameContextsForSport` running — and that function stopped being
   called automatically the moment `lib/scheduler.ts`'s cutover landed earlier this session.
   Nothing else wrote that snapshot. Fixed by porting `teamSportEspn.ts`'s `fetchScoreboard`/
   `fetchTeamRoster` directly into `game_context.py` (same URLs, same date windows, same
   shared `snapshot_cache` roster-TTL cache — reusable by either app) — Python's jobs are now
   self-sufficient, matching MLB's own pattern of not depending on TS staying alive.

2. **NFL/CFB/Soccer never filtered out finished games**, unlike MLB (`is_final`, real,
   parsed from game state). `GameLookupContext` (TS) has no `isFinal` field at all — a
   pre-existing gap, not something this session's Python port introduced. Real cost: since
   SportsGameOdds bills per-game (not per-board), a finished game left in the list meant a
   genuinely wasted live HTTP request and rate-limit consumption for a market that's already
   closed. Fixed in Python by parsing ESPN's real `competition.status.type.completed` field
   (live-confirmed shape) and applying the same `[g for g in games if not g.is_final]` filter
   MLB's jobs already use. **TS-side `GameLookupContext` still has no `isFinal` field** —
   flagged, not fixed, since TS is off the automated path now (Python owns scheduling) and
   widening that type touches every provider adapter's game-matching code.

**The tiering itself** (`python-odds-service/src/gameday.py`): three tiers computed from real
game kickoff times already loaded that cycle (no extra lookup) —
- **hot**: any non-final game within `[-4h, +6h]` of now → real paid-provider fetch every
  cycle ("refresh hardest right before the game").
- **warm**: any non-final game within 24h, not hot → real fetch throttled to once per 4h
  ("a few times the night before," not every cycle).
- **cold**: nothing within 24h → paid providers skipped entirely, zero real cost. The free
  ESPN schedule check still runs every cycle regardless of tier — it's what tells the system
  which tier it's in, and costs nothing against any budget.

Only the paid provider fetch is gated — the schedule/roster fetch is always-on since it's free.

**Outer job cadence** (`JOB_REGISTRY`) tightened from 3h (NFL/CFB) / 45min-then-60min (Soccer)
down to a shared 20min for all three, now that off-peak cycles are free by construction —
the interval no longer has to protect the budget by itself, `gameday.py` does that job.

**Verified numerically, not by hand arithmetic** (`measure_gameday_budget.py` — simulates the
real `compute_tier` function tick-by-tick over a real NFL-shaped 4-week schedule, not a
reimplementation of the logic): 20min cadence → **~500 real fetches/month against the 1,000
hard cap, 50% headroom**, with 418 of those concentrated in the actual hot-tier gameday
windows — both safer and far more front-loaded toward when freshness matters than the old
flat design. CFB and Soccer/EPL have equal-or-fewer real gameday-hours/week than NFL
structurally, so they inherit at least as much headroom.

**Verified live**: real tier computation against the real current NFL/CFB/Soccer/EPL slate
(NFL/Soccer → warm, CFB → cold), the warm-tier NFL fetch correctly proceeding (422 real rows
written, real spend recorded), and the cold-tier CFB skip correctly costing zero
(`requests: 0, objects: 0`, `elapsed_seconds: 0.0`).
