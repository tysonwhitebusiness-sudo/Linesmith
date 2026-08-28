# Linesmith Audit — Phase 4: Auth, Scale, Security

> Measured 2026-08-27 / 2026-08-28 against the live Supabase database and a
> live `next dev` instance of the app. Everything marked **verified** was
> executed, not inferred. Everything marked **unverified** says so.
>
> Companion: `docs/audit-phase-5.md` (recommendations, kept separate on
> purpose). Prior context: `docs/audit-handoff.md` → `docs/audit-handoff-phase-2.md`
> → `docs/audit-handoff-phase-4-5.md`.

---

## 0. Executive summary

**Do not expose this to real users in its current state.** There is one
finding — C1 — that makes every other finding in this document secondary. Your
database has row-level security switched off on 31 of its 35 tables, and it
hands full `SELECT, INSERT, UPDATE, DELETE, TRUNCATE` rights on all of them to
the `anon` role. The `anon` key is not a secret — it is prefixed
`NEXT_PUBLIC_` because it is *designed* to be shipped inside your browser
bundle, where anyone can read it out of the page source in about ten seconds.

Concretely: anyone who loads your site can issue one HTTP request that deletes
all 362,616 rows of `pick_history` — the entire graded track record of your
model, which no backfill can reconstruct because it is your own predictions,
not public data. I verified the write path end to end by inserting a row into
`system_events` using nothing but the public anon key, then deleting it again.
Both succeeded.

The second theme, and it is nearly as important: **you have an unauthenticated
write and compute surface that assumes nobody hostile will ever call it.**
`/api/odds/lines?sport=mlb` performs three database write passes on a plain
`GET` and takes **13.5 seconds** per request — measured, twice, on a live
server. Every `/api/props/*` operator route — including `fit-weights`, which
retrains a model and *activates it if it scores better* — answers to any
anonymous caller. I confirmed each of those reaches its handler with no auth
check.

The third theme is that **your connection budget is already fully spoken
for at one user.** Your app's pool is capped at 6 connections, the Python
worker takes 3, and the real Supavisor session-mode budget after Supabase's
own platform overhead is about 9. There is no headroom. This is not a
"10,000 users" problem — the `EMAXCONNSESSION` errors are already in your
`system_events` table.

**What is genuinely good, and I want to be clear about it because most of
this document is bad news:**

- Your **application-layer user isolation is correct and consistent.** Every
  one of the eleven user-data functions in `lib/db/client.ts` filters on
  `user_id`, every route passes `user.id` from a validated session, and
  `submitPicksAsBets` correctly refuses to move a pick the caller doesn't own.
  This is the part people usually get wrong, and you didn't.
- **RLS on the four user tables is correct** — `bets`, `picks`, `watchlist`,
  `tracked_lines` each have RLS enabled with an owner policy carrying *both*
  `USING` and `WITH CHECK` on `auth.uid() = user_id`. That's textbook. It is
  also proof you know how to do this, which makes the other 31 tables an
  oversight rather than a knowledge gap.
- **Every auth gate holds.** I tested them live against a running server —
  see §2.1. No bypasses.
- **No SQL injection anywhere.** Every query goes through `pgClient.ts`'s
  `compile()` into real parameterized placeholders. I grepped the whole tree
  for interpolated SQL and found nothing exploitable.
- **No secrets are committed.** `.env.local` has never been in a commit, and
  `SUPABASE_SERVICE_ROLE_KEY` isn't referenced by a single line of code.
- **Provider budget accounting is sound.** The increments are atomic upserts,
  and TS and Python agree on the period-key convention (UTC for daily,
  Eastern for monthly). I checked because a mismatch there would be a
  beautiful silent failure. It isn't one.

---

## 1. Topology — resolved

Phase 3 told you to resolve this first because everything else is measured
against it. **Answer: there is no hosted web app.**

`GET /v1/services/srv-da2v3ajsmd2c738bj7v0` (the service Phase 2 saw named
`Linesmith` in `before_delete_snapshot.json`) now returns **HTTP 404 —
`not found: service`**. A full listing of your Render account returns exactly
two services:

| id | name | type | state |
|---|---|---|---|
| `srv-da36bm2bkg8c73fqrdeg` | `line-buddy-odds-worker` | background worker | running |
| `crn-da7lquqfngtc73ft1n2g` | `line-buddy-odds-worker-health-check` | cron | running |

So the Next.js app runs **only on your laptop**. This resolves several
open questions at once and changes the shape of the risk:

- **The in-process timers in `lib/scheduler.ts` run once, not N times.** No
  write amplification. Phase 3's concern here is closed.
- **The public write surface is only public when your laptop is on.** That
  is the single reason C1 has not already been exploited. It is not a
  control — it's luck, and it evaporates the moment you deploy.
- **But the database is public 24/7 regardless.** C1 does not need your app
  to be running. PostgREST at
  `https://qsqzercvwnzaeboltvca.supabase.co/rest/v1/` is always up, and that
  is where the exposure actually lives.
- `npm start` and `npm run dev` both pass `-H 0.0.0.0`, which binds every
  network interface — so while it's running, anyone on the same LAN or Wi-Fi
  reaches the whole unauthenticated operator surface. See M3.

**Still open (I can't determine these from here):** whether the worker's
17-hour hang has a root cause you've identified, whether Render's
`notifyOnFail` is wired to anything that reaches you, and which Supabase plan
you're on. On that last one — see §5.4; your database is at 1,562 MB, which is
3× the free tier's 500 MB ceiling, so you are already paying for something.

---

## 2. What I verified by running it

### 2.1 Auth gates — all hold

Started the real app, hit every gated surface with no session:

| Request | Result |
|---|---|
| `GET /diagnostics` | **307** → `/login?next=%2Fdiagnostics` |
| `GET /api/diagnostics` | **401** |
| `GET /api/diagnostics/health` | **401** |
| `GET /bets` | **307** → `/login?next=%2Fbets` |
| `GET /api/bets` | **401** |
| `GET /api/picks` | **401** |
| `GET /api/watchlist` | **401** |
| `GET /api/tracked-lines` | **401** |
| `GET /api/picks/game-history` | **200** (deliberately public — correct) |
| `GET /api/picks/bankroll` | **200** (deliberately public — correct) |

This closes the Phase 3 concern that the bare `/diagnostics` path might slip
past a `:path*` matcher. It doesn't. The admin gate works.

### 2.2 Anonymous database access — the critical finding

Using only `NEXT_PUBLIC_SUPABASE_ANON_KEY` against PostgREST:

```
bets                 Content-Range: */0        (blocked by RLS — correct)
picks                Content-Range: */0        (blocked by RLS — correct)
watchlist            Content-Range: */0        (blocked by RLS — correct)
tracked_lines        Content-Range: */0        (blocked by RLS — correct)

pick_history         Content-Range: 0-0/362616 (fully readable)
prop_odds            Content-Range: 0-0/290663 (fully readable)
provider_usage       Content-Range: 0-0/38     (fully readable)
model_weights        Content-Range: 0-0/21     (fully readable)
system_events        Content-Range: 0-0/101    (fully readable)
snapshot_cache       Content-Range: 0-0/3009   (readable; body timed out)
```

Then, at the Postgres level:

```
RLS-OFF  policies=0   ×31 tables
RLS-ON   policies=1   bets, picks, tracked_lines, watchlist
```

And the grants — identical on all 35 tables:

```
<table> :: anon          :: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
<table> :: authenticated :: DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
```

Finally, a reversible end-to-end write proof with the anon key alone:

```
POST /rest/v1/system_events   → 201, row id 102 returned
DELETE /rest/v1/system_events → 204
verify                        → []
```

The probe row is gone. But the write happened, and the delete happened, with
a key that is in your browser bundle.

### 2.3 Unauthenticated operator routes

Against the live server, no session, empty JSON body:

```
POST /api/props/scan-player  → 400 {"error":"gameId is required"}
POST /api/props/more-books   → 400 {"error":"gameId is required"}
POST /api/props/sharp-price  → 400 {"error":"gameId is required"}
POST /api/odds/import        → 400 {"error":"No image supplied."}
```

A 400 from the handler's own validation is the proof: the request passed
through middleware untouched and executed application code. With a real
`gameId`, these spend real provider credits.

### 2.4 Attacker-controlled cache keys

```
GET /api/mlb/injuries?teamIds=888801,888802  → 200 in 1.69s
GET /api/mlb/injuries?teamIds=888803,888804  → 200 in 0.90s
```

Then in the database:

```
mlb:injuries:2026:888801,888802   105 bytes   2026-08-28T01:19:52Z
mlb:injuries:2026:888803,888804   105 bytes   2026-08-28T01:19:53Z
```

Both cleaned up. But nonsense team ids created permanent rows and fired real
upstream MLB StatsAPI calls, at roughly one second per request, with no auth.

### 2.5 Real per-request cost

```
GET /api/odds/lines?sport=mlb  →  200, 13.54s, 4,417 bytes
GET /api/odds/lines?sport=mlb  →  200, 13.98s   (no caching — same cost every time)
```

Thirteen and a half seconds, and thousands of database round-trips, to
produce four kilobytes.

---

## 3. Findings

### CRITICAL

---

#### C1 — Row-level security is off on 31 of 35 tables, and `anon` has full write rights on all of them

**What it is, in plain language.** Supabase gives you two keys. The `service_role`
key is a secret. The `anon` key is *not* — it's meant to be public, embedded in
your JavaScript, visible to every visitor. The entire security model assumes
that. What actually protects your data is Row Level Security (RLS): a per-table
switch that makes Postgres check a policy before letting any row through.

You turned RLS on for `bets`, `picks`, `watchlist` and `tracked_lines`, with
correct owner policies. You did not turn it on for the other 31 tables. Those
tables also carry blanket `INSERT / UPDATE / DELETE / TRUNCATE` grants to
`anon`, which is Supabase's default for tables created outside the dashboard.
With RLS off and the grant present, there is nothing between an anonymous HTTP
request and your data.

**Where.** All 31 tables in §2.2. The ones that matter most:

| Table | Rows | What an attacker gets |
|---|---:|---|
| `pick_history` | 362,616 | Read: your entire graded model record. Delete: it's gone, and it is *not* reconstructible — these are your predictions, not public data |
| `prop_odds` + `prop_odds_history` | 290,663 + 425,307 | Read: the whole line-shopping dataset Phase 5 identifies as your actual product asset |
| `model_weights` | 21 | Read: your fitted coefficients. Update: silently change what your model predicts for every user |
| `snapshot_cache` | 3,009 | Write: poison the cache every page read serves |
| `provider_usage` | 38 | Write: set spend counters to max and shut off every provider; or to zero and let real spend run past your caps |
| `system_events` | 101 | Read: internal error text. Write: forge or wipe your own audit trail |
| `auth.users` | 1 | *(not exposed via PostgREST — Supabase protects the `auth` schema; only reachable with the Postgres connection string)* |

**Why it matters / what standard practice says.** The universal Supabase rule
is: *every table in the `public` schema has RLS enabled, without exception.*
Tables that should be world-readable get an explicit `FOR SELECT USING (true)`
policy — the readability is then a deliberate, reviewable decision rather than
an absence. Supabase's own linter flags unprotected public tables as a security
error for this reason. The distinction matters because "no policy" and "a
policy that allows everything" look identical from the outside but behave
completely differently when someone adds a table later.

Note the asymmetry: `model_weights` being *readable* is arguably fine — plenty
of people publish their models. `model_weights` being *writable* by anonymous
strangers means your published numbers can be changed by anyone, and you would
have no way to tell.

**Severity: Critical.** Unauthenticated destructive write access to
irreplaceable data. Meets your own bar ("anything allowing access to another
user's data, or unauthenticated access to something that costs me money") twice
over.

**The fix.** In the Supabase SQL editor:

```sql
-- 1. Enable RLS on every public table that doesn't have it.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- 2. Revoke the blanket write grants from the public roles.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT IN ('bets','picks','watchlist','tracked_lines')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;
```

Nothing in your app breaks, because **nothing in your app reads these tables
through PostgREST.** Every server-side read goes through `lib/db/pgClient.ts`
using `DATABASE_URL`, which connects as the `postgres` role and bypasses RLS
entirely. The Python worker does the same. I checked: the only
`createBrowserClient`/`createServerClient` usages in the codebase are for auth
and for the four user tables.

If you later want a table genuinely public to the browser, add the policy
explicitly:

```sql
CREATE POLICY "public read" ON public.pick_history FOR SELECT TO anon USING (true);
```

**Effort:** 20 minutes including verification. **Dependencies:** none. **Do
this today, before anything else in this document.**

---

### HIGH

---

#### H1 — `/api/odds/lines` writes to the database on an unauthenticated GET, and takes 13.5 seconds doing it

**What it is.** A `GET` request is supposed to be safe — no side effects. This
one runs three write passes: `logGameOddsHistory` (inserts into
`game_odds_history`), `logTotalPredictionsFromLines` (inserts into
`pick_history`, your model's own track record), and `attachPricesFromLines`
(updates `game_picks`). It is not covered by any prefix in `middleware.ts`.

**Where.** [app/api/odds/lines/route.ts:207](app/api/odds/lines/route.ts:207)
onward.

**Measured cost of one request:**

| Step | Cost |
|---|---|
| `readGamesFromSnapshot()` | 11.06 MB read + 427 ms `JSON.parse` |
| `readGameOddsBookLinesForSport('mlb')` | 2,355 rows, 347 ms |
| `logGameOddsHistory` | one sequential `SELECT` per row, inside a single transaction holding one pooled connection |
| `attachPricesFromLines` | one `getGamePick` per matched game, sequential |
| **End-to-end, twice** | **13.5 s / 13.9 s** |

The 13.5 s figure is the *lucky* case. Today only 7 of 37 games in
`game_odds_book_lines` matched the MLB snapshot, so the write loop ran ~112
times. On a full slate the loop is bounded by *distinct*
`(game, market, side, bookmaker)` tuples, of which there are currently **2,268**.
I measured that lookup at 82 ms standalone; at the in-transaction rate implied
by the 13.5 s run it's ~107 ms. Either way a full slate is **three to four
minutes of one held connection**.

This is not theoretical. Your `system_events` table already contains, from this
exact route:

```
(EMAXCONNSESSION) max clients reached in session mode - max ...
canceling statement due to statement timeout
timeout exceeded when trying to connect
```

**Why it matters.** Two separate problems. First, cost and availability: six
concurrent callers exhaust your entire six-connection pool for minutes, and the
whole app stops responding — not just this route. Second, data integrity: an
anonymous caller can inflate `pick_history` and `game_odds_history` at will. If
you ever want to claim a track record, the table needs to be write-controlled.

**Fix, in order of value:**

1. **Move the writes off the request path entirely.** They belong in the Python
   worker next to `odds_lines_cycle.py`, which already owns the moneyline and
   total lock passes — the route's own comment says `attachPricesFromLines` is
   "NOT yet ported." Port it. The route then becomes a pure read.
2. **Batch the prior-lookup.** Replace the per-row `SELECT` with one query
   using `DISTINCT ON (event_id, market, side, bookmaker) ... ORDER BY
   observed_at DESC`, diff in memory, and insert changed rows in a single
   multi-row `INSERT`. That's ~2,268 round-trips → 2. This alone takes the
   route from minutes to well under a second.
3. **Cache the response.** It has no per-user content. `cachedRoute()` with a
   60-second TTL is the pattern your own `CLAUDE.md` already mandates.
4. Add a retention job for `game_odds_book_lines` — it holds 30 games from
   previous days that can never match a snapshot, and the read scan grows
   forever.

**Effort:** #2 is about two hours and gets you most of the win. #1 is a day.
**Severity: High** — unauthenticated writes to your track record, plus a
self-inflicted denial of service.

---

#### H2 — The entire `/api/props/*` operator surface is unauthenticated, including model retraining

**What it is.** `middleware.ts` protects exactly four API prefixes
(`/api/picks`, `/api/bets`, `/api/watchlist`, `/api/tracked-lines`) plus
`/api/diagnostics`. Everything else is open. That "everything else" includes:

| Route | What an anonymous caller can do |
|---|---|
| `POST /api/props/fit-weights` | Retrain the moneyline model and **activate it** if it beats the incumbent on holdout |
| `POST /api/props/fit-total-weights` | Same, totals |
| `POST /api/props/fit-home-run-weights` | Same, home runs |
| `POST /api/props/backfill` | Walk every subject's full season gamelog; writes `pick_history` |
| `POST /api/props/game-backfill` | Season-wide moneyline backfill |
| `POST /api/props/elo-backfill` | `?seasons=2010-2025` — 16 seasons of Elo, sequential, one request |
| `POST /api/props/ingest-historical-odds` | Reads files from disk into `historical_odds` |
| `POST /api/props/scan-player` | Real Tier-1 provider fetches (SharpAPI, Odds-API.io, Propline) |
| `POST /api/props/more-books` | Real SportsGameOdds fetch (paid, object-metered) |
| `POST /api/props/sharp-price` | Real OddsPapi fetch |
| `GET /api/golf/predictions` | 3,000-iteration Monte Carlo, self-described as a testing endpoint |
| `GET /api/odds/game-lines?force` | Bypasses the 6-hour TTL, calls the paid The Odds API |

Verified live in §2.3 — these reach their handlers with no auth.

**Why it matters.** Three distinct harms:

- **Model integrity.** `fit-weights` doesn't just compute; it *activates*.
  An anonymous request can change which model version serves your users.
  Even without malice, a stranger's curl loop retraining your model is
  absurd.
- **Cost.** `more-books` and `sharp-price` spend metered credits. They *do*
  have budget guards (see below), so your card is safe — but your day's quota
  isn't.
- **Availability.** `elo-backfill?seasons=2010-2025` is a multi-hour
  synchronous job. Fire three and the app is done.

**Partial credit where it's earned:** `more-books` is the best-defended route
in the codebase — it checks `monthlyStatus`, refuses when the budget is
exhausted, and enforces a 5-minute per-game cooldown. `refreshTier1` correctly
gates Odds-API.io and Propline on `dailyStatus` and tracks spend *within* the
loop rather than only at the top, which is a subtle bug most people would ship.
So your budget layer is real. It just isn't an auth layer: an attacker rotating
`gameId` values burns the whole month's SportsGameOdds object budget in an
afternoon, entirely within the cooldown rules, and your real users get nothing
for the rest of the month.

**Fix.** Two lines in `middleware.ts`:

```ts
const ADMIN_API_PREFIXES = ['/api/diagnostics', '/api/props', '/api/odds/import'];
```

plus the matching `matcher` entries. Then carve out the genuinely
user-facing ones as explicit exclusions, exactly the way
`PROTECTED_API_EXCLUDE` already handles `/api/picks/game-history`:

```ts
const ADMIN_API_EXCLUDE = ['/api/props/lines', '/api/props/calibration', '/api/props/line-history'];
```

`scan-player`, `more-books` and `sharp-price` are user actions, so they should
move to `PROTECTED_API_PREFIXES` (any signed-in user) rather than the admin
list — and they need a per-user rate limit on top (see M1).

**Effort:** an hour, plus an hour walking the Scan and Player Detail pages to
confirm nothing user-facing broke. **Severity: High.**

---

#### H3 — Attacker-controlled cache keys write unbounded rows and trigger unbounded upstream calls

**What it is.** About twenty routes build a `snapshot_cache` key from a
request parameter that nobody validates:

```
mlb:injuries:${season}:${sortedIds.join(',')}     ← arbitrary numeric list
tennis:weather:route:${venueCity.toLowerCase()}   ← arbitrary string
mlb:recent:${teamA}:${teamB}:${days}
mlb:bullpen:route:${teamA}:${teamB}:${season}
nba:team:${teamId}   nfl:team:${teamId}   cfb:team:${teamId}   ...
```

Proven in §2.4: two nonsense id pairs produced two permanent cache rows and two
rounds of upstream MLB API calls, unauthenticated, at ~1 s each.

**Why it matters.** `mlb:injuries` is the worst because the key is a
*combination* — the space isn't 30 team ids, it's every subset of every integer.
A single-threaded script writes tens of thousands of rows an hour into a
database that is already at **1,562 MB** with **no retention policy on any
table**. Every one of those requests also hits MLB StatsAPI, ESPN or a weather
provider from your IP, which is how you get rate-limited or blocked by a free
data source you depend on.

Team routes are better off — `build()` returns `null` for an unknown team, and
`cachedRoute` correctly declines to cache a null (that `notFoundMessage`
handling is well designed). But they still fire 2–3 upstream fetches per bogus
request before finding out.

**Fix.**

1. Validate against a known set before touching the cache. You already have
   the pattern — `SOCCER_LEAGUES` and `TENNIS_TOURS` are allowlisted properly
   in the soccer and tennis routes. Team ids need the same treatment: you have
   `fetchAllTeams()`, so reject anything not in it.
2. Cap combinatorial keys: `mlb/injuries` should accept at most 2 team ids
   (that is all Game Detail ever asks for) and reject the rest.
3. Hash long keys rather than embedding raw user input.
4. Add a `snapshot_cache` retention job — see M10.

**Effort:** half a day for all of it. **Severity: High** — unbounded storage
growth and third-party abuse from your IP, unauthenticated.

---

#### H4 — The connection budget is fully consumed at one user

**What it is.** Not a bug — a ceiling, and you are already at it.

```
Postgres max_connections           60
Supavisor session-mode pool        15
  ...minus Supabase platform overhead (pg_net, pg_cron, PostgREST,
     postgres_exporter, Supavisor auth_query, Supavisor mgmt)   ≈ 6
  = real budget                                                 ≈ 9
App pool  (lib/db/pgClient.ts, max: 6)                           6
Worker    (python-odds-service/src/db.py, max: 3)                3
                                                            ─────
                                                                 9  ← zero slack
```

The comment block in `pgClient.ts` documents arriving at these numbers the hard
way, through a live `EMAXCONNSESSION` on `/api/nfl/game/401873299`. That
analysis is correct. The problem is that it's correct for *one* user, and the
conclusion — "deliberately zero slack" — is the ceiling, not a safe operating
point.

Meanwhile every request to a gated route calls `supabase.auth.getUser()`, which
is a network round-trip to Supabase's auth service. That doesn't consume a
Postgres connection, but it does add latency and it has its own rate limits.

**Fix.** Switch `DATABASE_URL` to the **transaction-mode pooler (port 6543)**.
Session mode holds a real Postgres backend for the life of the client
connection; transaction mode returns it to the pool between statements, so the
same 15 slots serve far more concurrent work. I used 6543 for every query in
this audit — ~60 queries including `EXPLAIN ANALYZE` — with no
`EMAXCONNSESSION`. Caveats: transaction mode doesn't support session-level
state (prepared statements, `SET`, advisory locks). Your code uses none of
those, but multi-statement transactions still work correctly, so
`pgTransaction` is fine.

**Effort:** one line, plus a real smoke test of every sport's pages.
**Severity: High** — it is the first thing that breaks under any concurrency
at all.

---

#### H5 — Cache write failures are silently swallowed

**What it is.** In [lib/cachedRoute.ts](lib/cachedRoute.ts):

```ts
try { await writeSnapshotCache(cacheKey, JSON.stringify(payload)); } catch { /* ok */ }
```

**How I found it, which is the point.** Mid-audit, one of my write probes
returned `cannot execute DELETE in a read-only transaction` from Postgres.
During that window I fired three requests at `/api/mlb/injuries` with bogus
ids. All three returned **HTTP 200 in under a second**. Zero cache rows were
written. When I repeated the identical test a few minutes later, the rows
appeared normally.

So: for some window, every `cachedRoute()` in the app silently degraded from
"cached" to "rebuild from scratch on every single request," with **no error,
no log line, no `system_events` row, and 200 responses throughout.** The
`/diagnostics` page would have shown nothing. This is precisely the silent
failure class you asked me to hunt: the app looks perfectly healthy while
doing many times the work and paying many times the upstream cost.

**Fix.** Don't swallow it. At minimum:

```ts
try {
  await writeSnapshotCache(cacheKey, JSON.stringify(payload));
} catch (err) {
  console.error(`[cachedRoute] cache write failed for ${cacheKey}`, err);
  void logSystemEvent({ level: 'warn', source: 'cachedRoute',
    message: `cache write failed for ${cacheKey}`,
    detail: err instanceof Error ? err.message : String(err) });
}
```

Then add a `/diagnostics` check on `system_events` for a spike in
`source='cachedRoute'`. The `catch {}` is right that a cache write failure
shouldn't fail the request — it's wrong that it shouldn't be *visible*.

**Effort:** 30 minutes. **Severity: High**, because of the blast radius when
it fires and the complete absence of signal.

*Unverified:* I don't know why the database briefly rejected writes. Worth
checking your Supabase dashboard for a disk or quota event around 2026-08-28
01:15 UTC.

---

### MEDIUM

---

#### M1 — No rate limiting anywhere in the application

There is no request rate limiting of any kind. The grep hits for
"rate limit" are all *provider budget* code — outbound spend caps, not inbound
request control. What you have:

- Per-provider daily/monthly spend caps (real, and they work)
- A 5-minute per-game cooldown on `more-books` (real, but per-game, not per-caller)
- Nothing per IP, per user, or per route

**Why it matters.** Every finding above is amplified by this. It's also what
stands between one bored person and your entire day's provider quota.

**Fix.** At your scale, don't reach for Redis. Put a small in-memory
token-bucket in `middleware.ts` keyed on `x-forwarded-for` (or `user.id` when
signed in). Thirty lines, no dependency, and it survives until you're running
more than one app instance — at which point Upstash Redis's free tier is the
standard answer and `@upstash/ratelimit` is about ten lines.

Suggested budgets: 60 req/min per IP globally; 10/min on anything that touches
a provider; 2/hour on the fit/backfill routes (which should be admin-only
anyway per H2).

**Effort:** half a day. **Severity: Medium** standalone, but it's the
force multiplier on H1–H3.

---

#### M2 — No security headers

Verified on a live response — the only headers present are `vary`,
`content-type` and `keep-alive`. Missing: `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options` /
`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`.

**Why it matters.** Without `X-Frame-Options`/`frame-ancestors`, anyone can
iframe your site and clickjack a signed-in user into actions on their own
account. Without `X-Content-Type-Options: nosniff`, a browser may MIME-sniff a
response into something executable — relevant because `/api/odds/import`
accepts uploaded images. CSP is the one that matters most long-term and the
one worth adding last, because it takes real tuning against Next's inline
scripts.

**Fix.** In `next.config.mjs`:

```js
async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    ],
  }];
}
```

**Effort:** 20 minutes for those five; a day for a real CSP.
**Severity: Medium.**

---

#### M3 — The server binds to every network interface

`package.json`: `"dev": "next dev -H 0.0.0.0"`, `"start": "next start -H 0.0.0.0 -p 3000"`.

`-H 0.0.0.0` binds all interfaces rather than loopback. On a laptop that means
every device on the same network — home, office, coffee shop, hotel — can reach
the full unauthenticated operator surface from H2. Combined with H2 this is a
genuine, currently-live exposure whenever you run the app outside your home
network.

**Fix.** Drop `-H 0.0.0.0` (Next defaults to localhost). If you need LAN access
for phone testing, use `-H 0.0.0.0` only in a separate `dev:lan` script you run
deliberately. **Effort:** 2 minutes. **Severity: Medium** now, drops to
irrelevant once the app is properly hosted and H2 is fixed.

---

#### M4 — Error responses leak internal detail to anonymous callers

`cachedRoute`'s final catch returns
`{ error, detail: error.message }` with a 502, and several routes do the same.
`error.message` from `pg` includes table names, column names and constraint
names; from `fetch` it includes upstream hostnames and sometimes URLs with
query strings. That's free reconnaissance, and provider URLs can carry API keys.

**Fix.** Log the full error server-side; return a generic message plus a
correlation id. Gate `detail` behind an admin session or `NODE_ENV !== 'production'`.
**Effort:** an hour. **Severity: Medium.**

---

#### M5 — Open redirect on the login page

[app/login/page.tsx:26](app/login/page.tsx:26): `const next = search.get('next') ?? '/'`,
then `router.push(next)` after a successful sign-in. `next` is unvalidated, so
`/login?next=https://evil.example/` sends the user off-site *immediately after
they authenticate* — the highest-trust moment in the session, and the classic
setup for a credential-phishing follow-up page.

Your own middleware only ever sets `next` to a pathname, so this is only
reachable via a hand-crafted link. That's exactly how it would be used.

**Fix.**

```ts
const raw = search.get('next') ?? '/';
const next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
```

**Effort:** 5 minutes. **Severity: Medium.** *Verified by code reading; not
executed.*

---

#### M6 — No account recovery, and a weak password floor

There is no "forgot password" link and no `resetPasswordForEmail` call anywhere
in the codebase. A user who forgets their password is permanently locked out,
and their `bets`/`picks`/`watchlist` rows become unreachable. With one user
that's an inconvenience; with a thousand it's your top support burden.

The password floor is `minLength={6}` — an HTML attribute, trivially bypassed
by calling the Supabase client directly, so the real floor is whatever your
Supabase project is configured for (default 6). NIST's current guidance is a
minimum of 8 with no composition rules, and checking candidates against a
breached-password list.

**What's already right:** Supabase handles hashing (bcrypt), token issuance,
rotation and expiry. `@supabase/ssr` puts the session in httpOnly cookies, not
`localStorage` — which is the correct choice and the one people most often get
wrong. Middleware uses `getUser()` rather than `getSession()`, so the token is
validated against the auth server instead of trusted from a cookie. That
comment in `middleware.ts` is right and the code matches it.

**Fix.** Add a reset flow (`supabase.auth.resetPasswordForEmail` plus a
`/reset-password` page — perhaps 80 lines total), and raise the project's
minimum to 8 in Supabase Auth settings. **Effort:** half a day.
**Severity: Medium.**

---

#### M7 — Four high-severity dependency vulnerabilities

`npm audit --omit=dev`:

| Package | Path | Severity | Note |
|---|---|---|---|
| `postcss` | via `next` | High | XSS + arbitrary file read via `sourceMappingURL` |
| `sharp` | via `next` | High | libvips CVEs (4) |
| `xlsx` | direct | High | Prototype pollution + ReDoS — **no fix available** |

The `postcss`/`sharp` pair resolves by upgrading Next (currently 15.5.23
installed; audit suggests 16.3.3, a major version). Note your installed Next
*is* past CVE-2025-29927, the middleware auth-bypass — I checked, because with
your auth model that one would have been critical.

`xlsx` (SheetJS) has no fix on npm. The maintained builds moved off the npm
registry to SheetJS's own CDN. If you only use it to read the historical-odds
import spreadsheets, that's an offline operator task on files you control, so
the practical risk is low — but it's worth confirming no user-supplied
spreadsheet ever reaches it.

**Fix.** Schedule the Next 16 upgrade deliberately (it's a breaking change,
not a `npm audit fix`). Either pin `xlsx` from SheetJS's CDN or replace it with
a CSV path for the one import you use. **Effort:** a day for Next 16; an hour
for xlsx. **Severity: Medium** — real CVEs, but none trivially reachable in
your current usage.

---

#### M8 — Provider budget check-then-act race

The increment itself is safe — `incrementProviderUsage` and Python's
`_increment_usage` both use an atomic `ON CONFLICT DO UPDATE SET count = count + excluded.count`,
so no lost updates. I verified the period-key conventions match across both
languages (UTC daily, Eastern monthly), which is a real correctness win and
worth keeping.

The race is check-then-act: `dailyStatus()` reads, the fetch happens,
`recordDailySpend()` writes. Two processes can both read "under cap" and both
spend. `refreshTier1` mitigates this *within* one loop by tracking
`oddsApiIoSpentToday` locally, which is good — but it can't see what the Python
worker is doing concurrently.

Separately, Python's `_increment_usage` swallows failures by design
("occasionally under-recording is a much smaller problem than crashing"). That
reasoning is defensible, but it means recorded spend is a floor, not a
measurement, and nothing tells you when it drifts.

**Fix.** Make the cap check and the spend record one atomic statement — a
conditional upsert that only increments when the result stays under the limit,
returning whether it succeeded. Then "check" and "reserve" are the same
operation. **Effort:** half a day. **Severity: Medium** — bounded overshoot,
not unbounded.

---

#### M9 — Admin authorisation is a hardcoded UUID in source

`middleware.ts`: `const ADMIN_USER_IDS = ['038048de-c950-4798-9bfb-9da68c89f936']`.

The code comment already acknowledges this and explains the reasoning, which is
fair for one operator. Two real problems: it can't change without a redeploy,
and it puts your user id in a public GitHub repo. That id isn't a credential, so
this is low-harm — but it is the sort of thing that becomes load-bearing right
when you least want to touch it.

**Fix.** A `profiles` table with a `role` column (there is no `profiles` table
today — I checked, PostgREST returns 404), RLS-protected, read in middleware.
Or, cheaper for now, move the id to an environment variable.
**Effort:** 20 minutes for the env var; half a day for the table.
**Severity: Medium.**

---

#### M10 — No retention policy on any table; the database is at 1,562 MB

| Table | On-disk |
|---|---:|
| `player_game_history` | 830 MB |
| `snapshot_cache` | 366 MB |
| `prop_odds_history` | 111 MB |
| `prop_odds` | 105 MB |
| `pick_history` | 102 MB |
| **database total** | **1,562 MB** |

`snapshot_cache` holds 3,009 rows including eight `mlb:full-raw:<date>` blobs
of 66–72 MB each — one per day, forever. That's roughly 70 MB/day of pure
accumulation.

One correction to Phase 3 while I'm here: the `snapshotCacheSize` health check
reports **1,340 MB**, but `pg_total_relation_size('snapshot_cache')` is
**366 MB**. Both are right — the check sums `length(payload)` (logical
characters), while the relation size reflects TOAST compression on disk. Phase 3
reported the 1,340 MB figure as disk usage. It isn't. Don't panic-optimise
against the wrong number, but don't dismiss it either: 70 MB/day of logical
growth is real either way.

**Fix.** A daily `DELETE FROM snapshot_cache WHERE cache_key LIKE 'mlb:full-raw:%' AND fetched_at < now() - interval '7 days'`
plus similar for `prop_odds` and `game_odds_book_lines`. Add it as a job in
`JOB_REGISTRY` — the architecture in `CLAUDE.md` means it costs one function
and one registry line, and `health_check.py` picks it up for free.
**Effort:** two hours. **Severity: Medium** — a cost and performance problem
that compounds, not a security one.

---

#### M11 — The SQL placeholder compiler rewrites every `?` in the query text

[lib/db/pgClient.ts](lib/db/pgClient.ts)'s `compile()` does
`sql.replace(/\?/g, () => '$' + ++i)` — a blind regex over the entire string,
including string literals and operators.

Today this is safe: I grepped every query and none contains a literal `?`. But
it is a trap laid for future-you. The moment someone writes
`WHERE payload::jsonb ? 'key'` (jsonb key-existence) or `LIKE '%?%'`, the
placeholder numbering silently shifts and parameters bind to the wrong
positions. That fails as wrong *data*, not as an error, and `tsc` won't catch
it.

**Fix.** Skip `?` inside quoted literals, or just standardise on the `@name`
style (which is already supported and correctly scoped) and drop positional
support. Add a unit test with a jsonb `?` operator so the trap is documented in
executable form. **Effort:** two hours. **Severity: Medium** — latent, not
live.

---

### LOW

---

**L1 — Unvalidated path segments interpolated into upstream URLs.**
`teamId`, `playerId`, `gameId` go straight into template-literal fetch URLs
(`${BASE}/${espnSport}/${espnLeague}/teams/${teamId}/roster`). The host is
fixed, so this isn't full SSRF, but a crafted value containing `../` or a
query fragment reaches arbitrary paths on ESPN's API from your server. Fix by
validating as an integer or by `encodeURIComponent`. Rolled into H3's fix.

**L2 — `SUPABASE_SERVICE_ROLE_KEY` is configured but unused.** Not referenced
by a single line of code — only by docs. That's the *good* outcome (it's not in
the browser bundle), but an unused god-mode credential sitting in a file is
worth removing, and rotating it since it's been sitting around.

**L3 — `next dev` is not a production server.** If you deploy, use
`next build && next start`. Dev mode compiles on demand, disables optimisations,
and serves verbose errors.

**L4 — No CSRF tokens.** Low risk in practice: Supabase's auth cookies are
`SameSite=Lax`, and your state-changing routes take JSON bodies, which forces a
CORS preflight that a cross-site form can't satisfy. Worth revisiting only if
you add form-encoded endpoints.

**L5 — `/api/odds/import` accepts image uploads with no size or type limit
visible at the route.** Combined with M1 this is a memory-exhaustion vector.
Add an explicit size cap and MIME allowlist.

---

## 4. Single-user assumptions

You asked specifically for every place where one user is implicitly assumed.
Beyond the findings above:

| Assumption | Where | Breaks when |
|---|---|---|
| **Grading is global** | `gradeOpenBets()` in `/api/bets` GET grades *every* user's open bets on any user's page load | At N users, every request does N users' grading work. Move to a scheduled job. |
| **One process owns the timers** | `lib/scheduler.ts` — `setInterval` in the Next process | Two app instances = two MLB rebuilds and two calibration writes every tick. This is currently safe *only because there is no hosted app*. It is the first thing that breaks on deploy. Move both to `JOB_REGISTRY`. |
| **`started` flag is per-process** | `ensureSchedulerStarted()` | Same as above. |
| **Global pool cached on `global.__linesmithPgPool`** | `pgClient.ts` | Correct for one process; the 6-connection budget is per instance, so two instances = 12 against a 9-slot budget. |
| **Rebuild dedup is in-memory** | `lib/staleCache.ts` | Two instances both rebuild the same key simultaneously. Needs a Postgres advisory lock to be real. |
| **`snapshot_cache` is one flat namespace** | Already documented in `CLAUDE.md` | Fine within one app; would collide if you ever ran staging against the same database. |
| **22 tables have writers in both TS and Python** | Phase 3 §1.2 | No advisory locking anywhere. `ON CONFLICT DO NOTHING` makes it non-duplicating but first-writer-wins — including when the first writer had worse data. |

---

## 5. Scale: what breaks, in what order

Assumptions: one hosted app instance, current code, Supabase's ~9 usable
session-mode slots (or ~15× that if you move to transaction mode per H4).
"Concurrent users" means simultaneously active, not registered.

### 5.1 The failure sequence

**~5–10 concurrent users — database connections exhaust. Already happening.**

The binding constraint is 6 pool connections. `/api/odds/lines` holds one for
13.5 s today and 3–4 minutes on a full slate. Six people opening the Game
Lines page at once is enough.

*Symptom:* `connectionTimeoutMillis: 10_000` fires and users get a 502 with
"timeout exceeded when trying to connect." Not just on that route — on
*everything*, because the pool is shared. Your `system_events` table already
contains this error from a single-user workload.

*Fix:* H4 (transaction mode) + H1 (batch the write loop). Together these move
the ceiling by roughly two orders of magnitude, and they are the cheapest two
fixes in this document.

**~10–30 concurrent — `statement_timeout` on the heavy routes.**

`snapshot_cache` reads are 11 MB for `mlb:snapshot` alone. Under contention,
Supabase's statement timeout kills them mid-flight. Already in
`system_events`: "canceling statement due to statement timeout."

*Symptom:* the MLB pages go blank or serve stale data with no explanation,
intermittently, while other sports work — the confusing kind of failure.

*Fix:* stop storing an 11 MB blob as one row. Split the snapshot, or move the
raw payload to Supabase Storage and keep only the derived slate in Postgres.

**~50–100 concurrent — Node event loop and memory.**

`JSON.parse` on 11 MB takes 427 ms of *blocking* CPU on a single-threaded
runtime. At 50 concurrent MLB page loads that's ~21 s of queued CPU. Node
serialises it; everything else waits.

*Symptom:* uniformly slow responses across the whole app, low database load,
high CPU. Looks like a database problem and isn't — which is why it wastes a
day to diagnose.

*Fix:* cache the parsed object in process memory keyed on `fetched_at` so you
parse once per rebuild rather than once per request. Cheap and effective.

**~100–500 concurrent — upstream provider caps.**

Propline's daily cap is 1,000 requests and you've already hit 1,007 on
2026-08-22 under single-user load. Odds-API.io is 500/day. These are *daily*
caps on an app whose per-request behaviour partly scales with traffic.

*Symptom:* the silent one. `refreshTier1` degrades gracefully and logs a
warning nobody reads. Odds quietly stop updating; the UI shows prices with no
indication they're six hours old. Users bet on stale numbers. **This is the
failure mode with real financial consequences for your users, and it produces
no error at all.**

*Fix:* Phase 5 §2 (freshness display) plus provider tiers that scale with
users. This is a buy decision, not a build one.

**~500–1,000 concurrent — Supabase plan ceilings.**

Compute, bandwidth and storage. Your database is already 1,562 MB and growing
~70 MB/day from `mlb:full-raw` alone.

**~1,000–10,000 concurrent — architecture, not tuning.**

Beyond this the current shape doesn't stretch: you need read replicas or a
cache tier (Redis) in front of Postgres, a CDN for the snapshot payloads, and
the per-request writes gone entirely.

### 5.2 The summary table

| Users | First thing to break | Symptom | Fix |
|---:|---|---|---|
| 5–10 | Pool exhaustion (6 conns) | 502 "timeout exceeded", app-wide | H4 + H1 |
| 10–30 | `statement_timeout` on 11 MB reads | Blank/stale MLB pages, intermittent | Split `mlb:snapshot` |
| 50–100 | Node event loop (427 ms parse) | App-wide slowness, low DB load | Cache parsed snapshot in memory |
| 100–500 | Provider daily caps | **Silent stale odds** | Freshness UI + bigger plans |
| 500–1k | Supabase plan limits | Throttling, overage bills | Upgrade + retention |
| 1k–10k | Architecture | — | Redis, replicas, CDN |

### 5.3 Honest caveat

These thresholds come from measured single-request costs extrapolated against
known limits, not from a load test. The *ordering* I'm confident in — it
follows from the resource math. The exact numbers could be off by a factor of
two either way. Before you go live, run `autocannon` or `k6` against a staging
instance and replace my estimates with your own.

### 5.4 Question I can't answer from here

**Which Supabase plan are you on, and what are its ceilings?** Your database
is 1,562 MB against a 500 MB free-tier limit, so you're on a paid plan — but I
can't see which, and the compute/bandwidth/connection ceilings that matter for
§5.1 come with it. Please check Settings → Billing and note it in the doc.

---

## 6. What must be fixed before real users — the short list

Not the full ranking. The minimum that makes exposure defensible.

1. **C1 — enable RLS and revoke `anon` write grants.** 20 minutes. Nothing in
   the app breaks. Without this, the first person who reads your bundle can
   delete your model's entire history.
2. **H2 — put the operator surface behind auth.** One hour. A stranger being
   able to retrain and activate your model is not a defensible state.
3. **H1 — get the writes off `/api/odds/lines`, or at minimum batch the loop.**
   Two hours for the batching. It is both your worst performance problem and an
   unauthenticated write into your own track record.
4. **H4 — move to the transaction-mode pooler (`:6543`).** One line. Without
   it you fail at single-digit concurrency.
5. **M1 — basic per-IP rate limiting.** Half a day. It's what caps the damage
   from everything you haven't found yet.
6. **M5 — fix the open redirect.** Five minutes, and it's a post-authentication
   phishing setup.

Items 1, 4 and 6 total under an hour of actual work and remove the two worst
risks in the document. Do those three first, today.

Everything else — headers, dependency upgrades, password reset, retention,
budget races — is real and worth doing, but none of it is a reason to keep the
app offline.

---

## 7. Method and reproducibility

- **Database:** `DATABASE_URL` with `:5432` → `:6543` (transaction pooler),
  one `pg.Client`, `ssl: { rejectUnauthorized: false }`, `statement_timeout: 120000`.
  Roughly 60 queries across the session with no `EMAXCONNSESSION`.
- **RLS/grants:** `pg_class.relrowsecurity`, `pg_policies`,
  `information_schema.role_table_grants` — authoritative, not inferred from
  probe responses.
- **Anonymous access:** direct PostgREST calls with
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in both `apikey` and `Authorization` headers,
  using `Prefer: count=exact` + `Range: 0-0` to get row counts without pulling
  bodies.
- **Write proof:** one `INSERT` into `system_events` (`source='audit/phase4-rls-probe'`),
  then `DELETE`, then verified `[]`. Two `snapshot_cache` rows created by the
  `mlb:injuries` probe, then deleted. **Nothing I created remains in the
  database.**
- **App behaviour:** real `npm run dev` instance, `curl` for status codes,
  redirect targets, timings and headers. Server stopped afterward.
- **Render:** `GET /v1/services` and `/v1/services/{id}` with `RENDER_API_KEY`.
- **Temp scripts:** all `_audit_*.mjs` files deleted. Repo left as found.

**Not covered here** (so you know where the gaps are rather than assuming
coverage): no load test; no browser-side XSS review of the React tree; no
review of the Python worker's own network surface; `/api/odds/import`'s image
handling read only at the route boundary; no penetration test of Supabase Auth
itself (rate limits, enumeration, token replay).

---

*End of Phase 4.*
