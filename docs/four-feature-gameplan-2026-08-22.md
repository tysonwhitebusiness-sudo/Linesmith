# Four-feature gameplan — loading screens, auth, admin center, AI health monitor

Written 2026-08-22. Supersedes the "note only" posture in the
`project_feature_backlog_2026-08-22` memory for these four items — this is
the actual build plan. Nothing in this doc has been built yet.

**Companion constraint, active right now**: a local Python fit
(`python-odds-service/src/predict/model_fit.py`,
`fit_moneyline_weights`/`fit_total_weights`) is mid-run in another session,
walking 2022-2025 seasons, up to ~90-100 minutes. It holds up to 5 of the
Supabase pooler's 15 session-mode connection slots. **Nothing in this plan
should open a new DB connection — including running `supabase db push`,
any `python-odds-service` script, or a Postgres migration — until that fit
is confirmed done.** This mostly doesn't block Phase 03 (auth) planning or
scaffolding (package installs, writing migration SQL files, building
UI/middleware skeletons all require zero DB access), but it does block
actually applying the auth migration. Flagged inline below wherever it
matters.

---

## Dependency graph and recommended order

```
02  Loading screens hold for real data     — independent, no deps
03  Accounts & auth                        — foundational, blocks 04's gating
04  Diagnostics → admin center             — depends on 03 (basic gating)
                                              + reconciles docs/prompt-4-diagnostics.md
05  DeepSeek AI health monitor             — depends on 04 (a home to live on)
                                              + health_check.py output persistence
                                              (persistence layer itself has no dep on 04,
                                              could be built early)
```

**Recommended build order**: 02 first (fast, isolated, ships a visible win
immediately, zero schema risk). Then 03 in full before touching 04 — auth
is the one item here that changes what "public" means for the entire app,
and building an admin center or a monitoring dashboard before deciding who
can see them is wasted or throwaway work. 04 and the health-check
persistence half of 05 can then run together. 05's actual DeepSeek
integration is the last piece — it's the smallest of the four once it has
somewhere to live.

---

## 02 — Loading screens hold for real data — DONE (2026-08-22)

Built and verified end-to-end in a real browser against the live dev
server: `PlayerDetail`/`GameDetail`/`TeamDetail` now accept an
`onReadyChange?: (ready: boolean) => void` prop, computed from a
deliberately narrow subset of each component's own data-fetching hooks —
specifically only the ones that already gate a visible `lb-skel`/
`animate-pulse` shimmer today (`useLiveGame`, `useTeamStatcast`,
`useGameContext`, `useBullpen`, `useGamePickHistory`, and TeamDetail's
roster/form/batterRanks/`useNflTeamDetail`). `usePropOdds` and
`useMarketCalibration` were deliberately EXCLUDED from every readiness
gate after live testing showed `/api/props/calibration` taking 60-390+
seconds on a cold cache (flagged separately, see below) — neither hook
gates a skeleton anywhere in the codebase (confirmed by grep), so
blocking the whole page on them would have made load times far worse for
zero visible benefit. The 8 page-level call sites
(mlb/nfl/golf player pages, mlb/nfl game pages, `TeamDetailPanel.tsx`'s
two sport bodies) keep the relevant detail component mounted-but-hidden
(`display: none`) behind a `BrandedLoader` until ready, so hooks keep
running (no re-fetch on reveal) but nothing partial is visible. Verified
live: MLB player page (Ronald Acuña Jr., live in-progress game — hero,
live box score, at-bats, today's-lines, gamelog, matchup all appeared at
once), MLB game page (Braves @ Brewers — hero, pitching matchup, team
comparison, rankings all at once), MLB team page (team list stayed
interactive while the detail pane held its own loader, then resolved to
full content at once). `npm run typecheck` clean throughout.

**Real, separate finding surfaced during verification, not fixed here**:
`app/api/props/calibration/route.ts` took 60-390+ seconds on a cold
cache — almost certainly because `pick_history` grew from near-zero to
2,388+ rows very recently (the Python prop-prediction job's first real
run, per `docs/session-handoff-2026-08-22.md`) and this route's
aggregation likely wasn't re-verified at the new scale. It correctly uses
`cachedRoute()` (not a caching-convention violation), so this is a query/
aggregation performance issue, not an architecture one. Flagged as a
background task (`task_8cf9ab7c`) rather than fixed in this pass — out of
scope for "loading screens," and worth its own investigation.



### Current state (verified this session)
- 13 `loading.tsx` files exist (`app/mlb/loading.tsx`,
  `app/mlb/player/[playerId]/loading.tsx`, etc.), all rendering
  `<BrandedLoader size="page" />` — but every page under them is
  `'use client'` (confirmed on `app/mlb/player/[playerId]/page.tsx`) and
  fetches in a `useEffect`, so Next's route-level `loading.tsx` only
  covers the instant between route transitions, not the real fetch.
- Confirmed by reading `components/useSnapshot.ts`: it already exposes a
  clean `loading: boolean` (`SnapshotState.loading`), stale-while-revalidate
  (`if (!hasData.current) setLoading(true)` — only shows loading on first
  load, not on background refresh). This is exactly the shape needed —
  no rework of the hook itself required.
- What's on screen today during a real fetch is per-section skeletons
  (`components/Skeleton.tsx`), popping in piecemeal as each hook resolves.

### Decision: scope to (a), not (b)
(a) Keep client-side fetching, AND together each page's hook `loading`
booleans, hold `BrandedLoader` mounted until the combined flag flips, then
render the full page at once. (b) — moving fetching server-side for real
Suspense streaming — is a rewrite of every fetching hook and doesn't fit
live-polling hooks like `useLiveGame` at all. (a) matches the actual
complaint ("stay while the whole page loads") without a data-layer
rewrite nobody asked for.

### Build steps
1. `GameDetail.tsx`, `PlayerDetail.tsx`, `TeamDetail.tsx` each already
   call several hooks per sport (per the sport-adapter architecture in
   `CLAUDE.md` — MLB's `useSnapshot`/`useLiveGame`/`useTeamStatcast`, NFL's
   own hooks, golf's own hooks, all called unconditionally). Add one
   `const pageLoading = hookA.loading || hookB.loading || ...` per
   component, ANDed across every hook actually relevant to that sport's
   render path (a hook for a section that legitimately isn't shown for a
   given sport — e.g. golf has no live-game hook — should not gate the
   page).
2. While `pageLoading` is true, render `<BrandedLoader size="page" />`
   only — no partial tree, no section skeletons underneath.
3. Once false, render the full page as today. Section-level skeletons in
   `Skeleton.tsx` stay as-is for background refresh states (a hook
   re-fetching after the page is already visible should NOT re-trigger the
   full-page loader — that would fight the stale-while-revalidate pattern
   `useSnapshot` already carefully implements).
4. Repeat for the Scan and Golf schedule pages (their own hook sets).
5. `loading.tsx` files stay unchanged — they still correctly cover the
   route-transition instant; this change covers what happens after.

### Effort / risk
Low-medium, mechanical, page-by-page. Zero schema/backend/DB touch. No
dependency on anything else in this doc. Verify each page in the browser
preview (cold load vs. warm background refresh, confirm the full-page
loader does NOT reappear on a background poll).

---

## 03 — Accounts & auth (the foundational item)

### Current state (verified this session, not just carried from the audit)
- `package.json`: no `@supabase/supabase-js`, no `@supabase/ssr`, no
  `next-auth`, no `clerk`, no `stripe`. Zero auth/payment dependencies
  exist today.
- No `middleware.ts` anywhere in the repo (confirmed via glob — zero
  matches). Nothing gates any route today.
- `lib/db/schema.ts` (legacy SQLite-syntax reference; live schema is now
  `supabase/migrations/*.sql` per `[[project_db_postgres_migration]]`) —
  read the real Postgres migration directly. Confirmed table-by-table:
  - `picks`, `bets`, `watchlist` — genuinely per-user data (a slip,
    submitted bets, a watchlist). **No `user_id` column on any of them.**
  - `pick_history` — **this one is different from what the earlier audit
    implied.** Reading its own schema comment: it's "Log of what the scan
    surfaced, so 'did this actually hit' can be answered later" — a
    system-wide model-calibration log written by both TS's
    `pickHistoryLog.ts` and Python's `prop_pick_history.py`
    (`log_snapshot_candidates`), keyed `UNIQUE (sport, subject_id,
    dimension, category, game_id)` with no per-user semantics anywhere in
    it. **This table should NOT get a `user_id` column** — it's model
    performance data, not a user's data, and every user should see the
    same calibration numbers. Diagnostics/admin-center reads from it stay
    global reads, not per-user filtered reads. (Correcting this now,
    before schema work starts, avoids scoping a global analytics table to
    one user by mistake — a real bug class, not just a style nit.)
  - The DB is already hosted Postgres (Supabase project) — the hardest
    infra blocker for multi-tenant hosting (a single SQLite file) is
    already gone.
- Route surface that actually needs per-user scoping, confirmed by glob:
  `app/api/picks/route.ts`, `app/api/picks/game-history/route.ts`,
  `app/api/bets/route.ts`, `app/api/bets/[betId]/route.ts`,
  `app/api/watchlist/route.ts` — **5 routes.** Everything else under
  `app/api/**` (58 route files total) is either read-only sport/odds data
  (fine to stay public, at least initially) or admin/diagnostic (04's
  concern, gated separately).

### Provider choice: Supabase Auth
Natural fit purely because the DB already lives in that Supabase project —
no second auth vendor, same Postgres connection, and Supabase Auth's own
`auth.users` table lives in the same database so a foreign key from
`picks.user_id` to it is a normal FK, not a cross-service reference.
Needs `@supabase/ssr` (cookie-based session handling for App Router) —
new dependency, install is safe, doesn't touch the DB.

### Schema design
- Do **not** create an app-level `users` table that duplicates Supabase
  Auth's own `auth.users` — reference `auth.users(id)` directly via FK.
  If profile fields are needed later (display name, avatar), that's a
  thin `public.profiles(user_id FK, ...)` table, not required for phase 1.
- `ALTER TABLE picks ADD COLUMN user_id UUID REFERENCES auth.users(id)`
  — same for `bets`, `watchlist`. **Nullable at first**, not `NOT NULL`
  — see data-migration decision below before deciding whether to
  backfill-then-enforce.
- `pick_history` — no schema change. Confirmed above.
- New index: `idx_picks_user`, `idx_bets_user`, `idx_watchlist_user` on
  the new columns (mirrors the existing `idx_picks_sport` pattern).
- Write this as a new file under `supabase/migrations/` (timestamped,
  matching the existing 3-migration convention) — **write the file now,
  do not run it** until the fit script is confirmed done (running a
  migration opens a DB connection).

### Decision (confirmed 2026-08-22): attribute to the operator account
Today's `picks`/`bets`/`watchlist` rows get backfilled to the first real
signup (the operator's own account) once that account exists —
`UPDATE picks SET user_id = '<operator-uuid>' WHERE user_id IS NULL`,
same for `bets`/`watchlist` — so the real in-progress slip/bets survive
the cutover instead of being wiped. This runs once, after the operator's
own signup completes, as the last step of the migration phase.

### Route gating
- `middleware.ts` at the repo root, using `@supabase/ssr`'s
  `createServerClient` to read the session from cookies on every request.
- Protect exactly the 5 routes above (`/api/picks/**`, `/api/bets/**`,
  `/api/watchlist/**`) plus their corresponding pages
  (`app/bets/page.tsx`, `app/bet/[betId]/page.tsx`, the slip UI) — return
  401 on an API call with no session, redirect to a login page for the
  UI routes.
- Every protected route's DB call gets a `WHERE user_id = $1` clause
  added (currently these queries have no such filter at all — this is a
  real, required correctness change, not just an access-control one:
  without it, a logged-in user would see every other user's slip).
- Everything else (`/api/mlb`, `/api/golf`, `/api/props/**`, etc.) stays
  public for phase 1 — the paywall (Stripe entitlements) is what actually
  restricts these later, not auth alone. Don't conflate "logged in" with
  "paying" in this phase.
- Login/signup UI: Supabase Auth's own hosted flows or a thin custom
  form — thin custom form recommended to match the app's existing design
  system rather than an out-of-box Supabase Auth UI widget.

### Payment (explicitly phase 2, not simultaneous)
Stripe subscription + webhook handler (`app/api/stripe/webhook/route.ts`)
+ an entitlement column (`profiles.subscription_status` or similar),
layered on only after basic auth is proven working end-to-end for one
real account. Building both at once is the named failure mode from the
original audit — don't do it.

### Sequencing / DB-connection-pool note
Everything above except *applying* the migration and *testing* login
against real Postgres can be built and reviewed without touching the DB:
installing `@supabase/ssr`, writing `middleware.ts`, writing the
migration SQL file, building login/signup UI against mocked session
state. The actual `supabase db push` (or equivalent) and any live
`WHERE user_id = ...` query testing should wait for the fit-script
all-clear.

### Effort / risk
High — this is the real multi-stage build the other three items chain
off. Budget it as its own multi-session effort, not a quick pass.

---

## 04 — Diagnostics → admin center

### Current state (verified this session)
- `app/diagnostics/page.tsx` is **2,757 lines** (confirmed via direct
  line count), one `'use client'` component, ~15 flat sections (Status
  Overview, Pitcher/Batter Rankings, Pick History + Kelly analysis,
  Player Prop Providers, Model Calibration, Model Versions, Live Drift
  Check, Elo Ratings, Game Model Calibration, Data Sources & System,
  OddsHarvester file status, a collapsed Debug drawer with raw dumps and
  an env-var panel).
- `docs/prompt-4-diagnostics.md` already exists (read in full this
  session) — it is explicitly a **visual-only** brief: locked palette/
  type tokens carried over from the Game Detail redesign, asks for 2-3
  labeled visual options per section (hero treatment for Status Overview,
  table polish, Debug-drawer presentation, section rhythm/grouping,
  empty/loading states). It explicitly says **"not a license to invent a
  separate admin panel style"** and **"you're proposing presentation, not
  information architecture cuts."** This means: it does not cover what
  "admin center" actually needs — regrouping sections into a real IA
  (System Health / Data Pipelines / Model & Calibration / Usage & Spend /
  Pick History / Debug) is out of that brief's scope entirely.
- `python-odds-service/src/health_check.py`: confirmed structure — a list
  of `check_*` async functions (job-registry staleness, Elo freshness,
  game-model freshness, game-picks freshness, odds-history/prices
  freshness, prop-predictions freshness, golf-predictions freshness),
  each already producing a structured `{name, healthy, status, ...}`
  dict. `main()` only ever `print()`s these — **confirmed zero
  persistence anywhere.** This is the real backend gap: the checking
  logic already exists and is good; only the "surface it somewhere" half
  is missing.
- `system_events` table already exists (`level, source, message, detail,
  occurred_at`) — an existing, real place unstructured error/warning
  events already land, per its own schema comment
  (`source e.g. 'api/odds/lines'`). Not currently used for structured
  health-check results (it's a flat log, not per-check state), but
  establishes the "small addition to an existing table family" pattern
  CLAUDE.md's backend section describes.

### Sequencing decision: reconcile before starting, don't run both
The visual-options brief (`prompt-4-diagnostics.md`) is still valid and
worth doing — but doing it against today's flat 15-section layout means
redoing the "which sections group together" work a second time once the
real IA change lands. **Recommendation: do the IA regroup first** (this
phase), have the external design chat's visual pass (whenever it happens)
target the *new* grouped structure, not the old flat one. This isn't
"skip prompt-4" — it's "don't spend a design-chat round on a layout
that's about to be restructured underneath it."

### Build steps
1. **New table for structured health-check persistence** —
   `job_health_checks(check_name TEXT, healthy BOOLEAN, status TEXT,
   detail JSONB, checked_at TIMESTAMPTZ)`, one row per check per run
   (or upsert-by-`check_name`-keep-latest, matching the upsert pattern
   already used elsewhere in this codebase rather than unbounded
   row growth — mirrors the `game_odds_history` dedup lesson already
   documented in `CLAUDE.md`). Migration file only, applied after the
   fit-script all-clear (same DB-connection constraint as item 03).
2. `health_check.py`'s `main()` gains a write step: after computing
   `results`, upsert each into the new table via a `db.py` function
   (`write_health_check_results`), same non-fatal-on-failure pattern
   `write_job_run_log` already uses (`print`-and-continue rather than
   raising, so a monitoring write failure never breaks the actual check).
3. New TS route, `app/api/diagnostics/health/route.ts` — direct SQLite/
   Postgres read of the new table (pattern 2 from `CLAUDE.md`'s API
   caching rules: this is direct reads of a real table, not a snapshot
   blob), no external fetch, so no `cachedRoute()` needed — a plain,
   fast SELECT.
4. **IA regroup**: split `app/diagnostics/page.tsx`'s ~15 sections into
   the grouped structure (System Health, Data Pipelines, Model &
   Calibration, Usage & Spend, Pick History, Debug) — likely as tabs or
   a left-nav within one page rather than 6 separate routes, to keep
   today's single-page jump-link navigation pattern the user already
   knows. This is a real refactor of a 2,757-line file — plan to extract
   each of the ~15 existing sections into its own component first
   (mechanical, low-risk), then place them into the new groups (the part
   that's an actual design decision).
5. New "System Health" group's summary strip reads from step 3's route —
   this becomes the literal home 05 (DeepSeek) writes its own summary
   card into.
6. **Gate the whole page behind 03's auth** — once basic login exists,
   `middleware.ts` protects `/diagnostics` and `/api/diagnostics/**`
   outright (an "admin center" reachable by anyone defeats the name, per
   the original audit's own framing). This step has a hard dependency on
   03 landing first.
7. Once IA lands, hand the *new* grouped structure to the external
   design chat as an updated version of `prompt-4-diagnostics.md`'s
   brief (same locked token system, same options-not-decisions format,
   just re-scoped to the new grouping) — a small doc edit, not a
   from-scratch rewrite of that brief.

### Effort / risk
Medium-high. No hard technical blockers, but real work: extracting a
2,757-line component safely, and reconciling with prompt-4 rather than
duplicating it. Depends on 03 for the gating step (step 6) — everything
else (1-5, 7) can proceed before 03 finishes, since none of it exposes
new user data, just admin/system data that's already unauthenticated
today (not a regression to build it slightly ahead of the gate, as long
as step 6 actually lands before this goes to a real public launch).

---

## 05 — DeepSeek AI health monitor

### Current state (verified this session)
- `lib/odds/screenshotImport.ts` is the one existing LLM integration to
  copy the pattern from: `@anthropic-ai/sdk`, structured JSON-schema
  output (`EXTRACTION_SCHEMA`), one-shot call (not a running agent). No
  DeepSeek or other OpenAI-compatible client exists anywhere yet —
  `package.json` confirmed no matching dependency.
- `provider_usage` table already tracks spend for the four odds
  providers (`lib/odds/props/budget.ts` / Python's `db.py`), surfaced at
  `/api/props/diagnostics` — the pattern for tracking a new API's spend
  already exists in this codebase; extending it to DeepSeek's own token
  cost is additive, not new plumbing.
- `system_events` and the new `job_health_checks` table (04, step 1)
  together are exactly the structured input a summarizer needs.

### Decision: build the summarizer only, not autonomous triage
Two different builds hide under "AI health monitor":
- **Summarizer (this phase)**: feed `job_health_checks` (04) +
  `provider_usage` + recent `system_events` into DeepSeek on a schedule
  (or on-demand button on the admin center page), get back a plain-
  English summary/alert, display it as a card on 04's System Health
  group. Low-medium effort; a wrong output is just a bad summary of data
  a human can already see raw right next to it.
- **Autonomous triage**: let the model decide from raw logs what's wrong
  and page someone. Explicitly NOT this phase — for a monitoring tool, a
  hallucinated "everything's fine" is worse than no AI at all. If ever
  wanted, it's a separate, later, explicitly-scoped effort with its own
  false-positive/false-negative tolerance discussion — not a default
  extension of the summarizer.

### Build steps
1. New `lib/ai/deepseekClient.ts` — thin wrapper, OpenAI-compatible
   client (DeepSeek's API is OpenAI-schema-compatible; use the `openai`
   npm package pointed at DeepSeek's base URL, or a raw `fetch` — decide
   based on whether the `openai` package's other conveniences are worth
   the dependency; either way, mirror `screenshotImport.ts`'s structured-
   output discipline: define an explicit output schema, don't accept
   free-form prose that the UI then has to parse).
2. New route, `app/api/diagnostics/ai-summary/route.ts` — reads 04's
   `job_health_checks` + `provider_usage` + recent `system_events`,
   calls the DeepSeek client, returns the structured summary. This is
   exactly the "genuinely live" exception category in `CLAUDE.md`'s
   caching rules if run on every page load would be wasteful — recommend
   `cachedRoute()` with a TTL of 15-30 minutes (health state doesn't
   need a fresh LLM call every page view) rather than the admin/
   diagnostic-routes exemption, since this route legitimately has both a
   real external-call cost (DeepSeek tokens) and stable-for-a-while data
   underneath it.
3. Track spend: extend `provider_usage`'s existing pattern with a
   `deepseek` provider row (token-based `spend_unit`, matching this
   repo's Python `ProviderSpec.spend_unit: "requests" | "objects"`
   convention — token count is closer to "objects" than "requests" here).
4. UI: one summary card on 04's System Health group, refreshed on the
   same cadence as the route's cache TTL, with a manual "Ask again" button
   for a hard refresh.

### Effort / risk
Low-medium once 04 exists. The real risk is scope creep past the
summarizer boundary — hold the line there unless explicitly asked to go
further.

---

## Summary table

| # | Feature | Depends on | Effort | DB migration required | Can start before fit-script clears? |
|---|---|---|---|---|---|
| 02 | Loading screens | none | Low-med | No | Yes, fully |
| 03 | Auth | none | High | Yes (users/picks/bets/watchlist) | Scaffolding yes, migration apply no |
| 04 | Admin center | 03 (for gating step only) | Med-high | Yes (job_health_checks) | Yes except gating + migration apply |
| 05 | DeepSeek monitor | 04 | Low-med | No (reuses provider_usage) | Yes, once 04's tables exist |
