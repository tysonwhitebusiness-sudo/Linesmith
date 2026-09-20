# Master gameplan — UI system + the Slate

**Status (2026-09-19):** approved direction, nothing built. This is the build
order for two tracks that share one kit:

- **U track** — the UI system overhaul. Its locked spec is
  `docs/design/ui-system-master-prompt.md` (U0–U7). This plan does not restate
  it; it sequences it and records what changed.
- **S track** — the Slate, which replaces Scan's body on every sport's page.
  Its card-by-card spec is `docs/design/slate-sheet-cards.md`; the approved
  look is the mockup `docs/design/slate/slate.html`.

Update the status column of §5 at the end of every phase. Where this file and
the two specs disagree, this file wins on **order and scope**; the specs win on
**detail**.

---

## 1. Decisions (all operator, 2026-09-19)

| # | decision |
|---|---|
| D1 | The Slate **replaces Scan in place** at `/{sport}`. It is not a new page. |
| D2 | The app chrome is unchanged: `TopBar` (its **Scan** tab is renamed **Slate**) and the date strip with the game scroller (`DateGameStrip`, `GolferStrip`, `TennisMatchStrip`), which is always part of the top bar. **No second sport picker, date control or page title.** |
| D3 | **The Scan TABLE does not change at all** — `ScanTable` itself: its columns, cells, colors, heat, rank chips and row layout render exactly as today, and it becomes the Props section's table. **Everything else about Scan may change** to fit the new UI (operator, 2026-09-19): its tabs (All · Coming up · Watchlist · Home Runs), search, view toggles and filter pills are rebuilt on the kit. The mockup's restyled table is a stand-in; the build uses the real `ScanTable`. |
| D4 | The mockup's design is approved for everything else: the section order, the GameCard, Movers, Price outliers, Line disagreements, Spotlights, Specials, Model, Your lines, and the sticky section links. |
| D5 | All sports, in phases: each S phase ships its sections for **every** sport at once, through one adapter per sport. |
| D6 | Build the Slate's new sections **on the U kit, after U2** (the Hybrid table). |
| D7 | The Specials pilot set is the list in the spec; more later. No admin-entered "specials at the books" list. |
| D8 | U track decisions stand as locked (Untitled UI free set copied into `components/ui/`, Hybrid tables, our Tooltip/Card/charts). |
| D9 | **Keep the simple Elo guesser** for NFL, CFB and NHL, shown **only on the Slate**, as a **green highlight on the picked team's logo** in its GameCard. No model card, no probability column, no record chips: it is deliberately shallower than MLB's and golf's models. **Measured 2026-09-19:** it picks the market favorite on 95–100% of games (CFB 216 picks, 6 underdogs, 84.7% win rate, −1.3% per unit; NFL 47 picks, 2 underdogs; NHL 14 picks, 0 underdogs), so the card also marks the ~1-in-30 game where **the pick is not the market favorite** — the only case it adds information — and the section caption says so. |
| D10 | **Receipts grade the top 5.** |
| D11 | **Simple models stand in until a researched one passes its gate** (operator, 2026-09-19). They are separate code, not a slice of the researched ones: `predict/generic_team_elo.py` (game picks, NFL/CFB/NBA/NHL) vs MLB's own ensemble and the per-sport prop engines. The standing-in is made a policy, not a habit, by S0.5: a status register, display tied to status, and a scheduled promotion test. |

**Scope, precisely.** The U spec's §0b put Scan and the landing pages out of
scope. That now splits:

| frozen, untouched | rebuilt on the U kit |
|---|---|
| **`ScanTable` only** (plus `ScanCard`, its phone card), and the strips `DateGameStrip`, `GolferStrip`, `TennisMatchStrip` | `SlatePage` and every section: `GameCard`, Movers, `PriceOutliersCard`, `LineDisagreementsCard`, Spotlights, Specials, Model, Your lines, `SectionNav`, **and Scan's own controls** — `FilterBar`, `FilterSidebar`, `PlayerFilterDrawer`, the tabs and search (`useFilters` keeps its API; only its UI changes) |

Tailwind 4 (U0) still reaches the untouched files mechanically; they must look
identical before and after (U spec §0b rule 1). The `OUT_OF_SCOPE` list in
`tests/ui-primitives.test.ts` keeps every left-column file.

**Removed from Scan's body** (their content becomes a section): the
Players/Games toggle (Games is always a section), `GameLinesView` / `GameLine`
(the market grid), and `TodaysPicksModal` with its "Today's Picks" button
(→ the Model section). Nothing else of Scan is removed.

## 2. Rules for every phase

The research plan's §2, the U spec's §6 and CLAUDE.md all apply. In short:

1. **Build, type-check, test, render, compare, commit by explicit path, stop for
   sign-off.** `tsc --noEmit` clean; every TS test and the touched Python tests
   pass; `npm run build` passes (`LB_DIST_DIR=.next-verify` while a dev server
   holds `.next`).
2. **Render in a fresh tab** at 1440 and 400, for every sport the phase touches
   (MLB, NFL, CFB, EPL, MLS, NBA, NHL, ATP, WTA, golf). A sport that is off or
   empty today renders its real empty state; say which.
3. **Subtract in the same phase.** A phase that replaces something deletes the
   old one in the same commit.
4. **Python writes, TypeScript renders.** New tables get a
   `docs/table-ownership.md` row. No GET handler writes.
5. **API routes** go through `cachedRoute()`; grep the cache key first.
6. **Sport adapters:** `SlatePage` never branches on sport. Each sport has
   `lib/sports/{sport}/adapters/slateAdapter.ts` → `toSlateData`; a sport with
   no data for a section leaves it unset and the section hides.
7. **Honesty guards:** no edge column; `Model %` beside `IP`, never their
   difference (`tests/scan-no-edge.test.ts` is extended to the Slate);
   movement, gaps and rankings are captioned as not predictions.
8. **Never edit** `ScanTable` and the other left-column files of §1, except the
   mechanical Tailwind 4 conversion in U0. A guard test enforces it (S2).
9. **Ask before any Render deploy.** Check the 15-connection pooler before DB
   work.
10. **At ~92% context, hand off** (CLAUDE.md): rewrite `docs/CURRENT.md`.

## 3. The two tracks side by side

```
 now ─────────────────────────────────────────────────────────────────────────▶
 S0  cleanup (data)          ┐
 S0.5 model status register  ├─ Python/config only, no UI files: can run now
 S1  ranking + slate data    │
     (Python, deploy)        ┘
                     [R10–R12 sign-off]
 U0  Tailwind 4 + kit base ─▶ U1 Buttons ─▶ U2 Hybrid table ─▶ U5 borrowed pieces
                                                              │
                                             S2 shell + Games + Props (Scan, as is)
                                             S3 Movers + outliers + disagreements
                                             S4 Spotlights
                                             S5 Specials + receipts
                                             S6 Model + Your lines
                              U3 form controls / U4 overlays (interleave with S3–S6)
 U6 page sweep ─▶ S7 Slate close ─▶ U7 close
```

U5 moves ahead of U3/U4 (the U spec allows U3–U5 in any order) because the
Slate needs `Chip.dot`, `AvatarLabel`, `FeaturedIcon`, `Tabs.count` and
`SegmentedToggle`.

## 4. Phases

### S0 — Data cleanup before anything is built (Python/data; no UI)

The outage fix is done and deployed (`10a1647`, `8dab195`, `f2232c7`). What remains:

- **Q1 resolved (D9): the Elo picks stay,** for NFL, CFB and NHL, Slate-only.
  Soccer's stay stopped (Phase 8, 2026-09-13). Nothing to delete.
- `generic_pick_capture.py` sends `limit=1000` on a single date, so it captures
  picks for only 25 CFB games a day (ESPN's silent fallback). Fix to 500 — with
  D9 the capture is kept, so this is now a real gap, not a candidate for deletion.
- **Pre-register the honesty check** the Slate's caption rests on: the share of
  Elo picks that differ from the market favorite, per sport, recomputed weekly.
  If it reaches zero for a sport over a full season, that sport's highlight goes.
- **The Elo baseline's four changes (D9), in order of what they touch.** Three
  are display and change no pick: (a) show the model's win % beside the market's
  implied %, MLB-style, nothing computed between them — **allowed only if the
  register says `baseline` may show it; by S0.5's rule it may not, so this one
  waits for a gate**; (b) ring only at 65%+, so the ring means conviction;
  (c) mark the pick that goes against the favorite. The fourth changes the
  number, not the pick: (d) **calibrate** the probabilities against the picks
  already graded (CFB's average pick reads 68.5% and has never been checked).
- **The one change that moves picks:** `MARKET_BLEND_WEIGHT = 0.5` and
  `ELO_BLEND_WEIGHT = 0.2` are hand-set placeholders the code itself says should
  be fitted to graded outcomes. Fit them (pre-registered). The fit may say lean
  harder on the market, which would make the ring rarer — a legitimate result.
- **R6-F8:** ParlayAPI files pitchers' strikeouts under `batter-strikeouts` and
  walks allowed under `walks`. Map them in the Python writer.
- The 9 CFB teams with no `team_name_index` entry (closing lines and results
  skipped: Ohio, South Alabama, Stonehill, UMass, UL Monroe, Sacred Heart,
  Southern Utah, West Georgia, Arkansas State). Add them.
- Soccer draw prices: the live per-book feed carries none; only the archive has
  them (harvester). Check whether a provider we pay for returns a 3-way market
  that is being dropped, and map it; else the GameCard shows the archive draw.
- **Operator:** rebuild and restart the port-3000 production server; it predates
  the ESPN fix and will blank NFL/CFB/soccer again on its next rebuild.

**Done when:** each item is fixed, deployed (asked first) or recorded as not
held; the spec's §5 table is updated.

### S0.5 — Model status: a register, a display rule, a promotion test (D11)

The knowledge of which model is real lives across plan documents today, and the
app cannot read it. This makes it one fact in one place.

**1. The register.** One row per `sport × kind` (`game`, `prop`), in config with
a DB mirror the app reads:

| field | meaning |
|---|---|
| `engine` | `generic_elo`, `mlb_ensemble`, `mlb_pa_sim`, `count_prop_engine`, … |
| `status` | `none` · `baseline` (simple, unvalidated) · `gated` (passed a pre-registered test) · `failed` (attempted, did not pass) |
| `evidence` | the test, its result, the date, the commit |
| `since` | when it entered this status |

Seeded from what is true on 2026-09-19: MLB game **gated**; MLB props **gated**
(14 Platt calibrations); NHL props **baseline** (projections, temperature
calibration, never gated); NFL props **baseline** (projections, no probability,
decision 4.6); NFL/CFB/NBA/NHL game **baseline** (generic Elo); CFB game
**failed** (Phase 6), NBA props **failed** (Phase 7), soccer game **failed**
(Dixon-Coles; capture stopped 2026-09-13); golf **none** (model deleted
2026-09-13); tennis **none**; soccer/CFB/tennis/golf props **none**.

**2. Display tied to status** — one rule the pages read from the register, so no
page decides for itself:

| status | may show | must not show |
|---|---|---|
| `gated` | probability beside the market's implied probability, projection, pick, record | the difference between them (standing rule) |
| `baseline` | the pick (the green ring), a projection, hit rates | a probability beside a price, a record framed as a track record, any edge |
| `failed` / `none` | nothing; the section hides and says why | anything implying a model exists |

Each page says which it is in plain words ("baseline model, not validated").
`tests/scan-no-edge.test.ts` grows a case per status.

**3. The promotion test.** Each sport and kind carries its gate criteria,
written **before** the attempt (the project's pre-registration habit), and a
scheduled job re-runs them and updates `status` with its evidence. A sport moves
baseline → gated when it earns it, not when someone remembers to look; a gated
model that stops clearing its own bar moves back.

**Also in this phase:** `game_picks` gains a `source` column (the generic
baseline and MLB's own model both write that table today, told apart only by
sport), backfilled from sport.

**Done when:** the register is seeded and read by one page; the three display
rules are enforced by a test; the promotion job runs and records its evidence;
`docs/table-ownership.md` has the new rows.

### S1 — The Slate's data layer (Python; deploy; no UI)

- **`slate_rankings`** table (migration + `docs/table-ownership.md` row):
  `sport, slate_date, ranking_id, subject_id, rank, score, factors jsonb,
  frozen_at, outcome jsonb`. One writer: a new `slateRankingsJob` in
  `JOB_REGISTRY` (health_check picks it up by itself).
- The job computes every Spotlight and Specials ranking in the spec §4 for every
  sport with games today, with the factor columns the mockup shows, and
  **freezes** each ranking at its sport's first start (receipts need a ranking
  that existed before the games). A grading pass fills `outcome` next morning.
- Inputs it must build that nothing holds yet (spec §5): team K% vs pitcher
  hand (pitch corpus); TennisMyLife serve stats (fetched and stored); optional
  Understat xG for EPL.
- **Weights:** equal until a **pre-registered backtest** (commit the test and
  its pass/fail rule before the code that runs it; CURRENT.md's habit) sets
  them per ranking.
- `withJobLock` if it can overlap itself.

**Done when:** a day of rankings is frozen and graded for MLB and at least one
other sport; the backtest spec is committed; deploy approved and run.

### U0 — Tailwind 4 and the kit's foundation (U spec §6)

Unchanged from the U spec. Additions for the Slate:
- The before/after screenshots include **one `/{sport}` Scan page per sport**:
  `ScanTable`, `FilterBar` and the strips must be pixel-identical.
- `OUT_OF_SCOPE` gains nothing and loses nothing yet.

**Gate:** R10–R12 signed off and no other session editing UI files (U spec §10).

### U1 — Button family · U2 — the Hybrid table (U spec §6)

Unchanged. U2's reference set (§7 of the U spec) gains the Slate's tables as
fixtures on the kit page: Movers, Price outliers, Line disagreements, a
Spotlight (with `bar` and `streak`), a Specials ranking (with `score` bar and
`info` on every factor), and the Model picks table.

### U5 — Borrowed pieces (moved ahead of U3/U4)

Unchanged, plus what the Slate needs: `Chip.dot` (Upcoming / Live / Final),
`AvatarLabel`, `FeaturedIcon` in `EmptyState`, `Tabs.count`, `Card.count` and
`flush`. **Scan's files keep their old kit** (the glider `SegmentedToggle`,
`components/Skeleton.tsx`, `.lb-chip`) exactly as today.

### S2 — The Slate shell, Games and Props (every sport)

- **Route and chrome:** AppShell's Scan body becomes `SlatePage`. `TopBar`'s
  tab label **Scan → Slate** (the `Tab` type, `?tab=` value and any test that
  names it; keep `?tab=Scan` working as an alias). The strips are untouched.
- **`/api/slate?sport=&date=`** through `cachedRoute()` (key
  `slate:route:{sport}:{date}`, grep first). TTLs: games 60 s, lines/props
  120 s, rankings once per slate. It reads; it never writes.
- **Adapters:** `toSlateData` per sport returns `SlateData` (shared shape in
  `lib/sports/shared/slateShapes.ts`): games, movers, outliers, disagreements,
  spotlights, specials, model, with each unset where the sport has none.
- **`SectionNav`:** sticky under the header, anchor `Tabs` with counts; a hidden
  section drops out.
- **Games section:** `GameCard` grid (3 · 2 · 1 up), status filter
  (`SegmentedToggle` with counts), lines block (consensus, best price and book,
  move since first seen, book count), MLB model row, **the Elo highlight for
  NFL/CFB/NHL (D9): the picked team's logo ringed green, plus a "against the
  favorite" chip when the pick is not the market favorite**, context chips (park,
  area-forecast weather where outdoor, injuries), "Game page →" and
  "N props →". Golf: the leaderboard + winner prices. Tennis: matches. The
  game-line sanity rule (drop quotes > 15 implied points from the median, and
  invalid odds) lives in the read.
- **Props section:** `ScanTable` mounted unchanged (D3), under controls rebuilt
  on the kit — the tabs become `Tabs` with counts, the filter pills become
  `Select`s, search becomes the kit's input. `useFilters` keeps its API so the
  table receives exactly the rows it does today. "N props →" sets the existing
  Games filter.
- **Delete in this phase:** the Players/Games toggle, `GameLinesView`, `GameLine`.
- **Guard:** a test that fails if `ScanTable.tsx` or `ScanCard.tsx` change
  outside an explicitly approved commit (a content hash recorded in the test),
  and a render diff of the table at 1440/400 before and after.

**Done when:** every sport's page renders the chrome, the section links, Games
and the unchanged Scan table at 1440/400; Scan's table is pixel-identical to
before; the old toggle and market grid are gone.

### S3 — Movers, Price outliers, Line disagreements (every sport)

- Read from `game_odds_history` and `prop_odds_history` (first observation per
  book = "first seen"; the opener is not held) and the current `prop_odds`.
  Aggregation SQL in the `/api/slate` build; no new table.
- Movers: `Tabs` Game lines · Props; window `SegmentedToggle` (Since first seen ·
  3h · 1h, all real); Move bar; Steam and Split chips; sparkline.
- Outliers: ≥ 5 books, gap 4–15 implied points (larger = stale, dropped).
  Disagreements: books split on the line.
- Captions per the spec. Hidden for golf.

### S4 — Spotlights (every sport)

Reads `slate_rankings` (S1). Hit-rate leaders and Active streaks for every
sport, plus each sport's own (spec §4): MLB platoon, K spots, HR parks; NFL
receivers vs pass D, rushers vs run D; CFB rushers (team level); NBA pace-up,
usage bumps, shot zones (from October); NHL shot volume; soccer shot takers;
tennis form and serve vs return; golf low rounds. Empty states say why (MLS
history starts Aug 15; NBA/NHL until their seasons).

### S5 — Specials and receipts (every sport)

Reads `slate_rankings`. `Tabs` across the rankings; every factor a column with
`info`; the Score bar; the "why" line from each factor's percentile over the
whole pool; not-held notes (red-zone role, first-score rate, penalty takers,
lineups, strokes gained). **Receipts:** yesterday's frozen **top five** (D10) and what
happened, plus the running 7-day count. Needs S1's backtest to have set weights,
or the page says "equal weights" as the mockup does.

### S6 — Model section and Your lines

- **Model (MLB only):** today's picks (Model % beside IP, no difference), the
  total pick, yesterday's graded chips, 7- and 30-day records, calibration note.
  **Delete `TodaysPicksModal` and the "Today's Picks" button.**
- **Your lines** (signed in only): tracked lines, watchlist, slip legs and bets
  on today's slate, live status, best price now vs when tracked. Hidden when
  signed out. Uses the four user tables (TS-written, unchanged).

### U3 — Form controls · U4 — Overlays (U spec §6)

Unchanged; interleave with S3–S6. The Slate's filters (Movers window, Games
status) are already `SegmentedToggle`; nothing in the Slate waits on U3/U4.

### U6 — Page sweep (U spec §6, §8)

Unchanged, plus the Slate sections in the page inventory. Scan's untouched
files stay on `OUT_OF_SCOPE`.

### S7 — Slate close

- Every sport, every section, 1440/400, fresh tab, in-season and off-season
  states. Mockup vs page compared section by section.
- `tests/scan-no-edge.test.ts` covers every Slate section.
- `CLAUDE.md` gains the Slate adapter pattern (one line in the adapter section)
  and the "Scan table is frozen" rule.
- The handoff and `docs/CURRENT.md` updated; the mockup marked historical.

### U7 — Close (U spec §6)

Unchanged. `OUT_OF_SCOPE` remains, with the Scan files named and the reason.

## 5. Phase table

| phase | track | depends on | touches UI files | deploy | status |
|---|---|---|---|---|---|
| S0 | data | — | no | yes (ask) | not started |
| S0.5 | data + one rule | S0 | a status line only | yes (ask) | not started |
| S1 | data | S0 (Q1) | no | yes (ask) | not started |
| U0 | UI | R10–R12 sign-off | all (mechanical) | no | not started |
| U1 | UI | U0 | yes | no | not started |
| U2 | UI | U1 | yes | no | not started |
| U5 | UI | U2 | yes | no | not started |
| S2 | Slate | U2, U5 | yes | no | not started |
| S3 | Slate | S2 | yes | no | not started |
| S4 | Slate | S2, S1 | yes | no | not started |
| S5 | Slate | S2, S1 | yes | no | not started |
| S6 | Slate | S2 | yes | no | not started |
| U3 | UI | U0 | yes | no | not started |
| U4 | UI | U0 | yes | no | not started |
| U6 | UI | U1–U5 | yes | no | not started |
| S7 | Slate | S2–S6 | tests/docs | no | not started |
| U7 | UI | U6, S7 | tests/docs | no | not started |

Each row ends with a stop for the operator's sign-off.

## 6. Open questions

All three of the first round are answered (D9, D3, D10). Open now:

1. **CFB's Elo highlight:** it is the one sport with a real graded sample, and it
   is 97% market favorites at **−1.3% per unit**. Keep the green highlight there
   (D9 as written), or show it only on the games where the pick differs from the
   favorite?
2. **Watchlist and Home Runs:** both are Scan tabs today and both now have Slate
   sections (Your lines, Specials). Keep the tabs as well, or drop them in S2?
3. **A simple prop baseline for the sports with none** (NBA, CFB, soccer, tennis,
   golf): the counting engine NFL and NHL use is sport-agnostic, but each sport
   needs its own stat mapping and history. Worth a phase after S6, or leave those
   sports with prices and hit rates only?

## 7. Findings ledger

| id | found in | what | goes to | status |
|---|---|---|---|---|
| SL-1 | mockup build | Game lines include stale/exchange quotes (+10000 moneyline, `0` odds) | S2 read rule | open |
| SL-2 | mockup build | Soccer draw not in the live per-book feed | S0 | open |
| SL-3 | mockup build | ESPN `limit` above ~500 silently returns 25 events | fixed `f2232c7`; `generic_pick_capture` in S0 | partly fixed |
| SL-4 | mockup build | `game_odds_history` holds no NHL ids matching ESPN's (NHL API ids) | S2 adapter (NHL reads its own ids) | open |
| SL-5 | Q1 measurement | The Elo guesser picks the market favorite on 95–100% of games; CFB's 196 graded picks return −1.3% per unit | D9 presentation + S0 weekly check | open |
