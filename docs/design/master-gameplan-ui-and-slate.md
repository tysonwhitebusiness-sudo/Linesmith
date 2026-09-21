# Master gameplan — models, UI system, Slate

**Status: 2026-09-20. M0–M3 BUILT AND DEPLOYED (`dep-danoti942hec73f7n6i0`,
live 07:45 UTC); every sport now has a game model; U and S not started.** One ordered plan for
three tracks that ship together:

- **M — models and data.** What the app is allowed to claim, and the data the
  Slate needs. Python only; no UI files; can start now.
- **U — the UI system.** The locked kit (`docs/design/ui-system-master-prompt.md`).
- **S — the Slate.** Scan's body becomes the Slate on every sport's page
  (`docs/design/slate-sheet-cards.md`; approved look:
  `docs/design/slate/slate.html`).

**How to use this file.** Work the stages in §4 top to bottom. Each phase is a
build prompt: what to read, what to build, what "done" means, the guard test it
adds, how to verify, what to stop for. Update its row in §5 when it ends. Where
this file and a track spec disagree, this file wins on **order and scope**, the
spec wins on **detail**.

---

## 1. Decisions (operator, 2026-09-19)

| # | decision |
|---|---|
| D1 | The Slate **replaces Scan in place** at `/{sport}`. Not a new page. |
| D2 | The chrome is unchanged: `TopBar` (its **Scan** tab renamed **Slate**) and the date strip with the game scroller, which is always part of the top bar. No second sport picker, date control or page title. |
| D3 | **The Scan TABLE does not change at all** — `ScanTable` and `ScanCard`: columns, cells, colors, heat, rank chips, row layout. **Everything else about Scan may change** to fit the new UI: its tabs, search, view toggles and filter pills are rebuilt on the kit. |
| D4 | The mockup's design is approved for everything else: section order, GameCard, Movers, Price outliers, Line disagreements, Spotlights, Specials, Model, Your lines, sticky section links. |
| D5 | All sports, in phases: each S phase ships for **every** sport at once, through one adapter per sport. |
| D6 | The Slate's new sections are built **on the U kit, after U2**. |
| D7 | The Specials pilot set is the list in the spec. No admin-entered "specials at the books" list. |
| D8 | U track decisions stand as locked. |
| D9 | **Keep the simple Elo guesser** (NFL, CFB, NHL), **Slate only**, as a green ring on the picked team's logo. No model card, no probability, no record. Measured: it picks the market favorite on 95–100% of games, so the card marks the rare pick that goes against the favorite. |
| D10 | **Receipts grade the top 5.** |
| D11 | **Simple models stand in until a researched one passes its gate.** They are separate code, not a slice of the researched ones. Made a policy by M1: a register, display tied to status, a scheduled promotion test. |

## 2. Standing rules for every phase

1. **Build → `tsc --noEmit` → tests → `npm run build` → render → compare →
   commit by explicit path → stop for sign-off.** Use `LB_DIST_DIR=.next-verify`
   while a dev server holds `.next`.
2. **Render in a fresh tab** (`tabs_create`) at 1440 and 400, for every sport the
   phase touches: MLB, NFL, CFB, EPL, MLS, NBA, NHL, ATP, WTA, golf. A sport out
   of season renders its real empty state; name it in the write-up.
3. **Subtract in the same phase.** Replacing something deletes the old thing in
   the same commit.
4. **Python writes, TypeScript renders.** New tables get a
   `docs/table-ownership.md` row. No GET handler writes.
5. **Routes go through `cachedRoute()`.** Grep the cache key first — one flat
   `snapshot_cache` table, no namespacing.
6. **Sport adapters.** `SlatePage` never branches on sport:
   `lib/sports/{sport}/adapters/slateAdapter.ts` → `toSlateData`. A sport with no
   data for a section leaves it unset; the section hides.
7. **Honesty.** No edge anywhere. `Model %` may sit beside `IP` only where M1's
   register says `gated`; nothing computes, sorts by or colors their difference
   (`tests/scan-no-edge.test.ts`). Movement, price gaps and rankings are captioned
   as market information, not predictions.
8. **`ScanTable` and `ScanCard` are frozen** (D3), except U0's mechanical
   Tailwind conversion. A content-hash guard enforces it from S1.
9. **Ask before any Render deploy.** Check the 15-connection pooler before DB
   work; a harvester cycle or a fit may be holding connections.
10. **Pre-register every model claim:** the test and its pass/fail rule are
    committed before the code that runs it.
11. **At ~92% context, hand off:** rewrite `docs/CURRENT.md`, commit, push.
12. **The model vocabulary is internal** (operator, 2026-09-20). `baseline`,
    `gated`, `simple`, `advanced`, "not validated" and the register itself are
    how WE decide what a page may show. **None of those words may appear on a
    customer surface.** The status decides what renders; it never becomes
    copy. `/diagnostics` is the one place the vocabulary is allowed, because it
    is the operator's own page. A guard test enforces this from S1.

## 3. Where things stand (measured 2026-09-19)

So a fresh session doesn't re-derive it:

- **The ESPN outage is fixed and deployed** (`10a1647`, `8dab195`, `f2232c7`).
  ESPN rejects team-sport date ranges; every caller now asks one date at a time
  with `limit=500` (above ~500 it silently returns 25 events), and an unreadable
  day raises instead of reading as "no games". Caught up from 09-11: 446 finals,
  11 games of history, 80 games regraded. **Closing lines for 09-15 → 09-19 are
  lost.**
- **Models today (re-measured 2026-09-20, after the Elo extension shipped).**
  **Every sport can now predict a game** — that was the point of the extension,
  and it is done. The register holds 16 rows: **1 gated** (MLB props: 12 markets,
  14 Platt calibrations), **10 baseline**, **1 failed** (NBA props), **4 none**.
  - Game: MLB (its own ensemble), NFL, CFB, NBA, NHL on the generic Elo; and as
    of `c5baee4` **soccer** (three-way, measured draw rates EPL 24.03% / MLS
    25.12%, grading settles draws), **tennis** (`predict/tennis_serving.py`
    finally wires the surface-weighted engine that had sat unused since Phase
    2.2 — 57,155 matches replayed, 55 WTA picks live in production at 07:45)
    and **golf** (event-as-field Elo over a 235-event backfill; it RANKS, and
    publishes no win probability because no scale has been fitted).
  - **MLB's game model is `baseline`, not `gated`** — its own CLV backtest puts
    it below the close. Re-run live by `modelGateJob` at 07:46: mean −0.0563
    prob-points, positive-CLV rate **38.0% on 305/448** matched picks. See
    open question 0.
  - Props remain MLB-only as a gated model; NFL and NHL props are baselines and
    the other five sports have **no prop model at all** (M5, unapproved). The
    operator's instruction of 2026-09-20 stands: **the Elo work was about games
    only. Do not touch player props in any U or S phase** beyond rendering what
    already exists.
- **The generic Elo blends 50% with the market price** (`MARKET_BLEND_WEIGHT`
  0.5, `ELO_BLEND_WEIGHT` 0.2, still hand-set placeholders — M2's fit 2 is
  blocked on SL-9's data, which only starts accumulating 2026-09-20), which is
  why it picks the favorite 95–100% of the time. Graded picks: CFB 216, NFL 35,
  NHL 3, soccer 54 (capture resumed 2026-09-20), tennis 1 graded so far.
  **CFB is calibrated** (M2 fit 1: it said 68.0%, won 83.9%; log loss 0.471 →
  0.397).
- **Slate data** is measured per sport in `slate-sheet-cards.md` §4. Highlights:
  MLB 16 prop markets (up to 21 books); NFL 18 (pre-outage week); CFB 13; soccer
  7 per league; tennis 3; NHL none yet (preseason); NBA from October. Opening
  lines are **not held**, so Movers measures "since first seen". Weather **is**
  held (area forecast) for outdoor MLB/NFL/CFB venues.

## 4. The build, in order

### Stage 0 — models and data (now; no UI files; runs while R10–R12 await sign-off)

#### M0 — Close out the outage and the data gaps

**Why first:** every later phase reads this data, and two of these silently
shrink a sport's coverage.

**Read:** `docs/CURRENT.md` top section; `slate-sheet-cards.md` §5.

**Build:**
1. `predict/generic_pick_capture.py:57` sends `limit=1000` on a single date, so
   ESPN returns 25 events. Set 500. (Same bug class as `f2232c7`; left alone then
   because Q1 was open.)
2. **R6-F8:** ParlayAPI files pitchers' strikeouts under `batter-strikeouts` and
   walks allowed under `walks`. Map them in the Python writer so pitcher markets
   stop missing those books.
3. Add the 9 CFB teams missing from `team_name_index` (Ohio, South Alabama,
   Stonehill, UMass, UL Monroe, Sacred Heart, Southern Utah, West Georgia,
   Arkansas State). Their closing lines and results are being skipped.
4. **Soccer draw:** the live per-book feed carries no draw price; only the
   archive has one, from the harvester. Check whether a paid provider returns a
   3-way market we drop at ingest and map it; otherwise record it as
   archive-only.
5. **Operator:** rebuild and restart the port-3000 production server. It predates
   the fix and will blank NFL/CFB/soccer again on its next rebuild.

**Done when:** each item is fixed, deployed (asked first) or recorded as not
held; `slate-sheet-cards.md` §5 updated; one CFB slate shows lines and results
for the previously-missing teams.

**Guard:** a test asserting no ESPN call in the repo sends `limit` > 500.

**Stop for:** confirmation the production server was rebuilt.

#### M1 — Model status: a register, a display rule, a promotion test (D11)

**Why here:** it decides what every later page may claim. Building the Slate
first would bake today's habits into new code.

**Read:** `predict/generic_team_elo.py` header; `predict/calibration.py`;
`docs/master-plan-2026-09-06.md` Phase 6 and 7 close-outs (the failed gates).

**Build:**
1. **The register.** One row per `sport × kind` (`game`, `prop`): `engine`,
   `status` (`none` · `baseline` · `gated` · `failed`), `evidence` (test, result,
   date, commit), `since`, `fitted_at`. Config in Python with a DB mirror the app
   reads through one `cachedRoute()` endpoint.
2. **Seed from what is true today** (§3), each row citing its evidence.
3. **The display rule**, in one shared helper every page calls:

   | status | may show | must not show |
   |---|---|---|
   | `gated` | probability beside the market's implied probability, projection, pick, graded record | the difference between the two |
   | `baseline` | the pick (green ring), projection, hit rates, sample sizes | a probability beside a price, a record framed as a track record, any edge |
   | `failed` / `none` | nothing — the section hides and says why | anything implying a model exists |

4. ~~Every surface says its status in plain words ("baseline model, not
   validated").~~ **REVERSED by the operator 2026-09-20, before any page used
   it:** that vocabulary is internal (rule 12). A surface says nothing about
   model tiers; the status decides what it renders and the page reads as
   ordinary research either way. `statusLabel()` exists for `/diagnostics`
   only, and today nothing else calls it.
5. **The promotion test:** each sport × kind carries pre-registered gate
   criteria; a scheduled job re-runs them, updates `status`, writes the evidence.
   Demotion works the same way.
6. **`game_picks` gains a `source` column** — the generic baseline and MLB's own
   model both write that table, told apart only by sport today. Backfill from
   sport.

**Done when:** the register is seeded, read by at least one page and enforced by
tests; the promotion job has run once and recorded evidence;
`table-ownership.md` rows added.

**Guard:** `tests/scan-no-edge.test.ts` gains a case per status; a test fails if
a page renders a probability for a non-`gated` row.

**Stop for:** sign-off on the seeded statuses — this is the list of what the app
claims.

#### M2 — Fit the simple models against real outcomes (per sport, as data allows)

**Why here:** after M1, so a fit cannot quietly promote anything; before the
Slate shows the ring.

**Read:** `predict/probability_blend.py` (the placeholders),
`predict/platt_calibration.py`, `predict/walkforward.py`.

**Build:**
1. **Calibration.** Platt against graded picks, per sport. Changes the number,
   never the pick. CFB's average pick reads 68.5% and has never been checked
   against how often those picks won.
2. **Blend weights.** Fit `MARKET_BLEND_WEIGHT` (0.5) and `ELO_BLEND_WEIGHT`
   (0.2); the file itself calls them placeholders awaiting a fitting pass.
   **This one can move picks.** A fit that says lean harder on the market makes
   the ring rarer — a legitimate result, not a failure.
3. **Walk-forward only:** fit on what was known before each game.
4. **Sample gate: fit a sport at ≥ 200 graded picks; refit quarterly.** Today CFB
   196 (first), NFL 32, NHL 3, NBA from its season. Hold the placeholders
   otherwise and record in the register which sports are fitted.
5. Pre-register both criteria and the failure path: placeholders stay, the
   attempt is recorded.

**Done when:** CFB is fitted and calibrated with its evidence in the register;
the other sports' thresholds and expected dates are recorded.

**Guard:** a test that fitted weights are read from the register, never
hard-coded; a walk-forward leakage check.

**Stop for:** the fit's numbers before they go live.

#### M3 — The Slate's rankings (`slate_rankings`)

**Why here:** Spotlights (S3) and Specials (S4) read it, and it needs a day or
two of real frozen rankings before those pages can be judged.

**Read:** `slate-sheet-cards.md` §4 (every ranking's factors, per sport) and §5.

**Build:**
1. **Table** `slate_rankings`: `sport, slate_date, ranking_id, subject_id, rank,
   score, factors jsonb, frozen_at, outcome jsonb`. One writer.
2. **`slateRankingsJob`** in `JOB_REGISTRY` (health_check picks it up itself). It
   computes every Spotlight and Specials ranking for each sport with games today,
   **freezes** each at that sport's first start, and grades the frozen top 5
   (D10) next morning into `outcome`.
3. **Inputs nothing holds yet:** team K% vs pitcher hand (pitch corpus);
   TennisMyLife serve stats, fetched and stored; optionally Understat xG for EPL.
4. **Weights equal** until a pre-registered backtest sets them; the page says so.
5. `withJobLock` if it can overlap itself. Corpus reads stay off the Render
   worker (~300 MB each).

**Done when:** a full day is frozen and graded for MLB and at least one other
sport; the backtest spec is committed; deployed (asked first).

**Guard:** a test that a ranking row's `frozen_at` is never after its sport's
first start.

**Stop for:** one day's rankings reviewed against the mockup's columns.

### Stage 1 — the UI foundation (after R10–R12 sign-off; no other session editing UI)

#### U0 — Tailwind 4 and the kit's base (U spec §6, §9)

**Why here:** everything in U and S depends on it, and it touches nearly every
file, so it must not overlap another UI session.

**On the "after R10–R12 sign-off" dependency (resolved 2026-09-20):** its real
content is *don't run two UI sessions at once*, plus *don't rebase the R track's
work out from under it*. R10, R11 and R12 are built, committed and pushed
(`443484c` and earlier); nothing is uncommitted and no other session is editing
UI. **Proceed.** Sign-off on the R pages is still owed and is on the queue, but
it gates nothing here — U0 is a mechanical Tailwind conversion that must not
change a single pixel, so it cannot invalidate a page the operator has yet to
look at.

**Build:** the U spec's U0 exactly — Tailwind 3.4 → 4, config into `@theme`, the
Untitled UI token bridge, the `field` type token, `react-aria-components`,
`tailwind-merge` (extended so our font-size tokens survive), the icon set after
its license check, `RouterProvider` in the root layout, the dev-only `/kit` page
skeleton.

**Extra here:** before/after screenshots include **one `/{sport}` page per
sport**; `ScanTable`, the filter bar and the strips must be pixel-identical.

**Done when:** no size moved and no color changed anywhere; each trap in U spec
§9 is checked by eye on the kit page (`bg-good/10`, `border-cmp-a/30`,
`bg-ink/[0.08]`, bare `border`, `ring`, `outline-none`).

**Guard:** the Tailwind 4 build; `cx` merge cases.

#### U1 — Buttons · U2 — the Hybrid table · U5 — borrowed pieces

Three phases in this order, from the U spec §6. What belongs to this plan:

- **U1** first: the table footer uses Buttons.
- **U2** is the biggest visual change. Its kit-page fixtures gain the Slate's
  tables — Movers, Price outliers, Line disagreements, a Spotlight (with `bar`
  and `streak`), a Specials ranking (score bar, `info` on every factor), the
  Model picks table — so S1–S5 build on proven columns.
- **U5 moves ahead of U3/U4** (the U spec allows any order among U3–U5) because
  the Slate needs `Chip.dot`, `AvatarLabel`, `FeaturedIcon`, `Tabs.count`,
  `Card.count`/`flush` and `SegmentedToggle`. Scan's own files keep the old kit
  until S1 rebuilds their controls.

**Done when:** each phase's "done when" in the U spec, plus the kit page renders
the Slate fixtures at 1440 and 400.

### Stage 2 — the Slate (every sport per phase)

#### S1 — Shell, Games, and Props (Scan's table unchanged)

**Why here:** it needs U2's table and U5's pieces; everything else in S hangs off
this shell.

**Read:** `slate-sheet-cards.md` §2, §3.1, §3.3; the mockup; `AppShell.tsx` (the
slate body), `TopBar.tsx`, `DateGameStrip.tsx`.

**Build:**
1. **Route and chrome.** AppShell's Scan body → `SlatePage`. `TopBar`'s tab label
   **Scan → Slate** (the `Tab` type, the `?tab=` value, any test naming it; keep
   `?tab=Scan` working as an alias). The strips are untouched.
2. **`GET /api/slate?sport=&date=`** via `cachedRoute()` (key
   `slate:route:{sport}:{date}` — grep first). TTLs: games 60 s, lines and props
   120 s, rankings once per slate. It reads; it never writes.
3. **Shared shape** `lib/sports/shared/slateShapes.ts`; one `toSlateData` per
   sport; sections hide when unset.
4. **`SectionNav`:** sticky under the header, `Tabs` with counts, anchor links; a
   hidden section drops out of the nav.
5. **Games section:** `GameCard` grid (3 / 2 / 1 up), status filter with counts,
   lines block (consensus, best price and book, move since first seen, book
   count), MLB model row, **the Elo ring for NFL/CFB/NHL at 65%+ with the
   against-the-favorite chip** (D9, under M1's rule), context chips (park,
   area-forecast weather outdoors, injuries), "Game page →", "N props →". Golf:
   leaderboard + winner prices. Tennis: matches.
   **Line sanity, in the read:** drop quotes with `|odds| < 100` and any quote
   more than 15 implied points from the median (measured: a +10000 moneyline and
   a `0` price on 2026-09-19).
6. **Props section:** `ScanTable` mounted **unchanged** (D3) under controls
   rebuilt on the kit — tabs → `Tabs` with counts, filter pills → `Select`s,
   search → the kit input. `useFilters` keeps its API so the table receives
   exactly the rows it does today. "N props →" sets the existing Games filter.
7. **Delete:** the Players/Games toggle, `GameLinesView`, `GameLine`.

**Done when:** every sport renders chrome, nav, Games and the unchanged table at
1440/400; NBA shows its off-season state, NHL its no-props state, ATP its
no-matches state; the deleted files are gone.

**Guard:** content-hash test on `ScanTable.tsx` / `ScanCard.tsx`; a render diff of
the table before and after.

**Stop for:** sign-off per sport.

#### S2 — Movers, Price outliers, Line disagreements

**Read:** `slate-sheet-cards.md` §3.2 and §3.3 (the two summary cards).

**Build:**
1. Aggregations in the `/api/slate` build, no new table: the first observation per
   book in `game_odds_history` / `prop_odds_history` is **"first seen"**; the
   opener is not held and the caption says so.
2. **Movers:** `Tabs` Game lines · Props; window `SegmentedToggle` (since first
   seen · 3h · 1h, all real); Move in implied-probability points as the sort key
   with a magnitude bar; Steam (3+ books the same way within 30 minutes) and
   Split (line one way, price the other) chips; a sparkline from the history rows.
3. **Price outliers:** ≥ 5 books on the line, gap 4–15 points against the median
   of the rest; above 15 is a stale or exchange quote and is dropped.
4. **Line disagreements:** books split on the line itself.
5. Hidden for golf (winner prices are cached, not stored as history).

**Done when:** all three render for every sport with history; MLB and EPL show
real movers; captions present.

**Guard:** a test that "since open" never appears in Slate copy.

#### S3 — Spotlights

**Read:** `slate-sheet-cards.md` §3.4 and each sport's list in §4.

**Build:** read `slate_rankings` (M3). Hit-rate leaders and Active streaks for
every sport, plus each sport's own: MLB platoon / K spots / HR parks; NFL
receivers vs pass defenses and rushers vs run defenses; CFB rushers (team level —
CFB holds only the `all` position group); NBA pace-up, usage bumps, shot zones
(October); NHL shot volume; soccer shot takers; tennis form and serve vs return;
golf low rounds. Every factor is a column with an `info` tooltip naming its
source; each card carries a "why" line.

**Done when:** every sport shows its spotlights or a real empty state that says
why (MLS logs start 2026-08-15; NBA and NHL until their seasons).

#### S4 — Specials and receipts

**Read:** `slate-sheet-cards.md` §3.5 and the per-sport table in §4.

**Build:** `Tabs` across the sport's rankings; every factor a column; a score bar;
the "why" from each factor's percentile across the whole pool; not-held notes
(red-zone role, first-score rate, penalty takers, lineups, strokes gained).
**Receipts:** yesterday's frozen **top 5** and what happened, plus a running
7-day count. Weights stay equal until M3's backtest sets them, and the caption
says so.

**Done when:** MLB's four rankings and at least one other sport's render with
real receipts from a frozen day.

#### S5 — Model section and Your lines

**Read:** `slate-sheet-cards.md` §3.6 and §3.7; M1's display rule.

**Build:**
1. **Model (MLB only, `gated`):** today's picks with Model % beside IP and
   nothing between them, the total pick, yesterday's graded chips, 7- and 30-day
   records, the calibration note. **Delete `TodaysPicksModal` and its button.**
2. **Your lines** (signed in only): tracked lines, watchlist, slip legs and bets
   on today's slate; live status; best price now against the price when tracked;
   link to the bet page. Hidden when signed out.
3. Baseline sports show **no** model section — their ring is on the GameCard.

**Done when:** MLB's section matches the mockup; a signed-out load hides Your
lines; no baseline sport renders a probability.

### Stage 3 — finish the UI system

#### U3 — Form controls · U4 — Overlays · U6 — Page sweep

From the U spec §6, unchanged. U3 and U4 may interleave with S2–S5 (nothing in
the Slate waits on them). **U6** needs U1–U5 and now also sweeps the Slate's
sections; Scan's frozen files stay on `OUT_OF_SCOPE`; diagnostics goes last.

### Stage 4 — close

#### S6 — Slate close

Every sport, every section, 1440/400, in-season and off-season states, compared
against the mockup section by section. `tests/scan-no-edge.test.ts` covers every
Slate section. `CLAUDE.md` gains the Slate adapter rule and "the Scan table is
frozen". The mockup is marked historical; `docs/CURRENT.md` and the handoff are
rewritten.

#### U7 — UI close

From the U spec: remove the remaining allowlists (not `OUT_OF_SCOPE`), complete
the kit page, add the "UI primitives" section to `CLAUDE.md`.

#### M4 — Promotion tests running (ongoing, not a stop)

M1's scheduled job re-runs each sport's gate criteria and moves statuses on
evidence. First real decisions expected: CFB game after M2's fit; NBA props once
a full season of prices exists (Phase 7's reopen condition); NHL props after its
season.

#### M5 — A simple prop baseline where none exists (optional; needs approval)

NBA, CFB, soccer, tennis and golf have no prop model at all. The counting engine
NFL and NHL use is sport-agnostic, but each sport needs its own stat mapping and
history. One phase per sport, each entering the register as `baseline`.

## 5. Phase table

| # | phase | track | depends on | UI files | deploy | status |
|---|---|---|---|---|---|---|
| 1 | M0 outage and data close-out | M | — | no | **done** | **DONE 2026-09-20** (`603f65b`, deployed 07:45) |
| 2 | M1 model status register | M | M0 | diagnostics section | **done** | **DONE 2026-09-20** (`bd365e0`, deployed) — statuses need sign-off |
| 3 | M2 fit the baseline (CFB first) | M | M1, ≥200 graded picks | no | **done** | **DONE 2026-09-20** (`56db642`, deployed) — CFB calibrated; fit 2 blocked, see M2a |
| 4 | M3 `slate_rankings` job | M | M0 | no | **done** | **DONE 2026-09-20** (`737620b`, deployed; 30 rows written 07:45) — first receipts 2026-09-21 |
| 4b | M3b Elo for soccer, tennis, golf | M | M1 | no | **done** | **DONE 2026-09-20** (`c5baee4`, deployed) — every sport predicts a game |
| 5 | U0 Tailwind 4 + kit base | U | R10–R12 sign-off | all (mechanical) | no | **DONE 2026-09-20** — config deleted, theme in `@theme`, `cx` merges, `/kit` live; verified by emitted-CSS diff, not screenshots |
| 6 | U1 Buttons | U | U0 | yes | no | **DONE 2026-09-20** — Button/IconButton/CloseButton on react-aria; 73 of 96 raw buttons moved; `.lb-btn-primary` deleted |
| 7 | U2 Hybrid table | U | U1 | yes | no | **DONE 2026-09-20** — DataTable v2, Card.count/flush, Pagination; kit carries the Slate's tables on fixtures; 6 hand-rolled tables left on a named ratchet |
| 8 | U5 Borrowed pieces | U | U2 | yes | no | **DONE 2026-09-20** — Chip.dot, Tag, Tabs.count, SegmentedToggle.icon, AvatarLabel, AvatarGroup, FeaturedIcon; one chip / one toggle / one skeleton in scope |
| 9 | S1 Shell + Games + Props | S | U2, U5, M1 | yes | no | **DONE 2026-09-20, partly** — `/api/slate`, 7 adapters, SectionNav, GameCards and the props board are in; the filter pills still wait on U3's `Select` (SL-16) |
| 10 | S2 Movers + price gaps | S | S1 | yes | no | **PART DONE 2026-09-20** — Price outliers and Line disagreements shipped; **Movers NOT built**, and the reason is measured (SL-18) |
| 11 | S3 Spotlights | S | S1, M3 | yes | no | **DONE 2026-09-20** — the two universal spotlights for every sport, derived from the candidates (S3's `slate_rankings` premise was false — SL-21); sport-specific spotlights not built |
| 12 | S4 Specials + receipts | S | S1, M3 | yes | no | **done** — reads `slate_rankings` (MLB HR + K, NFL TD, EPL/MLS goalscorer; CFB defined, no rows); receipts live from 2026-09-20; labels drift-tested against the Python; page-width cutoff fixed (SL-25) |
| 13 | S5 Model + Your lines | S | S1, M1 | yes | no | **done** — MLB Model section (picks + price + lock state; no probability, grade, stake or record, per Q0); `TodaysPicksModal`, `useGamePickRecord` and the on-page record deleted; MLB cards now name the locked pick; Your lines signed-in only (signed-in render owed, Q15) |
| 14 | U3 Form controls | U | U0 | yes | no | **done** — field family in the kit; 0 raw `<input>`/`<select>`/`<textarea>` in scope; five hand-built listboxes are the kit `PickList`; every field 16px below 768px |
| 15 | U4 Overlays | U | U0 | yes | no | not started |
| 16 | U6 Page sweep | U | U1–U5 | yes | no | not started |
| 17 | S6 Slate close | S | S1–S5 | tests/docs | no | not started |
| 18 | U7 UI close | U | U6, S6 | tests/docs | no | not started |
| — | M4 promotion tests | M | M1 | no | — | ongoing |
| — | M5 simple prop baselines | M | approval | no | yes (ask) | not started |

Every numbered phase ends with a stop for sign-off.

## 6. Open questions

**How an unattended session handles these (operator away, 2026-09-20).** Each
one below now carries a **DEFAULT**: the reading a careful build would pick,
chosen so that being wrong costs a small, named, reversible edit rather than a
rebuilt phase. Build on the default, put a line in the sign-off queue
(`docs/design/SIGNOFF-QUEUE.md`) naming the question, the default taken, the
files it touched and what reversing it costs, and **keep going**. Do not stop
the build for any of these.

**From the M0–M3 build (2026-09-20):**

0. **MLB's game model is a `baseline`, not `gated`** — its own CLV backtest puts
   it below the close (mean −0.0571 prob-points, 37.9% positive on 290 matched
   picks). Under M1's display rule that means the Slate's Model section (S5, D4)
   may show its picks but **not** a probability beside a price, and no record.
   Confirm, or say the Model section should show something else.
   **Re-measured live 2026-09-20 07:46** by `modelGateJob`: mean −0.0563
   prob-points, 38.0% positive on **305/448** matched picks. A bigger sample,
   the same answer.
   **DEFAULT: follow the rule literally.** S5 renders MLB's picks, the total
   pick and the calibration note, and no probability, no `Model %` beside `IP`,
   no record. Reversing it later is additive — the columns get switched on, not
   rebuilt.


1. **CFB's green ring.** CFB is the only sport with a real graded sample: 216
   picks, 97% market favorites, **−1.3% per unit**. Ring every game, or only the
   games where the pick differs from the favorite?
   **DEFAULT: only where the pick differs from the favorite**, which is what D9
   already says in its own words ("the card marks the rare pick that goes
   against the favorite"). A ring on every game would be a green mark on the
   favorite 97% of the time — decoration that reads as a recommendation. Build
   it as one boolean on the adapter's game row so switching to ring-everything
   is a one-line change.
2. **Watchlist and Home Runs.** Both are Scan tabs today and both now have Slate
   sections (Your lines, Specials). Keep the tabs too, or drop them in S1?
   **DEFAULT: keep both tabs.** S1's "delete" list names three things and
   neither of these is among them, and rule 3 (subtract in the same phase) is
   about replacing something, not about removing a working surface nobody asked
   to lose. Deleting them later is cheap; rebuilding them is not.
3. **M5.** Build a simple prop baseline for the five sports with none, or leave
   them with prices and hit rates only?
   **NO DEFAULT — DO NOT BUILD.** M5 is marked "needs approval" and the
   operator's instruction of 2026-09-20 was explicit: the Elo work was about
   **games only**, and player props are not to be touched. An unattended
   session builds no prop model. Prices and hit rates render as they do today.

## 7. Findings ledger

| id | found in | what | goes to | status |
|---|---|---|---|---|
| SL-1 | mockup build | Game lines include stale/exchange quotes (+10000 moneyline, `0` odds) | S1 read rule | open |
| SL-2 | mockup build | Soccer draw price is not in the live per-book feed | M0 | open |
| SL-3 | mockup build | ESPN `limit` above ~500 silently returns 25 events | fixed `f2232c7`; `generic_pick_capture` in M0 | partly fixed |
| SL-4 | mockup build | `game_odds_history` has no NHL ids matching ESPN's (NHL API ids) | S1 adapter | open |
| SL-5 | Q1 measurement | The Elo baseline picks the market favorite on 95–100% of games; CFB's 196 graded picks return −1.3% per unit | D9 display + M2 fit | open |
| SL-6 | this plan | `game_picks` holds two systems' output, told apart only by sport | M1 `source` column | **fixed** `bd365e0` |
| SL-7 | M1 gate run | CFB: 136 picks considered, **0 matched a reference close**, so its game gate cannot run at all | M4 (a reference book CFB actually has) | open |
| SL-8 | M1 gate run | The prop gate is only runnable for MLB; NHL and NFL props cannot pass or fail theirs | M4 / M5 | open |
| SL-9 | M2 | `game_picks.initial_ml_features_json` was NULL on every generic-Elo row, so the blend-weight fit had no inputs | M2a stores them from 2026-09-20 | **fixed forward** |
| SL-10 | M3 | NFL implied points were absent (that slate had no lines yet), so the TD ranking scored on three factors | expected; the score skips missing factors | closed |
| SL-21 | S3 | **S3's premise was false: `slate_rankings` does not hold Spotlights.** Measured 2026-09-20 — it holds four rankings across three sports (`mlb-hr-of-the-day`, `mlb-most-strikeouts`, `nfl-anytime-td`, `soccer-anytime-goalscorer`), which are the SPECIALS pilot set (S4). The two spotlights the spec asks every sport for — Hit-rate leaders, Active streaks — have no rows there and never did. Built from the CANDIDATES instead, through the same `readForm` the props table's own L5/L10/Strk columns use, so a spotlight can never disagree with the table under it | done; S4 is the phase `slate_rankings` was actually written for | **fixed** |
| SL-22 | S3 | **A run that IS the whole record is not a streak.** WTA's card came back as eight rows of "Missed this line in each of the last 91 matches" on "To Win a Set · Yes" — the category never matches in that sport's history, so every period is a miss and the "run" is the record. A miss-run now needs the player to have cleared the line at least once ever, and a clear-run to have missed it | fixed in S3, pinned | **fixed** |
| SL-23 | S3 | Sport-SPECIFIC spotlights (MLB platoon / K spots / HR parks, NFL receivers vs pass defenses, CFB rushers, NBA pace-up, NHL shot volume, soccer shot takers, tennis serve vs return, golf low rounds) are NOT built. Each needs its own per-sport data, and none of it is in the candidates or in `slate_rankings` | a later phase, one sport at a time | open |
| SL-24 | S4 | **Three factor values are stored as percentages and one as a fraction**, and the Python's own `info` said "per plate appearance" for a value multiplied by 100. Printed bare, HR/PA read "4.57". Units now in `lib/slate/specialsFormat.ts` (display only), and the two sentences corrected in both languages — the drift test keeps them together | fixed in S4 | **fixed** |
| SL-25 | S4 | **The page cut off on the right, and scrolled sideways into blank space** (operator report, 2026-09-20). Measured: /nfl at 390px was 853px wide. Cause: every `sr-only` label in a table cell is `position: absolute`, and `.lb-scroll-x` was not a containing block, so they resolved against an ancestor OUTSIDE the scroller and stretched the document. `.lb-scroll-x` is now `position: relative` in `@layer base` (unlayered, it beat the `sticky` utility and slid the Slate's section nav over the game cards — caught on render). Also: the header's centred nav hid its own first tab (`justify-center-safe`), and the soccer/tennis header pushed Slip and Sign in off a phone. Swept 8 pages × 7 widths (360–1920): document width equals viewport on all of them | fixed in S4 | **fixed** |
| SL-26 | S5 | **The spec's calibration note has no source.** `model_calibration` holds the PROP-market fits only (hits, runs, strikeouts, …); there is no row for the game model, so "method and fit date" cannot be read for the Model section. The section's note says instead, in plain words, why it shows no probability or record | premise false — recorded, not built | open |
| SL-27 | S5 | **The card and the Model section named different picks.** The card derived its pick from the snapshot's win probability (`>=`, so a coin flip goes home); `game_picks` held the locked pick. Measured 2026-09-21: TOR/DET/SF on the cards, BAL/DET/MIN in `game_picks` — 2 of 3 differ, both at ~51%. The slate route now passes the locked picks into MLB's adapter and the card names those; expected runs print away–home instead of pick-first | fixed in S5, pinned | **fixed** |
| SL-28 | S5 | `game_picks.commence_time` comes back from the driver as a `Date` although `GamePickRow` types it a string; the Model route's first render sorted on it and 500'd. Normalised at the adapter | fixed in S5, pinned | **fixed** |
| SL-18 | S2 | **Movers is not buildable from these tables yet, and the data is not the problem.** Movement is real — 3,769 moved game lines and 120,495 moved prop lines in 36h. But at every threshold tried (raw, ±5000, ±2000, pick'em books excluded, grouped by point, capped at 25 implied points) the top rows are the same two or three books — Fanatics, HardRockBet, ProphetX — swinging a price 25 points on an unchanged line. That is quote quality, not a market changing its mind; real steam is 1–8 points. A card whose first row is always the same book quoting badly is worse than no card. **Price outliers and Line disagreements were built instead, and both produce believable output** | a per-book quality pass, which is its own piece of work; queue Q9 | open |
| SL-19 | S2 | The slate day defaulted to **UTC**. At 03:00 UTC it is 23:00 the previous evening in New York and the same slate is still on, so every Games section emptied the moment the clock passed midnight — with fifteen MLB games still on the strip above it. Found by rendering at 23:06 ET | fixed in S2, pinned | **fixed** |
| SL-20 | S2 | The section nav was `sticky top-0` under a header that is also `sticky top-0`, so it sat ON TOP of the date strip. The header's height is not a constant — golf's strip, tennis's and the team sports' all differ, and it reflows at 400px — so it is measured with a `ResizeObserver` rather than hard-coded | fixed in S2 | **fixed** |
| SL-12 | S1 | **Every price on `BookmakerOdds` is DECIMAL, not just the moneyline.** Only `homeOdds` carries a comment saying so. Spreads and totals vanished from every card because `overPrice: 1.81` is under ±100 and the sanity filter dropped it — the only survivors were exchanges whose decimal odds exceed 100 | fixed in S1, pinned by `tests/slate-shell.test.ts` | **fixed** |
| SL-13 | S1 | **`game_odds_book_lines.sport` is the GENERIC key** — `soccer`, never `soccer_epl`; `game_picks` is granular. `db.py` warns about exactly this and it still bit: every EPL card drew an empty lines block | fixed in S1 | **fixed** |
| SL-14 | S1 | **A book-line row does not record WHICH market it priced.** One EPL match carried totals of 0.5, 1.5, 2.5, 3, 3.25, 3.5, 5.5, 6.5, 7.5 and 8.5 across 21 books, because the table holds alternative and derivative markets beside the main one and the per-book merge keeps one row per book. Grouping on the MODAL point rescues football and baseball; it does not rescue soccer or tennis, where a "moneyline" can be a goal line. Their lines blocks are hidden with a stated reason rather than shown wrong | S2 reads this table in anger; sort the markets there | open |
| SL-15 | S1 | **A live game's `state` is a phrase, not a keyword** — "In Progress", "Manager challenge", "Delayed". Matching on equality put five live MLB games in the Final bucket with the Live filter reading 0 | fixed in S1 | **fixed** |
| SL-16 | S1 | S1's spec says the props filter pills become `Select`s and the search becomes the kit input — both are U3 components, and the gameplan runs U3 AFTER S1. The tabs were rebuilt on `Tabs` with real counts; the pills and the search are untouched and still work | U3, then a short follow-up | open |
| SL-17 | S1 | The snapshot's `SlateGame` carries no team RECORD, so the GameCard's "92-63" is absent on every sport. The mockup shows it | whichever phase next touches the snapshot builders | open |
| SL-11 | U0 render | `/mlb` takes **60–90 seconds** to settle in dev: `/api/mlb` is 26 MB and `/api/props/lines?sport=mlb` is 23.7 MB, and the latter is fetched twice (the hook's `refreshKey` is the snapshot's `fetchedAt`, so it refires when the snapshot lands). Until then the page honestly reads "No candidates match these filters." Cost half an hour chasing a regression that wasn't one — **wait for `table tbody tr` to be non-empty before judging a Scan render** | S1 (the `/api/slate` route should not ship a 24 MB body); note in the handoff | open |
