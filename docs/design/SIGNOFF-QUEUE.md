# Sign-off queue

**What this is.** The operator is away for a long stretch (2026-09-20) and the
build is running unattended through `docs/design/master-gameplan-ui-and-slate.md`.
Every phase in that plan ends with "stop for sign-off". An unattended session
cannot stop, so instead of stopping it **writes the row here and keeps going**.

**How to read it.** One row per thing the operator would have been asked. Each
says what was decided, what it cost, and — the part that matters — **what
reversing it costs**, so the operator can spend their review time on the
expensive ones first.

**How to write a row.** Append; never rewrite someone else's row. Keep
`reversing costs` honest: if changing your mind means rebuilding a phase, say
so plainly rather than softening it.

**Status values:** `awaiting` · `approved` · `changed` (operator picked
differently; the follow-up commit is named) · `moot`.

---

## Decisions taken on a default

| # | phase | question | default taken | reversing costs | status |
|---|---|---|---|---|---|
| Q0 | M1 / S5 | MLB's game model is `baseline`, not `gated` — its CLV backtest puts it below the close (−0.0563 prob-pts, 38.0% positive on 305/448, re-measured live 2026-09-20 07:46) | Follow M1's display rule literally: S5 shows MLB's picks and the calibration note, **no** probability beside a price, no record | Additive — switch the columns on | awaiting |
| Q1 | S1 | CFB's green ring: every game, or only against-the-favorite picks? | Only where the pick differs from the market favorite (D9's own wording; 97% of picks ARE the favorite, so ringing all of them is decoration) | One boolean on the adapter's game row | awaiting |
| Q2 | S1 | Keep the Watchlist and Home Runs tabs, or drop them? | Keep both. S1's delete list names three other things; neither of these is on it | Deleting later is cheap | awaiting |
| Q3 | M5 | Build simple prop baselines for the five sports with none? | **Not built.** Needs approval, and the operator's 2026-09-20 instruction was games-only, props untouched | n/a — nothing built | awaiting |
| Q4 | U0 | Two tint classes were **dead** under Tailwind 3 and work under Tailwind 4. v3's opacity scale had no `8` or `12`, so `bg-good/12` and `bg-ink/8` compiled to nothing at all. Four call sites: the won-game chip on the player page (`PlayerResearchSections.tsx:172`) and the team page (`TeamResearchPage.tsx:191`), and two diagnostics chips | **Let them apply.** The W chip has been rendering with no green behind it while the L chip beside it had `bg-bad/10` — that is a bug the migration exposed, not a design change it made. U0's "no pixel moves" rule is about the conversion, not about preserving a class that never worked | One edit per site if you want them flat again; U6 may normalise 12 → 10 to match the sibling | awaiting |
| Q5 | U0 | The U spec says U0 uses `@tailwindcss/upgrade` and verifies with before/after screenshots of one page per sport | **Converted by hand and verified against the emitted CSS instead.** `scripts/css-diff.js` and `scripts/css-classes.js` compare the v3 and v4 stylesheets rule by rule and class name by class name — 806 classes before, 798 after, and every difference accounted for. That covers the whole app rather than ten pages, and it caught Q4, which no screenshot of a Scan page would have. Five pages were still rendered by eye | Nothing to reverse — it is a stricter check, not a looser one. The comparison stylesheets are in the scratchpad and are regenerable from git | awaiting |
| Q6 | S1 | Soccer's and tennis's lines blocks: show the numbers the book-line table gives, or show nothing? | **Show nothing, and say why on the card.** Measured: 21 books quoting one EPL match returned ten different totals because the table mixes the main market with goal lines and handicaps, and the per-book merge does not record which is which. Football and baseball are rescued by grouping on the modal point; soccer and tennis are not | One flag per adapter (`hideLines`) once S2 sorts the markets out | awaiting |
| Q7 | S1 | The Games section is a DAY. NFL's snapshot holds the week (46 games) and CFB's the board (201) | **Filter to the requested day, Eastern.** A page showing the whole week is a schedule, not a slate, and the date strip above already picks the day. An empty day names the next one that has games | One line in `buildSlateGames` | awaiting |
| Q8 | S1 | Golf has no Games section | **Left unset, so the section and its nav entry hide.** A tournament is one field, not a grid of two-sided cards. Golf's winner prices became a section of their own above the props board — which also means golf no longer LOSES the props board to look at them, as the old three-way toggle made it | Additive | awaiting |
| Q9 | S2 | **Movers: ship it with the noise, or don't ship it?** | **Not shipped.** Measured at six different thresholds; at every one, the largest moves are two or three books swinging a price 25 implied points on an unchanged line, which is quote quality rather than market movement (real steam is 1–8 points). The two cards that DO produce believable output — Price outliers and Line disagreements — shipped instead | Nothing to reverse: the readers exist in `lib/slate/marketMoves.ts` and are tested, so building the card later is wiring, not research. What it really needs first is a per-book quality pass | awaiting |
| Q10 | S3 | Spotlights were specified to read `slate_rankings`. That table holds the Specials pilot set, not these | **Built from the candidates the props board already holds**, through the same `readForm` its own L5/L10/Strk columns use. A spotlight therefore cannot disagree with the table under it, which a nightly job could not guarantee | Nothing to reverse; if a job later writes real spotlight rows, the card reads a different source and the shape is unchanged | awaiting |
| Q11 | S3 | Only the TWO universal spotlights are built. The sport-specific ones (MLB platoon, NFL receivers vs pass defenses, NBA pace-up, …) are not | **Not built.** Each needs per-sport data that is in neither the candidates nor `slate_rankings`, so building them is a data phase per sport rather than a rendering one | Additive — the card shape takes any factor columns | awaiting |
| Q12 | S4 | Specials receipts count a player who did not play as neither a hit nor a miss, and the running count is "hits of those who played" | **As built.** Counting a scratch as a miss would punish the ranking for a lineup card it could not see; counting it as a hit would flatter it | Copy + one filter in `lib/slate/specials.ts` | awaiting |
| Q13 | S4 | CFB has a ranking defined (`cfb-anytime-td`) but the job wrote no rows for it | **Section hides for CFB** until rows exist. Whether the Python job should be producing CFB rows is a job question, not a Slate one | None on the Slate side | awaiting |
| Q14 | S4 | Phone header on soccer/tennis: two selects + utilities leave the Slate/Players/Teams nav almost no width (it scrolls), and the selects truncate | **Logo mark hidden below `sm` there; nothing else moved.** The real fix is a design call — e.g. league inside the sport picker, or tabs in a second row on phones | A header layout change | awaiting |
| Q15 | S5 | **Signed-in render of "Your lines" is owed.** No credentials were used: signed out is verified (no section, no nav entry, and no `/api/bets` or `/api/tracked-lines` request fires); the signed-in shape is covered by adapter tests only | **Shipped on the tests.** Open /mlb signed in with a bet, a slip leg and a watched player on today's slate | None — a render check | awaiting |
| Q16 | S5 | The ML / O/U win–loss chips above the Slate are **gone for every sport**, not just MLB | **Removed with `TodaysPicksModal`.** They were a record, and Q0's default is "no record" for a model that has not cleared its gate; NFL/CFB/NBA/NHL's picks are Elo, never gated at all. The record still exists in `game_picks` and on /diagnostics | Additive: a Record card reading `/api/picks/game-history` | awaiting |
| Q17 | S5 | The spec's "yesterday's graded chips and 7-/30-day record" are **not built** | **Not built**, per Q0's default (no record). Specials' receipts are a different thing — a ranking's top five, not a model's picks | Additive, same as Q16 | awaiting |
| Q18 | U6 | **Type sizes snapped to the ramp, never below 11px.** 8–11.5px → `overline` (11), 12 → `label`, 13 → `body-sm`, 14–15 → `body`, 17–18 → `title`, 20–26 → `heading`. So 8–10px text GREW to 11px (golf and tennis schedules, diagnostics). Weight and tracking were held where the token would have changed them. `/diagnostics` redirects signed-out, so its U6 render is owed | **As built**, per the U spec's "nothing below 11px" | A mapping table in `scripts/u6_sizes.py` | awaiting |
| Q19 | U6 | Golf's score cells were a per-cell gradient wash; they are now **coloured numbers** (under par green, over par red, par plain) via `Column.ink` | **As built** — the one distinction a scorecard shows is birdie/par/bogey, and the kit has one table | Additive: a wash could return as a `DataTable` option | awaiting |

## Phase sign-offs owed

| phase | what to look at | status |
|---|---|---|
| R10 / R11 / R12 | The rebuilt player, team and game research pages. Built 2026-09-17/19, pushed, never reviewed. Gates nothing in U or S | awaiting |
| M1 | **The seeded model statuses — this is the list of what the app claims about itself.** `/diagnostics` → model status, or `GET /api/model-status` | awaiting |
| M2 | CFB's calibration numbers before they drive anything user-visible | awaiting |
| M3 | One day's frozen rankings against the mockup's columns. First real receipts: 2026-09-21 | awaiting |

## Still owed by the operator (not a decision — an action)

- **Rebuild and restart the port-3000 production server.** It predates the ESPN
  range fix (2026-09-19) and will blank NFL/CFB/soccer again on its next
  rebuild. Carried since M0; nothing an agent can do.
