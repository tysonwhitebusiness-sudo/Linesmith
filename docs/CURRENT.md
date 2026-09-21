# CURRENT — pick up here

**Rewritten 2026-09-20, end of the unattended run.**

---

# WHAT HAPPENED WHILE YOU WERE OUT

Seven phases of `docs/design/master-gameplan-ui-and-slate.md` were built,
verified and pushed: **U0, U1, U2, U5, S1, two thirds of S2, and S3.** Nothing was deployed —
`render.yaml` has `autoDeploy: false`, so pushing is safe and the worker is
still on `c5baee4`. Every phase is on `main`.

**The headline: `/{sport}` is the Slate now.** The tab says Slate, the body is
sections, and the Games section is real on every sport.

| commit | phase | what |
|---|---|---|
| `d3b1f4c` | U0 | Tailwind 3.4 → 4, the token bridge, `cx` on tailwind-merge, `RouterProvider`, `/kit` |
| `689f600` | U1 | `Button` / `IconButton` / `CloseButton`; 73 of 96 raw buttons moved; `.lb-btn-primary` deleted |
| `96defca` | U2 | the Hybrid `DataTable`, `Card.count` / `flush`, `Pagination`, the kit's table fixtures |
| `9bb8867` | U5 | `Chip.dot`, `Tag`, `Tabs.count`, `SegmentedToggle.icon`, `AvatarLabel`, `AvatarGroup`, `FeaturedIcon` |
| `a458a17` | S1 | `/api/slate`, 7 sport adapters, SectionNav, GameCards, the props board |
| `170c06e` | S2 (part) | Price outliers and Line disagreements. **Movers deliberately not built** — see below |
| `ed04d76` | S3 | Hit-rate leaders and Active streaks, every sport, from the candidates — S3's `slate_rankings` premise was false |

**Decisions taken on a default are in `docs/design/SIGNOFF-QUEUE.md`** — ten
rows now (Q0–Q9). The expensive ones to reverse are **Q6** (soccer and tennis
show no lines block) and **Q7** (the Games section is one DAY, not a week).
**Q9 is the one to read first**: Movers was measured and not built.

**Six numbered phases remain**: S4 Specials and receipts, S5 Model and Your
lines, U3 Form controls, U4 Overlays, U6 Page sweep, and the two closes S6 and
U7. Movers is the open piece of S2; the sport-specific spotlights are the open
piece of S3.

**S4's data is measured and ready.** `slate_rankings` holds exactly the four
Specials rankings — `mlb-hr-of-the-day` (10 rows), `mlb-most-strikeouts` (10),
`nfl-anytime-td` (18) and `soccer-anytime-goalscorer` (EPL 15, MLS 10) — each
with its factors and percentiles as jsonb. What it does NOT have yet is a
single graded row: receipts need `outcome` filled, and the gameplan expects the
first ones on 2026-09-21.

---

## What renders now that did not before

Open `/mlb` and you get, under the unchanged top bar and date strip:

- a **sticky section nav** — Games 15 · Props 902 — derived from the data, so a
  section that has nothing drops out of the nav too;
- a **Games grid**, 3-up at 1440 and 1-up at 400, with a status filter carrying
  real counts (All 15 · Upcoming 1 · Live 5 · Final 9). Each card has the
  status, the venue, both teams with crests and probable starters, live or
  final scores, a three-column lines block (spread · total · moneyline) with
  the consensus, the best price and its book and the book count, a weather
  chip, and links to the game page and the prop count;
- **"Where the books differ"** — Price outliers (one book well off the median
  of at least five others, the gap in implied points with a magnitude bar) and
  Line disagreements (who is hanging the other number, and how many). Both
  captioned as facts about the books, not as edges;
- the **props board**, with its tabs rebuilt on the kit and carrying real
  counts. **The table itself is untouched** and a content-hash test now pins it.

Every sport has it. NFL shows 14 Sunday games with five Elo model rows; NBA and
CFB show their real empty days and name the next one (2026-10-03, 2026-09-24);
NHL its preseason; WTA five matches; ATP its "next matches are on 09-23"; golf
has no Games section at all, and its winner prices became a section of their
own — so golf no longer loses the props board to look at them.

`/kit` (dev only) is the whole design system on one page: tokens, the Tailwind
4 traps, the Button family, the Hybrid table with the research reference types
AND the Slate's own tables on fixtures, and the borrowed pieces.

---

## Start here

1. `docs/design/master-gameplan-ui-and-slate.md` — §5's phase table is current.
   **Next phase: S4 (Specials and receipts).** Its rows already exist; its
   receipts do not until a day has been graded.
2. `docs/design/SIGNOFF-QUEUE.md` — Q0–Q9, and the phase sign-offs owed.
3. `docs/design/ui-system-master-prompt.md` — the U track's status line and its
   findings ledger (U-1 … U-10) are current.
4. This file's "What is not done" below, which is the honest list.

**On Movers, and why it is not built.** The premise was measured first
(`scripts/probe-odds-history.ts`) and the DATA holds: 3,769 moved game lines
across 52 games in 36 hours, and 120,495 moved prop lines. The SIGNAL does not.
At every threshold tried — raw, ±5000, ±2000, pick'em books excluded, grouped
by point, capped at 25 implied points — the largest moves are the same two or
three books (Fanatics, HardRockBet, ProphetX) swinging a price 25 points on a
line that did not move. That is quote quality, not a market changing its mind;
real steam is one to eight points. The readers exist and are tested in
`lib/slate/marketMoves.ts`, so building the card later is wiring rather than
research — what it needs first is a per-book quality pass, which is its own
piece of work. `game_odds_history` has no `sport` column; it is keyed by
`event_id`, so a per-sport read joins through the snapshot's game ids.

---

## What is NOT done, honestly

**In S1, and on the ledger rather than quietly dropped:**

- The props **filter pills and search** are untouched. S1's spec says they
  become `Select`s and the kit input — both are U3 components, and the gameplan
  runs U3 *after* S1 (SL-16). The tabs were rebuilt; the pills still work as
  they did.
- **Team records** ("92-63") are absent on every card: the snapshot's
  `SlateGame` does not carry one (SL-17).
- The lines block has **no "since first seen" movement**, and will not until
  Movers is buildable (Q9) — it would read off the same quotes.
- "N props →" is a **label, not a link**; it does not yet set the Games filter.

**In U2, as a named ratchet, not a zero:** six hand-rolled tables remain, each
with the phase that takes it — diagnostics' eleven and golf's four go to U6,
and two are things `DataTable` genuinely cannot express yet: a grouped header
row for the pitch table (U-7) and a per-cell gradient wash for golf's scorecard
(U-8).

**In U1, likewise:** 23 raw buttons survive, each named in
`tests/ui-buttons.test.ts` with its phase — five listbox options (U3), the slip
scrim (U4), the old glider toggle (U5's file, kept while Scan uses it), 14
diagnostics controls (U6) and `global-error.tsx`, which runs when the
stylesheet may never have loaded and is right to use inline styles.

**Soccer and tennis show NO lines block** (Q6). Measured: one EPL match carried
totals of 0.5, 1.5, 2.5, 3, 3.25, 3.5, 5.5, 6.5, 7.5 and 8.5 across 21 books,
because `game_odds_book_lines` holds alternative and derivative markets beside
the main one and the per-book merge does not record which is which. Grouping on
the modal point rescues football and baseball; it does not rescue a sport where
a "moneyline" can be a goal line. The card says so. S2 read that family of
tables in anger and did NOT sort it out — it found the same problem one layer
down (Q9), so this stays open and is the same piece of work.

**No signed-in surface was verified** — there are no credentials in the repo
beyond Supabase's public anon key, and none were created. S5's "Your lines" is
not built yet; when it is, the signed-out half (the section is HIDDEN, not an
empty card) is the half that can be checked here.

---

## Owed by you

- ~~Rebuild and restart the port-3000 production server.~~ **DONE 2026-09-20
  23:18 ET**, at the operator's request, from `6188c30`. It has the ESPN range
  fix and every phase below. `/mlb` serves in 0.9 s there against 60-90 s in
  dev, and `/kit` correctly 404s. Restart it after any future `npm run build`.
- **A deploy, if you want any of this live.** Nothing in U or S needs the
  worker, so nothing was deployed and nothing is waiting on one.
- **Sign-off:** the twelve queue rows, plus R10/R11/R12 and M1–M3 from before.

---

## Findings worth knowing before the next phase

All of these were found by RENDERING, not by typing — the tests came after,
and each is pinned by one now (`tests/slate-shell.test.ts`).

- **Every price on a `BookmakerOdds` is DECIMAL**, not just the moneyline. Only
  `homeOdds` carries a comment saying so. Spreads and totals had vanished from
  every card (SL-12).
- **`game_odds_book_lines.sport` is the GENERIC key** — `soccer`, never
  `soccer_epl`, while `game_picks` is granular. `db.py` warns about exactly this
  and it still bit (SL-13).
- **A live game's `state` is a phrase**, not a keyword: "In Progress", "Manager
  challenge", "Delayed". Equality put five live MLB games in the Final bucket
  (SL-15).
- **The median of American odds is not a price.** One card's consensus read "0".
- **One book is not a consensus.** An NFL card printed a +30.5 spread off a
  single quote.
- **`/mlb` takes 60–90 seconds to settle in dev** (SL-11) — `/api/mlb` is 26 MB
  and `/api/props/lines` is 23.7 MB, fetched twice. Until then the page honestly
  reads "No candidates match these filters", which cost half an hour chasing a
  regression that was not one. **Wait for `table tbody tr` before judging a
  Scan/Slate render.** `/api/slate` exists partly because of this: MLB's is
  10.8 KB and the top of the page draws in a second.
- **Two tint classes were DEAD under Tailwind 3 and work under 4** (U-1,
  queue Q4): v3's opacity scale had no `8` or `12`, so `bg-good/12` compiled to
  nothing and the won-game chip rendered with no green while the lost-game chip
  beside it had `bg-bad/10`.

---

## Habits that kept paying

- **Audit a phase's premises before building it.** S2's was measured first and
  held; S1's line-reading premises were measured and three of them were wrong.
- **Render before believing.** Every one of S1's five bugs type-checked
  perfectly and passed every existing test.
- **Diff the bytes, not the status code.** U0 was verified by comparing the
  emitted stylesheets rule by rule (`scripts/css-diff.js`,
  `scripts/css-classes.js`) rather than by screenshots — 806 class names before,
  798 after, every difference accounted for. It caught Q4, which no screenshot
  of a Scan page would have.
- **A guard can be a ratchet.** Exact per-file counts with a reason and a phase
  beside each one: it fails on a new offender immediately, and it cannot
  quietly absorb one.

---

## Standing constraints

- **Ask before deploying to Render.** `git push` does not deploy.
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- **Do not render against port 3000's `linesmith-prod`.** Use
  `preview_start {name: "linesmith-dev"}`, which builds from the working tree.
- **If a whole sweep 500s at once, restart the dev server** before debugging.
- The Postgres pooler caps at **15 connections** — check for running fits first.
- Python tests and fits are standalone: `.venv/Scripts/python.exe <file>.py`.
- **At ~92% context, stop and hand off** by rewriting this file.
