# Linesmith Audit — Phase 5: Competitive & Standards Recommendations

> Researched and written 2026-08-27/28. **This document contains no bug
> findings.** Defects live in `docs/audit-phase-2.md`, `docs/audit-phase-3.md`
> and `docs/audit-phase-4.md`. This is about what a mature version of this
> product looks like and where you fall short of it.
>
> Where I reference Linesmith's own behaviour I verified it in the codebase or
> the database this session. Where I reference a competitor I have cited the
> source; I did not sign up for any paid product, so feature claims are as
> published, not as used.

---

## 0. The reframe you need before reading anything else

Phase 3 measured your model against the market and the result is unambiguous:

- Brier **0.2329** for the model vs **0.2294** for the market, on the 3,615
  rows where both exist. Paired t = 2.63. The model loses in **10 of 11
  markets**.
- Picks flagged `edge ≥ 3%` won **40.84%**. The market implied **41.02%**.
  The signal has no realised value.
- First-ever CLV measurement is **negative**: 27% of bets beat the closing
  reference, −4.6% ROI per unit (n=78, small).
- The fitted models are market-anchored by construction —
  `marketProbCentered` carries weight +3.5 (moneyline) and +3.7 (totals),
  while your own baseball features carry *negative* coefficients. Against a
  market-only baseline, the fitted models improve Brier by 0.0008 and 0.0025.
  That is noise.

I want to be direct, because you asked me to be: **Linesmith does not beat the
market, and the product cannot be positioned as though it does.** Any
marketing, any UI copy, any pitch built on "our model finds value the market
missed" is a claim your own database refutes. In a category where users risk
money on your numbers, shipping that claim is not just a credibility risk — in
several US states it is a regulated advertising claim (see §6).

**That is not the same as saying you have nothing.** You have something quite
good, and it is on the other side of the app:

| Asset | Size | Status |
|---|---:|---|
| Distinct bookmakers in `prop_odds` | **22** | live |
| Player-prop price rows | **290,663** | live |
| Player-prop line-movement points | **425,307** | collected, **surfaced nowhere** |
| Game-line movement points | **19,667** | collected, **surfaced nowhere** |
| Sports covered end-to-end | **8** (MLB, NFL, NBA, NHL, CFB, soccer, tennis, golf) | live |
| Historical game odds, de-vigged | 37,922 games, 2010–2026 | live |

Twenty-two books of player-prop pricing with 425,307 movement points, across
eight sports, is a genuinely differentiated dataset. It requires **no model at
all** to be valuable. Line shopping — showing a bettor that the price they are
about to take is available 15 cents better somewhere else — is a real,
provable, immediately-monetisable product. It is also the thing your users can
verify for themselves, which is exactly what a model's predictions are not.

Today `prop_odds_history` is read by two things: the grading pipeline and one
API route (`/api/props/line-history`) that **has no frontend consumer at all**
— I grepped for it. You are collecting the asset and showing none of it.

**So the strategic recommendation for this entire document is: stop selling
the model, start selling the prices.** Everything below flows from that.

---

## 1. The competitive landscape

I researched this independently rather than asking you who you were thinking
of. The market segments cleanly into four tiers.

### Tier 1 — Full +EV platforms ($99–$500/mo)

**OddsJam** is the category anchor: roughly $99/mo entry to ~$499/mo Platinum
(Gold at $199.99), covering ~40+ US sportsbooks with de-vigged odds, +EV,
arbitrage, middles, low-hold, promo conversion, a parlay builder, and a bet
tracker with CLV notifications and per-book CLV breakdowns. It also sells an
API on a "contact us" basis.

**Unabated** is the philosophical rival — CLV-first workflow, fair odds, props,
live pricing, ~$99/mo for Props+ and ~$199/mo Premium. Its proprietary
"Unabated Line" (a vig-free consensus) is sold separately at around $3,000/mo,
which tells you what the market pays for a *reference price* as opposed to a
prediction.

**What defines this tier:** breadth of books, speed, and de-vig sophistication.
Not prediction.

### Tier 2 — Prop specialists ($20–$40/mo)

**Props.cash** (~$19.99/mo) covers sportsbooks *and* DFS pick'em lines.
**Outlier** (~$35/mo) is notable for publishing an explicit comparison of
**seven** de-vig methods and stating openly that they are still researching
which performs best under which conditions. **Betsniper** (~$20/mo) bundles
surebets, several EV approaches, middles, odds comparison and prop research.
**Betstamp PRO** positions explicitly as "the pricing and data layer."

**This is your competitive set.** Not OddsJam.

### Tier 3 — Free / freemium

**DumbMoneyPicks.ai** is the most complete free offering — +EV scanning across
15+ books plus game-script analysis, player projections, DVP matchup data,
injury impact and line-movement monitoring. **DarkHorse Odds** competes on a
clean, straightforward interface. **PickTheOdds**, **BettorEdge** and
**OddsLogic** occupy similar ground.

**Why this tier matters most to you:** it sets the floor on what users will pay
for. A free product already gives away multi-book +EV scanning *and* injury and
line-movement data. Anything Linesmith charges for has to be above that line.

### Tier 4 — Data/API providers (your suppliers, and a possible business)

SportsGameOdds ($99–$499/mo, 80+ books incl. Pinnacle), SharpAPI ($79–$399/mo;
no-vig lines from Pro $229, Pinnacle-sourced at Sharp $399), PinnOdds
($99–$229/mo), PinnAPI (free at 100 req/day, paid from $99). Pinnacle's own
direct feed was ~€5,000/mo and is no longer publicly sold.

**This answers Phase 3's open question 4 directly.** A Pinnacle-class sharp
reference — which your redesigned edge calculation depends on and which
currently has 3.3% coverage — is a **$99–$399/month purchase**, not a build.
That is the single highest-leverage cheque in this document.

---

## 2. Feature gaps

Marked **[S]** standard (users will expect it and be confused by its absence),
**[D]** differentiator. Effort is calendar time at your pace. "Data needed"
tells you which of these you're already positioned for.

### 2.1 You should build these — the data is already in your database

#### G1 · Line-movement charts **[S]** — *the single biggest gap*
Every tool in every tier shows how a price moved from open to now. You have
**425,307 prop movement points and 19,667 game-line points** and display none
of them. There is no chart component in `components/` at all.

- *Data needed:* **none.** `prop_odds_history` and `game_odds_history` already
  hold it, with the right indexes.
- *Effort:* 2–3 days (one sparkline component, one detail chart, wire into
  `PropOddsPanel` and `GameLine`).
- *Why it's first:* it converts a dataset you already pay to collect into
  visible product value, with zero new plumbing, and it's the most-cited
  feature in every competitor's marketing.

#### G2 · Freshness on every price **[S]**
Competitors treat price age as a first-class display element. Your
`OddsChip` is actually **better designed than most** — it distinguishes
provenance (fetched vs hand-entered vs screenshot), carries `capturedAt`, and
correctly distinguishes "provider reports 0s delay" from "provider doesn't
disclose delay," which is a subtlety most tools get wrong. The gap is that
this lives in a `title` tooltip. It needs to be *visible*: a relative
timestamp, and a visual state when a price crosses a staleness threshold.

Phase 4 §5.1 makes this urgent rather than cosmetic — your most likely
production failure mode is providers silently hitting daily caps while the UI
shows six-hour-old prices as though they were live. **Users betting real money
on stale prices, with no indication, is the worst outcome this app can
produce.**

- *Data needed:* none — `fetched_at`, `is_delayed`, `delay_seconds` are all
  already on `prop_odds`.
- *Effort:* 1 day.

#### G3 · CLV tracking, shown to the user **[D]**
CLV — did you beat the closing line? — is the metric serious bettors use to
judge whether an edge is real. OddsJam sells CLV notifications and per-book
breakdowns; Unabated's whole workflow is CLV-first; Trademate markets CLV
tracking as its proof-of-edge feature.

You already have `bets` with `american_odds` and `submitted_at`, and
`game_odds_history`/`prop_odds_history` to establish a closing reference. Phase
3 computed CLV once, internally, on 78 rows. **Users see none of it.**

This is also the honest version of the thing your model can't do: instead of
telling a user your model likes a pick, tell them whether *their own* bets have
beaten the close. That is a claim you can actually stand behind.

- *Data needed:* none new, but you need a **defined closing reference** — the
  last observed price before `commence_time`, per book or consensus. Pick one
  and document it.
- *Effort:* 3–4 days.

#### G4 · Selectable de-vig method **[D]**
Linesmith implements exactly one method — multiplicative — in
`lib/odds/devig.ts`, and the docstring is honest about it. Multiplicative is
the standard because it's simple, but it ignores the favourite–longshot bias:
it systematically over-states the fair probability of longshots. **Every player
prop over/under with a longshot side is affected**, which is most of your
product.

The recognised alternatives are **power** (raise probabilities to a constant
exponent; widely regarded as the best general default because it corrects
favourite–longshot bias without overcorrecting), **Shin** (iterative, corrects
more aggressively), additive, probit, and "worst case" (the most conservative
across methods). Outlier exposes all seven and says publicly they're still
researching which wins where. Crazy Ninja Mike's Devigger has offered method
choice for years.

- *Data needed:* none — pure math on prices you already have.
- *Effort:* 2 days for power + Shin + worst-case behind a user setting; a week
  if you also want to backtest which one calibrates best on your own
  `pick_history`. **Do the backtest** — you have 3,615 rows with both model and
  market probabilities, which is exactly the dataset for it, and "we tested
  four de-vig methods against 3,615 graded outcomes and chose power" is a
  genuinely differentiating, honest claim.

#### G5 · Correlated-prop warnings **[D]**
Nothing in Linesmith tells a user that a batter's hits, total bases, runs and
RBIs are the same underlying event four ways. Books know this — FanDuel,
DraftKings and BetMGM all price SGP legs with correlation adjustments — and
FTN's SGP tool simulates full outcome distributions to surface it. A user
building a four-leg "parlay" out of correlated props on your slip is taking a
far more concentrated position than the displayed odds imply.

You have a bet slip. You have `dimension`/`market_key` per leg and `game_id`.
A first version is a static correlation map (same subject + related markets =
warn; opposing pitcher Ks vs opposing batter hits = warn) shown as a banner.

- *Data needed:* a hand-authored correlation map for the ~10 MLB markets, then
  per sport. Genuinely empirical correlations need joint outcome data —
  `player_game_history` (830 MB!) may already support that later.
- *Effort:* 3 days for the static version; weeks for empirical.
- *Why it's a differentiator:* it's a feature that *protects* the user, which
  is rare in this category and is exactly the trust posture §5 argues for.

#### G6 · Alerts **[S]**
Steam alerts and line-movement notifications are table stakes in Tiers 1–3.
You have the movement data. What you don't have is any notification channel,
any user preference storage, or a running server to evaluate them.

- *Data needed:* none new; needs a `user_alerts` table and a delivery channel
  (email via Resend/Postmark, or web push).
- *Effort:* a week, and **it depends on hosting the app** (Phase 4 §1 — there
  is no deployed web app today). Defer until after deployment.

### 2.2 You need to buy data for these

#### G7 · A Pinnacle-class sharp reference **[D]** — *the highest-leverage purchase*
Your redesigned edge model needs a sharp reference and has **3.3% coverage**.
This is a $99–$399/month line item (PinnOdds $99–$229; SharpAPI's Pinnacle tier
$399; SportsGameOdds $99–$499 including Pinnacle). Unabated charges $3,000/mo
for their equivalent consensus line, which tells you the market value of the
input you're missing.

**Buy, don't build.** Every hour spent approximating a sharp line from soft
books is an hour spent rebuilding something available for less than your
current provider spend.

#### G8 · Book limits **[D]**
Sharp tools display how much a book will actually take at a price. A +EV bet
you can only get $12 down on is not the same product as one you can get $2,000
down on. This is a real gap versus Tier 1, and it needs a feed that carries it.

#### G9 · DFS pick'em lines (PrizePicks, Underdog) **[S in the prop segment]**
Props.cash covers these at $19.99/mo. Many prop bettors live primarily in DFS
pick'em. If props are your focus, their absence is conspicuous.

### 2.3 Where you are genuinely ahead

Say this out loud in any positioning, because it's real:

- **Eight sports with full player, team and game detail pages**, sharing one
  adapter architecture. Most prop tools are NFL/NBA/MLB and thin elsewhere.
  Your tennis, CFB, NHL and golf coverage is unusual.
- **Price provenance done properly.** The `OddsChip` provenance model —
  distinguishing fetched from hand-entered from screenshot-imported, and
  "delay unknown" from "no delay" — is more careful than what most competitors
  ship.
- **Screenshot odds import** (`/api/odds/import`). I've not seen this
  elsewhere. It's a genuine convenience feature for a bettor reconciling a slip
  from their phone.
- **A 16-year de-vigged historical odds corpus** (`historical_odds`, 37,922
  games, 2010–2026). Most tools have months of history. Even without a winning
  model this is a research asset.

---

## 3. Data depth gaps

What competitors surface that you don't, and what each would take:

| Data | Who has it | You have | To get it |
|---|---|---|---|
| Line movement charts | everyone | **the data, no UI** | build the UI (G1) |
| Book limits | Tier 1 | none | paid feed (G8) |
| Sharp/Pinnacle reference | Tier 1–2 | 3.3% coverage | $99–399/mo (G7) |
| DFS pick'em lines | Props.cash, others | none | new provider (G9) |
| Injury impact on props | free tools have this | `/api/mlb/injuries` exists but is not joined to prop pricing | join existing data — ~2 days |
| Weather | some | tennis only (`/api/tennis/[tour]/weather`) | extend to MLB/NFL; you already have the shape |
| Player projections | free tools have this | model exists but doesn't beat market | see §0 — reposition, don't extend |
| Historical CLV by book | Tier 1 | data exists, never computed | build (G3) |
| Book-lag / slow-mover analysis | Tier 1 | **fully derivable from `prop_odds_history`** | build — high value, no new data |

**Note the pattern.** Six of these ten need no new data. You have been
accumulating a strong dataset and building models on top of it, when the higher
return was in *displaying* it.

**Book-lag analysis** deserves special mention: 425,307 timestamped
multi-book price points is precisely the raw material for "which book moves
last," which is one of the most valuable things a line-shopping tool can tell a
user, and it is derivable today with a SQL query and a chart.

---

## 4. UX conventions you deviate from

The odds screen is a settled genre. The conventions:

1. **A dense, sortable, filterable grid is the primary surface** — books as
   columns, markets as rows, sortable by EV/edge/hold. Users expect a
   spreadsheet, not a card layout. Worth auditing your Scan table against this
   directly.
2. **Customisable columns and saved profiles.** Serious users keep different
   layouts for game lines, props and live. Not a v1 requirement, but expected
   by the users who pay the most.
3. **Best price is highlighted, always.** You do this
   (`bestPrice` in `PropOddsPanel`, `GameLine.tsx`'s single-winner rule — and
   the reasoning in that comment about not marking near-best prices green is
   correct). **Keep it.**
4. **Price age is visible, not hidden in a tooltip.** See G2.
5. **One-click from a price to the book.** Deep links into the sportsbook are
   standard, and are also how affiliate monetisation works (§6).
6. **Bet tracking with automatic grading.** You have this — `bets` +
   `gradeOpenBets`. It's a real feature; competitors charge for it.
7. **Explicit hold/vig percentage per market.** Users use low-hold markets as a
   signal in their own right. You compute de-vigged probabilities already; the
   hold is one subtraction away and you don't show it.

**The deviation most likely to confuse people:** Linesmith presents model
outputs (grades, scores, edge) with equal or greater visual weight than
prices. In this category the price *is* the product, and users read a
prominently-displayed model number as a claim of predictive edge. Given §0,
that placement is actively misleading. Demote model outputs; promote prices,
movement and freshness.

---

## 5. Trust and transparency

This matters more here than in almost any other software category, because
users convert your numbers directly into money at risk.

The emerging standard for anyone publishing picks or probabilities is: publish
**what the model does, what data goes in, how EV is computed, and a complete
timestamped record of every pick including losers.** Aggregate accuracy
percentages without sample sizes are correctly read as marketing rather than
evidence.

### What Linesmith should do

**T1 · Publish the model's real record, including that it loses to the market.**
This sounds like commercial suicide and is the opposite. Nobody else in this
category publishes a market-relative Brier score. Being the tool that says
"here is our model, here is the market, here is the 3,615-game comparison, the
market currently wins" is a *stronger* trust position than another unfalsifiable
accuracy claim — and it is the only honest option given your own data.

*Data needed:* none. `pick_history` has it. *Effort:* 2 days for a public
methodology page.

**T2 · Stop displaying `edge ≥ 3%` as actionable.** Those picks won 40.84%
against a 41.02% market implication. Either recompute edge against a real sharp
reference (G7) or remove the display. Showing a number you have measured to
have no realised value is the single largest trust liability in the product.

**T3 · Show sample size everywhere a rate is displayed.** You already carry
`sample_size` on `pick_history` and `picks`. A win rate over 11 games and one
over 1,100 must not render identically.

**T4 · Disclose data freshness and provider coverage.** "22 books, updated
3 minutes ago, 4 of 22 stale" is a trust signal *and* an honest
representation of a real limitation.

**T5 · Distinguish backfilled from live results.** 87% of `pick_history` is
`event_context='backfill'`, and Phase 2 found backfilled rows carry
`surfaced_at = graded_at` — no evidence the prediction preceded the outcome.
Any user-facing record must exclude backfill or label it unmistakably.
Presenting a backfilled record as a track record is the exact behaviour the
industry criticises touts for.

---

## 6. Legal and compliance — the part a solo builder wouldn't know to look for

**I am not a lawyer and this is not legal advice.** These are the areas where
this category carries real regulatory weight and where you should get an actual
opinion before taking money or opening signups.

Right now Linesmith has **none** of the following. I grepped for every one:
no responsible-gambling text, no helpline, no age gate, no terms of service, no
privacy policy, no "not financial advice" disclaimer, no jurisdiction notice.
With one user (you) that's fine. On the day a stranger can sign up, it is not.

**C1 · Responsible gambling is now the regulatory centre of gravity.** 2026's
legislative wave across US states is focused on responsible gaming and consumer
protection rather than market expansion. Expected: prominent problem-gambling
resources (1-800-GAMBLER), age restrictions displayed, self-exclusion
awareness. *Minimum:* a persistent footer with helpline and 21+/18+ notice.

**C2 · Affiliate rules are state-by-state, and the operator carries the
liability.** If you deep-link to sportsbooks for revenue (§7), you're an
affiliate. Rules differ per state, FTC endorsement guidance applies to
disclosure, and — critically — **when an affiliate breaks advertising rules the
regulator penalises the operator**, which is why sportsbooks drop
non-compliant affiliates fast. Several states require affiliate registration.

**C3 · Jurisdiction restrictions.** Sports betting is legal in 38 states with
materially different rules. A tool linking to books must handle geography.
*Minimum:* a state selector that filters which books are shown.

**C4 · Selling picks may make you a "tout."** Several states regulate paid
sports-pick services specifically. **Selling data and prices is a materially
safer legal posture than selling predictions** — which happens to align exactly
with §0's strategic recommendation.

**C5 · Terms of service and privacy policy are not optional** once you store
user accounts and betting history. You store email addresses (Supabase Auth)
and bet records. Depending on user location, GDPR/CCPA obligations attach.

**C6 · Check your data providers' terms.** Redistributing odds data to third
parties is restricted under most feed licences. Displaying it in your product
is normally fine; exposing it via a public API (or, per Phase 4's C1, leaving
it readable by anyone with your anon key) may breach the licence you're paying
under.

**Priority:** C1 and C5 before *any* public signup. C2 and C3 before any
affiliate revenue. C4 before charging for picks — and preferably by never
charging for picks.

---

## 7. Monetization

What's actually used in this market:

| Model | Examples | Fit for Linesmith |
|---|---|---|
| Subscription, tiered by books/features | OddsJam ($99–499), Unabated ($99–199), Props.cash ($20), Outlier ($35) | **Best fit.** Aim at Tier 2: $15–30/mo |
| Freemium with a limited free scanner | DarkHorse, PickTheOdds, DumbMoneyPicks | Necessary — the free tier sets the floor you must clear |
| Affiliate revenue on book signups | most odds sites | Real money, but see C2/C3 |
| API/data licensing | OddsJam ("contact us"), Unabated Line ($3,000/mo) | Plausible *later* — your 8-sport prop history is genuinely licensable |
| Selling picks | tout services | **Avoid.** Legally riskiest (C4) and unsupported by your data (§0) |

**Recommended structure:**

- **Free:** all 8 sports, best price across books, 24h line movement, bet
  tracking. This has to be competitive with DumbMoneyPicks or nobody arrives.
- **Paid (~$20/mo):** full movement history, CLV tracking, alerts, de-vig
  method selection, book-lag analysis, unlimited watchlist/tracked lines.
- **Affiliate:** deep links from every price, once C2/C3 are handled.

The structural implication of tiering — and the reason it belongs in an audit —
is that **you currently have no entitlement layer at all.** `middleware.ts`'s
own comment says auth and paying are deliberately kept separate and there is no
paywall check anywhere. That's a correct decision for the auth phase and a real
piece of work before you can charge.

---

## 8. Engineering standards

You asked which of these are actually necessary at your stage versus premature.
I've been strict about it: **five of the twelve are worth doing now.** The rest
genuinely can wait, and I'd rather you did five properly.

### Do now

#### E1 · Automated tests on the TypeScript side — **necessary**
**What it is:** code that runs your code and asserts on the output, run
automatically on every change.

**Where you stand:** 19 real test files in `python-odds-service/`
(`test_walkforward.py`, `test_mlb_stacking.py`, `test_providers.py` and so on
— genuinely good coverage of the model layer). On the TypeScript side:
**zero**. No `*.test.ts` anywhere, no test script in `package.json`.

**Why it matters here specifically:** every Critical finding in Phase 3, and
every Critical and High in Phase 4, is in TypeScript. That is not a
coincidence. Your Python is tested and comparatively sound; your TypeScript
carries the odds math, the de-vig, the price display, the auth middleware and
the write paths, and nothing checks any of it.

**What to test first** — not everything, just the code where a silent wrong
number costs money:
- `lib/odds/devig.ts`, `lib/odds/display.ts` (American↔decimal conversion) —
  pure functions, table-driven tests, an afternoon
- `lib/odds/matching.ts` (`teamKey`) — team-name matching silently dropped 30
  of 37 games on the day I measured `/api/odds/lines`
- `lib/db/pgClient.ts`'s `compile()` — including the `?`-in-literal trap
  (Phase 4 M11)
- `middleware.ts` path matching — encode the §2.1 results as tests so an auth
  regression fails loudly

*Effort:* Vitest, 2 days for the first meaningful suite. **Highest-value
engineering investment available to you.**

#### E2 · CI — **necessary, and nearly free**
**What it is:** those tests plus `tsc --noEmit` and a build, run automatically
on every push.

**Where you stand:** one GitHub Actions workflow, `oddsharvester-scrape.yml`,
which is `workflow_dispatch`-only and explicitly documented as a manual
diagnostic. **No CI at all.**

**Why now:** you have `typecheck` and `build` scripts already and run them by
hand. The value isn't the commands, it's that they run when you *forget* — and
with 212 uncommitted files, forgetting is the current default.

*Effort:* a 20-line workflow. **One hour.**

#### E3 · Error tracking — **necessary**
**What it is:** a service that captures every unhandled exception with stack
trace and context, and tells you.

**Where you stand:** `console.error` to a terminal nobody watches, plus
`logSystemEvent` into `system_events` — which is genuinely a decent
poor-man's version, and it's how I found the real `EMAXCONNSESSION` and
statement-timeout errors. But only some code paths call it, and nothing alerts.

**Why now:** Phase 4 H5 is the argument. A silent cache-write failure degraded
every route in the app to zero caching, with 200 responses throughout and no
signal anywhere.

*Effort:* Sentry's free tier, `@sentry/nextjs`, ~2 hours.

#### E4 · Backup and recovery — **necessary**
**What it is:** a restorable copy, and *proof you have restored it*.

**Where you stand:** unknown to me — Supabase's built-in backups depend on your
plan. Free tier historically has none; Pro has daily with 7-day retention.

**Why now:** `pick_history` is 362,616 rows of your own graded predictions.
It cannot be re-derived from any public source. Phase 4 C1 means it is
currently deletable by anyone. Even after you fix C1, one bad migration does
the same thing.

*Effort:* confirm your plan's backup policy (15 min); add a weekly
`pg_dump` of the irreplaceable tables to cloud storage (2 hours); **restore it
once into a scratch project to prove it works** (2 hours). An untested backup
is not a backup.

#### E5 · Deployment — **necessary, and it unblocks everything**
**What it is:** the app running somewhere that isn't your laptop.

**Where you stand:** Phase 4 §1 — the `Linesmith` Render service was deleted;
only the Python worker and its health-check cron remain. The web app exists
only on your machine, served with `next dev -H 0.0.0.0`.

**Why now:** it blocks alerts (G6), any real user, any uptime claim, and it
means the app's in-process schedulers only run when you happen to have a
terminal open. Vercel is the natural home for a Next app; Render works too and
you're already there.

*Effort:* half a day. **Do it after Phase 4's C1, H2 and H4 — not before.**
Deploying the current unauthenticated write surface to a public URL would be
strictly worse than the status quo.

### Later — real, but genuinely premature

- **Structured logging / log aggregation.** `system_events` + Sentry is
  enough until you have multiple instances.
- **Uptime monitoring.** `health_check.py` already covers job liveness
  intelligently (2× each job's own interval). Add a free UptimeRobot ping once
  E5 lands — 10 minutes, so do it then.
- **Staging environment.** Premature. But **never point a staging app at the
  production database** — `snapshot_cache` is one flat namespace and would
  collide immediately.
- **Secrets management (Vault, Doppler).** `.env.local` gitignored and never
  committed, plus Render's env vars, is fine for one operator. Revisit at the
  first additional engineer. **Do** delete the unused
  `SUPABASE_SERVICE_ROLE_KEY` and rotate it (Phase 4 L2).
- **Dependency automation (Dependabot/Renovate).** Worth enabling once CI
  exists — otherwise it just generates PRs nothing validates.
- **Load testing.** Premature until E5. Then `k6` against staging, to replace
  Phase 4 §5's estimates with measurements.
- **Formal migrations.** You have applied migrations; Phase 2 flagged three
  that exist only on your laptop. Get them committed — that's a `git add`,
  not a tooling project.

### The one you can't defer: two implementations of the same logic

Phase 3 measured **22 of 35 tables with writers in both TypeScript and
Python**, with self-described "direct ports" that have already drifted (golf
has two live prediction pipelines writing the same tables from separately
maintained code). There is no advisory locking and no ownership boundary.

This is a *design* problem, not a tooling problem, and no amount of monitoring
fixes it. The rule to adopt: **for each table, exactly one language writes it.**
Write it down, table by table, and make the other side read-only. Until that
exists, every bug in this class costs double to find and can be reintroduced
from the other side after you fix it.

*Effort:* a day to write the ownership map; weeks to converge on it. Start with
the map — it's cheap and it makes the drift visible.

---

## 9. Priorities

Ordered by what unblocks or protects the most, not by ease. Phase 4 fixes are
referenced but not repeated.

### P0 — before any user other than you
1. Phase 4's §6 list (RLS, operator auth, `/api/odds/lines`, pooler, rate
   limit, open redirect). Nothing here proceeds without it.
2. **C1 + C5** — responsible-gambling footer, ToS, privacy policy. Half a day.
3. **T5** — exclude or unmistakably label backfilled rows in anything
   user-facing. Half a day.

### P1 — the product thesis (4–6 weeks)
4. **G1** line-movement charts — 3 days. *The highest-value feature you can
   ship, using data you already have.*
5. **G2** visible price freshness — 1 day.
6. **T2** stop displaying unvalidated edge — 1 day.
7. **E1 + E2** tests and CI on the odds math — 3 days.
8. **E5** deploy — half a day (after P0).
9. **E4** backups, restore-tested — half a day.
10. **G7** buy a Pinnacle-class feed — $99–399/mo, one afternoon to integrate.

### P2 — differentiation (6–10 weeks)
11. **G3** user-facing CLV — 4 days.
12. **G4** selectable de-vig, backtested on your own 3,615 rows — 1 week.
13. Book-lag analysis from `prop_odds_history` — 3 days.
14. **T1** public methodology page — 2 days.
15. **G5** correlated-prop warnings — 3 days.
16. **E3** Sentry — 2 hours.

### P3 — monetization (after P1/P2 prove retention)
17. Entitlement layer (there is none today) — 1 week.
18. **C2/C3** affiliate compliance and state filtering — 1 week.
19. **G6** alerts — 1 week.
20. TS/Python write-ownership map — ongoing.

### Explicitly deprioritised
- **Model improvement.** Phase 3's numbers say the returns are near zero
  relative to everything above. The `simWinProb` (+2.29) and `simOverProb`
  (+1.04) coefficients mean `sim_engine.py` is the second-largest model input
  and remains entirely unaudited — worth a look eventually, but not before the
  product has users.
- **New sports.** Eight is already more than most competitors. Depth beats
  breadth from here.

---

## 10. My honest read: the three things I'd do first

**1. Fix the database permissions (Phase 4 C1). Today, before anything else.**

Not because it's likely to be exploited tomorrow — your app isn't even
deployed. Because everything else in this document assumes the data survives.
`pick_history` is 362,616 rows of your own graded predictions and it is
genuinely irreplaceable; no backfill regenerates it, because it is a record of
what your model said *before* outcomes were known. Right now anyone who reads
your JavaScript bundle can delete it with one HTTP request, and you have no
tested restore path. Twenty minutes of SQL removes the single largest
existential risk to the work of the last year. There is no argument for
sequencing anything ahead of it.

**2. Stop building the model. Ship line movement and freshness instead.**

This is the hard one, because the model is where the work went. But your own
database says the model loses to the market in 10 of 11 markets, that the
`edge ≥ 3%` signal has no realised value, and that the fitted models beat a
market-only baseline by 0.0008 Brier — which is another way of writing zero.
Meanwhile you are sitting on 425,307 line-movement points across 22 books and 8
sports, and **displaying none of it**, while every competitor in the category
markets exactly that feature.

Line shopping needs no model, is verifiable by the user, is legally the safest
posture (§6 C4), and is the thing you already have more of than most tools.
Three days of chart work converts a dataset you already pay to collect into the
product's core value. That is the best return available to you by a wide margin,
and it is available right now.

**3. Write tests for the odds math, and put CI in front of them.**

Every Critical finding across Phases 3 and 4 is in TypeScript, and the
TypeScript has no tests while the Python has nineteen files of them. That
correlation is not an accident and it will keep producing findings. The code
that converts prices, removes vig, matches team names and gates auth is small,
pure, and trivially testable — and it is exactly the code where a silent wrong
number costs a user real money without anyone noticing. On the day I measured
`/api/odds/lines`, team-name matching silently dropped 30 of 37 games and
nothing anywhere flagged it.

Two days of Vitest plus one hour of GitHub Actions changes the economics of
every subsequent change you make. Without it, you will keep finding these by
audit, which is the slowest and most expensive way to find anything.

---

## Sources

- [Best Free Player Prop Research Tools (2026)](https://www.dumbmoneypicks.ai/guides/best-free-player-prop-research-tools-2026)
- [Betstamp PRO vs OddsJam (2026)](https://betstamp.com/comparison/oddsjam) · [Betstamp PRO](https://www.betstamp.com/pro) · [Betstamp](https://www.betstamp.com/)
- [7 Best OddsJam Alternatives for Sharp Bettors (2026) — ProfitDuel](https://www.profitduel.com/blog/oddsjam-alternatives) · [7 Best Outlier Alternatives](https://www.profitduel.com/blog/outlier-alternatives) · [5 best positive EV betting tools](https://www.profitduel.com/blog/5-best-positive-ev-betting-tools)
- [OddsJam Alternatives — Oddible](https://oddible.ai/blog/oddsjam-alternatives-5-cheaper-options-that-actually-work) · [OddsJam Pricing (2026) — ArbBets](https://getarbitragebets.com/blog/oddsjam-pricing) · [OddsJam Review 2026 — XCLSV](https://xclsvmedia.com/oddsjam-review-2026-is-this-199-month-betting-tool-worth-it/)
- [Unabated — Finding Positive EV Wagers](https://unabated.com/post/finding-positive-ev-wagers-step-by-step-guide)
- [How to Devig Odds — Comparing the Methods (Outlier)](https://help.outlier.bet/en/articles/8208129-how-to-devig-odds-comparing-the-methods) · [Devigging Methods Explained — Bet Hero](https://betherosports.com/blog/devigging-methods-explained) · [Five Devigging Methods Compared](https://betherosports.com/blog/how-to-find-the-true-odds) · [Devigger Help Guide — Crazy Ninja Mike](http://crazyninjamike.com/public/sportsbooks/sportsbook_devigger_help.aspx)
- [Best Free CLV Calculators in 2026 — XCLSV](https://xclsvmedia.com/best-free-clv-calculators-2026-track-closing-line-value/) · [5 Must Use Closing Line Value Betting Tools](https://oddsplays.com/us/betting-tools/closing-line-value/) · [Closing Line Value — PropsBot](https://propsbot.ai/glossary/closing-line-value/)
- [Odds Screen Guide — PickTheOdds](https://picktheodds.app/en/blog/the-ultimate-guide-to-odds-screens-in-sports-betting) · [The Sportsbook Screen — EdgeSlip](https://edgeslip.com/articles/sportsbook-screen) · [Line Movement & Steam Tracking Tools](https://oddsplays.com/us/betting-tools/line-movement-trackers/) · [Steam Moves Guide — XCLSV](https://xclsvmedia.com/how-to-use-steam-moves-sports-betting-sharp-action-2026/) · [OpticOdds Odds Screen](https://opticodds.com/odds-screen)
- [FTN NBA Same Game Parlay Tool](https://ftnfantasy.com/bets/nba/same-game-parlay-tool) · [Player Props & Team Totals: Correlation Risk — LSports](https://www.lsports.eu/blog/player-props-team-totals-correlation-risk/) · [Correlated Parlay Guide — OddsIndex](https://oddsindex.com/guides/correlated-parlay-guide)
- [Pinnacle Odds API — SharpAPI](https://sharpapi.io/sportsbooks/pinnacle-odds-api) · [Best Sports Betting APIs 2026 — SharpAPI](https://sharpapi.io/compare/best-sports-betting-apis) · [Odds API Pricing 2026 — OddsPapi](https://oddspapi.io/blog/odds-api-pricing-2026-comparison/) · [Pinnacle Odds API — SportsGameOdds](https://sportsgameodds.com/bookmakers/pinnacle-odds-api) · [PinnOdds](https://pinnodds.com/) · [PinnAPI](https://pinnapi.com/)
- [Sports Betting Affiliate Programs 2026 — Track360](https://track360.io/blog/sports-betting-affiliate-programs-2026) · [US Sports Betting State Map 2026](https://track360.io/blog/us-sports-betting-state-by-state-operator-map-2026) · [Responsible Gambling Rules Tighten Across US in 2026](https://www.deucescracked.com/blog/responsible-gambling-regulation-wave-2026) · [Sports Betting Affiliate Marketing 2026 — BettingUSA](https://www.bettingusa.com/affiliate/) · [Legal Sports Betting States 2026 — RG.org](https://rg.org/guides/regulations)
- [Betting Algorithm Transparency — SmartMatchPick](https://smartmatchpick.com/guides/betting-algorithm-transparency) · [Verified Track Records Audit — TipsterGPT](https://www.tipstergpt.com/blog/best-betting-tips-websites-verified-track-records) · [How to Verify Sports Tipster Claims](https://www.honestbettingreviews.com/verify-sports-tipsters/)

---

*End of Phase 5.*
