# Session handoff — four-feature build (loading screens / auth / admin center / DeepSeek monitor)

**Written for**: picking this work up in a fresh Claude Code session/account
with zero prior context. Read this whole file before doing anything.

---

## The end goal (read this first)

**Linesmith (line-buddy)** is a personal sports-betting research app —
Next.js/TypeScript (`app/`, `lib/`, `components/`) on top of a shared
Postgres database (Supabase-hosted), plus a separate Python background
worker (`python-odds-service/`) that this session's work does NOT touch.

On 2026-08-22 the user asked for a full build gameplan for four features
they'd previously only brainstormed (see the memory file
`project_feature_backlog_2026-08-22` if you have access to this account's
memory system — if not, this doc and the gameplan doc below are
self-contained enough without it). The gameplan was written, approved, and
is now **actively being built, phase by phase, with the user asking for a
test/verification checkpoint after each phase before moving to the next**.

**The governing document is `docs/four-feature-gameplan-2026-08-22.md`** —
read that in full. It has the complete architecture, phased build steps,
and reasoning for all four features. This handoff file is the "where did
we leave off" supplement, not a replacement for it.

The four features, build order (from the gameplan doc):
1. **02 — Loading screens hold for real data** — DONE, verified, see below.
2. **03 — Accounts & auth (Supabase Auth)** — IN PROGRESS, see below. This
   is the one you're most likely picking up mid-stream.
3. **04 — Diagnostics → admin center** — NOT STARTED. Depends on 03's
   gating existing first.
4. **05 — DeepSeek AI health monitor** — NOT STARTED. Depends on 04.

---

## Exact current git state — READ BEFORE TOUCHING GIT

**Nothing has been committed.** Established pattern this session (matches
this repo's own prior-session convention, see
`docs/session-handoff-2026-08-22.md` if present): build and verify locally
first, only commit/push when the user explicitly asks. Do not `git commit`
or `git push` without asking first.

Run `git status --short` yourself to get the live picture, but as of
writing:

```
 M app/api/bets/[betId]/route.ts
 M app/api/bets/route.ts
 M app/api/picks/route.ts
 M app/api/watchlist/route.ts
 M app/golf/player/[playerId]/page.tsx
 M app/mlb/game/[gameId]/page.tsx
 M app/mlb/player/[playerId]/page.tsx
 M app/nfl/game/[gameId]/page.tsx
 M app/nfl/player/[playerId]/page.tsx
 M components/GameDetail.tsx
 M components/PlayerDetail.tsx
 M components/TeamDetail.tsx
 M components/TeamDetailPanel.tsx
 M components/TopBar.tsx
 M components/useSlip.ts
 M lib/db/client.ts
 M package-lock.json
 M package.json
?? app/login/
?? components/AccountMenu.tsx
?? docs/four-feature-gameplan-2026-08-22.md
?? lib/supabase/
?? middleware.ts
?? scripts/backfill-operator-account.js
?? supabase/migrations/20260822170000_add_user_id_to_slip_tables.sql
?? supabase/migrations/20260822170500_scope_picks_watchlist_uniqueness_to_user.sql
?? supabase/migrations/20260822171000_rls_on_user_owned_tables.sql
```

**Two untracked items NOT part of this work, don't touch them:**
- `before_delete_snapshot.json` — pre-existed before this session started,
  unrelated.
- `docs/soccer-gameplan-2026-08-22.md` — appeared mid-session, from a
  *different, concurrent* Claude Code session the user has open (they
  confirmed that other session is doing gameplanning/auditing only, not
  implementation — see "Important context" below for why this matters).

`npm run typecheck` (`tsc --noEmit`) is clean as of the last check. Run it
again yourself before assuming the current state is good — more edits may
have landed after this doc was written if this handoff is stale.

---

## IMPORTANT CONTEXT — a real mid-session incident, don't repeat it

Partway through this session, a memory file got updated (by the *other*
concurrent Claude Code session mentioned above) claiming this exact
four-feature build was "already being built in another chat." This session
almost stood down and abandoned the work based on that note. **It was
wrong/stale** — the user clarified in chat that the other session is
gameplanning/auditing only. The lesson, if you see anything similar: verify
directly with the user in chat before standing down on the basis of a
memory note or file you didn't write yourself this session. It cost one
back-and-forth here; don't let it cost more.

Separately: **the user paused a long-running Python fit script
(`model_fit.py`, `fit_moneyline_weights`/`fit_total_weights`) themselves**,
specifically to free up the shared Postgres connection pool's headroom
while this four-feature build is underway. They said they'll resume it
**once this build is done**. This means:
- The original "don't touch the DB, only 15 connections total" caution
  from earlier in this session is currently relaxed — but don't take that
  as license to be careless. Still avoid running heavy concurrent
  DB-touching scripts unnecessarily, and don't restart the Python worker
  or run `python-odds-service` scripts without checking with the user
  first (that guidance weirdly never actually applied to this build,
  which is all TypeScript/Postgres-migration work, but flagging it since
  the original warning is still technically live for anything
  Python-side).
- **When this entire four-feature build is finished, tell the user so they
  know they can resume the fit.**

---

## Phase 02 — Loading screens — DONE

Full details already written into `docs/four-feature-gameplan-2026-08-22.md`'s
own Phase 02 section (search for "DONE (2026-08-22)") — read that, not a
re-summary here. Short version: `PlayerDetail`/`GameDetail`/`TeamDetail`
gained an `onReadyChange` callback prop wired to their own data-fetching
hooks (deliberately excluding `usePropOdds`/`useMarketCalibration`, which
don't drive any skeleton and where `/api/props/calibration` was measured
taking 60-390+ seconds on a cold cache — flagged as a separate background
task, not fixed). All 8 page-level call sites wired. Verified live in the
browser against real data (MLB player/game/team pages). Nothing left to do
here unless the user reports a regression.

**One real, separate finding surfaced and flagged (not fixed)**:
`app/api/props/calibration/route.ts` is slow on a cold cache, almost
certainly because `pick_history` grew to 2,388+ rows very recently from an
unrelated Python job. A background task chip was spawned for this
(`task_8cf9ab7c` — that id is only valid within the original session's UI,
won't mean anything in a fresh session, but the finding itself is real and
worth remembering).

---

## Phase 03 — Accounts & auth — IN PROGRESS, this is where you pick up

### The plan (from the gameplan doc, condensed)
- **Provider**: Supabase Auth (the DB is already a Supabase project, so no
  second auth vendor).
- **Schema**: `users` handled by Supabase Auth's own `auth.users` table
  (no app-level duplicate). `picks`/`bets`/`watchlist` get a nullable
  `user_id UUID REFERENCES auth.users(id)`. **`pick_history` deliberately
  does NOT get a `user_id` column** — it's a system-wide model-calibration
  log (what the model surfaced, for grading), not per-user data. This
  correction was made during planning, not in the original user-provided
  audit — don't undo it.
- **Data migration decision (user confirmed)**: today's global
  picks/bets/watchlist rows get backfilled onto the operator's own account
  once they sign up, not wiped.
- **Route gating**: only `/api/picks/**` (except `/api/picks/game-history`,
  see below), `/api/bets/**`, `/api/watchlist/**`, and pages `/bets`,
  `/bet/*` require auth. Everything else stays public in this phase —
  "logged in" and "paying" (Stripe/entitlements) are explicitly different
  concerns; Stripe is a later phase, not started.

### What's actually built and applied so far

**1. Database — 3 migrations written AND APPLIED to the real shared
Postgres DB** (not just written as files — actually run, verified via
direct query):
- `supabase/migrations/20260822170000_add_user_id_to_slip_tables.sql` —
  adds nullable `user_id UUID REFERENCES auth.users(id)` to `picks`,
  `bets`, `watchlist`, plus indexes. **Applied, verified**: all three
  columns exist.
- `supabase/migrations/20260822170500_scope_picks_watchlist_uniqueness_to_user.sql`
  — **a real correctness bug fix found during this work, not in the
  original plan**: `picks` had `UNIQUE (sport, subject_id, dimension,
  category)` and `watchlist` had `UNIQUE (sport, subject_id)` — neither
  included `user_id`, which would have meant two different users adding
  the identical leg would silently collide (`ON CONFLICT` would update the
  WRONG user's row). Drops the old constraints (found dynamically via
  `pg_constraint`, not by guessing Postgres's auto-generated name) and
  replaces them with `user_id`-inclusive versions. **Applied, verified**:
  `picks_user_sport_subject_dimension_category_key` and
  `watchlist_user_sport_subject_key` now exist with the right column list.
- `supabase/migrations/20260822171000_rls_on_user_owned_tables.sql` — **a
  second real security issue found and fixed, also not in the original
  plan**: Supabase auto-exposes every public-schema table via its
  PostgREST REST API. This app's own backend bypasses RLS (direct
  Postgres connection string, not through PostgREST) and always filters
  by `user_id` explicitly in every query — but the
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` about to ship in the browser bundle
  could otherwise be used to call Supabase's REST API directly and
  read/write ANY user's `picks`/`bets`/`watchlist` rows, completely
  bypassing this app's own route-level auth checks. Enables RLS with a
  default-deny-then-`auth.uid() = user_id` policy on all three tables.
  **Applied, verified**: `relrowsecurity = true` on all three tables, one
  `FOR ALL USING/WITH CHECK (auth.uid() = user_id)` policy each.
  **If you're auditing this work fresh, verify this is still correctly
  applied before trusting it — it's the single most important thing to
  not have silently regressed.**

  Migrations were applied via small one-off Node scripts (not the
  Supabase CLI, which isn't configured in this repo — no
  `supabase/config.toml` exists) using the `pg` package directly against
  `DATABASE_URL` from `.env.local`, following the exact pattern already
  documented in `CLAUDE.md`/prior session docs for this codebase (open a
  short-lived `Client`, run the SQL, close it — not the app's own pooled
  connection). The scratch scripts used for this aren't saved anywhere
  permanent; if you need to apply anything further, write a similar
  throwaway script rather than looking for them.

**2. Supabase client infrastructure**:
- `lib/supabase/server.ts` — `createClient()` for Route Handlers/Server
  Components, using `@supabase/ssr`'s `createServerClient` + Next's
  `cookies()`.
- `lib/supabase/client.ts` — `createClient()` for browser/client
  components, using `createBrowserClient`.
- Both follow the standard, current (2026) `@supabase/ssr` App Router
  pattern — if you're not familiar with it, the official Supabase Next.js
  SSR docs are the reference, but these two files are already
  correct/complete, don't need re-deriving.
- `@supabase/ssr` and `@supabase/supabase-js` added to `package.json` /
  installed (`npm install` already run, `node_modules` has them).

**3. `middleware.ts`** (new file, repo root) — gates the routes listed
above. **One subtlety already handled, don't re-break it**:
`/api/picks/game-history` is under the `/api/picks` prefix but must NOT be
gated — it reads `game_picks` (the model's own global pick-lock win/loss
record, public scoreboard data), not this user's slip. Confirmed by
reading the route file itself before excluding it. The middleware has an
explicit `PROTECTED_API_EXCLUDE` list for this — if you add more routes
under `/api/picks/**` in the future that are similarly global/public,
extend that list, don't just remove the exclusion.

**4. `app/login/page.tsx`** — thin custom sign-in/sign-up form (not
Supabase's hosted widget, to match this app's own design system: `lb-card`,
`text-masters`, etc. tokens already used throughout the codebase). Toggles
between sign-in/sign-up, shows a "check your email" state after signup
(Supabase's default email-confirmation flow). **Note: this file was
auto-corrected mid-session to wrap the `useSearchParams()`-using part in a
`<Suspense>` boundary** (`LoginPage` now just renders `<Suspense><LoginForm
/></Suspense>`) — this is a real, necessary Next.js App Router requirement
for any client component calling `useSearchParams()`, not a mistake to
revert.

**5. `components/AccountMenu.tsx`** (new) + wired into `components/TopBar.tsx`
— a self-contained sign-in/account-menu affordance that manages its own
auth state via `supabase.auth.onAuthStateChange()`, mounted directly inside
`TopBar` rather than threaded through as a prop (TopBar has ~9+ call
sites across every page; adding a prop everywhere would have been a much
bigger, unnecessary diff). Shows "Sign in" when logged out, an avatar-style
initial-letter button with a sign-out dropdown when logged in.

**6. `lib/db/client.ts`** — every picks/bets/watchlist CRUD function now
takes a `userId` parameter and filters/writes by it: `listPicks`,
`addPick`, `updatePickOdds`, `deletePick`, `clearPicks`, `listBets`,
`getBet`, `submitPicksAsBets`, `listWatchlist`, `addWatch`, `removeWatch`.
**Deliberately NOT changed**: `listOpenBetGameIds`, `listOpenBetsForGame`,
`markBetsLive`, `writeBetGrades` — these back the bet-grading job, which
settles bets against real game outcomes across ALL users, not one user's
request, so they stay global/unscoped. Don't add `userId` to these by
reflex if you're pattern-matching against the others.

**7. The 4 route files updated to match** (`app/api/picks/route.ts`,
`app/api/bets/route.ts`, `app/api/bets/[betId]/route.ts`,
`app/api/watchlist/route.ts`) — each gets the authenticated user via
`lib/supabase/server.ts`'s `createClient()` + `supabase.auth.getUser()`
(re-checked in the route handler itself even though `middleware.ts`
already blocks unauthenticated requests — defense in depth, not the
primary gate), and passes `user.id` through to every `lib/db/client.ts`
call. `/api/picks/game-history` was NOT touched (confirmed it doesn't call
any of the now-userId-requiring functions — it uses `gamePickRecord`/
`listGamePickHistory`, unrelated global functions).

**8. `components/useSlip.ts`** — every write call (`addPick`, `removePick`,
`clearSlip`, `submitPicks`, `setOdds`, `toggleWatch`) now checks for a 401
response and redirects to `/login?next=<current path>` via a shared
`redirectToLoginOn401` helper. Before this, a logged-out user clicking
"Add to slip" would have seen nothing happen with zero explanation (the
fetch calls were fire-and-forget, no `res.ok` check) — this was a real,
necessary UX fix once the routes started requiring auth, not optional
polish.

**9. `scripts/backfill-operator-account.js`** (new) — the one-time script
for the "attribute existing global data to the operator" decision. Not run
yet (needs a real signed-up account first). Usage:
`node scripts/backfill-operator-account.js you@example.com`. Looks up the
email in `auth.users`, then `UPDATE picks/bets/watchlist SET user_id = ?
WHERE user_id IS NULL` for each table. Safe to re-run (idempotent — only
touches still-`NULL` rows).

### What's NOT done yet in Phase 03 — pick up here

1. **`.env.local` is incomplete.** It now has (gitignored, not in git
   status, check it directly):
   - `NEXT_PUBLIC_SUPABASE_URL=https://qsqzercvwnzaeboltvca.supabase.co`
     — derived from `DATABASE_URL`'s own project ref, not pasted by the
     user, but should be correct (every Supabase project's URL follows
     this exact pattern).
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=` — **EMPTY, still needed.** The user
     was asked for this (Supabase dashboard → Project Settings → API) and
     chose to paste it in chat, but had not actually sent the value when
     this handoff was written. **Ask the user for it directly if it's
     still empty when you pick this up** — don't guess or fabricate a
     key. The app will not build/run correctly without it (both
     `lib/supabase/server.ts` and `lib/supabase/client.ts` read it via
     `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!`, non-null-asserted).
   - `SUPABASE_SERVICE_ROLE_KEY=` — filled in (user pasted it directly in
     chat this session). Not actually used by any code yet (the backfill
     script uses the direct `DATABASE_URL` connection instead, which
     already bypasses RLS as a privileged role — the service role key was
     saved for potential future use, e.g. an admin server action, but
     nothing currently depends on it). **This is a genuinely sensitive
     secret** (bypasses RLS entirely) — it's sitting in `.env.local`
     (correctly gitignored) but also now exists in this chat's own
     transcript history since the user pasted it directly rather than
     adding it to the file themselves. Low risk for a personal
     single-developer project, but worth a one-line heads-up to the user
     if you're ever unsure whether it needs rotating.

2. **Nothing has been tested end-to-end against a real browser yet with
   actual auth working** (Phase 02 was verified live in-browser; Phase 03
   has NOT been, because the anon key was still missing when work paused).
   Once the anon key is in `.env.local`:
   - Start the dev server (`preview_start` with the `linesmith-dev`
     config from `.claude/launch.json`, or `npm run dev` — see
     **environment quirks** below for a real gotcha about testing this
     specific app in a browser).
   - Sign up a real test account (or the operator's real one, per the
     data-migration decision) through `/login`.
   - Confirm you actually receive/can access the confirmation email
     Supabase sends by default — if the user can't easily check the inbox
     for whatever email they use, this blocks completing signup. Ask
     first rather than assuming.
   - After confirming, sign in, and verify: adding a pick actually
     persists (check the `picks` table has the row with the right
     `user_id`), the slip only shows that user's own picks, submitting to
     Live Bets works, `/bets` and `/bet/[id]` pages load correctly (not
     redirected to `/login` while genuinely signed in), and a *second*,
     different account does NOT see the first account's data (the actual
     multi-tenant correctness check — this is the single most important
     thing to verify, since the whole point of this phase was fixing the
     "one global instance" problem).
   - Confirm a logged-out visitor can still browse Scan/Player/Team/Game
     pages fine (those stay public), and that clicking "Add to slip" while
     logged out redirects to `/login` cleanly (via the `useSlip.ts` 401
     handling built this session) rather than silently failing.

3. **Run the backfill script** once the operator's own real account exists
   and is confirmed: `node scripts/backfill-operator-account.js
   <operator's real email>`. Verify row counts printed look right (should
   roughly match however many picks/bets/watchlist rows existed in the DB
   before auth landed — you can check with a quick `SELECT count(*) FROM
   picks WHERE user_id IS NULL` before and after, should go from
   nonzero/some-number to 0 assuming it's genuinely all the operator's own
   prior data).

4. **Not started at all**: Stripe/entitlements (deliberately phase 2 of
   auth, per the gameplan doc — don't start this without the user
   explicitly asking, it's a separate, later step even within Phase 03's
   own scope).

5. **Once Phase 03 is fully verified working**, update
   `docs/four-feature-gameplan-2026-08-22.md`'s Phase 03 section to mark
   it DONE (matching the style already used for Phase 02's "DONE
   (2026-08-22)" heading) with what was verified, then move to Phase 04
   (admin center) per the gameplan doc's own build steps — don't
   re-derive the plan, it's already written out in detail there.

---

## Known environment quirks hit this session (don't re-diagnose these)

- **The Next.js dev server in this environment is genuinely fragile under
  rapid edit+navigate cycles.** Editing a file while a page is open
  triggers Fast Refresh, which can remount polling hooks and stack up
  duplicate in-flight requests. This session hit response times of
  **200-390 seconds** purely from self-inflicted request pile-up (verified
  via `preview_logs` — the actual route handlers all eventually returned
  200 OK, just very slowly under the pile-up; no database connection-pool
  errors occurred). **Fix pattern that worked**: stop editing, `preview_stop`
  the dev server entirely, `preview_start` fresh, then do exactly ONE
  navigate + one patient wait (15-25s, checking `preview_logs` for
  completion) per verification step — do not rapid-fire navigate while
  also editing files.
- **`/api/props/calibration` is slow on a cold cache** (60-390+ seconds
  first hit, ~300ms once warm) — see Phase 02's section above. Unrelated
  to anything built this session; a real, separate, already-flagged issue.
- Browser tool's `navigate()` sometimes reports back
  `http://localhost:3000` regardless of the actual path navigated to —
  this is cosmetic (confirmed via `window.location.href` in
  `javascript_tool` matching the real intended URL); don't treat it as a
  navigation failure.
- `preview_stop` + `preview_start` (a full dev-server restart) is the
  reliable fix when the server's request queue gets backed up — don't try
  to "wait it out" past a couple of clean 20-30s checks; restarting is
  faster and cleaner than diagnosing a self-inflicted pile-up.

---

## How to verify DB-level state directly (methodology used this session)

No Supabase CLI is configured in this repo (no `supabase/config.toml`).
Migrations were applied and verified via small, throwaway Node scripts run
with `NODE_PATH` pointed at the project's `node_modules` (since a script
outside the repo directory won't resolve `pg` via normal `require`
resolution):

```bash
NODE_PATH="<repo>\node_modules" node <path-to-script>.js
```

The script itself manually parses `.env.local` (no `dotenv` package
installed in this repo — confirmed absent) to get `DATABASE_URL`, then
opens a plain `pg.Client` (not the app's own pooled `Pool` from
`lib/db/pgClient.ts`), runs whatever SQL/verification query is needed, and
closes the connection. This is the same general pattern
`scripts/migrate-to-postgres.js` (pre-existing in this repo) already uses.
Write a fresh throwaway script the same way for any further one-off DB
work — nothing reusable was left behind on purpose (scratch scripts lived
in a session-specific temp directory, not the repo).

---

## Summary — what to actually do first when you pick this up

1. Read `docs/four-feature-gameplan-2026-08-22.md` in full.
2. Run `git status --short` and `npm run typecheck` yourself to confirm
   the state matches this doc (it may have drifted if more work landed
   after this was written).
3. Check whether `.env.local`'s `NEXT_PUBLIC_SUPABASE_ANON_KEY` is filled
   in. If not, ask the user for it (Supabase dashboard → Project Settings
   → API → anon/public key) before doing anything that needs to actually
   run the app.
4. Once you have it: start the dev server, sign up/sign in for real,
   verify the full Phase 03 checklist in the "What's NOT done yet" section
   above.
5. Run the backfill script once the operator's real account is confirmed.
6. Mark Phase 03 DONE in the gameplan doc, then move to Phase 04
   (Diagnostics → admin center) per that doc's own Phase 04 section.
